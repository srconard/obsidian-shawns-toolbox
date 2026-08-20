// voice-view.ts — right-sidebar voice panel: Echo-style big buttons. Tap a
// button to start recording, tap again to stop; the audio is transcribed by
// Groq Whisper and routed through the same pipeline as typed capture. On the
// phone, the native right-edge swipe opens this panel.
import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type { CaptureKind } from "./section-core";
import {
	CAPTURE_ICONS,
	CAPTURE_LABELS,
	nowHm,
	routeCapture,
} from "./capture-service";
import { transcribeGroq } from "./groq-stt";
import type { CardsHost } from "./section-cards";

export const VOICE_VIEW_TYPE = "shawns-toolbox-voice";

const KINDS: CaptureKind[] = ["thought", "doToday", "otherTask", "log"];

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
	private recordingKind: CaptureKind | null = null;
	private busy = false;
	private buttons: Partial<Record<CaptureKind, HTMLButtonElement>> = {};

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
			const iconEl = icon;
			btn.addEventListener("click", () =>
				void this.toggle(kind, btn, iconEl)
			);
			this.buttons[kind] = btn;
		}
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

	private async toggle(
		kind: CaptureKind,
		btn: HTMLButtonElement,
		iconEl: HTMLElement
	): Promise<void> {
		if (this.busy) return;
		if (this.recordingKind === kind) {
			// second tap: stop → transcribe → route
			this.recordingKind = null;
			btn.removeClass("is-recording");
			setIcon(iconEl, "mic");
			this.recorder?.stop();
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
			void this.finish(kind, blob);
		};
		this.recorder = recorder;
		this.recordingKind = kind;
		btn.addClass("is-recording");
		setIcon(iconEl, "square");
		recorder.start();
	}

	private async finish(kind: CaptureKind, blob: Blob): Promise<void> {
		if (blob.size === 0) {
			new Notice("No audio captured");
			return;
		}
		this.busy = true;
		const btn = this.buttons[kind];
		btn?.addClass("is-busy");
		try {
			const settings = this.host.getSettings();
			const text = await transcribeGroq(
				settings.groqApiKey,
				settings.groqModel,
				await blob.arrayBuffer(),
				blob.type
			);
			const target = await routeCapture(this.app, settings, kind, text);
			// receipt carries the transcript so garbage is catchable
			new Notice(`→ ${target} ${nowHm()}\n${text}`, 6000);
		} catch (e) {
			new Notice(
				"Voice capture failed: " +
					(e instanceof Error ? e.message : String(e))
			);
		} finally {
			this.busy = false;
			btn?.removeClass("is-busy");
		}
	}
}
