-- 0002: business tables (invoices, registers, expenses, reconciliation).
-- Idempotent: safe to re-run. RLS policies live in 0004.

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  number text,
  date date,
  buyer_name text,
  buyer_gstin text,
  taxable numeric,
  rate numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  total numeric,
  month text,
  status text not null default 'draft',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoices_user_id_idx on public.invoices (user_id);
create index if not exists invoices_month_idx on public.invoices (user_id, month);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  description text,
  hsn text,
  qty numeric,
  price numeric,
  taxable numeric,
  rate numeric,
  tax numeric,
  created_at timestamptz not null default now()
);
create index if not exists invoice_items_invoice_id_idx on public.invoice_items (invoice_id);

create table if not exists public.credit_debit_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text,
  date date,
  number text,
  party text,
  gstin text,
  amount numeric,
  tax numeric,
  reason text,
  against_invoice text,
  month text,
  created_at timestamptz not null default now()
);
create index if not exists credit_debit_notes_user_id_idx on public.credit_debit_notes (user_id);

create table if not exists public.sales_register (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date,
  invoice_no text,
  buyer text,
  gstin text,
  taxable numeric,
  rate numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  total numeric,
  month text,
  created_at timestamptz not null default now()
);
create index if not exists sales_register_user_id_idx on public.sales_register (user_id);
create index if not exists sales_register_month_idx on public.sales_register (user_id, month);

create table if not exists public.purchase_register (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date,
  invoice_no text,
  vendor text,
  gstin text,
  taxable numeric,
  tax numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  itc_eligible boolean not null default true,
  month text,
  created_at timestamptz not null default now()
);
create index if not exists purchase_register_user_id_idx on public.purchase_register (user_id);
create index if not exists purchase_register_month_idx on public.purchase_register (user_id, month);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date,
  vendor text,
  category text,
  amount numeric,
  gst numeric,
  description text,
  month text,
  review_status text not null default 'unreviewed',
  created_at timestamptz not null default now()
);
create index if not exists expenses_user_id_idx on public.expenses (user_id);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date,
  description text,
  amount numeric,
  direction text,
  category text,
  source text,
  created_at timestamptz not null default now()
);
create index if not exists transactions_user_id_idx on public.transactions (user_id);

create table if not exists public.reconciliations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month text,
  summary jsonb,
  created_at timestamptz not null default now()
);
create index if not exists reconciliations_user_id_idx on public.reconciliations (user_id);

create table if not exists public.compliance_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_key text,
  title text,
  due date,
  category text,
  status text not null default 'pending',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, task_key)
);
create index if not exists compliance_tasks_user_id_idx on public.compliance_tasks (user_id);

drop trigger if exists set_updated_at on public.invoices;
create trigger set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.compliance_tasks;
create trigger set_updated_at before update on public.compliance_tasks
  for each row execute function public.set_updated_at();
