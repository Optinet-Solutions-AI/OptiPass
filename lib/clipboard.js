// Copied secrets leave the clipboard after CLEAR_SECONDS (security report
// S5): the popup tells the service worker what it copied (as a SHA-256
// hash only), the worker sets an alarm, and a hidden offscreen page then
// empties the clipboard - but only if it still holds that same value, so
// anything the user copied in the meantime is left alone. Works after the
// popup has closed.

export const CLEAR_SECONDS = 30;

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Copy a password / username / secret / 2FA code and schedule its removal.
export async function copySecret(text) {
  await navigator.clipboard.writeText(text);
  try {
    await chrome.runtime.sendMessage({ type: 'optipass-clip-armed', hash: await sha256Hex(text) });
  } catch {
    /* worker not reachable - the copy itself still worked */
  }
}
