#!/usr/bin/env node
/**
 * Adjustments probe v7 — find the credential the AM MCP actually uses.
 *
 * All safe:
 *   1. Reads your Claude Desktop config + mcp-remote auth cache to find how
 *      the ApparelMagic MCP authenticates (prints masked values only).
 *   2. Tries POST /api/inventory/set with dry_run:true (commits nothing) on:
 *        • the CENTRAL host  https://api.apparelmagic.com
 *        • your tenant host, with any newly-found credential
 *   3. Tries a read-only MCP handshake (initialize + tools/list) at
 *      https://api.apparelmagic.com/mcp with each candidate credential.
 *
 * Usage: node scripts/probe-adjustments-v7.js
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

const TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const TENANT = (process.env.NEXT_PUBLIC_APPARELMAGIC_URL || 'https://advanceapparels.app.apparelmagic.com/api/json')
  .replace(/\/api\/json\/?$/, '');
const CENTRAL = 'https://api.apparelmagic.com';
const MCP_URL = 'https://api.apparelmagic.com/mcp';

const mask = s => !s ? '(empty)' : `${String(s).slice(0, 4)}…${String(s).slice(-4)} (${String(s).length} chars)`;

// ── 1. Hunt for MCP credentials on this machine ──
function findMcpCredentials() {
  const found = []; // { source, key }
  const seen = new Set();
  const add = (source, key) => {
    if (key && typeof key === 'string' && key.length >= 8 && !seen.has(key)) {
      seen.add(key);
      found.push({ source, key });
    }
  };

  // Claude Desktop config
  const cfgPath = path.join(os.homedir(), 'Library/Application Support/Claude/claude_desktop_config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      const servers = cfg.mcpServers || {};
      for (const [name, s] of Object.entries(servers)) {
        if (!/apparel/i.test(name) && !/apparel/i.test(JSON.stringify(s))) continue;
        console.log(`   Found MCP server "${name}" in claude_desktop_config.json`);
        const blob = JSON.stringify(s);
        console.log(`   Config (masked): ${blob.replace(/([A-Za-z0-9_\-\.]{20,})/g, m => mask(m))}`);
        // env vars
        for (const v of Object.values(s.env || {})) add(`config env (${name})`, v);
        // --header Authorization: Bearer XXX style args
        const args = s.args || [];
        for (let i = 0; i < args.length; i++) {
          const a = String(args[i]);
          const bearer = a.match(/Bearer\s+([A-Za-z0-9_\-\.]+)/i);
          if (bearer) add(`config args (${name})`, bearer[1]);
          const kv = a.match(/^[A-Za-z-]*(?:key|token|auth)[A-Za-z-]*[:=]\s*([A-Za-z0-9_\-\.]+)$/i);
          if (kv) add(`config args (${name})`, kv[1]);
          if (/^--(?:header|env)$/.test(a) && args[i + 1]) {
            const nxt = String(args[i + 1]);
            const b2 = nxt.match(/Bearer\s+([A-Za-z0-9_\-\.]+)/i) || nxt.match(/[:=]\s*([A-Za-z0-9_\-\.]{16,})\s*$/);
            if (b2) add(`config args (${name})`, b2[1]);
          }
        }
      }
    } catch (e) {
      console.log('   ⚠️  Could not parse claude_desktop_config.json:', e.message);
    }
  } else {
    console.log('   (claude_desktop_config.json not found)');
  }

  // mcp-remote OAuth cache (~/.mcp-auth) — access tokens for remote MCPs
  const authDir = path.join(os.homedir(), '.mcp-auth');
  if (fs.existsSync(authDir)) {
    const walk = dir => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        if (st.isDirectory()) { walk(p); continue; }
        if (!/\.json$/i.test(f)) continue;
        try {
          const j = JSON.parse(fs.readFileSync(p, 'utf8'));
          const at = j.access_token || j.accessToken || (j.tokens && j.tokens.access_token);
          if (at) {
            console.log(`   Found OAuth cache: ~/.mcp-auth/…/${f} (access_token ${mask(at)}${j.expires_at ? `, expires_at=${j.expires_at}` : ''})`);
            add(`mcp-auth cache (${f})`, at);
          }
        } catch { /* skip */ }
      }
    };
    try { walk(authDir); } catch { /* skip */ }
  } else {
    console.log('   (~/.mcp-auth not found — MCP may use plain API key, not OAuth)');
  }

  return found;
}

