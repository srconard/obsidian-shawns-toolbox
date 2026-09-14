import { describe, expect, it } from "vitest";
import {
	addPage,
	addPane,
	clampPageIndex,
	DEFAULT_SECOND_PAGE_PANEL,
	evenRatios,
	MAX_PAGES,
	MAX_PANES,
	MIN_PANE_SHARE,
	normalizePage,
	normalizeRatios,
	pageAfterSwipe,
	paneGrows,
	ratiosChanged,
	ratiosFromDrag,
	removePage,
	removePane,
	resolveDualPages,
	reversePage,
	setPagePanel,
	trackableSwipeTouch,
} from "../dual-core";

const IDS = ["capture", "threads", "dreams", "voice", "highlights"];
const LEGACY = { selection: { top: "capture", bottom: "dreams" }, ratio: 0.5 };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("normalizeRatios", () => {
	it("passes a valid set through, scaled to sum 1", () => {
		expect(normalizeRatios([1, 1], 2)).toEqual([0.5, 0.5]);
		expect(normalizeRatios([0.3, 0.7], 2)).toEqual([0.3, 0.7]);
	});

	it("falls back to an even split on junk, wrong length, or a crushed pane", () => {
		expect(normalizeRatios(null, 3)).toEqual(evenRatios(3));
		expect(normalizeRatios([0.5], 2)).toEqual([0.5, 0.5]);
		expect(normalizeRatios([0.05, 0.95], 2)).toEqual([0.5, 0.5]);
		expect(normalizeRatios([NaN, 1], 2)).toEqual([0.5, 0.5]);
		expect(normalizeRatios([0, 1], 2)).toEqual([0.5, 0.5]);
	});

	it("a single pane is always the whole height", () => {
		expect(normalizeRatios([0.2], 1)).toEqual([1]);
	});
});

describe("normalizePage", () => {
	it("keeps valid toolbox ids and hosted view ids, in order", () => {
		expect(normalizePage({ panels: ["capture", "view:calendar"], ratios: [0.4, 0.6] }, IDS)).toEqual({
			panels: ["capture", "view:calendar"],
			ratios: [0.4, 0.6],
		});
	});

	it("drops unknown ids and duplicates, re-splitting evenly when a pane fell out", () => {
		expect(normalizePage({ panels: ["capture", "gone", "capture", "voice"], ratios: [0.2, 0.2, 0.2, 0.4] }, IDS)).toEqual({
			panels: ["capture", "voice"],
			ratios: [0.5, 0.5],
		});
	});

	it("caps at MAX_PANES", () => {
		const page = normalizePage({ panels: IDS }, IDS);
		expect(page?.panels.length).toBe(MAX_PANES);
		expect(sum(page!.ratios)).toBeCloseTo(1);
	});

	it("returns null when nothing usable is left", () => {
		expect(normalizePage({ panels: ["nope"] }, IDS)).toBeNull();
		expect(normalizePage({ panels: [] }, IDS)).toBeNull();
		expect(normalizePage("junk", IDS)).toBeNull();
		expect(normalizePage(null, IDS)).toBeNull();
	});
});

describe("resolveDualPages", () => {
	it("migrates the v1.39.0 two-half layout into page 1 and adds the voice page", () => {
		const pages = resolveDualPages(undefined, IDS, { ...LEGACY, ratio: 0.3 });
		expect(pages).toEqual([
			{ panels: ["capture", "dreams"], ratios: [0.3, 0.7] },
			{ panels: [DEFAULT_SECOND_PAGE_PANEL], ratios: [1] },
		]);
	});

	it("prefers stored pages when any survive", () => {
		const pages = resolveDualPages(
			[{ panels: ["threads"], ratios: [1] }, { panels: ["bogus"] }],
			IDS,
			LEGACY
		);
		expect(pages).toEqual([{ panels: ["threads"], ratios: [1] }]);
	});

	it("falls back to the legacy migration when every stored page is junk", () => {
		const pages = resolveDualPages([{ panels: ["bogus"] }], IDS, LEGACY);
		expect(pages[0].panels).toEqual(["capture", "dreams"]);
		expect(pages).toHaveLength(2);
	});

	it("never adds a voice page in a build without that panel", () => {
		const pages = resolveDualPages(null, ["capture", "dreams"], LEGACY);
		expect(pages).toHaveLength(1);
	});

	it("caps the page count", () => {
		const many = Array.from({ length: MAX_PAGES + 3 }, () => ({ panels: ["capture"] }));
		expect(resolveDualPages(many, IDS, LEGACY)).toHaveLength(MAX_PAGES);
	});
});

