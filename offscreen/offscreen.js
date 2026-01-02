/**
 * Offscreen Document
 * Handles GIF generation and image processing
 */

// Constants
const CLAUDE_ORANGE = '#FF6B35';
const CLAUDE_ORANGE_LIGHT = '#FF8B5B';

/**
 * Listen for messages from service worker
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  switch (message.action) {
    case 'generate_gif':
      generateGif(message.frames, message.actions, message.options)
        .then(dataUrl => sendResponse({ dataUrl }))
        .catch(error => sendResponse({ error: error.message }));
      return true; // Keep channel open

    case 'crop_image':
      cropImage(message.dataUrl, message.region)
        .then(dataUrl => sendResponse({ dataUrl }))
        .catch(error => sendResponse({ error: error.message }));
      return true;

    case 'play_sound':
      playSound(message.soundType)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ error: error.message }));
      return true;

    default:
      sendResponse({ error: 'Unknown action' });
  }
});

/**
 * Generate GIF from frames
 */
async function generateGif(frames, actions, options) {
  if (!frames || frames.length === 0) {
    throw new Error('No frames provided');
  }

  const opts = {
    showClickIndicators: options?.showClickIndicators ?? true,
    showDragPaths: options?.showDragPaths ?? true,
    showActionLabels: options?.showActionLabels ?? true,
    showProgressBar: options?.showProgressBar ?? true,
    showWatermark: options?.showWatermark ?? true,
    quality: options?.quality ?? 10
  };

  // Initialize GIF encoder
  const gif = new GIF({
    workers: 2,
    quality: opts.quality,
    workerScript: chrome.runtime.getURL('lib/gif.worker.js'),
    width: 0,
    height: 0
  });

  // Process each frame
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const img = await loadImage(frame.dataUrl);

    // Set GIF dimensions from first frame
    if (i === 0) {
      gif.options.width = img.width;
      gif.options.height = img.height;
    }

    // Create canvas for this frame
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');

    // Draw base image
    ctx.drawImage(img, 0, 0);

    // Draw overlays
    const action = actions?.find(a => a.frameIndex === i);

    if (opts.showClickIndicators && action) {
      drawClickIndicator(ctx, action);
    }

    if (opts.showDragPaths && action?.type === 'left_click_drag') {
      drawDragPath(ctx, action);
    }

    if (opts.showActionLabels && action) {
      drawActionLabel(ctx, action);
    }

    if (opts.showProgressBar) {
      drawProgressBar(ctx, i, frames.length);
    }

    if (opts.showWatermark) {
      drawWatermark(ctx, canvas.width, canvas.height);
    }

    // Add frame to GIF
    gif.addFrame(canvas, { delay: frame.delay || 100 });
  }

  // Render GIF
  return new Promise((resolve, reject) => {
    gif.on('finished', blob => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read GIF blob'));
      reader.readAsDataURL(blob);
    });

    gif.on('error', error => reject(error));
    gif.render();
  });
}

/**
 * Load image from data URL
 */
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

/**
 * Draw click indicator
 */
function drawClickIndicator(ctx, action) {
  if (!action.x || !action.y) return;
  if (!action.type?.includes('click')) return;

  const x = action.x;
  const y = action.y;

  // Outer ring
  ctx.beginPath();
  ctx.arc(x, y, 15, 0, Math.PI * 2);
  ctx.strokeStyle = CLAUDE_ORANGE;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Inner dot
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = CLAUDE_ORANGE;
  ctx.fill();

  // Ripple effect for double/triple click
  if (action.type === 'double_click' || action.type === 'triple_click') {
    ctx.beginPath();
    ctx.arc(x, y, 25, 0, Math.PI * 2);
    ctx.strokeStyle = CLAUDE_ORANGE_LIGHT;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/**
 * Draw drag path
 */
function drawDragPath(ctx, action) {
  if (!action.startX || !action.startY || !action.x || !action.y) return;

  // Draw arrow from start to end
  const startX = action.startX;
  const startY = action.startY;
  const endX = action.x;
  const endY = action.y;

  // Line
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.strokeStyle = '#FF0000';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Start circle
  ctx.beginPath();
  ctx.arc(startX, startY, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#FF0000';
  ctx.fill();

  // Arrow head
  const angle = Math.atan2(endY - startY, endX - startX);
  const arrowLength = 15;

  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(
    endX - arrowLength * Math.cos(angle - Math.PI / 6),
    endY - arrowLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    endX - arrowLength * Math.cos(angle + Math.PI / 6),
    endY - arrowLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fillStyle = '#FF0000';
  ctx.fill();
}

/**
 * Draw action label
 */
function drawActionLabel(ctx, action) {
  if (!action.type) return;

  // Format action type for display
  const label = formatActionLabel(action.type);

  // Position at top-left
  const padding = 8;
  const fontSize = 14;

  ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const textWidth = ctx.measureText(label).width;

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(10, 10, textWidth + padding * 2, fontSize + padding * 2);

  // Text
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(label, 10 + padding, 10 + padding + fontSize);
}

/**
 * Format action type for display
 */
function formatActionLabel(actionType) {
  const labels = {
    'left_click': 'Click',
    'right_click': 'Right Click',
    'double_click': 'Double Click',
    'triple_click': 'Triple Click',
    'type': 'Typing',
    'key': 'Key Press',
    'scroll': 'Scrolling',
    'scroll_to': 'Scroll To',
    'left_click_drag': 'Drag',
    'hover': 'Hover'
  };
  return labels[actionType] || actionType;
}

/**
 * Draw progress bar
 */
function drawProgressBar(ctx, current, total) {
  const barHeight = 4;
  const progress = (current + 1) / total;

  ctx.fillStyle = CLAUDE_ORANGE;
  ctx.fillRect(0, ctx.canvas.height - barHeight, ctx.canvas.width * progress, barHeight);
}

/**
 * Draw watermark
 */
function drawWatermark(ctx, width, height) {
  const text = 'Claude';
  const fontSize = 12;

  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';

  const textWidth = ctx.measureText(text).width;
  ctx.fillText(text, width - textWidth - 10, height - 10);
}

/**
 * Crop image to region
 */
async function cropImage(dataUrl, region) {
  const { x0, y0, x1, y1 } = region;
  const img = await loadImage(dataUrl);

  const canvas = document.createElement('canvas');
  const width = x1 - x0;
  const height = y1 - y0;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, x0, y0, width, height, 0, 0, width, height);

  return canvas.toDataURL('image/png');
}

/**
 * Play notification sound
 */
async function playSound(soundType) {
  // Create audio context
  const audioContext = new AudioContext();

  // Create oscillator for simple beep
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  // Configure based on sound type
  switch (soundType) {
    case 'success':
      oscillator.frequency.value = 800;
      gainNode.gain.value = 0.3;
      break;
    case 'error':
      oscillator.frequency.value = 400;
      gainNode.gain.value = 0.3;
      break;
    case 'notification':
    default:
      oscillator.frequency.value = 600;
      gainNode.gain.value = 0.2;
  }

  // Play for short duration
  oscillator.start();
  await new Promise(resolve => setTimeout(resolve, 150));
  oscillator.stop();

  audioContext.close();
}

console.log('[Offscreen] Document ready');
