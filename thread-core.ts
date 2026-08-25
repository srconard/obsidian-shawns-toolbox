// thread-core.ts — pure engine for the Threads panel. No Obsidian imports;
// fully covered by tests/thread-core.test.ts.
//
// A "post" is any line in a daily note carrying a #thread/<name> tag. Daily
// notes stay the single source of truth — this module only reads their text
// and computes the thread/reply structure the panel renders.

/** A single tagged line, resolved into structured form. */
export interface ThreadPost {
	/** Thread name from the #thread/<name> tag (first one on the line). */
	thread: string;
	/** Basename of the source daily note (no path, no .md), e.g. "2026-08-25". */
	note: string;
	/** The note's date (YYYY-MM-DD) — used as the timestamp fallback. */
	dateIso: string;
	/** Zero-based line number of the post in its note. */
	line: number;
	/** "HH:MM" prefix on the line if present, else null. */
	time: string | null;
	/** Display text: the line with the leading bullet/time and the tag/reply
	 *  markup stripped, so the panel shows just what Shawn wrote. */
	text: string;
	/** Block id on this line (without the caret), e.g. "t3f9", or null. */
	blockId: string | null;
	/** If this post replies to a block, the target note + block id. */
	replyTo: { note: string; blockId: string } | null;
	/** The raw line as written (for edits that append a block id). */
	raw: string;
}

/** An aggregated thread for the list view. */
export interface ThreadSummary {
	name: string;
	postCount: number;
	/** Most recent post's dateIso (YYYY-MM-DD). */
	lastActiveDate: string;
	/** Most recent post's time within lastActiveDate, or null. */
	lastActiveTime: string | null;
}

