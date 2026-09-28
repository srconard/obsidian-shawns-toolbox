// capture-hover-core.ts — framework-free logic for "Hide capture buttons until
// hover" (v1.58.0, desktop only).
//
// Shawn, 2026-09-28 (daily note, writing a morning free-write in the capture
// window): on desktop the four routing buttons under the capture box should be
// hidden, appearing only when the mouse hovers over where they sit — a blank
// page to write into. With the setting on, the plugin puts
// CAPTURE_HOVER_BUTTONS_CLASS on <body>, and styles.css fades the buttons out
// on every capture surface (main view, side panel, dual half) until the mouse
// is over the button row. Mod+Enter still captures a thought with the row
// hidden. The phone has no hover, so the class is never applied there — the
// buttons stay as they are on Android.

export const CAPTURE_HOVER_BUTTONS_CLASS = "stx-capture-hover-buttons";

/** Whether the body class should be on for this setting + platform. */
export function wantsCaptureHoverButtons(enabled: boolean, isMobile: boolean): boolean {
	return enabled && !isMobile;
}

/** Minimal slice of DOMTokenList, so tests can pass a fake. */
export interface ClassListLike {
	toggle(token: string, force?: boolean): boolean;
}

/** Add or remove the body class. Returns the state that was applied. */
export function applyCaptureHoverButtons(
	classList: ClassListLike,
	enabled: boolean,
	isMobile: boolean
): boolean {
	const on = wantsCaptureHoverButtons(enabled, isMobile);
	classList.toggle(CAPTURE_HOVER_BUTTONS_CLASS, on);
	return on;
}
