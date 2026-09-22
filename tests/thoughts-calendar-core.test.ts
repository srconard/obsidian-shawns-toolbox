import { describe, it, expect } from "vitest";
import {
	isDateIso,
	daysInMonth,
	monthStartIso,
	monthLabel,
	weekdayHeaders,
	stepMonthIso,
	stepDayIso,
	canStepDay,
	canStepMonth,
	buildMonthGrid,
	monthDayIsos,
	cellState,
	thoughtsTitle,
	dayHeaderLabel,
	missingNoteMessage,
} from "../thoughts-calendar-core";

describe("isDateIso", () => {
	it("accepts real dates", () => {
		expect(isDateIso("2026-09-22")).toBe(true);
		expect(isDateIso("2024-02-29")).toBe(true); // leap day
	});
	it("rejects malformed and impossible dates", () => {
		expect(isDateIso("2026-9-2")).toBe(false);
		expect(isDateIso("2026-13-01")).toBe(false);
		expect(isDateIso("2026-02-30")).toBe(false);
		expect(isDateIso("2025-02-29")).toBe(false); // not a leap year
		expect(isDateIso(20260922 as unknown)).toBe(false);
		expect(isDateIso(null)).toBe(false);
	});
});

describe("daysInMonth", () => {
	it("handles 31/30/28/29", () => {
		expect(daysInMonth(2026, 1)).toBe(31);
		expect(daysInMonth(2026, 9)).toBe(30);
		expect(daysInMonth(2026, 2)).toBe(28);
		expect(daysInMonth(2024, 2)).toBe(29);
	});
});

describe("month helpers", () => {
	it("normalizes to the first of the month", () => {
		expect(monthStartIso("2026-09-22")).toBe("2026-09-01");
		expect(monthStartIso("2026-09-01")).toBe("2026-09-01");
	});
	it("labels the month", () => {
		expect(monthLabel("2026-09-22")).toBe("September 2026");
		expect(monthLabel("2027-01-05")).toBe("January 2027");
	});
	it("steps whole months and lands on day 1", () => {
		expect(stepMonthIso("2026-09-22", 1)).toBe("2026-10-01");
		expect(stepMonthIso("2026-01-31", -1)).toBe("2025-12-01");
		expect(stepMonthIso("2026-12-15", 1)).toBe("2027-01-01");
	});
});

describe("weekdayHeaders", () => {
	it("defaults to Monday-first (the vault's ISO week)", () => {
		expect(weekdayHeaders()).toEqual([
			"Mon",
			"Tue",
			"Wed",
			"Thu",
			"Fri",
			"Sat",
			"Sun",
		]);
	});
	it("supports Sunday-first", () => {
		expect(weekdayHeaders(0)).toEqual([
			"Sun",
			"Mon",
			"Tue",
			"Wed",
			"Thu",
			"Fri",
			"Sat",
		]);
	});
});

describe("stepDayIso", () => {
	it("steps one day across month and year boundaries", () => {
		expect(stepDayIso("2026-09-22", -1)).toBe("2026-09-21");
		expect(stepDayIso("2026-09-30", 1)).toBe("2026-10-01");
		expect(stepDayIso("2026-01-01", -1)).toBe("2025-12-31");
	});
});

describe("canStepDay — next is clamped at today", () => {
	const today = "2026-09-22";
	it("always allows going back", () => {
		expect(canStepDay(today, -1, today)).toBe(true);
		expect(canStepDay("2019-01-01", -1, today)).toBe(true);
	});
	it("refuses to step past today", () => {
		expect(canStepDay(today, 1, today)).toBe(false);
	});
	it("allows stepping forward while still behind today", () => {
		expect(canStepDay("2026-09-21", 1, today)).toBe(true);
		expect(canStepDay("2026-08-31", 1, today)).toBe(true);
	});
});

describe("canStepMonth — the picker's month arrows clamp the same way", () => {
	const today = "2026-09-22";
	it("always allows going back", () => {
		expect(canStepMonth("2026-09-01", -1, today)).toBe(true);
	});
	it("refuses a month entirely in the future", () => {
		expect(canStepMonth("2026-09-01", 1, today)).toBe(false);
	});
	it("allows forward while behind today's month", () => {
		expect(canStepMonth("2026-08-01", 1, today)).toBe(true);
		expect(canStepMonth("2025-12-01", 1, today)).toBe(true);
	});
	it("judges by the month, not the day within it", () => {
		// First of the month: stepping forward is still refused.
		expect(canStepMonth("2026-09-01", 1, "2026-09-01")).toBe(false);
	});
});

