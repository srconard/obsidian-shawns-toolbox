// embedded-editor.ts — an editable Obsidian markdown editor mounted in an
// arbitrary container, used by the section cards.
//
// Obsidian has no public API for this. We lift the internal MarkdownEditor
// class out of the registered ".md" embed creator — the pattern Meta Bind,
// Modal Form, and Kanban rely on. Internals can shift across Obsidian
// updates, so resolution failure is non-fatal: callers get a plain
// <textarea> instead of a broken view.

import { App, Component, TFile } from "obsidian";
import {
	indentLines,
	moveLines,
	lineOfOffset,
	colOfOffset,
	offsetOf,
} from "./line-ops";

export type LineOp = "indent" | "outdent" | "up" | "down";

export interface EmbeddedEditorOptions {
	value: string;
	/** Vault path used as the editor's file context for link resolution. */
	filePath?: string;
	onChange?: (value: string) => void;
	onBlur?: (value: string) => void;
}

let EditorClass: any = null;
let resolveFailed = false;

function resolveEditorClass(app: App): any {
	if (EditorClass || resolveFailed) return EditorClass;
	try {
		const creator = (app as any).embedRegistry?.embedByExtension?.md;
		if (!creator) throw new Error("embedRegistry .md creator missing");
		// A throwaway embed instantiated only to reach the editor prototype.
		const embed = creator(
			{ app, containerEl: createDiv() },
			null as unknown as TFile,
			""
		);
		embed.editable = true;
		embed.showEditor();
		EditorClass = Object.getPrototypeOf(
			Object.getPrototypeOf(embed.editMode)
		).constructor;
		embed.unload();
	} catch (e) {
		console.warn(
			"[shawns-toolbox] embedded editor internals unavailable — section cards fall back to a textarea",
			e
		);
		resolveFailed = true;
		EditorClass = null;
	}
	return EditorClass;
}

export class EmbeddedMarkdownEditor extends Component {
	private editor: any = null;
	private textarea: HTMLTextAreaElement | null = null;

	constructor(
		private app: App,
		container: HTMLElement,
		private opts: EmbeddedEditorOptions
	) {
		super();
		const Cls = resolveEditorClass(app);
		if (Cls) {
			try {
				this.mountRealEditor(Cls, container);
			} catch (e) {
				console.warn(
					"[shawns-toolbox] embedded editor mount failed — falling back to a textarea",
					e
				);
				this.editor = null;
				this.mountTextarea(container);
			}
		} else {
			this.mountTextarea(container);
		}
	}

	private mountRealEditor(Cls: any, container: HTMLElement): void {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;
		class SectionEditor extends Cls {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			constructor(...args: any[]) {
				super(...args);
			}
			onUpdate(update: unknown, changed: boolean) {
				super.onUpdate(update, changed);
				// Guard: onUpdate can fire during construction, before the
				// wrapper's `editor` field is assigned — get() would return "".
				if (changed && self.editor) self.opts.onChange?.(self.get());
			}
			get file(): TFile | null {
				if (!self.opts.filePath) return null;
				const f = self.app.vault.getAbstractFileByPath(
					self.opts.filePath
				);
				return f instanceof TFile ? f : null;
			}
		}
		this.editor = new SectionEditor(this.app, container, {
			app: this.app,
			onMarkdownScroll: () => {},
			getMode: () => "source",
		});
		this.editor.set(this.opts.value, false);
		const el: HTMLElement = this.editor.editorEl ?? container;
		if (this.opts.onBlur) {
			this.registerDomEvent(el, "focusout", () =>
				this.opts.onBlur?.(this.get())
			);
		}
		this.registerDomEvent(el, "focusin", () => this.claimActiveEditor());
	}

