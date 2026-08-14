#!/usr/bin/env node
/**
 * Adjustments probe v9 — drive execute_actions.
 *
 * The AM MCP is a meta-tool server: writes go through the execute_actions
 * tool. This probe:
 *   1. initialize (X-API-Key)
 *   2. dumps the VERBATIM inputSchema of execute_actions + search_actions
 *   3. calls search_actions for "inventory set" to learn the action id format
 *   4. tries argument shapes for execute_actions with dry_run:true (safe)
 *   5. on a working dry run: live +1 → verify → restore → verify
 *
 * Usage: node scripts/probe-adjustments-v9.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

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

if (!MCP_KEY) { console.error('❌ AM_MCP_KEY missing from .env.local'); process.exit(1); }

// ── Legacy read for verification ──
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

// ── MCP client ──
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

async function callTool(name, args) {
  return mcpRaw({ jsonrpc: '2.0', id: ++reqId, method: 'tools/call', params: { name, arguments: args } });
}

function toolText(msg) {
  const content = msg?.result?.content;
  if (Array.isArray(content)) return content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  return JSON.stringify(msg?.result ?? msg?.error ?? null);
}

function isToolError(msg) {
  return !!(msg?.error || msg?.result?.isError);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('🔬 Adjustments probe v9 — execute_actions\n');

  // ── 1. init ──
  const init = await mcpRaw({
    jsonrpc: '2.0', id: ++reqId, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'AdvanceHQ', version: '1.0' } },
  });
  if (init.status >= 400 || !init.msg?.result) {
    console.log(`❌ initialize failed: HTTP ${init.status} · ${(init.msg ? JSON.stringify(init.msg) : init.text).slice(0, 200)}`);
    return;
  }
  await mcpRaw({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);
  console.log('1️⃣  initialize ✅');

  // ── 2. schemas ──
  const list = await mcpRaw({ jsonrpc: '2.0', id: ++reqId, method: 'tools/list', params: {} });
  const tools = list.msg?.result?.tools || [];
  const exec = tools.find(t => t.name === 'execute_actions');
  const search = tools.find(t => t.name === 'search_actions');
  if (!exec) { console.log('❌ execute_actions not in tools/list'); return; }

  console.log('\n2️⃣  Tool schemas (VERBATIM)');
  console.log('   execute_actions.inputSchema:');
  console.log('   ' + JSON.stringify(exec.inputSchema || {}, null, 2).split('\n').join('\n   '));
  if (search) {
    console.log('   search_actions.inputSchema:');
    console.log('   ' + JSON.stringify(search.inputSchema || {}, null, 2).split('\n').join('\n   '));
  }

  // ── 3. search_actions to learn action id format ──
  console.log('\n3️⃣  search_actions("inventory set")');
  let actionIds = [];
  if (search) {
    const sProps = Object.keys(search.inputSchema?.properties || {});
    const qKey = sProps.find(k => /query|q|search|term/i.test(k)) || sProps[0] || 'query';
    const sr = await callTool('search_actions', { [qKey]: 'inventory set' });
    const raw = toolText(sr.msg);
    console.log(`   ${isToolError(sr.msg) ? '❌' : '✅'} HTTP ${sr.status} · first 1200 chars:`);
    console.log('   ' + raw.slice(0, 1200).split('\n').join('\n   '));
    // Harvest plausible action identifiers from the result
    const idPatterns = [
      /"(?:action_?id|id|name|action)"\s*:\s*"([^"]+)"/g,
      /\b([A-Za-z]+Controller\.[A-Za-z]+)\b/g,
      /\b([a-z][a-z-]+\.[a-z]+)\b/g,
    ];
    const seen = new Set();
    for (const re of idPatterns) {
      let m;
      while ((m = re.exec(raw)) !== null) {
        const v = m[1];
        if (/invent|adjust/i.test(v) && !seen.has(v)) { seen.add(v); actionIds.push(v); }
      }
    }
    console.log(`   → harvested action ids: ${actionIds.slice(0, 8).join(' | ') || '(none — will use guesses)'}`);
  }
  if (!actionIds.length) {
    actionIds = ['InventoryQtyAdjustmentController.set', 'inventory-qty-adjustment.set', 'inventory.set'];
  }
  // Prefer the .set variants
  actionIds.sort((a, b) => (/set/i.test(b) ? 1 : 0) - (/set/i.test(a) ? 1 : 0));

  // ── 4. dry-run shape hunt ──
  const inv = await legacyGet('/inventory');
  const skuId = parseInt(inv.json?.response?.[0]?.sku_id || '4689');
  const before = await liveQty(skuId);
  console.log(`\n4️⃣  Dry-run shape hunt (sku_id=${skuId}, qty before: ${before})`);
  if (before === null) { console.log('❌ Cannot read live qty'); return; }

  const setBody = dry => ({
    items: [{ sku_id: skuId, target_qty: before + 1, warehouse_id: 1 }],
    reason: 'Advance HQ probe v9',
    ...(dry ? { dry_run: true } : {}),
  });

  const execProps = Object.keys(exec.inputSchema?.properties || {});
  console.log(`   execute_actions top-level keys: ${execProps.join(', ') || '(schema opaque)'}`);

  function shapesFor(id, body) {
    const s = [];
    // Schema-guided first
    if (execProps.includes('actions')) {
      s.push({ label: 'actions:[{action,params}]', args: { actions: [{ action: id, params: body }] } });
      s.push({ label: 'actions:[{id,body}]', args: { actions: [{ id, body }] } });
      s.push({ label: 'actions:[{name,arguments}]', args: { actions: [{ name: id, arguments: body }] } });
      s.push({ label: 'actions:[{actionId,parameters}]', args: { actions: [{ actionId: id, parameters: body }] } });
    }
    if (execProps.includes('action')) {
      s.push({ label: '{action,params}', args: { action: id, params: body } });
      s.push({ label: '{action,body}', args: { action: id, body } });
    }
    if (execProps.includes('actionId')) s.push({ label: '{actionId,parameters}', args: { actionId: id, parameters: body } });
    if (execProps.includes('id')) s.push({ label: '{id,params}', args: { id, params: body } });
    // Generic fallbacks
    if (!s.length) {
      s.push({ label: 'fallback {action,params}', args: { action: id, params: body } });
      s.push({ label: 'fallback actions:[{action,params}]', args: { actions: [{ action: id, params: body }] } });
    }
    return s;
  }

  let winner = null;
  outer:
  for (const id of actionIds.slice(0, 4)) {
    for (const shape of shapesFor(id, setBody(true))) {
      const r = await callTool('execute_actions', shape.args);
      const raw = toolText(r.msg);
      const bad = isToolError(r.msg);
      console.log(`   ${bad ? '❌' : '✅'} [${id}] ${shape.label} → ${raw.slice(0, 220).replace(/\n/g, ' ')}`);
      if (!bad) { winner = { id, shape }; break outer; }
      await sleep(300);
    }
  }

  if (!winner) {
    console.log('\n❌ No shape accepted. The verbatim schemas + errors above tell Claude exactly what to fix — paste everything back.');
    return;
  }

  console.log(`\n   🏆 Working call: action="${winner.id}" shape=${winner.shape.label}`);

  // ── 5. live round-trip ──
  console.log(`\n5️⃣  Live round-trip: → ${before + 1} → verify → ${before} → verify`);
  const mk = (target, dry) => {
    const body = { items: [{ sku_id: skuId, target_qty: target, warehouse_id: 1 }], reason: 'Advance HQ probe v9 live', ...(dry ? { dry_run: true } : {}) };
    // Rebuild the winning shape with this body
    const j = JSON.stringify(winner.shape.args);
    const rebuilt = JSON.parse(j);
    const replace = obj => {
      for (const k of Object.keys(obj)) {
        if (obj[k] && typeof obj[k] === 'object') {
          if (obj[k].items) obj[k] = body;
          else replace(obj[k]);
        }
      }
    };
    replace(rebuilt);
    return rebuilt;
  };

  const up = await callTool('execute_actions', mk(before + 1, false));
  console.log(`   +1: ${isToolError(up.msg) ? '❌' : '✅'} ${toolText(up.msg).slice(0, 300).replace(/\n/g, ' ')}`);
  await sleep(2500);
  const mid = await liveQty(skuId);
  console.log(`   qty now: ${mid} ${mid === before + 1 ? '✅ applied' : '⚠️  unexpected'}`);

  if (mid === before + 1) {
    const down = await callTool('execute_actions', mk(before, false));
    console.log(`   restore: ${isToolError(down.msg) ? '❌' : '✅'} ${toolText(down.msg).slice(0, 300).replace(/\n/g, ' ')}`);
    await sleep(2500);
    const fin = await liveQty(skuId);
    console.log(`   qty now: ${fin} ${fin === before ? '✅ restored' : '⚠️  check AM UI'}`);
    if (fin === before) {
      console.log(`\n🎉 FULLY WORKING. action="${winner.id}" · shape=${winner.shape.label}`);
      console.log('   The installed route auto-discovers this same call — add AM_MCP_KEY in Vercel and deploy.');
    }
  }

  console.log('\n📋 Paste this whole output back to Claude.');
})();
