// capture-view.ts — the central "blank screen" view in a main pane: nothing
// but an auto-focused input and the four routing buttons (type → route to a
// daily-note section → screen clears). Sections live in their own view
// (sections-view.ts) — deliberately no tabs or chrome here.
//
// The surface itself lives in capture-base-view.ts, shared with the
// right-sidebar variant (capture-side-view.ts) and the dual panel.
import { BaseCapturePanel } from "./capture-base-view";
import type { ToolboxPanel } from "./panel-base";
import { ToolboxPanelView } from "./panel-view";

export const CAPTURE_VIEW_TYPE = "shawns-toolbox-capture";

/** The main-pane capture surface: auto-focused, 760px centred typing column. */
export class CapturePanel extends BaseCapturePanel {}

export class CaptureView extends ToolboxPanelView {
	getViewType(): string {
		return CAPTURE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Capture";
	}

	getIcon(): string {
		return "zap";
	}

	protected createPanel(container: HTMLElement): ToolboxPanel {
		return new CapturePanel(this.host, container);
	}
}
