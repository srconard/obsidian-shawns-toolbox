// section-cards.ts — the shared "pick sections, see/edit only them" component
// used by the capture view's Sections mode and the left Focus panel.
//
// Every write is targeted through section-core's replaceSection against a
// fresh read (vault.process), so two cards — or an external editor — never
// clobber each other's sections. Reconciliation rule: a card the user is
// actively typing in wins its own section; unfocused cards follow the file.

import {
	App,
	Component,
	MarkdownRenderer,
	Notice,
	TFile,
	setIcon,
} from "obsidian";
import {
	parseSections,
	sliceSection,
	replaceSection,
	type Section,
} from "./section-core";
import {
	SCOPE_LABELS,
	logicalTodayIso,
	periodicNotePath,
	type NoteScope,
} from "./capture-service";
import { stepAnchorIso, formatDateLabel } from "./date-nav";
import { EmbeddedMarkdownEditor, type LineOp } from "./embedded-editor";
import type { ShawnsToolboxSettings } from "./settings";

export interface CardsHost {
	app: App;
	getSettings: () => ShawnsToolboxSettings;
	saveSettings: () => Promise<void>;
}

const WRITE_DEBOUNCE_MS = 800;
const CHECKBOX_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/;

interface Card {
	spec: string;
	lastSlice: string;
	editor: EmbeddedMarkdownEditor | null;
	renderEl: HTMLElement | null;
	timer: number | null;
}

export class SectionCards extends Component {
	private scope: NoteScope;
	private cards: Card[] = [];
	private cardsEl: HTMLElement | null = null;
	/** Date the view is anchored on; null = follow (logical) today. */
	private anchorIso: string | null = null;

	constructor(
		private host: CardsHost,
		private containerEl: HTMLElement,
		private surface: "main" | "focus"
	) {
		super();
		this.scope =
			surface === "focus" ? host.getSettings().focusScope : "day";
	}

	onload(): void {
		this.registerEvent(
			this.host.app.vault.on("modify", (f) => {
				if (f.path === this.notePath()) void this.reconcile();
			})
		);
		this.registerEvent(
			this.host.app.vault.on("create", (f) => {
				if (f.path === this.notePath()) void this.rebuild();
			})
		);
		void this.rebuild();
	}

	onunload(): void {
		this.teardownCards();
	}

	// ---- state helpers ----

	private resolvedIso(): string {
		return this.anchorIso ?? logicalTodayIso(this.host.getSettings());
	}

	private notePath(): string {
		return periodicNotePath(
			this.host.getSettings(),
			this.scope,
			this.anchorIso ?? undefined
		);
	}

	private noteFile(): TFile | null {
		const f = this.host.app.vault.getAbstractFileByPath(this.notePath());
		return f instanceof TFile ? f : null;
	}

	private selection(): string[] {
		const s = this.host.getSettings();
		const map =
			this.surface === "focus"
				? s.focusSectionSelections
				: s.sectionSelections;
		return map[this.scope] ?? [];
	}

	private async setSelection(specs: string[]): Promise<void> {
		const s = this.host.getSettings();
		const map =
			this.surface === "focus"
				? s.focusSectionSelections
				: s.sectionSelections;
		map[this.scope] = specs;
		await this.host.saveSettings();
	}

	private readingMode(): boolean {
		const s = this.host.getSettings();
		return this.surface === "focus"
			? s.focusReadingMode
			: s.sectionsReadingMode;
	}

	private async setReadingMode(v: boolean): Promise<void> {
		const s = this.host.getSettings();
		if (this.surface === "focus") s.focusReadingMode = v;
		else s.sectionsReadingMode = v;
		await this.host.saveSettings();
	}

	private chipsCollapsed(): boolean {
		const s = this.host.getSettings();
		return this.surface === "focus"
			? s.focusChipsCollapsed
			: s.sectionsChipsCollapsed;
	}

