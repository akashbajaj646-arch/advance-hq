import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

// ─────────────────────────────────────────────────────────────────────────────
// ApparelMagic WRITE TEST harness v2 (temporary diagnostics)
//
// v1 result: GET works; PUT (json + form, auth in query) → 401 Apache HTML page
// served from port 80, i.e. the request likely never reached AM's app auth.
//
// v2 probes a matrix of variants and stops at the first one that works:
//   methods:  PUT, POST, PATCH
//   body:     JSON vs form-encoded
//   auth:     time/token in query string vs inside the body
// All requests use redirect:'manual' so any Location header is captured —
// if a redirect is eating the write, we'll see exactly where it points.
//
// Usage (logged in as Advance HQ admin):
//   Read only:  /api/admin/am-write-test?product_id=2213
//   Write test: /api/admin/am-write-test?product_id=2213&write=SOME TEXT
// Only the `description` field is ever written.
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const BASE_URL = process.env.NEXT_PUBLIC_APPARELMAGIC_URL || 'https://advanceapparels.app.apparelmagic.com/api/json';

function authPair() {
  return { time: Math.floor(Date.now() / 1000).toString(), token: TOKEN };
}

function redact(s: string) {
  return TOKEN ? s.split(TOKEN).join('TOKEN_REDACTED') : s;
}

async function parseBody(res: Response): Promise<any> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw_text: text.slice(0, 600) }; }
}

function extractProduct(body: any, productId: string): any | null {
  const list = Array.isArray(body?.response) ? body.response
    : Array.isArray(body) ? body
    : body?.response ? [body.response]
    : body?.product_id ? [body]
    : [];
  if (list.length === 0) return null;
  return list.find((p: any) => String(p.product_id) === String(productId)) ?? list[0];
}

async function getProduct(productId: string): Promise<{ status: number; product: any | null; raw?: any }> {
  const auth = authPair();
  let qs = new URLSearchParams(auth).toString();
  let res = await fetch(`${BASE_URL}/products/${encodeURIComponent(productId)}?${qs}`, { headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
  let body = await parseBody(res);
  let product = res.ok ? extractProduct(body, productId) : null;

  if (!product) {
    qs = new URLSearchParams({ ...auth, product_id: String(productId), 'pagination[page_size]': '5' }).toString();
    res = await fetch(`${BASE_URL}/products?${qs}`, { headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
    body = await parseBody(res);
    product = res.ok ? extractProduct(body, productId) : null;
  }
  return { status: res.status, product, raw: product ? undefined : body };
}

type Attempt = {
  label: string;
  method: string;
  url: string;
  content_type: string;
  request_body: string;
  status: number;
  location_header: string | null;
  looks_ok: boolean;
  response: any;
};

async function tryVariant(opts: {
  label: string;
  method: 'PUT' | 'POST' | 'PATCH';
  url: string;
  contentType: 'application/json' | 'application/x-www-form-urlencoded';
  bodyObj: Record<string, string>;
}): Promise<Attempt> {
  const bodyStr = opts.contentType === 'application/json'
    ? JSON.stringify(opts.bodyObj)
    : new URLSearchParams(opts.bodyObj).toString();

  const res = await fetch(opts.url, {
    method: opts.method,
    headers: { 'User-Agent': 'AdvanceHQ/1.0', 'Content-Type': opts.contentType, 'Accept': 'application/json' },
    body: bodyStr,
    redirect: 'manual',
  });
  const body = await parseBody(res);

  return {
    label: opts.label,
    method: opts.method,
    url: redact(opts.url),
    content_type: opts.contentType,
    request_body: redact(bodyStr),
    status: res.status,
    location_header: res.headers.get('location'),
    looks_ok: res.ok && !body?.error && !body?._raw_text,
    response: body,
  };
}

export async function GET(request: Request) {
  try {
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

    const before = await getProduct(productId);
    if (!before.product) {
      return NextResponse.json({ mode: 'read-only', error: `Could not fetch product ${productId}`, fetch_status: before.status, raw: before.raw }, { status: 502 });
    }

    if (!write) {
      return NextResponse.json({
        mode: 'read-only',
        note: 'No changes made. Append &write=YOUR TEST DESCRIPTION to run the write probe.',
        summary: {
          product_id: before.product.product_id,
          style_number: before.product.style_number,
          description: before.product.description ?? null,
        },
        full_product_record: before.product,
      });
    }

    const auth = authPair();
    const qsAuth = new URLSearchParams(auth).toString();
    const singleUrl = `${BASE_URL}/products/${encodeURIComponent(productId)}`;
    const collectionUrl = `${BASE_URL}/products`;

    // Probe matrix — ordered by likelihood. Stops at the first variant that looks_ok AND verifies.
    const variants: Parameters<typeof tryVariant>[0][] = [
      { label: 'PUT /products/{id}, json body, auth in query',        method: 'PUT',   url: `${singleUrl}?${qsAuth}`, contentType: 'application/json',                  bodyObj: { description: write } },
      { label: 'POST /products/{id}, json body, auth in query',       method: 'POST',  url: `${singleUrl}?${qsAuth}`, contentType: 'application/json',                  bodyObj: { description: write } },
      { label: 'PUT /products/{id}, form body, auth IN BODY',         method: 'PUT',   url: singleUrl,                contentType: 'application/x-www-form-urlencoded', bodyObj: { ...auth, description: write } },
      { label: 'POST /products/{id}, form body, auth IN BODY',        method: 'POST',  url: singleUrl,                contentType: 'application/x-www-form-urlencoded', bodyObj: { ...auth, description: write } },
      { label: 'POST /products/{id}, json body, auth IN BODY',        method: 'POST',  url: singleUrl,                contentType: 'application/json',                  bodyObj: { ...auth, description: write } },
      { label: 'PATCH /products/{id}, json body, auth in query',      method: 'PATCH', url: `${singleUrl}?${qsAuth}`, contentType: 'application/json',                  bodyObj: { description: write } },
      { label: 'POST /products (collection) w/ product_id, auth in body', method: 'POST', url: collectionUrl,        contentType: 'application/x-www-form-urlencoded', bodyObj: { ...auth, product_id: String(productId), description: write } },
    ];

    const attempts: Attempt[] = [];
    let winner: Attempt | null = null;

    for (const v of variants) {
      const attempt = await tryVariant(v);
      attempts.push(attempt);
      if (attempt.looks_ok) {
        const check = await getProduct(productId);
        if ((check.product?.description ?? null) === write) {
          winner = attempt;
          break;
        }
      }
    }

    const after = await getProduct(productId);
    const afterDescription = after.product?.description ?? null;
    const verified = afterDescription === write;

    return NextResponse.json({
      mode: 'write-test-v2',
      product_id: productId,
      description_before: before.product.description ?? null,
      description_written: write,
      description_after: afterDescription,
      WRITE_VERIFIED: verified,
      winning_variant: winner?.label ?? null,
      conclusion: verified
        ? `✅ Writes work via: ${winner?.label}. Build the write client on this exact shape.`
        : '❌ No variant succeeded. See attempts[] — identical 401s across all variants means the token/account lacks write permission (reply to AM ticket 139923); differing statuses or Location headers point to the mechanical fix.',
      attempts,
    });
  } catch (error: any) {
    console.error('AM write test v2 error:', error);
    return NextResponse.json({ error: 'Internal error', detail: String(error?.message || error) }, { status: 500 });
  }
}
