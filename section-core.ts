// section-core.ts — pure markdown section engine for the capture & sections views.
// No Obsidian imports; fully covered by tests/section-core.test.ts.
//
// A "section" is a heading line plus every line up to (not including) the next
// heading of equal-or-shallower level. Headings inside code fences and YAML
// frontmatter do not count. All write operations are targeted: they rebuild
// the file from untouched line slices, never re-serialise the whole note.

export interface Section {
	/** Full heading line as written, e.g. "### Do Today" */
	heading: string;
	level: number;
	/** Heading text without the hashes, trimmed */
	title: string;
	headingLine: number;
	/** First content line (headingLine + 1) */
	start: number;
	/** Exclusive: line index of the next heading at level <= this, or line count */
	end: number;
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;
const FENCE_RE = /^(```|~~~)/;

function stripCr(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

export function splitLines(content: string): string[] {
	return content.split("\n");
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

export function parseSections(content: string): Section[] {
	const lines = splitLines(content);
	const sections: Section[] = [];
	let inFence = false;
	for (let i = frontmatterEnd(lines); i < lines.length; i++) {
		const line = stripCr(lines[i]);
		if (FENCE_RE.test(line.trimStart())) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const m = HEADING_RE.exec(line);
		if (!m) continue;
		sections.push({
			heading: line,
			level: m[1].length,
			title: m[2],
			headingLine: i,
			start: i + 1,
			end: lines.length,
		});
	}
	for (let s = 0; s < sections.length; s++) {
		for (let t = s + 1; t < sections.length; t++) {
			if (sections[t].level <= sections[s].level) {
				sections[s].end = sections[t].headingLine;
				break;
			}
		}
	}
	return sections;
}

/**
 * Find a section by spec. A spec with hashes ("### Do Today") matches level
 * and title exactly; a bare title ("Do Today") matches the first heading with
 * that title at any level.
 */
export function findSection(content: string, spec: string): Section | null {
	const sections = parseSections(content);
	const m = HEADING_RE.exec(spec.trim());
	if (m) {
		const level = m[1].length;
		const title = m[2];
		return (
			sections.find((s) => s.level === level && s.title === title) ?? null
		);
	}
	const title = spec.trim();
	return sections.find((s) => s.title === title) ?? null;
}

/** The section's content text (without its heading line), or null if missing. */
export function sliceSection(content: string, spec: string): string | null {
	const sec = findSection(content, spec);
	if (!sec) return null;
	return splitLines(content).slice(sec.start, sec.end).join("\n");
}

/**
 * Append a line to a section: after the last non-blank content line, so the
 * blank-line padding Shawn's daily template keeps before the next heading is
 * preserved. A lone "-" placeholder bullet is replaced instead of kept. A
 * missing section is created at the end of the note (a bare-title spec gets
 * "## " prepended).
 */
export function appendToSection(
	content: string,
	spec: string,
	line: string
): string {
	const lines = splitLines(content);
	const sec = findSection(content, spec);
	if (!sec) {
		const headingLine = HEADING_RE.test(spec.trim())
			? spec.trim()
			: "## " + spec.trim();
		const out = [...lines];
		while (out.length > 0 && stripCr(out[out.length - 1]).trim() === "") {
			out.pop();
		}
		out.push("", headingLine, line, "");
		return out.join("\n");
	}
	let last = -1;
	for (let i = sec.start; i < sec.end; i++) {
		if (stripCr(lines[i]).trim() !== "") last = i;
	}
	if (last === -1) {
		return [
			...lines.slice(0, sec.start),
			line,
			...lines.slice(sec.start),
		].join("\n");
	}
	if (stripCr(lines[last]).trim() === "-") {
		return [...lines.slice(0, last), line, ...lines.slice(last + 1)].join(
			"\n"
		);
	}
	return [
		...lines.slice(0, last + 1),
		line,
		...lines.slice(last + 1),
	].join("\n");
}

/**
 * Replace a section's content (heading preserved). newText === "" empties the
 * section. Unknown spec returns the content unchanged — the caller decides
 * whether that is an error.
 */
export function replaceSection(
	content: string,
	spec: string,
	newText: string
): string {
	const sec = findSection(content, spec);
	if (!sec) return content;
	const lines = splitLines(content);
	const newLines = newText === "" ? [] : splitLines(newText);
	return [
		...lines.slice(0, sec.start),
		...newLines,
		...lines.slice(sec.end),
	].join("\n");
}

// ---- capture line formatting ----

export type CaptureKind = "thought" | "doToday" | "otherTask" | "log";

/**
 * Format captured text as a daily-note line. Thoughts and logs get a
 * timestamped bullet ("- HH:mm text"); tasks get an unchecked checkbox
 * (daily-note tasks carry no redundant creation date, per vault convention).
 * Extra lines in the text become two-space continuation lines under the
 * bullet so multi-line captures stay one list item.
 */
export function formatCaptureLine(
	kind: CaptureKind,
	text: string,
	hm: string
): string {
	const body = text.replace(/\r\n/g, "\n").trim();
	const [head, ...rest] = body.split("\n");
	const prefix =
		kind === "doToday" || kind === "otherTask" ? "- [ ] " : `- ${hm} `;
	const cont = rest.map((l) => (l.trim() === "" ? "" : "  " + l.trimEnd()));
	return [prefix + head, ...cont].join("\n");
}
