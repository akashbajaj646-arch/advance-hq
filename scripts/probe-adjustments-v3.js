#!/usr/bin/env node
/**
 * Adjustments probe v3.
 *
 * Default mode is READ-ONLY:
 *   1. Retest single-SKU inventory filters with valid page_size (>=10)
 *   2. Look for the virtual "Inventory Adjustment" vendor
 *   3. Show /receivers shape
 *
 * Optional WRITE TEST (only runs if you explicitly pass --write-test):
 *   Picks the sample SKU, writes a +1 receiver, verifies qty went up by 1,
 *   then writes a -1 receiver to put it back, and verifies again.
 *
 * Usage:
 *   node scripts/probe-adjustments-v3.js                (read-only)
 *   node scripts/probe-adjustments-v3.js --write-test   (full round-trip on one SKU)
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
const WRITE_TEST = process.argv.includes('--write-test');

if (!TOKEN) { console.error('❌ APPARELMAGIC_TOKEN missing from .env.local'); process.exit(1); }

function auth() { return { time: Math.floor(Date.now() / 1000).toString(), token: TOKEN }; }

async function amGet(p, extra = {}) {
  const a = auth();
  const params = new URLSearchParams({ time: a.time, token: a.token, ...extra });
  const res = await fetch(`${BASE}${p}?${params}`, { headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function amPost(p, fields) {
  const a = auth();
  const body = new URLSearchParams({ time: a.time, token: a.token, ...fields });
  const res = await fetch(`${BASE}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'AdvanceHQ/1.0' },
    body: body.toString(),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function liveQty(skuId) {
  const r = await amGet('/inventory', {
    'parameters[0][field]': 'sku_id',
    'parameters[0][operator]': '=',
    'parameters[0][value]': String(skuId),
    'pagination[page_size]': '10',
  });
  const hit = (r.json?.response || []).find(x => String(x.sku_id) === String(skuId));
  return hit ? parseFloat(hit.qty_inventory) || 0 : null;
}

(async () => {
  console.log(`🔬 Adjustments probe v3 ${WRITE_TEST ? '(WRITE TEST ENABLED)' : '(read-only)'}\n`);

  // ── 1. Filter retest with valid page_size ──
  const inv = await amGet('/inventory');
  const sample = inv.json?.response?.[0];
  if (!sample) { console.log('❌ Could not read /inventory at all — stopping.'); process.exit(1); }
  const skuId = String(sample.sku_id);
  console.log(`1️⃣  Filter retest (sample sku_id=${skuId}, ${sample.sku_concat || sample.style_number})`);

  const fA = await amGet('/inventory', {
    'parameters[0][field]': 'sku_id',
    'parameters[0][operator]': '=',
    'parameters[0][value]': skuId,
    'pagination[page_size]': '10',
  });
  const aHits = fA.json?.response || [];
  const aOk = aHits.some(r => String(r.sku_id) === skuId) && aHits.length <= 10;
  console.log(`   parameters[] style (page_size=10): ${aOk ? `✅ works — ${aHits.length} hit(s)` : `⚠️  ${aHits.length} records, match=${aHits.some(r => String(r.sku_id) === skuId)}`}`);
  if (fA.json?.meta?.errors?.length) console.log(`   meta.errors: ${fA.json.meta.errors.join(' | ')}`);

  const fB = await amGet('/inventory', { sku_id: skuId, 'pagination[page_size]': '10' });
  const bHits = fB.json?.response || [];
  const bOk = bHits.some(r => String(r.sku_id) === skuId) && bHits.length <= 10;
  console.log(`   direct sku_id= style (page_size=10): ${bOk ? `✅ works — ${bHits.length} hit(s)` : `⚠️  ${bHits.length} records, match=${bHits.some(r => String(r.sku_id) === skuId)}`}`);

  if (!aOk && !bOk) {
    console.log('   ❌ Neither filter isolates a SKU — the screen will fall back to snapshot qty. Continue anyway.');
  }

  // ── 2. Adjustment vendor ──
  console.log('\n2️⃣  Looking for the virtual "Inventory Adjustment" vendor');
  const ven = await amGet('/vendors', { 'pagination[page_size]': '1000' });
  const vendors = ven.json?.response || [];
  console.log(`   ${vendors.length} vendor(s) in AM`);
  const nameOf = v => String(v.vendor_name || v.name || v.company || '');
  const idOf = v => String(v.vendor_id || v.id || '');
  if (vendors[0]) console.log(`   Vendor record keys: ${Object.keys(vendors[0]).join(', ')}`);
  const adjVendors = vendors.filter(v => /adjust/i.test(nameOf(v)));
  if (adjVendors.length) {
    for (const v of adjVendors) console.log(`   ✅ Found: id=${idOf(v)}  "${nameOf(v)}"`);
  } else {
    console.log('   ⚠️  No vendor with "adjust" in the name.');
    console.log('   → In ApparelMagic, create a vendor named "Inventory Adjustment" (one-time, takes 30 seconds).');
    console.log('     Then re-run this probe. First few existing vendors for reference:');
    for (const v of vendors.slice(0, 5)) console.log(`      • id=${idOf(v)}  "${nameOf(v)}"`);
  }

  // ── 3. Receivers shape ──
  console.log('\n3️⃣  /receivers');
  const rec = await amGet('/receivers', { 'pagination[page_size]': '10' });
  const recs = rec.json?.response || [];
  console.log(`   HTTP ${rec.status} · ${recs.length} existing receiver(s)`);
  if (recs[0]) {
    console.log('   Record keys: ' + Object.keys(recs[0]).join(', '));
    const itemsKey = Object.keys(recs[0]).find(k => /items/i.test(k));
    if (itemsKey && Array.isArray(recs[0][itemsKey]) && recs[0][itemsKey][0]) {
      console.log(`   ${itemsKey}[0] keys: ` + Object.keys(recs[0][itemsKey][0]).join(', '));
    }
  } else {
    console.log('   (No existing receivers — shape unknown until first write.)');
  }

  // ── 4. Optional write test ──
  if (!WRITE_TEST) {
    console.log('\n4️⃣  Write test skipped (read-only mode).');
    console.log('    To run a safe +1/−1 round-trip on the sample SKU:');
    console.log('    node scripts/probe-adjustments-v3.js --write-test');
    console.log('\n✅ Probe complete. Paste this output back to Claude.');
    return;
  }

  console.log('\n4️⃣  WRITE TEST — +1 then −1 on sku_id=' + skuId);
  const adjVendor = adjVendors[0];
  if (!adjVendor) { console.log('   ❌ No adjustment vendor — create it first, then re-run.'); return; }

  const warehousesRes = await amGet('/warehouses', { 'pagination[page_size]': '100' });
  const wh = (warehousesRes.json?.response || [])[0];
  const whIdVal = String(wh?.id || wh?.warehouse_id || '1');
  console.log(`   Using vendor id=${idOf(adjVendor)} "${nameOf(adjVendor)}", warehouse id=${whIdVal}`);

  const before = await liveQty(skuId);
  console.log(`   Qty before: ${before}`);
  if (before === null) { console.log('   ❌ Cannot read live qty — aborting write test.'); return; }

  const now = new Date();
  const dateStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;

  async function writeDelta(delta, label) {
    const r = await amPost('/receivers', {
      date: dateStr,
      vendor_id: idOf(adjVendor),
      warehouse_id: whIdVal,
      notes: `Advance HQ probe write test (${label})`,
      'receiver_items[0][sku_id]': skuId,
      'receiver_items[0][qty]': String(delta),
    });
    const ok = r.json && !r.json.error && !(r.json.meta?.errors?.length) && r.status < 400;
    console.log(`   ${label}: HTTP ${r.status} ${ok ? '✅' : '❌'}`);
    if (r.json) console.log('   Response: ' + JSON.stringify(r.json).slice(0, 800));
    else console.log('   Body: ' + r.text.slice(0, 300).replace(/\n/g, ' '));
    return ok;
  }

  const upOk = await writeDelta(1, '+1 receiver');
  await new Promise(r => setTimeout(r, 2000));
  const mid = await liveQty(skuId);
  console.log(`   Qty after +1: ${mid} ${mid === before + 1 ? '✅ increased correctly' : '⚠️  unexpected'}`);

  if (upOk) {
    const downOk = await writeDelta(-1, '−1 receiver (restore)');
    await new Promise(r => setTimeout(r, 2000));
    const after = await liveQty(skuId);
    console.log(`   Qty after −1: ${after} ${after === before ? '✅ restored to original' : '⚠️  check in AM UI'}`);
    if (!downOk) console.log('   ⚠️  Negative qty receiver rejected — decreases may need a different mechanism. Paste this output to Claude.');
  }

  console.log('\n✅ Write test complete. Check Inventory + Receiving in the AM UI, and paste this output back to Claude.');
})();
