// threads-view.ts — the Threads side panel. Reads #thread posts from every
// note outside the excluded folders (via ThreadService) and renders a list → flat
// chronological thread view (4chan-style) with reply indicators and a reply
// action. Primary reading surface is the phone.
import { App, ItemView, Menu, Modal, Notice, WorkspaceLeaf, TAbstractFile, setIcon } from "obsidian";
import type { CardsHost } from "./section-cards";
import { ThreadService } from "./thread-service";
import {
	summarizeThreads,
	orderThreadsByPin,
	threadPosts,
	replyCounts,
	indexByBlock,
	targetKey,
	periodicPosts,
	summarizePeriods,
	normalizeThreadName,
	THOUGHT_PERIODS,
	type ThreadPost,
	type PeriodicPost,
	type ThoughtPost,
	type ThreadSummary,
} from "./thread-core";
import {
	groupThreadsByArea,
	isFlatGrouping,
	type AreaGroup,
	type ThreadArea,
} from "./thread-areas";

/** A post the add-tag menu can act on — a thread post, a periodic-thought post,
 *  or a today's-thought post; all carry the fields the service needs to locate
 *  and edit the source line. */
type TaggablePost = ThreadPost | PeriodicPost | ThoughtPost;
type PeriodTagFilter = "all" | "tagged" | "untagged";

export const THREADS_VIEW_TYPE = "shawns-toolbox-threads";

const PREVIEW_LEN = 60;
const REFRESH_DEBOUNCE_MS = 400;

export class ThreadsView extends ItemView {
	private service: ThreadService;
	private posts: ThreadPost[] = [];
	private periodic: PeriodicPost[] = [];
	private today: ThoughtPost[] = [];
	// Thread → area mapping, parsed from the Shawn-editable areas note.
	private areas: ThreadArea[] = [];
	private activeThread: string | null = null;
	private activePeriod: string | null = null;
	// "Today's thoughts" view (every top-level thought in today's note).
	private activeToday = false;
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

	constructor(leaf: WorkspaceLeaf, private host: CardsHost) {
		super(leaf);
		this.service = new ThreadService(host.app, host.getSettings);
	}

	getViewType(): string {
		return THREADS_VIEW_TYPE;
	}
	getDisplayText(): string {
		return "Threads";
	}
	getIcon(): string {
		return "messages-square";
	}

