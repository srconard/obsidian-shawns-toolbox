import { describe, it, expect } from "vitest";
import { removeTag, listRemovableTags, appendTag, hasTag } from "../thread-core";

describe("removeTag", () => {
	it("removes a tag at the end of the line", () => {
		expect(removeTag("- 09:00 a thought #thread/dance", "#thread/dance")).toBe(
			"- 09:00 a thought"
		);
	});

	it("removes a tag in the middle and collapses the double space", () => {
		expect(
			removeTag("- 09:00 a thought #thread/dance #thought/weekly", "#thread/dance")
		).toBe("- 09:00 a thought #thought/weekly");
	});

	it("keeps a trailing ^blockid at line-end", () => {
		expect(
			removeTag("- 09:00 a thought #thread/dance ^ab12cd", "#thread/dance")
		).toBe("- 09:00 a thought ^ab12cd");
	});

	it("keeps a ↩ reply link intact", () => {
		const line =
			"- 10:15 a reply #thread/dance ↩ [[2026-09-24#^ab12cd]]";
		expect(removeTag(line, "#thread/dance")).toBe(
			"- 10:15 a reply ↩ [[2026-09-24#^ab12cd]]"
		);
	});

	it("keeps both the reply link and the block id", () => {
		const line =
			"- 10:15 a reply #thread/dance #thought/monthly ↩ [[2026-09-24#^ab12cd]] ^ff00aa";
		expect(removeTag(line, "#thought/monthly")).toBe(
			"- 10:15 a reply #thread/dance ↩ [[2026-09-24#^ab12cd]] ^ff00aa"
		);
	});

	it("preserves tab indentation", () => {
		expect(removeTag("\t\t- 09:00 child #thread/dance", "#thread/dance")).toBe(
			"\t\t- 09:00 child"
		);
	});

	it("preserves space indentation", () => {
		expect(removeTag("    - 09:00 child #thread/dance text", "#thread/dance")).toBe(
			"    - 09:00 child text"
		);
	});

	it("handles tabs around the tag", () => {
		expect(removeTag("- 09:00 a\t#thread/dance\tb", "#thread/dance")).toBe(
			"- 09:00 a b"
		);
	});

	it("keeps indentation when the tag leads the line", () => {
		expect(removeTag("\t#thread/dance rest", "#thread/dance")).toBe("\trest");
		expect(removeTag("#thread/dance rest", "#thread/dance")).toBe("rest");
	});

	it("never touches a prefix-similar tag", () => {
		const line = "- 09:00 x #thread/dance-studies #thread/dance/sub";
		expect(removeTag(line, "#thread/dance")).toBe(line);
	});

	it("removes the exact tag but leaves its longer sibling", () => {
		expect(
			removeTag("- 09:00 x #thread/dance-studies #thread/dance", "#thread/dance")
		).toBe("- 09:00 x #thread/dance-studies");
		expect(
			removeTag("- 09:00 x #thread/dance #thread/dance-studies", "#thread/dance")
		).toBe("- 09:00 x #thread/dance-studies");
	});

	it("does not match a tag glued to a word", () => {
		const line = "- 09:00 foo#thread/dance";
		expect(removeTag(line, "#thread/dance")).toBe(line);
	});

	it("is a no-op when the tag is absent (same string back)", () => {
		const line = "- 09:00 a thought #thread/other ^ab12cd";
		expect(removeTag(line, "#thread/dance")).toBe(line);
		expect(removeTag(line, "")).toBe(line);
	});

	it("removes every occurrence of a duplicated tag", () => {
		expect(
			removeTag("- 09:00 a #thread/dance b #thread/dance", "#thread/dance")
		).toBe("- 09:00 a b");
	});

	it("keeps a trailing CR", () => {
		expect(removeTag("- 09:00 a #thread/dance\r", "#thread/dance")).toBe(
			"- 09:00 a\r"
		);
	});

	it("is the inverse of appendTag", () => {
		for (const line of [
			"- 09:00 a thought",
			"- 09:00 a thought ^ab12cd",
			"\t- 09:00 a thought #thought/weekly",
		]) {
			const tagged = appendTag(line, "#thread/dance");
			expect(hasTag(tagged, "#thread/dance")).toBe(true);
			expect(removeTag(tagged, "#thread/dance")).toBe(line);
		}
	});
});

describe("listRemovableTags", () => {
	it("lists thread and cadence tags in order", () => {
		expect(
			listRemovableTags(
				"- 09:00 x #thought/weekly #thread/dance #thread/dance-studies ^ab12cd"
			)
		).toEqual(["#thought/weekly", "#thread/dance", "#thread/dance-studies"]);
	});

	it("ignores the reply link, block id, other tags and unknown cadences", () => {
		expect(
			listRemovableTags(
				"- 10:15 r #thread/dance #capture #thought/daily ↩ [[2026-09-24#^ab12cd]] ^ff00aa"
			)
		).toEqual(["#thread/dance"]);
	});

	it("de-duplicates and returns [] for an untagged line", () => {
		expect(listRemovableTags("- a #thread/x b #thread/x")).toEqual(["#thread/x"]);
		expect(listRemovableTags("- 09:00 nothing here")).toEqual([]);
	});

	it("does not list a tag glued to a word", () => {
		expect(listRemovableTags("- foo#thread/x")).toEqual([]);
	});
});
