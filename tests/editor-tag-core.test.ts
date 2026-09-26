import { describe, it, expect } from "vitest";
import { tagAtPosition, tagInSelection, tagSpans } from "../editor-tag-core";
import { removeTag } from "../thread-core";

describe("tagSpans", () => {
	it("finds tags with their spans", () => {
		const line = "- 09:00 idea #thread/flow/dance more #todo";
		expect(tagSpans(line)).toEqual([
			{ tag: "#thread/flow/dance", start: 13, end: 31 },
			{ tag: "#todo", start: 37, end: 42 },
		]);
	});

	it("stops a tag at punctuation", () => {
		expect(tagSpans("see #idea, then").map((s) => s.tag)).toEqual(["#idea"]);
	});

	it("ignores headings, link anchors, URLs and numbers", () => {
		expect(tagSpans("# Heading")).toEqual([]);
		expect(tagSpans("[[note#heading]] and [[n#^abc]]")).toEqual([]);
		expect(tagSpans("http://x.com/#anchor")).toEqual([]);
		expect(tagSpans("issue #123")).toEqual([]);
		expect(tagSpans("#2026-goal").map((s) => s.tag)).toEqual(["#2026-goal"]);
	});

	it("allows non-ASCII tags", () => {
		expect(tagSpans("a #café b").map((s) => s.tag)).toEqual(["#café"]);
	});
});

describe("tagAtPosition", () => {
	const line = "- 09:00 idea #thread/flow more";
	it("finds the tag under any character, edges included", () => {
		expect(tagAtPosition(line, 13)?.tag).toBe("#thread/flow");
		expect(tagAtPosition(line, 20)?.tag).toBe("#thread/flow");
		expect(tagAtPosition(line, 25)?.tag).toBe("#thread/flow");
	});
	it("returns null off the tag", () => {
		expect(tagAtPosition(line, 3)).toBeNull();
		expect(tagAtPosition(line, 28)).toBeNull();
	});
});

describe("tagInSelection", () => {
	const line = "- idea #thread/flow/dance x";
	it("a word selected inside the tag (phone long-press) finds it", () => {
		expect(tagInSelection(line, 8, 14)?.tag).toBe("#thread/flow/dance");
	});
	it("a selection covering the tag finds it", () => {
		expect(tagInSelection(line, 6, 26)?.tag).toBe("#thread/flow/dance");
	});
	it("a selection elsewhere does not", () => {
		expect(tagInSelection(line, 0, 4)).toBeNull();
	});
});

describe("removing the found tag uses the v1.50.0 line edit", () => {
	it("removes exactly that token", () => {
		const line = "- 09:00 idea #thread/flow #thread/flowers ^ab1";
		const t = tagAtPosition(line, 15)!;
		expect(removeTag(line, t.tag)).toBe("- 09:00 idea #thread/flowers ^ab1");
	});
});
