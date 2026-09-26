// thread-tree-core.ts — pure engine for nested thread tags (v1.51.0). No
// Obsidian imports; covered by tests/thread-tree-core.test.ts.
//
// A thread name may be a path: #thread/flow/movement/dance. The Threads panel
// shows those as a collapsible tree where a parent node lists its own posts
// AND rolls up every post of its descendants. The one rule that must never
// break is prefix safety: #thread/flow owns #thread/flow and #thread/flow/…,
// never #thread/flowers. Membership is always decided on whole path segments.
import type { ThreadSummary } from "./thread-core";
import { groupThreadsByArea, type AreaGroup, type ThreadArea } from "./thread-areas";

/** One node of the thread tree. */
export interface ThreadNode {
	/** Full path, e.g. "flow/movement/dance" (the part after #thread/). */
	name: string;
	/** Last path segment, e.g. "dance" — what the tree row shows. */
	label: string;
	/** 0 for a root. */
	depth: number;
	/** Posts tagged with exactly this path. 0 for a pure intermediate node. */
	ownCount: number;
	/** ownCount + every descendant's posts (the roll-up). */
	totalCount: number;
	/** Most recent post anywhere in the subtree ("" if none). */
	lastActiveDate: string;
	lastActiveTime: string | null;
	children: ThreadNode[];
}

/** Path segments of a thread name, empty segments dropped ("a//b/" → [a, b]). */
export function threadSegments(name: string): string[] {
	return name.split("/").filter((s) => s.length > 0);
}

/** The canonical form of a thread name: segments re-joined, no stray slashes. */
export function canonicalThreadName(name: string): string {
	return threadSegments(name).join("/");
}

/** Depth of a thread name: 0 for "flow", 2 for "flow/movement/dance". */
export function threadDepth(name: string): number {
	return Math.max(0, threadSegments(name).length - 1);
}

/**
 * Whether a post tagged `postThread` belongs to node `node` — the node itself
 * or any descendant. Whole-segment match only: "flow" contains "flow" and
 * "flow/dance", but never "flowers" or "flow-state".
 */
export function isWithinThread(postThread: string, node: string): boolean {
	const p = canonicalThreadName(postThread);
	const n = canonicalThreadName(node);
	if (!n) return false;
	return p === n || p.startsWith(n + "/");
}

/** Posts in a node's subtree (own + descendants), in the order given. */
export function subtreeFilter<T extends { thread: string | null }>(
	posts: T[],
	node: string
): T[] {
	return posts.filter((p) => p.thread !== null && isWithinThread(p.thread, node));
}

function newer(
	aDate: string,
	aTime: string | null,
	bDate: string,
	bTime: string | null
): boolean {
	if (aDate !== bDate) return aDate > bDate;
	return (aTime ?? "") > (bTime ?? "");
}

/**
 * Build the thread tree from per-name summaries (summarizeThreads output —
 * one row per exact tag). Intermediate paths nobody tagged directly become
 * nodes with ownCount 0. Siblings are ordered pinned first, then most recently
 * active, then by name. `pinned` holds full names.
 */
