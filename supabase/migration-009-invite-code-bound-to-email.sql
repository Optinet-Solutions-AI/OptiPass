-- ============================================================
-- OptiPass migration 009 - an invite code only works for its email
-- Run after migration 008.
--
-- Before: a valid invite code was accepted for ANY signup email, so a
-- forwarded signup link let someone else join with the invitee's role
-- (and used up their invite). Now a code counts only when the signup
-- email matches the invite's email; otherwise it is ignored and the
-- usual email check applies (no invite for that email -> rejected).
-- Safe to run more than once.
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

  -- invite code (from signup metadata), only for the email it was issued to
  if coalesce(new.raw_user_meta_data->>'invite_code', '') <> '' then
    select * into inv from invites
     where code = new.raw_user_meta_data->>'invite_code'
       and lower(email) = lower(new.email);
    has_inv := found;
  end if;
  if not has_inv then
    select * into inv from invites where lower(email) = lower(new.email);
    has_inv := found;
  end if;

  -- invite-only: uninvited signups are rejected (first user excepted)
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
