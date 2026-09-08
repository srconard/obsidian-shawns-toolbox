// capture-side-view.ts — capture mode as a right-sidebar panel (Shawn,
// 2026-09-07: "can we add a capture panel — it will be the capture mode but in
// a side panel?"). Same surface as the main-pane Capture view, same routing,
// same long-press date bar and recent-thought tag menu — every behaviour comes
// from BaseCapturePanel, so there is exactly one implementation to maintain.
//
// The only differences are the ones a panel needs:
//   - `.stx-capture-side` on the root, which re-asserts the full-height flex
//     column with a compound selector (`div.view-content.stx-capture-side`, and
//     `.stx-dual-body.stx-capture-side` inside the dual panel) because
//     Obsidian's `.workspace-drawer .view-content` rules out-specify a single
//     class on the phone drawer and would otherwise collapse the column — the
//     v1.36.0 `.stx-voice-root` lesson — and drops the main view's 760px
//     centred typing column, which a narrow panel never wants.
//   - no auto-focus: a panel that grabs focus on open pops the phone keyboard
//     the moment the drawer is swiped in. Tap the box to type.
//
// The same CaptureSidePanel is what the dual panel mounts for "Capture", so the
// narrow-layout tuning is shared rather than re-derived.
import { BaseCapturePanel } from "./capture-base-view";
import type { ToolboxPanel } from "./panel-base";
import { ToolboxPanelView } from "./panel-view";

export const CAPTURE_SIDE_VIEW_TYPE = "shawns-toolbox-capture-side";

export class CaptureSidePanel extends BaseCapturePanel {
	protected variantClass(): string {
		return "stx-capture-side";
	}

	protected autoFocus(): boolean {
		return false;
	}
}

export class CaptureSideView extends ToolboxPanelView {
	getViewType(): string {
		return CAPTURE_SIDE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Capture panel";
	}

	getIcon(): string {
		return "pencil-line";
	}

	protected createPanel(container: HTMLElement): ToolboxPanel {
		return new CaptureSidePanel(this.host, container);
	}
}
