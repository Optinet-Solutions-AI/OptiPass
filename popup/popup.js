import {
  decryptJson,
  encryptJson,
  exportKeyB64,
  generatePassword,
  generateTotp,
  generateVaultKey,
  importKeyB64,
  importPrivateKey,
  unwrapVaultKey,
  wrapVaultKey,
} from '../lib/crypto.js';
import * as api from '../lib/api.js';
import * as keychain from '../lib/keychain.js';

const $ = (id) => document.getElementById(id);

// Monochrome line icons (Feather-style), rendered via currentColor so
// they follow the theme.
const ICONS = {
  fill: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  pen: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
  refresh:
    '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.64A9 9 0 0 0 20.49 15"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

const state = {
  uid: null,
  profile: null,
  keyRecord: null,
  memberships: [], // [{vault_id, role, wrapped_key, vaults:{id,name,type}}]
  vaultKeys: new Map(), // vault_id -> CryptoKey
  items: [], // [{id, vault_id, data:{title,url,username,password,notes}}]
  settings: { ...keychain.DEFAULT_SETTINGS },
  editingId: null,
  activeHost: null,
  activeUrl: null,
  revealPassword: false,
  loginMode: 'signin', // or 'signup'
  adminProfiles: [],
  monitors: [],
  editingMonitorId: null,
  apiConfigLocked: false,
};

// ---------- screens / feedback ----------

const SCREENS = ['config', 'login', 'pending', 'master-setup', 'unlock', 'pin-setup', 'main', 'edit', 'settings', 'admin', 'monitors', 'monitor-edit'];

function showScreen(name) {
  for (const s of SCREENS) $(`screen-${s}`).classList.toggle('hidden', s !== name);
  const focus = { login: 'login-email', 'master-setup': 'ms-pw', 'pin-setup': 'ps-pin', main: 'search' }[name];
  if (focus) setTimeout(() => $(focus).focus(), 50);
}

// The unlock screen has two modes: quick PIN (if one is set on this
// browser) with a master-password fallback, or master password only.
async function showUnlockScreen(forceMaster = false) {
  $('unlock-email').textContent = state.profile?.email || '';
  const usePin = !forceMaster && (await keychain.hasPin());
  $('unlock-pin-wrap').classList.toggle('hidden', !usePin);
  $('unlock-master-wrap').classList.toggle('hidden', usePin);
  $('unlock-pin').value = '';
  hideError('unlock-error');
  showScreen('unlock');
  setTimeout(() => $(usePin ? 'unlock-pin' : 'unlock-pw').focus(), 50);
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

function showError(id, msg, ok = false) {
  const el = $(id);
  el.textContent = msg;
  el.classList.toggle('ok', ok);
  el.classList.remove('hidden');
}

function hideError(id) {
  $(id).classList.add('hidden');
}

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('set-theme').value = theme;
  $('btn-theme').innerHTML = icon(dark ? 'sun' : 'moon');
  $('btn-theme').title = dark ? 'Switch to light mode' : 'Switch to dark mode';
}

async function setTheme(theme, syncProfile) {
  applyTheme(theme);
  state.settings.theme = theme;
  await keychain.saveSettings(state.settings);
  if (syncProfile && state.profile) {
    state.profile.theme = theme;
    api.rest(`/profiles?id=eq.${state.uid}`, { method: 'PATCH', body: { theme } }).catch(() => {});
  }
}

// ---------- boot ----------

async function boot() {
  state.settings = await keychain.getSettings();
  applyTheme(state.settings.theme || 'light');
  state.activeHost = await getActiveHost();

  if (!api.isConfigured()) return showScreen('config');

  const session = await api.getSession();
  if (!session) return showScreen('login');
  state.uid = session.user.id;

  let profile;
  try {
    [profile] = await api.rest(`/profiles?id=eq.${state.uid}&select=*`);
  } catch (err) {
    showScreen('login');
    return showError('login-error', `Could not reach the server: ${err.message}`);
  }
  if (!profile) {
    // Signed in but no profile row (should not happen) - treat as pending.
    return showScreen('pending');
  }
  state.profile = profile;

  if (profile.status === 'pending') {
    $('pending-msg').textContent =
      'Your account is waiting for an admin to approve it. Ask your admin, then check again.';
    return showScreen('pending');
  }
  if (profile.status === 'disabled') {
    $('pending-msg').textContent = 'Your account has been disabled. Contact your admin.';
    return showScreen('pending');
  }

  await setTheme(profile.theme || 'light', false);

  const [keyRecord] = await api.rest(`/user_keys?user_id=eq.${state.uid}&select=*`);
  state.keyRecord = keyRecord || null;
  if (!keyRecord || !profile.public_key) return showScreen('master-setup');

  const unlocked = await keychain.getUnlocked();
  if (!unlocked) return showUnlockScreen();

  await enterMain();
}

async function getActiveHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      state.activeUrl = tab.url;
      return new URL(tab.url).hostname.replace(/^www\./, '');
    }
  } catch {
    /* chrome:// pages etc. */
  }
  return null;
}

// ---------- login / signup ----------

function setLoginMode(mode) {
  state.loginMode = mode;
  const signup = mode === 'signup';
  $('login-pw2-wrap').classList.toggle('hidden', !signup);
  $('btn-login-submit').textContent = signup ? 'Create account' : 'Sign in';
  $('login-toggle').textContent = signup ? 'Have an account? Sign in' : 'Need an account? Sign up';
  $('login-sub').textContent = signup
    ? 'Create your team account. An admin must approve you unless you were invited.'
    : 'Sign in with your team account.';
  hideError('login-error');
}

$('login-toggle').addEventListener('click', () =>
  setLoginMode(state.loginMode === 'signin' ? 'signup' : 'signin')
);

async function submitLogin() {
  const email = $('login-email').value.trim();
  const pw = $('login-pw').value;
  hideError('login-error');
  if (!email || !pw) return showError('login-error', 'Email and password are required.');

  const btn = $('btn-login-submit');
  btn.disabled = true;
  try {
    if (state.loginMode === 'signup') {
      if (pw.length < 8) return showError('login-error', 'Account password must be at least 8 characters.');
      if (pw !== $('login-pw2').value) return showError('login-error', 'Passwords do not match.');
      const { signedIn } = await api.signUp(email, pw);
      if (!signedIn) {
        setLoginMode('signin');
        return showError('login-error', 'Account created - confirm the email we sent you, then sign in.', true);
      }
    } else {
      await api.signIn(email, pw);
    }
    api.logEvent('auth.signin');
    $('login-pw').value = '';
    $('login-pw2').value = '';
    await boot();
  } catch (err) {
    showError('login-error', err.message);
  } finally {
    btn.disabled = false;
  }
}

$('btn-login-submit').addEventListener('click', submitLogin);
$('login-pw').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && state.loginMode === 'signin') submitLogin();
});

$('btn-pending-refresh').addEventListener('click', boot);
$('btn-pending-signout').addEventListener('click', doSignOut);
$('btn-unlock-signout').addEventListener('click', doSignOut);
$('btn-signout').addEventListener('click', doSignOut);

async function doSignOut() {
  await keychain.lock();
  await keychain.clearPin();
  await api.signOut();
  state.uid = null;
  state.profile = null;
  state.vaultKeys = new Map();
  state.items = [];
  setLoginMode('signin');
  showScreen('login');
}

