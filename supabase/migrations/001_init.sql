-- Dukan Builder: Supabase Postgres schema (run once, idempotent).
-- Timestamps are timestamptz; the app formats them as "YYYY-MM-DD HH:MM:SS" UTC.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  is_admin integer not null default 0,
  status text not null default 'active', -- 'active' | 'suspended'
  created_at timestamptz not null default now()
);

create table if not exists public.quota (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  builds_used integer not null default 0,
  builds_allowed integer not null default 5
);

create table if not exists public.sites (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  slug text unique not null,
  business_name text not null,
  status text not null default 'draft', -- 'draft' | 'ready' | 'published'
  category text not null default 'other',
  custom_domain text,
  created_at timestamptz not null default now()
);
create index if not exists idx_sites_user on public.sites(user_id);
create index if not exists idx_sites_status on public.sites(status);

create table if not exists public.briefs (
  id text primary key,
  site_id text not null references public.sites(id) on delete cascade,
  instructions text not null default '',
  address text not null default '',
  phone text not null default '',
  hours text not null default '',
  services text not null default '',
  colors text not null default '',
  category text not null default 'other',
  design_plan text not null default '',
  design_image text not null default '',
  design_image_mime text not null default '',
  design_notes text not null default '',
  media text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.builds (
  id text primary key,
  site_id text not null references public.sites(id) on delete cascade,
  opencode_session_id text,
  status text not null default 'queued', -- 'queued' | 'building' | 'ready' | 'failed'
  kind text not null default 'build', -- 'build' | 'refine'
  input text not null default '',
  failure_reason text,
  reviewed integer not null default 0,
  log text not null default '',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_builds_site on public.builds(site_id);
create index if not exists idx_builds_status on public.builds(status);
create index if not exists idx_builds_created on public.builds(created_at desc);

create table if not exists public.chat_messages (
  id text primary key,
  site_id text not null references public.sites(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_site on public.chat_messages(site_id);

create table if not exists public.previews (
  site_id text primary key references public.sites(id) on delete cascade,
  pid integer not null,
  port integer not null,
  started_at timestamptz not null default now()
);

create table if not exists public.rate_limits (
  key text primary key,
  tokens real not null,
  updated_at bigint not null
);

create table if not exists public.audit_log (
  id text primary key,
  actor_id uuid,
  actor_email text,
  action text not null,
  target_type text,
  target_id text,
  reason text,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_created on public.audit_log(created_at desc);
create index if not exists idx_audit_action on public.audit_log(action);

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.site_flags (
  id text primary key,
  site_id text not null references public.sites(id) on delete cascade,
  reported_by uuid,
  reason text not null,
  status text not null default 'open', -- 'open' | 'reviewed' | 'dismissed'
  created_at timestamptz not null default now()
);
create index if not exists idx_flags_status on public.site_flags(status);

-- Profile + quota row for every Supabase Auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  insert into public.quota (user_id, builds_allowed)
  values (new.id, coalesce(
    (select (value::jsonb)::int from public.platform_settings where key = 'default_builds_allowed'),
    5
  ))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Default platform settings.
insert into public.platform_settings (key, value) values
  ('default_builds_allowed', '5'),
  ('announcement_banner', '""'),
  ('banned_words', '[]'),
  ('feature_beta_builds', 'true')
on conflict (key) do nothing;
