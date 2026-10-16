// Keychain: what "unlocked" means on this device.
//
// Locked   -> nothing usable exists outside chrome.storage.local's
//             encrypted blobs (and the Supabase copies of the same).
// Unlocked -> the user's decrypted private key + unwrapped vault keys
//             sit in chrome.storage.session (memory-only, cleared on
//             browser exit or when the auto-lock alarm fires).
// PIN      -> works only until Chrome closes (see "quick-unlock PIN").

import {
  DEFAULT_ITERATIONS,
  b64ToBuf,
  bufToB64,
  decryptJson,
  deriveKey,
  encryptJson,
  generateRsaKeyPair,
  importPrivateKey,
  randomSalt,
  unwrapVaultKey,
  wrapVaultKey,
} from './crypto.js';

export const SESSION_STORE = 'optipass_session_keys';
const SETTINGS_KEY = 'optipass_settings';
const AUTOLOCK_ALARM = 'optipass-autolock';
const PIN_STORE = 'optipass_pin'; // chrome.storage.local (disk)
const PIN_SESSION = 'optipass_pin_session'; // chrome.storage.session (memory)

// A 6-digit PIN is far weaker than a master password, so it gets a
// heavier PBKDF2 cost and a hard attempt limit (wiped after 5 misses).
// It never leaves this device.
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
//
// Nothing on disk can be used to guess the PIN offline (security report
// S2). The PIN-locked copy of the private key lives in memory only
// (PIN_SESSION, gone when Chrome closes), next to the attempt counter.
// On disk (PIN_STORE) there is only the PBKDF2 salt and the PIN-derived
// key wrapped with the user's own RSA public key, so after a browser
// restart one master-password unlock (which yields the private key)
// re-creates the in-memory copy and the same PIN works again.
// Records from v2.16.37 and older ({salt, iv, ct} on disk) are upgraded
// on their next PIN unlock, or dropped at the next master unlock.

const pinRecord = async () => (await chrome.storage.local.get(PIN_STORE))[PIN_STORE] || null;
const pinSession = async () => (await chrome.storage.session.get(PIN_SESSION))[PIN_SESSION] || null;
const isLegacy = (rec) => !!rec && !!rec.ct;

// The public half of an RSA private JWK.
const publicOf = ({ kty, n, e, alg }) => ({ kty, n, e, alg, ext: true });

// A PIN is set up on this browser (it may still need one master unlock
// after a browser restart - see pinReady).
export async function hasPin() {
  return !!(await pinRecord());
}

// The PIN can unlock right now (false after a browser restart until the
// master password has been used once).
export async function pinReady() {
  const rec = await pinRecord();
  return !!rec && (isLegacy(rec) || !!(await pinSession()));
}

export async function clearPin() {
  await chrome.storage.local.remove(PIN_STORE);
  await chrome.storage.session.remove(PIN_SESSION);
}

async function storePin(pin, privateJwk) {
  const salt = randomSalt();
  const key = await deriveKey(pin, salt, PIN_ITERATIONS);
  const restore = await wrapVaultKey(publicOf(privateJwk), key);
  const { iv, ct } = await encryptJson(key, privateJwk);
  await chrome.storage.session.set({ [PIN_SESSION]: { iv, ct, attempts: 0 } });
  await chrome.storage.local.set({ [PIN_STORE]: { v: 2, salt: bufToB64(salt), iterations: PIN_ITERATIONS, restore } });
}

// Wrap the currently-unlocked private key under a PIN-derived key.
export async function setupPinFromSession(pin) {
  const unlocked = await getUnlocked();
  if (!unlocked) throw new Error('Vault is locked');
  await storePin(pin, unlocked.privateJwk);
}

// After a master-password unlock: re-create the in-memory PIN copy (first
// unlock since Chrome started). Returns 'ready', 'none', or 'reoffer' when
// the stored PIN can't be used any more (old format, or keys were reset).
export async function restorePin(privateJwk) {
  const rec = await pinRecord();
  if (!rec) return 'none';
  if (await pinSession()) return 'ready';
  try {
    if (isLegacy(rec)) throw new Error('old PIN format');
    const key = await unwrapVaultKey(await importPrivateKey(privateJwk), rec.restore);
    const { iv, ct } = await encryptJson(key, privateJwk);
    await chrome.storage.session.set({ [PIN_SESSION]: { iv, ct, attempts: 0 } });
    return 'ready';
  } catch {
    await clearPin();
    return 'reoffer';
  }
}

// Unlock with the PIN. Throws {code:'PIN_WRONG', attemptsLeft} on a miss,
// {code:'PIN_WIPED'} when the attempt limit removes the PIN, and
// {code:'PIN_RESTART'} when Chrome restarted since the master password
// was last used.
export async function unlockWithPin(pin) {
  const rec = await pinRecord();
  if (!rec) throw Object.assign(new Error('No PIN is set on this browser'), { code: 'NO_PIN' });
  const legacy = isLegacy(rec);
  const sess = legacy ? rec : await pinSession();
  if (!sess) throw Object.assign(new Error('Unlock with your master password once after restarting Chrome'), { code: 'PIN_RESTART' });
  const save = (r) => (legacy ? chrome.storage.local.set({ [PIN_STORE]: r }) : chrome.storage.session.set({ [PIN_SESSION]: r }));
  let privateJwk;
  try {
    const key = await deriveKey(pin, new Uint8Array(b64ToBuf(rec.salt)), rec.iterations);
    privateJwk = await decryptJson(key, sess.iv, sess.ct);
  } catch {
    sess.attempts = (sess.attempts || 0) + 1;
    if (sess.attempts >= PIN_MAX_ATTEMPTS) {
      await clearPin();
      throw Object.assign(new Error('Too many wrong attempts'), { code: 'PIN_WIPED' });
    }
    await save(sess);
    throw Object.assign(new Error('Wrong PIN'), {
      code: 'PIN_WRONG',
      attemptsLeft: PIN_MAX_ATTEMPTS - sess.attempts,
    });
  }
  if (legacy) await storePin(pin, privateJwk); // upgrade: the old copy leaves the disk
  else await save({ ...sess, attempts: 0 });
  await setUnlocked(privateJwk);
  return privateJwk;
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
