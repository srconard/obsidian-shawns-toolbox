// openai-stt.ts — OpenAI Whisper transcription over Obsidian's requestUrl.
// Fallback for Groq (see stt-chain.ts): system-wide convention is Groq
// whisper-large-v3-turbo primary, OpenAI whisper-1 fallback. Same hand-built
// multipart body as groq-stt.ts (requestUrl works on desktop and phone and
// avoids CORS).
import { requestUrl } from "obsidian";
import { extensionFor } from "./stt-chain";

const OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";

export async function transcribeOpenAi(
	apiKey: string,
	model: string,
	audio: ArrayBuffer,
	mime: string
): Promise<string> {
	if (!apiKey) {
		throw new Error("No OpenAI API key — add one in Shawn's Toolbox settings");
	}
	const boundary =
		"----stxBoundary" + Math.random().toString(36).slice(2);
	const enc = new TextEncoder();
	const head = enc.encode(
		`--${boundary}\r\n` +
			`Content-Disposition: form-data; name="file"; filename="audio.${extensionFor(mime)}"\r\n` +
			`Content-Type: ${mime || "application/octet-stream"}\r\n\r\n`
	);
	const tail = enc.encode(
		`\r\n--${boundary}\r\n` +
			`Content-Disposition: form-data; name="model"\r\n\r\n${model}\r\n` +
			`--${boundary}--\r\n`
	);
	const body = new Uint8Array(head.length + audio.byteLength + tail.length);
	body.set(head, 0);
	body.set(new Uint8Array(audio), head.length);
	body.set(tail, head.length + audio.byteLength);

	const res = await requestUrl({
		url: OPENAI_URL,
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": `multipart/form-data; boundary=${boundary}`,
		},
		body: body.buffer,
		throw: false,
	});
	if (res.status >= 300) {
		throw new Error(
			`OpenAI ${res.status}: ${(res.text ?? "").slice(0, 200)}`
		);
	}
	const text = (res.json?.text ?? "").trim();
	if (!text) throw new Error("OpenAI returned an empty transcript");
	return text;
}