describe("buildMonthGrid", () => {
	it("is always six full weeks", () => {
		for (const iso of ["2026-09-22", "2026-02-10", "2024-02-01", "2026-11-30"]) {
			const g = buildMonthGrid(iso);
			expect(g.weeks).toHaveLength(6);
			for (const w of g.weeks) expect(w).toHaveLength(7);
		}
	});

	it("pads September 2026 from Monday Aug 31 (Monday week start)", () => {
		const g = buildMonthGrid("2026-09-22");
		expect(g.monthIso).toBe("2026-09-01");
		expect(g.year).toBe(2026);
		expect(g.month).toBe(9);
		expect(g.label).toBe("September 2026");
		// 2026-09-01 is a Tuesday, so one leading day from August.
		expect(g.weeks[0][0]).toEqual({ iso: "2026-08-31", day: 31, inMonth: false });
		expect(g.weeks[0][1]).toEqual({ iso: "2026-09-01", day: 1, inMonth: true });
		const last = g.weeks[5][6];
		expect(last.inMonth).toBe(false);
	});

	it("pads the same month differently with a Sunday week start", () => {
		const g = buildMonthGrid("2026-09-22", 0);
		expect(g.weekdays[0]).toBe("Sun");
		expect(g.weeks[0][0].iso).toBe("2026-08-30");
		expect(g.weeks[0][2]).toEqual({ iso: "2026-09-01", day: 1, inMonth: true });
	});

	it("needs no leading pad when the 1st falls on the week start", () => {
		// 2026-06-01 is a Monday.
		const g = buildMonthGrid("2026-06-15");
		expect(g.weeks[0][0]).toEqual({ iso: "2026-06-01", day: 1, inMonth: true });
	});

	it("carries every day of the month exactly once", () => {
		const g = buildMonthGrid("2024-02-11");
		const inMonth = g.weeks.flat().filter((c) => c.inMonth);
		expect(inMonth).toHaveLength(29); // leap February
		expect(inMonth[0].iso).toBe("2024-02-01");
		expect(inMonth[28].iso).toBe("2024-02-29");
		expect(new Set(inMonth.map((c) => c.iso)).size).toBe(29);
	});

	it("is continuous — every cell is the previous cell plus a day", () => {
		const cells = buildMonthGrid("2026-12-05").weeks.flat();
		for (let i = 1; i < cells.length; i++) {
			expect(stepDayIso(cells[i - 1].iso, 1)).toBe(cells[i].iso);
		}
	});
});

describe("monthDayIsos", () => {
	it("lists the month's real days, in order", () => {
		const days = monthDayIsos("2026-09-22");
		expect(days).toHaveLength(30);
		expect(days[0]).toBe("2026-09-01");
		expect(days[29]).toBe("2026-09-30");
		expect(days[8]).toBe("2026-09-09"); // zero padded
	});
	it("handles a leap February", () => {
		expect(monthDayIsos("2024-02-01")).toHaveLength(29);
		expect(monthDayIsos("2025-02-01")).toHaveLength(28);
	});
});

describe("cellState — note presence, today, selection, future", () => {
	const ctx = {
		todayIso: "2026-09-22",
		selectedIso: "2026-09-20",
		notes: new Set(["2026-09-20", "2026-09-22", "2026-08-31"]),
	};

	it("marks a day that has a daily note", () => {
		const g = buildMonthGrid("2026-09-22");
		const cell = g.weeks.flat().find((c) => c.iso === "2026-09-20")!;
		const s = cellState(cell, ctx);
		expect(s.hasNote).toBe(true);
		expect(s.isSelected).toBe(true);
		expect(s.isToday).toBe(false);
		expect(s.selectable).toBe(true);
	});

	it("marks today and leaves it selectable", () => {
		const g = buildMonthGrid("2026-09-22");
		const cell = g.weeks.flat().find((c) => c.iso === "2026-09-22")!;
		const s = cellState(cell, ctx);
		expect(s.isToday).toBe(true);
		expect(s.isFuture).toBe(false);
		expect(s.selectable).toBe(true);
	});

	it("disables a future day even when it somehow has a note", () => {
		const g = buildMonthGrid("2026-09-22");
		const cell = g.weeks.flat().find((c) => c.iso === "2026-09-23")!;
		const s = cellState(cell, {
			...ctx,
			notes: new Set([...ctx.notes, "2026-09-23"]),
		});
		expect(s.isFuture).toBe(true);
		expect(s.selectable).toBe(false);
	});

	it("never marks or selects a padding cell, even one with a note", () => {
		const g = buildMonthGrid("2026-09-22");
		const pad = g.weeks[0][0]; // 2026-08-31, which IS in the notes set
		expect(pad.inMonth).toBe(false);
		const s = cellState(pad, { ...ctx, selectedIso: "2026-08-31" });
		expect(s.hasNote).toBe(false);
		expect(s.isSelected).toBe(false);
		expect(s.selectable).toBe(false);
	});

	it("shows no dots when nothing in the month has a note", () => {
		const g = buildMonthGrid("2026-09-22");
		const states = g.weeks
			.flat()
			.map((c) => cellState(c, { ...ctx, notes: new Set<string>() }));
		expect(states.some((s) => s.hasNote)).toBe(false);
	});
});

describe("labels", () => {
	it("keeps the familiar title on today and names the day otherwise", () => {
		expect(thoughtsTitle("2026-09-22", "2026-09-22")).toBe("Today's thoughts");
		expect(thoughtsTitle("2026-09-20", "2026-09-22")).toBe("Thoughts");
	});
	it("formats the header date weekday-first", () => {
		expect(dayHeaderLabel("2026-09-22")).toBe("Tue 2026-09-22");
		expect(dayHeaderLabel("2026-09-20")).toBe("Sun 2026-09-20");
	});
	it("names the day in the missing-note message", () => {
		expect(missingNoteMessage("2026-09-20")).toBe(
			"No daily note for Sun 2026-09-20."
		);
	});
});
