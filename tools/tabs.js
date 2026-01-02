/**
 * Tab Management Tools
 * Handles tab group management with configurable name and color
 */

import { getSettings } from '../lib/permissions.js';

let mcpGroupId = null;

/**
 * Get tab group settings (name and color)
 */
async function getTabGroupSettings() {
  const settings = await getSettings();
  return {
    name: settings.tab_group_name || 'Facai',
    color: settings.tab_group_color || 'orange'
  };
}

/**
 * Get or create tab group context
 */
export async function handleTabsContext(args) {
  const { createIfEmpty } = args || {};
  const { name, color } = await getTabGroupSettings();

  // Try to find existing group by name
  const groups = await chrome.tabGroups.query({ title: name });

  if (groups.length > 0) {
    mcpGroupId = groups[0].id;
    const tabs = await chrome.tabs.query({ groupId: mcpGroupId });

    return {
      groupId: mcpGroupId,
      tabs: tabs.map(t => ({
        id: t.id,
        url: t.url,
        title: t.title,
        active: t.active
      }))
    };
  }

  // No existing group
  if (!createIfEmpty) {
    return { groupId: null, tabs: [] };
  }

  // Create new window with tab
  const newWindow = await chrome.windows.create({
    url: 'about:blank',
    focused: true
  });

  const tabId = newWindow.tabs[0].id;

  // Create and configure group
  mcpGroupId = await chrome.tabs.group({
    tabIds: [tabId],
    createProperties: { windowId: newWindow.id }
  });

  await chrome.tabGroups.update(mcpGroupId, {
    title: name,
    color: color,
    collapsed: false
  });

  return {
    groupId: mcpGroupId,
    tabs: [{
      id: tabId,
      url: 'about:blank',
      title: 'New Tab',
      active: true
    }]
  };
}

/**
 * Create new tab in the group
 */
export async function handleTabsCreate(args) {
  // Ensure we have a group
  if (!mcpGroupId) {
    const context = await handleTabsContext({ createIfEmpty: true });
    if (!context.groupId) {
      throw new Error('Failed to create tab group');
    }
  }

  // Get the window containing the group
  const existingTabs = await chrome.tabs.query({ groupId: mcpGroupId });
  if (existingTabs.length === 0) {
    throw new Error('Tab group has no tabs');
  }

  const windowId = existingTabs[0].windowId;

  // Create new tab
  const newTab = await chrome.tabs.create({
    url: 'about:blank',
    windowId,
    active: true
  });

  // Add to group
  await chrome.tabs.group({
    tabIds: [newTab.id],
    groupId: mcpGroupId
  });

  return {
    id: newTab.id,
    url: newTab.url || 'about:blank',
    title: newTab.title || 'New Tab',
    groupId: mcpGroupId
  };
}

/**
 * Validate that a tab is in the managed group
 */
export async function validateTabInGroup(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);

    if (!tab) {
      return false;
    }

    // If no group exists in cache, try to find it by name
    if (!mcpGroupId) {
      const { name } = await getTabGroupSettings();
      const groups = await chrome.tabGroups.query({ title: name });
      if (groups.length === 0) {
        return false;
      }
      mcpGroupId = groups[0].id;
    }

    return tab.groupId === mcpGroupId;
  } catch (error) {
    // Tab doesn't exist
    return false;
  }
}

/**
 * Get cached group ID
 */
export function getMcpGroupId() {
  return mcpGroupId;
}

/**
 * Clear cached group ID
 */
export function clearMcpGroupId() {
  mcpGroupId = null;
}
