# ccext - Open Source Claude Code Browser Extension

An open-source Chrome extension that enables browser automation from Claude Code CLI. This is an alternative implementation compatible with the official Claude Code CLI's browser control features.

## Features

- **Tab Group Management** - Configurable group name and color
- **Page Reading** - DOM access and accessibility tree extraction
- **Computer Actions** - Mouse clicks, keyboard input, screenshots
- **Form Input** - Automated form filling
- **Visual Indicator** - Shows colored border when Claude is controlling the browser
- **GIF Recording** - Record browser automation sessions
- **Debug Tools** - Console message and network request monitoring

## Installation

### Step 1: Load the Extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `ccext` folder
5. Copy the **Extension ID** (e.g., `abcdefghijklmnopqrstuvwxyz123456`)

### Step 2: Run Install Script

```bash
./scripts/install-native-host.sh <your-extension-id>
```

This script adds your extension ID to the Native Host configuration.

### Step 3: Patch Claude Code CLI

**This step is required** because Claude Code CLI overwrites the Native Host config on startup, removing third-party extension IDs.

---

## CLI Patching Guide

### The Problem

When Claude Code CLI starts, it writes the Native Host configuration file with only the official extension ID in `allowed_origins`. This prevents third-party extensions like ccext from connecting.

### Finding cli.js

```bash
# Find Claude Code CLI location
which claude

# Follow the symlink to find the actual installation
# cli.js is usually in the same directory
ls -la $(dirname $(readlink -f $(which claude)))
```

Common locations:
- `~/.claude/local/cli.js`
- `~/.nvm/versions/node/*/lib/node_modules/@anthropic-ai/claude-code/cli.js`

### Finding the Patch Location

Since cli.js is minified and function names are obfuscated (they change between versions), search using these **stable keywords**:

```bash
# Search for the Native Host config location
grep -n "Claude Code Browser Extension Native Host" /path/to/cli.js
```

This will show you the line number where the config object is defined.

### What You'll Find (BEFORE Patch)

Look for a pattern like this (variable names will differ):

```javascript
G = {
    name: SOME_VAR,
    description: "Claude Code Browser Extension Native Host",
    path: A,
    type: "stdio",
    allowed_origins: ["chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/"]
},
```

### How to Patch (AFTER)

Add code to read and merge existing origins:

```javascript
// Add these lines BEFORE the config object definition:
existingOrigins = [];
try {
    let existingConfig = JSON.parse(await READ_FILE_FUNC(CONFIG_PATH_VAR, "utf-8"));
    existingOrigins = existingConfig.allowed_origins || [];
} catch {}
let mergedOrigins = [...new Set(["chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/", ...existingOrigins])],

// Modify the config object to use mergedOrigins:
G = {
    name: SOME_VAR,
    description: "Claude Code Browser Extension Native Host",
    path: A,
    type: "stdio",
    allowed_origins: mergedOrigins  // Changed from hardcoded array
},
```

### Finding Function and Variable Names

To identify the correct names in your version:

1. **`READ_FILE_FUNC`** - Search for `"utf-8"` near file reading operations. Common names: `ee2`, `readFile`, `fs.readFile`

2. **`CONFIG_PATH_VAR`** - This is the variable defined right before the config object (usually `B` or similar). It contains the path to the Native Host config file.

### Example (Actual Patched Code)

Here's a real example from one version:

```javascript
async function re2(A) {
    let Q = p07();
    if (!Q) throw Error("Claude in Chrome Native Host not supported on this platform");
    let B = x$(Q, d07),
        existingOrigins = [];
    try {
        let existingConfig = JSON.parse(await ee2(B, "utf-8"));
        existingOrigins = existingConfig.allowed_origins || [];
    } catch {}
    let mergedOrigins = [...new Set(["chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/", ...existingOrigins])],
        G = {
            name: JV1,
            description: "Claude Code Browser Extension Native Host",
            path: A,
            type: "stdio",
            allowed_origins: mergedOrigins
        },
    // ... rest of function
}
```

### Verification

After patching, restart Claude Code CLI and verify:

**macOS:**
```bash
cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_code_browser_extension.json
```

**Linux:**
```bash
cat ~/.config/google-chrome/NativeMessagingHosts/com.anthropic.claude_code_browser_extension.json
```

The `allowed_origins` array should contain both:
- `chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/` (official)
- `chrome-extension://<your-ccext-id>/` (your extension)

---

## Configuration

Open the extension options page (right-click extension icon → Options):

### General Settings
- **Tab Group Name** - Name displayed on the browser tab group (default: "Facai")
- **Tab Group Color** - Color of the tab group

### Visual Indicator
- **Show Visual Indicator** - Display a colored border when Claude is controlling the browser
- **Indicator Color** - Color of the visual indicator border

### Permissions
- Various settings for click, form, download, and navigation approvals

---

## Troubleshooting

### "Not Connected" in Settings

1. Check if Native Host config exists and contains your extension ID
2. Verify Claude Code CLI is running
3. Try reloading the extension

### "No such tool available" Error

1. Reload the extension in `chrome://extensions`
2. Restart Claude Code CLI
3. Check the extension's Service Worker console for errors

### Extension Not Detected by CLI

Run the install script again:
```bash
./scripts/install-native-host.sh <your-extension-id>
```

Then restart Chrome completely (quit all instances) and restart Claude Code CLI.

---

## License

Open source. See LICENSE file for details.
