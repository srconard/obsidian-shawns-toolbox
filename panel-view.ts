// panel-view.ts — the thin ItemView shell that shows exactly one ToolboxPanel.
//
// Every standalone panel view is now this shell plus three metadata methods
// (view type, tab title, icon) and a factory. All behaviour lives in the panel
// body (panel-base.ts), which the dual view mounts two of inside one leaf.
import { ItemView, WorkspaceLeaf } from "obsidian";
import type { ToolboxPanel } from "./panel-base";
import type { CardsHost } from "./section-cards";

export abstract class ToolboxPanelView extends ItemView {
	private panel: ToolboxPanel | null = null;

	constructor(leaf: WorkspaceLeaf, protected host: CardsHost) {
		super(leaf);
	}

	/** Build the body this view shows, rendering into `container`. */
	protected abstract createPanel(container: HTMLElement): ToolboxPanel;

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		const panel = this.createPanel(this.contentEl);
		this.panel = panel;
		// Adopt the panel's hotkey scope: Obsidian activates `view.scope` while
		// the view has focus, which is how the capture panel's Mod+Enter beats
		// Obsidian's own keymap.
		if (panel.scope) this.scope = panel.scope;
		this.addChild(panel);
	}

	async onClose(): Promise<void> {
		if (this.panel) {
			this.removeChild(this.panel);
			this.panel = null;
		}
	}
}
