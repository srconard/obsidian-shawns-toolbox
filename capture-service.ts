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

export function periodicNotePath(
	settings: ShawnsToolboxSettings,
	scope: NoteScope
): string {
	return normalizePath(
		moment().format(settings.periodicFormats[scope]) + ".md"
	);
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
 * Append captured text to its target section in today's daily note.
 * Returns the section title for the receipt toast. Throws with a readable
 * message when there is nothing to capture or no daily note — the caller
 * must keep the user's text on failure.
 */
export async function routeCapture(
	app: App,
	settings: ShawnsToolboxSettings,
	kind: CaptureKind,
	text: string
): Promise<string> {
	const trimmed = text.trim();
	if (!trimmed) throw new Error("Nothing to capture");
	const file = getPeriodicFile(app, settings, "day");
	if (!file) {
		throw new Error(
			`No daily note at ${periodicNotePath(settings, "day")}`
		);
	}
	const heading = settings.captureTargets[kind];
	const line = formatCaptureLine(kind, trimmed, nowHm());
	await app.vault.process(file, (content) =>
		appendToSection(content, heading, line)
	);
	return heading.replace(/^#+\s*/, "");
}
