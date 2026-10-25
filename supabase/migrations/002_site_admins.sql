-- Dukan Builder: per-site owner credentials + account TOTP (run once, idempotent).

create table if not exists public.site_admins (
  id text primary key,
  site_id text not null unique references public.sites(id) on delete cascade,
  username text not null unique,
  password_enc text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists totp_secret text,
  add column if not exists totp_enabled boolean not null default false,
  add column if not exists credentials_unlocked_until timestamptz;
