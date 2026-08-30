import { describe, it, expect } from "vitest";
import {
	stepAnchorIso,
	formatDateLabel,
	weekRange,
	monthRange,
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
