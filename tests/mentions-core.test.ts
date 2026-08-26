import { describe, it, expect } from "vitest";
import {
	linkTargets,
	isBareLinkLine,
	extractSubtree,
	extractInlineMentions,
	derivableDate,
} from "../mentions-core";

describe("linkTargets", () => {
	it("extracts wikilink targets in order, stripping alias and heading", () => {
		expect(
			linkTargets("saw [[Sharky|the shark]] near [[land#north]] today")
		).toEqual(["Sharky", "land"]);
	});

	it("returns [] for a line with no links", () => {
		expect(linkTargets("just some prose")).toEqual([]);
	});

	it("keeps duplicates (dedupe is the caller's job)", () => {
		expect(linkTargets("[[a]] and [[a]]")).toEqual(["a", "a"]);
	});
});

describe("isBareLinkLine", () => {
	it("is true for a plain list of links", () => {
		expect(isBareLinkLine("[[a]], [[b]], [[c]]")).toBe(true);
	});

	it("is true for a bulleted link entry", () => {
		expect(isBareLinkLine("- [[Sharky]]")).toBe(true);
	});

	it("is true for a link entry with a time prefix", () => {
		expect(isBareLinkLine("- 14:30 [[Sharky]]")).toBe(true);
	});

	it("treats a label word as prose but pure separators+links as bare", () => {
		expect(isBareLinkLine("Links: [[a]] · [[b]]")).toBe(false); // the word "Links" is content
		expect(isBareLinkLine("- [[a]] / [[b]] — [[c]]")).toBe(true);
	});

	it("is false when prose surrounds the link", () => {
		expect(isBareLinkLine("thinking about [[Sharky]] tonight")).toBe(false);
	});

	it("is false for a task line that is just a link (task text matters)", () => {
		// A checkbox with only a link is still bare content-wise.
		expect(isBareLinkLine("- [ ] [[Sharky]]")).toBe(true);
	});
});

describe("extractSubtree", () => {
	it("returns the deeper-indented child run of a parent bullet", () => {
		const lines = [
			"- parent [[Sharky]]",
			"    - child one",
			"    - child two",
			"        - grandchild",
			"- sibling",
		];
		expect(extractSubtree(lines, 0)).toEqual([
			"    - child one",
			"    - child two",
			"        - grandchild",
		]);
	});

	it("stops at a blank line", () => {
		const lines = ["- parent [[x]]", "    - child", "", "    - not included"];
		expect(extractSubtree(lines, 0)).toEqual(["    - child"]);
	});

	it("stops at a line of equal or shallower indent", () => {
		const lines = ["- parent", "    - child", "- next parent"];
		expect(extractSubtree(lines, 0)).toEqual(["    - child"]);
	});

	it("returns [] when the parent line is not a list bullet", () => {
		const lines = ["plain paragraph [[x]]", "    indented continuation"];
		expect(extractSubtree(lines, 0)).toEqual([]);
	});
});

describe("extractInlineMentions", () => {
	const isSharky = (t: string) => t.toLowerCase() === "sharky";

	it("captures a prose mention with no subtree", () => {
		const content = "I was thinking about [[Sharky]] today.";
		const out = extractInlineMentions(content, isSharky);
		expect(out).toHaveLength(1);
		expect(out[0].line).toBe(0);
		expect(out[0].text).toBe("I was thinking about [[Sharky]] today.");
		expect(out[0].subtree).toEqual([]);
	});

	it("captures a parent bullet mention with its child subtree", () => {
		const content = [
			"# Thoughts",
			"- talked with [[Sharky]] about the plan",
			"    - he wants the rich mentions view",
			"    - and a threads block",
			"- unrelated line",
		].join("\n");
		const out = extractInlineMentions(content, isSharky);
		expect(out).toHaveLength(1);
		expect(out[0].line).toBe(1);
		expect(out[0].subtree).toEqual([
			"    - he wants the rich mentions view",
			"    - and a threads block",
		]);
	});

	it("excludes a bare link-list entry", () => {
		const content = ["## Links", "- [[Sharky]]", "- [[land]]"].join("\n");
		expect(extractInlineMentions(content, isSharky)).toEqual([]);
	});

	it("ignores lines whose links do not resolve to the target", () => {
		const content = "see [[land]] and [[money]] here";
		expect(extractInlineMentions(content, isSharky)).toEqual([]);
	});

	it("captures multiple distinct mentions", () => {
		const content = [
			"morning note about [[Sharky]]",
			"",
			"later, [[Sharky]] again in a sentence",
		].join("\n");
		const out = extractInlineMentions(content, isSharky);
		expect(out.map((m) => m.line)).toEqual([0, 2]);
	});
});

describe("derivableDate", () => {
	it("returns the date for a daily-note basename", () => {
		expect(derivableDate("2026-08-26")).toBe("2026-08-26");
	});

	it("returns null for a non-daily basename", () => {
		expect(derivableDate("Sharky")).toBeNull();
		expect(derivableDate("walk dancing")).toBeNull();
	});
});