	private async setChipsCollapsed(v: boolean): Promise<void> {
		const s = this.host.getSettings();
		if (this.surface === "focus") s.focusChipsCollapsed = v;
		else s.sectionsChipsCollapsed = v;
		await this.host.saveSettings();
	}

	// ---- UI ----

	async rebuild(): Promise<void> {
		this.teardownCards();
		this.containerEl.empty();
		this.containerEl.addClass("stx-section-cards");

		const toolbar = this.containerEl.createDiv("stx-cards-toolbar");
		const collapsed = this.chipsCollapsed();
		const chipsToggle = toolbar.createEl("button", {
			cls: "stx-chips-toggle",
			attr: { "aria-label": "Show/hide section buttons" },
		});
		setIcon(chipsToggle, collapsed ? "chevron-right" : "chevron-down");
		chipsToggle.addEventListener("click", async () => {
			await this.setChipsCollapsed(!this.chipsCollapsed());
			void this.rebuild();
		});
		const scopeRow = toolbar.createDiv("stx-scope-row");
		for (const scope of [
			"day",
			"week",
			"month",
			"quarter",
			"year",
		] as NoteScope[]) {
			const btn = scopeRow.createEl("button", {
				cls: "stx-scope-btn" + (scope === this.scope ? " is-active" : ""),
				text: SCOPE_LABELS[scope],
			});
			btn.addEventListener("click", () => {
				this.scope = scope;
				if (this.surface === "focus") {
					this.host.getSettings().focusScope = scope;
					void this.host.saveSettings();
				}
				void this.rebuild();
			});
		}
		const readBtn = toolbar.createEl("button", {
			cls:
				"stx-reading-toggle" +
				(this.readingMode() ? " is-active" : ""),
			attr: { "aria-label": "Toggle reading mode" },
		});
		setIcon(readBtn, this.readingMode() ? "book-open" : "pencil");
		readBtn.addEventListener("click", async () => {
			await this.setReadingMode(!this.readingMode());
			void this.rebuild();
		});

		this.buildNavRow();

		const chipsEl = this.containerEl.createDiv(
			"stx-chips" + (collapsed ? " is-collapsed" : "")
		);
		this.cardsEl = this.containerEl.createDiv("stx-cards");
		if (!this.readingMode()) this.buildEditBar();

		const file = this.noteFile();
		if (!file) {
			this.cardsEl.createDiv({
				cls: "stx-empty",
				text: `No ${SCOPE_LABELS[this.scope].toLowerCase()} note (${this.notePath()})`,
			});
			return;
		}

		const content = await this.host.app.vault.cachedRead(file);
		const sections = parseSections(content);
		const selected = new Set(this.selection());

		for (const sec of sections) {
			const chip = chipsEl.createEl("button", {
				cls:
					"stx-chip stx-chip-l" +
					sec.level +
					(selected.has(sec.heading) ? " is-active" : ""),
				text: sec.title.replace(/%%.*?%%/g, "").trim() || sec.title,
			});
			chip.addEventListener("click", async () => {
				const next = new Set(this.selection());
				if (next.has(sec.heading)) next.delete(sec.heading);
				else next.add(sec.heading);
				// keep note order
				const ordered = sections
					.map((s) => s.heading)
					.filter((h) => next.has(h));
				await this.setSelection(ordered);
				void this.rebuild();
			});
		}

		for (const sec of sections) {
			if (!selected.has(sec.heading)) continue;
			this.buildCard(file, sec, content);
		}
		if (selected.size === 0) {
			this.cardsEl.createDiv({
				cls: "stx-empty",
				text: "Pick one or more sections above.",
			});
		}
	}

