// thread-service.ts — Obsidian glue over thread-core. Scans the timeline
// folder for #thread posts (with a per-file mtime cache so a rescan only
// re-reads changed notes), appends block ids to parent lines lazily, and
// writes replies into today's daily note.
import { App, TAbstractFile, TFile, moment } from "obsidian";
import type { ShawnsToolboxSettings } from "./settings";
import {
	logicalTodayIso,
	nowHm,
	periodicNotePath,
	ensureDailyNote,
} from "./capture-service";
import { appendToSection } from "./section-core";
import {
	parseNotePosts,
	ensureBlockId,
	generateBlockId,
	formatReplyLine,
	type ThreadPost,
} from "./thread-core";

const DAILY_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ThreadService {
	private cache = new Map<string, { mtime: number; posts: ThreadPost[] }>();

	constructor(
		private app: App,
		private getSettings: () => ShawnsToolboxSettings
	) {}

	/** "00. Timeline" (no trailing slash), derived from the day format. */
	timelineFolder(): string {
		const dayPath = periodicNotePath(this.getSettings(), "day");
		const slash = dayPath.lastIndexOf("/");
		return slash >= 0 ? dayPath.slice(0, slash) : "";
	}

	private prefix(): string {
		const f = this.timelineFolder();
		return f ? f + "/" : "";
	}

	isTimelineFile(file: TAbstractFile): boolean {
		return (
			file instanceof TFile &&
			file.extension === "md" &&
			file.path.startsWith(this.prefix())
		);
	}

	invalidate(path: string): void {
		this.cache.delete(path);
	}

	private noteDate(file: TFile): string {
		return DAILY_RE.test(file.basename)
			? file.basename
			: moment(file.stat.mtime).format("YYYY-MM-DD");
	}

	private noteFile(basename: string): TFile | null {
		const path = this.prefix() + basename + ".md";
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}

	/** Scan every timeline note for posts, reusing the cache where mtime holds. */
	async scan(): Promise<ThreadPost[]> {
		const prefix = this.prefix();
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(prefix));
		const live = new Set(files.map((f) => f.path));
		for (const path of [...this.cache.keys()]) {
			if (!live.has(path)) this.cache.delete(path);
		}
		const all: ThreadPost[] = [];
		for (const f of files) {
			const cached = this.cache.get(f.path);
			if (cached && cached.mtime === f.stat.mtime) {
				all.push(...cached.posts);
				continue;
			}
			const content = await this.app.vault.cachedRead(f);
			const posts = parseNotePosts(f.basename, this.noteDate(f), content);
			this.cache.set(f.path, { mtime: f.stat.mtime, posts });
			all.push(...posts);
		}
		return all;
	}

	/**
	 * Ensure the parent post's line carries a block id, appending one (lazily)
	 * if missing. Returns the id. Locates the line by number, falling back to a
	 * content match so an edit that shifted lines since the scan still works.
	 */
	async ensureParentBlockId(post: ThreadPost): Promise<string> {
		if (post.blockId) return post.blockId;
		const file = this.noteFile(post.note);
		if (!file) throw new Error(`Parent note not found: ${post.note}`);
		let assigned = generateBlockId();
		await this.app.vault.process(file, (content) => {
			const lines = content.split("\n");
			const idx = this.locateLine(lines, post);
			if (idx < 0) throw new Error("Could not find the post to reply to");
			const res = ensureBlockId(lines[idx], assigned);
			assigned = res.id;
			if (res.changed) lines[idx] = res.line;
			return lines.join("\n");
		});
		return assigned;
	}

	private locateLine(lines: string[], post: ThreadPost): number {
		const strip = (l: string) => (l.endsWith("\r") ? l.slice(0, -1) : l);
		if (strip(lines[post.line] ?? "") === post.raw) return post.line;
		return lines.findIndex((l) => strip(l) === post.raw);
	}

	/**
	 * Append a reply to today's daily note under the Thought heading, after
	 * ensuring the parent has a block id. Today's note is created from the
	 * template when missing (the plugin's standing auto-create behaviour).
	 * Returns the parent block id used.
	 */
	async appendReply(post: ThreadPost, replyText: string): Promise<string> {
		const text = replyText.trim();
		if (!text) throw new Error("Nothing to reply with");
		const settings = this.getSettings();
		const parentId = await this.ensureParentBlockId(post);
		const file = await ensureDailyNote(
			this.app,
			settings,
			logicalTodayIso(settings)
		);
		const line = formatReplyLine(
			nowHm(),
			text,
			post.thread,
			post.note,
			parentId
		);
		await this.app.vault.process(file, (content) =>
			appendToSection(content, settings.captureTargets.thought, line)
		);
		this.invalidate(file.path);
		this.invalidate(this.noteFile(post.note)?.path ?? "");
		return parentId;
	}

	/** Open a post's source note and put the cursor on its line. */
	async openPost(post: ThreadPost): Promise<void> {
		const file = this.noteFile(post.note);
		if (!file) throw new Error(`Note not found: ${post.note}`);
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file, { eState: { line: post.line } });
	}
}
