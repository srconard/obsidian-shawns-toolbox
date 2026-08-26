// pillar-inbox-modal.ts — the tiny quick-capture prompt behind the Pillars
// panel's "+" button. Two-taps-fast: tap "+", type, Enter (or Add). No
// categorisation UI — the item lands as a plain dated bullet in the pillar's
// Inbox; deciding where it lives happens at Sunday review, not at capture time.
import { App, Modal } from "obsidian";

export class PillarInboxModal extends Modal {
	constructor(
		app: App,
		private pillarName: string,
		private onSubmit: (text: string) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("stx-pillar-inbox");
		contentEl.createEl("h3", { text: `Capture → ${this.pillarName} inbox` });
		const input = contentEl.createEl("input", {
			cls: "stx-pillar-inbox-input",
			attr: { type: "text", placeholder: "quick note…" },
		});
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit(input.value);
			}
		});
		const row = contentEl.createDiv({ cls: "stx-pillar-inbox-row" });
		const add = row.createEl("button", { cls: "mod-cta", text: "Add" });
		add.addEventListener("click", () => this.submit(input.value));
		const cancel = row.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
		window.setTimeout(() => input.focus(), 0);
	}

	private submit(raw: string): void {
		const text = raw.trim();
		this.close();
		if (text) this.onSubmit(text);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
