# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Shawn's Toolbox** is an Obsidian plugin that provides productivity tools for note-taking. Currently implements checkbox completion stamping.

## Development Commands

```bash
npm install     # Install dependencies
npm run build   # Production build
npm run dev     # Watch mode with hot reload
npm run lint    # Run ESLint
```

## Project Structure

| File | Purpose |
|------|---------|
| `main.ts` | Plugin entry point, extends `Plugin` class |
| `settings.ts` | Settings interface and PluginSettingTab |
| `checkbox-handler.ts` | Checkbox detection and stamping logic |
| `manifest.json` | Plugin metadata (id, name, version) |
| `styles.css` | Plugin styles (placeholder) |
| `esbuild.config.mjs` | Build configuration |

## Current Features

### Checkbox Completion Stamping
- Appends `✅ YYYY-MM-DD` (optionally with `HH:MM`) when a checkbox is checked
- Configurable exclusion patterns (default: `#task`)
- Settings: `checkboxStampingEnabled`, `includeTime`, `excludePatterns`

## Obsidian Plugin Development Notes

- Plugin must export a default class extending `Plugin` from 'obsidian'
- Use `this.app` to access the Obsidian API
- Register events with `this.registerEvent()`
- Add settings with `this.addSettingTab()`
- Clean up resources in `onunload()`
- Use `this.loadData()` / `this.saveData()` for persistent settings

## Adding New Features

1. Create a handler file (e.g., `new-feature-handler.ts`)
2. Add settings to `ShawnsToolboxSettings` interface in `settings.ts`
3. Add UI controls in `ShawnsToolboxSettingTab.display()`
4. Initialize handler in `main.ts` `onload()`
5. Update README.md with documentation
