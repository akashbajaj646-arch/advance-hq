#!/usr/bin/env node
/**
 * Probe ApparelMagic before first use of the Adjustments screen.
 * Read-only — makes GET requests only. Verifies:
 *   1. The /adjustments endpoint exists (and shows the record shape)
 *   2. Warehouses list (so you know which warehouse_id will be used)
 *   3. Which inventory filter style AM honors for single-SKU lookups
 *
 * Usage: node scripts/probe-adjustments.js   (run from the repo root)
 */

const fs = require('fs');
const path = require('path');

// ── Load .env.local ──
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const BASE = process.env.NEXT_PUBLIC_APPARELMAGIC_URL || 'https://advanceapparels.app.apparelmagic.com/api/json';

if (!TOKEN) {
  console.error('❌ APPARELMAGIC_TOKEN not found in .env.local');
  process.exit(1);
}

function auth() {
  return { time: Math.floor(Date.now() / 1000).toString(), token: TOKEN };
}

async function amGet(p, extra = {}) {
  const a = auth();
  const params = new URLSearchParams({ time: a.time, token: a.token, ...extra });
  const res = await fetch(`${BASE}${p}?${params}`, { headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

(async () => {
  console.log('🔍 Probing ApparelMagic for the Adjustments module...\n');

  // 1. Adjustments endpoint
  console.log('1️⃣  GET /adjustments (page_size=1)');
  const adj = await amGet('/adjustments', { 'pagination[page_size]': '1' });
  if (adj.json && Array.isArray(adj.json.response)) {
    console.log(`   ✅ Endpoint exists — ${adj.json.response.length} sample record(s)`);
    if (adj.json.response[0]) {
      console.log('   Sample record keys:', Object.keys(adj.json.response[0]).join(', '));
      console.log('   Sample record:', JSON.stringify(adj.json.response[0], null, 2).slice(0, 1500));
    } else {
      console.log('   (No existing adjustments in AM yet — endpoint responded fine.)');
    }
  } else {
    console.log(`   ⚠️  HTTP ${adj.status} — endpoint may be named differently. Raw: ${adj.text.slice(0, 200)}`);
    const alt = await amGet('/inventory_adjustments', { 'pagination[page_size]': '1' });
    if (alt.json && Array.isArray(alt.json.response)) {
      console.log('   ✅ /inventory_adjustments works instead (the API route already falls back to this).');
    } else {
      console.log(`   ❌ /inventory_adjustments also failed (HTTP ${alt.status}). Ask AM support for the adjustments write endpoint.`);
    }
  }

  // 2. Warehouses
  console.log('\n2️⃣  GET /warehouses');
  const wh = await amGet('/warehouses', { 'pagination[page_size]': '100' });
  if (wh.json && Array.isArray(wh.json.response)) {
    console.log(`   ✅ ${wh.json.response.length} warehouse(s):`);
    for (const w of wh.json.response) {
      console.log(`      • id=${w.warehouse_id}  ${w.warehouse_name || w.name || ''}`);
    }
  } else {
    console.log(`   ⚠️  HTTP ${wh.status}: ${wh.text.slice(0, 200)}`);
  }

  // 3. Inventory single-SKU filter test
  console.log('\n3️⃣  Testing single-SKU inventory filters');
  const inv = await amGet('/inventory', { 'pagination[page_size]': '1' });
  const sample = inv.json?.response?.[0];
  if (!sample) {
    console.log('   ⚠️  Could not fetch a sample inventory record to test with.');
  } else {
    const skuId = String(sample.sku_id);
    console.log(`   Using sample sku_id=${skuId} (${sample.sku_concat || sample.style_number})`);

    const styleA = await amGet('/inventory', {
      'parameters[0][field]': 'sku_id',
      'parameters[0][operator]': '=',
      'parameters[0][value]': skuId,
      'pagination[page_size]': '5',
    });
    const aHits = styleA.json?.response || [];
    const aOk = aHits.length >= 1 && aHits.length <= 5 && aHits.some(r => String(r.sku_id) === skuId);
    console.log(`   parameters[] filter: ${aOk ? '✅ works' : `⚠️  returned ${aHits.length} records (likely ignored)`}`);

    const styleB = await amGet('/inventory', { sku_id: skuId, 'pagination[page_size]': '5' });
    const bHits = styleB.json?.response || [];
    const bOk = bHits.length >= 1 && bHits.length <= 5 && bHits.some(r => String(r.sku_id) === skuId);
    console.log(`   direct sku_id= filter: ${bOk ? '✅ works' : `⚠️  returned ${bHits.length} records (likely ignored)`}`);

    if (!aOk && !bOk) {
      console.log('   ❌ Neither filter style works — the screen will fall back to the Supabase snapshot for current qty.');
    }
  }

  console.log('\n✅ Probe complete. No writes were made.');
})();
