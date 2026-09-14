// dual-core.ts — the dual panel's pure logic: how a drag becomes a split ratio,
// how a ratio becomes flex growth, and how a stored panel choice is validated
// against the panels that actually exist. No Obsidian imports, so it is unit
// tested directly (tests/dual-core.test.ts).
//
// A half's selection is a string id: a toolbox panel keeps its bare id
// ("capture"), while any other Obsidian view hosted in a half (v1.40.0) is
// namespaced "view:<type>" — see foreign-core.ts.
import { isForeignId } from "./foreign-core";

/** Which half of the dual panel. */
export type DualHalf = "top" | "bottom";

/** The two panel ids currently shown, top first. */
export interface DualSelection {
	top: string;
	bottom: string;
}

/**
 * The split ratio is the TOP half's share of the space the two panels divide.
 * Clamped so neither half can be dragged away to nothing — a zero-height half
 * would be unrecoverable on a phone, where the divider is the only handle.
 */
export const MIN_SPLIT_RATIO = 0.15;
export const MAX_SPLIT_RATIO = 0.85;
export const DEFAULT_SPLIT_RATIO = 0.5;

/** Clamp any stored/incoming ratio into the usable range; junk → the default. */
export function clampSplitRatio(ratio: number): number {
	if (typeof ratio !== "number" || !Number.isFinite(ratio)) {
		return DEFAULT_SPLIT_RATIO;
	}
	if (ratio < MIN_SPLIT_RATIO) return MIN_SPLIT_RATIO;
	if (ratio > MAX_SPLIT_RATIO) return MAX_SPLIT_RATIO;
	return ratio;
}

/**
 * The ratio a divider drag lands on: the ratio the drag started from, plus the
 * pointer's travel as a fraction of the space the two halves share.
 *
 * `availablePx` is the height available to BOTH panels (the view minus the
 * header and the divider itself). A zero/negative/unknown available height
 * means we cannot translate pixels into a ratio at all, so the start ratio is
 * returned unchanged rather than snapping the layout to a clamp bound.
 */
export function ratioFromDrag(
	startRatio: number,
	deltaPx: number,
	availablePx: number
): number {
	if (!Number.isFinite(availablePx) || availablePx <= 0) {
		return clampSplitRatio(startRatio);
	}
	if (!Number.isFinite(deltaPx)) return clampSplitRatio(startRatio);
	return clampSplitRatio(startRatio + deltaPx / availablePx);
}

/**
 * The flex-grow pair for the two halves. Both panes are `flex-basis: 0`, so
 * the free space divides in proportion to these numbers — no percentage height
 * that could resolve against the wrong container in the phone drawer.
 */
export function splitGrow(ratio: number): { top: number; bottom: number } {
	const r = clampSplitRatio(ratio);
	return { top: r, bottom: 1 - r };
}

/** Whether two ratios differ enough to be worth persisting. */
export function ratioChanged(a: number, b: number): boolean {
	return Math.abs(clampSplitRatio(a) - clampSplitRatio(b)) > 0.005;
}

/**
 * Validate a stored selection against the panel ids that exist in this build.
 * An unknown TOOLBOX id (a panel renamed or removed since data.json was written)
 * falls back to the default for that half, and the fallback itself falls back to
 * the first available panel — so the view can never come up with an empty half.
 * A hosted-view id ("view:…") is always kept; see the note in `pick`.
 */
export function resolveDualSelection(
	stored: Partial<DualSelection> | null | undefined,
	availableIds: readonly string[],
	defaults: DualSelection
): DualSelection {
	const pick = (value: unknown, fallback: string): string => {
		if (typeof value === "string" && availableIds.includes(value)) {
			return value;
		}
		// A hosted Obsidian view ("view:calendar") is kept even though it is not
		// in `availableIds`: whether that view type exists depends on which
		// plugins are enabled RIGHT NOW, and resetting the half because the
		// Calendar plugin happened to be off would silently lose Shawn's choice.
		// The mount decides — an unavailable type renders a placeholder, and
		// re-enabling the plugin brings the half back untouched.
		if (isForeignId(value)) return value;
		if (availableIds.includes(fallback)) return fallback;
		if (isForeignId(fallback)) return fallback;
		return availableIds[0] ?? "";
	};
	return {
		top: pick(stored?.top, defaults.top),
		bottom: pick(stored?.bottom, defaults.bottom),
	};
}

