// editor-tag-menu.ts — "Remove #tag" in Obsidian's OWN editor context menu
// (v1.51.0). Shawn 2026-09-25 (Plan for Today → obsidian): "long press and pill
// pops up to delete a tag, there is already a menu that pops up and says edit
// tag so maybe add to that menu".
//
// Hooked on workspace "editor-menu", so it works wherever Obsidian shows that
// menu for a markdown editor: source mode and live preview, right-click on
// desktop, long-press on the phone. Which tag? The one under the press: the
// last contextmenu point is mapped to a document position through the editor's
// CodeMirror view; failing that, the selection (a phone long-press selects the
// word, usually the "thread" part of "#thread/x") or the cursor. The removal
// is thread-core's removeTag on that one line — the v1.50.0 edit — applied as
// a single replaceRange so one Undo restores it.
//
// Reading view is NOT covered: it has no editor, so Obsidian never emits
// editor-menu there and a rendered tag has no line to edit.
import { type Editor, type Menu, type Plugin } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { removeTag } from "./thread-core";
import { tagAtPosition, tagInSelection, type TagSpan } from "./editor-tag-core";
import { confirmRemoveTag } from "./tag-menu";

/** A press this old no longer describes the menu being built. */
const PRESS_TTL_MS = 1500;

export function registerEditorTagMenu(plugin: Plugin): void {
	let lastPress: { x: number; y: number; t: number } | null = null;
	// Capture phase: record the point before Obsidian builds its menu.
	plugin.registerDomEvent(
		document,
		"contextmenu",
		(e: MouseEvent) => {
			lastPress = { x: e.clientX, y: e.clientY, t: Date.now() };
		},
		{ capture: true }
	);
	plugin.registerEvent(
		plugin.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
			const press =
				lastPress && Date.now() - lastPress.t < PRESS_TTL_MS ? lastPress : null;
			const hit = findTagForMenu(editor, press);
			if (!hit) return;
			const { line, span } = hit;
			menu.addItem((item) =>
				item
					.setTitle(`Remove ${span.tag}`)
					.setIcon("x")
					.setSection("action")
					.onClick(() =>
						confirmRemoveTag(
							plugin.app,
							span.tag,
							() => applyRemoval(editor, line, span.tag),
							"this line"
						)
					)
			);
		})
	);
}

/** Where the menu's tag is: press point → selection → cursor. */
function findTagForMenu(
	editor: Editor,
	press: { x: number; y: number } | null
): { line: number; span: TagSpan } | null {
	if (press) {
		const cm = (editor as unknown as { cm?: EditorView }).cm;
		const offset = cm?.posAtCoords({ x: press.x, y: press.y });
		if (typeof offset === "number") {
			const pos = editor.offsetToPos(offset);
			const span = tagAtPosition(editor.getLine(pos.line), pos.ch);
			if (span) return { line: pos.line, span };
		}
	}
	const from = editor.getCursor("from");
	const to = editor.getCursor("to");
	if (from.line === to.line) {
		const text = editor.getLine(from.line);
		const span =
			from.ch !== to.ch
				? tagInSelection(text, from.ch, to.ch)
				: tagAtPosition(text, from.ch);
		if (span) return { line: from.line, span };
	}
	return null;
}

/** Re-read the line (it may have changed while the confirm was open) and
 *  remove the tag from it in one undoable edit. */
function applyRemoval(editor: Editor, line: number, tag: string): void {
	if (line >= editor.lineCount()) return;
	const before = editor.getLine(line);
	const after = removeTag(before, tag);
	if (after === before) return;
	editor.replaceRange(after, { line, ch: 0 }, { line, ch: before.length });
}
