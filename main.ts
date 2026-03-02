import { Notice, Plugin } from "obsidian";
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

export default class ShawnsToolboxPlugin extends Plugin {
	settings: ShawnsToolboxSettings = DEFAULT_SETTINGS;
	private handlerState: CheckboxHandlerState = {
		settings: DEFAULT_SETTINGS,
		enabled: true,
	};

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

		// Add settings tab
		this.addSettingTab(new ShawnsToolboxSettingTab(this.app, this));

		console.log("Shawn's Toolbox loaded");
	}

	onunload(): void {
		console.log("Shawn's Toolbox unloaded");
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
	}
}
