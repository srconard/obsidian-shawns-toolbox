import { describe, it, expect } from "vitest";
import {
	findLastMatching,
	normSpace,
	thoughtHead,
} from "../capture-recent";

describe("normSpace", () => {
	it("collapses whitespace runs and trims", () => {
		expect(normSpace("  a   b \t c  ")).toBe("a b c");
	});

	it("flattens newlines to single spaces", () => {
		expect(normSpace("a\n\nb")).toBe("a b");
	});
});

describe("thoughtHead", () => {
	it("takes the first line, normalised", () => {
		expect(thoughtHead("the   idea\nmore detail")).toBe("the idea");
	});

	it("returns the whole text when there is only one line", () => {
		expect(thoughtHead("just this")).toBe("just this");
	});

	it("is empty when the capture opens with a blank line", () => {
		// The caller drops the card rather than showing a line from further
		// down that would not match the thought's own line in the note.
		expect(thoughtHead("\nsecond line")).toBe("");
	});

	it("is empty for whitespace-only text", () => {
		expect(thoughtHead("   \n  ")).toBe("");
	});
});

describe("findLastMatching", () => {
	const posts = ["first thought", "second thought", "first thought"];

	it("returns the LAST index for a duplicated thought", () => {
		expect(findLastMatching(posts, "first thought")).toBe(2);
	});

	it("finds a unique thought", () => {
		expect(findLastMatching(posts, "second thought")).toBe(1);
	});

	it("matches ignoring whitespace differences on either side", () => {
		expect(findLastMatching(["a   b"], " a b ")).toBe(0);
	});

	it("returns -1 when nothing matches", () => {
		expect(findLastMatching(posts, "third thought")).toBe(-1);
	});

	it("returns -1 for an empty head rather than matching an empty post", () => {
		expect(findLastMatching(["", "x"], "  ")).toBe(-1);
	});

	it("returns -1 on an empty list", () => {
		expect(findLastMatching([], "anything")).toBe(-1);
	});
});
