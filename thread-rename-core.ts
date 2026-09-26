// thread-rename-core.ts — pure engine for "Rename / move thread…" (v1.52.0;
// Shawn 2026-09-26 08:20: "an option to long press on a thread to rename the
// entire thread tag and for every thread that has the tag"). No Obsidian
// imports; covered by tests/thread-rename-core.test.ts.
//
// A rename maps one thread path to another and carries its whole subtree:
// #thread/flow/movement → #thread/create/movement also turns
// #thread/flow/movement/sub into #thread/create/movement/sub. Membership is
// decided on whole path segments (isWithinThread), so #thread/flow never
// touches #thread/flowers. Only the tag token changes — the rest of the line
// (text, times, ^block-ids, ↩ [[note#^id]] reply links) is verbatim. Tags
// inside fenced code, inline code and the frontmatter block are left alone.
import { isWithinThread } from "./thread-tree-core";

// A #thread/<name> token: at line start or after whitespace, running over the
// whole tag alphabet, so the captured name is always the complete tag.
const TOKEN_SOURCE = "(^|\\s)#thread\\/([A-Za-z0-9_/-]+)";
// Characters a thread path segment may use (the same alphabet the panel reads).
const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
// A fence opener/closer: optional indent and blockquote markers, then ``` or ~~~.
const FENCE_RE = /^\s*(?:>\s*)*(`{3,}|~{3,})/;
// A plain list bullet in the Thread Areas note ("- name").
const AREA_BULLET_RE = /^([-*+]\s+)(.*\S)(\s*)$/;

function stripCr(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** Map one thread name through a rename, or null when it is not in the
 *  renamed subtree. "flow/sub" through flow → create/flow = "create/flow/sub". */
export function renameThreadName(name: string, from: string, to: string): string | null {
	// Literal whole-segment match: the tag's own spelling is what gets rewritten.
	if (name !== from && !name.startsWith(from + "/")) return null;
	return to + name.slice(from.length);
}

// ---- input validation ----

export type RenameInput = { ok: true; path: string } | { ok: false; error: string };

/**
 * Validate what was typed in the rename modal. The field is prefilled with
 * "thread/<current>"; a leading "#" and the "thread/" prefix are optional, so
 * "#thread/flow/dance", "thread/flow/dance" and "flow/dance" all mean the same
 * path. Rejects: empty, spaces, characters outside [A-Za-z0-9_-], empty path
 * segments (a//b, a leading or trailing /), no change, and moving a thread
 * inside itself (flow → flow/sub).
 */
export function parseRenameInput(raw: string, current: string): RenameInput {
	let t = raw.trim();
	if (/\s/.test(t)) return { ok: false, error: "A thread name can't contain spaces — use - or / instead." };
	if (t.startsWith("#")) t = t.slice(1);
	if (t === "thread" || t === "thread/") return { ok: false, error: "Enter a thread name after thread/." };
	if (t.startsWith("thread/")) t = t.slice("thread/".length);
	if (!t) return { ok: false, error: "Enter a thread name." };
	const segs = t.split("/");
	if (segs.some((s) => s.length === 0))
		return { ok: false, error: "Each part between / needs a name (no //, and no / at the start or end)." };
	const bad = segs.find((s) => !SEGMENT_RE.test(s));
	if (bad !== undefined)
		return { ok: false, error: `"${bad}" has characters a tag can't use — letters, digits, - and _ only.` };
	if (t === current) return { ok: false, error: "That's the current name — nothing to rename." };
	if (t.startsWith(current + "/"))
		return { ok: false, error: `Can't move #thread/${current} inside itself.` };
	return { ok: true, path: t };
}

// ---- scanning a note ----

/**
 * Per-line "may tags be rewritten here?" — false inside the leading
 * frontmatter block and inside fenced code blocks (fence lines included).
 */
export function editableLines(lines: string[]): boolean[] {
	const out: boolean[] = new Array(lines.length).fill(true);
	let i = 0;
	if (lines.length > 0 && stripCr(lines[0]).trim() === "---") {
		// Frontmatter only when it closes; an unclosed --- is just a rule.
		let end = -1;
		for (let j = 1; j < lines.length; j++) {
			const l = stripCr(lines[j]).trim();
			if (l === "---" || l === "...") {
				end = j;
				break;
			}
		}
		if (end > 0) {
			for (let j = 0; j <= end; j++) out[j] = false;
			i = end + 1;
		}
	}
	let fence: string | null = null; // the opening marker while inside a fence
	for (; i < lines.length; i++) {
		const m = FENCE_RE.exec(stripCr(lines[i]));
		if (fence === null) {
			if (m) {
				fence = m[1];
				out[i] = false;
			}
		} else {
			out[i] = false;
			if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
		}
	}
	return out;
}

