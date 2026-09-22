import { describe, it, expect } from "vitest";
import {
	buildSearchUrl,
	formatScore,
	hitLinkText,
	noteTitle,
	normalizeText,
	parseSearchResponse,
	rankTitleMatches,
	scoreTitleMatch,
	sharesStem,
	snippet,
	stripBreadcrumb,
	tokenize,
	VSEARCH_MAX_K,
} from "../vsearch-core";

// Shawn's own query, and a real /search page for it (curled from the NAS
// bridge on 2026-09-22 while building this). Keeping the verbatim payload
// here is the point: the parser's contract is whatever query_vault.py emits.
const QUERY = "no one is better than anyone else";

const LIVE_PAGE = [
	{
		note: "01. Default/dance isn't about being better, it's about transcendence.md",
		corpus: "shawn",
		heading: "",
		score: 0.41903987526893616,
		text:
			"dance isn't about being better, it's about transcendence\n" +
			"{Links}:\n" +
			"I think that dance cannot be about being better than people, it has to be about transcendence.",
		tags: ["bboy/thought", "top"],
	},
	{
		note: "01. Default/Humility.md",
		corpus: "shawn",
		heading: "",
		score: 0.4078865051269531,
		text:
			"Humility\nrespect mystery\n" +
			"The greatest evil is to think that you are better than others\n" +
			"I not above you or below you but I'm right here with you",
		tags: [],
	},
	{
		note: "01. Default/NSWCPD CTF Code 62.md",
		corpus: "shawn",
		heading: "Today",
		score: 0.40104517340660995,
		text: "NSWCPD CTF Code 62 > Today\nI need to not think that i am better than others",
		tags: [],
	},
];

describe("normalizeText / tokenize", () => {
	it("lowercases, strips punctuation and collapses whitespace", () => {
		expect(normalizeText("  Dance ISN'T   about-being better!  ")).toBe(
			"dance isn t about being better"
		);
	});
	it("drops the stopwords, keeping the words that carry the meaning", () => {
		// "no" survives on purpose: the stoplist is deliberately small, and a
		// negation is the whole point of this particular query.
		expect(tokenize(QUERY)).toEqual(["no", "one", "better", "anyone", "else"]);
	});
	it("keeps the raw words when the query is nothing BUT stopwords", () => {
		// "what is it" must still match on something; an empty token list
		// would score every title zero and silently return no notes.
		expect(tokenize("what is it")).toEqual(["what", "is", "it"]);
	});
	it("returns nothing for an empty query", () => {
		expect(tokenize("   ")).toEqual([]);
	});
});

describe("sharesStem", () => {
	it("pairs a word with its inflections", () => {
		expect(sharesStem("dance", "dancing")).toBe(true);
		expect(sharesStem("dancing", "dance")).toBe(true);
		expect(sharesStem("dark", "darkness")).toBe(true);
		expect(sharesStem("better", "betterment")).toBe(true);
	});
	it("refuses a stem shorter than four characters", () => {
		expect(sharesStem("one", "oneness")).toBe(false);
		expect(sharesStem("cat", "cats")).toBe(false);
	});
	it("refuses words that merely start alike", () => {
		expect(sharesStem("connect", "concrete")).toBe(false);
		expect(sharesStem("morning", "mortgage")).toBe(false);
		expect(sharesStem("threads", "threshold")).toBe(false);
	});
	it("is deliberately loose about a two-character tail", () => {
		// The cost of these is one extra note in a list of eight; the cost of
		// tightening past them is losing "dance" → "dancing".
		expect(sharesStem("thought", "though")).toBe(true);
		expect(sharesStem("practice", "practical")).toBe(true);
		expect(sharesStem("humility", "humiliation")).toBe(true);
	});
});

describe("noteTitle", () => {
	it("takes the basename without the extension", () => {
		expect(noteTitle("00. Timeline/2026-09-22.md")).toBe("2026-09-22");
		expect(noteTitle("Humility.md")).toBe("Humility");
		expect(noteTitle("a/b/c")).toBe("c");
	});
});

