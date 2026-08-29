import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
	guidingViews,
	sliceGuidingView,
	orderGuidingSelection,
	toggleGuidingSelection,
} from "../guiding-core";

const fixture = readFileSync(
	new URL("./fixtures/guiding-questions.md", import.meta.url),
	"utf8"
);

describe("guidingViews — against the real Guiding Questions.md fixture", () => {
	it("cycles one view per heading, in note order", () => {
		expect(guidingViews(fixture).map((v) => v.title)).toEqual([
			"Questions",
			"top questions",
			"other",
			"Guiding question Table",
			"Todo",
			"notes",
			"Thoughts",
			"Links",
			"inbox",
			"Related",
		]);
	});

	it("marks every view a section (the note has no preamble)", () => {
		expect(guidingViews(fixture).every((v) => v.kind === "section")).toBe(
			true
		);
	});

	it("slices a section view to its own heading + body", () => {
		const views = guidingViews(fixture);
		const todo = views.find((v) => v.title === "Todo")!;
		const slice = sliceGuidingView(fixture, todo);
		expect(slice.startsWith("# Todo")).toBe(true);
		expect(slice).toContain("What is my big guiding question");
		// Stops before the next heading.
		expect(slice).not.toContain("# notes");
	});
});

describe("guidingViews — resilience", () => {
	it("collapses a heading-less note to a single whole-note view", () => {
		const views = guidingViews("just some\nloose thoughts\nno headings\n");
		expect(views).toHaveLength(1);
		expect(views[0].kind).toBe("whole");
		expect(views[0].title).toBe("Whole note");
	});

	it("renders the whole-note view without its frontmatter", () => {
		const note = "---\ntags: [x]\n---\nbody line\nmore\n";
		const views = guidingViews(note);
		expect(views[0].kind).toBe("whole");
		const slice = sliceGuidingView(note, views[0]);
		expect(slice).toBe("body line\nmore\n");
	});

	it("offers a leading (top) view when non-blank content precedes the first heading", () => {
		const note = "intro paragraph\n\n# First\nbody\n";
		const views = guidingViews(note);
		expect(views.map((v) => v.title)).toEqual(["(top)", "First"]);
		expect(sliceGuidingView(note, views[0]).trim()).toBe("intro paragraph");
	});

	it("does not add a (top) view for blank-only preamble", () => {
		const note = "\n\n# First\nbody\n";
		expect(guidingViews(note).map((v) => v.kind)).toEqual(["section"]);
	});

	it("returns empty string for a stale section heading no longer present", () => {
		const stale = {
			kind: "section" as const,
			title: "Gone",
			heading: "# Gone",
			level: 1,
		};
		expect(sliceGuidingView("# Here\nbody\n", stale)).toBe("");
	});

	it("carries each section's heading level for chip indentation", () => {
		const views = guidingViews("# A\nx\n## B\ny\n");
		expect(views.map((v) => [v.title, v.level])).toEqual([
			["A", 1],
			["B", 2],
		]);
	});
});

describe("guiding selection — multi-section picks", () => {
	const views = guidingViews(fixture);

	it("keeps picked sections in note order regardless of selection order", () => {
		const picked = orderGuidingSelection(views, ["Todo", "Questions"]);
		expect(picked.map((v) => v.title)).toEqual(["Questions", "Todo"]);
	});

	it("drops a stale title that no longer resolves", () => {
		const picked = orderGuidingSelection(views, ["Questions", "Ghost"]);
		expect(picked.map((v) => v.title)).toEqual(["Questions"]);
	});

	it("toggling adds a title (note order) and removes it again", () => {
		const added = toggleGuidingSelection(views, ["Todo"], "Questions");
		expect(added).toEqual(["Questions", "Todo"]);
		const removed = toggleGuidingSelection(views, added, "Questions");
		expect(removed).toEqual(["Todo"]);
	});

	it("returns an empty selection with no picks", () => {
		expect(orderGuidingSelection(views, [])).toEqual([]);
	});
});
