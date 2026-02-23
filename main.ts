import { Editor, Plugin } from "obsidian";
import { CheckboxHandler } from "./checkbox-handler";
import {
	DEFAULT_SETTINGS,
	ShawnsToolboxSettingTab,
	type ShawnsToolboxSettings,
} from "./settings";

export default class ShawnsToolboxPlugin extends Plugin {
	settings: ShawnsToolboxSettings = DEFAULT_SETTINGS;
	private checkboxHandler: CheckboxHandler | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Initialize checkbox handler
		this.checkboxHandler = new CheckboxHandler(this.settings);

		// Register editor change event
		this.registerEvent(
			this.app.workspace.on("editor-change", (editor: Editor) => {
				if (
					this.settings.checkboxStampingEnabled &&
					this.checkboxHandler
				) {
					this.checkboxHandler.handleEditorChange(editor);
				}
			})
		);

		// Add settings tab
		this.addSettingTab(new ShawnsToolboxSettingTab(this.app, this));

		console.log("Shawn's Toolbox loaded");
	}

	onunload(): void {
		this.checkboxHandler = null;
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
		// Update checkbox handler with new settings
		if (this.checkboxHandler) {
			this.checkboxHandler.updateSettings(this.settings);
		}
	}
}
