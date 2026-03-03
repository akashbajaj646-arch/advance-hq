import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const AM_URL = process.env.NEXT_PUBLIC_APPARELMAGIC_URL || '';
const AM_TOKEN = process.env.APPARELMAGIC_TOKEN || '';

async function fetchSkuWarehousePage(lastId?: string): Promise<{ records: any[]; nextLastId: string | null }> {
  const time = Math.floor(Date.now() / 1000).toString();
  let url = `${AM_URL}/sku_warehouse?time=${time}&token=${AM_TOKEN}&pagination[page_size]=500`;
  if (lastId) {
    url += `&pagination[last_id]=${lastId}`;
  }

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': 'AdvanceHQ/1.0' },
  });

  if (!res.ok) {
    throw new Error(`ApparelMagic API error: ${res.status}`);
  }

  const data = await res.json();
  const records = data.response || [];
  const nextLastId = data.meta?.pagination?.last_id || null;

  return { records, nextLastId };
}

export async function POST() {
  try {
    let totalFetched = 0;
    let totalUpdated = 0;
    let totalWithLocation = 0;
    let lastId: string | undefined = undefined;
    let pageNum = 0;

    // Collect all sku_warehouse records with a location
    const locationMap: Record<string, string> = {}; // sku_id -> location

    while (true) {
      pageNum++;
      const { records, nextLastId } = await fetchSkuWarehousePage(lastId);

      if (records.length === 0) break;

      totalFetched += records.length;

      for (const rec of records) {
        if (rec.location && rec.location.trim() !== '') {
          totalWithLocation++;
          // If a SKU appears in multiple warehouses, keep both (comma-separated) or take the first
          // For now, prefer warehouse_id=1 (primary warehouse), otherwise take whatever has a location
          if (!locationMap[rec.sku_id]) {
            locationMap[rec.sku_id] = rec.location.trim();
          }
        }
      }

      console.log(`Page ${pageNum}: fetched ${records.length}, running total: ${totalFetched}, with location: ${totalWithLocation}`);

      if (!nextLastId || records.length < 500) break;
      lastId = nextLastId;
    }

    // Batch update product_skus with bin_location
    const skuIds = Object.keys(locationMap);
    const BATCH_SIZE = 100;

    for (let i = 0; i < skuIds.length; i += BATCH_SIZE) {
      const batch = skuIds.slice(i, i + BATCH_SIZE);
      const updates = batch.map(skuId => ({
        sku_id: skuId,
        bin_location: locationMap[skuId],
      }));

      // Update each SKU individually since Supabase upsert needs the primary key
      for (const update of updates) {
        const { error } = await supabase
          .from('product_skus')
          .update({ bin_location: update.bin_location })
          .eq('sku_id', update.sku_id);

        if (!error) totalUpdated++;
      }
    }

    // Also update inventory table
    let inventoryUpdated = 0;
    for (let i = 0; i < skuIds.length; i += BATCH_SIZE) {
      const batch = skuIds.slice(i, i + BATCH_SIZE);
      for (const skuId of batch) {
        const { error } = await supabase
          .from('inventory')
          .update({ bin_location: locationMap[skuId] })
          .eq('sku_id', skuId);
        if (!error) inventoryUpdated++;
      }
    }

    return NextResponse.json({
      success: true,
      total_sku_warehouse_records: totalFetched,
      total_with_location: totalWithLocation,
      unique_skus_with_location: skuIds.length,
      product_skus_updated: totalUpdated,
      inventory_updated: inventoryUpdated,
    });
  } catch (error: any) {
    console.error('Sync bin locations error:', error);

    return NextResponse.json({ error: error.message || 'Sync failed' }, { status: 500 });
  }
}
