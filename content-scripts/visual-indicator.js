/**
 * Visual Indicator Content Script
 * Shows visual feedback when Claude is controlling the browser
 */

(function() {
  'use strict';

  let indicatorElement = null;
  let stopButtonElement = null;

  /**
   * Show the visual indicator (glow border)
   */
  function showIndicator(color = '#FF6B35') {
    if (indicatorElement) return;

    // Create indicator overlay
    indicatorElement = document.createElement('div');
    indicatorElement.id = '__claude_visual_indicator';
    indicatorElement.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      pointer-events: none !important;
      z-index: 2147483647 !important;
      border: 3px solid ${color} !important;
      box-shadow: inset 0 0 10px ${color}40 !important;
      animation: __claude_glow 2s ease-in-out infinite !important;
    `;

    // Add animation styles
    const style = document.createElement('style');
    style.id = '__claude_indicator_style';
    style.textContent = `
      @keyframes __claude_glow {
        0%, 100% { opacity: 0.7; }
        50% { opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(indicatorElement);
  }

  /**
   * Hide the visual indicator
   */
  function hideIndicator() {
    if (indicatorElement) {
      indicatorElement.remove();
      indicatorElement = null;
    }

    const style = document.getElementById('__claude_indicator_style');
    if (style) {
      style.remove();
    }
  }

  /**
   * Show stop button
   */
  function showStopButton(onStop) {
    if (stopButtonElement) return;

    stopButtonElement = document.createElement('button');
    stopButtonElement.id = '__claude_stop_button';
    stopButtonElement.textContent = 'Stop Claude';
    stopButtonElement.style.cssText = `
      position: fixed !important;
      top: 10px !important;
      right: 10px !important;
      z-index: 2147483647 !important;
      padding: 8px 16px !important;
      background: #FF6B35 !important;
      color: white !important;
      border: none !important;
      border-radius: 4px !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      cursor: pointer !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
      transition: background 0.2s !important;
    `;

    stopButtonElement.addEventListener('mouseenter', () => {
      stopButtonElement.style.background = '#E55A2B !important';
    });

    stopButtonElement.addEventListener('mouseleave', () => {
      stopButtonElement.style.background = '#FF6B35 !important';
    });

    stopButtonElement.addEventListener('click', () => {
      if (onStop) onStop();
      hideAll();
    });

    document.body.appendChild(stopButtonElement);
  }

  /**
   * Hide stop button
   */
  function hideStopButton() {
    if (stopButtonElement) {
      stopButtonElement.remove();
      stopButtonElement = null;
    }
  }

  /**
   * Hide all indicators
   */
  function hideAll() {
    hideIndicator();
    hideStopButton();
  }

  /**
   * Show click indicator at position
   */
  function showClickIndicator(x, y) {
    const indicator = document.createElement('div');
    indicator.style.cssText = `
      position: fixed !important;
      left: ${x - 15}px !important;
      top: ${y - 15}px !important;
      width: 30px !important;
      height: 30px !important;
      border: 3px solid #FF6B35 !important;
      border-radius: 50% !important;
      pointer-events: none !important;
      z-index: 2147483646 !important;
      animation: __claude_click_ripple 0.5s ease-out forwards !important;
    `;

    // Add animation if not already present
    if (!document.getElementById('__claude_click_style')) {
      const style = document.createElement('style');
      style.id = '__claude_click_style';
      style.textContent = `
        @keyframes __claude_click_ripple {
          0% {
            transform: scale(0.5);
            opacity: 1;
          }
          100% {
            transform: scale(1.5);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(indicator);

    // Remove after animation
    setTimeout(() => indicator.remove(), 500);
  }

  // Listen for messages from service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'show_indicator':
        showIndicator(message.color);
        if (message.showStopButton) {
          showStopButton(() => {
            chrome.runtime.sendMessage({ type: 'stop_requested' });
          });
        }
        sendResponse({ success: true });
        break;

      case 'hide_indicator':
        hideAll();
        sendResponse({ success: true });
        break;

      case 'show_click':
        showClickIndicator(message.x, message.y);
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }

    return true; // Keep channel open for async response
  });

})();
