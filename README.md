# OptiPass

Optinet Solutions' team password manager — a Chrome (Manifest V3) extension backed by Supabase, with 1Password-style **zero-knowledge encryption**: the server only ever stores ciphertext.

- **Setup:** see [SETUP.md](SETUP.md) (one-time Supabase setup + team onboarding)
- **Feature roadmap vs 1Password:** see [FEATURES.md](FEATURES.md)

## What it does

- **Email sign-in** (Supabase Auth) — access only for people an admin invited or approved
- **Roles:** super admin (first signup) → admin → member; per-vault manager/editor/viewer
- **Personal vault** for every user (private even from admins) + **shared team vaults**
- **End-to-end encryption** — master password → PBKDF2 (600k) → AES-256-GCM; team sharing via RSA-wrapped vault keys; master password never leaves the device and is unrecoverable by design
- **Autofill** into the active tab, this-site suggestions, copy buttons, search
- **2FA one-time passwords (TOTP)** — store a site's 2FA setup key in the entry (replaces Google Authenticator); live code with countdown, one-click copy, and the code is auto-copied to the clipboard when you Fill a login. Keep the 2FA for OptiPass's own root accounts (Supabase, email) on a phone instead.
- **Password generator**, auto-lock on idle and browser close
- **Light/dark theme per user** (light default), synced to their profile
- **Minimalist UI** — Montserrat (bundled locally, no calls to Google Fonts), monochrome line icons, responsive layout that also works opened as a full browser tab
- **Audit log** of security-relevant events (viewable in Supabase)

## How the crypto works

```
account password ──> Supabase Auth (login only, no crypto role)

master password ──PBKDF2──> KEK ──decrypts──> your RSA private key
                                                    │
vault key (AES-256) <──unwraps── wrapped_key (one per vault member,
        │                         encrypted with each member's RSA public key)
        └──decrypts──> items (AES-GCM blobs)
```

Adding someone to a vault = encrypting the vault key with *their* public key. Only vault members can do that, so even the database owner can't grant themselves access to content.

## Project layout

```
manifest.json         Extension manifest (MV3)
background.js         Service worker - auto-lock enforcement
supabase/schema.sql   Full database schema: tables, roles, RLS policies
lib/config.js         Your Supabase URL + anon key (fill in)
lib/api.js            Thin Supabase client (auth + REST, token refresh)
lib/crypto.js         Web Crypto: PBKDF2, AES-GCM, RSA key wrapping, generator
lib/keychain.js       Lock/unlock state, master password handling, settings
popup/                UI - login, unlock, vaults, editor, settings, admin
icons/                Extension icons
backup-v1-local/      The previous local-only version (safe to delete)
```

## Development notes

- No build step, no dependencies — plain ES modules
- Syntax check: `node --check` on any `lib/*.js` (as `.mjs`)
- Crypto flows have a Node test exercising the full share/unlock cycle