// ---------- master password setup ----------

$('ms-pw').addEventListener('input', () => {
  const pw = $('ms-pw').value;
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  const colors = ['#b4544a', '#b4544a', '#c9a227', '#c9a227', '#6b8f71', '#6b8f71'];
  $('ms-strength').innerHTML = `<div style="width:${(score / 5) * 100}%;background:${colors[score]}"></div>`;
});

$('btn-ms-create').addEventListener('click', async () => {
  const pw = $('ms-pw').value;
  hideError('ms-error');
  if (pw.length < 10) return showError('ms-error', 'Master password must be at least 10 characters.');
  if (pw !== $('ms-pw2').value) return showError('ms-error', 'Passwords do not match.');

  const btn = $('btn-ms-create');
  btn.disabled = true;
  btn.textContent = 'Setting up encryption...';
  try {
    const { publicJwk, privateJwk, keyRecord } = await keychain.createUserKeys(pw);
    await api.rest(`/profiles?id=eq.${state.uid}`, { method: 'PATCH', body: { public_key: publicJwk } });
    await api.rest('/user_keys', { method: 'POST', body: { user_id: state.uid, ...keyRecord } });
    state.profile.public_key = publicJwk;
    state.keyRecord = keyRecord;
    await keychain.setUnlocked(privateJwk);
    api.logEvent('keys.setup');
    await enterMain();
    toast('Vault ready');
  } catch (err) {
    showError('ms-error', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Set master password';
  }
});

// ---------- unlock ----------

async function doUnlock() {
  const pw = $('unlock-pw').value;
  if (!pw) return;
  hideError('unlock-error');
  const btn = $('unlock-btn');
  btn.disabled = true;
  btn.textContent = 'Unlocking...';
  try {
    const privateJwk = await keychain.decryptPrivateKey(pw, state.keyRecord);
    await keychain.setUnlocked(privateJwk);
    $('unlock-pw').value = '';
    // Offer a quick-unlock PIN once per browser.
    if (!(await keychain.hasPin()) && !state.settings.pinOffered) {
      $('ps-pin').value = '';
      $('ps-pin2').value = '';
      hideError('ps-error');
      showScreen('pin-setup');
      return;
    }
    await enterMain();
  } catch {
    showError('unlock-error', 'Incorrect master password.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Unlock';
  }
}

$('unlock-btn').addEventListener('click', doUnlock);
$('unlock-pw').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doUnlock();
});

// ---------- quick-unlock PIN ----------

const PIN_RE = /^\d{6}$/;

function digitsOnly(el) {
  el.addEventListener('input', () => {
    el.value = el.value.replace(/\D/g, '').slice(0, 6);
  });
}
for (const id of ['unlock-pin', 'ps-pin', 'ps-pin2', 'sp-pin', 'sp-pin2']) digitsOnly($(id));

let pinUnlockBusy = false;
$('unlock-pin').addEventListener('input', async () => {
  const pin = $('unlock-pin').value;
  if (!PIN_RE.test(pin) || pinUnlockBusy) return;
  pinUnlockBusy = true;
  $('unlock-pin').disabled = true;
  hideError('unlock-error');
  try {
    await keychain.unlockWithPin(pin);
    await enterMain();
  } catch (err) {
    $('unlock-pin').value = '';
    if (err.code === 'PIN_WIPED') {
      await showUnlockScreen(true);
      showError('unlock-error', 'Too many wrong attempts - the PIN was removed. Unlock with your master password.');
    } else {
      showError('unlock-error', `Wrong PIN - ${err.attemptsLeft} attempt${err.attemptsLeft === 1 ? '' : 's'} left.`);
    }
  } finally {
    pinUnlockBusy = false;
    $('unlock-pin').disabled = false;
    if (!$('unlock-pin-wrap').classList.contains('hidden')) $('unlock-pin').focus();
  }
});

$('btn-unlock-use-master').addEventListener('click', () => showUnlockScreen(true));

async function savePinAndContinue(pinId, pin2Id, errorId) {
  const pin = $(pinId).value;
  if (!PIN_RE.test(pin)) {
    showError(errorId, 'The PIN must be exactly 6 digits.');
    return false;
  }
  if (pin !== $(pin2Id).value) {
    showError(errorId, 'PINs do not match.');
    return false;
  }
  await keychain.setupPinFromSession(pin);
  $(pinId).value = '';
  $(pin2Id).value = '';
  return true;
}

$('btn-ps-save').addEventListener('click', async () => {
  hideError('ps-error');
  try {
    if (!(await savePinAndContinue('ps-pin', 'ps-pin2', 'ps-error'))) return;
    state.settings.pinOffered = true;
    await keychain.saveSettings(state.settings);
    toast('PIN unlock enabled for this browser');
    await enterMain();
  } catch (err) {
    showError('ps-error', err.message);
  }
});

$('btn-ps-skip').addEventListener('click', async () => {
  state.settings.pinOffered = true;
  await keychain.saveSettings(state.settings);
  await enterMain();
});

// ---------- vault + item loading ----------

async function refreshMemberships() {
  state.memberships = await api.rest(
    `/vault_members?user_id=eq.${state.uid}&select=vault_id,role,wrapped_key,vaults(id,name,type)`
  );
}

async function ensurePersonalVault() {
  if (state.memberships.some((m) => m.vaults?.type === 'personal')) return;
  const vaultKey = await generateVaultKey();
  const wrapped = await wrapVaultKey(state.profile.public_key, vaultKey);
  const [v] = await api.rest('/vaults?select=id', {
    method: 'POST',
    body: { name: 'Personal', type: 'personal' },
    prefer: 'return=representation',
  });
  await api.rest('/vault_members', {
    method: 'POST',
    body: { vault_id: v.id, user_id: state.uid, role: 'manager', wrapped_key: wrapped },
  });
  await refreshMemberships();
}

// Unwrap any vault keys we haven't cached in the session yet.
async function ensureVaultKeys() {
  const unlocked = await keychain.getUnlocked();
  if (!unlocked) return false;
  const priv = await importPrivateKey(unlocked.privateJwk);
  let changed = false;
  state.vaultKeys = new Map();
  for (const m of state.memberships) {
    const cached = unlocked.vaultKeys[m.vault_id];
    if (cached) {
      state.vaultKeys.set(m.vault_id, await importKeyB64(cached));
    } else {
      try {
        const key = await unwrapVaultKey(priv, m.wrapped_key);
        unlocked.vaultKeys[m.vault_id] = await exportKeyB64(key);
        state.vaultKeys.set(m.vault_id, key);
        changed = true;
      } catch {
        // Wrapped for a previous keypair - a manager must re-add this user.
      }
    }
  }
  if (changed) await keychain.saveUnlocked(unlocked);
  return true;
}

async function fetchItems() {
  const rows = await api.rest('/items?select=id,vault_id,iv,enc_data&order=updated_at.desc');
  const items = [];
  for (const row of rows) {
    const key = state.vaultKeys.get(row.vault_id);
    if (!key) continue;
    try {
      items.push({ id: row.id, vault_id: row.vault_id, data: await decryptJson(key, row.iv, row.enc_data) });
    } catch {
      // Skip anything we cannot decrypt rather than break the list.
    }
  }
  state.items = items;
}

