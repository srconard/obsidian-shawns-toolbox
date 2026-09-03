import { describe, it, expect } from "vitest";
import {
	extractDreamsRegion,
	parseDreams,
	countDreams,
	toggleKeep,
	stripKeepPrefix,
	DREAMS_START,
	DREAMS_END,
} from "../dreams-core";

// An agent-note dreams lane: `###` connection headings between the markers,
// a mix of plain / kept / applied pair lines, and the high-signal round-up.
const AGENT_NOTE = [
	"---",
	"date: 2026-09-03",
	"dreams_reviewed: false",
	"---",
	"# 2026-09-03 — Agent Daily Note",
	"",
	DREAMS_START,
	"*Connections found across the vault.*",
	"",
	"---",
	"",
	"### The ramble found a guiding question already filed",
	"",
	"**[[2026-09-02]]** ↔ **[[How to play and dance with people]]**",
	"",
	'> "Conversation is like dance." *(2026-09-02)*',
	'> "dance is play / not all play is dance" *(#question/guiding)*',
	"",
	"**The thread:** He talked his way back to a note the vault already tags.",
	"",
	"**Speculation:** The ramble may be a retrieval channel.",
	"",
	"---",
	"",
	"### The note with the right title and nothing inside it",
	"",
	"- [ ] **[[2026-W30]]** ↔ **[[surrounded by people you love]]**",
	"",
	'> "being around loved ones is the goal" *(#thought/yearly)*',
	"",
	"**The thread:** The yearly thought got a note two days later.",
	"",
	"---",
	"",
	"### Reward hacking has a specific mechanism already in the vault",
	"",
	"- [x] **[[2026-09-01]]** ↔ **[[Huberman goal toolkit]]**",
	"",
	'> "how do I stop reward hacking" *(#thought/yearly)*',
	"",
	"**The thread:** The toolkit answers it.",
	"",
	"---",
	"",
	"### High-signal thoughts — no strong connection tonight",
	"",
	'- "music is the answer" ([[2026-08-30]]) — nothing cleared 0.58.',
	"",
	"---",
	"",
	"*Seeds: 11 daily-note thoughts. Surfaced 10 of 31 candidates.*",
	DREAMS_END,
	"",
	"## Reflection",
	"nothing to see here",
].join("\n");

// A legacy standalone digest: whole file is the region, `##` headings.
const LEGACY = [
	"---",
	"tags:",
	"  - claude/dreaming",
	"dreams_reviewed: false",
	"---",
	"# Dreaming — 2026-09-01",
	"",
	"*Connections found across the vault.*",
	"",
	"---",
	"",
	"## A 2024 dream already planted the skateboard",
	"",
	"**[[2026-08-29]]** ↔ **[[2024-02-21]]**",
	"",
	'> "I think I want to start skateboarding" *(2026-08-29)*',
	"",
	"**The thread:** the quarterly desire isn't new.",
	"",
	"**Speculation (AI):** recurring desires may be worth trusting.",
	"",
	"---",
	"",
	'## "Office in the woods" is a three-year-old vision',
	"",
	"**[[2026-08-30]]** ↔ **[[2023-09-05]]**",
	"",
	'> "Write in the woods" *(2026-08-30)*',
	"",
	"**The thread:** the yearly goal is the same picture from three years ago.",
	"",
	"---",
].join("\n");

describe("extractDreamsRegion", () => {
	it("returns the text between the lane markers for an agent note", () => {
		const region = extractDreamsRegion(AGENT_NOTE, true);
		expect(region).not.toBeNull();
		expect(region).toContain("The ramble found a guiding question");
		// Content outside the markers is excluded.
		expect(region).not.toContain("## Reflection");
		expect(region).not.toContain("nothing to see here");
	});

	it("returns null for an agent note with no dreams lane", () => {
		expect(extractDreamsRegion("# Just a note\nno lane here", true)).toBeNull();
	});

	it("returns the whole content for a legacy digest", () => {
		expect(extractDreamsRegion(LEGACY, false)).toBe(LEGACY);
	});
});

