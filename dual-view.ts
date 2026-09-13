// dual-view.ts — the Dual panel: a stack of toolbox panels (or any Obsidian
// views) inside ONE leaf, with swipeable PAGES of such stacks.
//
// Shawn, 2026-09-08 (voice): "Is there some way for us to open a double panel
// where we can put two things in the side panel for Obsidian?" On desktop the
// sidebar can already be split by dragging a tab into it; on the phone the
// drawer shows exactly one panel at a time, so the split has to live INSIDE a
// view. v1.39.0 built that as two halves; v1.40.0 let a half host any Obsidian
// view (foreign-host.ts).
//
// v1.43.0 (Shawn, 2026-09-13): "make it like a multi surface picker where you
// can customize how many panels you want … 2 like in the screenshot but if I
// swipe from the right it goes to another side panel and I should be able to
// choose which one that is — the audio capture right now." So the view now
// holds PAGES (dual-core.ts `DualPage`): each page is a vertical stack of 1–3
// panes, a horizontal swipe (or the page dots) moves between pages, and the
// selector header can be COLLAPSED behind a chevron ("a button at the top that
// will collapse and hide where you select the two panels"). Page 1 of an
// upgraded install is the old two-half layout; page 2 defaults to Voice.
//
// A pane shows either a real ToolboxPanel from the registry — the same class
// the standalone view mounts (panel-base.ts / panel-registry.ts), so behaviour
// is never reimplemented here — or any other registered view type, hosted in a
// detached leaf whose container is re-parented into the pane (foreign-host.ts).
//
// Layout notes (the v1.7.5 / v1.36.0 / v1.38.0 footgun, paid forward):
//   - The view's own `.view-content` needs a COMPOUND selector
//     (`div.view-content.stx-dual-root`) to re-assert its flex column, because
//     Obsidian's `.workspace-drawer .view-content` rules (0,2,0) out-specify a
//     single class and would drop the column in the phone drawer.
//   - Each pane is `flex-basis: 0` with a flex-grow set from its share — never
//     a percentage height, which would resolve against whichever ancestor
//     happens to have a definite height.
//   - The scrolling element of a pane is the element the panel renders into, so
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
	addPage,
	addPane,
	clampPageIndex,
	MAX_PAGES,
	MAX_PANES,
	pageAfterSwipe,
	paneGrows,
	ratiosChanged,
	ratiosFromDrag,
	removePage,
	removePane,
	resolveDualPages,
	reversePage,
	setPagePanel,
	type DualPage,
} from "./dual-core";

export const DUAL_VIEW_TYPE = "shawns-toolbox-dual";

/** Fired on the workspace when the settings tab edits the page list. */
export const DUAL_PAGES_CHANGED = "shawns-toolbox:dual-pages-changed";

/** Shipped defaults for a build with no stored layout at all: capture over dreams. */
const DEFAULT_LEGACY = { top: "capture", bottom: "dreams" };

/** Minimum finger travel (px) for a page swipe. */
const SWIPE_PX = 60;

interface Pane {
	/** Flex item that owns this pane's share of the height. */
	paneEl: HTMLElement;
	/** The element the panel renders into (and scrolls in); replaced on switch. */
	bodyEl: HTMLElement;
	chipEl: HTMLElement;
	/** Set when this pane shows a toolbox panel. */
	panel: ToolboxPanel | null;
	/** Set instead when this pane hosts another Obsidian view. */
	hosted: HostedViewSlot | null;
}

export class DualPanelView extends ItemView {
	private pages: DualPage[] = [];
	private pageIndex = 0;
	private collapsed = false;
	private panes: Pane[] = [];
	private dividers: HTMLElement[] = [];
	private headerEl: HTMLElement | null = null;
	private chipsEl: HTMLElement | null = null;
	private dotsEl: HTMLElement | null = null;
	private stackEl: HTMLElement | null = null;
	private toggleEl: HTMLElement | null = null;

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

	/** The page on screen. */
	private get page(): DualPage {
		return this.pages[this.pageIndex];
	}

