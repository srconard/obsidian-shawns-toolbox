import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parsePillars } from "../pillar-core";

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
