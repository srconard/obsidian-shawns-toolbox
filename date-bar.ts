// date-bar.ts — the shared "pick a day" strip used by the capture view and
// the voice panel: ◀ steps a day back, ▶ forward, tapping the date opens the
// platform calendar, a confirm button fires the caller's action. Long-press
// wiring lives here too so both surfaces behave identically.
import { setIcon } from "obsidian";
import { shiftDateIso } from "./template-renderer";
import { formatDateLabel } from "./date-nav";

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
		/** Date preselected when the bar opens (views pass logical tomorrow). */
		getDefaultDate: () => string;
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

	// The native date input renders as an unreadable stub on Android in a
	// narrow panel, so the visible date is our own label with the real input
	// stretched invisibly over it — a tap still opens the platform picker.
	const dateWrap = bar.createDiv("stx-datebar-date");
	const dateLabel = dateWrap.createSpan({ cls: "stx-datebar-date-label" });
	const input = dateWrap.createEl("input", {
		cls: "stx-datebar-input",
		attr: { type: "date", "aria-label": "Target date" },
	});
	const syncLabel = () => {
		dateLabel.textContent = input.value
			? formatDateLabel(input.value)
			: "pick a date";
	};
	input.addEventListener("change", syncLabel);
	input.addEventListener("input", syncLabel);
	// Desktop: a click on the transparent input only focuses it — open the
	// calendar dropdown explicitly. Android opens its dialog natively.
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
		syncLabel();
	});
	next.addEventListener("click", () => {
		if (input.value) input.value = shiftDateIso(input.value, 1);
		syncLabel();
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
			input.value = opts.getDefaultDate();
			syncLabel();
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