function vaultName(vaultId) {
  const m = state.memberships.find((x) => x.vault_id === vaultId);
  return m?.vaults?.name || 'Vault';
}

function vaultWritable(vaultId) {
  const m = state.memberships.find((x) => x.vault_id === vaultId);
  return m && ['manager', 'editor'].includes(m.role);
}

function sortedVaults() {
  return [...state.memberships].sort((a, b) => {
    if (a.vaults.type !== b.vaults.type) return a.vaults.type === 'personal' ? -1 : 1;
    return a.vaults.name.localeCompare(b.vaults.name);
  });
}

function populateVaultSelects() {
  const filter = $('vault-filter');
  const prev = filter.value;
  filter.innerHTML = '';
  filter.append(new Option('All vaults', 'all'));
  for (const m of sortedVaults()) filter.append(new Option(m.vaults.name, m.vault_id));
  if ([...filter.options].some((o) => o.value === prev)) filter.value = prev;

  const fv = $('f-vault');
  fv.innerHTML = '';
  for (const m of sortedVaults()) {
    if (['manager', 'editor'].includes(m.role)) fv.append(new Option(m.vaults.name, m.vault_id));
  }
}

async function enterMain() {
  await keychain.resetAutoLock();
  await refreshMemberships();
  try {
    await ensurePersonalVault();
  } catch {
    // Non-fatal; retried next open.
  }
  const ok = await ensureVaultKeys();
  if (!ok) return showUnlockScreen();
  await fetchItems();
  try {
    await fetchMonitors();
  } catch {
    state.monitors = []; // table may not exist until migration 002 runs
  }
  populateVaultSelects();
  $('btn-admin').classList.toggle('hidden', !['admin', 'super_admin'].includes(state.profile.role));
  renderList();
  renderMonitorStrip();
  if (await resumePendingPick()) return; // finish an in-progress monitor pick
  showScreen('main');
  autoCaptureMonitors(); // fire-and-forget refresh for the current site
}

// ---------- main list ----------

function entryMatchesHost(entry) {
  if (!state.activeHost || !entry.data.url) return false;
  try {
    const raw = entry.data.url.includes('://') ? entry.data.url : `https://${entry.data.url}`;
    const host = new URL(raw).hostname.replace(/^www\./, '');
    return host === state.activeHost || state.activeHost.endsWith(`.${host}`) || host.endsWith(`.${state.activeHost}`);
  } catch {
    return entry.data.url.toLowerCase().includes(state.activeHost);
  }
}

function renderList() {
  const query = $('search').value.trim().toLowerCase();
  const vaultFilter = $('vault-filter').value || 'all';
  const list = $('entry-list');
  list.innerHTML = '';

  let entries = state.items.filter((e) => vaultFilter === 'all' || e.vault_id === vaultFilter);
  entries.sort((a, b) => (a.data.title || '').localeCompare(b.data.title || ''));
  if (query) {
    entries = entries.filter((e) =>
      [e.data.title, e.data.username, e.data.url].some((f) => (f || '').toLowerCase().includes(query))
    );
  } else {
    entries.sort((a, b) => Number(entryMatchesHost(b)) - Number(entryMatchesHost(a)));
  }

  $('empty-state').classList.toggle('hidden', entries.length > 0);

  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = 'entry';

    const avatar = document.createElement('div');
    avatar.className = 'entry-avatar';
    avatar.textContent = (entry.data.title || '?')[0];

    const info = document.createElement('div');
    info.className = 'entry-info';
    const title = document.createElement('div');
    title.className = 'entry-title';
    title.textContent = entry.data.title || '(untitled)';
    const sub = document.createElement('div');
    sub.className = 'entry-sub';
    sub.textContent = entry.data.username || entry.data.url || '';
    if (!query && entryMatchesHost(entry)) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'this site';
      sub.appendChild(badge);
    }
    const m = state.memberships.find((x) => x.vault_id === entry.vault_id);
    if (m && m.vaults.type === 'shared' && vaultFilter === 'all') {
      const vb = document.createElement('span');
      vb.className = 'badge gray';
      vb.textContent = m.vaults.name;
      sub.appendChild(vb);
    }
    const mon = monitorForEntry(entry);
    if (mon && mon.last_numeric !== null && mon.last_numeric !== undefined) {
      const cb = document.createElement('span');
      cb.className = 'badge' + (monitorIsLow(mon) ? ' low' : ' gray');
      cb.textContent = formatMonitorValue(mon);
      cb.title = `${mon.name} - checked ${timeAgo(mon.last_checked_at)}`;
      sub.appendChild(cb);
    }
    info.append(title, sub);

    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    if (state.activeHost) {
      actions.append(actionBtn('fill', 'Fill on this page', () => fillCredentials(entry)));
    }
    actions.append(
      actionBtn('user', 'Copy username', () => copyText(entry.data.username, 'Username copied')),
      actionBtn('key', 'Copy password', () => copyText(entry.data.password, 'Password copied'))
    );
    if (entry.data.totp) {
      actions.append(actionBtn('shield', 'Copy 2FA code', () => copyTotp(entry)));
    }
    if (vaultWritable(entry.vault_id)) {
      actions.append(actionBtn('pen', 'Edit', () => openEdit(entry.id)));
    }

    li.append(avatar, info, actions);
    list.appendChild(li);
  }
}

function actionBtn(iconName, titleText, onClick) {
  const b = document.createElement('button');
  b.className = 'btn icon';
  b.innerHTML = icon(iconName);
  b.title = titleText;
  b.addEventListener('click', onClick);
  return b;
}

async function copyText(text, message) {
  if (!text) return toast('Nothing to copy');
  await navigator.clipboard.writeText(text);
  toast(message);
  keychain.resetAutoLock();
}

async function copyTotp(entry) {
  const t = await generateTotp(entry.data.totp);
  if (!t) return toast('This entry has an invalid 2FA key');
  await navigator.clipboard.writeText(t.code);
  toast(`2FA code copied - valid ${t.secondsLeft}s`);
  keychain.resetAutoLock();
}

$('search').addEventListener('input', renderList);
$('vault-filter').addEventListener('change', renderList);

$('btn-lock').addEventListener('click', async () => {
  await keychain.lock();
  state.vaultKeys = new Map();
  state.items = [];
  showUnlockScreen();
});

$('btn-add').addEventListener('click', () => openEdit(null));
$('btn-settings').addEventListener('click', () => {
  loadSettingsScreen();
  showScreen('settings');
});
$('btn-admin').addEventListener('click', async () => {
  showScreen('admin');
  await loadAdminScreen();
});
$('btn-theme').addEventListener('click', () =>
  setTheme(state.settings.theme === 'dark' ? 'light' : 'dark', true)
);

// ---------- autofill ----------

// Runs inside the page. Must be self-contained (no outer-scope references).
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

async function fillCredentials(entry) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: injectedFill,
      args: [entry.data.username || '', entry.data.password || ''],
    });
    if (results.some((r) => r.result)) {
      // The 1Password trick: after filling, put the current OTP on the
      // clipboard so the 2FA prompt is just a paste away.
      let msg = 'Filled';
      if (entry.data.totp) {
        const t = await generateTotp(entry.data.totp);
        if (t) {
          await navigator.clipboard.writeText(t.code);
          msg = `Filled - 2FA code copied, paste when asked (${t.secondsLeft}s)`;
        }
      }
      toast(msg);
      keychain.resetAutoLock();
    } else {
      toast('No login fields found on this page');
    }
  } catch {
    toast('Cannot fill on this page');
  }
}

