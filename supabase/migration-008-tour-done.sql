-- ============================================================
-- OptiPass migration 008 - remember the tour per account
-- Run after migration 007.
--
-- The extension's first-run tour used to be remembered only in
-- the browser, so it replayed on every new browser. tour_done
-- keeps it on the profile. Everyone who already has keys has
-- been through onboarding, so they start as done.
-- ============================================================

alter table public.profiles
  add column if not exists tour_done boolean not null default false;

update public.profiles p
   set tour_done = true
 where exists (select 1 from public.user_keys k where k.user_id = p.id);

grant update (tour_done) on public.profiles to authenticated;
