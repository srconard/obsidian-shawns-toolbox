import { describe, it, expect } from "vitest";
import {
	buildMultipart,
	ecoGroupsFromPostGroups,
	formatEcoLine,
	formatThreadForEco,
	mintConversationId,
	newChatTitle,
	noteLink,
	pickCurrentConversation,
	uploadFields,
	type EcoPostLine,
} from "../eco-send-core";

const post = (text: string, extra: Partial<EcoPostLine> = {}): EcoPostLine => ({
	dateIso: "2026-09-25",
	time: "16:39",
	text,
	note: "2026-09-25",
	blockId: "t1",
	depth: 0,
	...extra,
});

describe("formatEcoLine", () => {
	it("carries date, time, text and note link", () => {
		expect(formatEcoLine(post("a thought"))).toBe(
			"- 2026-09-25 16:39 · a thought — [[2026-09-25#^t1]]"
		);
	});
	it("indents replies and marks them", () => {
		expect(formatEcoLine(post("reply", { depth: 1, time: null, blockId: null }))).toBe(
			"  - ↩ 2026-09-25 · reply — [[2026-09-25]]"
		);
	});
	it("names a sub-thread", () => {
		expect(formatEcoLine(post("x", { subThread: "flow/dance" }))).toContain(
			"(#thread/flow/dance)"
		);
	});
	it("noteLink falls back to the note", () => {
		expect(noteLink("walk dancing", null)).toBe("[[walk dancing]]");
	});
});

describe("formatThreadForEco", () => {
	it("opens a new chat with the thread name first (it becomes the title)", () => {
		const text = formatThreadForEco("flow", [[post("one"), post("r", { depth: 1 })]], "new");
		expect(text.startsWith("Thread #thread/flow from Obsidian")).toBe(true);
		expect(text).toContain("1 post (2 lines with replies)");
		expect(text).toContain("## #thread/flow\n- 2026-09-25 16:39 · one");
		expect(text).toContain("  - ↩ 2026-09-25 16:39 · r");
	});

	it("words the add-to-current case as context", () => {
		const text = formatThreadForEco("flow", [[post("one")], [post("two")]], "current");
		expect(text.startsWith("Adding my thread #thread/flow from Obsidian")).toBe(true);
		expect(text).toContain("2 posts");
	});

	it("drops the oldest posts past the cap and says so", () => {
		const groups = Array.from({ length: 50 }, (_, i) => [post(`post ${i} ` + "x".repeat(80))]);
		const text = formatThreadForEco("flow", groups, "new", 2000);
		expect(text.length).toBeLessThanOrEqual(2000);
		expect(text).toMatch(/\(\d+ older posts left out/);
		expect(text).toContain("post 49");
		expect(text).not.toContain("post 0 ");
	});
});

describe("ids and titles", () => {
	it("mints ids the bridge accepts", () => {
		const id = mintConversationId(1790417046983, () => 0.5);
		expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
		expect(id.startsWith("obs")).toBe(true);
	});
	it("keeps the title within the bridge's 60 characters", () => {
		expect(newChatTitle("x".repeat(100)).length).toBe(60);
	});
});

describe("pickCurrentConversation", () => {
	it("takes the most recently active open Eco chat", () => {
		const row = pickCurrentConversation([
			{ id: "voicebridge", channel: "claude", updatedAt: 999 },
			{ id: "old", channel: "claude", updatedAt: 1 },
			{ id: "codex1", channel: "codex", updatedAt: 500 },
			{ id: "smoke1", channel: "claude", surface: "smoke", updatedAt: 600 },
			{ id: "arch", channel: "claude", archived: true, updatedAt: 700 },
			{ id: "done", channel: "claude", doneAt: 5, updatedAt: 800 },
			{ id: "cur", channel: "claude", updatedAt: 400 },
		]);
		expect(row?.id).toBe("cur");
	});
	it("returns null when nothing qualifies", () => {
		expect(pickCurrentConversation([])).toBeNull();
	});
});

describe("multipart", () => {
	it("builds a text-only form the bridge's /upload parses", () => {
		const { body, contentType } = buildMultipart(
			uploadFields({ id: "m1", text: "héllo\nworld", conversationId: "c1", title: "T" }),
			"BOUND"
		);
		expect(contentType).toBe("multipart/form-data; boundary=BOUND");
		expect(body).toContain('--BOUND\r\nContent-Disposition: form-data; name="text"\r\n\r\nhéllo\nworld\r\n');
		expect(body).toContain('name="channel"\r\n\r\nclaude\r\n');
		expect(body).toContain('name="surface"\r\n\r\n{"surface":"obsidian","mode":"rich"}\r\n');
		expect(body).toContain('name="conversationTitle"\r\n\r\nT\r\n');
		expect(body.endsWith("--BOUND--\r\n")).toBe(true);
	});
});

describe("ecoGroupsFromPostGroups", () => {
	it("flattens a card and its reply tree with depths", () => {
		const p = (text: string, thread: string | null = "flow") => ({
			thread,
			dateIso: "2026-09-25",
			time: null,
			text,
			note: "2026-09-25",
			blockId: null,
		});
		const groups = ecoGroupsFromPostGroups("flow", [
			{
				post: p("parent", "flow/dance"),
				replies: [{ reply: p("r1", null), children: [{ reply: p("r2"), children: [] }] }],
			},
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].map((l) => [l.text, l.depth, l.subThread])).toEqual([
			["parent", 0, "flow/dance"],
			["r1", 1, null],
			["r2", 2, null],
		]);
	});
});
