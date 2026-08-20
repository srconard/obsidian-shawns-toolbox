import { Notice, Plugin, WorkspaceLeaf, TFile } from "obsidian";
import { summarizeBlock } from "./block-summarizer";
import {
	createCheckboxExtensions,
	type CheckboxHandlerState,
} from "./checkbox-handler";
import {
	DEFAULT_SETTINGS,
	ShawnsToolboxSettingTab,
	type ShawnsToolboxSettings,
} from "./settings";
import { StatusView, STATUS_VIEW_TYPE } from "./status-view";
import { StatusFooter } from "./status-footer";
import { findConflicts, formatConflictReport } from "./status-conflicts";
import { todayIso } from "./status-service";
import { ensureDailyNote, logicalTodayIso } from "./capture-service";
import { CaptureView, CAPTURE_VIEW_TYPE } from "./capture-view";
import { SectionsView, SECTIONS_VIEW_TYPE } from "./sections-view";
import { FocusView, FOCUS_VIEW_TYPE } from "./focus-view";
import { VoiceView, VOICE_VIEW_TYPE } from "./voice-view";
import type { CardsHost } from "./section-cards";

export default class ShawnsToolboxPlugin extends Plugin {
	settings: ShawnsToolboxSettings = DEFAULT_SETTINGS;
	private handlerState: CheckboxHandlerState = {
		settings: DEFAULT_SETTINGS,
		enabled: true,
	};
	private statusFooter: StatusFooter | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Shared state object read by CodeMirror extensions
		this.handlerState.settings = this.settings;
		this.handlerState.enabled = this.settings.checkboxStampingEnabled;

		// Register CodeMirror extensions for checkbox stamping
		this.registerEditorExtension(
			createCheckboxExtensions(this.handlerState)
		);

		// Register the Summarize Block command
		this.addCommand({
			id: "summarize-block",
			name: "Summarize Block",
			editorCallback: async (editor) => {
				if (!this.settings.blockSummarizerEnabled) {
					new Notice(
						"Block Summarizer is disabled. Enable it in Shawn's Toolbox settings."
					);
					return;
				}
				await summarizeBlock(editor, this.settings);
			},
		});

		// ---- Note status ----

		this.registerView(
			STATUS_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new StatusView(leaf)
		);

		this.addCommand({
			id: "open-status-panel",
			name: "Open note status panel",
			callback: async () => {
				const existing =
					this.app.workspace.getLeavesOfType(STATUS_VIEW_TYPE);
				if (existing.length > 0) {
					this.app.workspace.revealLeaf(existing[0]);
					return;
				}
				const leaf = this.app.workspace.getRightLeaf(false);
				if (!leaf) return;
				await leaf.setViewState({
					type: STATUS_VIEW_TYPE,
					active: true,
				});
				this.app.workspace.revealLeaf(leaf);
			},
		});

		this.addCommand({
			id: "report-status-conflicts",
			name: "Report status phase conflicts",
			callback: async () => {
				const conflicts = findConflicts(this.app);
				const today = todayIso();
				const path = `AGENTS/inbox/status-conflicts-${today}.md`;
				const body = formatConflictReport(conflicts, today);
				const existing = this.app.vault.getAbstractFileByPath(path);
				if (existing instanceof TFile) {
					await this.app.vault.modify(existing, body);
				} else {
					await this.app.vault.create(path, body);
				}
				new Notice(`${conflicts.length} conflicts → ${path}`);
			},
		});

		// ---- Capture & Sections ----

		const host: CardsHost = {
			app: this.app,
			getSettings: () => this.settings,
			saveSettings: () => this.saveSettings(),
		};

		this.registerView(
			CAPTURE_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new CaptureView(leaf, host)
		);
		this.registerView(
			SECTIONS_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new SectionsView(leaf, host)
		);
		this.registerView(
			FOCUS_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new FocusView(leaf, host)
		);
		this.registerView(
			VOICE_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new VoiceView(leaf, host)
		);

