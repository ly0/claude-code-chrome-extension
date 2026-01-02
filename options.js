/**
 * Options Page JavaScript
 * Handles settings UI and permission management
 */

import {
  getAllPermissions,
  getSettings,
  updateSetting,
  resetSettings,
  clearAllData,
  addAllowedDomain,
  removeAllowedDomain,
  addBlockedDomain,
  removeBlockedDomain,
  exportData,
  importData
} from './lib/permissions.js';

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Setup tab navigation
  setupTabs();

  // Load and display current settings
  await loadSettings();

  // Setup event listeners
  setupEventListeners();

  // Display extension info
  displayExtensionInfo();

  // Check connection status
  checkConnectionStatus();
}

/**
 * Setup tab navigation
 */
function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active from all
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));

      // Add active to clicked tab
      tab.classList.add('active');
      const tabId = tab.dataset.tab;
      document.getElementById(tabId).classList.add('active');
    });
  });
}

/**
 * Load settings and populate UI
 */
async function loadSettings() {
  const { allowed_domains, blocked_domains, settings } = await getAllPermissions();

  // Populate domain lists
  renderDomainList('allowedDomainsList', allowed_domains, 'allowed');
  renderDomainList('blockedDomainsList', blocked_domains.map(d => ({ domain: d })), 'blocked');

  // Populate settings toggles
  document.getElementById('requireApprovalClicks').checked = settings.require_approval_for_clicks;
  document.getElementById('requireApprovalForms').checked = settings.require_approval_for_forms;
  document.getElementById('requireApprovalDownloads').checked = settings.require_approval_for_downloads;
  document.getElementById('requireApprovalNavigation').checked = settings.require_approval_for_navigation;
  document.getElementById('autoApproveSameDomain').checked = settings.auto_approve_same_domain;
  document.getElementById('showVisualIndicator').checked = settings.show_visual_indicator;
  document.getElementById('indicatorColor').value = settings.indicator_color;
  document.getElementById('notificationsEnabled').checked = settings.notifications_enabled;

  // Populate tab group settings
  document.getElementById('tabGroupName').value = settings.tab_group_name || 'Facai';
  document.getElementById('tabGroupColor').value = settings.tab_group_color || 'orange';
}

/**
 * Render domain list
 */
function renderDomainList(elementId, domains, type) {
  const list = document.getElementById(elementId);

  if (!domains || domains.length === 0) {
    list.innerHTML = '<li class="empty-state">No domains added</li>';
    return;
  }

  list.innerHTML = domains.map(entry => {
    const domain = typeof entry === 'string' ? entry : entry.domain;
    const lastUsed = entry.lastUsed ? formatDate(entry.lastUsed) : null;
    const addedAt = entry.addedAt ? formatDate(entry.addedAt) : null;

    return `
      <li data-domain="${domain}">
        <div class="domain-info">
          <span class="domain-name">${domain}</span>
          ${lastUsed ? `<span class="domain-meta">Last used: ${lastUsed}</span>` :
            addedAt ? `<span class="domain-meta">Added: ${addedAt}</span>` : ''}
        </div>
        <button class="remove-btn" data-domain="${domain}" data-type="${type}">&times;</button>
      </li>
    `;
  }).join('');

  // Add click handlers for remove buttons
  list.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', handleRemoveDomain);
  });
}

/**
 * Format date for display
 */
function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

  return date.toLocaleDateString();
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Add domain buttons
  document.getElementById('addAllowedDomain').addEventListener('click', () => handleAddDomain('allowed'));
  document.getElementById('addBlockedDomain').addEventListener('click', () => handleAddDomain('blocked'));

  // Enter key for domain inputs
  document.getElementById('newAllowedDomain').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAddDomain('allowed');
  });
  document.getElementById('newBlockedDomain').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAddDomain('blocked');
  });

  // Settings toggles
  document.getElementById('requireApprovalClicks').addEventListener('change', (e) => {
    updateSetting('require_approval_for_clicks', e.target.checked);
  });
  document.getElementById('requireApprovalForms').addEventListener('change', (e) => {
    updateSetting('require_approval_for_forms', e.target.checked);
  });
  document.getElementById('requireApprovalDownloads').addEventListener('change', (e) => {
    updateSetting('require_approval_for_downloads', e.target.checked);
  });
  document.getElementById('requireApprovalNavigation').addEventListener('change', (e) => {
    updateSetting('require_approval_for_navigation', e.target.checked);
  });
  document.getElementById('autoApproveSameDomain').addEventListener('change', (e) => {
    updateSetting('auto_approve_same_domain', e.target.checked);
  });
  document.getElementById('showVisualIndicator').addEventListener('change', (e) => {
    updateSetting('show_visual_indicator', e.target.checked);
  });
  document.getElementById('indicatorColor').addEventListener('change', (e) => {
    updateSetting('indicator_color', e.target.value);
  });
  document.getElementById('notificationsEnabled').addEventListener('change', (e) => {
    updateSetting('notifications_enabled', e.target.checked);
  });

  // Tab group settings
  document.getElementById('tabGroupName').addEventListener('change', (e) => {
    updateSetting('tab_group_name', e.target.value.trim() || 'Facai');
  });
  document.getElementById('tabGroupColor').addEventListener('change', (e) => {
    updateSetting('tab_group_color', e.target.value);
  });

  // Data management buttons
  document.getElementById('exportData').addEventListener('click', handleExport);
  document.getElementById('importData').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
  });
  document.getElementById('importFileInput').addEventListener('change', handleImport);
  document.getElementById('resetSettings').addEventListener('click', handleReset);
  document.getElementById('clearAllData').addEventListener('click', handleClearAll);
}

