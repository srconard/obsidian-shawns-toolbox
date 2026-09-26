// tag-menu.ts — the shared "add a tag to this thought" component. Extracted
// from the Threads panel so the Capture panel can reuse the exact same gesture
// and menu (long-press on touch / right-click on desktop → cadence tags on top,
// then the existing threads grouped by area, then "New thread…"). Since
// v1.50.0 it also removes: a "Remove tag" section on top lists the tags the
// post's line already carries, each behind a short confirm.
import { App, Menu, Modal, Notice } from "obsidian";
import { normalizeThreadName, THOUGHT_PERIODS } from "./thread-core";
import { isFlatGrouping, type AreaGroup } from "./thread-areas";
import { threadDepth } from "./thread-tree-core";
import { repliesPrompt, repliesPromptDetail, type TagOp } from "./retag-core";

/** The fields a tag can be appended against (matches ThreadService.appendTagToPost). */
export interface TagTarget {
	path?: string;
	note: string;
	line: number;
	raw: string;
}

/**
 * Attach a long-press (touch) / right-click (desktop) context menu to an
 * element. While the press is registered or the menu is open the element is
 * tinted (stx-post-pressed) as feedback; menuOpen keeps the tint through the
 * pointerup that follows a successful long-press, and the menu's onHide (via
 * the callback passed to buildMenu) clears it. buildMenu builds and shows the
 * menu at (x, y), calling onHide when it closes.
 *
 * v1.51.0: elements can nest (a reply card inside its post's card). Each wired
 * element is marked, and a press that starts inside a NESTED wired element is
 * left to that element, so only the innermost card's menu opens. Presses in a
 * text field are ignored (the reply box keeps its native paste menu). Returns
 * a function the element's click handler calls to skip the click that ends a
 * long-press, so "tap opens the note" never fires on the tail of a menu press.
 */
