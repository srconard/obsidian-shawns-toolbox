// threads-view.ts — the Threads side panel. Reads #thread posts from every
// note outside the excluded folders (via ThreadService) and renders a list → flat
// chronological thread view (4chan-style) with reply indicators and a reply
// action. Primary reading surface is the phone.
import { Menu, Notice, TAbstractFile, setIcon } from "obsidian";
import type { CardsHost } from "./section-cards";
import { ThreadService } from "./thread-service";
import {
	summarizeThreads,
	postOrder,
	targetKey,
	periodicPosts,
	summarizePeriods,
	listRemovableTags,
	THOUGHT_PERIODS,
	type ThreadPost,
	type PeriodicPost,
	type ThoughtPost,
} from "./thread-core";
import { UNSORTED_AREA, type ThreadArea } from "./thread-areas";
import {
	groupTreeByArea,
	menuAreaGroups,
	findNode,
	buildThreadTree,
	subtreeFilter,
	type ThreadNode,
	type TreeAreaGroup,
} from "./thread-tree-core";
import {
	groupPostsWithReplies,
	descendantReplies,
	type ReplyNode,
	type ReplyPost,
	type PostGroup,
} from "./thread-replies-core";
import type { TagOp } from "./retag-core";
import { ecoGroupsFromPostGroups, type EcoSendMode } from "./eco-send-core";
import { sendThreadToEco } from "./eco-send";
import {
	buildMonthGrid,
	monthDayIsos,
	monthStartIso,
	cellState,
	stepDayIso,
	stepMonthIso,
	canStepDay,
	canStepMonth,
	thoughtsTitle,
	dayHeaderLabel,
	missingNoteMessage,
	isDateIso,
} from "./thoughts-calendar-core";
import {
	wireLongPressMenu,
	wireChipLongPress,
	confirmRemoveTag,
	askApplyToReplies,
	showTagMenu as showTagMenuAt,
} from "./tag-menu";
import { ToolboxPanel } from "./panel-base";
import { ToolboxPanelView } from "./panel-view";

/** A post the add-tag menu can act on — a thread post, a periodic-thought post,
 *  a today's-thought post, or a reply line (v1.51.0); all carry the fields the
 *  service needs to locate and edit the source line. */
type TaggablePost = ThreadPost | PeriodicPost | ThoughtPost | ReplyPost;
type PeriodTagFilter = "all" | "tagged" | "untagged";

export const THREADS_VIEW_TYPE = "shawns-toolbox-threads";

const PREVIEW_LEN = 60;
const REFRESH_DEBOUNCE_MS = 400;

export class ThreadsPanel extends ToolboxPanel {
	private service: ThreadService;
	private posts: ThreadPost[] = [];
	private periodic: PeriodicPost[] = [];
	// Every "↩ [[note#^id]]" line in the vault, tagged or not (v1.51.0).
	private replies: ReplyPost[] = [];
	private today: ThoughtPost[] = [];
	// The thoughts screen's posts for the day it is showing. Same array object
	// as `today` while the selected day IS today.
	private dayThoughts: ThoughtPost[] = [];
	private dayNoteExists = true;
	// Thread → area mapping, parsed from the Shawn-editable areas note.
	private areas: ThreadArea[] = [];
	private activeThread: string | null = null;
	private activePeriod: string | null = null;
	// Thoughts view (every top-level thought in a day's note).
	private activeToday = false;
	// Which day the thoughts view is showing. Session-scoped only — never
	// persisted, and reset to today every time the Threads button opens the
	// screen, so "Today's thoughts" always means today (v1.47.0).
	private thoughtsDate: string | null = null;
	// Month the calendar picker is showing (first of month), or null = closed.
	private calendarMonth: string | null = null;
	// Days of `calendarMonth` that have a daily note — the picker's dots.
	private calendarNotes = new Set<string>();
	private threadPeriodFilter = new Set<string>();
	// Periodic-thoughts view: show all posts, only those already carrying a
	// #thread/ tag, or only untagged ones (Shawn's "not yet processed" set).
	private periodTagFilter: PeriodTagFilter = "all";
	// Same tagged/untagged filter for the "Today's thoughts" processing pass.
	private todayTagFilter: PeriodTagFilter = "all";
	private replyOpenFor: string | null = null;
	private refreshTimer: number | null = null;
	// Which surface the DOM currently shows, so render() can save the list's
	// scroll offset before drilling into a thread/period and restore it on the
	// way back (session-scoped; contentEl is the scroll container).
	private renderedMode: "list" | "thread" | "period" | "today" | null = null;
	private listScroll = 0;

	constructor(host: CardsHost, contentEl: HTMLElement) {
		super(host, contentEl);
		this.service = new ThreadService(host.app, host.getSettings);
	}

