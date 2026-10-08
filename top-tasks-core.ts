// top-tasks-core.ts — the "Top tasks" panel's rules, as pure functions
// (2026-10-08, trusted-resurfacing Phase 1).
//
// The panel shows Shawn's top 7 open tasks, ranked by the NAS bridge's
// GET /tasks/top?limit=7. Shawn asked (2026-10-08) for the Top view as a SIDE
// PANEL, not a query in his daily note. Since 1.60.0 (Shawn, voice 2026-10-08
// 13:48: "there are no checkboxes… I want to be able to check off the tasks")
// each row has a checkbox that ticks the line through the bridge's
// POST /tasks/toggle — the same endpoint the Eco phone app and eco-web use, so
// 🔁 recurrence and the stale-line check live in one place. Everything here is defensive — the bridge is a separate,
// evolving service, so missing or extra fields must never crash the panel.
// Design: vault AGENTS/dev/minimum-viable-echo/docs/2026-10-08
// trusted-resurfacing-design-draft.md §2.4 view 1 + Part 5.

export type TopPriority = "highest" | "high" | "medium" | "low" | "lowest";

export interface TopTask {
	id: string;
	/** Display text (the bridge strips tags/emoji/fields). */
	text: string;
	/** The task line verbatim. */
	raw: string;
	/** Vault-relative path of the note holding the task. */
	path: string;
	/** 0-based line number. */
	line: number;
	source: string | null;
	priority: TopPriority | null;
	overdue: boolean;
	scheduled: string | null;
	due: string | null;
	/** Why it ranks, e.g. "🔺 highest · rank 2". */
	reason: string;
	/** A 🔁 task — ticking it adds the next instance above the line. */
	recurring: boolean;
}

export interface TopList {
	generatedAt: string | null;
	today: string | null;
	indexed: number | null;
	candidates: number | null;
	tasks: TopTask[];
}

/** Last good list, persisted in plugin data for the offline fallback. */
export interface TopTasksCache {
	/** ISO time the list was fetched. */
	savedAt: string;
	list: TopList;
}

export type ParseResult = { ok: true; list: TopList } | { ok: false; error: string };

export const TOP_LIMIT = 7;
export const TOP_TIMEOUT_MS = 6000;
export const TOP_REFRESH_MS = 5 * 60 * 1000;

export const PRIORITY_EMOJI: Record<TopPriority, string> = {
	highest: "🔺",
	high: "⏫",
	medium: "🔼",
	low: "🔽",
	lowest: "⏬",
};

export const OVERDUE_EMOJI = "⏳";

function str(v: unknown): string | null {
	return typeof v === "string" ? v : null;
}

function num(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function normPriority(v: unknown, emoji: unknown): TopPriority | null {
	if (typeof v === "string") {
		const p = v.trim().toLowerCase();
		if (p in PRIORITY_EMOJI) return p as TopPriority;
	}
	if (typeof emoji === "string") {
		for (const name of Object.keys(PRIORITY_EMOJI) as TopPriority[]) {
			if (emoji.trim() === PRIORITY_EMOJI[name]) return name;
		}
	}
	return null;
}

/** Fallback display text when the bridge sent only `raw`. */
export function stripTaskLine(raw: string): string {
	return raw
		.replace(/^\s*[-*+]\s+\[.\]\s*/, "")
		.replace(/(^|\s)#[^\s#]+/g, " ")
		.replace(/[🔺⏫🔼🔽⏬]️?/gu, " ")
		.replace(/[⏳📅🛫➕✅❌🔁]️?\s*\d{4}-\d{2}-\d{2}/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Normalise one task object; null when it has no path to jump to. */
export function normaliseTask(v: unknown, index = 0): TopTask | null {
	if (!isRecord(v)) return null;
	const path = str(v.path)?.trim() ?? "";
	if (!path) return null;
	const raw = str(v.raw) ?? "";
	const text = (str(v.text) ?? "").trim() || stripTaskLine(raw) || "(empty task)";
	const lineN = num(v.line);
	const line = lineN !== null && lineN >= 0 ? Math.floor(lineN) : 0;
	const id = str(v.id) ?? (typeof v.id === "number" ? String(v.id) : `${path}:${line}:${index}`);
	return {
		id,
		text,
		raw,
		path,
		line,
		source: str(v.source),
		priority: normPriority(v.priority, v.priorityEmoji),
		overdue: v.overdue === true,
		scheduled: str(v.scheduled),
		due: str(v.due),
		reason: (str(v.reason) ?? "").trim(),
		recurring: (str(v.recurrence) ?? "").trim() !== "",
	};
}

/** Parse the bridge's /tasks/top JSON body (already decoded, or a string). */
export function parseTopResponse(body: unknown, limit = TOP_LIMIT): ParseResult {
	let data = body;
	if (typeof data === "string") {
		try {
			data = JSON.parse(data);
		} catch {
			return { ok: false, error: "Bridge sent a non-JSON reply" };
		}
	}
	if (!isRecord(data)) return { ok: false, error: "Bridge sent an empty reply" };
	if (data.ok === false) {
		return { ok: false, error: str(data.error) ?? "Bridge reported an error" };
	}
	if (!Array.isArray(data.tasks)) return { ok: false, error: "Bridge reply has no task list" };
	const tasks: TopTask[] = [];
	data.tasks.forEach((t, i) => {
		const n = normaliseTask(t, i);
		if (n) tasks.push(n);
	});
	return {
		ok: true,
		list: {
			generatedAt: str(data.generatedAt),
			today: str(data.today),
			indexed: num(data.indexed),
			candidates: num(data.candidates),
			tasks: tasks.slice(0, Math.max(0, limit)),
		},
	};
}

/** Restore a cache read back from plugin data; null when unusable. */
export function readCache(v: unknown): TopTasksCache | null {
	if (!isRecord(v)) return null;
	const savedAt = str(v.savedAt);
	if (!savedAt || Number.isNaN(Date.parse(savedAt))) return null;
	const parsed = parseTopResponse(isRecord(v.list) ? { ok: true, ...v.list } : null);
	if (!parsed.ok) return null;
	return { savedAt, list: parsed.list };
}

export function topTasksUrl(base: string, limit = TOP_LIMIT): string {
	return `${base.trim().replace(/\/+$/, "")}/tasks/top?limit=${limit}`;
}

export function priorityEmoji(t: TopTask): string {
	return t.priority ? PRIORITY_EMOJI[t.priority] : "";
}

/** Leading markers for a row: priority emoji, then ⏳ when overdue. */
export function rowMarkers(t: TopTask): string {
	return [priorityEmoji(t), t.overdue ? OVERDUE_EMOJI : ""].filter(Boolean).join(" ");
}

/** The row's main label: markers + task text. */
export function rowLabel(t: TopTask): string {
	const m = rowMarkers(t);
	return m ? `${m} ${t.text}` : t.text;
}

/** Basename of the task's note, without `.md`. */
export function sourceNote(path: string): string {
	const base = path.split("/").pop() ?? path;
	return base.replace(/\.md$/i, "");
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

function localDay(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "HH:MM" for a same-day time, "YYYY-MM-DD HH:MM" otherwise (local time). */
export function stampLabel(iso: string, now: Date): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "earlier";
	const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	return localDay(d) === localDay(now) ? hm : `${localDay(d)} ${hm}`;
}

/** The quiet offline line shown when the bridge can't be reached. */
export function offlineMessage(cache: TopTasksCache | null, now: Date): string {
	if (!cache) return "Bridge unreachable";
	return `Eco bridge unreachable — last list from ${stampLabel(cache.savedAt, now)}`;
}

/** Settle with `p`, or reject with a timeout error after `ms` — whichever is first. */
export function withTimeout<T>(p: Promise<T>, ms: number, what = "request"): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
		p.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			}
		);
	});
}

