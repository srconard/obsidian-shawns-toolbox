import { describe, it, expect } from "vitest";
import {
	stepAnchorIso,
	formatDateLabel,
	formatDateLabelWithYear,
	weekRange,
	monthRange,
	isAnchorIso,
	readScopeAnchor,
	writeScopeAnchor,
	sanitizeScopeAnchors,
	shortPeriodLabel,
	backChipLabel,
	shouldShowBackChip,
} from "../date-nav";

describe("stepAnchorIso", () => {
	it("steps a day", () => {
		expect(stepAnchorIso("2026-08-20", "day", -1)).toBe("2026-08-19");
		expect(stepAnchorIso("2026-08-31", "day", 1)).toBe("2026-09-01");
	});
	it("steps a week (7 days, keeps day-of-week)", () => {
		expect(stepAnchorIso("2026-08-20", "week", -1)).toBe("2026-08-13");
		expect(stepAnchorIso("2026-12-28", "week", 1)).toBe("2027-01-04");
	});
	it("steps a month, clamping the day-of-month", () => {
		expect(stepAnchorIso("2026-08-20", "month", 1)).toBe("2026-09-20");
		expect(stepAnchorIso("2026-01-31", "month", 1)).toBe("2026-02-28");
		expect(stepAnchorIso("2026-03-31", "month", -1)).toBe("2026-02-28");
	});
	it("steps a quarter (3 months) across year boundaries", () => {
		expect(stepAnchorIso("2026-11-15", "quarter", 1)).toBe("2027-02-15");
		expect(stepAnchorIso("2026-02-10", "quarter", -1)).toBe("2025-11-10");
	});
	it("steps a year, clamping Feb 29", () => {
		expect(stepAnchorIso("2024-02-29", "year", 1)).toBe("2025-02-28");
		expect(stepAnchorIso("2026-08-20", "year", -1)).toBe("2025-08-20");
	});
});

describe("weekRange", () => {
	it("returns Monday–Sunday of the ISO week", () => {
		// 2026-08-29 is a Saturday.
		expect(weekRange("2026-08-29")).toEqual({
			start: "2026-08-24",
			end: "2026-08-30",
		});
	});
	it("handles a Monday and a Sunday at the edges", () => {
		expect(weekRange("2026-08-24")).toEqual({
			start: "2026-08-24",
			end: "2026-08-30",
		});
		expect(weekRange("2026-08-30")).toEqual({
			start: "2026-08-24",
			end: "2026-08-30",
		});
	});
});

describe("monthRange", () => {
	it("returns the first and last day of the month", () => {
		expect(monthRange("2026-08-29")).toEqual({
			start: "2026-08-01",
			end: "2026-08-31",
		});
		expect(monthRange("2026-02-15")).toEqual({
			start: "2026-02-01",
			end: "2026-02-28",
		});
	});
});

describe("formatDateLabel", () => {
	it("renders Thu Aug 20", () => {
		expect(formatDateLabel("2026-08-20")).toBe("Thu Aug 20");
	});
	it("renders a single-digit day without padding", () => {
		expect(formatDateLabel("2026-09-01")).toBe("Tue Sep 1");
	});
});

describe("formatDateLabelWithYear", () => {
	it("appends the four-digit year", () => {
		expect(formatDateLabelWithYear("2025-08-20")).toBe("Wed Aug 20, 2025");
	});
	it("uses the date's own year, not today's", () => {
		expect(formatDateLabelWithYear("2022-12-09")).toBe("Fri Dec 9, 2022");
	});
});

// ---- v1.46.0: the Focus pane's persisted anchor -----------------------------
// The dual panel re-creates its panes on a drawer swipe-away/back, so the
// week you navigated to only survives if it is written to settings and read
// back when the pane is built. These are that round trip.

describe("isAnchorIso", () => {
	it("accepts a real ISO date", () => {
		expect(isAnchorIso("2026-09-18")).toBe(true);
		expect(isAnchorIso("2024-02-29")).toBe(true);
	});
	it("rejects a date that does not exist", () => {
		expect(isAnchorIso("2026-02-30")).toBe(false);
		expect(isAnchorIso("2026-13-01")).toBe(false);
	});
	it("rejects anything that is not a plain YYYY-MM-DD string", () => {
		expect(isAnchorIso("2026-9-1")).toBe(false);
		expect(isAnchorIso("2026-09-18T00:00:00Z")).toBe(false);
		expect(isAnchorIso(20260918)).toBe(false);
		expect(isAnchorIso(null)).toBe(false);
		expect(isAnchorIso(undefined)).toBe(false);
	});
});

