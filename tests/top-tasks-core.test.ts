import { describe, it, expect, vi, afterEach } from "vitest";
import {
	normaliseTask,
	offlineMessage,
	parseTopResponse,
	readCache,
	rowLabel,
	rowMarkers,
	sourceNote,
	stampLabel,
	stripTaskLine,
	topTasksUrl,
	withTimeout,
	listWithout,
	tickDoneText,
	tickErrorText,
	tickable,
	toggleBody,
	topToggleUrl,
	undoBody,
	TOP_TICK_UNDO_MS,
} from "../top-tasks-core";

// The bridge contract (GET /tasks/top?limit=7), as of 2026-10-08.
const FIXTURE = {
	ok: true,
	generatedAt: "2026-10-08T14:00:00.000Z",
	today: "2026-10-08",
	indexed: 1300,
	candidates: 120,
	limit: 7,
	tasks: [
		{
			id: "v-3f2a9c1b2d4e",
			text: "work on credit purchase protection",
			raw: "- [ ] #task work on credit purchase protection 🔺",
			path: "00. Timeline/2025-08-02.md",
			line: 41,
			source: "shawn",
			tags: ["#task", "#chore"],
			category: "chore",
			pillar: ["physical-health"],
			priority: "highest",
			priorityEmoji: "🔺",
			priorityBy: "shawn",
			rank: 2,
			scheduled: null,
			due: null,
			overdue: false,
			created: "2025-08-02",
			ageDays: 432,
			reason: "🔺 highest · rank 2",
			obsidianUrl: "obsidian://open?vault=Shawn%27s%20Vault&file=00.%20Timeline%2F2025-08-02",
		},
		{
			id: "T-1008-3",
			text: "renew passport",
			raw: "- [ ] renew passport ⏫ 📅 2026-10-01",
			path: "AGENTS/desks/eco/next-actions.md",
			line: 3,
			source: "eco",
			priority: "high",
			priorityEmoji: "⏫",
			due: "2026-10-01",
			overdue: true,
			reason: "⏫ high · overdue 7d",
			someFutureField: { nested: true },
		},
		{
			// Minimal: no priority, no reason, no id.
			text: "call the dentist",
			path: "00. Timeline/2026-10-07.md",
		},
	],
};

describe("parseTopResponse", () => {
	it("normalises the contract's tasks", () => {
		const r = parseTopResponse(FIXTURE);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.list.indexed).toBe(1300);
		expect(r.list.candidates).toBe(120);
		expect(r.list.generatedAt).toBe("2026-10-08T14:00:00.000Z");
		expect(r.list.tasks).toHaveLength(3);
		const [a, b, c] = r.list.tasks;
		expect(a).toMatchObject({ id: "v-3f2a9c1b2d4e", line: 41, priority: "highest", overdue: false, reason: "🔺 highest · rank 2" });
		expect(b).toMatchObject({ id: "T-1008-3", priority: "high", overdue: true, due: "2026-10-01" });
		expect(c).toMatchObject({ text: "call the dentist", line: 0, priority: null, overdue: false, reason: "" });
		expect(c.id).toBe("00. Timeline/2026-10-07.md:0:2");
	});

	it("accepts a JSON string body", () => {
		const r = parseTopResponse(JSON.stringify(FIXTURE));
		expect(r.ok && r.list.tasks.length).toBe(3);
	});

	it("caps the list at the limit", () => {
		const many = { ok: true, tasks: Array.from({ length: 12 }, (_, i) => ({ text: `t${i}`, path: `n${i}.md` })) };
		const r = parseTopResponse(many);
		expect(r.ok && r.list.tasks.map((t) => t.text)).toEqual(["t0", "t1", "t2", "t3", "t4", "t5", "t6"]);
	});

	it("skips malformed tasks instead of crashing", () => {
		const r = parseTopResponse({
			tasks: [null, 7, "x", [], { text: "no path" }, { path: "", text: "blank path" }, { path: "ok.md", line: -3, overdue: "yes", priority: 5 }],
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.list.tasks).toHaveLength(1);
		expect(r.list.tasks[0]).toMatchObject({ path: "ok.md", line: 0, overdue: false, priority: null, text: "(empty task)" });
		expect(r.list.indexed).toBeNull();
	});

	it("reports bad bodies as errors", () => {
		expect(parseTopResponse("<html>")).toEqual({ ok: false, error: "Bridge sent a non-JSON reply" });
		expect(parseTopResponse(null).ok).toBe(false);
		expect(parseTopResponse({ ok: true }).ok).toBe(false);
		expect(parseTopResponse({ ok: false, error: "index not built" })).toEqual({ ok: false, error: "index not built" });
	});
});

describe("normaliseTask", () => {
	it("derives priority from the emoji when the name is missing", () => {
		expect(normaliseTask({ path: "a.md", text: "x", priorityEmoji: "⏬" })?.priority).toBe("lowest");
		expect(normaliseTask({ path: "a.md", text: "x", priority: "MEDIUM" })?.priority).toBe("medium");
	});

	it("falls back to the stripped raw line for text", () => {
		expect(normaliseTask({ path: "a.md", raw: "- [ ] #task fix the bike 🔼 ⏳ 2026-10-12" })?.text).toBe("fix the bike");
		expect(stripTaskLine("- [ ] buy #context/errand milk ⏫")).toBe("buy milk");
	});
});

