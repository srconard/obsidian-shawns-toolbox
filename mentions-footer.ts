// mentions-footer.ts — "Rich mentions" area at the bottom of a note view. Lists
// every *inline* mention of the current note (a link inside a sentence/bullet,
// not a bare link-list entry), grouped by source note with the full line and,
// for a parent bullet, its whole child subtree — richer than Obsidian's native
// backlink pane. Pure DOM, mirroring StatusFooter; nothing is written to notes.
//
// Cheap by default: the collapsed affordance only appears when resolvedLinks
// says something links here (in-memory, no file reads). The vault-wide inline
// extraction (which must read each source note) runs lazily on expand.
import { App, MarkdownView, TFile, moment } from "obsidian";
import { extractInlineMentions, type InlineMention } from "./mentions-core";
import type { ShawnsToolboxSettings } from "./settings";

const FOOTER_CLASS = "stx-mentions-host";
const DAILY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface SourceMentions {
	file: TFile;
	label: string;
	sortKey: string;
	mentions: InlineMention[];
}

export class MentionsFooter {
	/** Target paths Shawn has expanded, so a metadata-driven rebuild re-expands. */
	private expanded = new Set<string>();

	constructor(
		private app: App,
		private getSettings: () => ShawnsToolboxSettings
	) {}

	private isExcluded(path: string): boolean {
		return this.getSettings().mentionsExcludeFolders.some(
			(folder) => path === folder || path.startsWith(`${folder}/`)
		);
	}

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
		host.querySelectorAll(`.${FOOTER_CLASS}`).forEach((el) => el.remove());

		const file = view.file;
		if (!file) return;
		if (!this.getSettings().mentionsFooterEnabled) return;
		if (this.isExcluded(file.path)) return;
		if (!this.hasBacklinks(file)) return;

		const container = host.createDiv({ cls: FOOTER_CLASS });
		if (this.expanded.has(file.path)) {
			this.renderExpanded(container, file);
		} else {
			const collapsed = container.createDiv({
				cls: "stx-collapsed",
				text: "❯ mentions",
			});
			collapsed.onclick = () => {
				this.expanded.add(file.path);
				collapsed.remove();
				this.renderExpanded(container, file);
			};
		}
	}

	/** Cheap in-memory check: does any note resolve a link to `target`? */
	private hasBacklinks(target: TFile): boolean {
		const resolved = this.app.metadataCache.resolvedLinks;
		for (const [src, targets] of Object.entries(resolved)) {
			if (src !== target.path && target.path in targets) return true;
		}
		return false;
	}

	private renderExpanded(container: HTMLElement, file: TFile): void {
		const area = container.createDiv({ cls: "stx-mentions" });
		const header = area.createDiv({ cls: "stx-mentions-header" });
		header.setText("Rich mentions");
		const collapse = header.createSpan({
			cls: "stx-mentions-collapse",
			text: "  ✕",
		});
		collapse.onclick = () => {
			this.expanded.delete(file.path);
			this.refreshAll();
		};
		const body = area.createDiv({ cls: "stx-mentions-body" });
		body.setText("Scanning…");

		void this.collect(file)
			.then((sources) => {
				body.empty();
				if (sources.length === 0) {
					body.createDiv({
						cls: "stx-mentions-empty",
						text: "No inline mentions (only bare link-list entries).",
					});
					return;
				}
				for (const src of sources) this.renderSource(body, src);
			})
			.catch((err) => {
				body.setText(`Could not scan mentions: ${err?.message ?? err}`);
			});
	}

	private renderSource(body: HTMLElement, src: SourceMentions): void {
		const group = body.createDiv({ cls: "stx-mentions-source" });
		group.createDiv({ cls: "stx-mentions-source-label", text: src.label });
		const list = group.createDiv({ cls: "stx-mentions-list" });
		for (const m of src.mentions) {
			const item = list.createDiv({ cls: "stx-mention" });
			const line = item.createDiv({ cls: "stx-mention-text", text: m.text });
			line.onclick = () => this.openAt(src.file, m.line);
			if (m.subtree.length) {
				const tree = item.createEl("pre", { cls: "stx-mention-subtree" });
				tree.setText(m.subtree.join("\n"));
			}
		}
	}

	/**
	 * Every source note with at least one inline mention of `target`, sorted
	 * most-recent first (daily notes by their date, others by mtime). Uses
	 * resolvedLinks to find candidate sources (no read), then reads only those.
	 */
	private async collect(target: TFile): Promise<SourceMentions[]> {
		const resolved = this.app.metadataCache.resolvedLinks;
		const out: SourceMentions[] = [];
		for (const [srcPath, targets] of Object.entries(resolved)) {
			if (srcPath === target.path) continue;
			if (!(target.path in targets)) continue;
			const srcFile = this.app.vault.getAbstractFileByPath(srcPath);
			if (!(srcFile instanceof TFile)) continue;
			const content = await this.app.vault.cachedRead(srcFile);
			const isTarget = (linkTarget: string) => {
				const dest = this.app.metadataCache.getFirstLinkpathDest(
					linkTarget,
					srcPath
				);
				return dest?.path === target.path;
			};
			const mentions = extractInlineMentions(content, isTarget);
			if (mentions.length === 0) continue;
			const dated = DAILY_RE.test(srcFile.basename);
			out.push({
				file: srcFile,
				label: srcFile.basename,
				sortKey: dated
					? srcFile.basename
					: moment(srcFile.stat.mtime).format("YYYY-MM-DD"),
				mentions,
			});
		}
		out.sort((a, b) =>
			a.sortKey === b.sortKey
				? a.label.localeCompare(b.label)
				: a.sortKey < b.sortKey
					? 1
					: -1
		);
		return out;
	}

	private async openAt(file: TFile, line: number): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file, { eState: { line } });
	}

	unmount(): void {
		document.querySelectorAll(`.${FOOTER_CLASS}`).forEach((el) => el.remove());
	}
}
