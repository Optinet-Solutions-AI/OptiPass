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

// ---------- one-time passwords (TOTP, RFC 6238) ----------
// Same algorithm as Google Authenticator: code = HMAC(secret, time/30s),
// computed locally. The secret is stored inside the encrypted item blob.

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input) {
  const clean = (input || '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!clean) return null;
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of clean) {
    const idx = B32_ALPHABET.indexOf(c);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return out.length ? new Uint8Array(out) : null;
}

// Accepts a raw base32 setup key ("JBSW Y3DP ...") or a full
// otpauth:// URI (what the QR code contains). Returns null if invalid.
export function parseTotpSecret(input) {
  let secret = (input || '').trim();
  let period = 30;
  let digits = 6;
  let algorithm = 'SHA-1';
  if (/^otpauth:\/\//i.test(secret)) {
    try {
      const params = new URL(secret).searchParams;
      secret = params.get('secret') || '';
      period = parseInt(params.get('period'), 10) || 30;
      digits = parseInt(params.get('digits'), 10) || 6;
      const alg = (params.get('algorithm') || '').toUpperCase().replace('-', '');
      if (alg === 'SHA256') algorithm = 'SHA-256';
      else if (alg === 'SHA512') algorithm = 'SHA-512';
    } catch {
      return null;
    }
  }
  const key = base32Decode(secret);
  if (!key) return null;
  return { key, period, digits, algorithm };
}

// Returns { code, secondsLeft, period } or null for an invalid secret.
export async function generateTotp(input, now = Date.now()) {
  const parsed = parseTotpSecret(input);
  if (!parsed) return null;
  const { key, period, digits, algorithm } = parsed;
  const counter = Math.floor(now / 1000 / period);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign']
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, msg));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  const code = (bin % 10 ** digits).toString().padStart(digits, '0');
  return { code, secondsLeft: period - (Math.floor(now / 1000) % period), period };
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

// Simple, common words for generated master passphrases - easy to
// write down and to retype on a new device. 5 words + 2 digits from a
// 240-word list is ~46 bits, plenty behind 600k-iteration PBKDF2.
const PASSPHRASE_WORDS = ('acorn amber anchor apple arrow aspen atlas autumn badge bagel bamboo barley basil beacon berry ' +
  'birch bison blaze bloom bluff bolt bonus book breeze brick bridge brook bubble butter cabin cactus ' +
  'camel candle canoe canyon carbon cargo castle cedar chalk cherry chess cider cliff cloud clover ' +
  'cobalt cocoa comet copper coral cotton cove crane crater creek crest crystal cypress daisy dawn ' +
  'delta denim desert diamond dome dove dragon drift dune eagle echo ember engine falcon feather fern ' +
  'field flame flint forest fossil fox frost galaxy garden garnet gecko ginger glacier glade globe ' +
  'gold goose granite grape grove hail harbor hawk hazel heron hill honey iceberg iris island ivory ' +
  'ivy jade jasper jungle juniper kayak kelp kettle kite koala lagoon lake lantern laurel lava leaf ' +
  'ledge lemon lily linen lion lotus lunar lynx magnet mango maple marble meadow mesa meteor mint ' +
  'mirror mist moon moss mountain nectar nest north nova nutmeg oak oasis ocean olive onyx opal ' +
  'orbit orchid osprey otter owl oyster palm panda pearl pebble pecan penguin pepper petal pine ' +
  'pixel planet plum polar pond poppy prairie prism pumpkin quail quartz quill rain raven reef ridge ' +
  'river robin rocket rose ruby saddle sage salmon sand sapphire scout seal shadow shell shore silver ' +
  'sky slate snow solar sparrow spice spring spruce star stone storm summit swan thunder tiger timber ' +
  'topaz torch trail tulip tundra turtle valley velvet vine violet walnut wave whale wheat willow ' +
  'wind winter wolf wren zebra zephyr zinc').split(' ');

export function generatePassphrase(words = 5) {
  const parts = Array.from({ length: words }, () => PASSPHRASE_WORDS[randInt(PASSPHRASE_WORDS.length)]);
  parts.push(String(randInt(100)).padStart(2, '0'));
  return parts.join('-');
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
