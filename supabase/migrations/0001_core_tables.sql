-- 0001: core tables (profiles, businesses, cases, documents, chats).
-- Idempotent: safe to re-run. All user tables get RLS owner-only
-- policies in 0004; this file only creates tables and indexes.
-- Requires the pgcrypto extension for gen_random_uuid (enabled by
-- default on Supabase projects).

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  email text,
  full_name text,
  phone text,
  pan text,
  gstin text,
  address text,
  city text,
  state text,
  pincode text,
  profile_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  gstin text,
  pan text,
  address text,
  business_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists businesses_user_id_idx on public.businesses (user_id);

create table if not exists public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);
create index if not exists business_members_user_id_idx on public.business_members (user_id);

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled case',
  notice_type text,
  authority text,
  period text,
  deadline text,
  status text not null default 'open',
  notes text,
  amount numeric,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cases_user_id_idx on public.cases (user_id);

create table if not exists public.case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists case_events_case_id_idx on public.case_events (case_id);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'other',
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index if not exists documents_user_id_idx on public.documents (user_id);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_user_id_idx on public.conversations (user_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text,
  content text,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_id_idx on public.messages (conversation_id);

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.businesses;
create trigger set_updated_at before update on public.businesses
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.cases;
create trigger set_updated_at before update on public.cases
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.conversations;
create trigger set_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();
