// pillar-core.ts — pure parser for the pillar ring. No Obsidian imports, so it
// unit-tests against a fixture copy of the real "01. Default/Pillars.md".
//
// A pillar is a wikilink that LEADS a line inside one of the `## ` subsections
// of the `# Pillars` section (from that heading until the next `# `-level
// heading). Both a bare `[[Link]]` line and a top-level `- [[Link]]` bullet
// count. Excluded: `[[YYYY-MM-DD]]` date links, links in indented sub-bullets
// (commentary), links before the first `## ` subsection, and prose lines whose
// leading link is followed by further wikilinks (e.g.
// "[[Dashboard]] - [[2025-12-12]] …" is a note, not a pillar).

export interface PillarLink {
	/** Wikilink target as written (before `|` alias and `#` anchor). */
	link: string;
	/** Alias if the wikilink had one, else the link text. */
	display: string;
}

/**
 * The pillar ring, injected into the section-cards component for the "pillar"
 * surface. Pure (no Obsidian types) so it can be described here; the Obsidian
 * glue that resolves links to vault paths lives in pillars-view.ts.
 */
export interface PillarSource {
	pillars: PillarLink[];
	currentIndex: number;
	/** Resolved vault path for the pillar at index, or null if unresolved. */
	notePathFor(index: number): string | null;
	setCurrentIndex(index: number): Promise<void>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const H1_RE = /^#\s/; // a level-1 heading line
const H2_RE = /^##\s/; // a level-2 subsection heading
const PILLARS_START_RE = /^#\s+Pillars\s*$/;
// A wikilink leading the line, optionally after a top-level "- " bullet, with
// NO leading whitespace (an indented sub-bullet is commentary, so excluded).
const LEAD_LINK_RE = /^(?:[-*+]\s+)?\[\[([^\]]+)\]\]/;

function stripCr(line: string): string {
	return line.endsWith("\r") ? line.slice(0, -1) : line;
}

export function parsePillars(markdown: string): PillarLink[] {
	const lines = markdown.split("\n").map(stripCr);
	let i = lines.findIndex((l) => PILLARS_START_RE.test(l));
	if (i < 0) return [];

	const out: PillarLink[] = [];
	let inSubsection = false;
	for (i = i + 1; i < lines.length; i++) {
		const line = lines[i];
		if (H1_RE.test(line)) break; // next H1 ends the # Pillars section
		if (H2_RE.test(line)) {
			inSubsection = true;
			continue;
		}
		if (!inSubsection) continue; // links before the first ## are not pillars

		const m = LEAD_LINK_RE.exec(line);
		if (!m) continue; // line does not lead with a top-level wikilink
		// A pillar entry is a single-link line; a further wikilink after the
		// leading one marks the line as prose/commentary, not a pillar.
		if (/\[\[/.test(line.slice(m[0].length))) continue;

		const inner = m[1];
		const pipe = inner.indexOf("|");
		const rawTarget = pipe >= 0 ? inner.slice(0, pipe) : inner;
		const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : "";
		const link = rawTarget.split("#")[0].trim();
		if (!link || DATE_RE.test(link)) continue;
		out.push({ link, display: alias || link });
	}
	return out;
}
