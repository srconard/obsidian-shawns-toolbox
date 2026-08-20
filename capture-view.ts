// capture-view.ts — the central "blank screen" view. Two modes toggled at the
// top: Capture (type → route to a daily-note section → screen clears) and
// Sections (the editable section cards).
import { ItemView, Notice, Scope, WorkspaceLeaf, setIcon } from "obsidian";
import type { CaptureKind } from "./section-core";
import {
	CAPTURE_ICONS,
	CAPTURE_LABELS,
	nowHm,
	routeCapture,
} from "./capture-service";
import { SectionCards, type CardsHost } from "./section-cards";

export const CAPTURE_VIEW_TYPE = "shawns-toolbox-capture";

type Mode = "capture" | "sections";

export class CaptureView extends ItemView {
	private mode: Mode = "capture";
	private cards: SectionCards | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private pendingText = "";
	private submitting = false;

	constructor(leaf: WorkspaceLeaf, private host: CardsHost) {
		super(leaf);
		// Mod+Enter = Thought. Registered on the view's keymap scope because
		// Obsidian's keymap claims the combo before a plain DOM listener on
		// the textarea ever sees it.
		this.scope = new Scope(this.app.scope);
		this.scope.register(["Mod"], "Enter", (evt) => {
			if (this.mode !== "capture") return true;
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
		this.render();
	}

	async onClose(): Promise<void> {
		this.unmountCards();
	}

	private unmountCards(): void {
		if (this.cards) {
			this.removeChild(this.cards);
			this.cards = null;
		}
	}

	private render(): void {
		// keep unsent capture text across mode switches
		if (this.inputEl) this.pendingText = this.inputEl.value;
		this.unmountCards();
		this.inputEl = null;

		const root = this.contentEl;
		root.empty();
		root.addClass("stx-capture-root");

		const tabs = root.createDiv("stx-mode-tabs");
		for (const mode of ["capture", "sections"] as Mode[]) {
			const btn = tabs.createEl("button", {
				cls:
					"stx-mode-tab" + (mode === this.mode ? " is-active" : ""),
				text: mode === "capture" ? "Capture" : "Sections",
			});
			btn.addEventListener("click", () => {
				if (this.mode === mode) return;
				this.mode = mode;
				this.render();
			});
		}

		const body = root.createDiv("stx-mode-body");
		if (this.mode === "capture") this.renderCapture(body);
		else {
			this.cards = new SectionCards(this.host, body, "main");
			this.addChild(this.cards);
		}
	}

	private renderCapture(body: HTMLElement): void {
		body.addClass("stx-capture-body");
		const input = body.createEl("textarea", {
			cls: "stx-capture-input",
			attr: { placeholder: "…" },
		});
		input.value = this.pendingText;
		this.inputEl = input;

		const buttons = body.createDiv("stx-capture-buttons");
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
			btn.addEventListener("click", () => void this.submit(kind));
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

	private async submit(kind: CaptureKind): Promise<void> {
		if (!this.inputEl || this.submitting) return;
		const text = this.inputEl.value;
		if (!text.trim()) return;
		this.submitting = true;
		try {
			const target = await routeCapture(
				this.app,
				this.host.getSettings(),
				kind,
				text
			);
			// Only clear after the write succeeded — never lose input.
			this.inputEl.value = "";
			this.pendingText = "";
			this.inputEl.focus();
			new Notice(`→ ${target} ${nowHm()}`);
		} catch (e) {
			new Notice(
				`Capture failed: ${e instanceof Error ? e.message : String(e)}`
			);
		} finally {
			this.submitting = false;
		}
	}
}
