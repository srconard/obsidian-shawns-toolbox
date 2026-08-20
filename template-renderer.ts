// template-renderer.ts — renders Shawn's daily-note template for an arbitrary
// date. A 1:1 TypeScript port of the vault's create-daily-note skill
// (.claude/skills/create-daily-note/scripts/create_daily_note.py): a narrow,
// explicit Templater subset — NOT full execution. Anything outside the
// vocabulary passes through unchanged, so an unrecognized fragment shows up
// literally in the created note: a loud failure, easy to extend.
//
// Understands:
// - {{date}} / {{time}} (core Templates syntax)
// - <% moment(tp.file.title,...).format/add/isoWeek ... %> date fragments
// - <% tp.date.now("YYYY-[W]WW", 0, tp.file.title, "YYYY-MM-DD") %>
// - <% tp.file.include("[[Name]]") %> → {templaterDir}/Name.md, rendered
// - <%* ... %> day-of-week dispatcher → {templaterDir}/Day Tasks/{Day}Tasks_template.md
//
// No Obsidian imports: file access is injected, dates are plain UTC math, so
// the whole module unit-tests.

export interface TemplateVault {
	/** Read a vault-relative path; null if the file does not exist. */
	read(path: string): Promise<string | null>;
}

export interface RendererPaths {
	/** Vault-relative path of the daily note template */
	template: string;
	/** Vault-relative folder holding Templater includes (and "Day Tasks/") */
	templaterDir: string;
}

const DAY_NAMES = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

function utc(dateIso: string): Date {
	const [y, m, d] = dateIso.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d));
}