describe("scoreTitleMatch", () => {
	it("scores nothing when no content word appears", () => {
		expect(scoreTitleMatch(QUERY, "Greenhouse dashboard")).toBe(0);
	});
	it("scores a partial match below a full one", () => {
		const partial = scoreTitleMatch(QUERY, "On being better");
		const full = scoreTitleMatch(QUERY, "no one better than anyone else");
		expect(partial).toBeGreaterThan(0);
		expect(full).toBeGreaterThan(partial);
	});
	it("gives the verbatim phrase a bonus", () => {
		expect(scoreTitleMatch("humility", "Humility")).toBeGreaterThan(
			scoreTitleMatch("humility", "A long note that mentions humility somewhere in its name")
		);
	});
	it("matches across an inflection the substring rule cannot see", () => {
		// "dance" does not appear inside "dancing" — the shared stem does.
		expect(scoreTitleMatch("dance", "dancing in the dark")).toBeGreaterThan(0);
		expect(scoreTitleMatch("dancing", "Dance practice")).toBeGreaterThan(0);
	});
	it("scores an empty query and an empty title at zero", () => {
		expect(scoreTitleMatch("", "Humility")).toBe(0);
		expect(scoreTitleMatch("humility", "")).toBe(0);
	});
});

describe("rankTitleMatches", () => {
	const PATHS = [
		"01. Default/Humility.md",
		"01. Default/dance isn't about being better, it's about transcendence.md",
		"04. Projects/Greenhouse dashboard.md",
		"03. Personal/Better than anyone else.md",
	];

	it("returns only the notes whose titles actually matched, best first", () => {
		const ranked = rankTitleMatches(QUERY, PATHS);
		expect(ranked.map((m) => m.path)).not.toContain(
			"04. Projects/Greenhouse dashboard.md"
		);
		expect(ranked[0].path).toBe("03. Personal/Better than anyone else.md");
	});
	it("honours the limit", () => {
		expect(rankTitleMatches(QUERY, PATHS, 1)).toHaveLength(1);
		expect(rankTitleMatches(QUERY, PATHS, 0)).toHaveLength(0);
	});
	it("lifts a note the passages also found, as a tie-breaker only", () => {
		const plain = rankTitleMatches("better", PATHS);
		const boosted = rankTitleMatches("better", PATHS, undefined, [
			"01. Default/dance isn't about being better, it's about transcendence.md",
		]);
		const find = (rows: typeof plain, path: string) =>
			rows.find((r) => r.path === path)!.score;
		const path =
			"01. Default/dance isn't about being better, it's about transcendence.md";
		expect(find(boosted, path)).toBeGreaterThan(find(plain, path));
		// The boost must never conjure a match out of a title that scored 0.
		expect(
			rankTitleMatches(QUERY, PATHS, undefined, [
				"04. Projects/Greenhouse dashboard.md",
			]).map((m) => m.path)
		).not.toContain("04. Projects/Greenhouse dashboard.md");
	});
	it("returns nothing for an empty query", () => {
		expect(rankTitleMatches("", PATHS)).toEqual([]);
	});
});

describe("buildSearchUrl", () => {
	it("builds the bridge's /search call — the JSON switch is format=json", () => {
		const url = new URL(
			buildSearchUrl("http://100.97.68.101:8787", QUERY, {
				k: 20,
				corpus: "shawn",
			})
		);
		expect(url.pathname).toBe("/search");
		expect(url.searchParams.get("q")).toBe(QUERY);
		expect(url.searchParams.get("format")).toBe("json");
		expect(url.searchParams.get("k")).toBe("20");
		expect(url.searchParams.get("corpus")).toBe("shawn");
	});
	it("tolerates a trailing slash and surrounding space in the setting", () => {
		expect(
			buildSearchUrl("  http://nas:8787//  ", "x").startsWith(
				"http://nas:8787/search?"
			)
		).toBe(true);
	});
	it("clamps k to the range the bridge accepts (1..50), not a 400", () => {
		const k = (n: number) =>
			new URL(buildSearchUrl("http://nas:8787", "x", { k: n })).searchParams.get(
				"k"
			);
		expect(k(999)).toBe(String(VSEARCH_MAX_K));
		expect(k(0)).toBe("1");
		expect(k(-5)).toBe("1");
	});
	it("omits floor unless asked, and passes it through when given", () => {
		expect(buildSearchUrl("http://nas:8787", "x")).not.toContain("floor");
		expect(
			buildSearchUrl("http://nas:8787", "x", { floor: 0.3 })
		).toContain("floor=0.3");
	});
	it("refuses an empty base URL rather than fetching a relative path", () => {
		expect(() => buildSearchUrl("   ", "x")).toThrow(/settings/i);
	});
});

