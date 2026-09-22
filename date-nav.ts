// date-nav.ts — pure date math for stepping the section views' anchor date
// through periodic notes: one press = one day/week/month/quarter/year.
// No Obsidian imports so it unit-tests (same philosophy as template-renderer).

import { shiftDateIso, isoWeek } from "./template-renderer";
import type { NoteScope } from "./capture-service";

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_ABBR = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** "Thu Aug 20" — shared by the date bar and the section nav row. */
export function formatDateLabel(dateIso: string): string {
	const [y, m, d] = dateIso.split("-").map(Number);
	const t = new Date(Date.UTC(y, m - 1, d));
	return `${DAY_ABBR[t.getUTCDay()]} ${MONTH_ABBR[t.getUTCMonth()]} ${t.getUTCDate()}`;
}

/** "Thu Aug 20, 2025" — used where the year matters (e.g. "On this day"). */
export function formatDateLabelWithYear(dateIso: string): string {
	const year = dateIso.slice(0, 4);
	return `${formatDateLabel(dateIso)}, ${year}`;
}

function shiftMonths(dateIso: string, months: number): string {
	const [y, m, d] = dateIso.split("-").map(Number);
	// Day 1 of the target month, then clamp the day-of-month: Jan 31 + 1 month
	// must be Feb 28/29, not Mar 2/3.
	const first = new Date(Date.UTC(y, m - 1 + months, 1));
	const daysInMonth = new Date(
		Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)
	).getUTCDate();
	const clamped = new Date(
		Date.UTC(
			first.getUTCFullYear(),
			first.getUTCMonth(),
			Math.min(d, daysInMonth)
		)
	);
	return clamped.toISOString().slice(0, 10);
}

export interface DateRange {
	start: string;
	end: string;
}

/** The ISO week (Mon–Sun) containing dateIso, as an inclusive [start, end]. */
export function weekRange(dateIso: string): DateRange {
	const [y, m, d] = dateIso.split("-").map(Number);
	const t = new Date(Date.UTC(y, m - 1, d));
	// getUTCDay: Sun=0..Sat=6 → offset to Monday-based (Mon=0..Sun=6).
	const offset = (t.getUTCDay() + 6) % 7;
	const iso = (dt: Date) => dt.toISOString().slice(0, 10);
	const start = new Date(t);
	start.setUTCDate(t.getUTCDate() - offset);
	const end = new Date(start);
	end.setUTCDate(start.getUTCDate() + 6);
	return { start: iso(start), end: iso(end) };
}

/** The calendar month containing dateIso, as an inclusive [start, end]. */
export function monthRange(dateIso: string): DateRange {
	const [y, m] = dateIso.split("-").map(Number);
	const iso = (dt: Date) => dt.toISOString().slice(0, 10);
	const start = new Date(Date.UTC(y, m - 1, 1));
	const end = new Date(Date.UTC(y, m, 0));
	return { start: iso(start), end: iso(end) };
}

/**
 * Step an anchor date by one unit of the scope. The anchor stays a plain
 * day; the periodic formats resolve it to the right week/month/quarter/year
 * note. Week steps 7 days so the day-of-week (and thus the ISO week) moves
 * exactly one week.
 */
export function stepAnchorIso(
	dateIso: string,
	scope: NoteScope,
	delta: -1 | 1
): string {
	switch (scope) {
		case "day":
			return shiftDateIso(dateIso, delta);
		case "week":
			return shiftDateIso(dateIso, delta * 7);
		case "month":
			return shiftMonths(dateIso, delta);
		case "quarter":
			return shiftMonths(dateIso, delta * 3);
		case "year":
			return shiftMonths(dateIso, delta * 12);
	}
}

// ---- persisted anchors (v1.46.0) --------------------------------------------
// The Focus pane's ◀ ▶ position used to live only in the SectionCards instance,
// so every rebuild threw it away — and the dual panel rebuilds its panes on a
// drawer swipe-away/back and on every page change. Shawn (2026-09-22, voice):
// "if I look at a different week and swipe away and come back it goes back to
// the current week. Make it so it doesn't do that." The anchor is now persisted
// per scope, keyed exactly like the existing per-scope heading memory
// (`focusSectionSelections`), and restored whenever a Focus pane is built.
//
// Storage shape is a plain Record<scope, isoDate>; "follow today" is the
// ABSENCE of a key, not a null, so an untouched scope and a reset one are the
// same state and the record stays JSON-clean in data.json.

