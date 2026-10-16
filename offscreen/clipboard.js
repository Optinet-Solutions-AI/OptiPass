// Offscreen helper (S5): empties the clipboard if it still holds the value
// OptiPass copied. Offscreen pages can't use navigator.clipboard (they never
// have focus), so this uses execCommand paste/copy on a hidden textarea.
import { sha256Hex } from '../lib/clipboard.js';

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'optipass-clip-check') return false;
  clearIfUnchanged(msg.hash).then(reply, () => reply('error'));
  return true; // reply comes asynchronously
});

async function clearIfUnchanged(hash) {
  const box = document.getElementById('clip');
  box.value = '';
  box.focus();
  document.execCommand('paste');
  const now = box.value;
  box.value = '';
  if (!now || (await sha256Hex(now)) !== hash) return 'changed';
  const empty = (e) => {
    e.clipboardData.setData('text/plain', '');
    e.preventDefault();
  };
  document.addEventListener('copy', empty);
  document.execCommand('copy');
  document.removeEventListener('copy', empty);
  return 'cleared';
}
