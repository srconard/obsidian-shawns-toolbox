// guiding-view.ts — right-sidebar Guiding Questions panel.
//
// It works like the Pillars / periodic-note panels: a row of section chips lets
// Shawn pick which of the note's sections to show, and the picked sections
// render together in a scrollable stack (the section-cards chip pattern reused
// for one fixed note). The selection persists across reloads, and the panel
// re-renders when the note changes.
//
// A lightly-structured note (few/no headings) still degrades gracefully — the
// chips include a single "Whole note" view when there are no headings, and a
// leading "(top)" view for any content before the first heading (guiding-core
// owns that logic). v1 stays read-only; per-section editing is deferred until
// the note's headings stabilise.
import { ItemView, MarkdownRenderer, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type { CardsHost } from "./section-cards";
import {
	guidingViews,
	sliceGuidingView,
	orderGuidingSelection,
	toggleGuidingSelection,
	type GuidingView,
} from "./guiding-core";
import { wireLinkClicks } from "./link-clicks";

export const GUIDING_VIEW_TYPE = "shawns-toolbox-guiding";

export class GuidingQuestionsView extends ItemView {
	private views: GuidingView[] = [];

	constructor(leaf: WorkspaceLeaf, private host: CardsHost) {
		super(leaf);
	}

	getViewType(): string {
		return GUIDING_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Guiding Questions";
	}

	getIcon(): string {
		return "compass";
	}

	async onOpen(): Promise<void> {
		const onNote = (f: { path: string }) => {
			if (f.path === this.notePath()) void this.refresh();
		};
		this.registerEvent(this.host.app.vault.on("modify", onNote));
		this.registerEvent(this.host.app.vault.on("create", onNote));
		this.registerEvent(
			this.host.app.vault.on("rename", (f, oldPath) => {
				if (f.path === this.notePath() || oldPath === this.notePath()) {
					void this.refresh();
				}
			})
		);
		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private notePath(): string {
		return this.host.getSettings().guidingQuestionsNotePath;
	}

	private noteFile(): TFile | null {
		const f = this.host.app.vault.getAbstractFileByPath(this.notePath());
		return f instanceof TFile ? f : null;
	}

	private selection(): string[] {
		return this.host.getSettings().guidingSectionSelections;
	}

	private async setSelection(titles: string[]): Promise<void> {
		this.host.getSettings().guidingSectionSelections = titles;
		await this.host.saveSettings();
	}

	private chipsCollapsed(): boolean {
		return this.host.getSettings().guidingChipsCollapsed;
	}

	private async setChipsCollapsed(v: boolean): Promise<void> {
		this.host.getSettings().guidingChipsCollapsed = v;
		await this.host.saveSettings();
	}

	/** Re-parse the note and re-render the currently-picked sections. */
	private async refresh(): Promise<void> {
		const file = this.noteFile();
		if (!file) {
			this.views = [];
			this.renderEmpty();
			return;
		}
		const content = await this.host.app.vault.cachedRead(file);
		this.views = guidingViews(content);
		await this.migrateFromLastView();
		this.renderCurrent(file, content);
	}

	/**
	 * One-time seed for users upgrading from the v1.17.0 one-section-at-a-time
	 * panel: if nothing is picked yet but a last-viewed section was remembered
	 * and still resolves, select it so the panel isn't blank on first open.
	 */
	private async migrateFromLastView(): Promise<void> {
		if (this.selection().length > 0) return;
		const last = this.host.getSettings().lastGuidingView;
		if (last && this.views.some((v) => v.title === last)) {
			await this.setSelection([last]);
		}
	}

	private renderEmpty(): void {
		this.contentEl.empty();
		this.contentEl.addClass("stx-section-cards");
		this.contentEl.createDiv({
			cls: "stx-empty",
			text: `Guiding Questions note not found (${this.notePath()}). Set the path in Shawn's Toolbox settings.`,
		});
	}

	private renderCurrent(file: TFile, content: string): void {
		this.contentEl.empty();
		this.contentEl.addClass("stx-section-cards");
		this.contentEl.style.display = "flex";
		this.contentEl.style.flexDirection = "column";

		const toolbar = this.contentEl.createDiv("stx-cards-toolbar");
		const collapsed = this.chipsCollapsed();
		const chipsToggle = toolbar.createEl("button", {
			cls: "stx-chips-toggle",
			attr: { "aria-label": "Show/hide section buttons" },
		});
		setIcon(chipsToggle, collapsed ? "chevron-right" : "chevron-down");
		chipsToggle.addEventListener("click", async () => {
			await this.setChipsCollapsed(!this.chipsCollapsed());
			this.renderCurrent(file, content);
		});
		// The note name, tappable to open the note itself.
		const label = toolbar.createEl("button", {
			cls: "stx-nav-label",
			text: file.basename,
			attr: { "aria-label": `Open ${file.basename}` },
		});
		label.addEventListener("click", () => {
			void this.host.app.workspace.getLeaf(false).openFile(file);
		});

		const selected = new Set(this.selection());
		const chipsEl = this.contentEl.createDiv(
			"stx-chips" + (collapsed ? " is-collapsed" : "")
		);
		for (const view of this.views) {
			const chip = chipsEl.createEl("button", {
				cls:
					"stx-chip stx-chip-l" +
					view.level +
					(selected.has(view.title) ? " is-active" : ""),
				text: view.title,
			});
			chip.addEventListener("click", async () => {
				await this.setSelection(
					toggleGuidingSelection(
						this.views,
						this.selection(),
						view.title
					)
				);
				this.renderCurrent(file, content);
			});
		}

		const cardsEl = this.contentEl.createDiv("stx-cards");
		cardsEl.style.flex = "1 1 auto";
		cardsEl.style.minHeight = "0";
		const picked = orderGuidingSelection(this.views, this.selection());
		if (picked.length === 0) {
			cardsEl.createDiv({
				cls: "stx-empty",
				text: "Pick one or more sections above.",
			});
			return;
		}
		for (const view of picked) {
			this.buildCard(cardsEl, file, content, view);
		}
	}

	private buildCard(
		cardsEl: HTMLElement,
		file: TFile,
		content: string,
		view: GuidingView
	): void {
		const card = cardsEl.createDiv("stx-card");
		if (view.kind === "section") {
			card.createDiv({ cls: "stx-card-title", text: view.title });
		}
		const body = card.createDiv("stx-card-body");
		wireLinkClicks(this.host.app, body, file.path);
		const slice = sliceGuidingView(content, view);
		void MarkdownRenderer.render(
			this.host.app,
			slice.trim() || "*empty*",
			body,
			file.path,
			this
		);
	}
}
