// dreams-core.ts — pure engine for the Dreams panel.
//
// The nightly `dream-connections` pass writes ~10 surprising note-pairings into
// each agent daily note (AGENTS/timeline/agent-notes/YYYY-MM-DD-AGENT.md) between
// `<!-- lane:dreams start -->` … `<!-- lane:dreams end -->`, and older ones live
// as standalone digests (AGENTS/workspace/dreaming/YYYY-MM-DD-dreaming.md). Each
// connection is a heading block — `## <title>` in legacy digests, `### <title>`
// in agent notes — carrying a pair line `**[[a]]** ↔ **[[b]]**`, one or two
// `> quote` lines, `**The thread:** …`, and `**Speculation:** …`. A final
// "High-signal thoughts — no strong connection tonight" block is not a
// connection. Shawn keeps a connection by turning its pair line into a checkbox
// `- [ ] **[[a]]** ↔ **[[b]]**`; the next night session wires the links and
// checks it off `- [x]`.
//
// No Obsidian imports; fully covered by tests/dreams-core.test.ts. Every write is
// targeted — it rewrites only the one pair line and never re-serialises the note.

import { splitLines } from "./section-core";

export const DREAMS_START = "<!-- lane:dreams start -->";
export const DREAMS_END = "<!-- lane:dreams end -->";

/** ↔ is the connection glyph in every pair line. */
const ARROW = "↔";
const HEADING_RE = /^(#{2,3})\s+(.*\S)\s*$/;
// A pair line, optionally prefixed with a - [ ] / - [x] checkbox.
const PAIR_PREFIX_RE = /^(\s*[-*]\s+\[([ xX])\]\s+)/;
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/** The 💭 glyph that marks Shawn's optional "why I kept this" note child line. */
export const NOTE_GLYPH = "💭";
// A note child line: optional indent, optional bullet, the 💭 glyph, then text.
const NOTE_LINE_RE = /^\s*(?:[-*]\s+)?💭\s?/;
// Trailing italic signature "*(Shawn, 2026-09-03)*" — stripped from display text.
const NOTE_SIG_RE = /\s*\*\([^)]*\)\*\s*$/;

/** True for a `- 💭 …` context-note child line (any indent, bullet optional). */
export function isNoteLine(line: string): boolean {
	return NOTE_LINE_RE.test(line.trim());
}

/** The note text from a `- 💭 <text> *(Shawn, date)*` line (glyph + signature stripped). */
export function noteTextFromLine(line: string): string {
	return line.trim().replace(NOTE_LINE_RE, "").replace(NOTE_SIG_RE, "").trim();
}

export type KeepState = "plain" | "kept" | "applied";

export interface DreamConnection {
	/** Heading text (e.g. "The ramble found a guiding question already filed"). */
	title: string;
	/** 2 for legacy `##` digests, 3 for agent-note `###` blocks. */
	level: number;
	/** The pair line with any checkbox prefix stripped — the stable match key. */
	pairBody: string;
	/** The two linked note targets (before any `|alias`), in order. */
	noteA: string;
	noteB: string;
	/** plain = no checkbox; kept = `- [ ]`; applied = `- [x]` (read-only). */
	keep: KeepState;
	/** Quote lines under the connection (the `>` lines), leading `> ` stripped. */
	quotes: string[];
	/** Text after `**The thread:**`, or "". */
	thread: string;
	/** Text after `**Speculation…:**`, or "". */
	speculation: string;
	/** Shawn's optional "why I kept this" note (glyph + signature stripped), or "". */
	note: string;
	/** The high-signal round-up block is informational, not a connection. */
	isHighSignal: boolean;
}

