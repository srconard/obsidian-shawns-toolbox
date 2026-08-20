import { describe, it, expect } from "vitest";
import { toggleBullet, toggleCheckbox } from "../line-ops";

describe("toggleBullet", () => {
	it("makes a plain line a bullet, preserving indent", () => {
		expect(toggleBullet("\tsome text", 0, 0).text).toBe("\t- some text");
	});
	it("removes the marker when every line is already a plain bullet", () => {
		const r = toggleBullet("- a\n\t- b", 0, 1);
		expect(r.text).toBe("a\n\tb");
	});
	it("converts a checkbox line to a plain bullet (mixed → all bullets)", () => {
		expect(toggleBullet("- [x] done", 0, 0).text).toBe("- done");
	});
	it("mixed plain + bullet range becomes all bullets", () => {
		expect(toggleBullet("- a\nplain", 0, 1).text).toBe("- a\n- plain");
	});
	it("skips empty lines and reports no-op on all-empty range", () => {
		const r = toggleBullet("- a\n\n- b", 0, 2);
		expect(r.text).toBe("a\n\nb");
		expect(toggleBullet("\n\n", 0, 1).changed).toBe(false);
	});
});

describe("toggleCheckbox", () => {
	it("makes a plain line a checkbox", () => {
		expect(toggleCheckbox("call mom", 0, 0).text).toBe("- [ ] call mom");
	});
	it("makes a bullet a checkbox, preserving indent", () => {
		expect(toggleCheckbox("\t- call mom", 0, 0).text).toBe(
			"\t- [ ] call mom"
		);
	});
	it("drops back to plain bullets when every line is a checkbox", () => {
		expect(toggleCheckbox("- [ ] a\n- [x] b", 0, 1).text).toBe("- a\n- b");
	});
	it("keeps existing checked state on mixed ranges", () => {
		expect(toggleCheckbox("- [x] a\n- b", 0, 1).text).toBe(
			"- [x] a\n- [ ] b"
		);
	});
	it("does not treat a bare [x] prose line as a checkbox", () => {
		expect(toggleCheckbox("- [ ] a\n[x] prose", 0, 1).text).toBe(
			"- [ ] a\n- [ ] [x] prose"
		);
	});
});
