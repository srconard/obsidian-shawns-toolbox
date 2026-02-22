# Shawn's Toolbox

An Obsidian plugin with productivity tools to enhance your note-taking workflow.

## Features

### Checkbox Completion Stamping

Automatically adds a checkmark emoji and completion date when you check a checkbox. This helps you track when tasks were completed without manual effort. Unchecking a box automatically removes the stamp.

#### How It Works

When you check a checkbox, the plugin automatically appends a completion stamp. When you uncheck it, the stamp is removed:

| Action | Before | After |
|--------|--------|-------|
| Check | `- [ ] Buy groceries` | `- [x] Buy groceries ✅ 2026-02-07` |
| Check (with time) | `- [ ] Call mom` | `- [x] Call mom ✅ 2026-02-07 14:30` |
| Uncheck | `- [x] Buy groceries ✅ 2026-02-07` | `- [ ] Buy groceries` |

#### Supported Checkbox Formats

The plugin recognizes checkboxes in all common markdown list formats:

| Format | Example |
|--------|---------|
| Dash lists | `- [x] Task` |
| Asterisk lists | `* [x] Task` |
| Plus lists | `+ [x] Task` |
| Numbered lists | `1. [x] Task` or `1) [x] Task` |

#### Exclusion Patterns

Some tasks shouldn't receive a completion stamp—for example, tasks managed by other plugins like [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) or [Dataview](https://github.com/blacksmithgu/obsidian-dataview).

You can configure exclusion patterns in the settings. Any line containing an exclusion pattern will be skipped.

**Default exclusion:** `#task`

**Example:**
```markdown
- [x] Regular item ✅ 2026-02-07      <- stamped
- [x] Managed task #task               <- not stamped (excluded)
- [x] Recurring item #recurring        <- not stamped (if #recurring is added to exclusions)
```

## Installation

### Manual Installation

1. Download the latest release from the [Releases page](https://github.com/srconard/obsidian-shawns-toolbox/releases)
2. Extract the ZIP file
3. Copy the `shawns-toolbox` folder to your vault's `.obsidian/plugins/` directory
4. Reload Obsidian (Ctrl/Cmd + R)
5. Go to **Settings > Community Plugins** and enable "Shawn's Toolbox"

### Building from Source

```bash
# Clone the repository
git clone https://github.com/srconard/obsidian-shawns-toolbox.git
cd obsidian-shawns-toolbox

# Install dependencies
npm install

# Build the plugin
npm run build

# For development with hot reload
npm run dev
```

After building, copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/shawns-toolbox/` folder.

## Settings

Access plugin settings via **Settings > Shawn's Toolbox**

### Checkbox Completion Stamping

| Setting | Description | Default |
|---------|-------------|---------|
| **Enable checkbox stamping** | Master toggle to turn the feature on or off | On |
| **Include time** | Add the completion time (HH:MM) alongside the date | Off |
| **Exclusion patterns** | Lines containing these patterns won't receive a stamp. Enter one pattern per line. | `#task` |

## Compatibility

- **Minimum Obsidian version:** 0.15.0
- **Platforms:** Windows, macOS, Linux, iOS, Android

## Changelog

### 1.1.0
- Unchecking a checkbox now automatically removes the completion stamp

### 1.0.0
- Initial release
- Checkbox completion stamping feature
- Configurable exclusion patterns
- Optional time stamping

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests on [GitHub](https://github.com/srconard/obsidian-shawns-toolbox).

## License

MIT License - see [LICENSE](LICENSE) for details.
