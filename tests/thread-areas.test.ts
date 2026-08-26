import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
	parseThreadAreas,
	groupThreadsByArea,
	isFlatGrouping,
	UNSORTED_AREA,
} from "../thread-areas";
import type { ThreadSummary } from "../thread-core";

const fixture = readFileSync(
	new URL("./fixtures/thread-areas.md", import.meta.url),
	"utf8"
);

/** Build a minimal summary; date/time only affect the incoming order, which the
 *  caller supplies, so any placeholder works here. */
function sum(name: string): ThreadSummary {
	return { name, postCount: 1, lastActiveDate: "2026-08-25", lastActiveTime: null };
}

describe("parseThreadAreas", () => {
	it("reads ## headings as areas and their bullets as thread names", () => {
		expect(parseThreadAreas(fixture)).toEqual([
			{ name: "Practice", threads: ["dance", "daily-practice", "focus"] },
			{ name: "Vision", threads: ["future-vision", "land"] },
			{ name: "Unsorted", threads: ["narrative"] },
		]);
	});

	it("ignores the format comment and prose, dedupes names", () => {
		const areas = parseThreadAreas(
			"<!-- comment -->\n## A\nsome prose, no bullet\n- x\n- x\n- y\n"
		);
		expect(areas).toEqual([{ name: "A", threads: ["x", "y"] }]);
	});

	it("strips a leading #thread/ or [[…]] wrapper on a bullet", () => {
		const areas = parseThreadAreas("## A\n- #thread/dance\n- [[land]]\n");
		expect(areas).toEqual([{ name: "A", threads: ["dance", "land"] }]);
	});

	it("returns [] for an empty or heading-less note", () => {
		expect(parseThreadAreas("")).toEqual([]);
		expect(parseThreadAreas("- dance\n- land\n")).toEqual([]);
	});
});

describe("groupThreadsByArea", () => {
	const areas = parseThreadAreas(fixture);

	it("groups threads under their area in note order", () => {
		const groups = groupThreadsByArea(
			[sum("future-vision"), sum("dance"), sum("daily-practice")],
			areas
		);
		expect(groups.map((g) => g.area)).toEqual(["Practice", "Vision"]);
		expect(groups[0].threads.map((t) => t.name)).toEqual([
			"dance",
			"daily-practice",
		]);
		expect(groups[1].threads.map((t) => t.name)).toEqual(["future-vision"]);
	});

	it("preserves incoming (last-active) order within an area", () => {
		const groups = groupThreadsByArea(
			[sum("daily-practice"), sum("focus"), sum("dance")],
			areas
		);
		expect(groups[0].threads.map((t) => t.name)).toEqual([
			"daily-practice",
			"focus",
			"dance",
		]);
	});

	it("puts unlisted threads into the explicit Unsorted area", () => {
		const groups = groupThreadsByArea(
			[sum("dance"), sum("brand-new-thread"), sum("narrative")],
			areas
		);
		const unsorted = groups.find((g) => g.area === UNSORTED_AREA);
		expect(unsorted?.threads.map((t) => t.name)).toEqual([
			"brand-new-thread",
			"narrative",
		]);
	});

	it("synthesizes an Unsorted group at the end when the note has none", () => {
		const noUnsorted = parseThreadAreas("## Practice\n- dance\n");
		const groups = groupThreadsByArea(
			[sum("dance"), sum("stray")],
			noUnsorted
		);
		expect(groups.map((g) => g.area)).toEqual(["Practice", UNSORTED_AREA]);
		expect(groups[1].threads.map((t) => t.name)).toEqual(["stray"]);
	});

	it("drops areas that match no live thread", () => {
		const groups = groupThreadsByArea([sum("future-vision")], areas);
		expect(groups.map((g) => g.area)).toEqual(["Vision"]);
	});

	it("floats pinned threads to the top of their area group", () => {
		const groups = groupThreadsByArea(
			[sum("dance"), sum("daily-practice"), sum("focus")],
			areas,
			["focus"]
		);
		expect(groups[0].threads.map((t) => t.name)).toEqual([
			"focus",
			"dance",
			"daily-practice",
		]);
	});

	it("with no areas, lumps everything into one Unsorted group", () => {
		const groups = groupThreadsByArea([sum("a"), sum("b")], []);
		expect(groups).toHaveLength(1);
		expect(groups[0].area).toBe(UNSORTED_AREA);
		expect(groups[0].threads.map((t) => t.name)).toEqual(["a", "b"]);
		expect(isFlatGrouping(groups)).toBe(true);
	});

	it("is not flat once a real area holds threads", () => {
		const groups = groupThreadsByArea([sum("dance")], areas);
		expect(isFlatGrouping(groups)).toBe(false);
	});
});
