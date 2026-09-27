// eco-tasks-core.ts — the "Eco tasks" panel's rules, as pure text functions
// (2026-09-27, J-0927-16).
//
// The Obsidian Eco plugin (0.3.0+) lets Shawn hover a line → 💬 → Comment or
// Eco task. That anchors the line with a block id (^eco-xxxxxx) and files an
// entry under a top-level heading at the bottom of the note:
//
//   # Eco tasks
//   - [ ] <task> [[note#^eco-xxxxxx|↑]] · 2026-09-27 12:40 #echo
//       - re: "<the anchored line's text>"
//   # Comments
//   - 2026-09-27 12:40 — <comment> [[note#^eco-xxxxxx|↑]]
//
// An Eco task is an ordinary `#echo` line, so the async echo watcher (voice-
// inbox) claims it, flips it to `[/]`, writes `> [!echo]` callouts under it and
// finally ticks it. This panel reads that lifecycle back for the ACTIVE note and
// lets Shawn answer a blocked task: the answer is written under the task (inside
// the subtree the worker reads) and `#echo/blocked` is removed so it re-runs.
// Design: vault AGENTS/dev/voice-bridge/docs/2026-09-27 obsidian-note-context-design.md §4.

export type EcoItemStatus =
	| "open"
	| "running"
	| "blocked"
	| "done"
	| "failed"
	| "heat"
	| "cancelled"
	| "comment";

export interface EcoItem {
	kind: "task" | "comment";
	status: EcoItemStatus;
	/** Display text: the entry without its ↑ link, timestamp and #echo tags. */
	text: string;
	/** 0-based line of the entry. */
	line: number;
	/** The entry line verbatim — the reply writer re-finds the task by it. */
	raw: string;
	/** Inside of `[[…|↑]]`, e.g. `2026-W40#^eco-k3f9x2`; null when absent. */
	link: string | null;
	stamp: string | null;
	/** The `re:` context line (the anchored line's text), tasks only. */
	context: string | null;
	/** Blocker question from the newest "needs your OK:" callout. */
	question: string | null;
	/** Text of the newest `> [!echo]` callout under the entry. */
	summary: string | null;
	/** Earlier answers written under the task (`- ↳ …`). */
	replies: string[];
}

export const ECO_TASKS_HEADING = "eco tasks";
export const COMMENTS_HEADING = "comments";

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const H1_RE = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const TASK_RE = /^(\s*)- \[(.)\]\s+(.*)$/;
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/;
const LINK_RE = /\[\[([^\]|]+)\|↑\]\]/;
const STAMP_RE = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/;
const CALLOUT_RE = /^\s*>\s*\[!echo\][-+]?\s*(.*)$/;
const CONTEXT_RE = /^\s*- re: "(.*)"\s*$/;
const REPLY_RE = /^\s*- ↳\s*(.*)$/;

function hasTag(body: string, tag: string): boolean {
	return (" " + body + " ").indexOf(" " + tag + " ") >= 0;
}

function indentOf(line: string): number {
	const m = /^\s*/.exec(line);
	return m ? m[0].replace(/\t/g, "    ").length : 0;
}

function codeFlags(lines: readonly string[]): boolean[] {
	const flags: boolean[] = [];
	let fence: string | null = null;
	for (const line of lines) {
		const m = FENCE_RE.exec(line);
		if (m) {
			const marker = m[1];
			if (fence === null) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
			flags.push(true);
			continue;
		}
		flags.push(fence !== null);
	}
	return flags;
}

/** The contiguous child lines under `line` (more indented, until a blank line). */
export function childRange(lines: readonly string[], line: number): { start: number; end: number } {
	const base = indentOf(lines[line]);
	let end = line + 1;
	while (end < lines.length && lines[end].trim() && indentOf(lines[end]) > base) end++;
	return { start: line + 1, end };
}

