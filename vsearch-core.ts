// vsearch-core.ts — the pure half of the Vault search panel (v1.46.0).
//
// Shawn, 2026-09-22 (voice): "make a vector search side panel: I type something
// like 'no one is better than anyone else', and it shows the notes named
// similar to this and everywhere where I have written something similar."
//
// Two answers, two ranking problems, and neither needs Obsidian:
//
//   * "Notes" — a client-side match of the query against note BASENAMES. The
//     semantic index chunks note BODIES, so a note whose *title* is the thing
//     he is reaching for may not surface a single passage; titles are cheap to
//     rank locally from `app.vault.getMarkdownFiles()`.
//   * "Passages" — the NAS bridge's `/search` endpoint, which runs the vault
//     index's `query_vault.py` and returns scored chunks. This module builds
//     that URL and validates whatever comes back; the fetch itself is glue.
//
// Everything here is string math so it unit-tests without a vault or a server.

/** One semantic hit as query_vault.py --json emits it. */
export interface VaultHit {
	/** Vault-relative path of the note the chunk came from, with .md. */
	note: string;
	/** Heading the chunk sits under; "" when the chunk is the note's top. */
	heading: string;
	/** Cosine similarity, 0..1. */
	score: number;
	/** The chunk body, whose first line is a "Note > Heading" breadcrumb. */
	text: string;
	/** Frontmatter tags of the source note (may be absent). */
	tags: string[];
	/** Which corpus the chunk belongs to (shawn / agent / dev / sessions). */
	corpus: string;
}

/** One ranked title match for the "Notes" group. */
export interface TitleMatch {
	path: string;
	title: string;
	score: number;
}

/**
 * The corpora this panel offers. The bridge also accepts "sessions" (saved
 * chat transcripts) — deliberately not offered here: Shawn is searching for
 * things HE wrote, and the transcripts would bury them under the assistant's
 * own restatements of them.
 */
export const VSEARCH_CORPORA = ["shawn", "agent", "dev", "all"] as const;
export type VSearchCorpus = (typeof VSEARCH_CORPORA)[number];

/** The bridge clamps k to 1..50 — asking for more is a 400, not a bigger page. */
export const VSEARCH_MAX_K = 50;
/** First page size; "More" grows to VSEARCH_MAX_K. */
export const VSEARCH_PAGE_K = 20;
/** How many title matches the "Notes" group shows. */
export const VSEARCH_TITLE_LIMIT = 8;

/**
 * Words carried by almost every sentence — they make a title score look
 * confident for the wrong reason ("no one is better than anyone else" would
 * otherwise half-match every note whose name contains "is"). Deliberately
 * small: a stoplist that eats real vocabulary is worse than none.
 */
const STOPWORDS = new Set([
	"a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by",
	"did", "do", "does", "for", "from", "had", "has", "have", "how", "i",
	"if", "in", "into", "is", "it", "its", "me", "my", "not", "of", "on",
	"or", "so", "than", "that", "the", "then", "there", "this", "to", "was",
	"were", "what", "when", "why", "with", "you", "your",
]);

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeText(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.replace(/\s+/g, " ");
}

/**
 * The content words of a query. Stopwords are dropped only when something
 * survives — a query that is ALL stopwords ("what is it") still has to match
 * on something, so in that case the raw words are kept.
 */
export function tokenize(query: string): string[] {
	const words = normalizeText(query).split(" ").filter(Boolean);
	const kept = words.filter((w) => w.length > 1 && !STOPWORDS.has(w));
	return kept.length > 0 ? kept : words;
}

/** "00. Timeline/2026-09-22.md" → "2026-09-22". */
export function noteTitle(path: string): string {
	const base = path.split("/").pop() ?? path;
	return base.replace(/\.md$/i, "");
}

/**
 * Two words that are plainly inflections of one another — the poor man's
 * stemmer, since there is no stemming library in a 300kB phone plugin.
 *
 * True when they share a prefix of at least four characters AND the shorter
 * word is almost entirely inside that prefix (at most two characters of tail
 * left over). "dance"/"dancing" shares "danc" and leaves one character, so it
 * matches; "one"/"oneness" shares only "one" — three characters — so a
 * three-letter query cannot claim every longer word it happens to begin.
 */
export function sharesStem(a: string, b: string): boolean {
	const short = a.length <= b.length ? a : b;
	const long = a.length <= b.length ? b : a;
	if (short.length < 4) return false;
	let common = 0;
	while (common < short.length && short[common] === long[common]) common++;
	return common >= 4 && short.length - common <= 2;
}

/**
 * How well a note's title answers the query, 0 (no match) .. ~1.35.
 *
 * Base is the share of content words present in the title, so a two-word
 * query matched once scores 0.5 and a fully-matched title scores 1. Two
 * bonuses on top: the whole normalized query appearing verbatim (+0.35), and
 * a short title (+0.1 under six words), because "Humility" answering a
 * one-word query is a better hit than a twenty-word note name that happens
 * to contain it.
 */
export function scoreTitleMatch(query: string, title: string): number {
	const tokens = tokenize(query);
	if (tokens.length === 0) return 0;
	const haystack = normalizeText(title);
	if (!haystack) return 0;
	const titleWords = haystack.split(" ");
	const words = new Set(titleWords);
	let hits = 0;
	for (const token of tokens) {
		// Whole word, then substring, then a shared stem. The substring rule
		// only catches a token that is literally contained in the title, which
		// misses every inflection that changes the ending — "dance" does not
		// appear anywhere in "dancing" — so sharesStem covers the rest.
		if (
			words.has(token) ||
			haystack.includes(token) ||
			titleWords.some((w) => sharesStem(w, token))
		) {
			hits++;
		}
	}
	if (hits === 0) return 0;
	let score = hits / tokens.length;
	const phrase = normalizeText(query);
	if (phrase && haystack.includes(phrase)) score += 0.35;
	if (haystack.split(" ").length < 6) score += 0.1;
	return score;
}

