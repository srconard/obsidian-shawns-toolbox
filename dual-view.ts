// dual-view.ts — the Dual panel: TWO toolbox panels stacked inside ONE leaf.
//
// Shawn, 2026-09-08 (voice): "Is there some way for us to open a double panel
// where we can put two things in the side panel for Obsidian?" On desktop the
// sidebar can already be split by dragging a tab into it; on the phone the
// drawer shows exactly one panel at a time, so the split has to live INSIDE a
// view. This is that view: a small header with a selector per half, the two
// panel bodies, and a draggable divider between them.
//
// A half shows either a real ToolboxPanel from the registry — the same class the
// standalone view mounts (panel-base.ts / panel-registry.ts), so behaviour is
// never reimplemented here and each standalone panel keeps working untouched —
// or (v1.40.0) ANY other view type registered with Obsidian, hosted in a
// detached leaf whose container is re-parented into the half (foreign-host.ts).
// Shawn, 2026-09-08: "it would be nice to select any but specifically the
// calendar … so that anything in the side panel can go in there."
//
// Layout notes (the v1.7.5 / v1.36.0 / v1.38.0 footgun, paid forward):
//   - The view's own `.view-content` needs a COMPOUND selector
//     (`div.view-content.stx-dual-root`) to re-assert its flex column, because
//     Obsidian's `.workspace-drawer .view-content` rules (0,2,0) out-specify a
//     single class and would drop the column in the phone drawer.
//   - Each half is `flex-basis: 0` with a flex-grow set from the split ratio —
//     never a percentage height, which would resolve against whichever
//     ancestor happens to have a definite height.
//   - The scrolling element of a half is the element the panel renders into, so
//     panels that track their own scroll offset (Threads) keep working.
import { ItemView, Menu, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type { ToolboxPanel } from "./panel-base";
import type { CardsHost } from "./section-cards";
import { PANEL_IDS, PANEL_SPECS, panelSpec } from "./panel-registry";
import {
	foreignMenuEntries,
	foreignType,
	selectionIcon,
	selectionLabel,
} from "./foreign-core";
import {
	HostedViewSlot,
	registeredViewTypes,
	viewTypeAvailable,
} from "./foreign-host";
import {
	applyDualChoice,
	clampSplitRatio,
	otherHalf,
	ratioChanged,
	ratioFromDrag,
	resolveDualSelection,
	splitGrow,
	swapDualSelection,
	swapSplitRatio,
	type DualHalf,
	type DualSelection,
} from "./dual-core";

export const DUAL_VIEW_TYPE = "shawns-toolbox-dual";

/** Shipped defaults: capture on top, the night's dreams below it. */
const DEFAULT_SELECTION: DualSelection = { top: "capture", bottom: "dreams" };

interface Half {
	/** Flex item that owns this half's share of the height. */
	paneEl: HTMLElement;
	/** The element the panel renders into (and scrolls in); replaced on switch. */
	bodyEl: HTMLElement;
	chipEl: HTMLElement;
	/** Set when this half shows a toolbox panel. */
	panel: ToolboxPanel | null;
	/** Set instead when this half hosts another Obsidian view. */
	hosted: HostedViewSlot | null;
}

export class DualPanelView extends ItemView {
	private selection: DualSelection = DEFAULT_SELECTION;
	private ratio = 0.5;
	private halves: Record<DualHalf, Half> | null = null;
	private dividerEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, private host: CardsHost) {
		super(leaf);
	}

	getViewType(): string {
		return DUAL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Dual panel";
	}

	getIcon(): string {
		return "rows-2";
	}

	async onOpen(): Promise<void> {
		const s = this.host.getSettings();
		this.selection = resolveDualSelection(
			{ top: s.dualTopPanel, bottom: s.dualBottomPanel },
			PANEL_IDS,
			DEFAULT_SELECTION
		);
		this.ratio = clampSplitRatio(s.dualSplitRatio);

		const root = this.contentEl;
		root.empty();
		root.addClass("stx-dual-root");

		const header = root.createDiv("stx-dual-header");
		const topChip = this.createChip(header, "top");
		const swap = header.createEl("button", {
			cls: "stx-dual-swap",
			attr: { "aria-label": "Swap the two panels" },
		});
		setIcon(swap, "arrow-down-up");
		swap.addEventListener("click", () => void this.swap());
		const bottomChip = this.createChip(header, "bottom");

		const topPane = root.createDiv("stx-dual-pane stx-dual-pane-top");
		const divider = root.createDiv("stx-dual-divider");
		divider.createDiv("stx-dual-grip");
		this.dividerEl = divider;
		const bottomPane = root.createDiv("stx-dual-pane stx-dual-pane-bottom");

		this.halves = {
			top: {
				paneEl: topPane,
				bodyEl: topPane.createDiv("stx-dual-body"),
				chipEl: topChip,
				panel: null,
				hosted: null,
			},
			bottom: {
				paneEl: bottomPane,
				bodyEl: bottomPane.createDiv("stx-dual-body"),
				chipEl: bottomChip,
				panel: null,
				hosted: null,
			},
		};

		this.wireDivider(divider);
		this.applyRatio();
		this.mount("top");
		this.mount("bottom");

		// A hosted view's plugin can be enabled or disabled while this view is on
		// screen. Obsidian rebuilds leaves of a vanished type, but ours is not in
		// the workspace tree, so nothing would tell it — without this the half
		// would keep showing a dead copy of a plugin that is no longer running.
		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.verifyHosted())
		);
	}

	async onClose(): Promise<void> {
		for (const half of ["top", "bottom"] as DualHalf[]) {
			this.unmount(half);
		}
		this.halves = null;
		this.dividerEl = null;
	}

	// ---- halves ----

	/** The selector chip for one half: icon + label + chevron, opens a menu. */
	private createChip(parent: HTMLElement, half: DualHalf): HTMLElement {
		const chip = parent.createEl("button", { cls: "stx-dual-chip" });
		chip.addEventListener("click", (evt) =>
			this.showPanelMenu(half, evt)
		);
		return chip;
	}

	private paintChip(half: DualHalf): void {
		const h = this.halves?.[half];
		if (!h) return;
		const id = this.selection[half];
		const label = selectionLabel(id, (x) => panelSpec(x)?.label ?? null);
		const icon = selectionIcon(id, (x) => panelSpec(x)?.icon ?? null);
		h.chipEl.empty();
		const iconEl = h.chipEl.createSpan("stx-dual-chip-icon");
		setIcon(iconEl, icon);
		h.chipEl.createSpan({ cls: "stx-dual-chip-label", text: label });
		const chev = h.chipEl.createSpan("stx-dual-chip-chevron");
		setIcon(chev, "chevron-down");
		h.chipEl.setAttr(
			"aria-label",
			`${half === "top" ? "Top" : "Bottom"} panel: ${label}`
		);
	}

	/**
	 * The half's selector menu: the toolbox panels first (the ones this plugin
	 * owns), then a separator, then every other view type Obsidian has
	 * registered right now — core sidebar views and community-plugin views alike
	 * (foreign-core.ts decides which are offerable and what they are called).
	 * The list is read at open time, not cached, so enabling a plugin makes its
	 * view selectable without reloading anything.
	 */
	private showPanelMenu(half: DualHalf, evt: MouseEvent): void {
		const menu = new Menu();
		const current = this.selection[half];
		const taken = this.selection[otherHalf(half)];
		const add = (
			id: string,
			label: string,
			icon: string,
			available = true
		) => {
			menu.addItem((item) => {
				const title = !available
					? `${label} (unavailable)`
					: id === taken
						? `${label} (swap)`
						: label;
				item
					.setTitle(title)
					.setIcon(icon)
					.setChecked(id === current)
					.onClick(() => void this.choose(half, id));
			});
		};
		for (const spec of PANEL_SPECS) {
			add(spec.id, spec.label, spec.icon);
		}
		const entries = foreignMenuEntries(
			registeredViewTypes(this.app),
			current
		);
		if (entries.length) {
			menu.addSeparator();
			for (const { spec, available } of entries) {
				add(spec.id, spec.label, spec.icon, available);
			}
		}
		menu.showAtMouseEvent(evt);
	}

	/** Mount whatever this half is set to, into a fresh body element. */
	private mount(half: DualHalf): void {
		const h = this.halves?.[half];
		if (!h) return;
		this.paintChip(half);
		const id = this.selection[half];
		const viewType = foreignType(id);
		if (viewType) {
			this.mountForeign(h, viewType);
			this.adoptScope();
			return;
		}
		const spec = panelSpec(id);
		if (!spec) {
			h.bodyEl.createDiv({
				cls: "stx-empty",
				text: "Panel unavailable",
			});
			return;
		}
		try {
			const panel = spec.create(this.host, h.bodyEl);
			h.panel = panel;
			this.addChild(panel);
		} catch (e) {
			console.error("Shawn's Toolbox: dual panel mount failed", e);
			new Notice(
				`Could not open ${spec.label}: ${
					e instanceof Error ? e.message : String(e)
				}`
			);
		}
		this.adoptScope();
	}

	/**
	 * Host another Obsidian view in this half. The mount is async (building a
	 * view state is), so the slot is recorded synchronously and the await guards
	 * against the half having been switched or the whole view closed meanwhile —
	 * otherwise a slow view would appear in a half that has moved on, and its
	 * leaf would never be detached.
	 */
	private mountForeign(h: Half, viewType: string): void {
		const slot = new HostedViewSlot(this.app, h.bodyEl, viewType);
		h.hosted = slot;
		void slot.mount().then(() => {
			if (h.hosted !== slot) {
				slot.dispose();
				return;
			}
			slot.resize();
		});
	}

	/**
	 * Unmount a half and throw its body element away. Panels add their root
	 * class (and sometimes inline styles) to the container they are handed, so a
	 * fresh element is the only way to be sure nothing leaks from the panel that
	 * was there before.
	 */
	private unmount(half: DualHalf): void {
		const h = this.halves?.[half];
		if (!h) return;
		if (h.panel) {
			this.removeChild(h.panel);
			h.panel = null;
		}
		if (h.hosted) {
			// Must happen before the body element goes: an undetached leaf keeps
			// its view loaded and its event handlers live for the whole session.
			h.hosted.dispose();
			h.hosted = null;
		}
		h.bodyEl.remove();
		h.bodyEl = h.paneEl.createDiv("stx-dual-body");
	}

	private async choose(half: DualHalf, id: string): Promise<void> {
		const next = applyDualChoice(this.selection, half, id);
		if (next.top === this.selection.top && next.bottom === this.selection.bottom) {
			return;
		}
		const swapped =
			next.top === this.selection.bottom &&
			next.bottom === this.selection.top;
		this.selection = next;
		if (swapped) this.ratio = swapSplitRatio(this.ratio);
		this.remount(swapped);
		await this.persist();
	}

	private async swap(): Promise<void> {
		this.selection = swapDualSelection(this.selection);
		this.ratio = swapSplitRatio(this.ratio);
		this.remount(true);
		await this.persist();
	}

	/**
	 * Re-check each hosted half against the view types registered right now, and
	 * remount the ones whose availability flipped: a disabled plugin turns its
	 * half into the placeholder, and re-enabling it brings the view back without
	 * Shawn having to touch the selector.
	 */
	private verifyHosted(): void {
		if (!this.halves) return;
		for (const half of ["top", "bottom"] as DualHalf[]) {
			const h = this.halves[half];
			const type = foreignType(this.selection[half]);
			if (!type || !h.hosted) continue;
			if (viewTypeAvailable(this.app, type) === h.hosted.isLive()) continue;
			this.unmount(half);
			this.mount(half);
		}
	}

	private remount(ratioChangedToo: boolean): void {
		this.unmount("top");
		this.unmount("bottom");
		if (ratioChangedToo) this.applyRatio();
		this.mount("top");
		this.mount("bottom");
	}

	/**
	 * Obsidian activates `view.scope` while the view has focus, which is how the
	 * capture panel's Mod+Enter beats Obsidian's own keymap. Adopt whichever
	 * mounted half brought a scope (a panel type can only be in one half).
	 */
	private adoptScope(): void {
		this.scope =
			this.halves?.top.panel?.scope ??
			this.halves?.bottom.panel?.scope ??
			null;
	}

	// ---- the divider ----

	private wireDivider(divider: HTMLElement): void {
		let dragging = false;
		let startY = 0;
		let startRatio = this.ratio;
		let available = 0;

		this.registerDomEvent(divider, "pointerdown", (e: PointerEvent) => {
			dragging = true;
			startY = e.clientY;
			startRatio = this.ratio;
			available = this.availableHeight();
			divider.addClass("is-dragging");
			// Capture keeps the drag alive when the finger leaves the (thin)
			// divider — without it a touch drag dies on the first pixel.
			try {
				divider.setPointerCapture(e.pointerId);
			} catch {
				/* not all platforms expose capture; move events still arrive */
			}
			e.preventDefault();
		});
		this.registerDomEvent(divider, "pointermove", (e: PointerEvent) => {
			if (!dragging) return;
			e.preventDefault();
			this.ratio = ratioFromDrag(startRatio, e.clientY - startY, available);
			this.applyRatio();
		});
		const end = (e: PointerEvent) => {
			if (!dragging) return;
			dragging = false;
			divider.removeClass("is-dragging");
			try {
				divider.releasePointerCapture(e.pointerId);
			} catch {
				/* already released */
			}
			void this.persist();
		};
		this.registerDomEvent(divider, "pointerup", end);
		this.registerDomEvent(divider, "pointercancel", end);
		// Escape hatch on both surfaces: back to an even split.
		this.registerDomEvent(divider, "dblclick", () => {
			this.ratio = 0.5;
			this.applyRatio();
			void this.persist();
		});
	}

	/** Height the two halves share right now (they own all of it between them). */
	private availableHeight(): number {
		const h = this.halves;
		if (!h) return 0;
		return h.top.paneEl.clientHeight + h.bottom.paneEl.clientHeight;
	}

	private applyRatio(): void {
		const h = this.halves;
		if (!h) return;
		const grow = splitGrow(this.ratio);
		h.top.paneEl.style.flexGrow = String(grow.top);
		h.bottom.paneEl.style.flexGrow = String(grow.bottom);
		this.resizeHosted();
	}

	/**
	 * A hosted view lays itself out from its container's size and never gets
	 * Obsidian's own resize notification (it is not in the workspace tree), so
	 * every size change we cause has to be forwarded. Toolbox panels are CSS-only
	 * and need nothing.
	 */
	private resizeHosted(): void {
		this.halves?.top.hosted?.resize();
		this.halves?.bottom.hosted?.resize();
	}

	/** Obsidian resized the leaf (drawer opened, window resized, split moved). */
	onResize(): void {
		this.resizeHosted();
	}

	private async persist(): Promise<void> {
		const s = this.host.getSettings();
		const ratioMoved = ratioChanged(s.dualSplitRatio, this.ratio);
		if (
			!ratioMoved &&
			s.dualTopPanel === this.selection.top &&
			s.dualBottomPanel === this.selection.bottom
		) {
			return;
		}
		s.dualTopPanel = this.selection.top;
		s.dualBottomPanel = this.selection.bottom;
		s.dualSplitRatio = clampSplitRatio(this.ratio);
		await this.host.saveSettings();
	}
}
