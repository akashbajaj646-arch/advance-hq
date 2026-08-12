import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';
import { amGet } from '@/lib/apparelmagic';

// POST /api/descriptions/refresh?page=N
// Walks one page of AM products (200/page) and upserts copy-status rows.
// The UI calls this in a loop until has_more=false — keeps each invocation
// well under the Vercel time cap. Only is_product=1 items are queued.

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 200;

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
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));

    const result = await amGet('products', {
      'pagination[page_size]': String(PAGE_SIZE),
      'pagination[page_number]': String(page),
    });

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

    return NextResponse.json({
      page,
      fetched: result.records.length,
      products_upserted: upserted,
      // AM may cap/ignore page_size (observed: returns 100 max). So keep paging while
      // records come back; the client stops when fetched=0 OR first_product_id repeats.
      has_more: result.records.length > 0,
      first_product_id: result.records[0]?.product_id ?? null,
    });
  } catch (error: any) {
    console.error('Descriptions refresh error:', error);
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