describe("parseSearchResponse", () => {
	it("reads the live payload the bridge returned", () => {
		const hits = parseSearchResponse(LIVE_PAGE);
		expect(hits).toHaveLength(3);
		expect(hits[0].note).toBe(
			"01. Default/dance isn't about being better, it's about transcendence.md"
		);
		expect(hits[2].heading).toBe("Today");
		expect(hits[0].tags).toEqual(["bboy/thought", "top"]);
		expect(hits[0].score).toBeCloseTo(0.419, 3);
	});
	it("accepts a {results: []} envelope as well as the bare array", () => {
		expect(parseSearchResponse({ results: LIVE_PAGE })).toHaveLength(3);
	});
	it("drops a malformed row instead of blanking the panel", () => {
		const hits = parseSearchResponse([
			LIVE_PAGE[0],
			null,
			"nope",
			{ heading: "orphan with no note" },
			{ note: "" },
		]);
		expect(hits).toHaveLength(1);
	});
	it("fills in the optional fields a row may omit", () => {
		const [hit] = parseSearchResponse([{ note: "A.md" }]);
		expect(hit).toEqual({
			note: "A.md",
			heading: "",
			score: 0,
			text: "",
			tags: [],
			corpus: "",
		});
	});
	it("returns nothing for a shape it does not recognise", () => {
		expect(parseSearchResponse(null)).toEqual([]);
		expect(parseSearchResponse({ error: "bridge down" })).toEqual([]);
		expect(parseSearchResponse("[]")).toEqual([]);
	});
});

describe("stripBreadcrumb", () => {
	it("drops the 'Note > Heading' line query_vault.py prepends", () => {
		const hit = LIVE_PAGE[2];
		expect(stripBreadcrumb(hit.text, hit.note, hit.heading)).toBe(
			"I need to not think that i am better than others"
		);
	});
	it("drops a bare note-title breadcrumb on a headingless chunk", () => {
		const hit = LIVE_PAGE[1];
		expect(stripBreadcrumb(hit.text, hit.note, hit.heading)).toBe(
			"respect mystery\n" +
				"The greatest evil is to think that you are better than others\n" +
				"I not above you or below you but I'm right here with you"
		);
	});
	it("leaves a chunk whose first line is real prose alone", () => {
		expect(
			stripBreadcrumb("I think therefore I am\nmore", "Humility.md", "")
		).toBe("I think therefore I am\nmore");
	});
});

describe("snippet", () => {
	it("picks the line that actually matches, not the first one", () => {
		const hit = LIVE_PAGE[1];
		expect(snippet(stripBreadcrumb(hit.text, hit.note, hit.heading), QUERY)).toBe(
			"The greatest evil is to think that you are better than others"
		);
	});
	it("windows a long line around the match and ellipsises the cut", () => {
		const line = "x".repeat(400) + " humility " + "y".repeat(400);
		const out = snippet(line, "humility", 60);
		expect(out.length).toBeLessThanOrEqual(64);
		expect(out).toContain("humility");
		expect(out.startsWith("…")).toBe(true);
		expect(out.endsWith("…")).toBe(true);
	});
	it("returns an empty string for an empty chunk", () => {
		expect(snippet("   \n  ", QUERY)).toBe("");
	});
});

describe("formatScore", () => {
	it("renders a similarity as a two-digit badge", () => {
		expect(formatScore(0.41903987526893616)).toBe("42");
		expect(formatScore(1)).toBe("100");
	});
	it("clamps rather than printing a nonsense badge", () => {
		expect(formatScore(-0.5)).toBe("0");
		expect(formatScore(4)).toBe("100");
		expect(formatScore(Number.NaN)).toBe("");
	});
});

describe("hitLinkText", () => {
	it("targets the heading when there is one", () => {
		expect(hitLinkText("A/B.md", "Today")).toBe("A/B.md#Today");
	});
	it("falls back to the note when the heading would break the link", () => {
		expect(hitLinkText("A/B.md", "")).toBe("A/B.md");
		expect(hitLinkText("A/B.md", "a # b")).toBe("A/B.md");
		expect(hitLinkText("A/B.md", "a | b")).toBe("A/B.md");
		expect(hitLinkText("A/B.md", "[[wiki]]")).toBe("A/B.md");
	});
});
