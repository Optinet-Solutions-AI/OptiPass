-- ============================================================
-- OptiPass migration 005 - shareable invite codes
-- Run after migration 004.
--
-- Every invite gets a unique code an admin can copy and send.
-- A new user signs up with their email + their own new password
-- and pastes the code - the signup trigger activates the account
-- immediately (the code wins even if the signup email differs
-- from the invited email).
-- ============================================================

alter table public.invites
  add column code text not null unique default encode(gen_random_bytes(8), 'hex');

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

  insert into profiles (id, email, display_name, role, status)
  values (
    new.id,
    new.email,
    split_part(new.email, '@', 1),
    case when first_user then 'super_admin'
         when has_inv then inv.role
         else 'member' end,
    case when first_user or has_inv then 'active'
         else 'pending' end
  );

  if has_inv then
    delete from invites where email = inv.email;
  end if;
  return new;
end;
$$;