function stripCr(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/**
 * The dreams region of a note. For an agent note it is the text between the
 * lane markers (exclusive); a note with no lane returns null. For a legacy
 * standalone digest the whole content is the region.
 */
export function extractDreamsRegion(
	content: string,
	isAgentNote: boolean
): string | null {
	if (!isAgentNote) return content;
	const s = content.indexOf(DREAMS_START);
	if (s < 0) return null;
	const e = content.indexOf(DREAMS_END, s);
	if (e < 0) return null;
	return content.slice(s + DREAMS_START.length, e);
}

/** Strip a leading `- [ ]` / `- [x]` checkbox prefix from a line. */
export function stripKeepPrefix(line: string): string {
	return line.replace(PAIR_PREFIX_RE, "");
}

function keepFromLine(line: string): KeepState {
	const m = PAIR_PREFIX_RE.exec(line);
	if (!m) return "plain";
	return m[2] === " " ? "kept" : "applied";
}

function isPairLine(line: string): boolean {
	return line.includes(ARROW) && line.includes("[[");
}

/** The two link targets in a pair line (before any `|alias`), or ["",""]. */
function pairTargets(pairBody: string): [string, string] {
	const targets: string[] = [];
	let m: RegExpExecArray | null;
	WIKILINK_RE.lastIndex = 0;
	while ((m = WIKILINK_RE.exec(pairBody)) !== null) {
		targets.push(m[1].trim());
	}
	return [targets[0] ?? "", targets[1] ?? ""];
}

function isHighSignalTitle(title: string): boolean {
	return /^high[- ]signal thoughts/i.test(title);
}

function afterLabel(line: string, label: RegExp): string | null {
	const m = label.exec(line);
	return m ? line.slice(m[0].length).trim() : null;
}

/**
 * Parse every connection block in a dreams region, in document order.
 * The high-signal round-up is returned with `isHighSignal: true` and no pair.
 */
export function parseDreams(region: string): DreamConnection[] {
	const lines = splitLines(region).map(stripCr);
	const out: DreamConnection[] = [];
	let i = 0;
	while (i < lines.length) {
		const hm = HEADING_RE.exec(lines[i]);
		if (!hm) {
			i++;
			continue;
		}
		const level = hm[1].length;
		const title = hm[2].trim();
		i++;
		const body: string[] = [];
		while (i < lines.length && !HEADING_RE.test(lines[i])) {
			body.push(lines[i]);
			i++;
		}
		const highSignal = isHighSignalTitle(title);
		let pairRaw = "";
		const quotes: string[] = [];
		let thread = "";
		let speculation = "";
		let note = "";
		for (const raw of body) {
			const line = raw.trim();
			// Shawn's context note sits under the pair line as a `- 💭 …` child.
			// Check it before the pair test so a note that happens to contain a
			// wikilink is never mistaken for the pair line.
			if (isNoteLine(line)) {
				note = noteTextFromLine(line);
				continue;
			}
			if (!pairRaw && isPairLine(line)) {
				pairRaw = line;
				continue;
			}
			if (line.startsWith(">")) {
				quotes.push(line.replace(/^>\s?/, ""));
				continue;
			}
			const t = afterLabel(line, /^\*\*The thread:\*\*\s*/i);
			if (t !== null) {
				thread = t;
				continue;
			}
			const sp = afterLabel(line, /^\*\*Speculation[^:*]*:\*\*\s*/i);
			if (sp !== null) {
				speculation = sp;
				continue;
			}
		}
		// A heading block with no pair line and not the high-signal round-up is
		// note structure, not a connection — skip it.
		if (!pairRaw && !highSignal) continue;
		const pairBody = stripKeepPrefix(pairRaw);
		const [noteA, noteB] = pairTargets(pairBody);
		out.push({
			title,
			level,
			pairBody,
			noteA,
			noteB,
			keep: keepFromLine(pairRaw),
			quotes,
			thread,
			speculation,
			note,
			isHighSignal: highSignal,
		});
	}
	return out;
}

export interface DreamCounts {
	/** Number of real connections (pair lines), excluding the high-signal block. */
	connections: number;
	/** Connections flagged to keep — either `- [ ]` or already applied `- [x]`. */
	flagged: number;
	/** Connections already applied (`- [x]`). */
	applied: number;
}

export function countDreams(conns: DreamConnection[]): DreamCounts {
	let connections = 0;
	let flagged = 0;
	let applied = 0;
	for (const c of conns) {
		if (c.isHighSignal || !c.pairBody) continue;
		connections++;
		if (c.keep === "kept" || c.keep === "applied") flagged++;
		if (c.keep === "applied") applied++;
	}
	return { connections, flagged, applied };
}

/**
 * Toggle a connection's keep flag in the note content by rewriting only its
 * pair line: plain → `- [ ]` (kept), kept → plain. An applied (`- [x]`) line is
 * read-only and returned unchanged, as is a content with no matching pair line.
 * Idempotent: matching is by the pair line's checkbox-stripped body, so
 * toggling twice returns to the original.
 */
export function toggleKeep(content: string, pairBody: string): string {
	const want = pairBody.trim();
	if (!want) return content;
	const lines = splitLines(content);
	for (let i = 0; i < lines.length; i++) {
		const line = stripCr(lines[i]);
		if (!isPairLine(line)) continue;
		if (stripKeepPrefix(line).trim() !== want) continue;
		const state = keepFromLine(line);
		if (state === "applied") return content; // read-only
		const indentMatch = /^(\s*)/.exec(line);
		const indent = indentMatch ? indentMatch[1] : "";
		const cr = lines[i].endsWith("\r") ? "\r" : "";
		lines[i] =
			state === "kept"
				? indent + stripKeepPrefix(line).trim() + cr
				: indent + "- [ ] " + stripKeepPrefix(line).trim() + cr;
		return lines.join("\n");
	}
	return content;
}

/**
 * Write (or replace, or delete) Shawn's context note for one connection by
 * touching only its `- 💭 …` child line directly under the pair line — the rest
 * of the dreams lane is never re-serialised. `text` is trimmed:
 *   • non-empty  → upsert `  - 💭 <text> *(Shawn, <dateIso>)*` (one note per
 *                  connection: an existing note line is replaced in place, else a
 *                  new line is inserted immediately below the pair line);
 *   • empty      → delete the existing note line, if any.
 * The connection is matched by its checkbox-stripped pair body, so keep-state
 * (plain / `- [ ]` / `- [x]`) is irrelevant. No matching pair line → unchanged.
 * Idempotent: saving the same text (same date) twice yields identical content.
 */
export function setConnectionNote(
	content: string,
	pairBody: string,
	text: string,
	dateIso: string
): string {
	const want = pairBody.trim();
	if (!want) return content;
	const lines = splitLines(content);
	let i = -1;
	for (let k = 0; k < lines.length; k++) {
		const line = stripCr(lines[k]);
		if (!isPairLine(line)) continue;
		if (stripKeepPrefix(line).trim() !== want) continue;
		i = k;
		break;
	}
	if (i < 0) return content;
	const pairLine = stripCr(lines[i]);
	const indentMatch = /^(\s*)/.exec(pairLine);
	const indent = indentMatch ? indentMatch[1] : "";
	const childIndent = indent + "  ";
	const newText = text.trim();
	// Find this connection's existing note line — the first `💭` line after the
	// pair line and before the next heading or pair line (the block boundary).
	let j = -1;
	for (let k = i + 1; k < lines.length; k++) {
		const l = stripCr(lines[k]);
		// isNoteLine wins over isPairLine so a note that dictated a `[[link]] ↔`
		// isn't misread as the next connection's pair line and skipped.
		if (isNoteLine(l)) {
			j = k;
			break;
		}
		if (HEADING_RE.test(l)) break;
		if (isPairLine(l)) break;
	}
	if (newText === "") {
		if (j >= 0) lines.splice(j, 1);
		return lines.join("\n");
	}
	const newLine = `${childIndent}- ${NOTE_GLYPH} ${newText} *(Shawn, ${dateIso})*`;
	if (j >= 0) {
		const cr = lines[j].endsWith("\r") ? "\r" : "";
		lines[j] = newLine + cr;
	} else {
		const cr = lines[i].endsWith("\r") ? "\r" : "";
		lines.splice(i + 1, 0, newLine + cr);
	}
	return lines.join("\n");
}
