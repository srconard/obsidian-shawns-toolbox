// line-ops.ts — pure line transformations behind the section cards' edit
// toolbar (indent / outdent / move up / move down). Operates on 0-based line
// ranges; the embedded editor maps its cursor/selection to lines and back.
// No Obsidian imports so it unit-tests.

export interface LineOpResult {
	text: string;
	/** Where the operated-on lines ended up (0-based, inclusive). */
	startLine: number;
	endLine: number;
	changed: boolean;
}

/** 0-based line index containing the character offset. */
export function lineOfOffset(text: string, offset: number): number {
	const upTo = text.slice(0, Math.max(0, Math.min(offset, text.length)));
	return upTo.split("\n").length - 1;
}

/** Column (chars from line start) of the character offset. */
export function colOfOffset(text: string, offset: number): number {
	const clamped = Math.max(0, Math.min(offset, text.length));
	const nl = text.lastIndexOf("\n", clamped - 1);
	return clamped - nl - 1;
}

/** Character offset of (line, col), col clamped to the line's length. */
export function offsetOf(text: string, line: number, col: number): number {
	const lines = text.split("\n");
	const l = Math.max(0, Math.min(line, lines.length - 1));
	let off = 0;
	for (let i = 0; i < l; i++) off += lines[i].length + 1;
	return off + Math.min(col, lines[l].length);
}

const INDENT = "\t";
/** Outdent removes one tab, or up to 4 leading spaces. */
const OUTDENT_RE = /^(\t| {1,4})/;

function clampRange(
	lines: string[],
	startLine: number,
	endLine: number
): [number, number] {
	const last = Math.max(0, lines.length - 1);
	const a = Math.min(Math.max(0, startLine), last);
	const b = Math.min(Math.max(a, endLine), last);
	return [a, b];
}

/** Indent (delta 1) or outdent (delta -1) the line range. Empty lines are
 * left alone so indenting never manufactures whitespace-only lines. */
export function indentLines(
	text: string,
	startLine: number,
	endLine: number,
	delta: -1 | 1
): LineOpResult {
	const lines = text.split("\n");
	const [a, b] = clampRange(lines, startLine, endLine);
	let changed = false;
	for (let i = a; i <= b; i++) {
		if (lines[i].trim() === "") continue;
		if (delta === 1) {
			lines[i] = INDENT + lines[i];
			changed = true;
		} else if (OUTDENT_RE.test(lines[i])) {
			lines[i] = lines[i].replace(OUTDENT_RE, "");
			changed = true;
		}
	}
	return { text: lines.join("\n"), startLine: a, endLine: b, changed };
}

/** Move the line range one line up (dir -1) or down (dir 1); no-op at the
 * edges of the text. */
export function moveLines(
	text: string,
	startLine: number,
	endLine: number,
	dir: -1 | 1
): LineOpResult {
	const lines = text.split("\n");
	const [a, b] = clampRange(lines, startLine, endLine);
	if (dir === -1 ? a === 0 : b === lines.length - 1) {
		return { text, startLine: a, endLine: b, changed: false };
	}
	const block = lines.splice(a, b - a + 1);
	lines.splice(a + dir, 0, ...block);
	return {
		text: lines.join("\n"),
		startLine: a + dir,
		endLine: b + dir,
		changed: true,
	};
}
