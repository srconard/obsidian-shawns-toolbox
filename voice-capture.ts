// voice-capture.ts — reusable voice-to-text capture shared by the voice panel
// and the pillar quick-capture modal. It wraps the EXISTING pipeline (Groq
// primary → OpenAI whisper-1 fallback via stt-chain's provider order, plus the
// never-lose-audio park under `voiceFailuresFolder`) — it is not a new
// transcription path, just the same one factored out so a second surface can
// record → transcribe → drop text into an input the user reviews before saving.
import { App, normalizePath } from "obsidian";
import type { ShawnsToolboxSettings } from "./settings";
import { transcribeGroq } from "./groq-stt";
import { transcribeOpenAi } from "./openai-stt";
import { failureAudioPath, sttProviderOrder } from "./stt-chain";

// The pure text helpers live in the obsidian-free stt-chain.ts so they stay
// unit-testable; re-exported here so this module is the modal's one import.
export { appendTranscript, failureEmbed } from "./stt-chain";

const MIME_CANDIDATES = [
	"audio/webm;codecs=opus",
	"audio/webm",
	"audio/mp4",
	"audio/ogg;codecs=opus",
];

/** First MediaRecorder-supported container/codec, or "" to let the browser pick. */
export function pickMimeType(): string {
	for (const c of MIME_CANDIDATES) {
		if (
			typeof MediaRecorder !== "undefined" &&
			MediaRecorder.isTypeSupported(c)
		) {
			return c;
		}
	}
	return "";
}

/**
 * Transcribe with the provider chain (Groq primary, OpenAI whisper-1 fallback —
 * each only tried when its key is set). Throws the last provider's error when
 * every configured provider fails, so the caller can park the audio. This is the
 * same chain `VoiceView.transcribe` uses.
 */
export async function transcribeChain(
	settings: ShawnsToolboxSettings,
	blob: Blob
): Promise<string> {
	const order = sttProviderOrder(settings);
	if (order.length === 0) {
		throw new Error(
			"No transcription API key — add Groq or OpenAI in settings"
		);
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
 * Never-lose-audio fallback: write the raw recording into the vault's failures
 * folder (timestamped, correct extension) and return its vault path. Same folder
 * and naming the voice panel uses (`failureAudioPath`), so parked recordings
 * from either surface sit together.
 */
export async function parkFailedAudio(
	app: App,
	settings: ShawnsToolboxSettings,
	blob: Blob
): Promise<string> {
	const folder = (settings.voiceFailuresFolder || "Voice Failures").replace(
		/\/+$/,
		""
	);
	if (folder && !app.vault.getAbstractFileByPath(folder)) {
		await app.vault.createFolder(folder);
	}
	const path = normalizePath(failureAudioPath(folder, blob.type));
	await app.vault.createBinary(path, await blob.arrayBuffer());
	return path;
}

/**
 * Minimal mic recorder: `start()` opens the stream + MediaRecorder, `stop()`
 * resolves the recorded Blob, `cancel()` tears everything down without resolving
 * (for a modal closed mid-recording). Mirrors the voice panel's recorder wiring.
 */
export class MicRecorder {
	private recorder: MediaRecorder | null = null;
	private stream: MediaStream | null = null;
	private chunks: BlobPart[] = [];
	private resolveStop: ((b: Blob) => void) | null = null;

	get active(): boolean {
		return this.recorder !== null;
	}

	async start(): Promise<void> {
		this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const mime = pickMimeType();
		this.chunks = [];
		const recorder = new MediaRecorder(
			this.stream,
			mime ? { mimeType: mime } : undefined
		);
		recorder.ondataavailable = (e) => {
			if (e.data.size > 0) this.chunks.push(e.data);
		};
		recorder.onstop = () => {
			const blob = new Blob(this.chunks, {
				type: recorder.mimeType || mime || "audio/webm",
			});
			this.teardownStream();
			this.recorder = null;
			const resolve = this.resolveStop;
			this.resolveStop = null;
			resolve?.(blob);
		};
		this.recorder = recorder;
		recorder.start();
	}

	/** Stop and resolve the recorded audio. */
	stop(): Promise<Blob> {
		return new Promise((resolve) => {
			if (!this.recorder || this.recorder.state === "inactive") {
				this.teardownStream();
				this.recorder = null;
				resolve(new Blob([]));
				return;
			}
			this.resolveStop = resolve;
			this.recorder.stop();
		});
	}

	/** Tear down mid-recording without resolving stop() — modal closed. */
	cancel(): void {
		this.resolveStop = null;
		if (this.recorder && this.recorder.state !== "inactive") {
			try {
				this.recorder.stop();
			} catch {
				// already stopped
			}
		}
		this.recorder = null;
		this.teardownStream();
	}

	private teardownStream(): void {
		this.stream?.getTracks().forEach((t) => t.stop());
		this.stream = null;
	}
}
