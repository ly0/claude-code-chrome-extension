/**
 * Debug Tools
 * Handles console messages and network request monitoring
 */

// Console message storage per tab
const consoleMessages = new Map();

// Network request storage per tab
const networkRequests = new Map();

// Active debugger sessions
const debuggerSessions = new Set();

/**
 * Initialize debug listeners
 */
export function initDebugListeners() {
  // Listen for tab removal to clean up
  chrome.tabs.onRemoved.addListener((tabId) => {
    consoleMessages.delete(tabId);
    networkRequests.delete(tabId);
    debuggerSessions.delete(tabId);
  });

  // Listen for navigation to clear data
  chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId === 0) {
      // Main frame navigation - clear data
      const tabId = details.tabId;
      const currentUrl = networkRequests.get(tabId)?.currentUrl;
      const newUrl = details.url;

      // Clear if navigating to different domain
      if (currentUrl && new URL(currentUrl).host !== new URL(newUrl).host) {
        consoleMessages.delete(tabId);
        networkRequests.delete(tabId);
      }
    }
  });
}

/**
 * Start monitoring console for a tab
 */
async function startConsoleMonitoring(tabId) {
  if (debuggerSessions.has(tabId)) {
    return; // Already monitoring
  }

  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    debuggerSessions.add(tabId);

    await chrome.debugger.sendCommand({ tabId }, 'Console.enable');
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');

    // Initialize storage
    if (!consoleMessages.has(tabId)) {
      consoleMessages.set(tabId, []);
    }

    // Listen for console messages
    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (source.tabId !== tabId) return;

      if (method === 'Console.messageAdded' || method === 'Runtime.consoleAPICalled') {
        const messages = consoleMessages.get(tabId) || [];
        const entry = {
          timestamp: Date.now(),
          level: params.message?.level || params.type || 'info',
          text: params.message?.text || params.args?.map(a => a.value || a.description).join(' ') || '',
          source: params.message?.source || 'console'
        };
        messages.push(entry);

        // Keep last 1000 messages
        if (messages.length > 1000) {
          messages.shift();
        }

        consoleMessages.set(tabId, messages);
      }
    });
  } catch (error) {
    console.error('[Debug] Failed to start console monitoring:', error);
  }
}

/**
 * Start monitoring network for a tab
 */
async function startNetworkMonitoring(tabId) {
  if (!networkRequests.has(tabId)) {
    networkRequests.set(tabId, {
      requests: [],
      currentUrl: null
    });
  }

  try {
    if (!debuggerSessions.has(tabId)) {
      await chrome.debugger.attach({ tabId }, '1.3');
      debuggerSessions.add(tabId);
    }

    await chrome.debugger.sendCommand({ tabId }, 'Network.enable');

    // Get current URL
    const tab = await chrome.tabs.get(tabId);
    networkRequests.get(tabId).currentUrl = tab.url;

    // Listen for network events
    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (source.tabId !== tabId) return;

      const storage = networkRequests.get(tabId);
      if (!storage) return;

      if (method === 'Network.requestWillBeSent') {
        storage.requests.push({
          requestId: params.requestId,
          url: params.request.url,
          method: params.request.method,
          type: params.type,
          timestamp: Date.now(),
          status: 'pending'
        });

        // Keep last 500 requests
        if (storage.requests.length > 500) {
          storage.requests.shift();
        }
      }

      if (method === 'Network.responseReceived') {
        const request = storage.requests.find(r => r.requestId === params.requestId);
        if (request) {
          request.status = params.response.status;
          request.statusText = params.response.statusText;
          request.mimeType = params.response.mimeType;
        }
      }

      if (method === 'Network.loadingFailed') {
        const request = storage.requests.find(r => r.requestId === params.requestId);
        if (request) {
          request.status = 'failed';
          request.error = params.errorText;
        }
      }
    });
  } catch (error) {
    console.error('[Debug] Failed to start network monitoring:', error);
  }
}

/**
 * Read console messages
 */
export async function handleReadConsole(args) {
  const { tabId, pattern, onlyErrors, clear, limit } = args;

  if (!tabId) {
    throw new Error('tabId is required');
  }

  // Start monitoring if not already
  await startConsoleMonitoring(tabId);

  let messages = consoleMessages.get(tabId) || [];

  // Filter by pattern
  if (pattern) {
    const regex = new RegExp(pattern, 'i');
    messages = messages.filter(m => regex.test(m.text));
  }

  // Filter for errors only
  if (onlyErrors) {
    messages = messages.filter(m =>
      m.level === 'error' || m.level === 'exception' || m.level === 'assert'
    );
  }

  // Apply limit
  const maxMessages = limit || 100;
  if (messages.length > maxMessages) {
    messages = messages.slice(-maxMessages);
  }

  // Clear if requested
  if (clear) {
    consoleMessages.set(tabId, []);
  }

  return {
    messages,
    total: messages.length,
    cleared: clear || false
  };
}

/**
 * Read network requests
 */
export async function handleReadNetwork(args) {
  const { tabId, urlPattern, clear, limit } = args;

  if (!tabId) {
    throw new Error('tabId is required');
  }

  // Start monitoring if not already
  await startNetworkMonitoring(tabId);

  const storage = networkRequests.get(tabId);
  let requests = storage?.requests || [];

  // Filter by URL pattern
  if (urlPattern) {
    requests = requests.filter(r => r.url.includes(urlPattern));
  }

  // Apply limit
  const maxRequests = limit || 100;
  if (requests.length > maxRequests) {
    requests = requests.slice(-maxRequests);
  }

  // Clear if requested
  if (clear && storage) {
    storage.requests = [];
  }

  return {
    requests: requests.map(r => ({
      url: r.url,
      method: r.method,
      type: r.type,
      status: r.status,
      statusText: r.statusText,
      mimeType: r.mimeType,
      error: r.error
    })),
    total: requests.length,
    cleared: clear || false
  };
}

/**
 * Stop debugger for a tab
 */
export async function stopDebugger(tabId) {
  if (debuggerSessions.has(tabId)) {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {
      // Ignore errors
    }
    debuggerSessions.delete(tabId);
  }
}
