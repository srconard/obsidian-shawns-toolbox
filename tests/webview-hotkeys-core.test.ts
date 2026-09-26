import { describe, it, expect } from "vitest";
import {
	DEFAULT_PASS_THROUGH_KEYS,
	GUEST_REMOVE_SCRIPT,
	SENTINEL,
	chooseMechanism,
	rehookDecision,
	comboString,
	decide,
	eventCombo,
	forwardSet,
	guestScript,
	hasBuiltinForwarding,
	hotkeyCombo,
	indexFromBaked,
	indexFromCommands,
	isForwardableCombo,
	isFullscreenOverlay,
	normaliseKey,
	parsePassThrough,
	parseSentinel,
	type KeyEventLike,
} from "../webview-hotkeys-core";

describe("normalisation", () => {
	it("orders modifiers Ctrl, Meta, Alt, Shift and upper-cases letters", () => {
		expect(comboString(["Shift", "Ctrl"], "p")).toBe("Ctrl+Shift+P");
		expect(comboString(["Alt", "Meta", "Shift", "Ctrl"], "k")).toBe("Ctrl+Meta+Alt+Shift+K");
	});

	it("normalises key names", () => {
		expect(normaliseKey(" ")).toBe("Space");
		expect(normaliseKey("f11")).toBe("F11");
		expect(normaliseKey("esc")).toBe("Escape");
		expect(normaliseKey("arrowleft")).toBe("ArrowLeft");
		expect(normaliseKey("comma")).toBe(",");
		expect(normaliseKey(",")).toBe(",");
	});

	it("reads Obsidian hotkeys in both the settings and the baked shape", () => {
		expect(hotkeyCombo({ modifiers: ["Mod"], key: "P" }, false)).toBe("Ctrl+P");
		expect(hotkeyCombo({ modifiers: ["Mod"], key: "P" }, true)).toBe("Meta+P");
		expect(hotkeyCombo({ modifiers: ["Mod", "Shift"], key: "P" }, false)).toBe("Ctrl+Shift+P");
		expect(hotkeyCombo({ modifiers: "Ctrl,Shift", key: "T" }, false)).toBe("Ctrl+Shift+T");
		expect(hotkeyCombo({ modifiers: "Alt,Ctrl", key: "ArrowLeft" }, false)).toBe("Ctrl+Alt+ArrowLeft");
		expect(hotkeyCombo({ modifiers: [], key: "F11" }, false)).toBe("F11");
		expect(hotkeyCombo({ modifiers: ["Mod"], key: "," }, false)).toBe("Ctrl+,");
	});

	it("rejects a hotkey with an unknown modifier or no key", () => {
		expect(hotkeyCombo({ modifiers: ["Hyper"], key: "P" }, false)).toBeNull();
		expect(hotkeyCombo({ modifiers: ["Mod"], key: "" }, false)).toBeNull();
	});

	it("reads keydown events by physical code, so Shift and layouts do not change the key", () => {
		expect(eventCombo({ key: "p", code: "KeyP", ctrlKey: true })).toBe("Ctrl+P");
		expect(eventCombo({ key: "P", code: "KeyP", ctrlKey: true, shiftKey: true })).toBe("Ctrl+Shift+P");
		expect(eventCombo({ key: ",", code: "Comma", ctrlKey: true })).toBe("Ctrl+,");
		expect(eventCombo({ key: "<", code: "Comma", ctrlKey: true, shiftKey: true })).toBe("Ctrl+Shift+,");
		expect(eventCombo({ key: ".", code: "Period", ctrlKey: true })).toBe("Ctrl+.");
		expect(eventCombo({ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true })).toBe("Ctrl+Shift+1");
		expect(eventCombo({ key: "F11", code: "F11" })).toBe("F11");
		expect(eventCombo({ key: "Enter", code: "Enter", ctrlKey: true })).toBe("Ctrl+Enter");
		expect(eventCombo({ key: " ", code: "Space", ctrlKey: true })).toBe("Ctrl+Space");
	});

	it("ignores bare modifier presses and dead keys", () => {
		expect(eventCombo({ key: "Control", code: "ControlLeft", ctrlKey: true })).toBeNull();
		expect(eventCombo({ key: "Shift", code: "ShiftLeft", shiftKey: true })).toBeNull();
		expect(eventCombo({ key: "Dead", code: "" })).toBeNull();
	});

	it("an event and the matching Obsidian hotkey give the same string", () => {
		const pairs: [KeyEventLike, { modifiers: string[]; key: string }][] = [
			[{ key: "p", code: "KeyP", ctrlKey: true }, { modifiers: ["Mod"], key: "P" }],
			[{ key: "o", code: "KeyO", ctrlKey: true }, { modifiers: ["Mod"], key: "O" }],
			[{ key: ",", code: "Comma", ctrlKey: true }, { modifiers: ["Mod"], key: "," }],
			[{ key: "P", code: "KeyP", ctrlKey: true, shiftKey: true }, { modifiers: ["Mod", "Shift"], key: "P" }],
			[{ key: "Tab", code: "Tab", ctrlKey: true, shiftKey: true }, { modifiers: ["Ctrl", "Shift"], key: "Tab" }],
		];
		for (const [ev, hk] of pairs) expect(eventCombo(ev)).toBe(hotkeyCombo(hk, false));
	});
});

