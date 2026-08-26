import { describe, it, expect } from "vitest";
import {
	parseThreadsBlock,
	isEmptySpec,
	selectBlockGroups,
	blockSourceLabel,
	type BlockPost,
} from "../threads-block";
import type { ThreadPost, PeriodicPost } from "../thread-core";

function tp(
	thread: string,
	dateIso: string,
	text: string,
	line = 0
): ThreadPost {
	return {
		thread,
		note: dateIso,
		path: `00. Timeline/${dateIso}.md`,
		dateIso,
		line,
		time: null,
		text,
		blockId: null,
		replyTo: null,
		periods: [],
		raw: text,
	};
}

function pp(
	period: string,
	dateIso: string,
	text: string,
	line = 0
): PeriodicPost {
	return {
		periods: [period],
		thread: null,
		note: dateIso,
		path: `00. Timeline/${dateIso}.md`,
		dateIso,
		line,
		time: null,
		text,
		blockId: null,
		raw: text,
	};
}

describe("parseThreadsBlock", () => {
	it("parses thread names from thread/threads keys and comma lists", () => {
		const spec = parseThreadsBlock("threads: singularity, narrative\nthread: land");
		expect(spec.threads).toEqual(["singularity", "narrative", "land"]);
		expect(spec.errors).toEqual([]);
	});

	it("treats a colon-less line as a thread name and dedupes", () => {
		const spec = parseThreadsBlock("singularity\nsingularity\nnarrative");
		expect(spec.threads).toEqual(["singularity", "narrative"]);
	});

	it("classifies cadences from tags and orders them by horizon", () => {
		const spec = parseThreadsBlock("tags: yearly, weekly");
		expect(spec.periods).toEqual(["weekly", "yearly"]);
	});

	it("accepts #thread/x and #thought/x forms in tags", () => {
		const spec = parseThreadsBlock("tags: #thread/land, #thought/monthly");
		expect(spec.threads).toEqual(["land"]);
		expect(spec.periods).toEqual(["monthly"]);
	});

	it("captures a filter from filter/search/contains", () => {
		expect(parseThreadsBlock("filter: dance").filter).toBe("dance");
		expect(parseThreadsBlock("search: dance").filter).toBe("dance");
		expect(parseThreadsBlock("contains: dance").filter).toBe("dance");
	});

	it("parses a positive integer limit and rejects bad ones", () => {
		expect(parseThreadsBlock("limit: 3").limit).toBe(3);
		const bad = parseThreadsBlock("limit: zero");
		expect(bad.limit).toBeNull();
		expect(bad.errors[0]).toContain("Invalid limit");
	});

	it("ignores // comments and blank lines", () => {
		const spec = parseThreadsBlock("// a comment\n\nthread: land\n");
		expect(spec.threads).toEqual(["land"]);
		expect(spec.errors).toEqual([]);
	});

	it("reports unknown keys and unknown tags", () => {
		expect(parseThreadsBlock("wat: 1").errors[0]).toContain("Unknown key");
		expect(parseThreadsBlock("tags: bogus").errors[0]).toContain("Unknown tag");
	});
});

describe("isEmptySpec", () => {
	it("is true for a comment-only block", () => {
		expect(isEmptySpec(parseThreadsBlock("// nothing here"))).toBe(true);
	});
	it("is false once a thread or period is selected", () => {
		expect(isEmptySpec(parseThreadsBlock("thread: land"))).toBe(false);
		expect(isEmptySpec(parseThreadsBlock("tags: weekly"))).toBe(false);
	});
});

describe("selectBlockGroups", () => {
	const posts: ThreadPost[] = [
		tp("land", "2026-08-20", "found a parcel"),
		tp("land", "2026-08-22", "walked the parcel again"),
		tp("land", "2026-08-24", "soil looks good"),
		tp("narrative", "2026-08-21", "the story of the shift"),
	];
	const periodic: PeriodicPost[] = [
		pp("weekly", "2026-08-23", "weekly reflection"),
		pp("yearly", "2026-08-01", "yearly intention"),
	];

	it("builds one group per selected thread then per cadence, in spec order", () => {
		const spec = parseThreadsBlock("threads: land, narrative\ntags: weekly");
		const groups = selectBlockGroups(spec, posts, periodic);
		expect(groups.map((g) => g.key)).toEqual(["land", "narrative", "weekly"]);
		expect(groups.map((g) => g.kind)).toEqual(["thread", "thread", "period"]);
		expect(groups[0].label).toBe("#thread/land");
		expect(groups[2].label).toBe("Weekly thoughts");
	});

	it("sorts a thread group chronologically", () => {
		const spec = parseThreadsBlock("thread: land");
		const [group] = selectBlockGroups(spec, posts, periodic);
		expect(group.posts.map((p) => p.dateIso)).toEqual([
			"2026-08-20",
			"2026-08-22",
			"2026-08-24",
		]);
	});

	it("applies a case-insensitive substring filter to post text", () => {
		const spec = parseThreadsBlock("thread: land\nfilter: PARCEL");
		const [group] = selectBlockGroups(spec, posts, periodic);
		expect(group.posts.map((p) => p.text)).toEqual([
			"found a parcel",
			"walked the parcel again",
		]);
	});

	it("keeps only the most recent N when a limit is set", () => {
		const spec = parseThreadsBlock("thread: land\nlimit: 2");
		const [group] = selectBlockGroups(spec, posts, periodic);
		expect(group.posts.map((p) => p.dateIso)).toEqual([
			"2026-08-22",
			"2026-08-24",
		]);
	});

	it("yields an empty group (not a crash) for a thread with no posts", () => {
		const spec = parseThreadsBlock("thread: ghost");
		const [group] = selectBlockGroups(spec, posts, periodic);
		expect(group.posts).toEqual([]);
	});
});

describe("blockSourceLabel", () => {
	const base: BlockPost = {
		note: "2026-08-24",
		path: "00. Timeline/2026-08-24.md",
		dateIso: "2026-08-24",
		line: 3,
		time: null,
		text: "x",
		thread: "land",
	};

	it("shows the date for a daily note", () => {
		expect(blockSourceLabel(base)).toBe("2026-08-24");
	});

	it("appends a time when present", () => {
		expect(blockSourceLabel({ ...base, time: "14:30" })).toBe(
			"2026-08-24 · 14:30"
		);
	});

	it("shows the note name for a non-daily note", () => {
		expect(
			blockSourceLabel({ ...base, note: "walk dancing" })
		).toBe("walk dancing");
	});
});