	async onOpen(): Promise<void> {
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

	async onClose(): Promise<void> {
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
		const { posts, periodic } = await this.service.scanAll();
		this.posts = posts;
		this.periodic = periodic;
		this.today = await this.service.todayThoughtPosts();
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
			this.render();
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
			const pinned = this.pinnedThreads();
			const pinnedSet = new Set(pinned);
			const groups = groupThreadsByArea(summaries, this.areas, pinned);
			if (isFlatGrouping(groups)) {
				// No areas organised yet — render one flat list (unchanged UX).
				const flat = groups.length
					? groups[0].threads
					: orderThreadsByPin(summaries, pinned);
				const list = this.contentEl.createDiv({ cls: "stx-thread-list" });
				this.renderThreadRows(list, flat, pinnedSet);
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
	private renderAreaGroup(group: AreaGroup, pinnedSet: Set<string>): void {
		const collapsed = this.collapsedAreas().includes(group.area);
		const sec = this.contentEl.createDiv({ cls: "stx-area-section" });
		const header = sec.createDiv({ cls: "stx-area-head" });
		if (collapsed) header.addClass("is-collapsed");
		const chevron = header.createSpan({ cls: "stx-area-chevron" });
		setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
		header.createSpan({ cls: "stx-area-name", text: group.area });
		header.createSpan({
			cls: "stx-area-count",
			text: String(group.threads.length),
		});
		header.addEventListener("click", () => void this.toggleArea(group.area));
		if (!collapsed) {
			const list = sec.createDiv({ cls: "stx-thread-list" });
			this.renderThreadRows(list, group.threads, pinnedSet);
		}
	}

	/** Render a run of thread rows into a list container (shared by the flat and
	 *  grouped views). */
	private renderThreadRows(
		list: HTMLElement,
		threads: ThreadSummary[],
		pinnedSet: Set<string>
	): void {
		for (const s of threads) {
			const when = s.lastActiveTime
				? `${s.lastActiveDate} ${s.lastActiveTime}`
				: s.lastActiveDate;
			const row = this.listRow(
				list,
				s.name,
				when,
				s.postCount,
				() => {
					this.activeThread = s.name;
					this.threadPeriodFilter.clear();
					this.replyOpenFor = null;
					this.render();
				},
				pinnedSet.has(s.name)
			);
			this.wireLongPressMenu(row, (x, y, onHide) =>
				this.showThreadMenu(s.name, x, y, onHide)
			);
		}
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

	// ---- today's thoughts ----

	private renderToday(): void {
		const head = this.contentEl.createDiv({ cls: "stx-threads-head" });
		this.iconButton(head, "arrow-left", "Back", () => {
			this.activeToday = false;
			this.render();
		});
		head.createSpan({ cls: "stx-threads-title", text: "Today's thoughts" });

		// Same All / Tagged / Untagged filter as the periodic views, so this view
		// doubles as a processing pass (Untagged = no #thread/ tag yet).
		const all = this.today;
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
				text:
					all.length === 0
						? "No thoughts in today's note yet."
						: "No thoughts match this filter.",
			});
			return;
		}

		const listEl = this.contentEl.createDiv({ cls: "stx-thread-posts" });
		for (const post of posts) {
			const card = listEl.createDiv({ cls: "stx-post" });
			this.wireTagMenu(card, post);
			const dateLine = card.createDiv({ cls: "stx-post-date" });
			dateLine.setText(this.sourceLabel(post));
			dateLine.addEventListener("click", async () => {
				try {
					await this.service.openPost(post);
				} catch (err) {
					new Notice(err instanceof Error ? err.message : String(err));
				}
			});
			card.createDiv({ cls: "stx-post-text", text: post.text });
			if (post.thread) {
				const threadName = post.thread;
				const t = card.createDiv({ cls: "stx-post-thread" });
				t.setText(`#thread/${threadName}`);
				t.addEventListener("click", () => {
					this.activeToday = false;
					this.activeThread = threadName;
					this.threadPeriodFilter.clear();
					this.render();
				});
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
			this.wireTagMenu(card, post);
			const dateLine = card.createDiv({ cls: "stx-post-date" });
			dateLine.setText(this.sourceLabel(post));
			dateLine.addEventListener("click", async () => {
				try {
					await this.service.openPost(post);
				} catch (err) {
					new Notice(err instanceof Error ? err.message : String(err));
				}
			});
			card.createDiv({ cls: "stx-post-text", text: post.text });
			if (post.thread) {
				const t = card.createDiv({ cls: "stx-post-thread" });
				t.setText(`#thread/${post.thread}`);
				t.addEventListener("click", () => {
					this.activePeriod = null;
					this.activeThread = post.thread;
					this.threadPeriodFilter.clear();
					this.render();
				});
			}
		}
	}

	// ---- thread detail ----

	private renderThread(thread: string): void {
		const head = this.contentEl.createDiv({ cls: "stx-threads-head" });
		this.iconButton(head, "arrow-left", "Back", () => {
			this.activeThread = null;
			this.replyOpenFor = null;
			this.render();
		});
		head.createSpan({
			cls: "stx-threads-title",
			text: `#thread/${thread}`,
		});

		const posts = threadPosts(this.posts, thread);
		const counts = replyCounts(this.posts);
		const parents = indexByBlock(this.posts);

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

		const cardByKey = new Map<string, HTMLElement>();
		const listEl = this.contentEl.createDiv({ cls: "stx-thread-posts" });

		for (const post of visible) {
			const card = listEl.createDiv({ cls: "stx-post" });
			const key = this.cardKey(post);
			card.dataset.key = key;
			cardByKey.set(key, card);
			this.wireTagMenu(card, post);

			// reply-to preview
			if (post.replyTo) {
				const pk = targetKey(post.replyTo.note, post.replyTo.blockId);
				const parent = parents.get(pk);
				const preview = parent
					? this.truncate(parent.text)
					: `${post.replyTo.note}`;
				const rt = card.createDiv({ cls: "stx-post-replyto" });
				rt.setText(`↩ ${preview}`);
				rt.addEventListener("click", (e) => {
					e.stopPropagation();
					this.jumpTo(cardByKey, pk);
				});
			}

			// date/time (or note name for non-timeline sources) — tapping opens
			// the source note at the line
			const dateLine = card.createDiv({ cls: "stx-post-date" });
			dateLine.setText(this.sourceLabel(post));
			dateLine.addEventListener("click", async (e) => {
				e.stopPropagation();
				try {
					await this.service.openPost(post);
				} catch (err) {
					new Notice(err instanceof Error ? err.message : String(err));
				}
			});

			card.createDiv({ cls: "stx-post-text", text: post.text });

			// footer: reply button + reply-count badge
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

			if (post.blockId) {
				const n = counts.get(targetKey(post.note, post.blockId));
				if (n && n > 0) {
					const badge = footer.createSpan({
						cls: "stx-post-replycount",
						text: `${n} ↩`,
					});
					badge.addEventListener("click", (e) => {
						e.stopPropagation();
						this.jumpToFirstReply(cardByKey, posts, post);
					});
				}
			}

			if (this.replyOpenFor === key) {
				this.renderReplyBox(card, post);
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

	private wireTagMenu(card: HTMLElement, post: TaggablePost): void {
		this.wireLongPressMenu(card, (x, y, onHide) =>
			this.showTagMenu(post, x, y, onHide)
		);
	}

	/**
	 * Attach a long-press (touch) / right-click (desktop) context menu to an
	 * element. While the press is registered or the menu is open the element is
	 * tinted (stx-post-pressed) as feedback; menuOpen keeps the tint through the
	 * pointerup that follows a successful long-press, and the menu's onHide (via
	 * the callback passed to buildMenu) clears it. buildMenu builds and shows the
	 * menu at (x, y), calling onHide when it closes.
	 */
	private wireLongPressMenu(
		el: HTMLElement,
		buildMenu: (x: number, y: number, onHide: () => void) => void
	): void {
		let timer: number | null = null;
		let menuOpen = false;
		let sx = 0;
		let sy = 0;
		const clearTint = () => {
			if (!menuOpen) el.removeClass("stx-post-pressed");
		};
		const cancel = () => {
			if (timer !== null) {
				window.clearTimeout(timer);
				timer = null;
			}
			clearTint();
		};
		const open = (x: number, y: number) => {
			menuOpen = true;
			el.addClass("stx-post-pressed");
			buildMenu(x, y, () => {
				menuOpen = false;
				el.removeClass("stx-post-pressed");
			});
		};
		el.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			cancel();
			open(e.clientX, e.clientY);
		});
		// Touch long-press — desktop right-click is handled above, so a mouse
		// press is ignored here to avoid a double affordance.
		el.addEventListener("pointerdown", (e) => {
			if (e.pointerType === "mouse") return;
			sx = e.clientX;
			sy = e.clientY;
			if (timer !== null) window.clearTimeout(timer);
			el.addClass("stx-post-pressed");
			timer = window.setTimeout(() => {
				timer = null;
				open(sx, sy);
			}, 450);
		});
		el.addEventListener("pointermove", (e) => {
			if (
				timer !== null &&
				(Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)
			)
				cancel();
		});
		el.addEventListener("pointerup", cancel);
		el.addEventListener("pointerleave", cancel);
		el.addEventListener("pointercancel", cancel);
	}

	private showTagMenu(
		post: TaggablePost,
		x: number,
		y: number,
		onHide?: () => void
	): void {
		const menu = new Menu();
		// Periodic cadence tags first (Shawn's ordering), then the thread picker.
		for (const period of THOUGHT_PERIODS) {
			const tag = `#thought/${period}`;
			menu.addItem((i) =>
				i
					.setTitle(tag)
					.setIcon("hash")
					.onClick(() => void this.applyTag(post, tag))
			);
		}
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle("New thread…")
				.setIcon("plus")
				.onClick(() => this.promptNewThread(post))
		);
		// Show the existing threads grouped by area (matching the list), with a
		// disabled label per area as a header. Until areas are organised the
		// grouping is flat (one Unsorted group) and the headers are suppressed.
		const groups = groupThreadsByArea(
			summarizeThreads(this.posts),
			this.areas,
			this.pinnedThreads()
		);
		const flat = isFlatGrouping(groups);
		for (const g of groups) {
			if (!flat) {
				menu.addSeparator();
				menu.addItem((i) => i.setTitle(g.area).setIsLabel(true));
			}
			for (const t of g.threads) {
				const tag = `#thread/${t.name}`;
				menu.addItem((i) =>
					i
						.setTitle(tag)
						.setIcon("messages-square")
						.onClick(() => void this.applyTag(post, tag))
				);
			}
		}
		if (onHide) menu.onHide(onHide);
		menu.showAtPosition({ x, y });
	}

	/**
	 * Prompt for a new thread name, normalize it to the tag convention, and
	 * append #thread/<name> to the post's source line. Empty input is a no-op;
	 * a name that matches an existing thread just reuses it (applyTag no-ops if
	 * the exact tag is already present).
	 */
	private promptNewThread(post: TaggablePost): void {
		new NewThreadModal(this.app, (raw) => {
			const name = normalizeThreadName(raw);
			if (!name) {
				new Notice("Enter a thread name");
				return;
			}
			void this.applyTag(post, `#thread/${name}`);
		}).open();
	}

	private async applyTag(post: TaggablePost, tag: string): Promise<void> {
		try {
			const changed = await this.service.appendTagToPost(post, tag);
			new Notice(changed ? `Added ${tag}` : `${tag} already on that post`);
			await this.refresh();
		} catch (err) {
			new Notice(err instanceof Error ? err.message : String(err));
		}
	}

	// ---- pin / unpin a thread (long-press / right-click a thread row) ----

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

	private jumpToFirstReply(
		cardByKey: Map<string, HTMLElement>,
		posts: ThreadPost[],
		parent: ThreadPost
	): void {
		if (!parent.blockId) return;
		const pk = targetKey(parent.note, parent.blockId);
		const reply = posts.find(
			(p) =>
				p.replyTo &&
				targetKey(p.replyTo.note, p.replyTo.blockId) === pk
		);
		if (reply) this.jumpTo(cardByKey, this.cardKey(reply));
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

/** A minimal single-field prompt for naming a new thread. Enter or Create
 *  submits the raw text (the caller normalizes it); Escape/Cancel closes. */
class NewThreadModal extends Modal {
	constructor(app: App, private onSubmit: (raw: string) => void) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("stx-new-thread");
		contentEl.createEl("h3", { text: "New thread" });
		const input = contentEl.createEl("input", {
			cls: "stx-new-thread-input",
			attr: { type: "text", placeholder: "thread name" },
		});
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit(input.value);
			}
		});
		const row = contentEl.createDiv({ cls: "stx-thread-reply-row" });
		const create = row.createEl("button", { cls: "mod-cta", text: "Create" });
		create.addEventListener("click", () => this.submit(input.value));
		const cancel = row.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
		window.setTimeout(() => input.focus(), 0);
	}

	private submit(raw: string): void {
		this.close();
		this.onSubmit(raw);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
