// OptiPass service worker.
// Unlocked key material lives only in chrome.storage.session (in-memory,
// cleared when the browser closes). This worker enforces the auto-lock
// timer even when the popup is closed. Sign-in state is separate and
// survives locking - locking just means "master password required again".

const SESSION_KEYS = 'optipass_session_keys';
const AUTOLOCK_ALARM = 'optipass-autolock';

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTOLOCK_ALARM) {
    chrome.storage.session.remove(SESSION_KEYS);
  }
});

// The monitor element-picker runs in the page after the popup has
// closed, so its result lands here; the popup collects it on reopen.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'optipass-monitor-pick' && msg.payload) {
    chrome.storage.session.set({ optipass_pending_pick: msg.payload });
  }
});
