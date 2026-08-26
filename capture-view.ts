// capture-view.ts — the central "blank screen" view: nothing but an
// auto-focused input and the four routing buttons (type → route to a
// daily-note section → screen clears). Sections live in their own view
// (sections-view.ts) — deliberately no tabs or chrome here.
import { ItemView, Notice, Scope, WorkspaceLeaf, setIcon } from "obsidian";
import type { CaptureKind } from "./section-core";
import {
	CAPTURE_ICONS,
	CAPTURE_LABELS,
	logicalTodayIso,
	nowHm,
	routeCapture,
} from "./capture-service";
import { shiftDateIso } from "./template-renderer";
import { createDateBar, wireLongPress, type DateBar } from "./date-bar";
import type { CardsHost } from "./section-cards";
import { ThreadService } from "./thread-service";
import { summarizeThreads } from "./thread-core";
import { groupThreadsByArea } from "./thread-areas";
import { wireLongPressMenu, showTagMenu, type TagTarget } from "./tag-menu";

export const CAPTURE_VIEW_TYPE = "shawns-toolbox-capture";

/** How many just-captured thoughts stay long-pressable in the recent strip. */
const RECENT_LIMIT = 8;

const normSpace = (s: string): string => s.replace(/\s+/g, " ").trim();

export class CaptureView extends ItemView {
	private inputEl: HTMLTextAreaElement | null = null;
	private submitting = false;
	private dateBar: DateBar | null = null;
	private dateBarKind: CaptureKind | null = null;
	private lastLongPress = 0;
	/** Threads scan / tag-append plumbing, shared with the Threads panel so the
	 *  add-tag menu here is the very same component. */
	private service: ThreadService;
	/** The "just captured" thought strip below the buttons — long-press a card to
	 *  tag the thought (same menu as the Threads panel) without leaving capture. */
	private recentEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, private host: CardsHost) {
		super(leaf);
		// Mod+Enter = Thought. Registered on the view's keymap scope because
		// Obsidian's keymap claims the combo before a plain DOM listener on
		// the textarea ever sees it.
		this.scope = new Scope(this.app.scope);
		this.scope.register(["Mod"], "Enter", (evt) => {
			evt.preventDefault();
			void this.submit("thought");
			return false;
		});
		this.service = new ThreadService(host.app, host.getSettings);
	}

	getViewType(): string {
		return CAPTURE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Capture";
	}

	getIcon(): string {
		return "zap";
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("stx-capture-root", "stx-capture-body");

		const input = root.createEl("textarea", {
			cls: "stx-capture-input",
			attr: { placeholder: "…" },
		});
		this.inputEl = input;

		this.dateBar = createDateBar(root, {
			confirmLabel: "Add",
			// Long-press means "not today" — default to logical tomorrow.
			getDefaultDate: () =>
				shiftDateIso(logicalTodayIso(this.host.getSettings()), 1),
			onConfirm: () => {
				const date = this.dateBar?.value();
				if (this.dateBarKind && date) {
					void this.submit(this.dateBarKind, date);
				}
			},
		});

		const buttons = root.createDiv("stx-capture-buttons");
		const kinds: CaptureKind[] = [
			"thought",
			"doToday",
			"otherTask",
			"log",
		];
		for (const kind of kinds) {
			const btn = buttons.createEl("button", {
				cls: "stx-capture-btn stx-capture-" + kind,
			});
			const icon = btn.createSpan("stx-capture-btn-icon");
			setIcon(icon, CAPTURE_ICONS[kind]);
			btn.createSpan({
				cls: "stx-capture-btn-label",
				text: CAPTURE_LABELS[kind],
			});
			btn.addEventListener("click", () => {
				// a long-press already handled this gesture
				if (Date.now() - this.lastLongPress < 700) return;
				void this.submit(kind);
			});
			if (kind === "doToday" || kind === "otherTask") {
				wireLongPress(btn, () => {
					this.lastLongPress = Date.now();
					this.dateBarKind = kind;
					this.dateBar?.show(CAPTURE_LABELS[kind] + " on");
				});
			}
		}

		this.recentEl = root.createDiv("stx-capture-recent");

		// Backup DOM path for Mod+Enter (the scope handler above is primary;
		// defaultPrevented guards against double-submit when both fire).
		input.addEventListener("keydown", (e) => {
			if (e.defaultPrevented) return;
			if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
				e.preventDefault();
				void this.submit("thought");
			}
		});
		window.setTimeout(() => input.focus(), 0);
	}

	private hideDateBar(): void {
		this.dateBar?.hide();
		this.dateBarKind = null;
	}

	private async submit(kind: CaptureKind, dateIso?: string): Promise<void> {
		if (!this.inputEl || this.submitting) return;
		const text = this.inputEl.value;
		if (!text.trim()) return;
		this.submitting = true;
		try {
			const target = await routeCapture(
				this.app,
				this.host.getSettings(),
				kind,
				text,
				dateIso
			);
			// Only clear after the write succeeded — never lose input.
			this.inputEl.value = "";
			this.inputEl.focus();
			// A just-captured thought becomes a long-pressable card so it can be
			// tagged in the moment (same menu as the Threads panel). Tasks/logs
			// aren't thoughts, so they don't join the strip.
			if (kind === "thought") this.addRecentThought(text);
			const when =
				dateIso && dateIso !== logicalTodayIso(this.host.getSettings())
					? dateIso
					: nowHm();
			new Notice(`→ ${target} ${when}`);
			this.hideDateBar();
		} catch (e) {
			new Notice(
				`Capture failed: ${e instanceof Error ? e.message : String(e)}`
			);
		} finally {
			this.submitting = false;
		}
	}

	/**
	 * Add a just-captured thought to the recent strip as a long-pressable card
	 * (newest on top, capped at RECENT_LIMIT). The card holds only the thought's
	 * head line; the live post is re-resolved from today's note when the tag menu
	 * opens, so a shifted line number never leaves a stale target behind.
	 */
	private addRecentThought(text: string): void {
		if (!this.recentEl) return;
		const head = normSpace(text.split("\n")[0]);
		if (!head) return;
		const card = this.recentEl.createDiv("stx-capture-recent-card");
		card.setText(head);
		this.recentEl.prepend(card);
		while (this.recentEl.childElementCount > RECENT_LIMIT) {
			this.recentEl.lastElementChild?.remove();
		}
		wireLongPressMenu(card, (x, y, onHide) =>
			void this.openThoughtTagMenu(head, x, y, onHide)
		);
	}

	/** Resolve the card's thought to a live post, then show the shared tag menu. */
	private async openThoughtTagMenu(
		head: string,
		x: number,
		y: number,
		onHide: () => void
	): Promise<void> {
		const target = await this.resolveThoughtTarget(head);
		if (!target) {
			new Notice("Couldn't find that thought to tag");
			onHide();
			return;
		}
		const groups = await this.threadGroups();
		showTagMenu({
			app: this.app,
			groups,
			x,
			y,
			onApplyTag: (tag) => void this.applyTag(target, tag),
			onHide,
		});
	}

	/** Find today's thought whose display text matches the card's head (last wins). */
	private async resolveThoughtTarget(head: string): Promise<TagTarget | null> {
		const posts = await this.service.todayThoughtPosts();
		const want = normSpace(head);
		for (let i = posts.length - 1; i >= 0; i--) {
			if (normSpace(posts[i].text) === want) {
				const p = posts[i];
				return { path: p.path, note: p.note, line: p.line, raw: p.raw };
			}
		}
		return null;
	}

	/** The existing threads grouped by area — same grouping the Threads panel uses. */
	private async threadGroups() {
		const { posts } = await this.service.scanAll();
		const areas = await this.service.loadThreadAreas();
		const pinned = this.host.getSettings().pinnedThreads ?? [];
		return groupThreadsByArea(summarizeThreads(posts), areas, pinned);
	}

	private async applyTag(target: TagTarget, tag: string): Promise<void> {
		try {
			const changed = await this.service.appendTagToPost(target, tag);
			new Notice(changed ? `Added ${tag}` : `${tag} already on that post`);
		} catch (err) {
			new Notice(err instanceof Error ? err.message : String(err));
		}
	}
}
