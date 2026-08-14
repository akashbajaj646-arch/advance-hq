#!/usr/bin/env node
/**
 * Adjustments probe v8 — speak MCP with the X-API-Key from your Claude config.
 *
 * Steps:
 *   1. Pull the am_… key from claude_desktop_config.json (or AM_MCP_KEY in .env.local)
 *   2. MCP handshake with X-API-Key header (the header your config actually uses)
 *   3. tools/list — print inventory/adjustment tools and their exact names
 *   4. tools/call the inventory-set tool with dry_run:true  (SAFE preview)
 *   5. If the dry run works: live round-trip — set test SKU to +1, verify via
 *      the legacy read API, set back, verify.
 *
 * Usage: node scripts/probe-adjustments-v8.js
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

const mask = s => !s ? '(empty)' : `${String(s).slice(0, 4)}…${String(s).slice(-4)} (${String(s).length} chars)`;

// ── Find the MCP key ──
function findMcpKey() {
  if (process.env.AM_MCP_KEY) return { key: process.env.AM_MCP_KEY, source: '.env.local AM_MCP_KEY' };
  const cfgPath = path.join(os.homedir(), 'Library/Application Support/Claude/claude_desktop_config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      for (const [name, s] of Object.entries(cfg.mcpServers || {})) {
        if (!/apparel/i.test(name) && !/apparel/i.test(JSON.stringify(s))) continue;
        for (const v of Object.values(s.env || {})) {
          if (typeof v === 'string' && /^am_/.test(v)) return { key: v, source: `claude_desktop_config.json (${name})` };
        }
        for (const a of (s.args || [])) {
          const m = String(a).match(/(am_[A-Za-z0-9_\-]{16,})/);
          if (m) return { key: m[1], source: `claude_desktop_config.json args (${name})` };
        }
      }
    } catch { /* ignore */ }
  }
  return null;
}

// ── Legacy read (for verification) ──
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

// ── Minimal MCP client (Streamable HTTP) ──
function parseMcpBody(text) {
  try { return JSON.parse(text); } catch {}
  // SSE: collect data: lines, return the last JSON-RPC message with a result/error
  const msgs = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^data:\s*(.+)$/);
    if (m) { try { msgs.push(JSON.parse(m[1])); } catch {} }
  }
  if (!msgs.length) return null;
  return msgs.find(x => x.result !== undefined || x.error !== undefined) || msgs[msgs.length - 1];
}

function makeMcpClient(url, key) {
  let sessionId = null;
  let reqId = 0;

  async function raw(payload, expectResponse = true) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'X-API-Key': key,
      'User-Agent': 'AdvanceHQ/1.0',
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    const text = await res.text();
    return { status: res.status, msg: expectResponse ? parseMcpBody(text) : null, text };
  }

  return {
    async initialize() {
      const r = await raw({
        jsonrpc: '2.0', id: ++reqId, method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'AdvanceHQ', version: '1.0' },
        },
      });
      if (r.status < 400 && r.msg?.result) {
        // Per spec, follow with initialized notification
        await raw({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);
      }
      return r;
    },
    async listTools() {
      return raw({ jsonrpc: '2.0', id: ++reqId, method: 'tools/list', params: {} });
    },
    async callTool(name, args) {
      return raw({ jsonrpc: '2.0', id: ++reqId, method: 'tools/call', params: { name, arguments: args } });
    },
    get sessionId() { return sessionId; },
  };
}

