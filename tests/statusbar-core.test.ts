import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
	STATUSBAR_AUTOHIDE_CLASS,
	applyStatusBarAutohide,
	wantsStatusBarAutohide,
	type ClassListLike,
} from "../statusbar-core";

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

describe("wantsStatusBarAutohide", () => {
	it("is on only for an enabled setting on desktop", () => {
		expect(wantsStatusBarAutohide(true, false)).toBe(true);
		expect(wantsStatusBarAutohide(false, false)).toBe(false);
		expect(wantsStatusBarAutohide(true, true)).toBe(false);
		expect(wantsStatusBarAutohide(false, true)).toBe(false);
	});
});

describe("applyStatusBarAutohide", () => {
	it("adds the body class on desktop when enabled", () => {
		const cl = fakeClassList();
		expect(applyStatusBarAutohide(cl, true, false)).toBe(true);
		expect(cl.set.has(STATUSBAR_AUTOHIDE_CLASS)).toBe(true);
	});

	it("removes it again when the toggle is turned off", () => {
		const cl = fakeClassList();
		applyStatusBarAutohide(cl, true, false);
		expect(applyStatusBarAutohide(cl, false, false)).toBe(false);
		expect(cl.set.has(STATUSBAR_AUTOHIDE_CLASS)).toBe(false);
	});

	it("never adds it on mobile, and clears a stale one", () => {
		const cl = fakeClassList();
		cl.set.add(STATUSBAR_AUTOHIDE_CLASS);
		expect(applyStatusBarAutohide(cl, true, true)).toBe(false);
		expect(cl.set.has(STATUSBAR_AUTOHIDE_CLASS)).toBe(false);
	});

	it("is idempotent when applied twice", () => {
		const cl = fakeClassList();
		applyStatusBarAutohide(cl, true, false);
		applyStatusBarAutohide(cl, true, false);
		expect([...cl.set]).toEqual([STATUSBAR_AUTOHIDE_CLASS]);
	});
});

// v1.56.5: the reveal target is a small bottom-right corner square, not the
// bar's whole width (Shawn, 2026-09-27). Lock the CSS contract that makes it so.

describe("auto-hide status bar CSS (corner hot zone)", () => {
	const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
	const sel = "body.stx-autohide-statusbar:not(.is-mobile)";
	const rule = (selector: string): string => {
		const start = css.indexOf(selector + " {");
		expect(start, `rule for ${selector}`).toBeGreaterThanOrEqual(0);
		return css.slice(start, css.indexOf("}", start));
	};

	it("hidden bar ignores the pointer, so its sliver and width never reveal it", () => {
		expect(rule(`${sel} .status-bar`)).toMatch(/pointer-events:\s*none/);
	});

	it("the only hover target is a square pinned to the bottom-right corner", () => {
		const before = rule(`${sel} .status-bar::before`);
		expect(before).toMatch(/pointer-events:\s*auto/);
		expect(before).toMatch(/right:\s*0/);
		expect(before).toMatch(/left:\s*auto/);
		expect(before).toMatch(/width:\s*var\(--stx-statusbar-hotzone\)/);
		expect(before).toMatch(/height:\s*var\(--stx-statusbar-hotzone\)/);
		expect(before).toMatch(/top:\s*calc\(3px - var\(--stx-statusbar-hotzone\)\)/);
		const size = /--stx-statusbar-hotzone:\s*(\d+)px/.exec(rule(sel));
		expect(size).not.toBeNull();
		const px = Number(size![1]);
		expect(px).toBeGreaterThanOrEqual(40);
		expect(px).toBeLessThanOrEqual(60);
	});

	it("once revealed the bar takes the pointer again, so it stays up while hovered", () => {
		const shown = rule(`${sel} .status-bar:focus-within`);
		expect(shown).toMatch(/pointer-events:\s*auto/);
		expect(shown).toMatch(/opacity:\s*1/);
	});
});
