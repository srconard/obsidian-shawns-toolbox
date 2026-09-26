import { describe, it, expect } from "vitest";
import {
	breadcrumb,
	flattenSubtreePosts,
	isUpLevelKey,
	moveTileFocus,
	newestFirst,
	normalizeViewMode,
	ownLevelPosts,
	parentPath,
	relativeThreadSegments,
	resolveDrillPath,
	subPathLabel,
	tileRoots,
	tileStats,
	tileSublineParts,
} from "../thread-tiles-core";
import { buildThreadTree, findNode, groupTreeByArea } from "../thread-tree-core";
import type { ThreadSummary } from "../thread-core";

const s = (
	name: string,
	postCount: number,
	lastActiveDate = "2026-09-01",
	lastActiveTime: string | null = null
): ThreadSummary => ({ name, postCount, lastActiveDate, lastActiveTime });

const p = (thread: string | null, dateIso: string, time: string | null = null, line = 0, note = dateIso) => ({
	thread,
	dateIso,
	time,
	line,
	note,
});

const summaries = [
	s("flow", 2, "2026-09-10"),
	s("flow/movement", 3, "2026-09-20", "08:10"),
	s("flow/movement/dance", 4, "2026-09-24", "07:00"),
	s("flow/play", 1, "2026-09-05"),
	s("nature/spots", 5, "2026-09-12"),
	s("eco", 8, "2026-09-25"),
];

describe("view mode", () => {
	it("defaults anything but 'tiles' to the tree", () => {
		expect(normalizeViewMode("tiles")).toBe("tiles");
		expect(normalizeViewMode("tree")).toBe("tree");
		expect(normalizeViewMode(undefined)).toBe("tree");
		expect(normalizeViewMode("grid")).toBe("tree");
	});
});

describe("tileRoots", () => {
	it("keeps the tree's root order across area groups", () => {
		const areas = [
			{ name: "Nature", threads: ["nature"] },
			{ name: "Flow", threads: ["flow"] },
		];
		const groups = groupTreeByArea(summaries, areas);
		const flatOrder = groups.flatMap((g) => g.roots.map((r) => r.name));
		expect(tileRoots(groups).map((r) => r.name)).toEqual(flatOrder);
		expect(flatOrder.slice(0, 2)).toEqual(["nature", "flow"]);
		expect(flatOrder).toContain("eco");
	});

	it("without areas: most recent first, same as the tree", () => {
		const groups = groupTreeByArea(summaries, []);
		expect(tileRoots(groups).map((r) => r.name)).toEqual(
			buildThreadTree(summaries).map((r) => r.name)
		);
	});

	it("drops a root listed twice", () => {
		const roots = buildThreadTree(summaries);
		const dup = tileRoots([
			{ area: "A", roots: [roots[0]] },
			{ area: "B", roots: [roots[0], roots[1]] },
		]);
		expect(dup.map((r) => r.name)).toEqual([roots[0].name, roots[1].name]);
	});
});

describe("tileStats / subline", () => {
	const roots = buildThreadTree(summaries);
	it("aggregates the whole subtree", () => {
		const flow = findNode(roots, "flow")!;
		expect(tileStats(flow)).toEqual({
			totalPosts: 10,
			childCount: 2,
			lastActive: "2026-09-24 07:00",
			here: 2,
		});
		expect(tileSublineParts(tileStats(flow))).toEqual([
			"10 posts",
			"2 threads",
			"2026-09-24 07:00",
			"2 here",
		]);
	});

	it("a pure intermediate node shows 0 here, like the tree row", () => {
		const nature = findNode(roots, "nature")!;
		expect(tileStats(nature).here).toBe(0);
		expect(tileSublineParts(tileStats(nature))).toEqual([
			"5 posts",
			"1 thread",
			"2026-09-12",
			"0 here",
		]);
	});

	it("a leaf has no thread count and no 'here'", () => {
		const dance = findNode(roots, "flow/movement/dance")!;
		expect(tileStats(dance).here).toBeNull();
		expect(tileSublineParts(tileStats(dance))).toEqual(["4 posts", "2026-09-24 07:00"]);
	});

	it("singular post and missing date", () => {
		expect(
			tileSublineParts({ totalPosts: 1, childCount: 0, lastActive: "", here: null })
		).toEqual(["1 post"]);
	});
});

describe("breadcrumb / parentPath", () => {
	it("builds clickable crumbs with full paths", () => {
		expect(breadcrumb("flow/movement")).toEqual([
			{ label: "Threads", name: null },
			{ label: "flow", name: "flow" },
			{ label: "movement", name: "flow/movement" },
		]);
	});
	it("top level is just the root crumb", () => {
		expect(breadcrumb(null)).toEqual([{ label: "Threads", name: null }]);
		expect(breadcrumb("")).toEqual([{ label: "Threads", name: null }]);
	});
	it("tolerates stray slashes", () => {
		expect(breadcrumb("/flow//movement/").map((c) => c.name)).toEqual([
			null,
			"flow",
			"flow/movement",
		]);
	});
	it("parentPath walks up to the top", () => {
		expect(parentPath("flow/movement/dance")).toBe("flow/movement");
		expect(parentPath("flow")).toBeNull();
		expect(parentPath(null)).toBeNull();
	});
});

