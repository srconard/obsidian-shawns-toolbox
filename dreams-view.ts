// dreams-view.ts — right-sidebar Dreams panel.
//
// The list shows every dream day (newest first), filtered Unprocessed / Processed
// / All, each row carrying its connection + kept counts and a Done toggle that
// flips the note's `dreams_reviewed` frontmatter. Tapping a day opens its
// connection cards: title, the two linked notes (tap → open in-app), the
// thread/quotes/speculation (collapsed, tap "context" to expand), and a tap on the
// card toggles KEEP — rewriting the pair line to `- [ ]` (or back to plain); an
// already-applied `- [x]` connection is read-only. Long-press / right-click a card
// dismisses it locally (greys it, no file write) so a day can be moved through
// fast. A "Kept" view lists everything saved across all days. All reads/writes go
// through DreamsService; the panel re-renders when any dream note changes.
import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type { CardsHost } from "./section-cards";
import {
	DreamsService,
	type DreamDay,
	type DreamDayDetail,
	type KeptConnection,
} from "./dreams-service";
import type { DreamConnection } from "./dreams-core";
import { formatDateLabelWithYear } from "./date-nav";
import {
	MicRecorder,
	appendTranscript,
	failureEmbed,
	parkFailedAudio,
	transcribeChain,
} from "./voice-capture";

export const DREAMS_VIEW_TYPE = "shawns-toolbox-dreams";

export type DreamFilter = "unprocessed" | "processed" | "all";

const FILTER_LABELS: Record<DreamFilter, string> = {
	unprocessed: "Unprocessed",
	processed: "Processed",
	all: "All",
};

const THREAD_PREVIEW = 150;

export class DreamsView extends ItemView {
	private svc: DreamsService;
	private mode: "list" | "day" | "kept" = "list";
	private currentDayPath: string | null = null;
	/** Pair bodies expanded (context shown) in the day view. */
	private expanded = new Set<string>();
	/** Pair bodies dismissed locally (greyed, no write) in the current day. */
	private dismissed = new Set<string>();
	private listScroll = 0;
	/** Suppresses the click that follows a long-press dismiss. */
	private suppressNextClick = false;
	/** Pair body whose context-note editor is open, or null. */
	private editing: string | null = null;
	/** Live draft text of the open note editor (survives re-renders). */
	private draft = "";
	/** Mic recorder for the open note editor. */
	private recorder: MicRecorder | null = null;
	private recState: "idle" | "recording" | "transcribing" = "idle";

	constructor(leaf: WorkspaceLeaf, private host: CardsHost) {
		super(leaf);
		this.svc = new DreamsService(host.app, () => host.getSettings());
	}

	getViewType(): string {
		return DREAMS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Dreams";
	}

	getIcon(): string {
		return "moon";
	}

	private get filter(): DreamFilter {
		return this.host.getSettings().dreamsFilter;
	}

	private async setFilter(f: DreamFilter): Promise<void> {
		this.host.getSettings().dreamsFilter = f;
		await this.host.saveSettings();
		await this.render();
	}

	async onOpen(): Promise<void> {
		const onNote = (f: { path: string }) => {
			if (this.svc.watches(f.path)) void this.render();
		};
		this.registerEvent(this.host.app.vault.on("modify", onNote));
		this.registerEvent(this.host.app.vault.on("create", onNote));
		this.registerEvent(this.host.app.vault.on("delete", onNote));
		this.registerEvent(
			this.host.app.vault.on("rename", (f, oldPath) => {
				if (this.svc.watches(f.path) || this.svc.watches(oldPath))
					void this.render();
			})
		);
		// Frontmatter edits (dreams_reviewed flipped elsewhere) don't fire a
		// vault modify we can cheaply distinguish; the metadata cache does.
		this.registerEvent(
			this.host.app.metadataCache.on("changed", (f) => {
				if (this.mode === "list" && this.svc.watches(f.path))
					void this.render();
			})
		);
		await this.render();
	}

	async onClose(): Promise<void> {
		this.recorder?.cancel();
		this.recorder = null;
		this.recState = "idle";
		this.contentEl.empty();
	}

