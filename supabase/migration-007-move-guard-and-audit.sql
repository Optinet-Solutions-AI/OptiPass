-- ============================================================
-- OptiPass migration 007 - creator-only moves + database audit
-- Run after migration 006.
--
-- 1) Only the creator of a tool may move it to another vault.
-- 2) A database-level audit trail records every meaningful
--    change (items, members, vaults, users, invites) into
--    audit_log - clients cannot skip it. Item contents stay
--    encrypted; only ids and metadata are logged.
-- ============================================================

-- ---------- creator-only moves ----------

create or replace function public.enforce_item_move()
returns trigger language plpgsql as
$$
begin
  if new.vault_id is distinct from old.vault_id
     and old.created_by is distinct from auth.uid() then
    raise exception 'Only the tool''s creator can move it to another vault';
  end if;
  return new;
end;
$$;

drop trigger if exists items_move_guard on public.items;
create trigger items_move_guard
  before update on public.items
  for each row execute function public.enforce_item_move();

-- ---------- audit trail ----------

create or replace function public.audit_items()
returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (user_id, action, detail)
    values (auth.uid(), 'db.item.create', jsonb_build_object('item_id', new.id, 'vault_id', new.vault_id));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.vault_id is distinct from old.vault_id then
      insert into audit_log (user_id, action, detail)
      values (auth.uid(), 'db.item.move',
              jsonb_build_object('item_id', new.id, 'from_vault', old.vault_id, 'to_vault', new.vault_id));
    else
      insert into audit_log (user_id, action, detail)
      values (auth.uid(), 'db.item.update', jsonb_build_object('item_id', new.id, 'vault_id', new.vault_id));
    end if;
    return new;
  else
    insert into audit_log (user_id, action, detail)
    values (auth.uid(), 'db.item.delete', jsonb_build_object('item_id', old.id, 'vault_id', old.vault_id));
    return old;
  end if;
end;
$$;

drop trigger if exists items_audit on public.items;
create trigger items_audit
  after insert or update or delete on public.items
  for each row execute function public.audit_items();

create or replace function public.audit_members()
returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (user_id, action, detail)
    values (auth.uid(), 'db.member.add',
            jsonb_build_object('vault_id', new.vault_id, 'user_id', new.user_id, 'role', new.role));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      insert into audit_log (user_id, action, detail)
      values (auth.uid(), 'db.member.role',
              jsonb_build_object('vault_id', new.vault_id, 'user_id', new.user_id,
                                 'old_role', old.role, 'new_role', new.role));
    end if;
    return new;
  else
    insert into audit_log (user_id, action, detail)
    values (auth.uid(), 'db.member.remove',
            jsonb_build_object('vault_id', old.vault_id, 'user_id', old.user_id));
    return old;
  end if;
end;
$$;

drop trigger if exists members_audit on public.vault_members;
create trigger members_audit
  after insert or update or delete on public.vault_members
  for each row execute function public.audit_members();

create or replace function public.audit_vaults()
returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (user_id, action, detail)
    values (auth.uid(), 'db.vault.create',
            jsonb_build_object('vault_id', new.id, 'name', new.name, 'type', new.type));
    return new;
  else
    insert into audit_log (user_id, action, detail)
    values (auth.uid(), 'db.vault.delete',
            jsonb_build_object('vault_id', old.id, 'name', old.name, 'type', old.type));
    return old;
  end if;
end;
$$;

drop trigger if exists vaults_audit on public.vaults;
create trigger vaults_audit
  after insert or delete on public.vaults
  for each row execute function public.audit_vaults();

create or replace function public.audit_profiles()
returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (user_id, action, detail)
    values (new.id, 'db.user.signup', jsonb_build_object('email', new.email, 'role', new.role));
    return new;
  end if;
  if new.role is distinct from old.role or new.status is distinct from old.status then
    insert into audit_log (user_id, action, detail)
    values (auth.uid(), 'db.user.change',
            jsonb_build_object('target', new.id, 'old_role', old.role, 'new_role', new.role,
                               'old_status', old.status, 'new_status', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit
  after insert or update on public.profiles
  for each row execute function public.audit_profiles();

create or replace function public.audit_invites()
returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (user_id, action, detail)
    values (auth.uid(), 'db.invite.create', jsonb_build_object('email', new.email, 'role', new.role));
    return new;
  else
    insert into audit_log (user_id, action, detail)
    values (auth.uid(), 'db.invite.removed', jsonb_build_object('email', old.email));
    return old;
  end if;
end;
$$;

drop trigger if exists invites_audit on public.invites;
create trigger invites_audit
  after insert or delete on public.invites
  for each row execute function public.audit_invites();
