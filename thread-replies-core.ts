// thread-replies-core.ts — pure reply structure for the Threads panel
// (v1.51.0). No Obsidian imports; covered by tests/thread-replies-core.test.ts.
//
// A reply is ANY line carrying "↩ [[<note>#^<id>]]" back to a post — whether
// or not it also carries the thread tag. v1.51.0 shows a post's replies inside
// the post's own box (Shawn 2026-09-25: "add child thoughts to what is
// presented, maybe just in the same box"), and asks before applying a tag
// edit to them. Both need the full reply graph, which this module builds.
import { extractBlockId, extractPeriods, postDisplayText, targetKey } from "./thread-core";

/** A line that replies to a block. */
export interface ReplyPost {
	/** The first #thread/<name> on the line, or null (untagged reply). */
	thread: string | null;
	note: string;
	path: string;
	dateIso: string;
	line: number;
	time: string | null;
	text: string;
	blockId: string | null;
	replyTo: { note: string; blockId: string };
	periods: string[];
	raw: string;
}

/** A reply as rendered under its parent: the reply plus its own replies. */
export interface ReplyNode {
	reply: ReplyPost;
	children: ReplyNode[];
}

/** A top-level card: a post and the reply tree under it. */
export interface PostGroup<P> {
	post: P;
	replies: ReplyNode[];
	/** Every reply in the tree (all depths). */
	replyCount: number;
}

/** The minimum a post needs for reply lookups and ordering. */
export interface Addressable {
	note: string;
	path?: string;
	line: number;
	blockId: string | null;
	dateIso: string;
	time: string | null;
	replyTo?: { note: string; blockId: string } | null;
}

// "↩" then (optional whitespace) a block link. The arrow is what makes a line a
// reply; a bare [[note#^id]] block embed/link elsewhere in prose is not one.
const REPLY_RE = /↩\s*\[\[([^\]#|]+?)#\^([A-Za-z0-9]+)(?:\|[^\]]*)?\]\]/;
const THREAD_TAG_RE = /#thread\/([A-Za-z0-9_/-]+)/;
const LEADING_TIME_RE = /^\s*(?:[-*+]\s+)?(\d{1,2}:\d{2})\b/;

function stripCr(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** Parse one line into a ReplyPost, or null when it carries no ↩ link. */
export function parseReplyLine(
	line: string,
	note: string,
	dateIso: string,
	lineNo: number,
	path: string = note
): ReplyPost | null {
	const clean = stripCr(line);
	const m = REPLY_RE.exec(clean);
	if (!m) return null;
	const tag = THREAD_TAG_RE.exec(clean);
	const timeM = LEADING_TIME_RE.exec(clean);
	let time: string | null = null;
	if (timeM) {
		const [h, mm] = timeM[1].split(":");
		time = `${h.padStart(2, "0")}:${mm}`;
	}
	return {
		thread: tag ? tag[1] : null,
		note,
		path,
		dateIso,
		line: lineNo,
		time,
		text: postDisplayText(clean.replace(REPLY_RE, "")),
		blockId: extractBlockId(clean),
		replyTo: { note: m[1].trim(), blockId: m[2] },
		periods: extractPeriods(clean),
		raw: clean,
	};
}

/** Every reply line in a note's content. */
export function parseNoteReplies(
	note: string,
	dateIso: string,
	content: string,
	path: string = note
): ReplyPost[] {
	const out: ReplyPost[] = [];
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const r = parseReplyLine(lines[i], note, dateIso, i, path);
		if (r) out.push(r);
	}
	return out;
}

/** Identity of a line: its file and line number. */
export function lineKey(p: { path?: string; note: string; line: number }): string {
	return `${p.path ?? p.note}:${p.line}`;
}

function chrono(a: Addressable, b: Addressable): number {
	if (a.dateIso !== b.dateIso) return a.dateIso < b.dateIso ? -1 : 1;
	const at = a.time ?? "";
	const bt = b.time ?? "";
	if (at !== bt) return at < bt ? -1 : 1;
	return a.line - b.line;
}

/** Replies grouped by the block they reply to (targetKey), each list chronological. */
export function repliesByTarget(replies: ReplyPost[]): Map<string, ReplyPost[]> {
	const map = new Map<string, ReplyPost[]>();
	for (const r of replies) {
		const k = targetKey(r.replyTo.note, r.replyTo.blockId);
		const list = map.get(k);
		if (list) list.push(r);
		else map.set(k, [r]);
	}
	for (const list of map.values()) list.sort(chrono);
	return map;
}

/**
 * The reply tree under one post: its direct replies, their replies, and so
 * on. Cycle-safe (a line is never visited twice), chronological per level.
 */
export function replyTree(
	post: { note: string; blockId: string | null; path?: string; line: number },
	byTarget: Map<string, ReplyPost[]>,
	seen: Set<string> = new Set([lineKey(post)])
): ReplyNode[] {
	if (!post.blockId) return [];
	const direct = byTarget.get(targetKey(post.note, post.blockId)) ?? [];
	const out: ReplyNode[] = [];
	for (const r of direct) {
		const k = lineKey(r);
		if (seen.has(k)) continue;
		seen.add(k);
		out.push({ reply: r, children: replyTree(r, byTarget, seen) });
	}
	return out;
}

/** Flatten a reply tree depth-first (parents before children). */
export function flattenReplies(nodes: ReplyNode[]): ReplyPost[] {
	const out: ReplyPost[] = [];
	const walk = (ns: ReplyNode[]) => {
		for (const n of ns) {
			out.push(n.reply);
			walk(n.children);
		}
	};
	walk(nodes);
	return out;
}

/** Every reply under a post, all depths — the set "apply to its N replies" edits. */
export function descendantReplies(
	post: { note: string; blockId: string | null; path?: string; line: number },
	replies: ReplyPost[]
): ReplyPost[] {
	return flattenReplies(replyTree(post, repliesByTarget(replies)));
}

/**
 * Group a thread's visible posts into cards. Every post's reply tree is shown
 * under it. A visible post that already sits in ANOTHER visible post's reply
 * tree is not repeated as its own card. A post whose parent is not in view
 * stays a top-level card (the panel keeps its "↩ parent" preview). Two posts
 * that reply to each other (a cycle) both stay top-level rather than vanish.
 */
export function groupPostsWithReplies<P extends Addressable>(
	visible: P[],
	replies: ReplyPost[]
): PostGroup<P>[] {
	const byTarget = repliesByTarget(replies);
	const trees = visible.map((p) => replyTree(p, byTarget));
	const members = trees.map((t) => new Set(flattenReplies(t).map(lineKey)));
	const keys = visible.map(lineKey);
	const contained = (i: number): boolean =>
		members.some((m, j) => j !== i && m.has(keys[i]) && !members[i].has(keys[j]));
	const out: PostGroup<P>[] = [];
	visible.forEach((p, i) => {
		if (contained(i)) return;
		out.push({ post: p, replies: trees[i], replyCount: members[i].size });
	});
	return out;
}
