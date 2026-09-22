// thoughts-calendar-core.ts — the pure half of day navigation + the month
// calendar picker on the Threads panel's thoughts screen (v1.47.0).
//
// Shawn, 2026-09-22 (voice): "In the threads side panel there is a button at
// the top that opens up the thoughts from today where I can tag them. We need
// the ability to go to different days and add tags: once I'm on the day screen,
// a button to go to previous days, but also a button that shows a month
// calendar and I can select a day that way."
//
// Everything here is date arithmetic over `YYYY-MM-DD` strings, so it unit-tests
// without a vault (same philosophy as date-nav.ts, which supplies the shared
// day/month label formatting this module reuses rather than re-deriving).

import { shiftDateIso } from "./template-renderer";

/** Full month names for the picker header. */
const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

/** Weekday abbreviations, Sunday-first (index = Date#getUTCDay()). */
const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 0 = weeks start on Sunday, 1 = weeks start on Monday (the vault default —
 *  date-nav's weekRange is Monday-based ISO). */
export type WeekStart = 0 | 1;

export const DEFAULT_WEEK_START: WeekStart = 1;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** One cell of the month grid. Padding cells (the days before the 1st and
 *  after the last) carry `inMonth: false` and are rendered blank — they are
 *  kept so every week row has exactly seven cells. */
export interface DayCell {
	/** `YYYY-MM-DD` — always a real date, including padding cells. */
	iso: string;
	/** Day of month, 1..31. */
	day: number;
	/** False for the leading/trailing days that belong to a neighbour month. */
	inMonth: boolean;
}

export interface MonthGrid {
	/** First day of the month, `YYYY-MM-01`. */
	monthIso: string;
	year: number;
	/** 1..12 (not the JS 0-based month). */
	month: number;
	/** "September 2026". */
	label: string;
	/** Weekday headers in display order, e.g. Mon…Sun for weekStart 1. */
	weekdays: string[];
	/** Week rows, each exactly seven cells. */
	weeks: DayCell[][];
}

/** True when the string is a well-formed, real calendar date. */
export function isDateIso(value: unknown): value is string {
	if (typeof value !== "string" || !ISO_RE.test(value)) return false;
	const [y, m, d] = value.split("-").map(Number);
	if (m < 1 || m > 12 || d < 1) return false;
	return d <= daysInMonth(y, m);
}

/** Days in month `m` (1-based) of year `y`, leap years included. */
export function daysInMonth(y: number, m: number): number {
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The first day of the month containing dateIso, as `YYYY-MM-01`. */
export function monthStartIso(dateIso: string): string {
	return `${dateIso.slice(0, 7)}-01`;
}

/** "September 2026" for any date inside the month. */
export function monthLabel(dateIso: string): string {
	const [y, m] = dateIso.split("-").map(Number);
	return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Weekday headers in display order for the given week start. */
export function weekdayHeaders(weekStart: WeekStart = DEFAULT_WEEK_START): string[] {
	return WEEKDAY_ABBR.slice(weekStart).concat(WEEKDAY_ABBR.slice(0, weekStart));
}

/** Step the month by whole months, keeping the result on day 1. */
export function stepMonthIso(dateIso: string, delta: number): string {
	const [y, m] = dateIso.split("-").map(Number);
	const t = new Date(Date.UTC(y, m - 1 + delta, 1));
	return t.toISOString().slice(0, 10);
}

/** Step a day by one, the ‹ › buttons' whole job. */
export function stepDayIso(dateIso: string, delta: -1 | 1): string {
	return shiftDateIso(dateIso, delta);
}

/**
 * May the ‹ › day buttons move? Backwards is always allowed (the vault has
 * daily notes going back years); forwards stops at today, because a thought
 * cannot be captured into a day that has not happened.
 */
export function canStepDay(
	dateIso: string,
	delta: -1 | 1,
	todayIso: string
): boolean {
	if (delta < 0) return true;
	return stepDayIso(dateIso, 1) <= todayIso;
}

/**
 * May the picker's ‹ › month arrows move? Same rule one unit up: forwards is
 * refused once the next month would start after today's month, so the grid can
 * never show a month that is entirely in the future.
 */
export function canStepMonth(
	monthIso: string,
	delta: -1 | 1,
	todayIso: string
): boolean {
	if (delta < 0) return true;
	return stepMonthIso(monthIso, 1) <= monthStartIso(todayIso);
}

/**
 * Build the six-week grid for the month containing dateIso. Always six rows
 * (42 cells) so the picker's height never jumps between months — the shape a
 * month calendar needs to feel stable under a thumb.
 */
export function buildMonthGrid(
	dateIso: string,
	weekStart: WeekStart = DEFAULT_WEEK_START
): MonthGrid {
	const monthIso = monthStartIso(dateIso);
	const [year, month] = monthIso.split("-").map(Number);
	const first = new Date(Date.UTC(year, month - 1, 1));
	// How many days of the previous month lead the grid.
	const lead = (first.getUTCDay() - weekStart + 7) % 7;
	const start = new Date(first);
	start.setUTCDate(first.getUTCDate() - lead);

	const weeks: DayCell[][] = [];
	for (let w = 0; w < 6; w++) {
		const row: DayCell[] = [];
		for (let d = 0; d < 7; d++) {
			const cur = new Date(start);
			cur.setUTCDate(start.getUTCDate() + w * 7 + d);
			const iso = cur.toISOString().slice(0, 10);
			row.push({
				iso,
				day: cur.getUTCDate(),
				inMonth: iso.slice(0, 7) === monthIso.slice(0, 7),
			});
		}
		weeks.push(row);
	}

	return {
		monthIso,
		year,
		month,
		label: monthLabel(monthIso),
		weekdays: weekdayHeaders(weekStart),
		weeks,
	};
}

/** Every real day of the month containing dateIso, in order — the set the view
 *  probes the vault with to find out which days have a daily note. */
export function monthDayIsos(dateIso: string): string[] {
	const [y, m] = dateIso.split("-").map(Number);
	const total = daysInMonth(y, m);
	const out: string[] = [];
	for (let d = 1; d <= total; d++) {
		out.push(`${dateIso.slice(0, 7)}-${String(d).padStart(2, "0")}`);
	}
	return out;
}

/** How one cell should render. */
export interface CellState {
	/** Part of the displayed month (padding cells are blanked out). */
	inMonth: boolean;
	/** A daily note exists for this day — the dot under the number. */
	hasNote: boolean;
	isToday: boolean;
	isSelected: boolean;
	/** After today: never selectable. */
	isFuture: boolean;
	/** A cell is tappable when it is a real day of this month and not future. */
	selectable: boolean;
}

export interface CellContext {
	todayIso: string;
	selectedIso: string;
	/** Days of the displayed month that have a daily note. */
	notes: ReadonlySet<string>;
}

/**
 * Map a cell onto its render state. Kept pure (and separate from buildMonthGrid)
 * so the note-presence probe can be async in the view without the grid math
 * waiting on the vault.
 */
export function cellState(cell: DayCell, ctx: CellContext): CellState {
	const isFuture = cell.iso > ctx.todayIso;
	return {
		inMonth: cell.inMonth,
		hasNote: cell.inMonth && ctx.notes.has(cell.iso),
		isToday: cell.iso === ctx.todayIso,
		isSelected: cell.inMonth && cell.iso === ctx.selectedIso,
		isFuture,
		selectable: cell.inMonth && !isFuture,
	};
}

/**
 * The thoughts screen's title. It stays "Today's thoughts" on today — the name
 * Shawn already knows the button by — and names the day otherwise.
 */
export function thoughtsTitle(dateIso: string, todayIso: string): string {
	return dateIso === todayIso ? "Today's thoughts" : "Thoughts";
}

/** "Tue 2026-09-22" — the header's date, weekday first so a glance is enough. */
export function dayHeaderLabel(dateIso: string): string {
	const [y, m, d] = dateIso.split("-").map(Number);
	const t = new Date(Date.UTC(y, m - 1, d));
	return `${WEEKDAY_ABBR[t.getUTCDay()]} ${dateIso}`;
}

/** The empty state shown when the selected day has no daily note at all. */
export function missingNoteMessage(dateIso: string): string {
	return `No daily note for ${dayHeaderLabel(dateIso)}.`;
}
