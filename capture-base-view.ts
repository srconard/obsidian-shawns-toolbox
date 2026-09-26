// capture-base-view.ts — the capture surface itself, shared by every place it
// is shown: the main-pane "blank screen" view (capture-view.ts), the
// right-sidebar panel (capture-side-view.ts) and either half of the dual panel
// (dual-view.ts). Nothing but an auto-focused input, the four routing buttons,
// and the just-captured thought strip; sections live in their own view
// (sections-view.ts).
//
// The surfaces differ ONLY in view type, tab title, icon and the extra root
// class that tunes the layout for a narrow panel — every behaviour (routing,
// long-press date bar, Mod+Enter, the recent strip's tag menu) is defined once,
// here. Since v1.39.0 this is a ToolboxPanel (a Component rendering into a
// container it is handed) rather than an ItemView, so a leaf can host two of it.
import { Notice, Platform, Scope, setIcon, normalizePath } from "obsidian";
import type { CaptureKind } from "./section-core";
import {
	CAPTURE_ICONS,
	CAPTURE_LABELS,
	logicalTodayIso,
	nowHm,
	routeCapture,
} from "./capture-service";
import { shiftDateIso } from "./template-renderer";
import { createDateBar, wireLongPress, type DateBar } from "./date-bar";
import type { CardsHost } from "./section-cards";
import { ThreadService } from "./thread-service";
import { summarizeThreads, listRemovableTags } from "./thread-core";
import { menuAreaGroups } from "./thread-tree-core";
import { wireLongPressMenu, showTagMenu, type TagTarget } from "./tag-menu";
import {
	findLastMatching,
	normSpace,
	thoughtHead,
	withTagOnHead,
} from "./capture-recent";
import { ToolboxPanel } from "./panel-base";

/** How many just-captured thoughts stay long-pressable in the recent strip. */
const RECENT_LIMIT = 8;

export abstract class BaseCapturePanel extends ToolboxPanel {
	private inputEl: HTMLTextAreaElement | null = null;
	private submitting = false;
	private dateBar: DateBar | null = null;
	private dateBarKind: CaptureKind | null = null;
	private lastLongPress = 0;
	/** Threads scan / tag-append plumbing, shared with the Threads panel so the
	 *  add-tag menu here is the very same component. */
	private service: ThreadService;
	/** The "just captured" thought strip below the buttons — long-press a card to
	 *  tag the thought (same menu as the Threads panel) without leaving capture. */
	private recentEl: HTMLElement | null = null;

	constructor(host: CardsHost, contentEl: HTMLElement) {
		super(host, contentEl);
		// Mod+Enter = Thought. Registered on the view's keymap scope because
		// Obsidian's keymap claims the combo before a plain DOM listener on
		// the textarea ever sees it.
		this.scope = new Scope(this.app.scope);
		this.scope.register(["Mod"], "Enter", (evt) => {
			evt.preventDefault();
			void this.submit("thought");
			return false;
		});
		this.service = new ThreadService(host.app, host.getSettings);
	}

	/** Extra class on the view's `.view-content` root; "" for the main view. */
	protected variantClass(): string {
		return "";
	}

	/** Focus the input when the surface opens (main pane: yes; panel: no — a
	 *  sidebar panel that steals focus pops the phone keyboard unbidden). */
	protected autoFocus(): boolean {
		return true;
	}

	protected async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("stx-capture-root", "stx-capture-body");
		const variant = this.variantClass();
		if (variant) root.addClass(variant);

		const input = root.createEl("textarea", {
			cls: "stx-capture-input",
			attr: { placeholder: "…" },
		});
		this.inputEl = input;

		this.dateBar = createDateBar(root, {
			confirmLabel: "Add",
			// Long-press means "not today" — default to logical tomorrow.
			getDefaultDate: () =>
				shiftDateIso(logicalTodayIso(this.host.getSettings()), 1),
			onConfirm: () => {
				const date = this.dateBar?.value();
				if (this.dateBarKind && date) {
					void this.submit(this.dateBarKind, date);
				}
			},
		});

