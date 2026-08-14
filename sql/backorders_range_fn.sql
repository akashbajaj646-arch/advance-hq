-- Backorder items with an order-date window pushed into the aggregation,
-- so quantities reflect only orders inside the selected range.
-- Call with nulls for all-time. Replaces the need for the backorder_items view.

create or replace function backorder_items_range(p_start date default null, p_end date default null)
returns table (
  sku_id text,
  style_number text,
  sku_concat text,
  description text,
  attr_2 text,
  size text,
  category text,
  qty_backordered numeric,
  order_count bigint,
  oldest_order_date date,
  newest_order_date date,
  qty_inventory numeric,
  qty_avail_sell numeric,
  active boolean,
  warehouse text,
  bin_location text
)
language sql
stable
as $$
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
    min(o.order_date)                                 as oldest_order_date,
    max(o.order_date)                                 as newest_order_date,
    min(inv.qty_inventory)                            as qty_inventory,
    min(inv.qty_avail_sell)                           as qty_avail_sell,
    bool_or(coalesce(inv.active, true))               as active,
    min(nullif(inv.location, ''))                     as warehouse,
    min(coalesce(nullif(inv.bin_location, ''), nullif(ps.bin_location, ''))) as bin_location
  from order_items oi
  join orders o on o.id = oi.order_id
  left join inventory inv on inv.sku_id = oi.sku_id
  left join product_skus ps on ps.sku_id = oi.sku_id
  left join products p on p.product_id = inv.product_id
  where coalesce(oi.qty_open, 0) > 0
    and oi.sku_id is not null
    and coalesce(o.order_status, '') not ilike '%cancel%'
    and (p_start is null or o.order_date >= p_start)
    and (p_end is null or o.order_date <= p_end)
  group by oi.sku_id
$$;
