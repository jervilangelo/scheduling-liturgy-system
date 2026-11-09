-- ECCM Liturgy & Ministry Planning — initial schema
-- Column names are snake_case versions of the TypeScript fields in src/types/domain.ts.
-- One volunteer directory and one assignment table serve every ministry.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Users and permissions
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role text not null default 'viewer' check (role in ('admin', 'approver', 'planner', 'viewer'))
);

create table public.role_permissions (
  id text primary key,                       -- '<role>:<permission>'
  role text not null check (role in ('admin', 'approver', 'planner', 'viewer')),
  permission text not null check (permission in (
    'view', 'edit_liturgy', 'edit_schedule', 'manage_volunteers', 'manage_songs',
    'submit_review', 'approve', 'publish', 'manage_settings', 'manage_users')),
  unique (role, permission)
);

-- Permission check used by every policy. Admins always keep view/settings/users
-- so the matrix can never lock everyone out.
create or replace function public.has_permission(p text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles pr
    left join role_permissions rp on rp.role = pr.role and rp.permission = p
    where pr.id = auth.uid()
      and (rp.id is not null or (pr.role = 'admin' and p in ('view', 'manage_settings', 'manage_users')))
  );
$$;

-- New sign-ups get a profile. The very first profile becomes admin (bootstrap);
-- everyone after starts as viewer until an admin assigns a role.
-- Disable public sign-ups in Supabase Auth and invite users instead.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)),
    case when exists (select 1 from public.profiles) then 'viewer' else 'admin' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only users with manage_users may change roles; nobody may change their own role.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role then
    if not public.has_permission('manage_users') then raise exception 'Not allowed to change roles'; end if;
    if new.id = auth.uid() then raise exception 'You cannot change your own role'; end if;
  end if;
  return new;
end; $$;
create trigger profiles_role_guard before update on public.profiles for each row execute function public.guard_profile_role();

-- ---------------------------------------------------------------------------
-- Ministries, roles, volunteers, availability
-- ---------------------------------------------------------------------------
create table public.ministries (
  id text primary key default gen_random_uuid()::text,
  slug text not null unique,
  name text not null,
  description text not null default '',
  default_start text not null default '09:00',
  default_end text not null default '11:00',
  uses_special_sundays boolean not null default false,
  active boolean not null default true
);

create table public.role_definitions (
  id text primary key default gen_random_uuid()::text,
  ministry_id text not null references public.ministries (id) on delete cascade,
  name text not null,
  min_count int not null default 1 check (min_count >= 0),
  sort_order int not null default 0,
  compatible_role_ids text[] not null default '{}',
  active boolean not null default true
);

create table public.volunteers (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  email text not null default '',
  phone text not null default '',
  ministry_ids text[] not null default '{}',
  role_ids text[] not null default '{}',
  max_per_month int not null default 0 check (max_per_month >= 0),
  active boolean not null default true,
  notes text not null default ''
);

create table public.availability (
  id text primary key default gen_random_uuid()::text,
  volunteer_id text not null references public.volunteers (id) on delete cascade,
  date date not null,
  note text not null default '',
  unique (volunteer_id, date)
);

-- ---------------------------------------------------------------------------
-- Services, assignments, liturgy
-- ---------------------------------------------------------------------------
create table public.services (
  id text primary key default gen_random_uuid()::text,
  ministry_id text not null references public.ministries (id),
  date date not null,
  start_time text not null,
  end_time text not null,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'published')),
  theme text not null default '',
  sermon jsonb not null default '{}'::jsonb,
  liturgy jsonb not null default '[]'::jsonb,
  creed_override text check (creed_override in ('nicene', 'apostles')),
  notes text not null default '',
  liturgy_version int not null default 0,
  submitted_by text,
  approved_by text,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (ministry_id, date, start_time)
);
create index services_date_idx on public.services (date);

-- Workflow enforcement in the database (mirrors src/modules/publishing).
create or replace function public.guard_service()
returns trigger language plpgsql security definer set search_path = public as $$
declare needed text;
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    needed := case
      when old.status = 'draft' and new.status = 'in_review' then 'submit_review'
      when old.status in ('in_review', 'approved') and new.status = 'draft' then 'approve'
      when old.status = 'in_review' and new.status = 'approved' then 'approve'
      when old.status = 'approved' and new.status = 'published' then 'publish'
      when old.status = 'published' and new.status = 'draft' then 'publish'
      else null end;
    if needed is null then raise exception 'Invalid status change % -> %', old.status, new.status; end if;
    if not public.has_permission(needed) then raise exception 'Missing permission: %', needed; end if;
  elsif tg_op = 'UPDATE' and old.status = 'published' then
    raise exception 'Published services are read-only. Unpublish first.';
  elsif tg_op = 'INSERT' and new.status <> 'draft'
        -- an upsert of an existing row fires BEFORE INSERT first; the UPDATE path re-checks it
        and not exists (select 1 from public.services s where s.id = new.id) then
    raise exception 'New services start as draft';
  end if;
  return new;