export function wireLongPressMenu(
	el: HTMLElement,
	buildMenu: (x: number, y: number, onHide: () => void) => void
): () => boolean {
	let timer: number | null = null;
	let menuOpen = false;
	let sx = 0;
	let sy = 0;
	let openedAt = 0;
	el.dataset.stxLp = "1";
	const mine = (e: Event): boolean => {
		const t = e.target;
		if (!(t instanceof Element)) return true;
		if (t.closest("textarea, input, [contenteditable='true']")) return false;
		return t.closest("[data-stx-lp]") === el;
	};
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
		// Android can fire contextmenu right after our own long-press timer.
		if (Date.now() - openedAt < 800) return;
		openedAt = Date.now();
		menuOpen = true;
		el.addClass("stx-post-pressed");
		buildMenu(x, y, () => {
			menuOpen = false;
			el.removeClass("stx-post-pressed");
		});
	};
	el.addEventListener("contextmenu", (e) => {
		if (!mine(e)) return;
		e.preventDefault();
		cancel();
		open(e.clientX, e.clientY);
	});
	// Touch long-press — desktop right-click is handled above, so a mouse
	// press is ignored here to avoid a double affordance.
	el.addEventListener("pointerdown", (e) => {
		if (e.pointerType === "mouse") return;
		if (!mine(e)) return;
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
	return () => Date.now() - openedAt < 800;
}

export interface TagMenuOptions {
	app: App;
	/** Existing threads grouped by area (from groupThreadsByArea), for the picker. */
	groups: AreaGroup[];
	x: number;
	y: number;
	/** Apply the chosen tag to the target (caller writes + refreshes). */
	onApplyTag: (tag: string) => void;
	onHide?: () => void;
	/** Optional non-clickable heading shown above the cadence tags — the capture
	 *  buttons use it to say what a long-press is tagging ("Thought · tag as"). */
	title?: string;
	/** Tags the post's line already carries (listRemovableTags(raw)). With
	 *  onRemoveTag, they head the menu as "Remove #thread/x" items. */
	existingTags?: string[];
	/** Remove a confirmed tag from the target (caller writes + refreshes). */
	onRemoveTag?: (tag: string) => void;
}

/**
 * Build and show the add-a-tag menu at (x, y): the #thought/<period> cadence
 * tags first (Shawn's ordering), then a "New thread…" creator, then the existing
 * threads grouped by area (matching the list). Until areas are organised the
 * grouping is flat (one Unsorted group) and the area headers are suppressed.
 */
export function showTagMenu(opts: TagMenuOptions): void {
	const { app, groups, x, y, onApplyTag, onHide, title, existingTags, onRemoveTag } =
		opts;
	const menu = new Menu();
	if (title) menu.addItem((i) => i.setTitle(title).setIsLabel(true));
	if (onRemoveTag && existingTags && existingTags.length > 0) {
		menu.addItem((i) => i.setTitle("Remove tag").setIsLabel(true));
		for (const tag of existingTags) {
			menu.addItem((i) =>
				i
					.setTitle(`Remove ${tag}`)
					.setIcon("x")
					.onClick(() => confirmRemoveTag(app, tag, () => onRemoveTag(tag)))
			);
		}
		menu.addSeparator();
	}
	for (const period of THOUGHT_PERIODS) {
		const tag = `#thought/${period}`;
		menu.addItem((i) =>
			i.setTitle(tag).setIcon("hash").onClick(() => onApplyTag(tag))
		);
	}
	menu.addSeparator();
	menu.addItem((i) =>
		i
			.setTitle("New thread…")
			.setIcon("plus")
			.onClick(() =>
				promptNewThread(app, (name) => onApplyTag(`#thread/${name}`))
			)
	);
	const flat = isFlatGrouping(groups);
	for (const g of groups) {
		if (!flat) {
			menu.addSeparator();
			menu.addItem((i) => i.setTitle(g.area).setIsLabel(true));
		}
		for (const t of g.threads) {
			const tag = `#thread/${t.name}`;
			// Nested paths (v1.51.0) are listed under their parent, indented with
			// non-breaking spaces (plain spaces collapse in the menu).
			const depth = threadDepth(t.name);
			const indent = depth > 0 ? "\u00a0\u00a0".repeat(depth - 1) + "↳ " : "";
			menu.addItem((i) =>
				i
					.setTitle(indent + tag)
					.setIcon("messages-square")
					.onClick(() => onApplyTag(tag))
			);
		}
	}
	if (onHide) menu.onHide(onHide);
	menu.showAtPosition({ x, y });
}

/** Ask "Remove #thread/x from this thought?" and call onConfirm on Remove.
 *  `what` names the target ("this line" for the editor menu). */
export function confirmRemoveTag(
	app: App,
	tag: string,
	onConfirm: () => void,
	what = "this thought"
): void {
	new ConfirmRemoveModal(app, tag, onConfirm, what).open();
}

/**
 * Ask "Also apply this to its N replies?" (v1.51.0). Resolves true only on an
 * explicit Yes; No, Enter (No is the default), Escape and closing all resolve
 * false, so the edit then touches only the post itself.
 */
export function askApplyToReplies(
	app: App,
	count: number,
	tag: string,
	op: TagOp
): Promise<boolean> {
	return new Promise((resolve) => {
		new RepliesModal(app, count, tag, op, resolve).open();
	});
}

class RepliesModal extends Modal {
	private answered = false;
	constructor(
		app: App,
		private count: number,
		private tag: string,
		private op: TagOp,
		private done: (yes: boolean) => void
	) {
		super(app);
	}

	private answer(yes: boolean): void {
		if (this.answered) return;
		this.answered = true;
		this.close();
		this.done(yes);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("stx-new-thread");
		contentEl.createEl("p", { text: repliesPrompt(this.count) });
		contentEl.createEl("p", {
			cls: "stx-replies-detail",
			text: repliesPromptDetail(this.tag, this.op),
		});
		const row = contentEl.createDiv({ cls: "stx-thread-reply-row" });
		const yes = row.createEl("button", { text: "Yes" });
		yes.addEventListener("click", () => this.answer(true));
		const no = row.createEl("button", { cls: "mod-cta", text: "No" });
		no.addEventListener("click", () => this.answer(false));
		this.scope.register([], "Enter", (e) => {
			e.preventDefault();
			this.answer(false);
			return false;
		});
		window.setTimeout(() => no.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
		// Escape / tapping outside counts as No.
		if (!this.answered) {
			this.answered = true;
			this.done(false);
		}
	}
}

/** Two-button confirm for removing a tag. Enter confirms; Escape/Cancel closes. */
class ConfirmRemoveModal extends Modal {
	constructor(
		app: App,
		private tag: string,
		private onConfirm: () => void,
		private what: string
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("stx-new-thread");
		contentEl.createEl("p", { text: `Remove ${this.tag} from ${this.what}?` });
		const row = contentEl.createDiv({ cls: "stx-thread-reply-row" });
		const remove = row.createEl("button", { cls: "mod-warning", text: "Remove" });
		remove.addEventListener("click", () => {
			this.close();
			this.onConfirm();
		});
		const cancel = row.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
		this.scope.register([], "Enter", (e) => {
			e.preventDefault();
			remove.click();
			return false;
		});
		window.setTimeout(() => remove.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Wire long-press (touch) / right-click (desktop) on a tag chip that sits inside
 * a post card, WITHOUT breaking its tap-to-jump. The press is claimed for the
 * chip (stopPropagation, so the card's own menu does not also open), a guard
 * swallows the duplicate contextmenu Android fires after a long-press, and the
 * returned function tells the chip's click handler to skip the jump when the
 * click is the tail of a long-press (the flag clears on the next press, so a
 * later genuine tap always navigates).
 */
export function wireChipLongPress(el: HTMLElement, onLongPress: () => void): () => boolean {
	let timer: number | null = null;
	let firedAt = 0;
	let suppressClick = false;
	let sx = 0;
	let sy = 0;
	const fire = () => {
		if (Date.now() - firedAt < 800) return;
		firedAt = Date.now();
		suppressClick = true;
		el.removeClass("stx-post-pressed");
		onLongPress();
	};
	const cancel = () => {
		if (timer !== null) {
			window.clearTimeout(timer);
			timer = null;
		}
		el.removeClass("stx-post-pressed");
	};
	el.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		e.stopPropagation();
		cancel();
		fire();
	});
	el.addEventListener("pointerdown", (e) => {
		e.stopPropagation();
		suppressClick = false; // a fresh press: its own click is a real tap
		if (e.pointerType === "mouse") return;
		sx = e.clientX;
		sy = e.clientY;
		if (timer !== null) window.clearTimeout(timer);
		el.addClass("stx-post-pressed");
		timer = window.setTimeout(() => {
			timer = null;
			fire();
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
	return () => {
		const s = suppressClick;
		suppressClick = false;
		return s;
	};
}

/**
 * Prompt for a new thread name, normalize it to the tag convention, and hand the
 * normalized name back. Empty input is a no-op with a nudge.
 */
export function promptNewThread(app: App, onName: (name: string) => void): void {
	new NewThreadModal(app, (raw) => {
		const name = normalizeThreadName(raw);
		if (!name) {
			new Notice("Enter a thread name");
			return;
		}
		onName(name);
	}).open();
}

/** A minimal single-field prompt for naming a new thread. Enter or Create
 *  submits the raw text (the caller normalizes it); Escape/Cancel closes. */
export class NewThreadModal extends Modal {
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
