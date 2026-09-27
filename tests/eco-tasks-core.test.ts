import { describe, it, expect } from "vitest";
import { displayText, parseEcoItems, replyToBlocked, statusCounts } from "../eco-tasks-core";

const NOW = new Date(2026, 8, 27, 12, 52);

const NOTE = [
	"# Top",
	"- call Joey ^eco-aaaaaa",
	"",
	"# Eco tasks",
	"- [ ] find his number [[2026-W40#^eco-aaaaaa|↑]] · 2026-09-27 12:40 #echo",
	'    - re: "call Joey"',
	"- [/] draft a message [[2026-W40#^eco-bbbbbb|↑]] · 2026-09-27 12:41 #echo",
	"  > [!echo]- working since 2026-09-27 12:42:03",
	'    - re: "text Sam"',
	"- [ ] book it [[2026-W40#^eco-cccccc|↑]] · 2026-09-27 12:43 #echo/blocked #echo",
	"  > [!echo] Echo · 12:45 — needs your OK: which date, Friday or Saturday? ⏸️",
	'    - re: "the trip"',
	"- [x] summarise [[2026-W40#Top|↑]] · 2026-09-27 12:44 #echo",
	"  > [!echo] Echo · 12:47 — Summarised the Top section into three bullets ✅",
	"- [ ] broken [[2026-W40#^eco-dddddd|↑]] · 2026-09-27 12:45 #echo #echo/error",
	"",
	"```",
	"# Comments",
	"- not a comment",
	"```",
	"",
	"# Comments",
	"- 2026-09-27 12:40 — rephrase this [[2026-W40#^eco-aaaaaa|↑]]",
	"",
	"# Other",
	"- [ ] not an eco task #echo",
].join("\n");

describe("parseEcoItems", () => {
	it("reads every Eco task with its status, and the comments", () => {
		const items = parseEcoItems(NOTE);
		expect(items.map((i) => [i.kind, i.status, i.text])).toEqual([
			["task", "open", "find his number"],
			["task", "running", "draft a message"],
			["task", "blocked", "book it"],
			["task", "done", "summarise"],
			["task", "failed", "broken"],
			["comment", "comment", "rephrase this"],
		]);
		const [open, running, blocked, done] = items;
		expect(open.link).toBe("2026-W40#^eco-aaaaaa");
		expect(open.context).toBe("call Joey");
		expect(open.stamp).toBe("2026-09-27 12:40");
		expect(running.summary).toMatch(/^working since/);
		expect(blocked.question).toBe("which date, Friday or Saturday?");
		expect(done.summary).toMatch(/Summarised the Top section/);
		expect(done.link).toBe("2026-W40#Top");
		expect(statusCounts(items)).toMatchObject({ open: 1, running: 1, blocked: 1, done: 1, failed: 1, comment: 1 });
	});

	it("ignores notes with no Eco sections and tolerates CRLF", () => {
		expect(parseEcoItems("# Top\n- [ ] x #echo\n")).toEqual([]);
		expect(parseEcoItems("# Eco tasks\r\n- [ ] a [[n#^eco-x|↑]] #echo\r\n").map((i) => i.text)).toEqual(["a"]);
	});

	it("reads heat-parked and cancelled tasks", () => {
		const items = parseEcoItems("# Eco tasks\n- [ ] a #echo/deferred-heat #echo\n- [-] b #echo\n");
		expect(items.map((i) => i.status)).toEqual(["heat", "cancelled"]);
	});
});

describe("replyToBlocked", () => {
	it("writes the answer after the callouts, inside the subtree, and clears #echo/blocked", () => {
		const items = parseEcoItems(NOTE);
		const blocked = items[2];
		const r = replyToBlocked(NOTE, blocked.line, blocked.raw, "Saturday #echo", NOW);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const lines = r.text.split("\n");
		expect(lines[9]).toBe("- [ ] book it [[2026-W40#^eco-cccccc|↑]] · 2026-09-27 12:43 #echo");
		expect(lines[12]).toBe("    - ↳ Shawn 2026-09-27 12:52: Saturday");
		expect(lines[13]).toBe("- [x] summarise [[2026-W40#Top|↑]] · 2026-09-27 12:44 #echo");
		// Re-parsed, it is open again and remembers the answer.
		const again = parseEcoItems(r.text)[2];
		expect(again.status).toBe("open");
		expect(again.replies).toEqual(["Shawn 2026-09-27 12:52: Saturday"]);
		// The #echo selector is still the last token (runnable).
		expect(/\s#echo\s*$/.test(lines[9])).toBe(true);
	});

	it("follows a task that moved, refuses one that changed or is not blocked", () => {
		const blocked = parseEcoItems(NOTE)[2];
		const shifted = "new first line\n" + NOTE;
		const r = replyToBlocked(shifted, blocked.line, blocked.raw, "ok", NOW);
		expect(r.ok).toBe(true);
		expect(replyToBlocked(NOTE, blocked.line, blocked.raw + " edited", "ok", NOW)).toMatchObject({ ok: false });
		const open = parseEcoItems(NOTE)[0];
		expect(replyToBlocked(NOTE, open.line, open.raw, "ok", NOW)).toMatchObject({ ok: false });
		expect(replyToBlocked(NOTE, blocked.line, blocked.raw, "   ", NOW)).toMatchObject({ ok: false });
	});

	it("keeps CRLF", () => {
		const t = "# Eco tasks\r\n- [ ] a #echo/blocked #echo\r\n  > [!echo] Echo · 1 — needs your OK: q ⏸️\r\n";
		const it0 = parseEcoItems(t)[0];
		const r = replyToBlocked(t, it0.line, it0.raw, "yes", NOW);
		expect(r.ok && r.text).toBe("# Eco tasks\r\n- [ ] a #echo\r\n  > [!echo] Echo · 1 — needs your OK: q ⏸️\r\n    - ↳ Shawn 2026-09-27 12:52: yes\r\n");
	});
});

describe("displayText", () => {
	it("drops the link, stamps and #echo tags", () => {
		expect(displayText("do it [[n#^x|↑]] · 2026-09-27 12:40 #echo/timeout/90 #echo")).toBe("do it");
		expect(displayText("2026-09-27 12:40 — a comment [[n#^x|↑]]")).toBe("a comment");
	});
});
