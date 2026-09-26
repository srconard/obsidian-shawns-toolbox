// editor-tag-core.ts — find the #tag under a position in an editor line
// (v1.51.0). No Obsidian imports; covered by tests/editor-tag-core.test.ts.
//
// Feeds the "Remove #tag" item the plugin adds to Obsidian's own editor
// context menu (long-press on the phone, right-click on desktop). The removal
// itself is thread-core's removeTag — the same line edit as v1.50.0.

/** A tag token on a line: its text and its [start, end) character span. */
export interface TagSpan {
	tag: string;
	start: number;
	end: number;
}

// Obsidian's tag body: anything but whitespace and the punctuation Obsidian
// ends a tag on. Letters in any script, digits, _, - and / are all allowed.
const TAG_BODY = "[^\\s!\"#$%&'()*+,.:;<=>?@^`{|}~\\[\\]\\\\]+";

/**
 * Every tag token on a line, in order. A tag must start the line or follow
 * whitespace (so [[note#heading]] and URL anchors never count), and must hold
 * at least one non-digit character (#123 is not a tag in Obsidian). A heading
 * marker ("# Title") has no body and never matches.
 */
export function tagSpans(line: string): TagSpan[] {
	const re = new RegExp(`(^|\\s)(#${TAG_BODY})`, "g");
	const out: TagSpan[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(line))) {
		const tag = m[2];
		const start = m.index + m[1].length;
		if (!/[^0-9#]/.test(tag)) continue;
		out.push({ tag, start, end: start + tag.length });
	}
	return out;
}

/**
 * The tag at character `ch` of `line`, or null. A position at either edge of
 * the token counts (a cursor just after "#tag" or just before its "#"), so a
 * long-press that lands on the tag's first or last character still finds it.
 */
export function tagAtPosition(line: string, ch: number): TagSpan | null {
	for (const s of tagSpans(line)) if (ch >= s.start && ch <= s.end) return s;
	return null;
}

/**
 * The tag a selection points at: the one the selection lies inside or covers.
 * Handles the phone case, where a long-press selects a word — often only the
 * "thread" part of "#thread/x", which still lies inside the tag's span.
 */
export function tagInSelection(line: string, from: number, to: number): TagSpan | null {
	const lo = Math.min(from, to);
	const hi = Math.max(from, to);
	for (const s of tagSpans(line)) {
		if (lo >= s.start && hi <= s.end) return s; // selection inside the tag
		if (lo <= s.start && hi >= s.end) return s; // selection covers the tag
	}
	return null;
}
