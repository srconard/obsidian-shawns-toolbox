// filing-core.ts — pure helpers for the "File tweet to note" lane (v1.37.0).
// Shares the share-sheet → media-inbox → note flow's string logic, kept pure so
// it can be unit-tested without Obsidian. The Obsidian glue (picker modal, HTTP
// call, note write, menu registration) lives in filing-service.ts.

/** A resource note returned by the media-inbox filing endpoint. */
export interface FiledResource {
	/** Vault-relative note path, e.g. "Library/Media Inbox/2026-09-04 Title.md". */
	note: string;
	/** Display title (already sanitized server-side; re-sanitized here for the alias). */
	title: string;
	/** Media kind (tweet | article | …); present on children, optional on the main note. */
	kind?: string;
}

/** The media-inbox POST /ingest {filed:true} response shape. */
export interface FiledResponse {
	note: string;
	title: string;
	children: FiledResource[];
}

/** First http(s) URL in the shared text, or null. Used to gate the menu row. */
export function extractFirstUrl(text: string): string | null {
	const m = (text ?? "").match(/https?:\/\/[^\s<>"')\]]+/);
	if (!m) return null;
	// Trim trailing sentence punctuation a URL rarely really ends with.
	return m[0].replace(/[.,;:!?)\]]+$/, "");
}

/** Wikilink target for a resource note: its basename without the .md extension. */
export function resourceLinkTarget(notePath: string): string {
	const base = (notePath ?? "").split("/").pop() ?? "";
	return base.replace(/\.md$/i, "");
}

/**
 * Make a title safe to use as a wikilink alias — strip the characters that
 * would break `[[target|alias]]` (`[`, `]`, `|`, `#`, `^`) and any newlines,
 * collapse whitespace. The server already sanitizes titles, but a resource note
 * could also be picked up with a hand-edited title, so be defensive.
 */
export function sanitizeAlias(title: string): string {
	return (title ?? "")
		.replace(/[\[\]|#^\r\n]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Build the block appended under the target note's `# Resources` section:
 *   - [[<main>|<title>]] >[[<dateIso>]]
 *     - [[<child>|<title>]]
 *     - [[<child>|<title>]]
 * The parent carries the provenance date (resource-schema link-line format);
 * each referenced resource is an indented child bullet beneath it.
 */
export function formatResourceBlock(
	main: FiledResource,
	children: FiledResource[],
	dateIso: string
): string {
	const link = (r: FiledResource) =>
		`[[${resourceLinkTarget(r.note)}|${sanitizeAlias(r.title)}]]`;
	const lines = [`- ${link(main)} >[[${dateIso}]]`];
	for (const child of children ?? []) {
		lines.push(`\t- ${link(child)}`);
	}
	return lines.join("\n");
}