/** [start, end) ranges of inline code spans (`x`, ``x``) on one line. */
function inlineCodeRanges(line: string): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	const re = /`+/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(line))) {
		const ticks = m[0];
		const close = line.indexOf(ticks, m.index + ticks.length);
		if (close < 0) continue;
		// The closer must be exactly as long (not part of a longer run).
		let end = close;
		while (line[end + ticks.length] === "`") {
			const next = line.indexOf(ticks, end + ticks.length + 1);
			if (next < 0) {
				end = -1;
				break;
			}
			end = next;
		}
		if (end < 0) continue;
		out.push([m.index, end + ticks.length]);
		re.lastIndex = end + ticks.length;
	}
	return out;
}

interface Token {
	/** Index of the "#". */
	start: number;
	/** Index just past the name. */
	end: number;
	name: string;
}

/** The #thread tokens on one (CR-stripped) line, outside inline code. */
function lineTokens(line: string): Token[] {
	const code = inlineCodeRanges(line);
	const re = new RegExp(TOKEN_SOURCE, "g");
	const out: Token[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(line))) {
		const start = m.index + m[1].length;
		if (code.some(([a, b]) => start >= a && start < b)) continue;
		out.push({ start, end: m.index + m[0].length, name: m[2] });
	}
	return out;
}

/** Every thread name tagged in a note (outside code/frontmatter), deduped. */
export function collectThreadNames(content: string): string[] {
	const lines = content.split("\n");
	const ok = editableLines(lines);
	const seen = new Set<string>();
	lines.forEach((raw, i) => {
		if (!ok[i]) return;
		for (const t of lineTokens(stripCr(raw))) seen.add(t.name);
	});
	return [...seen];
}

/** One rewritten line — enough to undo it exactly. */
export interface LineEdit {
	line: number;
	before: string;
	after: string;
	/** The line carried at least one descendant tag (#thread/from/…). */
	child: boolean;
}

/**
 * Rewrite one line. Every token inside the renamed subtree is mapped; when the
 * mapped tag is already on the line (a merge, or two tokens mapping to the
 * same name) the duplicate is dropped and its gap closed, so a merge never
 * leaves "#thread/y #thread/y". Returns null when nothing changes.
 */
export function renameLine(
	line: string,
	from: string,
	to: string
): { after: string; child: boolean } | null {
	const hadCr = line.endsWith("\r");
	const clean = stripCr(line);
	const tokens = lineTokens(clean);
	const mapped = tokens.map((t) => renameThreadName(t.name, from, to));
	if (mapped.every((m) => m === null)) return null;
	// Names that stay as they are claim their slot first.
	const present = new Set(tokens.filter((_, i) => mapped[i] === null).map((t) => t.name));
	let out = "";
	let cursor = 0;
	let child = false;
	const drops: number[] = []; // positions in `out` of dropped tokens
	tokens.forEach((t, i) => {
		const next = mapped[i];
		if (next === null) return;
		if (t.name !== from) child = true;
		out += clean.slice(cursor, t.start);
		if (present.has(next)) drops.push(out.length);
		else {
			present.add(next);
			out += "#thread/" + next;
		}
		cursor = t.end;
	});
	out += clean.slice(cursor);
	// Close the gaps left by dropped duplicates, right to left.
	for (let k = drops.length - 1; k >= 0; k--) {
		const at = drops[k];
		const leftRaw = out.slice(0, at);
		const left = leftRaw.replace(/[ \t]+$/, "");
		const right = out.slice(at).replace(/^[ \t]+/, "");
		if (left === "") out = leftRaw + right;
		else if (right === "") out = left;
		else out = `${left} ${right}`;
	}
	if (out === clean) return null;
	return { after: hadCr ? out + "\r" : out, child };
}

/** A note's rewritten content plus the per-line edits (empty = untouched). */
export interface ContentRename {
	content: string;
	edits: LineEdit[];
}

/** Rename a thread (and its subtree) across one note's content. */
export function renameInContent(content: string, from: string, to: string): ContentRename {
	if (content.indexOf("#thread/" + from) < 0) return { content, edits: [] };
	const lines = content.split("\n");
	const ok = editableLines(lines);
	const edits: LineEdit[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (!ok[i]) continue;
		const r = renameLine(lines[i], from, to);
		if (!r) continue;
		edits.push({ line: i, before: lines[i], after: r.after, child: r.child });
		lines[i] = r.after;
	}
	return edits.length ? { content: lines.join("\n"), edits } : { content, edits };
}

