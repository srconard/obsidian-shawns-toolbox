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

	// Threads panel
	/** Folders the Threads panel does not scan for #thread/#thought posts. */
	threadScanExcludeFolders: string[];

	// Capture & Sections
	/** Full heading line each capture button appends under */
	captureTargets: Record<CaptureKind, string>;
	/** moment formats resolving each periodic note's vault path (no .md) */
	periodicFormats: Record<NoteScope, string>;
	/** Captures before this hour (0–23) count as the previous day */
	dayRolloverHour: number;
	/** Daily note template, rendered when capture targets a missing day */
	dailyTemplatePath: string;
	/** Folder holding Templater includes (and its "Day Tasks/" subfolder) */
	templaterFolder: string;
	/** Persisted section chip selection per scope (sections view) */
	sectionSelections: Record<NoteScope, string[]>;
	/** Persisted selection per scope for the left Focus panel */
	focusSectionSelections: Record<NoteScope, string[]>;
	focusScope: NoteScope;
	/** Reading-mode toggles, persisted per surface */
	sectionsReadingMode: boolean;
	focusReadingMode: boolean;
	/** Chip-row collapse state, persisted per surface */
	sectionsChipsCollapsed: boolean;
	focusChipsCollapsed: boolean;

	// Pillars panel
	/** Note the pillar ring is parsed from (wikilinks under # Pillars). */
	pillarsNotePath: string;
	/** Persisted section chip selection per pillar note path. */
	pillarSectionSelections: Record<string, string[]>;
	pillarReadingMode: boolean;
	pillarChipsCollapsed: boolean;
	/** Last-viewed pillar (its wikilink text), restored across sessions. */
	lastPillarLink: string;

	// Voice capture
	groqApiKey: string;
	groqModel: string;
	/** OpenAI Whisper model used as the STT fallback when Groq fails. */
	openaiSttModel: string;
	/** Folder that failed (untranscribable) recordings are parked in. */
	voiceFailuresFolder: string;

	// AI Thought (voice → summary + bullets)
	/** Which model turns the transcript into bullets. */
	aiThoughtProvider: "gemini" | "openai";
	openaiApiKey: string;
	openaiModel: string;
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

	threadScanExcludeFolders: ["AGENTS", "Settings"],

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
		year: "[00. Timeline/]YYYY",
	},
	dayRolloverHour: 4,
	dailyTemplatePath: "Settings/Templates/Day/Daily Note Template.md",
	templaterFolder: "Settings/Templater",
	sectionSelections: { day: [], week: [], month: [], quarter: [], year: [] },
	focusSectionSelections: {
		day: ["## Plan for Today"],
		week: [],
		month: [],
		quarter: [],
		year: [],
	},
	focusScope: "day",
	sectionsReadingMode: false,
	focusReadingMode: false,
	sectionsChipsCollapsed: false,
	focusChipsCollapsed: false,

	pillarsNotePath: "01. Default/Pillars.md",
	pillarSectionSelections: {},
	pillarReadingMode: false,
	pillarChipsCollapsed: false,
	lastPillarLink: "",

	groqApiKey: "",
	groqModel: "whisper-large-v3-turbo",
	openaiSttModel: "whisper-1",
	voiceFailuresFolder: "Voice Failures",

	aiThoughtProvider: "gemini",
	openaiApiKey: "",
	openaiModel: "gpt-luna",
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

		containerEl.createEl("h2", {
			text: `Shawn's Toolbox Settings — v${this.plugin.manifest.version}`,
		});

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

		// Threads panel section
		containerEl.createEl("h3", { text: "Threads panel" });

		containerEl.createEl("p", {
			text: "The Threads panel scans every note for #thread/<name> and #thought/<period> lines, except notes under the folders listed here.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Exclude folders")
			.setDesc(
				"Notes under these folders are not scanned for thread posts. One per line."
			)
			.addTextArea((text) => {
				text
					.setPlaceholder("AGENTS\nSettings")
					.setValue(
						this.plugin.settings.threadScanExcludeFolders.join("\n")
					)
					.onChange(async (value) => {
						this.plugin.settings.threadScanExcludeFolders = value
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
			["year", "Yearly note format"],
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

		new Setting(containerEl)
			.setName("Day rollover hour")
			.setDesc(
				'"My day ends at 4 AM": captures and the Today scope before this hour (0–23) count as the previous day. 0 = plain midnight.'
			)
			.addText((text) => {
				text
					.setValue(String(this.plugin.settings.dayRolloverHour))
					.onChange(async (value) => {
						const n = Number(value.trim());
						this.plugin.settings.dayRolloverHour =
							Number.isInteger(n) && n >= 0 && n <= 23
								? n
								: DEFAULT_SETTINGS.dayRolloverHour;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "number";
				text.inputEl.min = "0";
				text.inputEl.max = "23";
				text.inputEl.style.width = "60px";
			});

		new Setting(containerEl)
			.setName("Daily note template")
			.setDesc(
				"Rendered (create-daily-note style) when a capture targets a day whose note doesn't exist yet."
			)
			.addText((text) => {
				text
					.setValue(this.plugin.settings.dailyTemplatePath)
					.onChange(async (value) => {
						this.plugin.settings.dailyTemplatePath =
							value.trim() ||
							DEFAULT_SETTINGS.dailyTemplatePath;
						await this.plugin.saveSettings();
					});
				text.inputEl.style.width = "300px";
			});

		new Setting(containerEl)
			.setName("Templater folder")
			.setDesc(
				'Folder the template\'s includes resolve against (holds "Day Tasks/").'
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.templaterFolder)
					.onChange(async (value) => {
						this.plugin.settings.templaterFolder =
							value.trim() || DEFAULT_SETTINGS.templaterFolder;
						await this.plugin.saveSettings();
					})
			);

		// Pillars panel section
		containerEl.createEl("h3", { text: "Pillars panel" });

		containerEl.createEl("p", {
			text: "The Pillars panel cycles through the pillar notes linked under the '# Pillars' section of this note, showing per-pillar the sections you pick (like the Focus panel).",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Pillars note path")
			.setDesc(
				"The note whose '# Pillars' wikilinks form the ring (path with .md)."
			)
			.addText((text) => {
				text
					.setPlaceholder("01. Default/Pillars.md")
					.setValue(this.plugin.settings.pillarsNotePath)
					.onChange(async (value) => {
						this.plugin.settings.pillarsNotePath =
							value.trim() || DEFAULT_SETTINGS.pillarsNotePath;
						await this.plugin.saveSettings();
					});
				text.inputEl.style.width = "300px";
			});

		// Voice capture section
		containerEl.createEl("h3", { text: "Voice capture" });

		containerEl.createEl("p", {
			text: "The voice panel records audio, transcribes it with Groq Whisper (OpenAI whisper-1 fallback), and routes the text like a typed capture. If every provider fails the raw audio is parked in the vault instead of lost.",
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

		new Setting(containerEl)
			.setName("OpenAI transcription model (fallback)")
			.setDesc(
				"Tried when Groq fails, using the OpenAI API key in the AI Thought section below."
			)
			.addText((text) =>
				text
					.setPlaceholder("whisper-1")
					.setValue(this.plugin.settings.openaiSttModel)
					.onChange(async (value) => {
						this.plugin.settings.openaiSttModel =
							value.trim() || DEFAULT_SETTINGS.openaiSttModel;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Voice failures folder")
			.setDesc(
				"When transcription fails on every provider, the raw audio is saved here (timestamped) so nothing is lost."
			)
			.addText((text) =>
				text
					.setPlaceholder("Voice Failures")
					.setValue(this.plugin.settings.voiceFailuresFolder)
					.onChange(async (value) => {
						this.plugin.settings.voiceFailuresFolder =
							value.trim() ||
							DEFAULT_SETTINGS.voiceFailuresFolder;
						await this.plugin.saveSettings();
					})
			);

		// AI Thought section
		containerEl.createEl("h3", { text: "AI Thought" });

		containerEl.createEl("p", {
			text: "The AI Thought voice button turns a rambling transcript into a bold headline + bullets. Pick which model does it. Gemini uses the Block Summarizer key above.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Provider")
			.addDropdown((drop) =>
				drop
					.addOption("gemini", "Gemini (Block Summarizer key)")
					.addOption("openai", "OpenAI")
					.setValue(this.plugin.settings.aiThoughtProvider)
					.onChange(async (value) => {
						this.plugin.settings.aiThoughtProvider =
							value === "openai" ? "openai" : "gemini";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("OpenAI API key")
			.setDesc(
				"Used for AI Thought when the provider above is OpenAI, and as the voice-transcription fallback when Groq fails."
			)
			.addText((text) => {
				text
					.setPlaceholder("Enter your API key")
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
				text.inputEl.style.width = "300px";
			});

		new Setting(containerEl)
			.setName("OpenAI model")
			.addText((text) =>
				text
					.setPlaceholder("gpt-luna")
					.setValue(this.plugin.settings.openaiModel)
					.onChange(async (value) => {
						this.plugin.settings.openaiModel =
							value.trim() || DEFAULT_SETTINGS.openaiModel;
						await this.plugin.saveSettings();
					})
			);
	}
}