// ---------- add / edit ----------

function openEdit(id) {
  state.editingId = id;
  state.revealPassword = false;
  $('f-password').type = 'password';
  hideError('edit-error');

  const entry = id ? state.items.find((e) => e.id === id) : null;
  $('edit-heading').textContent = entry ? 'Edit entry' : 'Add entry';

  const fv = $('f-vault');
  if (entry) {
    fv.value = entry.vault_id;
  } else {
    const filter = $('vault-filter').value;
    if (filter !== 'all' && vaultWritable(filter)) fv.value = filter;
  }

  $('f-title').value = entry?.data.title || '';
  $('f-url').value = entry?.data.url ?? (entry ? '' : state.activeHost || '');
  $('f-username').value = entry?.data.username || '';
  $('f-password').value = entry?.data.password || '';
  $('f-totp').value = entry?.data.totp || '';
  $('f-notes').value = entry?.data.notes || '';
  updateTotpPreview();

  const del = $('btn-delete');
  del.classList.toggle('hidden', !entry);
  del.textContent = 'Delete';
  del.dataset.confirming = '';

  showScreen('edit');
  setTimeout(() => $('f-title').focus(), 50);
}

$('btn-edit-back').addEventListener('click', () => showScreen('main'));

$('btn-reveal').addEventListener('click', () => {
  state.revealPassword = !state.revealPassword;
  $('f-password').type = state.revealPassword ? 'text' : 'password';
});

$('btn-generate').addEventListener('click', () => {
  const length = Math.min(64, Math.max(8, parseInt($('gen-length').value, 10) || 20));
  $('f-password').value = generatePassword(length, { symbols: $('gen-symbols').checked });
  $('f-password').type = 'text';
  state.revealPassword = true;
});

// Live 2FA code preview while editing (rotates every 30s).
async function updateTotpPreview() {
  const raw = $('f-totp').value.trim();
  const box = $('totp-preview');
  if (!raw) return box.classList.add('hidden');
  box.classList.remove('hidden');
  const t = await generateTotp(raw);
  const codeEl = $('totp-code');
  if (!t) {
    codeEl.textContent = "This doesn't look like a valid 2FA key yet";
    codeEl.classList.add('invalid');
    $('totp-left').textContent = '';
    return;
  }
  codeEl.classList.remove('invalid');
  codeEl.textContent = `${t.code.slice(0, 3)} ${t.code.slice(3)}`;
  $('totp-left').textContent = `renews in ${t.secondsLeft}s`;
}

$('f-totp').addEventListener('input', updateTotpPreview);
setInterval(() => {
  if (!$('screen-edit').classList.contains('hidden')) updateTotpPreview();
}, 1000);

$('btn-save').addEventListener('click', async () => {
  const title = $('f-title').value.trim();
  const vaultId = $('f-vault').value;
  hideError('edit-error');
  if (!title) return showError('edit-error', 'Title is required.');
  if (!vaultId) return showError('edit-error', 'Pick a vault.');
  const key = state.vaultKeys.get(vaultId);
  if (!key) return showError('edit-error', 'Vault key unavailable - relock and unlock again.');

  const totp = $('f-totp').value.trim();
  if (totp && !(await generateTotp(totp))) {
    return showError(
      'edit-error',
      "The 2FA key isn't valid - paste the site's setup key (letters/numbers) or its otpauth:// link."
    );
  }

  const now = new Date().toISOString();
  const existing = state.editingId ? state.items.find((e) => e.id === state.editingId) : null;
  const data = {
    type: 'login',
    title,
    url: $('f-url').value.trim(),
    username: $('f-username').value.trim(),
    password: $('f-password').value,
    totp,
    notes: $('f-notes').value.trim(),
    createdAt: existing?.data.createdAt || now,
    updatedAt: now,
  };

  const btn = $('btn-save');
  btn.disabled = true;
  try {
    const { iv, ct } = await encryptJson(key, data);
    if (existing) {
      await api.rest(`/items?id=eq.${existing.id}`, {
        method: 'PATCH',
        body: { vault_id: vaultId, iv, enc_data: ct },
      });
      existing.vault_id = vaultId;
      existing.data = data;
      api.logEvent('item.update', { item_id: existing.id, vault_id: vaultId });
    } else {
      const [row] = await api.rest('/items?select=id', {
        method: 'POST',
        body: { vault_id: vaultId, iv, enc_data: ct },
        prefer: 'return=representation',
      });
      state.items.push({ id: row.id, vault_id: vaultId, data });
      api.logEvent('item.create', { item_id: row.id, vault_id: vaultId });
    }
    await keychain.resetAutoLock();
    renderList();
    showScreen('main');
    toast('Saved');
  } catch (err) {
    showError('edit-error', err.message);
  } finally {
    btn.disabled = false;
  }
});

$('btn-delete').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1';
    btn.textContent = 'Confirm delete';
    return;
  }
  try {
    await api.rest(`/items?id=eq.${state.editingId}`, { method: 'DELETE' });
    api.logEvent('item.delete', { item_id: state.editingId });
    state.items = state.items.filter((en) => en.id !== state.editingId);
    renderList();
    showScreen('main');
    toast('Entry deleted');
  } catch (err) {
    showError('edit-error', err.message);
  }
});

// ---------- settings ----------

async function loadSettingsScreen() {
  $('set-email').textContent = `Signed in as ${state.profile.email} (${state.profile.role.replace('_', ' ')})`;
  $('set-name').value = state.profile.display_name || '';
  $('set-theme').value = state.settings.theme || 'light';
  $('set-autolock').value = state.settings.autoLockMinutes;
  for (const id of ['cmp-old', 'cmp-new', 'cmp-new2', 'sp-pin', 'sp-pin2']) $(id).value = '';
  hideError('cmp-msg');
  hideError('sp-msg');
  const pinOn = await keychain.hasPin();
  $('sp-status').textContent = pinOn
    ? 'PIN unlock is ON for this browser. Wrong PIN 5 times removes it.'
    : 'No PIN on this browser - unlocking asks for the master password.';
  $('btn-pin-remove').classList.toggle('hidden', !pinOn);
}

$('btn-pin-save').addEventListener('click', async () => {
  hideError('sp-msg');
  try {
    if (!(await savePinAndContinue('sp-pin', 'sp-pin2', 'sp-msg'))) return;
    state.settings.pinOffered = true;
    await keychain.saveSettings(state.settings);
    await loadSettingsScreen();
    toast('PIN saved');
  } catch (err) {
    showError('sp-msg', err.message);
  }
});

$('btn-pin-remove').addEventListener('click', async () => {
  await keychain.clearPin();
  await loadSettingsScreen();
  toast('PIN removed - master password required to unlock');
});

$('btn-settings-back').addEventListener('click', () => showScreen('main'));

$('btn-name-save').addEventListener('click', async () => {
  const display_name = $('set-name').value.trim();
  await api.rest(`/profiles?id=eq.${state.uid}`, { method: 'PATCH', body: { display_name } });
  state.profile.display_name = display_name;
  toast('Name saved');
});

$('set-theme').addEventListener('change', (e) => setTheme(e.target.value, true));

