// guiding-view.ts — right-sidebar Guiding Questions panel, modelled on the
// Pillars panel. It parses the source note live, flips through its sections one
// at a time with ◀ ▶ + a jump dropdown (the pillar-row styling), remembers the
// last-viewed section across sessions, and re-renders when the note changes.
//
// A lightly-structured note (few/no headings) shows as a single "whole note"
// view instead of breaking — the resilience the note needs while Shawn is still
// reorganising it (guiding-core owns that logic). v1 is read + flip + live
// update; per-section editing is deferred until the note's headings stabilise.
import { ItemView, MarkdownRenderer, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type { CardsHost } from "./section-cards";
import { guidingViews, sliceGuidingView, type GuidingView } from "./guiding-core";

export const GUIDING_VIEW_TYPE = "shawns-toolbox-guiding";

export class GuidingQuestionsView extends ItemView {
	private views: GuidingView[] = [];
	private index = 0;

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

	/** Re-parse the note, keep the last-viewed section if it still exists. */
	private async refresh(): Promise<void> {
		const file = this.noteFile();
		if (!file) {
			this.views = [];
			this.renderEmpty();
			return;
		}
		const wanted =
			this.views[this.index]?.title ??
			this.host.getSettings().lastGuidingView;
		const content = await this.host.app.vault.cachedRead(file);
		this.views = guidingViews(content);
		const found = this.views.findIndex((v) => v.title === wanted);
		this.index =
			found >= 0
				? found
				: Math.min(Math.max(this.index, 0), this.views.length - 1);
		this.renderCurrent(file, content);
	}

	private async setIndex(i: number): Promise<void> {
		const n = this.views.length;
		if (n === 0) return;
		this.index = ((i % n) + n) % n;
		this.host.getSettings().lastGuidingView = this.views[this.index].title;
		await this.host.saveSettings();
		const file = this.noteFile();
		if (file) {
			this.renderCurrent(file, await this.host.app.vault.cachedRead(file));
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
		const toolbar = this.contentEl.createDiv("stx-cards-toolbar");
		this.buildRow(toolbar);

		const cardsEl = this.contentEl.createDiv("stx-cards");
		const view = this.views[this.index];
		if (!view) {
			cardsEl.createDiv({ cls: "stx-empty", text: "Nothing to show." });
			return;
		}
		const card = cardsEl.createDiv("stx-card");
		const body = card.createDiv("stx-card-body");
		const slice = sliceGuidingView(content, view);
		void MarkdownRenderer.render(
			this.host.app,
			slice.trim() || "*empty*",
			body,
			file.path,
			this
		);
	}

	/** ◀ [section dropdown] ▶ — mirrors the Pillars panel's flip row. */
	private buildRow(toolbar: HTMLElement): void {
		const row = toolbar.createDiv("stx-pillar-row");
		const navBtn = (aria: string, icon: string, cb: () => void) => {
			const btn = row.createEl("button", {
				cls: "stx-nav-btn",
				attr: { "aria-label": aria },
			});
			setIcon(btn, icon);
			btn.addEventListener("click", cb);
		};
		navBtn("Previous section", "chevron-left", () =>
			void this.setIndex(this.index - 1)
		);
		const select = row.createEl("select", { cls: "stx-pillar-select" });
		if (this.views.length === 0) {
			select.createEl("option", { text: "—" });
			select.disabled = true;
		} else {
			this.views.forEach((v, i) => {
				const opt = select.createEl("option", {
					text: v.title,
					value: String(i),
				});
				if (i === this.index) opt.selected = true;
			});
			select.value = String(this.index);
			select.addEventListener("change", () =>
				void this.setIndex(Number(select.value))
			);
		}
		navBtn("Next section", "chevron-right", () =>
			void this.setIndex(this.index + 1)
		);
	}
}
