import { describe, expect, it } from "vitest";
import {
	DEFAULT_VIEW_ICON,
	EXCLUDED_VIEW_TYPES,
	FOREIGN_PREFIX,
	foreignId,
	foreignMenuEntries,
	foreignType,
	humanizeViewType,
	isForeignId,
	isToolboxViewType,
	listForeignViews,
	missingForeignSpec,
	selectionIcon,
	selectionLabel,
	viewIcon,
	viewLabel,
} from "../foreign-core";

/** The types the NAS Obsidian actually reported from `app.viewRegistry`. */
const LIVE_TYPES = [
	"all-properties",
	"audio",
	"backlink",
	"bases",
	"bookmarks",
	"canvas",
	"file-explorer",
	"file-properties",
	"graph",
	"image",
	"localgraph",
	"markdown",
	"outgoing-link",
	"outline",
	"pdf",
	"release-notes",
	"search",
	"sync",
	"tag",
	"video",
];

describe("foreign selection ids", () => {
	it("namespaces a view type so it can't collide with a panel id", () => {
		expect(foreignId("calendar")).toBe("view:calendar");
		expect(FOREIGN_PREFIX).toBe("view:");
	});

	it("recognises its own ids and nothing else", () => {
		expect(isForeignId("view:calendar")).toBe(true);
		expect(isForeignId("capture")).toBe(false);
		expect(isForeignId("view:")).toBe(false);
		expect(isForeignId("")).toBe(false);
		expect(isForeignId(null)).toBe(false);
		expect(isForeignId(7)).toBe(false);
	});

	it("round-trips the view type", () => {
		expect(foreignType(foreignId("calendar"))).toBe("calendar");
		expect(foreignType("view:my-plugin:side")).toBe("my-plugin:side");
		expect(foreignType("dreams")).toBeNull();
		expect(foreignType(undefined)).toBeNull();
	});
});

describe("humanizeViewType", () => {
	it("capitalises and un-slugs an unknown type", () => {
		expect(humanizeViewType("calendar")).toBe("Calendar");
		expect(humanizeViewType("kanban")).toBe("Kanban");
		expect(humanizeViewType("my-plugin_side-view")).toBe("My plugin side view");
		expect(humanizeViewType("some.other:view")).toBe("Some other view");
	});

	it("survives junk", () => {
		expect(humanizeViewType("")).toBe("");
		expect(humanizeViewType("---")).toBe("");
		expect(humanizeViewType("  spaced  out  ")).toBe("Spaced out");
	});
});

describe("viewLabel / viewIcon", () => {
	it("names the core views the way Obsidian's UI does", () => {
		expect(viewLabel("file-explorer")).toBe("Files");
		expect(viewLabel("backlink")).toBe("Backlinks");
		expect(viewLabel("outgoing-link")).toBe("Outgoing links");
		expect(viewLabel("tag")).toBe("Tags");
		expect(viewLabel("all-properties")).toBe("All properties");
		expect(viewLabel("localgraph")).toBe("Local graph");
	});

	it("names the Calendar community plugin's view", () => {
		expect(viewLabel("calendar")).toBe("Calendar");
		expect(viewIcon("calendar")).toBe("calendar");
	});

	it("falls back to a humanized slug and a neutral icon", () => {
		expect(viewLabel("kanban")).toBe("Kanban");
		expect(viewIcon("kanban")).toBe(DEFAULT_VIEW_ICON);
		// never empty — the chip must always have something to show
		expect(viewLabel("---")).toBe("---");
	});
});

describe("isToolboxViewType", () => {
	it("claims our own view types", () => {
		expect(isToolboxViewType("shawns-toolbox-dual")).toBe(true);
		expect(isToolboxViewType("shawns-toolbox-capture-side")).toBe(true);
		expect(isToolboxViewType("calendar")).toBe(false);
	});
});

