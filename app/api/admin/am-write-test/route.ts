import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

// ─────────────────────────────────────────────────────────────────────────────
// ApparelMagic WRITE TEST harness (temporary diagnostics — remove after Approve→AM ships)
//
// Drive it entirely from the browser while logged in as an Advance HQ admin:
//
//   READ ONLY (safe, no changes):
//     /api/admin/am-write-test?product_id=2213
//
//   PERFORM THE WRITE TEST (PUTs a description, then re-reads to verify):
//     /api/admin/am-write-test?product_id=2213&write=API write test via Advance HQ
//
// It tries a JSON-body PUT first; if AM rejects that, it retries form-encoded.
// Every attempt's status + raw response is returned so we learn the exact
// payload shape AM expects. Only the `description` field is ever written.
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const BASE_URL = process.env.NEXT_PUBLIC_APPARELMAGIC_URL || 'https://advanceapparels.app.apparelmagic.com/api/json';

function authQS(extra: Record<string, string> = {}) {
  return new URLSearchParams({
    time: Math.floor(Date.now() / 1000).toString(),
    token: TOKEN,
    ...extra,
  }).toString();
}

async function parseBody(res: Response): Promise<any> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw_text: text.slice(0, 2000) }; }
}

function extractProduct(body: any, productId: string): any | null {
  // AM usually wraps results as { response: [...] }
  const list = Array.isArray(body?.response) ? body.response
    : Array.isArray(body) ? body
    : body?.response ? [body.response]
    : body?.product_id ? [body]
    : [];
  if (list.length === 0) return null;
  return list.find((p: any) => String(p.product_id) === String(productId)) ?? list[0];
}

async function getProduct(productId: string): Promise<{ status: number; url: string; product: any | null; raw: any }> {
  // Try REST-style single fetch first
  let url = `${BASE_URL}/products/${encodeURIComponent(productId)}?${authQS()}`;
  let res = await fetch(url, { headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
  let body = await parseBody(res);
  let product = res.ok ? extractProduct(body, productId) : null;

  // Fallback: filtered list fetch
  if (!product) {
    url = `${BASE_URL}/products?${authQS({ product_id: String(productId), 'pagination[page_size]': '5' })}`;
    res = await fetch(url, { headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
    body = await parseBody(res);
    product = res.ok ? extractProduct(body, productId) : null;
  }

  return { status: res.status, url: url.replace(TOKEN, 'TOKEN_REDACTED'), product, raw: product ? undefined : body };
}

type Attempt = {
  label: string;
  method: string;
  url: string;
  request_body: string;
  status: number;
  ok: boolean;
  response: any;
};

async function attemptPut(productId: string, description: string): Promise<Attempt[]> {
  const attempts: Attempt[] = [];

  // Attempt 1: PUT with JSON body
  {
    const url = `${BASE_URL}/products/${encodeURIComponent(productId)}?${authQS()}`;
    const reqBody = JSON.stringify({ description });
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'User-Agent': 'AdvanceHQ/1.0', 'Content-Type': 'application/json' },
      body: reqBody,
    });
    const body = await parseBody(res);
    attempts.push({
      label: 'PUT json body',
      method: 'PUT',
      url: url.replace(TOKEN, 'TOKEN_REDACTED'),
      request_body: reqBody,
      status: res.status,
      ok: res.ok && !body?.error,
      response: body,
    });
    if (attempts[0].ok) return attempts;
  }

  // Attempt 2: PUT with form-encoded body
  {
    const url = `${BASE_URL}/products/${encodeURIComponent(productId)}?${authQS()}`;
    const form = new URLSearchParams({ description });
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'User-Agent': 'AdvanceHQ/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const body = await parseBody(res);
    attempts.push({
      label: 'PUT form-encoded body',
      method: 'PUT',
      url: url.replace(TOKEN, 'TOKEN_REDACTED'),
      request_body: form.toString(),
      status: res.status,
      ok: res.ok && !body?.error,
      response: body,
    });
  }

  return attempts;
}

export async function GET(request: Request) {
  try {
    // Admin session required — this route can WRITE to ApparelMagic.
    const session = await getSession();
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required. Log in to Advance HQ first, then open this URL in the same browser.' }, { status: 403 });
    }

    if (!TOKEN) {
      return NextResponse.json({ error: 'APPARELMAGIC_TOKEN env var is not set' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('product_id') || '2213';
    const write = searchParams.get('write');

    // ── BEFORE ──
    const before = await getProduct(productId);
    if (!before.product) {
      return NextResponse.json({
        mode: 'read-only',
        error: `Could not fetch product ${productId} from ApparelMagic`,
        fetch_status: before.status,
        fetch_url: before.url,
        raw: before.raw,
      }, { status: 502 });
    }

    const summary = {
      product_id: before.product.product_id,
      style_number: before.product.style_number,
      description: before.product.description ?? null,
      category: before.product.category ?? null,
      price: before.product.price ?? null,
    };

    if (!write) {
      return NextResponse.json({
        mode: 'read-only',
        note: `No changes made. To run the write test, append &write=YOUR TEST DESCRIPTION to this URL.`,
        summary,
        full_product_record: before.product,
      });
    }

    // ── WRITE ──
    const attempts = await attemptPut(productId, write);

    // ── AFTER (verify) ──
    const after = await getProduct(productId);
    const afterDescription = after.product?.description ?? null;
    const verified = afterDescription === write;

    return NextResponse.json({
      mode: 'write-test',
      product_id: productId,
      description_before: summary.description,
      description_written: write,
      description_after: afterDescription,
      WRITE_VERIFIED: verified,
      conclusion: verified
        ? '✅ ApparelMagic REST API accepts product writes with this token. The Approve → AM push can be built on this.'
        : '❌ The write did not stick. Check the attempts below for the status/error AM returned.',
      attempts,
      full_product_record_after: after.product ?? after.raw,
    });
  } catch (error: any) {
    console.error('AM write test error:', error);
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
