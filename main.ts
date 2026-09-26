import { Notice, Platform, Plugin, WorkspaceLeaf, TFile } from "obsidian";
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
import { MentionsFooter } from "./mentions-footer";
import { ThreadService } from "./thread-service";
import { renderThreadsBlock } from "./threads-block-view";
import { findConflicts, formatConflictReport } from "./status-conflicts";
import { todayIso } from "./status-service";
import { sanitizeScopeAnchors } from "./date-nav";
import { ensureDailyNote, logicalTodayIso } from "./capture-service";
import { CaptureView, CAPTURE_VIEW_TYPE } from "./capture-view";
import {
	CaptureSideView,
	CAPTURE_SIDE_VIEW_TYPE,
} from "./capture-side-view";
import { SectionsView, SECTIONS_VIEW_TYPE } from "./sections-view";
import {
	FocusFullView,
	FocusView,
	FOCUS_FULL_VIEW_TYPE,
	FOCUS_VIEW_TYPE,
} from "./focus-view";
import { VoiceView, VOICE_VIEW_TYPE } from "./voice-view";
import { ThreadsView, THREADS_VIEW_TYPE, toggleThreadsTilesMode } from "./threads-view";
import { lastThreadRename, undoWithNotice } from "./thread-rename";
import { PillarsView, PILLARS_VIEW_TYPE } from "./pillars-view";
import { GuidingQuestionsView, GUIDING_VIEW_TYPE } from "./guiding-view";
import { HighlightsView, HIGHLIGHTS_VIEW_TYPE } from "./highlights-view";
import { DreamsView, DREAMS_VIEW_TYPE } from "./dreams-view";
import { VSearchView, VSEARCH_VIEW_TYPE } from "./vsearch-view";
import { DualPanelView, DUAL_VIEW_TYPE, DUAL_LEFT_VIEW_TYPE } from "./dual-view";
import { DrawerChrome } from "./drawer-chrome";
import { openVaultChooser } from "./settings";
import { fileShareToNote, registerFilingMenu } from "./filing-service";
import type { CardsHost } from "./section-cards";
import { stopOverlayRelay, toggleLeafFullscreen, toggleLeafToolbar } from "./web-fullscreen";
import { WebviewHotkeys } from "./webview-hotkeys";
import { registerEditorTagMenu } from "./editor-tag-menu";
import {
	applyStatusBarAutohide,
	STATUSBAR_AUTOHIDE_CLASS,
} from "./statusbar-core";
import {
	FOCUS_MODE_CLASS,
	FOCUS_MODE_HOTKEY,
	FOCUS_MODE_VIEW_HEADERS_CLASS,
	applyFocusMode,
	initialFocusMode,
	osFullscreenStep,
} from "./focus-mode-core";

