// voice-view.ts — right-sidebar voice panel: Echo-style big buttons. Tap a
// button to start recording, tap again to stop; the audio is transcribed by
// Groq Whisper and routed through the same pipeline as typed capture.
// Long-press a task button to pick a target day first — confirming starts
// the recording, and the transcript lands on that day's daily note (created
// from the template when missing). On the phone, the native right-edge swipe
// opens this panel.
import { ItemView, Notice, WorkspaceLeaf, normalizePath, setIcon } from "obsidian";
import type { CaptureKind } from "./section-core";
import {
	CAPTURE_LABELS,
	logicalTodayIso,
	nowHm,
	routeCapture,
	routePreformatted,
} from "./capture-service";
import { shiftDateIso } from "./template-renderer";
import { transcribeGroq } from "./groq-stt";
import { transcribeOpenAi } from "./openai-stt";
import { failureAudioPath, sttProviderOrder } from "./stt-chain";
import type { ShawnsToolboxSettings } from "./settings";
import { callGeminiApi } from "./block-summarizer";
import { callOpenAiApi } from "./ai-providers";
import {
	buildBulletsPrompt,
	parseBulletsResponse,
	formatBulletedThought,
} from "./ai-bullets";
import { createDateBar, wireLongPress, type DateBar } from "./date-bar";
import type { CardsHost } from "./section-cards";
import { THOUGHT_PERIODS, applyPeriodTags } from "./thread-core";
import { HIGHLIGHTS_VIEW_TYPE } from "./highlights-view";

export const VOICE_VIEW_TYPE = "shawns-toolbox-voice";

const KINDS: CaptureKind[] = ["thought", "doToday", "otherTask", "log"];

/** Periodic cadence a thought can be armed with while recording. */
type Period = (typeof THOUGHT_PERIODS)[number];
const PERIOD_LABELS: Record<Period, string> = {
	weekly: "Weekly",
	monthly: "Monthly",
	quarterly: "Quarterly",
	yearly: "Yearly",
};

/** The voice panel's buttons: the four capture kinds plus AI bullets. */
type VoiceKind = CaptureKind | "aiThought";

function pickMimeType(): string {
	const candidates = [
		"audio/webm;codecs=opus",
		"audio/webm",
		"audio/mp4",
		"audio/ogg;codecs=opus",
	];
	for (const c of candidates) {
		if (
			typeof MediaRecorder !== "undefined" &&
			MediaRecorder.isTypeSupported(c)
		) {
			return c;
		}
	}
	return "";
}

