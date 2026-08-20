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
import { CaptureView, CAPTURE_VIEW_TYPE } from "./capture-view";
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
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Update the shared state so extensions pick up new settings immediately
		this.handlerState.settings = this.settings;
		this.handlerState.enabled = this.settings.checkboxStampingEnabled;
		this.statusFooter?.refreshAll();
	}
}
