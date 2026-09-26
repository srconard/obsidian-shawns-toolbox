import { describe, it, expect } from "vitest";
import {
	collectThreadNames,
	countEdits,
	editableLines,
	mergesIntoExisting,
	parseRenameInput,
	previewText,
	renameInAreasNote,
	renameInContent,
	renameLine,
	renameNameList,
	renameThreadName,
	undoInContent,
} from "../thread-rename-core";

describe("renameThreadName — descendant mapping and prefix safety", () => {
	it("maps the thread itself and every descendant", () => {
		expect(renameThreadName("flow", "flow", "create")).toBe("create");
		expect(renameThreadName("flow/sub", "flow", "create")).toBe("create/sub");
		expect(renameThreadName("flow/a/b", "flow", "x/y")).toBe("x/y/a/b");
		expect(renameThreadName("flow/movement", "flow/movement", "create/movement")).toBe(
			"create/movement"
		);
	});

	it("never touches a name that only shares a prefix, a parent or a sibling", () => {
		expect(renameThreadName("flowers", "flow", "create")).toBeNull();
		expect(renameThreadName("flow-state", "flow", "create")).toBeNull();
		expect(renameThreadName("flow", "flow/movement", "x")).toBeNull();
		expect(renameThreadName("flow/music", "flow/movement", "x")).toBeNull();
		expect(renameThreadName("flow/movements", "flow/movement", "x")).toBeNull();
	});
});

describe("parseRenameInput", () => {
	it("accepts the prefilled form, with or without # and thread/", () => {
		expect(parseRenameInput("thread/flow/dance", "flow/movement")).toEqual({ ok: true, path: "flow/dance" });
		expect(parseRenameInput("#thread/create/movement", "flow/movement")).toEqual({
			ok: true,
			path: "create/movement",
		});
		expect(parseRenameInput("  dance  ", "flow")).toEqual({ ok: true, path: "dance" });
		expect(parseRenameInput("a_b/c-d/9x", "flow")).toEqual({ ok: true, path: "a_b/c-d/9x" });
	});

	it("rejects empty, spaces, bad characters and empty segments", () => {
		for (const bad of ["", "   ", "thread/", "#thread", "#"]) expect(parseRenameInput(bad, "flow").ok).toBe(false);
		expect(parseRenameInput("thread/flow dance", "flow").ok).toBe(false);
		expect(parseRenameInput("thread/flow.dance", "flow").ok).toBe(false);
		expect(parseRenameInput("thread/flöw", "flow").ok).toBe(false);
		expect(parseRenameInput("thread/a//b", "flow").ok).toBe(false);
		expect(parseRenameInput("thread/a/", "flow").ok).toBe(false);
		expect(parseRenameInput("thread//a", "flow").ok).toBe(false);
	});

	it("rejects no change and moving a thread inside itself", () => {
		const same = parseRenameInput("thread/flow/movement", "flow/movement");
		expect(same.ok).toBe(false);
		if (!same.ok) expect(same.error).toMatch(/current name/);
		const inside = parseRenameInput("thread/flow/sub", "flow");
		expect(inside.ok).toBe(false);
		if (!inside.ok) expect(inside.error).toMatch(/inside itself/);
	});

	it("allows moving to a parent or a sibling (those are merges, not loops)", () => {
		expect(parseRenameInput("thread/flow", "flow/movement")).toEqual({ ok: true, path: "flow" });
		expect(parseRenameInput("thread/flowers", "flow")).toEqual({ ok: true, path: "flowers" });
	});
});

