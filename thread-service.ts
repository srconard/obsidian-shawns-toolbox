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
	parsePeriodicPosts,
	parseThoughtPosts,
	ensureBlockId,
	generateBlockId,
	formatReplyLine,
	appendTag,
	type ThreadPost,
	type PeriodicPost,
	type ThoughtPost,
} from "./thread-core";
import { parseThreadAreas, type ThreadArea } from "./thread-areas";

const DAILY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Folders whose notes are never scanned when no setting is configured. */
export const DEFAULT_THREAD_EXCLUDES = ["AGENTS", "Settings"];

export class ThreadService {
	private cache = new Map<
		string,
		{ mtime: number; posts: ThreadPost[]; periodic: PeriodicPost[] }
	>();

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

	/** Folder prefixes excluded from the scan (path segments, no trailing /). */
	private excludes(): string[] {
		const configured = this.getSettings().threadScanExcludeFolders;
		return configured && configured.length ? configured : DEFAULT_THREAD_EXCLUDES;
	}

	/** A markdown path is scannable unless it sits in an excluded folder. */
	isScannablePath(path: string): boolean {
		if (!path.endsWith(".md")) return false;
		return this.excludes().every(
			(dir) => path !== dir && !path.startsWith(dir + "/")
		);
	}

	isScannableFile(file: TAbstractFile): boolean {
		return file instanceof TFile && this.isScannablePath(file.path);
	}

	invalidate(path: string): void {
		this.cache.delete(path);
	}

	private noteDate(file: TFile): string {
		return DAILY_RE.test(file.basename)
			? file.basename
			: moment(file.stat.mtime).format("YYYY-MM-DD");
	}

	/** Resolve a post's source file: by its full path first (posts now come from
	 *  any folder), falling back to the legacy timeline-basename lookup. */
	private resolveFile(post: { path?: string; note: string }): TFile | null {
		if (post.path) {
			const f = this.app.vault.getAbstractFileByPath(post.path);
			if (f instanceof TFile) return f;
		}
		const legacy = this.prefix() + post.note + ".md";
		const f = this.app.vault.getAbstractFileByPath(legacy);
		return f instanceof TFile ? f : null;
	}

	/**
	 * Scan every scannable note (all markdown outside the excluded folders) for
	 * #thread posts and #thought/<period> posts in one pass, reusing the cache
	 * where mtime holds so a rescan only re-reads changed notes. Reading content
	 * is required (the parser needs line numbers, raw lines, and trailing block
	 * ids for edits), but the per-file mtime cache keeps a widened, whole-vault
	 * scan cheap: unchanged files are never re-read.
	 */
	async scanAll(): Promise<{ posts: ThreadPost[]; periodic: PeriodicPost[] }> {
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) => this.isScannablePath(f.path));
		const live = new Set(files.map((f) => f.path));
		for (const path of [...this.cache.keys()]) {
			if (!live.has(path)) this.cache.delete(path);
		}
		const posts: ThreadPost[] = [];
		const periodic: PeriodicPost[] = [];
		for (const f of files) {
			const cached = this.cache.get(f.path);
			if (cached && cached.mtime === f.stat.mtime) {
				posts.push(...cached.posts);
				periodic.push(...cached.periodic);
				continue;
			}
			const date = this.noteDate(f);
			const content = await this.app.vault.cachedRead(f);
			const p = parseNotePosts(f.basename, date, content, f.path);
			const pp = parsePeriodicPosts(f.basename, date, content, f.path);
			this.cache.set(f.path, { mtime: f.stat.mtime, posts: p, periodic: pp });
			posts.push(...p);
			periodic.push(...pp);
		}
		return { posts, periodic };
	}

	/**
	 * Every top-level thought line under today's daily note's # Thoughts section
	 * (tagged or not), for the "Today's thoughts" view — Shawn's capture→process
	 * bridge (record a thought, open this, tag it into a thread). Returns [] when
	 * today's note doesn't exist yet. Read fresh each call (a single note, cheap;
	 * the vault modify events already drive a refresh so the list stays live).
	 */
	async todayThoughtPosts(): Promise<ThoughtPost[]> {
		const settings = this.getSettings();
		const path = periodicNotePath(settings, "day", logicalTodayIso(settings));
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) return [];
		const content = await this.app.vault.cachedRead(f);
		return parseThoughtPosts(
			f.basename,
			this.noteDate(f),
			content,
			settings.captureTargets.thought,
			f.path
		);
	}

	/**
	 * Parse the thread-areas mapping note into ordered areas, read fresh each
	 * call (a single note, cheap). Returns [] when the note doesn't exist yet, so
	 * the list falls back to a flat, un-grouped view.
	 */
	async loadThreadAreas(): Promise<ThreadArea[]> {
		const path = this.getSettings().threadAreasNotePath;
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) return [];
		return parseThreadAreas(await this.app.vault.cachedRead(f));
	}

	/**
	 * Ensure the parent post's line carries a block id, appending one (lazily)
	 * if missing. Returns the id. Locates the line by number, falling back to a
	 * content match so an edit that shifted lines since the scan still works.
	 */
	async ensureParentBlockId(post: ThreadPost): Promise<string> {
		if (post.blockId) return post.blockId;
		const file = this.resolveFile(post);
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

	private locateLine(lines: string[], post: { line: number; raw: string }): number {
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
		this.invalidate(this.resolveFile(post)?.path ?? "");
		return parentId;
	}

	/**
	 * Append a tag (another #thread/<name> or a #thought/<period>) to a post's
	 * source line in its daily note, single-space separated and otherwise
	 * verbatim. No-op when the exact tag is already there. Locates the line by
	 * number with a content-match fallback (same as ensureParentBlockId), so an
	 * edit since the scan still resolves. Returns whether the line changed.
	 */
	async appendTagToPost(
		post: { path?: string; note: string; line: number; raw: string },
		tag: string
	): Promise<boolean> {
		const file = this.resolveFile(post);
		if (!file) throw new Error(`Note not found: ${post.note}`);
		let changed = false;
		await this.app.vault.process(file, (content) => {
			const lines = content.split("\n");
			const idx = this.locateLine(lines, post);
			if (idx < 0) throw new Error("Could not find the post line");
			const updated = appendTag(lines[idx], tag);
			if (updated !== lines[idx]) {
				lines[idx] = updated;
				changed = true;
			}
			return lines.join("\n");
		});
		this.invalidate(file.path);
		return changed;
	}

	/** Open a post's source note and put the cursor on its line. */
	async openPost(post: { path?: string; note: string; line: number }): Promise<void> {
		const file = this.resolveFile(post);
		if (!file) throw new Error(`Note not found: ${post.note}`);
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file, { eState: { line: post.line } });
	}
}
