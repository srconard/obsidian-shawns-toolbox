import { describe, it, expect } from "vitest";
import {
	extractFirstUrl,
	resourceLinkTarget,
	sanitizeAlias,
	formatResourceBlock,
} from "../filing-core";
import { appendToSection, sliceSection } from "../section-core";

describe("extractFirstUrl", () => {
	it("pulls the first http(s) URL out of shared text", () => {
		expect(extractFirstUrl("check this https://x.com/a/status/1 out")).toBe(
			"https://x.com/a/status/1"
		);
		expect(extractFirstUrl("https://example.com/essay")).toBe(
			"https://example.com/essay"
		);
	});
	it("trims trailing sentence punctuation", () => {
		expect(extractFirstUrl("see https://x.com/a/status/1.")).toBe(
			"https://x.com/a/status/1"
		);
		expect(extractFirstUrl("(https://x.com/a/status/1)")).toBe(
			"https://x.com/a/status/1"
		);
	});
	it("returns null when there is no URL", () => {
		expect(extractFirstUrl("just some text")).toBeNull();
		expect(extractFirstUrl("")).toBeNull();
	});
});

describe("resourceLinkTarget", () => {
	it("is the basename without the .md extension", () => {
		expect(
			resourceLinkTarget("Library/Media Inbox/2026-09-04 A Title.md")
		).toBe("2026-09-04 A Title");
		expect(resourceLinkTarget("Note.md")).toBe("Note");
	});
});

describe("sanitizeAlias", () => {
	it("strips wikilink-breaking characters and collapses whitespace", () => {
		expect(sanitizeAlias("A [weird] | title # here")).toBe(
			"A weird title here"
		);
		expect(sanitizeAlias("line one\nline two")).toBe("line one line two");
	});
});

describe("formatResourceBlock", () => {
	const main = {
		note: "Library/Media Inbox/2026-09-04 The Take.md",
		title: "The Take",
	};

	it("formats a lone resource with its provenance date", () => {
		expect(formatResourceBlock(main, [], "2026-09-04")).toBe(
			"- [[2026-09-04 The Take|The Take]] >[[2026-09-04]]"
		);
	});

	it("nests referenced resources as indented child bullets", () => {
		const children = [
			{ note: "Library/Media Inbox/2026-09-04 Quoted.md", title: "Quoted", kind: "tweet" },
			{ note: "Library/Media Inbox/2026-09-04 Linked.md", title: "Linked", kind: "article" },
		];
		expect(formatResourceBlock(main, children, "2026-09-04")).toBe(
			[
				"- [[2026-09-04 The Take|The Take]] >[[2026-09-04]]",
				"\t- [[2026-09-04 Quoted|Quoted]]",
				"\t- [[2026-09-04 Linked|Linked]]",
			].join("\n")
		);
	});

	it("indents each quoted level by its depth (quote of a quote of a quote)", () => {
		const children = [
			{ note: "Library/Media Inbox/2026-09-09 Quoted.md", title: "Quoted", kind: "tweet", depth: 1 },
			{ note: "Library/Media Inbox/2026-09-09 Deeper.md", title: "Deeper", kind: "tweet", depth: 2 },
			{ note: "Library/Media Inbox/2026-09-09 Deepest.md", title: "Deepest", kind: "tweet", depth: 3 },
			{ note: "Library/Media Inbox/2026-09-09 Linked.md", title: "Linked", kind: "article", depth: 1 },
		];
		expect(formatResourceBlock(main, children, "2026-09-09")).toBe(
			[
				"- [[2026-09-04 The Take|The Take]] >[[2026-09-09]]",
				"\t- [[2026-09-09 Quoted|Quoted]]",
				"\t\t- [[2026-09-09 Deeper|Deeper]]",
				"\t\t\t- [[2026-09-09 Deepest|Deepest]]",
				"\t- [[2026-09-09 Linked|Linked]]",
			].join("\n")
		);
	});

	it("clamps a hostile or nonsense depth into the tree instead of exploding it", () => {
		const children = [
			{ note: "a.md", title: "A", depth: 0 },
			{ note: "b.md", title: "B", depth: 99 },
			{ note: "c.md", title: "C", depth: -3 },
			{ note: "d.md", title: "D", depth: Number.NaN },
		];
		expect(formatResourceBlock(main, children, "2026-09-09")).toBe(
			[
				"- [[2026-09-04 The Take|The Take]] >[[2026-09-09]]",
				"\t- [[a|A]]",
				"\t\t\t\t\t- [[b|B]]",
				"\t- [[c|C]]",
				"\t- [[d|D]]",
			].join("\n")
		);
	});

	it("appends cleanly under a # Resources section, creating it when missing", () => {
		const note = ["---", "type: note", "---", "", "# Notes", "", "some text", ""].join("\n");
		const block = formatResourceBlock(main, [], "2026-09-04");
		const out = appendToSection(note, "# Resources", block);
		expect(out).toContain("# Resources");
		expect(sliceSection(out, "# Resources")).toContain(
			"- [[2026-09-04 The Take|The Take]] >[[2026-09-04]]"
		);
		// A second filing lands under the same section, not a new one.
		const out2 = appendToSection(out, "# Resources", "- [[2026-09-04 Another|Another]] >[[2026-09-04]]");
		expect(out2.match(/^# Resources$/gm)?.length).toBe(1);
	});
});