export class VoiceView extends ItemView {
	private recorder: MediaRecorder | null = null;
	private stream: MediaStream | null = null;
	private recordingKind: VoiceKind | null = null;
	private busy = false;
	private buttons: Partial<
		Record<VoiceKind, { btn: HTMLButtonElement; icon: HTMLElement }>
	> = {};
	private dateBar: DateBar | null = null;
	private dateBarKind: VoiceKind | null = null;
	/** Target day per kind, set by the date bar for the next recording. */
	private targetDates: Partial<Record<VoiceKind, string>> = {};
	private lastLongPress = 0;
	/** Kind the in-flight recording will finish as (mid-recording switching). */
	private liveKind: VoiceKind | null = null;
	/** Cadence tags armed for the thought currently being recorded. Toggled by
	 *  the period buttons (before or mid-recording); applied to the thought line
	 *  when a thought/aiThought recording lands, then cleared. */
	private armedPeriods = new Set<Period>();
	private periodBtns: Partial<Record<Period, HTMLButtonElement>> = {};
	private periodRow: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, private host: CardsHost) {
		super(leaf);
	}

	getViewType(): string {
		return VOICE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Voice capture";
	}

	getIcon(): string {
		return "mic";
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("stx-voice-root");

		this.dateBar = createDateBar(root, {
			confirmLabel: "Record",
			confirmIcon: "mic",
			// Long-press means "not today" — default to logical tomorrow.
			getDefaultDate: () =>
				shiftDateIso(logicalTodayIso(this.host.getSettings()), 1),
			onConfirm: () => {
				const kind = this.dateBarKind;
				const date = this.dateBar?.value();
				if (!kind || !date) return;
				this.targetDates[kind] = date;
				this.dateBar?.hide();
				this.dateBarKind = null;
				void this.toggle(kind);
			},
		});

		const wrap = root.createDiv("stx-voice-buttons");
		for (const kind of KINDS) {
			const btn = wrap.createEl("button", {
				cls: "stx-voice-btn stx-capture-" + kind,
			});
			const icon = btn.createSpan("stx-voice-btn-icon");
			setIcon(icon, "mic");
			btn.createSpan({
				cls: "stx-voice-btn-label",
				text: CAPTURE_LABELS[kind],
			});
			btn.addEventListener("click", () => {
				// a long-press already handled this gesture
				if (Date.now() - this.lastLongPress < 700) return;
				void this.toggle(kind);
			});
			if (kind === "doToday" || kind === "otherTask") {
				wireLongPress(btn, () => {
					this.lastLongPress = Date.now();
					if (this.recordingKind !== null) {
						new Notice("Already recording — stop that one first");
						return;
					}
					this.dateBarKind = kind;
					this.dateBar?.show(CAPTURE_LABELS[kind] + " on");
				});
			}
			this.buttons[kind] = { btn, icon };
		}

		// Fifth button — AI Thought: record → transcript → Gemini turns the
		// ramble into a bold summary + bullets (raw transcript folded under).
		const aiBtn = wrap.createEl("button", {
			cls: "stx-voice-btn stx-capture-thought stx-voice-ai",
		});
		const aiIcon = aiBtn.createSpan("stx-voice-btn-icon");
		setIcon(aiIcon, "sparkles");
		aiBtn.createSpan({ cls: "stx-voice-btn-label", text: "AI Thought" });
		aiBtn.addEventListener("click", () => {
			if (Date.now() - this.lastLongPress < 700) return;
			void this.toggle("aiThought");
		});
		this.buttons.aiThought = { btn: aiBtn, icon: aiIcon };

		// Cadence row — arm a periodic tag (#thought/<period>) for the thought
		// currently (or about to be) recorded. Tappable any time, including
		// mid-recording; the armed set is stamped onto the thought line when a
		// Thought / AI Thought recording lands, then cleared. While a recording
		// is live the row shows the pulsing dashed cue (mirrors the v1.8.1
		// Thought⇄AI switch affordance) — "tap to tag this recording".
		const periodRow = root.createDiv("stx-voice-periods");
		this.periodRow = periodRow;
		for (const period of THOUGHT_PERIODS) {
			const pbtn = periodRow.createEl("button", {
				cls: "stx-voice-period",
				text: PERIOD_LABELS[period],
			});
			pbtn.addEventListener("click", () => this.togglePeriod(period));
			this.periodBtns[period] = pbtn;
		}

		// Quick access to the Highlights panel — the day's "what mattered"
		// capture lives outside the voice pipeline, so this just opens it.
		const hlRow = root.createDiv("stx-voice-highlights");
		const hlBtn = hlRow.createEl("button", {
			cls: "stx-voice-highlights-btn",
			attr: { "aria-label": "Open highlights panel" },
		});
		const hlIcon = hlBtn.createSpan("stx-voice-highlights-icon");
		setIcon(hlIcon, "star");
		hlBtn.createSpan({ text: "Highlights" });
		hlBtn.addEventListener("click", () => this.openHighlights());
	}

	/** Reveal the Highlights panel, creating it in the right sidebar if needed. */
	private openHighlights(): void {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(HIGHLIGHTS_VIEW_TYPE);
		if (existing.length > 0) {
			workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;
		void leaf
			.setViewState({ type: HIGHLIGHTS_VIEW_TYPE, active: true })
			.then(() => workspace.revealLeaf(leaf));
	}

	/** Toggle a cadence tag armed for the recording; refresh its button state. */
	private togglePeriod(period: Period): void {
		if (this.armedPeriods.has(period)) this.armedPeriods.delete(period);
		else this.armedPeriods.add(period);
		this.periodBtns[period]?.toggleClass(
			"is-armed",
			this.armedPeriods.has(period)
		);
	}

	/** Clear all armed cadence tags and their button highlights. */
	private clearPeriods(): void {
		this.armedPeriods.clear();
		for (const period of THOUGHT_PERIODS) {
			this.periodBtns[period]?.removeClass("is-armed");
		}
	}

	/** Toggle the "recording live" pulsing cue on the cadence row. */
	private setPeriodsLive(live: boolean): void {
		this.periodRow?.toggleClass("is-live", live);
	}

	async onClose(): Promise<void> {
		this.stopStream();
	}

	private stopStream(): void {
		if (this.recorder && this.recorder.state !== "inactive") {
			try {
				this.recorder.stop();
			} catch {
				// already stopped
			}
		}
		this.recorder = null;
		this.stream?.getTracks().forEach((t) => t.stop());
		this.stream = null;
	}

	/** Default (idle) icon for a voice button. */
	private defaultIcon(kind: VoiceKind): string {
		return kind === "aiThought" ? "sparkles" : "mic";
	}

	/** Thought ⇄ AI Thought may swap mid-recording; nothing else may. */
	private static switchable(a: VoiceKind, b: VoiceKind): boolean {
		return (
			(a === "thought" && b === "aiThought") ||
			(a === "aiThought" && b === "thought")
		);
	}

	/**
	 * While a thought is being recorded, highlight its counterpart button as
	 * the live "switch this recording" target (and vice versa).
	 */
	private setSwitchAffordance(active: VoiceKind | null): void {
		this.buttons.thought?.btn.removeClass("is-switch-target");
		this.buttons.aiThought?.btn.removeClass("is-switch-target");
		if (active === "thought") {
			this.buttons.aiThought?.btn.addClass("is-switch-target");
		} else if (active === "aiThought") {
			this.buttons.thought?.btn.addClass("is-switch-target");
		}
	}

	private async toggle(kind: VoiceKind): Promise<void> {
		if (this.busy) return;
		const ui = this.buttons[kind];
		if (!ui) return;
		if (this.recordingKind === kind) {
			// second tap: stop → transcribe → route
			this.recordingKind = null;
			this.setSwitchAffordance(null);
			ui.btn.removeClass("is-recording");
			setIcon(ui.icon, this.defaultIcon(kind));
			this.recorder?.stop();
			return;
		}
		if (
			this.recordingKind !== null &&
			VoiceView.switchable(this.recordingKind, kind)
		) {
			// Mid-recording switch: the audio keeps rolling, only the routing
			// changes ("I'm rambling — make this an AI Thought after all").
			const from = this.recordingKind;
			const fromUi = this.buttons[from];
			fromUi?.btn.removeClass("is-recording");
			if (fromUi) setIcon(fromUi.icon, this.defaultIcon(from));
			this.recordingKind = kind;
			this.liveKind = kind;
			ui.btn.addClass("is-recording");
			setIcon(ui.icon, "square");
			this.setSwitchAffordance(kind);
			new Notice(
				kind === "aiThought"
					? "→ AI Thought (bullets on stop)"
					: "→ plain Thought"
			);
			return;
		}
		if (this.recordingKind !== null) {
			new Notice("Already recording — stop that one first");
			return;
		}
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({
				audio: true,
			});
		} catch (e) {
			delete this.targetDates[kind];
			new Notice(
				"Microphone unavailable: " +
					(e instanceof Error ? e.message : String(e))
			);
			return;
		}
		const mime = pickMimeType();
		const chunks: BlobPart[] = [];
		const recorder = new MediaRecorder(
			this.stream,
			mime ? { mimeType: mime } : undefined
		);
		recorder.ondataavailable = (e) => {
			if (e.data.size > 0) chunks.push(e.data);
		};
		recorder.onstop = () => {
			const blob = new Blob(chunks, {
				type: recorder.mimeType || mime || "audio/webm",
			});
			this.stream?.getTracks().forEach((t) => t.stop());
			this.stream = null;
			this.recorder = null;
			// liveKind, not the closure's kind: a mid-recording switch may
			// have re-routed this recording after it started.
			const finalKind = this.liveKind ?? kind;
			this.liveKind = null;
			void this.finish(finalKind, blob);
		};
		this.recorder = recorder;
		this.recordingKind = kind;
		this.liveKind = kind;
		ui.btn.addClass("is-recording");
		setIcon(ui.icon, "square");
		this.setSwitchAffordance(kind);
		this.setPeriodsLive(true);
		recorder.start();
	}

	private async finish(kind: VoiceKind, blob: Blob): Promise<void> {
		this.setPeriodsLive(false);
		const dateIso = this.targetDates[kind];
		delete this.targetDates[kind];
		// Cadence tags armed for this recording. Only thought/aiThought lines
		// take #thought/<period> tags; a Do Today / Log capture leaves the arm
		// intact (nothing consumed it).
		const periods = [...this.armedPeriods];
		if (blob.size === 0) {
			new Notice("No audio captured");
			return;
		}
		this.busy = true;
		const ui = this.buttons[kind];
		ui?.btn.addClass("is-busy");
		try {
			const settings = this.host.getSettings();
			let text: string;
			try {
				text = await this.transcribe(settings, blob);
			} catch (e) {
				// Every provider failed: never discard the audio — park it in
				// the vault and point today's note at it so it resurfaces.
				await this.saveFailedAudio(settings, kind, blob, dateIso, e);
				return;
			}
			const when =
				dateIso &&
				dateIso !== logicalTodayIso(this.host.getSettings())
					? dateIso
					: nowHm();
			if (kind === "aiThought") {
				await this.finishAiThought(text, dateIso, when, periods);
				this.clearPeriods();
				return;
			}
			// A plain Thought takes the armed cadence tags on its own line; other
			// kinds (Do Today / Other Task / Log) don't carry #thought tags.
			const capText =
				kind === "thought" ? applyPeriodTags(text, periods) : text;
			const target = await routeCapture(
				this.app,
				settings,
				kind,
				capText,
				dateIso
			);
			if (kind === "thought") this.clearPeriods();
			// receipt carries the transcript so garbage is catchable
			new Notice(`→ ${target} ${when}\n${capText}`, 6000);
		} catch (e) {
			new Notice(
				"Voice capture failed: " +
					(e instanceof Error ? e.message : String(e))
			);
		} finally {
			this.busy = false;
			ui?.btn.removeClass("is-busy");
		}
	}

	/**
	 * Transcribe with the provider chain: Groq primary, OpenAI whisper-1
	 * fallback (only if its key is set). Throws the last provider's error when
	 * all configured providers fail, so the caller can save the audio.
	 */
	private async transcribe(
		settings: ShawnsToolboxSettings,
		blob: Blob
	): Promise<string> {
		const order = sttProviderOrder(settings);
		if (order.length === 0) {
			throw new Error("No transcription API key — add Groq or OpenAI in settings");
		}
		const buf = await blob.arrayBuffer();
		let lastErr: unknown = null;
		for (const provider of order) {
			try {
				if (provider === "groq") {
					return await transcribeGroq(
						settings.groqApiKey,
						settings.groqModel,
						buf,
						blob.type
					);
				}
				return await transcribeOpenAi(
					settings.openaiApiKey,
					settings.openaiSttModel,
					buf,
					blob.type
				);
			} catch (e) {
				lastErr = e;
			}
		}
		throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
	}

	/**
	 * Last-resort durability: transcription failed on every provider, so write
	 * the raw audio into the vault (timestamped, correct extension) and drop a
	 * one-line pointer into today's capture section so it resurfaces. The
	 * failure Notice says exactly where the audio landed.
	 */
	private async saveFailedAudio(
		settings: ShawnsToolboxSettings,
		kind: VoiceKind,
		blob: Blob,
		dateIso: string | undefined,
		err: unknown
	): Promise<void> {
		const reason = err instanceof Error ? err.message : String(err);
		try {
			const folder = (
				settings.voiceFailuresFolder || "Voice Failures"
			).replace(/\/+$/, "");
			if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
				await this.app.vault.createFolder(folder);
			}
			const path = normalizePath(failureAudioPath(folder, blob.type));
			await this.app.vault.createBinary(path, await blob.arrayBuffer());
			// Pointer resurfaces the orphaned recording; best-effort so a
			// daily-note write failure can't also swallow the saved-audio notice.
			try {
				await routeCapture(
					this.app,
					settings,
					kind === "aiThought" ? "thought" : kind,
					`⚠️ Voice transcription failed — audio saved: [[${path}]]`,
					dateIso
				);
			} catch {
				// pointer is optional; the audio file is the durable record
			}
			new Notice(
				`Transcription failed (${reason}).\nAudio saved → ${path}`,
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

	/**
	 * AI Thought: transcript → Gemini → bold summary + bullets, raw folded
	 * beneath, appended under the thought heading. Any AI failure (no key,
	 * API error, unparseable reply) degrades to saving the raw transcript as
	 * a normal thought — a capture is never lost to a flaky model call.
	 */
	private async finishAiThought(
		text: string,
		dateIso: string | undefined,
		when: string,
		periods: Period[]
	): Promise<void> {
		const settings = this.host.getSettings();
		const heading = settings.captureTargets.thought;
		const useOpenAi = settings.aiThoughtProvider === "openai";
		const key = useOpenAi ? settings.openaiApiKey : settings.geminiApiKey;
		let block: string | null = null;
		let aiNote = "";
		if (!key) {
			aiNote = useOpenAi
				? "no OpenAI key in settings"
				: "no Gemini key in settings";
		} else {
			try {
				const prompt = buildBulletsPrompt(text);
				const raw = useOpenAi
					? await callOpenAiApi(
							key,
							settings.openaiModel,
							prompt,
							600
						)
					: await callGeminiApi(
							key,
							settings.geminiModel,
							prompt,
							600
						);
				const parsed = parseBulletsResponse(raw);
				if (parsed) {
					block = formatBulletedThought(parsed, text, nowHm());
					aiNote = `**${parsed.summary}** + ${parsed.bullets.length} bullets`;
				} else {
					aiNote = "unparseable AI reply";
				}
			} catch (e) {
				aiNote = e instanceof Error ? e.message : String(e);
			}
		}
		if (block !== null) {
			// Cadence tags ride on the summary line (block's first line).
			const target = await routePreformatted(
				this.app,
				settings,
				heading,
				applyPeriodTags(block, periods),
				dateIso
			);
			new Notice(`→ ${target} ${when}\n${aiNote}`, 6000);
		} else {
			const target = await routeCapture(
				this.app,
				settings,
				"thought",
				applyPeriodTags(text, periods),
				dateIso
			);
			new Notice(
				`AI bullets unavailable (${aiNote}) — saved raw → ${target} ${when}\n${text}`,
				8000
			);
		}
	}
}
