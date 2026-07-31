-- ============================================================
-- OptiPass migration 003 - API-based credit monitors
-- Run after migration 002 (or a fresh schema.sql older than this).
--
-- Adds a second monitor kind: instead of scraping the dashboard
-- page, OptiPass calls the tool's own API (e.g. EnigmaProxy's
-- /api/customer/packages/{id} -> remainingBandwidth).
--
-- The API key is a secret, so the API config {url, key, field}
-- is stored END-TO-END ENCRYPTED with the key of a vault the
-- creator picks (api_iv + api_enc, AES-GCM). Only members of
-- that vault can decrypt it and refresh the reading; the reading
-- itself stays team-visible like page monitors.
-- ============================================================

alter table public.tool_monitors
  add column kind text not null default 'page' check (kind in ('page', 'api')),
  add column api_vault_id uuid references public.vaults (id) on delete set null,
  add column api_iv text,
  add column api_enc text;