/** Swap the two halves (the ↕ button); the ratio is swapped with them. */
export function swapDualSelection(sel: DualSelection): DualSelection {
	return { top: sel.bottom, bottom: sel.top };
}

/** The ratio that keeps each panel's share of the space after a swap. */
export function swapSplitRatio(ratio: number): number {
	return clampSplitRatio(1 - clampSplitRatio(ratio));
}

/** The other half — used when a half is set to the panel the other one shows. */
export function otherHalf(half: DualHalf): DualHalf {
	return half === "top" ? "bottom" : "top";
}

/**
 * Setting one half to the panel the OTHER half already shows swaps them instead
 * of showing the same panel twice — two live copies of one panel would fight
 * over the same persisted state (the Dreams filter, the Highlights anchor).
 */
export function applyDualChoice(
	sel: DualSelection,
	half: DualHalf,
	id: string
): DualSelection {
	if (sel[half] === id) return sel;
	if (sel[otherHalf(half)] === id) return swapDualSelection(sel);
	return half === "top" ? { top: id, bottom: sel.bottom } : { top: sel.top, bottom: id };
}

// ---- Pages (v1.43.0) ----
//
// Shawn, 2026-09-13: "make it like a multi surface picker where you can
// customize how many panels you want … the main thing is to have 2 like in the
// screenshot but if I swipe from the right it goes to another side panel and I
// should be able to choose which one that is — I'd want it to be the audio
// capture right now." So the dual view holds a LIST OF PAGES; each page is a
// stack of 1–3 panes (panel ids + their shares of the height) and a horizontal
// swipe moves between pages. The two-half selection above is the v1.39.0
// storage shape and becomes page 1 on first load (see `resolveDualPages`).

/** One page of the dual view: a vertical stack of panes. */
export interface DualPage {
	/** Panel ids top→bottom (toolbox id or "view:<type>"), 1..MAX_PANES, unique. */
	panels: string[];
	/** Each pane's share of the height, same length as `panels`, summing to 1. */
	ratios: number[];
}

export const MAX_PANES = 3;
export const MAX_PAGES = 6;
/** Smallest share any pane can be dragged to (a zero-height pane is unrecoverable on a phone). */
export const MIN_PANE_SHARE = 0.15;

/** The page a fresh install (or a migrated v1.39.0 layout) swipes to: voice capture alone. */
export const DEFAULT_SECOND_PAGE_PANEL = "voice";

/** An even split for `n` panes. */
export function evenRatios(n: number): number[] {
	const count = Math.max(1, Math.min(MAX_PANES, Math.floor(n)));
	return Array.from({ length: count }, () => 1 / count);
}

/**
 * Coerce stored/incoming ratios for `n` panes into a usable set: right length,
 * finite, every pane at least MIN_PANE_SHARE, summing to 1. Anything that can't
 * be repaired falls back to an even split rather than snapping to a bound.
 */
export function normalizeRatios(ratios: unknown, n: number): number[] {
	const count = Math.max(1, Math.min(MAX_PANES, Math.floor(n)));
	if (count === 1) return [1];
	if (!Array.isArray(ratios) || ratios.length !== count) return evenRatios(count);
	const nums = ratios.map((r) => (typeof r === "number" && Number.isFinite(r) ? r : NaN));
	if (nums.some((r) => Number.isNaN(r) || r <= 0)) return evenRatios(count);
	const sum = nums.reduce((a, b) => a + b, 0);
	if (sum <= 0) return evenRatios(count);
	const scaled = nums.map((r) => r / sum);
	if (scaled.some((r) => r < MIN_PANE_SHARE - 1e-9)) return evenRatios(count);
	return scaled;
}

