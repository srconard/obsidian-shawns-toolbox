// status-controls.ts — one renderer, two layouts, so the sidebar panel and the
// note footer cannot drift apart.
import type { App, TFile } from "obsidian";
import { PHASES, formatAge } from "./status-core";
import { readStatus, writePhase, writeOngoing, todayIso } from "./status-service";

export function renderStatusControls(
	container: HTMLElement,
	app: App,
	file: TFile,
	layout: "panel" | "footer"
): void {
	container.empty();
	container.addClass("stx-status");
	container.addClass(`stx-status--${layout}`);

	const status = readStatus(app, file);

	const phaseRow = container.createDiv({ cls: "stx-phase-row" });
	for (const phase of PHASES) {
		const isCurrent = status.phase === phase;
		const btn = phaseRow.createEl("button", {
			cls: `stx-pill${isCurrent ? " stx-pill--on" : ""}`,
			text: `${isCurrent ? "☑" : "☐"} ${phase}`,
		});
		btn.setAttribute("aria-pressed", String(isCurrent));
		btn.onclick = async () => {
			// Clicking the current phase clears it; clicking another switches.
			await writePhase(app, file, isCurrent ? null : phase);
			renderStatusControls(container, app, file, layout);
		};
	}

	container.createDiv({ cls: "stx-divider" });

	const ongoingRow = container.createDiv({ cls: "stx-ongoing-row" });
	const ongoingBtn = ongoingRow.createEl("button", {
		cls: `stx-pill${status.ongoing ? " stx-pill--on" : ""}`,
		text: `${status.ongoing ? "☑" : "☐"} ongoing`,
	});
	ongoingBtn.setAttribute("aria-pressed", String(status.ongoing));
	ongoingBtn.onclick = async () => {
		await writeOngoing(app, file, !status.ongoing);
		renderStatusControls(container, app, file, layout);
	};

	ongoingRow.createSpan({
		cls: "stx-age",
		text: formatAge(status.phase, status.changed, todayIso()),
	});

	if (status.conflicts.length > 1) {
		container.createDiv({
			cls: "stx-conflict",
			text: `⚠ multiple phases: ${status.conflicts.join(
				", "
			)} — click one to resolve`,
		});
	}
}
