// top-tasks-core.ts — the "Top tasks" panel's rules, as pure functions
// (2026-10-08, trusted-resurfacing Phase 1).
//
// The panel shows Shawn's top 7 open tasks, ranked by the NAS bridge's
// GET /tasks/top?limit=7. Shawn asked (2026-10-08) for the Top view as a SIDE
// PANEL, not a query in his daily note. It is read-only: ticking stays on the
// task's own line. Everything here is defensive — the bridge is a separate,
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
