// status-core.ts — pure status logic. Deliberately imports nothing from
// "obsidian" so it can be unit-tested outside the app.
//
// Two independent axes:
//   phase   — simmering | on | active, mutually exclusive
//   ongoing — a standing flag that coexists with any phase, or stands alone
//
// Reads are case-insensitive (131 notes in the vault use `Active`); writes are
// always lowercase.

export type Phase = "simmering" | "on" | "active";

export const PHASES: readonly Phase[] = ["simmering", "on", "active"] as const;
export const ONGOING = "ongoing";

/** Frontmatter `tags` may be a list, a bare string, or a comma-separated string. */
export function normalizeTags(raw: unknown): string[] {
	if (raw == null) return [];
	const parts: string[] = Array.isArray(raw)
		? raw.map((t) => String(t))
		: String(raw).split(",");
	return parts
		.map((t) => t.trim().replace(/^#/, ""))
		.filter((t) => t.length > 0);
}

function asPhase(tag: string): Phase | null {
	const lower = tag.toLowerCase();
	return (PHASES as readonly string[]).includes(lower) ? (lower as Phase) : null;
}

/** The note's phase, or null. `ongoing` is never a phase. */
export function readPhase(tags: string[]): Phase | null {
	for (const tag of tags) {
		const phase = asPhase(tag);
		if (phase) return phase;
	}
	return null;
}

/** Every distinct phase present — length > 1 means a conflict. */
export function readAllPhases(tags: string[]): Phase[] {
	const found: Phase[] = [];
	for (const tag of tags) {
		const phase = asPhase(tag);
		if (phase && !found.includes(phase)) found.push(phase);
	}
	return found;
}

export function hasOngoing(tags: string[]): boolean {
	return tags.some((t) => t.toLowerCase() === ONGOING);
}

/**
 * Set the phase, clearing any others. `ongoing` and unrelated tags survive in
 * their original order. Pass null to clear the phase entirely.
 */
export function setPhase(tags: string[], phase: Phase | null): string[] {
	const kept = tags.filter((t) => asPhase(t) === null);
	return phase === null ? kept : [...kept, phase];
}

/** Toggle `ongoing`. Never touches the phase. */
export function setOngoing(tags: string[], value: boolean): string[] {
	const without = tags.filter((t) => t.toLowerCase() !== ONGOING);
	return value ? [...without, ONGOING] : without;
}

/** Whole days from one ISO date to another, or null if either is unparseable. */
export function daysBetween(fromIso: string, toIso: string): number | null {
	const from = Date.parse(`${fromIso}T00:00:00Z`);
	const to = Date.parse(`${toIso}T00:00:00Z`);
	if (Number.isNaN(from) || Number.isNaN(to)) return null;
	return Math.round((to - from) / 86_400_000);
}

/** Human-readable status line, e.g. "on since 2026-03-14 · 140 days". */
export function formatAge(
	phase: Phase | null,
	changedIso: string | null,
	todayIso: string
): string {
	if (phase === null) return "no status";
	if (!changedIso) return `${phase} · no date recorded`;
	const days = daysBetween(changedIso, todayIso);
	if (days === null) return `${phase} · no date recorded`;
	const age = days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`;
	return `${phase} since ${changedIso} · ${age}`;
}
