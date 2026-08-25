// pillars-view.ts — right-sidebar Pillars panel: sibling of the Focus panel.
// It parses the pillar ring live from the Pillars note (pure pillar-core),
// cycles through every pillar with ◀ ▶ + a jump dropdown, remembers the
// last-viewed pillar, and shows per-pillar the sections Shawn picks — reusing
// the SectionCards machinery (targeted section read/write, never whole-note).
import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { SectionCards, type CardsHost } from "./section-cards";
import { parsePillars, type PillarLink, type PillarSource } from "./pillar-core";

export const PILLARS_VIEW_TYPE = "shawns-toolbox-pillars";

/**
 * The pillar ring, backed by the parsed Pillars note. Owns link→path
 * resolution (Obsidian's metadata cache) and last-viewed persistence.
 */
class PillarRing implements PillarSource {
	pillars: PillarLink[] = [];
	currentIndex = 0;

	constructor(private host: CardsHost) {}

	/** Re-parse the Pillars note and restore the last-viewed pillar. */
	async reload(): Promise<void> {
		const path = this.host.getSettings().pillarsNotePath;
		const file = this.host.app.vault.getAbstractFileByPath(path);
		this.pillars =
			file instanceof TFile
				? parsePillars(await this.host.app.vault.cachedRead(file))
				: [];
		const last = this.host.getSettings().lastPillarLink;
		const idx = this.pillars.findIndex((p) => p.link === last);
		this.currentIndex = idx >= 0 ? idx : 0;
	}

	notePathFor(index: number): string | null {
		const pillar = this.pillars[index];
		if (!pillar) return null;
		const dest = this.host.app.metadataCache.getFirstLinkpathDest(
			pillar.link,
			this.host.getSettings().pillarsNotePath
		);
		return dest ? dest.path : null;
	}

	async setCurrentIndex(index: number): Promise<void> {
		this.currentIndex = index;
		this.host.getSettings().lastPillarLink =
			this.pillars[index]?.link ?? "";
		await this.host.saveSettings();
	}
}

export class PillarsView extends ItemView {
	private cards: SectionCards | null = null;
	private ring: PillarRing | null = null;

	constructor(leaf: WorkspaceLeaf, private host: CardsHost) {
		super(leaf);
	}

	getViewType(): string {
		return PILLARS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Pillars";
	}

	getIcon(): string {
		return "layout-grid";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.ring = new PillarRing(this.host);
		await this.ring.reload();
		this.cards = new SectionCards(
			this.host,
			this.contentEl,
			"pillar",
			this.ring
		);
		this.addChild(this.cards);

		// Editing the Pillars note edits the ring live.
		const onPillarsFile = (f: { path: string }) => {
			if (f.path === this.host.getSettings().pillarsNotePath) {
				void this.refreshRing();
			}
		};
		this.registerEvent(this.host.app.vault.on("modify", onPillarsFile));
		this.registerEvent(this.host.app.vault.on("create", onPillarsFile));
		this.registerEvent(
			this.host.app.vault.on("rename", (f, oldPath) => {
				if (
					f.path === this.host.getSettings().pillarsNotePath ||
					oldPath === this.host.getSettings().pillarsNotePath
				) {
					void this.refreshRing();
				}
			})
		);
	}

	private async refreshRing(): Promise<void> {
		if (!this.ring || !this.cards) return;
		await this.ring.reload();
		void this.cards.rebuild();
	}

	async onClose(): Promise<void> {
		if (this.cards) {
			this.removeChild(this.cards);
			this.cards = null;
		}
		this.ring = null;
	}
}
