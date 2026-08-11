// ApparelMagic API client for Advance HQ — reads AND writes.
//
// ⚠️ WRITE SHAPE IS NON-NEGOTIABLE (proven by write-test v2 on 2026-08-11):
//   - Writes MUST send auth (`time`, `token`) INSIDE a form-encoded body.
//   - Query-string auth (fine for GET) returns a 401 Apache HTML page on PUT/POST.
//   - Update:  PUT  /api/json/{entity}/{id}   form body: time, token, ...fields
//   - Create:  POST /api/json/{entity}        form body: time, token, ...fields
//   - Success responses include the full updated record in `response[0]`
//     and an empty `meta.errors` array — use amOk()/amRecord() to check.
//
// Server-side only (uses APPARELMAGIC_TOKEN). Never import into client components.

const TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const BASE_URL = process.env.NEXT_PUBLIC_APPARELMAGIC_URL || 'https://advanceapparels.app.apparelmagic.com/api/json';

export type AmResult = {
  ok: boolean;
  status: number;
  /** First record from response[] when present */
  record: any | null;
  /** All records from response[] */
  records: any[];
  /** Errors from meta.errors, or a synthesized error for transport failures */
  errors: any[];
  /** Raw parsed body (JSON) or { _raw_text } for non-JSON responses */
  raw: any;
};

function authPair(): Record<string, string> {
  return { time: Math.floor(Date.now() / 1000).toString(), token: TOKEN };
}

async function parseResult(res: Response): Promise<AmResult> {
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { _raw_text: text.slice(0, 1000) }; }

  const records = Array.isArray(body?.response) ? body.response : [];
  const metaErrors = Array.isArray(body?.meta?.errors) ? body.meta.errors : [];
  const transportError = !res.ok || body?._raw_text != null;

  return {
    ok: res.ok && !transportError && metaErrors.length === 0,
    status: res.status,
    record: records[0] ?? null,
    records,
    errors: transportError && metaErrors.length === 0
      ? [{ transport: true, status: res.status, body: body?._raw_text ?? body }]
      : metaErrors,
    raw: body,
  };
}

/** Stringify field values for AM's form encoding (numbers/booleans → strings, null/undefined skipped). */
function toFormFields(fields: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
  }
  return out;
}

/**
 * GET an entity list or single record. Auth in query string (works for reads).
 * amGet('products', { product_id: '2213' })          → filtered list
 * amGet('products/2213')                              → single record
 * amGet('orders', { 'pagination[page_size]': '200' }) → paged list
 */
export async function amGet(path: string, params: Record<string, string> = {}): Promise<AmResult> {
  const qs = new URLSearchParams({ ...authPair(), ...params }).toString();
  const res = await fetch(`${BASE_URL}/${path}?${qs}`, {
    method: 'GET',
    headers: { 'User-Agent': 'AdvanceHQ/1.0' },
  });
  return parseResult(res);
}

/**
 * UPDATE an existing record. Auth + fields form-encoded in the body (the only shape AM accepts).
 * amUpdate('products', '2213', { description: 'New copy', web_description: 'New web copy' })
 */
export async function amUpdate(entity: string, id: string | number, fields: Record<string, any>): Promise<AmResult> {
  const body = new URLSearchParams({ ...authPair(), ...toFormFields(fields) }).toString();
  const res = await fetch(`${BASE_URL}/${entity}/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    headers: { 'User-Agent': 'AdvanceHQ/1.0', 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body,
  });
  return parseResult(res);
}

/**
 * CREATE a new record. Auth + fields form-encoded in the body.
 * amCreate('products', { style_number: 'ABC123', description: '...', price: 4 })
 * On success, result.record contains the created record including its new id.
 */
export async function amCreate(entity: string, fields: Record<string, any>): Promise<AmResult> {
  const body = new URLSearchParams({ ...authPair(), ...toFormFields(fields) }).toString();
  const res = await fetch(`${BASE_URL}/${entity}`, {
    method: 'POST',
    headers: { 'User-Agent': 'AdvanceHQ/1.0', 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body,
  });
  return parseResult(res);
}
