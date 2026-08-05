-- ============================================================
-- Warehouse Pick/Pack Module — workflow tables
-- Synced AM tables (pick_tickets, pick_ticket_items, products,
-- product_skus, product_images) stay read-only mirrors.
-- All warehouse state lives in these tables. Idempotent.
-- ============================================================

create extension if not exists pgcrypto;

-- One job per pick ticket run through the warehouse flow
create table if not exists warehouse_jobs (
  id uuid primary key default gen_random_uuid(),
  pick_ticket_id text not null,
  apparel_magic_order_id text,
  customer_name text,
  customer_po text,
  status text not null default 'picking',
  -- picking | checking | packing | complete | cancelled
  picking_started_at timestamptz default now(),
  picking_completed_at timestamptz,
  checking_started_at timestamptz,
  checking_completed_at timestamptz,
  packing_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Only one active job per pick ticket
create unique index if not exists warehouse_jobs_active_pt_idx
  on warehouse_jobs (pick_ticket_id)
  where status not in ('complete', 'cancelled');

create index if not exists warehouse_jobs_status_idx on warehouse_jobs (status);

-- Snapshot of pick ticket lines at job creation.
-- Snapshotting (rather than FK to pick_ticket_items) makes the job
-- immune to mid-pick AM edits and re-syncs.
create table if not exists warehouse_pick_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references warehouse_jobs(id) on delete cascade,
  product_id text,
  style_number text,
  description text,
  attr_2 text,          -- color code (e.g. C1)
  attr_3 text,
  size text,
  qty_ordered numeric not null default 0,
  location text,        -- e.g. A3D
  notes text,
  upc text,
  qty_picked numeric,
  is_picked boolean not null default false,
  problem text,         -- null | short | damaged | not_found | other
  problem_note text,
  picked_at timestamptz
);

create index if not exists warehouse_pick_items_job_idx on warehouse_pick_items (job_id);

-- Checker blind counts (what the checker actually found in the cart)
create table if not exists warehouse_check_counts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references warehouse_jobs(id) on delete cascade,
  product_id text,
  style_number text not null,
  attr_2 text,
  size text,
  qty_counted numeric not null default 0,
  is_unexpected boolean not null default false,  -- style not on the pick ticket
  counted_at timestamptz default now()
);

create unique index if not exists warehouse_check_counts_key_idx
  on warehouse_check_counts (job_id, style_number, coalesce(attr_2, ''), coalesce(size, ''));

-- Verification results where expected != found
create table if not exists warehouse_discrepancies (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references warehouse_jobs(id) on delete cascade,
  style_number text not null,
  attr_2 text,
  size text,
  qty_expected numeric not null default 0,
  qty_found numeric not null default 0,
  kind text not null,     -- short | over | wrong_item
  resolution text,        -- null | corrected (cart fixed to match order) | accepted (ship as counted)
  note text,
  resolved_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists warehouse_discrepancies_job_idx on warehouse_discrepancies (job_id);

-- Boxes and contents
create table if not exists warehouse_boxes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references warehouse_jobs(id) on delete cascade,
  box_number int not null,
  length_in numeric,
  width_in numeric,
  height_in numeric,
  weight_lb numeric,
  created_at timestamptz default now()
);

create index if not exists warehouse_boxes_job_idx on warehouse_boxes (job_id);

create table if not exists warehouse_box_items (
  id uuid primary key default gen_random_uuid(),
  box_id uuid not null references warehouse_boxes(id) on delete cascade,
  job_id uuid not null references warehouse_jobs(id) on delete cascade,
  style_number text not null,
  attr_2 text,
  size text,
  qty numeric not null default 0
);

create unique index if not exists warehouse_box_items_key_idx
  on warehouse_box_items (box_id, style_number, coalesce(attr_2, ''), coalesce(size, ''));

create index if not exists warehouse_box_items_job_idx on warehouse_box_items (job_id);
