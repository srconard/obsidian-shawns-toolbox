// focus-view.ts — left-sidebar Focus panel: the section cards with their own
// persisted selection (default "## Plan for Today"). On the phone, the native
// left-edge swipe opens this: "swipe from the left, see the plan."
//
// The body is a ToolboxPanel so the dual panel (v1.39.0) can host it as one
// half of a split leaf; FocusView is the standalone shell over the same body.
import { SectionCards } from "./section-cards";
import { ToolboxPanel } from "./panel-base";
import { ToolboxPanelView } from "./panel-view";

export const FOCUS_VIEW_TYPE = "shawns-toolbox-focus";
/**
 * The same Focus body opened as a main-area tab (v1.48.0): room to browse
 * past weeks, with big week buttons pinned to the bottom. Shawn, 2026-09-22:
 * "a command that opens the focus screen not as a side panel but full on the
 * main screen … the buttons to skip around to different weeks bigger … at
 * the bottom". No swipe — on the phone a horizontal swipe opens the drawers.
 */
export const FOCUS_FULL_VIEW_TYPE = "shawns-toolbox-focus-full";

export class FocusPanel extends ToolboxPanel {
	private cards: SectionCards | null = null;
	/** Set by FocusFullView before the panel loads. */
	layout: "pane" | "full" = "pane";

	protected async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.cards = new SectionCards(
			this.host,
			this.contentEl,
			"focus",
			undefined,
			this.layout
		);
		this.addChild(this.cards);
	}

	protected async onClose(): Promise<void> {
		if (this.cards) {
			this.removeChild(this.cards);
			this.cards = null;
		}
	}
}

export class FocusView extends ToolboxPanelView {
	getViewType(): string {
		return FOCUS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Focus";
	}

	getIcon(): string {
		return "list-todo";
	}

	protected createPanel(container: HTMLElement): ToolboxPanel {
		return new FocusPanel(this.host, container);
	}
}

export class FocusFullView extends ToolboxPanelView {
	getViewType(): string {
		return FOCUS_FULL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Focus";
	}

	getIcon(): string {
		return "list-todo";
	}

	protected createPanel(container: HTMLElement): ToolboxPanel {
		const panel = new FocusPanel(this.host, container);
		panel.layout = "full";
		return panel;
	}
}