		this.addCommand({
			id: "open-capture-view",
			name: "Open capture view",
			callback: () => void this.activateView(CAPTURE_VIEW_TYPE, "main"),
		});
		this.addCommand({
			id: "open-sections-view",
			name: "Open sections view",
			callback: () =>
				void this.activateView(SECTIONS_VIEW_TYPE, "main"),
		});
		this.addCommand({
			id: "open-focus-panel",
			name: "Open focus panel",
			callback: () => void this.activateView(FOCUS_VIEW_TYPE, "left"),
		});
		this.addCommand({
			id: "open-voice-panel",
			name: "Open voice capture panel",
			callback: () => void this.activateView(VOICE_VIEW_TYPE, "right"),
		});
		this.addRibbonIcon("zap", "Open capture view", () =>
			void this.activateView(CAPTURE_VIEW_TYPE, "main")
		);
		this.addRibbonIcon("layout-list", "Open sections view", () =>
			void this.activateView(SECTIONS_VIEW_TYPE, "main")
		);

		// "Go to today" — jumps to (logical) today's daily note from anywhere,
		// creating it from the daily template when the 5 AM cron hasn't run.
		this.addCommand({
			id: "open-todays-daily-note",
			name: "Open today's daily note",
			callback: () => void this.openToday(),
		});
		this.addRibbonIcon("calendar-check", "Open today's daily note", () =>
			void this.openToday()
		);

		this.statusFooter = new StatusFooter(this.app, () => this.settings);
		const footer = this.statusFooter;
		this.registerEvent(
			this.app.workspace.on("layout-change", () => footer.refreshAll())
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () =>
				footer.refreshAll()
			)
		);
		this.registerEvent(
			this.app.metadataCache.on("changed", () => footer.refreshAll())
		);
		this.app.workspace.onLayoutReady(() => footer.refreshAll());

		// Add settings tab
		this.addSettingTab(new ShawnsToolboxSettingTab(this.app, this));

		console.log("Shawn's Toolbox loaded");
	}

	onunload(): void {
		this.statusFooter?.unmount();
		console.log("Shawn's Toolbox unloaded");
	}

	private async openToday(): Promise<void> {
		try {
			const file = await ensureDailyNote(
				this.app,
				this.settings,
				logicalTodayIso(this.settings)
			);
			await this.app.workspace.getLeaf(false).openFile(file);
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}

	private async activateView(
		type: string,
		side: "main" | "left" | "right"
	): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(type);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf =
			side === "main"
				? this.app.workspace.getLeaf(true)
				: side === "left"
					? this.app.workspace.getLeftLeaf(false)
					: this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		const raw = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
		// Merge the nested records defaults-first: a stored data.json from an
		// older version lacks newer keys (e.g. the "year" scope), and the
		// fresh objects also keep per-scope writes from mutating the
		// module-level DEFAULT_SETTINGS.
		this.settings.captureTargets = {
			...DEFAULT_SETTINGS.captureTargets,
			...this.settings.captureTargets,
		};
		this.settings.periodicFormats = {
			...DEFAULT_SETTINGS.periodicFormats,
			...this.settings.periodicFormats,
		};
		this.settings.sectionSelections = {
			...DEFAULT_SETTINGS.sectionSelections,
			...this.settings.sectionSelections,
		};
		this.settings.focusSectionSelections = {
			...DEFAULT_SETTINGS.focusSectionSelections,
			...this.settings.focusSectionSelections,
		};
		// v1.5.x migration: the Focus panel used to keep ONE selection across
		// all scopes (focusSections) — seed it into the current scope's slot.
		const legacy = raw.focusSections;
		if (
			Array.isArray(legacy) &&
			legacy.length > 0 &&
			!raw.focusSectionSelections
		) {
			this.settings.focusSectionSelections[this.settings.focusScope] =
				legacy as string[];
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Update the shared state so extensions pick up new settings immediately
		this.handlerState.settings = this.settings;
		this.handlerState.enabled = this.settings.checkboxStampingEnabled;
		this.statusFooter?.refreshAll();
	}
}
