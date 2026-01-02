/**
 * Computer Tools
 * Handles mouse/keyboard interactions and screenshots
 */

// Screenshot storage
const screenshotStore = new Map();

/**
 * Main computer action handler
 */
export async function handleComputer(args) {
  const { action, tabId, coordinate, text, duration, scroll_direction,
          scroll_amount, start_coordinate, region, ref, modifiers, repeat } = args;

  if (!tabId) {
    throw new Error('tabId is required');
  }

  if (!action) {
    throw new Error('action is required');
  }

  switch (action) {
    case 'screenshot':
      return captureScreenshot(tabId, region);

    case 'left_click':
    case 'right_click':
    case 'double_click':
    case 'triple_click':
      return performClick(tabId, action, coordinate, ref, modifiers);

    case 'type':
      return performType(tabId, text);

    case 'key':
      return performKeyPress(tabId, text, repeat || 1);

    case 'scroll':
      return performScroll(tabId, coordinate, scroll_direction, scroll_amount || 3);

    case 'scroll_to':
      return scrollToElement(tabId, ref);

    case 'wait':
      await new Promise(r => setTimeout(r, (duration || 1) * 1000));
      return { success: true };

    case 'left_click_drag':
      return performDrag(tabId, start_coordinate, coordinate);

    case 'hover':
      return performHover(tabId, coordinate, ref);

    case 'zoom':
      return captureZoom(tabId, region);

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * Capture screenshot
 */
async function captureScreenshot(tabId, region) {
  // Get the window containing the tab
  const tab = await chrome.tabs.get(tabId);

  // Capture visible tab
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

  if (region) {
    // Crop the image
    return cropImage(dataUrl, region, tabId);
  }

  // Store screenshot
  const imageId = `screenshot_${Date.now()}`;
  screenshotStore.set(imageId, dataUrl);

  return { imageId, dataUrl };
}

/**
 * Crop image to region
 */
async function cropImage(dataUrl, region, tabId) {
  const [x0, y0, x1, y1] = region;

  // Use offscreen document for image processing
  const result = await chrome.runtime.sendMessage({
    target: 'offscreen',
    action: 'crop_image',
    dataUrl,
    region: { x0, y0, x1, y1 }
  });

  if (result.error) {
    throw new Error(result.error);
  }

  const imageId = `screenshot_${Date.now()}`;
  screenshotStore.set(imageId, result.dataUrl);

  return { imageId, dataUrl: result.dataUrl };
}

/**
 * Capture zoomed region
 */
async function captureZoom(tabId, region) {
  if (!region) {
    throw new Error('region is required for zoom action');
  }

  return captureScreenshot(tabId, region);
}

/**
 * Perform click action
 */
async function performClick(tabId, action, coordinate, ref, modifiers) {
  let x, y;

  if (coordinate) {
    [x, y] = coordinate;
  } else if (ref) {
    const center = await getElementCenter(tabId, ref);
    x = center.x;
    y = center.y;
  } else {
    throw new Error('Either coordinate or ref is required');
  }

  // Use debugger API for precise click
  await chrome.debugger.attach({ tabId }, '1.3');

  try {
    const clickCount = action === 'double_click' ? 2 : action === 'triple_click' ? 3 : 1;
    const button = action === 'right_click' ? 'right' : 'left';
    const modifierFlags = parseModifiers(modifiers);

    // Mouse down
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x, y,
      button,
      clickCount,
      modifiers: modifierFlags
    });

    // Mouse up
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x, y,
      button,
      clickCount,
      modifiers: modifierFlags
    });

    return { success: true, x, y };
  } finally {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {
      // Ignore detach errors
    }
  }
}

/**
 * Perform hover action
 */
async function performHover(tabId, coordinate, ref) {
  let x, y;

  if (coordinate) {
    [x, y] = coordinate;
  } else if (ref) {
    const center = await getElementCenter(tabId, ref);
    x = center.x;
    y = center.y;
  } else {
    throw new Error('Either coordinate or ref is required');
  }

  await chrome.debugger.attach({ tabId }, '1.3');

  try {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x, y
    });

    return { success: true, x, y };
  } finally {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {}
  }
}

/**
 * Perform type action
 */
async function performType(tabId, text) {
  if (!text) {
    throw new Error('text is required');
  }

  await chrome.debugger.attach({ tabId }, '1.3');

  try {
    // Type each character
    for (const char of text) {
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: char
      });
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: 'keyUp'
      });
    }

    return { success: true };
  } finally {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {}
  }
}

/**
 * Perform key press action
 */
async function performKeyPress(tabId, text, repeat) {
  if (!text) {
    throw new Error('key text is required');
  }

  await chrome.debugger.attach({ tabId }, '1.3');

  try {
    // Parse key combinations (e.g., "ctrl+a" or "ArrowDown")
    const keys = text.split(' ').filter(k => k.length > 0);

    for (let i = 0; i < repeat; i++) {
      for (const keySpec of keys) {
        await pressKey(tabId, keySpec);
      }
    }

    return { success: true };
  } finally {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {}
  }
}

/**
 * Press a single key or key combination
 */
