-- Adds invoice snapshot support to payment links.
-- Run in the Supabase SQL editor. Safe to re-run.

alter table payment_link_audit add column if not exists amount_cents integer;
alter table payment_link_audit add column if not exists reference text;
alter table payment_link_audit add column if not exists invoice_number text;

-- Line items are snapshotted at link creation so the customer always sees
-- exactly what they were asked to pay for, even if the invoice changes later.
alter table payment_link_audit add column if not exists items jsonb;

create index if not exists payment_link_audit_created_idx
  on payment_link_audit (created_at desc);
