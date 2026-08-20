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

export const CAPTURE_VIEW_TYPE = "shawns-toolbox-capture";

export class CaptureView extends ItemView {
	private inputEl: HTMLTextAreaElement | null = null;
	private submitting = false;
	private dateBar: DateBar | null = null;
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
}
