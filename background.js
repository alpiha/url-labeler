importScripts('shared.js');

const DEFAULT_ICON = { 16: 'icons/icon16.png', 32: 'icons/icon32.png' };

let state = UL.normalizeState();
let ready = reload();

function reload() {
  return UL.loadState().then((s) => {
    state = s;
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(changes.rules || changes.looks)) return;
  ready = reload();
  ready.then(refreshAllTabs);
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  // Ignore title/favicon-only updates (our own content script causes those).
  if (info.url || info.status) updateTab(tab);
});

chrome.runtime.onStartup.addListener(refreshAllTabs);

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // Save settings from older versions in the current format.
  const { looks } = await chrome.storage.local.get('looks');
  if (looks) await UL.saveState(await UL.loadState());

  await refreshAllTabs();
  if (reason === 'install' || reason === 'update') injectIntoOpenTabs();
});

async function refreshAllTabs() {
  await ready;
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(updateTab));
}

// Calls a chrome.action setter, ignoring "No tab with id" errors from tabs that closed meanwhile.
// Uses the callback form because setIcon's promise doesn't reliably reject, which logs "Unchecked runtime.lastError".
function action(method, details) {
  if (!chrome.action[method]) return Promise.resolve(false);
  return new Promise((resolve) =>
    chrome.action[method](details, () => resolve(!chrome.runtime.lastError))
  );
}

async function updateTab(tab) {
  await ready;
  const tabId = tab.id;
  if (tabId == null || tabId < 0) return;
  const label = tab.url ? UL.resolve(state, tab.url)?.label : null;
  const showBadge = !!label?.placements.badge;

  const ok = showBadge
    ? await action('setIcon', { tabId, imageData: UL.iconImageData(label) })
    : await action('setIcon', { tabId, path: DEFAULT_ICON });
  if (!ok) return; // tab is gone

  if (showBadge) {
    await action('setBadgeBackgroundColor', { tabId, color: label.color });
    await action('setBadgeTextColor', { tabId, color: UL.textColor(label.color) });
  }
  await action('setBadgeText', { tabId, text: showBadge ? UL.badgeText(label) : '' });
  await action('setTitle', {
    tabId,
    title: label ? `URL Labeler: ${label.displayName}${label.name ? ` (${label.name})` : ''}` : 'URL Labeler: no label',
  });
}

// Tabs opened before install/reload don't have the content script yet.
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ['shared.js', 'content.js'] })
      .catch(() => {});
  }
}