	/** ◀ note-label ▶ [today] — plus the line-edit cluster in edit mode. */
	private buildNavRow(): void {
		const nav = this.containerEl.createDiv("stx-nav-row");

		const navBtn = (aria: string, icon: string, cb: () => void) => {
			const btn = nav.createEl("button", {
				cls: "stx-nav-btn",
				attr: { "aria-label": aria },
			});
			setIcon(btn, icon);
			btn.addEventListener("click", cb);
			return btn;
		};

		navBtn(`Previous ${this.scope}`, "chevron-left", () => {
			this.anchorIso = stepAnchorIso(this.resolvedIso(), this.scope, -1);
			void this.rebuild();
		});

		// The label names the note being viewed; tapping it opens that note.
		const noteName =
			this.notePath().split("/").pop()?.replace(/\.md$/, "") ?? "";
		const label = nav.createEl("button", {
			cls: "stx-nav-label",
			text:
				this.scope === "day"
					? formatDateLabel(this.resolvedIso())
					: noteName,
			attr: { "aria-label": `Open ${noteName}` },
		});
		label.addEventListener("click", () => {
			const file = this.noteFile();
			if (!file) return;
			void this.host.app.workspace.getLeaf(false).openFile(file);
		});

		navBtn(`Next ${this.scope}`, "chevron-right", () => {
			this.anchorIso = stepAnchorIso(this.resolvedIso(), this.scope, 1);
			void this.rebuild();
		});

		// Only offer "back to today" when this scope is actually showing a
		// different note than today's: an anchor of yesterday still resolves
		// to the current week/month, and a reset button there looks like a
		// no-op but silently yanks the day scope back (Shawn's 08-20 repro).
		const todayPath = periodicNotePath(this.host.getSettings(), this.scope);
		if (this.anchorIso !== null && this.notePath() !== todayPath) {
			const today = navBtn("Back to today", "calendar-check", () => {
				this.anchorIso = null;
				void this.rebuild();
			});
			today.addClass("is-anchored");
		}

	}

	/**
	 * The edit bar: bullet / checkbox / outdent / indent / move up / move
	 * down, pinned to the bottom of the view so it sits directly above the
	 * phone keyboard (the container is a flex column; this is its last row).
	 * Obsidian's own mobile toolbar ignores embedded editors — the v1.7.1
	 * activeEditor claim did not populate it on-device — so the cards carry
	 * their own bar instead.
	 */
	private buildEditBar(): void {
		const bar = this.containerEl.createDiv("stx-edit-bar");
		const opBtn = (op: LineOp, aria: string, icon: string) => {
			const btn = bar.createEl("button", {
				cls: "stx-edit-btn",
				attr: { "aria-label": aria },
			});
			setIcon(btn, icon);
			// Keep the editor's focus/cursor: the press must not blur it,
			// so the keyboard stays up and the op hits the right line.
			btn.addEventListener("pointerdown", (e) => e.preventDefault());
			btn.addEventListener("click", () => this.applyLineOp(op));
		};
		opBtn("bullet", "Toggle bullet", "list");
		opBtn("checkbox", "Toggle checkbox", "check-square");
		opBtn("outdent", "Outdent line", "chevrons-left");
		opBtn("indent", "Indent line", "chevrons-right");
		opBtn("up", "Move line up", "arrow-up");
		opBtn("down", "Move line down", "arrow-down");
	}

	/** Route a line op to the focused card's editor (or the only card). */
	private applyLineOp(op: LineOp): void {
		const editing = this.cards.filter((c) => c.editor);
		const target =
			editing.find((c) => c.editor?.hasFocus) ??
			(editing.length === 1 ? editing[0] : undefined);
		if (!target?.editor) {
			new Notice("Tap into a section first");
			return;
		}
		target.editor.applyLineOp(op);
	}

