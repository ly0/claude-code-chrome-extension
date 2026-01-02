/**
 * Page Interaction Tools
 * Handles reading page content and executing JavaScript
 */

/**
 * Read page accessibility tree
 */
export async function handleReadPage(args) {
  const { tabId, filter, depth, ref_id } = args;

  if (!tabId) {
    throw new Error('tabId is required');
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (f, d, r) => {
      if (typeof window.__generateAccessibilityTree !== 'function') {
        return { error: 'Accessibility tree script not loaded' };
      }
      return window.__generateAccessibilityTree(f, d, r);
    },
    args: [filter || 'all', depth || 15, ref_id || null]
  });

  if (!results || results.length === 0) {
    throw new Error('Failed to execute script');
  }

  const result = results[0].result;

  if (result.error) {
    throw new Error(result.error);
  }

  // Get current URL and title
  const tab = await chrome.tabs.get(tabId);

  return {
    pageContent: result.pageContent,
    viewport: result.viewport,
    url: tab.url,
    title: tab.title
  };
}

/**
 * Find elements using natural language query
 */
export async function handleFind(args) {
  const { tabId, query } = args;

  if (!tabId) {
    throw new Error('tabId is required');
  }

  if (!query) {
    throw new Error('query is required');
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (searchQuery) => {
      const matches = [];
      const maxResults = 20;

      // Get all elements with refs
      const elementMap = window.__claudeElementMap || {};

      for (const [ref, weakRef] of Object.entries(elementMap)) {
        if (matches.length >= maxResults) break;

        const element = weakRef.deref();
        if (!element || !document.body.contains(element)) continue;

        // Get element info
        const text = element.textContent?.toLowerCase() || '';
        const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
        const placeholder = element.getAttribute('placeholder')?.toLowerCase() || '';
        const title = element.getAttribute('title')?.toLowerCase() || '';
        const role = element.getAttribute('role') || element.tagName.toLowerCase();

        const searchLower = searchQuery.toLowerCase();

        // Check if element matches query
        if (text.includes(searchLower) ||
            ariaLabel.includes(searchLower) ||
            placeholder.includes(searchLower) ||
            title.includes(searchLower) ||
            role.includes(searchLower)) {

          const rect = element.getBoundingClientRect();
          matches.push({
            ref,
            role,
            name: ariaLabel || placeholder || title || text.substring(0, 100),
            bounds: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            },
            visible: rect.width > 0 && rect.height > 0
          });
        }
      }

      // Also search DOM directly for elements without refs
      const queryLower = searchQuery.toLowerCase();
      const selectors = [
        `[aria-label*="${queryLower}" i]`,
        `[placeholder*="${queryLower}" i]`,
        `[title*="${queryLower}" i]`,
        `button:contains("${queryLower}")`,
        `a:contains("${queryLower}")`
      ];

      for (const selector of selectors) {
        if (matches.length >= maxResults) break;

        try {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            if (matches.length >= maxResults) break;

            // Skip if already in matches
            let alreadyFound = false;
            for (const match of matches) {
              const existingEl = window.__claudeElementMap[match.ref]?.deref();
              if (existingEl === element) {
                alreadyFound = true;
                break;
              }
            }
            if (alreadyFound) continue;

            // Create new ref
            const ref = `ref_${++window.__claudeRefCounter}`;
            window.__claudeElementMap[ref] = new WeakRef(element);

            const rect = element.getBoundingClientRect();
            matches.push({
              ref,
              role: element.getAttribute('role') || element.tagName.toLowerCase(),
              name: element.getAttribute('aria-label') ||
                    element.getAttribute('placeholder') ||
                    element.textContent?.substring(0, 100),
              bounds: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              },
              visible: rect.width > 0 && rect.height > 0
            });
          }
        } catch (e) {
          // Selector might be invalid
        }
      }

      return {
        matches,
        total: matches.length,
        truncated: matches.length >= maxResults
      };
    },
    args: [query]
  });

  if (!results || results.length === 0) {
    throw new Error('Failed to execute search');
  }

  return results[0].result;
}

/**
 * Get page text content
 */
export async function handleGetPageText(args) {
  const { tabId } = args;

  if (!tabId) {
    throw new Error('tabId is required');
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // Try to get article content first
      const article = document.querySelector('article');
      if (article) {
        return {
          text: article.innerText,
          isArticle: true
        };
      }

      // Try main content
      const main = document.querySelector('main');
      if (main) {
        return {
          text: main.innerText,
          isArticle: false
        };
      }

      // Fall back to body
      return {
        text: document.body.innerText,
        isArticle: false
      };
    }
  });

  if (!results || results.length === 0) {
    throw new Error('Failed to get page text');
  }

  const { text, isArticle } = results[0].result;
  const tab = await chrome.tabs.get(tabId);

  return {
    text: text.substring(0, 100000), // Limit to 100KB
    url: tab.url,
    title: tab.title,
    isArticle
  };
}

/**
 * Execute JavaScript in page context
 */
export async function handleJavascript(args) {
  const { tabId, text, action } = args;

  if (!tabId) {
    throw new Error('tabId is required');
  }

  if (action !== 'javascript_exec') {
    throw new Error('Invalid action - expected javascript_exec');
  }

  if (!text) {
    throw new Error('JavaScript code is required');
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (code) => {
      try {
        // Use Function constructor to evaluate code
        const fn = new Function(code);
        const result = fn();
        return { success: true, result: result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
    args: [text],
    world: 'MAIN' // Execute in page context, not isolated world
  });

  if (!results || results.length === 0) {
    throw new Error('Failed to execute JavaScript');
  }

  const { success, result, error } = results[0].result;

  if (!success) {
    throw new Error(error);
  }

  return {
    success: true,
    result: result !== undefined ? JSON.stringify(result) : undefined
  };
}
