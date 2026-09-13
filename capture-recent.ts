// capture-recent.ts — pure helpers for the capture surfaces' "just captured"
// thought strip. Kept free of Obsidian imports so both capture surfaces (the
// main-pane view and the side panel) share one tested implementation.
import { appendTag } from "./thread-core";

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

/**
 * Put a tag on the HEAD line of a capture before it is routed (v1.42.0: long-
 * press Thought → pick a cadence/thread → the thought lands already tagged).
 * Only the first line carries the tag — a multi-line thought's continuation
 * lines are children, and a tag there would be a different post. Leading and
 * trailing blank lines are dropped first so the tag cannot land on an empty
 * line; a duplicate tag is a no-op (appendTag). Empty text stays empty.
 */
export function withTagOnHead(text: string, tag: string): string {
	const trimmed = text.replace(/^\s*\n|\s+$/g, "");
	if (!trimmed.trim()) return trimmed;
	const [head, ...rest] = trimmed.split("\n");
	return [appendTag(head, tag), ...rest].join("\n");
}
