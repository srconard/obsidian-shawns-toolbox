// webview-hotkeys.ts — "Forward Obsidian hotkeys from Web viewer" (v1.54.0).
// Pure half: webview-hotkeys-core.ts.
//
// Shawn, 2026-09-26 12:25: "the hotkeys don't work when i have my cursor
// focused in the web viewer … i cannot open up the command palette using
// ctrl+P". The core Web viewer renders pages in an Electron <webview>, whose key
// events never reach the embedding document.
//
// WHAT OBSIDIAN ALREADY DOES (measured on the NAS Obsidian 1.13.7, 2026-09-26).
// WebviewerView.configureWebContents hooks the guest's `before-input-event`
// through electron.remote and replays every keydown into app.keymap.onKeyEvent
// as an untrusted, target-less KeyboardEvent. A real Ctrl+P typed into eco-web's
// composer (xdotool, NAS container) opened the palette. So on such builds:
//   - there is nothing to forward, but Obsidian also takes keys the page wants
//     (a user hotkey on Ctrl+L fires while eco-web also gets Ctrl+L). We wrap
//     app.keymap.onKeyEvent and swallow the replayed event when the combo is on
//     "Keys to leave to the web page" — the "builtin" mechanism.
//   - the palette could still look dead: in the F11 web fullscreen it opens on
//     <body>, outside the fullscreen element, invisible. web-fullscreen.ts now
//     relays overlays into the fullscreen element.
//
// WHEN OBSIDIAN DOES NOT (older builds, or any other <webview>) — the "inject"
// mechanism: webview.executeJavaScript() installs a small keydown listener in
// the page (guestScript in the core). For a combo Obsidian binds, and that the
// page itself did not preventDefault, it preventDefaults and logs a sentinel;
// the webview's `console-message` event brings it back here and we run the
// bound command with app.commands.executeCommandById. Re-injected on every
// dom-ready (each page load gets a fresh window). If Obsidian also replays the
// key natively, the keymap wrap swallows that copy so nothing runs twice.
//
// Option A of the brief — our own `before-input-event` listener via
// @electron/remote — was rejected: remote callbacks run asynchronously in the
// renderer, so event.preventDefault() arrives after the main process has already
// delivered the key; it could observe but never keep a key from the page.
//
// v1.56.4 — WHY CTRL+P STILL DIED (the 1.54 diagnosis above was incomplete).
// Shawn, laptop, not in fullscreen: "the command pallet only comes up if i
// click on part of obsidian that is not the web viewer". Obsidian runs
// configureWebContents ONCE per view (flag `hasConfiguredWebContents`). When the
// <webview> is re-attached — its tab dragged to another split or tab group, the
// view moved to a popout — Chromium gives it a NEW guest webContents, and
// Obsidian never hooks that one. Measured on the NAS Obsidian 1.13.7: guest
// 17 → 18 after a split move, before-input-event listeners 1 → 0, and a real
// xdotool Ctrl+P typed into eco-web stopped opening the palette, while Ctrl+P
// after clicking Obsidian's own UI still did. The same 1.13.7 app code runs on
// Windows (the PC's asar is byte-identical in size and version).
// Fix: repairGuest() — on every dom-ready and scan, a configured view whose
// current guest has no before-input-event listener gets Obsidian's own
// configureWebContents() called again (rehookDecision in the core). That also
// restores Obsidian's click-to-activate-the-leaf hook, lost the same way.

import { App, Platform, WorkspaceLeaf } from "obsidian";
import {
	ForwardMode,
	GUEST_REMOVE_SCRIPT,
	HotkeyIndex,
	HotkeyLike,
	chooseMechanism,
	decide,
	eventCombo,
	forwardSet,
	guestScript,
	hasBuiltinForwarding,
	indexFromBaked,
	indexFromCommands,
	isForwardableCombo,
	parsePassThrough,
	parseSentinel,
	rehookDecision,
	RehookDecision,
} from "./webview-hotkeys-core";
import { hostedLeaves } from "./foreign-host";

export interface WebviewHotkeySettings {
	forwardWebviewHotkeys: boolean;
	webviewPassThroughKeys: string;
	webviewHotkeysMode: ForwardMode;
}

/** The Electron <webview> methods we use. */
interface WebviewEl extends HTMLElement {
	executeJavaScript(code: string): Promise<unknown>;
	getWebContentsId?: () => number;
}

/** The WebviewerView internals repairGuest() relies on (Obsidian 1.13.x). */
interface WebviewerViewLike {
	webview?: HTMLElement;
	containerEl?: HTMLElement;
	hasConfiguredWebContents?: boolean;
	configureWebContents?: () => void;
}

