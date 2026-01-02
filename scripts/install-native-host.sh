#!/bin/bash
# Add ccext extension ID to existing Claude Code CLI Native Host configuration
# and create symlinks to bypass CLI extension detection logic
#
# Prerequisite: Claude Code CLI must be installed
#
# Usage: ./install-native-host.sh <extension-id>

set -e

OFFICIAL_EXT_ID="fcoeoabgfenejglbffodgkkbkcdhcgfn"
EXTENSION_ID="${1:-}"

if [ -z "$EXTENSION_ID" ]; then
    echo "Usage: $0 <ccext-extension-id>"
    echo ""
    echo "How to get the extension ID:"
    echo "  1. Open chrome://extensions"
    echo "  2. Enable 'Developer mode'"
    echo "  3. Find 'Claude Code Browser Extension'"
    echo "  4. Copy the ID (e.g., abcdefghijklmnopqrstuvwxyz)"
    exit 1
fi

# Determine Native Host config path and Chrome config directory
if [[ "$OSTYPE" == "darwin"* ]]; then
    CONFIG_PATH="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_code_browser_extension.json"
    CHROME_BASE="$HOME/Library/Application Support/Google/Chrome"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    CONFIG_PATH="$HOME/.config/google-chrome/NativeMessagingHosts/com.anthropic.claude_code_browser_extension.json"
    CHROME_BASE="$HOME/.config/google-chrome"
else
    echo "Error: Unsupported operating system: $OSTYPE"
    exit 1
fi

echo "=========================================="
echo "ccext CLI Compatibility Configuration Tool"
echo "=========================================="
echo ""

# Step 1: Check Native Host configuration
echo "[1/3] Checking Claude Code CLI Native Host configuration..."

if [ ! -f "$CONFIG_PATH" ]; then
    echo ""
    echo "Error: Native Host configuration file not found"
    echo "Path: $CONFIG_PATH"
    echo ""
    echo "Please install Claude Code CLI first, which will automatically create the Native Host configuration."
    echo "Run this script again after installation."
    exit 1
fi

echo "      Configuration file found ✓"

# Step 2: Add extension ID to allowed_origins
echo ""
echo "[2/3] Adding extension ID to allowed_origins..."

if grep -q "$EXTENSION_ID" "$CONFIG_PATH"; then
    echo "      Extension ID already exists ✓"
else
    python3 << EOF
import json
import sys

config_path = "$CONFIG_PATH"
extension_id = "$EXTENSION_ID"

try:
    with open(config_path, "r") as f:
        config = json.load(f)
except Exception as e:
    print(f"      Error: Failed to read configuration file - {e}")
    sys.exit(1)

new_origin = f"chrome-extension://{extension_id}/"

if "allowed_origins" not in config:
    config["allowed_origins"] = []

if new_origin not in config["allowed_origins"]:
    config["allowed_origins"].append(new_origin)
    try:
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)
        print(f"      Added: {new_origin} ✓")
    except Exception as e:
        print(f"      Error: Failed to write configuration file - {e}")
        sys.exit(1)
else:
    print("      Extension ID already exists ✓")
EOF
fi

# Step 3: Create symlinks to bypass CLI detection
echo ""
echo "[3/3] Creating symlinks to bypass CLI extension detection..."

# Find all Chrome Profile directories
PROFILES=("Default" "Profile 1" "Profile 2" "Profile 3" "Profile 4" "Profile 5")
LINK_CREATED=false

for profile in "${PROFILES[@]}"; do
    EXT_DIR="$CHROME_BASE/$profile/Extensions"
    OFFICIAL_PATH="$EXT_DIR/$OFFICIAL_EXT_ID"

    if [ -d "$EXT_DIR" ]; then
        # Check if official extension already exists
        if [ -e "$OFFICIAL_PATH" ]; then
            if [ -L "$OFFICIAL_PATH" ]; then
                echo "      [$profile] Symlink already exists ✓"
                LINK_CREATED=true
            else
                echo "      [$profile] Official extension installed, skipping"
            fi
        else
            # Create symlink (pointing to ccext ID directory or create empty directory)
            CCEXT_PATH="$EXT_DIR/$EXTENSION_ID"

            if [ -d "$CCEXT_PATH" ]; then
                # ccext is in this profile, create symlink
                ln -s "$EXTENSION_ID" "$OFFICIAL_PATH" 2>/dev/null && {
                    echo "      [$profile] Symlink created ✓"
                    LINK_CREATED=true
                } || {
                    echo "      [$profile] Failed to create symlink"
                }
            else
                # Create an empty placeholder directory with version subdirectory
                mkdir -p "$OFFICIAL_PATH/1.0.0_0" 2>/dev/null && {
                    # Create minimal manifest.json
                    cat > "$OFFICIAL_PATH/1.0.0_0/manifest.json" << 'MANIFEST'
{
  "manifest_version": 3,
  "name": "Claude Code Extension (Link)",
  "version": "1.0.0",
  "description": "Placeholder for ccext"
}
MANIFEST
                    echo "      [$profile] Placeholder directory created ✓"
                    LINK_CREATED=true
                } || {
                    echo "      [$profile] Failed to create placeholder directory"
                }
            fi
        fi
    fi
done

if [ "$LINK_CREATED" = false ]; then
    echo "      Warning: Failed to create any symlinks or placeholder directories"
    echo "      CLI may still show 'extension not detected'"
fi

echo ""
echo "=========================================="
echo "Configuration complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Completely quit Chrome (ensure no background processes)"
echo "  2. Reopen Chrome"
echo "  3. Restart Claude Code CLI"
echo ""
echo "Verify configuration:"
echo "  cat \"$CONFIG_PATH\""
echo ""
