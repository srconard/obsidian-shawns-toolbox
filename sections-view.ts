// sections-view.ts — the standalone Sections window: the section cards with
// no extra chrome. Split out of the capture view (2026-08-19, Shawn's call):
// each surface is its own openable window.
import { ItemView, WorkspaceLeaf } from "obsidian";
import { SectionCards, type CardsHost } from "./section-cards";

export const SECTIONS_VIEW_TYPE = "shawns-toolbox-sections";

export class SectionsView extends ItemView {
	private cards: SectionCards | null = null;

	constructor(leaf: WorkspaceLeaf, private host: CardsHost) {
		super(leaf);
	}

	getViewType(): string {
		return SECTIONS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Sections";
	}

	getIcon(): string {
		return "layout-list";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.cards = new SectionCards(this.host, this.contentEl, "main");
		this.addChild(this.cards);
	}

	async onClose(): Promise<void> {
		if (this.cards) {
			this.removeChild(this.cards);
			this.cards = null;
		}
	}
}
