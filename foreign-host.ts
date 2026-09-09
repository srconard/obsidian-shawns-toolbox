// foreign-host.ts — mounting ANY registered Obsidian view inside a dual-panel
// half (v1.40.0). The pure "which views, called what" half is foreign-core.ts.
//
// HOW IT WORKS. Obsidian views are built by leaves, and a leaf's DOM
// (`leaf.containerEl`) is an ordinary element — so a view can be hosted anywhere
// by creating a leaf that is NOT part of the workspace tree, giving it a view
// state, and re-parenting its container into our own element:
//
//     const leaf = new (WorkspaceLeaf as any)(app);      // detached: no parent
//     await leaf.setViewState({ type, active: false });  // builds the view
//     half.appendChild(leaf.containerEl);                // host it
//     leaf.view.onResize?.();                            // let it lay out
//
// This is the technique the sidebar-embedding plugins use (Hover Editor builds
// its own detached `WorkspaceSplit` and creates leaves inside it). Measured live
// in the NAS Obsidian (1.13.x): the constructor takes the app, `setViewState`
// resolves with a real view, the container renders, and — crucially —
// `workspace.iterateAllLeaves()` never sees the leaf and `workspace.getLayout()`
// never serialises it, so hosting a view cannot leave ghost leaves in the saved
// layout. `leaf.detach()` on unload disposes the view.
//
// WHAT WE DO NOT DO. We do not call `workspace.createLeafInParent(rootSplit, …)`
// on the real workspace — that leaf WOULD be in the tree and would be restored
// on the next launch as an orphan tab. The fallback path below builds its own
// detached split for exactly that reason.
import { App, WorkspaceLeaf, setIcon } from "obsidian";
import { viewIcon, viewLabel } from "./foreign-core";

/** Whether this Obsidian has a view creator registered for `type`. */
export function viewTypeAvailable(app: App, type: string): boolean {
	const reg = registry(app);
	if (!reg) return false;
	if (typeof reg.getViewCreatorByType === "function") {
		try {
			return !!reg.getViewCreatorByType(type);
		} catch {
			/* fall through to the map */
		}
	}
	return !!reg.viewByType?.[type];
}

/** Every view type this Obsidian currently knows how to build. */
export function registeredViewTypes(app: App): string[] {
	const reg = registry(app);
	const byType = reg?.viewByType;
	if (!byType || typeof byType !== "object") return [];
	return Object.keys(byType);
}

/**
 * `containerEl` is the element a leaf renders into. It is real on every leaf but
 * is not in the public typings (it is not part of the documented plugin API), so
 * the one property we depend on is declared here rather than casting at each use.
 */
export type HostableLeaf = WorkspaceLeaf & { containerEl: HTMLElement };

/* eslint-disable @typescript-eslint/no-explicit-any */
interface ViewRegistryLike {
	viewByType?: Record<string, unknown>;
	getViewCreatorByType?: (type: string) => unknown;
}

function registry(app: App): ViewRegistryLike | null {
	const reg = (app as any)?.viewRegistry;
	return reg && typeof reg === "object" ? (reg as ViewRegistryLike) : null;
}

/**
 * A leaf with no place in the workspace. Primary path is the constructor, which
 * is what every embedding plugin uses and what was measured working here; the
 * fallback builds a detached `WorkspaceSplit` and asks the workspace to create a
 * leaf inside it, for an Obsidian where the constructor is not callable.
 */
