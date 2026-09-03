import { describe, it, expect } from "vitest";
import {
	extractDreamsRegion,
	parseDreams,
	countDreams,
	toggleKeep,
	stripKeepPrefix,
	setConnectionNote,
	isNoteLine,
	noteTextFromLine,
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

// An agent-note connection that already carries a Shawn context note.
const NOTED_AGENT = [
	DREAMS_START,
	"",
	"### A connection Shawn annotated",
	"",
	"- [ ] **[[Alpha]]** ↔ **[[Beta]]**",
	"  - 💭 I love how the ramble predated the idea *(Shawn, 2026-09-02)*",
	"",
	'> "a quote"',
	"",
	"**The thread:** they rhyme.",
	"",
	"---",
	DREAMS_END,
].join("\n");

const DATE = "2026-09-03";

describe("parseDreams — context note", () => {
	it("reads the 💭 child note and strips the glyph + signature", () => {
		const conns = parseDreams(extractDreamsRegion(NOTED_AGENT, true)!);
		expect(conns).toHaveLength(1);
		expect(conns[0].note).toBe("I love how the ramble predated the idea");
		expect(conns[0].keep).toBe("kept");
		// The note line is not mistaken for a quote or the pair line.
		expect(conns[0].noteA).toBe("Alpha");
		expect(conns[0].quotes).toEqual(['"a quote"']);
	});

	it("leaves note empty for connections without one", () => {
		const conns = parseDreams(extractDreamsRegion(AGENT_NOTE, true)!);
		expect(conns.map((c) => c.note)).toEqual(["", "", "", ""]);
	});
});

describe("isNoteLine / noteTextFromLine", () => {
	it("recognises a note child line at any indent", () => {
		expect(isNoteLine("  - 💭 hello *(Shawn, 2026-09-03)*")).toBe(true);
		expect(isNoteLine("💭 bare")).toBe(true);
		expect(isNoteLine("- [ ] **[[a]]** ↔ **[[b]]**")).toBe(false);
		expect(isNoteLine("> a quote")).toBe(false);
	});
	it("extracts the note text", () => {
		expect(
			noteTextFromLine("  - 💭 the reason here *(Shawn, 2026-09-03)*")
		).toBe("the reason here");
	});
});

describe("setConnectionNote", () => {
	it("inserts a note directly under a plain pair line", () => {
		const conns = parseDreams(extractDreamsRegion(AGENT_NOTE, true)!);
		const out = setConnectionNote(AGENT_NOTE, conns[0].pairBody, "my reason", DATE);
		const lines = out.split("\n");
		const pairIdx = lines.findIndex(
			(l) =>
				l.includes("How to play and dance with people") && l.includes("↔")
		);
		expect(lines[pairIdx + 1]).toBe(
			"  - 💭 my reason *(Shawn, 2026-09-03)*"
		);
		// One line longer, everything else identical.
		expect(lines.length).toBe(AGENT_NOTE.split("\n").length + 1);
		// Round-trips through the parser.
		const reparsed = parseDreams(extractDreamsRegion(out, true)!);
		expect(reparsed[0].note).toBe("my reason");
	});

	it("adds a note on a kept connection", () => {
		const conns = parseDreams(extractDreamsRegion(AGENT_NOTE, true)!);
		const out = setConnectionNote(AGENT_NOTE, conns[1].pairBody, "worth it", DATE);
		expect(out).toContain("  - 💭 worth it *(Shawn, 2026-09-03)*");
		expect(parseDreams(extractDreamsRegion(out, true)!)[1].note).toBe("worth it");
	});

	it("adds a note on an applied (read-only-keep) connection", () => {
		const conns = parseDreams(extractDreamsRegion(AGENT_NOTE, true)!);
		const out = setConnectionNote(AGENT_NOTE, conns[2].pairBody, "kept it", DATE);
		const applied = parseDreams(extractDreamsRegion(out, true)!)[2];
		expect(applied.keep).toBe("applied"); // note write leaves keep untouched
		expect(applied.note).toBe("kept it");
	});

	it("replaces an existing note in place, not appending a second", () => {
		const out = setConnectionNote(NOTED_AGENT, "**[[Alpha]]** ↔ **[[Beta]]**", "new reason", DATE);
		expect(out).toContain("  - 💭 new reason *(Shawn, 2026-09-03)*");
		expect(out).not.toContain("ramble predated");
		// Exactly one 💭 line.
		expect(out.split("\n").filter((l) => l.includes("💭"))).toHaveLength(1);
		expect(out.split("\n").length).toBe(NOTED_AGENT.split("\n").length);
	});

	it("deletes the note when text is empty", () => {
		const out = setConnectionNote(NOTED_AGENT, "**[[Alpha]]** ↔ **[[Beta]]**", "", DATE);
		expect(out).not.toContain("💭");
		expect(out.split("\n").length).toBe(NOTED_AGENT.split("\n").length - 1);
		expect(parseDreams(extractDreamsRegion(out, true)!)[0].note).toBe("");
	});

	it("delete-when-absent leaves content unchanged", () => {
		const conns = parseDreams(extractDreamsRegion(AGENT_NOTE, true)!);
		expect(setConnectionNote(AGENT_NOTE, conns[0].pairBody, "", DATE)).toBe(
			AGENT_NOTE
		);
	});

	it("is idempotent — saving the same note twice is a no-op the second time", () => {
		const conns = parseDreams(extractDreamsRegion(AGENT_NOTE, true)!);
		const once = setConnectionNote(AGENT_NOTE, conns[0].pairBody, "reason", DATE);
		const twice = setConnectionNote(once, conns[0].pairBody, "reason", DATE);
		expect(twice).toBe(once);
	});

	it("touches only the note line — the rest of the note is byte-identical", () => {
		const conns = parseDreams(extractDreamsRegion(AGENT_NOTE, true)!);
		const out = setConnectionNote(AGENT_NOTE, conns[0].pairBody, "reason", DATE);
		const before = AGENT_NOTE.split("\n");
		const after = out.split("\n").filter((l) => !l.includes("💭"));
		expect(after).toEqual(before);
	});

	it("returns content unchanged when no pair line matches", () => {
		expect(
			setConnectionNote(AGENT_NOTE, "**[[nope]]** ↔ **[[missing]]**", "x", DATE)
		).toBe(AGENT_NOTE);
	});

	it("works on a legacy ## digest too", () => {
		const conns = parseDreams(extractDreamsRegion(LEGACY, false)!);
		const out = setConnectionNote(LEGACY, conns[0].pairBody, "old dream", DATE);
		expect(out).toContain("  - 💭 old dream *(Shawn, 2026-09-03)*");
		expect(parseDreams(extractDreamsRegion(out, false)!)[0].note).toBe(
			"old dream"
		);
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