describe("scope anchors round trip", () => {
	it("writes an anchor and reads it back under the same scope", () => {
		const written = writeScopeAnchor({}, "week", "2026-09-18");
		expect(readScopeAnchor(written, "week")).toBe("2026-09-18");
	});
	it("keeps each scope's anchor separate", () => {
		let map = writeScopeAnchor({}, "week", "2026-09-18");
		map = writeScopeAnchor(map, "month", "2026-07-04");
		expect(readScopeAnchor(map, "week")).toBe("2026-09-18");
		expect(readScopeAnchor(map, "month")).toBe("2026-07-04");
		expect(readScopeAnchor(map, "day")).toBeNull();
	});
	it("clears a scope by removing the key, not storing null", () => {
		const map = writeScopeAnchor(
			writeScopeAnchor({}, "week", "2026-09-18"),
			"week",
			null
		);
		expect(readScopeAnchor(map, "week")).toBeNull();
		expect("week" in map).toBe(false);
	});
	it("never mutates the record it was given (settings objects are shared)", () => {
		const original = { week: "2026-09-18" };
		const next = writeScopeAnchor(original, "week", "2026-09-25");
		expect(original.week).toBe("2026-09-18");
		expect(next.week).toBe("2026-09-25");
	});
	it("refuses to persist garbage, clearing the key instead", () => {
		const map = writeScopeAnchor({ week: "2026-09-18" }, "week", "nonsense");
		expect(readScopeAnchor(map, "week")).toBeNull();
	});
	it("reads null out of a corrupt or absent record", () => {
		expect(readScopeAnchor(undefined, "week")).toBeNull();
		expect(readScopeAnchor(null, "week")).toBeNull();
		expect(readScopeAnchor([], "week")).toBeNull();
		expect(readScopeAnchor({ week: 7 }, "week")).toBeNull();
		expect(readScopeAnchor({ week: "2026-02-30" }, "week")).toBeNull();
	});
});

describe("sanitizeScopeAnchors", () => {
	it("keeps the well-formed entries and drops the rest", () => {
		expect(
			sanitizeScopeAnchors({
				week: "2026-09-18",
				month: "nope",
				day: 5,
				quarter: "2026-02-30",
			})
		).toEqual({ week: "2026-09-18" });
	});
	it("returns a fresh empty record for a missing or wrong-typed value", () => {
		expect(sanitizeScopeAnchors(undefined)).toEqual({});
		expect(sanitizeScopeAnchors("week")).toEqual({});
		expect(sanitizeScopeAnchors(["2026-09-18"])).toEqual({});
	});
});

// ---- v1.46.0: "back to the week I was just looking at" ----------------------

describe("shortPeriodLabel", () => {
	it("names a day by its date label", () => {
		expect(shortPeriodLabel("2026-09-18", "day")).toBe("Fri Sep 18");
	});
	it("names a week by its zero-padded ISO week number", () => {
		expect(shortPeriodLabel("2026-09-18", "week")).toBe("W38");
		expect(shortPeriodLabel("2026-01-07", "week")).toBe("W02");
	});
	it("names a month, quarter and year", () => {
		expect(shortPeriodLabel("2026-09-18", "month")).toBe("Sep");
		expect(shortPeriodLabel("2026-09-18", "quarter")).toBe("Q3");
		expect(shortPeriodLabel("2026-01-31", "quarter")).toBe("Q1");
		expect(shortPeriodLabel("2026-12-31", "quarter")).toBe("Q4");
		expect(shortPeriodLabel("2026-09-18", "year")).toBe("2026");
	});
});

describe("backChipLabel", () => {
	it("reads the way Shawn asked for it", () => {
		expect(backChipLabel("2026-09-18", "week")).toBe("Back to W38");
	});
});

describe("shouldShowBackChip", () => {
	const TODAY = "00. Timeline/2026-W39.md";
	const PREV = "00. Timeline/2026-W38.md";

	it("shows while following today with a remembered period", () => {
		expect(shouldShowBackChip(null, "2026-09-18", PREV, TODAY)).toBe(true);
	});
	it("hides while the pane is already anchored somewhere else", () => {
		expect(shouldShowBackChip("2026-09-11", "2026-09-18", PREV, TODAY)).toBe(
			false
		);
	});
	it("hides when nothing has been remembered yet", () => {
		expect(shouldShowBackChip(null, null, null, TODAY)).toBe(false);
	});
	it("hides when the remembered period IS today's note", () => {
		// The anchor is a day but the scope can be a week: an anchor of
		// yesterday still resolves to the current week note, and a chip
		// offering to take you where you already are is a dead button.
		expect(shouldShowBackChip(null, "2026-09-21", TODAY, TODAY)).toBe(false);
	});
});
