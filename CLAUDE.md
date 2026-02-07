# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Obsidian plugin development sandbox. Obsidian plugins are written in TypeScript and bundled for the Obsidian desktop app.

## Development Setup

Obsidian plugins typically use:
- **Build**: `npm run build` (esbuild or rollup)
- **Dev mode**: `npm run dev` (watch mode with hot reload)
- **Lint**: `npm run lint` (ESLint)

## Key Files (Standard Obsidian Plugin Structure)

- `main.ts` - Plugin entry point, extends `Plugin` class
- `manifest.json` - Plugin metadata (id, name, version, minAppVersion)
- `styles.css` - Optional plugin styles
- `esbuild.config.mjs` or `rollup.config.js` - Build configuration

## Obsidian Plugin Development Notes

- Plugin must export a default class extending `Plugin` from 'obsidian'
- Use `this.app` to access the Obsidian API
- Register commands with `this.addCommand()`
- Add settings with `this.addSettingTab()`
- Clean up resources in `onunload()`
