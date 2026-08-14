-- Backorder verification view
-- One row per SKU with open (unshipped) order quantity, current inventory,
-- and warehouse + bin location for efficient floor walks.

create or replace view backorder_items as
with safe_orders as (
  select
    o.id,
    o.order_status,
    coalesce(
      case when o.order_date ~ '^\d{4}-\d{2}-\d{2}' then substring(o.order_date, 1, 10)::date end,
      case when o.order_date ~ '^\d{1,2}/\d{1,2}/\d{4}$' then to_date(o.order_date, 'FMMM/FMDD/YYYY') end
    ) as ord_date
  from orders o
  where coalesce(o.order_status, '') not ilike '%cancel%'
)
select
  oi.sku_id,
  min(inv.style_number)                             as style_number,
  min(inv.sku_concat)                               as sku_concat,
  min(coalesce(inv.description, oi.description))    as description,
  min(coalesce(inv.attr_2, oi.attr_2))              as attr_2,
  min(coalesce(inv.size, oi.size))                  as size,
  min(p.category)                                   as category,
  sum(coalesce(oi.qty_open, 0))::numeric            as qty_backordered,
  count(distinct oi.order_id)                       as order_count,
  min(so.ord_date)                                  as oldest_order_date,
  max(so.ord_date)                                  as newest_order_date,
  min(inv.qty_inventory)                            as qty_inventory,
  min(inv.qty_avail_sell)                           as qty_avail_sell,
  bool_or(coalesce(inv.active, true))               as active,
  min(nullif(inv.location, ''))                     as warehouse,
  min(coalesce(nullif(inv.bin_location, ''), nullif(ps.bin_location, ''))) as bin_location
from order_items oi
join safe_orders so on so.id = oi.order_id
left join inventory inv on inv.sku_id = oi.sku_id
left join product_skus ps on ps.sku_id = oi.sku_id
left join products p on p.product_id = inv.product_id
where coalesce(oi.qty_open, 0) > 0
  and oi.sku_id is not null
group by oi.sku_id;