/**
 * The best title matches for the query, highest first. `boostPaths` — the
 * notes the semantic search already surfaced — get a small lift so a note
 * that matches on BOTH its name and its content outranks a name-only match;
 * it is a tie-breaker, never enough to promote a title that matched nothing.
 */
export function rankTitleMatches(
	query: string,
	paths: readonly string[],
	limit = VSEARCH_TITLE_LIMIT,
	boostPaths: readonly string[] = []
): TitleMatch[] {
	const boosted = new Set(boostPaths);
	const matches: TitleMatch[] = [];
	for (const path of paths) {
		const title = noteTitle(path);
		const base = scoreTitleMatch(query, title);
		if (base <= 0) continue;
		matches.push({
			path,
			title,
			score: base + (boosted.has(path) ? 0.15 : 0),
		});
	}
	matches.sort(
		(a, b) =>
			b.score - a.score ||
			a.title.length - b.title.length ||
			a.path.localeCompare(b.path)
	);
	return matches.slice(0, Math.max(0, limit));
}

/** Build the bridge's /search URL. NOTE: the JSON switch is `format=json`. */
export function buildSearchUrl(
	baseUrl: string,
	query: string,
	opts: { k?: number; corpus?: VSearchCorpus; floor?: number } = {}
): string {
	const base = baseUrl.trim().replace(/\/+$/, "");
	if (!base) throw new Error("Set the Vault search (bridge) URL in settings");
	const k = Math.min(VSEARCH_MAX_K, Math.max(1, Math.round(opts.k ?? VSEARCH_PAGE_K)));
	const params = new URLSearchParams({
		q: query,
		format: "json",
		k: String(k),
		corpus: opts.corpus ?? "shawn",
	});
	if (opts.floor !== undefined) params.set("floor", String(opts.floor));
	return `${base}/search?${params.toString()}`;
}

/**
 * Validate the endpoint's payload into hits. Anything malformed is dropped
 * rather than thrown on: a single bad row must not blank the whole panel.
 * Accepts the bare array query_vault.py emits, and a `{results: […]}`
 * envelope in case the bridge ever wraps it.
 */
export function parseSearchResponse(raw: unknown): VaultHit[] {
	const rows = Array.isArray(raw)
		? raw
		: Array.isArray((raw as { results?: unknown })?.results)
			? ((raw as { results: unknown[] }).results)
			: [];
	const hits: VaultHit[] = [];
	for (const row of rows) {
		if (!row || typeof row !== "object") continue;
		const r = row as Record<string, unknown>;
		if (typeof r.note !== "string" || !r.note) continue;
		const score = typeof r.score === "number" && Number.isFinite(r.score) ? r.score : 0;
		hits.push({
			note: r.note,
			heading: typeof r.heading === "string" ? r.heading : "",
			score,
			text: typeof r.text === "string" ? r.text : "",
			tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [],
			corpus: typeof r.corpus === "string" ? r.corpus : "",
		});
	}
	return hits;
}

/**
 * Drop the "Note > Heading" breadcrumb query_vault.py prepends to each chunk —
 * the row already shows both, and leaving it in makes every snippet open with
 * text Shawn did not write.
 */
export function stripBreadcrumb(text: string, note: string, heading: string): string {
	const lines = text.split("\n");
	if (lines.length === 0) return text;
	const first = normalizeText(lines[0]);
	const title = normalizeText(noteTitle(note));
	const withHeading = normalizeText(`${noteTitle(note)} ${heading}`);
	if (first && (first === title || (heading && first === withHeading))) {
		return lines.slice(1).join("\n").trim();
	}
	return text.trim();
}

/**
 * The most query-relevant window of a chunk, capped at `max` characters.
 * Picks the line with the most content-word hits (the chunk can be a dozen
 * lines and the match is rarely the first), then centres a window on the
 * first hit inside it so the matched words are actually visible.
 */
export function snippet(text: string, query: string, max = 220): string {
	const body = text.trim();
	if (!body) return "";
	const tokens = tokenize(query);
	const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
	if (lines.length === 0) return "";
	let best = lines[0];
	let bestHits = -1;
	for (const line of lines) {
		const hay = normalizeText(line);
		const hits = tokens.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
		if (hits > bestHits) {
			best = line;
			bestHits = hits;
		}
	}
	if (best.length <= max) return best;
	const hay = normalizeText(best);
	let at = -1;
	for (const token of tokens) {
		const i = hay.indexOf(token);
		if (i >= 0 && (at < 0 || i < at)) at = i;
	}
	const start = at < 0 ? 0 : Math.max(0, Math.min(at - Math.floor(max / 3), best.length - max));
	const end = Math.min(best.length, start + max);
	return (start > 0 ? "…" : "") + best.slice(start, end).trim() + (end < best.length ? "…" : "");
}

/** 0.4190… → "42" — a similarity badge, not a percentage claim. */
export function formatScore(score: number): string {
	if (!Number.isFinite(score)) return "";
	return String(Math.round(Math.max(0, Math.min(1, score)) * 100));
}

/**
 * The link target for a hit. Obsidian's openLinkText resolves `path#heading`;
 * a heading containing `#` or `|` would break that link, so those fall back
 * to opening the note itself rather than a link that silently fails.
 */
export function hitLinkText(note: string, heading: string): string {
	const clean = heading.trim();
	if (!clean || /[#|[\]]/.test(clean)) return note;
	return `${note}#${clean}`;
}
