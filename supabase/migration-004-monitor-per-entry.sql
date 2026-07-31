-- ============================================================
-- OptiPass migration 004 - credit monitors live on entries
-- Run after migration 003.
--
-- Monitors are no longer standalone: each one belongs to a vault
-- entry ("Track remaining credits" option in the entry editor) and
-- its reading is shown in a box under that entry. Deleting the
-- entry deletes its monitor.
-- ============================================================

alter table public.tool_monitors
  add column item_id uuid references public.items (id) on delete cascade;
