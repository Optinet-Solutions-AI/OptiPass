-- ============================================================
-- OptiPass migration 002 - tool credit monitors
-- Run this in the SQL Editor of a project that already ran
-- schema.sql. (Fresh installs get this table from schema.sql.)
--
-- Monitors track "remaining credits/balance" readings scraped
-- from a tool's dashboard while a team member has it open.
-- Readings are team-visible (RLS: active users only). They are
-- not end-to-end encrypted - they contain no secrets, and this
-- lets any signed-in member refresh a value even while their
-- vault is locked.
-- ============================================================

create table public.tool_monitors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,               -- dashboard page the value lives on
  selector text,                   -- CSS selector captured by the picker
  keyword text,                    -- fallback: find the number near this word
  unit text,                       -- e.g. 'credits', 'GB', 'USD'
  threshold numeric,               -- warn when the value drops below this
  last_value text,                 -- raw text as seen on the page
  last_numeric numeric,            -- parsed number
  last_checked_at timestamptz,
  last_checked_by uuid references public.profiles (id) on delete set null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.tool_monitors enable row level security;

create policy monitors_select on public.tool_monitors for select
  using (public.is_active());
create policy monitors_insert on public.tool_monitors for insert
  with check (public.is_active());
create policy monitors_update on public.tool_monitors for update
  using (public.is_active()) with check (public.is_active());
create policy monitors_delete on public.tool_monitors for delete
  using (public.is_active());

revoke all on public.tool_monitors from anon;
