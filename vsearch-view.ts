// vsearch-view.ts — the Vault search panel (v1.46.0).
//
// Semantic search over the whole vault, in a side panel: type a sentence, get
// back the notes NAMED like it and every passage anywhere that SAYS something
// like it. Shawn's ask (2026-09-22, voice): "I type something like 'no one is
// better than anyone else', and it shows the notes named similar to this and
// everywhere where I have written something similar to that."
//
// The embeddings live on the NAS, not in the plugin: the vault index is a
// sqlite DB queried by a python venv, so the panel asks the bridge's /search
// endpoint (`requestUrl`, which is the only HTTP that works on Android) and
// ranks the title half locally from `app.vault.getMarkdownFiles()`. All the
// parsing and ranking is in vsearch-core.ts; this file is DOM + network.
//
// Rebuild-safe by design: the dual panel re-creates its panes on a drawer
// swipe-away/back, so the last query AND its results are kept in a module-level
// cache and re-rendered on open — coming back to the panel must not cost
// another embedding call, and must not show a blank box where results were.
import { Notice, requestUrl, setIcon } from "obsidian";
import { ToolboxPanel } from "./panel-base";
import { ToolboxPanelView } from "./panel-view";
import {
	buildSearchUrl,
	formatScore,
	hitLinkText,
	noteTitle,
	parseSearchResponse,
	rankTitleMatches,
	snippet,
	stripBreadcrumb,
	VSEARCH_MAX_K,
	VSEARCH_PAGE_K,
	type TitleMatch,
	type VaultHit,
	type VSearchCorpus,
} from "./vsearch-core";
import {
	MicRecorder,
	appendTranscript,
	failureEmbed,
	parkFailedAudio,
	transcribeChain,
} from "./voice-capture";

export const VSEARCH_VIEW_TYPE = "shawns-toolbox-vsearch";

/** Survives a pane rebuild; cleared only by a new search. */
interface SearchState {
	query: string;
	k: number;
	hits: VaultHit[];
	titles: TitleMatch[];
	error: string | null;
}

let lastSearch: SearchState | null = null;

/**
 * The response body as text. `res.json` is a getter that THROWS on a
 * non-JSON body, so reading it to decide whether the body is JSON is the one
 * thing you must not do; `res.text` is inert.
 */
function bodyText(res: { text?: string; arrayBuffer?: ArrayBuffer }): string {
	if (typeof res.text === "string") return res.text;
	return "";
}

export class VSearchPanel extends ToolboxPanel {
	private inputEl: HTMLTextAreaElement | null = null;
	private resultsEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private searchBtn: HTMLButtonElement | null = null;
	private micBtn: HTMLButtonElement | null = null;
	private micIcon: HTMLElement | null = null;
	private recorder: MicRecorder | null = null;
	private recording = false;
	private busy = false;

	protected async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("stx-vsearch-root");

