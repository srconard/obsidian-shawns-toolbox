// eco-send.ts — Obsidian glue for "send this thread to Eco" (v1.51.0). The pure
// parts (payload text, multipart body, ids, picking the current chat) live in
// eco-send-core.ts.
//
// Path: the NAS bridge (settings.vaultSearchUrl — the same bridge the Vault
// search panel already reaches from the phone) → POST /upload, the multipart
// turn endpoint the Eco app itself uses. A new conversationId creates the chat;
// the Eco app and eco-web both adopt chats created on another surface from
// GET /conversations. requestUrl, not fetch: Android's WebView blocks plain
// http XHR to the NAS, requestUrl goes through the native layer.
import { App, Modal, Notice, requestUrl } from "obsidian";
import {
	buildMultipart,
	formatThreadForEco,
	mintConversationId,
	mintMessageId,
	newChatTitle,
	pickCurrentConversation,
	uploadFields,
	type ConvRow,
	type EcoPostLine,
	type EcoSendMode,
} from "./eco-send-core";

function base(url: string): string {
	return url.trim().replace(/\/+$/, "");
}

/** Send a thread to Eco: a new chat, or the most recently active one. */
export async function sendThreadToEco(opts: {
	app: App;
	bridgeUrl: string;
	thread: string;
	groups: EcoPostLine[][];
	mode: EcoSendMode;
}): Promise<void> {
	const { app, thread, groups, mode } = opts;
	const url = base(opts.bridgeUrl);
	if (!url) {
		new Notice("Set the bridge URL in Shawn's Toolbox settings first");
		return;
	}
	if (groups.length === 0) {
		new Notice(`#thread/${thread} has no posts to send`);
		return;
	}
	let conversationId: string;
	let title: string | undefined;
	let chatLabel = "a new Eco chat";
	if (mode === "new") {
		conversationId = mintConversationId(Date.now());
		title = newChatTitle(thread);
	} else {
		let rows: ConvRow[] = [];
		try {
			const res = await requestUrl({
				url: `${url}/conversations?filter=active&limit=30`,
				method: "GET",
				throw: false,
			});
			if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
			rows = (res.json?.conversations ?? []) as ConvRow[];
		} catch (err) {
			new Notice(
				`Can't reach Eco at ${url}: ${err instanceof Error ? err.message : String(err)}`
			);
			return;
		}
		const current = pickCurrentConversation(rows);
		if (!current) {
			new Notice("No open Eco chat to add to — use “new Eco chat” instead");
			return;
		}
		const label = current.title?.trim() || "Untitled chat";
		const ok = await confirmSend(
			app,
			`Add #thread/${thread} (${groups.length} ${groups.length === 1 ? "post" : "posts"}) to the Eco chat “${label}”?`,
			"This is your most recently active Eco chat."
		);
		if (!ok) return;
		conversationId = current.id;
		chatLabel = `“${label}”`;
	}
	const text = formatThreadForEco(thread, groups, mode);
	const boundary = `----stx${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
	const { body, contentType } = buildMultipart(
		uploadFields({ id: mintMessageId(Date.now()), text, conversationId, title }),
		boundary
	);
	try {
		const res = await requestUrl({
			url: `${url}/upload`,
			method: "POST",
			contentType,
			body,
			throw: false,
		});
		if (res.status < 200 || res.status >= 300)
			throw new Error(`HTTP ${res.status}${res.text ? ` — ${res.text.slice(0, 120)}` : ""}`);
		new Notice(`Sent #thread/${thread} to ${chatLabel}. Open Eco to continue.`);
	} catch (err) {
		new Notice(
			`Couldn't send to Eco: ${err instanceof Error ? err.message : String(err)}`
		);
	}
}

function confirmSend(app: App, question: string, detail: string): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmSendModal(app, question, detail, resolve).open();
	});
}

class ConfirmSendModal extends Modal {
	private answered = false;
	constructor(
		app: App,
		private question: string,
		private detail: string,
		private done: (ok: boolean) => void
	) {
		super(app);
	}

	private answer(ok: boolean): void {
		if (this.answered) return;
		this.answered = true;
		this.close();
		this.done(ok);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("stx-new-thread");
		contentEl.createEl("p", { text: this.question });
		contentEl.createEl("p", { cls: "stx-replies-detail", text: this.detail });
		const row = contentEl.createDiv({ cls: "stx-thread-reply-row" });
		const send = row.createEl("button", { cls: "mod-cta", text: "Add" });
		send.addEventListener("click", () => this.answer(true));
		const cancel = row.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.answer(false));
		window.setTimeout(() => send.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.answered) {
			this.answered = true;
			this.done(false);
		}
	}
}