describe("isForwardableCombo", () => {
	it("needs Ctrl, Meta or Alt, or a function key", () => {
		expect(isForwardableCombo("Ctrl+P")).toBe(true);
		expect(isForwardableCombo("Meta+P")).toBe(true);
		expect(isForwardableCombo("Alt+ArrowLeft")).toBe(true);
		expect(isForwardableCombo("F11")).toBe(true);
		expect(isForwardableCombo("Shift+F3")).toBe(true);
	});

	it("never takes typing", () => {
		expect(isForwardableCombo("P")).toBe(false);
		expect(isForwardableCombo("Shift+P")).toBe(false);
		expect(isForwardableCombo("Enter")).toBe(false);
		expect(isForwardableCombo("Escape")).toBe(false);
		expect(isForwardableCombo("Shift+Tab")).toBe(false);
	});

	it("never takes AltGr, which types characters", () => {
		expect(isForwardableCombo("Ctrl+Alt+Q", true)).toBe(false);
	});
});

describe("parsePassThrough", () => {
	it("parses the default list", () => {
		const { combos, invalid } = parsePassThrough(DEFAULT_PASS_THROUGH_KEYS, false);
		expect(invalid).toEqual([]);
		expect([...combos].sort()).toEqual(
			[
				"Ctrl+.",
				"Ctrl+L",
				"Ctrl+Enter",
				"Ctrl+C",
				"Ctrl+V",
				"Ctrl+X",
				"Ctrl+A",
				"Ctrl+Z",
				"Ctrl+Shift+Z",
				"Ctrl+Y",
			].sort()
		);
	});

	it("accepts spacing, case, semicolons, newlines and aliases", () => {
		const { combos } = parsePassThrough(" ctrl + shift + z ;mod+k\ncmd+j, Ctrl+Comma, Alt+left", false);
		expect(combos.has("Ctrl+Shift+Z")).toBe(true);
		expect(combos.has("Ctrl+K")).toBe(true);
		expect(combos.has("Meta+J")).toBe(true);
		expect(combos.has("Ctrl+,")).toBe(true);
		expect(combos.has("Alt+ArrowLeft")).toBe(true);
	});

	it("reads Ctrl++ as the plus key", () => {
		expect([...parsePassThrough("Ctrl++", false).combos]).toEqual(["Ctrl++"]);
	});

	it("on a Mac, a Ctrl entry also covers ⌘", () => {
		const { combos } = parsePassThrough("Ctrl+C, Ctrl+Shift+Z", true);
		expect(combos.has("Ctrl+C")).toBe(true);
		expect(combos.has("Meta+C")).toBe(true);
		expect(combos.has("Meta+Shift+Z")).toBe(true);
	});

	it("reports what it cannot read instead of dropping it silently", () => {
		const { combos, invalid } = parsePassThrough("Ctrl+L, Hyper+K, Ctrl+", false);
		expect([...combos]).toEqual(["Ctrl+L"]);
		expect(invalid).toEqual(["Hyper+K", "Ctrl+"]);
	});

	it("is empty for an empty setting", () => {
		expect(parsePassThrough("", false).combos.size).toBe(0);
		expect(parsePassThrough(" , ,", false).invalid).toEqual([]);
	});
});