function extractToolResult(msg) {
  // tools/call result content is usually [{type:'text', text:'…json…'}]
  const content = msg?.result?.content;
  if (Array.isArray(content)) {
    const texts = content.filter(c => c.type === 'text').map(c => c.text);
    const joined = texts.join('\n');
    try { return { parsed: JSON.parse(joined), raw: joined }; } catch { return { parsed: null, raw: joined }; }
  }
  return { parsed: msg?.result ?? null, raw: JSON.stringify(msg?.result ?? msg?.error ?? null) };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('🔬 Adjustments probe v8 — MCP client with X-API-Key\n');

  const found = findMcpKey();
  if (!found) {
    console.log('❌ No am_… key found in claude_desktop_config.json or AM_MCP_KEY in .env.local.');
    return;
  }
  console.log(`Key: ${mask(found.key)} from ${found.source}`);
  console.log(`MCP: ${MCP_URL}\n`);

  const mcp = makeMcpClient(MCP_URL, found.key);

  // ── 2. Handshake ──
  console.log('1️⃣  initialize (X-API-Key header)');
  const init = await mcp.initialize();
  if (init.status >= 400 || !init.msg?.result) {
    console.log(`   ❌ HTTP ${init.status} · ${(init.msg ? JSON.stringify(init.msg) : init.text).slice(0, 300)}`);
    console.log('   The key that works in Claude Desktop was rejected here — paste this to Claude.');
    return;
  }
  console.log(`   ✅ HTTP ${init.status} · server: ${JSON.stringify(init.msg.result.serverInfo || {})} · session: ${mcp.sessionId || '(none)'}`);

  // ── 3. tools/list ──
  console.log('\n2️⃣  tools/list');
  const list = await mcp.listTools();
  const tools = list.msg?.result?.tools || [];
  if (!tools.length) {
    console.log(`   ❌ No tools returned · HTTP ${list.status} · ${(list.msg ? JSON.stringify(list.msg) : list.text).slice(0, 300)}`);
    return;
  }
  console.log(`   ✅ ${tools.length} tool(s) total. Inventory/adjustment/receiver tools:`);
  const interesting = tools.filter(t => /invent|adjust|receiv/i.test(t.name + ' ' + (t.description || '')));
  for (const t of interesting) {
    console.log(`   • ${t.name} — ${(t.description || '').slice(0, 100)}`);
  }

  // Find the absolute-set tool
  const setTool =
    tools.find(t => /inventory/i.test(t.name) && /(^|[^a-z])set([^a-z]|$)/i.test(t.name)) ||
    tools.find(t => /qty.*adjust.*set|set.*qty/i.test(t.name)) ||
    tools.find(t => /inventory/i.test(t.description || '') && /absolute|target_qty|set/i.test(JSON.stringify(t.inputSchema || {})));
  const adjustTool = tools.find(t => /inventory/i.test(t.name) && /adjust/i.test(t.name) && t !== setTool);

  if (!setTool && !adjustTool) {
    console.log('\n   ❌ Could not identify a set/adjust tool by name. Full tool list:');
    for (const t of tools) console.log(`      - ${t.name}`);
    return;
  }
  const tool = setTool || adjustTool;
  const isSet = !!setTool;
  console.log(`\n   → Using tool: ${tool.name} (${isSet ? 'absolute set' : 'delta adjust'})`);
  if (tool.inputSchema) console.log(`   inputSchema: ${JSON.stringify(tool.inputSchema).slice(0, 600)}`);

  // ── 4. Dry run ──
  const inv = await legacyGet('/inventory');
  const sampleSku = parseInt(inv.json?.response?.[0]?.sku_id || '4689');
  const before = await liveQty(sampleSku);
  console.log(`\n3️⃣  Dry run on sku_id=${sampleSku} (qty before: ${before})`);
  if (before === null) { console.log('   ❌ Cannot read live qty via legacy API'); return; }

  const dryArgs = isSet
    ? { items: [{ sku_id: sampleSku, target_qty: before + 1, warehouse_id: 1 }], reason: 'Advance HQ probe v8 dry run', dry_run: true }
    : { items: [{ sku_id: sampleSku, qty: 1, warehouse_id: 1 }], reason: 'Advance HQ probe v8 dry run', dry_run: true };

  const dry = await mcp.callTool(tool.name, dryArgs);
  const dryRes = extractToolResult(dry.msg);
  const dryErr = dry.msg?.error || dry.msg?.result?.isError;
  console.log(`   HTTP ${dry.status} ${dryErr ? '❌' : '✅'} · ${dryRes.raw.slice(0, 500)}`);
  if (dryErr) { console.log('\n   Dry run failed — paste this output to Claude.'); return; }

  // ── 5. Live round-trip ──
  console.log(`\n4️⃣  Live round-trip: → ${before + 1} → verify → ${before} → verify`);
  const upArgs = isSet
    ? { items: [{ sku_id: sampleSku, target_qty: before + 1, warehouse_id: 1 }], reason: 'Advance HQ probe v8 (+1)' }
    : { items: [{ sku_id: sampleSku, qty: 1, warehouse_id: 1 }], reason: 'Advance HQ probe v8 (+1)' };
  const up = await mcp.callTool(tool.name, upArgs);
  const upRes = extractToolResult(up.msg);
  console.log(`   +1: HTTP ${up.status} · ${upRes.raw.slice(0, 300)}`);
  await sleep(2500);
  const mid = await liveQty(sampleSku);
  console.log(`   qty now: ${mid} ${mid === before + 1 ? '✅ applied' : '⚠️  unexpected'}`);

  if (mid === before + 1) {
    const downArgs = isSet
      ? { items: [{ sku_id: sampleSku, target_qty: before, warehouse_id: 1 }], reason: 'Advance HQ probe v8 restore' }
      : { items: [{ sku_id: sampleSku, qty: -1, warehouse_id: 1 }], reason: 'Advance HQ probe v8 restore' };
    const down = await mcp.callTool(tool.name, downArgs);
    console.log(`   restore: HTTP ${down.status} · ${extractToolResult(down.msg).raw.slice(0, 300)}`);
    await sleep(2500);
    const fin = await liveQty(sampleSku);
    console.log(`   qty now: ${fin} ${fin === before ? '✅ restored' : '⚠️  check AM UI'}`);
    if (fin === before) {
      console.log(`\n🎉 FULLY WORKING via MCP. Tool: ${tool.name}`);
      console.log('   The installed route uses exactly this path. Final steps printed by the setup script.');
    }
  }

  console.log('\n📋 Paste this whole output back to Claude.');
})();
