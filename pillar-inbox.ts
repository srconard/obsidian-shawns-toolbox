// pillar-inbox.ts — pure helpers for the Pillars-panel quick-capture inbox.
// No Obsidian imports; covered by tests/pillar-inbox.test.ts. The actual
// section write reuses section-core's appendToSection against this spec.

/**
 * Section every pillar's quick-captures land in. A bare title (no hashes) so
 * section-core's findSection matches an existing "Inbox" heading at ANY level
 * (the migrated pilot pillars carry it as an H1 tail section) and, when a
 * pillar note has none, creates one.
 */
export const PILLAR_INBOX_SPEC = "Inbox";

/**
 * Format a quick-capture as a pillar-inbox line: a PLAIN, dated bullet — never
 * a checkbox, because a capture is not a commitment (AGENTS conventions §Capture).
 * The trailing `[[YYYY-MM-DD]]` is the vault's task-creation-date link. Any
 * internal newlines collapse to single spaces so a capture stays one bullet.
 */
export function formatInboxLine(text: string, dateIso: string): string {
	const clean = text.replace(/\s+/g, " ").trim();
	return `- ${clean} [[${dateIso}]]`;
}
