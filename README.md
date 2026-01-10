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

## Quick Start

### Step 1: Load the Extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `ccext` folder
5. **Copy the Extension ID** (32 lowercase letters, e.g., `cbakplgmjcmedeaiomeiapkhobkhgjhc`)

### Step 2: Patch Claude Code CLI

Run the patch script to configure the CLI for ccext:

```bash
cd ccext
./scripts/patch-cli.sh <your-extension-id>
```

Example:
```bash
./scripts/patch-cli.sh cbakplgmjcmedeaiomeiapkhobkhgjhc
```

The script will:
- Auto-detect your Claude CLI installation
- Create a backup of cli.js
- Add your extension ID to allowed_origins
- Add your extension ID to detection array
- Create Chrome extension directory symlink

### Step 3: Restart Everything

1. **Quit Chrome completely** (ensure no background processes)
2. **Restart Chrome**
3. **Start Claude Code** with browser support:
   ```bash
   claude --chrome
   ```

## Verification

After setup, verify the connection:

1. Open Chrome DevTools → Application → Service Workers
2. Look for the ccext service worker
3. Check console for: `[SW] Native host connection verified`

In Claude CLI:
```bash
claude --chrome
> Open Twitter and summarize what's new
```

If browser tools work, setup is complete!

---

## Manual CLI Patching (Alternative)

If the automatic patch script doesn't work, you can patch manually.

### Finding cli.js

```bash
# Find Claude command location
which claude

# Follow symlink to find cli.js
ls -la $(dirname $(readlink -f $(which claude)))
```

Common locations:
- `~/.claude/local/cli.js`
- `~/.nvm/versions/node/*/lib/node_modules/@anthropic-ai/claude-code/cli.js`

### Patch 1: allowed_origins

Search for the Native Host config:
```bash
grep -n "Claude Code Browser Extension Native Host" /path/to/cli.js
```

Find the `allowed_origins` array and add your extension ID:

**Before:**
```javascript
allowed_origins: ["chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/"]
```

**After:**
```javascript
allowed_origins: ["chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/", "chrome-extension://YOUR_ID_HERE/"]
```

### Patch 2: Extension Detection

Search for extension detection:
```bash
grep -n "Extension not found in any profile" /path/to/cli.js
```

Find the array above this line (contains 32-letter IDs) and add your ID:

**Before:**
```javascript
let G = ["fcoeoabgfenejglbffodgkkbkcdhcgfn"];
```

**After:**
```javascript
let G = ["fcoeoabgfenejglbffodgkkbkcdhcgfn", "YOUR_ID_HERE"];
```

### Patch 3: Chrome Extension Directory

Create a symlink in Chrome's Extensions directory:

```bash
# Find your Chrome profile's Extensions directory
CHROME_EXT_DIR="$HOME/Library/Application Support/Google/Chrome/Default/Extensions"

# Create symlink pointing to ccext source
ln -s /path/to/ccext "$CHROME_EXT_DIR/YOUR_EXTENSION_ID"
```

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

### "Chrome extension not connected" Error

This usually means the communication chain is broken. Check each component:

1. **Check Native Host config contains your ID:**
   ```bash
   # macOS
   cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_code_browser_extension.json

   # Linux
   cat ~/.config/google-chrome/NativeMessagingHosts/com.anthropic.claude_code_browser_extension.json
   ```

2. **Verify no conflicting processes:**
   ```bash
   ps aux | grep claude-in-chrome-mcp
   ps aux | grep chrome-native-host
   ```
   Kill any stale processes:
   ```bash
   pkill -f "claude-in-chrome-mcp"
   pkill -f "chrome-native-host"
   ```

3. **Check socket exists:**
   ```bash
   ls -la $(node -e "console.log(require('os').tmpdir() + '/claude-mcp-browser-bridge-' + require('os').userInfo().username)")
   ```

4. **Restart everything:**
   - Quit Chrome completely
   - Kill all Claude processes
   - Restart Chrome
   - Run `claude --chrome`

### "Not Connected" in Extension Settings

1. Reload the extension in `chrome://extensions`
2. Verify Claude Code CLI is running with `--chrome` flag
3. Check the Service Worker console for errors

### Extension Not Detected by CLI

Re-run the patch script:
```bash
./scripts/patch-cli.sh <your-extension-id>
```

Then restart Chrome and CLI.

### Browser Tools Timeout

If tools timeout or don't respond:

1. The Chrome Service Worker may have been suspended
2. Try reloading the extension
3. Make sure the extension's Service Worker is active (check in DevTools)

---

## Architecture

Understanding the communication flow helps with debugging:

```
Claude Code CLI
    │
    ├─► spawns MCP server subprocess (--claude-in-chrome-mcp)
    │         │
    │         └─► connects via Unix socket
    │                    │
    ▼                    ▼
Native Host ◄──── Socket Server
    │
    └─► Chrome Native Messaging (stdin/stdout)
               │
               ▼
    Extension Service Worker
               │
               └─► Executes browser tools
               │
               └─► Returns results
```

Key points:
- MCP server and Native Host share a Unix socket
- Native Host is spawned by Chrome when extension connects
- If Service Worker sleeps, Native Host exits and socket is deleted
- All components must be running simultaneously

---

## License

Open source. See LICENSE file for details.
