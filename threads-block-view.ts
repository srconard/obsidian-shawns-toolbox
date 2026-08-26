// threads-block-view.ts — Obsidian glue for the ```threads code block. Parses
// the block body (threads-block.ts), scans posts through the shared
// ThreadService (same data layer as the side panel), and renders the selected
// groups inline with the shared card renderer (thread-render.ts). Read-only in
// v1: cards open their source line but nothing is edited from here.
import { MarkdownRenderChild } from "obsidian";
import type { ThreadService } from "./thread-service";
import {
	parseThreadsBlock,
	isEmptySpec,
	selectBlockGroups,
} from "./threads-block";
import { renderBlockGroups } from "./thread-render";

const USAGE =
	"Empty threads block. Add e.g. `threads: singularity, narrative` or `tags: weekly`.";

/**
 * Render a ```threads code block into `el`. Parses the body, then (async) scans
 * and paints the groups. A MarkdownRenderChild is returned so Obsidian owns the
 * lifecycle; the render is fired immediately. Errors and the empty case render a
 * quiet hint rather than throwing, so a malformed block never breaks the note.
 */
export function renderThreadsBlock(
	source: string,
	el: HTMLElement,
	service: ThreadService
): MarkdownRenderChild {
	const child = new MarkdownRenderChild(el);
	const root = el.createDiv({ cls: "stx-threads-block" });
	const spec = parseThreadsBlock(source);

	if (spec.errors.length) {
		const errs = root.createDiv({ cls: "stx-threads-block-errors" });
		for (const e of spec.errors) errs.createDiv({ text: `⚠ ${e}` });
	}

	if (isEmptySpec(spec)) {
		root.createDiv({ cls: "stx-threads-block-empty", text: USAGE });
		return child;
	}

	const loading = root.createDiv({
		cls: "stx-threads-block-empty",
		text: "Loading threads…",
	});

	void service
		.scanAll()
		.then(({ posts, periodic }) => {
			loading.remove();
			const groups = selectBlockGroups(spec, posts, periodic);
			renderBlockGroups(root, groups, {
				onOpen: (post) => void service.openPost(post),
			});
		})
		.catch((err) => {
			loading.setText(`Could not load threads: ${err?.message ?? err}`);
		});

	return child;
}
