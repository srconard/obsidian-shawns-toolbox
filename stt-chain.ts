// stt-chain.ts — pure STT-provider logic, no Obsidian imports so it can be
// unit-tested. Holds the audio file-extension map (shared by groq-stt.ts and
// openai-stt.ts), the provider-fallback ordering (Groq primary, OpenAI
// whisper-1 fallback — the system-wide convention), and the filename used when
// every provider fails and the raw audio must be parked in the vault instead
// of lost.

export type SttProvider = "groq" | "openai";

export function extensionFor(mime: string): string {
	if (mime.includes("webm")) return "webm";
	if (mime.includes("mp4")) return "m4a";
	if (mime.includes("ogg")) return "ogg";
	return "wav";
}

/**
 * Ordered list of STT providers to try for this recording. Groq is primary;
 * OpenAI (whisper-1) is the fallback and only appears when its key is set. A
 * provider with no key is skipped rather than attempted-and-failed. Empty
 * result means nothing can transcribe — the caller must save the audio.
 */
export function sttProviderOrder(keys: {
	groqApiKey: string;
	openaiApiKey: string;
}): SttProvider[] {
	const order: SttProvider[] = [];
	if (keys.groqApiKey) order.push("groq");
	if (keys.openaiApiKey) order.push("openai");
	return order;
}

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

/** e.g. "voice-2026-08-21-143005.webm" — sortable, extension matches the blob. */
export function failureAudioFilename(mime: string, at: Date = new Date()): string {
	const stamp =
		`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
		`-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
	return `voice-${stamp}.${extensionFor(mime)}`;
}

/** Full vault path for a parked failed recording under `folder`. */
export function failureAudioPath(
	folder: string,
	mime: string,
	at: Date = new Date()
): string {
	const clean = folder.replace(/\/+$/, "");
	const name = failureAudioFilename(mime, at);
	return clean ? `${clean}/${name}` : name;
}

/**
 * Merge a fresh transcript into whatever the user has already typed, so a mic
 * dictation appends rather than replaces. A single space joins non-empty parts;
 * trailing whitespace on the existing buffer is normalised first.
 */
export function appendTranscript(existing: string, addition: string): string {
	const add = addition.trim();
	if (!add) return existing;
	if (!existing.trim()) return add;
	return existing.replace(/\s+$/, "") + " " + add;
}

/**
 * The embed inserted into a capture buffer when transcription failed and the
 * audio was parked in the vault — so the capture still lands and the recording
 * can be transcribed later.
 */
export function failureEmbed(path: string): string {
	return `![[${path}]]`;
}
