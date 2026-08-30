// date-nav.ts — pure date math for stepping the section views' anchor date
// through periodic notes: one press = one day/week/month/quarter/year.
// No Obsidian imports so it unit-tests (same philosophy as template-renderer).

import { shiftDateIso } from "./template-renderer";
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
