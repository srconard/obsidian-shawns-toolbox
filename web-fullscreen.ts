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

/** Overlays Escape should close (not notices or tooltips). */
const ESCAPABLE = ["modal-container", "menu", "suggestion-container"];

interface KeyboardLockApi {
	lock(keys?: string[]): Promise<void>;
	unlock(): void;
}

/**
 * Move body-level overlays into the fullscreen element while it lasts.
 *
 * Two details measured on the NAS Obsidian 1.13.7:
 *   - Re-parenting a focused element blurs it. The palette focuses its input
 *     right after appending itself, so the focus is put back after the move.
 *   - In element fullscreen Chromium takes Escape to exit fullscreen, so Esc
 *     on an open palette left fullscreen and kept the palette open. While a
 *     modal/menu/suggester is open inside the fullscreen leaf, Escape is
 *     keyboard-locked to the page, so it closes that overlay instead; with no
 *     overlay open, Escape exits fullscreen exactly as before.
 */
function startOverlayRelay(fsEl: HTMLElement): void {
	stopOverlayRelay();
	const doc = fsEl.ownerDocument;
	const body = doc.body;
	const moved = new Set<HTMLElement>();
	const keyboard = (doc.defaultView?.navigator as unknown as { keyboard?: KeyboardLockApi } | undefined)
		?.keyboard;
	let locked = false;
	const syncEscapeLock = () => {
		let open = false;
		moved.forEach((el) => {
			if (el.parentNode === fsEl && ESCAPABLE.some((c) => el.classList.contains(c))) open = true;
		});
		if (open && !locked && keyboard) {
			locked = true;
			keyboard.lock(["Escape"]).catch(() => {
				locked = false;
			});
		} else if (!open && locked && keyboard) {
			locked = false;
			keyboard.unlock();
		}
	};
	const adopt = (n: Node) => {
		if (n.nodeType !== 1 || n.parentNode !== body || n === fsEl) return;
		const el = n as HTMLElement;
		if (!isFullscreenOverlay(el.classList)) return;
		const focused = doc.activeElement as HTMLElement | null;
		const hadFocus = !!focused && el.contains(focused);
		moved.add(el);
		fsEl.appendChild(el);
		if (hadFocus && focused) focused.focus({ preventScroll: true });
		else if (el.classList.contains("modal-container")) focusModal(el);
	};
	Array.from(body.children).forEach(adopt);
	syncEscapeLock();
	const bodyObserver = new MutationObserver((mutations) => {
		for (const m of mutations) m.addedNodes.forEach(adopt);
		syncEscapeLock();
	});
	bodyObserver.observe(body, { childList: true });
	// Closing an overlay removes it from the fullscreen element.
	const fsObserver = new MutationObserver(() => syncEscapeLock());
	fsObserver.observe(fsEl, { childList: true });
	relayStop = () => {
		bodyObserver.disconnect();
		fsObserver.disconnect();
		if (locked && keyboard) keyboard.unlock();
		locked = false;
		// Anything still open goes back where Obsidian put it.
		moved.forEach((el) => {
			if (el.parentNode !== fsEl) return;
			const focused = doc.activeElement as HTMLElement | null;
			const hadFocus = !!focused && el.contains(focused);
			body.appendChild(el);
			if (hadFocus && focused) focused.focus({ preventScroll: true });
		});
		moved.clear();
	};
}

/**
 * Obsidian focuses a new modal's first input as it opens — but outside the
 * fullscreen element that focus() silently fails (no focusin at all, measured
 * on the NAS 1.13.7), so the palette opened with nothing focused: typing went
 * nowhere and Escape reached Chromium's fullscreen exit instead of the page.
 * Once the modal is inside the fullscreen element, give its input the focus.
 */
function focusModal(container: HTMLElement): void {
	const doc = container.ownerDocument;
	const target =
		container.querySelector<HTMLElement>(
			'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), [contenteditable="true"]'
		) ?? container.querySelector<HTMLElement>(".modal");
	if (!target) return;
	const attempt = () => {
		if (container.isConnected && !container.contains(doc.activeElement)) {
			target.focus({ preventScroll: true });
		}
	};
	attempt();
	// The move and Obsidian's own open() share a task; settle once more after it.
	window.requestAnimationFrame(attempt);
}

/** End the overlay relay (fullscreen exit, plugin unload). */
export function stopOverlayRelay(): void {
	const stop = relayStop;
	relayStop = null;
	stop?.();
}
