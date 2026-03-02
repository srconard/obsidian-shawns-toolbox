import { App, PluginSettingTab, Setting } from "obsidian";
import type ShawnsToolboxPlugin from "./main";

export interface ShawnsToolboxSettings {
	checkboxStampingEnabled: boolean;
	includeTime: boolean;
	excludePatterns: string[];
	dateFormat: string;

	// Block Summarizer
	blockSummarizerEnabled: boolean;
	geminiApiKey: string;
	geminiModel: string;
}

export const DEFAULT_SETTINGS: ShawnsToolboxSettings = {
	checkboxStampingEnabled: true,
	includeTime: false,
	excludePatterns: ["#task"],
	dateFormat: "YYYY-MM-DD",

	blockSummarizerEnabled: true,
	geminiApiKey: "",
	geminiModel: "gemini-2.5-flash",
};

export class ShawnsToolboxSettingTab extends PluginSettingTab {
	plugin: ShawnsToolboxPlugin;

	constructor(app: App, plugin: ShawnsToolboxPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Shawn's Toolbox Settings" });

		// Checkbox Completion Stamping section
		containerEl.createEl("h3", { text: "Checkbox Completion Stamping" });

		containerEl.createEl("p", {
			text: "When you check a checkbox, a checkmark emoji and date will be appended to the line.",
			cls: "setting-item-description",
		});

		containerEl.createEl("p", {
			text: "Example: - [x] Buy groceries ✅ 2026-02-07",
			cls: "setting-item-description",
		});

		// Enable/disable toggle
		new Setting(containerEl)
			.setName("Enable checkbox stamping")
			.setDesc("Toggle the checkbox completion stamping feature on or off.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.checkboxStampingEnabled)
					.onChange(async (value) => {
						this.plugin.settings.checkboxStampingEnabled = value;
						await this.plugin.saveSettings();
					})
			);

		// Include time toggle
		new Setting(containerEl)
			.setName("Include time")
			.setDesc("Add the time of completion alongside the date (e.g., ✅ 2026-02-07 14:30).")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeTime)
					.onChange(async (value) => {
						this.plugin.settings.includeTime = value;
						await this.plugin.saveSettings();
					})
			);

		// Exclusion patterns
		new Setting(containerEl)
			.setName("Exclusion patterns")
			.setDesc(
				"Lines containing any of these patterns will not be stamped. Enter one pattern per line."
			)
			.addTextArea((text) => {
				text
					.setPlaceholder("#task\n#recurring")
					.setValue(this.plugin.settings.excludePatterns.join("\n"))
					.onChange(async (value) => {
						// Split by newlines, filter empty strings
						this.plugin.settings.excludePatterns = value
							.split("\n")
							.map((p) => p.trim())
							.filter((p) => p.length > 0);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 5;
				text.inputEl.cols = 30;
			});

		// Block Summarizer section
		containerEl.createEl("h3", { text: "Block Summarizer" });

		containerEl.createEl("p", {
			text: 'Summarize a bullet point and its children using an LLM. Place your cursor on a bullet and run the "Summarize Block" command.',
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Enable block summarizer")
			.setDesc("Toggle the block summarizer command on or off.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.blockSummarizerEnabled)
					.onChange(async (value) => {
						this.plugin.settings.blockSummarizerEnabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Gemini API key")
			.setDesc(
				"Your Google Gemini API key. Get one at https://aistudio.google.com/apikey"
			)
			.addText((text) => {
				text
					.setPlaceholder("Enter your API key")
					.setValue(this.plugin.settings.geminiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.geminiApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
				text.inputEl.style.width = "300px";
			});

		new Setting(containerEl)
			.setName("Gemini model")
			.setDesc("The Gemini model to use for summarization.")
			.addText((text) =>
				text
					.setPlaceholder("gemini-2.5-flash")
					.setValue(this.plugin.settings.geminiModel)
					.onChange(async (value) => {
						this.plugin.settings.geminiModel =
							value.trim() || "gemini-2.5-flash";
						await this.plugin.saveSettings();
					})
			);
	}
}
