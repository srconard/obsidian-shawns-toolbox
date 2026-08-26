// pillar-scrub.ts — the slot-reel wheel selector for the Pillars panel selector
// button (v1.21.0, reworked from the v1.18.0 anchored scrub). One continuous
// gesture: press the button, hold briefly until a reel of pillars pops up with a
// FIXED centre selector, slide the finger to spin the list under that selector
// (amplified — see pillar-core's wheelPosition, the reel moves faster than the
// finger — and wrapping around endlessly so every pillar is reachable from any
// touch position), and release to pick whatever pillar sits in the centre. A
// quick tap (no hold) falls through to the normal behaviour: open the same list
// as a tappable menu.
//
// No Obsidian imports — pure DOM — so the wheel math (pillar-core) is unit-tested
// and this glue stays framework-free.
import { wheelIndex, wheelPosition, wrapIndex } from "./pillar-core";

export interface ScrubItem {
	display: string;
}

export interface PillarScrubOptions {
	/** The pillars to choose among, in ring order. */
	getItems: () => ScrubItem[];
	/** The currently-selected index (the reel starts centred here). */
	getCurrentIndex: () => number;
	/** Commit a selection (release with a pillar in the centre, or tap a row). */
	onSelect: (index: number) => void;
}

const HOLD_MS = 350; // press this long → the reel opens
const PENDING_MOVE_CANCEL = 12; // px of movement before the hold fires → it was a scroll, not a press
const CANCEL_X = 100; // px of horizontal drift during a spin → abort without selecting
const ROW_H = 40; // px height of a reel row — MUST match .stx-pillar-reel-item in styles.css
const HALF_SLOTS = 3; // rows shown above and below the centre selector

/** Pixel distance that should spin the reel a full turn (all items); a fraction
 *  of the viewport height so it feels the same on phone and desktop, bounded so
 *  short and tall lists both stay comfortable. */
function scrubTravel(): number {
	return Math.min(320, Math.max(160, Math.round(window.innerHeight * 0.4)));
}

/* ------------------------------------------------------------------ tap menu */

interface TapMenu {
	close: () => void;
}

/** The fall-through quick-tap list: the full pillar list as a tappable menu with
 *  a dismiss backdrop. (The reel is for the hold gesture; a tap just picks.) */
function buildTapMenu(
	items: ScrubItem[],
	current: number,
	onSelect: (i: number) => void,
	onDismiss: () => void
): TapMenu {
	const backdrop = document.createElement("div");
	backdrop.className = "stx-pillar-scrub-backdrop";
	const root = document.createElement("div");
	root.className = "stx-pillar-scrub";
	backdrop.appendChild(root);
	document.body.appendChild(backdrop);

	items.forEach((it, i) => {
		const row = document.createElement("div");
		row.className = "stx-pillar-scrub-item";
		if (i === current) row.addClass("is-active");
		row.textContent = it.display;
		row.addEventListener("click", (e) => {
			e.stopPropagation();
			onSelect(i);
		});
		root.appendChild(row);
	});
	backdrop.addEventListener("click", () => onDismiss());
	items[current] &&
		root.children[current]?.scrollIntoView({ block: "center" });

	return { close: () => backdrop.remove() };
}

/* ---------------------------------------------------------------- slot reel */

interface Reel {
	/** Spin the reel to a fractional list position (integer = an item centred). */
	update: (pos: number) => void;
	setAborting: (aborting: boolean) => void;
	close: () => void;
}

/**
 * Build the floating slot-reel: a fixed-height window with a stationary centre
 * selector band, and a strip of rows that translates under it. `update(pos)`
 * fills the visible rows from the wrapped list around `round(pos)` and shifts the
 * strip by the sub-item fraction, so the list appears to spin continuously and
 * endlessly past the fixed selector.
 */
function buildReel(items: ScrubItem[]): Reel {
	const count = items.length;
	const backdrop = document.createElement("div");
	backdrop.className = "stx-pillar-scrub-backdrop";
	const reel = document.createElement("div");
	reel.className = "stx-pillar-reel";
	reel.style.height = `${ROW_H * (HALF_SLOTS * 2 + 1)}px`;

	const selector = document.createElement("div");
	selector.className = "stx-pillar-reel-selector";
	selector.style.height = `${ROW_H}px`;

	const strip = document.createElement("div");
	strip.className = "stx-pillar-reel-strip";

	const slots: HTMLElement[] = [];
	for (let k = -HALF_SLOTS; k <= HALF_SLOTS; k++) {
		const row = document.createElement("div");
		row.className = "stx-pillar-reel-item";
		row.style.height = `${ROW_H}px`;
		if (k === 0) row.addClass("is-center");
		strip.appendChild(row);
		slots.push(row);
	}

	reel.appendChild(selector);
	reel.appendChild(strip);
	backdrop.appendChild(reel);
	document.body.appendChild(backdrop);

	const update = (pos: number) => {
		const centre = Math.round(pos);
		const frac = pos - centre;
		// The strip sits so its centre slot lands on the selector, then shifts by
		// the sub-item fraction for smooth motion.
		strip.style.transform = `translateY(${-frac * ROW_H}px)`;
		slots.forEach((row, s) => {
			const k = s - HALF_SLOTS;
			const item = items[wrapIndex(centre + k, count)];
			row.textContent = item ? item.display : "";
		});
	};

	return {
		update,
		setAborting: (aborting) => reel.toggleClass("is-aborting", aborting),
		close: () => backdrop.remove(),
	};
}

