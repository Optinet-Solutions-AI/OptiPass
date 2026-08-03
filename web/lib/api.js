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

async function authFetch(path, body, bearer) {
  const headers = { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.error_description || data.msg || data.message || `Auth error (${res.status})`
    );
  }
  return data;
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
  if (!s) throw new Error('Signed out');
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${s.access_token}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (data && (data.message || data.hint || data.details)) || `Request failed (${res.status})`
    );
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
