# OptiPass Setup Guide

One person (the future **super admin**) does steps 1–4 once. Everyone else just does step 5.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in (free tier is fine)
2. **New project** → name it (e.g. `optipass`), set a strong database password, pick a region near you
3. Wait ~2 minutes for it to provision

## 2. Create the database schema

1. In the Supabase dashboard, open **SQL Editor** → **New query**
2. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql)
3. Click **Run**. You should see "Success. No rows returned."

## 3. Configure authentication

1. Go to **Authentication → Sign In / Providers** and make sure **Email** is enabled
2. Optional: under **Confirm email** decide whether users must click a confirmation link before first login
   - ON (default): safer, but each user must confirm their email once
   - OFF: smoother onboarding for a small internal team

## 4. Connect the extension

1. In Supabase go to **Project Settings → API** (or **Data API**) and copy:
   - **Project URL** (like `https://abcdefgh.supabase.co`)
   - **anon / public key**
2. Open [`lib/config.js`](lib/config.js) in this folder and paste both values
3. Load the extension: `chrome://extensions` → Developer mode ON → **Load unpacked** → select this folder
   (if already loaded, click the reload ↻ icon)

> The anon key is safe to distribute — it only allows what the row-level-security rules permit.

## 5. First sign-up = super admin

1. Click the OptiPass icon → **Sign up** with your email + an account password
2. **The very first account created automatically becomes the super admin.** Do this yourself before sharing the extension.
3. Create your **master password** (this one encrypts your data and can NEVER be recovered — write it down somewhere safe)
4. You're in. Your **Personal** vault is created automatically.

## 6. Onboard the team

Each teammate needs the extension folder (share it, or later publish privately on the Chrome Web Store) with the same `lib/config.js`.

Two ways in, both admin-controlled:

- **Invite (recommended):** Admin → *Invite by email*. When that person signs up, they're active immediately.
- **Approve:** If someone signs up uninvited, they sit in *pending* until an admin approves them in the Admin screen.

Each user sets their **own** master password — nobody, including admins, can read anyone else's personal vault.

## 7. Shared vaults

1. Admin screen → *Shared vaults* → create one (e.g. "IT Team", "Clients")
2. Under *Vault members*, add teammates and pick their permission:
   - **Manager** — add/remove members, delete vault, edit items
   - **Editor** — add/edit/delete items
   - **Viewer** — read & copy only

Notes on how sharing works (end-to-end encryption rules):

- Only a **manager of that vault** can add members, because adding someone means encrypting the vault key for them — and only members hold the vault key. Being a global admin isn't enough by itself.
- If someone is removed from a vault, they can't fetch anything anymore, but passwords they already saw should be rotated — same as any password manager.

## Forgot passwords?

- **Account password** (email login): reset via Supabase's email reset — or an admin can send a reset from the Supabase dashboard (Authentication → Users).
- **Master password: cannot be recovered. Ever.** That's the zero-knowledge design. The person's personal vault is lost; shared vaults are fine (a manager re-adds them after they redo key setup). To reset someone's keys: delete their row from `user_keys` in Supabase, they set a new master password on next login, then managers re-add them to shared vaults.