interface RemoteLike {
	webContents: { fromId(id: number): { listenerCount(ev: string): number; isDestroyed?: () => boolean } | null | undefined };
}

interface HotkeyManagerLike {
	baked?: boolean;
	bake?: () => void;
	bakedHotkeys?: HotkeyLike[];
	bakedIds?: string[];
	getHotkeys?: (id: string) => HotkeyLike[] | undefined;
	getDefaultHotkeys?: (id: string) => HotkeyLike[] | undefined;
}

interface AppInternals {
	hotkeyManager?: HotkeyManagerLike;
	commands?: {
		commands?: Record<string, unknown>;
		executeCommandById?: (id: string) => boolean;
	};
	keymap?: { onKeyEvent?: (e: KeyboardEvent) => unknown };
}

interface Hook {
	mechanism: "builtin" | "inject";
	cleanup: () => void;
}

const LOG = "[shawns-toolbox] webview hotkeys:";

export class WebviewHotkeys {
	private hooks = new Map<HTMLElement, Hook>();
	private observer: MutationObserver | null = null;
	private unwrapKeymap: (() => void) | null = null;
	private scanQueued = false;
	private running = false;
	/** Guest webContents ids already checked by repairGuest (hooked by Obsidian or by us). */
	private checkedGuests = new Set<number>();

	constructor(private app: App, private getSettings: () => WebviewHotkeySettings) {}

	private get internals(): AppInternals {
		return this.app as unknown as AppInternals;
	}

	/** Apply the current settings: start, stop, or re-push lists into pages. */
	refresh(): void {
		const s = this.getSettings();
		if (!Platform.isDesktopApp || !s.forwardWebviewHotkeys) {
			this.stop();
			return;
		}
		if (!this.running) {
			this.start();
			return;
		}
		// Settings changed while running: re-evaluate every webview from scratch,
		// because the mechanism may have changed with the mode.
		this.unhookAll();
		this.scan();
	}

	/** Look for new webviews (call on layout-change / active-leaf-change). */
	requestScan(): void {
		if (!this.running || this.scanQueued) return;
		this.scanQueued = true;
		window.setTimeout(() => {
			this.scanQueued = false;
			if (this.running) this.scan();
		}, 50);
	}

	stop(): void {
		if (!this.running) return;
		this.running = false;
		this.observer?.disconnect();
		this.observer = null;
		this.unwrapKeymap?.();
		this.unwrapKeymap = null;
		this.unhookAll();
	}

	private start(): void {
		this.running = true;
		this.wrapKeymap();
		// The Web viewer re-creates its <webview> after a crash or a popout move
		// with no workspace event, and a dual-panel half hosts a detached leaf the
		// workspace never lists — so watch the DOM too. The check per mutation is
		// one native getElementsByTagName on the added subtree.
		this.observer = new MutationObserver((mutations) => {
			for (const m of mutations) {
				for (let i = 0; i < m.addedNodes.length; i++) {
					const n = m.addedNodes[i];
					if (n.nodeType !== 1) continue;
					const el = n as Element;
					if (el.nodeName === "WEBVIEW" || el.getElementsByTagName("webview").length > 0) {
						this.requestScan();
						return;
					}
				}
			}
		});
		this.observer.observe(document.body, { childList: true, subtree: true });
		this.scan();
	}

	private unhookAll(): void {
		this.hooks.forEach((hook) => hook.cleanup());
		this.hooks.clear();
	}

	/** Every <webview> we can see: main document plus popout windows' documents. */
	private findWebviews(): HTMLElement[] {
		const found = new Set<HTMLElement>();
		const add = (root: Document | Element | null | undefined) => {
			if (!root) return;
			const list = root.getElementsByTagName("webview");
			for (let i = 0; i < list.length; i++) found.add(list[i] as HTMLElement);
		};
		add(document);
		for (const leaf of this.webviewerLeaves()) {
			const el = (leaf.view as unknown as { webview?: HTMLElement }).webview;
			if (el) found.add(el);
			else add(leaf.view.containerEl);
		}
		return Array.from(found);
	}

	/** Web viewer leaves in the workspace plus the ones a dual-panel half hosts. */
	private webviewerLeaves(): WorkspaceLeaf[] {
		const out = this.app.workspace.getLeavesOfType("webviewer").slice();
		hostedLeaves.forEach((leaf) => {
			if (leaf.view?.getViewType?.() === "webviewer" && out.indexOf(leaf) < 0) out.push(leaf);
		});
		return out;
	}

