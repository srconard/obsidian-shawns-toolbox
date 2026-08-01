// status-conflicts.ts — find notes carrying more than one phase tag.
// Read-only by design: which tag is correct is Shawn's call, not the plugin's.
import type { App } from "obsidian";
import { normalizeTags, readAllPhases, type Phase } from "./status-core";

export interface Conflict {
	path: string;
	phases: Phase[];
}

export function findConflicts(app: App): Conflict[] {
	const out: Conflict[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) continue;
		const phases = readAllPhases(normalizeTags(fm.tags));
		if (phases.length > 1) out.push({ path: file.path, phases });
	}
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function formatConflictReport(
	conflicts: Conflict[],
	todayIso: string
): string {
	const lines = [
		"---",
		`DateCreated: "${todayIso}"`,
		"tags: agent/inbox",
		"type: status-conflict-report",
		"---",
		"",
		"# Status phase conflicts",
		"",
		`Found **${conflicts.length}** notes carrying more than one of \`simmering\` / \`on\` / \`active\`.`,
		"",
		"These are reported, never auto-fixed — which tag is right is your call.",
		"Open any of them and click a phase in the status panel or footer to resolve it;",
		"setting a phase clears the others automatically.",
		"",
	];
	for (const c of conflicts) {
		lines.push(`- [[${c.path}]] — ${c.phases.join(", ")}`);
	}
	lines.push("");
	return lines.join("\n");
}
