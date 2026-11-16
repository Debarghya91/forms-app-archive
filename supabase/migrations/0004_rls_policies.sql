-- 0004: row level security. Owner-only policies on every user table.
-- The service role key bypasses RLS, so the server enforces ownership
-- in its data layer as well; these policies protect direct client
-- access through the anon key. Idempotent: policies are dropped
-- before they are created.

-- Owner tables with a user_id column: one policy per table.
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'profiles', 'businesses', 'cases', 'case_events', 'documents',
    'conversations', 'messages', 'invoices', 'credit_debit_notes',
    'sales_register', 'purchase_register', 'expenses', 'transactions',
    'reconciliations', 'compliance_tasks', 'subscriptions',
    'entitlements', 'credit_ledger', 'payments', 'referrals',
    'analytics_events', 'ca_profiles'
  ]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format(
      'create policy owner_all on public.%I for all to authenticated ' ||
      'using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t
    );
  end loop;
end;
$$;

-- audit_log: owners may read their own rows; writes are server-only
-- (service role), so no insert/update/delete policy for clients.
alter table public.audit_log enable row level security;
drop policy if exists owner_read on public.audit_log;
create policy owner_read on public.audit_log for select to authenticated
  using (auth.uid() = user_id);

-- invoice_items: ownership flows through the parent invoice.
alter table public.invoice_items enable row level security;
drop policy if exists owner_via_invoice on public.invoice_items;
create policy owner_via_invoice on public.invoice_items for all to authenticated
  using (exists (
    select 1 from public.invoices
    where invoices.id = invoice_items.invoice_id
      and invoices.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.invoices
    where invoices.id = invoice_items.invoice_id
      and invoices.user_id = auth.uid()
  ));

-- business_members: a member sees their own membership; the business
-- owner manages memberships for their business.
alter table public.business_members enable row level security;
drop policy if exists member_or_owner on public.business_members;
create policy member_or_owner on public.business_members for all to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.businesses
      where businesses.id = business_members.business_id
        and businesses.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.businesses
      where businesses.id = business_members.business_id
        and businesses.user_id = auth.uid()
    )
  );

-- referral_uses: visible to the referrer and to the redeemer.
alter table public.referral_uses enable row level security;
drop policy if exists referrer_or_redeemer on public.referral_uses;
create policy referrer_or_redeemer on public.referral_uses for all to authenticated
  using (auth.uid() = user_id or auth.uid() = referrer_id)
  with check (auth.uid() = user_id or auth.uid() = referrer_id);

-- ca_clients: visible to the CA and to the client.
alter table public.ca_clients enable row level security;
drop policy if exists ca_or_client on public.ca_clients;
create policy ca_or_client on public.ca_clients for all to authenticated
  using (auth.uid() = ca_user_id or auth.uid() = client_user_id)
  with check (auth.uid() = ca_user_id or auth.uid() = client_user_id);

-- Reference tables: readable by signed-in users, writable only by
-- the service role (no write policies for clients).
alter table public.plans enable row level security;
drop policy if exists read_all on public.plans;
create policy read_all on public.plans for select to authenticated using (true);

alter table public.tax_rule_packs enable row level security;
drop policy if exists read_all on public.tax_rule_packs;
create policy read_all on public.tax_rule_packs for select to authenticated using (true);

alter table public.rag_sources enable row level security;
drop policy if exists read_all on public.rag_sources;
create policy read_all on public.rag_sources for select to authenticated using (true);
