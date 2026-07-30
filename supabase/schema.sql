-- ============================================================
-- OptiPass v2 - Supabase schema
-- Paste this whole file into: Supabase Dashboard > SQL Editor > Run
--
-- Security model (zero-knowledge):
--   * The server NEVER sees plaintext passwords or vault keys.
--   * Each user has an RSA keypair. The private key is stored
--     encrypted with a key derived from their master password.
--   * Each vault has an AES-256 key, stored once per member,
--     wrapped (encrypted) with that member's RSA public key.
--   * Items are AES-GCM blobs encrypted with the vault key.
--
-- Access model:
--   * global roles: super_admin > admin > member
--   * the FIRST user to sign up becomes super_admin automatically
--   * anyone else who signs up uninvited lands in status 'pending'
--     and can do nothing until an admin approves them
--   * per-vault roles: manager > editor > viewer
-- ============================================================

-- ============ TABLES ============

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null default 'member' check (role in ('super_admin', 'admin', 'member')),
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  theme text not null default 'light' check (theme in ('light', 'dark')),
  public_key jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Private key material, encrypted client-side under the user's master password.
create table public.user_keys (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  key_salt text not null,
  iterations integer not null default 600000,
  iv text not null,
  ct text not null,
  updated_at timestamptz not null default now()
);

