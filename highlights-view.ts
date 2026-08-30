// highlights-view.ts — right-sidebar Highlights panel.
//
// Day mode shows one daily note's `highlights::` fields with an add box and
// per-item edit/delete; Week/Month/Range modes list highlights across the
// timeline folder, grouped by date. An "On this day" section surfaces past
// years' highlights for the same calendar date. All reads/writes go through
// HighlightsService; the panel re-renders when any timeline note changes.
import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type { CardsHost } from "./section-cards";
import { HighlightsService, type DayHighlights } from "./highlights-service";
import {
	formatDateLabel,
	weekRange,
	monthRange,
	stepAnchorIso,
	type DateRange,
} from "./date-nav";

export const HIGHLIGHTS_VIEW_TYPE = "shawns-toolbox-highlights";

type Mode = "day" | "week" | "month" | "range";

const MODE_LABELS: Record<Mode, string> = {
	day: "Day",
	week: "Week",
	month: "Month",
	range: "Range",
};

export class HighlightsView extends ItemView {
	private svc: HighlightsService;
	private mode: Mode = "day";
	/** Anchor date for day/week/month modes (YYYY-MM-DD). */
	private anchor: string;
	private rangeStart: string;
	private rangeEnd: string;
	/** In-progress add text, preserved across re-renders. */
	private draft = "";
	private addFocused = false;
	/** The highlight currently open for inline editing, if any. */
	private editing: { dateIso: string; text: string } | null = null;

	constructor(leaf: WorkspaceLeaf, private host: CardsHost) {
		super(leaf);
		this.svc = new HighlightsService(host.app, () => host.getSettings());
		this.anchor = this.svc.todayIso();
		const wk = weekRange(this.anchor);
		this.rangeStart = wk.start;
		this.rangeEnd = wk.end;
	}

	getViewType(): string {
		return HIGHLIGHTS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Highlights";
	}

	getIcon(): string {
		return "star";
	}