describe("clampPageIndex", () => {
	it("keeps an index inside the page list", () => {
		expect(clampPageIndex(1, 3)).toBe(1);
		expect(clampPageIndex(7, 3)).toBe(2);
		expect(clampPageIndex(-2, 3)).toBe(0);
		expect(clampPageIndex("x", 3)).toBe(0);
		expect(clampPageIndex(1.7, 3)).toBe(1);
		expect(clampPageIndex(0, 0)).toBe(0);
	});
});

describe("pageAfterSwipe", () => {
	it("a leftward swipe goes to the next page, rightward to the previous", () => {
		expect(pageAfterSwipe(0, 3, -120, 5)).toBe(1);
		expect(pageAfterSwipe(2, 3, 120, -5)).toBe(1);
	});

	it("does not wrap past either end", () => {
		expect(pageAfterSwipe(2, 3, -120, 0)).toBe(2);
		expect(pageAfterSwipe(0, 3, 120, 0)).toBe(0);
	});

	it("ignores short moves and mostly-vertical scrolls", () => {
		expect(pageAfterSwipe(0, 3, -40, 0)).toBe(0);
		expect(pageAfterSwipe(0, 3, -80, 70)).toBe(0);
		expect(pageAfterSwipe(0, 3, NaN, 0)).toBe(0);
	});
});

describe("trackableSwipeTouch", () => {
	it("tracks a single finger anywhere but the divider", () => {
		expect(trackableSwipeTouch(1, false)).toBe(true);
	});

	it("ignores a divider drag — that is a resize, not a page change", () => {
		expect(trackableSwipeTouch(1, true)).toBe(false);
	});

	it("ignores a second finger — a pinch that drifts sideways is not a swipe", () => {
		expect(trackableSwipeTouch(2, false)).toBe(false);
		expect(trackableSwipeTouch(3, false)).toBe(false);
	});

	it("ignores a touchstart carrying no touches at all", () => {
		expect(trackableSwipeTouch(0, false)).toBe(false);
	});
});

/**
 * v1.45.1 regression. The left dual panel never changed page on the phone:
 * a real one-finger drag produces pointerdown → pointermove → POINTERCANCEL →
 * touchmove … → touchend, so a swipe judged at `pointerup` is dropped. The
 * handler now judges at touchend/touchcancel from the last touch position,
 * which is what these cases stand in for — the decision must hold when the
 * final coordinate comes from `changedTouches` after the pointer stream died.
 */
describe("pageAfterSwipe — judged from the end of a cancelled pointer stream", () => {
	it("still pages when the travel is only known from the final touch", () => {
		// start 306 → end 40 on the left panel's first of two pages
		expect(pageAfterSwipe(0, 2, 40 - 306, 0)).toBe(1);
		// and back again
		expect(pageAfterSwipe(1, 2, 306 - 40, 0)).toBe(0);
	});

	it("a swipe that stopped short of the threshold still does not page", () => {
		expect(pageAfterSwipe(0, 2, 225 - 250, 0)).toBe(0);
	});
});

