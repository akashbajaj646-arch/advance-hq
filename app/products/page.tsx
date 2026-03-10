'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { db } from '@/lib/db';

interface Product {
  [key: string]: any;
}

const PAGE_SIZE = 20;

// All available columns grouped by category
const COLUMN_GROUPS: Record<string, { label: string; columns: { key: string; label: string }[] }> = {
  core: {
    label: 'Core',
    columns: [
      { key: 'style_number', label: 'Style #' },
      { key: 'description', label: 'Description' },
      { key: 'category', label: 'Category' },
      { key: 'price', label: 'Price' },
      { key: 'content', label: 'Content' },
      { key: 'origin', label: 'Origin' },
      { key: 'collection', label: 'Collection' },
      { key: 'season', label: 'Season' },
      { key: 'group', label: 'Group' },
      { key: 'class', label: 'Class' },
      { key: 'alt_code', label: 'Alt Code' },
    ]
  },
  costing: {
    label: 'Costing',
    columns: [
      { key: 'cost', label: 'Cost' },
      { key: 'cost_base', label: 'Cost Base' },
      { key: 'cost_labor', label: 'Cost Labor' },
      { key: 'cost_materials', label: 'Cost Materials' },
      { key: 'cost_misc', label: 'Cost Misc' },
      { key: 'cost_landed', label: 'Cost Landed' },
      { key: 'cost_freight', label: 'Cost Freight' },
      { key: 'cost_duty', label: 'Cost Duty' },
      { key: 'duty_rate', label: 'Duty Rate' },
      { key: 'vendor_cost_base', label: 'Vendor Cost Base' },
      { key: 'retail_price', label: 'Retail Price' },
      { key: 'margin', label: 'Margin %' },
      { key: 'pct_markup', label: 'Markup %' },
    ]
  },
  physical: {
    label: 'Physical & Compliance',
    columns: [
      { key: 'weight', label: 'Weight' },
      { key: 'weight_unit', label: 'Weight Unit' },
      { key: 'box_size', label: 'Box Size' },
      { key: 'tariff_code', label: 'Tariff Code' },
      { key: 'mid_code', label: 'MID Code' },
      { key: 'care_instructions', label: 'Care Instructions' },
      { key: 'unit_of_measure', label: 'Unit of Measure' },
      { key: 'lead_time', label: 'Lead Time' },
      { key: 'sample_size', label: 'Sample Size' },
    ]
  },
  vendor: {
    label: 'Vendor',
    columns: [
      { key: 'vendor_id', label: 'Vendor ID' },
      { key: 'vendor_name', label: 'Vendor Name' },
      { key: 'price_break_name', label: 'Price Break' },
    ]
  },
  web: {
    label: 'Web / B2B',
    columns: [
      { key: 'web_title', label: 'Web Title' },
      { key: 'web_description', label: 'Web Description' },
      { key: 'b2b_web_title', label: 'B2B Title' },
      { key: 'b2b_web_description', label: 'B2B Description' },
    ]
  },
  notes: {
    label: 'Notes',
    columns: [
      { key: 'notes', label: 'Notes' },
      { key: 'production_notes', label: 'Production Notes' },
    ]
  },
  flags: {
    label: 'Flags',
    columns: [
      { key: 'is_product', label: 'Is Product' },
      { key: 'is_component', label: 'Is Component' },
      { key: 'is_bundle', label: 'Is Bundle' },
      { key: 'is_inventory_tracked', label: 'Inventory Tracked' },
      { key: 'is_taxable', label: 'Taxable' },
      { key: 'is_returnable', label: 'Returnable' },
    ]
  },
  audit: {
    label: 'Audit Trail',
    columns: [
      { key: 'am_creation_time', label: 'Created (AM)' },
      { key: 'am_creation_user_name', label: 'Created By' },
      { key: 'am_last_modified_time', label: 'Modified (AM)' },
      { key: 'am_last_modified_user_name', label: 'Modified By' },
      { key: 'last_synced_at', label: 'Last Synced' },
    ]
  },
};

const DEFAULT_COLUMNS = ['style_number', 'description', 'category', 'price', 'cost', 'margin', 'season', 'origin'];

