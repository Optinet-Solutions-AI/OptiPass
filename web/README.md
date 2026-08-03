# OptiPass Web

The web version of OptiPass — same Supabase login, same database, same
zero-knowledge encryption as the Chrome extension. Built with Next.js.

## What works on the web

- Sign in / sign up (with invite codes), pending-approval gate
- Master password setup and unlock (keys held in the tab's session only,
  idle auto-lock)
- Vault list with search and vault filter; copy username / password /
  live 2FA codes
- Full entry editor: passwords, generator, 2FA keys, multiple API-key
  secrets, notes, credit/usage metrics
- Credit readings under each entry with LOW highlighting; API-kind
  metrics can refresh from the browser (tools whose APIs block browser
  requests refresh via the extension instead)
- Admin: approve users, invites with codes, roles, shared vaults and
  members
- Per-user light/dark theme

Extension-only by nature: autofill into pages, the click-to-pick element
capture, dashboard page scraping, the quick-unlock PIN, and the toolbar
alert badge.

## Develop

```bash
cd web
npm install
npm run dev     # http://localhost:3000
```

## Deploy to Vercel

1. vercel.com → Add New → Project → import `Optinet-Solutions-AI/OptiPass`
2. **Root Directory: `web`** (Framework Preset: Next.js — auto-detected)
3. Deploy. No environment variables needed — the Supabase URL and anon
   key are baked into `web/lib/config.js` (public by design; row-level
   security and end-to-end encryption do the protecting).

Every push to `main` that touches `web/` redeploys automatically.
