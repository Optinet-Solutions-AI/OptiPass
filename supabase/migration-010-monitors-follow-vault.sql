-- ============================================================
-- OptiPass migration 010 - credit monitors follow their tool's vault
-- Run after migration 009.
--
-- Monitors were readable and changeable by every active user, so the
-- toolbar LOW badge counted monitors on tools in other people's vaults,
-- and anyone could edit or delete them. Now a monitor belongs to the
-- vault of its tool (items.vault_id):
--   * members of that vault see it and may refresh its reading
--     (Viewers included - readings are captured while on the dashboard);
--   * only Managers/Editors may create it, change its settings or delete it.
-- Old monitors without a tool (before migration 004) stay visible so the
-- extension can attach them to a matching tool, as before.
-- ============================================================

create or replace function public.item_vault(i uuid)
returns uuid language sql stable security definer set search_path = public as
$$ select vault_id from items where id = i; $$;

drop policy if exists monitors_select on public.tool_monitors;
drop policy if exists monitors_insert on public.tool_monitors;
drop policy if exists monitors_update on public.tool_monitors;
drop policy if exists monitors_delete on public.tool_monitors;

create policy monitors_select on public.tool_monitors for select
  using (public.is_active()
         and (item_id is null or public.is_vault_member(public.item_vault(item_id))));
create policy monitors_insert on public.tool_monitors for insert
  with check (public.is_active() and item_id is not null
              and public.vault_role(public.item_vault(item_id)) in ('manager', 'editor'));
create policy monitors_update on public.tool_monitors for update
  using (public.is_active()
         and (item_id is null or public.is_vault_member(public.item_vault(item_id))))
  with check (public.is_active()
              and (item_id is null or public.is_vault_member(public.item_vault(item_id))));
create policy monitors_delete on public.tool_monitors for delete
  using (public.is_active()
         and (case when item_id is null then created_by = auth.uid() or public.is_admin()
                   else public.vault_role(public.item_vault(item_id)) in ('manager', 'editor') end));

-- Viewers may refresh a reading but not change what is monitored.
create or replace function public.guard_monitor_update()
returns trigger language plpgsql as
$$
begin
  if auth.uid() is not null
     and old.item_id is not null
     and coalesce(public.vault_role(public.item_vault(old.item_id)), '') not in ('manager', 'editor')
     and (new.item_id, new.name, new.url, new.kind, new.selector, new.keyword, new.api_vault_id,
          new.api_iv, new.api_enc, new.unit, new.threshold, new.created_by)
         is distinct from
         (old.item_id, old.name, old.url, old.kind, old.selector, old.keyword, old.api_vault_id,
          old.api_iv, old.api_enc, old.unit, old.threshold, old.created_by) then
    raise exception 'Only editors of this tool''s vault can change its monitor';
  end if;
  return new;
end;
$$;

drop trigger if exists tool_monitors_guard on public.tool_monitors;
create trigger tool_monitors_guard
  before update on public.tool_monitors
  for each row execute function public.guard_monitor_update();