/**
 * Handle adding a domain
 */
async function handleAddDomain(type) {
  const inputId = type === 'allowed' ? 'newAllowedDomain' : 'newBlockedDomain';
  const input = document.getElementById(inputId);
  const domain = input.value.trim().toLowerCase();

  if (!domain) {
    showNotification('Please enter a domain', 'error');
    return;
  }

  // Basic validation
  if (!isValidDomain(domain)) {
    showNotification('Invalid domain format', 'error');
    return;
  }

  const fn = type === 'allowed' ? addAllowedDomain : addBlockedDomain;
  const result = await fn(domain);

  if (result.success) {
    input.value = '';
    await loadSettings();
    showNotification(`Domain added to ${type} list`, 'success');
  } else {
    showNotification(result.error || 'Failed to add domain', 'error');
  }
}

/**
 * Handle removing a domain
 */
async function handleRemoveDomain(e) {
  const domain = e.target.dataset.domain;
  const type = e.target.dataset.type;

  const fn = type === 'allowed' ? removeAllowedDomain : removeBlockedDomain;
  const result = await fn(domain);

  if (result.success) {
    await loadSettings();
    showNotification('Domain removed', 'success');
  } else {
    showNotification(result.error || 'Failed to remove domain', 'error');
  }
}

/**
 * Validate domain format
 */
function isValidDomain(domain) {
  // Allow wildcards
  if (domain.startsWith('*.')) {
    domain = domain.slice(2);
  }

  // Basic domain validation
  const pattern = /^[a-z0-9]+([\-\.][a-z0-9]+)*\.[a-z]{2,}$/i;
  return pattern.test(domain) || domain === '*';
}

/**
 * Handle export settings
 */
async function handleExport() {
  try {
    const data = await exportData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `claude-extension-settings-${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
    showNotification('Settings exported', 'success');
  } catch (error) {
    showNotification('Failed to export settings', 'error');
  }
}

/**
 * Handle import settings
 */
async function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const result = await importData(text);

    if (result.success) {
      await loadSettings();
      showNotification('Settings imported', 'success');
    } else {
      showNotification(result.error || 'Failed to import settings', 'error');
    }
  } catch (error) {
    showNotification('Invalid settings file', 'error');
  }

  // Reset file input
  e.target.value = '';
}

/**
 * Handle reset settings
 */
async function handleReset() {
  if (!confirm('Reset all settings to defaults? Domain lists will not be affected.')) {
    return;
  }

  await resetSettings();
  await loadSettings();
  showNotification('Settings reset to defaults', 'success');
}

/**
 * Handle clear all data
 */
async function handleClearAll() {
  if (!confirm('Delete ALL extension data including domain lists and settings? This cannot be undone.')) {
    return;
  }

  await clearAllData();
  await loadSettings();
  showNotification('All data cleared', 'success');
}

/**
 * Display extension info
 */
function displayExtensionInfo() {
  const manifest = chrome.runtime.getManifest();
  document.getElementById('extensionVersion').textContent = manifest.version;
  document.getElementById('extensionId').textContent = chrome.runtime.id;
}

/**
 * Check Native Host connection status
 */
async function checkConnectionStatus() {
  const statusEl = document.getElementById('connectionStatus');
  const nativeStatusEl = document.getElementById('nativeHostStatus');

  try {
    // Try to connect to native host
    const port = chrome.runtime.connectNative('com.anthropic.claude_code_browser_extension');

    port.onMessage.addListener((msg) => {
      if (msg.type === 'pong') {
        statusEl.classList.add('connected');
        statusEl.classList.remove('disconnected');
        statusEl.querySelector('.status-text').textContent = 'Connected';
        nativeStatusEl.textContent = 'Connected';
      }
    });

    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message || 'Not connected';
      statusEl.classList.add('disconnected');
      statusEl.classList.remove('connected');
      statusEl.querySelector('.status-text').textContent = 'Disconnected';
      nativeStatusEl.textContent = error;
    });

    port.postMessage({ type: 'ping' });

    // Timeout after 2 seconds
    setTimeout(() => {
      if (!statusEl.classList.contains('connected')) {
        statusEl.classList.add('disconnected');
        statusEl.querySelector('.status-text').textContent = 'Not connected';
        nativeStatusEl.textContent = 'Not installed or CLI not running';
      }
    }, 2000);

  } catch (error) {
    statusEl.classList.add('disconnected');
    statusEl.querySelector('.status-text').textContent = 'Error';
    nativeStatusEl.textContent = error.message;
  }
}

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
  // Simple notification - could be enhanced with a toast UI
  const colors = {
    success: '#4caf50',
    error: '#f44336',
    info: '#2196f3'
  };

  // Create toast element
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    padding: 12px 20px;
    background: ${colors[type] || colors.info};
    color: white;
    border-radius: 8px;
    font-size: 14px;
    z-index: 10000;
    animation: slideIn 0.3s ease;
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);
