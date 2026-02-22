import { Editor } from "obsidian";
import type { ShawnsToolboxSettings } from "./settings";

// Regex to match a checked checkbox line
// Matches: - [x], * [x], + [x], or numbered like 1. [x], 1) [x]
const CHECKED_CHECKBOX_REGEX = /^(\s*)([-*+]|\d+[.)]) \[x\] /i;

// Regex to match an unchecked checkbox line
const UNCHECKED_CHECKBOX_REGEX = /^(\s*)([-*+]|\d+[.)]) \[ \] /;

/**
 * Determines if a line contains a checked checkbox
 */
export function isCheckedCheckbox(line: string): boolean {
	return CHECKED_CHECKBOX_REGEX.test(line);
}

/**
 * Determines if a line contains an unchecked checkbox
 */
export function isUncheckedCheckbox(line: string): boolean {
	return UNCHECKED_CHECKBOX_REGEX.test(line);
}

/**
 * Checks if a line should be excluded from stamping based on patterns
 */
export function shouldExcludeLine(
	line: string,
	excludePatterns: string[]
): boolean {
	return excludePatterns.some((pattern) => line.includes(pattern));
}

/**
 * Checks if a line already has a completion stamp
 */
export function hasCompletionStamp(line: string): boolean {
	return line.includes("✅");
}

/**
 * Regex matching the completion stamp: ✅ YYYY-MM-DD with optional HH:MM
 */
const COMPLETION_STAMP_REGEX = / ✅ \d{4}-\d{2}-\d{2}( \d{2}:\d{2})?/;

/**
 * Removes the completion stamp from a line, if present
 */
export function removeCompletionStamp(line: string): string {
	return line.replace(COMPLETION_STAMP_REGEX, "");
}

/**
 * Formats the current date according to the specified format
 * Currently only supports YYYY-MM-DD
 */
export function formatDate(date: Date, _format: string): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/**
 * Formats the current time as HH:MM
 */
export function formatTime(date: Date): string {
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${hours}:${minutes}`;
}

/**
 * Applies a completion stamp to a checkbox line if appropriate
 * Returns true if the stamp was applied, false otherwise
 */
export function applyCheckboxStamp(
	editor: Editor,
	lineNumber: number,
	settings: ShawnsToolboxSettings
): boolean {
	const lineText = editor.getLine(lineNumber);

	// Only stamp checked checkboxes
	if (!isCheckedCheckbox(lineText)) {
		return false;
	}

	// Check exclusion patterns
	if (shouldExcludeLine(lineText, settings.excludePatterns)) {
		return false;
	}

	// Avoid duplicate stamps
	if (hasCompletionStamp(lineText)) {
		return false;
	}

	// Apply the stamp
	const now = new Date();
	const dateStr = formatDate(now, settings.dateFormat);
	const timeStr = settings.includeTime ? ` ${formatTime(now)}` : "";
	const stamp = ` ✅ ${dateStr}${timeStr}`;
	editor.setLine(lineNumber, lineText + stamp);

	return true;
}

/**
 * Handles editor changes to detect checkbox state changes
 */
export class CheckboxHandler {
	private settings: ShawnsToolboxSettings;
	private previousLineStates: Map<string, Map<number, boolean>> = new Map();

	constructor(settings: ShawnsToolboxSettings) {
		this.settings = settings;
	}

	updateSettings(settings: ShawnsToolboxSettings): void {
		this.settings = settings;
	}

	/**
	 * Called when the editor content changes
	 * Detects checkbox state transitions and applies/removes stamps
	 */
	handleEditorChange(editor: Editor, filePath: string): void {
		const cursor = editor.getCursor();
		const lineNumber = cursor.line;
		const lineText = editor.getLine(lineNumber);

		// Get previous state for this file
		let fileStates = this.previousLineStates.get(filePath);
		if (!fileStates) {
			fileStates = new Map();
			this.previousLineStates.set(filePath, fileStates);
		}

		const previousState = fileStates.get(lineNumber);
		const wasChecked = previousState === true;

		// Update state for current line
		if (isUncheckedCheckbox(lineText)) {
			// Checked → unchecked: remove stamp if present
			if (wasChecked && hasCompletionStamp(lineText)) {
				editor.setLine(lineNumber, removeCompletionStamp(lineText));
			}
			fileStates.set(lineNumber, false);
		} else if (isCheckedCheckbox(lineText)) {
			// Unchecked → checked: apply stamp
			const wasUnchecked = previousState === false;
			if (wasUnchecked || !fileStates.has(lineNumber)) {
				if (!hasCompletionStamp(lineText)) {
					applyCheckboxStamp(editor, lineNumber, this.settings);
				}
			}
			fileStates.set(lineNumber, true);
		}
	}

	/**
	 * Clears state for a file (e.g., when file is closed)
	 */
	clearFileState(filePath: string): void {
		this.previousLineStates.delete(filePath);
	}
}
