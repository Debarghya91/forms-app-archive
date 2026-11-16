-- 0003: revenue, referral, analytics, tax packs, and CA tables.
-- Idempotent: safe to re-run. RLS policies live in 0004.
-- The plans table is not in the contract section 4 list, but sections
-- 3 and 8 require a plans table for server-side entitlement caps, so
-- it is created here. That is the only table beyond the contract list.

create table if not exists public.plans (
  id text primary key,
  display_name text,
  monthly_price_paise integer,
  display_price text,
  ai_calls_per_day integer,
  ai_calls_per_month integer,
  features jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan text not null,
  status text not null default 'active',
  started_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  plan text not null default 'free',
  ai_calls_today integer not null default 0,
  ai_calls_day date,
  credits integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  delta integer not null,
  reason text,
  balance_after integer,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_id_idx on public.credit_ledger (user_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  razorpay_order_id text,
  razorpay_payment_id text,
  amount integer,
  currency text not null default 'INR',
  pack text,
  plan text,
  status text not null default 'created',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_user_id_idx on public.payments (user_id);
create index if not exists payments_order_id_idx on public.payments (razorpay_order_id);
create unique index if not exists payments_payment_id_key
  on public.payments (razorpay_payment_id)
  where razorpay_payment_id is not null;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.referral_uses (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references auth.users (id) on delete cascade,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  code text,
  credits_earned integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists referral_uses_referrer_id_idx on public.referral_uses (referrer_id);

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text,
  ts timestamptz,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists analytics_events_user_id_idx on public.analytics_events (user_id);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  action text,
  entity_type text,
  entity_id text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_user_id_idx on public.audit_log (user_id);

create table if not exists public.tax_rule_packs (
  id uuid primary key default gen_random_uuid(),
  ay text not null,
  version integer not null,
  payload jsonb not null,
  source text,
  verified boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (ay, version)
);

create table if not exists public.rag_sources (
  id text primary key,
  title text,
  publisher text,
  url text,
  published_date date,
  version integer,
  topics text[],
  chunks jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ca_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  firm_name text,
  name text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ca_clients (
  id uuid primary key default gen_random_uuid(),
  ca_user_id uuid not null references auth.users (id) on delete cascade,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (ca_user_id, client_user_id)
);
create index if not exists ca_clients_ca_user_id_idx on public.ca_clients (ca_user_id);
create index if not exists ca_clients_client_user_id_idx on public.ca_clients (client_user_id);

drop trigger if exists set_updated_at on public.subscriptions;
create trigger set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.entitlements;
create trigger set_updated_at before update on public.entitlements
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.payments;
create trigger set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.ca_profiles;
create trigger set_updated_at before update on public.ca_profiles
  for each row execute function public.set_updated_at();
