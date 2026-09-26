// thread-rename.ts — Obsidian glue for "Rename / move thread…" (v1.52.0). The
// pure parts (line rewriting, descendant mapping, prefix safety, merge
// detection, the undo inverse) live in thread-rename-core.ts.
//
// Flow: the modal takes a new path → plan (read every note the Threads panel
// scans, compute the edits, nothing written) → preview text → Rename writes
// each changed note in ONE vault.process → a Notice with Undo (10 s). The edit
// list of the last rename is kept so the command "Undo last thread rename"
// works afterwards too (until Obsidian reloads).
import { App, Modal, Notice, TFile } from "obsidian";
import type { ShawnsToolboxSettings } from "./settings";
import {
	collectThreadNames,
	countEdits,
	MERGE_WARNING,
	mergesIntoExisting,
	parseRenameInput,
	previewText,
	renameInAreasNote,
	renameInContent,
	renameNameList,
	undoInContent,
	type LineEdit,
	type RenameCounts,
} from "./thread-rename-core";

export interface RenameHost {
	app: App;
	getSettings: () => ShawnsToolboxSettings;
	saveSettings: () => Promise<void>;
	/** Whether a note is one the Threads panel reads (outside excluded folders). */
	isScannablePath: (path: string) => boolean;
}

interface RenamePlan {
	from: string;
	to: string;
	files: Array<{ file: TFile; edits: LineEdit[] }>;
	counts: RenameCounts;
	merges: boolean;
	/** The Thread Areas note lists a renamed thread. */
	areasChange: boolean;
}

/** Everything needed to reverse one rename exactly. */
export interface RenameRecord {
	from: string;
	to: string;
	files: Array<{ path: string; edits: LineEdit[] }>;
	/** The areas note is restored whole (bullets may have been removed). */
	areas: { path: string; before: string; after: string } | null;
	settingsBefore: { pinned: string[]; collapsed: string[] };
	settingsAfter: { pinned: string[]; collapsed: string[] };
}

let lastRename: RenameRecord | null = null;

/** The last rename that has not been undone, for the command palette. */
export function lastThreadRename(): RenameRecord | null {
	return lastRename;
}

function scopeFiles(host: RenameHost): TFile[] {
	const areasPath = host.getSettings().threadAreasNotePath;
	return host.app.vault
		.getMarkdownFiles()
		.filter((f) => f.path !== areasPath && host.isScannablePath(f.path));
}

/** Compute a rename without writing anything. */
export async function planThreadRename(host: RenameHost, from: string, to: string): Promise<RenamePlan> {
	const files: RenamePlan["files"] = [];
	const existing = new Set<string>();
	for (const file of scopeFiles(host)) {
		const content = await host.app.vault.cachedRead(file);
		if (content.indexOf("#thread/") < 0) continue;
		for (const n of collectThreadNames(content)) existing.add(n);
		const r = renameInContent(content, from, to);
		if (r.edits.length) files.push({ file, edits: r.edits });
	}
	let areasChange = false;
	const areasFile = host.app.vault.getAbstractFileByPath(host.getSettings().threadAreasNotePath);
	if (areasFile instanceof TFile) {
		const content = await host.app.vault.cachedRead(areasFile);
		const r = renameInContent(content, from, to);
		if (r.edits.length) files.push({ file: areasFile, edits: r.edits });
		for (const n of collectThreadNames(content)) existing.add(n);
		areasChange = renameInAreasNote(r.content, from, to) !== r.content;
	}
	return {
		from,
		to,
		files,
		counts: countEdits(files),
		merges: mergesIntoExisting(existing, from, to),
		areasChange,
	};
}

/**
 * Apply a planned rename. Each note is re-read inside its vault.process so the
 * edits are computed on the note's current text (not the preview's snapshot).
 * The Thread Areas note is handled in the same single write as its own tags.
 */
