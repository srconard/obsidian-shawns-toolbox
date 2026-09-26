import { describe, it, expect } from "vitest";
import {
	editTagInLines,
	groupByPath,
	locateLine,
	repliesPrompt,
	repliesPromptDetail,
} from "../retag-core";

const lines = [
	"# Thoughts",
	"- 08:00 the parent #thread/flow ^p1",
	"- 10:00 a reply #thread/flow ↩ [[2026-09-20#^p1]] ^r1",
	"- 11:00 untagged reply ↩ [[2026-09-20#^p1]]",
];

describe("editTagInLines", () => {
	it("adds a tag to the post and each reply, keeping ↩ links and block ids", () => {
		const res = editTagInLines(
			lines,
			[
				{ line: 1, raw: lines[1] },
				{ line: 2, raw: lines[2] },
				{ line: 3, raw: lines[3] },
			],
			"#thread/dance",
			"add"
		);
		expect(res.changed).toBe(3);
		expect(res.missing).toBe(0);
		expect(res.lines[1]).toBe("- 08:00 the parent #thread/flow #thread/dance ^p1");
		expect(res.lines[2]).toBe(
			"- 10:00 a reply #thread/flow ↩ [[2026-09-20#^p1]] #thread/dance ^r1"
		);
		expect(res.lines[3]).toBe("- 11:00 untagged reply ↩ [[2026-09-20#^p1]] #thread/dance");
		expect(res.lines[0]).toBe("# Thoughts");
	});

	it("removes a tag where present and no-ops where absent", () => {
		const res = editTagInLines(
			lines,
			[
				{ line: 1, raw: lines[1] },
				{ line: 3, raw: lines[3] },
			],
			"#thread/flow",
			"remove"
		);
		expect(res.changed).toBe(1);
		expect(res.lines[1]).toBe("- 08:00 the parent ^p1");
		expect(res.lines[3]).toBe(lines[3]);
	});

	it("never removes a longer tag that only shares a prefix", () => {
		const l = ["- x #thread/flowers #thread/flow/dance"];
		const res = editTagInLines(l, [{ line: 0, raw: l[0] }], "#thread/flow", "remove");
		expect(res.changed).toBe(0);
		expect(res.lines[0]).toBe(l[0]);
	});

	it("finds a shifted line by its text and counts a vanished one as missing", () => {
		const shifted = ["new first line", ...lines];
		const res = editTagInLines(
			shifted,
			[
				{ line: 1, raw: lines[1] },
				{ line: 9, raw: "- gone" },
			],
			"#thread/x",
			"add"
		);
		expect(res.changed).toBe(1);
		expect(res.missing).toBe(1);
		expect(res.lines[2]).toContain("#thread/x");
	});

	it("two identical targets resolve to two different lines", () => {
		const dup = ["- same", "- same"];
		const res = editTagInLines(
			dup,
			[
				{ line: 0, raw: "- same" },
				{ line: 0, raw: "- same" },
			],
			"#t/x",
			"add"
		);
		expect(res.lines).toEqual(["- same #t/x", "- same #t/x"]);
	});

	it("keeps CRLF line endings", () => {
		const crlf = ["- a thought #thread/flow\r"];
		const res = editTagInLines(crlf, [{ line: 0, raw: "- a thought #thread/flow" }], "#thread/flow", "remove");
		expect(res.lines[0]).toBe("- a thought\r");
	});
});

describe("helpers", () => {
	it("locateLine prefers the recorded number", () => {
		expect(locateLine(["a", "b", "a"], { line: 2, raw: "a" })).toBe(2);
		expect(locateLine(["a", "b"], { line: 5, raw: "b" })).toBe(1);
		expect(locateLine(["a"], { line: 0, raw: "z" })).toBe(-1);
	});

	it("groups targets by file", () => {
		const g = groupByPath([
			{ path: "A.md", note: "A" },
			{ path: "B.md", note: "B" },
			{ path: "A.md", note: "A" },
		]);
		expect([...g.keys()]).toEqual(["A.md", "B.md"]);
		expect(g.get("A.md")).toHaveLength(2);
	});

	it("words the question", () => {
		expect(repliesPrompt(1)).toBe("Also apply this to its 1 reply?");
		expect(repliesPrompt(3)).toBe("Also apply this to its 3 replies?");
		expect(repliesPromptDetail("#thread/x", "add")).toContain("adds #thread/x");
		expect(repliesPromptDetail("#thread/x", "remove")).toContain("removes #thread/x");
	});
});