describe("hotkey index", () => {
	it("builds from Obsidian's baked tables (measured shape, NAS 1.13.7)", () => {
		const index = indexFromBaked(
			[
				{ modifiers: "Ctrl", key: "P" },
				{ modifiers: "Ctrl,Shift", key: "T" },
				{ modifiers: "Ctrl", key: "L" },
				{ modifiers: "Ctrl", key: "L" },
			],
			["command-palette:open", "workspace:undo-close-pane", "editor:toggle-checklist-status", "my:other"],
			false
		);
		expect(index.get("Ctrl+P")).toEqual(["command-palette:open"]);
		expect(index.get("Ctrl+Shift+T")).toEqual(["workspace:undo-close-pane"]);
		expect(index.get("Ctrl+L")).toEqual(["editor:toggle-checklist-status", "my:other"]);
	});

	it("per command: custom hotkeys win, an empty custom list unbinds, else defaults", () => {
		const custom: Record<string, { modifiers: string[]; key: string }[]> = {
			"switcher:open": [{ modifiers: ["Mod", "Shift"], key: "O" }],
			"app:open-settings": [],
		};
		const defaults: Record<string, { modifiers: string[]; key: string }[]> = {
			"command-palette:open": [{ modifiers: ["Mod"], key: "P" }],
			"switcher:open": [{ modifiers: ["Mod"], key: "O" }],
			"app:open-settings": [{ modifiers: ["Mod"], key: "," }],
		};
		const index = indexFromCommands(
			["command-palette:open", "switcher:open", "app:open-settings", "no:keys"],
			(id) => custom[id],
			(id) => defaults[id],
			false
		);
		expect(index.get("Ctrl+P")).toEqual(["command-palette:open"]);
		expect(index.get("Ctrl+Shift+O")).toEqual(["switcher:open"]);
		expect(index.has("Ctrl+O")).toBe(false);
		expect(index.has("Ctrl+,")).toBe(false);
	});
});

describe("decide + forwardSet", () => {
	const index = indexFromBaked(
		[
			{ modifiers: "Ctrl", key: "P" },
			{ modifiers: "Ctrl", key: "O" },
			{ modifiers: "Ctrl,Shift", key: "P" },
			{ modifiers: "Ctrl", key: "," },
			{ modifiers: "Ctrl", key: "L" },
			{ modifiers: "Ctrl", key: "Enter" },
			{ modifiers: "", key: "F11" },
			{ modifiers: "", key: "Escape" },
		],
		["a", "b", "c", "d", "e", "f", "g", "h"],
		false
	);
	const pass = parsePassThrough(DEFAULT_PASS_THROUGH_KEYS, false).combos;

	it("forwards the combos Shawn wants", () => {
		for (const c of ["Ctrl+P", "Ctrl+O", "Ctrl+Shift+P", "Ctrl+,", "F11"]) {
			expect(decide(c, index, pass)).toBe("forward");
		}
	});

	it("leaves eco-web's composer keys and clipboard keys to the page", () => {
		expect(decide("Ctrl+L", index, pass)).toBe("left-to-page");
		expect(decide("Ctrl+Enter", index, pass)).toBe("left-to-page");
		expect(decide("Ctrl+.", index, pass)).toBe("left-to-page");
		expect(decide("Ctrl+C", index, pass)).toBe("left-to-page");
	});

	it("never takes an unbound combo or plain keys", () => {
		expect(decide("Ctrl+K", index, pass)).toBe("unbound");
		expect(decide("Escape", index, pass)).toBe("not-forwardable");
		expect(decide("P", index, pass)).toBe("not-forwardable");
		expect(decide(null, index, pass)).toBe("not-forwardable");
		expect(decide("Ctrl+Alt+P", index, pass, true)).toBe("not-forwardable");
	});

	it("the page's list is exactly the forwardable, bound, not-left combos", () => {
		expect(forwardSet(index, pass)).toEqual(["Ctrl+,", "Ctrl+O", "Ctrl+P", "Ctrl+Shift+P", "F11"]);
	});
});

describe("sentinel + mechanism", () => {
	it("parses only our own console lines", () => {
		expect(parseSentinel(SENTINEL + JSON.stringify({ combo: "Ctrl+P" }))).toBe("Ctrl+P");
		expect(parseSentinel("hello")).toBeNull();
		expect(parseSentinel(SENTINEL + "{not json")).toBeNull();
		expect(parseSentinel(SENTINEL + "{}")).toBeNull();
		expect(parseSentinel(undefined)).toBeNull();
	});

	it("detects Obsidian's own webview forwarding from configureWebContents' source", () => {
		// Shortened from the real NAS Obsidian 1.13.7 function.
		const real =
			'function(){var e=this,t=electron.remote.webContents.fromId(this.webview.getWebContentsId());t.on("before-input-event",(function(n,i){e.app.keymap.onKeyEvent(new KeyboardEvent("keydown",{}))}))}';
		expect(hasBuiltinForwarding(real)).toBe(true);
		expect(hasBuiltinForwarding("function(){}")).toBe(false);
		expect(hasBuiltinForwarding(undefined)).toBe(false);
	});

	it("auto uses the built-in forwarding when present, else injects", () => {
		expect(chooseMechanism("auto", true)).toBe("builtin");
		expect(chooseMechanism("auto", false)).toBe("inject");
		expect(chooseMechanism("inject", true)).toBe("inject");
		expect(chooseMechanism("builtin", false)).toBe("builtin");
	});
});

