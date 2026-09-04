// filing-service.ts — Obsidian glue for "File tweet to note" (v1.37.0).
// Share a tweet/link to Obsidian → this adds a "File tweet to note…" row to the
// share-sheet menu (workspace 'receive-text-menu', the API ReadItLater uses) →
// a note picker (today's daily note first) → POST /ingest {filed:true} to the
// media-inbox server → append `- [[resource|AI title]] >[[date]]` (with each
// referenced child resource as an indented bullet) under the note's # Resources
// section. Pure string logic lives in filing-core.ts.
import {
	App,
	FuzzySuggestModal,
	Notice,
	TFile,
	requestUrl,
	type Menu,
} from "obsidian";
import {
	extractFirstUrl,
	formatResourceBlock,
	type FiledResponse,
} from "./filing-core";
import { appendToSection } from "./section-core";
import { ensureDailyNote, logicalTodayIso } from "./capture-service";
import type { ShawnsToolboxSettings } from "./settings";

const RESOURCES_SECTION = "# Resources";

/** POST /ingest {filed:true} and return the created resource notes. Throws on failure. */
export async function ingestFiled(
	settings: ShawnsToolboxSettings,
	url: string
): Promise<FiledResponse> {
	const base = settings.mediaInboxUrl.replace(/\/+$/, "");
	if (!base) throw new Error("Set the Media Inbox server URL in settings");
	const res = await requestUrl({
		url: `${base}/ingest`,
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-media-key": settings.mediaInboxKey,
		},
		body: JSON.stringify({ url, filed: true }),
		throw: false,
	});
	if (res.status >= 300) {
		const detail = (res.json?.error ?? res.text ?? "").toString().slice(0, 200);
		throw new Error(`Media Inbox ${res.status}: ${detail}`);
	}
	const body = res.json as Partial<FiledResponse> | undefined;
	if (!body || typeof body.note !== "string" || typeof body.title !== "string") {
		throw new Error("Media Inbox returned an unexpected response");
	}
	return { note: body.note, title: body.title, children: body.children ?? [] };
}

/**
 * A markdown-note picker whose first suggestion (empty query) is the default —
 * today's daily note. Everything else follows in vault order; fuzzy typing
 * narrows as usual.
 */
class NotePickerModal extends FuzzySuggestModal<TFile> {
	private readonly items: TFile[];
	private readonly onChoose: (file: TFile) => void;

	constructor(app: App, defaultFile: TFile | null, onChoose: (file: TFile) => void) {
		super(app);
		const all = app.vault.getMarkdownFiles();
		this.items =
			defaultFile && all.includes(defaultFile)
				? [defaultFile, ...all.filter((f) => f !== defaultFile)]
				: all;
		this.onChoose = onChoose;
		this.setPlaceholder("File into which note? (default: today's daily note)");
	}

	getItems(): TFile[] {
		return this.items;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}

/** Append the filed resource (+ its children) under the note's # Resources section. */
async function appendResourceBlock(
	app: App,
	settings: ShawnsToolboxSettings,
	file: TFile,
	filed: FiledResponse
): Promise<void> {
	const block = formatResourceBlock(
		{ note: filed.note, title: filed.title },
		filed.children,
		logicalTodayIso(settings)
	);
	await app.vault.process(file, (content) =>
		appendToSection(content, RESOURCES_SECTION, block)
	);
}

/**
 * The full flow: extract the URL, pick a note (default today's daily note),
 * file it, and link it in. Every failure surfaces as a Notice — nothing throws
 * into Obsidian.
 */
export function fileShareToNote(
	app: App,
	settings: ShawnsToolboxSettings,
	shareText: string
): void {
	const url = extractFirstUrl(shareText);
	if (!url) {
		new Notice("No URL found in the shared text");
		return;
	}
	void (async () => {
		let defaultFile: TFile | null = null;
		try {
			defaultFile = await ensureDailyNote(app, settings, logicalTodayIso(settings));
		} catch {
			// No daily note / template — the picker just opens without a default.
		}
		new NotePickerModal(app, defaultFile, (file) => {
			void (async () => {
				const notice = new Notice("Filing to Media Inbox…", 0);
				try {
					const filed = await ingestFiled(settings, url);
					await appendResourceBlock(app, settings, file, filed);
					const extra =
						filed.children.length > 0
							? ` (+${filed.children.length} referenced)`
							: "";
					notice.setMessage(`Filed → ${file.basename}: ${filed.title}${extra}`);
					setTimeout(() => notice.hide(), 5000);
				} catch (err) {
					notice.hide();
					new Notice(
						`File tweet failed: ${err instanceof Error ? err.message : String(err)}`
					);
				}
			})();
		}).open();
	})();
}

/**
 * Register the share-sheet menu row. The 'receive-text-menu' event fires when
 * something is shared into Obsidian on mobile (verified in ReadItLater's
 * source); it is not in the public typings, so the event name is cast.
 */
export function registerFilingMenu(
	app: App,
	getSettings: () => ShawnsToolboxSettings
): ReturnType<App["workspace"]["on"]> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (app.workspace.on as any)(
		"receive-text-menu",
		(menu: Menu, shareText: string) => {
			if (!extractFirstUrl(shareText)) return;
			menu.addItem((item) =>
				item
					.setTitle("File tweet to note…")
					.setIcon("link")
					.onClick(() => fileShareToNote(app, getSettings(), shareText))
			);
		}
	);
}
