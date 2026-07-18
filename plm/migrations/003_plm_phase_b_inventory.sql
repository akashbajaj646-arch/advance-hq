-- ============================================================
-- PLM 003 — Phase B: Raw materials inventory
-- Requires: 001_plm_foundation.sql
--
-- Two tables: a per-factory running balance (raw_material_stock)
-- and an append-only ledger (stock_movements). The ledger is the
-- audit trail; the balance is what "available to cut" reads from.
--
-- Balance maintenance: kept in APP LOGIC to match the explicit-
-- route pattern used elsewhere in HQ (reserve/consume fire from
-- the manufacturing-PO handlers in Phase C). See PLM.md ->
-- "Stock ledger vs balance" for the optional trigger alternative.
-- ============================================================

-- ------------------------------------------------------------
-- raw_material_stock — running balance per material per factory
-- qty_available is generated: on_hand - reserved. This is the
-- "available to cut" number.
-- ------------------------------------------------------------
create table if not exists raw_material_stock (
  id            uuid primary key default gen_random_uuid(),
  material_id   uuid not null references raw_materials(id) on delete cascade,
  factory_id    uuid not null references partners(id),
  qty_on_hand   numeric not null default 0,
  qty_reserved  numeric not null default 0,
  qty_available numeric generated always as (qty_on_hand - qty_reserved) stored,
  updated_at    timestamptz not null default now(),
  unique (material_id, factory_id)
);

create index if not exists idx_stock_material on raw_material_stock(material_id);

drop trigger if exists trg_stock_updated on raw_material_stock;
create trigger trg_stock_updated before update on raw_material_stock
  for each row execute function set_updated_at();

alter table raw_material_stock enable row level security;

-- ------------------------------------------------------------
-- stock_movements — append-only ledger + audit trail
-- movement_type:
--   adjustment  manual set/correct meters on hand (until real receiving)
--   reserve     PO issued -> reduces available (qty_reserved up)
--   release     PO cancelled -> frees the reservation
--   consume     cutting done -> reduces on_hand (and the reservation)
-- qty is signed by convention; ref_type/ref_id link to the driver
-- (e.g. 'manufacturing_po' + po id, or 'manual').
-- ------------------------------------------------------------
create table if not exists stock_movements (
  id            uuid primary key default gen_random_uuid(),
  material_id   uuid not null references raw_materials(id),
  factory_id    uuid references partners(id),
  movement_type text not null check (movement_type in ('adjustment','reserve','release','consume')),
  qty           numeric not null,
  ref_type      text,                              -- 'manufacturing_po' | 'manual' | ...
  ref_id        uuid,
  created_by    text,
  note          text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_movements_material on stock_movements(material_id, created_at desc);
create index if not exists idx_movements_ref on stock_movements(ref_type, ref_id);

alter table stock_movements enable row level security;

-- ------------------------------------------------------------
-- v_available_to_cut — convenience view for the UI
-- ------------------------------------------------------------
create or replace view v_available_to_cut as
select
  s.material_id,
  m.name        as material_name,
  m.material_type,
  m.unit,
  s.factory_id,
  p.name        as factory_name,
  s.qty_on_hand,
  s.qty_reserved,
  s.qty_available
from raw_material_stock s
join raw_materials m on m.id = s.material_id
left join partners p on p.id = s.factory_id;
