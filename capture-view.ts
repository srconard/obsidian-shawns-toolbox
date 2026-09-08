// capture-view.ts — the central "blank screen" view in a main pane: nothing
// but an auto-focused input and the four routing buttons (type → route to a
// daily-note section → screen clears). Sections live in their own view
// (sections-view.ts) — deliberately no tabs or chrome here.
//
// The surface itself lives in capture-base-view.ts, shared with the
// right-sidebar variant (capture-side-view.ts).
import { BaseCaptureView } from "./capture-base-view";

export const CAPTURE_VIEW_TYPE = "shawns-toolbox-capture";

export class CaptureView extends BaseCaptureView {
	getViewType(): string {
		return CAPTURE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Capture";
	}

	getIcon(): string {
		return "zap";
	}
}
