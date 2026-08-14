#!/usr/bin/env node
/**
 * Deactivation write test — safe round-trip on the bookkeeping test SKU.
 *   1. Read current active flag (legacy API)
 *   2. SKUController.update → active: 0, verify
 *   3. Restore original active value, verify
 *
 * Usage: node scripts/probe-deactivate-test.js
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
if (!MCP_KEY) { console.error('❌ AM_MCP_KEY missing'); process.exit(1); }

async function legacyGet(p, extra = {}) {
  const params = new URLSearchParams({ time: Math.floor(Date.now() / 1000).toString(), token: LEGACY_TOKEN, ...extra });
  const res = await fetch(`${LEGACY}${p}?${params}`, { headers: { 'User-Agent': 'AdvanceHQ/1.0' } });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}

async function liveRecord(skuId) {
  const r = await legacyGet('/inventory', {
    'parameters[0][field]': 'sku_id',
    'parameters[0][operator]': '=',
    'parameters[0][value]': String(skuId),
    'pagination[page_size]': '10',
  });
  return (r.json?.response || []).find(x => String(x.sku_id) === String(skuId)) || null;
}

function parseMcpBody(text) {
  try { return JSON.parse(text); } catch {}
  const msgs = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^data:\s*(.+)$/);
    if (m) { try { msgs.push(JSON.parse(m[1])); } catch {} }
  }
  return msgs.find(x => x.result !== undefined || x.error !== undefined) || msgs[msgs.length - 1] || null;
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
  return { status: res.status, msg: expectResponse ? parseMcpBody(text) : null };
}

function toolText(msg) {
  const c = msg?.result?.content;
  if (Array.isArray(c)) return c.filter(x => x.type === 'text').map(x => x.text).join('\n');
  return JSON.stringify(msg?.result ?? msg?.error ?? null);
}
const isErr = msg => !!(msg?.error || msg?.result?.isError);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function setActive(skuId, active) {
  return mcpRaw({
    jsonrpc: '2.0', id: ++reqId, method: 'tools/call',
    params: {
      name: 'execute_actions',
      arguments: {
        operationId: 'SKUController.update',
        pathParams: { id: skuId },
        requestBody: { active: active ? 1 : 0 },
      },
    },
  });
}

(async () => {
  console.log('🔬 SKU deactivation round-trip test\n');

  const init = await mcpRaw({
    jsonrpc: '2.0', id: ++reqId, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'AdvanceHQ', version: '1.0' } },
  });
  if (init.status >= 400 || !init.msg?.result) { console.log('❌ initialize failed'); return; }
  await mcpRaw({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);

  const inv = await legacyGet('/inventory');
  const skuId = parseInt(inv.json?.response?.[0]?.sku_id || '4689');
  const before = await liveRecord(skuId);
  if (!before) { console.log('❌ Cannot read test SKU'); return; }
  const wasActive = before.active === '1' || before.active === 1 || before.active === true;
  console.log(`Test SKU: sku_id=${skuId} (${before.sku_concat || before.style_number}) · active before: ${before.active} (${wasActive ? 'active' : 'inactive'})\n`);

  // Deactivate
  const d = await setActive(skuId, false);
  console.log(`1️⃣  deactivate: ${isErr(d.msg) ? '❌' : '✅'} ${toolText(d.msg).slice(0, 300).replace(/\n/g, ' ')}`);
  if (isErr(d.msg)) { console.log('\nPaste this output to Claude.'); return; }
  await sleep(2000);
  const mid = await liveRecord(skuId);
  const midActive = mid && (mid.active === '1' || mid.active === 1 || mid.active === true);
  console.log(`   active now: ${mid?.active} ${!midActive ? '✅ deactivated' : '⚠️  still active'}`);

  // Restore
  const r = await setActive(skuId, wasActive);
  console.log(`2️⃣  restore (${wasActive ? 'active' : 'inactive'}): ${isErr(r.msg) ? '❌' : '✅'} ${toolText(r.msg).slice(0, 300).replace(/\n/g, ' ')}`);
  await sleep(2000);
  const fin = await liveRecord(skuId);
  const finActive = fin && (fin.active === '1' || fin.active === 1 || fin.active === true);
  console.log(`   active now: ${fin?.active} ${finActive === wasActive ? '✅ restored' : '⚠️  check in AM UI'}`);

  if (!midActive && finActive === wasActive) {
    console.log('\n🎉 Deactivation FULLY WORKING — the "set to 0 + deactivate" one-tap is live once deployed.');
  }
  console.log('\n📋 Paste this output back to Claude.');
})();
