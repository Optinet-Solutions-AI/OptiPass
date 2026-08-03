// Keychain: what "unlocked" means on this device.
//
// Locked   -> nothing usable exists outside chrome.storage.local's
//             encrypted blobs (and the Supabase copies of the same).
// Unlocked -> the user's decrypted private key + unwrapped vault keys
//             sit in chrome.storage.session (memory-only, cleared on
//             browser exit or when the auto-lock alarm fires).

import {
  DEFAULT_ITERATIONS,
  b64ToBuf,
  bufToB64,
  decryptJson,
  deriveKey,
  encryptJson,
  generateRsaKeyPair,
  randomSalt,
} from './crypto.js';

const SESSION_STORE = 'optipass_session_keys';
const SETTINGS_KEY = 'optipass_settings';
const AUTOLOCK_ALARM = 'optipass-autolock';
const PIN_STORE = 'optipass_pin';

// A 6-digit PIN is far weaker than a master password, so it gets a
// heavier PBKDF2 cost and a hard attempt limit (blob wiped after 5
// misses). It never leaves this device.
const PIN_ITERATIONS = 1000000;
const PIN_MAX_ATTEMPTS = 5;

export const DEFAULT_SETTINGS = {
  autoLockMinutes: 5,
  theme: 'light',
  pinOffered: false,
  autoUpdate: true,
  alertsBadge: true,
  tourDone: false,
};

// New user (or key reset): make a keypair and encrypt the private
// half under the master password. `keyRecord` matches the user_keys row.
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

// Re-encrypt the private key under a new master password.
// Vault keys are untouched - only the wrapping password changes.
export async function reencryptPrivateKey(privateJwk, newMasterPassword) {
  const salt = randomSalt();
  const kek = await deriveKey(newMasterPassword, salt);
  const { iv, ct } = await encryptJson(kek, privateJwk);
  return { key_salt: bufToB64(salt), iterations: DEFAULT_ITERATIONS, iv, ct };
}

export async function setUnlocked(privateJwk) {
  await chrome.storage.session.set({ [SESSION_STORE]: { privateJwk, vaultKeys: {} } });
}

export async function getUnlocked() {
  const o = await chrome.storage.session.get(SESSION_STORE);
  return o[SESSION_STORE] || null;
}

export async function saveUnlocked(state) {
  await chrome.storage.session.set({ [SESSION_STORE]: state });
}

export async function lock() {
  await chrome.storage.session.remove(SESSION_STORE);
  await chrome.alarms.clear(AUTOLOCK_ALARM);
}

// ---------- quick-unlock PIN (device-local) ----------

export async function hasPin() {
  const o = await chrome.storage.local.get(PIN_STORE);
  return !!o[PIN_STORE];
}

export async function clearPin() {
  await chrome.storage.local.remove(PIN_STORE);
}

// Wrap the currently-unlocked private key under a PIN-derived key.
export async function setupPinFromSession(pin) {
  const unlocked = await getUnlocked();
  if (!unlocked) throw new Error('Vault is locked');
  const salt = randomSalt();
  const key = await deriveKey(pin, salt, PIN_ITERATIONS);
  const { iv, ct } = await encryptJson(key, unlocked.privateJwk);
  await chrome.storage.local.set({
    [PIN_STORE]: { salt: bufToB64(salt), iterations: PIN_ITERATIONS, iv, ct, attempts: 0 },
  });
}

// Unlock with the PIN. Throws {code:'PIN_WRONG', attemptsLeft} on a miss
// and {code:'PIN_WIPED'} when the attempt limit removes the PIN.
export async function unlockWithPin(pin) {
  const o = await chrome.storage.local.get(PIN_STORE);
  const rec = o[PIN_STORE];
  if (!rec) throw Object.assign(new Error('No PIN is set on this browser'), { code: 'NO_PIN' });
  try {
    const key = await deriveKey(pin, new Uint8Array(b64ToBuf(rec.salt)), rec.iterations);
    const privateJwk = await decryptJson(key, rec.iv, rec.ct);
    rec.attempts = 0;
    await chrome.storage.local.set({ [PIN_STORE]: rec });
    await setUnlocked(privateJwk);
    return privateJwk;
  } catch {
    rec.attempts = (rec.attempts || 0) + 1;
    if (rec.attempts >= PIN_MAX_ATTEMPTS) {
      await clearPin();
      throw Object.assign(new Error('Too many wrong attempts'), { code: 'PIN_WIPED' });
    }
    await chrome.storage.local.set({ [PIN_STORE]: rec });
    throw Object.assign(new Error('Wrong PIN'), {
      code: 'PIN_WRONG',
      attemptsLeft: PIN_MAX_ATTEMPTS - rec.attempts,
    });
  }
}

export async function getSettings() {
  const o = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(o[SETTINGS_KEY] || {}) };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

// (Re)start the auto-lock countdown. 0 minutes = never auto-lock.
export async function resetAutoLock() {
  const { autoLockMinutes } = await getSettings();
  await chrome.alarms.clear(AUTOLOCK_ALARM);
  if (autoLockMinutes > 0) {
    chrome.alarms.create(AUTOLOCK_ALARM, { delayInMinutes: autoLockMinutes });
  }
}
