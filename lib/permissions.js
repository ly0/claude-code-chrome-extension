/**
 * Permission Management Module
 * Handles domain allowlists, blocklists, and action approvals
 */

// Storage keys
const STORAGE_KEYS = {
  ALLOWED_DOMAINS: 'allowed_domains',
  BLOCKED_DOMAINS: 'blocked_domains',
  SETTINGS: 'settings'
};

// Default settings
const DEFAULT_SETTINGS = {
  require_approval_for_clicks: false,
  require_approval_for_forms: true,
  require_approval_for_downloads: true,
  require_approval_for_navigation: false,
  notifications_enabled: true,
  show_visual_indicator: true,
  indicator_color: '#FF6B35',
  auto_approve_same_domain: true,
  tab_group_name: 'Facai',
  tab_group_color: 'orange'
};

/**
 * Get all stored permissions and settings
 */
export async function getAllPermissions() {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.ALLOWED_DOMAINS,
    STORAGE_KEYS.BLOCKED_DOMAINS,
    STORAGE_KEYS.SETTINGS
  ]);

  return {
    allowed_domains: result[STORAGE_KEYS.ALLOWED_DOMAINS] || [],
    blocked_domains: result[STORAGE_KEYS.BLOCKED_DOMAINS] || [],
    settings: { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] }
  };
}

/**
 * Get current settings
 */
export async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };
}

/**
 * Update a specific setting
 */
export async function updateSetting(key, value) {
  const settings = await getSettings();
  settings[key] = value;
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
  return settings;
}

/**
 * Update multiple settings at once
 */
export async function updateSettings(newSettings) {
  const settings = await getSettings();
  const updated = { ...settings, ...newSettings };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: updated });
  return updated;
}

/**
 * Reset settings to defaults
 */
export async function resetSettings() {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  return DEFAULT_SETTINGS;
}

/**
 * Get allowed domains list
 */
export async function getAllowedDomains() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.ALLOWED_DOMAINS);
  return result[STORAGE_KEYS.ALLOWED_DOMAINS] || [];
}

/**
 * Add domain to allowlist
 */
export async function addAllowedDomain(domain) {
  const domains = await getAllowedDomains();

  // Check if already exists
  const existing = domains.find(d => d.domain === domain);
  if (existing) {
    return { success: false, error: 'Domain already in allowlist' };
  }

  const entry = {
    domain,
    addedAt: Date.now(),
    lastUsed: null
  };

  domains.push(entry);
  await chrome.storage.local.set({ [STORAGE_KEYS.ALLOWED_DOMAINS]: domains });

  return { success: true, entry };
}

/**
 * Remove domain from allowlist
 */
export async function removeAllowedDomain(domain) {
  const domains = await getAllowedDomains();
  const filtered = domains.filter(d => d.domain !== domain);

  if (filtered.length === domains.length) {
    return { success: false, error: 'Domain not found' };
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.ALLOWED_DOMAINS]: filtered });
  return { success: true };
}

/**
 * Update last used timestamp for domain
 */
export async function updateDomainLastUsed(domain) {
  const domains = await getAllowedDomains();
  const entry = domains.find(d => d.domain === domain || matchWildcard(d.domain, domain));

  if (entry) {
    entry.lastUsed = Date.now();
    await chrome.storage.local.set({ [STORAGE_KEYS.ALLOWED_DOMAINS]: domains });
  }
}

/**
 * Get blocked domains list
 */
export async function getBlockedDomains() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.BLOCKED_DOMAINS);
  return result[STORAGE_KEYS.BLOCKED_DOMAINS] || [];
}

/**
 * Add domain to blocklist
 */
export async function addBlockedDomain(domain) {
  const domains = await getBlockedDomains();

  if (domains.includes(domain)) {
    return { success: false, error: 'Domain already blocked' };
  }

  domains.push(domain);
  await chrome.storage.local.set({ [STORAGE_KEYS.BLOCKED_DOMAINS]: domains });

  return { success: true };
}

/**
 * Remove domain from blocklist
 */
export async function removeBlockedDomain(domain) {
  const domains = await getBlockedDomains();
  const filtered = domains.filter(d => d !== domain);

  if (filtered.length === domains.length) {
    return { success: false, error: 'Domain not found' };
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.BLOCKED_DOMAINS]: filtered });
  return { success: true };
}

/**
 * Check if domain is allowed
 */
export async function isDomainAllowed(domain) {
  // First check blocklist
  const blocked = await getBlockedDomains();
  for (const pattern of blocked) {
    if (matchWildcard(pattern, domain)) {
      return { allowed: false, reason: 'blocked' };
    }
  }

  // Then check allowlist
  const allowed = await getAllowedDomains();

  // If allowlist is empty, allow all (except blocked)
  if (allowed.length === 0) {
    return { allowed: true, reason: 'no_allowlist' };
  }

  for (const entry of allowed) {
    if (matchWildcard(entry.domain, domain)) {
      return { allowed: true, reason: 'allowlist', entry };
    }
  }

  return { allowed: false, reason: 'not_in_allowlist' };
}

/**
 * Check if action requires approval based on settings
 */
export async function requiresApproval(action, context = {}) {
  const settings = await getSettings();

  // Click actions
  if (['left_click', 'right_click', 'double_click', 'triple_click'].includes(action)) {
    return settings.require_approval_for_clicks;
  }

  // Form actions
  if (action === 'form_input' || action === 'type') {
    return settings.require_approval_for_forms;
  }

  // Download actions
  if (action === 'download' || context.isDownload) {
    return settings.require_approval_for_downloads;
  }

  // Navigation
  if (action === 'navigate') {
    // Check if same domain
    if (settings.auto_approve_same_domain && context.currentDomain && context.targetDomain) {
      if (context.currentDomain === context.targetDomain) {
        return false;
      }
    }
    return settings.require_approval_for_navigation;
  }

  return false;
}

/**
 * Match domain against wildcard pattern
 * Supports: *.example.com, example.*, *.example.*
 */
function matchWildcard(pattern, domain) {
  if (pattern === domain) return true;

  // Convert pattern to regex
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*');

  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(domain);
}

/**
 * Clear all permissions and reset to defaults
 */
export async function clearAllData() {
  await chrome.storage.local.remove([
    STORAGE_KEYS.ALLOWED_DOMAINS,
    STORAGE_KEYS.BLOCKED_DOMAINS,
    STORAGE_KEYS.SETTINGS
  ]);

  return { success: true };
}

/**
 * Export permissions data (for backup)
 */
export async function exportData() {
  const data = await getAllPermissions();
  return JSON.stringify(data, null, 2);
}

/**
 * Import permissions data (from backup)
 */
export async function importData(jsonString) {
  try {
    const data = JSON.parse(jsonString);

    await chrome.storage.local.set({
      [STORAGE_KEYS.ALLOWED_DOMAINS]: data.allowed_domains || [],
      [STORAGE_KEYS.BLOCKED_DOMAINS]: data.blocked_domains || [],
      [STORAGE_KEYS.SETTINGS]: { ...DEFAULT_SETTINGS, ...data.settings }
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Export default settings for reference
export { DEFAULT_SETTINGS };
