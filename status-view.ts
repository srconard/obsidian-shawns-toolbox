// status-view.ts — desktop right-sidebar panel showing the active note's status.
import { ItemView, WorkspaceLeaf } from "obsidian";
import { renderStatusControls } from "./status-controls";

export const STATUS_VIEW_TYPE = "shawns-toolbox-status";

export class StatusView extends ItemView {
	getViewType(): string {
		return STATUS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Note status";
	}

	getIcon(): string {
		return "check-circle";
	}

	async onOpen(): Promise<void> {
		// file-open is the event that actually fires when the active note
		// changes. active-leaf-change alone misses the case where the workspace
		// has no active file yet at mount time, which leaves a stale
		// "No note open" panel that never recovers.
		this.registerEvent(
			this.app.workspace.on("file-open", () => this.refresh())
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.refresh())
		);
		this.registerEvent(
			this.app.metadataCache.on("changed", () => this.refresh())
		);
		this.app.workspace.onLayoutReady(() => this.refresh());
		this.refresh();
	}

	// NOTE: deliberately named `refresh`, not `open`. A TS-private `open()`
	// shadows View.prototype.open and yields a silently blank view — that bug
	// cost a debugging session in the greenhouse-home plugin.
	refresh(): void {
		const container = this.contentEl;
		// getActiveFile(), not getActiveViewOfType(MarkdownView) — revealing this
		// panel gives it focus, so the "active view" is the panel itself and the
		// markdown lookup returns null. getActiveFile() survives that.
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			container.empty();
			container.createDiv({ cls: "stx-collapsed", text: "No note open" });
			return;
		}
		renderStatusControls(container, this.app, file, "panel");
	}
}
