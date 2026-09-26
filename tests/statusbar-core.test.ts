import { describe, it, expect } from "vitest";
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
