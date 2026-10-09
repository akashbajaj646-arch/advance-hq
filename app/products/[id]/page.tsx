'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import ProductAttributes from '@/components/ProductAttributes';

type Store = 'b2b' | 'dtc';
type Policy = 'CONTINUE' | 'DENY';
type Cell = { status: 'found' | 'missing' | 'error'; policy?: Policy };
type Row = {
  sku_id: string;
  color: string;
  size: string;
  size_position: number;
  upc: string;
  bin: string;
  on_hand: number;
  available: number;
  active: boolean;
};
type Msg = { kind: 'ok' | 'err'; text: string } | null;
type StoreStatus = { ok: boolean; products: { id: string; title: string; status: string }[]; error?: string };
type ZeroLine = { sku_id: string; warehouse_id: string; qty: number | null; checked: boolean };

const WAREHOUSES = [{ id: '1', name: 'Leuning St' }, { id: '2', name: 'State St' }];
const whName = (id: string) => WAREHOUSES.find(w => w.id === id)?.name || `Warehouse ${id}`;

const isActive = (v: any) => v === true || v === 1 || v === '1' || v === 't' || v === 'true';
const num = (v: any) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

function Switch({ on, busy, onClick }: { on: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${on ? 'bg-green-500' : 'bg-gray-300'} ${busy ? 'opacity-50 cursor-wait' : ''}`}
      title={on ? 'Active in AM (click to deactivate)' : 'Inactive in AM (click to activate)'}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

export default function ProductDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [product, setProduct] = useState<any>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'skus' | 'images' | 'attributes' | 'details'>('skus');

  const [shop, setShop] = useState<Record<string, Partial<Record<Store, Cell>>>>({});
  const [shopLoading, setShopLoading] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [exporting, setExporting] = useState(false);

  const [pstatus, setPstatus] = useState<Partial<Record<Store, StoreStatus>>>({});
  const [pstatusLoading, setPstatusLoading] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const [zeroOpen, setZeroOpen] = useState(false);
  const [zeroLoading, setZeroLoading] = useState(false);
  const [zeroLines, setZeroLines] = useState<ZeroLine[]>([]);
  const [zeroReason, setZeroReason] = useState('Zeroed from product page');
  const [zeroDeactivate, setZeroDeactivate] = useState(false);
  const [zeroProgress, setZeroProgress] = useState('');
  const [zeroRunning, setZeroRunning] = useState(false);

  useEffect(() => { load(); }, [id]);

  async function load() {
    setLoading(true);
    let { data } = await db.from('products').select('*').eq('style_number', id).single();
    if (!data) { const r = await db.from('products').select('*').eq('product_id', id).single(); data = r.data; }
    if (!data) { setLoading(false); return; }
    setProduct(data);
    await loadSkus(data.product_id);
    const imgRes = await db.from('product_images').select('*').eq('product_id', data.product_id);
    setImages(imgRes.data || []);
    setLoading(false);
    loadShopify(data.product_id);
    loadProductStatus(data.product_id);
  }

  async function loadProductStatus(productId: string) {
    setPstatusLoading(true);
    try {
      const res = await fetch(`/api/products/shopify-status?product_id=${encodeURIComponent(productId)}`, { cache: 'no-store' });
      const j = await res.json();
      if (res.ok) setPstatus(j);
    } finally {
      setPstatusLoading(false);
    }
  }

  async function changeShopifyStatus(status: 'DRAFT' | 'ACTIVE') {
    if (!product) return;
    const verb = status === 'DRAFT' ? 'Set to Draft (hidden from both storefronts)' : 'Set to Active (visible on both storefronts)';
    if (!confirm(`${product.style_number}: ${verb}?`)) return;
    setStatusBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/products/shopify-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: product.product_id, status }),
      });
      const j = await res.json();
      if (j.stores) setPstatus(j.stores);
      if (!res.ok && res.status !== 207) setMsg({ kind: 'err', text: j.error || 'Status update failed' });
      else if (j.errors?.length) setMsg({ kind: 'err', text: `Partly failed. ${j.errors.join(' | ')}` });
      else setMsg({ kind: 'ok', text: `Set to ${status === 'DRAFT' ? 'Draft' : 'Active'} on both Shopify stores` });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || 'Status update failed' });
    } finally {
      setStatusBusy(false);
    }
  }

  async function openZero(skuIds: string[]) {
    if (!skuIds.length) return;
    setZeroOpen(true);
    setZeroLoading(true);
    setZeroProgress('');
    setZeroDeactivate(false);
    setZeroReason('Zeroed from product page');
    const fallback = () => skuIds.flatMap(s => WAREHOUSES.map(w => ({ sku_id: s, warehouse_id: w.id, qty: null, checked: true })));
    try {
      const res = await fetch('/api/products/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku_ids: skuIds }),
      });
      const j = await res.json();
      if (!res.ok) { setZeroLines(fallback()); return; }
      const lines: ZeroLine[] = [];
      for (const s of skuIds) {
        const st = j.stock?.[s];
        const ids = new Set<string>([...WAREHOUSES.map(w => w.id), ...((st?.rows || []).map((r: any) => String(r.warehouse_id)))]);
        for (const wh of Array.from(ids)) {
          const hit = (st?.rows || []).find((r: any) => String(r.warehouse_id) === wh);
          const qty = st?.ok ? (hit ? Number(hit.qty) : 0) : null;
          lines.push({ sku_id: s, warehouse_id: wh, qty, checked: qty === null || qty !== 0 });
        }
      }
      setZeroLines(lines);
    } catch {
      setZeroLines(fallback());
    } finally {
      setZeroLoading(false);
    }
  }

  async function runZero() {
    if (!product) return;
    const todo = zeroLines.filter(l => l.checked);
    if (!todo.length && !zeroDeactivate) { setZeroOpen(false); return; }
    setZeroRunning(true);
    const done = new Set<string>();
    const errs: string[] = [];
    for (let i = 0; i < todo.length; i++) {
      const l = todo[i];
      setZeroProgress(`Zeroing ${i + 1} of ${todo.length}...`);
      try {
        const res = await fetch('/api/adjustments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'submit', sku_id: l.sku_id, target_qty: 0, warehouse_id: l.warehouse_id, notes: zeroReason }),
        });
        const j = await res.json();
        if (res.ok && j.success) done.add(l.sku_id);
        else errs.push(`${l.sku_id} ${whName(l.warehouse_id)}: ${j.detail || j.error || 'failed'}`);
      } catch (e: any) {
        errs.push(`${l.sku_id} ${whName(l.warehouse_id)}: ${e.message || 'failed'}`);
      }
    }
    setZeroRunning(false);
    setZeroOpen(false);
    await loadSkus(product.product_id);
    const allSkus = Array.from(new Set(zeroLines.map(l => l.sku_id)));
    const failedSkus = new Set(errs.map(e => e.split(' ')[0]));
    if (zeroDeactivate) {
      const toDeactivate = allSkus.filter(s => !failedSkus.has(s) && rows.find(r => r.sku_id === s)?.active !== false);
      if (toDeactivate.length) await setActive(toDeactivate, false);
    }
    if (errs.length) setMsg({ kind: 'err', text: `Zeroed ${todo.length - errs.length} of ${todo.length}. ${errs.slice(0, 3).join(' | ')}` });
    else if (!zeroDeactivate) setMsg({ kind: 'ok', text: `Set to 0 in ApparelMagic: ${todo.length} location${todo.length === 1 ? '' : 's'}` });
  }

  // inventory is the complete per-SKU source of truth; product_skus fills UPC and bin
  async function loadSkus(productId: string) {
    const [invRes, skuRes] = await Promise.all([
      db.from('inventory').select('*').eq('product_id', productId),
      db.from('product_skus').select('*').eq('product_id', productId),
    ]);
    const extra: Record<string, any> = {};
    for (const s of skuRes.data || []) extra[String(s.sku_id)] = s;
    const base: any[] = (invRes.data && invRes.data.length) ? invRes.data : (skuRes.data || []);
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const r of base) {
      const sid = String(r.sku_id);
      if (seen.has(sid)) continue;
      seen.add(sid);
      const e = extra[sid] || {};
      out.push({
        sku_id: sid,
        color: r.attr_2 || e.attr_2_name || e.attr_2 || '',
        size: r.size || e.size || '',
        size_position: num(r.size_position),
        upc: e.upc || r.upc || '',
        bin: e.location || r.location || '',
        on_hand: num(r.qty_inventory ?? e.qty_inventory),
        available: num(r.qty_avail_sell ?? e.qty_avail_sell),
        active: isActive(r.active ?? e.is_active),
      });
    }
    out.sort((a, b) => a.color.localeCompare(b.color) || a.size_position - b.size_position || a.size.localeCompare(b.size));
    setRows(out);
  }

  async function loadShopify(productId: string) {
    setShopLoading(true);
    try {
      const res = await fetch(`/api/products/sku-controls?product_id=${encodeURIComponent(productId)}`, { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) { setMsg({ kind: 'err', text: j.error || 'Could not load Shopify status' }); return; }
      setShop(j.skus || {});
      const bad = Object.entries(j.stores || {}).filter(([, s]: any) => !s.ok).map(([k, s]: any) => `${k.toUpperCase()}: ${s.error}`);
      if (bad.length) setMsg({ kind: 'err', text: `Shopify lookup failed. ${bad.join(' | ')}` });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || 'Could not load Shopify status' });
    } finally {
      setShopLoading(false);
    }
  }

  function markBusy(keys: string[], on: boolean) {
    setBusy(prev => { const n = { ...prev }; keys.forEach(k => { if (on) n[k] = true; else delete n[k]; }); return n; });
  }

  // Merge server results ({ b2b: {sku_id: CellResult}, dtc: ... }) into cell state; returns error lines
  function applyResults(results: any): string[] {
    const errors: string[] = [];
    setShop(prev => {
      const next = { ...prev };
      for (const store of ['b2b', 'dtc'] as Store[]) {
        const r = results?.[store];
        if (!r) continue;
        for (const [sku, c] of Object.entries<any>(r)) {
          next[sku] = { ...(next[sku] || {}) };
          if (c.status === 'set' || c.status === 'unchanged') next[sku][store] = { status: 'found', policy: c.policy };
          else if (c.status === 'missing') next[sku][store] = { status: 'missing' };
        }
      }
      return next;
    });
    for (const store of ['b2b', 'dtc'] as Store[]) {
      for (const [sku, c] of Object.entries<any>(results?.[store] || {})) {
        if (!c.ok) errors.push(`${sku} ${store.toUpperCase()}: ${c.error || c.status}`);
      }
    }
    return errors;
  }

  async function setPolicy(store: Store, skuIds: string[], policy: Policy) {
    if (!skuIds.length) return;
    const keys = skuIds.map(s => `${s}|${store}`);
    markBusy(keys, true);
    setMsg(null);
    try {
      const res = await fetch('/api/products/sku-controls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'policy', store, sku_ids: skuIds, policy }),
      });
      const j = await res.json();
      if (!res.ok && res.status !== 207) { setMsg({ kind: 'err', text: j.error || 'Update failed' }); return; }
      const errs = applyResults(j.results);
      setMsg(errs.length
        ? { kind: 'err', text: `Some updates failed. ${errs.slice(0, 4).join(' | ')}` }
        : { kind: 'ok', text: `${store.toUpperCase()} continue selling ${policy === 'CONTINUE' ? 'on' : 'off'} for ${skuIds.length} SKU${skuIds.length > 1 ? 's' : ''}` });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || 'Update failed' });
    } finally {
      markBusy(keys, false);
    }
  }

  async function setActive(skuIds: string[], active: boolean) {
    if (!skuIds.length) return;
    const keys = skuIds.flatMap(s => [`${s}|active`, `${s}|b2b`, `${s}|dtc`]);
    markBusy(keys, true);
    setMsg(null);
    try {
      const res = await fetch('/api/warehouse/update-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku_ids: skuIds, active }),
      });
      const j = await res.json();
      if (!res.ok && res.status !== 207) { setMsg({ kind: 'err', text: j.error || 'AM update failed' }); return; }
      const updated: string[] = (j.updated || []).map(String);
      const failed: { sku_id: string; reason: string }[] = j.failed || [];
      setRows(prev => prev.map(r => updated.includes(r.sku_id) ? { ...r, active } : r));

      let shopErrs: string[] = [];
      if (updated.length) {
        const r2 = await fetch('/api/products/sku-controls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sync_active', sku_ids: updated, active }),
        });
        const j2 = await r2.json();
        shopErrs = (!r2.ok && r2.status !== 207) ? [j2.error || 'Shopify update failed'] : applyResults(j2.results);
      }
      const amErrs = failed.map(f => `${f.sku_id} AM: ${f.reason}`);
      const all = [...amErrs, ...shopErrs];
      setMsg(all.length
        ? { kind: 'err', text: `${updated.length} updated, issues: ${all.slice(0, 4).join(' | ')}` }
        : { kind: 'ok', text: `${updated.length} SKU${updated.length > 1 ? 's' : ''} ${active ? 'activated' : 'deactivated'} in AM and both stores` });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || 'Update failed' });
    } finally {
      markBusy(keys, false);
    }
  }

  async function runExport() {
    if (!product) return;
    setExporting(true);
    setMsg(null);
    try {
      const res = await fetch('/api/products/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: product.product_id }),
      });
      const j = await res.json();
      if (!res.ok) { setMsg({ kind: 'err', text: j.error || 'Export failed' }); return; }
      const part = (s: Store) => {
        const x = j.stores?.[s] || {};
        if (x.error) return `${s.toUpperCase()}: ${x.error}`;
        return `${s.toUpperCase()}: ${x.enforced || 0} fixed, ${x.missing || 0} not listed${x.failed ? `, ${x.failed} failed` : ''}`;
      };
      const amPart = j.am?.ok ? `AM: ${j.am.refreshed} SKUs refreshed` : `AM: ${j.am?.error || 'refresh incomplete'}`;
      setMsg({ kind: j.success ? 'ok' : 'err', text: `${amPart}. ${part('b2b')}. ${part('dtc')}.` });
      await loadSkus(product.product_id);
      await loadShopify(product.product_id);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || 'Export failed' });
    } finally {
      setExporting(false);
    }
  }

  function storeHeader(store: Store) {
    const eligible = rows.filter(r => shop[r.sku_id]?.[store]?.status === 'found');
    const allOn = eligible.length > 0 && eligible.every(r => shop[r.sku_id]?.[store]?.policy === 'CONTINUE');
    const anyBusy = eligible.some(r => busy[`${r.sku_id}|${store}`]);
    return (
      <th className="px-3 py-3 text-center font-medium text-gray-500">
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs leading-tight">Continue Selling<br />{store === 'b2b' ? 'B2B' : 'DTC'}</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-600"
            checked={allOn}
            disabled={!eligible.length || anyBusy || shopLoading}
            onChange={() => setPolicy(store, eligible.map(r => r.sku_id), allOn ? 'DENY' : 'CONTINUE')}
            title="Toggle all listed SKUs"
          />
        </div>
      </th>
    );
  }

  function storeCell(r: Row, store: Store) {
    const c = shop[r.sku_id]?.[store];
    const key = `${r.sku_id}|${store}`;
    if (busy[key]) return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-brand-600" />;
    if (shopLoading && !c) return <span className="text-gray-300 text-xs">...</span>;
    if (!c || c.status === 'missing') return <span className="text-gray-300 text-xs" title="Not listed on this store">n/a</span>;
    if (c.status === 'error') return <span className="text-red-400 text-xs" title="Lookup failed">err</span>;
    const on = c.policy === 'CONTINUE';
    return (
      <input
        type="checkbox"
        className="h-4 w-4 accent-brand-600 cursor-pointer"
        checked={on}
        onChange={() => setPolicy(store, [r.sku_id], on ? 'DENY' : 'CONTINUE')}
      />
    );
  }

  const fmt = (v: any) => { const n = parseFloat(v); return isNaN(n) ? '' : `$${n.toFixed(2)}`; };
  if (loading) return <div className="p-8"><div className="animate-pulse"><div className="h-6 bg-gray-200 rounded w-48 mb-4"></div><div className="h-48 bg-gray-200 rounded"></div></div></div>;
  if (!product) return <div className="p-8"><Link href="/products" className="text-sm text-brand-600 hover:underline mb-4 inline-block">&larr; Back to Products</Link><div className="card text-center py-12"><p className="text-gray-400 text-lg">Product not found</p></div></div>;

  const tabs = [{ key: 'skus' as const, label: 'SKUs', count: rows.length }, { key: 'images' as const, label: 'Images', count: images.length }, { key: 'attributes' as const, label: 'Attributes', count: 0 }, { key: 'details' as const, label: 'Details', count: 0 }];
  const allActive = rows.length > 0 && rows.every(r => r.active);
  const anyActiveBusy = rows.some(r => busy[`${r.sku_id}|active`]);

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6"><Link href="/products" className="hover:text-brand-600 transition-colors">Products</Link><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg><span className="text-gray-700 font-medium">{product.style_number}</span></div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <div className="flex gap-6">
          {images.length > 0 && images[0].image_url && <div className="w-32 h-32 flex-shrink-0 rounded-lg overflow-hidden border border-gray-200 bg-gray-50"><img src={images[0].image_url} alt={product.style_number} className="w-full h-full object-cover" /></div>}
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">{product.style_number}</h1>
            <p className="text-sm text-gray-500 mt-1">{product.description || 'No description'}</p>
            <div className="flex flex-wrap gap-4 mt-4 text-sm">
              {product.category && <span className="px-2 py-0.5 bg-gray-100 rounded text-gray-600">{product.category}</span>}
              {num(product.wholesale_price) > 0 && <span className="text-gray-600">Wholesale: {fmt(product.wholesale_price)}</span>}
              {num(product.retail_price) > 0 && <span className="text-gray-600">Retail: {fmt(product.retail_price)}</span>}
              {num(product.cost) > 0 && <span className="text-gray-600">Cost: {fmt(product.cost)}</span>}
              {product.vendor_name && <span className="text-gray-600">Vendor: {product.vendor_name}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <div className="flex gap-2">
              {(['b2b', 'dtc'] as Store[]).map(s => {
                const st = pstatus[s];
                const statuses = Array.from(new Set((st?.products || []).map(p => p.status)));
                const label = pstatusLoading && !st ? '...' : !st ? '...' : !st.ok ? 'error' : statuses.length ? statuses.map(x => x.charAt(0) + x.slice(1).toLowerCase()).join(' / ') : 'Not listed';
                const color = statuses.includes('ACTIVE') ? 'bg-green-50 text-green-700 border-green-200'
                  : statuses.includes('DRAFT') ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : st && !st.ok ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-50 text-gray-500 border-gray-200';
                return <span key={s} title={st?.error || ''} className={`px-2.5 py-1 rounded-full border text-xs font-medium ${color}`}>{s.toUpperCase()}: {label}</span>;
              })}
            </div>
            {(() => {
              const all = (['b2b', 'dtc'] as Store[]).flatMap(s => pstatus[s]?.products || []);
              if (!all.length) return null;
              const anyActive = all.some(p => p.status === 'ACTIVE');
              return (
                <button
                  onClick={() => changeShopifyStatus(anyActive ? 'DRAFT' : 'ACTIVE')}
                  disabled={statusBusy}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-wait ${anyActive ? 'border-amber-300 text-amber-700 hover:bg-amber-50' : 'border-green-300 text-green-700 hover:bg-green-50'}`}
                >
                  {statusBusy ? 'Updating...' : anyActive ? 'Set Draft on Shopify' : 'Set Active on Shopify'}
                </button>
              );
            })()}
          </div>
        </div>
      </div>

      <div className="flex items-end justify-between border-b border-gray-200 mb-6">
        <div className="flex gap-1">{tabs.map(t => (<button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{t.label}{t.count > 0 && ` (${t.count})`}</button>))}</div>
        {tab === 'skus' && (
          <button
            onClick={runExport}
            disabled={exporting}
            className="mb-2 px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-wait"
            title="Refresh from ApparelMagic, then reconcile both Shopify stores"
          >
            {exporting ? 'Syncing...' : 'Export to Shopify'}
          </button>
        )}
      </div>

      {msg && tab === 'skus' && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm flex justify-between items-start gap-4 ${msg.kind === 'ok' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="text-current opacity-60 hover:opacity-100">&times;</button>
        </div>
      )}

      {tab === 'skus' && rows.length > 0 && (() => {
        const totOnHand = rows.reduce((t, r) => t + r.on_hand, 0);
        const totAvail = rows.reduce((t, r) => t + r.available, 0);
        const activeCount = rows.filter(r => r.active).length;
        const tone = (n: number) => n > 0 ? 'text-green-600' : n < 0 ? 'text-red-500' : 'text-gray-900';
        return (
          <div className="mb-4 grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-3">
              <div className="text-xs text-gray-500">Total On Hand</div>
              <div className={`text-2xl font-bold ${tone(totOnHand)}`}>{totOnHand.toLocaleString()}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-3">
              <div className="text-xs text-gray-500">Total Available</div>
              <div className={`text-2xl font-bold ${tone(totAvail)}`}>{totAvail.toLocaleString()}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-3">
              <div className="text-xs text-gray-500">Active SKUs</div>
              <div className="text-2xl font-bold text-gray-900">{activeCount} <span className="text-sm font-normal text-gray-400">of {rows.length}</span></div>
            </div>
          </div>
        );
      })()}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        {tab === 'skus' && (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left font-medium text-gray-500">SKU</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Color</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Size</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">UPC</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Bin</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">
                  <div>On Hand</div>
                  {rows.some(r => r.on_hand !== 0) && (
                    <button onClick={() => openZero(rows.filter(r => r.on_hand !== 0).map(r => r.sku_id))} className="text-[11px] font-normal text-red-500 hover:underline">Zero all stock</button>
                  )}
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Available</th>
                <th className="px-3 py-3 text-center font-medium text-gray-500">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-xs">Active</span>
                    <Switch
                      on={allActive}
                      busy={anyActiveBusy || !rows.length}
                      onClick={() => {
                        const next = !allActive;
                        const targets = rows.filter(r => r.active !== next).map(r => r.sku_id);
                        if (targets.length && confirm(`${next ? 'Activate' : 'Deactivate'} ${targets.length} SKU${targets.length > 1 ? 's' : ''} in ApparelMagic and both Shopify stores?`)) setActive(targets, next);
                      }}
                    />
                  </div>
                </th>
                {storeHeader('b2b')}
                {storeHeader('dtc')}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">No SKUs</td></tr>
              ) : rows.map(r => (
                <tr key={r.sku_id} className={`border-b border-gray-100 ${r.active ? '' : 'bg-gray-50/70 text-gray-400'}`}>
                  <td className="px-4 py-2.5 font-mono text-xs">{r.sku_id}</td>
                  <td className="px-4 py-2.5">{r.color}</td>
                  <td className="px-4 py-2.5">{r.size}</td>
                  <td className="px-4 py-2.5">{r.upc}</td>
                  <td className="px-4 py-2.5">{r.bin}</td>
                  <td className="px-4 py-2.5 text-right group">
                    <span className="group-hover:hidden">{r.on_hand}</span>
                    <button onClick={() => openZero([r.sku_id])} className="hidden group-hover:inline text-xs text-red-500 hover:underline whitespace-nowrap" title="Set this SKU's inventory to 0 in ApparelMagic">{r.on_hand} &middot; Set to 0</button>
                  </td>
                  <td className={`px-4 py-2.5 text-right ${r.available > 0 ? 'text-green-600 font-medium' : r.available < 0 ? 'text-red-500' : ''}`}>{r.available}</td>
                  <td className="px-3 py-2.5 text-center"><Switch on={r.active} busy={busy[`${r.sku_id}|active`]} onClick={() => setActive([r.sku_id], !r.active)} /></td>
                  <td className="px-3 py-2.5 text-center">{storeCell(r, 'b2b')}</td>
                  <td className="px-3 py-2.5 text-center">{storeCell(r, 'dtc')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'images' && (<div className="p-6">{images.length === 0 ? <p className="text-gray-400 text-center py-8">No images</p> : <div className="grid grid-cols-4 gap-4">{images.map((img, i) => (<div key={i} className="aspect-square rounded-lg overflow-hidden border border-gray-200 bg-gray-50">{img.image_url ? <img src={img.image_url} alt={`${product.style_number} ${i + 1}`} className="w-full h-full object-cover" /> : <div className="flex items-center justify-center h-full text-gray-300 text-xs">No URL</div>}</div>))}</div>}</div>)}
        {tab === 'attributes' && <ProductAttributes productId={String(product.product_id)} />}
        {tab === 'details' && (<div className="p-6 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">{Object.entries(product).filter(([k]) => !['id', 'created_at', 'updated_at', 'am_last_modified_time'].includes(k)).map(([key, val]) => (<div key={key} className="flex justify-between py-1 border-b border-gray-50"><span className="text-xs text-gray-400">{key.replace(/_/g, ' ')}</span><span className="text-gray-700 text-right max-w-[60%] truncate">{String(val || '')}</span></div>))}</div>)}
      </div>

      {zeroOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !zeroRunning && setZeroOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900">Set to 0 in ApparelMagic</h3>
            <p className="text-xs text-gray-500 mt-0.5 mb-4">Uncheck any location you want to keep. Live quantities from AM.</p>
            {zeroLoading ? (
              <div className="py-8 text-center text-sm text-gray-400">Reading live stock...</div>
            ) : (
              <div className="max-h-72 overflow-y-auto space-y-3">
                {Array.from(new Set(zeroLines.map(l => l.sku_id))).map(s => {
                  const r = rows.find(x => x.sku_id === s);
                  return (
                    <div key={s}>
                      <div className="text-sm font-medium text-gray-700">{r?.color} {r?.size} <span className="font-mono text-xs text-gray-400">{s}</span></div>
                      <div className="mt-1 space-y-1">
                        {zeroLines.filter(l => l.sku_id === s).map(l => (
                          <label key={l.warehouse_id} className="flex items-center justify-between text-sm pl-2 cursor-pointer">
                            <span className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-brand-600"
                                checked={l.checked}
                                disabled={zeroRunning}
                                onChange={() => setZeroLines(prev => prev.map(x => x.sku_id === l.sku_id && x.warehouse_id === l.warehouse_id ? { ...x, checked: !x.checked } : x))}
                              />
                              {whName(l.warehouse_id)}
                            </span>
                            <span className={l.qty ? 'text-gray-900 font-medium' : 'text-gray-400'}>{l.qty === null ? '?' : l.qty} &rarr; 0</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <input
                value={zeroReason}
                onChange={e => setZeroReason(e.target.value)}
                disabled={zeroRunning}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                placeholder="Reason"
              />
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={zeroDeactivate} disabled={zeroRunning} onChange={() => setZeroDeactivate(v => !v)} />
                Also deactivate (AM + both Shopify stores)
              </label>
            </div>
            <div className="mt-5 flex items-center justify-between">
              <span className="text-xs text-gray-500">{zeroProgress}</span>
              <div className="flex gap-2">
                <button onClick={() => setZeroOpen(false)} disabled={zeroRunning} className="px-3 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
                <button
                  onClick={runZero}
                  disabled={zeroRunning || zeroLoading || (!zeroLines.some(l => l.checked) && !zeroDeactivate)}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {zeroRunning ? 'Working...' : `Zero ${zeroLines.filter(l => l.checked).length} location${zeroLines.filter(l => l.checked).length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
