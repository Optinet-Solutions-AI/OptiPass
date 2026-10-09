// Supabase client for the web app - same logic as the extension's
// lib/api.js, with localStorage instead of chrome.storage.local.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

const AUTH_STORE = 'optipass_auth';

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_STORE));
  } catch {
    return null;
  }
}

function writeStore(s) {
  localStorage.setItem(AUTH_STORE, JSON.stringify(s));
}

function clearStore() {
  localStorage.removeItem(AUTH_STORE);
}

function normalizeSession(data) {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: { id: data.user.id, email: data.user.email },
  };
}

// ---------- plain-language errors ----------
// Server errors are written for developers ("duplicate key value violates
// unique constraint ..."). Translate the ones people can hit into what
// happened and what to do. The original stays on the error (err.code,
// err.detail) and in the console for debugging.

const CONSTRAINT_MESSAGES = {
  invites_pkey:
    'This email already has a pending invite. Use Copy link in the invite list, or remove it and invite again.',
  vault_members_pkey: 'That person is already a member of this vault.',
};

function dbErrorMessage(status, code, raw) {
  if (code === 'P0001' && raw) return raw; // raised by our own database functions, already plain
  if (code === '23505') {
    const name = (raw.match(/constraint "([^"]+)"/) || [])[1];
    return CONSTRAINT_MESSAGES[name] || 'That already exists, so nothing was changed.';
  }
  if (code === '42501' || status === 403) {
    return "You don't have permission to do that. Ask an admin or the vault's Manager.";
  }
  if (code === '23503') return 'Something this refers to no longer exists. Reload OptiPass and try again.';
  if (['23502', '23514', '22P02', '22001'].includes(code)) {
    return "One of the values isn't allowed. Check the form and try again.";
  }
  if (code === 'PGRST301' || status === 401) return 'Your session expired. Please sign in again.';
  if (status >= 500) return `The OptiPass server had a problem (error ${status}). Try again in a moment.`;
  return `Something went wrong (error ${code || status}). Try again, and tell an admin if it keeps happening.`;
}

function authErrorMessage(status, code, raw) {
  // The signup trigger rejects emails without a matching invite; Supabase
  // reports any trigger failure as this generic text.
  if (/database error saving new user/i.test(raw)) {
    return 'Signing up needs an invite for this email address. Ask an admin to invite you and use the link they send.';
  }
  if (code === 'email_address_invalid' || /validate email address/i.test(raw)) {
    return "That email address doesn't look right. Check it and try again.";
  }
  if (code === 'user_already_exists' || code === 'email_exists' || /already registered/i.test(raw)) {
    return 'An account with this email already exists. Sign in instead.';
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(raw)) {
    return 'Confirm your email first: open the link we sent you, then sign in.';
  }
  if (status === 429 || /rate limit/i.test(`${code} ${raw}`)) return 'Too many attempts. Wait a few minutes and try again.';
  if (status >= 500) return `The sign-in server had a problem (error ${status}). Try again in a moment.`;
  return raw || `Sign-in failed (error ${status}).`;
}

function serverError(message, status, code, raw) {
  if (raw && raw !== message) console.warn('OptiPass server error', status, code, raw);
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.detail = raw;
  return err;
}

// fetch() itself rejects with "Failed to fetch" when offline or blocked.
async function send(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error("Can't reach the OptiPass server. Check your internet connection and try again.");
  }
}

async function authFetch(path, body, bearer) {
  const headers = { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await send(`${SUPABASE_URL}/auth/v1${path}`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = data.error_description || data.msg || data.message || '';
    const code = data.error_code || '';
    throw serverError(authErrorMessage(res.status, code, raw), res.status, code, raw);
  }
  return data;
}

// Supabase email links (confirmation, invites, recovery) land on the
// Site URL with tokens in the hash. Adopt them as a session so the
// user arrives signed in instead of on a blank page.
export function adoptSessionFromUrlHash() {
  if (typeof window === 'undefined') return false;
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const access_token = h.get('access_token');
  const refresh_token = h.get('refresh_token');
  if (!access_token || !refresh_token) return false;
  try {
    const b64 = access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    writeStore({
      access_token,
      refresh_token,
      expires_at: payload.exp || Math.floor(Date.now() / 1000) + 3600,
      user: { id: payload.sub, email: payload.email },
    });
    window.history.replaceState(null, '', window.location.pathname);
    return true;
  } catch {
    return false;
  }
}

export async function signUp(email, password, inviteCode) {
  const body = { email, password };
  if (inviteCode) body.data = { invite_code: inviteCode };
  const data = await authFetch('/signup', body);
  if (data.access_token) {
    writeStore(normalizeSession(data));
    return { signedIn: true };
  }
  return { signedIn: false };
}

export async function signIn(email, password) {
  const data = await authFetch('/token?grant_type=password', { email, password });
  writeStore(normalizeSession(data));
}

export async function getSession() {
  let s = readStore();
  if (!s) return null;
  if (s.expires_at - 60 < Math.floor(Date.now() / 1000)) {
    try {
      const data = await authFetch('/token?grant_type=refresh_token', {
        refresh_token: s.refresh_token,
      });
      s = normalizeSession(data);
      writeStore(s);
    } catch {
      clearStore();
      return null;
    }
  }
  return s;
}

export async function signOut() {
  const s = readStore();
  if (s) {
    fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access_token}` },
    }).catch(() => {});
  }
  clearStore();
}

export async function rest(path, { method = 'GET', body, prefer } = {}) {
  const s = await getSession();
  if (!s) throw new Error("You're signed out. Please sign in again.");
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${s.access_token}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await send(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const raw = (data && (data.message || data.hint || data.details)) || '';
    const code = (data && data.code) || '';
    throw serverError(dbErrorMessage(res.status, code, raw), res.status, code, raw);
  }
  return data;
}

export async function rpc(name, args) {
  return rest(`/rpc/${name}`, { method: 'POST', body: args });
}

export async function logEvent(action, detail = {}) {
  try {
    const s = await getSession();
    if (!s) return;
    await rest('/audit_log', {
      method: 'POST',
      body: { user_id: s.user.id, action: `web.${action}`, detail },
    });
  } catch {
    /* auditing must never break the app */
  }
}
