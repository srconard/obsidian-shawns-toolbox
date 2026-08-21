// voice-view.ts — right-sidebar voice panel: Echo-style big buttons. Tap a
// button to start recording, tap again to stop; the audio is transcribed by
// Groq Whisper and routed through the same pipeline as typed capture.
// Long-press a task button to pick a target day first — confirming starts
// the recording, and the transcript lands on that day's daily note (created
// from the template when missing). On the phone, the native right-edge swipe
// opens this panel.
import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
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
import { callGeminiApi } from "./block-summarizer";
import { callOpenAiApi } from "./ai-providers";
import {
	buildBulletsPrompt,
	parseBulletsResponse,
	formatBulletedThought,
} from "./ai-bullets";
import { createDateBar, wireLongPress, type DateBar } from "./date-bar";
import type { CardsHost } from "./section-cards";

export const VOICE_VIEW_TYPE = "shawns-toolbox-voice";

const KINDS: CaptureKind[] = ["thought", "doToday", "otherTask", "log"];

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
		recorder.start();
	}

	private async finish(kind: VoiceKind, blob: Blob): Promise<void> {
		const dateIso = this.targetDates[kind];
		delete this.targetDates[kind];
		if (blob.size === 0) {
			new Notice("No audio captured");
			return;
		}
		this.busy = true;
		const ui = this.buttons[kind];
		ui?.btn.addClass("is-busy");
		try {
			const settings = this.host.getSettings();
			const text = await transcribeGroq(
				settings.groqApiKey,
				settings.groqModel,
				await blob.arrayBuffer(),
				blob.type
			);
			const when =
				dateIso &&
				dateIso !== logicalTodayIso(this.host.getSettings())
					? dateIso
					: nowHm();
			if (kind === "aiThought") {
				await this.finishAiThought(text, dateIso, when);
				return;
			}
			const target = await routeCapture(
				this.app,
				settings,
				kind,
				text,
				dateIso
			);
			// receipt carries the transcript so garbage is catchable
			new Notice(`→ ${target} ${when}\n${text}`, 6000);
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
	 * AI Thought: transcript → Gemini → bold summary + bullets, raw folded
	 * beneath, appended under the thought heading. Any AI failure (no key,
	 * API error, unparseable reply) degrades to saving the raw transcript as
	 * a normal thought — a capture is never lost to a flaky model call.
	 */
	private async finishAiThought(
		text: string,
		dateIso: string | undefined,
		when: string
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
			const target = await routePreformatted(
				this.app,
				settings,
				heading,
				block,
				dateIso
			);
			new Notice(`→ ${target} ${when}\n${aiNote}`, 6000);
		} else {
			const target = await routeCapture(
				this.app,
				settings,
				"thought",
				text,
				dateIso
			);
			new Notice(
				`AI bullets unavailable (${aiNote}) — saved raw → ${target} ${when}\n${text}`,
				8000
			);
		}
	}
}
