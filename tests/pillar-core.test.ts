import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
	parsePillars,
	wheelPosition,
	wheelIndex,
	wrapIndex,
} from "../pillar-core";

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

describe("wrapIndex — slot-reel endless loop", () => {
	it("passes an in-range index through", () => {
		expect(wrapIndex(3, 16)).toBe(3);
	});

	it("wraps past the end back to the start", () => {
		expect(wrapIndex(16, 16)).toBe(0);
		expect(wrapIndex(18, 16)).toBe(2);
	});

	it("wraps past the start back to the end", () => {
		expect(wrapIndex(-1, 16)).toBe(15);
		expect(wrapIndex(-18, 16)).toBe(14);
	});

	it("rounds a fractional index before wrapping", () => {
		expect(wrapIndex(2.4, 16)).toBe(2);
		expect(wrapIndex(-0.4, 16)).toBe(0);
		expect(wrapIndex(15.6, 16)).toBe(0); // rounds to 16 → wraps to 0
	});

	it("returns 0 for an empty list", () => {
		expect(wrapIndex(5, 0)).toBe(0);
	});
});

describe("wheelPosition — amplified reel spin (fractional, unwrapped)", () => {
	it("stays put with no vertical movement", () => {
		expect(wheelPosition(5, 0, 16, 240)).toBe(5);
	});

	it("spins the reel to follow the finger: DOWN decreases, UP increases", () => {
		// travel 240 over 16 items → 15px per item. Dragging DOWN spins earlier
		// items into the centre (position decreases).
		expect(wheelPosition(5, 30, 16, 240)).toBe(3); // +30px down → -2 items
		expect(wheelPosition(5, -45, 16, 240)).toBe(8); // -45px up → +3 items
	});

	it("is amplified: a full-travel drag spins a whole turn", () => {
		expect(wheelPosition(0, -240, 16, 240)).toBe(16); // one full loop up
		expect(wheelPosition(0, 240, 16, 240)).toBe(-16); // one full loop down
	});

	it("returns 0 for an empty or single-item list", () => {
		expect(wheelPosition(0, 100, 0, 240)).toBe(0);
		expect(wheelPosition(0, 100, 1, 240)).toBe(0);
	});
});

describe("wheelIndex — the pillar centred in the selector", () => {
	it("centres the current pillar with no movement", () => {
		expect(wheelIndex(5, 0, 16, 240)).toBe(5);
	});

	it("wraps around endlessly so every item is reachable from any start", () => {
		// Dragging UP from item 0 keeps advancing and loops past the end.
		expect(wheelIndex(0, -240, 16, 240)).toBe(0); // exactly one loop
		expect(wheelIndex(0, -270, 16, 240)).toBe(2); // one loop + 2
		// Dragging DOWN from item 0 loops back to the end.
		expect(wheelIndex(0, 30, 16, 240)).toBe(14); // -2 → wraps to 14
	});

	it("rounds to the nearest item", () => {
		// 24px / 15px-per-item = 1.6 → -2 items (down decreases).
		expect(wheelIndex(4, 24, 16, 240)).toBe(2);
	});

	it("returns 0 for an empty or single-item list", () => {
		expect(wheelIndex(0, 100, 0, 240)).toBe(0);
		expect(wheelIndex(0, 100, 1, 240)).toBe(0);
	});
});