$('btn-autolock-save').addEventListener('click', async () => {
  const minutes = Math.min(240, Math.max(0, parseInt($('set-autolock').value, 10) || 0));
  $('set-autolock').value = minutes;
  state.settings.autoLockMinutes = minutes;
  await keychain.saveSettings(state.settings);
  await keychain.resetAutoLock();
  toast(minutes === 0 ? 'Auto-lock disabled' : `Auto-lock set to ${minutes} min`);
});

$('btn-change-pw').addEventListener('click', async () => {
  hideError('cmp-msg');
  const oldPw = $('cmp-old').value;
  const newPw = $('cmp-new').value;
  if (newPw.length < 10) return showError('cmp-msg', 'New password must be at least 10 characters.');
  if (newPw !== $('cmp-new2').value) return showError('cmp-msg', 'New passwords do not match.');

  const btn = $('btn-change-pw');
  btn.disabled = true;
  btn.textContent = 'Re-encrypting...';
  try {
    const privateJwk = await keychain.decryptPrivateKey(oldPw, state.keyRecord);
    const newRecord = await keychain.reencryptPrivateKey(privateJwk, newPw);
    await api.rest(`/user_keys?user_id=eq.${state.uid}`, { method: 'PATCH', body: newRecord });
    state.keyRecord = newRecord;
    api.logEvent('keys.master_password_changed');
    for (const id of ['cmp-old', 'cmp-new', 'cmp-new2']) $(id).value = '';
    showError('cmp-msg', 'Master password changed.', true);
  } catch {
    showError('cmp-msg', 'Current master password is incorrect.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Change password';
  }
});

// ---------- admin ----------

async function loadAdminScreen() {
  try {
    await Promise.all([loadAdminUsers(), loadAdminInvites()]);
    populateManagedVaults();
    await loadVaultMembers();
  } catch (err) {
    toast(err.message);
  }
}

async function loadAdminUsers() {
  state.adminProfiles = await api.rest(
    '/profiles?select=id,email,display_name,role,status,public_key&order=email'
  );
  const box = $('admin-users');
  box.innerHTML = '';
  const isSuper = state.profile.role === 'super_admin';

  for (const p of state.adminProfiles) {
    const row = document.createElement('div');
    row.className = 'person';

    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = (p.display_name || p.email) + (p.id === state.uid ? ' (you)' : '');
    const small = document.createElement('small');
    small.textContent = `${p.email} - ${p.role.replace('_', ' ')} - ${p.status}`;
    who.appendChild(small);
    row.appendChild(who);

    if (p.role !== 'super_admin' && p.id !== state.uid) {
      if (p.status === 'pending') {
        row.appendChild(adminActionBtn('Approve', p.id, null, 'active'));
        row.appendChild(adminActionBtn('Reject', p.id, null, 'disabled'));
      } else if (p.status === 'active') {
        row.appendChild(adminActionBtn('Disable', p.id, null, 'disabled'));
        if (isSuper) {
          row.appendChild(
            adminActionBtn(p.role === 'admin' ? 'Make member' : 'Make admin', p.id,
              p.role === 'admin' ? 'member' : 'admin', null)
          );
        }
      } else {
        row.appendChild(adminActionBtn('Enable', p.id, null, 'active'));
      }
    }
    box.appendChild(row);
  }
}

function adminActionBtn(label, targetId, newRole, newStatus) {
  const b = document.createElement('button');
  b.className = 'btn small';
  b.textContent = label;
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await api.rpc('admin_update_user', { target_id: targetId, new_role: newRole, new_status: newStatus });
      api.logEvent('user.admin_update', { target_id: targetId, new_role: newRole, new_status: newStatus });
      await loadAdminUsers();
      toast('Updated');
    } catch (err) {
      toast(err.message);
      b.disabled = false;
    }
  });
  return b;
}

async function loadAdminInvites() {
  const invites = await api.rest('/invites?select=email,role&order=email');
  const box = $('invite-list');
  box.innerHTML = '';
  for (const inv of invites) {
    const row = document.createElement('div');
    row.className = 'person';
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = `${inv.email} (${inv.role})`;
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = 'Remove';
    b.addEventListener('click', async () => {
      await api.rest(`/invites?email=eq.${encodeURIComponent(inv.email)}`, { method: 'DELETE' });
      api.logEvent('invite.delete', { email: inv.email });
      loadAdminInvites();
    });
    row.append(who, b);
    box.appendChild(row);
  }
}

$('btn-invite').addEventListener('click', async () => {
  const email = $('inv-email').value.trim().toLowerCase();
  if (!email || !email.includes('@')) return toast('Enter a valid email');
  try {
    await api.rest('/invites', { method: 'POST', body: { email, role: $('inv-role').value } });
    api.logEvent('invite.create', { email });
    $('inv-email').value = '';
    await loadAdminInvites();
    toast(`Invited ${email}`);
  } catch (err) {
    toast(err.message);
  }
});

$('btn-create-vault').addEventListener('click', async () => {
  const name = $('nv-name').value.trim();
  if (!name) return toast('Give the vault a name');
  try {
    const vaultKey = await generateVaultKey();
    const wrapped = await wrapVaultKey(state.profile.public_key, vaultKey);
    const [v] = await api.rest('/vaults?select=id', {
      method: 'POST',
      body: { name, type: 'shared' },
      prefer: 'return=representation',
    });
    await api.rest('/vault_members', {
      method: 'POST',
      body: { vault_id: v.id, user_id: state.uid, role: 'manager', wrapped_key: wrapped },
    });
    api.logEvent('vault.create', { vault_id: v.id, name });
    $('nv-name').value = '';
    await refreshMemberships();
    await ensureVaultKeys();
    populateVaultSelects();
    populateManagedVaults();
    await loadVaultMembers();
    toast(`Vault "${name}" created`);
  } catch (err) {
    toast(err.message);
  }
});

function managedVaults() {
  return sortedVaults().filter((m) => m.role === 'manager' && m.vaults.type === 'shared');
}

function populateManagedVaults() {
  const sel = $('mv-vault');
  const prev = sel.value;
  sel.innerHTML = '';
  for (const m of managedVaults()) sel.append(new Option(m.vaults.name, m.vault_id));
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  const has = sel.options.length > 0;
  $('btn-vault-delete').classList.toggle('hidden', !has);
  $('btn-vault-delete').textContent = 'Delete this vault';
  $('btn-vault-delete').dataset.confirming = '';
}

async function loadVaultMembers() {
  const vaultId = $('mv-vault').value;
  const list = $('mv-list');
  const userSel = $('mv-user');
  list.innerHTML = '';
  userSel.innerHTML = '';
  if (!vaultId) return;

  const members = await api.rest(
    `/vault_members?vault_id=eq.${vaultId}&select=user_id,role,profiles(email,display_name)`
  );

  for (const mem of members) {
    const row = document.createElement('div');
    row.className = 'person';
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = `${mem.profiles?.display_name || mem.profiles?.email || mem.user_id} (${mem.role})`;
    row.appendChild(who);
    if (mem.user_id !== state.uid) {
      const b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = 'Remove';
      b.addEventListener('click', async () => {
        await api.rest(`/vault_members?vault_id=eq.${vaultId}&user_id=eq.${mem.user_id}`, { method: 'DELETE' });
        api.logEvent('member.remove', { vault_id: vaultId, user_id: mem.user_id });
        loadVaultMembers();
      });
      row.appendChild(b);
    }
    list.appendChild(row);
  }

  const memberIds = new Set(members.map((m) => m.user_id));
  for (const p of state.adminProfiles) {
    if (p.status === 'active' && p.public_key && !memberIds.has(p.id)) {
      userSel.append(new Option(p.display_name || p.email, p.id));
    }
  }
}

