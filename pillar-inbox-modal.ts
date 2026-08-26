// pillar-inbox-modal.ts — the quick-capture prompt behind the Pillars panel's
// "+" button. Two-taps-fast: tap "+", type (or dictate), Enter/Add. No
// categorisation UI — the item lands as a plain dated bullet in the pillar's
// Inbox; deciding where it lives happens at Sunday review, not at capture time.
//
// The single-line input is an auto-growing textarea so a whole thought stays
// visible, and a mic button lets Shawn dictate: record → transcribe (the
// plugin's Groq→OpenAI chain) → the text drops INTO the box for review before
// he taps Add. If transcription fails, the raw audio is parked in the vault and
// an embed is inserted so the capture still lands and can be transcribed later.
import { App, Modal, Notice, setIcon } from "obsidian";
import type { ShawnsToolboxSettings } from "./settings";
import {
	MicRecorder,
	appendTranscript,
	failureEmbed,
	parkFailedAudio,
	transcribeChain,
} from "./voice-capture";

export class PillarInboxModal extends Modal {
	private vvHandler: (() => void) | null = null;
	private input: HTMLTextAreaElement | null = null;
	private micBtn: HTMLButtonElement | null = null;
	private micIcon: HTMLElement | null = null;
	private recorder: MicRecorder | null = null;
	private recording = false;
	private transcribing = false;

	constructor(
		app: App,
		private pillarName: string,
		private settings: ShawnsToolboxSettings,
		private onSubmit: (text: string) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, modalEl, containerEl } = this;
		contentEl.addClass("stx-pillar-inbox");
		// The default centred modal gets buried under the Android soft keyboard,
		// which covers the bottom half of the screen and hides the single input.
		// Top-align the modal (CSS) and, when the keyboard resizes the visual
		// viewport, keep it pinned inside the still-visible band above the keyboard.
		containerEl.addClass("stx-inbox-modal-container");
		modalEl.addClass("stx-inbox-modal");
		contentEl.createEl("h3", { text: `Capture → ${this.pillarName} inbox` });

		// Auto-growing textarea (was a single-line input) so a longer thought
		// stays visible; it grows as text wraps up to a cap, then scrolls.
		const field = contentEl.createDiv({ cls: "stx-pillar-inbox-field" });
		const input = field.createEl("textarea", {
			cls: "stx-pillar-inbox-input",
			attr: { rows: "1", placeholder: "quick note…" },
		});
		this.input = input;
		input.addEventListener("input", () => this.autoGrow());
		input.addEventListener("keydown", (e) => {
			// Enter inserts a newline (mobile-friendly); submit stays on Add.
			// Mod+Enter is a desktop shortcut to submit without reaching for it.
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				this.submit(input.value);
			}
		});

		// Mic button — dictate into the box. Tap to record, tap to stop.
		const mic = field.createEl("button", {
			cls: "stx-inbox-mic",
			attr: { "aria-label": "Dictate", type: "button" },
		});
		this.micBtn = mic;
		this.micIcon = mic.createSpan({ cls: "stx-inbox-mic-icon" });
		setIcon(this.micIcon, "mic");
		mic.addEventListener("click", () => void this.toggleMic());

		const row = contentEl.createDiv({ cls: "stx-pillar-inbox-row" });
		const add = row.createEl("button", { cls: "mod-cta", text: "Add" });
		add.addEventListener("click", () => this.submit(input.value));
		const cancel = row.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());

		this.repositionAboveKeyboard();
		const vv = window.visualViewport;
		if (vv) {
			this.vvHandler = () => this.repositionAboveKeyboard();
			vv.addEventListener("resize", this.vvHandler);
			vv.addEventListener("scroll", this.vvHandler);
		}
		window.setTimeout(() => {
			input.focus();
			this.autoGrow();
		}, 0);
	}

	/** Grow the textarea to fit its content up to the CSS max-height, then scroll. */
	private autoGrow(): void {
		const el = this.input;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}

	/** Start recording, or stop-and-transcribe if already recording. */
	private async toggleMic(): Promise<void> {
		if (this.transcribing) return;
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
		if (!recorder) return;
		const blob = await recorder.stop();
		if (blob.size === 0) {
			if (this.micIcon) setIcon(this.micIcon, "mic");
			new Notice("No audio captured");
			return;
		}
		this.transcribing = true;
		this.micBtn?.addClass("is-busy");
		if (this.micIcon) setIcon(this.micIcon, "loader");
		try {
			let text: string;
			try {
				text = await transcribeChain(this.settings, blob);
			} catch (err) {
				// Every provider failed: park the audio and embed a link so the
				// capture still lands and can be transcribed later from the inbox.
				await this.handleTranscribeFailure(blob, err);
				return;
			}
			this.insertText(text);
		} finally {
			this.transcribing = false;
			this.micBtn?.removeClass("is-busy");
			if (this.micIcon) setIcon(this.micIcon, "mic");
		}
	}

	/** Park the failed recording and drop an embed into the box (never lose it). */
	private async handleTranscribeFailure(
		blob: Blob,
		err: unknown
	): Promise<void> {
		const reason = err instanceof Error ? err.message : String(err);
		try {
			const path = await parkFailedAudio(this.app, this.settings, blob);
			this.insertText(failureEmbed(path));
			new Notice(
				`Transcription failed (${reason}).\nAudio saved → ${path} — it'll land in the inbox to transcribe later.`,
				12000
			);
		} catch (saveErr) {
			new Notice(
				`Transcription failed (${reason}) AND could not save audio: ` +
					(saveErr instanceof Error ? saveErr.message : String(saveErr)),
				15000
			);
		}
	}

	/** Append text into the box (after any existing text), keep focus, regrow. */
	private insertText(text: string): void {
		const el = this.input;
		if (!el) return;
		el.value = appendTranscript(el.value, text);
		el.focus();
		this.autoGrow();
	}

	/**
	 * Keep the modal in the upper part of the currently-visible viewport. On
	 * mobile the keyboard shrinks window.visualViewport (and may scroll the layout
	 * viewport under it); pinning the modal's top margin to the visible band's
	 * offset keeps the input on-screen while typing.
	 */
	private repositionAboveKeyboard(): void {
		const vv = window.visualViewport;
		if (!vv) return;
		this.modalEl.style.marginTop = `${Math.max(16, vv.offsetTop + 16)}px`;
	}

	private submit(raw: string): void {
		const text = raw.trim();
		this.close();
		if (text) this.onSubmit(text);
	}

	onClose(): void {
		// Tear down any in-flight recording so a modal closed mid-record releases
		// the mic and drops the pending audio cleanly.
		this.recorder?.cancel();
		this.recorder = null;
		this.recording = false;
		this.transcribing = false;
		const vv = window.visualViewport;
		if (vv && this.vvHandler) {
			vv.removeEventListener("resize", this.vvHandler);
			vv.removeEventListener("scroll", this.vvHandler);
		}
		this.vvHandler = null;
		this.contentEl.empty();
	}
}
