import { describe, it, expect } from "vitest";
import {
	extensionFor,
	sttProviderOrder,
	failureAudioFilename,
	failureAudioPath,
} from "../stt-chain";

describe("extensionFor", () => {
	it("maps known mime types", () => {
		expect(extensionFor("audio/webm;codecs=opus")).toBe("webm");
		expect(extensionFor("audio/mp4")).toBe("m4a");
		expect(extensionFor("audio/ogg;codecs=opus")).toBe("ogg");
	});
	it("falls back to wav for anything unknown or empty", () => {
		expect(extensionFor("")).toBe("wav");
		expect(extensionFor("application/octet-stream")).toBe("wav");
	});
});

describe("sttProviderOrder", () => {
	it("is empty when no key is set", () => {
		expect(sttProviderOrder({ groqApiKey: "", openaiApiKey: "" })).toEqual(
			[]
		);
	});
	it("is groq-only when only Groq has a key", () => {
		expect(
			sttProviderOrder({ groqApiKey: "g", openaiApiKey: "" })
		).toEqual(["groq"]);
	});
	it("is openai-only when only OpenAI has a key", () => {
		expect(
			sttProviderOrder({ groqApiKey: "", openaiApiKey: "o" })
		).toEqual(["openai"]);
	});
	it("tries Groq first, OpenAI second when both are present", () => {
		expect(
			sttProviderOrder({ groqApiKey: "g", openaiApiKey: "o" })
		).toEqual(["groq", "openai"]);
	});
});

describe("failureAudioFilename", () => {
	it("stamps a sortable timestamp and matches the blob extension", () => {
		const at = new Date(2026, 7, 21, 14, 30, 5); // 2026-08-21 14:30:05 local
		expect(failureAudioFilename("audio/webm", at)).toBe(
			"voice-2026-08-21-143005.webm"
		);
		expect(failureAudioFilename("audio/mp4", at)).toBe(
			"voice-2026-08-21-143005.m4a"
		);
	});
	it("zero-pads single-digit fields", () => {
		const at = new Date(2026, 0, 3, 4, 5, 9);
		expect(failureAudioFilename("audio/ogg", at)).toBe(
			"voice-2026-01-03-040509.ogg"
		);
	});
});

describe("failureAudioPath", () => {
	const at = new Date(2026, 7, 21, 14, 30, 5);
	it("joins folder and filename", () => {
		expect(failureAudioPath("Voice Failures", "audio/webm", at)).toBe(
			"Voice Failures/voice-2026-08-21-143005.webm"
		);
	});
	it("strips a trailing slash on the folder", () => {
		expect(failureAudioPath("Voice Failures/", "audio/webm", at)).toBe(
			"Voice Failures/voice-2026-08-21-143005.webm"
		);
	});
	it("returns a bare filename when the folder is empty", () => {
		expect(failureAudioPath("", "audio/webm", at)).toBe(
			"voice-2026-08-21-143005.webm"
		);
	});
});