/** Persisted ◀ ▶ position per scope: scope id → anchor date (ISO YYYY-MM-DD). */
export type ScopeAnchors = Record<string, string>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed, real calendar date in ISO form. */
export function isAnchorIso(value: unknown): value is string {
	if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
	const [y, m, d] = value.split("-").map(Number);
	const t = new Date(Date.UTC(y, m - 1, d));
	return (
		t.getUTCFullYear() === y &&
		t.getUTCMonth() === m - 1 &&
		t.getUTCDate() === d
	);
}

/**
 * The stored anchor for a scope, or null to follow today. A missing record,
 * a missing key, or anything that isn't a real ISO date all read as null —
 * a corrupt data.json must never strand the panel on a note that can't exist.
 */
export function readScopeAnchor(map: unknown, scope: string): string | null {
	if (!map || typeof map !== "object" || Array.isArray(map)) return null;
	const value = (map as Record<string, unknown>)[scope];
	return isAnchorIso(value) ? value : null;
}

/**
 * Set (or, on null, clear) a scope's anchor, returning a NEW record — settings
 * objects are shared, so writing in place risks mutating DEFAULT_SETTINGS.
 * An invalid date clears the key rather than persisting garbage.
 */
export function writeScopeAnchor(
	map: unknown,
	scope: string,
	iso: string | null
): ScopeAnchors {
	const next = sanitizeScopeAnchors(map);
	if (isAnchorIso(iso)) next[scope] = iso;
	else delete next[scope];
	return next;
}

/**
 * A fresh record holding only the well-formed anchors of `map` — used on
 * settings load so a hand-edited or older data.json can't strand a panel on
 * a nonsense date, and so writes never touch DEFAULT_SETTINGS' own object.
 */
export function sanitizeScopeAnchors(map: unknown): ScopeAnchors {
	const next: ScopeAnchors = {};
	if (map && typeof map === "object" && !Array.isArray(map)) {
		for (const [key, value] of Object.entries(
			map as Record<string, unknown>
		)) {
			if (isAnchorIso(value)) next[key] = value;
		}
	}
	return next;
}

// ---- "back to where I was" chip (v1.46.0) -----------------------------------
// Shawn, 2026-09-22 (voice): "when you are looking at a different week and you
// click the button to return to the current week, make it so that there is a
// button that pops up to return to the week I was just looking at."
//
// Pressing "back to today" is the only thing that remembers a period — the
// ◀ ▶ steps do not, because the chip is only ever visible while the pane is
// following today, and stepping away hides it anyway. The remembered period is
// persisted beside the anchor (same ScopeAnchors shape, its own settings key),
// so it survives the dual panel's pane rebuild exactly as the anchor does.

/** "W38" / "Thu Sep 18" / "Sep" / "Q3" / "2026" — the chip's period name. */
export function shortPeriodLabel(dateIso: string, scope: NoteScope): string {
	switch (scope) {
		case "day":
			return formatDateLabel(dateIso);
		case "week":
			return `W${String(isoWeek(dateIso).week).padStart(2, "0")}`;
		case "month":
			return MONTH_ABBR[Number(dateIso.slice(5, 7)) - 1] ?? dateIso.slice(0, 7);
		case "quarter":
			return `Q${Math.floor((Number(dateIso.slice(5, 7)) - 1) / 3) + 1}`;
		case "year":
			return dateIso.slice(0, 4);
	}
}

/** The chip's caption. */
export function backChipLabel(dateIso: string, scope: NoteScope): string {
	return `Back to ${shortPeriodLabel(dateIso, scope)}`;
}

/**
 * Whether the chip should be on screen.
 *
 * Three conditions, all of which have bitten a naive version:
 *   * the pane is following today (`anchorIso === null`) — while you are
 *     already off on some other week the chip is noise, and "back to today"
 *     is the button that belongs there;
 *   * something was actually remembered;
 *   * the remembered period is not today's own note. Scopes are coarser than
 *     the anchor: an anchor of yesterday still resolves to the current week,
 *     so a week-scope chip could otherwise offer to take you where you are.
 */
export function shouldShowBackChip(
	anchorIso: string | null,
	prevIso: string | null,
	prevNotePath: string | null,
	todayNotePath: string
): boolean {
	if (anchorIso !== null) return false;
	if (!prevIso || !prevNotePath) return false;
	return prevNotePath !== todayNotePath;
}