describe("resolveDrillPath", () => {
	const roots = buildThreadTree(summaries);
	it("keeps an existing path", () => {
		expect(resolveDrillPath(roots, "flow/movement")).toBe("flow/movement");
	});
	it("falls back to the deepest surviving ancestor", () => {
		expect(resolveDrillPath(roots, "flow/movement/gone")).toBe("flow/movement");
		expect(resolveDrillPath(roots, "flow/x/y")).toBe("flow");
	});
	it("falls back to the top level", () => {
		expect(resolveDrillPath(roots, "gone/away")).toBeNull();
		expect(resolveDrillPath(roots, null)).toBeNull();
		expect(resolveDrillPath(roots, "")).toBeNull();
	});
	it("prefix safety: flowers is not flow", () => {
		expect(resolveDrillPath(roots, "flowers")).toBeNull();
	});
});

describe("sub-thread labels", () => {
	it("relative segments", () => {
		expect(relativeThreadSegments("flow/movement/dance", "flow")).toEqual(["movement", "dance"]);
		expect(relativeThreadSegments("flow", "flow")).toEqual([]);
		expect(relativeThreadSegments("flowers", "flow")).toBeNull();
	});
	it("labels", () => {
		expect(subPathLabel("flow/movement/dance", "flow")).toBe("movement › dance");
		expect(subPathLabel("flow", "flow")).toBe("this level");
		expect(subPathLabel("nature/spots", "flow")).toBe("nature/spots");
	});
});

describe("post lists", () => {
	const posts = [
		p("flow", "2026-09-10", "09:00", 3),
		p("flow/movement", "2026-09-20", "08:10", 1),
		p("flow/movement/dance", "2026-09-24", "07:00", 2),
		p("flow", "2026-09-10", null, 1),
		p("flowers", "2026-09-26", null, 0),
		p(null, "2026-09-26", null, 5),
		p("flow/movement/dance", "2026-09-24", "07:00", 1, "walk dancing"),
	];

	it("own-level posts are exact matches only, chronological", () => {
		const own = ownLevelPosts(posts, "flow");
		expect(own.map((x) => [x.thread, x.time, x.line])).toEqual([
			["flow", null, 1],
			["flow", "09:00", 3],
		]);
		expect(ownLevelPosts(posts, "flow/movement").length).toBe(1);
		expect(ownLevelPosts(posts, "nature")).toEqual([]);
	});

	it("flattened subtree: every post at and below, newest first, never flowers", () => {
		const all = flattenSubtreePosts(posts, "flow");
		expect(all.map((x) => x.thread)).toEqual([
			"flow/movement/dance",
			"flow/movement/dance",
			"flow/movement",
			"flow",
			"flow",
		]);
		expect(all.some((x) => x.thread === "flowers")).toBe(false);
		// same date+time: later line first, then note name as a stable tie-break
		expect(all.slice(0, 2).map((x) => x.line)).toEqual([2, 1]);
		expect(all.slice(3).map((x) => x.line)).toEqual([3, 1]);
	});

	it("newestFirst is deterministic across notes with equal keys", () => {
		const a = p("x", "2026-09-01", null, 0, "a");
		const b = p("x", "2026-09-01", null, 0, "b");
		expect([b, a].sort(newestFirst).map((x) => x.note)).toEqual(["a", "b"]);
	});

	it("flattening a leaf equals its own posts (reversed order)", () => {
		const leaf = flattenSubtreePosts(posts, "flow/movement/dance");
		expect(leaf.length).toBe(ownLevelPosts(posts, "flow/movement/dance").length);
	});
});

describe("keyboard", () => {
	it("moves between tiles and clamps", () => {
		expect(moveTileFocus(0, 3, "ArrowDown")).toBe(1);
		expect(moveTileFocus(2, 3, "ArrowDown")).toBe(2);
		expect(moveTileFocus(1, 3, "ArrowUp")).toBe(0);
		expect(moveTileFocus(0, 3, "ArrowUp")).toBe(0);
		expect(moveTileFocus(0, 3, "ArrowRight")).toBe(1);
		expect(moveTileFocus(2, 3, "ArrowLeft")).toBe(1);
		expect(moveTileFocus(1, 3, "Home")).toBe(0);
		expect(moveTileFocus(1, 3, "End")).toBe(2);
	});
	it("enters from nothing focused", () => {
		expect(moveTileFocus(-1, 3, "ArrowDown")).toBe(0);
		expect(moveTileFocus(-1, 3, "ArrowUp")).toBe(2);
	});
	it("ignores other keys and empty lists", () => {
		expect(moveTileFocus(0, 3, "Enter")).toBeNull();
		expect(moveTileFocus(0, 0, "ArrowDown")).toBeNull();
	});
	it("up-a-level keys", () => {
		expect(isUpLevelKey({ key: "Backspace" })).toBe(true);
		expect(isUpLevelKey({ key: "Backspace", ctrlKey: true })).toBe(false);
		expect(isUpLevelKey({ key: "ArrowLeft", altKey: true })).toBe(true);
		expect(isUpLevelKey({ key: "ArrowLeft" })).toBe(false);
		expect(isUpLevelKey({ key: "ArrowLeft", altKey: true, ctrlKey: true })).toBe(false);
		expect(isUpLevelKey({ key: "Enter" })).toBe(false);
	});
});