// #thread/<name> — name is word-ish (letters, digits, dash, underscore, slash
// for sub-tags). We capture up to the first whitespace or a trailing marker.
const THREAD_TAG_RE = /#thread\/([A-Za-z0-9_/-]+)/;
// A block link: [[<note>#^<id>]] (note may contain spaces; id is ASCII word).
const REPLY_LINK_RE = /\[\[([^\]#|]+?)#\^([A-Za-z0-9]+)\]\]/;
// A trailing block id: " ^id" at end of line.
const BLOCK_ID_RE = /\s\^([A-Za-z0-9]+)\s*$/;
// A leading time: "- HH:MM " or "HH:MM " (with optional bullet marker).
const LEADING_TIME_RE = /^\s*(?:[-*+]\s+)?(\d{1,2}:\d{2})\b/;

function stripCr(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** Extract the trailing block id (without caret) from a line, or null. */
export function extractBlockId(line: string): string | null {
	const m = BLOCK_ID_RE.exec(stripCr(line));
	return m ? m[1] : null;
}

/**
 * Build the visible text for a post: drop the leading bullet + time, the
 * #thread/<name> tag, the ↩ marker, the reply link, and the trailing block id.
 * Collapses the leftover whitespace.
 */
export function postDisplayText(line: string): string {
	let t = stripCr(line);
	t = t.replace(BLOCK_ID_RE, "");
	t = t.replace(REPLY_LINK_RE, "");
	t = t.replace(THREAD_TAG_RE, "");
	// leading list marker + time prefix
	t = t.replace(/^\s*(?:[-*+]\s+)?/, "");
	t = t.replace(/^(\d{1,2}:\d{2})\s+/, "");
	// leftover reply arrow(s)
	t = t.replace(/↩/g, "");
	return t.replace(/\s{2,}/g, " ").trim();
}

/** Parse one line into a ThreadPost, or null if it carries no #thread tag. */
export function parsePostLine(
	line: string,
	note: string,
	dateIso: string,
	lineNo: number
): ThreadPost | null {
	const clean = stripCr(line);
	const tag = THREAD_TAG_RE.exec(clean);
	if (!tag) return null;
	const timeM = LEADING_TIME_RE.exec(clean);
	const reply = REPLY_LINK_RE.exec(clean);
	return {
		thread: tag[1],
		note,
		dateIso,
		line: lineNo,
		time: timeM ? normalizeTime(timeM[1]) : null,
		text: postDisplayText(clean),
		blockId: extractBlockId(clean),
		replyTo: reply
			? { note: reply[1].trim(), blockId: reply[2] }
			: null,
		raw: clean,
	};
}

function normalizeTime(hm: string): string {
	const [h, m] = hm.split(":");
	return `${h.padStart(2, "0")}:${m}`;
}

/** Parse every #thread post in a daily note's content. */
export function parseNotePosts(
	note: string,
	dateIso: string,
	content: string
): ThreadPost[] {
	const posts: ThreadPost[] = [];
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const p = parsePostLine(lines[i], note, dateIso, i);
		if (p) posts.push(p);
	}
	return posts;
}

/** Chronological sort key: date, then time (untimed sorts before timed on the
 *  same day), then line order. */
function postOrder(a: ThreadPost, b: ThreadPost): number {
	if (a.dateIso !== b.dateIso) return a.dateIso < b.dateIso ? -1 : 1;
	const at = a.time ?? "";
	const bt = b.time ?? "";
	if (at !== bt) return at < bt ? -1 : 1;
	return a.line - b.line;
}

/** All posts of one thread, sorted chronologically. */
export function threadPosts(
	posts: ThreadPost[],
	thread: string
): ThreadPost[] {
	return posts.filter((p) => p.thread === thread).sort(postOrder);
}

/**
 * Summaries for the thread-list view, sorted by last-active (most recent
 * first). Ties broken by name for stability.
 */
export function summarizeThreads(posts: ThreadPost[]): ThreadSummary[] {
	const byName = new Map<string, ThreadPost[]>();
	for (const p of posts) {
		const list = byName.get(p.thread);
		if (list) list.push(p);
		else byName.set(p.thread, [p]);
	}
	const out: ThreadSummary[] = [];
	for (const [name, list] of byName) {
		const sorted = list.slice().sort(postOrder);
		const last = sorted[sorted.length - 1];
		out.push({
			name,
			postCount: list.length,
			lastActiveDate: last.dateIso,
			lastActiveTime: last.time,
		});
	}
	out.sort((a, b) => {
		if (a.lastActiveDate !== b.lastActiveDate)
			return a.lastActiveDate < b.lastActiveDate ? 1 : -1;
		const at = a.lastActiveTime ?? "";
		const bt = b.lastActiveTime ?? "";
		if (at !== bt) return at < bt ? 1 : -1;
		return a.name < b.name ? -1 : 1;
	});
	return out;
}

/**
 * Count replies per parent, keyed by "<note>::<blockId>". A post counts toward
 * its replyTo target regardless of thread, so cross-thread replies still show.
 */
export function replyCounts(posts: ThreadPost[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const p of posts) {
		if (!p.replyTo) continue;
		const key = targetKey(p.replyTo.note, p.replyTo.blockId);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

/** The stable key identifying a reply target (a note + block id pair). */
export function targetKey(note: string, blockId: string): string {
	return `${note}::${blockId}`;
}

/** Index posts by their own (note, blockId) so a reply can resolve its parent. */
export function indexByBlock(posts: ThreadPost[]): Map<string, ThreadPost> {
	const idx = new Map<string, ThreadPost>();
	for (const p of posts) {
		if (p.blockId) idx.set(targetKey(p.note, p.blockId), p);
	}
	return idx;
}

// ---- block ids ----

/** A fresh block id (without the caret): "t" + base36, ASCII only. */
export function generateBlockId(rng: () => number = Math.random): string {
	const suffix = Math.floor(rng() * 0x7fffffff)
		.toString(36)
		.slice(0, 6);
	return "t" + (suffix || "0");
}

/**
 * Ensure a line ends with a block id. If it already has one, return it
 * unchanged; otherwise append " ^<id>" (trimming trailing whitespace first).
 */
export function ensureBlockId(
	line: string,
	id: string
): { line: string; id: string; changed: boolean } {
	const existing = extractBlockId(line);
	if (existing) return { line, id: existing, changed: false };
	const trimmed = stripCr(line).replace(/\s+$/, "");
	return { line: `${trimmed} ^${id}`, id, changed: true };
}

// ---- tag append (long-press / right-click "add a tag to this post") ----

/** The periodic-thought cadence tags, in horizon order (SOP §3). */
export const THOUGHT_PERIODS = ["weekly", "monthly", "quarterly", "yearly"] as const;

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether a line already carries a tag as a whole token (so "#thread/focus"
 * does not match inside "#thread/focus-practice"). Used to make tag-append a
 * no-op when the exact tag is already present.
 */
export function hasTag(line: string, tag: string): boolean {
	const re = new RegExp(`(?:^|\\s)${escapeRe(tag)}(?=\\s|$)`);
	return re.test(stripCr(line));
}

/**
 * Append a tag to a post's source line, single-space separated, preserving the
 * line otherwise verbatim. No-op (returns the line unchanged) if the exact tag
 * is already present. If the line ends with a block id (" ^id"), the tag is
 * inserted just before it so the block id stays at line-end — otherwise the
 * `^id` would stop being a block id and any reply link to it would break.
 */
export function appendTag(line: string, tag: string): string {
	const clean = stripCr(line);
	if (hasTag(clean, tag)) return line;
	const block = BLOCK_ID_RE.exec(clean);
	if (block) {
		const head = clean.slice(0, block.index).replace(/\s+$/, "");
		const tail = clean.slice(block.index); // " ^id" (+ any trailing space)
		return `${head} ${tag}${tail}`;
	}
	return `${clean.replace(/\s+$/, "")} ${tag}`;
}

/**
 * Build the reply line appended to today's daily note under # Thoughts:
 * "- HH:MM <text> #thread/<name> ↩ [[<parentNote>#^<id>]]".
 */
export function formatReplyLine(
	hm: string,
	text: string,
	thread: string,
	parentNote: string,
	parentId: string
): string {
	const body = text.replace(/\r?\n/g, " ").trim();
	return `- ${hm} ${body} #thread/${thread} ↩ [[${parentNote}#^${parentId}]]`;
}