const STORAGE_KEY = 'advancehq-products-columns';

function getStoredColumns(): string[] {
  if (typeof window === 'undefined') return DEFAULT_COLUMNS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return DEFAULT_COLUMNS;
}

function formatValue(key: string, value: any): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key.startsWith('is_')) return value ? 'Yes' : 'No';
  if (key === 'price' || key === 'cost' || key === 'retail_price' || key === 'cost_base' ||
      key === 'cost_labor' || key === 'cost_materials' || key === 'cost_misc' ||
      key === 'cost_landed' || key === 'cost_freight' || key === 'cost_duty' ||
      key === 'vendor_cost_base') {
    return `$${parseFloat(value).toFixed(2)}`;
  }
  if (key === 'margin' || key === 'pct_markup' || key === 'duty_rate') {
    return `${parseFloat(value).toFixed(2)}%`;
  }
  if (key.includes('time') || key.includes('synced_at')) {
    try {
      return new Date(value).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch { return value; }
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function getColumnLabel(key: string): string {
  for (const group of Object.values(COLUMN_GROUPS)) {
    const col = group.columns.find(c => c.key === key);
    if (col) return col.label;
  }
  return key;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const router = useRouter();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productImages, setProductImages] = useState<string[]>([]);
  const [productSkus, setProductSkus] = useState<any[]>([]);
  const [childData, setChildData] = useState<Record<string, any[]>>({});
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [detailTab, setDetailTab] = useState('overview');
  const searchParams = useSearchParams();
  const deepLinkHandled = useRef(false);

  useEffect(() => {
    setVisibleColumns(getStoredColumns());
    loadCategories();
  }, []);

  useEffect(() => {
    setPage(0);
  }, [search, categoryFilter]);

  useEffect(() => {
    loadProducts();
  }, [page, search, categoryFilter]);

  // Deep-link: read ?style= param and auto-open that product
  useEffect(() => {
    const styleParam = searchParams.get('style');
    if (styleParam && !deepLinkHandled.current) {
      deepLinkHandled.current = true;
      setSearch(styleParam);
      (async () => {
        const { data } = await db
          .from('products')
          .select('*')
          .eq('style_number', styleParam)
          .limit(1)
          .maybeSingle();
        if (data) {
          const { data: imgs } = await db
            .from('product_images')
            .select('product_id, image_url')
            .eq('product_id', data.product_id)
            .eq('sort_order', 0);
          const { data: skuStats } = await db
            .from('product_skus')
            .select('product_id, qty_avail_sell')
            .eq('product_id', data.product_id);
          const enriched = {
            ...data,
            _image_url: imgs?.[0]?.image_url || null,
            _sku_count: skuStats?.length || 0,
            _total_inventory: skuStats?.reduce((s, sk) => s + (sk.qty_avail_sell || 0), 0) || 0,
          };
          openProductDetail(enriched);
        }
      })();
    }
  }, [searchParams]);



  function saveColumns(cols: string[]) {
    setVisibleColumns(cols);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cols));
  }

  function toggleColumn(key: string) {
    const next = visibleColumns.includes(key)
      ? visibleColumns.filter(c => c !== key)
      : [...visibleColumns, key];
    saveColumns(next);
  }

  async function loadCategories() {
    const { data } = await db
      .from('products')
      .select('category')
      .not('category', 'is', null)
      .not('category', 'eq', '');

    if (data) {
      const unique = [...new Set(data.map(d => d.category).filter(Boolean))] as string[];
      unique.sort();
      setCategories(unique);
    }
  }

  async function loadProducts() {
    setLoading(true);

    let query = db
      .from('products')
      .select('*', { count: 'exact' });

    if (search) {
      query = query.or(`style_number.ilike.%${search}%,description.ilike.%${search}%,category.ilike.%${search}%,alt_code.ilike.%${search}%,collection.ilike.%${search}%,season.ilike.%${search}%`);
    }

    if (categoryFilter) {
      query = query.eq('category', categoryFilter);
    }

    const { data, count } = await query
      .order('style_number', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (data) {
      const productIds = data.map(p => p.product_id);

      // Fetch first image for each
      const { data: images } = await db
        .from('product_images')
        .select('product_id, image_url')
        .in('product_id', productIds)
        .eq('sort_order', 0);

      const imageMap: Record<string, string> = {};
      images?.forEach(img => { imageMap[img.product_id] = img.image_url; });

      // SKU counts + inventory
      const { data: skuStats } = await db
        .from('product_skus')
        .select('product_id, qty_avail_sell')
        .in('product_id', productIds);

      const skuCountMap: Record<string, number> = {};
      const inventoryMap: Record<string, number> = {};
      skuStats?.forEach(sku => {
        skuCountMap[sku.product_id] = (skuCountMap[sku.product_id] || 0) + 1;
        inventoryMap[sku.product_id] = (inventoryMap[sku.product_id] || 0) + (sku.qty_avail_sell || 0);
      });

      const enriched = data.map(p => ({
        ...p,
        _image_url: imageMap[p.product_id] || null,
        _sku_count: skuCountMap[p.product_id] || 0,
        _total_inventory: inventoryMap[p.product_id] || 0,
      }));

      setProducts(enriched);
      setTotalCount(count || 0);
    }

    setLoading(false);
  }

  async function openProductDetail(product: Product) {
    setSelectedProduct(product);
    setDetailTab('overview');

    // Images
    const { data: images } = await db
      .from('product_images')
      .select('image_url')
      .eq('product_id', product.product_id)
      .order('sort_order', { ascending: true });
    setProductImages(images?.map(i => i.image_url) || []);

    // SKUs
    const { data: skus } = await db
      .from('product_skus')
      .select('*')
      .eq('product_id', product.product_id)
      .order('attr_2', { ascending: true })
      .order('size', { ascending: true });
    setProductSkus(skus || []);

    // Child tables
    const childTables = [
      'product_price_groups',
      'product_specs',
      'product_bill_of_materials',
      'product_tags',
      'product_processes',
      'product_royalties',
    ];

    const results: Record<string, any[]> = {};
    for (const table of childTables) {
      const { data } = await db
        .from(table)
        .select('*')
        .eq('product_id', product.product_id);
      if (data && data.length > 0) {
        results[table] = data;
      }
    }
    setChildData(results);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Detail tab sections
  const DETAIL_SECTIONS: Record<string, { label: string; fields: string[] }> = {
    overview: {
      label: 'Overview',
      fields: ['style_number', 'alt_code', 'description', 'category', 'group', 'class', 'collection', 'season', 'division_id', 'vendor_name', 'price_break_name']
    },
    pricing: {
      label: 'Pricing & Costs',
      fields: ['price', 'retail_price', 'cost', 'cost_base', 'cost_labor', 'cost_materials', 'cost_misc', 'cost_landed', 'cost_freight', 'cost_duty', 'duty_rate', 'vendor_cost_base', 'margin', 'pct_markup', 'cost_auto']
    },
    physical: {
      label: 'Physical & Compliance',
      fields: ['weight', 'weight_unit', 'box_size', 'content', 'origin', 'tariff_code', 'mid_code', 'care_instructions', 'unit_of_measure', 'lead_time', 'sample_size', 'pattern_or_silhouette']
    },
    web: {
      label: 'Web / B2B',
      fields: ['web_title', 'web_description', 'b2b_web_title', 'b2b_web_description']
    },
    notes: {
      label: 'Notes',
      fields: ['notes', 'production_notes']
    },
    flags: {
      label: 'Flags',
      fields: ['is_product', 'is_component', 'is_bundle', 'is_virtual_bundle', 'is_gift_card', 'is_emblem', 'is_inventory_tracked', 'is_taxable', 'is_returnable', 'is_note_required', 'skus_active']
    },
    audit: {
      label: 'Audit',
      fields: ['am_creation_time', 'am_creation_user_name', 'am_last_modified_time', 'am_last_modified_user_name', 'am_last_modified_command', 'last_synced_at', 'created_at']
    },
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-gray-500 mt-1">{totalCount.toLocaleString()} products synced from ApparelMagic</p>
        </div>
        <button
          onClick={() => setShowColumnPicker(!showColumnPicker)}
          className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
          </svg>
          Columns ({visibleColumns.length})
        </button>
      </div>

      {/* Column Picker Dropdown */}
      {showColumnPicker && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Customize Table Columns</h3>
            <div className="flex gap-2">
              <button
                onClick={() => saveColumns(DEFAULT_COLUMNS)}
                className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-50"
              >
                Reset to Default
              </button>
              <button
                onClick={() => setShowColumnPicker(false)}
                className="text-xs px-3 py-1 bg-brand-600 text-white rounded hover:bg-brand-700"
              >
                Done
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(COLUMN_GROUPS).map(([groupKey, group]) => (
              <div key={groupKey}>
                <p className="text-xs font-medium text-gray-400 uppercase mb-2">{group.label}</p>
                <div className="space-y-1">
                  {group.columns.map(col => (
                    <label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(col.key)}
                        onChange={() => toggleColumn(col.key)}
                        className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                      {col.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="card mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search by style, description, category, collection, season..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            />
          </div>
          <div className="w-full md:w-64">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none bg-white"
            >
              <option value="">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Products Table */}
      <div className="card">
        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : products.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No products found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="table-header pb-3 w-14"></th>
                    {visibleColumns.map(col => (
                      <th key={col} className="table-header pb-3 whitespace-nowrap">
                        {getColumnLabel(col)}
                      </th>
                    ))}
                    <th className="table-header pb-3 text-right">SKUs</th>
                    <th className="table-header pb-3 text-right">Inventory</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr
                      key={product.product_id}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => router.push(`/products/${product.style_number}`)}
                    >
                      <td className="table-cell">
                        {product._image_url ? (
                          <img src={product._image_url} alt={product.style_number} className="w-10 h-10 object-cover rounded" />
                        ) : (
                          <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center">
                            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5" />
                            </svg>
                          </div>
                        )}
                      </td>
                      {visibleColumns.map(col => (
                        <td key={col} className="table-cell text-sm max-w-[200px] truncate">
                          {col === 'style_number' ? (
                            <span className="font-medium text-brand-600">{product[col]}</span>
                          ) : col === 'category' && product[col] ? (
                            <span className="badge badge-gray">{product[col]}</span>
                          ) : (
                            formatValue(col, product[col])
                          )}
                        </td>
                      ))}
                      <td className="table-cell text-right text-sm">{product._sku_count}</td>
                      <td className="table-cell text-right text-sm">
                        <span className={product._total_inventory > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}>
                          {product._total_inventory?.toLocaleString() || 0}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-500">
                Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                  Previous
                </button>
                <span className="px-3 py-1 text-sm text-gray-500">Page {page + 1} of {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════ */}
      {/* PRODUCT DETAIL MODAL                              */}
      {/* ══════════════════════════════════════════════════ */}
      {selectedProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{selectedProduct.style_number}</h2>
                  <p className="text-gray-500">{selectedProduct.description || 'No description'}</p>
                  {selectedProduct.alt_code && (
                    <p className="text-xs text-gray-400 mt-1">Alt: {selectedProduct.alt_code}</p>
                  )}
                </div>
                <button onClick={() => setSelectedProduct(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
              </div>

              {/* Images strip */}
              {productImages.length > 0 && (
                <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
                  {productImages.map((url, i) => (
                    <img key={i} src={url} alt={`${i + 1}`}
                      className="w-20 h-20 object-cover rounded-lg border border-gray-200 flex-shrink-0" />
                  ))}
                </div>
              )}

              {/* Tabs */}
              <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
                {Object.entries(DETAIL_SECTIONS).map(([key, section]) => (
                  <button
                    key={key}
                    onClick={() => setDetailTab(key)}
                    className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                      detailTab === key
                        ? 'border-brand-600 text-brand-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {section.label}
                  </button>
                ))}
                <button
                  onClick={() => setDetailTab('skus')}
                  className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    detailTab === 'skus' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  SKUs ({productSkus.length})
                </button>
                {Object.keys(childData).length > 0 && (
                  <button
                    onClick={() => setDetailTab('related')}
                    className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                      detailTab === 'related' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Related Data
                  </button>
                )}
              </div>

              {/* Tab Content */}
              {detailTab !== 'skus' && detailTab !== 'related' && DETAIL_SECTIONS[detailTab] && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {DETAIL_SECTIONS[detailTab].fields.map(field => {
                    const value = selectedProduct[field];
                    const hasValue = value !== null && value !== undefined && value !== '' && value !== '0' && value !== '0.0000' && value !== '0.00';
                    return (
                      <div key={field} className={`rounded-lg p-3 ${hasValue ? 'bg-gray-50' : 'bg-gray-50/50'}`}>
                        <p className="text-xs text-gray-400 mb-1">{getColumnLabel(field) || field.replace(/_/g, ' ')}</p>
                        <p className={`text-sm font-medium ${hasValue ? 'text-gray-900' : 'text-gray-300'}`}>
                          {formatValue(field, value)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* SKUs Tab */}
              {detailTab === 'skus' && (
                <div className="overflow-x-auto">
                  {productSkus.length === 0 ? (
                    <p className="text-gray-400 text-center py-8">No SKUs found</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="px-3 py-2 text-left font-medium text-gray-500">SKU ID</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-500">Color</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-500">Size</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-500">Price</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-500">Cost</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-500">Avail</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-500">On Hand</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-500">Alloc</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-500">Open PO</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-500">Open Sales</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-500">UPC</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-500">Location</th>
                          <th className="px-3 py-2 text-center font-medium text-gray-500">Active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productSkus.map((sku, i) => (
                          <tr key={sku.sku_id || i} className="border-b border-gray-100">
                            <td className="px-3 py-2 text-gray-400 font-mono text-xs">{sku.sku_id}</td>
                            <td className="px-3 py-2">{sku.attr_2_name || sku.attr_2 || '-'}</td>
                            <td className="px-3 py-2">{sku.size || '-'}</td>
                            <td className="px-3 py-2 text-right">${(sku.price || 0).toFixed(2)}</td>
                            <td className="px-3 py-2 text-right">${(sku.cost || 0).toFixed(2)}</td>
                            <td className="px-3 py-2 text-right">
                              <span className={sku.qty_avail_sell > 0 ? 'text-green-600 font-medium' : sku.qty_avail_sell < 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>
                                {sku.qty_avail_sell || 0}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">{sku.qty_inventory || 0}</td>
                            <td className="px-3 py-2 text-right">{sku.qty_alloc || 0}</td>
                            <td className="px-3 py-2 text-right">{sku.qty_open_po || 0}</td>
                            <td className="px-3 py-2 text-right">{sku.qty_open_sales || 0}</td>
                            <td className="px-3 py-2 text-xs">{sku.upc || '-'}</td>
                            <td className="px-3 py-2 text-xs">{sku.location || '-'}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`inline-block w-2 h-2 rounded-full ${sku.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Related Data Tab (child tables) */}
              {detailTab === 'related' && (
                <div className="space-y-6">
                  {Object.entries(childData).map(([tableName, rows]) => {
                    const displayName = tableName.replace('product_', '').replace(/_/g, ' ');
                    return (
                      <div key={tableName}>
                        <h3 className="text-sm font-semibold text-gray-700 capitalize mb-2">
                          {displayName} ({rows.length})
                        </h3>
                        <div className="overflow-x-auto border border-gray-200 rounded-lg">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50">
                                {Object.keys(rows[0]).filter(k => !['id', 'product_id', 'created_at'].includes(k)).map(key => (
                                  <th key={key} className="px-3 py-2 text-left font-medium text-gray-500 capitalize">
                                    {key.replace(/_/g, ' ')}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((row, ri) => (
                                <tr key={ri} className="border-t border-gray-100">
                                  {Object.entries(row).filter(([k]) => !['id', 'product_id', 'created_at'].includes(k)).map(([k, v], ci) => (
                                    <td key={ci} className="px-3 py-2">
                                      {v === null ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                  {Object.keys(childData).length === 0 && (
                    <p className="text-gray-400 text-center py-8">No related data for this product</p>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
