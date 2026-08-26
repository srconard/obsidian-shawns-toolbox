// tag-menu.ts — the shared "add a tag to this thought" component. Extracted
// from the Threads panel so the Capture panel can reuse the exact same gesture
// and menu (long-press on touch / right-click on desktop → cadence tags on top,
// then the existing threads grouped by area, then "New thread…").
import { App, Menu, Modal, Notice } from "obsidian";
import { normalizeThreadName, THOUGHT_PERIODS } from "./thread-core";
import { isFlatGrouping, type AreaGroup } from "./thread-areas";

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
 */
export function wireLongPressMenu(
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

export interface TagMenuOptions {
	app: App;
	/** Existing threads grouped by area (from groupThreadsByArea), for the picker. */
	groups: AreaGroup[];
	x: number;
	y: number;
	/** Apply the chosen tag to the target (caller writes + refreshes). */
	onApplyTag: (tag: string) => void;
	onHide?: () => void;
}

/**
 * Build and show the add-a-tag menu at (x, y): the #thought/<period> cadence
 * tags first (Shawn's ordering), then a "New thread…" creator, then the existing
 * threads grouped by area (matching the list). Until areas are organised the
 * grouping is flat (one Unsorted group) and the area headers are suppressed.
 */
export function showTagMenu(opts: TagMenuOptions): void {
	const { app, groups, x, y, onApplyTag, onHide } = opts;
	const menu = new Menu();
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
			menu.addItem((i) =>
				i
					.setTitle(tag)
					.setIcon("messages-square")
					.onClick(() => onApplyTag(tag))
			);
		}
	}
	if (onHide) menu.onHide(onHide);
	menu.showAtPosition({ x, y });
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