	/**
	 * Announce this embedded editor as the workspace's active editor while it
	 * has focus. Obsidian's mobile toolbar (the strip above the keyboard) and
	 * every editor command (toggle bullet/checkbox, indent, move line) act on
	 * `workspace.activeEditor` — a real MarkdownView sets it on focus, but an
	 * embedded editor doesn't, which leaves the toolbar container empty and
	 * its buttons dead. Internals-based (like the editor mount itself), so
	 * failure is silent: the toolbar just doesn't light up.
	 */
	private claimActiveEditor(): void {
		if (!this.editor) return;
		try {
			const owner = this.editor.owner;
			if (!owner) return;
			// The owner is our options object; commands expect a
			// MarkdownFileInfo shape — give it `editor` and `file` lazily.
			if (!("editor" in owner)) {
				Object.defineProperty(owner, "editor", {
					get: () => this.editor?.editor ?? null,
					configurable: true,
				});
			}
			if (!("file" in owner)) {
				Object.defineProperty(owner, "file", {
					get: () => {
						if (!this.opts.filePath) return null;
						const f = this.app.vault.getAbstractFileByPath(
							this.opts.filePath
						);
						return f instanceof TFile ? f : null;
					},
					configurable: true,
				});
			}
			if (!owner.editor) return;
			const ws = this.app.workspace as any;
			ws.activeEditor = owner;
			const toolbar = (this.app as any).mobileToolbar;
			toolbar?.update?.();
			toolbar?.requestUpdate?.();
		} catch {
			// internals moved — never break typing over a toolbar nicety
		}
	}

	private mountTextarea(container: HTMLElement): void {
		this.textarea = container.createEl("textarea", {
			cls: "stx-fallback-editor",
		});
		this.textarea.value = this.opts.value;
		this.registerDomEvent(this.textarea, "input", () =>
			this.opts.onChange?.(this.textarea?.value ?? "")
		);
		if (this.opts.onBlur) {
			this.registerDomEvent(this.textarea, "blur", () =>
				this.opts.onBlur?.(this.textarea?.value ?? "")
			);
		}
	}

	get(): string {
		if (this.editor) {
			return this.editor.get?.() ?? "";
		}
		return this.textarea?.value ?? "";
	}

	/** Replace content without emitting onChange back to the caller. */
	set(value: string): void {
		if (this.editor) {
			this.editor.set(value, false);
		} else if (this.textarea) {
			this.textarea.value = value;
		}
	}

	/**
	 * Apply a line operation (indent/outdent/move) to the lines under the
	 * cursor or selection, preserving the cursor's line-relative position.
	 * Returns whether anything changed.
	 */
	applyLineOp(op: LineOp): boolean {
		const text = this.get();
		const sel = this.getSelectionOffsets();
		if (sel === null) return false;
		const startLine = lineOfOffset(text, Math.min(sel.anchor, sel.head));
		const endLine = lineOfOffset(text, Math.max(sel.anchor, sel.head));
		const col = colOfOffset(text, sel.head);
		const res =
			op === "indent" || op === "outdent"
				? indentLines(text, startLine, endLine, op === "indent" ? 1 : -1)
				: moveLines(text, startLine, endLine, op === "up" ? -1 : 1);
		if (!res.changed) return false;
		// Put a plain cursor on the head's line, same column (clamped).
		const headLine =
			res.startLine + (lineOfOffset(text, sel.head) - startLine);
		const pos = offsetOf(res.text, headLine, col);
		this.setWithSelection(res.text, pos);
		this.opts.onChange?.(res.text);
		return true;
	}

	private getSelectionOffsets(): { anchor: number; head: number } | null {
		if (this.editor) {
			const cm = this.editor.activeCM;
			const main = cm?.state?.selection?.main;
			if (!main) return null;
			return { anchor: main.anchor, head: main.head };
		}
		if (this.textarea) {
			return {
				anchor: this.textarea.selectionStart,
				head: this.textarea.selectionEnd,
			};
		}
		return null;
	}

	private setWithSelection(value: string, pos: number): void {
		if (this.editor) {
			const cm = this.editor.activeCM;
			if (cm?.dispatch) {
				cm.dispatch({
					changes: { from: 0, to: cm.state.doc.length, insert: value },
					selection: { anchor: pos },
					scrollIntoView: true,
				});
				return;
			}
			this.editor.set(value, false);
		} else if (this.textarea) {
			this.textarea.value = value;
			this.textarea.setSelectionRange(pos, pos);
		}
	}

	get hasFocus(): boolean {
		if (this.editor) {
			return this.editor.activeCM?.hasFocus ?? false;
		}
		return this.textarea
			? document.activeElement === this.textarea
			: false;
	}

	onunload(): void {
		try {
			this.editor?.destroy?.();
			this.editor?.unload?.();
		} catch {
			// a torn-down editor must never break the card that owns it
		}
		this.editor = null;
	}
}
