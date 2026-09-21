'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Warehouse floor view
//
// Built for two contexts at once:
//  - a phone in a picker's pocket (big tap targets, stacked cards, huge bins)
//  - a shared desktop by the packing bench (same layout, more breathing room)
//
// Scanner-friendly: the search box keeps focus, and a keyboard-wedge barcode
// scanner (types the UPC + Enter) jumps straight to the variant it scanned.
// Read-only by design — nothing here writes anywhere.
// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'products' | 'picktickets';

export default function WarehousePage() {
  const [tab, setTab] = useState<Tab>('products');

  // Search state
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Product detail state
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string>('');
  const [highlightSku, setHighlightSku] = useState<string>('');
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Pick ticket state
  const [ptQuery, setPtQuery] = useState('');
  const [ptList, setPtList] = useState<any[]>([]);
  const [ptListLoading, setPtListLoading] = useState(false);
  const [ptDetail, setPtDetail] = useState<any | null>(null);
  const [ptDetailLoading, setPtDetailLoading] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, [tab]);

  // ── Product search ──
  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    setSearched(true);
    setDetail(null);
    setHighlightSku('');
    try {
      const res = await fetch(`/api/warehouse/search?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      setResults(data.products || []);
      if (data.direct_hit) {
        // Scanned barcode / exact SKU: jump straight to the variant
        openProduct(data.direct_hit.product_id, data.direct_hit.attr_2 || '', data.direct_hit.sku_id || '');
      }
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  async function openProduct(productId: string, color = '', skuId = '') {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await fetch(`/api/warehouse/product/${encodeURIComponent(productId)}`);
      const data = await res.json();
      if (data.product) {
        setDetail(data);
        const colors = [...new Set((data.skus || []).map((s: any) => s.attr_2).filter(Boolean))] as string[];
        setSelectedColor(color && colors.includes(color) ? color : (colors[0] || ''));
        setHighlightSku(skuId);
      }
    } finally {
      setDetailLoading(false);
    }
  }

  // ── Pick ticket search ──
  async function runPtSearch(q: string) {
    setPtListLoading(true);
    setPtDetail(null);
    try {
      const res = await fetch(`/api/warehouse/pick-tickets?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      setPtList(data.pick_tickets || []);
    } catch {
      setPtList([]);
    } finally {
      setPtListLoading(false);
    }
  }

  async function openPt(id: string) {
    setPtDetailLoading(true);
    try {
      const res = await fetch(`/api/warehouse/pick-tickets?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (data.pick_ticket) setPtDetail(data);
    } finally {
      setPtDetailLoading(false);
    }
  }

  // ── Derived product detail data ──
  const colors: string[] = detail
    ? ([...new Set((detail.skus || []).map((s: any) => s.attr_2).filter(Boolean))] as string[])
    : [];

  // AM is inconsistent about colorway labels: SKUs say "C1" while colorway
  // image records can say "C1 C1". Normalize and match loosely.
  const norm = (s: any) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const colorMatches = (imgColor: any, color: string) => {
    const a = norm(imgColor);
    const b = norm(color);
    if (!a || !b) return false;
    return a === b || a.startsWith(b + ' ') || b.startsWith(a + ' ') || a.split(' ').includes(b);
  };

  // First image per colorway, used as a swatch on the color chips so pickers
  // can tell colors apart even when AM names them "C1" / "C2"
  const colorThumb = (c: string): string | null => {
    const img = (detail?.colorway_images || []).find((i: any) => colorMatches(i.attr_2, c));
    return img?.image_url || null;
  };

  const colorImages: { url: string; label: string | null }[] = (() => {
    if (!detail) return [];
    const cw = (detail.colorway_images || []).filter((i: any) => colorMatches(i.attr_2, selectedColor));
    if (cw.length > 0) return cw.map((i: any) => ({ url: i.image_url, label: selectedColor }));
    // Any attributed colorway images at all? Show them with their own labels
    // so at least the corner badge says which color each photo belongs to.
    const anyCw = detail.colorway_images || [];
    if (anyCw.length > 0) return anyCw.map((i: any) => ({ url: i.image_url, label: i.attr_2 || null }));
    // Nothing attributed yet: unlabeled product images
    return (detail.images || []).map((i: any) => ({ url: i.image_url, label: null }));
  })();

  const colorSkus = detail
    ? (detail.skus || []).filter((s: any) => !selectedColor || s.attr_2 === selectedColor)
    : [];

  const warehouses: { id: string; name: string }[] = (() => {
    if (!detail) return [];
    const map = new Map<string, string>();
    (detail.warehouse_locations || []).forEach((w: any) => map.set(w.warehouse_id, w.warehouse_name || `Warehouse ${w.warehouse_id}`));
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  })();

  function binsFor(skuId: string) {
    return (detail?.warehouse_locations || []).filter((w: any) => w.sku_id === skuId);
  }

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Sticky header: tabs + search */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 pt-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">Warehouse</h1>
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setTab('products')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'products' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
              >
                Products
              </button>
              <button
                onClick={() => setTab('picktickets')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'picktickets' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
              >
                Pick Tickets
              </button>
            </div>
          </div>

          {tab === 'products' ? (
            <div className="pb-3 flex gap-2">
              <input
                ref={inputRef}
                type="text"
                inputMode="search"
                enterKeyHint="search"
                placeholder="Scan barcode or type style, SKU, UPC…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { runSearch(query); (e.target as HTMLInputElement).select(); } }}
                className="flex-1 h-14 px-4 text-lg border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
              />
              <button
                onClick={() => runSearch(query)}
                className="h-14 px-6 bg-brand-600 text-white rounded-xl font-semibold text-base active:scale-95 transition-transform"
              >
                Search
              </button>
            </div>
          ) : (
            <div className="pb-3 flex gap-2">
              <input
                type="text"
                inputMode="search"
                enterKeyHint="search"
                placeholder="Pick ticket #, order #, PO, or customer…"
                value={ptQuery}
                onChange={e => setPtQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') runPtSearch(ptQuery); }}
                className="flex-1 h-14 px-4 text-lg border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                autoComplete="off"
              />
              <button
                onClick={() => runPtSearch(ptQuery)}
                className="h-14 px-6 bg-brand-600 text-white rounded-xl font-semibold text-base active:scale-95 transition-transform"
              >
                Search
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 pt-4">
        {/* ══════════════ PRODUCTS TAB ══════════════ */}
        {tab === 'products' && (
          <>
            {detailLoading && (
              <div className="py-16 text-center text-gray-400 text-lg">Loading product…</div>
            )}

            {/* Product detail */}
            {detail && !detailLoading && (
              <div className="space-y-4">
                <button
                  onClick={() => { setDetail(null); setHighlightSku(''); inputRef.current?.focus(); }}
                  className="text-brand-600 font-medium py-2 -ml-1 px-1"
                >
                  &larr; Back to results
                </button>

                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h2 className="text-2xl font-bold text-gray-900">{detail.product.style_number}</h2>
                  <p className="text-gray-500 mt-0.5">{detail.product.description || ''}</p>
                  {detail.product.category && (
                    <span className="inline-block mt-2 px-2 py-0.5 bg-gray-100 rounded text-sm text-gray-600">{detail.product.category}</span>
                  )}
                </div>

                {/* Color selector */}
                {colors.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                    {colors.map(c => {
                      const thumb = colorThumb(c);
                      return (
                        <button
                          key={c}
                          onClick={() => setSelectedColor(c)}
                          className={`flex-shrink-0 flex items-center gap-2.5 rounded-xl text-base font-semibold border-2 transition-colors ${thumb ? 'pl-1.5 pr-4 py-1.5' : 'px-5 py-3'} ${
                            selectedColor === c
                              ? 'bg-brand-600 border-brand-600 text-white'
                              : 'bg-white border-gray-300 text-gray-700'
                          }`}
                        >
                          {thumb && (
                            <span className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                              <img src={thumb} alt={c} className="w-full h-full object-cover" loading="lazy" />
                            </span>
                          )}
                          {c}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Images for the selected color */}
                {colorImages.length > 0 ? (
                  <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                    {colorImages.map((img, i) => (
                      <button
                        key={i}
                        onClick={() => setLightbox(img.url)}
                        className="relative flex-shrink-0 w-36 h-36 sm:w-44 sm:h-44 rounded-xl overflow-hidden border border-gray-200 bg-white"
                      >
                        <img src={img.url} alt={`${detail.product.style_number} ${img.label || ''} ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                        {img.label && (
                          <span className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-md bg-black/70 text-white text-sm font-bold">
                            {img.label}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400">No images for this color yet</div>
                )}

                {/* Size / inventory / bins */}
                <div className="space-y-3">
                  {colorSkus.length === 0 && (
                    <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400">No SKUs for this color</div>
                  )}
                  {colorSkus.map((sku: any) => {
                    const bins = binsFor(sku.sku_id);
                    const isHighlighted = highlightSku === sku.sku_id;
                    return (
                      <div
                        key={sku.sku_id}
                        className={`bg-white rounded-xl border-2 p-4 ${isHighlighted ? 'border-brand-600 ring-2 ring-brand-100' : 'border-gray-200'}`}
                      >
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div>
                            <p className="text-xl font-bold text-gray-900">{sku.size || 'One Size'}</p>
                            <p className="text-xs text-gray-400 font-mono mt-0.5">{sku.sku_id}{sku.upc ? ` · UPC ${sku.upc}` : ''}</p>
                            {isHighlighted && <p className="text-xs font-semibold text-brand-600 mt-1">Scanned item</p>}
                            {sku.is_active === false && <p className="text-xs font-semibold text-red-500 mt-1">Inactive SKU</p>}
                          </div>
                          <div className="flex gap-5 text-right">
                            <div>
                              <p className="text-2xl font-bold text-gray-900">{sku.qty_inventory ?? 0}</p>
                              <p className="text-xs text-gray-400">On hand</p>
                            </div>
                            <div>
                              <p className={`text-2xl font-bold ${(sku.qty_avail_sell ?? 0) > 0 ? 'text-green-600' : 'text-red-500'}`}>{sku.qty_avail_sell ?? 0}</p>
                              <p className="text-xs text-gray-400">Available</p>
                            </div>
                          </div>
                        </div>

                        {/* Per-warehouse bins: the thing this whole view exists for */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                          {bins.length > 0 ? bins.map((b: any) => (
                            <div key={b.warehouse_id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3 border border-gray-100">
                              <div>
                                <p className="text-sm font-medium text-gray-700">{b.warehouse_name}</p>
                                <p className="text-xs text-gray-400">{b.qty ?? 0} units</p>
                              </div>
                              <p className="text-2xl font-bold font-mono tracking-wide text-gray-900">{b.bin_location || '—'}</p>
                            </div>
                          )) : (
                            <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3 border border-gray-100 sm:col-span-2">
                              <p className="text-sm text-gray-500">Bin</p>
                              <p className="text-2xl font-bold font-mono tracking-wide text-gray-900">{sku.bin_location || '—'}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Results list */}
            {!detail && !detailLoading && (
              <>
                {searching && <div className="py-16 text-center text-gray-400 text-lg">Searching…</div>}
                {!searching && searched && results.length === 0 && (
                  <div className="py-16 text-center">
                    <p className="text-gray-500 text-lg font-medium">Nothing matched that search</p>
                    <p className="text-gray-400 mt-1">Check the style number or try scanning the barcode again.</p>
                  </div>
                )}
                {!searching && !searched && (
                  <div className="py-20 text-center">
                    <p className="text-gray-500 text-lg font-medium">Scan a barcode or search a style</p>
                    <p className="text-gray-400 mt-1">Images, stock, and bin locations for both warehouses.</p>
                  </div>
                )}
                <div className="space-y-2">
                  {results.map(p => (
                    <button
                      key={p.product_id}
                      onClick={() => openProduct(p.product_id)}
                      className="w-full flex items-center gap-4 bg-white rounded-xl border border-gray-200 p-3 text-left active:bg-gray-50"
                    >
                      <div className="w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
                        {p.image_url
                          ? <img src={p.image_url} alt={p.style_number} className="w-full h-full object-cover" loading="lazy" />
                          : <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">No img</div>}
                      </div>
                      <div className="min-w-0">
                        <p className="text-lg font-bold text-gray-900">{p.style_number}</p>
                        <p className="text-sm text-gray-500 truncate">{p.description || ''}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ══════════════ PICK TICKETS TAB ══════════════ */}
        {tab === 'picktickets' && (
          <>
            {ptDetailLoading && <div className="py-16 text-center text-gray-400 text-lg">Loading pick ticket…</div>}

            {/* PT detail */}
            {ptDetail && !ptDetailLoading && (
              <div className="space-y-4">
                <button onClick={() => setPtDetail(null)} className="text-brand-600 font-medium py-2 -ml-1 px-1">
                  &larr; Back to pick tickets
                </button>

                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900">PT-{ptDetail.pick_ticket.pick_ticket_id}</h2>
                      <p className="text-gray-500">{ptDetail.pick_ticket.customer_name || 'Unknown customer'}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-lg text-sm font-semibold ${
                      ptDetail.pick_ticket.is_void ? 'bg-red-100 text-red-600'
                      : ptDetail.pick_ticket.wms_status === 'shipped' || ptDetail.pick_ticket.wms_status === 'completed' ? 'bg-green-100 text-green-700'
                      : ptDetail.pick_ticket.wms_status === 'picked' ? 'bg-blue-100 text-blue-700'
                      : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {ptDetail.pick_ticket.is_void ? 'VOID' : (ptDetail.pick_ticket.wms_status || 'pending')}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-sm text-gray-500">
                    {ptDetail.pick_ticket.apparel_magic_order_id && <span>Order #{ptDetail.pick_ticket.apparel_magic_order_id}</span>}
                    {ptDetail.pick_ticket.customer_po && <span>PO {ptDetail.pick_ticket.customer_po}</span>}
                    {ptDetail.pick_ticket.pick_ticket_date && <span>{fmtDate(ptDetail.pick_ticket.pick_ticket_date)}</span>}
                  </div>
                </div>

                <div className="space-y-2">
                  {(ptDetail.items || []).length === 0 && (
                    <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400">No line items on this pick ticket</div>
                  )}
                  {(ptDetail.items || []).map((item: any, idx: number) => {
                    const style = item.style_number || item.style || item._sku?.product_id || '';
                    const color = item.attr_2 || item.color || item._sku?.attr_2 || '';
                    const size = item.size || item._sku?.size || '';
                    const qty = item.qty ?? item.qty_ordered ?? item.quantity ?? item.qty_picked ?? 0;
                    return (
                      <div key={idx} className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-lg font-bold text-gray-900">{style} {color && <span className="font-semibold text-gray-600">· {color}</span>} {size && <span className="font-semibold text-gray-600">· {size}</span>}</p>
                            <p className="text-sm text-gray-500 truncate">{item.description || ''}</p>
                            {item.sku_id && <p className="text-xs text-gray-400 font-mono mt-0.5">{item.sku_id}{item._sku?.upc ? ` · UPC ${item._sku.upc}` : ''}</p>}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-2xl font-bold text-gray-900">{qty}</p>
                            <p className="text-xs text-gray-400">to pick</p>
                          </div>
                        </div>
                        {(item._bins || []).length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                            {item._bins.map((b: any) => (
                              <div key={b.warehouse_id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2.5 border border-gray-100">
                                <p className="text-sm text-gray-600">{b.warehouse_name}</p>
                                <p className="text-xl font-bold font-mono tracking-wide text-gray-900">{b.bin_location || '—'}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* PT list */}
            {!ptDetail && !ptDetailLoading && (
              <>
                {ptListLoading && <div className="py-16 text-center text-gray-400 text-lg">Searching…</div>}
                {!ptListLoading && ptList.length === 0 && (
                  <div className="py-20 text-center">
                    <p className="text-gray-500 text-lg font-medium">Look up a pick ticket</p>
                    <p className="text-gray-400 mt-1">Search by pick ticket number, order number, PO, or customer name.</p>
                  </div>
                )}
                <div className="space-y-2">
                  {ptList.map(pt => (
                    <button
                      key={pt.pick_ticket_id}
                      onClick={() => openPt(pt.pick_ticket_id)}
                      className="w-full flex items-center justify-between gap-3 bg-white rounded-xl border border-gray-200 p-4 text-left active:bg-gray-50"
                    >
                      <div className="min-w-0">
                        <p className="text-lg font-bold text-gray-900">PT-{pt.pick_ticket_id}</p>
                        <p className="text-sm text-gray-500 truncate">
                          {pt.customer_name || 'Unknown'}
                          {pt.apparel_magic_order_id ? ` · Order #${pt.apparel_magic_order_id}` : ''}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          pt.is_void ? 'bg-red-100 text-red-600'
                          : pt.wms_status === 'shipped' || pt.wms_status === 'completed' ? 'bg-green-100 text-green-700'
                          : pt.wms_status === 'picked' ? 'bg-blue-100 text-blue-700'
                          : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {pt.is_void ? 'VOID' : (pt.wms_status || 'pending')}
                        </span>
                        <p className="text-xs text-gray-400 mt-1">{fmtDate(pt.pick_ticket_date)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Image lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="Product" className="max-w-full max-h-full object-contain rounded-lg" />
          <button className="absolute top-4 right-4 text-white text-3xl leading-none w-12 h-12 rounded-full bg-white/10" aria-label="Close image">×</button>
        </div>
      )}
    </div>
  );
}
