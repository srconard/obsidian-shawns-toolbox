// top-tasks-view.ts — the "Top tasks" panel (2026-10-08, trusted-resurfacing
// Phase 1).
//
// Shows Shawn's top 7 open tasks from the NAS bridge (GET /tasks/top?limit=7),
// a side panel beside the Eco tasks panel — Shawn asked for the Top view as a
// panel, not a query in his daily note. Read-only: a click opens the task's
// note at its line; ticking stays on the line itself. Refreshes when shown,
// every few minutes while visible, and on the ↻ button. Offline it quietly
// shows the last good list (persisted in plugin data). Rules: top-tasks-core.ts.
import { TFile, requestUrl, setIcon } from "obsidian";
import { ToolboxPanel } from "./panel-base";
import { ToolboxPanelView } from "./panel-view";
import {
	offlineMessage,
	parseTopResponse,
	readCache,
	rowMarkers,
	sourceNote,
	stampLabel,
	topTasksUrl,
	withTimeout,
	TOP_LIMIT,
	TOP_REFRESH_MS,
	TOP_TIMEOUT_MS,
	type TopTask,
	type TopTasksCache,
} from "./top-tasks-core";

export const TOP_TASKS_VIEW_TYPE = "shawns-toolbox-top-tasks";

export class TopTasksPanel extends ToolboxPanel {
	private interval: number | null = null;
	private loading = false;
	private wasShown = false;
	/** null = never fetched this session; true/false = last attempt's outcome. */
	private online: boolean | null = null;

	protected onOpen(): void {
		this.contentEl.addClass("stx-top-tasks");
		this.render();
		// "Refresh when the panel is shown": sidebar tab switches and drawer
		// opens surface as layout/leaf changes — fetch on the hidden→shown edge.
		const onShowMaybe = (): void => {
			const shown = this.isShown();
			if (shown && !this.wasShown) void this.refresh();
			this.wasShown = shown;
		};
		this.registerEvent(this.app.workspace.on("layout-change", onShowMaybe));
		this.registerEvent(this.app.workspace.on("active-leaf-change", onShowMaybe));
		this.app.workspace.onLayoutReady(() => {
			this.wasShown = this.isShown();
			void this.refresh();
		});
		this.interval = window.setInterval(() => {
			if (this.isShown()) void this.refresh();
		}, TOP_REFRESH_MS);
	}

	protected onClose(): void {
		if (this.interval !== null) window.clearInterval(this.interval);
		this.interval = null;
	}

	private isShown(): boolean {
		const el = this.contentEl;
		return el.isConnected && el.offsetParent !== null;
	}

	private cache(): TopTasksCache | null {
		return readCache(this.host.getSettings().topTasksCache);
	}

	async refresh(): Promise<void> {
		if (this.loading) return;
		this.loading = true;
		this.render();
		const settings = this.host.getSettings();
		const headers: Record<string, string> = {};
		const token = (settings.bridgeToken ?? "").trim();
		if (token) headers["x-note-chat-token"] = token;
		try {
			// requestUrl, not fetch: Android's webview blocks plain-http XHR to
			// the NAS; requestUrl has no timeout of its own, hence withTimeout.
			const res = await withTimeout(
				requestUrl({ url: topTasksUrl(settings.vaultSearchUrl, TOP_LIMIT), method: "GET", headers, throw: false }),
				TOP_TIMEOUT_MS,
				"Top tasks"
			);
			if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
			let body: unknown;
			try {
				body = res.json;
			} catch {
				body = res.text;
			}
			const parsed = parseTopResponse(body, TOP_LIMIT);
			if (!parsed.ok) throw new Error(parsed.error);
			settings.topTasksCache = { savedAt: new Date().toISOString(), list: parsed.list };
			await this.host.saveSettings();
			this.online = true;
		} catch (e) {
			// Quiet by design: no Notice — the panel shows the offline line.
			console.debug("Shawn's Toolbox: Top tasks fetch failed", e);
			this.online = false;
		} finally {
			this.loading = false;
			this.render();
		}
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const head = el.createDiv({ cls: "stx-eco-head stx-top-head" });
		head.createSpan({ cls: "stx-eco-title", text: "Top tasks" });
		const cache = this.cache();
		const now = new Date();
		const meta = head.createSpan({ cls: "stx-eco-counts" });
		if (this.loading) meta.setText("refreshing…");
		else if (cache && this.online !== false) meta.setText(`as of ${stampLabel(cache.savedAt, now)}`);
		const btn = head.createEl("button", { cls: "clickable-icon stx-top-refresh", attr: { "aria-label": "Refresh top tasks" } });
		setIcon(btn, "refresh-cw");
		btn.disabled = this.loading;
		btn.onclick = () => void this.refresh();

		if (this.online === false) el.createDiv({ cls: "stx-top-offline", text: offlineMessage(cache, now) });
		if (!cache) {
			if (this.online !== false)
				el.createDiv({ cls: "stx-collapsed", text: this.loading ? "Loading top tasks…" : "No list yet — press ↻." });
			return;
		}
		const tasks = cache.list.tasks;
		if (!tasks.length) {
			el.createDiv({ cls: "stx-collapsed", text: "No open tasks rank right now." });
			return;
		}
		const list = el.createDiv({ cls: "stx-top-list" + (this.online === false ? " is-stale" : "") });
		for (const t of tasks) this.row(list, t);
		const { indexed, candidates } = cache.list;
		if (indexed !== null && candidates !== null)
			el.createDiv({ cls: "stx-top-foot", text: `from ${candidates} candidates · ${indexed} open tasks` });
	}

	private row(el: HTMLElement, t: TopTask): void {
		const row = el.createDiv({ cls: `stx-eco-item stx-top-item${t.overdue ? " is-overdue" : ""}` });
		const top = row.createDiv({ cls: "stx-eco-top" });
		const markers = rowMarkers(t);
		if (markers) top.createSpan({ cls: "stx-top-markers", text: markers });
		top.createSpan({ cls: "stx-eco-text", text: t.text });
		const meta = row.createDiv({ cls: "stx-eco-meta stx-top-meta" });
		meta.createSpan({ cls: "stx-top-note", text: sourceNote(t.path) });
		if (t.reason) meta.createSpan({ cls: "stx-top-reason", text: ` · ${t.reason}` });
		row.setAttr("title", `${t.path}:${t.line + 1}`);
		row.onclick = () => void this.jump(t);
	}

	/** Open the task's note at its line (read-only — no ticking here). */
	private async jump(t: TopTask): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(t.path);
		if (file instanceof TFile) {
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file, { eState: { line: t.line } });
			return;
		}
		await this.app.workspace.openLinkText(t.path.replace(/\.md$/i, ""), "", false);
	}
}

export class TopTasksView extends ToolboxPanelView {
	getViewType(): string {
		return TOP_TASKS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Top tasks";
	}

	getIcon(): string {
		return "list-ordered";
	}

	protected createPanel(container: HTMLElement): ToolboxPanel {
		return new TopTasksPanel(this.host, container);
	}
}
