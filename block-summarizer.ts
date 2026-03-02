import { type Editor, Notice, requestUrl } from "obsidian";
import type { ShawnsToolboxSettings } from "./settings";

// Matches any bullet list marker: -, *, +, or numbered (1. / 1))
const BULLET_PREFIX_REGEX = /^(\s*)([-*+]|\d+[.)]) /;

// Combined regex to skip past: list marker, optional checkbox, optional [[date]], optional time
const LINE_PREFIX_REGEX =
	/^(\s*(?:[-*+]|\d+[.)]) )(\[.\] )?(\[\[\d{4}-\d{2}-\d{2}\]\] ?)?(\d{1,2}:\d{2} ?)?/;

// Detects an existing bolded summary phrase at a given position
const EXISTING_SUMMARY_REGEX = /^\*\*[^*]+\*\* /;

// Matches a line that starts with optional date/time but is NOT a bullet
const PLAIN_LINE_PREFIX_REGEX =
	/^(\[\[\d{4}-\d{2}-\d{2}\]\] ?)?(\d{1,2}:\d{2} ?)?/;

// ── Types ────────────────────────────────────────────────────────────

export interface ContentBlock {
	/** The line where the summary will be inserted */
	targetLine: number;
	/** The full text of the target line */
	targetText: string;
	/** Additional context lines (child bullets or rest of paragraph) */
	contextTexts: string[];
	/** Whether this is a bullet block or a plain paragraph */
	kind: "bullet" | "paragraph";
}

export interface InsertPosition {
	insertOffset: number;
	existingBoldLength: number;
}

// ── Block extraction ─────────────────────────────────────────────────

/**
 * Starting from `cursorLine`, extracts the bullet at that line plus all
 * child bullets (determined by strictly greater indentation).
 * Returns null if the cursor line is not a bullet.
 */
function extractBulletBlock(
	editor: Editor,
	cursorLine: number
): ContentBlock | null {
	const parentText = editor.getLine(cursorLine);
	const parentMatch = BULLET_PREFIX_REGEX.exec(parentText);
	if (!parentMatch) return null;

	const parentIndent = parentMatch[1].length;
	const childTexts: string[] = [];

	for (let i = cursorLine + 1; i <= editor.lastLine(); i++) {
		const lineText = editor.getLine(i);

		// Stop at blank lines
		if (lineText.trim() === "") break;

		const lineMatch = BULLET_PREFIX_REGEX.exec(lineText);
		if (!lineMatch) break;

		const lineIndent = lineMatch[1].length;
		if (lineIndent <= parentIndent) break;

		childTexts.push(lineText);
	}

	return {
		targetLine: cursorLine,
		targetText: parentText,
		contextTexts: childTexts,
		kind: "bullet",
	};
}

/**
 * Extracts a contiguous paragraph of non-blank, non-bullet lines around
 * the cursor. The first line of the paragraph is the target where the
 * summary will be inserted.
 */
function extractParagraphBlock(
	editor: Editor,
	cursorLine: number
): ContentBlock | null {
	const cursorText = editor.getLine(cursorLine);
	if (cursorText.trim() === "") return null;

	// Walk upward to find the first line of this paragraph
	let startLine = cursorLine;
	for (let i = cursorLine - 1; i >= 0; i--) {
		const lineText = editor.getLine(i);
		if (lineText.trim() === "" || BULLET_PREFIX_REGEX.test(lineText)) break;
		startLine = i;
	}

	// Walk downward to find the last line of this paragraph
	const contextTexts: string[] = [];
	for (let i = startLine + 1; i <= editor.lastLine(); i++) {
		const lineText = editor.getLine(i);
		if (lineText.trim() === "" || BULLET_PREFIX_REGEX.test(lineText)) break;
		contextTexts.push(lineText);
	}

	return {
		targetLine: startLine,
		targetText: editor.getLine(startLine),
		contextTexts,
		kind: "paragraph",
	};
}

/**
 * Unified extractor: tries bullet block first, falls back to paragraph.
 */
export function extractBlock(
	editor: Editor,
	cursorLine: number
): ContentBlock | null {
	return (
		extractBulletBlock(editor, cursorLine) ??
		extractParagraphBlock(editor, cursorLine)
	);
}

// ── Insert position detection ────────────────────────────────────────

/**
 * Determines where in `lineText` the bolded summary should be inserted.
 * For bullets: skips past list marker, optional checkbox, optional [[date]],
 * optional HH:MM timestamp.
 * For paragraphs: skips past optional [[date]] and optional HH:MM timestamp.
 * Also detects if an existing **bold** summary is already present.
 */
export function findSummaryInsertPosition(
	lineText: string,
	kind: "bullet" | "paragraph"
): InsertPosition {
	const prefixRegex =
		kind === "bullet" ? LINE_PREFIX_REGEX : PLAIN_LINE_PREFIX_REGEX;
	const prefixMatch = prefixRegex.exec(lineText);
	const insertOffset = prefixMatch ? prefixMatch[0].length : 0;

	// Check if there is already a bolded summary at the insert position
	const remaining = lineText.substring(insertOffset);
	const boldMatch = EXISTING_SUMMARY_REGEX.exec(remaining);
	const existingBoldLength = boldMatch ? boldMatch[0].length : 0;

	return { insertOffset, existingBoldLength };
}

// ── Prompt building ──────────────────────────────────────────────────

/**
 * Strips the markdown list prefix (marker, checkbox, date, time) from a
 * line so only the semantic content remains for the LLM.
 */