/** Whether an id can fill a pane in this build (toolbox panel or hosted view). */
function usablePanelId(value: unknown, availableIds: readonly string[]): value is string {
	return (
		typeof value === "string" &&
		(availableIds.includes(value) || isForeignId(value))
	);
}

/**
 * Validate one stored page: unknown toolbox ids drop out, duplicates collapse
 * to their first slot, the list is capped at MAX_PANES, ratios are repaired
 * (re-derived evenly when a pane dropped out, since the stored ones no longer
 * line up). Returns null for a page with nothing usable left.
 */
export function normalizePage(
	stored: unknown,
	availableIds: readonly string[]
): DualPage | null {
	if (!stored || typeof stored !== "object") return null;
	const raw = (stored as { panels?: unknown; ratios?: unknown }).panels;
	if (!Array.isArray(raw)) return null;
	const panels: string[] = [];
	for (const id of raw) {
		if (usablePanelId(id, availableIds) && !panels.includes(id)) panels.push(id);
		if (panels.length === MAX_PANES) break;
	}
	if (panels.length === 0) return null;
	const ratiosIn = (stored as { ratios?: unknown }).ratios;
	const ratios =
		panels.length === raw.length
			? normalizeRatios(ratiosIn, panels.length)
			: evenRatios(panels.length);
	return { panels, ratios };
}

/**
 * The page list to show. Stored pages win when at least one survives
 * validation; otherwise the v1.39.0 two-half selection (`legacy`) becomes page
 * 1 and a voice-capture page is added as page 2 — the layout Shawn asked for on
 * 2026-09-13 — so an upgrade shows exactly what it showed before, plus the
 * swipe. The result always has 1..MAX_PAGES pages.
 */
export function resolveDualPages(
	stored: unknown,
	availableIds: readonly string[],
	legacy: { selection: DualSelection; ratio: number }
): DualPage[] {
	const pages: DualPage[] = [];
	if (Array.isArray(stored)) {
		for (const p of stored) {
			const page = normalizePage(p, availableIds);
			if (page) pages.push(page);
			if (pages.length === MAX_PAGES) break;
		}
	}
	if (pages.length > 0) return pages;
	const first = normalizePage(
		{
			panels: [legacy.selection.top, legacy.selection.bottom],
			ratios: [clampSplitRatio(legacy.ratio), 1 - clampSplitRatio(legacy.ratio)],
		},
		availableIds
	) ?? { panels: [availableIds[0] ?? ""], ratios: [1] };
	pages.push(first);
	if (availableIds.includes(DEFAULT_SECOND_PAGE_PANEL)) {
		pages.push({ panels: [DEFAULT_SECOND_PAGE_PANEL], ratios: [1] });
	}
	return pages;
}

/** Clamp a stored page index to the pages that exist. */
export function clampPageIndex(index: unknown, count: number): number {
	if (count <= 0) return 0;
	if (typeof index !== "number" || !Number.isFinite(index)) return 0;
	const i = Math.floor(index);
	if (i < 0) return 0;
	if (i >= count) return count - 1;
	return i;
}

/**
 * The page a horizontal swipe lands on. `dx` is the finger's travel (negative =
 * leftward = "swipe from the right" = NEXT page); no wrap-around, so a swipe
 * past the last page stays put — a wrap would make "which page am I on"
 * unknowable mid-gesture.
 */
export function pageAfterSwipe(
	current: number,
	count: number,
	dx: number,
	dy: number,
	threshold = 60
): number {
	const cur = clampPageIndex(current, count);
	if (!Number.isFinite(dx) || !Number.isFinite(dy)) return cur;
	if (Math.abs(dx) < threshold) return cur;
	// mostly horizontal, or it was a scroll
	if (Math.abs(dx) < Math.abs(dy) * 1.5) return cur;
	return clampPageIndex(dx < 0 ? cur + 1 : cur - 1, count);
}

