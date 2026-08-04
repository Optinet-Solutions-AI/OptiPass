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
import { getVersions, newer } from '../lib/updates.js';

const $ = (id) => document.getElementById(id);

// Toolbar popups are force-closed by Chrome on any outside click, which
// breaks pick-the-number flows. window=1 marks a dedicated window that
// stays open while the user clicks around the page.
const IN_WINDOW = new URLSearchParams(location.search).has('window');
if (IN_WINDOW) document.documentElement.classList.add('windowed');

function openOwnWindow() {
  chrome.windows.create({
    url: chrome.runtime.getURL('popup/popup.html?window=1'),
    type: 'popup',
    width: 430,
    height: 700,
  });
}

// The page we act on: in the toolbar popup that's the current tab; in
// window mode it's the active tab of the last-focused normal window.
async function getActiveNormalTab() {
  if (!IN_WINDOW) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }
  const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  const [tab] = await chrome.tabs.query({ active: true, windowId: w.id });
  return tab;
}

// Window mode has no activeTab grant, so page access needs a one-time
// host permission (we already declare optional_host_permissions).
async function ensurePageAccess(tab, interactive) {
  if (!IN_WINDOW) return true; // activeTab covers the toolbar popup
  try {
    return await ensureOriginPermission(tab.url, interactive);
  } catch {
    return false;
  }
}

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
  trash:
    '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>',
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
  editMetrics: [], // metric sub-forms while the entry editor is open
  editSecrets: [], // extra API-key secrets while the entry editor is open
};

// ---------- screens / feedback ----------

