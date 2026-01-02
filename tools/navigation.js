/**
 * Navigation Tools
 * Handles URL navigation and window resizing
 */

/**
 * Navigate to URL or go back/forward in history
 */
export async function handleNavigate(args) {
  const { tabId, url } = args;

  if (!tabId) {
    throw new Error('tabId is required');
  }

  if (!url) {
    throw new Error('url is required');
  }

  // Handle history navigation
  if (url === 'back') {
    await chrome.tabs.goBack(tabId);
    // Wait for navigation
    await waitForNavigation(tabId);
    const tab = await chrome.tabs.get(tabId);
    return { success: true, url: tab.url, title: tab.title };
  }

  if (url === 'forward') {
    await chrome.tabs.goForward(tabId);
    await waitForNavigation(tabId);
    const tab = await chrome.tabs.get(tabId);
    return { success: true, url: tab.url, title: tab.title };
  }

  // Normalize URL
  let normalizedUrl = url;
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
    normalizedUrl = 'https://' + url;
  }

  // Navigate to URL
  await chrome.tabs.update(tabId, { url: normalizedUrl });

  // Wait for page load
  await waitForNavigation(tabId);

  const tab = await chrome.tabs.get(tabId);

  return {
    success: true,
    url: tab.url,
    title: tab.title
  };
}

/**
 * Wait for navigation to complete
 */
function waitForNavigation(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Navigation timeout'));
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Resize browser window
 */
export async function handleResizeWindow(args) {
  const { tabId, width, height } = args;

  if (!tabId) {
    throw new Error('tabId is required');
  }

  if (!width || !height) {
    throw new Error('width and height are required');
  }

  // Get the window containing this tab
  const tab = await chrome.tabs.get(tabId);
  const windowId = tab.windowId;

  // Resize the window
  await chrome.windows.update(windowId, {
    width: Math.round(width),
    height: Math.round(height)
  });

  // Get updated window info
  const window = await chrome.windows.get(windowId);

  return {
    success: true,
    width: window.width,
    height: window.height
  };
}
