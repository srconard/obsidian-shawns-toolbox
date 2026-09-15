// drawer-chrome.ts — the phone drawer's bottom row (v1.42.0).
//
// Shawn, 2026-09-13 (screenshots): "move the side panel picker to the bottom.
// For the right panel remove where it says the note that is open and the word
// count … it will be next to the sync checkbox (make it taller again). For the
// left side panel remove where you select the vault and just put that in the
// settings menu, and put the side panel picker where the vault selector was,
// next to the settings button."
//
// Everything here is Obsidian's OWN mobile drawer chrome, not plugin markup
// (the v1.35.0 lesson). Measured live in the NAS Obsidian 1.12.7 under phone
// emulation (412×915, `is-phone`):
//
//   .workspace-drawer > .workspace-drawer-inner
//     ├ .workspace-drawer-tab-container
//     │   └ .workspace-drawer-active-tab-container   (flex column)
//     │       ├ .workspace-drawer-active-tab-content  (the panel)
//     │       └ .workspace-drawer-tab-options         (order 2 → BOTTOM, 52px)
//     │           ├ .workspace-tab-header.workspace-drawer-tab-select  ← the pill
//     │           └ .workspace-drawer-tab-options-list (absolute, opens UPWARD)
//     └ .workspace-drawer-header                      (order 2 → below the pill)
//         ├ .workspace-drawer-header-left   (left: vault name + file count;
//         │                                  right: open note + word count)
//         └ .workspace-drawer-header-icon   (left: settings gear; right: sync)
//
// THE TRAP, measured: the pill's tap handler is NOT on the pill. Obsidian
// registers one `pointerdown` listener on `.workspace-drawer-tab-options` and
// checks `activeTabHeaderEl.contains(target)` — so a pill re-parented into the
// header row looks right and does nothing when tapped (the first cut of this
// file did exactly that). The pill therefore STAYS where Obsidian built it, and
// the header's ICONS move to it instead: each `.workspace-drawer-header-icon`
// (gear / sync — a pin on tablets) is appended into the tab-options element,
// which CSS turns into a row (pill grows, icons trail), and the emptied header
// row is hidden. Icons keep their own click listeners; the sync icon keeps
// updating its status classes; the options list still opens upward from the
// same element. The vault switcher the header carried is replaced by "Manage
// vaults" in the toolbox settings tab (+ a command).
//
// Nothing is destroyed: `restore()` puts every icon back exactly where it came
// from, so disabling the plugin (or the setting) leaves the drawer stock.
//
// v1.45.2 — THE SECOND TRAP, measured: the icons are not all there when we
// first run. `apply()` used to skip any drawer it had already folded, so it
// adopted exactly the icons that existed at `onLayoutReady`. Obsidian Sync
// builds its `.sync-status-icon` into the right drawer's header LATER, and the
// skip meant no later `layout-change` ever picked it up — leaving it stranded
// in the header row we hide, i.e. no sync status anywhere on the phone (Shawn,
// 2026-09-15). This never showed up in testing because a hot `plugin:reload`
// runs apply() when Sync's icon already exists; only a cold start loses it.
// So `apply()` now re-scans an already-folded drawer for stragglers, and a
// MutationObserver on the header adopts a late icon the moment it is built
// (a cold phone start need not produce another layout-change at all).
import { App, Platform } from "obsidian";

export const OPTIONS_ROW_CLASS = "stx-drawer-options-row";
export const HEADER_HIDDEN_CLASS = "stx-drawer-header-hidden";

interface MobileDrawerLike {
	headerEl?: HTMLElement;
	/** The pill (`.workspace-drawer-tab-select`). Its parent is the options element. */
	activeTabHeaderEl?: HTMLElement;
}

interface Moved {
	icon: HTMLElement;
	parent: HTMLElement;
	next: Node | null;
}