describe("ratiosFromDrag", () => {
	it("moves share between the two panes the divider separates only", () => {
		const next = ratiosFromDrag([1 / 3, 1 / 3, 1 / 3], 0, 30, 300);
		expect(next[0]).toBeCloseTo(1 / 3 + 0.1);
		expect(next[1]).toBeCloseTo(1 / 3 - 0.1);
		expect(next[2]).toBeCloseTo(1 / 3);
		expect(sum(next)).toBeCloseTo(1);
	});

	it("keeps both neighbours at least MIN_PANE_SHARE", () => {
		const next = ratiosFromDrag([0.5, 0.5], 0, 10000, 300);
		expect(next[1]).toBeCloseTo(MIN_PANE_SHARE);
		expect(next[0]).toBeCloseTo(1 - MIN_PANE_SHARE);
		const back = ratiosFromDrag([0.5, 0.5], 0, -10000, 300);
		expect(back[0]).toBeCloseTo(MIN_PANE_SHARE);
	});

	it("returns the start ratios for an unknown height or divider", () => {
		expect(ratiosFromDrag([0.5, 0.5], 0, 30, 0)).toEqual([0.5, 0.5]);
		expect(ratiosFromDrag([0.5, 0.5], 1, 30, 300)).toEqual([0.5, 0.5]);
		expect(ratiosFromDrag([1], 0, 30, 300)).toEqual([1]);
	});
});

describe("ratiosChanged / paneGrows", () => {
	it("notices a real move and ignores noise", () => {
		expect(ratiosChanged([0.5, 0.5], [0.5, 0.5])).toBe(false);
		expect(ratiosChanged([0.5, 0.5], [0.501, 0.499])).toBe(false);
		expect(ratiosChanged([0.5, 0.5], [0.6, 0.4])).toBe(true);
		expect(ratiosChanged([1], [0.5, 0.5])).toBe(true);
	});

	it("grows are the normalised shares", () => {
		expect(paneGrows([2, 2])).toEqual([0.5, 0.5]);
	});
});

describe("page editing", () => {
	const page = { panels: ["capture", "dreams"], ratios: [0.3, 0.7] };

	it("setPagePanel replaces a pane, swaps when the id is already on the page", () => {
		expect(setPagePanel(page, 1, "voice")).toEqual({ panels: ["capture", "voice"], ratios: [0.3, 0.7] });
		expect(setPagePanel(page, 0, "dreams")).toEqual({ panels: ["dreams", "capture"], ratios: [0.7, 0.3] });
		expect(setPagePanel(page, 0, "capture")).toBe(page);
		expect(setPagePanel(page, 5, "voice")).toBe(page);
	});

	it("reversePage flips panes and ratios together", () => {
		expect(reversePage(page)).toEqual({ panels: ["dreams", "capture"], ratios: [0.7, 0.3] });
	});

	it("addPane appends with an even split, up to MAX_PANES, never a duplicate", () => {
		const three = addPane(page, "voice");
		expect(three.panels).toEqual(["capture", "dreams", "voice"]);
		expect(three.ratios).toEqual(evenRatios(3));
		expect(addPane(three, "threads")).toBe(three);
		expect(addPane(page, "dreams")).toBe(page);
	});

	it("removePane keeps at least one pane and re-splits evenly", () => {
		expect(removePane(page, 0)).toEqual({ panels: ["dreams"], ratios: [1] });
		expect(removePane({ panels: ["capture"], ratios: [1] }, 0).panels).toEqual(["capture"]);
		expect(removePane(page, 9)).toBe(page);
	});

	it("addPage / removePage respect the bounds", () => {
		const pages = [page];
		expect(addPage(pages, { panels: ["voice"], ratios: [1] })).toHaveLength(2);
		const full = Array.from({ length: MAX_PAGES }, () => page);
		expect(addPage(full, page)).toBe(full);
		expect(removePage(pages, 0)).toBe(pages);
		expect(removePage([page, page], 1)).toHaveLength(1);
		expect(removePage([page, page], 4)).toHaveLength(2);
	});
});