const SCREENS = ['config', 'login', 'pending', 'master-setup', 'unlock', 'pin-setup', 'main', 'edit', 'settings', 'admin', 'help'];

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
  maybeAutoReload(); // apply new files after a git pull, silently
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
    const tab = await getActiveNormalTab();
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
      const { signedIn } = await api.signUp(email, pw, $('login-invite').value.trim() || undefined);
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
  try {
    await adoptOrphanMonitors(); // attach pre-004 monitors to matching entries
  } catch {
    /* best effort */
  }
  populateVaultSelects();
  populateTagFilter();
  $('btn-admin').classList.toggle('hidden', !['admin', 'super_admin'].includes(state.profile.role));
  renderList();
  if (await resumePendingPick()) return; // finish an in-progress monitor pick
  showScreen('main');
  autoCaptureMonitors(); // fire-and-forget refresh for the current site
  if (!state.settings.tourDone) {
    state.settings.tourDone = true;
    keychain.saveSettings(state.settings);
    startTour();
  }
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

  const tagFilter = $('tag-filter').value || 'all';
  let entries = state.items.filter(
    (e) =>
      (vaultFilter === 'all' || e.vault_id === vaultFilter) &&
      (tagFilter === 'all' || (e.data.tags || []).includes(tagFilter))
  );
  entries.sort((a, b) => (a.data.title || '').localeCompare(b.data.title || ''));
  if (query) {
    entries = entries.filter((e) =>
      [e.data.title, e.data.username, e.data.url, ...(e.data.tags || [])].some((f) =>
        (f || '').toLowerCase().includes(query)
      )
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
    for (const tag of entry.data.tags || []) {
      const tb = document.createElement('span');
      tb.className = 'badge';
      tb.textContent = tag;
      sub.appendChild(tb);
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

    const row = document.createElement('div');
    row.className = 'entry-row';
    row.append(avatar, info, actions);
    li.appendChild(row);

    const mons = monitorsForItem(entry.id);
    if (mons.length) li.appendChild(creditBox(mons));

    list.appendChild(li);
  }
  updateLowBadge();
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
$('tag-filter').addEventListener('change', renderList);

// Label filter options come from the labels present on visible entries.
function populateTagFilter() {
  const sel = $('tag-filter');
  const prev = sel.value;
  const tags = [...new Set(state.items.flatMap((e) => e.data.tags || []))].sort((a, b) =>
    a.localeCompare(b)
  );
  sel.innerHTML = '';
  sel.append(new Option('All labels', 'all'));
  for (const t of tags) sel.append(new Option(t, t));
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  sel.classList.toggle('hidden', tags.length === 0);
}

$('btn-lock').addEventListener('click', async () => {
  await keychain.lock();
  state.vaultKeys = new Map();
  state.items = [];
  showUnlockScreen();
});

$('btn-add').addEventListener('click', () => openEdit(null));
$('btn-window').classList.toggle('hidden', IN_WINDOW);
$('btn-window').addEventListener('click', () => {
  openOwnWindow();
  window.close();
});
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
    const tab = await getActiveNormalTab();
    if (!(await ensurePageAccess(tab, true))) {
      return toast('OptiPass needs permission for that site - approve the prompt and try again.');
    }
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

async function openEdit(id, resume = null) {
  state.editingId = id;
  state.revealPassword = false;
  $('f-password').type = 'password';
  hideError('edit-error');

  const entry = id ? state.items.find((e) => e.id === id) : null;
  $('edit-heading').textContent = entry ? 'Edit entry' : 'Add entry';

  const d = resume?.draft;
  const fv = $('f-vault');
  if (d?.vault && [...fv.options].some((o) => o.value === d.vault)) {
    fv.value = d.vault;
  } else if (entry) {
    fv.value = entry.vault_id;
  } else {
    const filter = $('vault-filter').value;
    if (filter !== 'all' && vaultWritable(filter)) fv.value = filter;
  }

  $('f-title').value = d?.title ?? entry?.data.title ?? '';
  $('f-url').value = d?.url ?? entry?.data.url ?? (entry ? '' : state.activeHost || '');
  $('f-tags').value = d?.tags ?? (entry?.data.tags || []).join(', ');
  $('f-username').value = d?.username ?? entry?.data.username ?? '';
  $('f-password').value = d?.password ?? entry?.data.password ?? '';
  $('f-totp').value = d?.totp ?? entry?.data.totp ?? '';
  $('f-notes').value = d?.notes ?? entry?.data.notes ?? '';
  updateTotpPreview();

  // ----- extra API-key secrets -----
  state.editSecrets = (d?.secrets ?? entry?.data.secrets ?? []).map((s) => ({ ...s }));
  renderSecretList();

  // ----- credit / usage metrics -----
  state.editMetrics = [];
  if (resume?.draft?.metrics) {
    state.editMetrics = resume.draft.metrics;
    const target = state.editMetrics[resume.draft.pickIndex];
    if (target) {
      target.selector = resume.pick.selector;
      target.pickedText = resume.pick.text;
      if (!target.url) target.url = resume.pick.url;
    }
  } else if (id) {
    for (const mon of monitorsForItem(id)) {
      const m = {
        id: mon.id,
        label: mon.name || '',
        kind: mon.kind || 'page',
        url: mon.kind === 'page' ? mon.url || '' : '',
        selector: mon.selector || '',
        pickedText: '',
        keyword: mon.keyword || '',
        apiUrl: '',
        apiKey: '',
        apiPath: '',
        apiVaultId: mon.api_vault_id || fv.value,
        unit: mon.unit || '',
        threshold: mon.threshold ?? '',
        locked: false,
      };
      if (mon.kind === 'api') {
        const cfg = await decryptApiConfig(mon);
        if (cfg) {
          m.apiUrl = cfg.apiUrl || '';
          m.apiKey = cfg.apiKey || '';
          m.apiPath = cfg.jsonPath || '';
        } else {
          m.locked = true;
        }
      }
      state.editMetrics.push(m);
    }
  }
  renderMetricList();

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

  // Validate every metric sub-form before anything is written.
  const metricBodies = [];
  for (const m of state.editMetrics) {
    if (m.locked) continue; // untouched - only key-vault members may edit
    const label = (m.label || '').trim() || 'Credits';
    const thr = String(m.threshold ?? '').trim();
    const body = {
      name: label,
      kind: m.kind,
      unit: (m.unit || '').trim() || null,
      threshold: thr === '' ? null : Number(thr),
    };
    if (m.kind === 'page') {
      const murl = (m.url || '').trim() || $('f-url').value.trim();
      if (!murl) return showError('edit-error', `"${label}": the dashboard URL is required.`);
      if (!m.selector && !(m.keyword || '').trim()) {
        return showError(
          'edit-error',
          `"${label}": pick the number on the dashboard page, or give a keyword to find it by.`
        );
      }
      Object.assign(body, {
        url: murl,
        selector: m.selector || null,
        keyword: (m.keyword || '').trim() || null,
        api_vault_id: null,
        api_iv: null,
        api_enc: null,
      });
    } else {
      const cfg = {
        apiUrl: (m.apiUrl || '').trim(),
        apiKey: (m.apiKey || '').trim(),
        jsonPath: (m.apiPath || '').trim(),
      };
      if (!/^https:\/\//.test(cfg.apiUrl)) {
        return showError('edit-error', `"${label}": enter the full https:// API URL.`);
      }
      if (!cfg.apiKey) return showError('edit-error', `"${label}": paste the API key.`);
      const keyVaultKey = state.vaultKeys.get(m.apiVaultId);
      if (!keyVaultKey) return showError('edit-error', `"${label}": pick a vault for the key.`);
      const enc = await encryptJson(keyVaultKey, cfg);
      Object.assign(body, {
        url: new URL(cfg.apiUrl).origin,
        selector: null,
        keyword: null,
        api_vault_id: m.apiVaultId,
        api_iv: enc.iv,
        api_enc: enc.ct,
      });
    }
    metricBodies.push({ id: m.id, body });
  }

  const now = new Date().toISOString();
  const existing = state.editingId ? state.items.find((e) => e.id === state.editingId) : null;
  const data = {
    type: 'login',
    title,
    url: $('f-url').value.trim(),
    tags: [...new Set($('f-tags').value.split(',').map((t) => t.trim()).filter(Boolean))],
    username: $('f-username').value.trim(),
    password: $('f-password').value,
    totp,
    secrets: state.editSecrets
      .map((s) => ({ label: (s.label || '').trim(), value: s.value || '' }))
      .filter((s) => s.label || s.value),
    notes: $('f-notes').value.trim(),
    createdAt: existing?.data.createdAt || now,
    updatedAt: now,
  };

  const btn = $('btn-save');
  btn.disabled = true;
  try {
    const { iv, ct } = await encryptJson(key, data);
    let itemId;
    if (existing) {
      await api.rest(`/items?id=eq.${existing.id}`, {
        method: 'PATCH',
        body: { vault_id: vaultId, iv, enc_data: ct },
      });
      existing.vault_id = vaultId;
      existing.data = data;
      itemId = existing.id;
      api.logEvent('item.update', { item_id: itemId, vault_id: vaultId });
    } else {
      const [row] = await api.rest('/items?select=id', {
        method: 'POST',
        body: { vault_id: vaultId, iv, enc_data: ct },
        prefer: 'return=representation',
      });
      state.items.push({ id: row.id, vault_id: vaultId, data });
      itemId = row.id;
      api.logEvent('item.create', { item_id: itemId, vault_id: vaultId });
    }

    // Metrics: upsert every sub-form, delete the removed ones.
    let saveMsg = 'Saved';
    try {
      const keepIds = new Set(state.editMetrics.filter((m) => m.id).map((m) => m.id));
      for (const em of monitorsForItem(itemId)) {
        if (!keepIds.has(em.id)) {
          await api.rest(`/tool_monitors?id=eq.${em.id}`, { method: 'DELETE' });
          state.monitors = state.monitors.filter((x) => x.id !== em.id);
        }
      }
      for (const { id: monId, body } of metricBodies) {
        body.item_id = itemId;
        if (monId) {
          await api.rest(`/tool_monitors?id=eq.${monId}`, { method: 'PATCH', body });
          const mon = state.monitors.find((x) => x.id === monId);
          if (mon) {
            Object.assign(mon, body);
            captureMonitor(mon, { silent: true }).then((ok) => ok && renderList());
          }
        } else {
          const [monRow] = await api.rest('/tool_monitors?select=*', {
            method: 'POST',
            body,
            prefer: 'return=representation',
          });
          state.monitors.push(monRow);
          api.logEvent('monitor.create', { monitor_id: monRow.id, item_id: itemId });
          captureMonitor(monRow, { silent: true }).then((ok) => ok && renderList());
        }
      }
    } catch (err) {
      saveMsg = `Entry saved, but monitors failed: ${err.message}`;
    }

    await keychain.resetAutoLock();
    populateTagFilter();
    renderList();
    showScreen('main');
    toast(saveMsg);
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
  $('set-autoupdate').checked = state.settings.autoUpdate !== false;
  $('set-alerts').checked = state.settings.alertsBadge !== false;
  $('upd-status').textContent = `Running v${chrome.runtime.getManifest().version}`;
  $('btn-reload-ext').classList.add('hidden');
}

$('set-autoupdate').addEventListener('change', async (e) => {
  state.settings.autoUpdate = e.target.checked;
  await keychain.saveSettings(state.settings);
});

$('set-alerts').addEventListener('change', async (e) => {
  state.settings.alertsBadge = e.target.checked;
  await keychain.saveSettings(state.settings);
  updateLowBadge();
});

$('btn-check-updates').addEventListener('click', async () => {
  $('upd-status').textContent = 'Checking...';
  const { running, disk, remote } = await getVersions();
  if (disk && disk !== running) {
    $('btn-reload-ext').classList.remove('hidden');
    $('upd-status').textContent = `v${disk} is ready in the folder - click Reload now to apply.`;
  } else if (remote && newer(remote, running)) {
    $('upd-status').textContent = `v${remote} is available. Run "git pull" in the OptiPass folder (or re-download it) and it applies automatically.`;
  } else {
    $('upd-status').textContent = `Up to date - v${running}.`;
  }
});

$('btn-reload-ext').addEventListener('click', () => chrome.runtime.reload());
$('btn-help').addEventListener('click', () => showScreen('help'));
$('btn-help-back').addEventListener('click', () => showScreen('settings'));
$('btn-tour').addEventListener('click', () => {
  showScreen('main');
  startTour();
});
$('btn-help-tour').addEventListener('click', () => {
  showScreen('main');
  startTour();
});

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
  const invites = await api.rest('/invites?select=*&order=email');
  const box = $('invite-list');
  box.innerHTML = '';
  for (const inv of invites) {
    const row = document.createElement('div');
    row.className = 'person';
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = `${inv.email} (${inv.role})`;
    row.appendChild(who);
    if (inv.code) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn small';
      copyBtn.textContent = 'Copy code';
      copyBtn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(inv.code);
        toast('Invite code copied - send it to your teammate');
      });
      row.appendChild(copyBtn);
    }
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = 'Remove';
    b.addEventListener('click', async () => {
      await api.rest(`/invites?email=eq.${encodeURIComponent(inv.email)}`, { method: 'DELETE' });
      api.logEvent('invite.delete', { email: inv.email });
      loadAdminInvites();
    });
    row.appendChild(b);
    box.appendChild(row);
  }
}

