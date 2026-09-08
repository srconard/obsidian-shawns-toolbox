// capture-recent.ts — pure helpers for the capture surfaces' "just captured"
// thought strip. Kept free of Obsidian imports so both capture surfaces (the
// main-pane view and the side panel) share one tested implementation.

/** Collapse every run of whitespace and trim — the strip's display form. */
export function normSpace(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

/**
 * The head line a recent-thought card shows: the captured text's FIRST line,
 * whitespace-normalised. Deliberately the first line and not the first
 * non-empty one — a capture that opens with a blank line has no head, and the
 * caller drops it from the strip rather than showing a line from further down
 * that would not match the thought's own line in the note.
 */
export function thoughtHead(text: string): string {
	return normSpace(text.split("\n")[0] ?? "");
}

/**
 * Index of the LAST entry whose normalised text equals `head`, or -1.
 * Last-wins because the same thought can be captured twice in a day and the
 * card the user just long-pressed is the most recent one.
 */
export function findLastMatching(texts: string[], head: string): number {
	const want = normSpace(head);
	if (!want) return -1;
	for (let i = texts.length - 1; i >= 0; i--) {
		if (normSpace(texts[i]) === want) return i;
	}
	return -1;
}
