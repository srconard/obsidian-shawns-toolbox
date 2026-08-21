// ai-bullets.ts — pure prompt/parse/format logic for the "voice thought →
// AI bullets" capture: a rambling spoken transcript becomes a couple-word
// bold summary with clean child bullets, the raw transcript folded beneath.
// No Obsidian imports so it unit-tests; the voice view owns the API call.

export interface BulletedThought {
	summary: string;
	bullets: string[];
}

export function buildBulletsPrompt(transcript: string): string {
	return [
		"You reorganize a spoken, rambling voice transcript into clean notes.",
		"Rules:",
		"- Preserve the speaker's meaning exactly. Never invent, embellish, or advise.",
		"- First line of your reply: a 2-6 word headline phrase (no bullet, no quotes, no markdown).",
		"- Then one bullet per distinct point, each starting with \"- \", concise, in the speaker's voice.",
		"- Use as few bullets as the content honestly needs (often 2-5).",
		"- Reply with ONLY the headline and bullets. No preamble, no code fences.",
		"",
		"Transcript:",
		transcript.trim(),
	].join("\n");
}

/**
 * Parse the model reply defensively: first non-empty line is the summary
 * (stray bullets/bold/quotes/fences stripped), remaining bullet-ish lines
 * are the bullets. Returns null when nothing usable came back — the caller
 * falls back to saving the raw transcript.
 */
export function parseBulletsResponse(raw: string): BulletedThought | null {
	const lines = raw
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l !== "" && !/^(```|~~~)/.test(l));
	if (lines.length === 0) return null;
	const clean = (l: string) =>
		l
			.replace(/^[-*+]\s+/, "")
			.replace(/^\*\*(.*)\*\*$/, "$1")
			.replace(/^"(.*)"$/, "$1")
			.trim();
	const summary = clean(lines[0]);
	if (!summary) return null;
	const bullets = lines
		.slice(1)
		.map(clean)
		.filter((l) => l !== "");
	return { summary, bullets };
}

/** Collapse a transcript to one line so it can live as a single child bullet. */
export function singleLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * The multi-line block appended under "# Thoughts":
 *
 *   - HH:MM **summary**
 *   \t- bullet
 *   \t- raw: transcript…
 *
 * Tab-indented children per the vault's daily-note convention; the raw
 * transcript rides along as the last (foldable) child so nothing is lost.
 */
export function formatBulletedThought(
	parsed: BulletedThought,
	transcript: string,
	hm: string
): string {
	const out = [`- ${hm} **${parsed.summary}**`];
	for (const b of parsed.bullets) out.push(`\t- ${b}`);
	out.push(`\t- raw: ${singleLine(transcript)}`);
	return out.join("\n");
}