/**
 * Whether a touch that has just landed should be tracked as a possible page
 * swipe. Exactly one finger (two is a pinch, and a pinch that drifts sideways
 * must not flip the page), and not on the divider — the divider owns its own
 * drag, and a resize is not a page change.
 */
export function trackableSwipeTouch(touchCount: number, onDivider: boolean): boolean {
	return touchCount === 1 && !onDivider;
}

/**
 * Drag the divider below pane `index`: the two panes it separates trade share,
 * everything else keeps its height. Both stay at least MIN_PANE_SHARE.
 */
export function ratiosFromDrag(
	startRatios: readonly number[],
	index: number,
	deltaPx: number,
	availablePx: number
): number[] {
	const ratios = normalizeRatios([...startRatios], startRatios.length);
	if (index < 0 || index >= ratios.length - 1) return ratios;
	if (!Number.isFinite(availablePx) || availablePx <= 0) return ratios;
	if (!Number.isFinite(deltaPx)) return ratios;
	const pair = ratios[index] + ratios[index + 1];
	const minTop = MIN_PANE_SHARE;
	const maxTop = pair - MIN_PANE_SHARE;
	let top = ratios[index] + deltaPx / availablePx;
	if (top < minTop) top = minTop;
	if (top > maxTop) top = maxTop;
	const next = [...ratios];
	next[index] = top;
	next[index + 1] = pair - top;
	return next;
}

/** Whether two ratio sets differ enough to be worth persisting. */
export function ratiosChanged(a: readonly number[], b: readonly number[]): boolean {
	if (a.length !== b.length) return true;
	return a.some((r, i) => Math.abs(r - b[i]) > 0.005);
}

/**
 * Set pane `slot` of a page to `id`. Picking a panel another pane of the SAME
 * page already shows swaps the two (ratios travel with them) — two live copies
 * of one panel would fight over its persisted state. Unchanged → same object.
 */
export function setPagePanel(page: DualPage, slot: number, id: string): DualPage {
	if (slot < 0 || slot >= page.panels.length) return page;
	if (page.panels[slot] === id) return page;
	const other = page.panels.indexOf(id);
	const panels = [...page.panels];
	const ratios = [...page.ratios];
	if (other >= 0) {
		panels[slot] = id;
		panels[other] = page.panels[slot];
		ratios[slot] = page.ratios[other];
		ratios[other] = page.ratios[slot];
		return { panels, ratios };
	}
	panels[slot] = id;
	return { panels, ratios };
}

/** Reverse the stack (the ↕ button); ratios reverse with the panes. */
export function reversePage(page: DualPage): DualPage {
	return {
		panels: [...page.panels].reverse(),
		ratios: [...page.ratios].reverse(),
	};
}

/** Add a pane at the bottom (even split). No-op at MAX_PANES or for a duplicate. */
export function addPane(page: DualPage, id: string): DualPage {
	if (page.panels.length >= MAX_PANES || page.panels.includes(id)) return page;
	const panels = [...page.panels, id];
	return { panels, ratios: evenRatios(panels.length) };
}

/** Remove pane `slot`; the survivors re-split evenly. A page keeps at least one pane. */
export function removePane(page: DualPage, slot: number): DualPage {
	if (page.panels.length <= 1 || slot < 0 || slot >= page.panels.length) return page;
	const panels = page.panels.filter((_, i) => i !== slot);
	return { panels, ratios: evenRatios(panels.length) };
}

/** Append a page; no-op at MAX_PAGES. */
export function addPage(pages: DualPage[], page: DualPage): DualPage[] {
	if (pages.length >= MAX_PAGES) return pages;
	return [...pages, page];
}

/** Remove page `index`; the list keeps at least one page. */
export function removePage(pages: DualPage[], index: number): DualPage[] {
	if (pages.length <= 1 || index < 0 || index >= pages.length) return pages;
	return pages.filter((_, i) => i !== index);
}

/** The flex-grow per pane (panes are `flex-basis: 0`, so grow = share). */
export function paneGrows(ratios: readonly number[]): number[] {
	return normalizeRatios([...ratios], ratios.length);
}
