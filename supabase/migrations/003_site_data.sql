-- Dukan Builder: per-site customer submissions (run once, idempotent).
-- Mirrors scripts/migrate-003.cjs so a fresh host can apply everything from
-- the Supabase SQL editor (001, 002, 003 in order).

create table if not exists public.site_requests (
  id text primary key,
  site_id text not null references public.sites(id) on delete cascade,
  ref text not null,
  type text not null check (type in ('booking','inquiry')),
  status text not null default 'new',
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  message text not null default '',
  fields jsonb not null default '{}'::jsonb,
  sample boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists site_requests_site_ref_uq
  on public.site_requests (site_id, ref);
create index if not exists site_requests_site_created_idx
  on public.site_requests (site_id, created_at desc);

create table if not exists public.site_subscribers (
  id text primary key,
  site_id text not null references public.sites(id) on delete cascade,
  email text not null,
  name text not null default '',
  sample boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists site_subscribers_site_email_uq
  on public.site_subscribers (site_id, email);

alter table public.sites
  add column if not exists data_seeded boolean not null default false;
