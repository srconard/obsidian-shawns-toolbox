import { describe, it, expect } from "vitest";
import {
	normalizeTags,
	readPhase,
	readAllPhases,
	hasOngoing,
	setPhase,
	setOngoing,
	daysBetween,
	formatAge,
} from "../status-core";

describe("normalizeTags", () => {
	it("handles a YAML list", () => {
		expect(normalizeTags(["on", "top"])).toEqual(["on", "top"]);
	});
	it("handles a single string", () => {
		expect(normalizeTags("on")).toEqual(["on"]);
	});
	it("handles a comma-separated string", () => {
		expect(normalizeTags("on, top")).toEqual(["on", "top"]);
	});
	it("handles null and undefined", () => {
		expect(normalizeTags(null)).toEqual([]);
		expect(normalizeTags(undefined)).toEqual([]);
	});
	it("strips a leading hash", () => {
		expect(normalizeTags(["#on"])).toEqual(["on"]);
	});
	it("drops empty entries", () => {
		expect(normalizeTags(["on", "", "  "])).toEqual(["on"]);
	});
});

describe("readPhase", () => {
	it("finds a lowercase phase", () => {
		expect(readPhase(["on", "top"])).toBe("on");
	});
	it("is case-insensitive — 131 notes use Active", () => {
		expect(readPhase(["Active"])).toBe("active");
	});
	it("returns null when there is no phase", () => {
		expect(readPhase(["top", "idea"])).toBeNull();
	});
	it("does NOT treat ongoing as a phase", () => {
		expect(readPhase(["ongoing"])).toBeNull();
	});
	it("does not mistake 'ongoing' for 'on'", () => {
		expect(readPhase(["ongoing", "top"])).toBeNull();
	});
});

describe("readAllPhases", () => {
	it("returns every phase present, for conflict detection", () => {
		expect(readAllPhases(["active", "on", "simmering"]).sort()).toEqual([
			"active",
			"on",
			"simmering",
		]);
	});
	it("returns a single-element array for a clean note", () => {
		expect(readAllPhases(["on", "ongoing"])).toEqual(["on"]);
	});
	it("deduplicates differently-cased duplicates", () => {
		expect(readAllPhases(["Active", "active"])).toEqual(["active"]);
	});
});

describe("hasOngoing", () => {
	it("detects ongoing", () => {
		expect(hasOngoing(["on", "ongoing"])).toBe(true);
	});
	it("is case-insensitive", () => {
		expect(hasOngoing(["Ongoing"])).toBe(true);
	});
	it("is false when absent", () => {
		expect(hasOngoing(["on"])).toBe(false);
	});
});

describe("setPhase", () => {
	it("adds a phase to a note that had none", () => {
		expect(setPhase(["top"], "active")).toEqual(["top", "active"]);
	});
	it("replaces the existing phase", () => {
		expect(setPhase(["on", "top"], "active")).toEqual(["top", "active"]);
	});
	it("resolves a multi-phase conflict down to one", () => {
		expect(setPhase(["active", "on", "simmering"], "on")).toEqual(["on"]);
	});
	it("removes differently-cased phase tags", () => {
		expect(setPhase(["Active", "top"], "on")).toEqual(["top", "on"]);
	});
	it("preserves ongoing — it is a separate axis", () => {
		expect(setPhase(["on", "ongoing"], "active")).toEqual([
			"ongoing",
			"active",
		]);
	});
	it("clears the phase when passed null", () => {
		expect(setPhase(["on", "ongoing", "top"], null)).toEqual([
			"ongoing",
			"top",
		]);
	});
	it("preserves unrelated tag order", () => {
		expect(setPhase(["idea", "on", "top"], "active")).toEqual([
			"idea",
			"top",
			"active",
		]);
	});
	it("does not mutate the input array", () => {
		const input = ["on", "top"];
		setPhase(input, "active");
		expect(input).toEqual(["on", "top"]);
	});
});

describe("setOngoing", () => {
	it("adds ongoing without touching the phase", () => {
		expect(setOngoing(["on"], true)).toEqual(["on", "ongoing"]);
	});
	it("removes ongoing without touching the phase", () => {
		expect(setOngoing(["on", "ongoing"], false)).toEqual(["on"]);
	});
	it("is idempotent when adding", () => {
		expect(setOngoing(["ongoing"], true)).toEqual(["ongoing"]);
	});
	it("works with no phase at all — 60 notes are ongoing-only", () => {
		expect(setOngoing(["top"], true)).toEqual(["top", "ongoing"]);
	});
	it("normalises a differently-cased ongoing", () => {
		expect(setOngoing(["Ongoing", "on"], true)).toEqual(["on", "ongoing"]);
	});
});

describe("daysBetween", () => {
	it("counts days", () => {
		expect(daysBetween("2026-03-14", "2026-08-01")).toBe(140);
	});
	it("returns 0 for the same day", () => {
		expect(daysBetween("2026-08-01", "2026-08-01")).toBe(0);
	});
	it("returns null for an unparseable date", () => {
		expect(daysBetween("not-a-date", "2026-08-01")).toBeNull();
	});
});

describe("formatAge", () => {
	it("describes phase and age", () => {
		expect(formatAge("on", "2026-03-14", "2026-08-01")).toBe(
			"on since 2026-03-14 · 140 days"
		);
	});
	it("says today when the change is same-day", () => {
		expect(formatAge("active", "2026-08-01", "2026-08-01")).toBe(
			"active since 2026-08-01 · today"
		);
	});
	it("singularises one day", () => {
		expect(formatAge("on", "2026-07-31", "2026-08-01")).toBe(
			"on since 2026-07-31 · 1 day"
		);
	});
	it("handles a missing date", () => {
		expect(formatAge("on", null, "2026-08-01")).toBe("on · no date recorded");
	});
	it("handles no phase", () => {
		expect(formatAge(null, null, "2026-08-01")).toBe("no status");
	});
});
