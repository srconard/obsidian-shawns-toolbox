import { describe, expect, it } from "vitest";
import {
	applyDualChoice,
	clampSplitRatio,
	DEFAULT_SPLIT_RATIO,
	MAX_SPLIT_RATIO,
	MIN_SPLIT_RATIO,
	otherHalf,
	ratioChanged,
	ratioFromDrag,
	resolveDualSelection,
	splitGrow,
	swapDualSelection,
	swapSplitRatio,
} from "../dual-core";

const IDS = ["capture", "threads", "dreams", "highlights"];

describe("clampSplitRatio", () => {
	it("passes a usable ratio through", () => {
		expect(clampSplitRatio(0.42)).toBe(0.42);
	});

	it("clamps to the reachable range so a half is never dragged to nothing", () => {
		expect(clampSplitRatio(0)).toBe(MIN_SPLIT_RATIO);
		expect(clampSplitRatio(-3)).toBe(MIN_SPLIT_RATIO);
		expect(clampSplitRatio(1)).toBe(MAX_SPLIT_RATIO);
		expect(clampSplitRatio(12)).toBe(MAX_SPLIT_RATIO);
	});

	it("falls back to an even split on junk from data.json", () => {
		// Non-finite is junk, not "very large" — Infinity means the stored value
		// is meaningless, so the even split is the honest answer.
		expect(clampSplitRatio(NaN)).toBe(DEFAULT_SPLIT_RATIO);
		expect(clampSplitRatio(Infinity)).toBe(DEFAULT_SPLIT_RATIO);
		expect(clampSplitRatio(-Infinity)).toBe(DEFAULT_SPLIT_RATIO);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(clampSplitRatio("0.7" as any)).toBe(DEFAULT_SPLIT_RATIO);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(clampSplitRatio(undefined as any)).toBe(DEFAULT_SPLIT_RATIO);
	});
});

describe("ratioFromDrag", () => {
	it("moves the boundary by the pointer's share of the shared height", () => {
		// Dragging 50px down in 500px of shared space = +0.1 to the top half.
		expect(ratioFromDrag(0.5, 50, 500)).toBeCloseTo(0.6, 10);
		expect(ratioFromDrag(0.5, -50, 500)).toBeCloseTo(0.4, 10);
	});

	it("stops at the clamp instead of running past it", () => {
		expect(ratioFromDrag(0.8, 400, 500)).toBe(MAX_SPLIT_RATIO);
		expect(ratioFromDrag(0.2, -400, 500)).toBe(MIN_SPLIT_RATIO);
	});

	it("holds the start ratio when the height is unmeasurable", () => {
		expect(ratioFromDrag(0.4, 100, 0)).toBe(0.4);
		expect(ratioFromDrag(0.4, 100, -20)).toBe(0.4);
		expect(ratioFromDrag(0.4, NaN, 500)).toBe(0.4);
	});

	it("clamps the start ratio too, so a bad stored value self-heals", () => {
		expect(ratioFromDrag(0.99, 0, 500)).toBe(MAX_SPLIT_RATIO);
	});
});

describe("splitGrow", () => {
	it("splits the growth between the halves", () => {
		expect(splitGrow(0.35)).toEqual({ top: 0.35, bottom: 0.65 });
	});

	it("always sums to one, even from a clamped input", () => {
		for (const r of [-1, 0, 0.1, 0.5, 0.9, 1, 4, NaN]) {
			const g = splitGrow(r);
			expect(g.top + g.bottom).toBeCloseTo(1, 10);
			expect(g.top).toBeGreaterThan(0);
			expect(g.bottom).toBeGreaterThan(0);
		}
	});
});

describe("ratioChanged", () => {
	it("ignores sub-pixel drift so a tap does not write settings", () => {
		expect(ratioChanged(0.5, 0.5)).toBe(false);
		expect(ratioChanged(0.5, 0.502)).toBe(false);
	});

	it("reports a real move", () => {
		expect(ratioChanged(0.5, 0.55)).toBe(true);
	});

	it("compares clamped values, so junk vs default is not a change", () => {
		expect(ratioChanged(NaN, DEFAULT_SPLIT_RATIO)).toBe(false);
	});
});

