// Crypto primitives for OptiPass, built on the Web Crypto API.
// Master password -> PBKDF2-SHA256 (600k iterations) -> AES-256-GCM key.
// AES-GCM is authenticated, so a wrong password simply fails to decrypt.

export const DEFAULT_ITERATIONS = 600000;

export function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function randomSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

export async function deriveKey(password, salt, iterations = DEFAULT_ITERATIONS) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true, // extractable, so the unlocked key can be kept in session storage
    ['encrypt', 'decrypt']
  );
}

export async function encryptJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: bufToB64(iv), ct: bufToB64(ct) };
}

export async function decryptJson(key, ivB64, ctB64) {
  const iv = new Uint8Array(b64ToBuf(ivB64));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, b64ToBuf(ctB64));
  return JSON.parse(new TextDecoder().decode(pt));
}

export async function exportKeyB64(key) {
  return bufToB64(await crypto.subtle.exportKey('raw', key));
}

export async function importKeyB64(b64) {
  return crypto.subtle.importKey('raw', b64ToBuf(b64), { name: 'AES-GCM' }, true, [
    'encrypt',
    'decrypt',
  ]);
}

// ---------- team sharing (RSA key wrapping) ----------
// Each user has an RSA-OAEP keypair. A vault's AES key is "wrapped"
// (encrypted) with each member's public key, so only members can ever
// recover it - the server just stores opaque wrapped blobs.

export async function generateRsaKeyPair() {
  const kp = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['wrapKey', 'unwrapKey']
  );
  return {
    publicJwk: await crypto.subtle.exportKey('jwk', kp.publicKey),
    privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey),
  };
}

export async function importPublicKey(jwk) {
  const { key_ops, ...clean } = jwk;
  return crypto.subtle.importKey('jwk', clean, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, [
    'wrapKey',
  ]);
}

export async function importPrivateKey(jwk) {
  const { key_ops, ...clean } = jwk;
  return crypto.subtle.importKey('jwk', clean, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, [
    'unwrapKey',
  ]);
}

export async function generateVaultKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

export async function wrapVaultKey(publicJwk, vaultKey) {
  const pub = await importPublicKey(publicJwk);
  return bufToB64(await crypto.subtle.wrapKey('raw', vaultKey, pub, { name: 'RSA-OAEP' }));
}

export async function unwrapVaultKey(privateKey, wrappedB64) {
  return crypto.subtle.unwrapKey(
    'raw',
    b64ToBuf(wrappedB64),
    privateKey,
    { name: 'RSA-OAEP' },
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt']
  );
}

// Unbiased random int in [0, max) via rejection sampling.
function randInt(max) {
  const limit = 256 - (256 % max);
  const b = new Uint8Array(1);
  do {
    crypto.getRandomValues(b);
  } while (b[0] >= limit);
  return b[0] % max;
}

// Ambiguous characters (I, l, 1, O, 0) are excluded on purpose.
export function generatePassword(length = 20, { symbols = true } = {}) {
  const sets = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
  ];
  if (symbols) sets.push('!@#$%^&*()-_=+[]{};:,.?');
  const all = sets.join('');
  const pick = (chars) => chars[randInt(chars.length)];
  const out = sets.map(pick); // guarantee at least one char from each set
  while (out.length < length) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}
