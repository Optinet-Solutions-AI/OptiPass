// Copied secrets leave the clipboard after CLEAR_SECONDS (security report
// S5), but only if the clipboard still holds what OptiPass copied, so
// anything copied since is left alone. A web page can only touch the
// clipboard while its tab is in front, so if the user is elsewhere at the
// 30 s mark the check waits until they come back. Reading the clipboard
// makes Chrome ask once; if they block it, nothing is cleared.

export const CLEAR_SECONDS = 30;

let pending = null; // the latest copy waiting to be cleared

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Copy a password / username / secret / 2FA code and schedule its removal.
export async function copySecret(text) {
  await navigator.clipboard.writeText(text);
  pending?.cancel();
  const job = { hash: await sha256Hex(text) };
  const onFocus = () => setTimeout(() => clearIfUnchanged(job), 300);
  const timer = setTimeout(() => clearIfUnchanged(job), CLEAR_SECONDS * 1000);
  job.cancel = () => {
    clearTimeout(timer);
    window.removeEventListener('focus', onFocus);
  };
  job.waitForFocus = () => window.addEventListener('focus', onFocus, { once: true });
  pending = job;
}

async function clearIfUnchanged(job) {
  if (pending !== job) return; // a newer copy took over
  if (!document.hasFocus()) return job.waitForFocus();
  pending = null;
  job.cancel();
  try {
    const now = await navigator.clipboard.readText();
    if (now && (await sha256Hex(now)) === job.hash) await navigator.clipboard.writeText('');
  } catch {
    /* clipboard access refused - leave it */
  }
}