describe("parseDreams — agent note (### headings)", () => {
	const conns = parseDreams(extractDreamsRegion(AGENT_NOTE, true)!);

	it("parses every connection plus the high-signal block", () => {
		expect(conns).toHaveLength(4);
		expect(conns.map((c) => c.isHighSignal)).toEqual([
			false,
			false,
			false,
			true,
		]);
	});

	it("reads the title, level, pair notes and keep state", () => {
		const first = conns[0];
		expect(first.level).toBe(3);
		expect(first.title).toBe(
			"The ramble found a guiding question already filed"
		);
		expect(first.noteA).toBe("2026-09-02");
		expect(first.noteB).toBe("How to play and dance with people");
		expect(first.keep).toBe("plain");
		expect(first.quotes).toHaveLength(2);
		expect(first.thread).toContain("talked his way back");
		expect(first.speculation).toContain("retrieval channel");
	});

	it("detects kept and applied checkbox states", () => {
		expect(conns[1].keep).toBe("kept");
		expect(conns[2].keep).toBe("applied");
		expect(conns[2].noteB).toBe("Huberman goal toolkit");
	});

	it("keeps the high-signal block as informational, not a connection", () => {
		const high = conns[3];
		expect(high.isHighSignal).toBe(true);
		expect(high.noteA).toBe("");
		expect(high.pairBody).toBe("");
	});
});

describe("parseDreams — legacy digest (## headings)", () => {
	const conns = parseDreams(extractDreamsRegion(LEGACY, false)!);

	it("parses ## connection headings", () => {
		expect(conns).toHaveLength(2);
		expect(conns[0].level).toBe(2);
		expect(conns[0].noteA).toBe("2026-08-29");
		expect(conns[0].noteB).toBe("2024-02-21");
		expect(conns[1].title).toContain("Office in the woods");
	});

	it('reads a "Speculation (AI):" label variant', () => {
		expect(conns[0].speculation).toContain("recurring desires");
	});
});

describe("countDreams", () => {
	it("counts connections, flagged (kept+applied) and applied", () => {
		const conns = parseDreams(extractDreamsRegion(AGENT_NOTE, true)!);
		expect(countDreams(conns)).toEqual({
			connections: 3,
			flagged: 2,
			applied: 1,
		});
	});
});

describe("toggleKeep", () => {
	it("flags a plain pair line as `- [ ]`", () => {
		const conns = parseDreams(extractDreamsRegion(AGENT_NOTE, true)!);
		const out = toggleKeep(AGENT_NOTE, conns[0].pairBody);
		expect(out).toContain(
			"- [ ] **[[2026-09-02]]** ↔ **[[How to play and dance with people]]**"
		);
	});

	it("reverts a kept pair line back to plain", () => {
		const conns = parseDreams(extractDreamsRegion(AGENT_NOTE, true)!);
		const out = toggleKeep(AGENT_NOTE, conns[1].pairBody);
		// The `- [ ]` prefix is gone; the bare pair line remains.
		expect(out).toContain(
			"**[[2026-W30]]** ↔ **[[surrounded by people you love]]**"
		);
		expect(out).not.toContain(
			"- [ ] **[[2026-W30]]** ↔ **[[surrounded by people you love]]**"
		);
	});

	it("is idempotent — toggle twice returns the original", () => {
		const conns = parseDreams(extractDreamsRegion(AGENT_NOTE, true)!);
		const once = toggleKeep(AGENT_NOTE, conns[0].pairBody);
		const twice = toggleKeep(once, conns[0].pairBody);
		expect(twice).toBe(AGENT_NOTE);
	});

	it("leaves an applied `- [x]` connection read-only", () => {
		const conns = parseDreams(extractDreamsRegion(AGENT_NOTE, true)!);
		const out = toggleKeep(AGENT_NOTE, conns[2].pairBody);
		expect(out).toBe(AGENT_NOTE);
	});

	it("returns content unchanged when no pair line matches", () => {
		expect(toggleKeep(AGENT_NOTE, "**[[nope]]** ↔ **[[missing]]**")).toBe(
			AGENT_NOTE
		);
	});

	it("only rewrites the pair line, not the surrounding note", () => {
		const conns = parseDreams(extractDreamsRegion(AGENT_NOTE, true)!);
		const out = toggleKeep(AGENT_NOTE, conns[0].pairBody);
		// Everything outside the one line is byte-identical.
		expect(out).toContain("## Reflection");
		expect(out).toContain("*Seeds: 11 daily-note thoughts.");
		expect(out.split("\n")).toHaveLength(AGENT_NOTE.split("\n").length);
	});
});

describe("stripKeepPrefix", () => {
	it("strips a checkbox prefix and leaves a plain line untouched", () => {
		expect(stripKeepPrefix("- [ ] **[[a]]** ↔ **[[b]]**")).toBe(
			"**[[a]]** ↔ **[[b]]**"
		);
		expect(stripKeepPrefix("- [x] **[[a]]** ↔ **[[b]]**")).toBe(
			"**[[a]]** ↔ **[[b]]**"
		);
		expect(stripKeepPrefix("**[[a]]** ↔ **[[b]]**")).toBe(
			"**[[a]]** ↔ **[[b]]**"
		);
	});
});
