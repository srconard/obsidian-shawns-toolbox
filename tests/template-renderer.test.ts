import { describe, it, expect } from "vitest";
import {
	isoWeek,
	shiftDateIso,
	logicalDateIso,
	renderMomentFragments,
	fixTrailingSpaceOnEmptyItems,
	renderDailyNote,
	type TemplateVault,
	type RendererPaths,
} from "../template-renderer";

const PATHS: RendererPaths = {
	template: "Settings/Templates/Day/Daily Note Template.md",
	templaterDir: "Settings/Templater",
};

function fakeVault(files: Record<string, string>): TemplateVault {
	return {
		read: async (path: string) => files[path] ?? null,
	};
}

describe("isoWeek", () => {
	it("matches known ISO-8601 fixtures", () => {
		expect(isoWeek("2026-08-19")).toEqual({ year: 2026, week: 34 });
		expect(isoWeek("2016-01-04")).toEqual({ year: 2016, week: 1 });
		expect(isoWeek("2015-12-31")).toEqual({ year: 2015, week: 53 });
		expect(isoWeek("2021-01-01")).toEqual({ year: 2020, week: 53 });
	});
});

describe("logicalDateIso", () => {
	it("counts pre-rollover hours as the previous day", () => {
		// local-time Date constructor keeps this TZ-independent
		expect(logicalDateIso(new Date(2026, 7, 20, 0, 30), 4)).toBe(
			"2026-08-19"
		);
		expect(logicalDateIso(new Date(2026, 7, 20, 3, 59), 4)).toBe(
			"2026-08-19"
		);
	});
	it("flips to the new day at the rollover hour", () => {
		expect(logicalDateIso(new Date(2026, 7, 20, 4, 0), 4)).toBe(
			"2026-08-20"
		);
		expect(logicalDateIso(new Date(2026, 7, 20, 23, 50), 4)).toBe(
			"2026-08-20"
		);
	});
	it("rollover 0 is plain midnight", () => {
		expect(logicalDateIso(new Date(2026, 7, 20, 0, 1), 0)).toBe(
			"2026-08-20"
		);
	});
	it("handles month boundaries", () => {
		expect(logicalDateIso(new Date(2026, 8, 1, 2, 0), 4)).toBe(
			"2026-08-31"
		);
	});
});

describe("shiftDateIso", () => {
	it("shifts across month and year boundaries", () => {
		expect(shiftDateIso("2026-08-19", 1)).toBe("2026-08-20");
		expect(shiftDateIso("2026-08-01", -1)).toBe("2026-07-31");
		expect(shiftDateIso("2026-12-31", 1)).toBe("2027-01-01");
	});
});

describe("renderMomentFragments", () => {
	const date = "2026-08-19";

	it("renders yesterday / tomorrow / week / weekNum / self", () => {
		expect(
			renderMomentFragments(
				`<% moment(tp.file.title,'YYYY-MM-DD').add(-1,'days').format("YYYY-MM-DD") %>`,
				date
			)
		).toBe("2026-08-18");
		expect(
			renderMomentFragments(
				`<% moment(tp.file.title,'YYYY-MM-DD').add(1,'days').format("YYYY-MM-DD") %>`,
				date
			)
		).toBe("2026-08-20");
		expect(
			renderMomentFragments(
				`<% moment(tp.file.title, "YYYY-MM-DD").format("YYYY-[W]WW") %>`,
				date
			)
		).toBe("2026-W34");
		expect(
			renderMomentFragments(
				`<% moment(tp.file.title, "YYYY-MM-DD").isoWeek() %>`,
				date
			)
		).toBe("34");
		expect(
			renderMomentFragments(
				`<% moment(tp.file.title, "YYYY-MM-DD").format("YYYY-MM-DD") %>`,
				date
			)
		).toBe("2026-08-19");
	});

	it("renders the tp.date.now week reference used by day-task templates", () => {
		expect(
			renderMomentFragments(
				`<% tp.date.now("YYYY-[W]WW", 0, tp.file.title, "YYYY-MM-DD") %>`,
				date
			)
		).toBe("2026-W34");
	});

	it("leaves unknown fragments untouched (loud failure)", () => {
		const weird = `<% tp.frontmatter.something %>`;
		expect(renderMomentFragments(weird, date)).toBe(weird);
	});
});

describe("fixTrailingSpaceOnEmptyItems", () => {
	it("restores trailing spaces on empty bullets and checkboxes", () => {
		expect(fixTrailingSpaceOnEmptyItems("-\n- [ ]\n- real")).toBe(
			"- \n- [ ] \n- real"
		);
	});
});

describe("renderDailyNote", () => {
	const template = [
		"---",
		'DateCreated: "{{date}}"',
		'TimeCreated: "{{time}}"',
		"---",
		`[[<% moment(tp.file.title,'YYYY-MM-DD').add(-1,'days').format("YYYY-MM-DD") %>|⏪]] | [[<% moment(tp.file.title, "YYYY-MM-DD").format("YYYY-[W]WW") %>|Week: <% moment(tp.file.title, "YYYY-MM-DD").isoWeek() %>]]`,
		"",
		'<% tp.file.include("[[Tracked Habits]]") %>',
		"",
		"### Do Today",
		"- [ ]",
		"<%*",
		"let noteDate = moment(tp.file.title)",
		"if (dayOfWeek === 4) {",
		'    tR += await tp.file.include("[[ThursdayTasks_template]]")',
		"}",
		"%>",
		"",
		"# Logs",
		"-",
	].join("\n");

	const files: Record<string, string> = {
		[PATHS.template]: template,
		"Settings/Templater/Tracked Habits.md": "## Habits\n- [ ] Flow #habit\n",
		"Settings/Templater/Day Tasks/ThursdayTasks_template.md":
			'- [ ] Thursday thing for <% tp.date.now("YYYY-[W]WW", 0, tp.file.title, "YYYY-MM-DD") %>\n',
	};

	it("renders the full pipeline for a Thursday", async () => {
		// 2026-08-20 is a Thursday
		const out = await renderDailyNote(
			fakeVault(files),
			PATHS,
			"2026-08-20",
			"21:30"
		);
		expect(out).not.toBeNull();
		expect(out!).toContain('DateCreated: "2026-08-20"');
		expect(out!).toContain('TimeCreated: "21:30"');
		expect(out!).toContain("[[2026-08-19|⏪]]");
		expect(out!).toContain("[[2026-W34|Week: 34]]");
		expect(out!).toContain("## Habits");
		expect(out!).toContain("- [ ] Thursday thing for 2026-W34");
		expect(out!).not.toContain("<%");
		// trailing-space repair applied
		expect(out!).toContain("# Logs\n- ");
	});

	it("drops the dispatcher content on a day with no template", async () => {
		// 2026-08-21 is a Friday; no FridayTasks_template in the fake vault
		const out = await renderDailyNote(
			fakeVault(files),
			PATHS,
			"2026-08-21",
			"08:00"
		);
		expect(out!).not.toContain("Thursday thing");
		expect(out!).not.toContain("<%*");
	});

	it("marks a missing include loudly", async () => {
		const noHabits = { ...files };
		delete noHabits["Settings/Templater/Tracked Habits.md"];
		const out = await renderDailyNote(
			fakeVault(noHabits),
			PATHS,
			"2026-08-20",
			"08:00"
		);
		expect(out!).toContain("<!-- include not found: Tracked Habits -->");
	});

	it("returns null when the template itself is missing", async () => {
		const out = await renderDailyNote(fakeVault({}), PATHS, "2026-08-20", "08:00");
		expect(out).toBeNull();
	});
});
