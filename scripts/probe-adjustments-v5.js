#!/usr/bin/env node
/**
 * Adjustments probe v5 — resource-wrapped payload hypothesis.
 *
 * Theory: AM's write API iterates a resource-named array in the body
 * (receivers[0][...]), so bare fields = zero records processed = the
 * silent HTTP 200 no-op we've been seeing.
 *
 * Runs the +1 → verify → −1 → verify loop with three encodings of the
 * wrapped payload. Stops at the first that moves inventory.
 *
 * Usage: node scripts/probe-adjustments-v5.js   (writes — test SKU only)
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
if (!TOKEN) { console.error('❌ APPARELMAGIC_TOKEN missing'); process.exit(1); }

function auth() { return { time: Math.floor(Date.now() / 1000).toString(), token: TOKEN }; }

async function amGet(p, extra = {}) {
  const a = auth();
  const params = new URLSearchParams({ time: a.time, token: a.token, ...extra });
  const res = await fetch(`${BASE}${p}?${params}`, { headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function amPostForm(p, fields) {
  const a = auth();
  const body = new URLSearchParams({ time: a.time, token: a.token, ...fields });
  const res = await fetch(`${BASE}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'AdvanceHQ/1.0' },
    body: body.toString(),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function amPostJson(p, obj) {
  const a = auth();
  const res = await fetch(`${BASE}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'AdvanceHQ/1.0' },
    body: JSON.stringify({ time: a.time, token: a.token, ...obj }),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
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

async function maxReceiverId() {
  const r = await amGet('/receivers', { 'pagination[page_size]': '1000' });
  let max = 0;
  for (const rec of (r.json?.response || [])) max = Math.max(max, parseInt(rec.receiver_id) || 0);
  return max;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('🔬 Adjustments probe v5 — resource-wrapped payloads (WRITE TEST)\n');

  const inv = await amGet('/inventory');
  const sample = inv.json?.response?.[0];
  if (!sample) { console.log('❌ Cannot read inventory'); return; }
  const skuId = String(sample.sku_id);
  const productId = String(sample.product_id || '');
  console.log(`Test SKU: sku_id=${skuId} (${sample.sku_concat || sample.style_number})`);

  const ven = await amGet('/vendors', { 'pagination[page_size]': '1000' });
  const adjVendor = (ven.json?.response || []).find(v => /adjust/i.test(String(v.vendor_name || v.name || '')));
  if (!adjVendor) { console.log('❌ No adjustment vendor'); return; }
  const vendorId = String(adjVendor.vendor_id || adjVendor.id);

  const wh = await amGet('/warehouses', { 'pagination[page_size]': '100' });
  const whIdVal = String((wh.json?.response || [])[0]?.id || '1');
  console.log(`Vendor id=${vendorId}, warehouse id=${whIdVal}`);

  const before = await liveQty(skuId);
  console.log(`Qty before: ${before}\n`);
  if (before === null) { console.log('❌ Cannot read live qty'); return; }

  const now = new Date();
  const dateStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;

  function headerObj(delta) {
    return {
      date: dateStr,
      vendor_id: vendorId,
      warehouse_id: whIdVal,
      notes: 'Advance HQ probe v5',
      receiver_items: [{
        sku_id: skuId,
        product_id: productId,
        warehouse_id: whIdVal,
        qty: String(delta),
        unit_cost: '0',
      }],
    };
  }

  const variants = [
    {
      name: 'F: form, receivers[0][...] wrapped brackets',
      run: d => amPostForm('/receivers', {
        'receivers[0][date]': dateStr,
        'receivers[0][vendor_id]': vendorId,
        'receivers[0][warehouse_id]': whIdVal,
        'receivers[0][notes]': 'Advance HQ probe v5',
        'receivers[0][receiver_items][0][sku_id]': skuId,
        'receivers[0][receiver_items][0][product_id]': productId,
        'receivers[0][receiver_items][0][warehouse_id]': whIdVal,
        'receivers[0][receiver_items][0][qty]': String(d),
        'receivers[0][receiver_items][0][unit_cost]': '0',
      }),
    },
    {
      name: 'G: JSON body, {receivers:[{...}]}, token in body',
      run: d => amPostJson('/receivers', { receivers: [headerObj(d)] }),
    },
    {
      name: 'H: form, receivers=<JSON string>',
      run: d => amPostForm('/receivers', { receivers: JSON.stringify([headerObj(d)]) }),
    },
  ];

  let winner = null;
  let prevMaxId = await maxReceiverId();

  for (const v of variants) {
    console.log(`▶ Variant ${v.name}`);
    const r = await v.run(1);
    console.log(`  HTTP ${r.status} · ${r.json ? JSON.stringify(r.json).slice(0, 500) : r.text.slice(0, 200).replace(/\n/g, ' ')}`);
    await sleep(2500);
    const q = await liveQty(skuId);
    const newMaxId = await maxReceiverId();
    const qtyMoved = q === before + 1;
    const receiverCreated = newMaxId > prevMaxId;
    console.log(`  qty now: ${q} (${qtyMoved ? '✅ +1 applied' : 'no change'}) · new receiver: ${receiverCreated ? `✅ id=${newMaxId}` : 'no'}\n`);
    prevMaxId = newMaxId;

    if (qtyMoved) { winner = v; break; }
    if (receiverCreated && !qtyMoved) {
      console.log(`  ⚠️  Header created without inventory effect — void receiver id=${newMaxId} in the AM UI.\n`);
    }
  }

  if (!winner) {
    console.log('❌ Resource-wrapped variants also no-op. REST receiver creation is a dead end on this account.');
    console.log('\n👉 Definitive next step — takes 2 minutes in Claude Desktop:');
    console.log('   Ask Claude there: "Using the ApparelMagic MCP, run search_actions for');
    console.log('   \'receiver\', \'adjustment\', and \'inventory\', then get_schema for anything');
    console.log('   that creates or adjusts, and show me the full schemas."');
    console.log('   Paste the schemas back into this chat.');
    return;
  }

  console.log(`🏆 WINNER: variant ${winner.name}`);
  console.log('Restoring with −1...');
  const r2 = await winner.run(-1);
  console.log(`  HTTP ${r2.status} · ${r2.json ? JSON.stringify(r2.json).slice(0, 300) : r2.text.slice(0, 150)}`);
  await sleep(2500);
  const finalQty = await liveQty(skuId);
  console.log(`  qty now: ${finalQty} ${finalQty === before ? '✅ restored — both directions work' : '⚠️  NOT restored — negative receivers may be rejected; check AM UI'}`);
  console.log('\n📋 Paste this output back to Claude to lock the route to the winner.');
})();
