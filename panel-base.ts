// panel-base.ts — a toolbox panel body, decoupled from the leaf that shows it.
//
// Every sidebar panel used to BE an ItemView: it rendered into its own
// `this.contentEl` and could therefore only ever exist one-per-leaf. The dual
// panel (v1.39.0) needs two panels inside ONE leaf, so the body moved down here:
// a `Component` that is handed the container it should render into.
//
// The hook names are deliberately `onOpen` / `onClose` — the same names the
// ItemView bodies already used — so converting a panel is a class-header change,
// not a rewrite, and each standalone view keeps behaving identically. The thin
// ItemView shell that hosts one of these lives in panel-view.ts; the dual view
// hosts two of them (dual-view.ts).
import { App, Component, Scope } from "obsidian";
import type { CardsHost } from "./section-cards";

export abstract class ToolboxPanel extends Component {
	/** Same `this.app` the ItemView bodies used. */
	readonly app: App;
	/**
	 * Optional keymap scope for panel-local hotkeys (the capture panel's
	 * Mod+Enter). A View gets `scope` for free; a Component does not, so the
	 * host adopts whatever the panel sets here — see ToolboxPanelView.
	 */
	scope: Scope | null = null;

	constructor(
		protected host: CardsHost,
		readonly contentEl: HTMLElement
	) {
		super();
		this.app = host.app;
	}

	/** Render into `this.contentEl`. Called once, when the panel loads. */
	protected onOpen(): Promise<void> | void {}

	/** Tear down anything the render started. Called when the panel unloads. */
	protected onClose(): Promise<void> | void {}

	onload(): void {
		void this.onOpen();
	}

	onunload(): void {
		void this.onClose();
	}
}
