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

## Block Summarizer

- **`block-summarizer.ts`** — LLM-powered feature that summarizes a bullet block or paragraph into a short bolded title phrase
- Uses **Gemini 2.5 Flash** by default via the REST API (`generativelanguage.googleapis.com`); model is configurable in settings
- API calls use Obsidian's built-in `requestUrl` (works on all platforms, avoids CORS)
- **Thinking is disabled** via `thinkingConfig: { thinkingBudget: 0 }` for speed — Gemini 2.5 Flash is a thinking model but we only need a short phrase
- **Response parsing** searches backward through `candidates[0].content.parts` for the last part with a `text` field, since thinking models may prepend thought parts
- **Two block types**: `extractBulletBlock()` for bullet lines (parent + indented children), `extractParagraphBlock()` for contiguous non-blank/non-bullet lines. Unified via `extractBlock()` which tries bullet first, falls back to paragraph
- **Insert position logic** uses `LINE_PREFIX_REGEX` for bullets (skips marker, checkbox, date, time) and `PLAIN_LINE_PREFIX_REGEX` for paragraphs (skips date, time only)
- **Idempotent**: re-running the command replaces an existing `**bold summary**` via `EXISTING_SUMMARY_REGEX` detection
- Child bullets / paragraph continuation lines provide context to the LLM but are not modified
- The API key is stored in plugin settings (`data.json`) and masked in the settings UI via `type="password"`
- `data.json` is gitignored to prevent accidental API key leaks
