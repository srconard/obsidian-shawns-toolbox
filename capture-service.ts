// capture-service.ts — Obsidian glue over section-core for capture routing.
// Periodic notes are resolved by moment-format settings (defaults match the
// vault's "00. Timeline/" conventions) rather than depending on the Daily
// Notes / Periodic Notes plugins.
import { App, TFile, moment, normalizePath } from "obsidian";
import {
	appendToSection,
	formatCaptureLine,
	type CaptureKind,
} from "./section-core";
import {
	logicalDateIso,
	renderDailyNote,
	type TemplateVault,
} from "./template-renderer";
import type { ShawnsToolboxSettings } from "./settings";

export type NoteScope = "day" | "week" | "month" | "quarter" | "year";

export const SCOPE_LABELS: Record<NoteScope, string> = {
	day: "Today",
	week: "Week",
	month: "Month",
	quarter: "Quarter",
	year: "Year",
};

export const CAPTURE_LABELS: Record<CaptureKind, string> = {
	thought: "Thought",
	doToday: "Do Today",
	otherTask: "Other Task",
	log: "Log",
};

export const CAPTURE_ICONS: Record<CaptureKind, string> = {
	thought: "lightbulb",
	doToday: "check-square",
	otherTask: "list-plus",
	log: "book-open",
};

export function nowHm(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "Today" under the day-rollover rule: before dayRolloverHour (default 4 AM)
 * the logical day is still yesterday, so late-night captures and the Today
 * scope stay on the evening's note.
 */
export function logicalTodayIso(settings: ShawnsToolboxSettings): string {
	return logicalDateIso(new Date(), settings.dayRolloverHour);
}

export function periodicNotePath(
	settings: ShawnsToolboxSettings,
	scope: NoteScope,
	dateIso?: string
): string {
	const m = moment(dateIso ?? logicalTodayIso(settings), "YYYY-MM-DD");
	return normalizePath(m.format(settings.periodicFormats[scope]) + ".md");
}

export function getPeriodicFile(
	app: App,
	settings: ShawnsToolboxSettings,
	scope: NoteScope
): TFile | null {
	const f = app.vault.getAbstractFileByPath(periodicNotePath(settings, scope));
	return f instanceof TFile ? f : null;
}

/**
 * The daily note for dateIso, created from the daily template (via the
 * create-daily-note renderer port) when it does not exist yet.
 */
export async function ensureDailyNote(
	app: App,
	settings: ShawnsToolboxSettings,
	dateIso: string
): Promise<TFile> {
	const path = periodicNotePath(settings, "day", dateIso);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return existing;

	const tv: TemplateVault = {
		read: async (p: string) => {
			const f = app.vault.getAbstractFileByPath(normalizePath(p));
			return f instanceof TFile ? await app.vault.cachedRead(f) : null;
		},
	};
	const content = await renderDailyNote(
		tv,
		{
			template: settings.dailyTemplatePath,
			templaterDir: settings.templaterFolder,
		},
		dateIso,
		nowHm()
	);
	if (content === null) {
		throw new Error(
			`Daily note template not found: ${settings.dailyTemplatePath}`
		);
	}
	const folder = path.split("/").slice(0, -1).join("/");
	if (folder && !app.vault.getAbstractFileByPath(folder)) {
		await app.vault.createFolder(folder);
	}
	return await app.vault.create(path, content);
}

/**
 * Append captured text to its target section in the daily note for dateIso
 * (default: today), creating that note from the template when missing.
 * Returns the section title for the receipt toast. Throws with a readable
 * message when there is nothing to capture — the caller must keep the
 * user's text on failure.
 */
export async function routeCapture(
	app: App,
	settings: ShawnsToolboxSettings,
	kind: CaptureKind,
	text: string,
	dateIso?: string
): Promise<string> {
	const trimmed = text.trim();
	if (!trimmed) throw new Error("Nothing to capture");
	const file = await ensureDailyNote(
		app,
		settings,
		dateIso ?? logicalTodayIso(settings)
	);
	const heading = settings.captureTargets[kind];
	const line = formatCaptureLine(kind, trimmed, nowHm());
	await app.vault.process(file, (content) =>
		appendToSection(content, heading, line)
	);
	return heading.replace(/^#+\s*/, "");
}
