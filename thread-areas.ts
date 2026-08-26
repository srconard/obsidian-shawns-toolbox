// thread-areas.ts — pure engine for grouping threads by area. Areas are defined
// in a Shawn-editable mapping note: each `## ` heading is an area name, and the
// plain bullet lines under it name the threads (the <name> part of
// #thread/<name>). No Obsidian imports; covered by tests/thread-areas.test.ts.
import { parseSections, splitLines } from "./section-core";
import { orderThreadsByPin, type ThreadSummary } from "./thread-core";

/** One area from the mapping note: its name and the thread names listed under it. */
export interface ThreadArea {
	/** The `## ` heading text. */
	name: string;
	/** Thread names listed under it, in note order, deduped. */
	threads: string[];
}

/** A rendered group: an area plus the live thread summaries that belong to it. */
export interface AreaGroup {
	area: string;
	threads: ThreadSummary[];
}

/** The catch-all area for threads not listed anywhere in the mapping note. */
export const UNSORTED_AREA = "Unsorted";

// A plain list bullet with non-empty content: "- name" / "* name" / "+ name".
const BULLET_RE = /^[-*+]\s+(.*\S)\s*$/;

/**
 * Parse the mapping note into ordered areas. Only level-2 (`## `) headings are
 * areas; under each, every bullet line is read as a thread name. A leading
 * `#thread/` or `[[…]]` wrapper on a bullet is stripped so either the bare name
 * or a "#thread/name" form reads the same. Non-bullet lines (the format comment,
 * prose) are ignored. Empty content and an empty mapping note yield [].
 */
export function parseThreadAreas(content: string): ThreadArea[] {
	const lines = splitLines(content);
	const areas: ThreadArea[] = [];
	for (const sec of parseSections(content)) {
		if (sec.level !== 2) continue;
		const threads: string[] = [];
		const seen = new Set<string>();
		for (let i = sec.start; i < sec.end; i++) {
			const raw = lines[i] ?? "";
			const clean = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
			const m = BULLET_RE.exec(clean);
			if (!m) continue;
			let name = m[1].trim();
			name = name.replace(/^#thread\//, "");
			name = name.replace(/^\[\[/, "").replace(/\]\]$/, "");
			name = name.trim();
			if (!name || seen.has(name)) continue;
			seen.add(name);
			threads.push(name);
		}
		areas.push({ name: sec.title, threads });
	}
	return areas;
}

/**
 * Group thread summaries under their mapped area, in the mapping note's order.
 * The first area (in note order) that lists a thread wins it. Threads listed in
 * no area fall into an "Unsorted" group at the end — merged into an explicit
 * `## Unsorted` area if the note has one (matched case-insensitively). Area
 * names that match no live thread produce no group (dropped). Within each group,
 * pinned threads float to the top, keeping the incoming (last-active) order
 * otherwise. Pure — the caller persists the pinned list + collapse state.
 */
export function groupThreadsByArea(
	summaries: ThreadSummary[],
	areas: ThreadArea[],
	pinned: readonly string[] = []
): AreaGroup[] {
	// First area that lists a thread owns it.
	const areaOf = new Map<string, string>();
	for (const a of areas) {
		for (const t of a.threads) {
			if (!areaOf.has(t)) areaOf.set(t, a.name);
		}
	}

	// Where unlisted threads land: an explicit ## Unsorted area if present, else
	// a synthetic one appended at the end.
	const explicitUnsorted = areas.find(
		(a) => a.name.toLowerCase() === UNSORTED_AREA.toLowerCase()
	);
	const unsortedName = explicitUnsorted ? explicitUnsorted.name : UNSORTED_AREA;

	const buckets = new Map<string, ThreadSummary[]>();
	for (const s of summaries) {
		const name = areaOf.get(s.name) ?? unsortedName;
		const bucket = buckets.get(name);
		if (bucket) bucket.push(s);
		else buckets.set(name, [s]);
	}

	// Emit areas in note order, then the synthetic Unsorted (if any leftovers and
	// it wasn't already an explicit area). Drop empty groups.
	const order: string[] = [];
	const seen = new Set<string>();
	for (const a of areas) {
		if (!seen.has(a.name)) {
			order.push(a.name);
			seen.add(a.name);
		}
	}
	if (!seen.has(unsortedName)) order.push(unsortedName);

	const out: AreaGroup[] = [];
	for (const name of order) {
		const threads = buckets.get(name);
		if (!threads || threads.length === 0) continue;
		out.push({ area: name, threads: orderThreadsByPin(threads, pinned) });
	}
	return out;
}

/**
 * Whether the grouping is effectively unorganized — a single Unsorted group.
 * The view renders this case flat (no area headers), so nothing changes visually
 * until Shawn actually sorts threads into areas in the mapping note.
 */
export function isFlatGrouping(groups: AreaGroup[]): boolean {
	return groups.length <= 1 && (groups.length === 0 || groups[0].area === UNSORTED_AREA);
}