/** Entry text without the ↑ link, the `· stamp`, a leading `stamp —`, and #echo tags. */
export function displayText(body: string): string {
	return body
		.replace(LINK_RE, " ")
		.replace(/·\s*\d{4}-\d{2}-\d{2} \d{2}:\d{2}/, " ")
		.replace(/^\s*\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s*—\s*/, "")
		.split(/\s+/)
		.filter((t) => t && !/^#echo(\/\S*)?$/.test(t))
		.join(" ")
		.trim();
}

function taskStatus(statusChar: string, body: string): EcoItemStatus {
	if (statusChar === "x" || statusChar === "X") return "done";
	if (statusChar === "/") return "running";
	if (statusChar === "-") return "cancelled";
	if (hasTag(body, "#echo/blocked")) return "blocked";
	if (hasTag(body, "#echo/error")) return "failed";
	if (hasTag(body, "#echo/deferred-heat")) return "heat";
	return "open";
}

/** Every Eco task and comment in the note's `# Eco tasks` / `# Comments` sections. */
export function parseEcoItems(text: string): EcoItem[] {
	const lines = text.split(/\r?\n/);
	const code = codeFlags(lines);
	const items: EcoItem[] = [];
	let section: "task" | "comment" | null = null;
	for (let i = 0; i < lines.length; i++) {
		if (code[i]) continue;
		const h = H1_RE.exec(lines[i]);
		if (h) {
			const t = h[1].trim().toLowerCase();
			section = t === ECO_TASKS_HEADING ? "task" : t === COMMENTS_HEADING ? "comment" : null;
			continue;
		}
		if (!section) continue;
		const raw = lines[i];
		if (indentOf(raw) > 1) continue; // children are read with their parent
		const { start, end } = childRange(lines, i);
		const children = lines.slice(start, end);
		const callouts = children.map((c) => CALLOUT_RE.exec(c)).filter((m): m is RegExpExecArray => !!m).map((m) => m[1].trim());
		const summary = callouts.length ? callouts[0] : null;
		const ctx = children.map((c) => CONTEXT_RE.exec(c)).find((m) => !!m);
		const replies = children.map((c) => REPLY_RE.exec(c)).filter((m): m is RegExpExecArray => !!m).map((m) => m[1].trim());
		const task = TASK_RE.exec(raw);
		if (task && section === "task") {
			const body = task[3];
			const status = taskStatus(task[2], body);
			const blockedCallout = callouts.find((c) => /needs your OK:/i.test(c));
			const question =
				status === "blocked" && blockedCallout
					? blockedCallout.replace(/^.*?needs your OK:\s*/i, "").replace(/\s*⏸️?\s*$/, "").trim()
					: null;
			const link = LINK_RE.exec(body);
			const stamp = STAMP_RE.exec(body);
			items.push({
				kind: "task",
				status,
				text: displayText(body),
				line: i,
				raw,
				link: link ? link[1] : null,
				stamp: stamp ? stamp[1] : null,
				context: ctx ? ctx[1] : null,
				question,
				summary,
				replies,
			});
			i = end - 1;
			continue;
		}
		const bullet = BULLET_RE.exec(raw);
		if (bullet && section === "comment" && !task) {
			const body = bullet[2];
			const link = LINK_RE.exec(body);
			const stamp = STAMP_RE.exec(body);
			items.push({
				kind: "comment",
				status: "comment",
				text: displayText(body),
				line: i,
				raw,
				link: link ? link[1] : null,
				stamp: stamp ? stamp[1] : null,
				context: null,
				question: null,
				summary,
				replies,
			});
			i = end - 1;
		}
	}
	return items;
}

function pad(n: number): string {
	return n < 10 ? "0" + n : String(n);
}

export function stampOf(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type ReplyResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * Answer a blocked Eco task: write `- ↳ Shawn <stamp>: <answer>` at the end of
 * the task's contiguous child block (after the watcher's callouts, so the
 * re-run sees question and answer together) and remove `#echo/blocked` from
 * the task line so the watcher claims it again. The task is re-found by its
 * exact text; when it moved or changed, the write is refused rather than
 * guessed.
 */
export function replyToBlocked(text: string, line: number, expectedRaw: string, answer: string, now: Date): ReplyResult {
	const eol = text.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	let at = line;
	if (lines[at] !== expectedRaw) {
		const hits: number[] = [];
		lines.forEach((l, j) => {
			if (l === expectedRaw) hits.push(j);
		});
		if (hits.length !== 1) return { ok: false, error: "That task changed since the panel read it — refresh and try again." };
		at = hits[0];
	}
	const m = TASK_RE.exec(lines[at]);
	if (!m || !hasTag(m[3], "#echo/blocked")) return { ok: false, error: "That task is not blocked any more." };
	const clean = answer
		.replace(/\s+/g, " ")
		.split(" ")
		.filter((t) => t && !/^#echo(\/\S*)?$/.test(t))
		.join(" ")
		.trim();
	if (!clean) return { ok: false, error: "Type an answer first." };
	const { end } = childRange(lines, at);
	const indent = m[1];
	lines.splice(end, 0, `${indent}    - ↳ Shawn ${stampOf(now)}: ${clean}`);
	lines[at] = lines[at].replace(/[ \t]+#echo\/blocked(?=\s|$)/, "");
	return { ok: true, text: lines.join(eol) };
}

/** Counts for the panel header. */
export function statusCounts(items: readonly EcoItem[]): Record<EcoItemStatus, number> {
	const out: Record<EcoItemStatus, number> = {
		open: 0,
		running: 0,
		blocked: 0,
		done: 0,
		failed: 0,
		heat: 0,
		cancelled: 0,
		comment: 0,
	};
	for (const it of items) out[it.status]++;
	return out;
}

export const STATUS_LABELS: Record<EcoItemStatus, string> = {
	open: "open",
	running: "running",
	blocked: "blocked",
	done: "done",
	failed: "failed",
	heat: "waiting (heat)",
	cancelled: "cancelled",
	comment: "comment",
};
