// foreign-core.ts — the pure half of "host ANY registered Obsidian view in a
// dual-panel half" (v1.40.0).
//
// Shawn, 2026-09-08 (eco-web): "For the dual side panel we made — is it possible
// to put other views in there that are not in the toolbox? It would be nice to
// select any but specifically the calendar. Can we figure out how to do it so
// that anything in the side panel can go in there?" (echoing his 2026-08-22
// capture, "add more things to side panel like calendar").
//
// A dual half can now show either a toolbox panel (a `ToolboxPanel` from
// panel-registry.ts) or ANY view type in `app.viewRegistry` — core sidebar views
// (Outline, Backlinks, Search, Tags, Bookmarks, …) and community-plugin views
// (Calendar). This file decides WHICH view types are offerable and WHAT they are
// called; the mounting itself is glue and lives in foreign-host.ts.
//
// No Obsidian imports, so it is unit tested directly (tests/foreign-core.test.ts).

/**
 * Selection ids are stored in settings (`dualTopPanel` / `dualBottomPanel`).
 * A toolbox panel keeps its bare id ("capture"); a hosted Obsidian view is
 * namespaced ("view:calendar") so the two can never collide and so a stored id
 * says which kind it is without consulting any registry.
 */
export const FOREIGN_PREFIX = "view:";

/** One Obsidian view type offered in the selector menu. */
export interface ForeignViewSpec {
	/** Selection id — "view:<type>". */
	id: string;
	/** The view type as registered in `app.viewRegistry`. */
	type: string;
	label: string;
	icon: string;
}

export function foreignId(type: string): string {
	return FOREIGN_PREFIX + type;
}

export function isForeignId(id: unknown): id is string {
	return typeof id === "string" && id.startsWith(FOREIGN_PREFIX) && id.length > FOREIGN_PREFIX.length;
}

/** The view type inside a foreign selection id, or null if it isn't one. */
export function foreignType(id: unknown): string | null {
	return isForeignId(id) ? id.slice(FOREIGN_PREFIX.length) : null;
}

/**
 * View types we deliberately never offer.
 *
 * The **file views** (`markdown`, `canvas`, `pdf`, `image`, `audio`, `video`,
 * `bases`) are excluded because they are meaningless without a file: opening one
 * through `setViewState({type})` with no state gives an empty shell, and a half
 * that can only ever be blank is worse than not offering it. `empty` and
 * `release-notes` are Obsidian's own scaffolding.
 *
 * Toolbox views are excluded separately (see `isToolboxViewType`) — their
 * panels are already the first half of the menu, and mounting a toolbox view
 * type here would run a *second* live copy of a panel that the duplicate guard
 * in dual-core exists to prevent.
 */
export const EXCLUDED_VIEW_TYPES: readonly string[] = [
	"empty",
	"release-notes",
	"markdown",
	"canvas",
	"pdf",
	"image",
	"audio",
	"video",
	"bases",
];

/** Our own view types — offered as panels, never as hosted views. */
export function isToolboxViewType(type: string): boolean {
	return type.startsWith("shawns-toolbox");
}

/**
 * Readable names for the view types we know by sight. Anything not listed
 * (every community plugin) falls back to `humanizeViewType`, which is why an
 * unknown plugin still reads sanely instead of showing a raw slug.
 */
const VIEW_LABELS: Readonly<Record<string, string>> = {
	"all-properties": "All properties",
	backlink: "Backlinks",
	bookmarks: "Bookmarks",
	calendar: "Calendar",
	"file-explorer": "Files",
	"file-properties": "Properties",
	graph: "Graph",
	localgraph: "Local graph",
	"outgoing-link": "Outgoing links",
	outline: "Outline",
	search: "Search",
	sync: "Sync",
	tag: "Tags",
	"web-viewer": "Web viewer",
	webviewer: "Web viewer",
};

