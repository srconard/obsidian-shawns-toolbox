// guiding-core.ts — pure logic for the Guiding Questions panel.
// No Obsidian imports, so it unit-tests against a fixture copy of the real
// "03. Personal/Guiding Questions.md".
//
// The panel now works like the Pillars / periodic-note panels: Shawn picks
// which of the note's sections to show and they render together (see
// guiding-view). This module owns the pure pieces — the ordered ring of
// selectable views and the selection toggle — plus the resilience the note
// still needs while it is lightly structured and Shawn is reorganising it:
//   - a note with NO headings collapses to a single "whole note" view rather
//     than breaking, and
//   - any non-blank content before the first heading is offered as a leading
//     "(top)" view so nothing is hidden.
// When real headings exist, each becomes its own selectable view.

import { parseSections } from "./section-core";

export type GuidingViewKind = "whole" | "preamble" | "section";

export interface GuidingView {
	kind: GuidingViewKind;
	/** Label for the chips / persistence key (must be unique within a note). */
	title: string;
	/** Full heading line for a "section" view (matches parseSections), else "". */
	heading: string;
	/** Heading depth (1–6) for chip indentation; 1 for whole/preamble views. */
	level: number;
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
		return [{ kind: "whole", title: "Whole note", heading: "", level: 1 }];
	}
	const views: GuidingView[] = [];
	const lines = content.split("\n");
	const fm = frontmatterEnd(lines);
	const preamble = lines
		.slice(fm, sections[0].headingLine)
		.join("\n")
		.trim();
	if (preamble !== "") {
		views.push({ kind: "preamble", title: "(top)", heading: "", level: 1 });
	}
	for (const sec of sections) {
		views.push({
			kind: "section",
			title: sec.title.trim() || sec.heading,
			heading: sec.heading,
			level: sec.level,
		});
	}
	return views;
}

/**
 * The subset of `views` the user has selected, in note order. Selection is
 * stored as a list of view titles; titles that no longer resolve (the note was
 * re-headed) are silently dropped, so a stale pick never breaks the panel.
 */
export function orderGuidingSelection(
	views: GuidingView[],
	selectedTitles: string[]
): GuidingView[] {
	const wanted = new Set(selectedTitles);
	return views.filter((v) => wanted.has(v.title));
}

/**
 * Toggle a title's membership in the selection and return the new selection as
 * a list of titles in note order — the shape persisted in settings (mirrors the
 * Pillars section-pick persistence).
 */
export function toggleGuidingSelection(
	views: GuidingView[],
	selectedTitles: string[],
	title: string
): string[] {
	const next = new Set(selectedTitles);
	if (next.has(title)) next.delete(title);
	else next.add(title);
	return views.map((v) => v.title).filter((t) => next.has(t));
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