function stripLinePrefix(line: string): string {
	// Try bullet prefix first, then plain line prefix
	const bulletMatch = LINE_PREFIX_REGEX.exec(line);
	if (bulletMatch && bulletMatch[0].length > 0) {
		return line.substring(bulletMatch[0].length);
	}
	const plainMatch = PLAIN_LINE_PREFIX_REGEX.exec(line);
	return plainMatch ? line.substring(plainMatch[0].length) : line;
}

/**
 * Builds the prompt sent to Gemini. Includes the target line content
 * and all context lines (child bullets or paragraph continuation).
 */
export function buildSummarizationPrompt(block: ContentBlock): string {
	const cleanedTarget = stripLinePrefix(block.targetText);
	const cleanedContext = block.contextTexts.map(stripLinePrefix);
	const fullBlock = [cleanedTarget, ...cleanedContext].join("\n");

	const contentLabel =
		block.kind === "bullet"
			? "Bullet content:"
			: "Paragraph content:";

	return [
		"You are a note summarizer. Given the following text from a personal knowledge base, generate a short descriptive summary phrase that could serve as a title.",
		"",
		"Rules:",
		"- Respond with ONLY the summary phrase, nothing else",
		"- Use 3-5 words (never just one word)",
		"- Use Title Case",
		"- Do not include punctuation at the end",
		"- Do not wrap in quotes or bold markers",
		"- Be specific and descriptive, not generic",
		"",
		"Examples of good summaries:",
		'- "Reorganizing Project File Structure"',
		'- "Weekly Team Sync Notes"',
		'- "Fix Login Timeout Bug"',
		'- "Ideas for New Dashboard"',
		"",
		contentLabel,
		fullBlock,
	].join("\n");
}

// ── Gemini API ───────────────────────────────────────────────────────

/**
 * Calls the Gemini REST API using Obsidian's built-in `requestUrl`
 * (works on all platforms, avoids CORS issues).
 */
export async function callGeminiApi(
	apiKey: string,
	model: string,
	promptText: string
): Promise<string> {
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

	const response = await requestUrl({
		url,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-goog-api-key": apiKey,
		},
		body: JSON.stringify({
			contents: [{ parts: [{ text: promptText }] }],
			generationConfig: {
				maxOutputTokens: 40,
				temperature: 0.2,
				// Disable thinking for 2.5 models — we only need a short phrase
				thinkingConfig: { thinkingBudget: 0 },
			},
		}),
	});

	const candidates = response.json?.candidates;
	if (!candidates || candidates.length === 0) {
		throw new Error("Unexpected API response format: no candidates returned.");
	}

	// Gemini 2.5 models may return thought parts before text parts.
	// Find the last part that has a `text` field (the actual answer).
	const parts = candidates[0]?.content?.parts;
	let resultText: string | undefined;
	if (Array.isArray(parts)) {
		for (let i = parts.length - 1; i >= 0; i--) {
			if (typeof parts[i].text === "string") {
				resultText = parts[i].text;
				break;
			}
		}
	}
	if (typeof resultText !== "string") {
		throw new Error("Unexpected API response format: missing text in response.");
	}

	// Clean up: trim whitespace, remove accidental quotes or bold markers
	let cleaned = resultText.trim();
	cleaned = cleaned.replace(/^["']+|["']+$/g, ""); // strip wrapping quotes
	cleaned = cleaned.replace(/^\*\*|\*\*$/g, ""); // strip wrapping bold
	cleaned = cleaned.trim();

	if (cleaned.length === 0) {
		throw new Error("Summarization returned an empty result.");
	}

	return cleaned;
}

// ── Orchestrator ─────────────────────────────────────────────────────

/**
 * Main entry point: extracts the block at the cursor (bullet or paragraph),
 * sends it to Gemini for summarization, and inserts the bolded result.
 */
export async function summarizeBlock(
	editor: Editor,
	settings: ShawnsToolboxSettings
): Promise<void> {
	const cursor = editor.getCursor();
	const block = extractBlock(editor, cursor.line);

	if (!block) {
		new Notice("No content to summarize at cursor.");
		return;
	}

	if (!settings.geminiApiKey) {
		new Notice(
			"Gemini API key is not configured. Set it in Shawn's Toolbox settings."
		);
		return;
	}

	// Check the target has actual content beyond the prefix
	const contentAfterPrefix = stripLinePrefix(block.targetText).trim();
	if (contentAfterPrefix.length === 0 && block.contextTexts.length === 0) {
		new Notice("No content to summarize.");
		return;
	}

	const prompt = buildSummarizationPrompt(block);

	new Notice("Summarizing...");

	try {
		const summary = await callGeminiApi(
			settings.geminiApiKey,
			settings.geminiModel,
			prompt
		);

		// Re-read the line in case something changed during the async call
		const currentLineText = editor.getLine(block.targetLine);
		const { insertOffset, existingBoldLength } =
			findSummaryInsertPosition(currentLineText, block.kind);

		// Build the bolded summary, avoiding double spaces
		const nextChar = currentLineText[insertOffset + existingBoldLength];
		const trailingSpace = nextChar === " " ? "" : " ";
		const boldedSummary = `**${summary}**${trailingSpace}`;

		editor.replaceRange(
			boldedSummary,
			{ line: block.targetLine, ch: insertOffset },
			{
				line: block.targetLine,
				ch: insertOffset + existingBoldLength,
			}
		);

		new Notice("Summary added.");
	} catch (error: unknown) {
		const message =
			error instanceof Error ? error.message : String(error);

		if (message.includes("401") || message.includes("403")) {
			new Notice("Gemini API key is invalid or unauthorized.");
		} else if (message.includes("429")) {
			new Notice(
				"Gemini API rate limit reached. Try again in a moment."
			);
		} else {
			new Notice(`Summarization failed: ${message}`);
		}

		console.error("Shawn's Toolbox: Summarization failed", error);
	}
}