describe("fullscreen overlays", () => {
	const cl = (...c: string[]) => ({ contains: (t: string) => c.indexOf(t) >= 0 });
	it("recognises Obsidian's body-level overlays", () => {
		expect(isFullscreenOverlay(cl("modal-container", "mod-dim"))).toBe(true);
		expect(isFullscreenOverlay(cl("menu"))).toBe(true);
		expect(isFullscreenOverlay(cl("notice-container"))).toBe(true);
		expect(isFullscreenOverlay(cl("suggestion-container"))).toBe(true);
	});
	it("leaves the app itself alone", () => {
		expect(isFullscreenOverlay(cl("app-container"))).toBe(false);
		expect(isFullscreenOverlay(cl("workspace-leaf"))).toBe(false);
		expect(isFullscreenOverlay(null)).toBe(false);
	});
});

// ---- The page script, run against a fake window ----------------------------

type Listener = (e: FakeKey) => void;

class FakeKey {
	defaultPrevented = false;
	isComposing = false;
	private stopped = false;
	constructor(public init: KeyEventLike & { altGraph?: boolean }) {}
	get key() {
		return this.init.key;
	}
	get code() {
		return this.init.code;
	}
	get ctrlKey() {
		return !!this.init.ctrlKey;
	}
	get metaKey() {
		return !!this.init.metaKey;
	}
	get altKey() {
		return !!this.init.altKey;
	}
	get shiftKey() {
		return !!this.init.shiftKey;
	}
	getModifierState(k: string) {
		return k === "AltGraph" && !!this.init.altGraph;
	}
	preventDefault() {
		this.defaultPrevented = true;
	}
	stopPropagation() {
		this.stopped = true;
	}
	get propagationStopped() {
		return this.stopped;
	}
}

interface FakePage {
	logs: string[];
	win: Record<string, unknown>;
	run(code: string): unknown;
	/** Dispatch: window capture → page handler (document level) → window bubble. */
	press(init: KeyEventLike & { altGraph?: boolean }, page?: (e: FakeKey) => void): Promise<FakeKey>;
	listenerCount(): number;
}

function fakePage(): FakePage {
	const logs: string[] = [];
	const capture: Listener[] = [];
	const bubble: Listener[] = [];
	const win: Record<string, unknown> = {
		addEventListener(type: string, fn: Listener, useCapture?: boolean) {
			if (type === "keydown") (useCapture ? capture : bubble).push(fn);
		},
		removeEventListener(type: string, fn: Listener, useCapture?: boolean) {
			const list = useCapture ? capture : bubble;
			const i = list.indexOf(fn);
			if (i >= 0) list.splice(i, 1);
		},
	};
	const fakeConsole = { log: (s: string) => logs.push(s) };
	return {
		logs,
		win,
		run(code: string) {
			// eslint-disable-next-line @typescript-eslint/no-implied-eval
			return new Function("window", "console", "setTimeout", `return ${code};`)(win, fakeConsole, setTimeout);
		},
		async press(init, page) {
			const e = new FakeKey(init);
			capture.forEach((fn) => fn(e));
			if (page) page(e);
			if (!e.propagationStopped) bubble.forEach((fn) => fn(e));
			await new Promise((r) => setTimeout(r, 5));
			return e;
		},
		listenerCount: () => capture.length + bubble.length,
	};
}

const combosOf = (logs: string[]) => logs.map((l) => parseSentinel(l));

