// embedded-editor.ts — an editable Obsidian markdown editor mounted in an
// arbitrary container, used by the section cards.
//
// Obsidian has no public API for this. We lift the internal MarkdownEditor
// class out of the registered ".md" embed creator — the pattern Meta Bind,
// Modal Form, and Kanban rely on. Internals can shift across Obsidian
// updates, so resolution failure is non-fatal: callers get a plain
// <textarea> instead of a broken view.

import { App, Component, TFile } from "obsidian";

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
		if (this.opts.onBlur) {
			const el: HTMLElement = this.editor.editorEl ?? container;
			this.registerDomEvent(el, "focusout", () =>
				this.opts.onBlur?.(this.get())
			);
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
