import { describe, it, expect } from "vitest";
import {
	formatHighlightLine,
	normalizeHighlightText,
	parseHighlights,
	addHighlight,
	editHighlight,
	deleteHighlight,
} from "../highlights-core";

// The real daily-note shape around the highlights field: a folded
// "# What Happened Today" level-1 section holding "## Summary" and
// "## Highlights", the latter seeded with an empty placeholder field.
const EMPTY = [
	"---",
	'DateCreated: "2026-08-29"',
	"---",
	"# Night Session Direction",
	"- ",
	"# What Happened Today %% fold %%",
	"## Summary",
	"## Highlights",
	"highlights:: ",
	"",
	"## Notes Created today",
	"end",
].join("\n");

const FILLED = [
	"# What Happened Today",
	"## Summary",
	"## Highlights",
	"highlights:: nice walk to the waterfall",
	"highlights:: called Mom",
	"",
	"## Notes Created today",
].join("\n");

describe("formatHighlightLine / normalize", () => {
	it("prefixes the field and collapses whitespace", () => {
		expect(formatHighlightLine("  a great   day\n\n")).toBe(
			"highlights:: a great day"
		);
	});
	it("collapses internal newlines to single spaces", () => {
		expect(normalizeHighlightText("line one\nline two")).toBe(
			"line one line two"
		);
	});
});

describe("parseHighlights", () => {
	it("returns non-empty highlights with their line indices", () => {
		const hs = parseHighlights(FILLED);
		expect(hs.map((h) => h.text)).toEqual([
			"nice walk to the waterfall",
			"called Mom",
		]);
		expect(hs[0].line).toBe(3);
		expect(hs[1].line).toBe(4);
	});
	it("ignores the empty placeholder field", () => {
		expect(parseHighlights(EMPTY)).toEqual([]);
	});
});

describe("addHighlight", () => {
	it("replaces the lone empty placeholder", () => {
		const out = addHighlight(EMPTY, "first highlight");
		expect(parseHighlights(out).map((h) => h.text)).toEqual([
			"first highlight",
		]);
		expect(out).not.toContain("highlights:: \n");
		// The rest of the note is untouched.
		expect(out).toContain("## Notes Created today");
	});

	it("appends after existing highlights, preserving trailing blank padding", () => {
		const out = addHighlight(FILLED, "chocolate store");
		const lines = out.split("\n");
		expect(parseHighlights(out).map((h) => h.text)).toEqual([
			"nice walk to the waterfall",
			"called Mom",
			"chocolate store",
		]);
		// Inserted directly after the last highlight, before the blank line.
		expect(lines[5]).toBe("highlights:: chocolate store");
		expect(lines[6]).toBe("");
	});

	it("collapses multi-line input into one field line", () => {
		const out = addHighlight(EMPTY, "one\ntwo");
		expect(parseHighlights(out).map((h) => h.text)).toEqual(["one two"]);
	});

	it("creates ## Highlights after ## Summary when the section is missing", () => {
		const note = [
			"# What Happened Today",
			"## Summary",
			"some summary text",
			"",
			"## Notes Created today",
		].join("\n");
		const out = addHighlight(note, "brand new");
		const lines = out.split("\n");
		const hIdx = lines.indexOf("## Highlights");
		const sIdx = lines.indexOf("## Summary");
		const nIdx = lines.indexOf("## Notes Created today");
		expect(hIdx).toBeGreaterThan(sIdx);
		expect(hIdx).toBeLessThan(nIdx);
		expect(parseHighlights(out).map((h) => h.text)).toEqual(["brand new"]);
	});

	it("appends a block at the end when there is no What Happened Today section", () => {
		const note = ["# Some Note", "body"].join("\n");
		const out = addHighlight(note, "orphan");
		expect(out).toContain("## Highlights");
		expect(parseHighlights(out).map((h) => h.text)).toEqual(["orphan"]);
	});
});

describe("editHighlight", () => {
	it("rewrites the matching field, leaving others intact", () => {
		const out = editHighlight(FILLED, "called Mom", "called Mom for an hour");
		expect(parseHighlights(out).map((h) => h.text)).toEqual([
			"nice walk to the waterfall",
			"called Mom for an hour",
		]);
	});
	it("no-ops when the text is not found", () => {
		expect(editHighlight(FILLED, "missing", "x")).toBe(FILLED);
	});
});

describe("deleteHighlight", () => {
	it("removes the matching field line", () => {
		const out = deleteHighlight(FILLED, "nice walk to the waterfall");
		expect(parseHighlights(out).map((h) => h.text)).toEqual(["called Mom"]);
	});
	it("no-ops when the text is not found", () => {
		expect(deleteHighlight(FILLED, "missing")).toBe(FILLED);
	});
});
