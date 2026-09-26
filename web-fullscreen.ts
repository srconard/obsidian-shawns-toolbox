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

//
// Overlays (v1.54.0): in element fullscreen only the fullscreen element's
// subtree is painted, so the command palette, menus and notices — which
// Obsidian appends to <body> — opened invisibly (Ctrl+P "did nothing" and took
// the focus with it). While a leaf is fullscreen, such overlays are moved into
// it, and moved back to <body> when fullscreen ends.

import type { App, WorkspaceLeaf } from "obsidian";
import { isFullscreenOverlay } from "./webview-hotkeys-core";

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
			stopOverlayRelay();
			document.removeEventListener("fullscreenchange", cleanup);
		}
	};
	document.addEventListener("fullscreenchange", cleanup);

	try {
		await el.requestFullscreen();
		startOverlayRelay(el);
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

let relayStop: (() => void) | null = null;

/** Move body-level overlays into the fullscreen element while it lasts. */
function startOverlayRelay(fsEl: HTMLElement): void {
	stopOverlayRelay();
	const body = fsEl.ownerDocument.body;
	const moved = new Set<HTMLElement>();
	const adopt = (n: Node) => {
		if (n.nodeType !== 1 || n.parentNode !== body || n === fsEl) return;
		const el = n as HTMLElement;
		if (!isFullscreenOverlay(el.classList)) return;
		moved.add(el);
		fsEl.appendChild(el);
	};
	Array.from(body.children).forEach(adopt);
	const observer = new MutationObserver((mutations) => {
		for (const m of mutations) m.addedNodes.forEach(adopt);
	});
	observer.observe(body, { childList: true });
	relayStop = () => {
		observer.disconnect();
		// Anything still open goes back where Obsidian put it.
		moved.forEach((el) => {
			if (el.parentNode === fsEl) body.appendChild(el);
		});
		moved.clear();
	};
}

/** End the overlay relay (fullscreen exit, plugin unload). */
export function stopOverlayRelay(): void {
	const stop = relayStop;
	relayStop = null;
	stop?.();
}
