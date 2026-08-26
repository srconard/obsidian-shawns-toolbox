// threads-block.ts — pure engine for the ```threads code block. Parses the
// block's key:value body into a selection spec and, given the scanned thread +
// periodic posts, computes the grouped posts to render inline in a note. No
// Obsidian imports; covered by tests/threads-block.test.ts.
//
// The rendered content mirrors the Threads side panel; this module only decides
// *what* to show (which threads/cadences, filtered/limited), reusing thread-core
// for the actual post lookups.
import {
	threadPosts,
	periodicPosts,
	normalizeThreadName,
	THOUGHT_PERIODS,
	type ThreadPost,
	type PeriodicPost,
} from "./thread-core";

/** Parsed form of a ```threads block body. */
export interface ThreadsBlockSpec {
	/** #thread/<name> names to show (in the order written). */
	threads: string[];
	/** #thought/<period> cadences to show (in horizon order). */
	periods: string[];
	/** Case-insensitive substring the post text must contain, or null. */
	filter: string | null;
	/** Max posts per group (most recent kept), or null for all. */
	limit: number | null;
	/** Human-readable problems (unknown keys, bad limit) to surface to Shawn. */
	errors: string[];
}

/** A post as the block renders it — the common shape of a thread post and a
 *  periodic-thought post. */
export interface BlockPost {
	note: string;
	path: string;
	dateIso: string;
	line: number;
	time: string | null;
	text: string;
	/** The #thread name if the post carries one, else null (periodic thoughts). */
	thread: string | null;
}

/** One rendered group: a labelled run of posts (a thread, or a cadence). */
export interface BlockGroup {
	label: string;
	kind: "thread" | "period";
	key: string;
	posts: BlockPost[];
}

const PERIOD_SET = new Set<string>(THOUGHT_PERIODS);

function pushUnique(list: string[], value: string): void {
	if (value && !list.includes(value)) list.push(value);
}

/**
 * Parse a ```threads block body. Recognised keys (case-insensitive):
 *   thread / threads : #thread/<name> names (comma or one-per-line)
 *   tag / tags       : cadences (weekly|monthly|quarterly|yearly); a #thread/x
 *                      value here is accepted as a thread too
 *   filter / search  : substring the post text must contain
 *   limit            : max posts per group
 * A non-empty line without a colon is treated as a thread name (lenient). Lines
 * starting with // are comments.
 */
export function parseThreadsBlock(source: string): ThreadsBlockSpec {
	const spec: ThreadsBlockSpec = {
		threads: [],
		periods: [],
		filter: null,
		limit: null,
		errors: [],
	};
	for (const rawLine of source.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("//")) continue;
		const idx = line.indexOf(":");
		if (idx < 0) {
			pushUnique(spec.threads, normalizeThreadName(line));
			continue;
		}
		const key = line.slice(0, idx).trim().toLowerCase();
		const value = line.slice(idx + 1).trim();
		const values = value
			.split(",")
			.map((v) => v.trim())
			.filter((v) => v.length > 0);
		switch (key) {
			case "thread":
			case "threads":
				for (const v of values)
					pushUnique(spec.threads, normalizeThreadName(v));
				break;
			case "tag":
			case "tags":
				for (const v of values) classifyTag(v, spec);
				break;
			case "filter":
			case "search":
			case "contains":
				spec.filter = value || null;
				break;
			case "limit": {
				const n = Number(value);
				if (Number.isInteger(n) && n > 0) spec.limit = n;
				else spec.errors.push(`Invalid limit "${value}"`);
				break;
			}
			default:
				spec.errors.push(`Unknown key "${key}"`);
		}
	}
	// Keep cadences in horizon order regardless of how they were written.
	spec.periods = THOUGHT_PERIODS.filter((p) => spec.periods.includes(p));
	return spec;
}

/** Route a `tags:` value to a cadence or a thread name. */
function classifyTag(raw: string, spec: ThreadsBlockSpec): void {
	let v = raw.trim();
	if (v.startsWith("#thread/")) {
		pushUnique(spec.threads, normalizeThreadName(v.slice("#thread/".length)));
		return;
	}
	v = v.replace(/^#?thought\//, "").toLowerCase();
	if (PERIOD_SET.has(v)) {
		pushUnique(spec.periods, v);
		return;
	}
	spec.errors.push(`Unknown tag "${raw}" (expected weekly/monthly/quarterly/yearly or #thread/<name>)`);
}

/** Whether the spec selects nothing (an empty or comment-only block). */
export function isEmptySpec(spec: ThreadsBlockSpec): boolean {
	return spec.threads.length === 0 && spec.periods.length === 0;
}

function toBlockPost(p: ThreadPost | PeriodicPost): BlockPost {
	return {
		note: p.note,
		path: p.path,
		dateIso: p.dateIso,
		line: p.line,
		time: p.time,
		text: p.text,
		thread: p.thread,
	};
}

function applyLimit(posts: BlockPost[], limit: number | null): BlockPost[] {
	if (limit === null || posts.length <= limit) return posts;
	// Posts arrive chronological (oldest→newest); keep the most recent `limit`.
	return posts.slice(posts.length - limit);
}

/**
 * Build the groups the block renders from the scanned posts. One group per
 * selected thread (chronological), then one per selected cadence. The optional
 * filter is a case-insensitive substring on the post text; the optional limit
 * caps each group to its most recent N posts.
 */
export function selectBlockGroups(
	spec: ThreadsBlockSpec,
	posts: ThreadPost[],
	periodic: PeriodicPost[]
): BlockGroup[] {
	const needle = spec.filter ? spec.filter.toLowerCase() : null;
	const matches = (text: string) =>
		needle === null || text.toLowerCase().includes(needle);
	const groups: BlockGroup[] = [];
	for (const name of spec.threads) {
		const selected = threadPosts(posts, name)
			.filter((p) => matches(p.text))
			.map(toBlockPost);
		groups.push({
			label: `#thread/${name}`,
			kind: "thread",
			key: name,
			posts: applyLimit(selected, spec.limit),
		});
	}
	for (const period of spec.periods) {
		const selected = periodicPosts(periodic, period)
			.filter((p) => matches(p.text))
			.map(toBlockPost);
		groups.push({
			label: `${cap(period)} thoughts`,
			kind: "period",
			key: period,
			posts: applyLimit(selected, spec.limit),
		});
	}
	return groups;
}

const DAILY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The label for a post's source: a daily note shows its date, any other note
 *  its name; a time suffix is appended when present. */
export function blockSourceLabel(post: BlockPost): string {
	const base = DAILY_RE.test(post.note) ? post.dateIso : post.note;
	return post.time ? `${base} · ${post.time}` : base;
}

function cap(s: string): string {
	return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
