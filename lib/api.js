// Thin Supabase client (auth + PostgREST) using plain fetch.
// No SDK dependency: MV3-friendly, and Supabase's CORS allows
// extension origins out of the box.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const AUTH_STORE = 'optipass_auth';

export function isConfigured() {
  return (
    /^https:\/\//.test(SUPABASE_URL) &&
    !SUPABASE_URL.includes('YOUR-') &&
    !SUPABASE_ANON_KEY.includes('YOUR-')
  );
}

async function readStore() {
  const o = await chrome.storage.local.get(AUTH_STORE);
  return o[AUTH_STORE] || null;
}

async function writeStore(s) {
  await chrome.storage.local.set({ [AUTH_STORE]: s });
}

async function clearStore() {
  await chrome.storage.local.remove(AUTH_STORE);
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

// Returns { signedIn } - signedIn is false when Supabase requires
// the user to confirm their email address before the first login.
export async function signUp(email, password) {
  const data = await authFetch('/signup', { email, password });
  if (data.access_token) {
    await writeStore(normalizeSession(data));
    return { signedIn: true };
  }
  return { signedIn: false };
}

export async function signIn(email, password) {
  const data = await authFetch('/token?grant_type=password', { email, password });
  await writeStore(normalizeSession(data));
}

// Returns a live session (refreshing the token if needed) or null.
export async function getSession() {
  let s = await readStore();
  if (!s) return null;
  if (s.expires_at - 60 < Math.floor(Date.now() / 1000)) {
    try {
      const data = await authFetch('/token?grant_type=refresh_token', {
        refresh_token: s.refresh_token,
      });
      s = normalizeSession(data);
      await writeStore(s);
    } catch {
      await clearStore();
      return null;
    }
  }
  return s;
}

export async function signOut() {
  const s = await readStore();
  if (s) {
    // Best effort - local sign-out matters more than the server call.
    fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access_token}` },
    }).catch(() => {});
  }
  await clearStore();
}

// PostgREST request. `path` starts with '/', e.g. '/items?select=*'.
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
      body: { user_id: s.user.id, action, detail },
    });
  } catch {
    // Auditing must never break the app.
  }
}
