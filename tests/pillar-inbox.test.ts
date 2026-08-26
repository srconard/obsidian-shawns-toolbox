import { describe, it, expect } from "vitest";
import { formatInboxLine, PILLAR_INBOX_SPEC } from "../pillar-inbox";
import { appendToSection, sliceSection } from "../section-core";

describe("formatInboxLine", () => {
	it("makes a plain dated bullet, never a checkbox", () => {
		expect(formatInboxLine("call the dentist", "2026-08-26")).toBe(
			"- call the dentist [[2026-08-26]]"
		);
	});

	it("trims and collapses internal whitespace to one line", () => {
		expect(formatInboxLine("  buy   new\nshoes  ", "2026-08-26")).toBe(
			"- buy new shoes [[2026-08-26]]"
		);
	});
});

describe("pillar inbox append (via section-core)", () => {
	it("appends into an existing H1 '# Inbox' tail section", () => {
		const note = [
			"# Purpose",
			"foundation",
			"",
			"# Inbox",
			"- older capture",
			"",
		].join("\n");
		const out = appendToSection(
			note,
			PILLAR_INBOX_SPEC,
			formatInboxLine("new thing", "2026-08-26")
		);
		expect(sliceSection(out, "Inbox")).toBe(
			"- older capture\n- new thing [[2026-08-26]]\n"
		);
		// the plain bullet carries no checkbox
		expect(out).not.toContain("- [ ] new thing");
	});

	it("creates an Inbox section when a pillar note lacks one", () => {
		const note = ["# Purpose", "foundation", ""].join("\n");
		const out = appendToSection(
			note,
			PILLAR_INBOX_SPEC,
			formatInboxLine("first item", "2026-08-26")
		);
		expect(out).toContain("## Inbox");
		expect(out).toContain("- first item [[2026-08-26]]");
	});
});
