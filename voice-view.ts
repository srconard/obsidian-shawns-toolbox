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
} from "./capture-service";
import { shiftDateIso } from "./template-renderer";
import { transcribeGroq } from "./groq-stt";
import { createDateBar, wireLongPress, type DateBar } from "./date-bar";
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
	private buttons: Partial<
		Record<CaptureKind, { btn: HTMLButtonElement; icon: HTMLElement }>
	> = {};
	private dateBar: DateBar | null = null;
	private dateBarKind: CaptureKind | null = null;
	/** Target day per kind, set by the date bar for the next recording. */
	private targetDates: Partial<Record<CaptureKind, string>> = {};
	private lastLongPress = 0;

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

	private async toggle(kind: CaptureKind): Promise<void> {
		if (this.busy) return;
		const ui = this.buttons[kind];
		if (!ui) return;
		if (this.recordingKind === kind) {
			// second tap: stop → transcribe → route
			this.recordingKind = null;
			ui.btn.removeClass("is-recording");
			setIcon(ui.icon, "mic");
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
			void this.finish(kind, blob);
		};
		this.recorder = recorder;
		this.recordingKind = kind;
		ui.btn.addClass("is-recording");
		setIcon(ui.icon, "square");
		recorder.start();
	}

	private async finish(kind: CaptureKind, blob: Blob): Promise<void> {
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
			const target = await routeCapture(
				this.app,
				settings,
				kind,
				text,
				dateIso
			);
			const when =
				dateIso &&
				dateIso !== logicalTodayIso(this.host.getSettings())
					? dateIso
					: nowHm();
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
}