describe("renameLine — only the tag token changes", () => {
	it("keeps text, time, block id and reply link verbatim", () => {
		const line = "- 09:14 a thought #thread/flow/movement ↩ [[2026-09-20#^ab12]] ^cd34";
		expect(renameLine(line, "flow/movement", "create/movement")).toEqual({
			after: "- 09:14 a thought #thread/create/movement ↩ [[2026-09-20#^ab12]] ^cd34",
			child: false,
		});
	});

	it("moves child tags and flags the line as a child line", () => {
		expect(renameLine("- x #thread/flow/sub", "flow", "create")).toEqual({
			after: "- x #thread/create/sub",
			child: true,
		});
	});

	it("is prefix-safe on the line", () => {
		expect(renameLine("- x #thread/flowers #thread/flow-state", "flow", "create")).toBeNull();
		expect(renameLine("- x #thread/flowers #thread/flow", "flow", "create")!.after).toBe(
			"- x #thread/flowers #thread/create"
		);
	});

	it("needs a whitespace boundary before the #", () => {
		expect(renameLine("- see a#thread/flow", "flow", "create")).toBeNull();
		expect(renameLine("#thread/flow at line start", "flow", "create")!.after).toBe(
			"#thread/create at line start"
		);
	});

	it("keeps a CRLF line ending", () => {
		expect(renameLine("- x #thread/flow\r", "flow", "y")!.after).toBe("- x #thread/y\r");
	});

	it("skips inline code", () => {
		expect(renameLine("- use `#thread/flow` like this", "flow", "y")).toBeNull();
		expect(renameLine("- `#thread/flow` and #thread/flow", "flow", "y")!.after).toBe(
			"- `#thread/flow` and #thread/y"
		);
	});

	it("drops a duplicate the merge would create and closes the gap", () => {
		expect(renameLine("- x #thread/flow #thread/create ^id", "flow", "create")!.after).toBe(
			"- x #thread/create ^id"
		);
		expect(renameLine("- x #thread/create #thread/flow ^id", "flow", "create")!.after).toBe(
			"- x #thread/create ^id"
		);
		// Two tokens mapping to the same new name keep one.
		expect(renameLine("- x #thread/a/b #thread/c/b", "a", "c")!.after).toBe("- x #thread/c/b");
	});

	it("renames every occurrence on the line", () => {
		expect(renameLine("- #thread/flow and #thread/flow/sub", "flow", "z")).toEqual({
			after: "- #thread/z and #thread/z/sub",
			child: true,
		});
	});
});

describe("editableLines — code fences and frontmatter", () => {
	it("excludes frontmatter and fenced code, fence lines included", () => {
		const lines = ["---", "tags: x", "---", "a", "```", "#thread/flow", "```", "b", "~~~js", "c", "~~~", "d"];
		expect(editableLines(lines)).toEqual([
			false, false, false, true, false, false, false, true, false, false, false, true,
		]);
	});

	it("a ``` inside a ~~~ fence does not close it; a longer closer does", () => {
		expect(editableLines(["~~~", "```", "x", "~~~", "y"])).toEqual([false, false, false, false, true]);
		expect(editableLines(["````", "```", "x", "````", "y"])).toEqual([false, false, false, false, true]);
	});

	it("an unclosed leading --- is not frontmatter", () => {
		expect(editableLines(["---", "#thread/flow"])).toEqual([true, true]);
	});
});

describe("renameInContent", () => {
	const note = [
		"---",
		"title: t",
		"---",
		"# Thoughts",
		"- 08:00 one #thread/flow ^a1",
		"- 08:05 two #thread/flow/movement ↩ [[n#^a1]]",
		"- 08:10 three #thread/flowers",
		"```",
		"- 08:15 code #thread/flow",
		"```",
		"- 08:20 four #thread/flow/movement/dance",
	].join("\n");

	it("rewrites every line in the subtree and records exact edits", () => {
		const r = renameInContent(note, "flow", "create/flow");
		expect(r.edits.map((e) => e.line)).toEqual([4, 5, 10]);
		expect(r.edits.map((e) => e.child)).toEqual([false, true, true]);
		const lines = r.content.split("\n");
		expect(lines[4]).toBe("- 08:00 one #thread/create/flow ^a1");
		expect(lines[5]).toBe("- 08:05 two #thread/create/flow/movement ↩ [[n#^a1]]");
		expect(lines[6]).toBe("- 08:10 three #thread/flowers");
		expect(lines[8]).toBe("- 08:15 code #thread/flow");
		expect(lines[10]).toBe("- 08:20 four #thread/create/flow/movement/dance");
	});

	it("a note without the tag is returned untouched", () => {
		const r = renameInContent("- x #thread/other", "flow", "y");
		expect(r.edits).toEqual([]);
		expect(r.content).toBe("- x #thread/other");
	});

	it("keeps CRLF line endings throughout", () => {
		const r = renameInContent("- a #thread/flow\r\n- b\r\n", "flow", "y");
		expect(r.content).toBe("- a #thread/y\r\n- b\r\n");
	});
});

