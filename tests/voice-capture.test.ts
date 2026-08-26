import { describe, it, expect } from "vitest";
import { appendTranscript, failureEmbed } from "../stt-chain";

describe("appendTranscript", () => {
	it("returns the transcript when the box was empty", () => {
		expect(appendTranscript("", "call the dentist")).toBe(
			"call the dentist"
		);
	});

	it("appends after existing text with a single joining space", () => {
		expect(appendTranscript("remember to", "buy milk")).toBe(
			"remember to buy milk"
		);
	});

	it("normalises trailing whitespace before joining", () => {
		expect(appendTranscript("first thought  \n", "second")).toBe(
			"first thought second"
		);
	});

	it("trims the addition and no-ops on an empty transcript", () => {
		expect(appendTranscript("keep this", "   ")).toBe("keep this");
		expect(appendTranscript("keep this", "  more  ")).toBe(
			"keep this more"
		);
	});

	it("keeps a whitespace-only existing buffer from adding a leading space", () => {
		expect(appendTranscript("   ", "hello")).toBe("hello");
	});
});

describe("failureEmbed", () => {
	it("wraps the parked audio path in an Obsidian embed", () => {
		expect(failureEmbed("Voice Failures/voice-2026-08-26-101500.webm")).toBe(
			"![[Voice Failures/voice-2026-08-26-101500.webm]]"
		);
	});
});
