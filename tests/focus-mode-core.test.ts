import { describe, it, expect } from "vitest";
import {
	FOCUS_MODE_CLASS,
	FOCUS_MODE_HOTKEY,
	FOCUS_MODE_VIEW_HEADERS_CLASS,
	applyFocusMode,
	initialFocusMode,
	osFullscreenStep,
	type ClassListLike,
} from "../focus-mode-core";
import {
	DEFAULT_PASS_THROUGH_KEYS,
	decide,
	eventCombo,
	forwardSet,
	hotkeyCombo,
	indexFromBaked,
	parsePassThrough,
} from "../webview-hotkeys-core";

function fakeClassList(): ClassListLike & { set: Set<string> } {
	const set = new Set<string>();
	return {
		set,
		toggle(token: string, force?: boolean): boolean {
			const on = force ?? !set.has(token);
			if (on) set.add(token);
			else set.delete(token);
			return on;
		},
	};
}

describe("initialFocusMode", () => {
	it("restores the remembered state", () => {
		expect(initialFocusMode({ focusModeOn: true, startInFocusMode: false })).toBe(true);
		expect(initialFocusMode({ focusModeOn: false, startInFocusMode: false })).toBe(false);
	});
	it("'start in focus mode' wins over a remembered off", () => {
		expect(initialFocusMode({ focusModeOn: false, startInFocusMode: true })).toBe(true);
	});
});

describe("applyFocusMode", () => {
	it("adds only the tab-bar class by default", () => {
		const cl = fakeClassList();
		expect(applyFocusMode(cl, true, false, false)).toBe(true);
		expect([...cl.set]).toEqual([FOCUS_MODE_CLASS]);
	});
	it("adds the view-header class when that setting is on", () => {
		const cl = fakeClassList();
		applyFocusMode(cl, true, true, false);
		expect(cl.set.has(FOCUS_MODE_CLASS)).toBe(true);
		expect(cl.set.has(FOCUS_MODE_VIEW_HEADERS_CLASS)).toBe(true);
	});
	it("turning it off removes both classes", () => {
		const cl = fakeClassList();
		applyFocusMode(cl, true, true, false);
		expect(applyFocusMode(cl, false, true, false)).toBe(false);
		expect(cl.set.size).toBe(0);
	});
	it("is a no-op on mobile and clears stale classes", () => {
		const cl = fakeClassList();
		cl.set.add(FOCUS_MODE_CLASS);
		cl.set.add(FOCUS_MODE_VIEW_HEADERS_CLASS);
		expect(applyFocusMode(cl, true, true, true)).toBe(false);
		expect(cl.set.size).toBe(0);
	});
	it("is idempotent", () => {
		const cl = fakeClassList();
		applyFocusMode(cl, true, false, false);
		applyFocusMode(cl, true, false, false);
		expect([...cl.set]).toEqual([FOCUS_MODE_CLASS]);
	});
});

describe("osFullscreenStep", () => {
	it("enters OS full screen only when the setting is on", () => {
		expect(osFullscreenStep(true, true, false, false)).toEqual({ action: "enter", owned: true });
		expect(osFullscreenStep(true, false, false, false)).toEqual({ action: "none", owned: false });
	});
	it("does not claim a window that was already full screen", () => {
		expect(osFullscreenStep(true, true, true, false)).toEqual({ action: "none", owned: false });
		expect(osFullscreenStep(false, true, true, false)).toEqual({ action: "none", owned: false });
	});
	it("leaves full screen on exit only if focus mode entered it", () => {
		expect(osFullscreenStep(false, true, true, true)).toEqual({ action: "leave", owned: false });
		// the user already left full screen themselves
		expect(osFullscreenStep(false, true, false, true)).toEqual({ action: "none", owned: false });
	});
	it("turning the setting off while in focus mode releases the window", () => {
		expect(osFullscreenStep(true, false, true, true)).toEqual({ action: "leave", owned: false });
	});
});

describe("focus-mode hotkey vs Web viewer forwarding (v1.54.0)", () => {
	// Baked shape as measured on NAS 1.13.7: Mod resolved to Ctrl off-Mac.
	const baked = [
		{ modifiers: "Ctrl", key: "P" },
		{ modifiers: "Ctrl,Shift", key: "F11" },
		{ modifiers: "", key: "F11" },
	];
	const ids = ["command-palette:open", "shawns-toolbox:toggle-focus-mode", "shawns-toolbox:toggle-web-fullscreen"];

	it("the default hotkey is Mod+Shift+F11 and resolves per platform", () => {
		expect(hotkeyCombo({ modifiers: [...FOCUS_MODE_HOTKEY.modifiers], key: FOCUS_MODE_HOTKEY.key }, false)).toBe("Ctrl+Shift+F11");
		expect(hotkeyCombo({ modifiers: [...FOCUS_MODE_HOTKEY.modifiers], key: FOCUS_MODE_HOTKEY.key }, true)).toBe("Meta+Shift+F11");
	});

	it("a Ctrl+Shift+F11 keydown inside the Web viewer is forwarded to the command", () => {
		const index = indexFromBaked(baked, ids, false);
		const pass = parsePassThrough(DEFAULT_PASS_THROUGH_KEYS, false).combos;
		const combo = eventCombo({ key: "F11", code: "F11", ctrlKey: true, shiftKey: true });
		expect(combo).toBe("Ctrl+Shift+F11");
		expect(decide(combo, index, pass)).toBe("forward");
		expect(index.get("Ctrl+Shift+F11")).toEqual(["shawns-toolbox:toggle-focus-mode"]);
		expect(forwardSet(index, pass)).toContain("Ctrl+Shift+F11");
	});

	it("the default 'keys to leave to the page' never swallows it", () => {
		expect(parsePassThrough(DEFAULT_PASS_THROUGH_KEYS, false).combos.has("Ctrl+Shift+F11")).toBe(false);
		expect(parsePassThrough(DEFAULT_PASS_THROUGH_KEYS, true).combos.has("Meta+Shift+F11")).toBe(false);
	});

	it("Escape is never a forwarded (or focus-mode) key", () => {
		const index = indexFromBaked(baked, ids, false);
		expect(decide(eventCombo({ key: "Escape", code: "Escape" }), index, new Set())).toBe("not-forwardable");
	});
});
