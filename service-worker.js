/**
 * Claude Code Browser Extension - Service Worker
 * Handles Native Messaging connection and MCP tool routing
 */

// Import tool handlers
import { handleTabsContext, handleTabsCreate, validateTabInGroup } from './tools/tabs.js';
import { handleReadPage, handleFind, handleGetPageText, handleJavascript } from './tools/page.js';
import { handleNavigate, handleResizeWindow } from './tools/navigation.js';
import { handleComputer, handleFormInput } from './tools/computer.js';
import { handleGifCreator, handleUploadImage, addGifFrame } from './tools/media.js';
import { handleReadConsole, handleReadNetwork, initDebugListeners } from './tools/debug.js';
import { getSettings } from './lib/permissions.js';

// Constants
const NATIVE_HOST_NAME = 'com.anthropic.claude_code_browser_extension';
const TOOL_TIMEOUT_MS = 30000;

// Tools that should show visual indicator (user-visible actions)
const VISUAL_INDICATOR_TOOLS = new Set([
  'navigate',
  'computer',
  'form_input',
  'javascript_tool'
]);

// State
let nativePort = null;
let pendingRequests = new Map();
let isConnected = false;

/**
 * Connect to Native Host
 */
function connectNativeHost() {
  if (nativePort) {
    console.log('[SW] Native port already exists');
    return;
  }

  console.log('[SW] Connecting to native host:', NATIVE_HOST_NAME);

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  } catch (error) {
    console.error('[SW] Failed to connect to native host:', error);
    return;
  }

  nativePort.onMessage.addListener(handleNativeMessage);
  nativePort.onDisconnect.addListener(handleNativeDisconnect);

  // Send ping to verify connection
  sendNativeMessage({ type: 'ping' });
}

/**
 * Handle messages from Native Host
 */
function handleNativeMessage(message) {
  console.log('[SW] Native message received:', message.type);

  if (message.type === 'pong') {
    isConnected = true;
    console.log('[SW] Native host connection verified');
    return;
  }

  if (message.type === 'tool_request') {
    handleToolRequest(message)
      .then(result => {
        sendNativeMessage({
          type: 'tool_response',
          requestId: message.requestId,
          result
        });
      })
      .catch(error => {
        sendNativeMessage({
          type: 'tool_response',
          requestId: message.requestId,
          error: error.message || String(error)
        });
      });
    return;
  }

  // Handle response to pending request
  if (message.requestId && pendingRequests.has(message.requestId)) {
    const { resolve, reject, timeout } = pendingRequests.get(message.requestId);
    clearTimeout(timeout);
    pendingRequests.delete(message.requestId);

    if (message.error) {
      reject(new Error(message.error));
    } else {
      resolve(message.result);
    }
  }
}

/**
 * Handle Native Host disconnection
 */
function handleNativeDisconnect() {
  const error = chrome.runtime.lastError?.message || 'Unknown error';
  console.log('[SW] Native host disconnected:', error);

  nativePort = null;
  isConnected = false;

  // Reject all pending requests
  for (const [id, { reject, timeout }] of pendingRequests) {
    clearTimeout(timeout);
    reject(new Error('Native host disconnected'));
  }
  pendingRequests.clear();

  // Attempt reconnection after delay
  setTimeout(connectNativeHost, 5000);
}

/**
 * Send message to Native Host
 */
function sendNativeMessage(message) {
  if (!nativePort) {
    console.error('[SW] No native port available');
    return false;
  }

  try {
    nativePort.postMessage(message);
    return true;
  } catch (error) {
    console.error('[SW] Failed to send native message:', error);
    return false;
  }
}

/**
 * Show visual indicator on tab
 */
async function showVisualIndicator(tabId, color) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'show_indicator',
      color: color
    });
  } catch (e) {
    // Content script may not be loaded, ignore
    console.log('[SW] Could not show indicator:', e.message);
  }
}

/**
 * Hide visual indicator on tab
 */
async function hideVisualIndicator(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'hide_indicator'
    });
  } catch (e) {
    console.log('[SW] Could not hide indicator:', e.message);
  }
}

