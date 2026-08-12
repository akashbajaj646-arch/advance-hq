import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';
import { amGet } from '@/lib/apparelmagic';

// POST /api/descriptions/refresh?last_id=X
// Walks one page of AM products and upserts copy-status rows.
// AM pagination is CURSOR-based: pass pagination[last_id], read the next cursor
// from meta.pagination.last_id (page numbers are silently ignored by AM).
// The UI loops until next_last_id is null. Only is_product=1 items are queued.

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 500;

function decodeEntities(s: string): string {
  return (s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

function extractImageUrls(images: any, limit?: number): string[] {
  const urls = new Set<string>();
  const list: any[] = Array.isArray(images) ? images : [];
  for (const img of list) {
    const u = img?.img;
    if (typeof u === 'string' && u.startsWith('http')) urls.add(u);
  }
  const arr = Array.from(urls);
  return limit ? arr.slice(0, limit) : arr;
}

function isAllCaps(text: string): boolean {
  const letters = (text || '').replace(/[^a-zA-Z]/g, '');
  if (letters.length < 15) return false;
  const upper = letters.replace(/[^A-Z]/g, '');
  return upper.length / letters.length >= 0.9;
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const lastId = searchParams.get('last_id');

    const params: Record<string, string> = { 'pagination[page_size]': String(PAGE_SIZE) };
    if (lastId) params['pagination[last_id]'] = lastId;
    const result = await amGet('products', params);

    if (!result.ok && result.records.length === 0) {
      return NextResponse.json({ error: 'ApparelMagic fetch failed', status: result.status, detail: result.errors }, { status: 502 });
    }

    const products = result.records.filter((p: any) => String(p.is_product) === '1' && p.product_id);
    const ids = products.map((p: any) => String(p.product_id));

    // Existing rows so we don't clobber workflow statuses (drafted/pushed/skipped)
    const { data: existingRows } = ids.length
      ? await supabaseAdmin.from('product_copy').select('product_id,status').in('product_id', ids)
      : { data: [] as any[] };
    const existingStatus: Record<string, string> = Object.fromEntries((existingRows || []).map(r => [r.product_id, r.status]));

    // Aggregate inventory per product from the nightly-synced inventory table.
    // Chunk the id list and page each query (Supabase caps ~1000 rows per select).
    const invSums: Record<string, { qty_inventory: number; qty_avail_sell: number }> = {};
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data: invRows, error: invErr } = await supabaseAdmin
          .from('inventory')
          .select('product_id,qty_inventory,qty_avail_sell')
          .in('product_id', chunk)
          .range(from, from + 999);
        if (invErr || !invRows || invRows.length === 0) break;
        for (const r of invRows) {
          const pid = String(r.product_id);
          if (!invSums[pid]) invSums[pid] = { qty_inventory: 0, qty_avail_sell: 0 };
          invSums[pid].qty_inventory += Number(r.qty_inventory) || 0;
          invSums[pid].qty_avail_sell += Number(r.qty_avail_sell) || 0;
        }
        if (invRows.length < 1000) break;
        from += 1000;
      }
    }

    const now = new Date().toISOString();
    const rows = products.map((p: any) => {
      const description = decodeEntities(p.description || '').trim();
      const webTitle = decodeEntities(p.web_title || '').trim();
      const webDescription = decodeEntities(p.web_description || '').trim();

      const missingCopy = !webDescription || !description;
      const allCaps = isAllCaps(webDescription) || (!webDescription && isAllCaps(description));
      const needsCopy = missingCopy || allCaps;

      const prior = existingStatus[String(p.product_id)];
      const keepStatus = prior && ['drafted', 'pushed', 'skipped'].includes(prior);
      const status = keepStatus ? prior : (needsCopy ? 'pending' : 'ok');

      const imageUrls: string[] = extractImageUrls(p.images);

      return {
        product_id: String(p.product_id),
        style_number: p.style_number ?? null,
        category: p.category ?? null,
        image_url: imageUrls[0] ?? null,
        images: imageUrls,
        current_description: description || null,
        current_web_title: webTitle || null,
        current_web_description: webDescription || null,
        am_active: parseInt(String(p.skus_active ?? '0'), 10) > 0,
        qty_inventory: invSums[String(p.product_id)]?.qty_inventory ?? 0,
        qty_avail_sell: invSums[String(p.product_id)]?.qty_avail_sell ?? 0,
        missing_copy: missingCopy,
        all_caps: allCaps,
        status,
        updated_at: now,
      };
    });

    let upserted = 0;
    if (rows.length) {
      const { error } = await supabaseAdmin.from('product_copy').upsert(rows, { onConflict: 'product_id' });
      if (error) {
        console.error('product_copy upsert error:', error);
        return NextResponse.json({ error: 'Database upsert failed', detail: error.message }, { status: 500 });
      }
      upserted = rows.length;
    }

    const nextLastId = result.raw?.meta?.pagination?.last_id
      ? String(result.raw.meta.pagination.last_id)
      : null;

    return NextResponse.json({
      fetched: result.records.length,
      products_upserted: upserted,
      next_last_id: nextLastId, // null = done
    });
  } catch (error: any) {
    console.error('Descriptions refresh error:', error);
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
