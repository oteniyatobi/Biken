create table if not exists public.ride_requests (
  id text primary key,
  name text not null,
  email text not null,
  phone text not null,
  pickup text not null,
  destination text not null,
  date date not null,
  time time not null,
  language text not null default 'English',
  status text not null default 'New'
    check (status in ('New', 'Finding rider', 'Confirmed', 'Completed', 'Cancelled')),
  rider text,
  rider_phone text,
  fare integer check (fare is null or fare >= 0),
  notes text,
  submitted_at timestamptz not null default now(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists ride_requests_status_idx on public.ride_requests (status);
create index if not exists ride_requests_date_idx on public.ride_requests (date);
create index if not exists ride_requests_submitted_at_idx on public.ride_requests (submitted_at desc);
alter table public.ride_requests
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  name text not null,
  role text not null default 'admin' check (role = 'admin'),
  created_at timestamptz not null default now(),
  last_login timestamptz
);

create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.admin_sessions add column if not exists token_hash text;
alter table public.admin_sessions drop column if exists token;
delete from public.admin_sessions where token_hash is null;
create unique index if not exists admin_sessions_token_hash_idx
  on public.admin_sessions (token_hash);
create index if not exists admin_sessions_user_id_idx on public.admin_sessions (user_id);
create index if not exists admin_sessions_expires_at_idx on public.admin_sessions (expires_at);

alter table public.ride_requests enable row level security;
alter table public.admin_users enable row level security;
alter table public.admin_sessions enable row level security;

revoke all on public.ride_requests, public.admin_users, public.admin_sessions
  from anon, authenticated;
