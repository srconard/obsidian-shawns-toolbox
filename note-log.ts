// note-log.ts — the vault-wide "note log" convention, mechanics only.
// Deliberately imports nothing from "obsidian" so it can be unit-tested.
//
// Convention (v1): a note may carry a `## Log` section at the BOTTOM. Anything
// that changes the note appends ONE signed line as a Dataview inline field so
// the history stays queryable:
//
//   log:: 2026-08-12 status: simmering → active — toolbox
//
// Frontmatter keeps only what the dashboards need (current status + changed
// date); the log carries the narrative. See the convention doc referenced in
// AGENTS/system/convention-index.md.

import type { Phase } from "./status-core";

export const LOG_HEADING = "## Log";
const LOG_HEADING_RE = /^##\s+Log\s*$/;

/** Renders a phase (or its absence) for a log line. Cleared/absent → "none". */
function phaseLabel(phase: Phase | null): string {
	return phase ?? "none";
}

/**
 * A status-transition log entry, e.g.
 *   "log:: 2026-08-12 status: simmering → active — toolbox"
 * Signed "toolbox" because the plugin is the author of this line.
 */
export function formatStatusLogEntry(
	from: Phase | null,
	to: Phase | null,
	dateIso: string
): string {
	return `log:: ${dateIso} status: ${phaseLabel(from)} → ${phaseLabel(to)} — toolbox`;
}

/**
 * Append one entry line to the note's `## Log` section, returning the new
 * content. Creates the section at the bottom if absent; otherwise appends to
 * the end of the existing section. Existing content is preserved exactly.
 */
export function appendLog(content: string, entry: string): string {
	const lines = content.split("\n");

	let headingIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (LOG_HEADING_RE.test(lines[i])) {
			headingIdx = i;
			break;
		}
	}

	if (headingIdx === -1) {
		// No section yet — create it at the bottom, after trimming any trailing
		// blank lines so we don't accumulate whitespace on repeated appends.
		const base = content.replace(/\s+$/, "");
		if (base.length === 0) return `${LOG_HEADING}\n${entry}\n`;
		return `${base}\n\n${LOG_HEADING}\n${entry}\n`;
	}

	// Section exists — find where it ends (next level-1/2 heading, or EOF) and
	// insert the entry after the section's last non-blank line.
	let endIdx = lines.length;
	for (let i = headingIdx + 1; i < lines.length; i++) {
		if (/^#{1,2}\s/.test(lines[i])) {
			endIdx = i;
			break;
		}
	}
	let insertAt = endIdx;
	while (insertAt > headingIdx + 1 && lines[insertAt - 1].trim() === "") {
		insertAt--;
	}
	lines.splice(insertAt, 0, entry);
	return lines.join("\n");
}
