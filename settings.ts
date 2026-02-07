import { App, PluginSettingTab, Setting } from "obsidian";
import type ShawnsToolboxPlugin from "./main";

export interface ShawnsToolboxSettings {
	excludePatterns: string[];
	dateFormat: string;
}

export const DEFAULT_SETTINGS: ShawnsToolboxSettings = {
	excludePatterns: ["#task"],
	dateFormat: "YYYY-MM-DD",
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
	}
}
