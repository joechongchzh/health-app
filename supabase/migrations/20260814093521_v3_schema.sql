create extension if not exists pgcrypto;

create table public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into public.app_config (key, value) values ('registration_mode', 'invite')
on conflict (key) do nothing;

create table public.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'disabled')),
  invited_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null,
  label text,
  expires_at timestamptz,
  max_uses integer not null default 1 check (max_uses > 0),
  use_count integer not null default 0 check (use_count >= 0),
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index invite_codes_hash_unique on public.invite_codes (code_hash);

create or replace function public.is_active_member(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where user_id = check_user_id and status = 'active'
  );
$$;

revoke all on function public.is_active_member(uuid) from public;
grant execute on function public.is_active_member(uuid) to authenticated;

create or replace function public.redeem_invite_code(raw_code text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  selected_id uuid;
  mode text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if public.is_active_member(auth.uid()) then
    return true;
  end if;

  select value into mode from public.app_config where key = 'registration_mode';
  if mode = 'open' then
    insert into public.memberships (user_id, invited_at)
    values (auth.uid(), now())
    on conflict (user_id) do update set status = 'active';
    return true;
  end if;

  select id into selected_id
  from public.invite_codes
  where disabled_at is null
    and (expires_at is null or expires_at > now())
    and use_count < max_uses
    and crypt(trim(raw_code), code_hash) = code_hash
  order by created_at
  for update skip locked
  limit 1;

  if selected_id is null then
    raise exception 'invalid or expired invite code';
  end if;

  update public.invite_codes set use_count = use_count + 1 where id = selected_id;
  insert into public.memberships (user_id, invited_at)
  values (auth.uid(), now())
  on conflict (user_id) do update set status = 'active', invited_at = excluded.invited_at;
  return true;
end;
$$;

revoke all on function public.redeem_invite_code(text) from public;
grant execute on function public.redeem_invite_code(text) to authenticated;

create or replace function public.require_newer_record_version()
returns trigger
language plpgsql
as $$
begin
  if new.version <= old.version then
    raise exception 'stale record version' using errcode = '40001';
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'days', 'meal_entries', 'workouts', 'weight_entries',
    'foods', 'combos', 'supplement_definitions', 'supplement_checkins', 'training_plans'
  ] loop
    execute format(
      'create table public.%I (
        id uuid primary key,
        user_id uuid not null references auth.users(id) on delete cascade,
        version integer not null default 1 check (version > 0),
        payload jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        deleted_at timestamptz,
        constraint payload_owner_matches check ((payload->>''userId'')::uuid = user_id),
        constraint payload_id_matches check ((payload->>''id'')::uuid = id)
      )', table_name
    );
    execute format('create index %I on public.%I (user_id, updated_at)', table_name || '_user_updated_idx', table_name);
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create trigger require_newer_version before update on public.%I for each row execute function public.require_newer_record_version()',
      table_name
    );
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = auth.uid() and public.is_active_member(auth.uid()))',
      table_name || '_select_own', table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = auth.uid() and public.is_active_member(auth.uid()))',
      table_name || '_insert_own', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = auth.uid() and public.is_active_member(auth.uid())) with check (user_id = auth.uid() and public.is_active_member(auth.uid()))',
      table_name || '_update_own', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (user_id = auth.uid() and public.is_active_member(auth.uid()))',
      table_name || '_delete_own', table_name
    );
  end loop;
end $$;

alter table public.app_config enable row level security;
alter table public.memberships enable row level security;
alter table public.invite_codes enable row level security;

create policy memberships_select_own on public.memberships
for select to authenticated using (user_id = auth.uid());

revoke all on public.app_config, public.invite_codes from anon, authenticated;
grant select on public.memberships to authenticated;
grant select, insert, update, delete on public.profiles, public.days, public.meal_entries,
  public.workouts, public.weight_entries, public.foods, public.combos,
  public.supplement_definitions, public.supplement_checkins, public.training_plans to authenticated;

comment on table public.invite_codes is
  'Create an invite with: insert into public.invite_codes(code_hash,label,max_uses,expires_at) values (crypt(''YOUR-CODE'', gen_salt(''bf'')), ''friends'', 10, now()+interval ''30 days'');';