// ---- preview ----

export interface RenameCounts {
	/** Lines changed. */
	lines: number;
	/** Notes changed. */
	notes: number;
	/** Of `lines`, those that carried a child-thread tag. */
	childLines: number;
}

export function countEdits(files: Array<{ edits: LineEdit[] }>): RenameCounts {
	let lines = 0;
	let notes = 0;
	let childLines = 0;
	for (const f of files) {
		if (f.edits.length === 0) continue;
		notes++;
		lines += f.edits.length;
		childLines += f.edits.filter((e) => e.child).length;
	}
	return { lines, notes, childLines };
}

/**
 * Whether the rename lands on a thread that already exists outside the moved
 * subtree — the target itself, or any of its descendants, or an exact collision
 * of a moved name (flow/sub → y/sub when y/sub exists).
 */
export function mergesIntoExisting(existing: Iterable<string>, from: string, to: string): boolean {
	for (const e of existing) {
		if (renameThreadName(e, from, to) !== null) continue; // moving itself
		if (isWithinThread(e, to)) return true;
	}
	return false;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Rename #thread/x → #thread/y: N lines in M notes (includes K lines in child threads)". */
export function previewText(from: string, to: string, c: RenameCounts): string {
	let s = `Rename #thread/${from} → #thread/${to}: ${plural(c.lines, "line", "lines")} in ${plural(c.notes, "note", "notes")}`;
	if (c.childLines > 0) s += ` (includes ${plural(c.childLines, "line", "lines")} in child threads)`;
	return s;
}

export const MERGE_WARNING = "This merges into an existing thread.";

// ---- Thread Areas note + settings ----

/**
 * Rename a thread inside the Thread Areas mapping note, whose bullets name ROOT
 * threads ("- flow", "- #thread/flow" or "- [[flow]]"). A bullet in the renamed
 * subtree is rewritten in place (its wrapper kept). When a root moves under
 * another root (dance → flow/dance) the bullet is removed instead: a nested
 * thread follows its root's area. Other lines are verbatim.
 */
export function renameInAreasNote(content: string, from: string, to: string): string {
	const lines = content.split("\n");
	const out: string[] = [];
	for (const raw of lines) {
		const clean = stripCr(raw);
		const cr = raw.length !== clean.length ? "\r" : "";
		const m = AREA_BULLET_RE.exec(clean);
		if (!m) {
			out.push(raw);
			continue;
		}
		const body = m[2];
		const wrapped = /^(#thread\/|\[\[)?(.*?)(\]\])?$/.exec(body)!;
		const name = wrapped[2].trim();
		const next = renameThreadName(name, from, to);
		if (next === null) {
			out.push(raw);
			continue;
		}
		if (!name.includes("/") && next.includes("/")) continue; // root now nested
		out.push(`${m[1]}${wrapped[1] ?? ""}${next}${wrapped[3] ?? ""}${m[3]}${cr}`);
	}
	return out.join("\n");
}

/** Map a stored list of thread names (pins, collapsed nodes), deduped, order kept. */
export function renameNameList(names: readonly string[], from: string, to: string): string[] {
	const out: string[] = [];
	for (const n of names) {
		const next = renameThreadName(n, from, to) ?? n;
		if (!out.includes(next)) out.push(next);
	}
	return out;
}

// ---- undo ----

/**
 * Reverse a note's edits. Each edit is restored where its rewritten line still
 * sits; if the note shifted since, the nearest line still equal to the
 * rewritten text is used. A line that was changed again since the rename is
 * left alone and counted as missed — undo never overwrites newer work.
 */
export function undoInContent(
	content: string,
	edits: LineEdit[]
): { content: string; restored: number; missed: number } {
	const lines = content.split("\n");
	const used = new Set<number>();
	let restored = 0;
	let missed = 0;
	const same = (a: string, b: string) => stripCr(a) === stripCr(b);
	for (const e of edits) {
		let at = -1;
		if (e.line < lines.length && !used.has(e.line) && same(lines[e.line], e.after)) at = e.line;
		else {
			let best = Infinity;
			lines.forEach((l, i) => {
				if (used.has(i) || !same(l, e.after)) return;
				const d = Math.abs(i - e.line);
				if (d < best) {
					best = d;
					at = i;
				}
			});
		}
		if (at < 0) {
			missed++;
			continue;
		}
		used.add(at);
		const cr = lines[at].endsWith("\r") ? "\r" : "";
		lines[at] = stripCr(e.before) + cr;
		restored++;
	}
	return { content: restored ? lines.join("\n") : content, restored, missed };
}