export async function applyThreadRename(host: RenameHost, plan: RenamePlan): Promise<RenameRecord> {
	const { from, to } = plan;
	const settings = host.getSettings();
	const record: RenameRecord = {
		from,
		to,
		files: [],
		areas: null,
		settingsBefore: {
			pinned: [...(settings.pinnedThreads ?? [])],
			collapsed: [...(settings.threadTreeCollapsed ?? [])],
		},
		settingsAfter: { pinned: [], collapsed: [] },
	};
	const areasPath = settings.threadAreasNotePath;
	for (const { file } of plan.files) {
		if (file.path === areasPath) continue;
		await host.app.vault.process(file, (content) => {
			const r = renameInContent(content, from, to);
			if (r.edits.length) record.files.push({ path: file.path, edits: r.edits });
			return r.content;
		});
	}
	const areasFile = host.app.vault.getAbstractFileByPath(areasPath);
	if (areasFile instanceof TFile && (plan.areasChange || plan.files.some((f) => f.file === areasFile))) {
		await host.app.vault.process(areasFile, (content) => {
			const after = renameInAreasNote(renameInContent(content, from, to).content, from, to);
			if (after !== content) record.areas = { path: areasFile.path, before: content, after };
			return after;
		});
	}
	settings.pinnedThreads = renameNameList(settings.pinnedThreads ?? [], from, to);
	settings.threadTreeCollapsed = renameNameList(settings.threadTreeCollapsed ?? [], from, to);
	record.settingsAfter = {
		pinned: [...settings.pinnedThreads],
		collapsed: [...settings.threadTreeCollapsed],
	};
	await host.saveSettings();
	lastRename = record;
	return record;
}

const sameList = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Reverse a rename's exact edits. Lines edited again since are left alone and
 * reported, never overwritten. Returns how many lines were restored/missed.
 */
export async function undoThreadRename(
	host: RenameHost,
	record: RenameRecord
): Promise<{ restored: number; missed: number }> {
	let restored = 0;
	let missed = 0;
	for (const f of record.files) {
		const file = host.app.vault.getAbstractFileByPath(f.path);
		if (!(file instanceof TFile)) {
			missed += f.edits.length;
			continue;
		}
		await host.app.vault.process(file, (content) => {
			const r = undoInContent(content, f.edits);
			restored += r.restored;
			missed += r.missed;
			return r.content;
		});
	}
	if (record.areas) {
		const a = record.areas;
		const file = host.app.vault.getAbstractFileByPath(a.path);
		if (file instanceof TFile) {
			await host.app.vault.process(file, (content) => {
				if (content !== a.after) {
					missed++;
					return content;
				}
				return a.before;
			});
		} else missed++;
	}
	const settings = host.getSettings();
	if (sameList(settings.pinnedThreads ?? [], record.settingsAfter.pinned))
		settings.pinnedThreads = [...record.settingsBefore.pinned];
	if (sameList(settings.threadTreeCollapsed ?? [], record.settingsAfter.collapsed))
		settings.threadTreeCollapsed = [...record.settingsBefore.collapsed];
	await host.saveSettings();
	if (lastRename === record) lastRename = null;
	return { restored, missed };
}

/** Run an undo and report it. */
export async function undoWithNotice(
	host: RenameHost,
	record: RenameRecord,
	onUndone?: () => void
): Promise<void> {
	try {
		const { restored, missed } = await undoThreadRename(host, record);
		let msg = `Undid rename: #thread/${record.to} → #thread/${record.from} (${restored} ${restored === 1 ? "line" : "lines"})`;
		if (missed) msg += ` — ${missed} changed since and left alone`;
		new Notice(msg);
		onUndone?.();
	} catch (e) {
		new Notice(`Undo failed: ${(e as Error).message}`);
	}
}

/**
 * The whole interaction: modal → preview → confirm → apply → Notice with Undo.
 * `onRenamed` / `onUndone` let the panel follow the thread it is showing.
 */
export function openRenameThread(
	host: RenameHost,
	current: string,
	hooks: { onRenamed?: (r: RenameRecord) => void; onUndone?: (r: RenameRecord) => void } = {}
): void {
	new RenameThreadModal(host, current, async (plan) => {
		try {
			const record = await applyThreadRename(host, plan);
			const lines = record.files.reduce((n, f) => n + f.edits.length, 0);
			hooks.onRenamed?.(record);
			showUndoNotice(host, record, lines, () => hooks.onUndone?.(record));
		} catch (e) {
			new Notice(`Rename failed: ${(e as Error).message}`);
		}
	}).open();
}

const UNDO_NOTICE_MS = 10_000;