describe("guestScript", () => {
	it("forwards a listed combo once and preventDefaults it", async () => {
		const p = fakePage();
		expect(p.run(guestScript(["Ctrl+P", "Ctrl+,"]))).toBe("installed");
		const e = await p.press({ key: "p", code: "KeyP", ctrlKey: true });
		expect(combosOf(p.logs)).toEqual(["Ctrl+P"]);
		expect(e.defaultPrevented).toBe(true);
		await p.press({ key: ",", code: "Comma", ctrlKey: true });
		expect(combosOf(p.logs)).toEqual(["Ctrl+P", "Ctrl+,"]);
	});

	it("leaves typing and unlisted combos completely alone", async () => {
		const p = fakePage();
		p.run(guestScript(["Ctrl+P"]));
		const typed = await p.press({ key: "p", code: "KeyP" });
		const copy = await p.press({ key: "c", code: "KeyC", ctrlKey: true });
		const bullet = await p.press({ key: ".", code: "Period", ctrlKey: true });
		expect(p.logs).toEqual([]);
		expect(typed.defaultPrevented || copy.defaultPrevented || bullet.defaultPrevented).toBe(false);
	});

	it("does not take a key the page already handled (preventDefault)", async () => {
		const p = fakePage();
		p.run(guestScript(["Ctrl+P"]));
		await p.press({ key: "p", code: "KeyP", ctrlKey: true }, (e) => e.preventDefault());
		expect(p.logs).toEqual([]);
	});

	it("still forwards when the page stopped propagation without preventDefault", async () => {
		const p = fakePage();
		p.run(guestScript(["Ctrl+P"]));
		await p.press({ key: "p", code: "KeyP", ctrlKey: true }, (e) => e.stopPropagation());
		expect(combosOf(p.logs)).toEqual(["Ctrl+P"]);
	});

	it("skips AltGr", async () => {
		const p = fakePage();
		p.run(guestScript(["Ctrl+Alt+Q"]));
		await p.press({ key: "@", code: "KeyQ", ctrlKey: true, altKey: true, altGraph: true });
		expect(p.logs).toEqual([]);
	});

	it("re-injecting only swaps the list, and removal takes the listeners away", async () => {
		const p = fakePage();
		p.run(guestScript(["Ctrl+P"]));
		expect(p.run(guestScript(["Ctrl+O"]))).toBe("updated");
		expect(p.listenerCount()).toBe(2);
		await p.press({ key: "p", code: "KeyP", ctrlKey: true });
		await p.press({ key: "o", code: "KeyO", ctrlKey: true });
		expect(combosOf(p.logs)).toEqual(["Ctrl+O"]);
		expect(p.run(GUEST_REMOVE_SCRIPT)).toBe("removed");
		expect(p.listenerCount()).toBe(0);
		expect(p.win.__stbHotkeys).toBeUndefined();
		expect(p.run(GUEST_REMOVE_SCRIPT)).toBe("absent");
	});

	it("the page's combo function agrees with the plugin's for every sample", () => {
		const p = fakePage();
		p.run(guestScript([]));
		const guest = (p.win.__stbHotkeys as { combo: (e: FakeKey) => string | null }).combo;
		const samples: KeyEventLike[] = [
			{ key: "p", code: "KeyP", ctrlKey: true },
			{ key: "P", code: "KeyP", ctrlKey: true, shiftKey: true },
			{ key: "<", code: "Comma", ctrlKey: true, shiftKey: true },
			{ key: ".", code: "Period", metaKey: true },
			{ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true },
			{ key: "F11", code: "F11" },
			{ key: "ArrowLeft", code: "ArrowLeft", ctrlKey: true, altKey: true },
			{ key: " ", code: "Space", ctrlKey: true },
			{ key: "Enter", code: "NumpadEnter", ctrlKey: true },
			{ key: "Control", code: "ControlLeft", ctrlKey: true },
			{ key: "Dead", code: "" },
		];
		for (const s of samples) expect(guest(new FakeKey(s))).toBe(eventCombo(s));
	});
});

describe("rehookDecision (v1.56.4: re-attached Web viewer guests)", () => {
	const base = { guestId: 18, known: false, viewConfigured: true, listeners: 0 };

	it("re-hooks a configured view whose new guest has no key listener", () => {
		expect(rehookDecision(base)).toBe("rehook");
	});
	it("leaves a guest that already has a listener (Obsidian's first hook)", () => {
		expect(rehookDecision({ ...base, listeners: 1 })).toBe("hooked");
	});
	it("waits for Obsidian on a view it has not configured yet (first page load)", () => {
		expect(rehookDecision({ ...base, viewConfigured: false })).toBe("obsidian-pending");
	});
	it("does nothing twice for the same guest", () => {
		expect(rehookDecision({ ...base, known: true })).toBe("known");
	});
	it("never guesses when it cannot count listeners", () => {
		expect(rehookDecision({ ...base, listeners: null })).toBe("cannot-inspect");
	});
	it("ignores a webview without a guest", () => {
		expect(rehookDecision({ ...base, guestId: null })).toBe("no-guest");
		expect(rehookDecision({ ...base, guestId: 0 })).toBe("no-guest");
		expect(rehookDecision({ ...base, guestId: NaN })).toBe("no-guest");
	});
	it("checks 'known' before anything that would touch electron.remote", () => {
		expect(rehookDecision({ guestId: 5, known: true, viewConfigured: false, listeners: null })).toBe("known");
	});
});
