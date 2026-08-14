#!/usr/bin/env node
/**
 * Adjustments probe v6 — the modern API surface.
 *
 * The AM MCP revealed POST /api/inventory/set (absolute set with dry_run).
 * This probe finds which auth style that surface accepts:
 *
 * Phase 1 (SAFE): try auth styles against /api/inventory/set with
 *         dry_run:true — previews only, commits nothing.
 * Phase 2 (live, only if phase 1 finds a winner): set the test SKU to
 *         current+1, verify via legacy inventory read, set back, verify.
 *
 * Usage: node scripts/probe-adjustments-v6.js
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
const LEGACY = (process.env.NEXT_PUBLIC_APPARELMAGIC_URL || 'https://advanceapparels.app.apparelmagic.com/api/json').replace(/\/+$/, '');
const MODERN = LEGACY.replace(/\/api\/json$/, '/api'); // …/api
if (!TOKEN) { console.error('❌ APPARELMAGIC_TOKEN missing'); process.exit(1); }

function legacyAuth() { return { time: Math.floor(Date.now() / 1000).toString(), token: TOKEN }; }

async function legacyGet(p, extra = {}) {
  const a = legacyAuth();
  const params = new URLSearchParams({ time: a.time, token: a.token, ...extra });
  const res = await fetch(`${LEGACY}${p}?${params}`, { headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function liveQty(skuId) {
  const r = await legacyGet('/inventory', {
    'parameters[0][field]': 'sku_id',
    'parameters[0][operator]': '=',
    'parameters[0][value]': String(skuId),
    'pagination[page_size]': '10',
  });
  const hit = (r.json?.response || []).find(x => String(x.sku_id) === String(skuId));
  return hit ? parseFloat(hit.qty_inventory) || 0 : null;
}

async function modernPost(p, bodyObj, style) {
  const a = legacyAuth();
  let url = `${MODERN}${p}`;
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'AdvanceHQ/1.0', ...(style.headers || {}) };
  if (style.query) {
    const q = {};
    for (const [k, v] of Object.entries(style.query)) q[k] = v === '__TIME__' ? a.time : v;
    url += '?' + new URLSearchParams(q).toString();
  }
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(bodyObj) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, isHtml: /^\s*<!DOCTYPE|^\s*<html/i.test(text) };
  } catch (e) {
    return { status: 0, json: null, text: String(e), isHtml: false };
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('🔬 Adjustments probe v6 — modern API /inventory/set\n');
  console.log(`Modern base: ${MODERN}`);

  const inv = await legacyGet('/inventory');
  const sample = inv.json?.response?.[0];
  if (!sample) { console.log('❌ Cannot read inventory'); return; }
  const skuId = parseInt(sample.sku_id);
  const before = await liveQty(skuId);
  console.log(`Test SKU: sku_id=${skuId} (${sample.sku_concat || sample.style_number}) · qty before: ${before}\n`);
  if (before === null) { console.log('❌ Cannot read live qty'); return; }

  const dryBody = {
    items: [{ sku_id: skuId, target_qty: before + 1, warehouse_id: 1 }],
    reason: 'Advance HQ probe v6 dry run',
    dry_run: true,
  };

  const styles = [
    { name: 'Bearer token header', headers: { Authorization: `Bearer ${TOKEN}` } },
    { name: 'X-API-Key header', headers: { 'X-API-Key': TOKEN } },
    { name: 'X-Api-Token header', headers: { 'X-Api-Token': TOKEN } },
    { name: 'api-key header', headers: { 'api-key': TOKEN } },
    { name: 'token query param', query: { token: TOKEN } },
    { name: 'legacy time+token query', query: { time: '__TIME__', token: TOKEN } },
  ];

  console.log('1️⃣  Auth-style hunt (dry_run:true — commits nothing)');
  let winner = null;
  for (const s of styles) {
    const r = await modernPost('/inventory/set', dryBody, s);
    const looksAuthFail = r.status === 401 || r.status === 403 || r.isHtml;
    const looksGood = r.status >= 200 && r.status < 300 && r.json;
    const preview = r.json ? JSON.stringify(r.json).slice(0, 300) : r.text.slice(0, 120).replace(/\n/g, ' ');
    console.log(`   ${looksGood ? '✅' : looksAuthFail ? '🔒' : '⚠️ '} ${s.name.padEnd(26)} HTTP ${r.status} · ${preview}`);
    if (looksGood && !winner) winner = s;
    await sleep(400);
  }

  if (!winner) {
    console.log('\n❌ No auth style reached /inventory/set directly.');
    console.log('   The modern API may only accept the MCP layer\'s injected key (a separate credential).');
    console.log('   Check ApparelMagic Settings > API for a separate REST/MCP key, or ask AM support:');
    console.log('   "How do we authenticate direct calls to POST /api/inventory/set outside the MCP?"');
    console.log('\n📋 Paste this output back to Claude.');
    return;
  }

  console.log(`\n   🏆 Auth winner: ${winner.name}`);

  // ── Phase 2: live round-trip ──
  console.log('\n2️⃣  Live round-trip: set to ' + (before + 1) + ', verify, set back to ' + before);
  const upBody = { items: [{ sku_id: skuId, target_qty: before + 1, warehouse_id: 1 }], reason: 'Advance HQ probe v6 test (+1)' };
  const r1 = await modernPost('/inventory/set', upBody, winner);
  console.log(`   set +1: HTTP ${r1.status} · ${(r1.json ? JSON.stringify(r1.json) : r1.text).slice(0, 400)}`);
  await sleep(2500);
  const mid = await liveQty(skuId);
  console.log(`   qty now: ${mid} ${mid === before + 1 ? '✅ set applied' : '⚠️  unexpected'}`);

  if (mid === before + 1) {
    const downBody = { items: [{ sku_id: skuId, target_qty: before, warehouse_id: 1 }], reason: 'Advance HQ probe v6 restore' };
    const r2 = await modernPost('/inventory/set', downBody, winner);
    console.log(`   restore: HTTP ${r2.status} · ${(r2.json ? JSON.stringify(r2.json) : r2.text).slice(0, 300)}`);
    await sleep(2500);
    const fin = await liveQty(skuId);
    console.log(`   qty now: ${fin} ${fin === before ? '✅ restored — /inventory/set works both directions' : '⚠️  check AM UI'}`);
    if (fin === before) {
      console.log('\n🎉 FULLY WORKING. The route is already wired to this — deploy and the screen is live:');
      console.log('   cd /Users/Akash/advance-hq && git add -A && git commit -m "Adjustments: wire to /api/inventory/set" && git push');
    }
  }

  console.log('\n📋 Paste this output back to Claude.');
})();
