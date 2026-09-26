import { describe, it, expect } from "vitest";
import {
	descendantReplies,
	groupPostsWithReplies,
	parseNoteReplies,
	parseReplyLine,
	type ReplyPost,
} from "../thread-replies-core";
import { parseNotePosts, type ThreadPost } from "../thread-core";

describe("parseReplyLine", () => {
	it("parses an untagged reply", () => {
		const r = parseReplyLine(
			"- 16:39 a reply with no tag ↩ [[2026-02-11#^tfvbq4y]]",
			"2026-09-25",
			"2026-09-25",
			80,
			"00. Timeline/2026-09-25.md"
		)!;
		expect(r.thread).toBeNull();
		expect(r.replyTo).toEqual({ note: "2026-02-11", blockId: "tfvbq4y" });
		expect(r.time).toBe("16:39");
		expect(r.text).toBe("a reply with no tag");
		expect(r.path).toBe("00. Timeline/2026-09-25.md");
	});

	it("parses a tagged reply with its own block id", () => {
		const r = parseReplyLine(
			"- 9:05 yes #thread/eco ↩ [[walk dancing#^ab12]] ^cd34",
			"2026-09-25",
			"2026-09-25",
			3
		)!;
		expect(r.thread).toBe("eco");
		expect(r.blockId).toBe("cd34");
		expect(r.time).toBe("09:05");
		expect(r.replyTo.note).toBe("walk dancing");
	});

	it("is not fooled by a plain block link without the arrow", () => {
		expect(parseReplyLine("- see [[2026-02-11#^abc]]", "n", "2026-09-25", 0)).toBeNull();
		expect(parseReplyLine("- plain thought #thread/x", "n", "2026-09-25", 0)).toBeNull();
	});
});

// A small vault: a parent post in 09-20, replies in 09-21 (one tagged, one
// not), and a reply to a reply in 09-22.
const n20 = [
	"- 08:00 the parent #thread/flow ^p1",
	"- 08:30 unrelated #thread/flow",
].join("\n");
const n21 = [
	"- 10:00 tagged reply #thread/flow ↩ [[2026-09-20#^p1]] ^r1",
	"- 11:00 untagged reply ↩ [[2026-09-20#^p1]]",
].join("\n");
const n22 = ["- 12:00 reply to the reply ↩ [[2026-09-21#^r1]]"].join("\n");

function vault(): { posts: ThreadPost[]; replies: ReplyPost[] } {
	const posts = [
		...parseNotePosts("2026-09-20", "2026-09-20", n20, "T/2026-09-20.md"),
		...parseNotePosts("2026-09-21", "2026-09-21", n21, "T/2026-09-21.md"),
		...parseNotePosts("2026-09-22", "2026-09-22", n22, "T/2026-09-22.md"),
	];
	const replies = [
		...parseNoteReplies("2026-09-20", "2026-09-20", n20, "T/2026-09-20.md"),
		...parseNoteReplies("2026-09-21", "2026-09-21", n21, "T/2026-09-21.md"),
		...parseNoteReplies("2026-09-22", "2026-09-22", n22, "T/2026-09-22.md"),
	];
	return { posts, replies };
}

describe("groupPostsWithReplies", () => {
	it("puts every reply in its parent's box, tagged or not", () => {
		const { posts, replies } = vault();
		const flow = posts.filter((p) => p.thread === "flow");
		const groups = groupPostsWithReplies(flow, replies);
		// The tagged reply is a flow post too, but it is not repeated as a card.
		expect(groups.map((g) => g.post.text)).toEqual(["the parent", "unrelated"]);
		const parent = groups[0];
		expect(parent.replyCount).toBe(3);
		expect(parent.replies.map((r) => r.reply.text)).toEqual([
			"tagged reply",
			"untagged reply",
		]);
		expect(parent.replies[0].children.map((c) => c.reply.text)).toEqual([
			"reply to the reply",
		]);
		expect(groups[1].replyCount).toBe(0);
	});

	it("keeps a reply as its own card when its parent is not in view", () => {
		const { posts, replies } = vault();
		const onlyReply = posts.filter((p) => p.text === "tagged reply");
		const groups = groupPostsWithReplies(onlyReply, replies);
		expect(groups).toHaveLength(1);
		expect(groups[0].replies.map((r) => r.reply.text)).toEqual(["reply to the reply"]);
	});

	it("survives a reply cycle without losing either post", () => {
		const a = "- 08:00 a #thread/x ↩ [[2026-09-21#^b]] ^a";
		const b = "- 09:00 b #thread/x ↩ [[2026-09-20#^a]] ^b";
		const posts = [
			...parseNotePosts("2026-09-20", "2026-09-20", a, "A.md"),
			...parseNotePosts("2026-09-21", "2026-09-21", b, "B.md"),
		];
		const replies = [
			...parseNoteReplies("2026-09-20", "2026-09-20", a, "A.md"),
			...parseNoteReplies("2026-09-21", "2026-09-21", b, "B.md"),
		];
		const groups = groupPostsWithReplies(posts, replies);
		expect(groups.map((g) => g.post.text)).toEqual(["a", "b"]);
	});
});

describe("descendantReplies", () => {
	it("returns every reply at every depth, parents first", () => {
		const { posts, replies } = vault();
		const parent = posts.find((p) => p.blockId === "p1")!;
		expect(descendantReplies(parent, replies).map((r) => r.text)).toEqual([
			"tagged reply",
			"reply to the reply",
			"untagged reply",
		]);
	});

	it("is empty for a post without a block id", () => {
		const { posts, replies } = vault();
		const loose = posts.find((p) => p.text === "unrelated")!;
		expect(descendantReplies(loose, replies)).toEqual([]);
	});
});