	private async render(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("stx-dreams-root");
		if (this.mode === "day") {
			await this.renderDay(root);
		} else if (this.mode === "kept") {
			await this.renderKept(root);
		} else {
			await this.renderList(root);
		}
	}

	// ---- day list ----

	private async renderList(root: HTMLElement): Promise<void> {
		const days = await this.svc.listDays();
		const unprocessed = days.filter((d) => !d.reviewed);
		const processed = days.filter((d) => d.reviewed);

		// Header + unprocessed badge.
		const header = root.createDiv("stx-dreams-header");
		header.createSpan({ cls: "stx-dreams-title", text: "Dreams" });
		if (unprocessed.length > 0) {
			header.createSpan({
				cls: "stx-dreams-badge",
				text: String(unprocessed.length),
				attr: { "aria-label": `${unprocessed.length} unprocessed days` },
			});
		}

		// Filter chips + Kept.
		const chips = root.createDiv("stx-dreams-chips");
		const counts: Record<DreamFilter, number> = {
			unprocessed: unprocessed.length,
			processed: processed.length,
			all: days.length,
		};
		(["unprocessed", "processed", "all"] as DreamFilter[]).forEach((f) => {
			const chip = chips.createEl("button", {
				cls:
					"stx-dreams-chip" +
					(this.filter === f ? " is-active" : ""),
				text: `${FILTER_LABELS[f]} ${counts[f]}`,
			});
			chip.addEventListener("click", () => void this.setFilter(f));
		});
		const keptBtn = chips.createEl("button", {
			cls: "stx-dreams-chip stx-dreams-kept-chip",
			text: "★ Kept",
			attr: { "aria-label": "Show kept connections" },
		});
		keptBtn.addEventListener("click", () => {
			this.mode = "kept";
			void this.render();
		});

		const shown =
			this.filter === "unprocessed"
				? unprocessed
				: this.filter === "processed"
					? processed
					: days;

		const listEl = root.createDiv("stx-dreams-list");
		if (shown.length === 0) {
			listEl.createDiv({
				cls: "stx-dreams-empty",
				text:
					this.filter === "unprocessed"
						? "✅ All caught up — no unprocessed dream days."
						: "No dream days here yet.",
			});
		}
		for (const day of shown) this.buildDayRow(listEl, day);
		listEl.scrollTop = this.listScroll;
		listEl.addEventListener("scroll", () => {
			this.listScroll = listEl.scrollTop;
		});
	}

	private buildDayRow(listEl: HTMLElement, day: DreamDay): void {
		const row = listEl.createDiv(
			"stx-dreams-day" + (day.reviewed ? " is-reviewed" : "")
		);
		const open = row.createEl("button", {
			cls: "stx-dreams-day-open",
			attr: { "aria-label": `Open ${day.dateIso}` },
		});
		open.createSpan({
			cls: "stx-dreams-day-date",
			text: formatDateLabelWithYear(day.dateIso),
		});
		const meta = `${day.counts.connections} connection${
			day.counts.connections === 1 ? "" : "s"
		}${day.counts.flagged ? ` · ${day.counts.flagged} kept` : ""}${
			day.isAgent ? "" : " · digest"
		}`;
		open.createSpan({ cls: "stx-dreams-day-meta", text: meta });
		open.addEventListener("click", () => {
			this.currentDayPath = day.path;
			this.dismissed.clear();
			this.expanded.clear();
			this.mode = "day";
			void this.render();
		});

		const done = row.createEl("button", {
			cls:
				"stx-dreams-done" + (day.reviewed ? " is-done" : ""),
			attr: {
				"aria-label": day.reviewed ? "Mark not done" : "Mark day done",
			},
		});
		setIcon(done, day.reviewed ? "rotate-ccw" : "check");
		done.addEventListener("click", async (e) => {
			e.stopPropagation();
			try {
				await this.svc.setReviewed(day.path, !day.reviewed);
				await this.render();
			} catch (err) {
				new Notice(msg("Could not update", err));
			}
		});
	}

	// ---- day detail ----