export function buildThreadTree(
	summaries: ThreadSummary[],
	pinned: readonly string[] = []
): ThreadNode[] {
	const byName = new Map<string, ThreadNode>();
	const roots: ThreadNode[] = [];
	const ensure = (segs: string[]): ThreadNode => {
		const name = segs.join("/");
		let node = byName.get(name);
		if (node) return node;
		node = {
			name,
			label: segs[segs.length - 1],
			depth: segs.length - 1,
			ownCount: 0,
			totalCount: 0,
			lastActiveDate: "",
			lastActiveTime: null,
			children: [],
		};
		byName.set(name, node);
		if (segs.length === 1) roots.push(node);
		else ensure(segs.slice(0, -1)).children.push(node);
		return node;
	};
	for (const s of summaries) {
		const segs = threadSegments(s.name);
		if (segs.length === 0) continue;
		const node = ensure(segs);
		node.ownCount += s.postCount;
		// Roll the count and recency up every ancestor, the node included.
		for (let i = segs.length; i >= 1; i--) {
			const n = byName.get(segs.slice(0, i).join("/"))!;
			n.totalCount += s.postCount;
			if (newer(s.lastActiveDate, s.lastActiveTime, n.lastActiveDate, n.lastActiveTime)) {
				n.lastActiveDate = s.lastActiveDate;
				n.lastActiveTime = s.lastActiveTime;
			}
		}
	}
	const pinSet = new Set(pinned.map(canonicalThreadName));
	const sortLevel = (nodes: ThreadNode[]) => {
		nodes.sort((a, b) => {
			const ap = pinSet.has(a.name) ? 0 : 1;
			const bp = pinSet.has(b.name) ? 0 : 1;
			if (ap !== bp) return ap - bp;
			if (a.lastActiveDate !== b.lastActiveDate || a.lastActiveTime !== b.lastActiveTime)
				return newer(a.lastActiveDate, a.lastActiveTime, b.lastActiveDate, b.lastActiveTime)
					? -1
					: 1;
			return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
		});
		for (const n of nodes) sortLevel(n.children);
	};
	sortLevel(roots);
	return roots;
}

/** Find a node by full name anywhere in the tree. */
export function findNode(roots: ThreadNode[], name: string): ThreadNode | null {
	const target = canonicalThreadName(name);
	const walk = (nodes: ThreadNode[]): ThreadNode | null => {
		for (const n of nodes) {
			if (n.name === target) return n;
			if (target.startsWith(n.name + "/")) return walk(n.children);
		}
		return null;
	};
	return walk(roots);
}

/**
 * Depth-first rows for rendering. A node's children are included only when
 * `isExpanded(node.name)` is true (default: everything expanded — the tag
 * menu's full listing).
 */
export function flattenThreadTree(
	roots: ThreadNode[],
	isExpanded: (name: string) => boolean = () => true
): ThreadNode[] {
	const out: ThreadNode[] = [];
	const walk = (nodes: ThreadNode[]) => {
		for (const n of nodes) {
			out.push(n);
			if (n.children.length > 0 && isExpanded(n.name)) walk(n.children);
		}
	};
	walk(roots);
	return out;
}

/** A node as a rolled-up ThreadSummary (count = the whole subtree). */
export function nodeSummary(node: ThreadNode): ThreadSummary {
	return {
		name: node.name,
		postCount: node.totalCount,
		lastActiveDate: node.lastActiveDate,
		lastActiveTime: node.lastActiveTime,
	};
}

/** An area group of whole trees (areas map ROOT names). */
export interface TreeAreaGroup {
	area: string;
	roots: ThreadNode[];
}

/**
 * Group the thread tree by area. Areas (from the mapping note) assign ROOT
 * thread names; a nested thread always follows its root. Reuses the flat
 * grouping on rolled-up root summaries, so area order, the Unsorted catch-all
 * and pin-first ordering behave exactly as before for un-nested threads.
 */
export function groupTreeByArea(
	summaries: ThreadSummary[],
	areas: ThreadArea[],
	pinned: readonly string[] = []
): TreeAreaGroup[] {
	const roots = buildThreadTree(summaries, pinned);
	const byName = new Map(roots.map((r) => [r.name, r]));
	const groups = groupThreadsByArea(roots.map(nodeSummary), areas, pinned);
	return groups.map((g) => ({
		area: g.area,
		roots: g.threads.map((t) => byName.get(t.name)!).filter(Boolean),
	}));
}

/**
 * The same grouping flattened into AreaGroup rows for the add-tag menu: every
 * node of every tree, parents before children, so nested paths (including
 * intermediate ones nobody has tagged yet) can be picked directly.
 */
export function menuAreaGroups(
	summaries: ThreadSummary[],
	areas: ThreadArea[],
	pinned: readonly string[] = []
): AreaGroup[] {
	return groupTreeByArea(summaries, areas, pinned).map((g) => ({
		area: g.area,
		threads: flattenThreadTree(g.roots).map(nodeSummary),
	}));
}
