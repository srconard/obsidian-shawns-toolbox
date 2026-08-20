import { describe, it, expect } from "vitest";
import {
	indentLines,
	moveLines,
	lineOfOffset,
	colOfOffset,
	offsetOf,
} from "../line-ops";

const TEXT = ["- alpha", "- beta", "\t- child", "- gamma"].join("\n");

describe("indentLines", () => {
	it("indents a single line with a tab", () => {
		const r = indentLines(TEXT, 1, 1, 1);
		expect(r.text.split("\n")[1]).toBe("\t- beta");
		expect(r.changed).toBe(true);
		expect(r.startLine).toBe(1);
	});
	it("indents a multi-line range", () => {
		const r = indentLines(TEXT, 1, 2, 1);
		expect(r.text.split("\n").slice(1, 3)).toEqual([
			"\t- beta",
			"\t\t- child",
		]);
	});
	it("leaves empty lines alone", () => {
		const r = indentLines("- a\n\n- b", 0, 2, 1);
		expect(r.text).toBe("\t- a\n\n\t- b");
	});
	it("outdents a tab", () => {
		const r = indentLines(TEXT, 2, 2, -1);
		expect(r.text.split("\n")[2]).toBe("- child");
	});
	it("outdents up to 4 leading spaces", () => {
		expect(indentLines("    - a", 0, 0, -1).text).toBe("- a");
		expect(indentLines("      - a", 0, 0, -1).text).toBe("  - a");
	});
	it("outdent on an unindented line changes nothing", () => {
		const r = indentLines(TEXT, 0, 0, -1);
		expect(r.text).toBe(TEXT);
		expect(r.changed).toBe(false);
	});
	it("clamps an out-of-range selection", () => {
		const r = indentLines(TEXT, 3, 99, 1);
		expect(r.text.split("\n")[3]).toBe("\t- gamma");
	});
});

describe("moveLines", () => {
	it("moves a line up", () => {
		const r = moveLines(TEXT, 1, 1, -1);
		expect(r.text.split("\n")).toEqual([
			"- beta",
			"- alpha",
			"\t- child",
			"- gamma",
		]);
		expect(r.startLine).toBe(0);
	});
	it("moves a line down", () => {
		const r = moveLines(TEXT, 0, 0, 1);
		expect(r.text.split("\n")[0]).toBe("- beta");
		expect(r.startLine).toBe(1);
	});
	it("moves a multi-line block as one unit", () => {
		const r = moveLines(TEXT, 1, 2, 1);
		expect(r.text.split("\n")).toEqual([
			"- alpha",
			"- gamma",
			"- beta",
			"\t- child",
		]);
		expect(r.startLine).toBe(2);
		expect(r.endLine).toBe(3);
	});
	it("is a no-op at the top edge", () => {
		const r = moveLines(TEXT, 0, 0, -1);
		expect(r.text).toBe(TEXT);
		expect(r.changed).toBe(false);
	});
	it("is a no-op at the bottom edge", () => {
		const r = moveLines(TEXT, 3, 3, 1);
		expect(r.text).toBe(TEXT);
		expect(r.changed).toBe(false);
	});
});

describe("offset helpers", () => {
	const t = "ab\ncde\nf";
	it("lineOfOffset", () => {
		expect(lineOfOffset(t, 0)).toBe(0);
		expect(lineOfOffset(t, 2)).toBe(0); // end of line 0
		expect(lineOfOffset(t, 3)).toBe(1); // start of line 1
		expect(lineOfOffset(t, 8)).toBe(2);
	});
	it("colOfOffset", () => {
		expect(colOfOffset(t, 0)).toBe(0);
		expect(colOfOffset(t, 5)).toBe(2);
		expect(colOfOffset(t, 3)).toBe(0);
	});
	it("offsetOf round-trips and clamps the column", () => {
		expect(offsetOf(t, 1, 2)).toBe(5);
		expect(offsetOf(t, 1, 99)).toBe(6); // clamped to end of "cde"
		expect(offsetOf(t, 0, 0)).toBe(0);
	});
});
