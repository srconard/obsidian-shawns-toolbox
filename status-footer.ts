// status-footer.ts — appends a status row to the bottom of the note view.
// This is the phone surface. Nothing is written into the note body; the footer
// is pure DOM, rebuilt on every layout/metadata change.
import { App, MarkdownView } from "obsidian";
import { renderStatusControls } from "./status-controls";
import { readStatus } from "./status-service";
import type { ShawnsToolboxSettings } from "./settings";

const FOOTER_CLASS = "stx-footer-host";

export class StatusFooter {
	constructor(
		private app: App,
		private getSettings: () => ShawnsToolboxSettings
	) {}

	private isExcluded(path: string): boolean {
		return this.getSettings().statusExcludeFolders.some(
			(folder) => path === folder || path.startsWith(`${folder}/`)
		);
	}

	/** Live Preview renders into .cm-sizer; Reading view into .markdown-preview-section. */
	private hostFor(view: MarkdownView): HTMLElement | null {
		return (
			view.contentEl.querySelector<HTMLElement>(".cm-sizer") ??
			view.contentEl.querySelector<HTMLElement>(".markdown-preview-section")
		);
	}

	refreshAll(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView) this.refreshView(view);
		}
	}

	private refreshView(view: MarkdownView): void {
		const host = this.hostFor(view);
		if (!host) return;

		// Always clear first — prevents duplicates on re-render and stale
		// footers when switching notes within the same leaf.
		host.querySelectorAll(`.${FOOTER_CLASS}`).forEach((el) => el.remove());

		const file = view.file;
		if (!file) return;
		if (!this.getSettings().statusFooterEnabled) return;
		if (this.isExcluded(file.path)) return;

		const container = host.createDiv({ cls: FOOTER_CLASS });
		const status = readStatus(this.app, file);

		if (status.phase === null && !status.ongoing) {
			// Untagged notes get a quiet affordance rather than a full row, so
			// the footer doesn't shout on every note in the vault.
			const collapsed = container.createDiv({
				cls: "stx-collapsed",
				text: "＋ status",
			});
			collapsed.onclick = () => {
				collapsed.remove();
				renderStatusControls(container, this.app, file, "footer");
			};
			return;
		}

		renderStatusControls(container, this.app, file, "footer");
	}

	unmount(): void {
		document
			.querySelectorAll(`.${FOOTER_CLASS}`)
			.forEach((el) => el.remove());
	}
}
