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
			if (this.applied.some((a) => a.options === options)) continue;
			const icons: Moved[] = [];
			for (const icon of Array.from(
				header.querySelectorAll<HTMLElement>(".workspace-drawer-header-icon")
			)) {
				icons.push({ icon, parent: header, next: icon.nextSibling });
				options.appendChild(icon);
			}
			header.addClass(HEADER_HIDDEN_CLASS);
			options.addClass(OPTIONS_ROW_CLASS);
			this.applied.push({ header, options, icons });
		}
	}

	/** Put every icon back where Obsidian built it and unhide the headers. */
	restore(): void {
		for (const a of this.applied.splice(0)) {
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
