// top-tasks-view.ts — the "Top tasks" panel (2026-10-08, trusted-resurfacing
// Phase 1).
//
// Shows Shawn's top 7 open tasks from the NAS bridge (GET /tasks/top?limit=7),
// a side panel beside the Eco tasks panel — Shawn asked for the Top view as a
// panel, not a query in his daily note. A click on the text opens the task's
// note at its line; the checkbox (1.60.0) ticks the line through the bridge's
// POST /tasks/toggle, with a short Undo. Refreshes when shown,
// every few minutes while visible, and on the ↻ button. Offline it quietly
// shows the last good list (persisted in plugin data). Rules: top-tasks-core.ts.
import { Menu, Notice, TFile, requestUrl, setIcon } from "obsidian";
import { ToolboxPanel } from "./panel-base";
import { ToolboxPanelView } from "./panel-view";
import {
	CONFIRM_LABEL,
	UNCONFIRMED_HINT,
	UNCONFIRMED_LABEL,
	confirmBody,
	confirmErrorText,
	confirmable,
	listConfirmed,
	topConfirmUrl,
	type TopConfirmBody,
	listWithout,
	offlineMessage,
	parseTopResponse,
	tickDoneText,
	tickErrorText,
	tickable,
	toggleBody,
	topToggleUrl,
	undoBody,
	TOP_TICK_UNDO_MS,
	type TopToggleBody,
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
	/** The last tick while its Undo is offered. */
	private lastTick: { task: TopTask; resp: unknown } | null = null;
	private undoTimer: number | null = null;

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
		if (this.undoTimer !== null) window.clearTimeout(this.undoTimer);
		this.undoTimer = null;
	}

	/** POST /tasks/toggle. Never throws: status 200 = ok, 0 = unreachable. */
	private async postToggle(body: TopToggleBody): Promise<{ status: number; body: unknown }> {
		return this.postJson(topToggleUrl(this.host.getSettings().vaultSearchUrl), body, "Tick");
	}

	/** "Still high" (1.61.0): POST /tasks/confirm — a dated record, no line edit. */
	private async confirm(t: TopTask): Promise<void> {
		if (!confirmable(t)) return;
		const settings = this.host.getSettings();
		const before = this.cache();
		if (before) settings.topTasksCache = { ...before, list: listConfirmed(before.list, t.id) };
		this.render();
		const r = await this.postJson(topConfirmUrl(settings.vaultSearchUrl), confirmBody(t), "Confirm");
		if (r.status !== 200) {
			if (before) settings.topTasksCache = before;
			new Notice(confirmErrorText(r.status, r.body));
			this.render();
		}
		void this.refresh();
	}

	private offerConfirm(e: MouseEvent, t: TopTask): void {
		e.preventDefault();
		e.stopPropagation();
		const menu = new Menu();
		menu.addItem((i) => i.setTitle(CONFIRM_LABEL).setIcon("check").onClick(() => void this.confirm(t)));
		menu.showAtMouseEvent(e);
	}

	/** POST JSON to the bridge. Never throws: status 200 = ok, 0 = unreachable. */
	private async postJson(url: string, body: TopToggleBody | TopConfirmBody, what: string): Promise<{ status: number; body: unknown }> {
		const settings = this.host.getSettings();
		const headers: Record<string, string> = { "content-type": "application/json" };
		const token = (settings.bridgeToken ?? "").trim();
		if (token) headers["x-note-chat-token"] = token;
		try {
			const res = await withTimeout(
				requestUrl({ url, method: "POST", headers, body: JSON.stringify(body), throw: false }),
				TOP_TIMEOUT_MS,
				what
			);
			let json: unknown = null;
			try {
				json = res.json;
			} catch {
				json = null;
			}
			const ok = res.status >= 200 && res.status < 300 && !(json && typeof json === "object" && (json as { ok?: unknown }).ok === false);
			return { status: ok ? 200 : res.status || 500, body: json };
		} catch {
			return { status: 0, body: null };
		}
	}

	/** Optimistic tick: the row leaves at once; Undo for a few seconds; a 409 refetches. */
	private async tick(t: TopTask): Promise<void> {
		if (!tickable(t)) return;
		const settings = this.host.getSettings();
		const before = this.cache();
		if (before) settings.topTasksCache = { ...before, list: listWithout(before.list, t.id) };
		this.lastTick = null;
		this.render();
		const r = await this.postToggle(toggleBody(t, true));
		if (r.status !== 200) {
			if (before) settings.topTasksCache = before;
			new Notice(tickErrorText(r.status, r.body));
			this.render();
			void this.refresh();
			return;
		}
		await this.host.saveSettings();
		this.lastTick = { task: t, resp: r.body };
		if (this.undoTimer !== null) window.clearTimeout(this.undoTimer);
		this.undoTimer = window.setTimeout(() => {
			this.lastTick = null;
			this.undoTimer = null;
			this.render();
			void this.refresh();
		}, TOP_TICK_UNDO_MS);
		this.render();
	}

	private async undo(): Promise<void> {
		const tick = this.lastTick;
		if (!tick) return;
		this.lastTick = null;
		if (this.undoTimer !== null) window.clearTimeout(this.undoTimer);
		this.undoTimer = null;
		this.render();
		const r = await this.postToggle(undoBody(tick.task, tick.resp));
		if (r.status !== 200) new Notice(tickErrorText(r.status, r.body));
		void this.refresh();
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

		if (this.lastTick) {
			const bar = el.createDiv({ cls: "stx-top-undo" });
			bar.createSpan({ text: tickDoneText(this.lastTick.task, this.lastTick.resp) });
			const undo = bar.createEl("button", { text: "Undo" });
			undo.onclick = () => void this.undo();
		}
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
		const box = top.createEl("input", { cls: "task-list-item-checkbox stx-top-check", type: "checkbox" });
		box.disabled = !tickable(t) || this.online === false;
		box.setAttr("aria-label", t.recurring ? "Done — adds the next 🔁 instance above it" : "Done");
		box.onclick = (e) => e.stopPropagation();
		box.onchange = () => {
			if (box.checked) void this.tick(t);
		};
		const markers = rowMarkers(t);
		if (markers) top.createSpan({ cls: "stx-top-markers", text: markers });
		top.createSpan({ cls: "stx-eco-text", text: t.text });
		if (confirmable(t)) {
			const chip = top.createEl("button", { cls: "stx-top-unconf", text: UNCONFIRMED_LABEL, attr: { "aria-label": UNCONFIRMED_HINT, title: UNCONFIRMED_HINT } });
			chip.disabled = this.online === false;
			chip.onclick = (e) => this.offerConfirm(e, t);
			chip.oncontextmenu = (e) => this.offerConfirm(e, t);
		}
		const meta = row.createDiv({ cls: "stx-eco-meta stx-top-meta" });
		meta.createSpan({ cls: "stx-top-note", text: sourceNote(t.path) });
		if (t.reason) meta.createSpan({ cls: "stx-top-reason", text: ` · ${t.reason}` });
		row.setAttr("title", `${t.path}:${t.line + 1}`);
		row.onclick = () => void this.jump(t);
	}

	/** Open the task's note at its line. */
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