	private async renderDay(root: HTMLElement): Promise<void> {
		const path = this.currentDayPath;
		const detail = path ? await this.svc.dayDetail(path) : null;
		const bar = root.createDiv("stx-dreams-daybar");
		const back = bar.createEl("button", {
			cls: "stx-dreams-back",
			attr: { "aria-label": "Back to days" },
		});
		setIcon(back, "chevron-left");
		back.addEventListener("click", () => {
			this.mode = "list";
			void this.render();
		});
		bar.createSpan({
			cls: "stx-dreams-daytitle",
			text: detail ? formatDateLabelWithYear(detail.dateIso) : "Dreams",
		});

		if (!detail) {
			root.createDiv({
				cls: "stx-dreams-empty",
				text: "This day's note could not be read.",
			});
			return;
		}

		const listEl = root.createDiv("stx-dreams-cards");
		const conns = detail.connections.filter((c) => !c.isHighSignal && c.pairBody);
		if (conns.length === 0) {
			listEl.createDiv({
				cls: "stx-dreams-empty",
				text: "No connections in this day's dreams.",
			});
		}
		for (const c of conns) this.buildCard(listEl, detail, c);

		// High-signal round-up (informational).
		const high = detail.connections.find((c) => c.isHighSignal);
		if (high && high.quotes.length + (high.thread ? 1 : 0) >= 0) {
			this.buildHighSignal(root, detail, high);
		}

		const foot = root.createDiv("stx-dreams-dayfoot");
		const doneBtn = foot.createEl("button", {
			cls:
				"stx-dreams-markdone" + (detail.reviewed ? " is-done" : ""),
			text: detail.reviewed ? "Marked done — undo" : "Mark day done",
		});
		doneBtn.addEventListener("click", async () => {
			try {
				await this.svc.setReviewed(detail.path, !detail.reviewed);
				if (!detail.reviewed) {
					// Just marked done — return to the list.
					this.mode = "list";
				}
				await this.render();
			} catch (err) {
				new Notice(msg("Could not update", err));
			}
		});
	}

	private buildCard(
		listEl: HTMLElement,
		detail: DreamDayDetail,
		c: DreamConnection
	): void {
		const dismissed = this.dismissed.has(c.pairBody);
		const readOnly = c.keep === "applied";
		const card = listEl.createDiv(
			"stx-dreams-card" +
				(c.keep === "kept" ? " is-kept" : "") +
				(readOnly ? " is-applied" : "") +
				(dismissed ? " is-dismissed" : "")
		);

		const head = card.createDiv("stx-dreams-card-head");
		const badge = head.createSpan({ cls: "stx-dreams-state" });
		badge.setText(c.keep === "applied" ? "✓" : c.keep === "kept" ? "★" : "·");
		head.createSpan({ cls: "stx-dreams-card-title", text: c.title });

		// Tapping the head toggles KEEP (unless read-only / dismissed).
		this.wireKeepToggle(head, detail, c);
		// Long-press / right-click the card dismisses it locally.
		this.wireDismiss(card, c);

		const pair = card.createDiv("stx-dreams-pair");
		this.buildNoteLink(pair, detail.path, c.noteA);
		pair.createSpan({ cls: "stx-dreams-arrow", text: " ↔ " });
		this.buildNoteLink(pair, detail.path, c.noteB);

		if (c.thread) {
			const expanded = this.expanded.has(c.pairBody);
			card.createDiv({
				cls: "stx-dreams-thread",
				text:
					expanded || c.thread.length <= THREAD_PREVIEW
						? c.thread
						: c.thread.slice(0, THREAD_PREVIEW).trimEnd() + "…",
			});
		}

		const hasContext = c.quotes.length > 0 || !!c.speculation;
		if (hasContext) {
			const expanded = this.expanded.has(c.pairBody);
			const toggle = card.createEl("button", {
				cls: "stx-dreams-context-toggle",
				text: expanded ? "▾ context" : "▸ context",
			});
			toggle.addEventListener("click", (e) => {
				e.stopPropagation();
				if (expanded) this.expanded.delete(c.pairBody);
				else this.expanded.add(c.pairBody);
				void this.render();
			});
			if (expanded) {
				const body = card.createDiv("stx-dreams-context");
				for (const q of c.quotes) {
					body.createDiv({ cls: "stx-dreams-quote", text: q });
				}
				if (c.speculation) {
					const sp = body.createDiv("stx-dreams-spec");
					sp.createSpan({ cls: "stx-dreams-spec-label", text: "Speculation: " });
					sp.createSpan({ text: c.speculation });
				}
			}
		}

		this.buildNoteSection(card, detail, c);
	}

