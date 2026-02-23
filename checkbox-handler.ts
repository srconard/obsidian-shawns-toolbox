import { ViewPlugin, EditorView } from "@codemirror/view";
import type { PluginValue } from "@codemirror/view";
import type { ShawnsToolboxSettings } from "./settings";

// Regex to match a checked checkbox line
// Matches: - [x], * [x], + [x], or numbered like 1. [x], 1) [x]
const CHECKED_CHECKBOX_REGEX = /^(\s*)([-*+]|\d+[.)]) \[x\] /i;

// Regex to match an unchecked checkbox line
const UNCHECKED_CHECKBOX_REGEX = /^(\s*)([-*+]|\d+[.)]) \[ \] /;

// Regex matching the completion stamp: ✅ YYYY-MM-DD with optional HH:MM
const COMPLETION_STAMP_REGEX = / ✅ \d{4}-\d{2}-\d{2}( \d{2}:\d{2})?/;

export function isCheckedCheckbox(line: string): boolean {
	return CHECKED_CHECKBOX_REGEX.test(line);
}

export function isUncheckedCheckbox(line: string): boolean {
	return UNCHECKED_CHECKBOX_REGEX.test(line);
}

export function shouldExcludeLine(
	line: string,
	excludePatterns: string[]
): boolean {
	return excludePatterns.some((pattern) => line.includes(pattern));
}

export function hasCompletionStamp(line: string): boolean {
	return line.includes("✅");
}

export function removeCompletionStamp(line: string): string {
	return line.replace(COMPLETION_STAMP_REGEX, "");
}

export function formatDate(date: Date, _format: string): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function formatTime(date: Date): string {
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${hours}:${minutes}`;
}

/**
 * Builds the completion stamp string based on current settings.
 */
function buildStamp(settings: ShawnsToolboxSettings): string {
	const now = new Date();
	const dateStr = formatDate(now, settings.dateFormat);
	const timeStr = settings.includeTime ? ` ${formatTime(now)}` : "";
	return ` ✅ ${dateStr}${timeStr}`;
}

/**
 * Inspect a line and dispatch a stamp addition or removal if needed.
 * Works directly with the CodeMirror EditorView so we don't depend
 * on Obsidian's Editor wrapper or cursor position.
 */
function processLine(
	view: EditorView,
	lineNumber: number,
	settings: ShawnsToolboxSettings
): void {
	const line = view.state.doc.line(lineNumber);
	const text = line.text;

	if (isCheckedCheckbox(text) && !hasCompletionStamp(text) && !shouldExcludeLine(text, settings.excludePatterns)) {
		const stamp = buildStamp(settings);
		view.dispatch({
			changes: { from: line.to, insert: stamp },
		});
	} else if (isUncheckedCheckbox(text) && hasCompletionStamp(text)) {
		const cleaned = removeCompletionStamp(text);
		view.dispatch({
			changes: { from: line.from, to: line.to, insert: cleaned },
		});
	}
}

/**
 * Shared mutable reference so the CodeMirror extensions can read
 * the latest plugin settings and enabled state without reconstruction.
 */
export interface CheckboxHandlerState {
	settings: ShawnsToolboxSettings;
	enabled: boolean;
}

/**
 * CodeMirror ViewPlugin that listens for checkbox clicks in live preview.
 * Uses posAtDOM() to find the exact line of the clicked checkbox, which
 * is reliable regardless of where the cursor happens to be.
 */
function buildClickPlugin(state: CheckboxHandlerState) {
	class ClickHandler implements PluginValue {
		private view: EditorView;
		private handler: (evt: MouseEvent) => void;

		constructor(view: EditorView) {
			this.view = view;
			this.handler = this.handleClick.bind(this);
			this.view.dom.addEventListener("click", this.handler);
		}

		destroy() {
			this.view.dom.removeEventListener("click", this.handler);
		}

		// eslint-disable-next-line @typescript-eslint/no-empty-function
		update() {}

		private handleClick(evt: MouseEvent) {
			if (!state.enabled) return;

			const target = evt.target as HTMLElement;
			if (
				!(target instanceof HTMLInputElement) ||
				target.type !== "checkbox"
			) {
				return;
			}

			// posAtDOM gives us the exact doc position of the clicked element
			const pos = this.view.posAtDOM(target);
			const line = this.view.state.doc.lineAt(pos);

			// Defer so Obsidian's own checkbox toggle completes first
			setTimeout(() => {
				// Re-read the line after Obsidian has toggled the checkbox
				const updatedLine = this.view.state.doc.line(line.number);
				const text = updatedLine.text;

				if (
					isCheckedCheckbox(text) &&
					!hasCompletionStamp(text) &&
					!shouldExcludeLine(text, state.settings.excludePatterns)
				) {
					const stamp = buildStamp(state.settings);
					this.view.dispatch({
						changes: { from: updatedLine.to, insert: stamp },
					});
				} else if (isUncheckedCheckbox(text) && hasCompletionStamp(text)) {
					const cleaned = removeCompletionStamp(text);
					this.view.dispatch({
						changes: {
							from: updatedLine.from,
							to: updatedLine.to,
							insert: cleaned,
						},
					});
				}
			}, 10);
		}
	}

	return ViewPlugin.fromClass(ClickHandler);
}

/**
 * CodeMirror updateListener that catches checkbox toggles from keyboard
 * shortcuts (Ctrl/Cmd+Enter) or the command palette. Compares old and
 * new line content for each changed range to detect checkbox transitions.
 */
function buildUpdateListener(state: CheckboxHandlerState) {
	return EditorView.updateListener.of((update) => {
		if (!state.enabled || !update.docChanged) return;

		// Collect line numbers that were affected by changes
		const changedLineNumbers = new Set<number>();
		update.changes.iterChanges((_fromA, _toA, fromB, toB) => {
			const startLine = update.state.doc.lineAt(fromB).number;
			const endLine = update.state.doc.lineAt(toB).number;
			for (let n = startLine; n <= endLine; n++) {
				changedLineNumbers.add(n);
			}
		});

		for (const lineNumber of changedLineNumbers) {
			const line = update.state.doc.line(lineNumber);
			const text = line.text;

			// Only act if the line is a checkbox and needs stamp work.
			// Skip if this change was likely dispatched by us (stamp text).
			if (text.includes("✅") && isCheckedCheckbox(text)) continue;

			if (
				isCheckedCheckbox(text) &&
				!hasCompletionStamp(text) &&
				!shouldExcludeLine(text, state.settings.excludePatterns)
			) {
				// Defer to avoid dispatching inside an update listener
				setTimeout(() => processLine(update.view, lineNumber, state.settings), 0);
			} else if (isUncheckedCheckbox(text) && hasCompletionStamp(text)) {
				setTimeout(() => processLine(update.view, lineNumber, state.settings), 0);
			}
		}
	});
}

/**
 * Creates the pair of CodeMirror extensions that handle checkbox stamping.
 * Register both via plugin.registerEditorExtension() in main.ts.
 */
export function createCheckboxExtensions(state: CheckboxHandlerState) {
	return [buildClickPlugin(state), buildUpdateListener(state)];
}