end; $$;
create trigger services_guard before insert or update on public.services for each row execute function public.guard_service();

create table public.assignments (
  id text primary key default gen_random_uuid()::text,
  service_id text not null references public.services (id) on delete cascade,
  role_id text not null references public.role_definitions (id) on delete cascade,
  volunteer_id text not null references public.volunteers (id) on delete cascade,
  overridden boolean not null default false,
  override_reason text not null default '',
  created_at timestamptz not null default now(),
  check (not overridden or length(trim(override_reason)) > 0)
);
create index assignments_service_idx on public.assignments (service_id);
create index assignments_volunteer_idx on public.assignments (volunteer_id);

create or replace function public.service_is_published(sid text)
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from services where id = sid and status = 'published'); $$;

create table public.songs (
  id text primary key default gen_random_uuid()::text,
  title text not null,
  artist text not null default '',
  themes text[] not null default '{}',
  song_key text not null default '',
  last_sung date,
  sheet_row int,
  notes text not null default ''
);

create table public.liturgy_templates (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  description text not null default '',
  items jsonb not null default '[]'::jsonb
);

create table public.liturgy_versions (
  id text primary key default gen_random_uuid()::text,
  service_id text not null references public.services (id) on delete cascade,
  version int not null,
  items jsonb not null,
  sermon jsonb not null,
  theme text not null default '',
  note text not null default '',
  saved_by text not null,
  saved_at timestamptz not null default now(),
  unique (service_id, version)
);

create table public.audit_log (
  id text primary key default gen_random_uuid()::text,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text not null,
  details text not null default ''
);
create index audit_log_at_idx on public.audit_log (at desc);

