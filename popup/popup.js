import {
  decryptJson,
  encryptJson,
  exportKeyB64,
  generatePassword,
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
  revealPassword: false,
  loginMode: 'signin', // or 'signup'
  adminProfiles: [],
};

// ---------- screens / feedback ----------

const SCREENS = ['config', 'login', 'pending', 'master-setup', 'unlock', 'main', 'edit', 'settings', 'admin'];

function showScreen(name) {
  for (const s of SCREENS) $(`screen-${s}`).classList.toggle('hidden', s !== name);
  const focus = { login: 'login-email', unlock: 'unlock-pw', 'master-setup': 'ms-pw', main: 'search' }[name];
  if (focus) setTimeout(() => $(focus).focus(), 50);
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
  if (!unlocked) {
    $('unlock-email').textContent = profile.email;
    return showScreen('unlock');
  }

  await enterMain();
}

async function getActiveHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) return new URL(tab.url).hostname.replace(/^www\./, '');
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
  if (!ok) {
    $('unlock-email').textContent = state.profile.email;
    return showScreen('unlock');
  }
  await fetchItems();
  populateVaultSelects();
  $('btn-admin').classList.toggle('hidden', !['admin', 'super_admin'].includes(state.profile.role));
  renderList();
  showScreen('main');
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

$('search').addEventListener('input', renderList);
$('vault-filter').addEventListener('change', renderList);

$('btn-lock').addEventListener('click', async () => {
  await keychain.lock();
  state.vaultKeys = new Map();
  state.items = [];
  $('unlock-email').textContent = state.profile.email;
  showScreen('unlock');
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
      toast('Filled');
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
  $('f-notes').value = entry?.data.notes || '';

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

$('btn-save').addEventListener('click', async () => {
  const title = $('f-title').value.trim();
  const vaultId = $('f-vault').value;
  hideError('edit-error');
  if (!title) return showError('edit-error', 'Title is required.');
  if (!vaultId) return showError('edit-error', 'Pick a vault.');
  const key = state.vaultKeys.get(vaultId);
  if (!key) return showError('edit-error', 'Vault key unavailable - relock and unlock again.');

  const now = new Date().toISOString();
  const existing = state.editingId ? state.items.find((e) => e.id === state.editingId) : null;
  const data = {
    type: 'login',
    title,
    url: $('f-url').value.trim(),
    username: $('f-username').value.trim(),
    password: $('f-password').value,
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

function loadSettingsScreen() {
  $('set-email').textContent = `Signed in as ${state.profile.email} (${state.profile.role.replace('_', ' ')})`;
  $('set-name').value = state.profile.display_name || '';
  $('set-theme').value = state.settings.theme || 'light';
  $('set-autolock').value = state.settings.autoLockMinutes;
  for (const id of ['cmp-old', 'cmp-new', 'cmp-new2']) $(id).value = '';
  hideError('cmp-msg');
}

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

// ---------- go ----------

boot();