	async onOpen(): Promise<void> {
		const inTimeline = (path: string) =>
			path.startsWith(this.svc.timelineFolder() + "/");
		const onNote = (f: { path: string }) => {
			if (inTimeline(f.path)) void this.render();
		};
		this.registerEvent(this.host.app.vault.on("modify", onNote));
		this.registerEvent(this.host.app.vault.on("create", onNote));
		this.registerEvent(this.host.app.vault.on("delete", onNote));
		this.registerEvent(
			this.host.app.vault.on("rename", (f, oldPath) => {
				if (inTimeline(f.path) || inTimeline(oldPath)) void this.render();
			})
		);
		await this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/** The date range currently in view (day = a single day). */
	private currentRange(): DateRange {
		switch (this.mode) {
			case "day":
				return { start: this.anchor, end: this.anchor };
			case "week":
				return weekRange(this.anchor);
			case "month":
				return monthRange(this.anchor);
			case "range":
				return { start: this.rangeStart, end: this.rangeEnd };
		}
	}

	private async setMode(mode: Mode): Promise<void> {
		this.mode = mode;
		this.editing = null;
		if (mode === "range") {
			// Seed the custom range from the current week for a sensible start.
			const wk = weekRange(this.anchor);
			this.rangeStart = wk.start;
			this.rangeEnd = wk.end;
		}
		await this.render();
	}

	private async render(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("stx-highlights-root");

		this.buildModeRow(root);
		this.buildNav(root);

		const listEl = root.createDiv("stx-hl-list");
		if (this.mode === "day") {
			await this.renderDay(listEl);
			await this.renderOnThisDay(root);
		} else {
			await this.renderRange(listEl);
		}
	}

	// ---- toolbar ----

	private buildModeRow(root: HTMLElement): void {
		const row = root.createDiv("stx-hl-modes");
		(["day", "week", "month", "range"] as Mode[]).forEach((mode) => {
			const btn = row.createEl("button", {
				cls:
					"stx-hl-mode" + (this.mode === mode ? " is-active" : ""),
				text: MODE_LABELS[mode],
			});
			btn.addEventListener("click", () => void this.setMode(mode));
		});
	}

	private buildNav(root: HTMLElement): void {
		if (this.mode === "range") {
			this.buildRangeNav(root);
			return;
		}
		const nav = root.createDiv("stx-hl-nav");
		const prev = nav.createEl("button", {
			cls: "stx-hl-nav-btn",
			attr: { "aria-label": "Previous" },
		});
		setIcon(prev, "chevron-left");
		prev.addEventListener("click", () => void this.step(-1));

		const label = nav.createEl("button", {
			cls: "stx-hl-nav-label",
			text: this.navLabel(),
			attr: { "aria-label": "Pick a date" },
		});
		// The visible label overlays an invisible native date input so a tap
		// opens the platform calendar (Android renders raw date inputs poorly).
		const input = label.createEl("input", {
			cls: "stx-hl-date-input",
			attr: { type: "date", value: this.anchor, "aria-label": "Date" },
		});
		input.addEventListener("click", (e) => {
			e.stopPropagation();
			try {
				input.showPicker?.();
			} catch {
				// picker already open or not permitted — input still works
			}
		});
		input.addEventListener("change", () => {
			if (input.value) {
				this.anchor = input.value;
				this.editing = null;
				void this.render();
			}
		});

		const next = nav.createEl("button", {
			cls: "stx-hl-nav-btn",
			attr: { "aria-label": "Next" },
		});
		setIcon(next, "chevron-right");
		next.addEventListener("click", () => void this.step(1));

		const today = nav.createEl("button", {
			cls: "stx-hl-today",
			text: "Today",
			attr: { "aria-label": "Jump to today" },
		});
		today.addEventListener("click", () => {
			this.anchor = this.svc.todayIso();
			this.editing = null;
			void this.render();
		});
	}

	private buildRangeNav(root: HTMLElement): void {
		const nav = root.createDiv("stx-hl-rangenav");
		const mkInput = (value: string, set: (v: string) => void) => {
			const inp = nav.createEl("input", {
				cls: "stx-hl-range-input",
				attr: { type: "date", value },
			});
			inp.addEventListener("change", () => {
				if (inp.value) {
					set(inp.value);
					this.editing = null;
					void this.render();
				}
			});
			return inp;
		};
		mkInput(this.rangeStart, (v) => (this.rangeStart = v));
		nav.createSpan({ cls: "stx-hl-range-to", text: "→" });
		mkInput(this.rangeEnd, (v) => (this.rangeEnd = v));
	}

	private navLabel(): string {
		if (this.mode === "day") return formatDateLabel(this.anchor);
		const { start, end } = this.currentRange();
		return `${formatDateLabel(start)} – ${formatDateLabel(end)}`;
	}

	private async step(delta: -1 | 1): Promise<void> {
		// Range mode has no stepper; day steps one day, week/month one unit.
		if (this.mode === "range") return;
		const scope: "day" | "week" | "month" = this.mode;
		this.anchor = stepAnchorIso(this.anchor, scope, delta);
		this.editing = null;
		await this.render();
	}

	// ---- day mode ----

	private async renderDay(listEl: HTMLElement): Promise<void> {
		const highlights = await this.svc.readDay(this.anchor);
		if (highlights.length === 0) {
			listEl.createDiv({
				cls: "stx-hl-empty",
				text: "No highlights for this day yet.",
			});
		}
		for (const h of highlights) {
			this.buildRow(listEl, this.anchor, h.text);
		}
		this.buildAddBox(listEl);
	}

	private buildAddBox(listEl: HTMLElement): void {
		const box = listEl.createDiv("stx-hl-addbox");
		const input = box.createEl("input", {
			cls: "stx-hl-add-input",
			attr: { type: "text", placeholder: "Add a highlight…" },
		});
		input.value = this.draft;
		input.addEventListener("input", () => {
			this.draft = input.value;
		});
		const submit = async () => {
			const text = input.value.trim();
			if (!text) return;
			try {
				await this.svc.addToDay(this.anchor, text);
				this.draft = "";
				this.addFocused = true;
				// The vault-modify event re-renders; clear our copy first.
			} catch (e) {
				new Notice(
					"Could not add highlight: " +
						(e instanceof Error ? e.message : String(e))
				);
			}
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				void submit();
			}
		});
		const add = box.createEl("button", {
			cls: "stx-hl-add-btn",
			attr: { "aria-label": "Add highlight" },
		});
		setIcon(add, "plus");
		add.addEventListener("click", () => void submit());

