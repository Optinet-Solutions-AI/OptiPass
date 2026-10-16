// Web keychain: unlocked key material lives only in this page's memory
// (never in sessionStorage, which Chrome writes to disk), with an
// inactivity auto-lock. Reloading or closing the page locks the vault.
// The private key is held as a non-extractable CryptoKey, vault keys as
// CryptoKeys (extractable only because sharing re-wraps them for others).

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

const SETTINGS_KEY = 'optipass_settings';

// Unlocked state: { privateKey: CryptoKey, vaultKeys: Map(vault_id -> CryptoKey) }
let unlocked = null;
let lastActivity = 0;

// Versions up to 2.16.36 kept the unlocked keys in sessionStorage: wipe
// anything they left behind.
if (typeof sessionStorage !== 'undefined') {
  try {
    sessionStorage.removeItem('optipass_session_keys');
    sessionStorage.removeItem('optipass_last_activity');
  } catch {
    /* storage unavailable */
  }
}

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
  lastActivity = Date.now();
}

// True when the idle timeout has passed; caller should lock.
export function activityExpired() {
  const { autoLockMinutes } = getSettings();
  if (!autoLockMinutes) return false;
  return lastActivity > 0 && Date.now() - lastActivity > autoLockMinutes * 60 * 1000;
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

// Keep the private key as a non-extractable CryptoKey: usable for
// unwrapping vault keys, but no script can read it back out.
export async function setUnlocked(privateJwk) {
  const { key_ops, ...jwk } = privateJwk;
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, [
    'unwrapKey',
  ]);
  unlocked = { privateKey, vaultKeys: new Map() };
  touchActivity();
}

export function getUnlocked() {
  if (activityExpired()) {
    lock();
    return null;
  }
  return unlocked;
}

export function lock() {
  unlocked = null;
  lastActivity = 0;
}