	private scan(): void {
		// Drop hooks for webviews that are gone.
		this.hooks.forEach((hook, el) => {
			if (!el.isConnected) {
				hook.cleanup();
				this.hooks.delete(el);
			}
		});
		for (const el of this.findWebviews()) {
			if (!el.isConnected) continue;
			if (!this.hooks.has(el)) this.hook(el as WebviewEl);
			// A hooked element can have been re-attached since (new guest).
			this.repairGuest(el as WebviewEl);
		}
	}

	/**
	 * Re-run Obsidian's own configureWebContents when this Web viewer's current
	 * guest was never hooked (see the v1.56.4 note at the top of the file).
	 */
	repairGuest(el: WebviewEl): RehookDecision | "no-view" {
		const view = this.viewFor(el);
		if (!view || view.webview !== el || typeof view.configureWebContents !== "function") return "no-view";
		let guestId: number | null = null;
		try {
			guestId = typeof el.getWebContentsId === "function" ? el.getWebContentsId() : null;
		} catch {
			guestId = null; // throws until the guest is attached; dom-ready retries
		}
		const known = guestId !== null && this.checkedGuests.has(guestId);
		let listeners: number | null = null;
		if (guestId !== null && !known && view.hasConfiguredWebContents) {
			const remote = (window as unknown as { electron?: { remote?: RemoteLike } }).electron?.remote;
			try {
				const wc = remote?.webContents.fromId(guestId);
				if (wc && !(wc.isDestroyed?.() ?? false)) listeners = wc.listenerCount("before-input-event");
			} catch {
				listeners = null;
			}
		}
		const d = rehookDecision({ guestId, known, viewConfigured: !!view.hasConfiguredWebContents, listeners });
		if (d === "hooked" && guestId !== null) this.checkedGuests.add(guestId);
		if (d === "rehook" && guestId !== null) {
			this.checkedGuests.add(guestId);
			try {
				view.configureWebContents.call(view);
				console.info(LOG, "re-hooked keys for re-attached Web viewer guest", guestId);
			} catch (err) {
				console.error(LOG, "re-hooking Web viewer guest failed", guestId, err);
			}
		}
		return d;
	}

	private viewFor(el: HTMLElement): WebviewerViewLike | null {
		for (const leaf of this.webviewerLeaves()) {
			const view = leaf.view as unknown as WebviewerViewLike;
			if (view.webview === el) return view;
		}
		return null;
	}

	/** The WebviewerView owning this element, when the workspace lists it. */
	private leafFor(el: HTMLElement): WorkspaceLeaf | null {
		for (const leaf of this.webviewerLeaves()) {
			const view = leaf.view as unknown as { webview?: HTMLElement; containerEl?: HTMLElement };
			if (view.webview === el || view.containerEl?.contains(el)) return leaf;
		}
		return null;
	}

	/**
	 * Whether Obsidian replays this webview's keys itself. Only a Web viewer's
	 * own <webview> can be; read the source of its configureWebContents. A
	 * Web viewer the workspace does not list (a dual-panel half) borrows the
	 * answer from any listed one; with none to read we assume "no" — injecting
	 * when Obsidian also forwards is harmless (the keymap wrap drops the copy),
	 * the reverse would leave the page with no hotkeys at all.
	 */
	private builtinFor(el: HTMLElement): boolean {
		if (!el.closest('.workspace-leaf-content[data-type="webviewer"]')) return false;
		const leaf = this.leafFor(el) ?? this.app.workspace.getLeavesOfType("webviewer")[0] ?? null;
		if (!leaf) return false;
		const proto = Object.getPrototypeOf(leaf.view) as { configureWebContents?: () => void } | null;
		const fn = proto?.configureWebContents;
		return typeof fn === "function" && hasBuiltinForwarding(Function.prototype.toString.call(fn));
	}

	private hook(el: WebviewEl): void {
		const s = this.getSettings();
		const mechanism = chooseMechanism(s.webviewHotkeysMode, this.builtinFor(el));
		// A re-attached element loads its page again in its new guest: dom-ready is
		// the moment that guest exists and can be checked (v1.56.4).
		const repair = () => {
			if (this.hooks.has(el)) this.repairGuest(el);
		};
		el.addEventListener("dom-ready", repair);
		if (mechanism === "builtin") {
			this.hooks.set(el, { mechanism, cleanup: () => el.removeEventListener("dom-ready", repair) });
			return;
		}
		const inject = () => void this.inject(el);
		const onConsole = (ev: Event) => {
			const combo = parseSentinel((ev as unknown as { message?: unknown }).message);
			if (combo) this.run(combo, el);
		};
		el.addEventListener("dom-ready", inject);
		el.addEventListener("console-message", onConsole);
		this.hooks.set(el, {
			mechanism,
			cleanup: () => {
				el.removeEventListener("dom-ready", repair);
				el.removeEventListener("dom-ready", inject);
				el.removeEventListener("console-message", onConsole);
				if (el.isConnected) el.executeJavaScript(GUEST_REMOVE_SCRIPT).catch(() => {});
			},
		});
		// Already loaded? executeJavaScript throws before the first dom-ready,
		// in which case the listener above does it.
		inject();
	}

