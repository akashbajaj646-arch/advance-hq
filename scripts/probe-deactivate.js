#!/usr/bin/env node
/**
 * Deactivation probe — READ-ONLY.
 * Finds the MCP action + schema for deactivating a SKU/product, so the
 * "set to 0 and deactivate" one-tap can be wired next.
 *
 * Usage: node scripts/probe-deactivate.js
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

const MCP_URL = process.env.AM_MCP_URL || 'https://api.apparelmagic.com/mcp';
const MCP_KEY = process.env.AM_MCP_KEY || '';
if (!MCP_KEY) { console.error('❌ AM_MCP_KEY missing'); process.exit(1); }

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

(async () => {
  console.log('🔍 Deactivation probe (read-only)\n');

  const init = await mcpRaw({
    jsonrpc: '2.0', id: ++reqId, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'AdvanceHQ', version: '1.0' } },
  });
  if (init.status >= 400 || !init.msg?.result) { console.log('❌ initialize failed'); return; }
  await mcpRaw({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);

  for (const query of ['deactivate sku', 'update sku active', 'update product']) {
    console.log(`search_actions("${query}", write, includeSchema):`);
    const r = await mcpRaw({
      jsonrpc: '2.0', id: ++reqId, method: 'tools/call',
      params: { name: 'search_actions', arguments: { query, type: 'write', limit: 5, includeSchema: true } },
    });
    console.log(toolText(r.msg).slice(0, 2500));
    console.log('────────────────────────────\n');
  }

  console.log('✅ Done. Paste this output to Claude to wire the "set to 0 + deactivate" one-tap.');
})();
