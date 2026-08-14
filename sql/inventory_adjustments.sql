-- Inventory Adjustments audit log
-- Every adjustment attempted from the /adjustments screen lands here,
-- success or failure, with the raw ApparelMagic response for debugging.

create table if not exists inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  sku_id text not null,
  style_number text,
  sku_concat text,
  warehouse_id text,
  qty_before numeric,
  qty_target numeric,
  qty_delta numeric,
  source text,                 -- 'live' (AM read succeeded) or 'snapshot' (fell back to Supabase copy)
  status text not null,        -- 'success' | 'error' | 'noop'
  error text,
  notes text,
  am_adjustment_id text,
  am_endpoint text,
  am_response jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_adjustments_sku on inventory_adjustments (sku_id);
create index if not exists idx_inventory_adjustments_created on inventory_adjustments (created_at desc);