function showUndoNotice(host: RenameHost, record: RenameRecord, lines: number, onUndone: () => void): void {
	const frag = document.createDocumentFragment();
	const text = document.createElement("span");
	text.textContent = `Renamed #thread/${record.from} → #thread/${record.to} (${lines} ${lines === 1 ? "line" : "lines"}). `;
	frag.appendChild(text);
	const btn = document.createElement("button");
	btn.className = "stx-rename-undo";
	btn.textContent = "Undo";
	frag.appendChild(btn);
	const notice = new Notice(frag, UNDO_NOTICE_MS);
	let done = false;
	btn.addEventListener("click", (e) => {
		e.stopPropagation(); // a click on a Notice also dismisses it
		if (done) return;
		done = true;
		notice.hide();
		void undoWithNotice(host, record, onUndone);
	});
}

/** Two steps in one modal: edit the path, then preview and confirm. */
class RenameThreadModal extends Modal {
	private busy = false;

	constructor(
		private host: RenameHost,
		private current: string,
		private onConfirm: (plan: RenamePlan) => Promise<void>
	) {
		super(host.app);
	}

	onOpen(): void {
		this.showEdit(`thread/${this.current}`);
	}

	private showEdit(value: string): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("stx-new-thread");
		contentEl.createEl("h3", { text: "Rename / move thread" });
		contentEl.createEl("p", {
			cls: "stx-replies-detail",
			text: "Edit the path — child threads move with it. Use / to nest (thread/flow/dance).",
		});
		const input = contentEl.createEl("input", {
			cls: "stx-new-thread-input",
			attr: { type: "text", autocapitalize: "off", autocorrect: "off", spellcheck: "false" },
		});
		input.value = value;
		const error = contentEl.createEl("p", { cls: "stx-rename-error" });
		const row = contentEl.createDiv({ cls: "stx-thread-reply-row" });
		const next = row.createEl("button", { cls: "mod-cta", text: "Preview" });
		const cancel = row.createEl("button", { text: "Cancel" });
		const validate = () => {
			const r = parseRenameInput(input.value, this.current);
			// Say what's wrong once there is a change to judge.
			error.setText(!r.ok && input.value.trim() !== value ? r.error : "");
			next.disabled = !r.ok;
			return r;
		};
		const go = () => {
			const r = validate();
			if (!r.ok) {
				error.setText(r.error);
				return;
			}
			void this.showPreview(r.path, input.value);
		};
		input.addEventListener("input", validate);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				go();
			}
		});
		next.addEventListener("click", go);
		cancel.addEventListener("click", () => this.close());
		validate();
		window.setTimeout(() => {
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
		}, 0);
	}

	private async showPreview(to: string, typed: string): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Rename / move thread" });
		const status = contentEl.createEl("p", { text: "Counting…" });
		let plan: RenamePlan;
		try {
			plan = await planThreadRename(this.host, this.current, to);
		} catch (e) {
			status.setText(`Could not scan the vault: ${(e as Error).message}`);
			return;
		}
		status.setText(previewText(plan.from, plan.to, plan.counts));
		if (plan.merges) contentEl.createEl("p", { cls: "stx-rename-warning", text: MERGE_WARNING });
		if (plan.areasChange)
			contentEl.createEl("p", {
				cls: "stx-replies-detail",
				text: "The Thread Areas note is updated too.",
			});
		contentEl.createEl("p", {
			cls: "stx-replies-detail",
			text: "Only the tag changes — text, times, block ids and reply links stay. AGENTS/ and other folders the Threads panel skips are not touched.",
		});
		const row = contentEl.createDiv({ cls: "stx-thread-reply-row" });
		const nothing = plan.counts.lines === 0 && !plan.areasChange;
		const confirm = row.createEl("button", { cls: "mod-cta", text: "Rename" });
		confirm.disabled = nothing;
		const back = row.createEl("button", { text: "Back" });
		const cancel = row.createEl("button", { text: "Cancel" });
		confirm.addEventListener("click", () => {
			if (this.busy || nothing) return;
			this.busy = true;
			this.close();
			void this.onConfirm(plan);
		});
		back.addEventListener("click", () => this.showEdit(typed));
		cancel.addEventListener("click", () => this.close());
		window.setTimeout(() => (nothing ? back : confirm).focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
