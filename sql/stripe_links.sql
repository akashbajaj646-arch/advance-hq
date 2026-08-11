-- Maps an Advance HQ / ApparelMagic customer to a Stripe customer.
-- Email is only ever a hint; this table is the source of truth once written.
-- Run in the Supabase SQL editor. Safe to re-run.

create table if not exists stripe_links (
  hq_customer_id text primary key,
  stripe_customer_id text not null,
  matched_email text,
  match_method text,                       -- 'email' | 'manual'
  shopify_customer_gid text,               -- filled in later by the account extension
  linked_at timestamptz not null default now()
);

create index if not exists stripe_links_stripe_idx on stripe_links (stripe_customer_id);
create index if not exists stripe_links_gid_idx on stripe_links (shopify_customer_gid);

alter table stripe_links enable row level security;
