// thread-tiles-core.ts — pure logic for the Threads panel's drill-down "tiles"
// mode (v1.56.0). No Obsidian imports; covered by tests/thread-tiles-core.test.ts.
//
// Shawn, 2026-09-26 12:55: "a different view mode where it just shows the root
// thread categories as big wide buttons … you can click on each and it will
// show everything at the next level, and maybe at the top you can click show
// all threads contained at and below this level." The tree engine
// (thread-tree-core.ts) already rolls counts and recency up the tree; this
// module turns a node into a tile's subline, a drill path into a breadcrumb,
// and a subtree into the flat "show all" list.
import { postOrder } from "./thread-core";
import {
	canonicalThreadName,
	findNode,
	isWithinThread,
	threadSegments,
	type ThreadNode,
	type TreeAreaGroup,
} from "./thread-tree-core";

export type ThreadsViewMode = "tree" | "tiles";

/** The persisted mode, defaulting anything unknown to the tree. */
export function normalizeViewMode(v: unknown): ThreadsViewMode {
	return v === "tiles" ? "tiles" : "tree";
}

/**
 * The top-level tiles: every root, in the order the tree shows them (area
 * order, then pinned-first / most-recent within an area). A root appears once
 * even if a malformed grouping listed it twice.
 */
export function tileRoots(groups: TreeAreaGroup[]): ThreadNode[] {
	const seen = new Set<string>();
	const out: ThreadNode[] = [];
	for (const g of groups)
		for (const r of g.roots)
			if (!seen.has(r.name)) {
				seen.add(r.name);
				out.push(r);
			}
	return out;
}

/** What a tile's subline says, as data (the view joins it with " · "). */
export interface TileStats {
	/** Posts in the whole subtree (the node's roll-up). */
	totalPosts: number;
	/** Direct child threads. */
	childCount: number;
	/** "YYYY-MM-DD" or "YYYY-MM-DD HH:MM", "" if the subtree has no posts. */
	lastActive: string;
	/** Posts tagged exactly at this node — shown as "N here" under the same
	 *  rule as the tree row: only when the node has children and its own count
	 *  differs from the roll-up. null = not shown. */
	here: number | null;
}

export function tileStats(node: ThreadNode): TileStats {
	const hasKids = node.children.length > 0;
	return {
		totalPosts: node.totalCount,
		childCount: node.children.length,
		lastActive: node.lastActiveTime
			? `${node.lastActiveDate} ${node.lastActiveTime}`
			: node.lastActiveDate,
		here: hasKids && node.ownCount !== node.totalCount ? node.ownCount : null,
	};
}

/** The subline parts in display order, e.g. ["12 posts", "3 threads",
 *  "2026-09-24 08:10", "2 here"]. Zero-child and no-date parts are omitted. */
export function tileSublineParts(stats: TileStats): string[] {
	const parts = [`${stats.totalPosts} post${stats.totalPosts === 1 ? "" : "s"}`];
	if (stats.childCount > 0)
		parts.push(`${stats.childCount} thread${stats.childCount === 1 ? "" : "s"}`);
	if (stats.lastActive) parts.push(stats.lastActive);
	if (stats.here !== null) parts.push(`${stats.here} here`);
	return parts;
}

/** One crumb: the top level ("Threads", name null) or a node on the path. */
export interface Crumb {
	label: string;
	/** Full thread name to drill to, or null for the top level. */
	name: string | null;
}

/** "flow/movement" → Threads › flow › movement, each crumb carrying the full
 *  path it leads to. The top level is always the first crumb. */
export function breadcrumb(path: string | null, rootLabel = "Threads"): Crumb[] {
	const crumbs: Crumb[] = [{ label: rootLabel, name: null }];
	const segs = threadSegments(path ?? "");
	for (let i = 0; i < segs.length; i++)
		crumbs.push({ label: segs[i], name: segs.slice(0, i + 1).join("/") });
	return crumbs;
}