	private buildCard(file: TFile, sec: Section, content: string): void {
		if (!this.cardsEl) return;
		const slice = sliceSection(content, sec.heading) ?? "";
		const cardEl = this.cardsEl.createDiv("stx-card");
		cardEl.createDiv({ cls: "stx-card-title", text: sec.title });
		const bodyEl = cardEl.createDiv("stx-card-body");

		const card: Card = {
			spec: sec.heading,
			lastSlice: slice,
			editor: null,
			renderEl: null,
			timer: null,
		};

		if (this.readingMode()) {
			card.renderEl = bodyEl;
			void this.renderReading(file, card, slice);
		} else {
			card.editor = new EmbeddedMarkdownEditor(this.host.app, bodyEl, {
				value: slice,
				filePath: file.path,
				onChange: (value) => {
					if (card.timer !== null) window.clearTimeout(card.timer);
					card.timer = window.setTimeout(() => {
						card.timer = null;
						void this.writeBack(card, value);
					}, WRITE_DEBOUNCE_MS);
				},
				onBlur: (value) => {
					if (card.timer !== null) {
						window.clearTimeout(card.timer);
						card.timer = null;
					}
					void this.writeBack(card, value);
				},
			});
			this.addChild(card.editor);
		}
		this.cards.push(card);
	}

	private async renderReading(
		file: TFile,
		card: Card,
		slice: string
	): Promise<void> {
		if (!card.renderEl) return;
		card.renderEl.empty();
		await MarkdownRenderer.render(
			this.host.app,
			slice || "*empty*",
			card.renderEl,
			file.path,
			this
		);
		const boxes = card.renderEl.querySelectorAll<HTMLInputElement>(
			"input.task-list-item-checkbox"
		);
		boxes.forEach((box, i) => {
			box.disabled = false;
			box.addEventListener("change", () =>
				void this.toggleCheckbox(file, card, i, box.checked)
			);
		});
	}

	/** Flip the i-th checkbox line of the card's section in the real file. */
	private async toggleCheckbox(
		file: TFile,
		card: Card,
		index: number,
		checked: boolean
	): Promise<void> {
		await this.host.app.vault.process(file, (content) => {
			const slice = sliceSection(content, card.spec);
			if (slice === null) return content;
			const lines = slice.split("\n");
			let n = -1;
			for (let j = 0; j < lines.length; j++) {
				if (!CHECKBOX_RE.test(lines[j])) continue;
				n++;
				if (n !== index) continue;
				lines[j] = lines[j].replace(
					CHECKBOX_RE,
					`$1${checked ? "x" : " "}$3`
				);
				break;
			}
			const next = lines.join("\n");
			card.lastSlice = next;
			return replaceSection(content, card.spec, next);
		});
		void this.renderReading(file, card, card.lastSlice);
	}

	// ---- writes & reconciliation ----

	private async writeBack(card: Card, value: string): Promise<void> {
		if (value === card.lastSlice) return;
		const file = this.noteFile();
		if (!file) return;
		// Set before the write so our own modify event reconciles as a no-op.
		card.lastSlice = value;
		await this.host.app.vault.process(file, (content) =>
			replaceSection(content, card.spec, value)
		);
	}

	/** The file changed (us or someone else): update cards that aren't busy. */
	private async reconcile(): Promise<void> {
		const file = this.noteFile();
		if (!file) return;
		const content = await this.host.app.vault.cachedRead(file);
		for (const card of this.cards) {
			const fresh = sliceSection(content, card.spec);
			if (fresh === null || fresh === card.lastSlice) continue;
			if (card.editor) {
				if (card.editor.hasFocus || card.timer !== null) continue;
				card.lastSlice = fresh;
				card.editor.set(fresh);
			} else if (card.renderEl) {
				card.lastSlice = fresh;
				void this.renderReading(file, card, fresh);
			}
		}
	}

	private teardownCards(): void {
		for (const card of this.cards) {
			if (card.timer !== null) {
				window.clearTimeout(card.timer);
				// a pending edit must not be lost on teardown
				if (card.editor) void this.writeBack(card, card.editor.get());
			}
			if (card.editor) this.removeChild(card.editor);
		}
		this.cards = [];
	}
}