		// v1.42.0 (Shawn, 2026-09-13): icon-only buttons, one compact row. The
		// label stays in the DOM (hidden by CSS) and doubles as the aria-label,
		// so hovering on desktop shows what a button is; a long-press flashes the
		// same label on the phone, in addition to the button's long-press action.
		const buttons = root.createDiv("stx-capture-buttons stx-capture-icons");
		const kinds: CaptureKind[] = [
			"thought",
			"doToday",
			"otherTask",
			"log",
		];
		for (const kind of kinds) {
			const label = CAPTURE_LABELS[kind];
			const btn = buttons.createEl("button", {
				cls: "stx-capture-btn stx-capture-" + kind,
				attr: { "aria-label": label, title: label },
			});
			const icon = btn.createSpan("stx-capture-btn-icon");
			setIcon(icon, CAPTURE_ICONS[kind]);
			btn.createSpan({ cls: "stx-capture-btn-label", text: label });
			btn.addEventListener("click", () => {
				// a long-press already handled this gesture
				if (Date.now() - this.lastLongPress < 700) return;
				void this.submit(kind);
			});
			wireLongPress(btn, () => {
				this.lastLongPress = Date.now();
				this.flashLabel(btn, label);
				if (kind === "doToday" || kind === "otherTask") {
					this.dateBarKind = kind;
					this.dateBar?.show(label + " on");
				} else if (kind === "thought") {
					void this.openCaptureTagMenu(btn);
				}
			});
		}

		if (this.host.getSettings().captureLayoutProbe && Platform.isMobile) {
			const probe = buttons.createEl("button", {
				cls: "stx-capture-btn stx-capture-probe",
				attr: { "aria-label": "Layout probe (writes geometry to a note)", title: "Layout probe" },
			});
			const pi = probe.createSpan("stx-capture-btn-icon");
			setIcon(pi, "bug");
			probe.addEventListener("pointerdown", (e) => e.preventDefault()); // keep the keyboard up
			probe.addEventListener("click", () => void this.writeLayoutProbe());
		}

		this.recentEl = root.createDiv("stx-capture-recent");
		this.watchKeyboard(root);