$('mv-vault').addEventListener('change', loadVaultMembers);

$('btn-mv-add').addEventListener('click', async () => {
  const vaultId = $('mv-vault').value;
  const userId = $('mv-user').value;
  if (!vaultId || !userId) return toast('Pick a vault and a user');
  const vaultKey = state.vaultKeys.get(vaultId);
  if (!vaultKey) return toast('Vault key unavailable - lock and unlock again');
  try {
    const target = state.adminProfiles.find((p) => p.id === userId);
    const wrapped = await wrapVaultKey(target.public_key, vaultKey);
    await api.rest('/vault_members', {
      method: 'POST',
      body: { vault_id: vaultId, user_id: userId, role: $('mv-role').value, wrapped_key: wrapped },
    });
    api.logEvent('member.add', { vault_id: vaultId, user_id: userId, role: $('mv-role').value });
    await loadVaultMembers();
    toast('Member added');
  } catch (err) {
    toast(err.message);
  }
});

$('btn-vault-delete').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const vaultId = $('mv-vault').value;
  if (!vaultId) return;
  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1';
    btn.textContent = 'Click again to delete vault + all its entries';
    return;
  }
  try {
    await api.rest(`/vaults?id=eq.${vaultId}`, { method: 'DELETE' });
    api.logEvent('vault.delete', { vault_id: vaultId });
    await refreshMemberships();
    await ensureVaultKeys();
    await fetchItems();
    populateVaultSelects();
    populateManagedVaults();
    await loadVaultMembers();
    renderList();
    toast('Vault deleted');
  } catch (err) {
    toast(err.message);
  }
});

$('btn-admin-back').addEventListener('click', () => showScreen('main'));

// ---------- tool credit monitors ----------