interface Applied {
	header: HTMLElement;
	options: HTMLElement;
	icons: Moved[];
	/** Watches the header for icons Obsidian creates AFTER the first apply. */
	observer: MutationObserver | null;
}

export class DrawerChrome {
	private applied: Applied[] = [];

	constructor(
		private app: App,
		private enabled: () => boolean
	) {}

	/** Both drawers, if this Obsidian has them (mobile only). */
	private drawers(): MobileDrawerLike[] {
		/* eslint-disable @typescript-eslint/no-explicit-any */
		const ws = this.app.workspace as any;
		return [ws.leftSplit, ws.rightSplit].filter(
			(d): d is MobileDrawerLike =>
				!!d && typeof d === "object" && !!d.headerEl && !!d.activeTabHeaderEl
		);
		/* eslint-enable @typescript-eslint/no-explicit-any */
	}

	/**
	 * Fold each drawer's header icons into its pill row. Idempotent: safe to
	 * call on every layout-change (a drawer already done is left alone). Undoes
	 * itself when the setting is off or this is not a phone — tablets keep the
	 * options at the TOP of the drawer, where a gear would be wrong.
	 */
	apply(): void {
		if (!Platform.isPhone || !this.enabled()) {
			this.restore();
			return;
		}
		for (const drawer of this.drawers()) {
			const header = drawer.headerEl!;
			const options = drawer.activeTabHeaderEl!.parentElement;
			if (!options) continue;
			const existing = this.applied.find((a) => a.options === options);
			if (existing) {
				// Already folded — but Obsidian may have built another icon into
				// the header since (the v1.45.2 bug: Sync creates its status icon
				// after `onLayoutReady`, so a cold start stranded it in the header
				// we hide). Adopt the stragglers instead of skipping the drawer.
				if (existing.header !== header) {
					existing.observer?.disconnect();
					existing.header.removeClass(HEADER_HIDDEN_CLASS);
					existing.header = header;
					existing.observer = this.watch(existing);
				}
				this.adopt(existing);
				header.addClass(HEADER_HIDDEN_CLASS);
				continue;
			}
			const entry: Applied = { header, options, icons: [], observer: null };
			this.adopt(entry);
			header.addClass(HEADER_HIDDEN_CLASS);
			options.addClass(OPTIONS_ROW_CLASS);
			entry.observer = this.watch(entry);
			this.applied.push(entry);
		}
	}

	/**
	 * Move every `.workspace-drawer-header-icon` still sitting in the header
	 * into the pill row, remembering where each came from. Safe to re-run: an
	 * icon already moved is no longer a child of the header.
	 */
	private adopt(entry: Applied): void {
		for (const icon of Array.from(
			entry.header.querySelectorAll<HTMLElement>(".workspace-drawer-header-icon")
		)) {
			entry.icons.push({ icon, parent: entry.header, next: icon.nextSibling });
			entry.options.appendChild(icon);
		}
	}

	/**
	 * Adopt late-built icons the moment they appear, rather than waiting for the
	 * next `layout-change` — on a cold phone start there may not be one, and an
	 * unadopted icon is invisible because we hide the row it lives in.
	 */
	private watch(entry: Applied): MutationObserver | null {
		if (typeof MutationObserver === "undefined") return null;
		const observer = new MutationObserver(() => {
			if (!Platform.isPhone || !this.enabled()) return;
			this.adopt(entry);
		});
		observer.observe(entry.header, { childList: true });
		return observer;
	}

	/** Put every icon back where Obsidian built it and unhide the headers. */
	restore(): void {
		for (const a of this.applied.splice(0)) {
			a.observer?.disconnect();
			a.options.removeClass(OPTIONS_ROW_CLASS);
			a.header.removeClass(HEADER_HIDDEN_CLASS);
			for (const m of a.icons) {
				try {
					m.parent.insertBefore(m.icon, m.next);
				} catch {
					m.parent.appendChild(m.icon);
				}
			}
		}
	}
}
