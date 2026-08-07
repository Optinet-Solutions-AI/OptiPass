-- ============================================================
-- OptiPass migration 006 - invite-only signup + user deletion
-- Run after migration 005.
--
-- 1) Signing up now REQUIRES a valid invite (code or invited
--    email). Uninvited signups are rejected instead of parking
--    in 'pending'. The very first account (fresh install) is
--    still allowed and becomes super admin.
-- 2) The super admin can delete user accounts from the app via
--    admin_delete_user (cascades to profile, keys, memberships).
-- ============================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as
$$
declare
  inv invites%rowtype;
  has_inv boolean := false;
  first_user boolean;
begin
  select count(*) = 0 into first_user from profiles;

  if coalesce(new.raw_user_meta_data->>'invite_code', '') <> '' then
    select * into inv from invites where code = new.raw_user_meta_data->>'invite_code';
    has_inv := found;
  end if;
  if not has_inv then
    select * into inv from invites where lower(email) = lower(new.email);
    has_inv := found;
  end if;

  if not first_user and not has_inv then
    raise exception 'An invite is required to join';
  end if;

  insert into profiles (id, email, display_name, role, status)
  values (
    new.id,
    new.email,
    split_part(new.email, '@', 1),
    case when first_user then 'super_admin' else inv.role end,
    'active'
  );

  if has_inv then
    delete from invites where email = inv.email;
  end if;
  return new;
end;
$$;

create or replace function public.admin_delete_user(target_id uuid)
returns void language plpgsql security definer set search_path = public as
$$
declare
  caller profiles%rowtype;
  target profiles%rowtype;
begin
  select * into caller from profiles where id = auth.uid();
  if caller is null or caller.status <> 'active' or caller.role <> 'super_admin' then
    raise exception 'Only the super admin can delete users';
  end if;
  select * into target from profiles where id = target_id;
  if not found then
    raise exception 'User not found';
  end if;
  if target.role = 'super_admin' then
    raise exception 'Super admin accounts cannot be deleted';
  end if;
  delete from auth.users where id = target_id;
end;
$$;
