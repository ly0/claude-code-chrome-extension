#!/bin/bash
# Patch Claude Code CLI to support third-party browser extensions
#
# This script patches cli.js to:
# 1. Merge allowed_origins instead of overwriting (preserves third-party extension IDs)
# 2. Add your extension ID to the detection array
#
# Usage: ./patch-cli.sh <extension-id> [cli-path]

set -e

EXTENSION_ID="${1:-}"
CLI_PATH="${2:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_error() { echo -e "${RED}Error: $1${NC}" >&2; }
print_success() { echo -e "${GREEN}$1${NC}"; }
print_warning() { echo -e "${YELLOW}$1${NC}"; }
print_info() { echo "$1"; }

# Validate extension ID
if [ -z "$EXTENSION_ID" ]; then
    echo "Usage: $0 <extension-id> [cli-path]"
    echo ""
    echo "Arguments:"
    echo "  extension-id  Your ccext extension ID (required)"
    echo "  cli-path      Path to cli.js (optional, auto-detected if not provided)"
    echo ""
    echo "How to get the extension ID:"
    echo "  1. Open chrome://extensions"
    echo "  2. Enable 'Developer mode'"
    echo "  3. Find 'Claude Code Browser Extension'"
    echo "  4. Copy the ID (e.g., abcdefghijklmnopqrstuvwxyz)"
    exit 1
fi

# Validate extension ID format (32 lowercase letters)
if ! [[ "$EXTENSION_ID" =~ ^[a-z]{32}$ ]]; then
    print_error "Invalid extension ID format. Must be 32 lowercase letters."
    echo "Example: abcdefghijklmnopqrstuvwxyz123456"
    exit 1
fi

echo "=========================================="
echo "Claude Code CLI Patcher for ccext"
echo "=========================================="
echo ""

