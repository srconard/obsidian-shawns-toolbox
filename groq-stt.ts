// groq-stt.ts — Groq Whisper transcription over Obsidian's requestUrl
// (multipart body built by hand; requestUrl works on desktop and phone and
// avoids CORS, same reason block-summarizer uses it for Gemini).
import { requestUrl } from "obsidian";

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

function extensionFor(mime: string): string {
	if (mime.includes("webm")) return "webm";
	if (mime.includes("mp4")) return "m4a";
	if (mime.includes("ogg")) return "ogg";
	return "wav";
}

export async function transcribeGroq(
	apiKey: string,
	model: string,
	audio: ArrayBuffer,
	mime: string
): Promise<string> {
	if (!apiKey) {
		throw new Error("No Groq API key — add one in Shawn's Toolbox settings");
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
		url: GROQ_URL,
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
			`Groq ${res.status}: ${(res.text ?? "").slice(0, 200)}`
		);
	}
	const text = (res.json?.text ?? "").trim();
	if (!text) throw new Error("Groq returned an empty transcript");
	return text;
}
