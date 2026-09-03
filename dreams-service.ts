// dreams-service.ts — Obsidian glue over dreams-core. Enumerates the dream days
// (agent daily notes with a `## Dreams` lane + legacy standalone digests), reads
// and counts their connections, flips the `dreams_reviewed` frontmatter flag, and
// toggles a connection's keep checkbox. A per-file mtime cache keeps the
// day-list scan cheap: unchanged notes are never re-parsed.
import { App, TFile, normalizePath } from "obsidian";
import type { ShawnsToolboxSettings } from "./settings";
import {
	extractDreamsRegion,
	parseDreams,
	countDreams,
	toggleKeep,
	setConnectionNote,
	type DreamConnection,
	type DreamCounts,
} from "./dreams-core";
import { todayIso } from "./status-service";

const AGENT_RE = /^\d{4}-\d{2}-\d{2}-AGENT$/;
const LEGACY_RE = /^\d{4}-\d{2}-\d{2}-dreaming$/;

export interface DreamDay {
	dateIso: string;
	path: string;
	isAgent: boolean;
	counts: DreamCounts;
	reviewed: boolean;
}

export interface DreamDayDetail extends DreamDay {
	connections: DreamConnection[];
}

/** A kept/applied connection with the day it lives on (for the cross-day view). */
export interface KeptConnection {
	dateIso: string;
	path: string;
	connection: DreamConnection;
}

interface CacheEntry {
	mtime: number;
	connections: DreamConnection[];
}

export class DreamsService {
	private cache = new Map<string, CacheEntry>();

	constructor(
		private app: App,
		private getSettings: () => ShawnsToolboxSettings
	) {}

	agentFolder(): string {
		return normalizePath(this.getSettings().dreamsAgentNotesFolder);
	}

	legacyFolder(): string {
		return normalizePath(this.getSettings().dreamsLegacyFolder);
	}

	/** True for a path under either dreams folder — used to gate live refreshes. */
	watches(path: string): boolean {
		const p = normalizePath(path);
		return (
			p.startsWith(this.agentFolder() + "/") ||
			p.startsWith(this.legacyFolder() + "/")
		);
	}

	private dreamFiles(): TFile[] {
		const agent = this.agentFolder() + "/";
		const legacy = this.legacyFolder() + "/";
		return this.app.vault.getMarkdownFiles().filter((f) => {
			if (f.path.startsWith(agent)) return AGENT_RE.test(f.basename);
			if (f.path.startsWith(legacy)) return LEGACY_RE.test(f.basename);
			return false;
		});
	}

	private async connectionsFor(f: TFile): Promise<DreamConnection[]> {
		const cached = this.cache.get(f.path);
		if (cached && cached.mtime === f.stat.mtime) return cached.connections;
		const content = await this.app.vault.cachedRead(f);
		const isAgent = f.basename.endsWith("-AGENT");
		const region = extractDreamsRegion(content, isAgent);
		const connections = region === null ? [] : parseDreams(region);
		this.cache.set(f.path, { mtime: f.stat.mtime, connections });
		return connections;
	}

	private reviewed(f: TFile): boolean {
		const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
		return fm?.dreams_reviewed === true;
	}

	/** Every dream day with counts + reviewed flag, newest first. */
	async listDays(): Promise<DreamDay[]> {
		const out: DreamDay[] = [];
		for (const f of this.dreamFiles()) {
			const connections = await this.connectionsFor(f);
			const counts = countDreams(connections);
			if (counts.connections === 0) continue; // empty / no lane
			out.push({
				dateIso: f.basename.slice(0, 10),
				path: f.path,
				isAgent: f.basename.endsWith("-AGENT"),
				counts,
				reviewed: this.reviewed(f),
			});
		}
		out.sort((a, b) => (a.dateIso < b.dateIso ? 1 : a.dateIso > b.dateIso ? -1 : 0));
		return out;
	}

	async dayDetail(path: string): Promise<DreamDayDetail | null> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) return null;
		const connections = await this.connectionsFor(f);
		return {
			dateIso: f.basename.slice(0, 10),
			path: f.path,
			isAgent: f.basename.endsWith("-AGENT"),
			counts: countDreams(connections),
			reviewed: this.reviewed(f),
			connections,
		};
	}

	/** All kept/applied connections across every day, newest day first. */
	async keptConnections(): Promise<KeptConnection[]> {
		const out: KeptConnection[] = [];
		for (const f of this.dreamFiles()) {
			const connections = await this.connectionsFor(f);
			const dateIso = f.basename.slice(0, 10);
			for (const c of connections) {
				if (c.isHighSignal) continue;
				if (c.keep === "kept" || c.keep === "applied") {
					out.push({ dateIso, path: f.path, connection: c });
				}
			}
		}
		out.sort((a, b) => (a.dateIso < b.dateIso ? 1 : a.dateIso > b.dateIso ? -1 : 0));
		return out;
	}

	/** Toggle a connection's keep checkbox (plain ⇄ `- [ ]`; applied is read-only). */
	async toggleKeep(path: string, pairBody: string): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) throw new Error(`Note not found: ${path}`);
		await this.app.vault.process(f, (content) => toggleKeep(content, pairBody));
		this.cache.delete(path);
	}

	/**
	 * Write (or replace / delete) Shawn's context note for a connection, touching
	 * only the `- 💭 …` child line under its pair line. Empty text deletes it.
	 */
	async setNote(path: string, pairBody: string, text: string): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) throw new Error(`Note not found: ${path}`);
		const date = todayIso();
		await this.app.vault.process(f, (content) =>
			setConnectionNote(content, pairBody, text, date)
		);
		this.cache.delete(path);
	}

	/** Set (or clear) the day's `dreams_reviewed` frontmatter flag atomically. */
	async setReviewed(path: string, reviewed: boolean): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) throw new Error(`Note not found: ${path}`);
		await this.app.fileManager.processFrontMatter(f, (fm) => {
			fm.dreams_reviewed = reviewed;
		});
	}

	invalidate(path: string): void {
		this.cache.delete(path);
	}
}
