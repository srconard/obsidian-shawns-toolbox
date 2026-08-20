import { App, PluginSettingTab, Setting } from "obsidian";
import type ShawnsToolboxPlugin from "./main";
import type { CaptureKind } from "./section-core";
import type { NoteScope } from "./capture-service";

export interface ShawnsToolboxSettings {
	checkboxStampingEnabled: boolean;
	includeTime: boolean;
	excludePatterns: string[];
	dateFormat: string;

	// Block Summarizer
	blockSummarizerEnabled: boolean;
	geminiApiKey: string;
	geminiModel: string;

	// Note status
	statusFooterEnabled: boolean;
	statusExcludeFolders: string[];

	// Capture & Sections
	/** Full heading line each capture button appends under */
	captureTargets: Record<CaptureKind, string>;
	/** moment formats resolving each periodic note's vault path (no .md) */
	periodicFormats: Record<NoteScope, string>;
	/** Persisted section-mode chip selection per scope (capture view) */
	sectionSelections: Record<NoteScope, string[]>;
	/** Persisted selection for the left Focus panel */
	focusSections: string[];
	focusScope: NoteScope;
	/** Reading-mode toggles, persisted per surface */
	sectionsReadingMode: boolean;
	focusReadingMode: boolean;

	// Voice capture
	groqApiKey: string;
	groqModel: string;
}

export const DEFAULT_SETTINGS: ShawnsToolboxSettings = {
	// Off by default: the Tasks plugin already stamps completion dates on `#task`
	// lines, and enabling this plugin should not silently change task behaviour.
	checkboxStampingEnabled: false,
	includeTime: false,
	excludePatterns: ["#task"],
	dateFormat: "YYYY-MM-DD",

	blockSummarizerEnabled: true,
	geminiApiKey: "",
	geminiModel: "gemini-2.5-flash",

	statusFooterEnabled: true,
	statusExcludeFolders: ["00. Timeline", "AGENTS"],

	captureTargets: {
		thought: "# Thoughts",
		doToday: "### Do Today",
		otherTask: "### Other tasks",
		log: "# Logs",
	},
	periodicFormats: {
		day: "[00. Timeline/]YYYY-MM-DD",
		week: "[00. Timeline/]gggg-[W]ww",
		month: "[00. Timeline/]YYYY-MM",
		quarter: "[00. Timeline/]YYYY-[Q]Q",
	},
	sectionSelections: { day: [], week: [], month: [], quarter: [] },
	focusSections: ["## Plan for Today"],
	focusScope: "day",
	sectionsReadingMode: false,
	focusReadingMode: false,

	groqApiKey: "",
	groqModel: "whisper-large-v3-turbo",
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

		// Note Status section
		containerEl.createEl("h3", { text: "Note Status" });

		containerEl.createEl("p", {
			text: "Set a note's phase (simmering / on / active) and stamp the date it changed. 'ongoing' is a separate axis and can be combined with any phase, or stand alone.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Show status footer in notes")
			.setDesc(
				"Render the status checkboxes at the bottom of each note. The sidebar panel is unaffected."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.statusFooterEnabled)
					.onChange(async (value) => {
						this.plugin.settings.statusFooterEnabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Exclude folders")
			.setDesc(
				"Notes under these folders get no status footer. One per line."
			)
			.addTextArea((text) => {
				text
					.setPlaceholder("00. Timeline\nAGENTS")
					.setValue(
						this.plugin.settings.statusExcludeFolders.join("\n")
					)
					.onChange(async (value) => {
						this.plugin.settings.statusExcludeFolders = value
							.split("\n")
							.map((p) => p.trim())
							.filter((p) => p.length > 0);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
				text.inputEl.cols = 30;
			});

		// Capture & Sections section
		containerEl.createEl("h3", { text: "Capture & Sections" });

		containerEl.createEl("p", {
			text: "Each capture button appends under a heading in today's daily note. Specify the full heading line (hashes included).",
			cls: "setting-item-description",
		});

		const targetLabels: Array<
			[keyof ShawnsToolboxSettings["captureTargets"], string]
		> = [
			["thought", "Thought button target"],
			["doToday", "Do Today button target"],
			["otherTask", "Other Task button target"],
			["log", "Log button target"],
		];
		for (const [kind, label] of targetLabels) {
			new Setting(containerEl).setName(label).addText((text) =>
				text
					.setValue(this.plugin.settings.captureTargets[kind])
					.onChange(async (value) => {
						this.plugin.settings.captureTargets[kind] =
							value.trim() ||
							DEFAULT_SETTINGS.captureTargets[kind];
						await this.plugin.saveSettings();
					})
			);
		}

		containerEl.createEl("p", {
			text: "Periodic note paths as moment formats (no .md). Literal text goes in [brackets].",
			cls: "setting-item-description",
		});

		const scopeLabels: Array<
			[keyof ShawnsToolboxSettings["periodicFormats"], string]
		> = [
			["day", "Daily note format"],
			["week", "Weekly note format"],
			["month", "Monthly note format"],
			["quarter", "Quarterly note format"],
		];
		for (const [scope, label] of scopeLabels) {
			new Setting(containerEl).setName(label).addText((text) =>
				text
					.setValue(this.plugin.settings.periodicFormats[scope])
					.onChange(async (value) => {
						this.plugin.settings.periodicFormats[scope] =
							value.trim() ||
							DEFAULT_SETTINGS.periodicFormats[scope];
						await this.plugin.saveSettings();
					})
			);
		}

		// Voice capture section
		containerEl.createEl("h3", { text: "Voice capture" });

		containerEl.createEl("p", {
			text: "The voice panel records audio, transcribes it with Groq Whisper, and routes the text like a typed capture.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Groq API key")
			.setDesc("Get one at https://console.groq.com/keys")
			.addText((text) => {
				text
					.setPlaceholder("Enter your API key")
					.setValue(this.plugin.settings.groqApiKey)
					.onChange(async (value) => {
						this.plugin.settings.groqApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
				text.inputEl.style.width = "300px";
			});

		new Setting(containerEl)
			.setName("Groq transcription model")
			.addText((text) =>
				text
					.setPlaceholder("whisper-large-v3-turbo")
					.setValue(this.plugin.settings.groqModel)
					.onChange(async (value) => {
						this.plugin.settings.groqModel =
							value.trim() || DEFAULT_SETTINGS.groqModel;
						await this.plugin.saveSettings();
					})
			);
	}
}
