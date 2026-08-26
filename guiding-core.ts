// guiding-core.ts — pure logic for the Guiding Questions panel's flip ring.
// No Obsidian imports, so it unit-tests against a fixture copy of the real
// "03. Personal/Guiding Questions.md".
//
// The panel flips through the source note one section at a time, the way the
// Pillars panel flips through pillars. Resilience is the point: the note is
// lightly structured today and Shawn will reorganise it later, so
//   - a note with NO headings collapses to a single "whole note" view rather
//     than breaking, and
//   - any non-blank content before the first heading is offered as a leading
//     "(top)" view so nothing is hidden.
// When real headings exist, section-cycling kicks in (one view per heading).

import { parseSections } from "./section-core";

export type GuidingViewKind = "whole" | "preamble" | "section";

export interface GuidingView {
	kind: GuidingViewKind;
	/** Label for the dropdown / nav row; also the last-viewed persistence key. */
	title: string;
	/** Full heading line for a "section" view (matches parseSections), else "". */
	heading: string;
}

function stripCr(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** Index of the first line after the closing frontmatter delimiter, or 0. */
function frontmatterEnd(lines: string[]): number {
	if (stripCr(lines[0] ?? "") !== "---") return 0;
	for (let i = 1; i < lines.length; i++) {
		const l = stripCr(lines[i]);
		if (l === "---" || l === "...") return i + 1;
	}
	return 0; // unterminated — treat as no frontmatter
}

/**
 * The ordered ring of flip-able views for the note. Never empty: a note with no
 * headings yields a single "whole note" view.
 */
export function guidingViews(content: string): GuidingView[] {
	const sections = parseSections(content);
	if (sections.length === 0) {
		return [{ kind: "whole", title: "Whole note", heading: "" }];
	}
	const views: GuidingView[] = [];
	const lines = content.split("\n");
	const fm = frontmatterEnd(lines);
	const preamble = lines
		.slice(fm, sections[0].headingLine)
		.join("\n")
		.trim();
	if (preamble !== "") {
		views.push({ kind: "preamble", title: "(top)", heading: "" });
	}
	for (const sec of sections) {
		views.push({
			kind: "section",
			title: sec.title.trim() || sec.heading,
			heading: sec.heading,
		});
	}
	return views;
}

/**
 * The markdown to render for a view. Frontmatter is stripped from the whole /
 * preamble views so the raw `---` block never renders. A section view includes
 * its own heading line so the card shows the heading for context.
 */
export function sliceGuidingView(content: string, view: GuidingView): string {
	const lines = content.split("\n");
	const fm = frontmatterEnd(lines);
	if (view.kind === "whole") {
		return lines.slice(fm).join("\n");
	}
	const sections = parseSections(content);
	if (view.kind === "preamble") {
		const end = sections.length ? sections[0].headingLine : lines.length;
		return lines.slice(fm, end).join("\n");
	}
	const sec = sections.find((s) => s.heading === view.heading);
	if (!sec) return "";
	return lines.slice(sec.headingLine, sec.end).join("\n");
}