	private async inject(el: WebviewEl): Promise<void> {
		if (!this.hooks.has(el)) return;
		const combos = forwardSet(this.index(), this.passThrough());
		try {
			await el.executeJavaScript(guestScript(combos));
		} catch {
			// Not ready yet (no dom-ready) or the page is gone; dom-ready retries.
		}
	}

	/** Run the Obsidian command bound to a combo the page handed back. */
	private run(combo: string, el: HTMLElement): void {
		const index = this.index();
		if (decide(combo, index, this.passThrough()) !== "forward") return;
		const leaf = this.leafFor(el);
		if (leaf && this.app.workspace.getMostRecentLeaf() !== leaf) {
			this.app.workspace.setActiveLeaf(leaf, { focus: false });
		}
		const exec = this.internals.commands?.executeCommandById;
		if (typeof exec !== "function") return;
		for (const id of index.get(combo) ?? []) {
			try {
				// false = the command's check failed here (e.g. an editor command
				// with no editor); try the next command bound to the same keys.
				if (exec.call(this.internals.commands, id)) return;
			} catch (err) {
				console.error(LOG, "command failed", id, err);
				return;
			}
		}
	}

	private passThrough(): Set<string> {
		return parsePassThrough(this.getSettings().webviewPassThroughKeys, Platform.isMacOS).combos;
	}

	/** combo → command ids, from Obsidian's own effective (baked) hotkey table. */
	index(): HotkeyIndex {
		const hm = this.internals.hotkeyManager;
		const isMac = Platform.isMacOS;
		if (!hm) return new Map();
		if (Array.isArray(hm.bakedHotkeys) && Array.isArray(hm.bakedIds)) {
			if (!hm.baked && typeof hm.bake === "function") {
				try {
					hm.bake();
				} catch {
					/* fall through to the per-command table */
				}
			}
			if (hm.bakedIds.length > 0) return indexFromBaked(hm.bakedHotkeys, hm.bakedIds, isMac);
		}
		const ids = Object.keys(this.internals.commands?.commands ?? {});
		return indexFromCommands(
			ids,
			(id) => (typeof hm.getHotkeys === "function" ? hm.getHotkeys(id) : undefined),
			(id) => (typeof hm.getDefaultHotkeys === "function" ? hm.getDefaultHotkeys(id) : undefined),
			isMac
		);
	}

	/**
	 * Wrap app.keymap.onKeyEvent. Obsidian's own webview forwarding calls it
	 * with an untrusted, target-less KeyboardEvent while the <webview> has focus;
	 * real keydowns in Obsidian's own UI are trusted and never touched.
	 */
	private wrapKeymap(): void {
		const keymap = this.internals.keymap;
		if (!keymap || typeof keymap.onKeyEvent !== "function") return;
		const original = keymap.onKeyEvent;
		const hadOwn = Object.prototype.hasOwnProperty.call(keymap, "onKeyEvent");
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;
		const wrapped = function (this: unknown, e: KeyboardEvent) {
			if (self.swallow(e)) return undefined;
			// eslint-disable-next-line prefer-rest-params
			return original.apply(this, arguments as unknown as [KeyboardEvent]);
		};
		keymap.onKeyEvent = wrapped;
		this.unwrapKeymap = () => {
			if (keymap.onKeyEvent !== wrapped) return; // someone wrapped us; leave theirs
			if (hadOwn) keymap.onKeyEvent = original;
			else delete keymap.onKeyEvent;
		};
	}

	private swallow(e: KeyboardEvent): boolean {
		if (!e || e.isTrusted) return false;
		const doc = (window as unknown as { activeDocument?: Document }).activeDocument ?? document;
		const focused = doc.activeElement as HTMLElement | null;
		if (!focused || focused.nodeName !== "WEBVIEW") return false;
		const hook = this.hooks.get(focused);
		if (!hook) return false;
		const combo = eventCombo(e);
		// Plain typing reaches here once per key; leave it before any table work.
		if (!combo || !isForwardableCombo(combo)) return false;
		const d = decide(combo, this.index(), this.passThrough());
		if (d === "left-to-page") return true;
		// The page script forwards this one itself; drop Obsidian's copy.
		return hook.mechanism === "inject" && d === "forward";
	}
}
