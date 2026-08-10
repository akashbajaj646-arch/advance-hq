-- Payment link tokens: single-use enforcement + issuance audit trail.
-- Run in Supabase SQL editor.

create table if not exists payment_link_tokens (
  jti uuid primary key,
  email text not null,
  used_at timestamptz not null default now()
);

create table if not exists payment_link_audit (
  jti uuid primary key,
  email text not null,
  expires_at timestamptz not null,
  issued_by text,
  created_at timestamptz not null default now()
);

create index if not exists payment_link_audit_created_idx
  on payment_link_audit (created_at desc);

-- Service role only; these are never touched from the browser.
alter table payment_link_tokens enable row level security;
alter table payment_link_audit enable row level security;
