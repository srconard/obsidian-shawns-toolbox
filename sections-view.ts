// sections-view.ts — the standalone Sections window: the section cards with
// no extra chrome. Split out of the capture view (2026-08-19, Shawn's call):
// each surface is its own openable window.
//
// The body is a ToolboxPanel so the dual panel (v1.39.0) can host it as one
// half of a split leaf; SectionsView is the standalone shell over the same body.
import { SectionCards } from "./section-cards";
import { ToolboxPanel } from "./panel-base";
import { ToolboxPanelView } from "./panel-view";

export const SECTIONS_VIEW_TYPE = "shawns-toolbox-sections";

export class SectionsPanel extends ToolboxPanel {
	private cards: SectionCards | null = null;

	protected async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.cards = new SectionCards(this.host, this.contentEl, "main");
		this.addChild(this.cards);
	}

	protected async onClose(): Promise<void> {
		if (this.cards) {
			this.removeChild(this.cards);
			this.cards = null;
		}
	}
}

export class SectionsView extends ToolboxPanelView {
	getViewType(): string {
		return SECTIONS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Sections";
	}

	getIcon(): string {
		return "layout-list";
	}

	protected createPanel(container: HTMLElement): ToolboxPanel {
		return new SectionsPanel(this.host, container);
	}
}
