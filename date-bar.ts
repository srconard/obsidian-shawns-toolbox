// date-bar.ts — the shared "pick a day" strip used by the capture view and
// the voice panel: ◀ steps a day back, ▶ forward, tapping the date opens the
// platform calendar, a confirm button fires the caller's action. Long-press
// wiring lives here too so both surfaces behave identically.
import { setIcon } from "obsidian";
import { shiftDateIso } from "./template-renderer";
import { todayIsoLocal } from "./capture-service";

export interface DateBar {
	el: HTMLElement;
	/** Reveal the bar with a context label; date resets to tomorrow. */
	show(label: string): void;
	hide(): void;
	/** Currently picked date (YYYY-MM-DD). */
	value(): string;
}

export function createDateBar(
	parent: HTMLElement,
	opts: {
		confirmLabel: string;
		confirmIcon?: string;
		onConfirm: () => void;
	}
): DateBar {
	const bar = parent.createDiv("stx-datebar");
	bar.hide();

	const labelEl = bar.createSpan({ cls: "stx-datebar-label" });

	const prev = bar.createEl("button", {
		cls: "stx-datebar-btn",
		attr: { "aria-label": "Previous day" },
	});
	setIcon(prev, "chevron-left");

	const input = bar.createEl("input", {
		cls: "stx-datebar-input",
		attr: { type: "date" },
	});
	// Tap the date itself → platform calendar (Android native picker,
	// Chromium dropdown on desktop).
	input.addEventListener("click", () => {
		try {
			input.showPicker?.();
		} catch {
			// picker already open, or not allowed — the input still works
		}
	});

	const next = bar.createEl("button", {
		cls: "stx-datebar-btn",
		attr: { "aria-label": "Next day" },
	});
	setIcon(next, "chevron-right");

	prev.addEventListener("click", () => {
		if (input.value) input.value = shiftDateIso(input.value, -1);
	});
	next.addEventListener("click", () => {
		if (input.value) input.value = shiftDateIso(input.value, 1);
	});

	const confirm = bar.createEl("button", { cls: "stx-datebar-add" });
	if (opts.confirmIcon) {
		const icon = confirm.createSpan("stx-datebar-add-icon");
		setIcon(icon, opts.confirmIcon);
	}
	confirm.createSpan({ text: opts.confirmLabel });
	confirm.addEventListener("click", () => opts.onConfirm());

	const close = bar.createEl("button", {
		cls: "stx-datebar-btn",
		attr: { "aria-label": "Cancel" },
	});
	setIcon(close, "x");

	const api: DateBar = {
		el: bar,
		show(label: string) {
			labelEl.textContent = label;
			// Long-press means "not today" — default to tomorrow.
			input.value = shiftDateIso(todayIsoLocal(), 1);
			bar.show();
		},
		hide() {
			bar.hide();
		},
		value() {
			return input.value;
		},
	};
	close.addEventListener("click", () => api.hide());
	return api;
}

/**
 * Fire cb after a ~450ms hold (pointer events; context menu suppressed so
 * Android doesn't steal the gesture). The caller guards the click that
 * follows a long-press with its own timestamp check.
 */
export function wireLongPress(el: HTMLElement, cb: () => void): void {
	let timer: number | null = null;
	const cancel = () => {
		if (timer !== null) {
			window.clearTimeout(timer);
			timer = null;
		}
	};
	el.addEventListener("pointerdown", () => {
		cancel();
		timer = window.setTimeout(() => {
			timer = null;
			cb();
		}, 450);
	});
	el.addEventListener("pointerup", cancel);
	el.addEventListener("pointerleave", cancel);
	el.addEventListener("pointercancel", cancel);
	el.addEventListener("contextmenu", (e) => e.preventDefault());
}