		// Backup DOM path for Mod+Enter (the scope handler above is primary;
		// defaultPrevented guards against double-submit when both fire).
		input.addEventListener("keydown", (e) => {
			if (e.defaultPrevented) return;
			if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
				e.preventDefault();
				void this.submit("thought");
			}
		});
		if (this.autoFocus()) window.setTimeout(() => input.focus(), 0);
	}

	/**
	 * v1.44.0: the phone keyboard as a class. Obsidian publishes
	 * `--keyboard-height` (used by the CSS padding formula), but a build where
	 * that variable stays 0 would leave the safe-area + navbar padding under the
	 * buttons as a dead row with the keyboard up. `visualViewport` shrinks with
	 * the keyboard on Android regardless, so it toggles `stx-kb-open` here and
	 * the CSS zeroes the padding on that class as well.
	 */
	private watchKeyboard(root: HTMLElement): void {
		const vv = window.visualViewport;
		if (!vv || !Platform.isMobile) return;
		const update = () => {
			// Android Obsidian: the app shrinks and `--keyboard-height` is set on
			// the root element, but window.innerHeight and the visual viewport do
			// not change (phone probe, 2026-09-13). Read the variable first.
			const kb = parseFloat(
				getComputedStyle(document.documentElement).getPropertyValue("--keyboard-height")
			);
			const open = (Number.isFinite(kb) && kb > 0) || window.innerHeight - vv.height > 120;
			root.toggleClass("stx-kb-open", open);
			// adjustPan-style layouts leave the view extending under the keyboard:
			// pad the overhang away so the buttons end at the visible bottom.
			const overhang = root.getBoundingClientRect().bottom - (vv.offsetTop + vv.height);
			root.style.setProperty("--stx-kb-overhang", open && overhang > 0 ? `${Math.round(overhang)}px` : "0px");
		};
		this.registerDomEvent(vv as unknown as HTMLElement, "resize", update);
		this.registerDomEvent(vv as unknown as HTMLElement, "scroll", update);
		this.registerDomEvent(window, "resize", update);
		// The leaf resizes when the keyboard shows — but on the way DOWN the
		// resize fires while `--keyboard-height` is still non-zero and the
		// variable is cleared afterwards with no further resize (phone probe
		// 2026-09-13 19:43Z: keyboard 0px, class still set, buttons under the
		// navbar). So: watch the variable itself (Obsidian writes it to the root
		// element's style attribute) and re-check on a short tail after any
		// trigger.
		const settle = () => {
			update();
			for (const ms of [120, 400, 900]) window.setTimeout(update, ms);
		};
		if (typeof ResizeObserver !== "undefined") {
			const ro = new ResizeObserver(settle);
			ro.observe(root);
			this.register(() => ro.disconnect());
		}
		if (typeof MutationObserver !== "undefined") {
			const mo = new MutationObserver(settle);
			mo.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
			mo.observe(document.body, { attributes: true, attributeFilter: ["style", "class"] });
			this.register(() => mo.disconnect());
		}
		this.registerDomEvent(root, "focusin", settle);
		this.registerDomEvent(root, "focusout", settle);
		settle();
	}

	/** Append the live geometry around the buttons to a vault note (phone diagnosis). */
	private async writeLayoutProbe(): Promise<void> {
		const root = this.contentEl;
		const q = (sel: string) => document.querySelector<HTMLElement>(sel);
		const rect = (el: Element | null) => {
			if (!el) return "—";
			const r = el.getBoundingClientRect();
			return `top ${Math.round(r.top)} bottom ${Math.round(r.bottom)} h ${Math.round(r.height)}`;
		};
		const pad = (el: Element | null) => (el ? getComputedStyle(el).paddingBottom : "—");
		const docStyle = getComputedStyle(document.documentElement);
		const bodyStyle = getComputedStyle(document.body);
		const vv = window.visualViewport;
		const lines: string[] = [];
		lines.push(`## ${new Date().toISOString()} — capture layout probe (${this.variantClass() || "main"})`);
		lines.push(`- window.innerHeight ${window.innerHeight} · visualViewport ${vv ? `h ${Math.round(vv.height)} top ${Math.round(vv.offsetTop)}` : "n/a"} · classes ${root.className}`);
		lines.push(`- --keyboard-height ${docStyle.getPropertyValue("--keyboard-height") || "(unset)"} · --safe-area-inset-bottom ${bodyStyle.getPropertyValue("--safe-area-inset-bottom")} · --mobile-toolbar-height ${bodyStyle.getPropertyValue("--mobile-toolbar-height")} · body ${document.body.className}`);
		lines.push(`- root .view-content: ${rect(root)} · padding-bottom ${pad(root)} · overhang var ${root.style.getPropertyValue("--stx-kb-overhang")}`);
		lines.push(`- buttons: ${rect(root.querySelector(".stx-capture-buttons"))} · input: ${rect(root.querySelector(".stx-capture-input"))}`);
		let el: HTMLElement | null = root.parentElement;
		while (el && el !== document.body) {
			const cls = el.className.toString().split(" ").slice(0, 3).join(".");
			lines.push(`- ancestor ${el.tagName.toLowerCase()}.${cls}: ${rect(el)} · padding-bottom ${pad(el)} · height ${getComputedStyle(el).height}`);
			el = el.parentElement;
		}
		for (const sel of [".mobile-navbar", ".mobile-toolbar", ".mobile-toolbar-spacer", ".mobile-toolbar-options-container"]) {
			const e = q(sel);
			lines.push(`- ${sel}: ${e ? `${rect(e)} · display ${getComputedStyle(e).display} · parent ${e.parentElement?.className.toString().slice(0, 40)} · options ${e.querySelectorAll(".mobile-toolbar-option").length}` : "absent"}`);
		}
		const path = normalizePath("AGENTS/inbox/capture-layout-probe.md");
		const text = lines.join("\n") + "\n\n";
		try {
			const existing = this.app.vault.getFileByPath(path);
			if (existing) await this.app.vault.append(existing, text);
			else await this.app.vault.create(path, `# Capture layout probe\n\n${text}`);
			new Notice("Layout probe written → AGENTS/inbox/capture-layout-probe.md");
		} catch (e) {
			new Notice(`Probe failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private hideDateBar(): void {
		this.dateBar?.hide();
		this.dateBarKind = null;
	}

	private async submit(
		kind: CaptureKind,
		dateIso?: string,
		tag?: string
	): Promise<void> {
		if (!this.inputEl || this.submitting) return;
		const raw = this.inputEl.value;
		if (!raw.trim()) return;
		// A cadence/thread tag picked from the Thought long-press menu rides on
		// the head line, so the thought lands already tagged (no second write).
		const text = tag ? withTagOnHead(raw, tag) : raw;
		this.submitting = true;
		try {
			const target = await routeCapture(
				this.app,
				this.host.getSettings(),
				kind,
				text,
				dateIso
			);
			// Only clear after the write succeeded — never lose input.
			this.inputEl.value = "";
			this.inputEl.focus();
			// A just-captured thought becomes a long-pressable card so it can be
			// tagged in the moment (same menu as the Threads panel). Tasks/logs
			// aren't thoughts, so they don't join the strip.
			if (kind === "thought") this.addRecentThought(text);
			const when =
				dateIso && dateIso !== logicalTodayIso(this.host.getSettings())
					? dateIso
					: nowHm();
			new Notice(tag ? `→ ${target} ${when} · ${tag}` : `→ ${target} ${when}`);
			this.hideDateBar();
		} catch (e) {
			new Notice(
				`Capture failed: ${e instanceof Error ? e.message : String(e)}`
			);
		} finally {
			this.submitting = false;
		}
	}

	/**
	 * Show a button's name for a moment (phone: there is no hover). A small tip
	 * element inside the button, removed after ~1.2 s; a second flash on the same
	 * button replaces the first.
	 */
	private flashLabel(btn: HTMLElement, label: string): void {
		btn.querySelector(".stx-capture-btn-tip")?.remove();
		const tip = btn.createSpan({ cls: "stx-capture-btn-tip", text: label });
		window.setTimeout(() => tip.remove(), 1200);
	}

	/**
	 * Long-press Thought (v1.42.0, Shawn: "if I do a long press I can add a
	 * periodic tag like #thought/quarterly"): the same cadence + thread menu the
	 * Threads panel and the recent strip use, but the pick CAPTURES — the text in
	 * the box is routed as a thought with the tag already on its head line. With
	 * nothing typed there is nothing to tag, so the menu is not shown.
	 */
	private async openCaptureTagMenu(btn: HTMLElement): Promise<void> {
		if (!this.inputEl?.value.trim()) {
			new Notice("Type a thought first, then long-press to tag it");
			return;
		}
		const rect = btn.getBoundingClientRect();
		const groups = await this.threadGroups();
		if (!this.inputEl?.value.trim()) return;
		showTagMenu({
			app: this.app,
			groups,
			x: rect.left + rect.width / 2,
			y: rect.top,
			title: "Thought · tag as",
			onApplyTag: (tag) => void this.submit("thought", undefined, tag),
		});
	}

	/**
	 * Add a just-captured thought to the recent strip as a long-pressable card
	 * (newest on top, capped at RECENT_LIMIT). The card holds only the thought's
	 * head line; the live post is re-resolved from today's note when the tag menu
	 * opens, so a shifted line number never leaves a stale target behind.
	 */
	private addRecentThought(text: string): void {
		if (!this.recentEl) return;
		const head = thoughtHead(text);
		if (!head) return;
		const card = this.recentEl.createDiv("stx-capture-recent-card");
		card.setText(head);
		this.recentEl.prepend(card);
		while (this.recentEl.childElementCount > RECENT_LIMIT) {
			this.recentEl.lastElementChild?.remove();
		}
		wireLongPressMenu(card, (x, y, onHide) =>
			void this.openThoughtTagMenu(head, x, y, onHide)
		);
	}

	/** Resolve the card's thought to a live post, then show the shared tag menu. */
	private async openThoughtTagMenu(
		head: string,
		x: number,
		y: number,
		onHide: () => void
	): Promise<void> {
		const target = await this.resolveThoughtTarget(head);
		if (!target) {
			new Notice("Couldn't find that thought to tag");
			onHide();
			return;
		}
		const groups = await this.threadGroups();
		showTagMenu({
			app: this.app,
			groups,
			x,
			y,
			onApplyTag: (tag) => void this.applyTag(target, tag),
			existingTags: listRemovableTags(target.raw),
			onRemoveTag: (tag) => void this.removeTag(target, tag),
			onHide,
		});
	}

	/** Find today's thought whose display text matches the card's head (last wins). */
	private async resolveThoughtTarget(head: string): Promise<TagTarget | null> {
		const posts = await this.service.todayThoughtPosts();
		const i = findLastMatching(
			posts.map((p) => normSpace(p.text)),
			head
		);
		if (i < 0) return null;
		const p = posts[i];
		return { path: p.path, note: p.note, line: p.line, raw: p.raw };
	}

	/** The existing threads grouped by area — same grouping the Threads panel uses. */
	private async threadGroups() {
		const { posts } = await this.service.scanAll();
		const areas = await this.service.loadThreadAreas();
		const pinned = this.host.getSettings().pinnedThreads ?? [];
		return menuAreaGroups(summarizeThreads(posts), areas, pinned);
	}

	/** Remove a (confirmed) tag from the thought's own line; replies untouched. */
	private async removeTag(target: TagTarget, tag: string): Promise<void> {
		try {
			const changed = await this.service.removeTagFromPost(target, tag);
			new Notice(changed ? `Removed ${tag}` : `${tag} was no longer on that post`);
		} catch (err) {
			new Notice(err instanceof Error ? err.message : String(err));
		}
	}

	private async applyTag(target: TagTarget, tag: string): Promise<void> {
		try {
			const changed = await this.service.appendTagToPost(target, tag);
			new Notice(changed ? `Added ${tag}` : `${tag} already on that post`);
		} catch (err) {
			new Notice(err instanceof Error ? err.message : String(err));
		}
	}
}
