import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parsePillars, scrubIndex } from "../pillar-core";

const fixture = readFileSync(
	new URL("./fixtures/pillars.md", import.meta.url),
	"utf8"
);

describe("parsePillars — against the real Pillars.md fixture", () => {
	it("extracts exactly the 16 pillars in note order", () => {
		expect(parsePillars(fixture).map((p) => p.link)).toEqual([
			"01. Physical Health",
			"02. Avoid Addiction",
			"03. Ecology of practices - Connection to Sacred",
			"Creativity - Art and Invention",
			"Relationships - Friends and Family",
			"Intimate Relationship",
			"Personal Growth and Learning",
			"Leisure, Rest, and Experience",
			"Long-Term Goals and future vision",
			"15. Nature",
			"09. Community and Volunteering",
			"10. Home and Environment",
			"11. Financial Management",
			"12. Work and Career",
			"13. Collaboration, Coordination, and Distributed Cognition",
			"14. Life management System",
		]);
	});

	it("includes a leading link even when trailing plain commentary follows it", () => {
		// "[[12. Work and Career]], gameA work" is a pillar; the comma-comment
		// after the link must not exclude it.
		expect(parsePillars(fixture).map((p) => p.link)).toContain(
			"12. Work and Career"
		);
	});

	it("excludes dates, pre-subsection links, indented sub-bullets, and prose lines", () => {
		const links = parsePillars(fixture).map((p) => p.link);
		expect(links).not.toContain("non negotiables"); // before the first ## subsection
		expect(links).not.toContain("Dashboard - organization"); // prose: leading link + more links
		expect(links).not.toContain("Open Source"); // indented sub-bullet
		expect(links).not.toContain("GameB"); // indented sub-bullet
		expect(links).not.toContain("Play"); // indented sub-bullet
		expect(links).not.toContain("sustainable"); // does not lead the line
		expect(links.some((l) => /^\d{4}-\d{2}-\d{2}$/.test(l))).toBe(false);
	});
});

describe("parsePillars — edge cases", () => {
	it("returns [] when there is no # Pillars heading", () => {
		expect(parsePillars("# Other\n## A\n[[Foo]]\n")).toEqual([]);
	});

	it("stops at the next H1 heading", () => {
		expect(
			parsePillars("# Pillars\n## A\n[[One]]\n# Next\n[[Two]]").map(
				(p) => p.link
			)
		).toEqual(["One"]);
	});

	it("does not treat ## subsection headings as the end of the section", () => {
		expect(
			parsePillars("# Pillars\n## A\n[[One]]\n## B\n[[Two]]").map(
				(p) => p.link
			)
		).toEqual(["One", "Two"]);
	});

	it("honours wikilink aliases and strips heading anchors", () => {
		expect(
			parsePillars("# Pillars\n## A\n[[Real Path|Nice Name]]\n[[Note#Section]]")
		).toEqual([
			{ link: "Real Path", display: "Nice Name" },
			{ link: "Note", display: "Note" },
		]);
	});

	it("accepts top-level bullet links but rejects indented ones", () => {
		expect(
			parsePillars("# Pillars\n## A\n- [[Top]]\n\t- [[Nested]]").map(
				(p) => p.link
			)
		).toEqual(["Top"]);
	});

	it("excludes links that do not lead the line", () => {
		expect(
			parsePillars("# Pillars\n## A\nsome text [[Foo]]").map((p) => p.link)
		).toEqual([]);
	});
});

describe("scrubIndex — hold-and-drag amplified selection", () => {
	it("stays put with no vertical movement", () => {
		expect(scrubIndex(5, 0, 16, 240)).toBe(5);
	});

	it("advances the index when dragging down, retreats when dragging up", () => {
		// travel 240 over 16 items → 16px per item.
		expect(scrubIndex(5, 32, 16, 240)).toBe(7); // +2 items
		expect(scrubIndex(5, -48, 16, 240)).toBe(2); // -3 items
	});

	it("is amplified: a full-travel drag spans the whole list", () => {
		expect(scrubIndex(0, 240, 16, 240)).toBe(15);
		expect(scrubIndex(15, -240, 16, 240)).toBe(0);
	});

	it("clamps to valid indices at both ends", () => {
		expect(scrubIndex(0, -500, 16, 240)).toBe(0);
		expect(scrubIndex(15, 500, 16, 240)).toBe(15);
	});

	it("rounds to the nearest item", () => {
		// 20px / 16px-per-item = 1.25 → rounds to +1.
		expect(scrubIndex(4, 20, 16, 240)).toBe(5);
		// 24px / 16 = 1.5 → rounds to +2.
		expect(scrubIndex(4, 24, 16, 240)).toBe(6);
	});

	it("returns 0 for an empty or single-item list", () => {
		expect(scrubIndex(0, 100, 0, 240)).toBe(0);
		expect(scrubIndex(0, 100, 1, 240)).toBe(0);
	});
});
