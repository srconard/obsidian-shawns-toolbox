// pillar-scrub.ts — the hold-and-drag scrub selector for the Pillars panel
// selector button (v1.18.0). One continuous gesture: press the button, hold
// briefly until an overlay list of pillars pops up, slide the finger down/up to
// move the highlight (amplified — see scrubIndex, the list moves faster than the
// finger), and release to pick the highlighted pillar. A quick tap (no hold)
// falls through to the normal behaviour: open the same list as a tappable menu.
//
// No Obsidian imports — pure DOM — so the amplification math (pillar-core's
// scrubIndex) is unit-tested and this glue stays framework-free.
import { scrubIndex } from "./pillar-core";

export interface ScrubItem {
	display: string;
}

export interface PillarScrubOptions {
	/** The pillars to choose among, in ring order. */
	getItems: () => ScrubItem[];
	/** The currently-selected index (the gesture starts highlighting here). */
	getCurrentIndex: () => number;
	/** Commit a selection (release over a highlight, or tap a row). */
	onSelect: (index: number) => void;
}

const HOLD_MS = 350; // press this long → the scrub overlay opens
const PENDING_MOVE_CANCEL = 12; // px of movement before the hold fires → it was a scroll, not a press
const CANCEL_X = 100; // px of horizontal drift during a scrub → abort without selecting

/** Pixel distance that should traverse the whole pillar list; a fraction of the
 *  viewport height so it feels the same on phone and desktop, bounded so short
 *  and tall lists both stay comfortable. */
function scrubTravel(): number {
	return Math.min(320, Math.max(160, Math.round(window.innerHeight * 0.4)));
}

interface Overlay {
	root: HTMLElement;
	highlight: (index: number) => void;
	setAborting: (aborting: boolean) => void;
	close: () => void;
}

/**
 * Build the floating pillar list. `tappable` wires each row to select on click
 * and a backdrop to dismiss (tap mode); scrub mode leaves rows inert and drives
 * the highlight from the drag. The overlay is fixed-position on document.body so
 * it floats above the narrow sidebar.
 */
function buildOverlay(
	items: ScrubItem[],
	current: number,
	tappable: { onSelect: (i: number) => void; onDismiss: () => void } | null
): Overlay {
	const backdrop = document.createElement("div");
	backdrop.className = "stx-pillar-scrub-backdrop";
	const root = document.createElement("div");
	root.className = "stx-pillar-scrub";
	backdrop.appendChild(root);
	document.body.appendChild(backdrop);

	const rows: HTMLElement[] = items.map((it, i) => {
		const row = document.createElement("div");
		row.className = "stx-pillar-scrub-item";
		row.textContent = it.display;
		if (tappable) {
			row.addEventListener("click", (e) => {
				e.stopPropagation();
				tappable.onSelect(i);
			});
		}
		root.appendChild(row);
		return row;
	});

	if (tappable) {
		backdrop.addEventListener("click", () => tappable.onDismiss());
	}

	let highlighted = -1;
	const highlight = (index: number) => {
		if (index === highlighted) return;
		if (rows[highlighted]) rows[highlighted].removeClass("is-active");
		highlighted = index;
		const row = rows[index];
		if (!row) return;
		row.addClass("is-active");
		// Keep the highlighted row in view so the list appears to scroll under a
		// fixed selection point as the finger drags.
		const target = row.offsetTop - root.clientHeight / 2 + row.offsetHeight / 2;
		root.scrollTop = target;
	};
	highlight(current);

	return {
		root,
		highlight,
		setAborting: (aborting) => root.toggleClass("is-aborting", aborting),
		close: () => backdrop.remove(),
	};
}

/**
 * Wire the press-hold-drag-release scrub gesture (and the fall-through tap) onto
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
	let overlay: Overlay | null = null;
	let pointerId = -1;
	// A scrub (or an abandoned press) is followed by a synthesized click we must
	// swallow, so it doesn't reopen the list. A genuine tap leaves this false and
	// its click is what opens the tap menu — sidestepping the ghost-click race.
	let suppressClick = false;

	const clearHold = () => {
		if (holdTimer !== null) {
			window.clearTimeout(holdTimer);
			holdTimer = null;
		}
	};

	const closeOverlay = () => {
		overlay?.close();
		overlay = null;
	};

	const reset = () => {
		clearHold();
		closeOverlay();
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
		startIndex = Math.min(count - 1, Math.max(0, opts.getCurrentIndex()));
		current = startIndex;
		travel = scrubTravel();
		overlay = buildOverlay(items, startIndex, null);
	};

	const openTapMenu = () => {
		const items = opts.getItems();
		if (items.length === 0) return;
		overlay = buildOverlay(items, opts.getCurrentIndex(), {
			onSelect: (i) => {
				closeOverlay();
				opts.onSelect(i);
			},
			onDismiss: closeOverlay,
		});
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
		if (mode !== "scrub" || !overlay) return;
		e.preventDefault();
		aborting = Math.abs(e.clientX - startX) > CANCEL_X;
		overlay.setAborting(aborting);
		current = scrubIndex(startIndex, e.clientY - startY, count, travel);
		overlay.highlight(current);
	});

	const finish = (e: PointerEvent) => {
		if (e.pointerId !== pointerId) return;
		const wasScrub = mode === "scrub";
		const commit = wasScrub && !aborting;
		const pick = current;
		// The scrub's own release synthesizes a click; swallow it. A plain tap
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
