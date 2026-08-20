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
	/** The bottom padding we last applied (to tell ours from Obsidian's). */
	private myPad: string | null = null;

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
		// Re-clamp when the keyboard state likely changed (focus moves,
		// window/viewport resize). Obsidian re-sizes its keyboard padding on
		// those same signals; the delays let it write first.
		this.registerDomEvent(this.containerEl, "focusin", () =>
			this.schedulePaddingClamp()
		);
		this.registerDomEvent(this.containerEl, "focusout", () =>
			this.schedulePaddingClamp()
		);
		this.registerDomEvent(window, "resize", () =>
			this.schedulePaddingClamp()
		);
		void this.rebuild();
	}

	/**
	 * Obsidian pads the view's bottom to keep content clear of the on-screen
	 * keyboard, sized as if the view reached the window bottom. In the mobile
	 * drawer the tab strip + vault switcher sit BELOW the view, so that
	 * padding overshoots by exactly their height — Shawn's probe: children
	 * end y=392, container bottom y=724, keyboard-clearance padding ≈330px
	 * while only ~160px of the container is actually under the keyboard.
	 * The overshoot rendered as the dead strip between the edit bar and the
	 * keyboard. Clamp: our padding = Obsidian's padding minus everything
	 * already below the container.
	 */
	private clampBottomPadding(): void {
		const el = this.containerEl;
		// Only clear the inline value if WE set it — if Obsidian overwrote
		// it, the current value is the fresh keyboard measurement.
		if (this.myPad !== null && el.style.paddingBottom === this.myPad) {
			el.style.paddingBottom = "";
		}
		const obsPad =
			parseFloat(getComputedStyle(el).paddingBottom) || 0;
		const below = Math.max(
			0,
			window.innerHeight - el.getBoundingClientRect().bottom
		);
		const pad = Math.max(7, Math.round(obsPad - below));
		this.myPad = `${pad}px`;
		el.style.paddingBottom = this.myPad;
	}

	private schedulePaddingClamp(): void {
		for (const ms of [60, 350, 750]) {
			window.setTimeout(() => this.clampBottomPadding(), ms);
		}
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
		// Layout as INLINE styles: in the mobile drawer Obsidian's own
		// .view-content rules kept beating our class selectors (the probe
		// showed display:flex never applying → the column didn't stretch and
		// the container's empty bottom rendered as a dead box above the
		// keyboard). Inline styles cannot lose a specificity war.
		this.containerEl.style.display = "flex";
		this.containerEl.style.flexDirection = "column";

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
		this.cardsEl.style.flex = "1 1 auto";
		this.cardsEl.style.minHeight = "0";
		if (!this.readingMode()) this.buildEditBar();

		const file = this.noteFile();
		if (!file) {
			this.cardsEl.createDiv({
				cls: "stx-empty",
				text: `No ${SCOPE_LABELS[this.scope].toLowerCase()} note (${this.notePath()})`,
			});
			this.clampBottomPadding();
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
		this.clampBottomPadding();
		this.schedulePaddingClamp();
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
		bar.style.marginTop = "auto";
		bar.style.flex = "0 0 auto";
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

		// TEMPORARY (v1.7.4): the dead box below the bar survived the
		// empty-mobile-toolbar CSS collapse, so the guess was wrong. This
		// probe samples what element actually occupies the space between
		// the bar and the keyboard and writes a report note to read back.
		// Remove once the box is identified and killed.
		const probe = bar.createEl("button", {
			cls: "stx-edit-btn stx-probe-btn",
			attr: { "aria-label": "Probe layout below the bar (debug)" },
		});
		setIcon(probe, "bug");
		probe.addEventListener("pointerdown", (e) => e.preventDefault());
		probe.addEventListener("click", () => void this.runLayoutProbe(bar));
	}

	/** Sample elementFromPoint down the gap under the bar → report note. */
	private async runLayoutProbe(bar: HTMLElement): Promise<void> {
		const lines: string[] = [];
		try {
			const version =
				(this.host.app as any).plugins?.plugins?.["shawns-toolbox"]
					?.manifest?.version ?? "?";
			lines.push(`plugin v${version}`);
			const cs = getComputedStyle(this.containerEl);
			const cr = this.containerEl.getBoundingClientRect();
			lines.push(
				`container computed: display=${cs.display} flexDir=${cs.flexDirection}` +
					` [top=${Math.round(cr.top)} bottom=${Math.round(cr.bottom)}]`
			);
			if (this.cardsEl) {
				const cc = getComputedStyle(this.cardsEl);
				const r = this.cardsEl.getBoundingClientRect();
				lines.push(
					`cards computed: flexGrow=${cc.flexGrow}` +
						` [top=${Math.round(r.top)} bottom=${Math.round(r.bottom)} h=${Math.round(r.height)}]`
				);
			}
			const bs = getComputedStyle(bar);
			lines.push(`bar computed: marginTop=${bs.marginTop}`);
			lines.push(
				`container padding: t=${cs.paddingTop} b=${cs.paddingBottom}` +
					` (our inline pb=${this.containerEl.style.paddingBottom || "none"}, myPad=${this.myPad ?? "unset"})`
			);
			lines.push(
				`body[style]: ${document.body.getAttribute("style") ?? "(none)"}`
			);
			lines.push(
				`html[style]: ${document.documentElement.getAttribute("style") ?? "(none)"}`
			);
			const rect = bar.getBoundingClientRect();
			const vv = window.visualViewport;
			lines.push(
				`bar.bottom=${Math.round(rect.bottom)} innerHeight=${window.innerHeight}` +
					` vv.height=${vv ? Math.round(vv.height) : "n/a"}` +
					` vv.offsetTop=${vv ? Math.round(vv.offsetTop) : "n/a"}` +
					` doc.clientHeight=${document.documentElement.clientHeight}`
			);
			const describe = (el: Element): string => {
				const cls = Array.from(el.classList).slice(0, 6).join(".");
				return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}`;
			};
			const x = Math.round(window.innerWidth / 2);
			const yEnd = Math.max(
				window.innerHeight,
				document.documentElement.clientHeight
			);
			let last = "";
			for (let y = Math.round(rect.bottom) + 2; y < yEnd - 1; y += 10) {
				const el = document.elementFromPoint(x, y);
				const desc = el ? describe(el) : "(nothing)";
				if (desc === last) continue;
				last = desc;
				const r = el?.getBoundingClientRect();
				lines.push(
					`y=${y}: ${desc}` +
						(r
							? ` [top=${Math.round(r.top)} bottom=${Math.round(r.bottom)} h=${Math.round(r.height)}]`
							: "")
				);
			}
			const below = document.elementFromPoint(
				x,
				Math.round(rect.bottom) + 6
			);
			const chain: string[] = [];
			for (
				let el: Element | null = below;
				el && chain.length < 10;
				el = el.parentElement
			) {
				chain.push(describe(el));
			}
			lines.push(`ancestor chain: ${chain.join("  <  ")}`);
		} catch (e) {
			lines.push(`probe error: ${e instanceof Error ? e.message : e}`);
		}
		const path = "AGENTS/inbox/stx-layout-probe.md";
		const body = `# Toolbox layout probe\n\nTaken ${new Date().toISOString()} — keyboard should have been open.\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`;
		const existing = this.host.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.host.app.vault.modify(existing, body);
		} else {
			await this.host.app.vault.create(path, body);
		}
		new Notice(`Layout probe → ${path}`);
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
