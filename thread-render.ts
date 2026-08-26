// thread-render.ts — shared DOM helper that renders BlockGroup[] (from
// threads-block.ts) into an element, reusing the Threads panel's post-card
// markup/classes (.stx-post / .stx-post-date / .stx-post-text) so the inline
// ```threads block looks identical to the side panel. Obsidian-free at the type
// level (takes a plain HTMLElement and an onOpen callback), so the panel and the
// code-block processor share one renderer instead of duplicating card markup.
import { blockSourceLabel, type BlockGroup, type BlockPost } from "./threads-block";

export interface RenderOptions {
	/** Open a post's source line (the panel wires this to ThreadService.openPost). */
	onOpen: (post: BlockPost) => void;
}

/** Render one post card into `list`, mirroring the panel's card structure. */
function renderCard(
	list: HTMLElement,
	post: BlockPost,
	kind: BlockGroup["kind"],
	onOpen: (post: BlockPost) => void
): void {
	const card = list.createDiv({ cls: "stx-post" });
	const dateLine = card.createDiv({ cls: "stx-post-date" });
	dateLine.setText(blockSourceLabel(post));
	dateLine.onclick = () => onOpen(post);
	card.createDiv({ cls: "stx-post-text", text: post.text });
	// In a cadence group the thread name is useful context (the group header is
	// the cadence, not a thread); in a thread group the header already names it.
	if (kind === "period" && post.thread) {
		card.createDiv({ cls: "stx-post-thread" }).setText(`#thread/${post.thread}`);
	}
}

/**
 * Render every group into `root`: a labelled header followed by its post cards.
 * An empty group still renders its header plus a quiet "no posts yet" line so
 * Shawn can see the block resolved the thread/cadence but it simply has nothing.
 */
export function renderBlockGroups(
	root: HTMLElement,
	groups: BlockGroup[],
	opts: RenderOptions
): void {
	for (const group of groups) {
		const section = root.createDiv({ cls: "stx-threads-block-group" });
		section.createDiv({ cls: "stx-threads-block-head", text: group.label });
		if (group.posts.length === 0) {
			section.createDiv({
				cls: "stx-threads-block-empty",
				text: "No posts yet.",
			});
			continue;
		}
		const list = section.createDiv({ cls: "stx-thread-posts" });
		for (const post of group.posts) renderCard(list, post, group.kind, opts.onOpen);
	}
}