describe("preview counts and merge detection", () => {
	it("counts lines, notes and child lines", () => {
		const a = renameInContent("- #thread/flow\n- #thread/flow/sub", "flow", "y");
		const b = renameInContent("- #thread/flow/sub/deep", "flow", "y");
		const c = renameInContent("- nothing", "flow", "y");
		const counts = countEdits([a, b, c]);
		expect(counts).toEqual({ lines: 3, notes: 2, childLines: 2 });
		expect(previewText("flow", "y", counts)).toBe(
			"Rename #thread/flow → #thread/y: 3 lines in 2 notes (includes 2 lines in child threads)"
		);
		expect(previewText("flow", "y", { lines: 1, notes: 1, childLines: 0 })).toBe(
			"Rename #thread/flow → #thread/y: 1 line in 1 note"
		);
	});

	it("detects a merge into an existing thread or its subtree", () => {
		expect(mergesIntoExisting(["flow", "create"], "flow", "create")).toBe(true);
		expect(mergesIntoExisting(["flow", "create/other"], "flow", "create")).toBe(true);
		expect(mergesIntoExisting(["flow/sub", "y/sub"], "flow", "y")).toBe(true);
		// Moving into an ancestor that still has other children.
		expect(mergesIntoExisting(["flow/movement", "flow/music"], "flow/movement", "flow")).toBe(true);
	});

	it("no merge when only the moved subtree or prefix-lookalikes exist", () => {
		expect(mergesIntoExisting(["flow", "flow/sub"], "flow", "create")).toBe(false);
		expect(mergesIntoExisting(["flow", "createx", "creat"], "flow", "create")).toBe(false);
	});

	it("collectThreadNames ignores code and frontmatter", () => {
		const names = collectThreadNames("---\nx: 1\n---\n- #thread/a #thread/b/c\n```\n#thread/z\n```\n`#thread/q`");
		expect(names.sort()).toEqual(["a", "b/c"]);
	});
});

describe("Thread Areas note and stored name lists", () => {
	const areas = [
		"<!-- #thread/<name> comment -->",
		"## Movement",
		"- flow",
		"- flowers",
		"- #thread/dance",
		"## Unsorted",
		"- [[soul]]",
	].join("\n");

	it("renames a root bullet in place, keeping its wrapper", () => {
		const out = renameInAreasNote(areas, "flow", "motion").split("\n");
		expect(out[2]).toBe("- motion");
		expect(out[3]).toBe("- flowers");
		expect(renameInAreasNote(areas, "dance", "move").split("\n")[4]).toBe("- #thread/move");
		expect(renameInAreasNote(areas, "soul", "spirit").split("\n")[6]).toBe("- [[spirit]]");
	});

	it("drops the bullet when a root moves under another root", () => {
		const out = renameInAreasNote(areas, "dance", "flow/dance");
		expect(out.split("\n")).toEqual([
			"<!-- #thread/<name> comment -->",
			"## Movement",
			"- flow",
			"- flowers",
			"## Unsorted",
			"- [[soul]]",
		]);
	});

	it("leaves the note unchanged when nothing matches", () => {
		expect(renameInAreasNote(areas, "nothing", "x")).toBe(areas);
	});

	it("remaps pins / collapsed lists, deduped", () => {
		expect(renameNameList(["flow", "flow/sub", "flowers", "y"], "flow", "y")).toEqual([
			"y",
			"y/sub",
			"flowers",
		]);
	});
});

describe("undoInContent — the exact inverse", () => {
	const before = "# T\n- 08:00 a #thread/flow ^x1\n- b\n- 09:00 c #thread/flow/sub\n- d #thread/flowers";

	it("restores the original content exactly", () => {
		const r = renameInContent(before, "flow", "create");
		const u = undoInContent(r.content, r.edits);
		expect(u).toEqual({ content: before, restored: 2, missed: 0 });
	});

	it("restores a merge that dropped a duplicate", () => {
		const src = "- x #thread/flow #thread/create ^id";
		const r = renameInContent(src, "flow", "create");
		expect(undoInContent(r.content, r.edits).content).toBe(src);
	});

	it("follows a line that shifted since the rename", () => {
		const r = renameInContent(before, "flow", "create");
		const shifted = "new top line\n" + r.content;
		const u = undoInContent(shifted, r.edits);
		expect(u.content).toBe("new top line\n" + before);
		expect(u.restored).toBe(2);
	});

	it("leaves a line edited again since the rename alone", () => {
		const r = renameInContent(before, "flow", "create");
		const edited = r.content.replace("- 08:00 a #thread/create ^x1", "- 08:00 a EDITED #thread/create ^x1");
		const u = undoInContent(edited, r.edits);
		expect(u.restored).toBe(1);
		expect(u.missed).toBe(1);
		expect(u.content).toContain("EDITED #thread/create");
		expect(u.content).toContain("- 09:00 c #thread/flow/sub");
	});

	it("keeps the current CR of a line", () => {
		const r = renameInContent("- a #thread/flow\r\n- b", "flow", "y");
		expect(undoInContent(r.content, r.edits).content).toBe("- a #thread/flow\r\n- b");
	});
});
