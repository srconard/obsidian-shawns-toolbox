// mentions-core.ts — pure engine for the "Rich mentions" note footer. Given a
// source note's text and a predicate that resolves a wikilink target to whether
// it points at the note being viewed, it extracts the *inline* mentions: links
// that sit inside a sentence/thought line (excluding bare link-list entries like
// the "Links" lists at the bottom of a note), each with the full line and — when
// the line is a parent bullet — its whole child subtree. No Obsidian imports;
// covered by tests/mentions-core.test.ts.
//
// The vault-wide "which notes link here" scan belongs to the Obsidian layer
// (metadataCache.resolvedLinks); this module only classifies + extracts within a
// single source note's text.
import { splitLines } from "./section-core";

export interface InlineMention {
	/** Zero-based line number of the mention line in its source note. */
	line: number;
	/** The mention line as written (trailing whitespace trimmed). */
	text: string;
	/** Child lines forming the thought subtree when the mention line is a parent
	 *  bullet with more-indented children; [] otherwise. Verbatim (trailing
	 *  whitespace trimmed), indentation preserved. */
	subtree: string[];
}

// A wikilink: [[target]], [[target|alias]], [[target#heading]].
const WIKILINK_RE = /\[\[([^\]]+?)\]\]/g;
// A leading list marker (bullet or ordered), with an optional task checkbox.
const LIST_MARKER_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX>/\-]\]\s+)?/;
// A "HH:MM" time prefix (after any list marker has been stripped).
const LEADING_TIME_RE = /^(\d{1,2}:\d{2})\b\s*/;

function stripCr(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** Wikilink targets on a line (the part before `#`/`|`), in order, deduped-free. */
export function linkTargets(line: string): string[] {
	const out: string[] = [];
	const re = new RegExp(WIKILINK_RE.source, "g");
	let m: RegExpExecArray | null;
	while ((m = re.exec(line))) {
		const target = m[1].split("|")[0].split("#")[0].trim();
		if (target) out.push(target);
	}
	return out;
}

/** Leading indentation width of a line (tab counts as one). */
function indentWidth(line: string): number {
	const m = /^[ \t]*/.exec(line);
	return m ? m[0].length : 0;
}

function isBlank(line: string): boolean {
	return stripCr(line).trim() === "";
}

/**
 * Whether a line is a *bare* link entry — its only meaningful content is one or
 * more wikilinks (the "Links" lists at the bottom of a note). Strips the
 * wikilinks, a leading list/blockquote/heading marker and time, and the
 * separators/punctuation that glue a link list together; if nothing substantive
 * remains the line is bare and is excluded from rich mentions.
 */
export function isBareLinkLine(line: string): boolean {
	let t = stripCr(line);
	t = t.replace(LIST_MARKER_RE, "");
	t = t.replace(/^\s*>+\s*/, ""); // blockquote marker
	t = t.replace(/^\s*#{1,6}\s+/, ""); // heading marker
	t = t.replace(LEADING_TIME_RE, "");
	t = t.replace(WIKILINK_RE, "");
	// Whatever remains between/around the links: commas, bullets, dashes, a
	// trailing colon, etc. If it reduces to nothing, the line was just links.
	const leftover = t.replace(/[\s,;:|/•·—–\-]+/g, "").trim();
	return leftover === "";
}

/**
 * The child subtree of a parent bullet: the contiguous run of following lines
 * indented deeper than the parent, stopping at the first blank line or a line at
 * the parent's indentation or shallower. Returns [] when the parent line is not
 * a list bullet (a mention in a plain paragraph has no subtree).
 */
export function extractSubtree(lines: string[], parentIdx: number): string[] {
	const parent = stripCr(lines[parentIdx] ?? "");
	if (!LIST_MARKER_RE.test(parent)) return [];
	const parentIndent = indentWidth(parent);
	const kids: string[] = [];
	for (let i = parentIdx + 1; i < lines.length; i++) {
		const line = stripCr(lines[i]);
		if (isBlank(line)) break;
		if (indentWidth(line) <= parentIndent) break;
		kids.push(line.replace(/\s+$/, ""));
	}
	return kids;
}

/**
 * Extract every inline mention of the target note in `content`. `isTarget`
 * decides whether a wikilink target resolves to the viewed note (the Obsidian
 * layer resolves paths/aliases). A line qualifies when it carries a resolving
 * link AND is not a bare link-list entry.
 */
export function extractInlineMentions(
	content: string,
	isTarget: (linkTarget: string) => boolean
): InlineMention[] {
	const lines = splitLines(content);
	const out: InlineMention[] = [];
	for (let i = 0; i < lines.length; i++) {
		const raw = stripCr(lines[i]);
		const targets = linkTargets(raw);
		if (targets.length === 0) continue;
		if (!targets.some((t) => isTarget(t))) continue;
		if (isBareLinkLine(raw)) continue;
		out.push({
			line: i,
			text: raw.replace(/\s+$/, ""),
			subtree: extractSubtree(lines, i),
		});
	}
	return out;
}

const DAILY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Date derivable from a source note's basename: a daily note (YYYY-MM-DD) is
 *  its own date; any other note has no derivable date. */
export function derivableDate(noteBasename: string): string | null {
	return DAILY_RE.test(noteBasename) ? noteBasename : null;
}
