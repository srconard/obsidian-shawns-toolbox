// retag-core.ts — pure line edits for applying one tag change to a post AND
// (optionally) its replies (v1.51.0). No Obsidian imports; covered by
// tests/retag-core.test.ts.
//
// Shawn 2026-09-25: "then also have to deal with how a reply is handled when
// tags are edited". Decision 2026-09-26: ask "Also apply this to its N
// replies?" (default No); Yes applies the same add/remove to each reply's own
// line. Replies can live in other notes, so the service groups the targets by
// file and runs editTagInLines once per file.
import { appendTag, removeTag } from "./thread-core";

export type TagOp = "add" | "remove";

/** Where a target line was when it was scanned. */
export interface LineTarget {
	line: number;
	raw: string;
}

function stripCr(l: string): string {
	return l.endsWith("\r") ? l.slice(0, -1) : l;
}

/**
 * Find a scanned line in the current file: at its recorded number if the text
 * still matches, else the first line with the same text that is not already
 * claimed (an edit since the scan may have shifted lines). -1 when gone.
 */
export function locateLine(
	lines: string[],
	target: LineTarget,
	claimed: Set<number> = new Set()
): number {
	if (!claimed.has(target.line) && stripCr(lines[target.line] ?? "") === target.raw)
		return target.line;
	for (let i = 0; i < lines.length; i++) {
		if (claimed.has(i)) continue;
		if (stripCr(lines[i]) === target.raw) return i;
	}
	return -1;
}

/** Apply one tag op to a single line (appendTag / removeTag). A CRLF line
 *  keeps its \r (appendTag alone would drop it). */
export function applyTagOp(line: string, tag: string, op: TagOp): string {
	const next = op === "add" ? appendTag(line, tag) : removeTag(line, tag);
	if (next === line) return line;
	return line.endsWith("\r") && !next.endsWith("\r") ? `${next}\r` : next;
}

/**
 * Apply one tag op to several target lines of ONE file. Each target is located
 * independently (so two targets never resolve to the same line). Returns the
 * new lines, how many lines actually changed, and how many targets were not
 * found. Lines that already have (add) or lack (remove) the tag are no-ops.
 */
export function editTagInLines(
	lines: string[],
	targets: LineTarget[],
	tag: string,
	op: TagOp
): { lines: string[]; changed: number; missing: number } {
	const out = lines.slice();
	const claimed = new Set<number>();
	let changed = 0;
	let missing = 0;
	for (const t of targets) {
		const idx = locateLine(out, t, claimed);
		if (idx < 0) {
			missing++;
			continue;
		}
		claimed.add(idx);
		const next = applyTagOp(out[idx], tag, op);
		if (next !== out[idx]) {
			out[idx] = next;
			changed++;
		}
	}
	return { lines: out, changed, missing };
}

/** Group targets by their file path, keeping first-seen file order. */
export function groupByPath<T extends { path?: string; note: string }>(
	targets: T[]
): Map<string, T[]> {
	const map = new Map<string, T[]>();
	for (const t of targets) {
		const k = t.path ?? t.note;
		const list = map.get(k);
		if (list) list.push(t);
		else map.set(k, [t]);
	}
	return map;
}

/** The question asked before a tag change reaches a post's replies. */
export function repliesPrompt(count: number): string {
	return `Also apply this to its ${count} ${count === 1 ? "reply" : "replies"}?`;
}

/** The line under the question saying exactly what Yes would do. */
export function repliesPromptDetail(tag: string, op: TagOp): string {
	return op === "add"
		? `Yes adds ${tag} to each reply's own line. No changes only this post.`
		: `Yes removes ${tag} from each reply's own line. No changes only this post.`;
}