		const bar = root.createDiv("stx-vsearch-bar");
		const field = bar.createDiv("stx-vsearch-field");
		const input = field.createEl("textarea", {
			cls: "stx-vsearch-input",
			attr: {
				rows: "2",
				placeholder: "say it how you'd say it…",
			},
		});
		this.inputEl = input;
		input.value = lastSearch?.query ?? this.host.getSettings().vaultSearchLastQuery ?? "";
		input.addEventListener("keydown", (e) => {
			// Enter searches (the obvious phone gesture); Shift+Enter newlines.
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				void this.runSearch(VSEARCH_PAGE_K);
			}
		});

		const mic = field.createEl("button", {
			cls: "stx-vsearch-mic",
			attr: { "aria-label": "Dictate the query", type: "button" },
		});
		this.micBtn = mic;
		this.micIcon = mic.createSpan({ cls: "stx-vsearch-mic-icon" });
		setIcon(this.micIcon, "mic");
		mic.addEventListener("click", () => void this.toggleMic());

		const go = bar.createEl("button", {
			cls: "stx-vsearch-go mod-cta",
			text: "Search",
		});
		this.searchBtn = go;
		go.addEventListener("click", () => void this.runSearch(VSEARCH_PAGE_K));

		this.statusEl = root.createDiv("stx-vsearch-status");
		this.resultsEl = root.createDiv("stx-vsearch-results");

		// Re-render whatever the last search found, without hitting the network.
		if (lastSearch && lastSearch.query) this.render();
		else this.setStatus("Search your whole vault by meaning, not words.");
	}

	protected async onClose(): Promise<void> {
		this.recorder?.cancel();
		this.recorder = null;
		this.recording = false;
		this.contentEl.empty();
	}

	// ---- search ----

	private async runSearch(k: number): Promise<void> {
		if (this.busy) return;
		const query = (this.inputEl?.value ?? "").trim();
		if (!query) {
			this.setStatus("Type something to search for.");
			return;
		}
		const settings = this.host.getSettings();
		settings.vaultSearchLastQuery = query;
		void this.host.saveSettings();

		this.busy = true;
		if (this.searchBtn) this.searchBtn.disabled = true;
		this.setStatus("Searching…");
		// The title half is local and instant — show it even if the bridge is
		// down, because half an answer beats an error page.
		const titles = rankTitleMatches(
			query,
			this.host.app.vault.getMarkdownFiles().map((f) => f.path)
		);
		let hits: VaultHit[] = [];
		let error: string | null = null;
		try {
			hits = await this.fetchHits(query, k);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
		lastSearch = {
			query,
			k,
			hits,
			// Re-rank now that we know which notes the passages came from.
			titles: hits.length
				? rankTitleMatches(
						query,
						this.host.app.vault.getMarkdownFiles().map((f) => f.path),
						undefined,
						hits.map((h) => h.note)
					)
				: titles,
			error,
		};
		this.busy = false;
		if (this.searchBtn) this.searchBtn.disabled = false;
		this.render();
	}

	private async fetchHits(query: string, k: number): Promise<VaultHit[]> {
		const settings = this.host.getSettings();
		const url = buildSearchUrl(settings.vaultSearchUrl, query, {
			k,
			corpus: settings.vaultSearchCorpus as VSearchCorpus,
		});
		// requestUrl, not fetch: Android's webview blocks plain-http XHR to a
		// LAN/Tailscale host, and every other NAS lane in this plugin uses it.
		let res;
		try {
			res = await requestUrl({ url, method: "GET", throw: false });
		} catch (e) {
			// No response at all — NAS asleep, Tailscale down, wrong URL.
			throw new Error(
				`Can't reach the bridge at ${settings.vaultSearchUrl} ` +
					`(${e instanceof Error ? e.message : String(e)})`
			);
		}
		const body = bodyText(res);
		if (res.status >= 300) {
			// The bridge answers a bad param with {"error": "..."} — show that
			// sentence, not a bare status code he can do nothing with.
			let detail = body.slice(0, 200);
			try {
				const parsed = JSON.parse(body);
				if (parsed && typeof parsed.error === "string") detail = parsed.error;
			} catch {
				/* plain-text body; the slice above is the best we have */
			}
			throw new Error(`Bridge ${res.status}: ${detail || "search failed"}`);
		}
		let payload: unknown;
		try {
			payload = JSON.parse(body);
		} catch {
			throw new Error(
				"The bridge answered with something that isn't JSON — is the " +
					"URL pointing at the bridge's /search?"
			);
		}
		return parseSearchResponse(payload);
	}

	// ---- rendering ----

	private setStatus(text: string, isError = false): void {
		const el = this.statusEl;
		if (!el) return;
		el.empty();
		el.toggleClass("is-error", isError);
		if (text) el.setText(text);
	}

	private render(): void {
		const results = this.resultsEl;
		const state = lastSearch;
		if (!results || !state) return;
		results.empty();

		if (state.error) {
			this.setStatus(state.error, true);
		} else {
			const n = state.hits.length;
			this.setStatus(
				`${state.titles.length} note${state.titles.length === 1 ? "" : "s"} · ` +
					`${n} passage${n === 1 ? "" : "s"}`
			);
		}

		if (state.titles.length > 0) {
			const group = results.createDiv("stx-vsearch-group");
			group.createDiv({ cls: "stx-vsearch-group-title", text: "Notes" });
			for (const match of state.titles) this.buildTitleRow(group, match);
		}

		if (state.hits.length > 0) {
			const group = results.createDiv("stx-vsearch-group");
			group.createDiv({ cls: "stx-vsearch-group-title", text: "Passages" });
			for (const hit of state.hits) this.buildHitRow(group, hit, state.query);
			// Only offer "More" when the page came back full — a short page is
			// the whole answer, and a second call would just re-embed the query.
			if (state.hits.length >= state.k && state.k < VSEARCH_MAX_K) {
				const more = results.createEl("button", {
					cls: "stx-vsearch-more",
					text: "More passages",
				});
				more.addEventListener("click", () =>
					void this.runSearch(VSEARCH_MAX_K)
				);
			}
		}

		if (!state.error && state.titles.length === 0 && state.hits.length === 0) {
			results.createDiv({
				cls: "stx-vsearch-empty",
				text: "Nothing close enough. Try saying it a different way.",
			});
		}
	}

	private buildTitleRow(parent: HTMLElement, match: TitleMatch): void {
		const row = parent.createDiv("stx-vsearch-row stx-vsearch-note");
		row.createDiv({ cls: "stx-vsearch-note-title", text: match.title });
		const folder = match.path.split("/").slice(0, -1).join("/");
		if (folder) row.createDiv({ cls: "stx-vsearch-path", text: folder });
		row.addEventListener("click", () => this.open(match.path));
	}

	private buildHitRow(parent: HTMLElement, hit: VaultHit, query: string): void {
		const row = parent.createDiv("stx-vsearch-row stx-vsearch-hit");
		const head = row.createDiv("stx-vsearch-hit-head");
		head.createSpan({ cls: "stx-vsearch-hit-note", text: noteTitle(hit.note) });
		if (hit.heading) {
			head.createSpan({ cls: "stx-vsearch-hit-heading", text: hit.heading });
		}
		head.createSpan({ cls: "stx-vsearch-score", text: formatScore(hit.score) });
		row.createDiv({
			cls: "stx-vsearch-snippet",
			text: snippet(stripBreadcrumb(hit.text, hit.note, hit.heading), query),
		});
		row.addEventListener("click", () =>
			this.open(hitLinkText(hit.note, hit.heading))
		);
	}

	/** Open a note (optionally at a heading) in the main pane. */
	private open(linkText: string): void {
		try {
			void this.host.app.workspace.openLinkText(linkText, "", false);
		} catch (e) {
			new Notice(
				`Could not open ${linkText}: ` +
					(e instanceof Error ? e.message : String(e))
			);
		}
	}

	// ---- dictation (same Groq→OpenAI chain as the pillar inbox modal) ----

	private async toggleMic(): Promise<void> {
		if (this.recording) {
			await this.stopAndTranscribe();
			return;
		}
		try {
			this.recorder = new MicRecorder();
			await this.recorder.start();
		} catch (e) {
			this.recorder = null;
			new Notice(
				"Microphone unavailable: " +
					(e instanceof Error ? e.message : String(e))
			);
			return;
		}
		this.recording = true;
		this.micBtn?.addClass("is-recording");
		if (this.micIcon) setIcon(this.micIcon, "square");
	}

	private async stopAndTranscribe(): Promise<void> {
		const recorder = this.recorder;
		this.recorder = null;
		this.recording = false;
		this.micBtn?.removeClass("is-recording");
		if (this.micIcon) setIcon(this.micIcon, "mic");
		if (!recorder) return;
		const blob = await recorder.stop();
		if (blob.size === 0) {
			new Notice("No audio captured");
			return;
		}
		this.micBtn?.addClass("is-busy");
		if (this.micIcon) setIcon(this.micIcon, "loader");
		try {
			let text: string;
			try {
				text = await transcribeChain(this.host.getSettings(), blob);
			} catch (err) {
				// Never lose a recording, even one that was only ever a query.
				const reason = err instanceof Error ? err.message : String(err);
				const path = await parkFailedAudio(
					this.host.app,
					this.host.getSettings(),
					blob
				);
				this.insert(failureEmbed(path));
				new Notice(
					`Transcription failed (${reason}). Audio saved → ${path}`,
					12000
				);
				return;
			}
			this.insert(text);
			void this.runSearch(VSEARCH_PAGE_K);
		} finally {
			this.micBtn?.removeClass("is-busy");
			if (this.micIcon) setIcon(this.micIcon, "mic");
		}
	}

	private insert(text: string): void {
		const el = this.inputEl;
		if (!el) return;
		el.value = appendTranscript(el.value, text);
		el.focus();
	}
}

export class VSearchView extends ToolboxPanelView {
	getViewType(): string {
		return VSEARCH_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Vault search";
	}

	getIcon(): string {
		return "scan-search";
	}

	protected createPanel(container: HTMLElement): ToolboxPanel {
		return new VSearchPanel(this.host, container);
	}
}
