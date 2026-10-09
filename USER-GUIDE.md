# OptiPass — User Guide

OptiPass is Optinet Solutions' own password manager: a Chrome extension (plus a
web app) where the team stores logins, 2FA codes, API keys, and keeps an eye on
tool credits and payments. Everything is **end-to-end encrypted** — the server
only ever stores scrambled data. Not even admins can read your Personal vault.

**The one rule to remember:** you have **two passwords**.

| | What it does | If you forget it |
|---|---|---|
| **Account password** | Signs you in (like any website login) | An admin can reset it |
| **Master password** | Decrypts your vaults; never leaves your device | **Gone forever — nobody can recover it.** Write it down somewhere safe. |

Day to day you'll barely type either — a 6-digit PIN unlocks the extension.

---

## 1. Installing the extension

1. Get the OptiPass folder — either:
   - **Zip:** [download it here](https://github.com/Optinet-Solutions-AI/OptiPass/archive/refs/heads/main.zip),
     right-click → **Extract All…** ⚠️ Windows nests a folder inside a
     folder — open them until you can see **`manifest.json`**; that inner
     folder is the one you need.
   - **Git (auto-updates):** `git clone https://github.com/Optinet-Solutions-AI/OptiPass.git`
2. In Chrome open `chrome://extensions`
3. Turn ON **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the folder **that contains
   `manifest.json`** (if Chrome says "Manifest file is missing", you picked
   the outer wrapper — go one level deeper)
5. Click the puzzle-piece 🧩 in the toolbar and **pin** OptiPass

**Updates are automatic.** When a new version is pushed, run `git pull` in the
folder (or wait — teammates' pulls land the files) and OptiPass reloads itself.
You can force a check in **Settings → Check for updates**. You never reinstall.

> The folder must stay where it is — moving or deleting it breaks the
> extension until you Load unpacked again.

---

## 2. Signing up (first time)

You need an **invite** from an admin — sign-ups without one are rejected.
The admin sends you a **signup link**: open it and your invite and email are
already filled in, so you only choose an account password. Or sign up in the
extension:

1. Click the OptiPass icon → **Need an account? Sign up**
2. Enter the **email that was invited** and choose an **account password**
   (8+ characters). The **invite code** field is only needed if you sign up
   with a different email
3. OptiPass **generates your master password** for you (a 5-word passphrase
   like `coral-window-lemon-storm-pine-42`). **Copy it and save it somewhere
   safe right now** — you'll need it on any new device or Chrome profile,
   and it can never be recovered. You can change it later in Settings.
4. You're in. Your private **Personal** vault is created automatically.
5. OptiPass offers a **6-digit PIN** for this browser — take it. It's how
   you'll unlock every day.
6. A short **interactive tour** walks you around the first time (replay it
   anytime from Settings → Take the tour).

---

## 3. Logging in and unlocking

- **Unlock (daily):** click the icon → type your 6-digit **PIN**. Wrong PIN
  five times → the PIN is removed and your master password is required.
- **Master password:** used on a new browser, after a PIN wipe, or via
  "Use master password instead".
- **Auto-lock:** the vault locks after 5 minutes idle (change it in Settings →
  Auto-lock: 1 minute to 4 hours, or Never) and always when the browser closes. Locking never signs you out.
- **Sign out** (Settings → Sign out): full logout — account password needed
  next time, and your PIN on that browser is removed.

---

## 4. The main screen

- **Search** matches tool names, usernames, links, and tags — this is the
  fastest way to anything.
- **Filter:** once you use tags, a tag dropdown appears under the search box
  (there is no vault filter: every tool you can see is in one list, and an
  expanded tool shows which team vault it's in).
- **Tool rows are collapsed** — one line with the name and status badges:
  - `this site` — matches the page you're on
  - `LOW` (red) — a credit/usage metric fell below its threshold
  - `payment pending` — someone requested a top-up
  - `via OAuth` — signs in through Google/GitHub etc.
- **Click a row to expand it** (or press Tab to reach it and Enter to open it):
  account, action buttons, and credit readings.
- **Pagination** at 8 tools per page — but really, just search.
- Top-row icons: **+** add tool · **↗ open in window** (a window that stays
  open while you browse — great for long edits) · **🔒 lock**.
  Second row: theme toggle · settings · admin (admins only).

### Action buttons on an expanded tool
| Button | Does |
|---|---|
| **Fill login** | Fill the login form on the current page (also copies the 2FA code if the tool has one) |
| **Username** | Copy username (or the OAuth account email) |
| **Password** | Copy password |
| **2FA code** | Copy the current 2FA code |
| **Open** | Open the tool's link |
| **Edit** | Edit the tool (editors only) |

The web app shows the same Username / Password / 2FA code / Edit buttons
under every tool — no need to hover.

### Filling logins without opening OptiPass
On any login page, **right-click the username or password field →
"OptiPass – fill login"** → pick the saved login. If it says "Unlock OptiPass
first", do that and right-click again.

---

## 5. Adding a tool

1. Click **+** ("Add tool")
2. Fill the **Basic information**: tool name, tool link, **who has access**
   (Private, or a team), sign-in method, and credentials
3. **Save** — the tool reopens in full edit mode so you can add the rest

**Sign-in method:**
- **Username & password** — normal login; use ⚡ to generate a strong password
- **OAuth (Google, GitHub, ...)** — for "Sign in with Google" tools: pick
  *which account* signs in (link it to the tool that holds that account). Username and
  password fields disappear — there aren't any.

**Tags:** add comma-separated tags (e.g. `Project Phoenix, proxies`) in the
Tags section to group tools by project. They become badges and a filter.

---

## 6. Editing a tool — the sections

**Step by step:**
1. Find the tool (search is fastest) and click its row to expand it
2. Click the **Edit** button
3. Every part of the tool is a collapsible section — click a section header
   to open it, make your changes
4. Click **Save** (the save bar sticks to the bottom, always reachable).
   If you press Back with unsaved changes, OptiPass asks first: **Discard
   changes** or **Keep editing**.

The sections:

### MFA — one-time passwords
Replace Google Authenticator: when a site offers authenticator-app 2FA, choose
**"enter code manually"**, copy the setup key, and paste it here. OptiPass
shows the rotating 6-digit code with a countdown. Save the site's **recovery
codes** into Notes. From then on, Fill auto-copies the current code, and the
**2FA code** button copies it anytime. Team vault = the whole team can pass 2FA.
> Keep the 2FA of *root* accounts (the email/Google account that recovers
> everything else) on a phone as well — never only in OptiPass.

### API keys & secrets
Any number of named secrets per tool (public key, private key, staging...)
with copy buttons. Encrypted like everything else.

### Credit & usage monitors
Track any number the tool shows — credits, bandwidth, RAM, seats:
- **From the tool's API** (best): endpoint URL + API key + which response
  field holds the number. **Test** shows what it finds. Refreshes
  automatically whenever anyone opens OptiPass. The API key is stored
  encrypted in a vault you pick.
- **From the dashboard page**: open the dashboard, click **"Pick the number
  on the current page"**, then click the number itself. Refreshes whenever a
  member visits that page with OptiPass.
Set a **unit** (GB, USD...) and **Warn below** — readings turn red LOW and a
red badge appears on the OptiPass toolbar icon.

### Payments & top-ups
- **Payment link** — the tool's billing page, with a one-click open button
- **Request a payment**: enter amount/currency → **"Request payment &
  copy summary"** → paste the summary in WhatsApp. The request is saved
  straight away (no need to press Save), and the summary is copied only once
  it's stored. The summary includes the tool's payment link and login
  credentials. The request stays **pending** (badge on the tool) until marked
  paid. Marking a request paid or cancelling it is also saved immediately.
- **For the person paying**: when you open that tool's payment page, OptiPass
  pops up a **guide window** with the amount, open-page button, copy
  login/password/2FA, and **Mark as paid** — which files the payment into
  history automatically. Viewers (see-and-copy access) can pay but can't
  record it: their guide says so, and they tell the requester or another
  editor, who marks it paid.
- **Payment history**: every top-up with date, amount, currency, method, and
  whether it's a one-time top-up, monthly subscription, or auto-recharge
  (pay-as-you-go).

### Notes
Anything else — recovery codes, quirks, who owns the account.

### Deleting a tool
1. Open the tool → **Edit**
2. Scroll to the bottom → **Delete tool**
3. The button changes to **Confirm delete** — click it again
4. The tool, its monitors, and its payment records are gone for everyone
   in that vault (this cannot be undone)

### Moving a tool to another vault (e.g. Personal → AI Automation Team)
1. Open the tool → **Edit**
2. In **Basic information**, change **Who has access** to the target team
3. **Save** — the tool is re-encrypted under the team's key and everyone in
   that team can now see it

> **Only the tool's creator can move it.** If you didn't create the tool,
> the "Who has access" selector is locked — and the database itself refuses
> the move even if someone tries to force it.

---

## 7. Teams & sharing

- **Vaults are teams.** A tool lives in exactly one vault; everyone in that
  vault sees the whole tool (credentials, 2FA, keys, monitors, payments).
- **Personal is truly private** — cryptographically. No admin, no server
  owner, nobody can decrypt it.
- **Per-vault roles:** **Manager** (manage members, delete vault), **Editor**
  (add/edit tools), **Viewer** (see and copy only).
- Sharing *part* of a tool (e.g. just an API key): make a second tool with
  only that key in a vault the right people are in.
- **Move tools between vaults**: edit the tool and change "Who has access".
  **Only a tool's creator can move it** — enforced by the database.
- Removing someone from a vault stops their access instantly — but rotate any
  passwords they already saw (true of every password manager).

---

## 8. Admin guide (admins & super admin)

Open **Admin** (the 👥 icon on the main screen — visible to admins only).

### Creating a team (step by step)
1. Admin → **Team vaults** → type the team name (e.g. `AI Automation Team`)
2. Click **Create** — you become the vault's Manager automatically
3. Under **Vault members**, make sure the new vault is selected
4. Pick a teammate in the **Add a person...** dropdown. People who can't be
   added yet are listed greyed out with the reason (e.g. invited but not
   signed up, or hasn't set a master password yet)
5. Choose their role — **Manager** (manage members), **Editor** (add/edit
   tools), or **Viewer** (see and copy only)
6. Click **Add** — they instantly see everything in that vault

> Only a vault's Manager can add members — adding someone means encrypting the
> vault key for them, and only members hold that key. A person must have
> signed up (and set their master password) before they can be added.

### Inviting a new teammate (step by step)
1. Admin → **Invite by email** → enter their email and global role
2. Click **Invite** — a **signup link is copied to your clipboard** (it's
   also in the invite list: **Copy link**, or **Copy code** for the code alone)
3. Send them the link (plus the setup guide for the extension)
4. They open the link, choose their passwords, and are active immediately
5. Add them to the team vaults they need (steps above)

Sign-ups **without an invite are rejected** — there is no way in without one
(no "pending approval" queue).

### Managing people
- **Disable** cuts someone's server access instantly (re-enable anytime)
- The **super admin** can additionally promote/demote admins and **Delete**
  accounts entirely (click Delete, then Confirm delete)
- When someone leaves: disable or delete them, remove them from vaults, and
  rotate any passwords they had seen

### The audit trail
Every meaningful change is recorded **by the database itself** — clients
can't skip it: who created/edited/**moved**/deleted which tool (and between
which vaults), who added/removed vault members or changed roles, vault
creation/deletion, signups, role/status changes, and invites. Item contents
stay encrypted — the log holds ids and metadata, never secrets. Admins can
inspect it in Supabase (`audit_log` table) to retrace who changed what, when.

---

## 9. The web app

Same login, same data, at the team's Vercel URL. Works everywhere Chrome
isn't: view and edit tools, copy passwords and live 2FA codes, admin screens,
API monitor refresh. Extension-only: page autofill, right-click fill, the
element picker, the PIN, the toolbar badge, and **payments** (requesting a
payment, the payer's guide, and payment history). The web app does show a
**payment pending** badge on the tool, and saving a tool there keeps its
payment data. The browser's **Back** button moves between the web app's
screens (editor → list); from the list it leaves the site.

---

## 10. Settings reference

| Setting | Notes |
|---|---|
| Display name | Shown to teammates |
| Theme | Light (default) / dark — follows you across devices |
| Auto-lock | How long without activity before locking: 1 minute … 4 hours, or Never. Saved as soon as you pick |
| Quick unlock PIN | Set / change / remove for this browser |
| Change master password | Re-encrypts your keys; vault data untouched |
| Updates | Auto-update toggle (default on) + manual check |
| Alerts | Toolbar badge for LOW metrics |
| Help / tour | This guide's short version + the interactive tour |

---

## 11. How your data is secured (and why admins can't read your Personal vault)

Plain-language version of the cryptography — the same building blocks used
by 1Password and Bitwarden:

1. **Your master password never leaves your device.** It is run through
   **PBKDF2-SHA256 with 600,000 iterations** (the OWASP-recommended
   strength) to derive a key — and only that derived key, never the
   password, is used for anything.
2. **That key unlocks your personal RSA keypair.** Everyone has one; the
   private half is stored encrypted under your master password.
3. **Every vault has its own AES-256 key.** Your tools are sealed with
   **AES-256-GCM** — authenticated 256-bit encryption with a fresh random
   nonce on every save. This is the cipher; there are no known practical
   attacks against it.
4. **Sharing = wrapping keys, not copying secrets.** When you're added to a
   team vault, its AES key is encrypted ("wrapped") with *your* RSA public
   key — one wrapped copy per member. Only your private key (which only your
   master password unlocks) can unwrap it.
5. **Why admins can't read your Personal vault:** its key is wrapped for
   exactly one person — you. An admin, the database owner, even someone who
   stole the entire server database, holds only ciphertext and wrapped keys
   they cannot unwrap. This isn't a permission that could be toggled; it's
   mathematics.
6. **The server is locked down anyway**: row-level security means the API
   only serves you rows you're entitled to, signups are invite-only, and the
   append-only **audit trail** is written by database triggers.
7. **The honest limits:** a weak master password is the one thing that can
   undermine all of the above (use 12+ characters), and a compromised device
   (malware, keyloggers) can read what you can read. OptiPass protects the
   server side completely and the device side as well as any password
   manager can.

---

## 12. Troubleshooting

- **Forgot your PIN** → "Use master password instead" (5 wrong tries resets
  the PIN automatically).
- **Forgot your account password** → an admin resets it from Supabase.
- **Forgot your master password** → it cannot be recovered. An admin resets
  your keys (see SETUP.md); your Personal vault is lost, team vaults return
  when a vault Admin re-adds you.
- **2FA code rejected** → your computer clock is off; Windows Settings →
  Time → Sync now.
- **Right-click menu says "Unlock OptiPass first"** → unlock, right-click
  again.
- **A monitor stopped reading** → the tool redesigned its page; edit the
  metric and re-pick the number, or add a keyword fallback.
- **Something looks outdated** → Settings → Check for updates → Reload now.
