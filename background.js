// OptiPass service worker.
// - Enforces the auto-lock timer (unlocked keys live only in
//   chrome.storage.session; locking never signs you out).
// - Relays monitor element-picker results to the popup.
// - Every 30 minutes: applies updated files automatically (after a
//   git pull the disk manifest differs from the running one) and
//   refreshes the LOW-alert badge on the toolbar icon.

import { rest } from './lib/api.js';
import { decryptJson, importKeyB64 } from './lib/crypto.js';

const SESSION_KEYS = 'optipass_session_keys';
const AUTOLOCK_ALARM = 'optipass-autolock';
const MAINT_ALARM = 'optipass-maintenance';
const BADGE_COLOR = '#b4544a';

function ensureMaintenanceAlarm() {
  chrome.alarms.create(MAINT_ALARM, { periodInMinutes: 30, delayInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(() => {
  ensureMaintenanceAlarm();
  rebuildFillMenu();
});
chrome.runtime.onStartup.addListener(() => {
  ensureMaintenanceAlarm();
  rebuildFillMenu();
});

// ---------- right-click "fill login" context menu ----------
// While the vault is unlocked, the session cache holds the raw vault
// keys, so the worker can decrypt entries and offer site matches.

const MENU_ROOT = 'optipass-fill';
let menuEntries = new Map(); // menu item id -> {username, password}
let menuBuild = Promise.resolve();

function rebuildFillMenu() {
  menuBuild = menuBuild.then(doRebuildFillMenu).catch(() => {});
}

async function doRebuildFillMenu() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: MENU_ROOT, title: 'OptiPass - fill login', contexts: ['editable'] });
  menuEntries = new Map();
  let host = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.url && /^https?:/.test(tab.url)) {
      host = new URL(tab.url).hostname.replace(/^www\./, '');
    }
  } catch {
    /* no accessible tab */
  }
  if (!host) {
    chrome.contextMenus.create({
      id: 'op-none',
      parentId: MENU_ROOT,
      title: 'Open a website tab, then right-click again',
      enabled: false,
      contexts: ['editable'],
    });
    return;
  }
  const matches = await matchesForHost(host);
  if (matches === null) {
    chrome.contextMenus.create({ id: 'op-unlock', parentId: MENU_ROOT, title: 'Unlock OptiPass first...', contexts: ['editable'] });
    return;
  }
  if (matches.length === 0) {
    chrome.contextMenus.create({ id: 'op-none', parentId: MENU_ROOT, title: `No saved login for ${host}`, enabled: false, contexts: ['editable'] });
    return;
  }
  for (const m of matches.slice(0, 10)) {
    const id = `op-fill:${m.id}`;
    menuEntries.set(id, m);
    chrome.contextMenus.create({
      id,
      parentId: MENU_ROOT,
      title: `${m.title}${m.username ? ` (${m.username})` : ''}`,
      contexts: ['editable'],
    });
  }
}

// null = locked; otherwise entries whose site matches the host and
// that actually have something to fill.
async function matchesForHost(host) {
  const { optipass_session_keys: unlocked } = await chrome.storage.session.get('optipass_session_keys');
  if (!unlocked) return null;
  let rows;
  try {
    rows = await rest('/items?select=id,vault_id,iv,enc_data');
  } catch {
    return [];
  }
  const out = [];
  for (const row of rows) {
    const raw = unlocked.vaultKeys[row.vault_id];
    if (!raw) continue;
    try {
      const key = await importKeyB64(raw);
      const data = await decryptJson(key, row.iv, row.enc_data);
      if (!data.url || (!data.username && !data.password)) continue;
      const h = new URL(data.url.includes('://') ? data.url : `https://${data.url}`)
        .hostname.replace(/^www\./, '');
      if (h === host || host.endsWith(`.${h}`) || h.endsWith(`.${host}`)) {
        out.push({ id: row.id, title: data.title || '(untitled)', username: data.username || '', password: data.password || '' });
      }
    } catch {
      /* skip undecryptable */
    }
  }
  return out;
}