create table public.invites (
  email text primary key,
  role text not null default 'member' check (role in ('admin', 'member')),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.vaults (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'shared' check (type in ('personal', 'shared')),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index one_personal_vault_per_user
  on public.vaults (created_by) where (type = 'personal');

create table public.vault_members (
  vault_id uuid not null references public.vaults (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'editor' check (role in ('manager', 'editor', 'viewer')),
  wrapped_key text not null, -- vault key wrapped with this member's RSA public key
  added_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (vault_id, user_id)
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults (id) on delete cascade,
  iv text not null,
  enc_data text not null, -- AES-GCM blob: {type,title,url,username,password,notes,...}
  created_by uuid default auth.uid(),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- ============ HELPER FUNCTIONS ============
-- security definer so RLS policies can consult these tables
-- without recursing into their own policies.

create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and status = 'active'); $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles
                  where id = auth.uid() and status = 'active'
                    and role in ('admin', 'super_admin')); $$;

create or replace function public.is_vault_member(v uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from vault_members where vault_id = v and user_id = auth.uid()); $$;

create or replace function public.vault_role(v uuid)
returns text language sql stable security definer set search_path = public as
$$ select role from vault_members where vault_id = v and user_id = auth.uid(); $$;

create or replace function public.vault_is_empty(v uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select not exists (select 1 from vault_members where vault_id = v); $$;

create or replace function public.vault_creator(v uuid)
returns uuid language sql stable security definer set search_path = public as
$$ select created_by from vaults where id = v; $$;

-- ============ SIGNUP GATING ============
-- First user ever -> active super_admin.
-- Invited email     -> active, with the invited role.
-- Anyone else       -> status 'pending' (no access until approved).

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as
$$
declare
  inv record;
  first_user boolean;
begin
  select count(*) = 0 into first_user from profiles;
  select * into inv from invites where lower(email) = lower(new.email);

  insert into profiles (id, email, display_name, role, status)
  values (
    new.id,
    new.email,
    split_part(new.email, '@', 1),
    case when first_user then 'super_admin'
         when inv.email is not null then inv.role
         else 'member' end,
    case when first_user or inv.email is not null then 'active'
         else 'pending' end
  );

  delete from invites where lower(email) = lower(new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ ADMIN RPC ============
-- Role/status changes go through this function, never direct UPDATEs.

create or replace function public.admin_update_user(
  target_id uuid,
  new_role text default null,
  new_status text default null
) returns void language plpgsql security definer set search_path = public as
$$
declare
  caller record;
  target record;
begin
  select * into caller from profiles where id = auth.uid();
  if caller is null or caller.status <> 'active'
     or caller.role not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;

  select * into target from profiles where id = target_id;
  if target is null then
    raise exception 'User not found';
  end if;
  if target.role = 'super_admin' then
    raise exception 'Super admin accounts cannot be modified';
  end if;

  if new_role is not null then
    if caller.role <> 'super_admin' then
      raise exception 'Only the super admin can change roles';
    end if;
    if new_role not in ('admin', 'member') then
      raise exception 'Invalid role';
    end if;
    update profiles set role = new_role where id = target_id;
  end if;

  if new_status is not null then
    if new_status not in ('active', 'disabled', 'pending') then
      raise exception 'Invalid status';
    end if;
    update profiles set status = new_status where id = target_id;
  end if;
end;
$$;

-- ============ updated_at MAINTENANCE ============

create or replace function public.touch_updated_at()
returns trigger language plpgsql as
$$ begin new.updated_at = now(); return new; end; $$;

create or replace function public.touch_item()
returns trigger language plpgsql as
$$ begin new.updated_at = now(); new.updated_by = auth.uid(); return new; end; $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger user_keys_touch before update on public.user_keys
  for each row execute function public.touch_updated_at();
create trigger items_touch before update on public.items
  for each row execute function public.touch_item();

-- ============ ROW LEVEL SECURITY ============

alter table public.profiles enable row level security;
alter table public.user_keys enable row level security;
alter table public.invites enable row level security;
alter table public.vaults enable row level security;
alter table public.vault_members enable row level security;
alter table public.items enable row level security;
alter table public.audit_log enable row level security;

-- profiles: you always see your own; active users see the team
-- (emails + public keys are needed for member pickers and key wrapping)
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_active());
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- user_keys: strictly your own row
create policy user_keys_own on public.user_keys for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- invites: admins only
create policy invites_select on public.invites for select using (public.is_admin());
create policy invites_insert on public.invites for insert with check (public.is_admin());
create policy invites_delete on public.invites for delete using (public.is_admin());

-- vaults
create policy vaults_select on public.vaults for select
  using (public.is_active() and (public.is_vault_member(id) or created_by = auth.uid()));
create policy vaults_insert on public.vaults for insert
  with check (
    public.is_active() and created_by = auth.uid()
    and (type = 'personal' or (type = 'shared' and public.is_admin()))
  );
create policy vaults_update on public.vaults for update
  using (public.is_active() and public.vault_role(id) = 'manager');
create policy vaults_delete on public.vaults for delete
  using (public.is_active() and public.vault_role(id) = 'manager');

-- vault_members: managers manage; the vault creator may add themself
-- as the first member (bootstrap when creating a vault)
create policy vm_select on public.vault_members for select
  using (public.is_active() and (user_id = auth.uid() or public.is_vault_member(vault_id)));
create policy vm_insert on public.vault_members for insert
  with check (
    public.is_active() and (
      public.vault_role(vault_id) = 'manager'
      or (user_id = auth.uid()
          and public.vault_creator(vault_id) = auth.uid()
          and public.vault_is_empty(vault_id))
    )
  );
create policy vm_update on public.vault_members for update
  using (public.is_active() and public.vault_role(vault_id) = 'manager');
create policy vm_delete on public.vault_members for delete
  using (public.is_active() and (public.vault_role(vault_id) = 'manager' or user_id = auth.uid()));

-- items: members read; managers/editors write
create policy items_select on public.items for select
  using (public.is_active() and public.is_vault_member(vault_id));
create policy items_insert on public.items for insert
  with check (public.is_active() and public.vault_role(vault_id) in ('manager', 'editor'));
create policy items_update on public.items for update
  using (public.is_active() and public.vault_role(vault_id) in ('manager', 'editor'))
  with check (public.is_active() and public.vault_role(vault_id) in ('manager', 'editor'));
create policy items_delete on public.items for delete
  using (public.is_active() and public.vault_role(vault_id) in ('manager', 'editor'));

-- audit_log: append-only for users, readable by admins
create policy audit_insert on public.audit_log for insert
  with check (auth.uid() is not null and user_id = auth.uid());
create policy audit_select on public.audit_log for select using (public.is_admin());

-- ============ PRIVILEGE HARDENING ============

-- anon key holders (not signed in) get nothing from the REST API
revoke all on all tables in schema public from anon;

-- profiles rows are only created by the signup trigger, and users may
-- self-edit only cosmetic/key columns; role & status go through the RPC
revoke insert, update, delete on public.profiles from authenticated;
grant update (display_name, theme, public_key) on public.profiles to authenticated;

-- the audit log is append-only
revoke update, delete on public.audit_log from authenticated;