// ── Ticks (1.60.0, 2026-10-08) ──
// Mirrors eco-web's eco-core.mjs and the phone's src/topTasks.ts: optimistic
// tick (the row leaves at once), an Undo offered for TOP_TICK_UNDO_MS, a 409
// (the line changed in the note) is a Notice and a refetch.

/** How long the Undo stays offered after a tick. */
export const TOP_TICK_UNDO_MS = 6000;

export interface TopToggleBody {
	id: string;
	path: string;
	line: number;
	raw: string;
	done: boolean;
}

export function topToggleUrl(base: string): string {
	return `${base.trim().replace(/\/+$/, "")}/tasks/toggle`;
}

/** Can this row be ticked? The bridge must have sent the line's raw text. */
export function tickable(t: TopTask | null | undefined): boolean {
	return !!t && t.path !== "" && t.raw !== "";
}

export function toggleBody(t: TopTask, done = true): TopToggleBody {
	return { id: t.id, path: t.path, line: t.line, raw: t.raw, done: done !== false };
}

/** The undo body: the bridge reports where the ticked line sits NOW (a 🔁 tick inserts above it). */
export function undoBody(t: TopTask, resp: unknown): TopToggleBody {
	const r = isRecord(resp) ? resp : {};
	const line = num(r.line);
	return {
		id: t.id,
		path: str(r.path) || t.path,
		line: line !== null && Number.isInteger(line) ? line : t.line,
		raw: str(r.raw) || t.raw,
		done: false,
	};
}

/** The list with one task taken out (the optimistic tick). Never mutates. */
export function listWithout(list: TopList, id: string): TopList {
	const tasks = list.tasks.filter((t) => t.id !== id);
	if (tasks.length === list.tasks.length) return list;
	const candidates = list.candidates !== null ? Math.max(0, list.candidates - 1) : null;
	return { ...list, tasks, candidates };
}

/** The line shown with the Undo. */
export function tickDoneText(t: Pick<TopTask, "text">, resp: unknown): string {
	const text = t.text || "task";
	const short = text.length > 48 ? text.slice(0, 47) + "…" : text;
	const ins = isRecord(resp) && isRecord(resp.inserted) ? resp.inserted : null;
	const raw = ins ? str(ins.raw) ?? "" : "";
	const next = raw ? /📅️?\s*(\d{4}-\d{2}-\d{2})/u.exec(raw) || /⏳️?\s*(\d{4}-\d{2}-\d{2})/u.exec(raw) : null;
	return next ? `Done — ${short} · next 🔁 ${next[1]}` : `Done — ${short}`;
}

/** A failed toggle → the Notice text. `status` 0 = the bridge was unreachable. */
export function tickErrorText(status: number, body: unknown): string {
	const msg = isRecord(body) ? str(body.error) ?? "" : "";
	if (status === 409) return "That task changed in the note — refreshed the list.";
	if (status === 422) return msg || "Can’t tick that one here — tick it in Obsidian.";
	if (status === 0) return "Couldn’t reach the Eco bridge — the task was not ticked.";
	return "Couldn’t tick that task" + (msg ? `: ${msg}` : ".");
}
