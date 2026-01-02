/**
 * Accessibility Tree Content Script
 * Generates a traversable accessibility tree for page analysis
 */

(function() {
  'use strict';

  // Element reference storage using WeakRef for memory efficiency
  window.__claudeElementMap = window.__claudeElementMap || {};
  window.__claudeRefCounter = window.__claudeRefCounter || 0;

  /**
   * Generate accessibility tree
   * @param {string} filter - Filter mode: 'all', 'interactive'
   * @param {number} depth - Maximum traversal depth
   * @param {string} refId - Optional ref ID to start from
   */
  window.__generateAccessibilityTree = function(filter, depth, refId) {
    try {
      const maxDepth = depth ?? 15;
      const lines = [];
      const options = { filter: filter || 'all', refId };

      /**
       * Get ARIA role for element
       */
      function getRole(element) {
        const role = element.getAttribute('role');
        if (role) return role;

        const tagName = element.tagName.toLowerCase();
        const type = element.getAttribute('type');

        const roleMap = {
          'a': 'link',
          'button': 'button',
          'input': getInputRole(element, type),
          'select': 'combobox',
          'textarea': 'textbox',
          'h1': 'heading',
          'h2': 'heading',
          'h3': 'heading',
          'h4': 'heading',
          'h5': 'heading',
          'h6': 'heading',
          'img': 'image',
          'nav': 'navigation',
          'main': 'main',
          'header': 'banner',
          'footer': 'contentinfo',
          'section': 'region',
          'article': 'article',
          'aside': 'complementary',
          'form': 'form',
          'table': 'table',
          'ul': 'list',
          'ol': 'list',
          'li': 'listitem',
          'label': 'label'
        };

        return roleMap[tagName] || 'generic';
      }

      /**
       * Get input-specific role
       */
      function getInputRole(element, type) {
        const inputType = type || element.type || 'text';
        const inputRoles = {
          'submit': 'button',
          'button': 'button',
          'checkbox': 'checkbox',
          'radio': 'radio',
          'file': 'button'
        };
        return inputRoles[inputType] || 'textbox';
      }

      /**
       * Get accessible name for element
       */
      function getName(element) {
        const tagName = element.tagName.toLowerCase();

        // Handle select elements
        if (tagName === 'select') {
          const selected = element.querySelector('option[selected]') || element.options?.[element.selectedIndex];
          if (selected?.textContent) {
            return selected.textContent.trim();
          }
        }

        // Try various name sources
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel?.trim()) return ariaLabel.trim();

        const placeholder = element.getAttribute('placeholder');
        if (placeholder?.trim()) return placeholder.trim();

        const title = element.getAttribute('title');
        if (title?.trim()) return title.trim();

        const alt = element.getAttribute('alt');
        if (alt?.trim()) return alt.trim();

        // Check for label
        if (element.id) {
          const label = document.querySelector(`label[for="${element.id}"]`);
          if (label?.textContent?.trim()) {
            return label.textContent.trim();
          }
        }

        // Input value for submit buttons
        if (tagName === 'input') {
          const type = element.getAttribute('type') || '';
          const value = element.getAttribute('value');
          if (type === 'submit' && value?.trim()) {
            return value.trim();
          }
          if (element.value?.length < 50 && element.value?.trim()) {
            return element.value.trim();
          }
        }

        // Direct text content for buttons and links
        if (['button', 'a', 'summary'].includes(tagName)) {
          let text = '';
          for (const node of element.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
              text += node.textContent;
            }
          }
          if (text.trim()) return text.trim();
        }

        // Headings
        if (tagName.match(/^h[1-6]$/)) {
          const text = element.textContent;
          if (text?.trim()) {
            return text.trim().substring(0, 100);
          }
        }

        // Skip images without alt
        if (tagName === 'img') return '';

        // General text content
        let textContent = '';
        for (const node of element.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            textContent += node.textContent;
          }
        }
        if (textContent?.trim()?.length >= 3) {
          const trimmed = textContent.trim();
          return trimmed.length > 100 ? trimmed.substring(0, 100) + '...' : trimmed;
        }

        return '';
      }

      /**
       * Check if element is visible
       */
      function isVisible(element) {
        const style = window.getComputedStyle(element);
        return style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               style.opacity !== '0' &&
               element.offsetWidth > 0 &&
               element.offsetHeight > 0;
      }

      /**
       * Check if element is interactive
       */
      function isInteractive(element) {
        const tagName = element.tagName.toLowerCase();
        return ['a', 'button', 'input', 'select', 'textarea', 'details', 'summary'].includes(tagName) ||
               element.getAttribute('onclick') !== null ||
               element.getAttribute('tabindex') !== null ||
               element.getAttribute('role') === 'button' ||
               element.getAttribute('role') === 'link' ||
               element.getAttribute('contenteditable') === 'true';
      }

      /**
       * Check if element is a landmark
       */
      function isLandmark(element) {
        const tagName = element.tagName.toLowerCase();
        return ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'nav', 'main', 'header', 'footer', 'section', 'article', 'aside'].includes(tagName) ||
               element.getAttribute('role') !== null;
      }

      /**
       * Check if element should be included
       */
      function shouldInclude(element, opts) {
        const tagName = element.tagName.toLowerCase();

        // Skip non-visible elements
        if (['script', 'style', 'meta', 'link', 'title', 'noscript'].includes(tagName)) {
          return false;
        }

        // Skip aria-hidden unless showing all
        if (opts.filter !== 'all' && element.getAttribute('aria-hidden') === 'true') {
          return false;
        }

        // Check visibility (unless viewing specific ref)
        if (opts.filter !== 'all' && !opts.refId && !isVisible(element)) {
          return false;
        }

        // Check if in viewport (unless viewing specific ref)
        if (opts.filter !== 'all' && !opts.refId) {
          const rect = element.getBoundingClientRect();
          if (!(rect.top < window.innerHeight && rect.bottom > 0 &&
                rect.left < window.innerWidth && rect.right > 0)) {
            return false;
          }
        }

        // Interactive filter
        if (opts.filter === 'interactive') {
          return isInteractive(element);
        }

        // Include interactive elements
        if (isInteractive(element)) return true;

        // Include landmarks
        if (isLandmark(element)) return true;

        // Include elements with accessible names
        if (getName(element).length > 0) return true;

        // Include elements with specific roles
        const role = getRole(element);
        if (role !== null && role !== 'generic' && role !== 'image') {
          return true;
        }

        return false;
      }

      /**
       * Get or create element reference
       */
      function getOrCreateRef(element) {
        // Check for existing ref
        for (const [ref, weakRef] of Object.entries(window.__claudeElementMap)) {
          if (weakRef.deref() === element) {
            return ref;
          }
        }

        // Create new ref
        const ref = `ref_${++window.__claudeRefCounter}`;
        window.__claudeElementMap[ref] = new WeakRef(element);
        return ref;
      }

      /**
       * Process element recursively
       */
      function processElement(element, currentDepth) {
        if (currentDepth > maxDepth) return;
        if (!element || !element.tagName) return;

        const include = shouldInclude(element, options) ||
                        (options.refId !== null && currentDepth === 0);

        if (include) {
          const role = getRole(element);
          const name = getName(element);
          const ref = getOrCreateRef(element);

          // Build line
          let line = ' '.repeat(currentDepth) + role;

          if (name) {
            const escapedName = name.replace(/\s+/g, ' ').substring(0, 100).replace(/"/g, '\\"');
            line += ` "${escapedName}"`;
          }

          line += ` [${ref}]`;

          // Add key attributes
          if (element.getAttribute('href')) {
            line += ` href="${element.getAttribute('href')}"`;
          }
          if (element.getAttribute('type')) {
            line += ` type="${element.getAttribute('type')}"`;
          }
          if (element.getAttribute('placeholder')) {
            line += ` placeholder="${element.getAttribute('placeholder')}"`;
          }

          lines.push(line);
        }

        // Process children
        if (element.children && currentDepth < maxDepth) {
          for (const child of element.children) {
            processElement(child, include ? currentDepth + 1 : currentDepth);
          }
        }
      }

      // Get start element
      let startElement;
      if (refId) {
        const weakRef = window.__claudeElementMap[refId];
        if (!weakRef) {
          return {
            error: `Element with ref_id '${refId}' not found. It may have been removed from the page. Use read_page without ref_id to get the current page state.`,
            pageContent: '',
            viewport: { width: window.innerWidth, height: window.innerHeight }
          };
        }
        startElement = weakRef.deref();
        if (!startElement) {
          return {
            error: `Element with ref_id '${refId}' no longer exists. It may have been removed from the page. Use read_page without ref_id to get the current page state.`,
            pageContent: '',
            viewport: { width: window.innerWidth, height: window.innerHeight }
          };
        }
      } else {
        startElement = document.body;
      }

      // Process tree
      if (startElement) {
        processElement(startElement, 0);
      }

      // Clean up stale refs
      for (const ref in window.__claudeElementMap) {
        if (!window.__claudeElementMap[ref].deref()) {
          delete window.__claudeElementMap[ref];
        }
      }

      // Check output size
      const content = lines.join('\n');
      if (content.length > 50000) {
        let errorMsg = `Output exceeds 50000 character limit (${content.length} characters). `;
        if (refId) {
          errorMsg += 'The specified element has too much content. Try specifying a smaller depth parameter or focus on a more specific child element.';
        } else if (depth !== undefined) {
          errorMsg += 'Try specifying an even smaller depth parameter or use ref_id to focus on a specific element.';
        } else {
          errorMsg += 'Try specifying a depth parameter (e.g., depth: 5) or use ref_id to focus on a specific element from the page.';
        }
        return {
          error: errorMsg,
          pageContent: '',
          viewport: { width: window.innerWidth, height: window.innerHeight }
        };
      }

      return {
        pageContent: content,
        viewport: { width: window.innerWidth, height: window.innerHeight }
      };

    } catch (error) {
      throw new Error('Error generating accessibility tree: ' + (error.message || 'Unknown error'));
    }
  };

})();
