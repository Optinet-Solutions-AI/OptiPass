# 1Password feature comparison — what OptiPass has and what we could add

Legend: ✅ **have it** · 🟡 **easy add** (days) · 🔵 **bigger effort** (weeks) · ⛔ **skip** (enterprise-scale or not feasible in an extension)

## Vault & item management

| Feature | Status | Notes |
|---|---|---|
| Login items (site, username, password, notes) | ✅ | |
| Personal vault per user | ✅ | Auto-created, private even from admins |
| Shared team vaults | ✅ | Created by admins, per-member permissions |
| Search | ✅ | Title, username, URL |
| Secure notes | 🟡 | Item data is already a flexible encrypted blob |
| Credit cards / identities | 🟡 | Same reason — just new form types |
| API keys / SSH keys | 🟡 | Same |
| Tags & favorites | 🟡 | |
| Custom fields | 🟡 | |
| Archive / trash (restore deleted) | 🟡 | Soft-delete flag |
| Move items between vaults | ✅ | Change the vault in the edit form |
| Item history / versions | 🔵 | Needs versioned storage |
| File / document attachments | 🔵 | Needs Supabase Storage + encryption layer |

## Security

| Feature | Status | Notes |
|---|---|---|
| Zero-knowledge end-to-end encryption | ✅ | AES-256-GCM; server only stores ciphertext |
| Master password (never stored/sent) | ✅ | PBKDF2-SHA256, 600k iterations |
| Auto-lock on idle + on browser close | ✅ | Configurable per user |
| Password generator | ✅ | Random, 8–64 chars, symbols toggle |
| Memorable word-based passwords | 🟡 | e.g. `correct-horse-battery` style |
| Watchtower: weak/reused password report | 🟡 | Pure client-side analysis |
| Watchtower: breach check (HaveIBeenPwned) | 🟡 | Free k-anonymity API, password never sent |
| TOTP 2FA codes (store + copy 6-digit codes) | 🟡 | Small standard algorithm |
| Clipboard auto-clear after N seconds | 🟡 | |
| Phishing guard (warn when filling on wrong domain) | 🟡 | We already domain-match |
| Secret Key (1Password's second factor) | ⛔ | Big friction for small gain at our scale |
| Biometric unlock (Windows Hello / Touch ID) | ⛔ | Not available to Chrome extensions |
| Passkey storage | ⛔ | Browser-level API, not extension-accessible |
| Travel mode | ⛔ | |

## Autofill & browser integration

| Feature | Status | Notes |
|---|---|---|
| Fill from popup (⬇ button) | ✅ | Works with React/Angular login forms |
| "This site" suggestions on top | ✅ | Matches current tab's domain |
| Inline autofill icon inside page fields | 🔵 | Content script UI on every page |
| Auto-save prompt after logging in on a site | 🔵 | Form-submission capture |
| Open site & fill in one click | 🟡 | |

## Team & administration

| Feature | Status | Notes |
|---|---|---|
| Email + password sign-in | ✅ | Supabase Auth |
| Invite-only / admin approval to join | ✅ | Invited = instant; uninvited = pending approval |
| Roles: super admin / admin / member | ✅ | First signup = super admin |
| Per-vault permissions (manager/editor/viewer) | ✅ | |
| Disable (suspend) users | ✅ | Cuts all server access instantly |
| Audit log (who did what, when) | ✅ | Logged to DB; view in Supabase (in-app viewer 🟡) |
| Recovery: admin resets a user's keys | 🟡 | Manual today (documented in SETUP.md) |
| Groups (grant vault access to a group) | ⛔ | Overkill below ~30 people |
| SSO (Google/Microsoft login) | 🔵 | Supabase supports it; changes key handling |
| SCIM provisioning, custom reports | ⛔ | Enterprise |

## Sharing & access

| Feature | Status | Notes |
|---|---|---|
| Sync across devices/machines | ✅ | Sign in anywhere the extension is installed |
| Share single item via expiring link (external) | 🔵 | Needs a small public web endpoint |
| Web app / desktop app / mobile app | 🔵/⛔ | We're Chrome-extension-only today |
| Offline access (cached, read-only) | 🔵 | |
| Import from CSV (Chrome, LastPass, 1Password) | 🟡 | High value for migration day one |
| Encrypted export/backup | 🟡 | v1 had it; re-add on top of Supabase |

## Suggested next batch (my recommendation)

1. **CSV import** — you'll want this the day the team migrates existing passwords
2. **Secure notes + credit cards** — cheap, immediately useful
3. **Watchtower basics** — weak/reused report + HaveIBeenPwned breach check
4. **TOTP codes** — lets the team keep 2FA secrets in shared vaults
5. **Clipboard auto-clear + favorites** — small quality-of-life wins
