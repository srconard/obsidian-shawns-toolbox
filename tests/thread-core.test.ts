import { describe, it, expect } from "vitest";
import {
	parsePostLine,
	parseNotePosts,
	postDisplayText,
	extractBlockId,
	threadPosts,
	summarizeThreads,
	replyCounts,
	indexByBlock,
	targetKey,
	generateBlockId,
	ensureBlockId,
	formatReplyLine,
} from "../thread-core";

describe("parsePostLine", () => {
	it("returns null for a line with no #thread tag", () => {
		expect(parsePostLine("- 09:00 just a thought", "2026-08-25", "2026-08-25", 3)).toBeNull();
	});

	it("extracts thread, time, and clean text", () => {
		const p = parsePostLine(
			"- 14:30 the mountain feels close today #thread/mountains",
			"2026-08-25",
			"2026-08-25",
			5
		)!;
		expect(p.thread).toBe("mountains");
		expect(p.time).toBe("14:30");
		expect(p.text).toBe("the mountain feels close today");
		expect(p.blockId).toBeNull();
		expect(p.replyTo).toBeNull();
		expect(p.line).toBe(5);
		expect(p.note).toBe("2026-08-25");
	});

	it("supports sub-tag thread names with slashes", () => {
		const p = parsePostLine("- 08:00 x #thread/ideas/hardware", "n", "2026-08-25", 0)!;
		expect(p.thread).toBe("ideas/hardware");
	});

	it("pads a single-digit hour", () => {
		const p = parsePostLine("- 9:05 morning #thread/log", "n", "2026-08-25", 0)!;
		expect(p.time).toBe("09:05");
	});

	it("falls back to null time when there is no HH:MM prefix", () => {
		const p = parsePostLine("- a bare thought #thread/log", "n", "2026-08-25", 0)!;
		expect(p.time).toBeNull();
	});

	it("reads a trailing block id", () => {
		const p = parsePostLine("- 10:00 parent post #thread/log ^t3f9", "n", "2026-08-25", 0)!;
		expect(p.blockId).toBe("t3f9");
		expect(p.text).toBe("parent post");
	});

	it("parses a reply pointer and strips the arrow + link from text", () => {
		const p = parsePostLine(
			"- 11:00 agreed #thread/log ↩ [[2026-08-24#^t3f9]]",
			"2026-08-25",
			"2026-08-25",
			2
		)!;
		expect(p.replyTo).toEqual({ note: "2026-08-24", blockId: "t3f9" });
		expect(p.text).toBe("agreed");
	});

	it("accepts any block link as a reply pointer (arrow is only convention)", () => {
		const p = parsePostLine("- 11:00 see [[2026-08-24#^t3f9]] #thread/log", "n", "2026-08-25", 0)!;
		expect(p.replyTo).toEqual({ note: "2026-08-24", blockId: "t3f9" });
	});
});

describe("postDisplayText", () => {
	it("strips bullet, tag, block id and collapses whitespace", () => {
		expect(postDisplayText("- 12:00 hello   world #thread/x ^tabc")).toBe("hello world");
	});
	it("handles a line with no time prefix", () => {
		expect(postDisplayText("- plain note #thread/x")).toBe("plain note");
	});
});

describe("extractBlockId", () => {
	it("returns the id without the caret", () => {
		expect(extractBlockId("some line ^t9z")).toBe("t9z");
	});
	it("returns null when absent", () => {
		expect(extractBlockId("some line")).toBeNull();
	});
	it("ignores a caret that is mid-line, not a block id", () => {
		expect(extractBlockId("a ^caret in the middle here")).toBeNull();
	});
});

const NOTE_A = [
	"# Thoughts",
	"- 09:00 first idea #thread/build ^tp1",
	"- 10:30 unrelated line",
	"- 11:00 second idea #thread/garden",
].join("\n");

const NOTE_B = [
	"# Thoughts",
	"- 08:00 reply to first #thread/build ↩ [[2026-08-24#^tp1]]",
	"- 09:15 newest garden note #thread/garden",
].join("\n");

describe("parseNotePosts", () => {
	it("finds only tagged lines with correct line numbers", () => {
		const posts = parseNotePosts("2026-08-24", "2026-08-24", NOTE_A);
		expect(posts.map((p) => p.line)).toEqual([1, 3]);
		expect(posts.map((p) => p.thread)).toEqual(["build", "garden"]);
	});
});

describe("threadPosts + summarizeThreads", () => {
	const all = [
		...parseNotePosts("2026-08-24", "2026-08-24", NOTE_A),
		...parseNotePosts("2026-08-25", "2026-08-25", NOTE_B),
	];

	it("returns a thread's posts in chronological order across notes", () => {
		const build = threadPosts(all, "build");
		expect(build.map((p) => p.dateIso)).toEqual(["2026-08-24", "2026-08-25"]);
	});

	it("sorts threads by last-active, newest first", () => {
		const summary = summarizeThreads(all);
		// garden last active 2026-08-25 09:15; build last active 2026-08-25 08:00
		expect(summary.map((s) => s.name)).toEqual(["garden", "build"]);
		expect(summary[0].postCount).toBe(2);
		expect(summary[0].lastActiveTime).toBe("09:15");
	});
});

describe("replyCounts + indexByBlock", () => {
	const all = [
		...parseNotePosts("2026-08-24", "2026-08-24", NOTE_A),
		...parseNotePosts("2026-08-25", "2026-08-25", NOTE_B),
	];

	it("counts a reply against its parent by (note, blockId)", () => {
		const counts = replyCounts(all);
		expect(counts.get(targetKey("2026-08-24", "tp1"))).toBe(1);
	});

	it("resolves a parent post from a reply pointer", () => {
		const idx = indexByBlock(all);
		const parent = idx.get(targetKey("2026-08-24", "tp1"))!;
		expect(parent.text).toBe("first idea");
	});
});

describe("generateBlockId", () => {
	it("starts with t and is ASCII alphanumeric", () => {
		const id = generateBlockId(() => 0.42);
		expect(id).toMatch(/^t[a-z0-9]+$/);
	});
	it("is deterministic given a fixed rng", () => {
		expect(generateBlockId(() => 0.42)).toBe(generateBlockId(() => 0.42));
	});
});

describe("ensureBlockId", () => {
	it("appends an id when missing", () => {
		const r = ensureBlockId("- 09:00 parent #thread/x", "tabc");
		expect(r.changed).toBe(true);
		expect(r.line).toBe("- 09:00 parent #thread/x ^tabc");
		expect(r.id).toBe("tabc");
	});
	it("keeps the existing id and reports no change", () => {
		const r = ensureBlockId("- 09:00 parent #thread/x ^told", "tnew");
		expect(r.changed).toBe(false);
		expect(r.id).toBe("told");
		expect(r.line).toBe("- 09:00 parent #thread/x ^told");
	});
	it("trims trailing whitespace before appending", () => {
		const r = ensureBlockId("- text   ", "tid");
		expect(r.line).toBe("- text ^tid");
	});
});

describe("formatReplyLine", () => {
	it("builds the canonical reply line", () => {
		expect(
			formatReplyLine("15:20", "makes sense", "build", "2026-08-24", "tp1")
		).toBe("- 15:20 makes sense #thread/build ↩ [[2026-08-24#^tp1]]");
	});
	it("flattens newlines in the reply text", () => {
		expect(formatReplyLine("15:20", "line one\nline two", "x", "n", "i")).toBe(
			"- 15:20 line one line two #thread/x ↩ [[n#^i]]"
		);
	});
});
