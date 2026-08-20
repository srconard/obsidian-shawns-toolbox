// capture-view.ts — the central "blank screen" view: nothing but an
// auto-focused input and the four routing buttons (type → route to a
// daily-note section → screen clears). Sections live in their own view
// (sections-view.ts) — deliberately no tabs or chrome here.
import { ItemView, Notice, Scope, WorkspaceLeaf, setIcon } from "obsidian";
import type { CaptureKind } from "./section-core";
import {
	CAPTURE_ICONS,
	CAPTURE_LABELS,
	nowHm,
	routeCapture,
	todayIsoLocal,
} from "./capture-service";
import { shiftDateIso } from "./template-renderer";
import type { CardsHost } from "./section-cards";

const LONG_PRESS_MS = 450;

export const CAPTURE_VIEW_TYPE = "shawns-toolbox-capture";

export class CaptureView extends ItemView {
	private inputEl: HTMLTextAreaElement | null = null;
	private submitting = false;
	private dateBarEl: HTMLElement | null = null;
	private dateInputEl: HTMLInputElement | null = null;
	private dateBarKind: CaptureKind | null = null;
	private lastLongPress = 0;

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

		this.buildDateBar(root);

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
				this.wireLongPress(btn, kind);
			}
		}

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

	/** Hold a task button to pick which day the task goes to. */
	private wireLongPress(btn: HTMLElement, kind: CaptureKind): void {
		let timer: number | null = null;
		const cancel = () => {
			if (timer !== null) {
				window.clearTimeout(timer);
				timer = null;
			}
		};
		btn.addEventListener("pointerdown", () => {
			cancel();
			timer = window.setTimeout(() => {
				timer = null;
				this.lastLongPress = Date.now();
				this.showDateBar(kind);
			}, LONG_PRESS_MS);
		});
		btn.addEventListener("pointerup", cancel);
		btn.addEventListener("pointerleave", cancel);
		btn.addEventListener("pointercancel", cancel);
		// Android long-press context menu would steal the gesture
		btn.addEventListener("contextmenu", (e) => e.preventDefault());
	}

	private buildDateBar(root: HTMLElement): void {
		const bar = root.createDiv("stx-datebar");
		bar.hide();
		this.dateBarEl = bar;

		bar.createSpan({ cls: "stx-datebar-label" });

		const prev = bar.createEl("button", {
			cls: "stx-datebar-btn",
			attr: { "aria-label": "Previous day" },
		});
		setIcon(prev, "chevron-left");

		const input = bar.createEl("input", {
			cls: "stx-datebar-input",
			attr: { type: "date" },
		});
		this.dateInputEl = input;
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

		const add = bar.createEl("button", {
			cls: "stx-datebar-add",
			text: "Add",
		});
		add.addEventListener("click", () => {
			if (this.dateBarKind && input.value) {
				void this.submit(this.dateBarKind, input.value);
			}
		});

		const close = bar.createEl("button", {
			cls: "stx-datebar-btn",
			attr: { "aria-label": "Cancel" },
		});
		setIcon(close, "x");
		close.addEventListener("click", () => this.hideDateBar());
	}

	private showDateBar(kind: CaptureKind): void {
		if (!this.dateBarEl || !this.dateInputEl) return;
		this.dateBarKind = kind;
		const label = this.dateBarEl.querySelector(".stx-datebar-label");
		if (label) label.textContent = CAPTURE_LABELS[kind] + " on";
		// Long-press means "not today" — default to tomorrow.
		this.dateInputEl.value = shiftDateIso(todayIsoLocal(), 1);
		this.dateBarEl.show();
	}

	private hideDateBar(): void {
		this.dateBarEl?.hide();
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
			const when =
				dateIso && dateIso !== todayIsoLocal() ? dateIso : nowHm();
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
}