export function shiftDateIso(dateIso: string, days: number): string {
	const [y, m, d] = dateIso.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The "logical" date for a wall-clock moment under Shawn's day-rollover rule:
 * before rolloverHour (e.g. 4 AM) the day still counts as yesterday, so a
 * 1 AM capture lands on the evening's note. rolloverHour 0 = plain midnight.
 */
export function logicalDateIso(now: Date, rolloverHour: number): string {
	const shifted = new Date(now.getTime() - rolloverHour * 3600000);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

/** ISO-8601 week (Monday-based, week 1 contains Jan 4). */
export function isoWeek(dateIso: string): { year: number; week: number } {
	const t = utc(dateIso);
	const day = (t.getUTCDay() + 6) % 7; // 0=Mon
	t.setUTCDate(t.getUTCDate() - day + 3); // the week's Thursday
	const year = t.getUTCFullYear();
	const jan4 = new Date(Date.UTC(year, 0, 4));
	const week1Monday = new Date(
		Date.UTC(year, 0, 4 - ((jan4.getUTCDay() + 6) % 7))
	);
	const week =
		Math.floor(
			(t.getTime() - week1Monday.getTime()) / (7 * 86400000)
		) + 1;
	return { year, week };
}

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

/**
 * Substitute the `<% ... %>` momentjs date fragments we understand with
 * literal values for the target date. Patterns match the actual template —
 * explicit, so unknown fragments are NOT silently swallowed.
 */
export function renderMomentFragments(text: string, dateIso: string): string {
	const yesterday = shiftDateIso(dateIso, -1);
	const tomorrow = shiftDateIso(dateIso, 1);
	const iso = isoWeek(dateIso);
	const week = `${iso.year}-W${pad2(iso.week)}`;
	const weekNum = String(iso.week);
	const d = utc(dateIso);
	const year = String(d.getUTCFullYear());
	const month = String(d.getUTCMonth() + 1);
	const day = String(d.getUTCDate());

	const MOMENT_TITLE =
		"moment\\(tp\\.file\\.title\\s*,\\s*['\"]YYYY-MM-DD['\"]\\)";
	const patterns: Array<[RegExp, string]> = [
		[
			new RegExp(
				`<%\\s*${MOMENT_TITLE}\\.add\\(\\s*-1\\s*,\\s*['"]days['"]\\)\\.format\\(['"]YYYY-MM-DD['"]\\)\\s*%>`,
				"g"
			),
			yesterday,
		],
		[
			new RegExp(
				`<%\\s*${MOMENT_TITLE}\\.add\\(\\s*1\\s*,\\s*['"]days['"]\\)\\.format\\(['"]YYYY-MM-DD['"]\\)\\s*%>`,
				"g"
			),
			tomorrow,
		],
		[
			new RegExp(
				`<%\\s*${MOMENT_TITLE}\\.format\\(['"]YYYY-\\[W\\]WW['"]\\)\\s*%>`,
				"g"
			),
			week,
		],
		[
			new RegExp(`<%\\s*${MOMENT_TITLE}\\.isoWeek\\(\\)\\s*%>`, "g"),
			weekNum,
		],
		[
			new RegExp(
				`<%\\s*${MOMENT_TITLE}\\.format\\(['"]YYYY-MM-DD['"]\\)\\s*%>`,
				"g"
			),
			dateIso,
		],
		[
			new RegExp(
				`<%\\s*${MOMENT_TITLE}\\.format\\(['"]YYYY['"]\\)\\s*%>`,
				"g"
			),
			year,
		],
		[
			new RegExp(
				`<%\\s*${MOMENT_TITLE}\\.format\\(['"]M['"]\\)\\s*%>`,
				"g"
			),
			month,
		],
		[
			new RegExp(
				`<%\\s*${MOMENT_TITLE}\\.format\\(['"]D['"]\\)\\s*%>`,
				"g"
			),
			day,
		],
		[
			new RegExp(
				`<%\\s*tp\\.date\\.now\\(\\s*['"]YYYY-\\[W\\]WW['"]\\s*,\\s*0\\s*,\\s*tp\\.file\\.title\\s*,\\s*['"]YYYY-MM-DD['"]\\)\\s*%>`,
				"g"
			),
			week,
		],
	];
	for (const [pattern, repl] of patterns) {
		text = text.replace(pattern, repl);
	}
	return text;
}

const INCLUDE_RE =
	/<%\s*(?:await\s+)?tp\.file\.include\(\s*['"]\[\[([^\]]+)\]\]['"]\s*\)\s*%>/g;

/**
 * Replace inline `<% tp.file.include("[[Name]]") %>` fragments with the
 * rendered contents of {templaterDir}/Name.md. A missing include renders as
 * a visible HTML comment so the failure is loud in the note. Does NOT touch
 * the `<%* ... %>` day dispatcher (that block starts with `<%*`).
 */
async function renderInlineIncludes(
	text: string,
	dateIso: string,
	tv: TemplateVault,
	paths: RendererPaths
): Promise<string> {
	const matches = [...text.matchAll(INCLUDE_RE)];
	for (const m of matches) {
		const name = m[1];
		const content = await tv.read(`${paths.templaterDir}/${name}.md`);
		const rendered =
			content === null
				? `<!-- include not found: ${name} -->`
				: renderMomentFragments(content.replace(/\n+$/, ""), dateIso);
		text = text.replace(m[0], rendered);
	}
	return text;
}

/**
 * Replace the `<%* ... %>` JS day-of-week dispatcher block with the contents
 * of the matching {Day}Tasks_template.md, rendered.
 */
async function renderDayDispatcher(
	text: string,
	dateIso: string,
	tv: TemplateVault,
	paths: RendererPaths
): Promise<string> {
	const dayName = DAY_NAMES[utc(dateIso).getUTCDay()];
	const content = await tv.read(
		`${paths.templaterDir}/Day Tasks/${dayName}Tasks_template.md`
	);
	const dayContent =
		content === null
			? ""
			: renderMomentFragments(content.replace(/\n+$/, ""), dateIso);
	return text.replace(/<%\*[\s\S]*?%>/g, () => dayContent);
}

/**
 * Empty list items must be `- ` and empty checkboxes `- [ ] ` (with a
 * trailing space) for Obsidian's renderer + Tasks plugin; editors that trim
 * trailing whitespace strip these. Restore them.
 */
export function fixTrailingSpaceOnEmptyItems(text: string): string {
	return text
		.split("\n")
		.map((line) => {
			const stripped = line.replace(/\s+$/, "");
			if (stripped === "-") return "- ";
			if (stripped === "- [ ]") return "- [ ] ";
			return line;
		})
		.join("\n");
}

/**
 * Render the daily note for dateIso. Returns null when the template file is
 * missing (the caller decides how loud to be).
 */
export async function renderDailyNote(
	tv: TemplateVault,
	paths: RendererPaths,
	dateIso: string,
	timeHm: string
): Promise<string | null> {
	let text = await tv.read(paths.template);
	if (text === null) return null;

	text = text.split("{{date}}").join(dateIso);
	text = text.split("{{time}}").join(timeHm);

	text = await renderInlineIncludes(text, dateIso, tv, paths);
	text = await renderDayDispatcher(text, dateIso, tv, paths);
	text = renderMomentFragments(text, dateIso);
	text = fixTrailingSpaceOnEmptyItems(text);
	return text;
}
