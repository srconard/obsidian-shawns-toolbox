import { describe, it, expect } from "vitest";
import {
	CAPTURE_HOVER_BUTTONS_CLASS,
	applyCaptureHoverButtons,
	wantsCaptureHoverButtons,
	type ClassListLike,
} from "../capture-hover-core";

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

describe("wantsCaptureHoverButtons", () => {
	it("is on only for an enabled setting on desktop", () => {
		expect(wantsCaptureHoverButtons(true, false)).toBe(true);
		expect(wantsCaptureHoverButtons(false, false)).toBe(false);
		expect(wantsCaptureHoverButtons(true, true)).toBe(false);
		expect(wantsCaptureHoverButtons(false, true)).toBe(false);
	});
});

describe("applyCaptureHoverButtons", () => {
	it("adds the body class on desktop when enabled", () => {
		const cl = fakeClassList();
		expect(applyCaptureHoverButtons(cl, true, false)).toBe(true);
		expect(cl.set.has(CAPTURE_HOVER_BUTTONS_CLASS)).toBe(true);
	});

	it("removes it again when the toggle is turned off", () => {
		const cl = fakeClassList();
		applyCaptureHoverButtons(cl, true, false);
		expect(applyCaptureHoverButtons(cl, false, false)).toBe(false);
		expect(cl.set.has(CAPTURE_HOVER_BUTTONS_CLASS)).toBe(false);
	});

	it("never adds it on mobile (Android keeps its buttons), and clears a stale one", () => {
		const cl = fakeClassList();
		cl.set.add(CAPTURE_HOVER_BUTTONS_CLASS);
		expect(applyCaptureHoverButtons(cl, true, true)).toBe(false);
		expect(cl.set.has(CAPTURE_HOVER_BUTTONS_CLASS)).toBe(false);
	});

	it("is idempotent when applied twice", () => {
		const cl = fakeClassList();
		applyCaptureHoverButtons(cl, true, false);
		applyCaptureHoverButtons(cl, true, false);
		expect([...cl.set]).toEqual([CAPTURE_HOVER_BUTTONS_CLASS]);
	});
});