/**
 * Handle tool request from Native Host
 */
async function handleToolRequest(request) {
  // Support both CLI format: { params: { tool, args } }
  // and direct format: { tool, args }
  const params = request.params || request;
  let { tool, args = {} } = params;
  const requestId = request.requestId;

  // Strip MCP prefix if present (e.g., mcp__claude-in-chrome__navigate -> navigate)
  if (tool && tool.startsWith('mcp__claude-in-chrome__')) {
    tool = tool.replace('mcp__claude-in-chrome__', '');
  }

  console.log(`[SW] Tool request: ${tool}`, args);

  // Check if should show visual indicator
  const settings = await getSettings();
  const shouldShowIndicator = settings.show_visual_indicator
    && args.tabId
    && VISUAL_INDICATOR_TOOLS.has(tool);

  // Show indicator before action
  if (shouldShowIndicator) {
    await showVisualIndicator(args.tabId, settings.indicator_color);
  }

  try {
    // Validate tabId if present
    if (args.tabId) {
      const isValid = await validateTabInGroup(args.tabId);
      if (!isValid) {
        throw new Error(`Tab ${args.tabId} is not in the MCP group or does not exist`);
      }
    }

    // Route to appropriate handler
    switch (tool) {
      // Tab management
      case 'tabs_context_mcp':
        return handleTabsContext(args);
      case 'tabs_create_mcp':
        return handleTabsCreate(args);

      // Page interaction
      case 'read_page':
        return handleReadPage(args);
      case 'find':
        return handleFind(args);
      case 'get_page_text':
        return handleGetPageText(args);
      case 'javascript_tool':
        return handleJavascript(args);

      // Navigation
      case 'navigate':
        return handleNavigate(args);
      case 'resize_window':
        return handleResizeWindow(args);

      // Computer actions
      case 'computer':
        const result = await handleComputer(args);
        // Add frame to GIF recording if active
        if (args.action && args.action !== 'wait') {
          await addGifFrame(args.tabId, args);
        }
        return result;
      case 'form_input':
        return handleFormInput(args);

      // Media
      case 'gif_creator':
        return handleGifCreator(args);
      case 'upload_image':
        return handleUploadImage(args);

      // Debug
      case 'read_console_messages':
        return handleReadConsole(args);
      case 'read_network_requests':
        return handleReadNetwork(args);

      // Plan/Shortcuts (stub implementations)
      case 'update_plan':
        return handleUpdatePlan(args);
      case 'shortcuts_list':
        return handleShortcutsList(args);
      case 'shortcuts_execute':
        return handleShortcutsExecute(args);

      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  } finally {
    // Hide indicator after action (even on error)
    if (shouldShowIndicator) {
      await hideVisualIndicator(args.tabId);
    }
  }
}

/**
 * Update plan - show user the planned actions
 */
async function handleUpdatePlan(args) {
  const { domains, approach } = args;

  // Store the plan for reference
  await chrome.storage.local.set({
    currentPlan: {
      domains: domains || [],
      approach: approach || [],
      timestamp: Date.now()
    }
  });

  return {
    success: true,
    message: 'Plan updated',
    domains,
    approach
  };
}

/**
 * List available shortcuts (stub)
 */
async function handleShortcutsList(args) {
  // Return empty list - shortcuts are managed by Claude Code CLI
  return {
    shortcuts: [],
    workflows: []
  };
}

/**
 * Execute shortcut (stub)
 */
async function handleShortcutsExecute(args) {
  const { command, shortcutId } = args;

  // Shortcuts are managed by Claude Code CLI
  return {
    success: false,
    error: 'Shortcuts must be executed through Claude Code CLI'
  };
}

// Initialize on service worker startup
console.log('[SW] Service worker starting...');
connectNativeHost();
initDebugListeners();

// Re-connect when service worker wakes up
chrome.runtime.onStartup.addListener(() => {
  console.log('[SW] Browser startup - connecting to native host');
  connectNativeHost();
});

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[SW] Extension installed/updated:', details.reason);
  connectNativeHost();
});

// Export for testing
export { connectNativeHost, handleToolRequest, isConnected };
