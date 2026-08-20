// focus-view.ts — left-sidebar Focus panel: the section cards with their own
// persisted selection (default "## Plan for Today"). On the phone, the native
// left-edge swipe opens this: "swipe from the left, see the plan."
import { ItemView, WorkspaceLeaf } from "obsidian";
import { SectionCards, type CardsHost } from "./section-cards";

export const FOCUS_VIEW_TYPE = "shawns-toolbox-focus";

export class FocusView extends ItemView {
	private cards: SectionCards | null = null;

	constructor(leaf: WorkspaceLeaf, private host: CardsHost) {
		super(leaf);
	}

	getViewType(): string {
		return FOCUS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Focus";
	}

	getIcon(): string {
		return "list-todo";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.cards = new SectionCards(this.host, this.contentEl, "focus");
		this.addChild(this.cards);
	}

	async onClose(): Promise<void> {
		if (this.cards) {
			this.removeChild(this.cards);
			this.cards = null;
		}
	}
}
