// Update detection for the load-unpacked install.
//
// Three versions matter:
//   running - the code Chrome currently has loaded
//   disk    - manifest.json in the extension folder (changes after git pull)
//   remote  - manifest.json on GitHub main (what the team has shipped)
//
// disk != running  -> new files are already here; a reload applies them
//                     (done automatically when auto-update is on).
// remote > disk    -> a git pull (or re-download) is needed first.

const REMOTE_MANIFEST =
  'https://raw.githubusercontent.com/Optinet-Solutions-AI/OptiPass/main/manifest.json';

export async function getVersions() {
  const running = chrome.runtime.getManifest().version;
  let disk = null;
  let remote = null;
  try {
    disk = (await (await fetch(chrome.runtime.getURL('manifest.json'))).json()).version;
  } catch {
    /* unreadable */
  }
  try {
    const res = await fetch(REMOTE_MANIFEST, { cache: 'no-store' });
    if (res.ok) remote = (await res.json()).version;
  } catch {
    /* offline */
  }
  return { running, disk, remote };
}

export function newer(a, b) {
  if (!a || !b) return false;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}