function monitorHost(url) {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

async function fetchMonitors() {
  state.monitors = await api.rest('/tool_monitors?select=*&order=name');
}

function formatMonitorValue(mon) {
  if (mon.last_numeric === null || mon.last_numeric === undefined) {
    return mon.last_value || 'no reading yet';
  }
  const n = Number(mon.last_numeric).toLocaleString();
  return mon.unit ? `${n} ${mon.unit}` : n;
}

function monitorIsLow(mon) {
  return (
    mon.threshold !== null &&
    mon.threshold !== undefined &&
    mon.last_numeric !== null &&
    mon.last_numeric !== undefined &&
    Number(mon.last_numeric) < Number(mon.threshold)
  );
}

function timeAgo(iso) {
  if (!iso) return 'never checked';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Compact credits strip shown at the top of the main vault screen.
function renderMonitorStrip() {
  const strip = $('monitor-strip');
  strip.innerHTML = '';
  strip.classList.toggle('hidden', state.monitors.length === 0);
  for (const mon of state.monitors) {
    const chip = document.createElement('button');
    chip.className = 'mon-chip' + (monitorIsLow(mon) ? ' low' : '');
    chip.title = `${mon.name} - checked ${timeAgo(mon.last_checked_at)}. Click to manage monitors.`;
    const name = document.createElement('span');
    name.textContent = mon.name;
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent =
      mon.last_numeric === null || mon.last_numeric === undefined
        ? '—'
        : formatMonitorValue(mon);
    chip.append(name, val);
    chip.addEventListener('click', () => {
      renderMonitors();
      showScreen('monitors');
    });
    strip.appendChild(chip);
  }
}

// Monitor whose host matches an entry's site, if any.
function monitorForEntry(entry) {
  if (!entry.data.url) return null;
  let host;
  try {
    const raw = entry.data.url.includes('://') ? entry.data.url : `https://${entry.data.url}`;
    host = new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  return (
    state.monitors.find((m) => {
      const mh = monitorHost(m.url);
      return mh && (mh === host || mh.endsWith(`.${host}`) || host.endsWith(`.${mh}`));
    }) || null
  );
}

function renderMonitors() {
  renderMonitorStrip();
  const list = $('monitor-list');
  list.innerHTML = '';
  $('monitors-empty').classList.toggle('hidden', state.monitors.length > 0);

  for (const mon of state.monitors) {
    const row = document.createElement('div');
    row.className = 'person';

    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = mon.name;
    if (monitorIsLow(mon)) {
      const b = document.createElement('span');
      b.className = 'badge low';
      b.textContent = 'low';
      who.appendChild(b);
    }
    const small = document.createElement('small');
    small.textContent = `${monitorHost(mon.url) || mon.url}${mon.kind === 'api' ? ' - API' : ''} - ${timeAgo(mon.last_checked_at)}`;
    who.appendChild(small);

    const value = document.createElement('div');
    value.className = 'mon-value' + (monitorIsLow(mon) ? ' low' : '');
    value.textContent = formatMonitorValue(mon);

    const refresh = actionBtn('refresh', 'Refresh now', async () => {
      if (await captureMonitor(mon)) renderMonitors();
    });
    const edit = actionBtn('pen', 'Edit monitor', () => openMonitorEdit(mon.id));

    row.append(who, value, refresh, edit);
    list.appendChild(row);
  }
}

// Runs inside the dashboard page: find the tracked element and read it.
function injectedExtract(selector, keyword) {
  const parseNum = (t) => {
    const m = (t || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  };
  let el = null;
  if (selector) {
    try {
      el = document.querySelector(selector);
    } catch {
      /* stale selector */
    }
  }
  if (!el && keyword) {
    // Most specific (shortest) element containing the keyword and a digit.
    const kw = keyword.toLowerCase();
    let best = null;
    for (const node of document.body.querySelectorAll('*')) {
      const text = (node.textContent || '').trim();
      if (!text || text.length > 120) continue;
      if (text.toLowerCase().includes(kw) && /\d/.test(text)) {
        if (!best || text.length < best.text.length) best = { node, text };
      }
    }
    el = best && best.node;
  }
  if (!el) return null;
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  return { text, numeric: parseNum(text) };
}

// Decrypt an API monitor's {apiUrl, apiKey, jsonPath} - only possible
// for members of the vault that holds the key.
async function decryptApiConfig(mon) {
  if (mon.kind !== 'api' || !mon.api_enc || !mon.api_vault_id) return null;
  const key = state.vaultKeys.get(mon.api_vault_id);
  if (!key) return null;
  try {
    return await decryptJson(key, mon.api_iv, mon.api_enc);
  } catch {
    return null;
  }
}

// "a.b.0.c" -> obj.a.b[0].c
function pluck(obj, path) {
  if (!path) return obj;
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part.trim()];
  }
  return cur;
}

async function ensureOriginPermission(apiUrl, interactive) {
  const origin = `${new URL(apiUrl).origin}/*`;
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  if (!interactive) return false;
  return chrome.permissions.request({ origins: [origin] });
}

// Calls the tool's API and extracts the number. Throws readable errors.
async function fetchApiValue(cfg, { interactive = false } = {}) {
  if (!(await ensureOriginPermission(cfg.apiUrl, interactive))) {
    throw new Error(
      `OptiPass needs permission to contact ${new URL(cfg.apiUrl).hostname} - press Test once to grant it.`
    );
  }
  const res = await fetch(cfg.apiUrl, {
    headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`API answered ${res.status}: ${text.slice(0, 140)}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`API did not return JSON: ${text.slice(0, 140)}`);
  }
  const v = pluck(json, (cfg.jsonPath || '').trim());
  if (v === undefined || v === null) {
    throw new Error(
      `Field "${cfg.jsonPath}" not found. Response starts: ${JSON.stringify(json).slice(0, 180)}`
    );
  }
  const numeric = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  if (Number.isNaN(numeric)) {
    throw new Error(
      `Field "${cfg.jsonPath}" contains "${String(v).slice(0, 60)}" - that's not a number, so it can't be monitored. (Handy for discovering ids, though.)`
    );
  }
  return { value: v, numeric };
}

async function captureMonitor(mon, { silent = false } = {}) {
  try {
    let patch;
    if (mon.kind === 'api') {
      const cfg = await decryptApiConfig(mon);
      if (!cfg) {
        if (!silent) toast("You aren't in the vault holding this monitor's API key");
        return false;
      }
      const r = await fetchApiValue(cfg, { interactive: !silent });
      patch = { last_value: String(r.value), last_numeric: r.numeric };
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) return false;
      const tabHost = new URL(tab.url).hostname.replace(/^www\./, '');
      if (monitorHost(mon.url) !== tabHost) {
        if (!silent) toast(`Open ${monitorHost(mon.url)} in this tab first`);
        return false;
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: injectedExtract,
        args: [mon.selector || '', mon.keyword || ''],
      });
      const r = results.map((x) => x.result).find(Boolean);
      if (!r || r.numeric === null) {
        if (!silent) toast('Could not find the value on this page');
        return false;
      }
      patch = { last_value: r.text, last_numeric: r.numeric };
    }
    patch.last_checked_at = new Date().toISOString();
    patch.last_checked_by = state.uid;
    await api.rest(`/tool_monitors?id=eq.${mon.id}`, { method: 'PATCH', body: patch });
    Object.assign(mon, patch);
    if (!silent) toast(`${mon.name}: ${formatMonitorValue(mon)}`);
    return true;
  } catch (err) {
    if (!silent) toast(err.message || 'Capture failed');
    return false;
  }
}

// Quiet refresh when the popup opens: page monitors when we're on their
// site; API monitors from anywhere once the reading is >15 min old.
async function autoCaptureMonitors() {
  for (const mon of state.monitors) {
    if (mon.kind === 'api') {
      const age = mon.last_checked_at
        ? Date.now() - new Date(mon.last_checked_at).getTime()
        : Infinity;
      if (age < 15 * 60 * 1000) continue;
    } else {
      if (!state.activeHost || monitorHost(mon.url) !== state.activeHost) continue;
    }
    if (await captureMonitor(mon, { silent: true })) {
      toast(`${mon.name}: ${formatMonitorValue(mon)}${monitorIsLow(mon) ? ' - LOW' : ''}`);
      renderMonitorStrip();
      renderList();
    }
  }
}

async function openMonitorEdit(id, prefill = null) {
  state.editingMonitorId = id;
  state.apiConfigLocked = false;
  const mon = id ? state.monitors.find((m) => m.id === id) : null;
  const src = prefill || mon || {};
  $('monitor-edit-heading').textContent = mon ? 'Edit monitor' : 'Add monitor';
  $('m-name').value = src.name || '';
  $('m-url').value = src.url || state.activeUrl || '';
  $('m-keyword').value = src.keyword || '';
  $('m-unit').value = src.unit || '';
  $('m-threshold').value = src.threshold ?? '';
  $('m-kind').value = src.kind || 'page';

  // Vault options for holding an API key
  const vaultSel = $('m-api-vault');
  vaultSel.innerHTML = '';
  for (const m of sortedVaults()) vaultSel.append(new Option(m.vaults.name, m.vault_id));

  $('m-api-url').value = '';
  $('m-api-key').value = '';
  $('m-api-path').value = '';
  hideError('m-api-result');
  if (mon && mon.kind === 'api') {
    if ([...vaultSel.options].some((o) => o.value === mon.api_vault_id)) {
      vaultSel.value = mon.api_vault_id;
    }
    const cfg = await decryptApiConfig(mon);
    if (cfg) {
      $('m-api-url').value = cfg.apiUrl || '';
      $('m-api-key').value = cfg.apiKey || '';
      $('m-api-path').value = cfg.jsonPath || '';
    } else {
      state.apiConfigLocked = true;
      showError(
        'm-api-result',
        "You aren't in the vault holding this monitor's API key, so only a member of that vault can edit it."
      );
    }
  }

  $('m-picked').classList.add('hidden');
  if (src.selector) {
    $('m-picked').textContent = prefill?.pickedText
      ? `Picked: "${prefill.pickedText}"`
      : 'A picked element is saved for this monitor.';
    $('m-picked').classList.remove('hidden');
  }
  $('m-picked').dataset.selector = src.selector || '';
  hideError('monitor-error');
  updateMonitorKindUI();
  const del = $('btn-monitor-delete');
  del.classList.toggle('hidden', !mon);
  del.textContent = 'Delete';
  del.dataset.confirming = '';
  showScreen('monitor-edit');
}

function updateMonitorKindUI() {
  const isApi = $('m-kind').value === 'api';
  $('m-page-fields').classList.toggle('hidden', isApi);
  $('m-api-fields').classList.toggle('hidden', !isApi);
}

$('m-kind').addEventListener('change', updateMonitorKindUI);

$('btn-api-test').addEventListener('click', async () => {
  hideError('m-api-result');
  const cfg = {
    apiUrl: $('m-api-url').value.trim(),
    apiKey: $('m-api-key').value.trim(),
    jsonPath: $('m-api-path').value.trim(),
  };
  if (!/^https:\/\//.test(cfg.apiUrl)) return showError('m-api-result', 'Enter the full https:// API URL.');
  if (!cfg.apiKey) return showError('m-api-result', 'Paste the API key.');
  const btn = $('btn-api-test');
  btn.disabled = true;
  try {
    const r = await fetchApiValue(cfg, { interactive: true });
    showError('m-api-result', `Found: ${r.numeric.toLocaleString()} (raw value: ${JSON.stringify(r.value)})`, true);
  } catch (err) {
    showError('m-api-result', err.message);
  } finally {
    btn.disabled = false;
  }
});

// Element picker injected into the page. The popup closes when the user
// clicks the page, so the result goes to the background worker and is
// collected next time the popup opens (resumePendingPick).
function injectedPicker() {
  if (window.__optipassPicker) return;
  window.__optipassPicker = true;
  const Z = 2147483647;
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;pointer-events:none;z-index:${Z};border:2px solid #5551d8;background:rgba(85,81,216,.12);border-radius:4px;`;
  const tip = document.createElement('div');
  tip.style.cssText = `position:fixed;z-index:${Z};background:#23221f;color:#fff;font:12px/1.5 sans-serif;padding:6px 12px;border-radius:8px;pointer-events:none;max-width:320px;`;
  tip.textContent = 'OptiPass: click the number showing the remaining credits (Esc to cancel)';
  document.body.append(overlay, tip);

  const cssPath = (el) => {
    const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      if (node.id) {
        parts.unshift(`#${esc(node.id)}`);
        break;
      }
      let part = node.tagName.toLowerCase();
      const cls = [...node.classList].slice(0, 2).map((c) => `.${esc(c)}`).join('');
      part += cls;
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    // Shortest suffix of the path that still uniquely finds the element.
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidate = parts.slice(i).join(' > ');
      try {
        if (document.querySelector(candidate) === el) return candidate;
      } catch {
        /* try longer */
      }
    }
    return parts.join(' > ');
  };

  const move = (e) => {
    const r = e.target.getBoundingClientRect();
    overlay.style.left = `${r.left - 2}px`;
    overlay.style.top = `${r.top - 2}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.height = `${r.height}px`;
    tip.style.left = `${Math.min(e.clientX + 14, innerWidth - 340)}px`;
    tip.style.top = `${Math.min(e.clientY + 18, innerHeight - 60)}px`;
  };
  const key = (e) => {
    if (e.key === 'Escape') cleanup();
  };
  const click = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    const m = text.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    chrome.runtime.sendMessage({
      type: 'optipass-monitor-pick',
      payload: {
        selector: cssPath(el),
        text,
        numeric: m ? parseFloat(m[0]) : null,
        url: location.href.split('#')[0],
        title: document.title,
      },
    });
    cleanup();
    const ok = document.createElement('div');
    ok.style.cssText = `position:fixed;top:16px;right:16px;z-index:${Z};background:#23221f;color:#fff;font:13px sans-serif;padding:10px 18px;border-radius:999px;`;
    ok.textContent = 'Captured - reopen OptiPass to finish';
    document.body.appendChild(ok);
    setTimeout(() => ok.remove(), 4000);
  };
  const cleanup = () => {
    overlay.remove();
    tip.remove();
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key, true);
    window.__optipassPicker = false;
  };
  document.addEventListener('mousemove', move, true);
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', key, true);
}

async function resumePendingPick() {
  const o = await chrome.storage.session.get(['optipass_pending_pick', 'optipass_monitor_draft']);
  const pick = o.optipass_pending_pick;
  if (!pick) return false;
  await chrome.storage.session.remove(['optipass_pending_pick', 'optipass_monitor_draft']);
  const draft = o.optipass_monitor_draft || {};
  await openMonitorEdit(draft.id || null, {
    name: draft.name || (pick.title || '').split(/[|\-–—:·]/)[0].trim().slice(0, 40),
    url: draft.url || pick.url,
    selector: pick.selector,
    keyword: draft.keyword || '',
    unit: draft.unit || '',
    threshold: draft.threshold || '',
    pickedText: pick.text,
  });
  return true;
}

$('btn-monitors').addEventListener('click', async () => {
  try {
    await fetchMonitors();
  } catch {
    toast('Run migration-002-tool-monitors.sql in Supabase first');
  }
  renderMonitors();
  showScreen('monitors');
});

$('btn-monitors-back').addEventListener('click', () => showScreen('main'));
$('btn-monitor-add').addEventListener('click', () => openMonitorEdit(null));
$('btn-monitor-edit-back').addEventListener('click', () => {
  renderMonitors();
  showScreen('monitors');
});

$('btn-monitor-pick').addEventListener('click', async () => {
  await chrome.storage.session.set({
    optipass_monitor_draft: {
      id: state.editingMonitorId,
      name: $('m-name').value,
      url: $('m-url').value,
      keyword: $('m-keyword').value,
      unit: $('m-unit').value,
      threshold: $('m-threshold').value,
    },
  });
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: injectedPicker });
    window.close(); // hand control to the page; the pick resumes on reopen
  } catch {
    showError('monitor-error', 'Cannot pick on this page - open the tool dashboard in the active tab.');
  }
});

