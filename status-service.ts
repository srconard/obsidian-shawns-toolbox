// status-service.ts — Obsidian glue over status-core.
// Reads come from the metadata cache (cheap, no file I/O); writes go through
// processFrontMatter so Obsidian owns the YAML serialisation.
import type { App, TFile } from "obsidian";
import {
	normalizeTags,
	readPhase,
	readAllPhases,
	hasOngoing,
	setPhase,
	setOngoing,
	type Phase,
} from "./status-core";

export interface NoteStatus {
	phase: Phase | null;
	ongoing: boolean;
	changed: string | null;
	/** Every phase found — length > 1 means the note carries a conflict. */
	conflicts: Phase[];
}

export function todayIso(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function readStatus(app: App, file: TFile): NoteStatus {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
	const tags = normalizeTags(fm.tags);
	const changed = fm.status_changed;
	return {
		phase: readPhase(tags),
		ongoing: hasOngoing(tags),
		changed: typeof changed === "string" ? changed : null,
		conflicts: readAllPhases(tags),
	};
}

/**
 * Set the phase and stamp the date. Clearing the phase (null) counts as a
 * change and stamps too, so "when did this stop being active" stays answerable.
 */
export async function writePhase(
	app: App,
	file: TFile,
	phase: Phase | null
): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm) => {
		fm.tags = setPhase(normalizeTags(fm.tags), phase);
		fm.status_changed = todayIso();
	});
}

/**
 * Toggle ongoing. Deliberately does NOT touch status_changed — ongoing is a
 * standing character trait, not a phase, so it has no meaningful age.
 */
export async function writeOngoing(
	app: App,
	file: TFile,
	value: boolean
): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm) => {
		fm.tags = setOngoing(normalizeTags(fm.tags), value);
	});
}
