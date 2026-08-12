-- Product-level inventory sums on the copy queue (aggregated from the nightly-synced inventory table)

alter table product_copy add column if not exists qty_inventory numeric;
alter table product_copy add column if not exists qty_avail_sell numeric;
create index if not exists idx_product_copy_qty_inventory on product_copy(qty_inventory);
create index if not exists idx_product_copy_qty_avail_sell on product_copy(qty_avail_sell);