$('btn-monitor-save').addEventListener('click', async () => {
  hideError('monitor-error');
  const kind = $('m-kind').value;
  const name = $('m-name').value.trim();
  if (!name) return showError('monitor-error', 'Name the tool.');
  const thr = $('m-threshold').value;
  const body = {
    name,
    kind,
    unit: $('m-unit').value.trim() || null,
    threshold: thr === '' ? null : Number(thr),
  };

  if (kind === 'page') {
    const url = $('m-url').value.trim();
    const keyword = $('m-keyword').value.trim();
    const selector = $('m-picked').dataset.selector || '';
    if (!url) return showError('monitor-error', 'The dashboard URL is required.');
    if (!selector && !keyword) {
      return showError('monitor-error', 'Pick the number on the page, or give a keyword to find it by.');
    }
    Object.assign(body, {
      url,
      selector: selector || null,
      keyword: keyword || null,
      api_vault_id: null,
      api_iv: null,
      api_enc: null,
    });
  } else {
    if (state.apiConfigLocked) {
      return showError('monitor-error', "Only a member of the key's vault can edit this monitor.");
    }
    const cfg = {
      apiUrl: $('m-api-url').value.trim(),
      apiKey: $('m-api-key').value.trim(),
      jsonPath: $('m-api-path').value.trim(),
    };
    if (!/^https:\/\//.test(cfg.apiUrl)) return showError('monitor-error', 'Enter the full https:// API URL.');
    if (!cfg.apiKey) return showError('monitor-error', 'Paste the API key.');
    const vaultId = $('m-api-vault').value;
    const vaultKey = state.vaultKeys.get(vaultId);
    if (!vaultKey) return showError('monitor-error', 'Pick a vault for the key.');
    const { iv, ct } = await encryptJson(vaultKey, cfg);
    Object.assign(body, {
      url: new URL(cfg.apiUrl).origin,
      selector: null,
      keyword: null,
      api_vault_id: vaultId,
      api_iv: iv,
      api_enc: ct,
    });
  }
  try {
    let mon;
    if (state.editingMonitorId) {
      await api.rest(`/tool_monitors?id=eq.${state.editingMonitorId}`, { method: 'PATCH', body });
      mon = state.monitors.find((m) => m.id === state.editingMonitorId);
      Object.assign(mon, body);
    } else {
      const [row] = await api.rest('/tool_monitors?select=*', {
        method: 'POST',
        body,
        prefer: 'return=representation',
      });
      state.monitors.push(row);
      state.monitors.sort((a, b) => a.name.localeCompare(b.name));
      mon = row;
      api.logEvent('monitor.create', { monitor_id: row.id, name });
    }
    await captureMonitor(mon, { silent: true }); // grab a first reading if the tab matches
    renderMonitors();
    showScreen('monitors');
    toast('Monitor saved');
  } catch (err) {
    showError('monitor-error', err.message);
  }
});

$('btn-monitor-delete').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1';
    btn.textContent = 'Confirm delete';
    return;
  }
  try {
    await api.rest(`/tool_monitors?id=eq.${state.editingMonitorId}`, { method: 'DELETE' });
    api.logEvent('monitor.delete', { monitor_id: state.editingMonitorId });
    state.monitors = state.monitors.filter((m) => m.id !== state.editingMonitorId);
    renderMonitors();
    showScreen('monitors');
    toast('Monitor deleted');
  } catch (err) {
    showError('monitor-error', err.message);
  }
});

// ---------- go ----------

boot();
