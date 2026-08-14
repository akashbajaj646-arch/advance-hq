#!/usr/bin/env node
/**
 * Adjustments probe v4 — find the receiver payload encoding AM actually parses.
 *
 * Step 1 (read-only): dump the FULL receiver_items structure from existing
 *         receivers, plus any receivers created today (checks whether the v3
 *         test left empty headers behind).
 * Step 2 (write, only with --write-test): try payload variants for a +1
 *         receiver one at a time. After each attempt, verify whether the live
 *         qty moved AND whether a new receiver appeared. Stop at the first
 *         variant that works, then write a −1 with the same variant to restore.
 *
 * Usage:
 *   node scripts/probe-adjustments-v4.js                (read-only inspection)
 *   node scripts/probe-adjustments-v4.js --write-test   (variant hunt)
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

async function amPostJson(p, obj, tokenInBody) {
  const a = auth();
  const url = tokenInBody ? `${BASE}${p}` : `${BASE}${p}?${new URLSearchParams({ time: a.time, token: a.token })}`;
  const payload = tokenInBody ? { time: a.time, token: a.token, ...obj } : obj;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'AdvanceHQ/1.0' },
    body: JSON.stringify(payload),
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
  const list = r.json?.response || [];
  let max = 0;
  for (const rec of list) max = Math.max(max, parseInt(rec.receiver_id) || 0);
  return { max, list };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log(`🔬 Adjustments probe v4 ${WRITE_TEST ? '(WRITE TEST)' : '(read-only)'}\n`);

  // ── 1. Inspect real receivers ──
  console.log('1️⃣  Existing receiver structure');
  const { max: startMaxId, list: receivers } = await maxReceiverId();
  console.log(`   ${receivers.length} receiver(s), highest receiver_id=${startMaxId}`);

  const withItems = receivers.find(r => Array.isArray(r.receiver_items) && r.receiver_items.length > 0);
  if (withItems) {
    console.log(`   Receiver ${withItems.receiver_id} (vendor: ${withItems.vendor_name}, adjustment_type: ${JSON.stringify(withItems.adjustment_type)}, qty: ${withItems.qty}):`);
    console.log('   receiver_items[0] VERBATIM:');
    console.log('   ' + JSON.stringify(withItems.receiver_items[0], null, 2).split('\n').join('\n   '));
    if (withItems.receiver_items[0]) {
      console.log('   → item field names: ' + Object.keys(withItems.receiver_items[0]).join(', '));
    }
  } else {
    console.log('   ⚠️  No receiver has populated receiver_items — will rely on guessed field names.');
  }

  // Show adjustment_type values seen across receivers
  const adjTypes = [...new Set(receivers.map(r => JSON.stringify(r.adjustment_type)))];
  console.log(`   adjustment_type values seen: ${adjTypes.join(', ')}`);

  // Receivers created today (did v3 leave empty headers?)
  const today = new Date();
  const todayStr = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;
  const todays = receivers.filter(r => (r.date || '').includes(todayStr) || String(r.notes || '').includes('probe write test'));
  if (todays.length) {
    console.log(`   ⚠️  ${todays.length} receiver(s) from today / v3 test:`);
    for (const t of todays) console.log(`      • receiver_id=${t.receiver_id} qty=${t.qty} notes="${(t.notes || '').slice(0, 60)}" void=${t.void}`);
    console.log('      (If these are empty test headers, void them in the AM UI: Receiving > open > Void.)');
  } else {
    console.log('   ✅ No stray receivers from the v3 test — the silent no-op created nothing.');
  }

  if (!WRITE_TEST) {
    console.log('\n2️⃣  Variant hunt skipped (read-only). Run with --write-test when ready.');
    console.log('\n✅ Done. Paste this output back to Claude.');
    return;
  }

  // ── 2. Variant hunt ──
  const inv = await amGet('/inventory');
  const sample = inv.json?.response?.[0];
  if (!sample) { console.log('❌ Cannot read inventory'); return; }
  const skuId = String(sample.sku_id);
  const productId = String(sample.product_id || '');

  const ven = await amGet('/vendors', { 'pagination[page_size]': '1000' });
  const vendors = ven.json?.response || [];
  const adjVendor = vendors.find(v => /adjust/i.test(String(v.vendor_name || v.name || '')));
  if (!adjVendor) { console.log('❌ No adjustment vendor'); return; }
  const vendorId = String(adjVendor.vendor_id || adjVendor.id);

  const wh = await amGet('/warehouses', { 'pagination[page_size]': '100' });
  const whIdVal = String((wh.json?.response || [])[0]?.id || '1');

  // Use item field names learned from a real receiver if available
  const learnedItemKeys = withItems?.receiver_items?.[0] ? Object.keys(withItems.receiver_items[0]) : [];
  const qtyKey = learnedItemKeys.find(k => k === 'qty') || learnedItemKeys.find(k => /^qty/.test(k)) || 'qty';
  const skuKey = learnedItemKeys.includes('sku_id') ? 'sku_id' : (learnedItemKeys.find(k => /sku/.test(k)) || 'sku_id');
  console.log(`\n2️⃣  Variant hunt on sku_id=${skuId} (item keys: sku→${skuKey}, qty→${qtyKey})`);

  const before = await liveQty(skuId);
  console.log(`   Qty before: ${before}`);
  if (before === null) { console.log('❌ Cannot read live qty'); return; }

  const baseHeader = {
    date: todayStr,
    vendor_id: vendorId,
    warehouse_id: whIdVal,
    notes: 'Advance HQ probe v4 variant test',
  };

  const variants = [
    {
      name: 'A: form brackets + cost/product_id',
      run: d => amPostForm('/receivers', {
        ...baseHeader,
        [`receiver_items[0][${skuKey}]`]: skuId,
        [`receiver_items[0][${qtyKey}]`]: String(d),
        'receiver_items[0][cost]': '0',
        'receiver_items[0][product_id]': productId,
      }),
    },
    {
      name: 'B: form, receiver_items as JSON string',
      run: d => amPostForm('/receivers', {
        ...baseHeader,
        receiver_items: JSON.stringify([{ [skuKey]: skuId, [qtyKey]: String(d), cost: '0', product_id: productId }]),
      }),
    },
    {
      name: 'C: JSON body, token in body',
      run: d => amPostJson('/receivers', {
        ...baseHeader,
        receiver_items: [{ [skuKey]: skuId, [qtyKey]: String(d), cost: '0', product_id: productId }],
      }, true),
    },
    {
      name: 'D: JSON body, token in query string',
      run: d => amPostJson('/receivers', {
        ...baseHeader,
        receiver_items: [{ [skuKey]: skuId, [qtyKey]: String(d), cost: '0', product_id: productId }],
      }, false),
    },
    {
      name: 'E: form brackets, items[] key',
      run: d => amPostForm('/receivers', {
        ...baseHeader,
        [`items[0][${skuKey}]`]: skuId,
        [`items[0][${qtyKey}]`]: String(d),
        'items[0][cost]': '0',
      }),
    },
  ];

  let winner = null;
  let prevMaxId = startMaxId;

  for (const v of variants) {
    console.log(`\n   ▶ Variant ${v.name}`);
    const r = await v.run(1);
    const bodyPreview = r.json ? JSON.stringify(r.json).slice(0, 400) : r.text.slice(0, 200).replace(/\n/g, ' ');
    console.log(`     HTTP ${r.status} · ${bodyPreview}`);
    await sleep(2500);
    const q = await liveQty(skuId);
    const { max: newMaxId } = await maxReceiverId();
    const qtyMoved = q === before + 1;
    const receiverCreated = newMaxId > prevMaxId;
    console.log(`     qty now: ${q} (${qtyMoved ? '✅ +1 applied' : 'no change'}) · new receiver created: ${receiverCreated ? `✅ id=${newMaxId}` : 'no'}`);
    prevMaxId = newMaxId;

    if (qtyMoved) { winner = v; break; }
    if (receiverCreated && !qtyMoved) {
      console.log('     ⚠️  Created a receiver HEADER but qty did not move — void receiver id=' + newMaxId + ' in the AM UI.');
    }
  }

  if (!winner) {
    console.log('\n❌ No variant moved inventory. The REST API may not support receiver creation on this plan.');
    console.log('   Next move: in Claude Desktop, ask the ApparelMagic MCP to search_actions for "receiver" and "adjustment"');
    console.log('   and paste the schemas back — the MCP is likely the correct write surface.');
    console.log('\n📋 Paste this whole output back to Claude.');
    return;
  }

  console.log(`\n   🏆 WINNER: variant ${winner.name}`);
  console.log('   Restoring with −1 via the same variant...');
  const r2 = await winner.run(-1);
  console.log(`     HTTP ${r2.status} · ${r2.json ? JSON.stringify(r2.json).slice(0, 300) : r2.text.slice(0, 200)}`);
  await sleep(2500);
  const finalQty = await liveQty(skuId);
  console.log(`     qty now: ${finalQty} ${finalQty === before ? '✅ restored — negative receivers work too' : '⚠️  NOT restored — negative receivers may be rejected; check AM UI'}`);

  console.log('\n📋 Paste this whole output back to Claude so the route can be locked to the winning variant.');
})();
