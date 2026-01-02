/**
 * Media Tools
 * Handles GIF recording/export and image upload
 */

import { getScreenshot } from './computer.js';

// GIF recording state per tab
const gifRecordings = new Map();

// Offscreen document state
let offscreenDocumentCreated = false;

/**
 * Ensure offscreen document exists
 */
async function ensureOffscreenDocument() {
  if (offscreenDocumentCreated) return;

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length > 0) {
    offscreenDocumentCreated = true;
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['BLOBS', 'DOM_PARSER'],
    justification: 'GIF generation and image processing'
  });

  offscreenDocumentCreated = true;
}

/**
 * Handle GIF creator actions
 */
export async function handleGifCreator(args) {
  const { action, tabId, download, filename, options } = args;

  if (!tabId) {
    throw new Error('tabId is required');
  }

  switch (action) {
    case 'start_recording':
      return startRecording(tabId);

    case 'stop_recording':
      return stopRecording(tabId);

    case 'export':
      return exportGif(tabId, download, filename, options);

    case 'clear':
      return clearRecording(tabId);

    default:
      throw new Error(`Unknown gif_creator action: ${action}`);
  }
}

/**
 * Start GIF recording
 */
function startRecording(tabId) {
  gifRecordings.set(tabId, {
    frames: [],
    actions: [],
    startTime: Date.now(),
    isRecording: true
  });

  return {
    success: true,
    message: 'Recording started'
  };
}

/**
 * Stop GIF recording
 */
function stopRecording(tabId) {
  const recording = gifRecordings.get(tabId);
  if (!recording) {
    throw new Error('No active recording for this tab');
  }

  recording.isRecording = false;

  return {
    success: true,
    frameCount: recording.frames.length,
    duration: Date.now() - recording.startTime
  };
}

/**
 * Clear recording data
 */
function clearRecording(tabId) {
  gifRecordings.delete(tabId);

  return { success: true };
}

/**
 * Export GIF
 */
async function exportGif(tabId, download, filename, options) {
  const recording = gifRecordings.get(tabId);
  if (!recording || recording.frames.length === 0) {
    throw new Error('No frames recorded');
  }

  await ensureOffscreenDocument();

  // Send frames to offscreen document for GIF generation
  const result = await chrome.runtime.sendMessage({
    target: 'offscreen',
    action: 'generate_gif',
    frames: recording.frames,
    actions: recording.actions,
    options: {
      showClickIndicators: options?.showClickIndicators ?? true,
      showDragPaths: options?.showDragPaths ?? true,
      showActionLabels: options?.showActionLabels ?? true,
      showProgressBar: options?.showProgressBar ?? true,
      showWatermark: options?.showWatermark ?? true,
      quality: options?.quality ?? 10
    }
  });

  if (result.error) {
    throw new Error(result.error);
  }

  // Download if requested
  if (download) {
    const name = filename || `recording-${Date.now()}.gif`;
    await chrome.downloads.download({
      url: result.dataUrl,
      filename: name
    });
  }

  return {
    success: true,
    dataUrl: result.dataUrl,
    frameCount: recording.frames.length
  };
}

/**
 * Add frame to current recording
 */
export async function addGifFrame(tabId, actionInfo) {
  const recording = gifRecordings.get(tabId);
  if (!recording || !recording.isRecording) {
    return; // Not recording
  }

  try {
    // Capture current screenshot
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

    recording.frames.push({
      dataUrl,
      timestamp: Date.now(),
      delay: 100 // Default frame delay
    });

    // Record action info for overlays
    if (actionInfo) {
      recording.actions.push({
        type: actionInfo.action,
        x: actionInfo.coordinate?.[0],
        y: actionInfo.coordinate?.[1],
        frameIndex: recording.frames.length - 1
      });
    }
  } catch (error) {
    console.error('[Media] Failed to capture frame:', error);
  }
}

/**
 * Handle image upload
 */
export async function handleUploadImage(args) {
  const { tabId, imageId, ref, coordinate, filename } = args;

  if (!tabId) {
    throw new Error('tabId is required');
  }

  if (!imageId) {
    throw new Error('imageId is required');
  }

  // Get the image data
  const dataUrl = getScreenshot(imageId);
  if (!dataUrl) {
    throw new Error(`Image not found: ${imageId}`);
  }

  // Convert data URL to blob
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  if (ref) {
    // Upload to file input element
    return uploadToFileInput(tabId, ref, blob, filename || 'image.png');
  } else if (coordinate) {
    // Drag and drop to coordinate
    return dragDropToCoordinate(tabId, coordinate, blob, filename || 'image.png');
  } else {
    throw new Error('Either ref or coordinate is required');
  }
}

/**
 * Upload to file input element
 */
async function uploadToFileInput(tabId, ref, blob, filename) {
  // Create a file from the blob
  const file = new File([blob], filename, { type: blob.type });

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (elementRef, fileData, fileName, fileType) => {
      const element = window.__claudeElementMap?.[elementRef]?.deref();
      if (!element) {
        return { success: false, error: 'Element not found' };
      }

      if (element.tagName.toLowerCase() !== 'input' || element.type !== 'file') {
        return { success: false, error: 'Element is not a file input' };
      }

      // Create file from base64 data
      const byteString = atob(fileData.split(',')[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: fileType });
      const file = new File([blob], fileName, { type: fileType });

      // Create DataTransfer and set files
      const dt = new DataTransfer();
      dt.items.add(file);
      element.files = dt.files;

      // Dispatch change event
      element.dispatchEvent(new Event('change', { bubbles: true }));

      return { success: true };
    },
    args: [ref, await blobToDataUrl(blob), filename, blob.type]
  });

  if (!results || results.length === 0) {
    throw new Error('Failed to upload file');
  }

  return results[0].result;
}

/**
 * Drag and drop to coordinate
 */
async function dragDropToCoordinate(tabId, coordinate, blob, filename) {
  const [x, y] = coordinate;
  const dataUrl = await blobToDataUrl(blob);

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (dropX, dropY, fileData, fileName, fileType) => {
      // Find element at coordinate
      const element = document.elementFromPoint(dropX, dropY);
      if (!element) {
        return { success: false, error: 'No element at coordinate' };
      }

      // Create file from base64 data
      const byteString = atob(fileData.split(',')[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: fileType });
      const file = new File([blob], fileName, { type: fileType });

      // Create DataTransfer
      const dt = new DataTransfer();
      dt.items.add(file);

      // Create and dispatch drop event
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: dropX,
        clientY: dropY
      });

      element.dispatchEvent(dropEvent);

      return { success: true };
    },
    args: [x, y, dataUrl, filename, blob.type]
  });

  if (!results || results.length === 0) {
    throw new Error('Failed to drop file');
  }

  return results[0].result;
}

/**
 * Convert blob to data URL
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