describe("row labels", () => {
	it("leads with the priority emoji and ⏳ when overdue", () => {
		const r = parseTopResponse(FIXTURE);
		if (!r.ok) throw new Error("fixture failed");
		const [a, b, c] = r.list.tasks;
		expect(rowLabel(a)).toBe("🔺 work on credit purchase protection");
		expect(rowMarkers(b)).toBe("⏫ ⏳");
		expect(rowLabel(b)).toBe("⏫ ⏳ renew passport");
		expect(rowLabel(c)).toBe("call the dentist");
	});

	it("shows the source note's basename without .md", () => {
		expect(sourceNote("00. Timeline/2025-08-02.md")).toBe("2025-08-02");
		expect(sourceNote("Top.md")).toBe("Top");
		expect(sourceNote("a/b/Notes.MD")).toBe("Notes");
	});

	it("builds the endpoint URL from the bridge base", () => {
		expect(topTasksUrl("http://100.97.68.101:8787/")).toBe("http://100.97.68.101:8787/tasks/top?limit=7");
		expect(topTasksUrl(" http://x:1 ", 3)).toBe("http://x:1/tasks/top?limit=3");
	});
});

describe("offline", () => {
	const now = new Date(2026, 9, 8, 15, 30);

	it("says plainly when there is no cached list", () => {
		expect(offlineMessage(null, now)).toBe("Bridge unreachable");
	});

	it("names the cached list's time, with the date when it is not today", () => {
		const r = parseTopResponse(FIXTURE);
		if (!r.ok) throw new Error("fixture failed");
		const today = new Date(2026, 9, 8, 9, 5).toISOString();
		expect(offlineMessage({ savedAt: today, list: r.list }, now)).toBe("Eco bridge unreachable — last list from 09:05");
		const yesterday = new Date(2026, 9, 7, 22, 40).toISOString();
		expect(stampLabel(yesterday, now)).toBe("2026-10-07 22:40");
		expect(stampLabel("garbage", now)).toBe("earlier");
	});

	it("round-trips a cache through plugin data and rejects junk", () => {
		const r = parseTopResponse(FIXTURE);
		if (!r.ok) throw new Error("fixture failed");
		const cache = { savedAt: "2026-10-08T14:00:00.000Z", list: r.list };
		const back = readCache(JSON.parse(JSON.stringify(cache)));
		expect(back).toEqual(cache);
		expect(readCache(null)).toBeNull();
		expect(readCache({ savedAt: "nope", list: r.list })).toBeNull();
		expect(readCache({ savedAt: "2026-10-08T14:00:00.000Z" })).toBeNull();
	});
});

describe("withTimeout", () => {
	afterEach(() => vi.useRealTimers());

	it("passes a fast result through", async () => {
		await expect(withTimeout(Promise.resolve(5), 1000)).resolves.toBe(5);
	});

	it("rejects a slow request after the timeout", async () => {
		vi.useFakeTimers();
		const p = withTimeout(new Promise(() => {}), 6000, "Top tasks");
		const check = expect(p).rejects.toThrow("Top tasks timed out after 6 s");
		await vi.advanceTimersByTimeAsync(6000);
		await check;
	});
});

// ── Ticks (1.60.0, 2026-10-08 13:48) ──
describe("ticks", () => {
	const RAW = "- [ ] #task prepare for week review in hammock 🔁 every week 📅 2026-10-02";
	const t = normaliseTask({
		id: "v-1", text: "prepare for week review in hammock", raw: RAW,
		path: "00. Timeline/2026-10-02.md", line: 40, recurrence: "every week",
	})!;

	it("reads the 🔁 flag and knows what can be ticked", () => {
		expect(t.recurring).toBe(true);
		expect(tickable(t)).toBe(true);
		expect(tickable(normaliseTask({ id: "x", path: "a.md", text: "no raw" }))).toBe(false);
		expect(tickable(null)).toBe(false);
	});

	it("builds the toggle and undo bodies", () => {
		expect(topToggleUrl("http://nas:8787/")).toBe("http://nas:8787/tasks/toggle");
		expect(toggleBody(t)).toEqual({ id: "v-1", path: t.path, line: 40, raw: RAW, done: true });
		const resp = { ok: true, path: t.path, line: 41, raw: "- [x] … ✅ 2026-10-08",
			inserted: { line: 40, raw: "- [ ] #task prepare 🔁 every week 📅 2026-10-09" } };
		expect(undoBody(t, resp)).toEqual({ id: "v-1", path: t.path, line: 41, raw: resp.raw, done: false });
		expect(undoBody(t, null)).toEqual({ id: "v-1", path: t.path, line: 40, raw: RAW, done: false });
		expect(tickDoneText(t, resp)).toBe("Done — prepare for week review in hammock · next 🔁 2026-10-09");
		expect(tickDoneText({ text: "x" }, {})).toBe("Done — x");
		expect(TOP_TICK_UNDO_MS).toBeGreaterThanOrEqual(3000);
	});

	it("removes a row without mutating, and words the errors", () => {
		const list = { generatedAt: null, today: null, indexed: 10, candidates: 4, tasks: [t] };
		const next = listWithout(list, "v-1");
		expect(next.tasks).toHaveLength(0);
		expect(next.candidates).toBe(3);
		expect(list.tasks).toHaveLength(1);
		expect(listWithout(list, "nope")).toBe(list);
		expect(tickErrorText(409, {})).toMatch(/changed in the note/);
		expect(tickErrorText(0, null)).toMatch(/not ticked/);
		expect(tickErrorText(422, { error: "🔁 rule" })).toBe("🔁 rule");
		expect(tickErrorText(500, { error: "boom" })).toMatch(/boom/);
	});
});