// Same fill routine the popup injects.
function injectedFill(username, password) {
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const setVal = (el, value) => {
    const desc = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const pwFields = [...document.querySelectorAll('input[type="password"]')].filter(visible);
  const pw = pwFields[0];
  let filled = false;
  if (pw && password) {
    setVal(pw, password);
    filled = true;
  }
  if (username) {
    const scope = (pw && pw.form) || document;
    const candidates = [
      ...scope.querySelectorAll('input[type="text"], input[type="email"], input:not([type])'),
    ].filter(visible);
    let target = candidates[0];
    if (pw) {
      const before = candidates.filter(
        (el) => pw.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING
      );
      if (before.length) target = before[before.length - 1];
    }
    if (target) {
      setVal(target, username);
      filled = true;
    }
  }
  return filled;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'op-unlock') {
    chrome.windows.create({
      url: chrome.runtime.getURL('popup/popup.html?window=1'),
      type: 'popup',
      width: 430,
      height: 700,
    });
    return;
  }
  const id = String(info.menuItemId);
  if (!id.startsWith('op-fill:') || !tab?.id) return;
  let m = menuEntries.get(id);
  if (!m) {
    await doRebuildFillMenu().catch(() => {});
    m = menuEntries.get(id);
    if (!m) return;
  }
  chrome.scripting
    .executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: injectedFill,
      args: [m.username, m.password],
    })
    .catch(() => {});
});

chrome.tabs.onActivated.addListener(rebuildFillMenu);
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') {
    rebuildFillMenu();
    maybeOpenPayGuide(tab);
  }
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) rebuildFillMenu();
});

// The worker restarts often; keep the menu in sync with the active tab
// on every wake (context menus persist, our entry cache does not).
rebuildFillMenu();

// When someone opens the payment page of a tool with a pending request,
// open the persistent window as a step-by-step guide (once per request
// per browser session). The host map is kept fresh by the popup.
async function maybeOpenPayGuide(tab) {
  try {
    const url = tab?.url || '';
    if (!/^https?:/.test(url)) return;
    const { optipass_pending_payhosts: map = {}, optipass_payguide_shown: shown = [] } =
      await chrome.storage.session.get(['optipass_pending_payhosts', 'optipass_payguide_shown']);
    const host = new URL(url).hostname.replace(/^www\./, '');
    let itemId = null;
    for (const [h, id] of Object.entries(map)) {
      if (h === host || host.endsWith(`.${h}`) || h.endsWith(`.${host}`)) {
        itemId = id;
        break;
      }
    }
    if (!itemId || shown.includes(itemId)) return;
    await chrome.storage.session.set({ optipass_payguide_shown: [...shown, itemId] });
    chrome.windows.create({
      url: chrome.runtime.getURL(`popup/popup.html?window=1&request=${itemId}`),
      type: 'popup',
      width: 430,
      height: 700,
    });
  } catch {
    /* never break navigation */
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[SESSION_KEYS]) rebuildFillMenu();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTOLOCK_ALARM) {
    chrome.storage.session.remove(SESSION_KEYS);
  } else if (alarm.name === MAINT_ALARM) {
    maintenance();
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'optipass-monitor-pick' && msg.payload) {
    chrome.storage.session.set({ optipass_pending_pick: msg.payload });
  }
});

async function maintenance() {
  const { optipass_settings: settings = {} } = await chrome.storage.local.get('optipass_settings');

  // Auto-apply updates: new files on disk -> reload the extension.
  try {
    if (settings.autoUpdate !== false) {
      const disk = (await (await fetch(chrome.runtime.getURL('manifest.json'))).json()).version;
      if (disk && disk !== chrome.runtime.getManifest().version) {
        chrome.runtime.reload();
        return;
      }
    }
  } catch {
    /* manifest unreadable - skip */
  }

  // LOW-alert badge from the team's latest readings.
  try {
    if (settings.alertsBadge === false) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }
    const monitors = await rest('/tool_monitors?select=last_numeric,threshold');
    const low = monitors.filter(
      (m) =>
        m.threshold !== null &&
        m.last_numeric !== null &&
        Number(m.last_numeric) < Number(m.threshold)
    ).length;
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    chrome.action.setBadgeText({ text: low > 0 ? String(low) : '' });
  } catch {
    /* signed out or offline - keep the current badge */
  }
}
