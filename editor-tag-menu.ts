// editor-tag-menu.ts — "Remove #tag" in Obsidian's OWN editor context menu
// (v1.51.0, fixed for the phone in v1.51.1). Shawn 2026-09-25 (Plan for Today
// → obsidian): "long press and pill pops up to delete a tag, there is already
// a menu that pops up and says edit tag so maybe add to that menu".
//
// Which tag: a capture-phase contextmenu listener maps the press point to a
// document position through the CodeMirror view under it (any markdown
// editor: a note in source mode or live preview, or an embedded card editor),
// falling back to the selection — a phone long-press selects a word, usually
// the "thread" part of "#thread/x" — or the cursor.
//
// Where the item goes — two paths, because Obsidian has two:
//   1. workspace "editor-menu": the ordinary editor menu (desktop always;
//      mobile when there is a selection).
//   2. Obsidian 1.13's editor contextmenu handler, on MOBILE with nothing
//      selected and a tag/link under the press, shows its short token menu
//      ("Edit tag") and deliberately skips editor-menu
//      (`!sel && isMobile && token || trigger("editor-menu", …)`, read from the
//      app bundle 2026-09-26). That is exactly Shawn's long-press. So the menu
//      is caught as it is shown: Menu.prototype.showAtMouseEvent is wrapped
//      (restored on unload) and, only when a tag press from the listener
//      above is fresh and path 1 did not already add the item, "Remove #tag"
//      is added next to "Edit tag".
//
// The removal is thread-core's removeTag on that one line — the v1.50.0 edit —
// as one CodeMirror transaction, so one Undo restores it. Reading view is NOT
// covered: it has no editor, so there is no line to edit.
import { Menu, type Plugin } from "obsidian";
import { EditorView } from "@codemirror/view";
import { removeTag } from "./thread-core";
import { tagAtPosition, tagInSelection, type TagSpan } from "./editor-tag-core";
import { confirmRemoveTag } from "./tag-menu";

/** A press this old no longer describes the menu being shown. */
const PRESS_TTL_MS = 1500;

interface TagPress {
	view: EditorView;
	/** 1-based CodeMirror line number. */
	lineNo: number;
	span: TagSpan;
	t: number;
	/** Set once the item has been added to a menu for this press. */
	handled: boolean;
}

export function registerEditorTagMenu(plugin: Plugin): void {
	let press: TagPress | null = null;
	const fresh = (): TagPress | null =>
		press && !press.handled && Date.now() - press.t < PRESS_TTL_MS ? press : null;

	// Capture phase: resolve the tag before Obsidian builds its menu.
	plugin.registerDomEvent(
		document,
		"contextmenu",
		(e: MouseEvent) => {
			press = null;
			const target = e.target;
			if (!(target instanceof Element)) return;
			const dom = target.closest(".cm-editor");
			if (!(dom instanceof HTMLElement)) return;
			const view = EditorView.findFromDOM(dom);
			if (!view) return;
			const hit = tagAtCoords(view, e.clientX, e.clientY) ?? tagAtSelection(view);
			if (hit) press = { view, ...hit, t: Date.now(), handled: false };
		},
		{ capture: true }
	);

	const addItem = (menu: Menu, p: TagPress) => {
		p.handled = true;
		menu.addItem((item) =>
			item
				.setTitle(`Remove ${p.span.tag}`)
				.setIcon("x")
				.setSection("selection")
				.onClick(() =>
					confirmRemoveTag(
						plugin.app,
						p.span.tag,
						() => applyRemoval(p.view, p.lineNo, p.span.tag),
						"this line"
					)
				)
		);
	};

	// Path 1: the ordinary editor menu.
	plugin.registerEvent(
		plugin.app.workspace.on("editor-menu", (menu: Menu) => {
			const p = fresh();
			if (p) addItem(menu, p);
		})
	);

	// Path 2: the mobile token menu that skips editor-menu.
	const proto = Menu.prototype as unknown as {
		showAtMouseEvent: (this: Menu, evt: MouseEvent) => Menu;
	};
	const original = proto.showAtMouseEvent;
	proto.showAtMouseEvent = function (this: Menu, evt: MouseEvent): Menu {
		try {
			const p = fresh();
			if (p) addItem(this, p);
		} catch (err) {
			console.error("shawns-toolbox: editor tag menu", err);
		}
		return original.call(this, evt);
	};
	plugin.register(() => {
		proto.showAtMouseEvent = original;
	});
}

/** The tag under a screen point, or null. */
function tagAtCoords(
	view: EditorView,
	x: number,
	y: number
): { lineNo: number; span: TagSpan } | null {
	const pos = view.posAtCoords({ x, y });
	if (pos === null) return null;
	const line = view.state.doc.lineAt(pos);
	const span = tagAtPosition(line.text, pos - line.from);
	return span ? { lineNo: line.number, span } : null;
}

/** The tag the selection sits in / covers, or under the cursor. */
function tagAtSelection(view: EditorView): { lineNo: number; span: TagSpan } | null {
	const sel = view.state.selection.main;
	const line = view.state.doc.lineAt(sel.from);
	if (sel.to > line.to) return null;
	const from = sel.from - line.from;
	const to = sel.to - line.from;
	const span =
		from !== to ? tagInSelection(line.text, from, to) : tagAtPosition(line.text, from);
	return span ? { lineNo: line.number, span } : null;
}

/** Re-read the line (it may have changed while the confirm was open) and
 *  remove the tag from it in one undoable transaction. */
function applyRemoval(view: EditorView, lineNo: number, tag: string): void {
	if (!view.dom.isConnected) return;
	if (lineNo > view.state.doc.lines) return;
	const line = view.state.doc.line(lineNo);
	const after = removeTag(line.text, tag);
	if (after === line.text) return;
	view.dispatch({
		changes: { from: line.from, to: line.to, insert: after },
		userEvent: "delete",
	});
}