$('btn-invite').addEventListener('click', async () => {
  const email = $('inv-email').value.trim().toLowerCase();
  if (!email || !email.includes('@')) return toast('Enter a valid email');
  try {
    const [inv] = await api.rest('/invites?select=*', {
      method: 'POST',
      body: { email, role: $('inv-role').value },
      prefer: 'return=representation',
    });
    api.logEvent('invite.create', { email });
    $('inv-email').value = '';
    await loadAdminInvites();
    if (inv?.code) {
      await navigator.clipboard.writeText(inv.code);
      toast(`Invited ${email} - invite code copied to clipboard`);
    } else {
      toast(`Invited ${email}`);
    }
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

// Red count badge on the toolbar icon when any metric is LOW.
function updateLowBadge() {
  if (state.settings.alertsBadge === false) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const low = state.monitors.filter(monitorIsLow).length;
  chrome.action.setBadgeBackgroundColor({ color: '#b4544a' });
  chrome.action.setBadgeText({ text: low > 0 ? String(low) : '' });
}

// After a git pull the folder holds a newer manifest than the running
// code - reload to apply it (the "no reinstall, no refresh" update).
async function maybeAutoReload() {
  if (state.settings.autoUpdate === false) return;
  try {
    const disk = (await (await fetch(chrome.runtime.getURL('manifest.json'))).json()).version;
    if (disk && disk !== chrome.runtime.getManifest().version) chrome.runtime.reload();
  } catch {
    /* ignore */
  }
}

function timeAgo(iso) {
  if (!iso) return 'never checked';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function monitorsForItem(itemId) {
  return state.monitors.filter((m) => m.item_id === itemId);
}

// The "own box" under an entry: one row per tracked metric
// (e.g. Credits and Bandwidth for a proxy).
function creditBox(mons) {
  const box = document.createElement('div');
  box.className = 'credit-box';
  for (const mon of mons) {
    const row = document.createElement('div');
    row.className = 'credit-metric' + (monitorIsLow(mon) ? ' low' : '');

    const info = document.createElement('div');
    info.className = 'credit-info';
    const label = document.createElement('div');
    label.className = 'credit-label';
    label.textContent = `${mon.name || 'Credits'}${mon.kind === 'api' ? ' - live' : ''}`;
    const value = document.createElement('div');
    value.className = 'credit-value';
    value.textContent =
      mon.last_numeric === null || mon.last_numeric === undefined
        ? 'not read yet'
        : formatMonitorValue(mon);
    info.append(label, value);

    const meta = document.createElement('div');
    meta.className = 'credit-meta';
    meta.textContent = `${timeAgo(mon.last_checked_at)}${monitorIsLow(mon) ? ' - LOW' : ''}`;

    const refresh = actionBtn('refresh', 'Refresh now', async () => {
      if (await captureMonitor(mon)) renderList();
    });

    row.append(info, meta, refresh);
    box.appendChild(row);
  }
  return box;
}

// Older monitors (created before they lived on entries) get attached
// to the first entry whose site matches. Best effort, runs quietly.
async function adoptOrphanMonitors() {
  for (const mon of state.monitors) {
    if (mon.item_id) continue;
    const mh = monitorHost(mon.url);
    if (!mh) continue;
    const entry = state.items.find((e) => {
      if (!e.data.url) return false;
      try {
        const raw = e.data.url.includes('://') ? e.data.url : `https://${e.data.url}`;
        const eh = new URL(raw).hostname.replace(/^www\./, '');
        return eh === mh || eh.endsWith(`.${mh}`) || mh.endsWith(`.${eh}`);
      } catch {
        return false;
      }
    });
    if (entry) {
      await api.rest(`/tool_monitors?id=eq.${mon.id}`, {
        method: 'PATCH',
        body: { item_id: entry.id },
      });
      mon.item_id = entry.id;
    }
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
      const tab = await getActiveNormalTab();
      if (!tab?.url) return false;
      const tabHost = new URL(tab.url).hostname.replace(/^www\./, '');
      if (monitorHost(mon.url) !== tabHost) {
        if (!silent) toast(`Open ${monitorHost(mon.url)} in this tab first`);
        return false;
      }
      if (!(await ensurePageAccess(tab, !silent))) {
        if (!silent) toast('OptiPass needs permission for that site - approve the prompt and try again.');
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
      renderList();
    }
  }
}

// ---------- metric sub-forms (entry editor) ----------

function blankMetric() {
  const defaults = ['Credits', 'Bandwidth'];
  return {
    id: null,
    label: defaults[state.editMetrics.length] || '',
    kind: 'page',
    url: '',
    selector: '',
    pickedText: '',
    keyword: '',
    apiUrl: '',
    apiKey: '',
    apiPath: '',
    apiVaultId: $('f-vault').value,
    unit: '',
    threshold: '',
    locked: false,
  };
}

function renderMetricList() {
  const list = $('metric-list');
  list.innerHTML = '';
  state.editMetrics.forEach((m, i) => list.appendChild(metricBlock(m, i)));
}

function boundInput(type, m, prop, placeholder) {
  const el = document.createElement('input');
  el.type = type;
  el.autocomplete = 'off';
  el.value = m[prop] ?? '';
  el.placeholder = placeholder;
  el.addEventListener('input', () => (m[prop] = el.value));
  return el;
}

function fieldLabel(text) {
  const l = document.createElement('label');
  l.textContent = text;
  return l;
}

function metricBlock(m, i) {
  const wrap = document.createElement('div');
  wrap.className = 'metric-block';

  if (m.locked) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = `"${m.label || 'Metric'}" uses an API key stored in a vault you're not in - only members of that vault can edit or remove it.`;
    wrap.appendChild(note);
    return wrap;
  }

  const head = document.createElement('div');
  head.className = 'row';
  const label = boundInput('text', m, 'label', 'Metric name, e.g. Bandwidth');
  label.classList.add('grow');
  const kind = document.createElement('select');
  kind.append(new Option('Dashboard page', 'page'), new Option("Tool's API", 'api'));
  kind.value = m.kind;
  const remove = document.createElement('button');
  remove.className = 'btn icon';
  remove.title = 'Remove this metric';
  remove.innerHTML = icon('trash');
  remove.addEventListener('click', () => {
    state.editMetrics.splice(i, 1);
    renderMetricList();
  });
  head.append(label, kind, remove);

  // read from the dashboard page
  const pageDiv = document.createElement('div');
  pageDiv.append(fieldLabel('Dashboard page (where the number is shown)'));
  pageDiv.append(boundInput('text', m, 'url', 'https://tool.example.com/dashboard'));
  const pick = document.createElement('button');
  pick.className = 'btn';
  pick.style.width = '100%';
  pick.style.marginTop = '8px';
  pick.textContent = 'Pick the number on the current page';
  pick.addEventListener('click', () => launchPicker(i));
  pageDiv.append(pick);
  if (m.selector) {
    const picked = document.createElement('div');
    picked.className = 'error ok';
    picked.textContent = m.pickedText
      ? `Picked: "${m.pickedText}"`
      : 'A picked element is saved for this metric.';
    pageDiv.append(picked);
  }
  pageDiv.append(fieldLabel('Or find it by a nearby word'));
  pageDiv.append(boundInput('text', m, 'keyword', 'e.g. "bandwidth" - grabs the number next to it'));

  // read from the tool's API
  const apiDiv = document.createElement('div');
  apiDiv.append(fieldLabel('API endpoint that returns the number'));
  apiDiv.append(boundInput('text', m, 'apiUrl', 'https://tool.example.com/api/balance'));
  apiDiv.append(fieldLabel('API key (stored end-to-end encrypted)'));
  apiDiv.append(boundInput('password', m, 'apiKey', 'Bearer token from the tool'));
  apiDiv.append(fieldLabel('Response field that holds the number'));
  apiDiv.append(boundInput('text', m, 'apiPath', 'e.g. remainingBandwidth or 0.balance'));
  apiDiv.append(fieldLabel('Keep the key in vault'));
  const vaultSel = document.createElement('select');
  for (const mem of sortedVaults()) vaultSel.append(new Option(mem.vaults.name, mem.vault_id));
  if ([...vaultSel.options].some((o) => o.value === m.apiVaultId)) vaultSel.value = m.apiVaultId;
  vaultSel.addEventListener('change', () => (m.apiVaultId = vaultSel.value));
  apiDiv.append(vaultSel);
  const test = document.createElement('button');
  test.className = 'btn';
  test.style.width = '100%';
  test.style.marginTop = '8px';
  test.textContent = 'Test - fetch the value now';
  const result = document.createElement('div');
  result.className = 'error hidden';
  test.addEventListener('click', async () => {
    result.classList.add('hidden');
    result.classList.remove('ok');
    const cfg = { apiUrl: m.apiUrl.trim(), apiKey: m.apiKey.trim(), jsonPath: m.apiPath.trim() };
    const show = (msg, ok) => {
      result.textContent = msg;
      result.classList.toggle('ok', !!ok);
      result.classList.remove('hidden');
    };
    if (!/^https:\/\//.test(cfg.apiUrl)) return show('Enter the full https:// API URL.');
    if (!cfg.apiKey) return show('Paste the API key.');
    test.disabled = true;
    try {
      const r = await fetchApiValue(cfg, { interactive: true });
      show(`Found: ${r.numeric.toLocaleString()} (raw value: ${JSON.stringify(r.value)})`, true);
    } catch (err) {
      show(err.message);
    } finally {
      test.disabled = false;
    }
  });
  apiDiv.append(test, result);

  const syncKind = () => {
    pageDiv.classList.toggle('hidden', m.kind !== 'page');
    apiDiv.classList.toggle('hidden', m.kind !== 'api');
  };
  kind.addEventListener('change', () => {
    m.kind = kind.value;
    syncKind();
  });
  syncKind();

  const ut = document.createElement('div');
  ut.className = 'row';
  const unitWrap = document.createElement('div');
  unitWrap.className = 'grow';
  unitWrap.append(fieldLabel('Unit'), boundInput('text', m, 'unit', 'credits / GB / USD'));
  const thrWrap = document.createElement('div');
  const thr = boundInput('number', m, 'threshold', '');
  thr.min = '0';
  thrWrap.append(fieldLabel('Warn below'), thr);
  ut.append(unitWrap, thrWrap);

  wrap.append(head, pageDiv, apiDiv, ut);
  return wrap;
}

$('btn-metric-add').addEventListener('click', () => {
  state.editMetrics.push(blankMetric());
  renderMetricList();
});

// ---------- extra API-key secrets (entry editor) ----------

function renderSecretList() {
  const list = $('secret-list');
  list.innerHTML = '';
  state.editSecrets.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.margin = '0';
    const label = boundInput('text', s, 'label', 'Label, e.g. Private API key');
    label.classList.add('grow');
    const value = boundInput('password', s, 'value', 'Secret value');
    value.classList.add('grow');
    const copy = actionBtn('key', 'Copy secret', () =>
      copyText(s.value, `${(s.label || 'Secret').trim() || 'Secret'} copied`)
    );
    const remove = actionBtn('trash', 'Remove secret', () => {
      state.editSecrets.splice(i, 1);
      renderSecretList();
    });
    row.append(label, value, copy, remove);
    list.appendChild(row);
  });
}

$('btn-secret-add').addEventListener('click', () => {
  state.editSecrets.push({ label: '', value: '' });
  renderSecretList();
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

// The popup closes when the user clicks the page, so stash the whole
// entry form as a draft and resume editing when the popup reopens.
async function resumePendingPick() {
  const o = await chrome.storage.session.get(['optipass_pending_pick', 'optipass_entry_draft']);
  const pick = o.optipass_pending_pick;
  if (!pick) return false;
  await chrome.storage.session.remove(['optipass_pending_pick', 'optipass_entry_draft']);
  const draft = o.optipass_entry_draft || {};
  await openEdit(draft.entryId || null, { draft, pick });
  return true;
}

async function launchPicker(pickIndex) {
  await chrome.storage.session.set({
    optipass_entry_draft: {
      entryId: state.editingId,
      vault: $('f-vault').value,
      title: $('f-title').value,
      url: $('f-url').value,
      tags: $('f-tags').value,
      username: $('f-username').value,
      password: $('f-password').value,
      totp: $('f-totp').value,
      notes: $('f-notes').value,
      secrets: state.editSecrets,
      metrics: state.editMetrics,
      pickIndex,
    },
  });
  try {
    const tab = await getActiveNormalTab();
    if (!(await ensurePageAccess(tab, true))) {
      return showError('edit-error', 'OptiPass needs permission for that site to pick on it - approve the prompt and try again.');
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: injectedPicker });
    if (IN_WINDOW) {
      toast('Click the number on the page - the form comes back here automatically.');
    } else {
      // The toolbar popup dies on the outside click anyway; hand over to
      // a dedicated window that survives and resumes the form by itself.
      openOwnWindow();
      window.close();
    }
  } catch {
    showError('edit-error', 'Cannot pick on this page - open the tool dashboard in the active tab.');
  }
}

// In window mode the pick lands while we're still open: resume live.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !changes.optipass_pending_pick?.newValue) return;
  const usable =
    !$('screen-main').classList.contains('hidden') || !$('screen-edit').classList.contains('hidden');
  if (!usable) return; // locked - the normal unlock flow resumes it instead
  resumePendingPick().then((resumed) => {
    if (resumed && IN_WINDOW) {
      chrome.windows.getCurrent((w) => chrome.windows.update(w.id, { focused: true }));
    }
  });
});

// ---------- interactive tour ----------

const TOUR_STEPS = [
  { el: 'search', title: 'Search', text: 'Find any login by name, username, or website.' },
  { el: 'btn-add', title: 'Add entries', text: 'Save logins - with 2FA codes, API keys, and credit monitors attached to them.' },
  { el: 'vault-filter', title: 'Vaults are your teams', text: 'Personal is only yours - not even admins can read it. Shared vaults (like AI Team) are visible only to their members.' },
  { el: 'entry-list', title: 'Your vault', text: 'Fill a login on the current site (⬇), or copy the username, password, or 2FA code. Credit readings appear in a box under their tool and turn red when LOW.' },
  { el: 'btn-theme', title: 'Theme', text: 'Light or dark - your choice follows you to every device.' },
  { el: 'btn-lock', title: 'Lock', text: 'Locks the vault. Unlock with your 6-digit PIN or master password.' },
  { el: 'btn-settings', title: 'Settings & help', text: 'PIN, auto-lock, updates, alerts, help, and this tour live here.' },
];

let tourStep = 0;
let tourEls = null;

function startTour() {
  endTour();
  tourStep = 0;
  const overlay = document.createElement('div');
  overlay.id = 'tour-overlay';
  const spot = document.createElement('div');
  spot.className = 'tour-spot';
  const card = document.createElement('div');
  card.className = 'tour-card';
  overlay.append(spot, card);
  document.body.appendChild(overlay);
  tourEls = { overlay, spot, card };
  renderTourStep();
}

function endTour() {
  if (tourEls) tourEls.overlay.remove();
  tourEls = null;
}

function renderTourStep() {
  if (!tourEls) return;
  const step = TOUR_STEPS[tourStep];
  const target = $(step.el);
  let r = target ? target.getBoundingClientRect() : null;
  if (!r || (!r.width && !r.height)) {
    r = { left: 20, top: 90, width: window.innerWidth - 40, height: 60 };
  }
  const pad = 4;
  Object.assign(tourEls.spot.style, {
    left: `${r.left - pad}px`,
    top: `${r.top - pad}px`,
    width: `${r.width + pad * 2}px`,
    height: `${r.height + pad * 2}px`,
  });

  const card = tourEls.card;
  card.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'tour-title';
  h.textContent = step.title;
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = step.text;
  const nav = document.createElement('div');
  nav.className = 'row';
  const count = document.createElement('span');
  count.className = 'muted';
  count.style.flex = '1';
  count.textContent = `${tourStep + 1} / ${TOUR_STEPS.length}`;
  const skip = document.createElement('button');
  skip.className = 'btn link';
  skip.textContent = 'Skip';
  skip.addEventListener('click', endTour);
  const back = document.createElement('button');
  back.className = 'btn small';
  back.textContent = 'Back';
  back.disabled = tourStep === 0;
  back.addEventListener('click', () => {
    tourStep--;
    renderTourStep();
  });
  const next = document.createElement('button');
  next.className = 'btn small primary';
  next.textContent = tourStep === TOUR_STEPS.length - 1 ? 'Done' : 'Next';
  next.addEventListener('click', () => {
    if (tourStep === TOUR_STEPS.length - 1) return endTour();
    tourStep++;
    renderTourStep();
  });
  nav.append(count, skip, back, next);
  card.append(h, p, nav);

  requestAnimationFrame(() => {
    const cardH = card.offsetHeight;
    const below = r.top + r.height + 12;
    const top = below + cardH + 10 < window.innerHeight ? below : Math.max(10, r.top - cardH - 12);
    card.style.top = `${top}px`;
  });
}

// ---------- go ----------

boot();