describe("resolveDualSelection", () => {
	it("keeps a stored selection that still exists", () => {
		expect(
			resolveDualSelection(
				{ top: "threads", bottom: "highlights" },
				IDS,
				{ top: "capture", bottom: "dreams" }
			)
		).toEqual({ top: "threads", bottom: "highlights" });
	});

	it("falls back per half when a stored panel id is gone", () => {
		expect(
			resolveDualSelection({ top: "retired", bottom: "threads" }, IDS, {
				top: "capture",
				bottom: "dreams",
			})
		).toEqual({ top: "capture", bottom: "threads" });
	});

	it("survives missing / malformed stored values", () => {
		const defaults = { top: "capture", bottom: "dreams" };
		expect(resolveDualSelection(null, IDS, defaults)).toEqual(defaults);
		expect(resolveDualSelection(undefined, IDS, defaults)).toEqual(defaults);
		expect(resolveDualSelection({}, IDS, defaults)).toEqual(defaults);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(resolveDualSelection({ top: 7 as any }, IDS, defaults)).toEqual(
			defaults
		);
	});

	it("falls back to the first panel when even the default is gone", () => {
		expect(
			resolveDualSelection(null, ["threads", "dreams"], {
				top: "capture",
				bottom: "nope",
			})
		).toEqual({ top: "threads", bottom: "threads" });
	});

	it("returns empty ids only when there are no panels at all", () => {
		expect(
			resolveDualSelection(null, [], { top: "capture", bottom: "dreams" })
		).toEqual({ top: "", bottom: "" });
	});
});

describe("swap helpers", () => {
	it("swaps the two halves", () => {
		expect(swapDualSelection({ top: "a", bottom: "b" })).toEqual({
			top: "b",
			bottom: "a",
		});
	});

	it("swaps the ratio with them so each panel keeps its share", () => {
		expect(swapSplitRatio(0.3)).toBeCloseTo(0.7, 10);
		expect(swapSplitRatio(0.5)).toBe(0.5);
	});

	it("keeps a swapped ratio inside the clamp", () => {
		expect(swapSplitRatio(MIN_SPLIT_RATIO)).toBeCloseTo(MAX_SPLIT_RATIO, 10);
		// 1 - 0.85 lands a float epsilon under MIN; the clamp catches it.
		expect(swapSplitRatio(MAX_SPLIT_RATIO)).toBeGreaterThanOrEqual(
			MIN_SPLIT_RATIO
		);
		expect(swapSplitRatio(MAX_SPLIT_RATIO)).toBeCloseTo(MIN_SPLIT_RATIO, 10);
	});

	it("names the other half", () => {
		expect(otherHalf("top")).toBe("bottom");
		expect(otherHalf("bottom")).toBe("top");
	});
});

describe("applyDualChoice", () => {
	const sel = { top: "capture", bottom: "dreams" };

	it("sets the picked half", () => {
		expect(applyDualChoice(sel, "bottom", "threads")).toEqual({
			top: "capture",
			bottom: "threads",
		});
		expect(applyDualChoice(sel, "top", "threads")).toEqual({
			top: "threads",
			bottom: "dreams",
		});
	});

	it("is a no-op when the half already shows that panel", () => {
		expect(applyDualChoice(sel, "top", "capture")).toBe(sel);
	});

	it("swaps rather than showing one panel twice", () => {
		// Two live copies of a panel would fight over the same persisted state
		// (the Dreams filter, the Highlights anchor).
		expect(applyDualChoice(sel, "top", "dreams")).toEqual({
			top: "dreams",
			bottom: "capture",
		});
		expect(applyDualChoice(sel, "bottom", "capture")).toEqual({
			top: "dreams",
			bottom: "capture",
		});
	});
});
