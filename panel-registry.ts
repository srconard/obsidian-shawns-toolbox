// panel-registry.ts — every toolbox panel that can be mounted into a container,
// as data. The dual panel (dual-view.ts) builds its two selector menus from
// this list and mounts whatever is picked; nothing else needs to know how many
// panels exist.
//
// Adding a panel: convert its body to a ToolboxPanel (panel-base.ts), keep the
// standalone ItemView shell (panel-view.ts), and add one row here.
import type { ToolboxPanel } from "./panel-base";
import type { CardsHost } from "./section-cards";
import { CaptureSidePanel } from "./capture-side-view";
import { ThreadsPanel } from "./threads-view";
import { DreamsPanel } from "./dreams-view";
import { HighlightsPanel } from "./highlights-view";
import { VoicePanel } from "./voice-view";
import { PillarsPanel } from "./pillars-view";
import { FocusPanel } from "./focus-view";
import { SectionsPanel } from "./sections-view";
import { GuidingQuestionsPanel } from "./guiding-view";
import { StatusPanel } from "./status-view";
import { VSearchPanel } from "./vsearch-view";

export interface PanelSpec {
	/** Stable id stored in settings — never rename one without a migration. */
	id: string;
	/** Short label for the dual panel's selector chips. */
	label: string;
	/** Lucide icon, matching the panel's own ribbon icon. */
	icon: string;
	create(host: CardsHost, container: HTMLElement): ToolboxPanel;
}

export const PANEL_SPECS: readonly PanelSpec[] = [
	{
		id: "capture",
		label: "Capture",
		icon: "pencil-line",
		create: (h, c) => new CaptureSidePanel(h, c),
	},
	{
		id: "threads",
		label: "Threads",
		icon: "messages-square",
		create: (h, c) => new ThreadsPanel(h, c),
	},
	{
		id: "dreams",
		label: "Dreams",
		icon: "moon",
		create: (h, c) => new DreamsPanel(h, c),
	},
	{
		id: "highlights",
		label: "Highlights",
		icon: "star",
		create: (h, c) => new HighlightsPanel(h, c),
	},
	{
		id: "voice",
		label: "Voice",
		icon: "mic",
		create: (h, c) => new VoicePanel(h, c),
	},
	{
		id: "pillars",
		label: "Pillars",
		icon: "layout-grid",
		create: (h, c) => new PillarsPanel(h, c),
	},
	{
		id: "focus",
		label: "Focus",
		icon: "list-todo",
		create: (h, c) => new FocusPanel(h, c),
	},
	{
		id: "sections",
		label: "Sections",
		icon: "layout-list",
		create: (h, c) => new SectionsPanel(h, c),
	},
	{
		id: "guiding",
		label: "Guiding questions",
		icon: "compass",
		create: (h, c) => new GuidingQuestionsPanel(h, c),
	},
	{
		id: "status",
		label: "Note status",
		icon: "check-circle",
		create: (h, c) => new StatusPanel(h, c),
	},
	{
		id: "vsearch",
		label: "Vault search",
		icon: "scan-search",
		create: (h, c) => new VSearchPanel(h, c),
	},
] as const;

export const PANEL_IDS: readonly string[] = PANEL_SPECS.map((p) => p.id);

export function panelSpec(id: string): PanelSpec | null {
	return PANEL_SPECS.find((p) => p.id === id) ?? null;
}
