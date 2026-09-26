// eco-send-core.ts — pure helpers for sending a thread to Eco (v1.51.0). No
// Obsidian imports; covered by tests/eco-send-core.test.ts.
//
// Shawn 2026-09-25: "maybe long press on a thread and then I can load all into
// eco and chat". The plugin reaches Eco through the NAS bridge's existing
// POST /upload (the same multipart turn endpoint the Eco app uses for a
// message with attachments; it creates the conversation when the id is new).
// No bridge change was needed. This module builds the message text, the
// multipart body, the conversation id, and picks the "current" chat.

/** One line of the payload: a post or a reply, with where it lives. */
export interface EcoPostLine {
	dateIso: string;
	time: string | null;
	text: string;
	/** Note basename, e.g. "2026-09-25" — the wikilink target. */
	note: string;
	blockId: string | null;
	/** 0 for a post, 1+ for replies under it. */
	depth: number;
	/** The sub-thread this post is tagged with, when it is not the node itself. */
	subThread?: string | null;
}

export type EcoSendMode = "new" | "current";

/** Upper bound on the message text; the oldest posts are dropped past it. */
export const ECO_MAX_CHARS = 60_000;

function oneLine(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

/** "[[2026-09-25#^t3f9]]" or "[[walk dancing]]" when the line has no block id. */
export function noteLink(note: string, blockId: string | null): string {
	return blockId ? `[[${note}#^${blockId}]]` : `[[${note}]]`;
}

/** One payload line: "- 2026-09-25 16:39 · text — [[2026-09-25#^id]]". */
export function formatEcoLine(p: EcoPostLine): string {
	const indent = "  ".repeat(Math.max(0, p.depth));
	const when = p.time ? `${p.dateIso} ${p.time}` : p.dateIso;
	const arrow = p.depth > 0 ? "↩ " : "";
	const sub = p.subThread ? ` (#thread/${p.subThread})` : "";
	return `${indent}- ${arrow}${when} · ${oneLine(p.text)}${sub} — ${noteLink(p.note, p.blockId)}`;
}

/**
 * The message Eco receives. Posts are grouped: a post line followed by its
 * replies (depth > 0). When the text would pass `maxChars`, whole groups are
 * dropped from the OLDEST end and a line says how many posts were left out.
 */
export function formatThreadForEco(
	thread: string,
	groups: EcoPostLine[][],
	mode: EcoSendMode,
	maxChars: number = ECO_MAX_CHARS
): string {
	const total = groups.reduce((n, g) => n + g.length, 0);
	const postCount = groups.length;
	const head =
		mode === "new"
			? `Thread #thread/${thread} from Obsidian — let's talk about it. It has ${postCount} ${postCount === 1 ? "post" : "posts"} (${total} lines with replies). Read it through and tell me what you notice.`
			: `Adding my thread #thread/${thread} from Obsidian to this chat as context (${postCount} ${postCount === 1 ? "post" : "posts"}, ${total} lines with replies).`;
	const legend =
		"Each line is one thought: date and time · text — the note it lives in. Indented ↩ lines are replies to the thought above them.";
	const blocks = groups.map((g) => g.map(formatEcoLine).join("\n"));
	let kept = blocks.slice();
	let dropped = 0;
	const build = () => {
		const omitted =
			dropped > 0
				? `\n(${dropped} older ${dropped === 1 ? "post" : "posts"} left out to keep this message short.)`
				: "";
		return `${head}\n\n${legend}${omitted}\n\n## #thread/${thread}\n${kept.join("\n")}`;
	};
	let text = build();
	while (text.length > maxChars && kept.length > 1) {
		kept = kept.slice(1);
		dropped++;
		text = build();
	}
	if (text.length > maxChars) text = text.slice(0, maxChars - 1) + "…";
	return text;
}

/** A conversation id in the bridge's accepted form ([A-Za-z0-9_-]{1,64}). */
export function mintConversationId(now: number, rng: () => number = Math.random): string {
	const rand = Math.floor(rng() * 36 ** 4)
		.toString(36)
		.padStart(4, "0");
	return `obs${now.toString(36)}-${rand}`;
}

/** A message id for the /upload turn. */
export function mintMessageId(now: number, rng: () => number = Math.random): string {
	return `obs-${now}-${Math.floor(rng() * 1e6)}`;
}

/** The chat title sent along (the bridge takes at most 60 characters). The
 *  sidebar title itself comes from the message's first 60 characters, which
 *  is why the new-chat text opens with "Thread #thread/<name> from Obsidian". */
export function newChatTitle(thread: string): string {
	return `Thread: ${thread}`.slice(0, 60);
}

/** A row of the bridge's GET /conversations answer (only what we read). */
export interface ConvRow {
	id: string;
	title?: string;
	channel?: string;
	surface?: string;
	updatedAt?: number;
	archived?: boolean;
	doneAt?: number | null;
}

const LEGACY_DEFAULT_ID = "voicebridge";

/**
 * The chat to add to: the most recently active open Eco (claude-channel) chat.
 * The bridge cannot know which chat is on screen, so recency stands in for
 * "current"; the plugin shows the chosen title in a confirm first. Skips the
 * legacy single-session id, test (smoke) chats, archived and done chats.
 */
export function pickCurrentConversation(rows: readonly ConvRow[]): ConvRow | null {
	const ok = rows.filter(
		(r) =>
			typeof r.id === "string" &&
			/^[A-Za-z0-9_-]{1,64}$/.test(r.id) &&
			r.id !== LEGACY_DEFAULT_ID &&
			(r.channel ?? "claude") === "claude" &&
			r.surface !== "smoke" &&
			!r.archived &&
			!r.doneAt
	);
	ok.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
	return ok[0] ?? null;
}

/**
 * A multipart/form-data body of plain text fields (no files), as a string —
 * Obsidian's requestUrl sends a string body as UTF-8.
 */
export function buildMultipart(
	fields: Record<string, string>,
	boundary: string
): { body: string; contentType: string } {
	let body = "";
	for (const [k, v] of Object.entries(fields)) {
		body += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
	}
	body += `--${boundary}--\r\n`;
	return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** The /upload fields for one thread send. */
export function uploadFields(opts: {
	id: string;
	text: string;
	conversationId: string;
	title?: string;
}): Record<string, string> {
	const f: Record<string, string> = {
		id: opts.id,
		text: opts.text,
		channel: "claude",
		conversationId: opts.conversationId,
		surface: JSON.stringify({ surface: "obsidian", mode: "rich" }),
	};
	if (opts.title) f.conversationTitle = opts.title;
	return f;
}

/** The fields ecoGroupsFromPostGroups reads from a post or reply. */
interface EcoSource {
	thread: string | null;
	dateIso: string;
	time: string | null;
	text: string;
	note: string;
	blockId: string | null;
}

/**
 * Turn the thread view's cards (a post + its reply tree) into payload groups:
 * the post at depth 0, then its replies depth-first at depth 1, 2, …. A post
 * tagged with a sub-thread of `thread` names that sub-thread.
 */
export function ecoGroupsFromPostGroups(
	thread: string,
	groups: Array<{
		post: EcoSource;
		replies: Array<{ reply: EcoSource; children: unknown[] }>;
	}>
): EcoPostLine[][] {
	type Node = { reply: EcoSource; children: Node[] };
	const line = (p: EcoSource, depth: number): EcoPostLine => ({
		dateIso: p.dateIso,
		time: p.time,
		text: p.text,
		note: p.note,
		blockId: p.blockId,
		depth,
		subThread: depth === 0 && p.thread && p.thread !== thread ? p.thread : null,
	});
	return groups.map((g) => {
		const out: EcoPostLine[] = [line(g.post, 0)];
		const walk = (nodes: Node[], depth: number) => {
			for (const n of nodes) {
				out.push(line(n.reply, depth));
				walk(n.children, depth + 1);
			}
		};
		walk(g.replies as Node[], 1);
		return out;
	});
}
