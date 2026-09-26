import { describe, it, expect } from "vitest";
import {
	buildThreadTree,
	canonicalThreadName,
	findNode,
	flattenThreadTree,
	groupTreeByArea,
	isWithinThread,
	menuAreaGroups,
	subtreeFilter,
	threadDepth,
} from "../thread-tree-core";
import { parseNotePosts, summarizeThreads, type ThreadSummary } from "../thread-core";

const s = (
	name: string,
	postCount: number,
	lastActiveDate = "2026-09-01",
	lastActiveTime: string | null = null
): ThreadSummary => ({ name, postCount, lastActiveDate, lastActiveTime });

describe("prefix safety", () => {
	it("a node owns itself and its descendants", () => {
		expect(isWithinThread("flow", "flow")).toBe(true);
		expect(isWithinThread("flow/dance", "flow")).toBe(true);
		expect(isWithinThread("flow/movement/dance", "flow")).toBe(true);
		expect(isWithinThread("flow/movement/dance", "flow/movement")).toBe(true);
	});

	it("never matches a name that only shares a prefix", () => {
		expect(isWithinThread("flowers", "flow")).toBe(false);
		expect(isWithinThread("flow-state", "flow")).toBe(false);
		expect(isWithinThread("flowers/rose", "flow")).toBe(false);
		expect(isWithinThread("flow/dancers", "flow/dance")).toBe(false);
	});

	it("a child never contains its parent or a sibling", () => {
		expect(isWithinThread("flow", "flow/dance")).toBe(false);
		expect(isWithinThread("flow/music", "flow/dance")).toBe(false);
	});

	it("tolerates stray slashes", () => {
		expect(canonicalThreadName("/flow//dance/")).toBe("flow/dance");
		expect(isWithinThread("flow/", "flow")).toBe(true);
		expect(isWithinThread("anything", "")).toBe(false);
		expect(threadDepth("flow/movement/dance")).toBe(2);
		expect(threadDepth("flow")).toBe(0);
	});

	it("subtreeFilter keeps own + descendant posts only", () => {
		const posts = [
			{ thread: "flow" },
			{ thread: "flow/dance" },
			{ thread: "flowers" },
			{ thread: null },
			{ thread: "music" },
		];
		expect(subtreeFilter(posts, "flow").map((p) => p.thread)).toEqual([
			"flow",
			"flow/dance",
		]);
	});
});

describe("buildThreadTree", () => {
	it("nests paths and rolls counts up", () => {
		const roots = buildThreadTree([
			s("flow/movement/dance", 3, "2026-09-20"),
			s("flow", 2, "2026-09-10"),
			s("flow/music", 1, "2026-09-01"),
			s("flowers", 4, "2026-08-01"),
		]);
		expect(roots.map((r) => r.name)).toEqual(["flow", "flowers"]);
		const flow = roots[0];
		expect(flow.ownCount).toBe(2);
		expect(flow.totalCount).toBe(6);
		expect(flow.lastActiveDate).toBe("2026-09-20");
		const movement = findNode(roots, "flow/movement")!;
		expect(movement.ownCount).toBe(0); // intermediate, nobody tagged it
		expect(movement.totalCount).toBe(3);
		expect(movement.label).toBe("movement");
		expect(movement.depth).toBe(1);
		expect(findNode(roots, "flowers")!.totalCount).toBe(4);
		expect(findNode(roots, "flow/dance")).toBeNull();
	});

	it("orders siblings pinned first, then most recent, then name", () => {
		const roots = buildThreadTree(
			[
				s("a", 1, "2026-09-01"),
				s("b", 1, "2026-09-05"),
				s("c", 1, "2026-09-05", "10:00"),
				s("d", 1, "2026-08-01"),
			],
			["d"]
		);
		expect(roots.map((r) => r.name)).toEqual(["d", "c", "b", "a"]);
	});

	it("pins apply per level to nested names", () => {
		const roots = buildThreadTree(
			[s("x/new", 1, "2026-09-10"), s("x/old", 1, "2026-01-01")],
			["x/old"]
		);
		expect(roots[0].children.map((c) => c.name)).toEqual(["x/old", "x/new"]);
	});

	it("flattens depth-first and honours collapse", () => {
		const roots = buildThreadTree([
			s("flow/dance", 1, "2026-09-02"),
			s("flow/music", 1, "2026-09-01"),
			s("zen", 1, "2026-08-01"),
		]);
		expect(flattenThreadTree(roots).map((n) => n.name)).toEqual([
			"flow",
			"flow/dance",
			"flow/music",
			"zen",
		]);
		expect(flattenThreadTree(roots, () => false).map((n) => n.name)).toEqual([
			"flow",
			"zen",
		]);
	});

	it("works on real parsed posts (tags are never rewritten)", () => {
		const content = [
			"- 09:00 one #thread/flow/movement/dance",
			"- 09:05 two #thread/flowers",
			"- 09:10 three #thread/flow",
		].join("\n");
		const posts = parseNotePosts("2026-09-26", "2026-09-26", content);
		expect(posts.map((p) => p.thread)).toEqual([
			"flow/movement/dance",
			"flowers",
			"flow",
		]);
		const roots = buildThreadTree(summarizeThreads(posts));
		expect(findNode(roots, "flow")!.totalCount).toBe(2);
		expect(findNode(roots, "flowers")!.totalCount).toBe(1);
	});
});

describe("area grouping of trees", () => {
	it("areas map root names; children follow their root", () => {
		const summaries = [
			s("flow/dance", 2, "2026-09-02"),
			s("people", 1, "2026-09-01"),
			s("misc", 1, "2026-08-01"),
		];
		const groups = groupTreeByArea(summaries, [
			{ name: "Body", threads: ["flow"] },
			{ name: "Life", threads: ["people"] },
		]);
		expect(groups.map((g) => [g.area, g.roots.map((r) => r.name)])).toEqual([
			["Body", ["flow"]],
			["Life", ["people"]],
			["Unsorted", ["misc"]],
		]);
		expect(groups[0].roots[0].totalCount).toBe(2);
	});

	it("the menu lists every nested path, parents first", () => {
		const groups = menuAreaGroups(
			[s("flow/movement/dance", 1, "2026-09-02"), s("zen", 1, "2026-08-01")],
			[]
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].threads.map((t) => t.name)).toEqual([
			"flow",
			"flow/movement",
			"flow/movement/dance",
			"zen",
		]);
	});
});
