// eco-tasks-view.ts — the "Eco tasks" panel (2026-09-27, J-0927-16).
//
// Lists the ACTIVE note's Eco tasks and comments (written by the Obsidian Eco
// plugin's line 💬) with their echo status — open / running / blocked / done /
// failed — the blocker question when blocked, and a reply box that writes the
// answer under the task and clears #echo/blocked so the watcher re-runs it.
// Clicking an item jumps to the anchored line. Rules: eco-tasks-core.ts.
import { Notice, TFile } from "obsidian";
import { ToolboxPanel } from "./panel-base";
import { ToolboxPanelView } from "./panel-view";
import { parseEcoItems, replyToBlocked, statusCounts, STATUS_LABELS, type EcoItem } from "./eco-tasks-core";

export const ECO_TASKS_VIEW_TYPE = "shawns-toolbox-eco-tasks";

export class EcoTasksPanel extends ToolboxPanel {
	private file: TFile | null = null;
	private timer: number | null = null;
	/** Drafts survive the re-render a vault change triggers. */
	private drafts = new Map<string, string>();

	protected onOpen(): void {
		this.contentEl.addClass("stx-eco-tasks");
		this.registerEvent(this.app.workspace.on("file-open", () => this.follow()));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.follow()));
		this.registerEvent(
			this.app.vault.on("modify", (f) => {
				if (this.file && f.path === this.file.path) this.schedule();
			})
		);
		this.app.workspace.onLayoutReady(() => this.follow());
		this.follow();
	}

	protected onClose(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
	}

	/** Track the active markdown note (the panel keeps the last one while it has focus). */
	private follow(): void {
		const f = this.app.workspace.getActiveFile();
		if (f && f.extension === "md") this.file = f;
		void this.refresh();
	}

	private schedule(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.refresh();
		}, 400);
	}

	// Named `refresh`, not `open` — see status-view.ts.
	async refresh(): Promise<void> {
		const el = this.contentEl;
		const file = this.file;
		if (!file) {
			el.empty();
			el.createDiv({ cls: "stx-collapsed", text: "No note open" });
			return;
		}
		const text = await this.app.vault.cachedRead(file);
		if (this.file !== file) return;
		// A focused reply box must not be wiped by a re-render mid-typing.
		const active = document.activeElement;
		if (active instanceof HTMLTextAreaElement && el.contains(active)) return;
		this.render(file, parseEcoItems(text));
	}

	private render(file: TFile, items: EcoItem[]): void {
		const el = this.contentEl;
		el.empty();
		const head = el.createDiv({ cls: "stx-eco-head" });
		head.createSpan({ cls: "stx-eco-title", text: `Eco tasks · ${file.basename}` });
		const c = statusCounts(items);
		const bits = [
			c.open && `${c.open} open`,
			c.running && `${c.running} running`,
			c.blocked && `${c.blocked} blocked`,
			c.done && `${c.done} done`,
			c.failed && `${c.failed} failed`,
			c.comment && `${c.comment} comment${c.comment === 1 ? "" : "s"}`,
		].filter(Boolean);
		if (bits.length) head.createSpan({ cls: "stx-eco-counts", text: bits.join(" · ") });

		if (!items.length) {
			el.createDiv({
				cls: "stx-collapsed",
				text: "No Eco tasks or comments in this note. Hover a line and press 💬 (Obsidian Eco plugin 0.3.0+), or use the command “Comment or Eco task on the current line”.",
			});
			return;
		}
		const tasks = items.filter((i) => i.kind === "task");
		const comments = items.filter((i) => i.kind === "comment");
		if (tasks.length) this.group(el, "Eco tasks", tasks, file);
		if (comments.length) this.group(el, "Comments", comments, file);
	}

	private group(el: HTMLElement, title: string, items: EcoItem[], file: TFile): void {
		el.createDiv({ cls: "stx-eco-group", text: title });
		for (const it of items) this.item(el, it, file);
	}

	private item(el: HTMLElement, it: EcoItem, file: TFile): void {
		const row = el.createDiv({ cls: `stx-eco-item is-${it.status}` });
		const top = row.createDiv({ cls: "stx-eco-top" });
		top.createSpan({ cls: `stx-eco-chip is-${it.status}`, text: STATUS_LABELS[it.status] });
		top.createSpan({ cls: "stx-eco-text", text: it.text || "(empty)" });
		if (it.stamp) row.createDiv({ cls: "stx-eco-meta", text: it.stamp });
		if (it.context) row.createDiv({ cls: "stx-eco-context", text: `re: ${it.context}` });
		if (it.question) row.createDiv({ cls: "stx-eco-question", text: `❓ ${it.question}` });
		else if (it.summary && it.status !== "open") row.createDiv({ cls: "stx-eco-summary", text: it.summary });
		for (const r of it.replies) row.createDiv({ cls: "stx-eco-reply", text: `↳ ${r}` });
		row.onclick = (e) => {
			if ((e.target as HTMLElement).closest(".stx-eco-answer")) return;
			void this.jump(file, it);
		};
		if (it.status === "blocked") this.replyBox(row, it, file);
	}

	private replyBox(row: HTMLElement, it: EcoItem, file: TFile): void {
		const box = row.createDiv({ cls: "stx-eco-answer" });
		const ta = box.createEl("textarea", { attr: { rows: "2", placeholder: "Answer, then Reply — the task re-runs with it" } });
		ta.value = this.drafts.get(it.raw) ?? "";
		ta.oninput = () => this.drafts.set(it.raw, ta.value);
		const btn = box.createEl("button", { text: "Reply & re-run", cls: "mod-cta" });
		const send = async (): Promise<void> => {
			btn.disabled = true;
			let error = "";
			try {
				await this.app.vault.process(file, (text) => {
					const r = replyToBlocked(text, it.line, it.raw, ta.value, new Date());
					if (!r.ok) {
						error = r.error;
						return text;
					}
					return r.text;
				});
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
			}
			btn.disabled = false;
			if (error) {
				new Notice(error);
				return;
			}
			this.drafts.delete(it.raw);
			ta.blur();
			new Notice("Answer written — the echo watcher re-runs the task within a minute.");
			void this.refresh();
		};
		btn.onclick = () => void send();
		ta.onkeydown = (e) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				void send();
			}
		};
	}

	/** Jump to the anchored line (block link or heading), else to the entry itself. */
	private async jump(file: TFile, it: EcoItem): Promise<void> {
		if (it.link && it.link.indexOf("#") >= 0) {
			const sub = it.link.slice(it.link.indexOf("#"));
			await this.app.workspace.openLinkText(file.path + sub, file.path, false);
			return;
		}
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file, { eState: { line: it.line } });
	}
}

export class EcoTasksView extends ToolboxPanelView {
	getViewType(): string {
		return ECO_TASKS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Eco tasks";
	}

	getIcon(): string {
		return "message-square-plus";
	}

	protected createPanel(container: HTMLElement): ToolboxPanel {
		return new EcoTasksPanel(this.host, container);
	}
}
