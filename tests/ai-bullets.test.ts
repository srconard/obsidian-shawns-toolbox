import { describe, it, expect } from "vitest";
import {
	buildBulletsPrompt,
	parseBulletsResponse,
	formatBulletedThought,
	singleLine,
} from "../ai-bullets";

describe("buildBulletsPrompt", () => {
	it("embeds the trimmed transcript", () => {
		const p = buildBulletsPrompt("  so I was thinking about dashboards  ");
		expect(p).toContain("Transcript:\nso I was thinking about dashboards");
		expect(p).toContain("headline");
	});
});

describe("parseBulletsResponse", () => {
	it("parses headline + bullets", () => {
		const r = parseBulletsResponse(
			"Sensemaking dashboard idea\n- build on top of Knitter\n- ingest into second brain"
		);
		expect(r).toEqual({
			summary: "Sensemaking dashboard idea",
			bullets: ["build on top of Knitter", "ingest into second brain"],
		});
	});
	it("strips stray markdown from the headline and bullets", () => {
		const r = parseBulletsResponse(
			'**"Beat Saber experiment"**\n* try it daily for a week\n+ track energy'
		);
		expect(r?.summary).toBe("Beat Saber experiment");
		expect(r?.bullets).toEqual(["try it daily for a week", "track energy"]);
	});
	it("ignores code fences and blank lines", () => {
		const r = parseBulletsResponse("```\nHeadline here\n\n- one\n```");
		expect(r?.summary).toBe("Headline here");
		expect(r?.bullets).toEqual(["one"]);
	});
	it("summary-only reply is valid (zero bullets)", () => {
		expect(parseBulletsResponse("Just a headline")).toEqual({
			summary: "Just a headline",
			bullets: [],
		});
	});
	it("returns null on empty/garbage", () => {
		expect(parseBulletsResponse("")).toBeNull();
		expect(parseBulletsResponse("\n\n```\n```")).toBeNull();
	});
});

describe("formatBulletedThought", () => {
	it("renders time, bold summary, tab children, raw last", () => {
		const out = formatBulletedThought(
			{ summary: "Dashboard idea", bullets: ["point one", "point two"] },
			"so I was thinking\nabout stuff",
			"21:40"
		);
		expect(out.split("\n")).toEqual([
			"- 21:40 **Dashboard idea**",
			"\t- point one",
			"\t- point two",
			"\t- raw: so I was thinking about stuff",
		]);
	});
});

describe("singleLine", () => {
	it("collapses all whitespace runs", () => {
		expect(singleLine("  a\n\n b\tc ")).toBe("a b c");
	});
});