create table public.app_settings (
  id text primary key default 'global' check (id = 'global'),
  church_name text not null default 'ECCM',
  creed_anchor_year int not null default 2026,
  creed_anchor_month int not null default 1 check (creed_anchor_month between 1 and 12),
  creed_anchor_kind text not null default 'nicene' check (creed_anchor_kind in ('nicene', 'apostles')),
  communion_label text not null default 'Holy Communion',
  cpp_label text not null default 'CPP',
  creed_label text not null default 'Creed',
  default_template_id text,
  sheet_spreadsheet_id text not null default '',
  sheet_name text not null default 'SongList',
  sheet_title_header text not null default 'Title',
  sheet_last_sung_header text not null default 'Last Sung',
  sheet_theme_header text not null default 'Theme',
  sheet_artist_header text not null default 'Artist',
  consecutive_weeks_warning int not null default 3
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.ministries enable row level security;
alter table public.role_definitions enable row level security;
alter table public.volunteers enable row level security;
alter table public.availability enable row level security;
alter table public.services enable row level security;
alter table public.assignments enable row level security;
alter table public.songs enable row level security;
alter table public.liturgy_templates enable row level security;
alter table public.liturgy_versions enable row level security;
alter table public.audit_log enable row level security;
alter table public.app_settings enable row level security;

-- Read access: anyone signed in with 'view'
create policy read_profiles on public.profiles for select to authenticated using (id = auth.uid() or public.has_permission('view'));
create policy read_role_permissions on public.role_permissions for select to authenticated using (true);
create policy read_ministries on public.ministries for select to authenticated using (public.has_permission('view'));
create policy read_roles on public.role_definitions for select to authenticated using (public.has_permission('view'));
create policy read_volunteers on public.volunteers for select to authenticated using (public.has_permission('view'));
create policy read_availability on public.availability for select to authenticated using (public.has_permission('view'));
create policy read_services on public.services for select to authenticated using (public.has_permission('view'));
create policy read_assignments on public.assignments for select to authenticated using (public.has_permission('view'));
create policy read_songs on public.songs for select to authenticated using (public.has_permission('view'));
create policy read_templates on public.liturgy_templates for select to authenticated using (public.has_permission('view'));
create policy read_versions on public.liturgy_versions for select to authenticated using (public.has_permission('view'));
create policy read_audit on public.audit_log for select to authenticated using (public.has_permission('view'));
create policy read_settings on public.app_settings for select to authenticated using (public.has_permission('view'));

-- Writes
create policy write_profiles on public.profiles for update to authenticated using (public.has_permission('manage_users')) with check (public.has_permission('manage_users'));
create policy write_role_permissions on public.role_permissions for all to authenticated using (public.has_permission('manage_users')) with check (public.has_permission('manage_users'));
create policy write_ministries on public.ministries for all to authenticated using (public.has_permission('manage_settings')) with check (public.has_permission('manage_settings'));
create policy write_roles on public.role_definitions for all to authenticated using (public.has_permission('manage_settings')) with check (public.has_permission('manage_settings'));
create policy write_templates on public.liturgy_templates for all to authenticated using (public.has_permission('manage_settings') or public.has_permission('edit_liturgy')) with check (public.has_permission('manage_settings'));
create policy write_settings on public.app_settings for all to authenticated using (public.has_permission('manage_settings')) with check (public.has_permission('manage_settings'));
create policy write_volunteers on public.volunteers for all to authenticated using (public.has_permission('manage_volunteers')) with check (public.has_permission('manage_volunteers'));
create policy write_availability on public.availability for all to authenticated using (public.has_permission('manage_volunteers')) with check (public.has_permission('manage_volunteers'));

create policy insert_services on public.services for insert to authenticated
  with check (public.has_permission('edit_liturgy') or public.has_permission('edit_schedule'));
create policy update_services on public.services for update to authenticated
  using (public.has_permission('edit_liturgy') or public.has_permission('edit_schedule') or public.has_permission('submit_review') or public.has_permission('approve') or public.has_permission('publish'))
  with check (true); -- transitions and the published lock are enforced by services_guard

create policy write_assignments on public.assignments for all to authenticated
  using (public.has_permission('edit_schedule') and not public.service_is_published(service_id))
  with check (public.has_permission('edit_schedule') and not public.service_is_published(service_id));

create policy insert_songs on public.songs for insert to authenticated with check (public.has_permission('manage_songs'));
create policy update_songs on public.songs for update to authenticated using (public.has_permission('manage_songs') or public.has_permission('publish')) with check (true);
create policy delete_songs on public.songs for delete to authenticated using (public.has_permission('manage_songs'));

create policy insert_versions on public.liturgy_versions for insert to authenticated with check (public.has_permission('edit_liturgy'));

-- Audit log is append-only and attributed to the signed-in user.
create policy insert_audit on public.audit_log for insert to authenticated
  with check (actor = coalesce(auth.jwt() ->> 'email', ''));

-- ---------------------------------------------------------------------------
-- Defaults (mirrors src/modules/permissions DEFAULT_MATRIX and the demo seed)
-- ---------------------------------------------------------------------------
insert into public.role_permissions (id, role, permission)
select r || ':' || p, r, p from (values
  ('admin', 'view'), ('admin', 'edit_liturgy'), ('admin', 'edit_schedule'), ('admin', 'manage_volunteers'), ('admin', 'manage_songs'),
  ('admin', 'submit_review'), ('admin', 'approve'), ('admin', 'publish'), ('admin', 'manage_settings'), ('admin', 'manage_users'),
  ('approver', 'view'), ('approver', 'edit_liturgy'), ('approver', 'edit_schedule'), ('approver', 'submit_review'), ('approver', 'approve'), ('approver', 'publish'),
  ('planner', 'view'), ('planner', 'edit_liturgy'), ('planner', 'edit_schedule'), ('planner', 'manage_volunteers'), ('planner', 'manage_songs'), ('planner', 'submit_review'),
  ('viewer', 'view')
) as t(r, p);

insert into public.app_settings (id, default_template_id) values ('global', 'tpl-standard');

insert into public.ministries (id, slug, name, description, default_start, default_end, uses_special_sundays)
values ('min-worship', 'worship', 'Sunday worship', 'Main Sunday worship service', '09:00', '11:00', true);

insert into public.role_definitions (id, ministry_id, name, min_count, sort_order, compatible_role_ids) values
  ('role-leader', 'min-worship', 'Service Leader', 1, 0, '{role-music}'),
  ('role-reader', 'min-worship', 'Scripture Reader', 1, 1, '{}'),
  ('role-music', 'min-worship', 'Music', 1, 2, '{}');

-- The church's standard order of worship. Each line is "title: detail";
-- a song line with an empty title is written "- Song".
insert into public.liturgy_templates (id, name, description, items) values
  ('tpl-standard', 'Standard Sunday', 'Regular order of worship', '[
    {"id":"t1","kind":"song","title":"Preparatory","detail":""},
    {"id":"t2","kind":"call_to_worship","title":"Call to Worship","detail":""},
    {"id":"t3","kind":"song","title":"","detail":""},
    {"id":"t4","kind":"song","title":"","detail":""},
    {"id":"t5","kind":"scripture","title":"Scripture Reading","detail":""},
    {"id":"t6","kind":"confession","title":"Prayer of Confession","detail":""},
    {"id":"t7","kind":"song","title":"","detail":""},
    {"id":"t8","kind":"scripture","title":"Congregational Reading of Scripture","detail":""},
    {"id":"t9","kind":"prayer","title":"Prayer of Thanksgiving","detail":""},
    {"id":"t10","kind":"song","title":"","detail":""},
    {"id":"t11","kind":"prayer","title":"Pastoral Prayer","detail":""},
    {"id":"t12","kind":"song","title":"","detail":""},
    {"id":"t13","kind":"sermon","title":"Sermon","detail":""},
    {"id":"t14","kind":"song","title":"Response Song","detail":""}
  ]'::jsonb);
