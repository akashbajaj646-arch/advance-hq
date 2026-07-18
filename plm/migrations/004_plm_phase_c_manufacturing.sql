-- ============================================================
-- PLM 004 — Phase C: Manufacturing PO + WIP + outsourcing
-- Requires: 001, 002, 003
--
-- product_id / style_number are SOFT references to the AM-synced
-- products table (text keys) — no hard FK, same reasoning as
-- samples.promoted_product_id.
--
-- Routing resolution: a PO's operations come from the routing of
-- the sample that produced its product, i.e.
--   product_id -> samples.promoted_product_id -> routing_steps.
-- WIP and dispatches reference those routing_steps directly.
-- ============================================================

-- ------------------------------------------------------------
-- manufacturing_pos — the factory/vendor PO (vendor-customer)
-- fx_rate_locked = issue-date rate, immutable, for costing
-- history. Actual settlement (live USD on pay day) stays
-- off-system for now. packing_template_id is a soft ref into the
-- existing template-config system (select, not free text).
-- ------------------------------------------------------------
create table if not exists manufacturing_pos (
  id                  uuid primary key default gen_random_uuid(),
  po_number           text not null unique,
  product_id          text,                        -- soft ref -> products.product_id
  style_number        text,                        -- denormalized soft ref
  producer_type       text not null check (producer_type in ('internal_factory','external_vendor')),
  producer_id         uuid references partners(id),
  packing_template_id uuid,                         -- soft ref -> template-config
  delivery_date       date,
  final_price         numeric,
  currency            text check (currency in ('INR','USD','THB')),
  fx_rate_locked      numeric,                      -- issue-date rate for costing history
  status              text not null default 'open'
                        check (status in ('open','in_production','completed','cancelled')),
  notes               text,
  created_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_mpo_product on manufacturing_pos(product_id);
create index if not exists idx_mpo_status on manufacturing_pos(status);

drop trigger if exists trg_mpo_updated on manufacturing_pos;
create trigger trg_mpo_updated before update on manufacturing_pos
  for each row execute function set_updated_at();

alter table manufacturing_pos enable row level security;

-- ------------------------------------------------------------
-- manufacturing_po_lines — the size x color matrix
-- ------------------------------------------------------------
create table if not exists manufacturing_po_lines (
  id         uuid primary key default gen_random_uuid(),
  po_id      uuid not null references manufacturing_pos(id) on delete cascade,
  color      text,
  size       text,
  qty        integer not null default 0,
  created_at timestamptz not null default now(),
  unique (po_id, color, size)
);

create index if not exists idx_mpo_lines_po on manufacturing_po_lines(po_id);

alter table manufacturing_po_lines enable row level security;

-- ------------------------------------------------------------
-- wip_status — in-house, manual, PO x style x stage
-- One row per (PO, routing step). Someone updates qty_at_stage
-- by hand. No color/size split in this view, by design.
-- ------------------------------------------------------------
create table if not exists wip_status (
  id              uuid primary key default gen_random_uuid(),
  po_id           uuid not null references manufacturing_pos(id) on delete cascade,
  routing_step_id uuid references routing_steps(id) on delete cascade,
  qty_at_stage    integer not null default 0,
  updated_by      text,
  updated_at      timestamptz not null default now(),
  unique (po_id, routing_step_id)
);

create index if not exists idx_wip_po on wip_status(po_id);

drop trigger if exists trg_wip_updated on wip_status;
create trigger trg_wip_updated before update on wip_status
  for each row execute function set_updated_at();

alter table wip_status enable row level security;

-- ------------------------------------------------------------
-- outsource_dispatches — sent to a stitching unit / dye house
-- ------------------------------------------------------------
create table if not exists outsource_dispatches (
  id              uuid primary key default gen_random_uuid(),
  po_id           uuid not null references manufacturing_pos(id) on delete cascade,
  routing_step_id uuid references routing_steps(id),
  vendor_id       uuid references partners(id),
  qty_sent        integer not null,
  sent_at         date not null default current_date,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_dispatch_po on outsource_dispatches(po_id);
create index if not exists idx_dispatch_vendor on outsource_dispatches(vendor_id);

drop trigger if exists trg_dispatch_updated on outsource_dispatches;
create trigger trg_dispatch_updated before update on outsource_dispatches
  for each row execute function set_updated_at();

alter table outsource_dispatches enable row level security;

-- ------------------------------------------------------------
-- outsource_receipts — partial returns, each its own event
-- Units dribble back; each receipt is a row so open qty and
-- turnaround stay accurate.
-- ------------------------------------------------------------
create table if not exists outsource_receipts (
  id           uuid primary key default gen_random_uuid(),
  dispatch_id  uuid not null references outsource_dispatches(id) on delete cascade,
  qty_received integer not null,
  received_at  date not null default current_date,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_receipt_dispatch on outsource_receipts(dispatch_id);

alter table outsource_receipts enable row level security;

-- ------------------------------------------------------------
-- v_outsource_open — open qty + turnaround per dispatch
-- turnaround_days measured to the LAST receipt (null while open).
-- ------------------------------------------------------------
create or replace view v_outsource_open as
select
  d.id                as dispatch_id,
  d.po_id,
  d.vendor_id,
  d.routing_step_id,
  d.qty_sent,
  coalesce(sum(r.qty_received), 0)          as qty_received,
  d.qty_sent - coalesce(sum(r.qty_received), 0) as qty_open,
  d.sent_at,
  max(r.received_at)                        as last_received_at,
  case when d.qty_sent - coalesce(sum(r.qty_received), 0) <= 0
       then max(r.received_at) - d.sent_at end as turnaround_days
from outsource_dispatches d
left join outsource_receipts r on r.dispatch_id = d.id
group by d.id;

-- ------------------------------------------------------------
-- v_vendor_performance — rollup for the "how fast is this unit"
-- reference. Avg turnaround over closed dispatches + open volume.
-- ------------------------------------------------------------
create or replace view v_vendor_performance as
select
  p.id                                    as vendor_id,
  p.name                                  as vendor_name,
  count(o.dispatch_id)                    as dispatch_count,
  sum(o.qty_sent)                         as total_sent,
  sum(o.qty_received)                     as total_received,
  sum(o.qty_open)                         as total_open,
  round(avg(o.turnaround_days) filter (where o.turnaround_days is not null), 1)
                                          as avg_turnaround_days
from partners p
join v_outsource_open o on o.vendor_id = p.id
where p.partner_type = 'external_vendor'
group by p.id, p.name;
