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
