// threads-view.ts — the Threads side panel. Reads #thread posts from the
// timeline folder (via ThreadService) and renders a thread list → flat
// chronological thread view (4chan-style) with reply indicators and a reply
// action. Primary reading surface is the phone.
import { ItemView, Notice, WorkspaceLeaf, TAbstractFile, setIcon } from "obsidian";
import type { CardsHost } from "./section-cards";
import { ThreadService } from "./thread-service";
import {
	summarizeThreads,
	threadPosts,
	replyCounts,
	indexByBlock,
	targetKey,
	type ThreadPost,
} from "./thread-core";

export const THREADS_VIEW_TYPE = "shawns-toolbox-threads";

const PREVIEW_LEN = 60;
const REFRESH_DEBOUNCE_MS = 400;

export class ThreadsView extends ItemView {
	private service: ThreadService;
	private posts: ThreadPost[] = [];
	private activeThread: string | null = null;
	private replyOpenFor: string | null = null;
	private refreshTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, private host: CardsHost) {
		super(leaf);
		this.service = new ThreadService(host.app, host.getSettings);
	}

	getViewType(): string {
		return THREADS_VIEW_TYPE;
	}
	getDisplayText(): string {
		return "Threads";
	}
	getIcon(): string {
		return "messages-square";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("stx-threads");
		const rescanOn = (file: TAbstractFile) => {
			if (!this.service.isTimelineFile(file)) return;
			this.service.invalidate(file.path);
			this.scheduleRefresh();
		};
		this.registerEvent(this.app.vault.on("modify", rescanOn));
		this.registerEvent(this.app.vault.on("create", rescanOn));
		this.registerEvent(this.app.vault.on("delete", rescanOn));
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.service.invalidate(oldPath);
				rescanOn(file);
			})
		);
		await this.refresh();
	}

	async onClose(): Promise<void> {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.contentEl.empty();
	}

	private scheduleRefresh(): void {
		// Don't yank the UI out from under an in-progress reply.
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			if (this.isTypingReply()) return;
			void this.refresh();
		}, REFRESH_DEBOUNCE_MS);
	}

	private isTypingReply(): boolean {
		const active = document.activeElement;
		return (
			this.replyOpenFor !== null &&
			active instanceof HTMLElement &&
			this.contentEl.contains(active) &&
			active.classList.contains("stx-thread-reply-input")
		);
	}

	private async refresh(): Promise<void> {
		this.posts = await this.service.scan();
		this.render();
	}

	private render(): void {
		this.contentEl.empty();
		if (this.activeThread === null) this.renderList();
		else this.renderThread(this.activeThread);
	}

	// ---- thread list ----

	private renderList(): void {
		const head = this.contentEl.createDiv({ cls: "stx-threads-head" });
		head.createSpan({ cls: "stx-threads-title", text: "Threads" });
		this.iconButton(head, "refresh-cw", "Rescan", () => void this.refresh());

		const summaries = summarizeThreads(this.posts);
		if (summaries.length === 0) {
			this.contentEl.createDiv({
				cls: "stx-threads-empty",
				text: "No #thread posts found in the timeline yet.",
			});
			return;
		}
		const list = this.contentEl.createDiv({ cls: "stx-thread-list" });
		for (const s of summaries) {
			const row = list.createDiv({ cls: "stx-thread-row" });
			row.createDiv({ cls: "stx-thread-row-name", text: s.name });
			const meta = row.createDiv({ cls: "stx-thread-row-meta" });
			const when = s.lastActiveTime
				? `${s.lastActiveDate} ${s.lastActiveTime}`
				: s.lastActiveDate;
			meta.createSpan({ cls: "stx-thread-row-date", text: when });
			meta.createSpan({
				cls: "stx-thread-row-count",
				text: `${s.postCount} post${s.postCount === 1 ? "" : "s"}`,
			});
			row.addEventListener("click", () => {
				this.activeThread = s.name;
				this.replyOpenFor = null;
				this.render();
			});
		}
	}

	// ---- thread detail ----

	private renderThread(thread: string): void {
		const head = this.contentEl.createDiv({ cls: "stx-threads-head" });
		this.iconButton(head, "arrow-left", "Back", () => {
			this.activeThread = null;
			this.replyOpenFor = null;
			this.render();
		});
		head.createSpan({
			cls: "stx-threads-title",
			text: `#thread/${thread}`,
		});

		const posts = threadPosts(this.posts, thread);
		const counts = replyCounts(this.posts);
		const parents = indexByBlock(this.posts);
		const cardByKey = new Map<string, HTMLElement>();
		const listEl = this.contentEl.createDiv({ cls: "stx-thread-posts" });

		for (const post of posts) {
			const card = listEl.createDiv({ cls: "stx-post" });
			const key = this.cardKey(post);
			card.dataset.key = key;
			cardByKey.set(key, card);

			// reply-to preview
			if (post.replyTo) {
				const pk = targetKey(post.replyTo.note, post.replyTo.blockId);
				const parent = parents.get(pk);
				const preview = parent
					? this.truncate(parent.text)
					: `${post.replyTo.note}`;
				const rt = card.createDiv({ cls: "stx-post-replyto" });
				rt.setText(`↩ ${preview}`);
				rt.addEventListener("click", (e) => {
					e.stopPropagation();
					this.jumpTo(cardByKey, pk);
				});
			}

			// date/time — tapping opens the source note at the line
			const dateLine = card.createDiv({ cls: "stx-post-date" });
			dateLine.setText(
				post.time ? `${post.dateIso} · ${post.time}` : post.dateIso
			);
			dateLine.addEventListener("click", async (e) => {
				e.stopPropagation();
				try {
					await this.service.openPost(post);
				} catch (err) {
					new Notice(err instanceof Error ? err.message : String(err));
				}
			});

			card.createDiv({ cls: "stx-post-text", text: post.text });

			// footer: reply button + reply-count badge
			const footer = card.createDiv({ cls: "stx-post-footer" });
			const replyBtn = footer.createEl("button", {
				cls: "stx-post-reply-btn",
				text: "Reply",
			});
			replyBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.replyOpenFor = this.replyOpenFor === key ? null : key;
				this.render();
			});

			if (post.blockId) {
				const n = counts.get(targetKey(post.note, post.blockId));
				if (n && n > 0) {
					const badge = footer.createSpan({
						cls: "stx-post-replycount",
						text: `${n} ↩`,
					});
					badge.addEventListener("click", (e) => {
						e.stopPropagation();
						this.jumpToFirstReply(cardByKey, posts, post);
					});
				}
			}

			if (this.replyOpenFor === key) {
				this.renderReplyBox(card, post);
			}
		}
	}

	private renderReplyBox(card: HTMLElement, post: ThreadPost): void {
		const box = card.createDiv({ cls: "stx-thread-reply" });
		const input = box.createEl("textarea", {
			cls: "stx-thread-reply-input",
		});
		input.rows = 2;
		input.placeholder = "Reply…";
		const row = box.createDiv({ cls: "stx-thread-reply-row" });
		const send = row.createEl("button", {
			cls: "mod-cta",
			text: "Send",
		});
		const cancel = row.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => {
			this.replyOpenFor = null;
			this.render();
		});
		const submit = async () => {
			const text = input.value.trim();
			if (!text) return;
			send.disabled = true;
			try {
				await this.service.appendReply(post, text);
				this.replyOpenFor = null;
				new Notice("Reply added to today's note");
				await this.refresh();
			} catch (err) {
				send.disabled = false;
				new Notice(err instanceof Error ? err.message : String(err));
			}
		};
		send.addEventListener("click", () => void submit());
		input.addEventListener("keydown", (e) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
				e.preventDefault();
				void submit();
			}
		});
		window.setTimeout(() => input.focus(), 0);
	}

	// ---- helpers ----

	private cardKey(post: ThreadPost): string {
		return post.blockId
			? targetKey(post.note, post.blockId)
			: `${post.note}#${post.line}`;
	}

	private jumpTo(cardByKey: Map<string, HTMLElement>, key: string): void {
		const el = cardByKey.get(key);
		if (!el) return;
		el.scrollIntoView({ behavior: "smooth", block: "center" });
		el.addClass("stx-post-hl");
		window.setTimeout(() => el.removeClass("stx-post-hl"), 1400);
	}

	private jumpToFirstReply(
		cardByKey: Map<string, HTMLElement>,
		posts: ThreadPost[],
		parent: ThreadPost
	): void {
		if (!parent.blockId) return;
		const pk = targetKey(parent.note, parent.blockId);
		const reply = posts.find(
			(p) =>
				p.replyTo &&
				targetKey(p.replyTo.note, p.replyTo.blockId) === pk
		);
		if (reply) this.jumpTo(cardByKey, this.cardKey(reply));
	}

	private truncate(text: string): string {
		return text.length > PREVIEW_LEN
			? text.slice(0, PREVIEW_LEN).trimEnd() + "…"
			: text;
	}

	private iconButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void
	): void {
		const btn = parent.createEl("button", {
			cls: "stx-threads-iconbtn",
			attr: { "aria-label": label },
		});
		setIcon(btn, icon);
		btn.addEventListener("click", onClick);
	}
}
