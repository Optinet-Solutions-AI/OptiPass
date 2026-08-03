// Web keychain: unlocked key material lives in sessionStorage (cleared
// when the tab closes) with an inactivity auto-lock, mirroring the
// extension's chrome.storage.session behavior.

import {
  DEFAULT_ITERATIONS,
  b64ToBuf,
  bufToB64,
  decryptJson,
  deriveKey,
  encryptJson,
  generateRsaKeyPair,
  randomSalt,
} from './crypto';

const SESSION_STORE = 'optipass_session_keys';
const ACTIVITY_KEY = 'optipass_last_activity';
const SETTINGS_KEY = 'optipass_settings';

export const DEFAULT_SETTINGS = { autoLockMinutes: 15, theme: 'light' };

export function getSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function touchActivity() {
  sessionStorage.setItem(ACTIVITY_KEY, String(Date.now()));
}

// True when the idle timeout has passed; caller should lock.
export function activityExpired() {
  const { autoLockMinutes } = getSettings();
  if (!autoLockMinutes) return false;
  const last = Number(sessionStorage.getItem(ACTIVITY_KEY) || 0);
  return last > 0 && Date.now() - last > autoLockMinutes * 60 * 1000;
}

export async function createUserKeys(masterPassword) {
  const { publicJwk, privateJwk } = await generateRsaKeyPair();
  const salt = randomSalt();
  const kek = await deriveKey(masterPassword, salt);
  const { iv, ct } = await encryptJson(kek, privateJwk);
  return {
    publicJwk,
    privateJwk,
    keyRecord: { key_salt: bufToB64(salt), iterations: DEFAULT_ITERATIONS, iv, ct },
  };
}

// Throws if the master password is wrong (AES-GCM auth failure).
export async function decryptPrivateKey(masterPassword, keyRecord) {
  const kek = await deriveKey(
    masterPassword,
    new Uint8Array(b64ToBuf(keyRecord.key_salt)),
    keyRecord.iterations || DEFAULT_ITERATIONS
  );
  return decryptJson(kek, keyRecord.iv, keyRecord.ct);
}

export async function reencryptPrivateKey(privateJwk, newMasterPassword) {
  const salt = randomSalt();
  const kek = await deriveKey(newMasterPassword, salt);
  const { iv, ct } = await encryptJson(kek, privateJwk);
  return { key_salt: bufToB64(salt), iterations: DEFAULT_ITERATIONS, iv, ct };
}

export function setUnlocked(privateJwk) {
  sessionStorage.setItem(SESSION_STORE, JSON.stringify({ privateJwk, vaultKeys: {} }));
  touchActivity();
}

export function getUnlocked() {
  if (activityExpired()) {
    lock();
    return null;
  }
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_STORE));
  } catch {
    return null;
  }
}

export function saveUnlocked(state) {
  sessionStorage.setItem(SESSION_STORE, JSON.stringify(state));
}

export function lock() {
  sessionStorage.removeItem(SESSION_STORE);
  sessionStorage.removeItem(ACTIVITY_KEY);
}
