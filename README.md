# Shawn's Toolbox

An Obsidian plugin with productivity tools to enhance your note-taking workflow.

## Features

### Checkbox Completion Stamping

Automatically adds a checkmark emoji and completion date when you check a checkbox.

**Before:**
```markdown
- [ ] Buy groceries
```

**After:**
```markdown
- [x] Buy groceries ✅ 2026-02-07
```

**With time enabled:**
```markdown
- [x] Buy groceries ✅ 2026-02-07 14:30
```

#### Supported Formats

- Dash lists: `- [x]`
- Asterisk lists: `* [x]`
- Plus lists: `+ [x]`
- Numbered lists: `1. [x]`, `2) [x]`

#### Exclusion Patterns

You can exclude certain lines from being stamped by adding patterns in the settings. Any line containing an exclusion pattern will be skipped.

**Default exclusion:** `#task`

This is useful for task management plugins that use specific tags (like Tasks plugin with `#task`).

**Example:**
```markdown
- [x] Regular item ✅ 2026-02-07
- [x] Task item #task              (no stamp added)
```

## Installation

### Manual Installation

1. Download the latest release from the [Releases page](https://github.com/srconard/obsidian-shawns-toolbox/releases)
2. Extract the files to your vault's `.obsidian/plugins/shawns-toolbox/` folder
3. Reload Obsidian
4. Enable the plugin in Settings > Community Plugins

### From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/srconard/obsidian-shawns-toolbox.git
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the plugin:
   ```bash
   npm run build
   ```
4. Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/shawns-toolbox/` folder

## Settings

Access settings via **Settings > Shawn's Toolbox**

| Setting | Description | Default |
|---------|-------------|---------|
| Enable checkbox stamping | Toggle the feature on/off | On |
| Include time | Add completion time alongside the date | Off |
| Exclusion patterns | Lines containing these patterns won't be stamped | `#task` |

## Development

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Development mode (watch for changes)
npm run dev
```

## License

MIT