describe("listForeignViews", () => {
	const listed = listForeignViews(LIVE_TYPES);
	const types = listed.map((s) => s.type);

	it("offers the core sidebar views", () => {
		for (const t of [
			"backlink",
			"bookmarks",
			"file-explorer",
			"outline",
			"outgoing-link",
			"search",
			"tag",
			"all-properties",
			"file-properties",
			"graph",
		]) {
			expect(types).toContain(t);
		}
	});

	it("drops the file views and Obsidian's own scaffolding", () => {
		for (const t of EXCLUDED_VIEW_TYPES) expect(types).not.toContain(t);
		expect(types).not.toContain("markdown");
		expect(types).not.toContain("pdf");
		expect(types).not.toContain("release-notes");
	});

	it("drops our own toolbox views (they are already panels)", () => {
		const withOurs = listForeignViews([
			...LIVE_TYPES,
			"shawns-toolbox-dual",
			"shawns-toolbox-dreams",
		]).map((s) => s.type);
		expect(withOurs.some((t) => t.startsWith("shawns-toolbox"))).toBe(false);
	});

	it("includes a community plugin's view once it is registered", () => {
		const withCal = listForeignViews([...LIVE_TYPES, "calendar"]);
		expect(withCal.map((s) => s.id)).toContain("view:calendar");
	});

	it("sorts by label, not registration order", () => {
		const labels = listed.map((s) => s.label);
		expect([...labels].sort((a, b) => a.localeCompare(b))).toEqual(labels);
	});

	it("ignores duplicates and junk entries", () => {
		const out = listForeignViews([
			"outline",
			"outline",
			"",
			"   ",
			null,
			42,
			undefined,
		]);
		expect(out.map((s) => s.type)).toEqual(["outline"]);
	});

	it("survives an empty or missing registry", () => {
		expect(listForeignViews([])).toEqual([]);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(listForeignViews(undefined as any)).toEqual([]);
	});
});

describe("missingForeignSpec", () => {
	it("describes a view whose plugin is gone", () => {
		expect(missingForeignSpec("view:calendar")).toEqual({
			id: "view:calendar",
			type: "calendar",
			label: "Calendar",
			icon: "calendar",
		});
	});

	it("is null for a toolbox id", () => {
		expect(missingForeignSpec("capture")).toBeNull();
	});
});

describe("foreignMenuEntries", () => {
	it("marks everything registered as available", () => {
		const entries = foreignMenuEntries(LIVE_TYPES, "capture");
		expect(entries.length).toBeGreaterThan(0);
		expect(entries.every((e) => e.available)).toBe(true);
	});

	it("appends the current selection when its plugin is disabled", () => {
		const entries = foreignMenuEntries(LIVE_TYPES, "view:calendar");
		const last = entries[entries.length - 1];
		expect(last.spec.id).toBe("view:calendar");
		expect(last.available).toBe(false);
	});

	it("does not duplicate the current selection when it is registered", () => {
		const entries = foreignMenuEntries(
			[...LIVE_TYPES, "calendar"],
			"view:calendar"
		);
		expect(entries.filter((e) => e.spec.id === "view:calendar")).toHaveLength(1);
	});

	it("adds nothing extra for a toolbox selection", () => {
		const a = foreignMenuEntries(LIVE_TYPES, "dreams").length;
		const b = foreignMenuEntries(LIVE_TYPES, "capture").length;
		expect(a).toBe(b);
	});
});

describe("selectionLabel / selectionIcon", () => {
	const panelLabel = (id: string) => (id === "capture" ? "Capture" : null);
	const panelIcon = (id: string) => (id === "capture" ? "pencil-line" : null);

	it("uses the panel's own label and icon for a toolbox id", () => {
		expect(selectionLabel("capture", panelLabel)).toBe("Capture");
		expect(selectionIcon("capture", panelIcon)).toBe("pencil-line");
	});

	it("uses the view label and icon for a hosted view", () => {
		expect(selectionLabel("view:calendar", panelLabel)).toBe("Calendar");
		expect(selectionIcon("view:calendar", panelIcon)).toBe("calendar");
	});

	it("still shows something for an id nothing knows", () => {
		expect(selectionLabel("retired", panelLabel)).toBe("retired");
		expect(selectionIcon("retired", panelIcon)).toBe("help-circle");
	});
});