export default class ShawnsToolboxPlugin extends Plugin {
	settings: ShawnsToolboxSettings = DEFAULT_SETTINGS;
	private handlerState: CheckboxHandlerState = {
		settings: DEFAULT_SETTINGS,
		enabled: true,
	};
	private statusFooter: StatusFooter | null = null;
	private drawerChrome: DrawerChrome | null = null;
	private webviewHotkeys: WebviewHotkeys | null = null;
	/** True while the OS full screen is one focus mode turned on (so we may turn it off). */
	private focusOwnsOsFullscreen = false;
	private mentionsFooter: MentionsFooter | null = null;
	/** Shared across ```threads block renders so the mtime cache persists. */
	private threadService: ThreadService | null = null;

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
			STATUS_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new StatusView(leaf, host)
		);
		this.registerView(
			CAPTURE_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new CaptureView(leaf, host)
		);
		this.registerView(
			CAPTURE_SIDE_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new CaptureSideView(leaf, host)
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
			FOCUS_FULL_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new FocusFullView(leaf, host)
		);
		this.registerView(
			VOICE_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new VoiceView(leaf, host)
		);
		this.registerView(
			THREADS_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new ThreadsView(leaf, host)
		);
		this.registerView(
			PILLARS_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new PillarsView(leaf, host)
		);
		this.registerView(
			GUIDING_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new GuidingQuestionsView(leaf, host)
		);
		this.registerView(
			HIGHLIGHTS_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new HighlightsView(leaf, host)
		);
		this.registerView(
			DREAMS_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new DreamsView(leaf, host)
		);
		this.registerView(
			VSEARCH_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new VSearchView(leaf, host)
		);
		// Two panels stacked in one leaf — the only way to see two toolbox
		// surfaces at once in the phone drawer, which shows one panel at a time.
		this.registerView(
			DUAL_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new DualPanelView(leaf, host, "right")
		);
		this.registerView(
			DUAL_LEFT_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new DualPanelView(leaf, host, "left")
		);

		this.addCommand({
			id: "open-capture-view",
			name: "Open capture view",
			callback: () => void this.activateView(CAPTURE_VIEW_TYPE, "main"),
		});
		this.addCommand({
			id: "open-capture-panel",
			name: "Open capture panel",
			callback: () =>
				void this.activateView(CAPTURE_SIDE_VIEW_TYPE, "right"),
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
			id: "open-focus-full",
			name: "Open focus full screen",
			callback: () =>
				void this.activateView(FOCUS_FULL_VIEW_TYPE, "main"),
		});
		this.addCommand({
			id: "open-voice-panel",
			name: "Open voice capture panel",
			callback: () => void this.activateView(VOICE_VIEW_TYPE, "right"),
		});
		this.addCommand({
			id: "open-threads-panel",
			name: "Open threads panel",
			callback: () => void this.activateView(THREADS_VIEW_TYPE, "right"),
		});
		this.addCommand({
			id: "threads-toggle-tiles",
			name: "Threads: toggle tiles view",
			callback: () =>
				void (async () => {
					const open = await toggleThreadsTilesMode(host);
					if (open === 0) await this.activateView(THREADS_VIEW_TYPE, "right");
				})(),
		});
		this.addCommand({
			id: "open-pillars-panel",
			name: "Open pillars panel",
			callback: () => void this.activateView(PILLARS_VIEW_TYPE, "right"),
		});
		this.addCommand({
			id: "open-guiding-panel",
			name: "Open guiding questions panel",
			callback: () => void this.activateView(GUIDING_VIEW_TYPE, "right"),
		});
		this.addCommand({
			id: "open-highlights-panel",
			name: "Open highlights panel",
			callback: () =>
				void this.activateView(HIGHLIGHTS_VIEW_TYPE, "right"),
		});
		this.addCommand({
			id: "open-dreams-panel",
			name: "Open dreams panel",
			callback: () => void this.activateView(DREAMS_VIEW_TYPE, "right"),
		});
		this.addCommand({
			id: "open-vsearch-panel",
			name: "Open vault search panel",
			callback: () => void this.activateView(VSEARCH_VIEW_TYPE, "right"),
		});
		this.addCommand({
			id: "open-dual-panel",
			name: "Open dual panel",
			callback: () => void this.activateView(DUAL_VIEW_TYPE, "right"),
		});
		this.addCommand({
			id: "open-dual-panel-left",
			name: "Open dual panel (left)",
			callback: () => void this.activateView(DUAL_LEFT_VIEW_TYPE, "left"),
		});
		// Desktop has no swipe; the dots work, but a hotkey is nicer.
		for (const [id, name, dir] of [
			["dual-panel-next-page", "Dual panel: next page", 1],
			["dual-panel-previous-page", "Dual panel: previous page", -1],
		] as const) {
			this.addCommand({
				id,
				name,
				checkCallback: (checking) => {
					const active = this.app.workspace.activeLeaf?.view;
					const view =
						active instanceof DualPanelView
							? active
							: [...this.app.workspace.getLeavesOfType(DUAL_VIEW_TYPE), ...this.app.workspace.getLeavesOfType(DUAL_LEFT_VIEW_TYPE)]
								.map((l) => l.view)
								.find((v): v is DualPanelView => v instanceof DualPanelView);
					if (!view) return false;
					if (!checking) void view.stepPage(dir);
					return true;
				},
			});
		}
		// ---- Auto-hide status bar (v1.53.0, desktop only) ----
		this.refreshStatusBarAutohide();
		this.addCommand({
			id: "toggle-autohide-status-bar",
			name: "Toggle auto-hide status bar",
			checkCallback: (checking) => {
				if (Platform.isMobile) return false;
				if (!checking) void this.toggleStatusBarAutohide();
				return true;
			},
		});

		// ---- Focus mode (v1.55.0, desktop only) ----
		// Hides the tab-header strips + titlebar (styles.css). Toggled by the
		// same hotkey in both directions; Escape is deliberately NOT bound — the
		// Web viewer page needs it. Mod+Shift+F11 carries a modifier-free F-key,
		// so v1.54.0's Web viewer forwarding picks it up from bakedHotkeys.
		if (Platform.isDesktopApp && !Platform.isMobile) {
			if (initialFocusMode(this.settings) !== this.settings.focusModeOn) {
				this.settings.focusModeOn = true;
				void this.saveData(this.settings);
			}
			this.refreshFocusMode();
		}
		this.addCommand({
			id: "toggle-focus-mode",
			name: "Toggle focus mode (hide tab bars)",
			hotkeys: [{ modifiers: [...FOCUS_MODE_HOTKEY.modifiers], key: FOCUS_MODE_HOTKEY.key }],
			checkCallback: (checking) => {
				if (!Platform.isDesktopApp || Platform.isMobile) return false;
				if (!checking) void this.setFocusMode(!this.settings.focusModeOn, true);
				return true;
			},
		});

		// ---- Web viewer hotkeys (v1.54.0, desktop only) ----
		if (Platform.isDesktopApp) {
			this.webviewHotkeys = new WebviewHotkeys(this.app, () => this.settings);
			this.app.workspace.onLayoutReady(() => this.refreshWebviewHotkeys());
			this.registerEvent(
				this.app.workspace.on("layout-change", () => this.webviewHotkeys?.requestScan())
			);
			this.registerEvent(
				this.app.workspace.on("active-leaf-change", () => this.webviewHotkeys?.requestScan())
			);
		}

		// ---- Web viewer fullscreen ----

		this.addCommand({
			id: "toggle-web-fullscreen",
			name: "Toggle fullscreen (hides web viewer toolbar)",
			hotkeys: [{ modifiers: [], key: "F11" }],
			callback: () => void toggleLeafFullscreen(this.app),
		});
		// ---- Threads: undo the last rename (v1.52.0) ----
		this.addCommand({
			id: "undo-last-thread-rename",
			name: "Undo last thread rename",
			checkCallback: (checking) => {
				const record = lastThreadRename();
				if (!record) return false;
				if (!checking) {
					const service =
						this.threadService ?? new ThreadService(this.app, () => this.settings);
					void undoWithNotice(
						{
							app: this.app,
							getSettings: () => this.settings,
							saveSettings: () => this.saveSettings(),
							isScannablePath: (p) => service.isScannablePath(p),
						},
						record
					);
				}
				return true;
			},
		});
		this.addCommand({
			id: "toggle-web-toolbar",
			name: "Toggle web viewer toolbar",
			callback: () => {
				const hidden = toggleLeafToolbar(this.app);
				new Notice(hidden ? "Web viewer toolbar hidden" : "Web viewer toolbar shown");
			},
		});

		this.addRibbonIcon("zap", "Open capture view", () =>
			void this.activateView(CAPTURE_VIEW_TYPE, "main")
		);
		this.addRibbonIcon("pencil-line", "Open capture panel", () =>
			void this.activateView(CAPTURE_SIDE_VIEW_TYPE, "right")
		);
		this.addRibbonIcon("layout-list", "Open sections view", () =>
			void this.activateView(SECTIONS_VIEW_TYPE, "main")
		);
		this.addRibbonIcon("messages-square", "Open threads panel", () =>
			void this.activateView(THREADS_VIEW_TYPE, "right")
		);
		this.addRibbonIcon("layout-grid", "Open pillars panel", () =>
			void this.activateView(PILLARS_VIEW_TYPE, "right")
		);
		this.addRibbonIcon("compass", "Open guiding questions panel", () =>
			void this.activateView(GUIDING_VIEW_TYPE, "right")
		);
		this.addRibbonIcon("star", "Open highlights panel", () =>
			void this.activateView(HIGHLIGHTS_VIEW_TYPE, "right")
		);
		this.addRibbonIcon("moon", "Open dreams panel", () =>
			void this.activateView(DREAMS_VIEW_TYPE, "right")
		);
		this.addRibbonIcon("scan-search", "Open vault search panel", () =>
			void this.activateView(VSEARCH_VIEW_TYPE, "right")
		);
		this.addRibbonIcon("rows-2", "Open dual panel", () =>
			void this.activateView(DUAL_VIEW_TYPE, "right")
		);
		this.addRibbonIcon("panel-left", "Open dual panel (left)", () =>
			void this.activateView(DUAL_LEFT_VIEW_TYPE, "left")
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

		// Phone drawer chrome (v1.42.0): the panel-picker pill moves into the
		// drawer's bottom row. Applied once the layout exists and re-checked on
		// every layout change (idempotent), undone on unload.
		this.drawerChrome = new DrawerChrome(
			this.app,
			() => this.settings.drawerPillInHeader
		);
		this.app.workspace.onLayoutReady(() => this.refreshDrawerChrome());
		this.registerEvent(
			this.app.workspace.on("layout-change", () =>
				this.refreshDrawerChrome()
			)
		);
		this.addCommand({
			id: "open-vault-chooser",
			name: "Switch vault (open the vault chooser)",
			callback: () => openVaultChooser(this.app),
		});

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

		this.mentionsFooter = new MentionsFooter(this.app, () => this.settings);
		const mentions = this.mentionsFooter;
		this.registerEvent(
			this.app.workspace.on("layout-change", () => mentions.refreshAll())
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () =>
				mentions.refreshAll()
			)
		);
		this.registerEvent(
			this.app.metadataCache.on("changed", () => mentions.refreshAll())
		);
		this.app.workspace.onLayoutReady(() => mentions.refreshAll());

		// "Remove #tag" in Obsidian's own editor context menu (v1.51.0).
		registerEditorTagMenu(this);

		// ```threads code block — inline thread views (Feature B). Shares one
		// ThreadService so the per-file mtime cache persists across renders.
		this.threadService = new ThreadService(this.app, () => this.settings);
		const threadService = this.threadService;
		this.registerMarkdownCodeBlockProcessor("threads", (source, el, ctx) => {
			ctx.addChild(renderThreadsBlock(source, el, threadService));
		});

		// ---- Media Inbox filing lane ("File tweet to note") ----
		// Share a tweet/link → Obsidian → this row files it into the Media Inbox
		// library and links it under the picked note's # Resources section.
		this.registerEvent(registerFilingMenu(this.app, () => this.settings));
		// Command entry (desktop has no share sheet): file the URL on the clipboard.
		this.addCommand({
			id: "file-clipboard-url-to-note",
			name: "File clipboard URL to note",
			callback: () => void this.fileClipboardUrl(),
		});

		// Add settings tab
		this.addSettingTab(new ShawnsToolboxSettingTab(this.app, this));

		console.log("Shawn's Toolbox loaded");
	}

	onunload(): void {
		document.body.classList.remove(STATUSBAR_AUTOHIDE_CLASS);
		document.body.classList.remove(FOCUS_MODE_CLASS, FOCUS_MODE_VIEW_HEADERS_CLASS);
		if (this.focusOwnsOsFullscreen) this.electronWindow()?.setFullScreen(false);
		this.webviewHotkeys?.stop();
		stopOverlayRelay();
		this.drawerChrome?.restore();
		this.statusFooter?.unmount();
		this.mentionsFooter?.unmount();
		console.log("Shawn's Toolbox unloaded");
	}

	private async fileClipboardUrl(): Promise<void> {
		try {
			const text = await navigator.clipboard.readText();
			fileShareToNote(this.app, this.settings, text);
		} catch {
			new Notice("Could not read the clipboard");
		}
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
		try {
			const ws = this.app.workspace;
			// Reuse a live leaf of this type. A leaf can survive in the saved
			// layout as a deferred/unloaded placeholder (Obsidian ≥1.7.2) or as
			// an orphan with no parent — revealing one of those is a silent no-op
			// (the "tap the ribbon, nothing happens" bug). Load deferred leaves,
			// detach orphans, and fall through to creating a fresh one.
			for (const leaf of ws.getLeavesOfType(type)) {
				const anyLeaf = leaf as WorkspaceLeaf & {
					parent?: unknown;
					loadIfDeferred?: () => Promise<void>;
				};
				if (!anyLeaf.parent) {
					leaf.detach();
					continue;
				}
				if (typeof anyLeaf.loadIfDeferred === "function") {
					await anyLeaf.loadIfDeferred();
				}
				await ws.revealLeaf(leaf);
				ws.setActiveLeaf(leaf, { focus: true });
				return;
			}
			const leaf =
				side === "main"
					? ws.getLeaf("tab")
					: side === "left"
						? ws.getLeftLeaf(false)
						: ws.getRightLeaf(false);
			if (!leaf) {
				new Notice(`Could not open ${type}: no ${side} pane available`);
				return;
			}
			await leaf.setViewState({ type, active: true });
			await ws.revealLeaf(leaf);
			ws.setActiveLeaf(leaf, { focus: true });
		} catch (e) {
			console.error("Shawn's Toolbox: activateView failed", e);
			new Notice(
				`Could not open view: ${e instanceof Error ? e.message : String(e)}`
			);
		}
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
		// Sanitised copy (v1.46.0): a stored anchor is only honoured when it
		// is a real ISO date, and the fresh object keeps per-scope writes off
		// the module-level DEFAULT_SETTINGS.
		this.settings.focusAnchors = sanitizeScopeAnchors(
			this.settings.focusAnchors
		);
		this.settings.focusPrevAnchors = sanitizeScopeAnchors(
			this.settings.focusPrevAnchors
		);
		this.settings.pillarSectionSelections = {
			...DEFAULT_SETTINGS.pillarSectionSelections,
			...this.settings.pillarSectionSelections,
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

	/** Add or remove the status-bar auto-hide body class for the current setting. */
	refreshStatusBarAutohide(): void {
		applyStatusBarAutohide(
			document.body.classList,
			this.settings.autohideStatusBar,
			Platform.isMobile
		);
	}

	private async toggleStatusBarAutohide(): Promise<void> {
		this.settings.autohideStatusBar = !this.settings.autohideStatusBar;
		await this.saveSettings();
		this.refreshStatusBarAutohide();
		new Notice(
			this.settings.autohideStatusBar
				? "Status bar auto-hide on — hover the bottom-right corner to show it"
				: "Status bar auto-hide off"
		);
	}

	/** Apply focus mode (body classes + optional OS full screen) for the current settings. */
	refreshFocusMode(): void {
		const active = applyFocusMode(
			document.body.classList,
			this.settings.focusModeOn,
			this.settings.focusModeHideViewHeaders,
			Platform.isMobile || !Platform.isDesktopApp
		);
		const win = this.electronWindow();
		if (!win) return;
		const step = osFullscreenStep(
			active,
			this.settings.focusModeOsFullscreen,
			win.isFullScreen(),
			this.focusOwnsOsFullscreen
		);
		if (step.action === "enter") win.setFullScreen(true);
		else if (step.action === "leave") win.setFullScreen(false);
		this.focusOwnsOsFullscreen = step.owned;
	}

	/** Turn focus mode on or off, remember it, and optionally say so. */
	async setFocusMode(on: boolean, notify = false): Promise<void> {
		if (Platform.isMobile || !Platform.isDesktopApp) return;
		this.settings.focusModeOn = on;
		await this.saveSettings();
		this.refreshFocusMode();
		if (notify) {
			new Notice(
				on
					? "Focus mode on — Ctrl/Cmd+Shift+F11 or the command palette turns it off"
					: "Focus mode off"
			);
		}
	}

	/** The Electron BrowserWindow via @electron/remote; null when unavailable. */
	private electronWindow(): { isFullScreen(): boolean; setFullScreen(on: boolean): void } | null {
		try {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const electron = (window as unknown as { require?: (m: string) => any }).require?.("electron");
			const win = electron?.remote?.getCurrentWindow?.();
			return win && typeof win.setFullScreen === "function" ? win : null;
		} catch {
			return null;
		}
	}

	/** Start, stop or re-apply Web viewer hotkey forwarding after a settings change. */
	refreshWebviewHotkeys(): void {
		this.webviewHotkeys?.refresh();
	}

	/** Re-apply (or undo) the drawer pill move after a settings change. */
	refreshDrawerChrome(): void {
		this.drawerChrome?.apply();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Update the shared state so extensions pick up new settings immediately
		this.handlerState.settings = this.settings;
		this.handlerState.enabled = this.settings.checkboxStampingEnabled;
		this.statusFooter?.refreshAll();
		this.mentionsFooter?.refreshAll();
	}
}
