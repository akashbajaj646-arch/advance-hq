-- Shopify inventory-policy automation, Stage 1: detection
-- Snapshot of per-SKU active state (diffed after each nightly inventory sync),
-- event log of transitions, and automation settings (mode: off | dry_run | live).

create table if not exists sku_active_snapshot (
  sku_id text primary key,
  product_id text,
  style_number text,
  attr_2 text,               -- color
  size text,
  sku_concat text,           -- matches the Shopify variant SKU field (AM-synced stores)
  active boolean,
  captured_at timestamptz not null default now()
);

create table if not exists automation_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,          -- 'sku_deactivated' | 'sku_reactivated'
  sku_id text not null,
  product_id text,
  style_number text,
  attr_2 text,
  size text,
  sku_concat text,
  detected_at timestamptz not null default now(),
  status text not null default 'pending',  -- pending | dry_run | completed | failed | dismissed
  b2b_result jsonb,                        -- Stage 2: per-store action results
  dtc_result jsonb,
  error text,
  processed_at timestamptz
);

create index if not exists idx_automation_events_status on automation_events(status);
create index if not exists idx_automation_events_detected on automation_events(detected_at desc);

create table if not exists automation_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into automation_settings (key, value)
values ('shopify_mode', '"off"'::jsonb)     -- off | dry_run | live
on conflict (key) do nothing;
