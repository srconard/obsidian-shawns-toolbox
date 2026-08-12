import { describe, it, expect } from "vitest";
import { appendLog, formatStatusLogEntry, LOG_HEADING } from "../note-log";

describe("formatStatusLogEntry", () => {
	it("renders a normal transition", () => {
		expect(formatStatusLogEntry("simmering", "active", "2026-08-12")).toBe(
			"log:: 2026-08-12 status: simmering → active — toolbox"
		);
	});
	it("renders an empty from-value as none (first status ever set)", () => {
		expect(formatStatusLogEntry(null, "active", "2026-08-12")).toBe(
			"log:: 2026-08-12 status: none → active — toolbox"
		);
	});
	it("renders a cleared to-value as none", () => {
		expect(formatStatusLogEntry("active", null, "2026-08-12")).toBe(
			"log:: 2026-08-12 status: active → none — toolbox"
		);
	});
	it("includes the time when given (24h HH:mm)", () => {
		expect(
			formatStatusLogEntry("simmering", "active", "2026-08-12", "11:54")
		).toBe("log:: 2026-08-12 11:54 status: simmering → active — toolbox");
	});
	it("omits the time when not given (hand-written human lines)", () => {
		expect(formatStatusLogEntry(null, "active", "2026-08-12")).toBe(
			"log:: 2026-08-12 status: none → active — toolbox"
		);
	});
});

describe("appendLog — section absent", () => {
	it("creates a Log section at the bottom", () => {
		const before = "# Note\n\nSome body text.\n";
		const after = appendLog(before, "log:: 2026-08-12 status: none → active — toolbox");
		expect(after).toBe(
			"# Note\n\nSome body text.\n\n## Log\nlog:: 2026-08-12 status: none → active — toolbox\n"
		);
	});
	it("handles a note with no trailing newline", () => {
		const before = "Body with no newline";
		const after = appendLog(before, "log:: 2026-08-12 status: none → on — toolbox");
		expect(after).toBe(
			"Body with no newline\n\n## Log\nlog:: 2026-08-12 status: none → on — toolbox\n"
		);
	});
	it("handles empty content", () => {
		const after = appendLog("", "log:: 2026-08-12 status: none → on — toolbox");
		expect(after).toBe("## Log\nlog:: 2026-08-12 status: none → on — toolbox\n");
	});
	it("does not accumulate blank lines when body ends in whitespace", () => {
		const before = "Body\n\n\n";
		const after = appendLog(before, "log:: x");
		expect(after).toBe("Body\n\n## Log\nlog:: x\n");
	});
});

describe("appendLog — section present", () => {
	it("appends after existing log lines", () => {
		const before =
			"# Note\n\nBody.\n\n## Log\nlog:: 2026-08-01 status: none → simmering — toolbox\n";
		const after = appendLog(
			before,
			"log:: 2026-08-12 status: simmering → active — toolbox"
		);
		expect(after).toBe(
			"# Note\n\nBody.\n\n## Log\n" +
				"log:: 2026-08-01 status: none → simmering — toolbox\n" +
				"log:: 2026-08-12 status: simmering → active — toolbox\n"
		);
	});
	it("inserts before a following section rather than at EOF", () => {
		const before = "## Log\nlog:: a\n\n## Footer\ntext\n";
		const after = appendLog(before, "log:: b");
		expect(after).toBe("## Log\nlog:: a\nlog:: b\n\n## Footer\ntext\n");
	});
	it("preserves existing body content exactly", () => {
		const before = "Line1\n- a checklist\n  - nested\n\n## Log\nlog:: a\n";
		const after = appendLog(before, "log:: b");
		expect(after).toContain("Line1\n- a checklist\n  - nested\n");
		expect(after.endsWith("log:: a\nlog:: b\n")).toBe(true);
	});
});

describe("appendLog — duplicate guard (first-set regression)", () => {
	// The v1.4.0 bug: setting a status for the first time stamped two identical
	// lines because the write path re-entered under one click. appendLog must
	// treat a byte-identical last entry as a no-op so a re-entrant write cannot
	// double the line.
	it("does not append a line byte-identical to the section's last entry", () => {
		const entry = "log:: 2026-08-12 11:54 status: none → active — toolbox";
		const first = appendLog("# Note\n\nBody.\n", entry);
		const second = appendLog(first, entry);
		expect(second).toBe(first);
		expect(second.split(entry).length - 1).toBe(1);
	});
	it("still appends a genuinely different entry (different time)", () => {
		const a = "log:: 2026-08-12 11:54 status: none → active — toolbox";
		const b = "log:: 2026-08-12 11:55 status: active → simmering — toolbox";
		const after = appendLog(appendLog("Body\n", a), b);
		expect(after.endsWith(`${a}\n${b}\n`)).toBe(true);
	});
});

describe("LOG_HEADING", () => {
	it("is the agreed heading", () => {
		expect(LOG_HEADING).toBe("## Log");
	});
});
