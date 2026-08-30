// highlights-service.ts — Obsidian glue over highlights-core. Reads and writes
// `highlights::` fields in daily notes, and scans the timeline folder for range
// views ("this week/month", custom range) and the "on this day" retrospective.
// A per-file mtime cache keeps the whole-folder scan cheap: unchanged notes are
// never re-read.
import { App, TFile } from "obsidian";
import type { ShawnsToolboxSettings } from "./settings";
import {
	periodicNotePath,
	ensureDailyNote,
	logicalTodayIso,
} from "./capture-service";
import {
	parseHighlights,
	addHighlight,
	editHighlight,
	deleteHighlight,
	type Highlight,
} from "./highlights-core";

const DAILY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DayHighlights {
	dateIso: string;
	highlights: Highlight[];
}

export class HighlightsService {
	private cache = new Map<string, { mtime: number; texts: string[] }>();

	constructor(
		private app: App,
		private getSettings: () => ShawnsToolboxSettings
	) {}

	todayIso(): string {
		return logicalTodayIso(this.getSettings());
	}

	/** "00. Timeline" (no trailing slash), derived from the day format. */
	timelineFolder(): string {
		const dayPath = periodicNotePath(this.getSettings(), "day");
		const slash = dayPath.lastIndexOf("/");
		return slash >= 0 ? dayPath.slice(0, slash) : "";
	}

	private dailyFile(dateIso: string): TFile | null {
		const path = periodicNotePath(this.getSettings(), "day", dateIso);
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}

	invalidate(dateIso: string): void {
		this.cache.delete(
			periodicNotePath(this.getSettings(), "day", dateIso)
		);
	}

	/** Highlights recorded on dateIso, or [] when the note is missing. */
	async readDay(dateIso: string): Promise<Highlight[]> {
		const f = this.dailyFile(dateIso);
		if (!f) return [];
		const content = await this.app.vault.cachedRead(f);
		return parseHighlights(content);
	}

	/** Add a highlight to dateIso's note, creating the note from template first. */
	async addToDay(dateIso: string, text: string): Promise<void> {
		if (!text.trim()) throw new Error("Nothing to add");
		const file = await ensureDailyNote(this.app, this.getSettings(), dateIso);
		await this.app.vault.process(file, (content) =>
			addHighlight(content, text)
		);
		this.cache.delete(file.path);
	}

	async editInDay(
		dateIso: string,
		oldText: string,
		newText: string
	): Promise<void> {
		const file = this.dailyFile(dateIso);
		if (!file) throw new Error(`Daily note not found for ${dateIso}`);
		await this.app.vault.process(file, (content) =>
			editHighlight(content, oldText, newText)
		);
		this.cache.delete(file.path);
	}

	async deleteFromDay(dateIso: string, oldText: string): Promise<void> {
		const file = this.dailyFile(dateIso);
		if (!file) throw new Error(`Daily note not found for ${dateIso}`);
		await this.app.vault.process(file, (content) =>
			deleteHighlight(content, oldText)
		);
		this.cache.delete(file.path);
	}

	/** Timeline daily notes (basename YYYY-MM-DD) with cached highlight text. */
	private dailyNotes(): TFile[] {
		const folder = this.timelineFolder();
		const prefix = folder ? folder + "/" : "";
		return this.app.vault
			.getMarkdownFiles()
			.filter(
				(f) =>
					DAILY_RE.test(f.basename) &&
					(prefix === "" || f.path.startsWith(prefix))
			);
	}

	private async textsFor(f: TFile): Promise<string[]> {
		const cached = this.cache.get(f.path);
		if (cached && cached.mtime === f.stat.mtime) return cached.texts;
		const content = await this.app.vault.cachedRead(f);
		const texts = parseHighlights(content).map((h) => h.text);
		this.cache.set(f.path, { mtime: f.stat.mtime, texts });
		return texts;
	}

	/**
	 * All highlights across daily notes whose date is in [startIso, endIso]
	 * inclusive, newest day first. Uses the mtime cache so repeated range views
	 * only re-read changed notes.
	 */
	async scanRange(startIso: string, endIso: string): Promise<DayHighlights[]> {
		const lo = startIso <= endIso ? startIso : endIso;
		const hi = startIso <= endIso ? endIso : startIso;
		const files = this.dailyNotes().filter(
			(f) => f.basename >= lo && f.basename <= hi
		);
		const out: DayHighlights[] = [];
		for (const f of files) {
			const texts = await this.textsFor(f);
			if (texts.length === 0) continue;
			out.push({
				dateIso: f.basename,
				highlights: texts.map((text, i) => ({ text, line: i })),
			});
		}
		out.sort((a, b) => (a.dateIso < b.dateIso ? 1 : -1));
		return out;
	}

	/**
	 * Highlights from other years' notes sharing dateIso's calendar month/day
	 * (the "on this day" retrospective), newest year first. The given year is
	 * excluded so it doesn't duplicate the main view.
	 */
	async onThisDay(dateIso: string): Promise<DayHighlights[]> {
		const md = dateIso.slice(5); // "MM-DD"
		const files = this.dailyNotes().filter(
			(f) => f.basename.slice(5) === md && f.basename !== dateIso
		);
		const out: DayHighlights[] = [];
		for (const f of files) {
			const texts = await this.textsFor(f);
			if (texts.length === 0) continue;
			out.push({
				dateIso: f.basename,
				highlights: texts.map((text, i) => ({ text, line: i })),
			});
		}
		out.sort((a, b) => (a.dateIso < b.dateIso ? 1 : -1));
		return out;
	}
}