# Find CLI path if not provided
if [ -z "$CLI_PATH" ]; then
    print_info "Finding Claude Code CLI location..."

    # Try to find claude command
    CLAUDE_CMD=$(which claude 2>/dev/null || true)

    if [ -z "$CLAUDE_CMD" ]; then
        print_error "Could not find 'claude' command. Please provide cli.js path manually."
        echo "Usage: $0 <extension-id> /path/to/cli.js"
        exit 1
    fi

    print_info "  Found claude at: $CLAUDE_CMD"

    # Check if it's a symlink
    if [ -L "$CLAUDE_CMD" ]; then
        LINK_TARGET=$(readlink "$CLAUDE_CMD" 2>/dev/null)
        print_info "  Symlink target: $LINK_TARGET"

        # Resolve relative path to absolute path
        if [[ "$LINK_TARGET" == /* ]]; then
            # Already absolute path
            CLI_PATH="$LINK_TARGET"
        else
            # Relative path - resolve from symlink's directory
            LINK_DIR=$(dirname "$CLAUDE_CMD")
            CLI_PATH=$(cd "$LINK_DIR" && cd "$(dirname "$LINK_TARGET")" && pwd)/$(basename "$LINK_TARGET")
        fi
    else
        # Not a symlink, check if it's cli.js itself or look for it
        if [[ "$CLAUDE_CMD" == *.js ]]; then
            CLI_PATH="$CLAUDE_CMD"
        else
            # Search in common locations relative to the command
            CLAUDE_DIR=$(dirname "$CLAUDE_CMD")
            if [ -f "$CLAUDE_DIR/cli.js" ]; then
                CLI_PATH="$CLAUDE_DIR/cli.js"
            elif [ -f "$CLAUDE_DIR/../cli.js" ]; then
                CLI_PATH="$CLAUDE_DIR/../cli.js"
            fi
        fi
    fi

    if [ -z "$CLI_PATH" ] || [ ! -f "$CLI_PATH" ]; then
        print_error "Could not find cli.js automatically."
        echo ""
        echo "Please provide the path manually:"
        echo "  $0 $EXTENSION_ID /path/to/cli.js"
        echo ""
        echo "Common locations:"
        echo "  ~/.claude/local/cli.js"
        echo "  ~/.nvm/versions/node/*/lib/node_modules/@anthropic-ai/claude-code/cli.js"
        exit 1
    fi
fi

# Verify cli.js exists
if [ ! -f "$CLI_PATH" ]; then
    print_error "cli.js not found at: $CLI_PATH"
    exit 1
fi

print_success "Found cli.js at: $CLI_PATH"

# Create backup
BACKUP_PATH="${CLI_PATH}.backup.$(date +%Y%m%d_%H%M%S)"
cp "$CLI_PATH" "$BACKUP_PATH"
print_success "Created backup at: $BACKUP_PATH"

echo ""
print_info "Applying patches..."

# ============================================
# PATCH 1: Add extension ID to allowed_origins
# ============================================
print_info ""
print_info "[Patch 1] Adding extension ID to allowed_origins..."

NEW_ORIGIN="chrome-extension://$EXTENSION_ID/"

# Check if already contains our extension
if grep -q "$EXTENSION_ID" "$CLI_PATH"; then
    print_warning "  Extension ID already in allowed_origins"
else
    # Use perl to add the extension origin to allowed_origins array
    # Pass NEW_ORIGIN as environment variable to avoid shell quoting issues
    NEW_ORIGIN="$NEW_ORIGIN" perl -i -pe 's/(allowed_origins:\["chrome-extension:\/\/[a-z]+\/")/$1,"$ENV{NEW_ORIGIN}"/' "$CLI_PATH"

    # Verify the change was made
    if grep -q "$EXTENSION_ID" "$CLI_PATH"; then
        print_success "  Added extension ID to allowed_origins"
    else
        print_warning "  Could not find allowed_origins pattern (Patch 1 skipped)"
    fi
fi

# ============================================
# PATCH 2: Add extension ID to detection array
# ============================================
print_info ""
print_info "[Patch 2] Adding extension ID to detection array..."

# Check if already contains our ID
if grep -q "\"$EXTENSION_ID\"" "$CLI_PATH"; then
    print_warning "  Extension ID already in detection array"
else
    # Use perl to add extension ID to the array
    # Pattern: ["32-letter-id"] -> ["32-letter-id","NEW_ID"]
    # Perl handles special characters better than sed
    if perl -i -pe "s/\\[\"([a-z]{32})\"\\]/[\"\\1\",\"$EXTENSION_ID\"]/" "$CLI_PATH"; then
        # Verify the change was made
        if grep -q "\"$EXTENSION_ID\"" "$CLI_PATH"; then
            print_success "  Added extension ID to detection array"
        else
            print_warning "  Could not find extension ID array pattern (Patch 2 skipped)"
        fi
    else
        print_error "  Failed to apply Patch 2"
    fi
fi

# ============================================
# PATCH 3: Create Chrome extension directory
# ============================================
print_info ""
print_info "[Patch 3] Creating Chrome extension directory..."

# Get the script's directory to find ccext root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CCEXT_DIR="$(dirname "$SCRIPT_DIR")"

# Find Chrome Extensions directory (try multiple profiles)
CHROME_BASE="$HOME/Library/Application Support/Google/Chrome"
CHROME_EXT_DIR=""

for profile in "Default" "Profile 1" "Profile 2" "Profile 3"; do
    if [ -d "$CHROME_BASE/$profile/Extensions" ]; then
        CHROME_EXT_DIR="$CHROME_BASE/$profile/Extensions"
        break
    fi
done

if [ -z "$CHROME_EXT_DIR" ]; then
    print_warning "  Could not find Chrome Extensions directory (Patch 3 skipped)"
else
    EXT_PATH="$CHROME_EXT_DIR/$EXTENSION_ID"

    if [ -e "$EXT_PATH" ]; then
        print_warning "  Extension directory already exists"
    else
        # Create symlink to ccext source directory
        if ln -s "$CCEXT_DIR" "$EXT_PATH" 2>/dev/null; then
            print_success "  Created extension symlink: $EXT_PATH -> $CCEXT_DIR"
        else
            print_error "  Failed to create extension symlink"
        fi
    fi
fi

echo ""
echo "=========================================="
print_success "Patching complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Run the install script to update Native Host config:"
echo "     ./scripts/install-native-host.sh $EXTENSION_ID"
echo ""
echo "  2. Restart Claude Code CLI:"
echo "     claude --chrome"
echo ""
echo "  3. If you need to revert, restore from backup:"
echo "     cp \"$BACKUP_PATH\" \"$CLI_PATH\""
echo ""
