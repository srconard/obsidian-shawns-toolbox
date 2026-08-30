// highlights-core.ts — pure engine for the daily-note highlights feature.
// No Obsidian imports; fully covered by tests/highlights-core.test.ts.
//
// A "highlight" is a Dataview inline field line — `highlights:: <text>` — that
// lives under the `## Highlights` heading inside the `# What Happened Today`
// section of a daily note. All write operations are targeted: they rebuild the
// note from untouched line slices and never re-serialise the whole file.

import { splitLines, findSection, parseSections } from "./section-core";

export const HL_FIELD = "highlights";
export const HL_HEADING = "## Highlights";
const WHAT_HAPPENED = "# What Happened Today";
const SUMMARY_TITLE = "Summary";

const HL_RE = /^highlights::[ \t]*(.*)$/;

function stripCr(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** Collapse a highlight's text to a single line (inline fields are one line). */
export function normalizeHighlightText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Format captured text as a `highlights:: <text>` inline-field line. */
export function formatHighlightLine(text: string): string {
	return `${HL_FIELD}:: ${normalizeHighlightText(text)}`;
}

export interface Highlight {
	/** The field value, trimmed (never empty for parsed results). */
	text: string;
	/** 0-based line index in the note. */
	line: number;
}

/** True for a `highlights::` line whose value is empty (the template placeholder). */
function isPlaceholder(line: string): boolean {
	const m = HL_RE.exec(stripCr(line));
	return !!m && m[1].trim() === "";
}

/** Every non-empty `highlights::` line in the note, in document order. */
export function parseHighlights(content: string): Highlight[] {
	const lines = splitLines(content);
	const out: Highlight[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = HL_RE.exec(stripCr(lines[i]));
		if (!m) continue;
		const text = m[1].trim();
		if (text === "") continue;
		out.push({ text, line: i });
	}
	return out;
}

/**
 * Add a highlight. If a `## Highlights` section exists, the line is placed
 * after its last non-blank content line — but a lone empty `highlights::`
 * placeholder is replaced rather than kept. If the section is missing it is
 * created inside `# What Happened Today` (after `## Summary` when present),
 * falling back to the end of the note when that section is missing too.
 */
export function addHighlight(content: string, text: string): string {
	const line = formatHighlightLine(text);
	const lines = splitLines(content);
	const sec = findSection(content, HL_HEADING);

	if (sec) {
		// Replace a lone empty placeholder if that's all the section holds.
		let last = -1;
		let contentLines = 0;
		for (let i = sec.start; i < sec.end; i++) {
			if (stripCr(lines[i]).trim() !== "") {
				last = i;
				contentLines++;
			}
		}
		if (contentLines === 1 && last >= 0 && isPlaceholder(lines[last])) {
			return [
				...lines.slice(0, last),
				line,
				...lines.slice(last + 1),
			].join("\n");
		}
		if (last === -1) {
			return [
				...lines.slice(0, sec.start),
				line,
				...lines.slice(sec.start),
			].join("\n");
		}
		return [
			...lines.slice(0, last + 1),
			line,
			...lines.slice(last + 1),
		].join("\n");
	}

	// No `## Highlights` — create it inside `# What Happened Today`.
	const what = findSection(content, WHAT_HAPPENED);
	if (what) {
		const sections = parseSections(content);
		const summary = sections.find(
			(s) =>
				s.title === SUMMARY_TITLE &&
				s.headingLine >= what.headingLine &&
				s.headingLine < what.end
		);
		const insertAt = summary ? summary.end : what.start;
		return [
			...lines.slice(0, insertAt),
			HL_HEADING,
			line,
			...lines.slice(insertAt),
		].join("\n");
	}

	// No `# What Happened Today` either — append the block at the end.
	const out = [...lines];
	while (out.length > 0 && stripCr(out[out.length - 1]).trim() === "") {
		out.pop();
	}
	out.push("", HL_HEADING, line, "");
	return out.join("\n");
}

/** Locate the line index of the highlight whose value matches `text`. */
function findHighlightLine(lines: string[], text: string): number {
	const want = normalizeHighlightText(text);
	for (let i = 0; i < lines.length; i++) {
		const m = HL_RE.exec(stripCr(lines[i]));
		if (m && m[1].trim() === want) return i;
	}
	return -1;
}

/**
 * Rewrite the highlight whose current value equals `oldText` to `newText`.
 * Returns the content unchanged if no matching line is found.
 */
export function editHighlight(
	content: string,
	oldText: string,
	newText: string
): string {
	const lines = splitLines(content);
	const idx = findHighlightLine(lines, oldText);
	if (idx < 0) return content;
	lines[idx] = formatHighlightLine(newText);
	return lines.join("\n");
}

/**
 * Remove the highlight whose value equals `oldText`. Returns the content
 * unchanged when no matching line is found.
 */
export function deleteHighlight(content: string, oldText: string): string {
	const lines = splitLines(content);
	const idx = findHighlightLine(lines, oldText);
	if (idx < 0) return content;
	return [...lines.slice(0, idx), ...lines.slice(idx + 1)].join("\n");
}