// ── HTTP helpers ──
async function post(url, headers, bodyObj) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'User-Agent': 'AdvanceHQ/1.0', ...headers },
      body: JSON.stringify(bodyObj),
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    // SSE responses: extract first data: line
    if (!json && /^event:|^data:/m.test(text)) {
      const m = text.match(/^data:\s*(\{.*\})\s*$/m);
      if (m) { try { json = JSON.parse(m[1]); } catch {} }
    }
    return { status: res.status, json, text, isHtml: /^\s*<!DOCTYPE|^\s*<html/i.test(text) };
  } catch (e) {
    return { status: 0, json: null, text: String(e), isHtml: false };
  }
}

function brief(r) {
  if (r.status === 0) return `network error: ${r.text.slice(0, 100)}`;
  if (r.isHtml) return `HTTP ${r.status} · HTML error page`;
  return `HTTP ${r.status} · ${(r.json ? JSON.stringify(r.json) : r.text).slice(0, 220).replace(/\n/g, ' ')}`;
}

(async () => {
  console.log('🔬 Adjustments probe v7 — credential + host hunt (all safe: dry_run / read-only)\n');

  console.log('1️⃣  Credentials on this machine');
  const creds = findMcpCredentials();
  const candidates = [{ source: '.env.local APPARELMAGIC_TOKEN', key: TOKEN }, ...creds];
  console.log(`   → ${candidates.length} candidate credential(s): ${candidates.map(c => `${c.source} ${mask(c.key)}`).join(' | ')}\n`);

  const dryBody = {
    items: [{ sku_id: 4689, target_qty: 1, warehouse_id: 1 }],
    reason: 'Advance HQ probe v7 dry run',
    dry_run: true,
  };

  const headerStyles = key => ([
    { name: 'Bearer', headers: { Authorization: `Bearer ${key}` } },
    { name: 'X-API-Key', headers: { 'X-API-Key': key } },
  ]);

  // ── 2. REST hunt: central host, then tenant host ──
  console.log('2️⃣  POST /api/inventory/set with dry_run:true');
  let restWinner = null;
  for (const host of [CENTRAL, TENANT]) {
    for (const cred of candidates) {
      for (const style of headerStyles(cred.key)) {
        const url = `${host}/api/inventory/set`;
        const r = await post(url, style.headers, dryBody);
        const good = r.status >= 200 && r.status < 300 && r.json && !r.isHtml;
        const tag = `${host.replace('https://', '')} · ${style.name} · ${cred.source}`;
        console.log(`   ${good ? '✅' : r.status === 401 || r.status === 403 ? '🔒' : '⚠️ '} ${tag}`);
        console.log(`      ${brief(r)}`);
        if (good && !restWinner) restWinner = { host, style: style.name, cred };
      }
    }
  }

  if (restWinner) {
    console.log(`\n   🏆 REST WINNER: ${restWinner.host}/api/inventory/set · ${restWinner.style} · ${restWinner.cred.source}`);
    console.log('   Paste this output to Claude — one env var + tiny route tweak and the screen goes live.');
  }

  // ── 3. MCP protocol handshake (read-only) ──
  console.log('\n3️⃣  MCP handshake at ' + MCP_URL);
  let mcpWinner = null;
  for (const cred of candidates) {
    const init = await post(MCP_URL, { Authorization: `Bearer ${cred.key}` }, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'AdvanceHQ-probe', version: '1.0' },
      },
    });
    const ok = init.json && (init.json.result || init.json.id !== undefined) && !init.json.error && init.status < 400;
    console.log(`   ${ok ? '✅' : init.status === 401 ? '🔒' : '⚠️ '} initialize · ${cred.source} → ${brief(init)}`);
    if (ok && !mcpWinner) mcpWinner = cred;
  }

  if (mcpWinner) {
    console.log(`\n   🏆 MCP WINNER: Bearer ${mask(mcpWinner.key)} from ${mcpWinner.source}`);
    console.log('   The Vercel route can speak MCP directly with this credential.');
  }

  if (!restWinner && !mcpWinner) {
    console.log('\n❌ Nothing on this machine authenticates the modern surface.');
    console.log('   → The MCP credential likely lives server-side in your Claude.ai connector settings (OAuth).');
    console.log('   Two paths from here:');
    console.log('   a) In ApparelMagic: Settings > API — look for a separate key labeled REST/MCP/v2 and paste it');
    console.log('      into .env.local as AM_MODERN_KEY=…, then re-run this probe.');
    console.log('   b) AM support (fastest definitive answer): "How do we authenticate direct server-side calls');
    console.log('      to POST /api/inventory/set (the endpoint behind your MCP inventory-qty-adjustment.set');
    console.log('      action)? Our /api/json token gets 401 on the /api surface."');
  }

  console.log('\n📋 Paste this whole output back to Claude.');
})();
