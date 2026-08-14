#!/usr/bin/env node
/**
 * Adjustments probe v10 — the locked call.
 *
 *   tools/call execute_actions {
 *     operationId: "InventoryQtyAdjustmentController.set",
 *     requestBody: { items:[{sku_id, target_qty, warehouse_id}], reason, dry_run? }
 *   }
 *
 * 1. dry_run:true preview (safe)
 * 2. live: set test SKU to +1 → verify via legacy read → restore → verify
 *
 * Usage: node scripts/probe-adjustments-v10.js
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

const LEGACY_TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const LEGACY = (process.env.NEXT_PUBLIC_APPARELMAGIC_URL || 'https://advanceapparels.app.apparelmagic.com/api/json').replace(/\/+$/, '');
const MCP_URL = process.env.AM_MCP_URL || 'https://api.apparelmagic.com/mcp';
const MCP_KEY = process.env.AM_MCP_KEY || '';
const OPERATION_ID = 'InventoryQtyAdjustmentController.set';

if (!MCP_KEY) { console.error('❌ AM_MCP_KEY missing from .env.local'); process.exit(1); }

async function legacyGet(p, extra = {}) {
  const params = new URLSearchParams({ time: Math.floor(Date.now() / 1000).toString(), token: LEGACY_TOKEN, ...extra });
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

function parseMcpBody(text) {
  try { return JSON.parse(text); } catch {}
  const msgs = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^data:\s*(.+)$/);
    if (m) { try { msgs.push(JSON.parse(m[1])); } catch {} }
  }
  if (!msgs.length) return null;
  return msgs.find(x => x.result !== undefined || x.error !== undefined) || msgs[msgs.length - 1];
}

let sessionId = null;
let reqId = 0;

async function mcpRaw(payload, expectResponse = true) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'X-API-Key': MCP_KEY,
    'User-Agent': 'AdvanceHQ/1.0',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  const text = await res.text();
  return { status: res.status, msg: expectResponse ? parseMcpBody(text) : null, text };
}

function toolText(msg) {
  const content = msg?.result?.content;
  if (Array.isArray(content)) return content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  return JSON.stringify(msg?.result ?? msg?.error ?? null);
}

const isErr = msg => !!(msg?.error || msg?.result?.isError);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function setInventory(skuId, targetQty, reason, dry) {
  return mcpRaw({
    jsonrpc: '2.0', id: ++reqId, method: 'tools/call',
    params: {
      name: 'execute_actions',
      arguments: {
        operationId: OPERATION_ID,
        requestBody: {
          items: [{ sku_id: skuId, target_qty: targetQty, warehouse_id: 1 }],
          reason,
          ...(dry ? { dry_run: true } : {}),
        },
      },
    },
  });
}

(async () => {
  console.log('🔬 Adjustments probe v10 — locked execute_actions call\n');

  const init = await mcpRaw({
    jsonrpc: '2.0', id: ++reqId, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'AdvanceHQ', version: '1.0' } },
  });
  if (init.status >= 400 || !init.msg?.result) {
    console.log(`❌ initialize failed: HTTP ${init.status}`);
    return;
  }
  await mcpRaw({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);
  console.log('1️⃣  initialize ✅');

  const inv = await legacyGet('/inventory');
  const skuId = parseInt(inv.json?.response?.[0]?.sku_id || '4689');
  const before = await liveQty(skuId);
  console.log(`\nTest SKU: sku_id=${skuId} · qty before: ${before}`);
  if (before === null) { console.log('❌ Cannot read live qty'); return; }

  // ── Dry run ──
  console.log('\n2️⃣  dry_run preview (commits nothing)');
  const dry = await setInventory(skuId, before + 1, 'Advance HQ probe v10 dry run', true);
  console.log(`   ${isErr(dry.msg) ? '❌' : '✅'} ${toolText(dry.msg).slice(0, 600)}`);
  if (isErr(dry.msg)) { console.log('\nDry run rejected — paste this output to Claude.'); return; }

  // ── Live round-trip ──
  console.log(`\n3️⃣  Live: → ${before + 1} → verify → ${before} → verify`);
  const up = await setInventory(skuId, before + 1, 'Advance HQ probe v10 (+1)', false);
  console.log(`   set ${before + 1}: ${isErr(up.msg) ? '❌' : '✅'} ${toolText(up.msg).slice(0, 300).replace(/\n/g, ' ')}`);
  await sleep(2500);
  const mid = await liveQty(skuId);
  console.log(`   qty now: ${mid} ${mid === before + 1 ? '✅ applied' : '⚠️  unexpected'}`);

  if (mid === before + 1) {
    const down = await setInventory(skuId, before, 'Advance HQ probe v10 restore', false);
    console.log(`   set ${before}: ${isErr(down.msg) ? '❌' : '✅'} ${toolText(down.msg).slice(0, 300).replace(/\n/g, ' ')}`);
    await sleep(2500);
    const fin = await liveQty(skuId);
    console.log(`   qty now: ${fin} ${fin === before ? '✅ restored' : '⚠️  check AM UI'}`);
    if (fin === before) {
      console.log('\n🎉 FULLY WORKING — the deployed route makes this exact call.');
      console.log('   1. Vercel → Settings → Environment Variables → AM_MCP_KEY = (the am_… key) → Production');
      console.log('   2. cd /Users/Akash/advance-hq && git add -A && git commit -m "Adjustments: live via AM MCP" && git push');
    }
  }

  console.log('\n📋 Paste this output back to Claude.');
})();
