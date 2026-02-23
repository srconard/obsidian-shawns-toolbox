# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also the root vault `CLAUDE.md` for workspace-level context, build commands, and architecture overview.

## Plugin-Specific Notes

- **Checkbox regex patterns** in `checkbox-handler.ts` support `-`, `*`, `+`, and numbered (`1.` / `1)`) list markers with arbitrary indentation
- **Two CodeMirror extensions** — a `ViewPlugin` handles live preview clicks via `posAtDOM()`, an `updateListener` handles keyboard toggles. Both use deferred `setTimeout` dispatches to avoid racing with Obsidian's own checkbox handling
- **Exclusion patterns** are plain substring matches against the full line text (not regex)
- The `dateFormat` setting exists in the interface but only `"YYYY-MM-DD"` is currently implemented in `formatDate()`
- `styles.css` is a placeholder — no custom styles yet
- `manifest.json` `minAppVersion` is `0.15.0`; keep this in sync if using newer Obsidian APIs