async function pressKey(tabId, keySpec) {
  const parts = keySpec.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  let modifierFlags = 0;
  for (const mod of modifiers) {
    if (mod === 'ctrl' || mod === 'control') modifierFlags |= 2;
    if (mod === 'alt') modifierFlags |= 1;
    if (mod === 'shift') modifierFlags |= 8;
    if (mod === 'meta' || mod === 'cmd' || mod === 'command') modifierFlags |= 4;
  }

  // Map common key names
  const keyMap = {
    'enter': 'Enter',
    'return': 'Enter',
    'tab': 'Tab',
    'escape': 'Escape',
    'esc': 'Escape',
    'backspace': 'Backspace',
    'delete': 'Delete',
    'arrowup': 'ArrowUp',
    'arrowdown': 'ArrowDown',
    'arrowleft': 'ArrowLeft',
    'arrowright': 'ArrowRight',
    'home': 'Home',
    'end': 'End',
    'pageup': 'PageUp',
    'pagedown': 'PageDown',
    'space': ' '
  };

  const mappedKey = keyMap[key] || key;

  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: mappedKey,
    modifiers: modifierFlags
  });

  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: mappedKey,
    modifiers: modifierFlags
  });
}

/**
 * Perform scroll action
 */
async function performScroll(tabId, coordinate, direction, amount) {
  const [x, y] = coordinate || [400, 300];

  await chrome.debugger.attach({ tabId }, '1.3');

  try {
    let deltaX = 0;
    let deltaY = 0;
    const scrollDelta = amount * 100;

    switch (direction) {
      case 'up': deltaY = -scrollDelta; break;
      case 'down': deltaY = scrollDelta; break;
      case 'left': deltaX = -scrollDelta; break;
      case 'right': deltaX = scrollDelta; break;
      default: throw new Error(`Invalid scroll direction: ${direction}`);
    }

    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x, y,
      deltaX,
      deltaY
    });

    return { success: true };
  } finally {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {}
  }
}

/**
 * Scroll element into view
 */
async function scrollToElement(tabId, ref) {
  if (!ref) {
    throw new Error('ref is required for scroll_to');
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (elementRef) => {
      const element = window.__claudeElementMap?.[elementRef]?.deref();
      if (!element) {
        return { success: false, error: 'Element not found' };
      }

      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return { success: true };
    },
    args: [ref]
  });

  if (!results || results.length === 0) {
    throw new Error('Failed to scroll to element');
  }

  return results[0].result;
}

/**
 * Perform drag action
 */
async function performDrag(tabId, startCoordinate, endCoordinate) {
  if (!startCoordinate || !endCoordinate) {
    throw new Error('start_coordinate and coordinate are required');
  }

  const [startX, startY] = startCoordinate;
  const [endX, endY] = endCoordinate;

  await chrome.debugger.attach({ tabId }, '1.3');

  try {
    // Move to start
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: startX,
      y: startY
    });

    // Mouse down at start
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: startX,
      y: startY,
      button: 'left'
    });

    // Move to end
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: endX,
      y: endY
    });

    // Mouse up at end
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: endX,
      y: endY,
      button: 'left'
    });

    return { success: true };
  } finally {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {}
  }
}

/**
 * Get element center coordinates
 */
async function getElementCenter(tabId, ref) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (elementRef) => {
      const element = window.__claudeElementMap?.[elementRef]?.deref();
      if (!element) {
        return { error: 'Element not found' };
      }

      const rect = element.getBoundingClientRect();
      return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2
      };
    },
    args: [ref]
  });

  if (!results || results.length === 0 || results[0].result.error) {
    throw new Error(results?.[0]?.result?.error || 'Failed to get element center');
  }

  return results[0].result;
}

/**
 * Parse modifier keys string
 */
function parseModifiers(modifiersStr) {
  if (!modifiersStr) return 0;

  let flags = 0;
  const mods = modifiersStr.toLowerCase().split('+');

  for (const mod of mods) {
    if (mod === 'ctrl' || mod === 'control') flags |= 2;
    if (mod === 'alt') flags |= 1;
    if (mod === 'shift') flags |= 8;
    if (mod === 'meta' || mod === 'cmd' || mod === 'command') flags |= 4;
  }

  return flags;
}

/**
 * Handle form input
 */
export async function handleFormInput(args) {
  const { tabId, ref, value } = args;

  if (!tabId) {
    throw new Error('tabId is required');
  }

  if (!ref) {
    throw new Error('ref is required');
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (elementRef, inputValue) => {
      const element = window.__claudeElementMap?.[elementRef]?.deref();
      if (!element) {
        return { success: false, error: 'Element not found' };
      }

      const tagName = element.tagName.toLowerCase();
      const type = element.type?.toLowerCase();

      // Handle different input types
      if (tagName === 'input' || tagName === 'textarea') {
        if (type === 'checkbox' || type === 'radio') {
          element.checked = Boolean(inputValue);
        } else {
          element.value = String(inputValue);
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return { success: true };
      }

      if (tagName === 'select') {
        element.value = String(inputValue);
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true };
      }

      if (element.isContentEditable) {
        element.textContent = String(inputValue);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        return { success: true };
      }

      return { success: false, error: 'Element is not a form field' };
    },
    args: [ref, value]
  });

  if (!results || results.length === 0) {
    throw new Error('Failed to set form value');
  }

  const result = results[0].result;
  if (!result.success) {
    throw new Error(result.error);
  }

  return { success: true };
}

/**
 * Get stored screenshot
 */
export function getScreenshot(imageId) {
  return screenshotStore.get(imageId);
}
