import { describe, it, expect } from "vitest";
import {
	parsePostLine,
	parseNotePosts,
	postDisplayText,
	extractBlockId,
	threadPosts,
	summarizeThreads,
	orderThreadsByPin,
	replyCounts,
	indexByBlock,
	targetKey,
	generateBlockId,
	ensureBlockId,
	formatReplyLine,
	hasTag,
	appendTag,
	applyPeriodTags,
	extractPeriods,
	parsePeriodicPosts,
	periodicPosts,
	summarizePeriods,
	normalizeThreadName,
	parseThoughtPosts,
	THOUGHT_PERIODS,
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

describe("path propagation", () => {
	it("carries an explicit source path onto every parsed thread post", () => {
		const posts = parseNotePosts(
			"walk dancing",
			"2026-08-25",
			"- 09:00 a thought #thread/build",
			"01. Default/walk dancing.md"
		);
		expect(posts[0].path).toBe("01. Default/walk dancing.md");
		expect(posts[0].note).toBe("walk dancing");
	});

	it("carries the source path onto periodic posts too", () => {
		const posts = parsePeriodicPosts(
			"walk dancing",
			"2026-08-25",
			"- 09:00 a thought #thought/weekly",
			"01. Default/walk dancing.md"
		);
		expect(posts[0].path).toBe("01. Default/walk dancing.md");
	});

	it("defaults path to the note basename when not supplied", () => {
		const posts = parseNotePosts("2026-08-25", "2026-08-25", "- 09:00 x #thread/build");
		expect(posts[0].path).toBe("2026-08-25");
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

describe("orderThreadsByPin", () => {
	const all = [
		...parseNotePosts("2026-08-24", "2026-08-24", NOTE_A),
		...parseNotePosts("2026-08-25", "2026-08-25", NOTE_B),
	];
	const summaries = summarizeThreads(all); // ["garden", "build"] by last-active

	it("moves pinned threads above unpinned, keeping last-active order otherwise", () => {
		const ordered = orderThreadsByPin(summaries, ["build"]);
		expect(ordered.map((s) => s.name)).toEqual(["build", "garden"]);
	});

	it("keeps last-active order within the pinned group", () => {
		const ordered = orderThreadsByPin(summaries, ["build", "garden"]);
		// both pinned → same relative order as the incoming (last-active) list
		expect(ordered.map((s) => s.name)).toEqual(["garden", "build"]);
	});

	it("is a no-op when nothing is pinned", () => {
		const ordered = orderThreadsByPin(summaries, []);
		expect(ordered.map((s) => s.name)).toEqual(["garden", "build"]);
	});

	it("ignores pinned names that don't exist", () => {
		const ordered = orderThreadsByPin(summaries, ["nonexistent"]);
		expect(ordered.map((s) => s.name)).toEqual(["garden", "build"]);
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

describe("hasTag", () => {
	it("matches a whole tag token", () => {
		expect(hasTag("- 09:00 x #thread/focus", "#thread/focus")).toBe(true);
		expect(hasTag("- 09:00 x #thought/quarterly", "#thought/quarterly")).toBe(true);
	});
	it("does not match a tag that is a prefix of a longer tag", () => {
		expect(hasTag("- 09:00 x #thread/focus-practice", "#thread/focus")).toBe(false);
		expect(hasTag("- 09:00 x #thread/focus/deep", "#thread/focus")).toBe(false);
	});
	it("matches a tag at end of line", () => {
		expect(hasTag("- 09:00 x #thought/yearly", "#thought/yearly")).toBe(true);
	});
});

describe("appendTag", () => {
	it("appends a tag single-space separated at end of line", () => {
		expect(appendTag("- 09:00 a thought #thread/focus", "#thought/quarterly")).toBe(
			"- 09:00 a thought #thread/focus #thought/quarterly"
		);
	});
	it("appends a second #thread tag", () => {
		expect(appendTag("- 09:00 a thought #thread/focus", "#thread/health")).toBe(
			"- 09:00 a thought #thread/focus #thread/health"
		);
	});
	it("is a no-op when the exact tag is already present (verbatim)", () => {
		const line = "- 09:00 a thought #thread/focus #thought/quarterly";
		expect(appendTag(line, "#thought/quarterly")).toBe(line);
		expect(appendTag(line, "#thread/focus")).toBe(line);
	});
	it("inserts before a trailing block id so the ^id stays at line-end", () => {
		expect(appendTag("- 09:00 a thought #thread/focus ^t3f9", "#thought/monthly")).toBe(
			"- 09:00 a thought #thread/focus #thought/monthly ^t3f9"
		);
	});
	it("no-op keeps a trailing block id untouched", () => {
		const line = "- 09:00 a thought #thread/focus #thought/monthly ^t3f9";
		expect(appendTag(line, "#thought/monthly")).toBe(line);
	});
	it("collapses trailing whitespace before appending", () => {
		expect(appendTag("- 09:00 a thought #thread/focus   ", "#thought/weekly")).toBe(
			"- 09:00 a thought #thread/focus #thought/weekly"
		);
	});
	it("preserves a CR-terminated no-op line verbatim", () => {
		const line = "- 09:00 a thought #thought/weekly\r";
		expect(appendTag(line, "#thought/weekly")).toBe(line);
	});
});

describe("applyPeriodTags", () => {
	it("returns the block unchanged when no periods are armed", () => {
		const line = "- 09:00 a thought";
		expect(applyPeriodTags(line, [])).toBe(line);
	});
	it("appends one cadence tag to a plain thought line", () => {
		expect(applyPeriodTags("- 09:00 a thought", ["weekly"])).toBe(
			"- 09:00 a thought #thought/weekly"
		);
	});
	it("appends multiple tags in THOUGHT_PERIODS (horizon) order, not arm order", () => {
		expect(
			applyPeriodTags("- 09:00 a thought", ["yearly", "weekly", "monthly"])
		).toBe("- 09:00 a thought #thought/weekly #thought/monthly #thought/yearly");
	});
	it("is a no-op for a cadence already present but still adds the others", () => {
		expect(
			applyPeriodTags("- 09:00 a thought #thought/weekly", ["weekly", "quarterly"])
		).toBe("- 09:00 a thought #thought/weekly #thought/quarterly");
	});
	it("tags only the first line of a multi-line block, children untouched", () => {
		const block = "- 09:00 **summary**\n\t- a bullet\n\t- raw: the ramble";
		expect(applyPeriodTags(block, ["monthly"])).toBe(
			"- 09:00 **summary** #thought/monthly\n\t- a bullet\n\t- raw: the ramble"
		);
	});
	it("ignores unknown period strings", () => {
		const line = "- 09:00 a thought";
		expect(applyPeriodTags(line, ["daily", "weekly"])).toBe(
			"- 09:00 a thought #thought/weekly"
		);
	});
});

describe("THOUGHT_PERIODS", () => {
	it("is the SOP cadence set in horizon order", () => {
		expect(THOUGHT_PERIODS).toEqual(["weekly", "monthly", "quarterly", "yearly"]);
	});
});

describe("extractPeriods", () => {
	it("returns the cadence tags on a line in horizon order", () => {
		expect(
			extractPeriods("- 09:00 x #thought/yearly #thread/a #thought/weekly")
		).toEqual(["weekly", "yearly"]);
	});
	it("returns empty when no cadence tag is present", () => {
		expect(extractPeriods("- 09:00 x #thread/a")).toEqual([]);
	});
	it("does not match a cadence that is a prefix of a longer tag", () => {
		expect(extractPeriods("- x #thought/weekly-review")).toEqual([]);
		expect(extractPeriods("- x #thought/quarterly/q3")).toEqual([]);
	});
	it("dedupes a repeated cadence", () => {
		expect(extractPeriods("#thought/monthly and #thought/monthly")).toEqual([
			"monthly",
		]);
	});
});

describe("parsePostLine periods + display", () => {
	it("captures cadence tags and strips them from display text", () => {
		const p = parsePostLine(
			"- 14:30 keep going #thread/build #thought/quarterly",
			"2026-08-25",
			"2026-08-25",
			1
		)!;
		expect(p.periods).toEqual(["quarterly"]);
		expect(p.text).toBe("keep going");
	});
});

const PNOTE = [
	"# Thoughts",
	"- 09:00 quarterly reflection #thought/quarterly",
	"- 10:00 a thread post with a cadence #thread/build #thought/weekly ^tp9",
	"- 11:00 just a normal thought",
	"- 12:00 yearly + quarterly #thought/yearly #thought/quarterly",
].join("\n");

describe("parsePeriodicPosts", () => {
	const posts = parsePeriodicPosts("2026-08-25", "2026-08-25", PNOTE);
	it("finds only lines carrying a cadence tag", () => {
		expect(posts.map((p) => p.line)).toEqual([1, 2, 4]);
	});
	it("records the thread name when the line is also a thread post", () => {
		expect(posts.find((p) => p.line === 2)!.thread).toBe("build");
		expect(posts.find((p) => p.line === 1)!.thread).toBeNull();
	});
	it("carries the block id and clean text", () => {
		const p = posts.find((p) => p.line === 2)!;
		expect(p.blockId).toBe("tp9");
		expect(p.text).toBe("a thread post with a cadence");
	});
});

describe("periodicPosts + summarizePeriods", () => {
	const all = [
		...parsePeriodicPosts("2026-08-24", "2026-08-24", "- 08:00 old q #thought/quarterly"),
		...parsePeriodicPosts("2026-08-25", "2026-08-25", PNOTE),
	];
	it("filters to a cadence, chronologically across notes", () => {
		const q = periodicPosts(all, "quarterly");
		expect(q.map((p) => p.dateIso)).toEqual([
			"2026-08-24",
			"2026-08-25",
			"2026-08-25",
		]);
	});
	it("summarizes only cadences with posts, in horizon order, with counts", () => {
		const sum = summarizePeriods(all);
		expect(sum.map((s) => s.period)).toEqual(["weekly", "quarterly", "yearly"]);
		expect(sum.find((s) => s.period === "quarterly")!.postCount).toBe(3);
		expect(sum.find((s) => s.period === "weekly")!.postCount).toBe(1);
	});
});

describe("normalizeThreadName", () => {
	it("lowercases and folds whitespace to dashes", () => {
		expect(normalizeThreadName("  Walk Dancing ")).toBe("walk-dancing");
	});
	it("drops characters outside the thread-name alphabet", () => {
		expect(normalizeThreadName("Idea!! #2 (draft)")).toBe("idea-2-draft");
	});
	it("collapses dash and slash runs and trims edges", () => {
		expect(normalizeThreadName("--practice//flare--")).toBe("practice/flare");
	});
	it("keeps digits, underscores, and existing kebab names verbatim", () => {
		expect(normalizeThreadName("focus-practice_2")).toBe("focus-practice_2");
	});
	it("returns empty string when nothing usable remains", () => {
		expect(normalizeThreadName("   !!!   ")).toBe("");
	});
});

const TNOTE = [
	"---",
	"DateCreated: 2026-08-25",
	"---",
	"# Thoughts",
	"- 06:48 morning walk thought",
	"- eco",
	"\t- 07:26 child idea under eco",
	"- 12:26 a guiding question #question/guiding",
	"- 19:41 camping idea #thread/nature-spots ↩ [[2026-04-14#^tg819vn]]",
	"- 21:21 people memory #thought/quarterly #thread/people-memory ^tp1",
	"- ",
	"",
	"# Night Session Direction",
	"- not a thought",
].join("\n");

describe("parseThoughtPosts", () => {
	const posts = parseThoughtPosts("2026-08-25", "2026-08-25", TNOTE);

	it("returns every top-level bullet under # Thoughts (skips children/placeholders/other sections)", () => {
		expect(posts.map((p) => p.line)).toEqual([4, 5, 7, 8, 9]);
	});
	it("includes untagged thoughts, with thread null", () => {
		const eco = posts.find((p) => p.line === 5)!;
		expect(eco.thread).toBeNull();
		expect(eco.text).toBe("eco");
		expect(eco.time).toBeNull();
	});
	it("keeps non-thread/thought tags in the display text", () => {
		expect(posts.find((p) => p.line === 7)!.text).toContain("#question/guiding");
	});
	it("records the #thread name and strips the tag + reply link from text", () => {
		const camp = posts.find((p) => p.line === 8)!;
		expect(camp.thread).toBe("nature-spots");
		expect(camp.text).toBe("camping idea");
	});
	it("carries periods, block id, and time", () => {
		const ppl = posts.find((p) => p.line === 9)!;
		expect(ppl.thread).toBe("people-memory");
		expect(ppl.periods).toEqual(["quarterly"]);
		expect(ppl.blockId).toBe("tp1");
		expect(ppl.time).toBe("21:21");
		expect(ppl.text).toBe("people memory");
	});
	it("threads the source path through for edits", () => {
		const posts2 = parseThoughtPosts(
			"2026-08-25",
			"2026-08-25",
			TNOTE,
			"# Thoughts",
			"00. Timeline/2026-08-25.md"
		);
		expect(posts2[0].path).toBe("00. Timeline/2026-08-25.md");
	});
	it("returns [] when the note has no Thoughts section", () => {
		expect(parseThoughtPosts("x", "2026-08-25", "# Other\n- a bullet")).toEqual([]);
	});
	it("honours a custom heading spec", () => {
		const custom = "## Ideas\n- 08:00 one idea\n";
		expect(parseThoughtPosts("x", "2026-08-25", custom, "## Ideas").map((p) => p.text)).toEqual([
			"one idea",
		]);
	});
});