	protected async onOpen(): Promise<void> {
		this.contentEl.addClass("stx-threads");
		const rescanOn = (file: TAbstractFile) => {
			if (!this.service.isScannableFile(file)) return;
			this.service.invalidate(file.path);
			this.scheduleRefresh();
		};
		this.registerEvent(this.app.vault.on("modify", rescanOn));
		this.registerEvent(this.app.vault.on("create", rescanOn));
		this.registerEvent(this.app.vault.on("delete", rescanOn));
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.service.invalidate(oldPath);
				rescanOn(file);
			})
		);
		// The areas note may sit in an excluded folder (so rescanOn skips it);
		// refresh the grouping whenever it changes, mirroring the Pillars panel.
		const onAreasFile = (f: { path: string }) => {
			if (f.path === this.host.getSettings().threadAreasNotePath)
				this.scheduleRefresh();
		};
		this.registerEvent(this.app.vault.on("modify", onAreasFile));
		this.registerEvent(this.app.vault.on("create", onAreasFile));
		this.registerEvent(
			this.app.vault.on("rename", (f, oldPath) => {
				if (
					f.path === this.host.getSettings().threadAreasNotePath ||
					oldPath === this.host.getSettings().threadAreasNotePath
				)
					this.scheduleRefresh();
			})
		);
		await this.refresh();
	}

	protected async onClose(): Promise<void> {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.contentEl.empty();
	}

	private scheduleRefresh(): void {
		// Don't yank the UI out from under an in-progress reply.
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			if (this.isTypingReply()) return;
			void this.refresh();
		}, REFRESH_DEBOUNCE_MS);
	}

	private isTypingReply(): boolean {
		const active = document.activeElement;
		return (
			this.replyOpenFor !== null &&
			active instanceof HTMLElement &&
			this.contentEl.contains(active) &&
			active.classList.contains("stx-thread-reply-input")
		);
	}

	private async refresh(): Promise<void> {
		const { posts, periodic, replies } = await this.service.scanAll();
		this.posts = posts;
		this.periodic = periodic;
		this.replies = replies;
		this.today = await this.service.todayThoughtPosts();
		await this.loadDayThoughts();
		this.areas = await this.service.loadThreadAreas();
		this.render();
	}

	private render(): void {
		// Remember the list's scroll offset before we tear it down, so returning
		// from a thread/period (or re-rendering the list after a rescan) lands
		// where Shawn was rather than at the top.
		if (this.renderedMode === "list") {
			this.listScroll = this.contentEl.scrollTop;
		}
		this.contentEl.empty();
		if (this.activeToday) {
			this.renderedMode = "today";
			this.renderToday();
		} else if (this.activePeriod !== null) {
			this.renderedMode = "period";
			this.renderPeriod(this.activePeriod);
		} else if (this.activeThread !== null) {
			this.renderedMode = "thread";
			this.renderThread(this.activeThread);
		} else {
			this.renderedMode = "list";
			this.renderList();
			this.restoreListScroll();
		}
	}

	private restoreListScroll(): void {
		const apply = () => (this.contentEl.scrollTop = this.listScroll);
		apply();
		// Height isn't always settled synchronously on mobile; reapply next frame.
		window.requestAnimationFrame(apply);
	}

	// ---- thread list ----

	private renderList(): void {
		// Top of the main page: jump into today's thoughts (the capture→process
		// bridge). Shown regardless of whether any threads exist yet.
		const untagged = this.today.filter((p) => p.thread === null).length;
		const todayBtn = this.contentEl.createEl("button", {
			cls: "stx-today-btn",
			text:
				untagged > 0
					? `Today's thoughts · ${untagged} untagged`
					: "Today's thoughts",
		});
		todayBtn.addEventListener("click", () => {
			this.activeToday = true;
			this.activeThread = null;
			this.activePeriod = null;
			this.todayTagFilter = "all";
			// Entering from the Threads button always lands on today, whatever day
			// the screen was left on earlier in the session.
			this.thoughtsDate = this.service.todayIso();
			this.calendarMonth = null;
			void this.loadDayThoughts().then(() => this.render());
		});

		const head = this.contentEl.createDiv({ cls: "stx-threads-head" });
		head.createSpan({ cls: "stx-threads-title", text: "Threads" });
		this.iconButton(head, "refresh-cw", "Rescan", () => void this.refresh());

		const summaries = summarizeThreads(this.posts);
		const periods = summarizePeriods(this.periodic);
		if (summaries.length === 0 && periods.length === 0) {
			this.contentEl.createDiv({
				cls: "stx-threads-empty",
				text: "No #thread or #thought posts found in your notes yet.",
			});
			return;
		}
		if (summaries.length > 0) {
			// Nested tags (#thread/a/b/c) render as a collapsible tree (v1.51.0);
			// areas assign root threads, and a child always follows its root.
			const pinned = this.pinnedThreads();
			const pinnedSet = new Set(pinned);
			const groups = groupTreeByArea(summaries, this.areas, pinned);
			const flat =
				groups.length === 0 ||
				(groups.length === 1 && groups[0].area === UNSORTED_AREA);
			if (flat) {
				// No areas organised yet — one list, no area headers.
				const list = this.contentEl.createDiv({ cls: "stx-thread-list" });
				this.renderTreeNodes(list, groups[0]?.roots ?? [], pinnedSet);
			} else {
				for (const g of groups) this.renderAreaGroup(g, pinnedSet);
			}
		}
		if (periods.length > 0) {
			const sec = this.contentEl.createDiv({ cls: "stx-period-section" });
			sec.createDiv({ cls: "stx-period-head", text: "Periodic thoughts" });
			const list = sec.createDiv({ cls: "stx-thread-list" });
			for (const s of periods) {
				const when = s.lastActiveTime
					? `${s.lastActiveDate} ${s.lastActiveTime}`
					: s.lastActiveDate;
				this.listRow(
					list,
					`${cap(s.period)} thoughts`,
					when,
					s.postCount,
					() => {
						this.activePeriod = s.period;
						this.periodTagFilter = "all";
						this.replyOpenFor = null;
						this.render();
					}
				);
			}
		}
	}

	/** An area group: a collapsible header + (when expanded) its thread rows. */
	private renderAreaGroup(group: TreeAreaGroup, pinnedSet: Set<string>): void {
		const collapsed = this.collapsedAreas().includes(group.area);
		const sec = this.contentEl.createDiv({ cls: "stx-area-section" });
		const header = sec.createDiv({ cls: "stx-area-head" });
		if (collapsed) header.addClass("is-collapsed");
		const chevron = header.createSpan({ cls: "stx-area-chevron" });
		setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
		header.createSpan({ cls: "stx-area-name", text: group.area });
		header.createSpan({
			cls: "stx-area-count",
			text: String(group.roots.length),
		});
		header.addEventListener("click", () => void this.toggleArea(group.area));
		if (!collapsed) {
			const list = sec.createDiv({ cls: "stx-thread-list" });
			this.renderTreeNodes(list, group.roots, pinnedSet);
		}
	}

	/**
	 * Render thread-tree nodes (v1.51.0): one row per node, indented by depth.
	 * A node with children gets a chevron that collapses them (remembered in
	 * settings.threadTreeCollapsed); tapping the row opens the node, whose view
	 * lists its own posts plus every descendant's. The count is the roll-up.
	 */
	private renderTreeNodes(
		list: HTMLElement,
		nodes: ThreadNode[],
		pinnedSet: Set<string>
	): void {
		const collapsedSet = new Set(this.collapsedThreads());
		for (const node of nodes) {
			const when = node.lastActiveTime
				? `${node.lastActiveDate} ${node.lastActiveTime}`
				: node.lastActiveDate;
			let wasLongPress: () => boolean = () => false;
			const row = this.listRow(
				list,
				node.label,
				when,
				node.totalCount,
				() => {
					if (wasLongPress()) return;
					this.openThread(node.name);
				},
				pinnedSet.has(node.name)
			);
			row.addClass("stx-thread-tree-row");
			row.style.setProperty("--stx-tree-depth", String(node.depth));
			row.setAttr("aria-label", `#thread/${node.name}`);
			const nameEl = row.querySelector(".stx-thread-row-name");
			const hasKids = node.children.length > 0;
			const collapsed = hasKids && collapsedSet.has(node.name);
			if (nameEl instanceof HTMLElement) {
				const chev = createSpan({ cls: "stx-thread-tree-chevron" });
				nameEl.prepend(chev);
				if (hasKids) {
					setIcon(chev, collapsed ? "chevron-right" : "chevron-down");
					chev.setAttr("aria-label", collapsed ? "Expand" : "Collapse");
					chev.addEventListener("click", (e) => {
						e.stopPropagation();
						void this.toggleThreadCollapsed(node.name);
					});
				} else chev.addClass("is-leaf");
			}
			if (hasKids && node.ownCount !== node.totalCount) {
				const meta = row.querySelector(".stx-thread-row-meta");
				if (meta instanceof HTMLElement)
					meta.createSpan({
						cls: "stx-thread-row-own",
						text: `${node.ownCount} here`,
					});
			}
			wasLongPress = wireLongPressMenu(row, (x, y, onHide) =>
				this.showThreadMenu(node.name, x, y, onHide)
			);
			if (hasKids && !collapsed) this.renderTreeNodes(list, node.children, pinnedSet);
		}
	}

	private openThread(name: string): void {
		this.activeToday = false;
		this.activePeriod = null;
		this.calendarMonth = null;
		this.activeThread = name;
		this.threadPeriodFilter.clear();
		this.replyOpenFor = null;
		this.render();
	}

	private collapsedThreads(): string[] {
		return this.host.getSettings().threadTreeCollapsed ?? [];
	}

	private async toggleThreadCollapsed(name: string): Promise<void> {
		const settings = this.host.getSettings();
		const current = settings.threadTreeCollapsed ?? [];
		settings.threadTreeCollapsed = current.includes(name)
			? current.filter((n) => n !== name)
			: [...current, name];
		await this.host.saveSettings();
		this.render();
	}

	private collapsedAreas(): string[] {
		return this.host.getSettings().threadAreasCollapsed ?? [];
	}

	private async toggleArea(area: string): Promise<void> {
		const settings = this.host.getSettings();
		const current = settings.threadAreasCollapsed ?? [];
		settings.threadAreasCollapsed = current.includes(area)
			? current.filter((a) => a !== area)
			: [...current, area];
		await this.host.saveSettings();
		this.render();
	}

	private listRow(
		list: HTMLElement,
		name: string,
		when: string,
		count: number,
		onClick: () => void,
		pinned = false
	): HTMLElement {
		const row = list.createDiv({ cls: "stx-thread-row" });
		if (pinned) row.addClass("is-pinned");
		const nameEl = row.createDiv({ cls: "stx-thread-row-name" });
		if (pinned) {
			const pin = nameEl.createSpan({ cls: "stx-thread-row-pin" });
			setIcon(pin, "pin");
		}
		nameEl.createSpan({ text: name });
		const meta = row.createDiv({ cls: "stx-thread-row-meta" });
		meta.createSpan({ cls: "stx-thread-row-date", text: when });
		meta.createSpan({
			cls: "stx-thread-row-count",
			text: `${count} post${count === 1 ? "" : "s"}`,
		});
		row.addEventListener("click", onClick);
		return row;
	}

	// ---- thoughts for a day (default today) ----

	/** The day the thoughts screen is showing — today until Shawn moves it. */
	private selectedDay(): string {
		return this.thoughtsDate ?? this.service.todayIso();
	}

	/** Load the selected day's thought posts. Today's are already in hand from
	 *  the refresh (the list button's untagged count needs them), so that case
	 *  costs no extra read. */
	private async loadDayThoughts(): Promise<void> {
		const day = this.selectedDay();
		this.dayNoteExists = this.service.hasDayNote(day);
		this.dayThoughts =
			day === this.service.todayIso()
				? this.today
				: await this.service.dayThoughtPosts(day);
	}

	/** Move the thoughts screen to a day, clamped at today, and redraw. */
	private async goToDay(dateIso: string): Promise<void> {
		if (!isDateIso(dateIso)) return;
		const today = this.service.todayIso();
		this.thoughtsDate = dateIso > today ? today : dateIso;
		this.calendarMonth = null;
		await this.loadDayThoughts();
		this.render();
	}

	/** Open (or move) the month picker, probing the vault for which of that
	 *  month's days actually have a daily note. */
	private showCalendar(monthIso: string): void {
		this.calendarMonth = monthStartIso(monthIso);
		this.calendarNotes = this.service.daysWithNotes(
			monthDayIsos(this.calendarMonth)
		);
		this.render();
	}

	private renderToday(): void {
		const day = this.selectedDay();
		const today = this.service.todayIso();

		const head = this.contentEl.createDiv({ cls: "stx-threads-head" });
		this.iconButton(head, "arrow-left", "Back", () => {
			this.activeToday = false;
			this.calendarMonth = null;
			this.render();
		});
		head.createSpan({
			cls: "stx-threads-title",
			text: thoughtsTitle(day, today),
		});
		if (day !== today) {
			const todayBtn = head.createEl("button", {
				cls: "stx-thoughts-today",
				text: "Today",
				attr: { "aria-label": "Back to today" },
			});
			todayBtn.addEventListener("click", () => void this.goToDay(today));
		}

		// Day navigation: ‹ | the date (tap = calendar) | › | calendar button.
		const nav = this.contentEl.createDiv({ cls: "stx-thoughts-nav" });
		const stepBtn = (icon: string, label: string, delta: -1 | 1) => {
			const btn = nav.createEl("button", {
				cls: "stx-thoughts-navbtn",
				attr: { "aria-label": label },
			});
			setIcon(btn, icon);
			if (!canStepDay(day, delta, today)) {
				btn.disabled = true;
				btn.addClass("is-disabled");
			} else {
				btn.addEventListener("click", () =>
					void this.goToDay(stepDayIso(day, delta))
				);
			}
		};
		stepBtn("chevron-left", "Previous day", -1);

		const dateBtn = nav.createEl("button", {
			cls: "stx-thoughts-date",
			text: dayHeaderLabel(day),
			attr: { "aria-label": "Pick a day" },
		});
		dateBtn.addEventListener("click", () => {
			if (this.calendarMonth) {
				this.calendarMonth = null;
				this.render();
			} else this.showCalendar(day);
		});

		stepBtn("chevron-right", "Next day", 1);

		const calBtn = nav.createEl("button", {
			cls: "stx-thoughts-navbtn",
			attr: { "aria-label": "Open the month calendar" },
		});
		setIcon(calBtn, "calendar-days");
		if (this.calendarMonth) calBtn.addClass("is-active");
		calBtn.addEventListener("click", () => {
			if (this.calendarMonth) {
				this.calendarMonth = null;
				this.render();
			} else this.showCalendar(day);
		});

		if (this.calendarMonth) this.renderCalendar(this.calendarMonth, day, today);

		// Same All / Tagged / Untagged filter as the periodic views, so this view
		// doubles as a processing pass (Untagged = no #thread/ tag yet).
		const all = this.dayThoughts;
		const filterBar = this.contentEl.createDiv({ cls: "stx-period-filter" });
		const opts: Array<[PeriodTagFilter, string]> = [
			["all", "All"],
			["tagged", "Tagged"],
			["untagged", "Untagged"],
		];
		for (const [key, label] of opts) {
			const chip = filterBar.createEl("button", {
				cls: "stx-period-chip",
				text: label,
			});
			if (this.todayTagFilter === key) chip.addClass("is-active");
			chip.addEventListener("click", () => {
				this.todayTagFilter = key;
				this.render();
			});
		}
		const posts =
			this.todayTagFilter === "tagged"
				? all.filter((p) => p.thread !== null)
				: this.todayTagFilter === "untagged"
				  ? all.filter((p) => p.thread === null)
				  : all;

		if (posts.length === 0) {
			this.contentEl.createDiv({
				cls: "stx-threads-empty",
				text: !this.dayNoteExists
					? missingNoteMessage(day)
					: all.length === 0
					  ? day === today
						  ? "No thoughts in today's note yet."
						  : "No thoughts in that day's note."
					  : "No thoughts match this filter.",
			});
			return;
		}

		const listEl = this.contentEl.createDiv({ cls: "stx-thread-posts" });
		for (const post of posts) {
			const card = listEl.createDiv({ cls: "stx-post" });
			// v1.51.0: tap opens the note at the line; long-press tags.
			this.wireOpenTap(card, post, this.wireTagMenu(card, post));
			const dateLine = card.createDiv({ cls: "stx-post-date" });
			dateLine.setText(this.sourceLabel(post));
			card.createDiv({ cls: "stx-post-text", text: post.text });
			if (post.thread) {
				const threadName = post.thread;
				const t = card.createDiv({ cls: "stx-post-thread" });
				t.setText(`#thread/${threadName}`);
				this.wireThreadChip(t, post, threadName, () => this.openThread(threadName));
			}
		}
	}

	// ---- month calendar picker ----

	/**
	 * A month grid dropped inline under the nav row (rather than a floating
	 * popover, which is a positioning minefield inside the phone drawer).
	 * Days that have a daily note carry a dot; today is outlined; the selected
	 * day is filled; future days and the neighbour-month padding are dead.
	 */
	private renderCalendar(monthIso: string, selected: string, today: string): void {
		const grid = buildMonthGrid(monthIso);
		const root = this.contentEl.createDiv({ cls: "stx-cal" });

		const head = root.createDiv({ cls: "stx-cal-head" });
		const monthBtn = (icon: string, label: string, delta: -1 | 1) => {
			const btn = head.createEl("button", {
				cls: "stx-cal-navbtn",
				attr: { "aria-label": label },
			});
			setIcon(btn, icon);
			if (!canStepMonth(grid.monthIso, delta, today)) {
				btn.disabled = true;
				btn.addClass("is-disabled");
			} else {
				btn.addEventListener("click", () =>
					this.showCalendar(stepMonthIso(grid.monthIso, delta))
				);
			}
		};
		monthBtn("chevron-left", "Previous month", -1);
		head.createSpan({ cls: "stx-cal-title", text: grid.label });
		monthBtn("chevron-right", "Next month", 1);

		const weekdayRow = root.createDiv({ cls: "stx-cal-weekdays" });
		for (const wd of grid.weekdays)
			weekdayRow.createSpan({ cls: "stx-cal-weekday", text: wd });

		const body = root.createDiv({ cls: "stx-cal-grid" });
		const ctx = {
			todayIso: today,
			selectedIso: selected,
			notes: this.calendarNotes,
		};
		for (const week of grid.weeks) {
			for (const cell of week) {
				const state = cellState(cell, ctx);
				if (!state.inMonth) {
					body.createDiv({ cls: "stx-cal-day is-pad" });
					continue;
				}
				const el = body.createEl("button", {
					cls: "stx-cal-day",
					attr: { "aria-label": cell.iso },
				});
				el.createSpan({ cls: "stx-cal-daynum", text: String(cell.day) });
				if (state.hasNote) el.createSpan({ cls: "stx-cal-dot" });
				if (state.isToday) el.addClass("is-today");
				if (state.isSelected) el.addClass("is-selected");
				if (!state.selectable) {
					el.disabled = true;
					el.addClass("is-disabled");
					continue;
				}
				el.addEventListener("click", () => void this.goToDay(cell.iso));
			}
		}
	}
	// ---- periodic-thoughts detail ----

	private renderPeriod(period: string): void {
		const head = this.contentEl.createDiv({ cls: "stx-threads-head" });
		this.iconButton(head, "arrow-left", "Back", () => {
			this.activePeriod = null;
			this.render();
		});
		head.createSpan({
			cls: "stx-threads-title",
			text: `${cap(period)} thoughts`,
		});

		// Tagged / untagged filter: "untagged" = no #thread/ tag yet, i.e. not
		// yet processed into a thread — the set Shawn works through.
		const all = periodicPosts(this.periodic, period);
		const filterBar = this.contentEl.createDiv({ cls: "stx-period-filter" });
		const opts: Array<[PeriodTagFilter, string]> = [
			["all", "All"],
			["tagged", "Tagged"],
			["untagged", "Untagged"],
		];
		for (const [key, label] of opts) {
			const chip = filterBar.createEl("button", {
				cls: "stx-period-chip",
				text: label,
			});
			if (this.periodTagFilter === key) chip.addClass("is-active");
			chip.addEventListener("click", () => {
				this.periodTagFilter = key;
				this.render();
			});
		}
		const posts =
			this.periodTagFilter === "tagged"
				? all.filter((p) => p.thread !== null)
				: this.periodTagFilter === "untagged"
				  ? all.filter((p) => p.thread === null)
				  : all;

		const listEl = this.contentEl.createDiv({ cls: "stx-thread-posts" });
		for (const post of posts) {
			const card = listEl.createDiv({ cls: "stx-post" });
			// v1.51.0: tap opens the note at the line; long-press tags.
			this.wireOpenTap(card, post, this.wireTagMenu(card, post));
			const dateLine = card.createDiv({ cls: "stx-post-date" });
			dateLine.setText(this.sourceLabel(post));
			card.createDiv({ cls: "stx-post-text", text: post.text });
			if (post.thread) {
				const threadName = post.thread;
				const t = card.createDiv({ cls: "stx-post-thread" });
				t.setText(`#thread/${threadName}`);
				this.wireThreadChip(t, post, threadName, () => this.openThread(threadName));
			}
		}
	}

	// ---- thread detail ----

	/**
	 * One thread (or tree node): its own posts plus every descendant's
	 * (v1.51.0), each post in a box with its replies under it — every line
	 * carrying "↩ [[…#^id]]" back to the post, tagged or not. Tap a box to open
	 * its note at the line; long-press it to tag; long-press the header to send
	 * the thread to Eco.
	 */
	private renderThread(thread: string): void {
		const head = this.contentEl.createDiv({ cls: "stx-threads-head" });
		this.iconButton(head, "arrow-left", "Back", () => {
			this.activeThread = null;
			this.replyOpenFor = null;
			this.render();
		});
		const title = head.createSpan({
			cls: "stx-threads-title",
			text: `#thread/${thread}`,
		});
		title.setAttr("aria-label", "Long-press for thread actions");
		wireLongPressMenu(title, (x, y, onHide) =>
			this.showThreadMenu(thread, x, y, onHide)
		);
		// Desktop / discoverability: the same menu from a button.
		this.iconButton(head, "more-horizontal", "Thread actions", () => {
			const r = title.getBoundingClientRect();
			this.showThreadMenu(thread, r.left, r.bottom);
		});

		// Sub-threads: one chip per child node, to drill down the tree.
		const node = findNode(
			buildThreadTree(summarizeThreads(this.posts), this.pinnedThreads()),
			thread
		);
		if (node && node.children.length > 0) {
			const bar = this.contentEl.createDiv({ cls: "stx-subthreads" });
			for (const c of node.children) {
				const chip = bar.createEl("button", {
					cls: "stx-period-chip",
					text: `${c.label} · ${c.totalCount}`,
				});
				chip.setAttr("aria-label", `#thread/${c.name}`);
				chip.addEventListener("click", () => this.openThread(c.name));
			}
		}

		const posts = subtreeFilter(this.posts, thread).sort(postOrder);

		// Cadence filter: chips for the periods any post in this thread carries.
		// Multi-select is a union (a post matches if it carries any selected
		// period); default off (empty set) shows all posts.
		const present = THOUGHT_PERIODS.filter((pr) =>
			posts.some((p) => p.periods.includes(pr))
		);
		if (present.length > 0) {
			const bar = this.contentEl.createDiv({ cls: "stx-period-filter" });
			for (const pr of present) {
				const chip = bar.createEl("button", {
					cls: "stx-period-chip",
					text: cap(pr),
				});
				if (this.threadPeriodFilter.has(pr)) chip.addClass("is-active");
				chip.addEventListener("click", () => {
					if (this.threadPeriodFilter.has(pr))
						this.threadPeriodFilter.delete(pr);
					else this.threadPeriodFilter.add(pr);
					this.render();
				});
			}
		}
		const visible =
			this.threadPeriodFilter.size === 0
				? posts
				: posts.filter((p) =>
						p.periods.some((pr) => this.threadPeriodFilter.has(pr))
				  );

		const groups = groupPostsWithReplies(visible, this.replies);
		// "↩ parent" previews resolve against every post AND reply line.
		const textByBlock = new Map<string, string>();
		for (const l of [...this.posts, ...this.replies])
			if (l.blockId) textByBlock.set(targetKey(l.note, l.blockId), l.text);

		const cardByKey = new Map<string, HTMLElement>();
		const listEl = this.contentEl.createDiv({ cls: "stx-thread-posts" });
		for (const g of groups) this.renderThreadCard(listEl, g, thread, textByBlock, cardByKey);
	}

	private renderThreadCard(
		listEl: HTMLElement,
		group: PostGroup<ThreadPost>,
		thread: string,
		textByBlock: Map<string, string>,
		cardByKey: Map<string, HTMLElement>
	): void {
		const post = group.post;
		const card = listEl.createDiv({ cls: "stx-post" });
		const key = this.cardKey(post);
		card.dataset.key = key;
		cardByKey.set(key, card);
		this.wireOpenTap(card, post, this.wireTagMenu(card, post));

		// reply-to preview (the parent is not in this view)
		if (post.replyTo) {
			const pk = targetKey(post.replyTo.note, post.replyTo.blockId);
			const parentText = textByBlock.get(pk);
			const rt = card.createDiv({ cls: "stx-post-replyto" });
			rt.setText(`↩ ${parentText ? this.truncate(parentText) : post.replyTo.note}`);
			rt.addEventListener("click", (e) => {
				e.stopPropagation();
				if (cardByKey.has(pk)) this.jumpTo(cardByKey, pk);
				else
					void this.openSafe({
						note: post.replyTo!.note,
						line: 0,
						blockId: post.replyTo!.blockId,
					});
			});
		}

		card.createDiv({ cls: "stx-post-date", text: this.sourceLabel(post) });
		card.createDiv({ cls: "stx-post-text", text: post.text });

		// A post from a sub-thread names it (tap = open that sub-thread).
		if (post.thread !== thread) {
			const sub = post.thread;
			const chip = card.createDiv({ cls: "stx-post-thread" });
			chip.setText(`#thread/${sub}`);
			this.wireThreadChip(chip, post, sub, () => this.openThread(sub));
		}

		// footer: reply button + reply count
		const footer = card.createDiv({ cls: "stx-post-footer" });
		const replyBtn = footer.createEl("button", {
			cls: "stx-post-reply-btn",
			text: "Reply",
		});
		replyBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.replyOpenFor = this.replyOpenFor === key ? null : key;
			this.render();
		});
		if (group.replyCount > 0) {
			footer.createSpan({
				cls: "stx-post-replycount",
				text: `${group.replyCount} ${group.replyCount === 1 ? "reply" : "replies"}`,
			});
		}

		if (this.replyOpenFor === key) this.renderReplyBox(card, post);

		if (group.replies.length > 0) {
			const box = card.createDiv({ cls: "stx-post-replies" });
			this.renderReplyNodes(box, group.replies, thread);
		}
	}

	/** Replies inside their post's box, nested by depth. Each is its own tap
	 *  (open at its line) and long-press (tag) target. */
	private renderReplyNodes(box: HTMLElement, nodes: ReplyNode[], thread: string): void {
		for (const n of nodes) {
			const r = n.reply;
			const el = box.createDiv({ cls: "stx-reply" });
			this.wireOpenTap(el, r, this.wireTagMenu(el, r));
			el.createDiv({ cls: "stx-post-date", text: `↩ ${this.sourceLabel(r)}` });
			el.createDiv({ cls: "stx-post-text", text: r.text });
			if (r.thread && r.thread !== thread) {
				const other = r.thread;
				const chip = el.createDiv({ cls: "stx-post-thread" });
				chip.setText(`#thread/${other}`);
				this.wireThreadChip(chip, r, other, () => this.openThread(other));
			}
			if (n.children.length > 0) {
				const sub = el.createDiv({ cls: "stx-post-replies" });
				this.renderReplyNodes(sub, n.children, thread);
			}
		}
	}

	private renderReplyBox(card: HTMLElement, post: ThreadPost): void {
		const box = card.createDiv({ cls: "stx-thread-reply" });
		const input = box.createEl("textarea", {
			cls: "stx-thread-reply-input",
		});
		input.rows = 2;
		input.placeholder = "Reply…";
		const row = box.createDiv({ cls: "stx-thread-reply-row" });
		const send = row.createEl("button", {
			cls: "mod-cta",
			text: "Send",
		});
		const cancel = row.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => {
			this.replyOpenFor = null;
			this.render();
		});
		const submit = async () => {
			const text = input.value.trim();
			if (!text) return;
			send.disabled = true;
			try {
				await this.service.appendReply(post, text);
				this.replyOpenFor = null;
				new Notice("Reply added to today's note");
				await this.refresh();
			} catch (err) {
				send.disabled = false;
				new Notice(err instanceof Error ? err.message : String(err));
			}
		};
		send.addEventListener("click", () => void submit());
		input.addEventListener("keydown", (e) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
				e.preventDefault();
				void submit();
			}
		});
		window.setTimeout(() => input.focus(), 0);
	}

	// ---- add-a-tag menu (long-press on touch, right-click on desktop) ----

	/** Long-press / right-click → the shared tag menu. Returns the "was that
	 *  click the tail of a long-press" check for the card's tap handler. */
	private wireTagMenu(card: HTMLElement, post: TaggablePost): () => boolean {
		return wireLongPressMenu(card, (x, y, onHide) =>
			this.showTagMenu(post, x, y, onHide)
		);
	}

	/**
	 * Tap anywhere on a thought card → open its source note at that line
	 * (v1.51.0; Shawn 2026-09-25 "maybe if you click on the whole thought it
	 * will take you to the note"). This replaces v1.22.0's tap-to-tag in the
	 * thoughts / periodic views — tagging is the long-press everywhere now.
	 * Controls inside the card keep their own action: buttons, the reply box,
	 * a #thread chip (tap = jump to the thread), the ↩ preview, and a nested
	 * reply (which opens ITS line).
	 */
	private wireOpenTap(
		el: HTMLElement,
		post: { path?: string; note: string; line: number },
		wasLongPress: () => boolean
	): void {
		el.dataset.stxOpen = "1";
		el.addClass("stx-post-tappable");
		el.addEventListener("click", (e) => {
			const t = e.target;
			if (!(t instanceof Element)) return;
			if (
				t.closest(
					"button, a, textarea, input, .stx-post-thread, .stx-post-replyto, .stx-thread-reply"
				)
			)
				return;
			if (t.closest("[data-stx-open]") !== el) return;
			if (wasLongPress()) return;
			void this.openSafe(post);
		});
	}

	/** Open a post's note at its line (or a block by link), reporting failures. */
	private async openSafe(post: {
		path?: string;
		note: string;
		line: number;
		blockId?: string | null;
	}): Promise<void> {
		try {
			if (!post.path && post.blockId) {
				await this.app.workspace.openLinkText(`${post.note}#^${post.blockId}`, "", false);
				return;
			}
			await this.service.openPost(post);
		} catch (err) {
			new Notice(err instanceof Error ? err.message : String(err));
		}
	}

	private showTagMenu(
		post: TaggablePost,
		x: number,
		y: number,
		onHide?: () => void
	): void {
		// Existing threads grouped by area, every nested path listed under its
		// parent (v1.51.0). Until areas are organised the grouping is flat.
		const groups = menuAreaGroups(
			summarizeThreads(this.posts),
			this.areas,
			this.pinnedThreads()
		);
		showTagMenuAt({
			app: this.app,
			groups,
			x,
			y,
			onApplyTag: (tag) => void this.editTag(post, tag, "add"),
			existingTags: listRemovableTags(post.raw),
			onRemoveTag: (tag) => void this.editTag(post, tag, "remove"),
			onHide,
		});
	}

	/**
	 * Add or remove one tag on a post (a removal is already confirmed). When
	 * the post has replies, ask "Also apply this to its N replies?" first —
	 * No is the default; Yes applies the same edit to each reply's own line
	 * (v1.51.0; v1.50.0 always left replies alone). Then refresh.
	 */
	private async editTag(post: TaggablePost, tag: string, op: TagOp): Promise<void> {
		try {
			const replies = descendantReplies(post, this.replies);
			const targets: TaggablePost[] = [post];
			if (replies.length > 0 && (await askApplyToReplies(this.app, replies.length, tag, op)))
				targets.push(...replies);
			const { changed, missing } = await this.service.editTagOnPosts(
				targets.map((t) => ({ path: t.path, note: t.note, line: t.line, raw: t.raw })),
				tag,
				op
			);
			const verb = op === "add" ? "Added" : "Removed";
			let msg: string;
			if (targets.length === 1)
				msg =
					changed > 0
						? `${verb} ${tag}`
						: op === "add"
						  ? `${tag} already on that post`
						  : `${tag} was no longer on that post`;
			else
				msg = `${verb} ${tag} ${op === "add" ? "on" : "from"} ${changed} of ${targets.length} lines (the post and its replies)`;
			if (missing > 0) msg += ` — ${missing} line${missing === 1 ? "" : "s"} not found`;
			new Notice(msg);
			await this.refresh();
		} catch (err) {
			new Notice(err instanceof Error ? err.message : String(err));
		}
	}

	/**
	 * A post's #thread chip: tap jumps to the thread (unchanged); long-press /
	 * right-click asks to remove that tag from the post (v1.50.0), then — if it
	 * has replies — whether to remove it from them too (v1.51.0).
	 */
	private wireThreadChip(
		chip: HTMLElement,
		post: TaggablePost,
		thread: string,
		jump: () => void
	): void {
		const tag = `#thread/${thread}`;
		const wasLongPress = wireChipLongPress(chip, () =>
			confirmRemoveTag(this.app, tag, () => void this.editTag(post, tag, "remove"))
		);
		chip.addEventListener("click", (e) => {
			e.stopPropagation();
			if (wasLongPress()) return;
			jump();
		});
	}

	// ---- thread actions (long-press / right-click a thread row or header) ----

	private pinnedThreads(): string[] {
		return this.host.getSettings().pinnedThreads ?? [];
	}

	private showThreadMenu(
		name: string,
		x: number,
		y: number,
		onHide?: () => void
	): void {
		const menu = new Menu();
		// Send to Eco (v1.51.0; Shawn 2026-09-25 "long press on a thread and
		// then I can load all into eco and chat").
		menu.addItem((i) =>
			i
				.setTitle("Chat about this thread in a new Eco chat")
				.setIcon("message-circle")
				.onClick(() => void this.sendToEco(name, "new"))
		);
		menu.addItem((i) =>
			i
				.setTitle("Add this thread to the current Eco chat")
				.setIcon("messages-square")
				.onClick(() => void this.sendToEco(name, "current"))
		);
		menu.addSeparator();
		const pinned = this.pinnedThreads().includes(name);
		menu.addItem((i) =>
			i
				.setTitle(pinned ? "Unpin" : "Pin")
				.setIcon(pinned ? "pin-off" : "pin")
				.onClick(() => void this.togglePin(name))
		);
		if (onHide) menu.onHide(onHide);
		menu.showAtPosition({ x, y });
	}

	/** Send a thread (own + sub-thread posts, each with its replies) to Eco. */
	private async sendToEco(thread: string, mode: EcoSendMode): Promise<void> {
		const posts = subtreeFilter(this.posts, thread).sort(postOrder);
		const groups = ecoGroupsFromPostGroups(
			thread,
			groupPostsWithReplies(posts, this.replies)
		);
		await sendThreadToEco({
			app: this.app,
			bridgeUrl: this.host.getSettings().vaultSearchUrl,
			thread,
			groups,
			mode,
		});
	}

	private async togglePin(name: string): Promise<void> {
		const settings = this.host.getSettings();
		const current = settings.pinnedThreads ?? [];
		settings.pinnedThreads = current.includes(name)
			? current.filter((n) => n !== name)
			: [...current, name];
		await this.host.saveSettings();
		this.render();
	}

	// ---- helpers ----

	/**
	 * The label shown where a post's date sits. Timeline daily notes (basename is
	 * a YYYY-MM-DD date) show the date; posts from any other note show the note
	 * name instead, so a #thread line in "01. Default/walk dancing.md" reads
	 * "walk dancing" rather than a meaningless file-mtime date. A time suffix is
	 * appended when the line carries one either way.
	 */
	private sourceLabel(post: { note: string; dateIso: string; time: string | null }): string {
		const base = /^\d{4}-\d{2}-\d{2}$/.test(post.note) ? post.dateIso : post.note;
		return post.time ? `${base} · ${post.time}` : base;
	}

	private cardKey(post: ThreadPost): string {
		return post.blockId
			? targetKey(post.note, post.blockId)
			: `${post.note}#${post.line}`;
	}

	private jumpTo(cardByKey: Map<string, HTMLElement>, key: string): void {
		const el = cardByKey.get(key);
		if (!el) return;
		el.scrollIntoView({ behavior: "smooth", block: "center" });
		el.addClass("stx-post-hl");
		window.setTimeout(() => el.removeClass("stx-post-hl"), 1400);
	}

	private truncate(text: string): string {
		return text.length > PREVIEW_LEN
			? text.slice(0, PREVIEW_LEN).trimEnd() + "…"
			: text;
	}

	private iconButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void
	): void {
		const btn = parent.createEl("button", {
			cls: "stx-threads-iconbtn",
			attr: { "aria-label": label },
		});
		setIcon(btn, icon);
		btn.addEventListener("click", onClick);
	}
}

function cap(s: string): string {
	return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

export class ThreadsView extends ToolboxPanelView {
	getViewType(): string {
		return THREADS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Threads";
	}

	getIcon(): string {
		return "messages-square";
	}

	protected createPanel(container: HTMLElement): ToolboxPanel {
		return new ThreadsPanel(this.host, container);
	}
}