/** One level up: "flow/movement" → "flow", "flow" → null (the top level). */
export function parentPath(path: string | null): string | null {
	const segs = threadSegments(path ?? "");
	return segs.length <= 1 ? null : segs.slice(0, -1).join("/");
}

/**
 * The drill path that still exists in the tree. A remembered path whose node
 * disappeared (renamed, retagged, deleted) falls back to its deepest existing
 * ancestor, and to the top level (null) when nothing on it survives.
 */
export function resolveDrillPath(
	roots: ThreadNode[],
	path: string | null | undefined
): string | null {
	const segs = threadSegments(path ?? "");
	for (let n = segs.length; n >= 1; n--) {
		const candidate = segs.slice(0, n).join("/");
		if (findNode(roots, candidate)) return candidate;
	}
	return null;
}

/** The thread path of `postThread` below `node`, as segments: [] for a post
 *  tagged exactly at the node, ["movement", "dance"] for flow/movement/dance
 *  under flow. null when the post is not in the node's subtree. */
export function relativeThreadSegments(postThread: string, node: string): string[] | null {
	if (!isWithinThread(postThread, node)) return null;
	const n = threadSegments(node).length;
	return threadSegments(postThread).slice(n);
}

/** A show-all label: "this level" for a post at the node itself, else the
 *  sub-thread path joined with " › ". */
export function subPathLabel(postThread: string, node: string, sep = " › "): string {
	const rel = relativeThreadSegments(postThread, node);
	if (rel === null) return canonicalThreadName(postThread);
	return rel.length === 0 ? "this level" : rel.join(sep);
}

/** Posts tagged exactly at `node` (not its descendants), in postOrder. */
export function ownLevelPosts<T extends { thread: string | null; dateIso: string; time: string | null; line: number }>(
	posts: T[],
	node: string
): T[] {
	const target = canonicalThreadName(node);
	return posts
		.filter((p) => p.thread !== null && canonicalThreadName(p.thread) === target)
		.sort(postOrder);
}

/** Newest-first order (the reverse of postOrder, ties broken by note then
 *  line so the result is deterministic across notes). */
export function newestFirst(
	a: { dateIso: string; time: string | null; line: number; note?: string },
	b: { dateIso: string; time: string | null; line: number; note?: string }
): number {
	const o = postOrder(b, a);
	if (o !== 0) return o;
	const an = a.note ?? "";
	const bn = b.note ?? "";
	return an < bn ? -1 : an > bn ? 1 : 0;
}

/** The flat "show all at and below this level" list: every post of the
 *  subtree, newest first. */
export function flattenSubtreePosts<T extends { thread: string | null; dateIso: string; time: string | null; line: number; note?: string }>(
	posts: T[],
	node: string
): T[] {
	return posts
		.filter((p) => p.thread !== null && isWithinThread(p.thread, node))
		.sort(newestFirst);
}

/** Keyboard movement between tiles (one column). Returns the new index, or
 *  null when the key is not a movement key. An index of -1 (nothing focused
 *  yet) lands on the first tile for Down/Right/Home and the last for Up/Left/End. */
export function moveTileFocus(index: number, count: number, key: string): number | null {
	if (count <= 0) return null;
	const last = count - 1;
	switch (key) {
		case "ArrowDown":
		case "ArrowRight":
			return index < 0 ? 0 : Math.min(last, index + 1);
		case "ArrowUp":
		case "ArrowLeft":
			return index < 0 ? last : Math.max(0, index - 1);
		case "Home":
			return 0;
		case "End":
			return last;
		default:
			return null;
	}
}

/** Backspace (no modifiers) or Alt+Left = go up one level. */
export function isUpLevelKey(e: {
	key: string;
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
}): boolean {
	if (e.key === "Backspace") return !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
	if (e.key === "ArrowLeft") return !!e.altKey && !e.ctrlKey && !e.metaKey;
	return false;
}
