-- Active-product flag on the copy queue (derived from AM skus_active > 0)

alter table product_copy add column if not exists am_active boolean;
create index if not exists idx_product_copy_am_active on product_copy(am_active);
