// capture-base-view.ts — the capture surface itself, shared by every place it
// is shown: the main-pane "blank screen" view (capture-view.ts), the
// right-sidebar panel (capture-side-view.ts) and either half of the dual panel
// (dual-view.ts). Nothing but an auto-focused input, the four routing buttons,
// and the just-captured thought strip; sections live in their own view
// (sections-view.ts).
//
// The surfaces differ ONLY in view type, tab title, icon and the extra root
// class that tunes the layout for a narrow panel — every behaviour (routing,
// long-press date bar, Mod+Enter, the recent strip's tag menu) is defined once,
// here. Since v1.39.0 this is a ToolboxPanel (a Component rendering into a
// container it is handed) rather than an ItemView, so a leaf can host two of it.
import { Notice, Scope, setIcon } from "obsidian";
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
import { findLastMatching, normSpace, thoughtHead } from "./capture-recent";
import { ToolboxPanel } from "./panel-base";

/** How many just-captured thoughts stay long-pressable in the recent strip. */
const RECENT_LIMIT = 8;

export abstract class BaseCapturePanel extends ToolboxPanel {
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

	constructor(host: CardsHost, contentEl: HTMLElement) {
		super(host, contentEl);
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

	/** Extra class on the view's `.view-content` root; "" for the main view. */
	protected variantClass(): string {
		return "";
	}

	/** Focus the input when the surface opens (main pane: yes; panel: no — a
	 *  sidebar panel that steals focus pops the phone keyboard unbidden). */
	protected autoFocus(): boolean {
		return true;
	}

	protected async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("stx-capture-root", "stx-capture-body");
		const variant = this.variantClass();
		if (variant) root.addClass(variant);

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
		if (this.autoFocus()) window.setTimeout(() => input.focus(), 0);
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
		const head = thoughtHead(text);
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
		const i = findLastMatching(
			posts.map((p) => normSpace(p.text)),
			head
		);
		if (i < 0) return null;
		const p = posts[i];
		return { path: p.path, note: p.note, line: p.line, raw: p.raw };
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
