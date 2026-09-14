// web-fullscreen.ts — fullscreen + toolbar hiding for Obsidian's web viewer.
//
// Two commands:
//   - toggle-web-fullscreen: puts the active leaf into browser (Electron)
//     fullscreen via element.requestFullscreen(), which hides every other bit
//     of Obsidian chrome (ribbon, sidebars, tab bar, status bar) for free.
//     While fullscreen, the web viewer's toolbar (address bar, back / forward /
//     reload) is hidden by CSS. Escape or the hotkey again exits.
//   - toggle-web-toolbar: hides just the toolbar on the active web viewer leaf,
//     without going fullscreen (useful in a split).
//
// Both work on the active leaf; the toolbar hide only applies to webviewer
// leaves (`.workspace-leaf-content[data-type="webviewer"] > .view-header`).

import type { App, WorkspaceLeaf } from "obsidian";

export const FULLSCREEN_CLASS = "stx-web-fullscreen";
export const HIDE_TOOLBAR_CLASS = "stx-web-hide-toolbar";

type LeafWithContainer = WorkspaceLeaf & { containerEl?: HTMLElement };

function activeLeafEl(app: App): HTMLElement | null {
	const leaf = app.workspace.getMostRecentLeaf() as LeafWithContainer | null;
	const el = leaf?.containerEl ?? null;
	return el instanceof HTMLElement ? el : null;
}

/** Toggle Electron fullscreen on the active leaf. Returns the new state. */
export async function toggleLeafFullscreen(app: App): Promise<boolean> {
	if (document.fullscreenElement) {
		await document.exitFullscreen();
		return false;
	}
	const el = activeLeafEl(app);
	if (!el || typeof el.requestFullscreen !== "function") return false;

	el.classList.add(FULLSCREEN_CLASS);
	const cleanup = () => {
		if (!document.fullscreenElement) {
			el.classList.remove(FULLSCREEN_CLASS);
			document.removeEventListener("fullscreenchange", cleanup);
		}
	};
	document.addEventListener("fullscreenchange", cleanup);

	try {
		await el.requestFullscreen();
	} catch (err) {
		el.classList.remove(FULLSCREEN_CLASS);
		document.removeEventListener("fullscreenchange", cleanup);
		console.error("[shawns-toolbox] requestFullscreen failed", err);
		return false;
	}
	return true;
}

/** Toggle the toolbar-hidden class on the active leaf. Returns the new state. */
export function toggleLeafToolbar(app: App): boolean {
	const el = activeLeafEl(app);
	if (!el) return false;
	return el.classList.toggle(HIDE_TOOLBAR_CLASS);
}