/** Icons for the same known set; anything else gets a neutral panel icon. */
const VIEW_ICONS: Readonly<Record<string, string>> = {
	"all-properties": "archive",
	backlink: "links-coming-in",
	bookmarks: "bookmark",
	calendar: "calendar",
	"file-explorer": "folder",
	"file-properties": "info",
	graph: "git-fork",
	localgraph: "git-fork",
	"outgoing-link": "links-going-out",
	outline: "list",
	search: "search",
	sync: "refresh-cw",
	tag: "tags",
	"web-viewer": "globe",
	webviewer: "globe",
};

export const DEFAULT_VIEW_ICON = "layout-panel-top";

/**
 * Turn a raw view type into something readable: separators become spaces and the
 * first letter is capitalised. `"calendar"` → `"Calendar"`,
 * `"kanban"` → `"Kanban"`, `"my-plugin_side-view"` → `"My plugin side view"`.
 */
export function humanizeViewType(type: string): string {
	const words = String(type)
		.replace(/[-_.:]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!words) return "";
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The label shown for a view type — the known name, else a humanized slug. */
export function viewLabel(type: string): string {
	const known = VIEW_LABELS[type];
	if (known) return known;
	return humanizeViewType(type) || type;
}

/** The icon shown for a view type. */
export function viewIcon(type: string): string {
	return VIEW_ICONS[type] ?? DEFAULT_VIEW_ICON;
}

/**
 * Every view type worth offering, from the raw key list of `app.viewRegistry`.
 * Excluded types and our own toolbox views are dropped, duplicates and junk
 * entries are ignored, and the result is sorted by label so the menu reads
 * alphabetically rather than in registration order (which is arbitrary and
 * changes when a plugin is enabled).
 */
export function listForeignViews(registeredTypes: readonly unknown[]): ForeignViewSpec[] {
	const seen = new Set<string>();
	const out: ForeignViewSpec[] = [];
	for (const raw of registeredTypes ?? []) {
		if (typeof raw !== "string") continue;
		const type = raw.trim();
		if (!type) continue;
		if (seen.has(type)) continue;
		seen.add(type);
		if (EXCLUDED_VIEW_TYPES.includes(type)) continue;
		if (isToolboxViewType(type)) continue;
		out.push({
			id: foreignId(type),
			type,
			label: viewLabel(type),
			icon: viewIcon(type),
		});
	}
	out.sort((a, b) => a.label.localeCompare(b.label) || a.type.localeCompare(b.type));
	return out;
}

/**
 * The spec for a selection id that is foreign but NOT in the offered list — a
 * view whose plugin has since been disabled or uninstalled. The selection is
 * deliberately kept (rather than reset to a default) so that re-enabling the
 * plugin brings the half back exactly as Shawn left it; the menu shows the
 * entry marked unavailable so he can see why the half is a placeholder.
 */
export function missingForeignSpec(id: string): ForeignViewSpec | null {
	const type = foreignType(id);
	if (!type) return null;
	return { id, type, label: viewLabel(type), icon: viewIcon(type) };
}

/**
 * The menu entries for one half: every offered view, plus the current selection
 * when it is a foreign view that is no longer registered (appended at the end,
 * so an unavailable entry never displaces a working one).
 */
export function foreignMenuEntries(
	registeredTypes: readonly unknown[],
	currentId: string
): { spec: ForeignViewSpec; available: boolean }[] {
	const offered = listForeignViews(registeredTypes);
	const entries = offered.map((spec) => ({ spec, available: true }));
	if (isForeignId(currentId) && !offered.some((s) => s.id === currentId)) {
		const spec = missingForeignSpec(currentId);
		if (spec) entries.push({ spec, available: false });
	}
	return entries;
}

/** The label for any selection id, given the toolbox panels' own labels. */
export function selectionLabel(
	id: string,
	panelLabel: (id: string) => string | null
): string {
	const type = foreignType(id);
	if (type) return viewLabel(type);
	return panelLabel(id) ?? id;
}

/** The icon for any selection id, given the toolbox panels' own icons. */
export function selectionIcon(
	id: string,
	panelIcon: (id: string) => string | null
): string {
	const type = foreignType(id);
	if (type) return viewIcon(type);
	return panelIcon(id) ?? "help-circle";
}