function createDetachedLeaf(app: App): HostableLeaf | null {
	try {
		const leaf = new (WorkspaceLeaf as any)(app);
		if (leaf && typeof leaf.setViewState === "function" && leaf.containerEl) {
			return leaf as HostableLeaf;
		}
	} catch {
		/* try the split fallback */
	}
	try {
		const ws = app.workspace as any;
		const SplitCtor = ws?.rootSplit?.constructor;
		if (!SplitCtor || typeof ws.createLeafInParent !== "function") return null;
		const split = new SplitCtor(ws, "vertical");
		const leaf = ws.createLeafInParent(split, 0);
		if (leaf && typeof leaf.setViewState === "function" && leaf.containerEl) {
			return leaf as HostableLeaf;
		}
	} catch {
		/* no host available */
	}
	return null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * One hosted Obsidian view living inside a dual-panel half.
 *
 * The slot owns the leaf it creates and is responsible for disposing it: every
 * exit path (unavailable type, failed mount, half switched, view closed) ends in
 * `dispose()`, because a leaf that is never detached keeps its view loaded and
 * its event handlers live for the rest of the session.
 */
export class HostedViewSlot {
	private leaf: HostableLeaf | null = null;

	constructor(
		private app: App,
		private container: HTMLElement,
		private type: string
	) {}

	/** Build the view and host it. Returns false when a placeholder was shown. */
	async mount(): Promise<boolean> {
		this.container.addClass("stx-dual-foreign");
		if (!viewTypeAvailable(this.app, this.type)) {
			this.renderPlaceholder(
				`${viewLabel(this.type)} isn't available`,
				"The plugin that provides this view is not installed or not enabled."
			);
			return false;
		}
		const leaf = createDetachedLeaf(this.app);
		if (!leaf) {
			this.renderPlaceholder(
				`Can't host ${viewLabel(this.type)}`,
				"This Obsidian build doesn't allow a view to be hosted outside the workspace."
			);
			return false;
		}
		this.leaf = leaf;
		try {
			await leaf.setViewState({ type: this.type, active: false });
		} catch (e) {
			console.error("Shawn's Toolbox: hosting view failed", this.type, e);
			this.dispose();
			this.renderPlaceholder(
				`${viewLabel(this.type)} failed to open`,
				e instanceof Error ? e.message : String(e)
			);
			return false;
		}
		// A view type can be registered and still refuse to build (a plugin
		// mid-unload); `setViewState` then leaves an `empty` view behind.
		if (!leaf.view || leaf.view.getViewType?.() !== this.type) {
			this.dispose();
			this.renderPlaceholder(
				`${viewLabel(this.type)} didn't open`,
				"Obsidian built an empty view for this type."
			);
			return false;
		}
		this.container.empty();
		this.container.appendChild(leaf.containerEl);
		this.resize();
		return true;
	}

	/**
	 * Views lay themselves out from the size of their container, and a hosted
	 * one never receives Obsidian's own resize notifications — so the dual view
	 * forwards them here whenever the divider moves or the leaf is resized.
	 */
	resize(): void {
		const view = this.leaf?.view as { onResize?: () => void } | undefined;
		try {
			view?.onResize?.();
		} catch (e) {
			console.error("Shawn's Toolbox: hosted view resize failed", this.type, e);
		}
	}

	/**
	 * Whether a real view is mounted (as opposed to a placeholder). The dual view
	 * compares this against `viewTypeAvailable` to notice a plugin being enabled
	 * or disabled while the half is on screen.
	 */
	isLive(): boolean {
		return this.leaf !== null;
	}

	/** Detach the leaf and drop its DOM. Safe to call more than once. */
	dispose(): void {
		const leaf = this.leaf;
		this.leaf = null;
		if (!leaf) return;
		try {
			// Disposes the view (unloads its components and event refs). The leaf
			// has no parent, so this is the whole teardown.
			leaf.detach();
		} catch (e) {
			console.error("Shawn's Toolbox: detaching hosted view failed", this.type, e);
		}
		try {
			leaf.containerEl?.detach();
		} catch {
			/* already gone */
		}
	}

	private renderPlaceholder(title: string, detail: string): void {
		this.container.empty();
		const box = this.container.createDiv("stx-dual-missing");
		const icon = box.createDiv("stx-dual-missing-icon");
		setIcon(icon, viewIcon(this.type));
		box.createDiv({ cls: "stx-dual-missing-title", text: title });
		box.createDiv({ cls: "stx-dual-missing-detail", text: detail });
		box.createDiv({
			cls: "stx-dual-missing-type",
			text: this.type,
		});
	}
}