	// ---- context note ("why I kept this") ----

	/**
	 * The note text (if any) plus the add/edit affordance. The pencil appears only
	 * once a connection is kept or applied — on a plain card it shows up right
	 * after the tap-to-keep re-render. When the editor is open for this
	 * connection, the inline editor replaces the button.
	 */
	private buildNoteSection(
		card: HTMLElement,
		detail: DreamDayDetail,
		c: DreamConnection
	): void {
		if (c.note) {
			const noteEl = card.createDiv("stx-dreams-note-body");
			noteEl.createSpan({ cls: "stx-dreams-note-glyph", text: "💭 " });
			noteEl.createSpan({ cls: "stx-dreams-note-text", text: c.note });
		}
		if (this.editing === c.pairBody) {
			this.buildNoteEditor(card, detail, c);
			return;
		}
		if (c.keep === "plain") return; // affordance appears once kept/applied
		const btn = card.createEl("button", {
			cls: "stx-dreams-note-btn",
			attr: {
				"aria-label": c.note ? "Edit note" : "Add a note",
				type: "button",
			},
		});
		setIcon(btn.createSpan({ cls: "stx-dreams-note-btn-icon" }), "pencil");
		btn.createSpan({ text: c.note ? "edit" : "why?" });
		// Keep the card's long-press dismiss / keep-toggle from firing.
		btn.addEventListener("pointerdown", (e) => e.stopPropagation());
		btn.addEventListener("contextmenu", (e) => e.stopPropagation());
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.editing = c.pairBody;
			this.draft = c.note;
			void this.render();
		});
	}

	private buildNoteEditor(
		card: HTMLElement,
		detail: DreamDayDetail,
		c: DreamConnection
	): void {
		const box = card.createDiv("stx-dreams-note-editor");
		// Swallow the gestures the card uses for keep-toggle / long-press dismiss.
		box.addEventListener("pointerdown", (e) => e.stopPropagation());
		box.addEventListener("contextmenu", (e) => e.stopPropagation());
		box.addEventListener("click", (e) => e.stopPropagation());

		const ta = box.createEl("textarea", {
			cls: "stx-dreams-note-input",
			attr: {
				rows: "2",
				placeholder: "what you like about this connection…",
			},
		});
		ta.value = this.draft;
		const grow = () => {
			ta.style.height = "auto";
			ta.style.height = `${ta.scrollHeight}px`;
		};
		ta.addEventListener("input", () => {
			this.draft = ta.value;
			grow();
		});
		ta.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				void this.saveNote(detail, c);
			} else if (e.key === "Escape") {
				e.preventDefault();
				this.cancelNote();
			}
		});

		const row = box.createDiv("stx-dreams-note-editrow");
		const mic = row.createEl("button", {
			cls: "stx-inbox-mic stx-dreams-note-mic",
			attr: { "aria-label": "Dictate", type: "button" },
		});
		const micIcon = mic.createSpan({ cls: "stx-inbox-mic-icon" });
		setIcon(micIcon, "mic");
		mic.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.toggleMic(ta, mic, micIcon);
		});

		const done = row.createEl("button", {
			cls: "mod-cta stx-dreams-note-done",
			text: "Done",
		});
		done.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.saveNote(detail, c);
		});
		const cancel = row.createEl("button", {
			cls: "stx-dreams-note-cancel",
			text: "Cancel",
		});
		cancel.addEventListener("click", (e) => {
			e.stopPropagation();
			this.cancelNote();
		});

		window.setTimeout(() => {
			ta.focus();
			grow();
			const n = ta.value.length;
			ta.setSelectionRange(n, n);
		}, 0);
	}

	private async saveNote(
		detail: DreamDayDetail,
		c: DreamConnection
	): Promise<void> {
		const text = this.draft.trim();
		const prev = this.draft;
		this.editing = null;
		this.draft = "";
		try {
			await this.svc.setNote(detail.path, c.pairBody, text);
			await this.render();
		} catch (err) {
			// Reopen the editor so the typed text isn't lost.
			this.editing = c.pairBody;
			this.draft = prev;
			new Notice(msg("Could not save note", err));
			await this.render();
		}
	}

	private cancelNote(): void {
		this.editing = null;
		this.draft = "";
		void this.render();
	}

	/** Reuse the plugin's Groq→OpenAI dictation chain to fill the note box. */
	private async toggleMic(
		ta: HTMLTextAreaElement,
		mic: HTMLElement,
		micIcon: HTMLElement
	): Promise<void> {
		if (this.recState === "transcribing") return;
		if (this.recState === "recording") {
			await this.stopAndTranscribe(ta, mic, micIcon);
			return;
		}
		try {
			this.recorder = new MicRecorder();
			await this.recorder.start();
		} catch (e) {
			this.recorder = null;
			new Notice(
				"Microphone unavailable: " +
					(e instanceof Error ? e.message : String(e))
			);
			return;
		}
		this.recState = "recording";
		mic.addClass("is-recording");
		setIcon(micIcon, "square");
	}

	private async stopAndTranscribe(
		ta: HTMLTextAreaElement,
		mic: HTMLElement,
		micIcon: HTMLElement
	): Promise<void> {
		const recorder = this.recorder;
		this.recorder = null;
		this.recState = "idle";
		mic.removeClass("is-recording");
		if (!recorder) return;
		const blob = await recorder.stop();
		if (blob.size === 0) {
			setIcon(micIcon, "mic");
			new Notice("No audio captured");
			return;
		}
		this.recState = "transcribing";
		mic.addClass("is-busy");
		setIcon(micIcon, "loader");
		const settings = this.host.getSettings();
		try {
			let text: string;
			try {
				text = await transcribeChain(settings, blob);
			} catch (err) {
				// Every provider failed — park the audio and embed it so nothing
				// is lost; the note editor keeps the embed for later transcription.
				try {
					const path = await parkFailedAudio(this.host.app, settings, blob);
					this.appendDraft(ta, failureEmbed(path));
					new Notice(
						`Transcription failed. Audio saved → ${path} — transcribe it later.`,
						10000
					);
				} catch (saveErr) {
					new Notice(
						"Transcription failed and could not save audio: " +
							(saveErr instanceof Error
								? saveErr.message
								: String(saveErr)),
						12000
					);
				}
				return;
			}
			this.appendDraft(ta, text);
		} finally {
			this.recState = "idle";
			mic.removeClass("is-busy");
			setIcon(micIcon, "mic");
		}
	}

	private appendDraft(ta: HTMLTextAreaElement, text: string): void {
		this.draft = appendTranscript(this.draft, text);
		ta.value = this.draft;
		ta.focus();
		ta.style.height = "auto";
		ta.style.height = `${ta.scrollHeight}px`;
	}

	private buildHighSignal(
		root: HTMLElement,
		detail: DreamDayDetail,
		c: DreamConnection
	): void {
		const box = root.createDiv("stx-dreams-highsignal");
		const key = "__highsignal__";
		const expanded = this.expanded.has(key);
		const toggle = box.createEl("button", {
			cls: "stx-dreams-context-toggle",
			text: (expanded ? "▾ " : "▸ ") + c.title,
		});
		toggle.addEventListener("click", () => {
			if (expanded) this.expanded.delete(key);
			else this.expanded.add(key);
			void this.render();
		});
		if (expanded) {
			const body = box.createDiv("stx-dreams-context");
			for (const q of c.quotes) {
				body.createDiv({ cls: "stx-dreams-quote", text: q });
			}
		}
	}

	// ---- kept (cross-day) ----

	private async renderKept(root: HTMLElement): Promise<void> {
		const bar = root.createDiv("stx-dreams-daybar");
		const back = bar.createEl("button", {
			cls: "stx-dreams-back",
			attr: { "aria-label": "Back to days" },
		});
		setIcon(back, "chevron-left");
		back.addEventListener("click", () => {
			this.mode = "list";
			void this.render();
		});
		bar.createSpan({ cls: "stx-dreams-daytitle", text: "★ Kept connections" });

		const kept = await this.svc.keptConnections();
		const listEl = root.createDiv("stx-dreams-cards");
		if (kept.length === 0) {
			listEl.createDiv({
				cls: "stx-dreams-empty",
				text: "Nothing kept yet — tap a connection in a day to keep it.",
			});
			return;
		}
		for (const k of kept) this.buildKeptRow(listEl, k);
	}

	private buildKeptRow(listEl: HTMLElement, k: KeptConnection): void {
		const c = k.connection;
		const card = listEl.createDiv(
			"stx-dreams-card is-kept" +
				(c.keep === "applied" ? " is-applied" : "")
		);
		const head = card.createDiv("stx-dreams-card-head");
		head.createSpan({
			cls: "stx-dreams-state",
			text: c.keep === "applied" ? "✓" : "★",
		});
		head.createSpan({
			cls: "stx-dreams-kept-date",
			text: formatDateLabelWithYear(k.dateIso),
		});
		card.createDiv({ cls: "stx-dreams-card-title", text: c.title });
		const pair = card.createDiv("stx-dreams-pair");
		this.buildNoteLink(pair, k.path, c.noteA);
		pair.createSpan({ cls: "stx-dreams-arrow", text: " ↔ " });
		this.buildNoteLink(pair, k.path, c.noteB);
		if (c.note) {
			const noteEl = card.createDiv("stx-dreams-note-body");
			noteEl.createSpan({ cls: "stx-dreams-note-glyph", text: "💭 " });
			noteEl.createSpan({ cls: "stx-dreams-note-text", text: c.note });
		}
	}

	// ---- shared bits ----

	private buildNoteLink(parent: HTMLElement, sourcePath: string, note: string): void {
		if (!note) {
			parent.createSpan({ cls: "stx-dreams-note", text: "(?)" });
			return;
		}
		const link = parent.createEl("button", {
			cls: "stx-dreams-note",
			text: note,
			attr: { "aria-label": `Open ${note}` },
		});
		link.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.host.app.workspace.openLinkText(
				note,
				sourcePath,
				e.ctrlKey || e.metaKey
			);
		});
	}

	private wireKeepToggle(
		head: HTMLElement,
		detail: DreamDayDetail,
		c: DreamConnection
	): void {
		if (c.keep === "applied") return; // read-only
		head.addClass("is-toggleable");
		head.addEventListener("click", async () => {
			if (this.suppressNextClick) {
				this.suppressNextClick = false;
				return;
			}
			if (this.dismissed.has(c.pairBody)) return;
			try {
				await this.svc.toggleKeep(detail.path, c.pairBody);
				await this.render();
			} catch (err) {
				new Notice(msg("Could not update connection", err));
			}
		});
	}

	private wireDismiss(card: HTMLElement, c: DreamConnection): void {
		const toggleDismiss = () => {
			if (this.dismissed.has(c.pairBody)) this.dismissed.delete(c.pairBody);
			else this.dismissed.add(c.pairBody);
			void this.render();
		};
		card.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			toggleDismiss();
		});
		let timer: number | null = null;
		const clear = () => {
			if (timer !== null) {
				window.clearTimeout(timer);
				timer = null;
			}
		};
		card.addEventListener("pointerdown", () => {
			clear();
			timer = window.setTimeout(() => {
				this.suppressNextClick = true;
				toggleDismiss();
			}, 500);
		});
		card.addEventListener("pointerup", clear);
		card.addEventListener("pointermove", clear);
		card.addEventListener("pointerleave", clear);
	}
}

function msg(prefix: string, err: unknown): string {
	return `${prefix}: ${err instanceof Error ? err.message : String(err)}`;
}
