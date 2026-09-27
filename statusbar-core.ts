// statusbar-core.ts — framework-free logic for "Auto-hide status bar" (v1.53.0).
//
// Desktop Obsidian's status bar (.status-bar — backlinks, word count, sync,
// Whisper, Stille …) sits in the bottom-right corner. With the setting on, the
// plugin puts STATUSBAR_AUTOHIDE_CLASS on <body>, and styles.css hides the bar
// until the mouse reaches the bottom-right corner. Since v1.56.5 only a small
// square in that corner (--stx-statusbar-hotzone, 48px) reveals it — not the
// bar's whole width; once revealed it stays up while the mouse is over the bar.
// Mobile has no such bar, so the class is never applied there.

export const STATUSBAR_AUTOHIDE_CLASS = "stx-autohide-statusbar";

/** Whether the body class should be on for this setting + platform. */
export function wantsStatusBarAutohide(enabled: boolean, isMobile: boolean): boolean {
	return enabled && !isMobile;
}

/** Minimal slice of DOMTokenList, so tests can pass a fake. */
export interface ClassListLike {
	toggle(token: string, force?: boolean): boolean;
}

/** Add or remove the body class. Returns the state that was applied. */
export function applyStatusBarAutohide(
	classList: ClassListLike,
	enabled: boolean,
	isMobile: boolean
): boolean {
	const on = wantsStatusBarAutohide(enabled, isMobile);
	classList.toggle(STATUSBAR_AUTOHIDE_CLASS, on);
	return on;
}
