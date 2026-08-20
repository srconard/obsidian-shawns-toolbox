import { describe, it, expect } from "vitest";
import {
	parseSections,
	findSection,
	sliceSection,
	appendToSection,
	replaceSection,
	formatCaptureLine,
} from "../section-core";

// A trimmed-down copy of the real daily-note shape: frontmatter, nested
// heading levels, dataviewjs fences, trailing blank padding, a lone "-"
// placeholder bullet in Logs.
const DAILY = [
	"---",
	'DateCreated: "2026-08-19"',
	"tags:",
	"---",
	"nav line",
	"",
	"# Traction/ Action management",
	"",
	"## Plan for Today",
	"- [x] Call parents today",
	"- [ ] check oil",
	"## Tasks",
	"### Do Today",
	"- [ ] buy dry bag",
	"",
	"### Tasks Due Today",
	"```dataviewjs",
	'await dv.view("Settings/Scripts/tasks-due-today");',
	"```",
	"### Other tasks",
	"- [ ] existing other task",
	"",
	"# Logs",
	"- ",
	"",
	"",
	"# Thoughts",
	"- 08:24 first thought",
	"",
	"",
	"",
	"# Night Session Direction",
	"- ",
].join("\n");

describe("parseSections", () => {
	it("finds headings at every level with correct boundaries", () => {
		const secs = parseSections(DAILY);
		const titles = secs.map((s) => s.title);
		expect(titles).toContain("Plan for Today");
		expect(titles).toContain("Do Today");
		expect(titles).toContain("Thoughts");
		const plan = secs.find((s) => s.title === "Plan for Today")!;
		expect(plan.level).toBe(2);
		// Plan ends where "## Tasks" begins, not at "### Do Today"
		const tasks = secs.find((s) => s.title === "Tasks")!;
		expect(plan.end).toBe(tasks.headingLine);
	});

	it("a ### section ends at the next ### or shallower heading", () => {
		const secs = parseSections(DAILY);
		const doToday = secs.find((s) => s.title === "Do Today")!;
		const due = secs.find((s) => s.title === "Tasks Due Today")!;
		expect(doToday.end).toBe(due.headingLine);
	});

	it("ignores frontmatter and code fences", () => {
		const withFakes = [
			"---",
			"# not a heading",
			"---",
			"# Real",
			"```",
			"# fenced fake",
			"```",
			"done",
		].join("\n");
		const secs = parseSections(withFakes);
		expect(secs).toHaveLength(1);
		expect(secs[0].title).toBe("Real");
	});

	it("a deeper heading does not close a shallower section", () => {
		const secs = parseSections(DAILY);
		const tasks = secs.find((s) => s.title === "Tasks")!;
		const logs = secs.find((s) => s.title === "Logs")!;
		expect(tasks.end).toBe(logs.headingLine);
	});
});

describe("findSection", () => {
	it("matches level + title for a hash spec", () => {
		expect(findSection(DAILY, "### Do Today")?.title).toBe("Do Today");
		// wrong level -> no match
		expect(findSection(DAILY, "## Do Today")).toBeNull();
	});

	it("matches any level for a bare-title spec", () => {
		expect(findSection(DAILY, "Do Today")?.level).toBe(3);
	});

	it("returns null for a missing section", () => {
		expect(findSection(DAILY, "# Nope")).toBeNull();
	});
});

describe("sliceSection / replaceSection round trip", () => {
	it("slice -> replace with the same text is identity", () => {
		for (const spec of [
			"## Plan for Today",
			"### Do Today",
			"# Thoughts",
			"# Logs",
		]) {
			const text = sliceSection(DAILY, spec);
			expect(text).not.toBeNull();
			expect(replaceSection(DAILY, spec, text!)).toBe(DAILY);
		}
	});

	it("replaces only the target section", () => {
		const out = replaceSection(
			DAILY,
			"### Do Today",
			"- [ ] rewritten task\n"
		);
		expect(out).toContain("- [ ] rewritten task");
		expect(out).not.toContain("- [ ] buy dry bag");
		// neighbours untouched
		expect(out).toContain("- [x] Call parents today");
		expect(out).toContain("- 08:24 first thought");
		expect(out).toContain("### Tasks Due Today");
	});

	it("unknown spec returns content unchanged", () => {
		expect(replaceSection(DAILY, "# Nope", "x")).toBe(DAILY);
	});

	it("empty newText empties the section but keeps the heading", () => {
		const out = replaceSection(DAILY, "### Do Today", "");
		expect(out).toContain("### Do Today");
		expect(out).not.toContain("buy dry bag");
	});
});

describe("appendToSection", () => {
	it("inserts after the last non-blank line, preserving trailing padding", () => {
		const out = appendToSection(DAILY, "# Thoughts", "- 11:48 new thought");
		const lines = out.split("\n");
		const i = lines.indexOf("- 08:24 first thought");
		expect(lines[i + 1]).toBe("- 11:48 new thought");
		// the three blank padding lines before the next heading survive
		expect(lines.slice(i + 2, i + 5)).toEqual(["", "", ""]);
		expect(lines[i + 5]).toBe("# Night Session Direction");
	});

	it("replaces a lone '-' placeholder bullet", () => {
		const out = appendToSection(DAILY, "# Logs", "- 12:00 logged");
		expect(out).toContain("# Logs\n- 12:00 logged");
		const logsSlice = sliceSection(out, "# Logs")!;
		expect(logsSlice).not.toMatch(/^- $/m);
	});

	it("inserts right after the heading when the section is empty", () => {
		const doc = "# A\n\n\n# B\ncontent";
		const out = appendToSection(doc, "# A", "- new");
		expect(out).toBe("# A\n- new\n\n\n# B\ncontent");
	});

	it("creates a missing section at the end of the note", () => {
		const out = appendToSection("# A\ntext\n\n\n", "# Fresh", "- first");
		expect(out).toBe("# A\ntext\n\n# Fresh\n- first\n");
	});

	it("prefixes '## ' when creating from a bare-title spec", () => {
		const out = appendToSection("# A\ntext", "Fresh", "- first");
		expect(out).toContain("\n## Fresh\n- first");
	});

	it("does not append inside a code fence's fake heading", () => {
		const out = appendToSection(DAILY, "### Tasks Due Today", "- added");
		const lines = out.split("\n");
		const fenceClose = lines.indexOf("```", lines.indexOf("```dataviewjs"));
		expect(lines[fenceClose + 1]).toBe("- added");
	});
});

describe("formatCaptureLine", () => {
	it("timestamps thoughts and logs", () => {
		expect(formatCaptureLine("thought", "an idea", "11:48")).toBe(
			"- 11:48 an idea"
		);
		expect(formatCaptureLine("log", "did a thing", "09:05")).toBe(
			"- 09:05 did a thing"
		);
	});

	it("formats tasks as unchecked checkboxes without a timestamp", () => {
		expect(formatCaptureLine("doToday", "buy dry bag", "11:48")).toBe(
			"- [ ] buy dry bag"
		);
		expect(formatCaptureLine("otherTask", "later thing", "11:48")).toBe(
			"- [ ] later thing"
		);
	});

	it("turns extra lines into two-space continuations", () => {
		expect(
			formatCaptureLine("thought", "first\nsecond\r\nthird", "10:00")
		).toBe("- 10:00 first\n  second\n  third");
	});

	it("trims surrounding whitespace", () => {
		expect(formatCaptureLine("thought", "  padded  \n", "10:00")).toBe(
			"- 10:00 padded"
		);
	});
});
