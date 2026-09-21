import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Syncs colorway-attributed images into product_colorway_images so the
// warehouse view can show images per variant (the existing product sync
// flattens colorway images into product_images with no color attribution).
//
// Cursor-based: each run processes as many products as fit in the time
// budget, stores progress in hq_kv, and the next run (cron or manual)
// continues where it left off. Wraps to the start when the catalog is done.
//
// POST ?product_id=XXX  -> sync a single product (round-trip probe)
// POST                  -> continue from stored cursor
// GET                   -> read-only probe (cursor position + row counts)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const AM_URL = process.env.NEXT_PUBLIC_APPARELMAGIC_URL || '';
const AM_TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const CURSOR_KEY = 'colorway_images_cursor';
const TIME_BUDGET_MS = 240_000; // leave headroom under maxDuration

function authParams() {
  return { time: Math.floor(Date.now() / 1000).toString(), token: AM_TOKEN };
}

async function fetchColorways(productId: string): Promise<any[]> {
  const auth = authParams();
  const url = `${AM_URL}/product_attributes?product_id=${productId}&time=${auth.time}&token=${auth.token}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    return data.response || [];
  } catch {
    return [];
  }
}

async function syncOneProduct(productId: string): Promise<{ images: number }> {
  const colorways = await fetchColorways(productId);

  const rows: any[] = [];
  const seen = new Set<string>();

  for (const cw of colorways) {
    // AM colorway records: be defensive about which field carries the color name
    const attr2 = cw.attr_2 || cw.color || cw.name || null;
    const paId = cw.product_attribute_id ? String(cw.product_attribute_id) : (cw.id ? String(cw.id) : null);

    if (cw.images && Array.isArray(cw.images)) {
      let sort = 0;
      for (const img of cw.images) {
        if (img.img && !seen.has(img.img)) {
          seen.add(img.img);
          rows.push({
            product_id: String(productId),
            attr_2: attr2,
            product_attribute_id: paId,
            image_url: img.img,
            sort_order: sort++,
            last_synced_at: new Date().toISOString(),
          });
        }
      }
    }
  }

  // Replace-per-product (same pattern as product_images in sync-products)
  await supabase.from('product_colorway_images').delete().eq('product_id', String(productId));
  if (rows.length > 0) {
    const { error } = await supabase.from('product_colorway_images').insert(rows);
    if (error) throw new Error(`Insert failed for product ${productId}: ${error.message}`);
  }
  return { images: rows.length };
}

async function getCursor(): Promise<number> {
  const { data } = await supabase.from('hq_kv').select('value').eq('key', CURSOR_KEY).maybeSingle();
  const n = parseInt(data?.value || '0', 10);
  return isNaN(n) ? 0 : n;
}

async function setCursor(n: number) {
  await supabase.from('hq_kv').upsert({ key: CURSOR_KEY, value: String(n), updated_at: new Date().toISOString() });
}

export async function GET() {
  try {
    const cursor = await getCursor();
    const { count: productCount } = await supabase
      .from('products').select('*', { count: 'exact', head: true });
    const { count: imageCount } = await supabase
      .from('product_colorway_images').select('*', { count: 'exact', head: true });

    return NextResponse.json({
      probe: true,
      cursor_position: cursor,
      total_products: productCount ?? 0,
      colorway_image_rows: imageCount ?? 0,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Probe failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const singleProductId = searchParams.get('product_id');

  // Single-product round-trip probe
  if (singleProductId) {
    try {
      const result = await syncOneProduct(singleProductId);
      const { data: rows } = await supabase
        .from('product_colorway_images')
        .select('attr_2, image_url, sort_order')
        .eq('product_id', singleProductId)
        .order('attr_2').order('sort_order');
      return NextResponse.json({ success: true, product_id: singleProductId, ...result, rows });
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { data: syncLog } = await supabase
    .from('sync_log')
    .insert({ sync_type: 'colorway_images', source: 'apparel_magic', status: 'started' })
    .select().single();

  try {
    const cursor = await getCursor();

    // Stable ordering so the cursor walks the whole catalog deterministically
    const BATCH = 1000;
    const { data: products, count } = await supabase
      .from('products')
      .select('product_id', { count: 'exact' })
      .order('product_id', { ascending: true })
      .range(cursor, cursor + BATCH - 1);

    const total = count ?? 0;
    let processed = 0;
    let imagesWritten = 0;
    let errors = 0;
    let firstError: string | null = null;
    let newCursor = cursor;

    for (const p of products || []) {
      // Mid-loop time budget check (established sync pattern)
      if (Date.now() - startTime > TIME_BUDGET_MS) break;
      try {
        const r = await syncOneProduct(p.product_id);
        imagesWritten += r.images;
      } catch (e: any) {
        errors++;
        if (!firstError) firstError = e.message;
      }
      processed++;
      newCursor = cursor + processed;
    }

    // Wrap when we've walked the whole catalog
    const done = newCursor >= total;
    await setCursor(done ? 0 : newCursor);

    const duration = Math.round((Date.now() - startTime) / 1000);

    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'completed',
        records_processed: processed,
        records_updated: imagesWritten,
        errors,
        error_details: firstError ? { first_error: firstError } : null,
        completed_at: new Date().toISOString(),
        duration_seconds: duration,
      }).eq('id', syncLog.id);
    }

    return NextResponse.json({
      success: true,
      products_processed: processed,
      images_written: imagesWritten,
      errors,
      first_error: firstError,
      cursor_before: cursor,
      cursor_after: done ? 0 : newCursor,
      catalog_complete_this_run: done,
      total_products: total,
      duration: `${duration}s`,
    });
  } catch (error: any) {
    console.error('Colorway image sync error:', error);
    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'failed',
        error_details: { message: error.message || 'Unknown error' },
        completed_at: new Date().toISOString(),
      }).eq('id', syncLog.id);
    }
    return NextResponse.json({ error: error.message || 'Sync failed' }, { status: 500 });
  }
}
