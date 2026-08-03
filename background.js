// OptiPass service worker.
// - Enforces the auto-lock timer (unlocked keys live only in
//   chrome.storage.session; locking never signs you out).
// - Relays monitor element-picker results to the popup.
// - Every 30 minutes: applies updated files automatically (after a
//   git pull the disk manifest differs from the running one) and
//   refreshes the LOW-alert badge on the toolbar icon.

import { rest } from './lib/api.js';

const SESSION_KEYS = 'optipass_session_keys';
const AUTOLOCK_ALARM = 'optipass-autolock';
const MAINT_ALARM = 'optipass-maintenance';
const BADGE_COLOR = '#b4544a';

function ensureMaintenanceAlarm() {
  chrome.alarms.create(MAINT_ALARM, { periodInMinutes: 30, delayInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(ensureMaintenanceAlarm);
chrome.runtime.onStartup.addListener(ensureMaintenanceAlarm);

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