		if (this.addFocused) {
			this.addFocused = false;
			window.setTimeout(() => input.focus(), 0);
		}
	}

	// ---- range / week / month modes ----

	private async renderRange(listEl: HTMLElement): Promise<void> {
		const { start, end } = this.currentRange();
		const days = await this.svc.scanRange(start, end);
		if (days.length === 0) {
			listEl.createDiv({
				cls: "stx-hl-empty",
				text: "No highlights in this range.",
			});
			return;
		}
		for (const day of days) this.buildDayGroup(listEl, day);
	}

	private buildDayGroup(listEl: HTMLElement, day: DayHighlights): void {
		const group = listEl.createDiv("stx-hl-group");
		const head = group.createEl("button", {
			cls: "stx-hl-group-date",
			text: formatDateLabel(day.dateIso),
			attr: { "aria-label": `Open ${day.dateIso}` },
		});
		head.addEventListener("click", () => {
			this.mode = "day";
			this.anchor = day.dateIso;
			this.editing = null;
			void this.render();
		});
		for (const h of day.highlights) {
			this.buildRow(group, day.dateIso, h.text);
		}
	}

	// ---- on this day ----

	private async renderOnThisDay(root: HTMLElement): Promise<void> {
		const days = await this.svc.onThisDay(this.anchor);
		if (days.length === 0) return;
		const section = root.createDiv("stx-hl-onthisday");
		section.createDiv({ cls: "stx-hl-onthisday-title", text: "On this day" });
		for (const day of days) this.buildDayGroup(section, day);
	}

	// ---- a single highlight row (view + inline edit) ----

	private buildRow(
		parent: HTMLElement,
		dateIso: string,
		text: string
	): void {
		const isEditing =
			this.editing &&
			this.editing.dateIso === dateIso &&
			this.editing.text === text;
		if (isEditing) {
			this.buildEditRow(parent, dateIso, text);
			return;
		}
		const row = parent.createEl("button", {
			cls: "stx-hl-item",
			attr: { "aria-label": "Edit highlight" },
		});
		row.createSpan({ cls: "stx-hl-item-text", text });
		row.addEventListener("click", () => {
			this.editing = { dateIso, text };
			void this.render();
		});
	}

	private buildEditRow(
		parent: HTMLElement,
		dateIso: string,
		text: string
	): void {
		const row = parent.createDiv("stx-hl-edit");
		const input = row.createEl("input", {
			cls: "stx-hl-edit-input",
			attr: { type: "text", value: text },
		});
		const save = async () => {
			const next = input.value.trim();
			if (!next) return;
			try {
				if (next !== text) {
					await this.svc.editInDay(dateIso, text, next);
				}
				this.editing = null;
				await this.render();
			} catch (e) {
				new Notice(
					"Could not save: " +
						(e instanceof Error ? e.message : String(e))
				);
			}
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				void save();
			} else if (e.key === "Escape") {
				this.editing = null;
				void this.render();
			}
		});
		const saveBtn = row.createEl("button", {
			cls: "stx-hl-edit-btn",
			attr: { "aria-label": "Save" },
		});
		setIcon(saveBtn, "check");
		saveBtn.addEventListener("click", () => void save());

		const delBtn = row.createEl("button", {
			cls: "stx-hl-edit-btn stx-hl-del",
			attr: { "aria-label": "Delete" },
		});
		setIcon(delBtn, "trash-2");
		delBtn.addEventListener("click", async () => {
			try {
				await this.svc.deleteFromDay(dateIso, text);
				this.editing = null;
				await this.render();
			} catch (e) {
				new Notice(
					"Could not delete: " +
						(e instanceof Error ? e.message : String(e))
				);
			}
		});

		const cancelBtn = row.createEl("button", {
			cls: "stx-hl-edit-btn",
			attr: { "aria-label": "Cancel" },
		});
		setIcon(cancelBtn, "x");
		cancelBtn.addEventListener("click", () => {
			this.editing = null;
			void this.render();
		});

		window.setTimeout(() => input.focus(), 0);
	}
}