	async onOpen(): Promise<void> {
		this.loadLayout();

		const root = this.contentEl;
		root.empty();
		root.addClass("stx-dual-root");

		// ---- header: collapse toggle · chips + swap · ⋯ menu · page dots ----
		const header = root.createDiv("stx-dual-header");
		this.headerEl = header;
		const toggle = header.createEl("button", { cls: "stx-dual-toggle" });
		this.toggleEl = toggle;
		toggle.addEventListener("click", () => void this.setCollapsed(!this.collapsed));
		this.chipsEl = header.createDiv("stx-dual-chips");
		const more = header.createEl("button", {
			cls: "stx-dual-more",
			attr: { "aria-label": "Pages and panes" },
		});
		setIcon(more, "ellipsis");
		more.addEventListener("click", (evt) => this.showLayoutMenu(evt));
		this.dotsEl = header.createDiv("stx-dual-dots");

		// ---- the stack of panes for the current page ----
		this.stackEl = root.createDiv("stx-dual-stack");
		this.wireSwipe(root);

		this.renderPage();
		this.paintHeader();

		// A hosted view's plugin can be enabled or disabled while this view is on
		// screen. Obsidian rebuilds leaves of a vanished type, but ours is not in
		// the workspace tree, so nothing would tell it — without this the pane
		// would keep showing a dead copy of a plugin that is no longer running.
		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.verifyHosted())
		);
		// The settings tab edits the same page list; re-read and re-render.
		this.registerEvent(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(this.app.workspace as any).on(DUAL_PAGES_CHANGED, () => {
				this.unmountAll();
				this.loadLayout();
				this.renderPage();
				this.paintHeader();
			})
		);
	}

	async onClose(): Promise<void> {
		this.unmountAll();
		this.panes = [];
		this.dividers = [];
		this.headerEl = this.chipsEl = this.dotsEl = this.stackEl = this.toggleEl = null;
	}

	// ---- layout state ----

	private loadLayout(): void {
		const s = this.host.getSettings();
		this.pages = resolveDualPages(s.dualPages, PANEL_IDS, {
			selection: {
				top: s.dualTopPanel || DEFAULT_LEGACY.top,
				bottom: s.dualBottomPanel || DEFAULT_LEGACY.bottom,
			},
			ratio: s.dualSplitRatio,
		});
		this.pageIndex = clampPageIndex(s.dualPage, this.pages.length);
		this.collapsed = !!s.dualHeaderCollapsed;
	}

	private async persist(): Promise<void> {
		const s = this.host.getSettings();
		s.dualPages = this.pages.map((p) => ({
			panels: [...p.panels],
			ratios: [...p.ratios],
		}));
		s.dualPage = this.pageIndex;
		s.dualHeaderCollapsed = this.collapsed;
		await this.host.saveSettings();
	}

	private replacePage(next: DualPage): void {
		this.pages = this.pages.map((p, i) => (i === this.pageIndex ? next : p));
	}

	// ---- header ----

	private paintHeader(): void {
		const header = this.headerEl;
		if (!header || !this.chipsEl || !this.dotsEl || !this.toggleEl) return;
		header.toggleClass("is-collapsed", this.collapsed);
		this.contentEl.toggleClass("stx-dual-header-collapsed", this.collapsed);
		this.toggleEl.empty();
		setIcon(this.toggleEl, this.collapsed ? "chevron-down" : "chevron-up");
		this.toggleEl.setAttr(
			"aria-label",
			this.collapsed ? "Show the panel selectors" : "Hide the panel selectors"
		);

		// chips (+ a swap button between the first two when there are exactly two)
		this.chipsEl.empty();
		this.page.panels.forEach((id, slot) => {
			if (slot === 1 && this.page.panels.length === 2) {
				const swap = this.chipsEl!.createEl("button", {
					cls: "stx-dual-swap",
					attr: { "aria-label": "Swap the two panels" },
				});
				setIcon(swap, "arrow-down-up");
				swap.addEventListener("click", () => void this.swap());
			}
			const chip = this.chipsEl!.createEl("button", { cls: "stx-dual-chip" });
			chip.addEventListener("click", (evt) => this.showPanelMenu(slot, evt));
			const label = selectionLabel(id, (x) => panelSpec(x)?.label ?? null);
			const icon = selectionIcon(id, (x) => panelSpec(x)?.icon ?? null);
			const iconEl = chip.createSpan("stx-dual-chip-icon");
			setIcon(iconEl, icon);
			chip.createSpan({ cls: "stx-dual-chip-label", text: label });
			const chev = chip.createSpan("stx-dual-chip-chevron");
			setIcon(chev, "chevron-down");
			chip.setAttr("aria-label", `Pane ${slot + 1}: ${label}`);
			if (this.panes[slot]) this.panes[slot].chipEl = chip;
		});

		// page dots — only when there is somewhere to go
		this.dotsEl.empty();
		this.dotsEl.toggleClass("is-hidden", this.pages.length < 2);
		this.pages.forEach((_, i) => {
			const dot = this.dotsEl!.createEl("button", {
				cls: "stx-dual-dot" + (i === this.pageIndex ? " is-active" : ""),
				attr: { "aria-label": `Page ${i + 1} of ${this.pages.length}` },
			});
			dot.addEventListener("click", () => void this.goToPage(i));
		});

		// Obsidian's drawer closes on a horizontal swipe; on page 2+ a rightward
		// swipe must mean "previous page" instead, so the drawer is told to
		// ignore swipes that start inside this view. On page 1 the stock gesture
		// (swipe right = close) is left alone.
		if (this.pageIndex > 0 && this.pages.length > 1) {
			this.contentEl.setAttr("data-ignore-swipe", "true");
		} else {
			this.contentEl.removeAttribute("data-ignore-swipe");
		}
	}

	private async setCollapsed(collapsed: boolean): Promise<void> {
		if (this.collapsed === collapsed) return;
		this.collapsed = collapsed;
		this.paintHeader();
		this.resizeHosted();
		await this.persist();
	}

	/**
	 * A pane's selector menu: the toolbox panels first (the ones this plugin
	 * owns), then a separator, then every other view type Obsidian has
	 * registered right now — core sidebar views and community-plugin views alike
	 * (foreign-core.ts decides which are offerable and what they are called).
	 * The list is read at open time, not cached, so enabling a plugin makes its
	 * view selectable without reloading anything.
	 */
	private showPanelMenu(slot: number, evt: MouseEvent): void {
		const menu = new Menu();
		const current = this.page.panels[slot];
		const add = (id: string, label: string, icon: string, available = true) => {
			menu.addItem((item) => {
				const onPage = this.page.panels.includes(id) && id !== current;
				const title = !available
					? `${label} (unavailable)`
					: onPage
						? `${label} (swap)`
						: label;
				item
					.setTitle(title)
					.setIcon(icon)
					.setChecked(id === current)
					.onClick(() => void this.choose(slot, id));
			});
		};
		for (const spec of PANEL_SPECS) add(spec.id, spec.label, spec.icon);
		const entries = foreignMenuEntries(registeredViewTypes(this.app), current);
		if (entries.length) {
			menu.addSeparator();
			for (const { spec, available } of entries) {
				add(spec.id, spec.label, spec.icon, available);
			}
		}
		if (this.page.panels.length > 1) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle("Remove this pane")
					.setIcon("x")
					.onClick(() => void this.dropPane(slot))
			);
		}
		menu.showAtMouseEvent(evt);
	}

	/** The ⋯ menu: add a pane to this page, add / remove pages. */
	private showLayoutMenu(evt: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((i) =>
			i.setTitle(`Page ${this.pageIndex + 1} of ${this.pages.length}`).setIsLabel(true)
		);
		if (this.page.panels.length < MAX_PANES) {
			menu.addItem((i) =>
				i
					.setTitle("Add a pane below")
					.setIcon("plus")
					.onClick(() => void this.pushPane())
			);
		}
		if (this.pages.length < MAX_PAGES) {
			menu.addItem((i) =>
				i
					.setTitle("Add a page (swipe left to reach it)")
					.setIcon("copy-plus")
					.onClick(() => void this.pushPage())
			);
		}
		if (this.pages.length > 1) {
			menu.addItem((i) =>
				i
					.setTitle("Remove this page")
					.setIcon("trash-2")
					.onClick(() => void this.dropPage())
			);
			menu.addSeparator();
			if (this.pageIndex > 0) {
				menu.addItem((i) =>
					i
						.setTitle("Previous page")
						.setIcon("chevron-left")
						.onClick(() => void this.goToPage(this.pageIndex - 1))
				);
			}
			if (this.pageIndex < this.pages.length - 1) {
				menu.addItem((i) =>
					i
						.setTitle("Next page")
						.setIcon("chevron-right")
						.onClick(() => void this.goToPage(this.pageIndex + 1))
				);
			}
		}
		menu.showAtMouseEvent(evt);
	}

	// ---- pages ----

	async goToPage(index: number): Promise<void> {
		const next = clampPageIndex(index, this.pages.length);
		if (next === this.pageIndex) return;
		this.unmountAll();
		this.pageIndex = next;
		this.renderPage();
		this.paintHeader();
		await this.persist();
	}

	/** Step to the next / previous page (commands + swipe). */
	async stepPage(dir: 1 | -1): Promise<void> {
		await this.goToPage(this.pageIndex + dir);
	}

	private async pushPage(): Promise<void> {
		// A new page starts as a single pane showing the first panel the current
		// page does not — never a copy of a panel already live on screen.
		const fresh =
			PANEL_IDS.find((id) => !this.page.panels.includes(id)) ?? PANEL_IDS[0];
		const next = addPage(this.pages, { panels: [fresh], ratios: [1] });
		if (next === this.pages) return;
		this.pages = next;
		await this.goToPage(this.pages.length - 1);
		await this.persist();
	}

	private async dropPage(): Promise<void> {
		const next = removePage(this.pages, this.pageIndex);
		if (next === this.pages) return;
		this.unmountAll();
		this.pages = next;
		this.pageIndex = clampPageIndex(this.pageIndex, this.pages.length);
		this.renderPage();
		this.paintHeader();
		await this.persist();
	}

	private async pushPane(): Promise<void> {
		const fresh = PANEL_IDS.find((id) => !this.page.panels.includes(id));
		if (!fresh) return;
		const next = addPane(this.page, fresh);
		if (next === this.page) return;
		this.unmountAll();
		this.replacePage(next);
		this.renderPage();
		this.paintHeader();
		await this.persist();
	}

	private async dropPane(slot: number): Promise<void> {
		const next = removePane(this.page, slot);
		if (next === this.page) return;
		this.unmountAll();
		this.replacePage(next);
		this.renderPage();
		this.paintHeader();
		await this.persist();
	}

	/**
	 * Horizontal swipe = page change. Touch only (a mouse drag on desktop is
	 * text selection); the divider owns its own pointer capture so a divider
	 * drag never reads as a swipe; and a swipe is judged at pointerup from the
	 * total travel, so a vertical scroll that wanders sideways is ignored.
	 */
	private wireSwipe(root: HTMLElement): void {
		let startX = 0;
		let startY = 0;
		let tracking = false;
		this.registerDomEvent(root, "pointerdown", (e: PointerEvent) => {
			if (e.pointerType === "mouse") return;
			if ((e.target as HTMLElement | null)?.closest?.(".stx-dual-divider")) return;
			tracking = true;
			startX = e.clientX;
			startY = e.clientY;
		});
		const end = (e: PointerEvent) => {
			if (!tracking) return;
			tracking = false;
			if (this.pages.length < 2) return;
			const next = pageAfterSwipe(
				this.pageIndex,
				this.pages.length,
				e.clientX - startX,
				e.clientY - startY,
				SWIPE_PX
			);
			if (next !== this.pageIndex) void this.goToPage(next);
		};
		this.registerDomEvent(root, "pointerup", end);
		this.registerDomEvent(root, "pointercancel", () => {
			tracking = false;
		});
	}

	// ---- panes ----

	/** Build the pane elements + dividers for the current page and mount them. */
	private renderPage(): void {
		const stack = this.stackEl;
		if (!stack) return;
		stack.empty();
		this.panes = [];
		this.dividers = [];
		this.page.panels.forEach((_, slot) => {
			if (slot > 0) {
				const divider = stack.createDiv("stx-dual-divider");
				divider.createDiv("stx-dual-grip");
				this.wireDivider(divider, slot - 1);
				this.dividers.push(divider);
			}
			const paneEl = stack.createDiv(
				"stx-dual-pane" + (this.page.panels.length === 1 ? " stx-dual-pane-solo" : "")
			);
			this.panes.push({
				paneEl,
				bodyEl: paneEl.createDiv("stx-dual-body"),
				chipEl: paneEl, // replaced by paintHeader
				panel: null,
				hosted: null,
			});
		});
		this.applyRatios();
		this.page.panels.forEach((_, slot) => this.mount(slot));
	}

	/** Mount whatever pane `slot` is set to, into its body element. */
	private mount(slot: number): void {
		const h = this.panes[slot];
		if (!h) return;
		const id = this.page.panels[slot];
		const viewType = foreignType(id);
		if (viewType) {
			this.mountForeign(h, viewType);
			this.adoptScope();
			return;
		}
		const spec = panelSpec(id);
		if (!spec) {
			h.bodyEl.createDiv({ cls: "stx-empty", text: "Panel unavailable" });
			return;
		}
		try {
			const panel = spec.create(this.host, h.bodyEl);
			h.panel = panel;
			this.addChild(panel);
		} catch (e) {
			console.error("Shawn's Toolbox: dual panel mount failed", e);
			new Notice(
				`Could not open ${spec.label}: ${e instanceof Error ? e.message : String(e)}`
			);
		}
		this.adoptScope();
	}

	/**
	 * Host another Obsidian view in this pane. The mount is async (building a
	 * view state is), so the slot is recorded synchronously and the await guards
	 * against the pane having been switched or the whole view closed meanwhile —
	 * otherwise a slow view would appear in a pane that has moved on, and its
	 * leaf would never be detached.
	 */
	private mountForeign(h: Pane, viewType: string): void {
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
	 * Unmount a pane and throw its body element away. Panels add their root
	 * class (and sometimes inline styles) to the container they are handed, so a
	 * fresh element is the only way to be sure nothing leaks from the panel that
	 * was there before.
	 */
	private unmount(slot: number): void {
		const h = this.panes[slot];
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

	private unmountAll(): void {
		this.panes.forEach((_, i) => this.unmount(i));
	}

	private async choose(slot: number, id: string): Promise<void> {
		const next = setPagePanel(this.page, slot, id);
		if (next === this.page) return;
		this.unmountAll();
		this.replacePage(next);
		this.renderPage();
		this.paintHeader();
		await this.persist();
	}

	private async swap(): Promise<void> {
		this.unmountAll();
		this.replacePage(reversePage(this.page));
		this.renderPage();
		this.paintHeader();
		await this.persist();
	}

	/**
	 * Re-check each hosted pane against the view types registered right now, and
	 * remount the ones whose availability flipped: a disabled plugin turns its
	 * pane into the placeholder, and re-enabling it brings the view back without
	 * Shawn having to touch the selector.
	 */
	private verifyHosted(): void {
		this.panes.forEach((h, slot) => {
			const type = foreignType(this.page.panels[slot]);
			if (!type || !h.hosted) return;
			if (viewTypeAvailable(this.app, type) === h.hosted.isLive()) return;
			this.unmount(slot);
			this.mount(slot);
		});
	}

	/**
	 * Obsidian activates `view.scope` while the view has focus, which is how the
	 * capture panel's Mod+Enter beats Obsidian's own keymap. Adopt whichever
	 * mounted pane brought a scope (a panel type can only be in one pane).
	 */
	private adoptScope(): void {
		this.scope = this.panes.find((p) => p.panel?.scope)?.panel?.scope ?? null;
	}

	// ---- the dividers ----

	private wireDivider(divider: HTMLElement, index: number): void {
		let dragging = false;
		let startY = 0;
		let startRatios: number[] = [];
		let available = 0;

		this.registerDomEvent(divider, "pointerdown", (e: PointerEvent) => {
			dragging = true;
			startY = e.clientY;
			startRatios = [...this.page.ratios];
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
			this.replacePage({
				panels: this.page.panels,
				ratios: ratiosFromDrag(startRatios, index, e.clientY - startY, available),
			});
			this.applyRatios();
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
			if (ratiosChanged(startRatios, this.page.ratios)) void this.persist();
		};
		this.registerDomEvent(divider, "pointerup", end);
		this.registerDomEvent(divider, "pointercancel", end);
		// Escape hatch on both surfaces: back to an even split.
		this.registerDomEvent(divider, "dblclick", () => {
			const n = this.page.panels.length;
			this.replacePage({
				panels: this.page.panels,
				ratios: Array.from({ length: n }, () => 1 / n),
			});
			this.applyRatios();
			void this.persist();
		});
	}

	/** Height the panes share right now (they own all of it between them). */
	private availableHeight(): number {
		return this.panes.reduce((sum, p) => sum + p.paneEl.clientHeight, 0);
	}

	private applyRatios(): void {
		const grows = paneGrows(this.page.ratios);
		this.panes.forEach((p, i) => {
			p.paneEl.style.flexGrow = String(grows[i] ?? 0);
		});
		this.resizeHosted();
	}

	/**
	 * A hosted view lays itself out from its container's size and never gets
	 * Obsidian's own resize notification (it is not in the workspace tree), so
	 * every size change we cause has to be forwarded. Toolbox panels are CSS-only
	 * and need nothing.
	 */
	private resizeHosted(): void {
		for (const p of this.panes) p.hosted?.resize();
	}

	/** Obsidian resized the leaf (drawer opened, window resized, split moved). */
	onResize(): void {
		this.resizeHosted();
	}
}
