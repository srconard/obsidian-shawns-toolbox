// link-clicks.ts — make links inside MarkdownRenderer output open correctly
// from a custom view.
//
// MarkdownRenderer.render emits an internal wikilink as
// <a class="internal-link" data-href="Some Note" href="Some Note">, whose href
// is the raw linktext, not a URL. In Obsidian's own reading pane a delegated
// handler catches these; inside a plugin's ItemView / injected DOM nothing
// does, so a click falls through to native anchor navigation — and on mobile
// that reloads the whole webview (the full-app "reload" Shawn hit tapping a
// link in the Guiding Questions panel). Delegate one click handler on the
// rendered container that routes anchors instead: internal links through
// workspace.openLinkText (resolves relative to the source note), external
// links to the system browser.
import { App } from "obsidian";

/**
 * Wire link handling on a container holding MarkdownRenderer output. Safe to
 * attach once per container element — delegation catches anchors added later.
 * Attach to a freshly created element so the listener is released with it.
 */
export function wireLinkClicks(
	app: App,
	container: HTMLElement,
	sourcePath: string
): void {
	container.addEventListener("click", (evt) => {
		const anchor = (evt.target as HTMLElement).closest("a");
		if (!anchor || !container.contains(anchor)) return;
		const href =
			anchor.getAttribute("data-href") ?? anchor.getAttribute("href");
		if (!href) return;
		if (anchor.classList.contains("internal-link")) {
			evt.preventDefault();
			void app.workspace.openLinkText(
				href,
				sourcePath,
				evt.ctrlKey || evt.metaKey
			);
		} else if (
			anchor.classList.contains("external-link") ||
			/^[a-z][a-z0-9+.-]*:\/\//i.test(href)
		) {
			evt.preventDefault();
			window.open(href, "_blank");
		}
	});
}
