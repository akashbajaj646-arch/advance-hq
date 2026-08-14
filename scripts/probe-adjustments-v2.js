#!/usr/bin/env node
/**
 * Adjustments diagnostic v2 — READ-ONLY, no writes.
 * Prints raw statuses and real field names so we stop guessing:
 *   1. Exact base URL in use (token masked)
 *   2. /warehouses raw record → find the real id field
 *   3. /inventory raw status + record keys
 *   4. Candidate adjustment endpoints, each with exact status + response type
 *   5. Single-SKU filter test (if inventory readable)
 *
 * Usage: node scripts/probe-adjustments-v2.js   (from repo root)
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const BASE = (process.env.NEXT_PUBLIC_APPARELMAGIC_URL || 'https://advanceapparels.app.apparelmagic.com/api/json').replace(/\/+$/, '');

if (!TOKEN) { console.error('❌ APPARELMAGIC_TOKEN missing from .env.local'); process.exit(1); }

function auth() { return { time: Math.floor(Date.now() / 1000).toString(), token: TOKEN }; }

async function amGet(p, extra = {}) {
  const a = auth();
  const params = new URLSearchParams({ time: a.time, token: a.token, ...extra });
  const url = `${BASE}${p}?${params}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, isHtml: /^\s*<!DOCTYPE|^\s*<html/i.test(text) };
  } catch (e) {
    return { status: 0, json: null, text: String(e), isHtml: false };
  }
}

function describe(r) {
  if (r.status === 0) return `network error: ${r.text.slice(0, 120)}`;
  if (r.json && Array.isArray(r.json.response)) return `HTTP ${r.status} · JSON · ${r.json.response.length} record(s)`;
  if (r.json) return `HTTP ${r.status} · JSON (no response[] array) · top keys: ${Object.keys(r.json).join(', ')}`;
  if (r.isHtml) return `HTTP ${r.status} · Apache/HTML error page (not JSON)`;
  return `HTTP ${r.status} · non-JSON: ${r.text.slice(0, 120)}`;
}

(async () => {
  console.log('🔬 Adjustments diagnostic v2 (read-only)\n');
  console.log(`Base URL: ${BASE}`);
  console.log(`Token:    ${TOKEN.slice(0, 4)}…${TOKEN.slice(-4)} (${TOKEN.length} chars)\n`);

  // ── 1. Warehouses: dump the real record so we see the id field name ──
  console.log('1️⃣  /warehouses');
  const wh = await amGet('/warehouses', { 'pagination[page_size]': '100' });
  console.log(`   ${describe(wh)}`);
  const whList = wh.json?.response || [];
  if (whList[0]) {
    console.log('   First record, verbatim:');
    console.log('   ' + JSON.stringify(whList[0], null, 2).split('\n').join('\n   '));
    const idField = ['warehouse_id', 'id', 'location_id'].find(f => whList[0][f] !== undefined)
      || Object.keys(whList[0]).find(k => /(^|_)id$/.test(k));
    console.log(`   → Detected id field: ${idField || 'NOT FOUND'}`);
    for (const w of whList) {
      console.log(`   • ${idField ? `${idField}=${w[idField]}` : '(no id)'}  ${w.warehouse_name || w.name || w.description || ''}`);
    }
  }

  // ── 2. Inventory: exact status ──
  console.log('\n2️⃣  /inventory (page_size=1)');
  const inv = await amGet('/inventory', { 'pagination[page_size]': '1' });
  console.log(`   ${describe(inv)}`);
  const sample = inv.json?.response?.[0] || null;
  if (sample) {
    console.log(`   Sample sku_id=${sample.sku_id} (${sample.sku_concat || sample.style_number})`);
  } else if (inv.text) {
    console.log(`   First 300 chars of body:\n   ${inv.text.slice(0, 300).replace(/\n/g, ' ')}`);
    // Retry without pagination at all
    const inv2 = await amGet('/inventory');
    console.log(`   Retry with NO params: ${describe(inv2)}`);
    if (inv2.json?.response?.[0]) console.log('   → Works without pagination! sku_id=' + inv2.json.response[0].sku_id);
  }

  // ── 3. Candidate adjustment endpoints ──
  console.log('\n3️⃣  Candidate adjustment endpoints (GET, read-only)');
  const candidates = [
    '/adjustments',
    '/inventory_adjustments',
    '/adjustment',
    '/stock_adjustments',
    '/inventory_transactions',
    '/transactions',
    '/receivers',
  ];
  for (const c of candidates) {
    const r = await amGet(c, { 'pagination[page_size]': '1' });
    const good = r.json && Array.isArray(r.json.response);
    console.log(`   ${good ? '✅' : '  '} ${c.padEnd(26)} ${describe(r)}`);
    if (good && r.json.response[0]) {
      console.log('      Record keys: ' + Object.keys(r.json.response[0]).join(', '));
    }
  }

  // ── 4. Filter test, if we got a sample SKU ──
  const testSku = sample?.sku_id || (await amGet('/inventory')).json?.response?.[0]?.sku_id;
  if (testSku) {
    console.log(`\n4️⃣  Single-SKU filter test (sku_id=${testSku})`);
    const a = await amGet('/inventory', {
      'parameters[0][field]': 'sku_id',
      'parameters[0][operator]': '=',
      'parameters[0][value]': String(testSku),
      'pagination[page_size]': '5',
    });
    const aHits = a.json?.response || [];
    console.log(`   parameters[] style: ${describe(a)}${aHits.length ? ` — ${aHits.length} hit(s), match=${aHits.some(r => String(r.sku_id) === String(testSku))}` : ''}`);

    const b = await amGet('/inventory', { sku_id: String(testSku), 'pagination[page_size]': '5' });
    const bHits = b.json?.response || [];
    console.log(`   direct sku_id= style: ${describe(b)}${bHits.length ? ` — ${bHits.length} hit(s), match=${bHits.some(r => String(r.sku_id) === String(testSku))}` : ''}`);
  } else {
    console.log('\n4️⃣  Skipped filter test — no sample SKU readable.');
  }

  console.log('\n✅ Diagnostic complete. No writes were made. Paste this whole output back to Claude.');
})();
