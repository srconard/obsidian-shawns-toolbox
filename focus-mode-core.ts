// focus-mode-core.ts — framework-free logic for "Focus mode" (v1.55.0).
//
// Shawn, 2026-09-26 12:49 (eco-web inside Obsidian's Web viewer, laptop):
// "a full screen mode that will just get rid of the blue bar at the top of the
// screen that has the tabs … so then i would just be focusing on the threads
// screen and eco web chat". Focus mode puts FOCUS_MODE_CLASS on <body>, and
// styles.css hides every tab-header strip plus the desktop titlebar. The
// optional FOCUS_MODE_VIEW_HEADERS_CLASS also hides each leaf's view header.
// Desktop only: mobile never gets either class.
//
// Not to be confused with the Focus *panel* (focus-view.ts), which shows the
// Plan-for-Today section cards.

export const FOCUS_MODE_CLASS = "stx-focus-mode";
export const FOCUS_MODE_VIEW_HEADERS_CLASS = "stx-focus-mode-hide-view-headers";

/** Default hotkey: Ctrl/Cmd+Shift+F11. Unbound in core Obsidian 1.13.7 (measured). */
export const FOCUS_MODE_HOTKEY = { modifiers: ["Mod", "Shift"], key: "F11" } as const;

export interface FocusModeSettings {
	/** Last state, remembered across reloads. */
	focusModeOn: boolean;
	/** Always come up in focus mode, whatever the last state was. */
	startInFocusMode: boolean;
	/** Also hide each leaf's .view-header (title row, Web viewer URL bar). */
	focusModeHideViewHeaders: boolean;
	/** Also put the Electron window into OS full screen. */
	focusModeOsFullscreen: boolean;
}

/** State on plugin load: "start in focus mode" wins, else the remembered state. */
export function initialFocusMode(s: Pick<FocusModeSettings, "focusModeOn" | "startInFocusMode">): boolean {
	return s.startInFocusMode || s.focusModeOn;
}

/** Minimal slice of DOMTokenList, so tests can pass a fake. */
export interface ClassListLike {
	toggle(token: string, force?: boolean): boolean;
}

/**
 * Add or remove both body classes. Returns whether focus mode is applied —
 * always false on mobile, where any stale class is cleared.
 */
export function applyFocusMode(
	classList: ClassListLike,
	on: boolean,
	hideViewHeaders: boolean,
	isMobile: boolean
): boolean {
	const active = on && !isMobile;
	classList.toggle(FOCUS_MODE_CLASS, active);
	classList.toggle(FOCUS_MODE_VIEW_HEADERS_CLASS, active && hideViewHeaders);
	return active;
}

/**
 * What to do with the OS (Electron window) full screen when focus mode changes.
 * We only leave full screen if focus mode put the window there — a window that
 * was already full screen (F11 in the OS menu, or maximised by the user) is left
 * alone. Returns the action and the new "we own it" flag.
 */
export function osFullscreenStep(
	focusOn: boolean,
	settingOn: boolean,
	windowIsFullscreen: boolean,
	weOwnIt: boolean
): { action: "enter" | "leave" | "none"; owned: boolean } {
	if (focusOn && settingOn) {
		if (windowIsFullscreen) return { action: "none", owned: weOwnIt };
		return { action: "enter", owned: true };
	}
	if (weOwnIt && windowIsFullscreen) return { action: "leave", owned: false };
	return { action: "none", owned: false };
}