/* --------------------------------------------------------------- the gesture */

/**
 * Wire the press-hold-spin-release wheel gesture (and the fall-through tap) onto
 * a selector button. Pointer capture keeps the drag alive off the small button;
 * `touch-action: none` (set on the button by CSS) stops the page scrolling under
 * a vertical drag.
 */
export function wirePillarScrub(
	button: HTMLElement,
	opts: PillarScrubOptions
): void {
	let mode: "idle" | "pending" | "scrub" = "idle";
	let startX = 0;
	let startY = 0;
	let startIndex = 0;
	let travel = 0;
	let count = 0;
	let current = 0;
	let aborting = false;
	let holdTimer: number | null = null;
	let reel: Reel | null = null;
	let tapMenu: TapMenu | null = null;
	let pointerId = -1;
	// A spin (or an abandoned press) is followed by a synthesized click we must
	// swallow, so it doesn't reopen the list. A genuine tap leaves this false and
	// its click is what opens the tap menu — sidestepping the ghost-click race.
	let suppressClick = false;

	const clearHold = () => {
		if (holdTimer !== null) {
			window.clearTimeout(holdTimer);
			holdTimer = null;
		}
	};

	const closeReel = () => {
		reel?.close();
		reel = null;
	};

	const closeTapMenu = () => {
		tapMenu?.close();
		tapMenu = null;
	};

	const reset = () => {
		clearHold();
		closeReel();
		button.removeClass("stx-pillar-pressed");
		if (pointerId >= 0 && button.hasPointerCapture(pointerId)) {
			button.releasePointerCapture(pointerId);
		}
		mode = "idle";
		pointerId = -1;
		aborting = false;
	};

	const beginScrub = () => {
		const items = opts.getItems();
		count = items.length;
		if (count === 0) {
			reset();
			return;
		}
		mode = "scrub";
		// The currently-selected pillar starts centred in the selector.
		startIndex = wrapIndex(opts.getCurrentIndex(), count);
		current = startIndex;
		travel = scrubTravel();
		reel = buildReel(items);
		reel.update(startIndex);
	};

	const openTapMenu = () => {
		const items = opts.getItems();
		if (items.length === 0) return;
		tapMenu = buildTapMenu(
			items,
			wrapIndex(opts.getCurrentIndex(), items.length),
			(i) => {
				closeTapMenu();
				opts.onSelect(i);
			},
			closeTapMenu
		);
	};

	button.addEventListener("pointerdown", (e) => {
		if (opts.getItems().length === 0) return;
		// Left button / touch / pen only.
		if (e.button !== undefined && e.button > 0) return;
		reset();
		suppressClick = false;
		pointerId = e.pointerId;
		startX = e.clientX;
		startY = e.clientY;
		mode = "pending";
		button.addClass("stx-pillar-pressed");
		try {
			button.setPointerCapture(pointerId);
		} catch {
			/* capture is best-effort */
		}
		holdTimer = window.setTimeout(() => {
			holdTimer = null;
			if (mode === "pending") beginScrub();
		}, HOLD_MS);
	});

	button.addEventListener("pointermove", (e) => {
		if (e.pointerId !== pointerId) return;
		if (mode === "pending") {
			// Movement before the hold fired means the user is scrolling, not
			// pressing — abandon so we neither scrub nor register a tap.
			if (
				Math.abs(e.clientX - startX) > PENDING_MOVE_CANCEL ||
				Math.abs(e.clientY - startY) > PENDING_MOVE_CANCEL
			) {
				suppressClick = true;
				reset();
			}
			return;
		}
		if (mode !== "scrub" || !reel) return;
		e.preventDefault();
		aborting = Math.abs(e.clientX - startX) > CANCEL_X;
		reel.setAborting(aborting);
		const deltaY = e.clientY - startY;
		reel.update(wheelPosition(startIndex, deltaY, count, travel));
		current = wheelIndex(startIndex, deltaY, count, travel);
	});

	const finish = (e: PointerEvent) => {
		if (e.pointerId !== pointerId) return;
		const wasScrub = mode === "scrub";
		const commit = wasScrub && !aborting;
		const pick = current;
		// The spin's own release synthesizes a click; swallow it. A plain tap
		// (mode "pending") leaves suppressClick false, and its click opens the
		// list below.
		if (wasScrub) suppressClick = true;
		reset();
		if (commit) opts.onSelect(pick);
	};

	button.addEventListener("pointerup", finish);
	button.addEventListener("pointercancel", (e) => {
		if (e.pointerId !== pointerId) return;
		suppressClick = true;
		reset();
	});
	button.addEventListener("click", (e) => {
		if (suppressClick) {
			suppressClick = false;
			e.preventDefault();
			e.stopPropagation();
			return;
		}
		openTapMenu(); // a quick tap → the pillar list to pick from
	});
}
