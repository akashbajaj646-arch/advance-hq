'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function BarChart({ data, xKey, yKey, label, color = '#e85d2c', height = 200 }: { data: any[]; xKey: string; yKey: string; label: string; color?: string; height?: number }) {
  if (!data.length) return <p className="text-gray-400 text-center py-8">No data</p>;
  const max = Math.max(...data.map(d => parseFloat(d[yKey]) || 0));
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((d, i) => {
          const val = parseFloat(d[yKey]) || 0;
          const pct = max > 0 ? (val / max) * 100 : 0;
          return (
            <div key={i} className="flex-1 flex flex-col items-center group relative">
              <div className="absolute -top-8 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                {yKey.includes('revenue') || yKey.includes('value') || yKey.includes('cost') || yKey.includes('owed') || yKey.includes('stock') ? `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : val.toLocaleString()}
              </div>
              <div className="w-full rounded-t transition-all duration-300 hover:opacity-80" style={{ height: `${pct}%`, backgroundColor: color, minHeight: pct > 0 ? '4px' : '0' }} />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 mt-2">
        {data.map((d, i) => <div key={i} className="flex-1 text-center text-xs text-gray-500 truncate">{d[xKey]}</div>)}
      </div>
      {label && <p className="text-xs text-gray-400 text-center mt-1">{label}</p>}
    </div>
  );
}

function Metric({ label, value, subtitle, color = 'text-gray-900' }: { label: string; value: string; subtitle?: string; color?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
    </div>
  );
}

function $(n: any, d = 0) { const v = parseFloat(n) || 0; return `$${v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`; }
function num(n: any) { return (parseFloat(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
function pct(n: number, t: number) { return t > 0 ? `${(n / t * 100).toFixed(1)}%` : '0%'; }

export default function ReportsPage() {
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [activeReport, setActiveReport] = useState<'sales' | 'product' | 'inventory' | 'customer'>('sales');
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear().toString());
  const [availableYears, setAvailableYears] = useState<string[]>([]);

  const [salesData, setSalesData] = useState<any>(null);
  const [productData, setProductData] = useState<any>(null);
  const [inventoryData, setInventoryData] = useState<any>(null);
  const [customerData, setCustomerData] = useState<any>(null);

  useEffect(() => { loadAvailableYears(); }, []);
  useEffect(() => { if (yearFilter) loadCurrentReport(); }, [yearFilter, activeReport]);

  async function loadAvailableYears() {
    const { data } = await supabase.from('invoices').select('invoice_date').not('invoice_date', 'is', null).order('invoice_date', { ascending: false }).limit(1);
    const { data: earliest } = await supabase.from('invoices').select('invoice_date').not('invoice_date', 'is', null).order('invoice_date', { ascending: true }).limit(1);
    if (data?.[0] && earliest?.[0]) {
      const ly = new Date(data[0].invoice_date).getFullYear();
      const ey = new Date(earliest[0].invoice_date).getFullYear();
      const years: string[] = [];
      for (let y = ly; y >= ey; y--) years.push(y.toString());
      setAvailableYears(years);
      setYearFilter(ly.toString());
    }
  }

  async function loadCurrentReport() {
    setLoading(true);
    const year = parseInt(yearFilter);
    if (activeReport === 'sales' && !salesData) {
      const { data } = await supabase.rpc('get_sales_report', { report_year: year });
      setSalesData(data);
    } else if (activeReport === 'sales') {
      const { data } = await supabase.rpc('get_sales_report', { report_year: year });
      setSalesData(data);
    }
    if (activeReport === 'product') {
      const { data } = await supabase.rpc('get_product_report', { report_year: year });
      setProductData(data);
    }
    if (activeReport === 'inventory') {
      const { data } = await supabase.rpc('get_inventory_ar_report');
      setInventoryData(data);
    }
    if (activeReport === 'customer') {
      const { data } = await supabase.rpc('get_customer_report', { report_year: year });
      setCustomerData(data);
    }
    setLoading(false);
  }

  // ── Sales parsing ──
  const monthly = salesData?.monthly || [];
  const prevMonthly = salesData?.prev_monthly || [];
  const topCustomers = salesData?.top_customers || [];
  const topProducts = salesData?.top_products || [];
  const byState = salesData?.by_state || [];
  const bySeason = salesData?.by_season || [];
  const totalRevenue = parseFloat(salesData?.totals?.total_revenue) || 0;
  const totalOrders = parseInt(salesData?.totals?.total_orders) || 0;
  const totalUnits = parseFloat(salesData?.totals?.total_units) || 0;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const prevYearRevenue = parseFloat(salesData?.prev_year_revenue) || 0;
  const yoyChange = prevYearRevenue > 0 ? ((totalRevenue - prevYearRevenue) / prevYearRevenue * 100) : 0;

  const monthlyFull = MONTHS.map((m, i) => {
    const f = monthly.find((r: any) => parseInt(r.month_num) === i + 1);
    return { month: m, revenue: parseFloat(f?.revenue) || 0, orders: parseInt(f?.orders) || 0, units: parseFloat(f?.units) || 0, avg_order: f ? (parseFloat(f.revenue) / parseInt(f.orders)) : 0 };
  });
  const prevMonthlyFull = MONTHS.map((m, i) => {
    const f = prevMonthly.find((r: any) => parseInt(r.month_num) === i + 1);
    return { month: m, revenue: parseFloat(f?.revenue) || 0, orders: parseInt(f?.orders) || 0 };
  });

  async function exportToExcel() {
    setExporting(true);
    try {
      const res = await fetch('/api/admin/export-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report: 'sales', year: yearFilter, monthlySales: monthlyFull, prevYearSales: prevMonthlyFull,
          topCustomers: topCustomers.map((c: any) => ({ name: c.customer_name, id: c.customer_id, revenue: parseFloat(c.revenue), orders: parseInt(c.orders), units: parseFloat(c.units), avg_order: parseInt(c.orders) > 0 ? parseFloat(c.revenue) / parseInt(c.orders) : 0 })),
          topProducts: topProducts.map((p: any) => ({ style: p.style_number, description: p.description, revenue: parseFloat(p.revenue), units: parseFloat(p.units) })),
          regionData: byState.map((r: any) => ({ state: r.state, revenue: parseFloat(r.revenue), orders: parseInt(r.orders) })),
          seasonData: bySeason.map((s: any) => ({ season: s.season, revenue: parseFloat(s.revenue), orders: parseInt(s.orders), units: parseFloat(s.units) })),
          totals: { totalRevenue, totalOrders, totalUnits, avgOrderValue, prevYearRevenue }
        })
      });
      if (res.ok) { const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `Sales_Report_${yearFilter}.xlsx`; a.click(); URL.revokeObjectURL(url); }
    } catch (err) { console.error('Export error:', err); }
    setExporting(false);
  }

  const REPORTS = [
    { key: 'sales', label: 'Sales & Revenue' },
    { key: 'product', label: 'Product Performance' },
    { key: 'inventory', label: 'Inventory & AR' },
    { key: 'customer', label: 'Customer Analytics' },
  ];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 mt-1">Business intelligence & analytics</p>
        </div>
        <div className="flex gap-3">
          <select value={yearFilter} onChange={e => { setYearFilter(e.target.value); setSalesData(null); setProductData(null); setCustomerData(null); }} className="px-4 py-2 border border-gray-300 rounded-lg outline-none bg-white text-sm">
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {activeReport === 'sales' && (
            <button onClick={exportToExcel} disabled={exporting || loading} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
              {exporting ? 'Exporting...' : 'Export Excel'}
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {REPORTS.map(r => (
          <button key={r.key} onClick={() => setActiveReport(r.key as any)} className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeReport === r.key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{r.label}</button>
        ))}
      </div>

      {loading ? <div className="text-center py-16 text-gray-500">Loading report data...</div> : (
        <>
          {/* ═══════════════ SALES & REVENUE ═══════════════ */}
          {activeReport === 'sales' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Metric label="Total Revenue" value={$(totalRevenue)} subtitle={yearFilter} />
                <Metric label="Total Invoices" value={num(totalOrders)} />
                <Metric label="Total Units" value={num(totalUnits)} />
                <Metric label="Avg Invoice Value" value={$(avgOrderValue)} />
                <Metric label={`YoY vs ${parseInt(yearFilter) - 1}`} value={`${yoyChange >= 0 ? '+' : ''}${yoyChange.toFixed(1)}%`} subtitle={`Prev: ${$(prevYearRevenue)}`} color={yoyChange >= 0 ? 'text-green-600' : 'text-red-600'} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Monthly Revenue — {yearFilter}</h3>
                  <BarChart data={monthlyFull} xKey="month" yKey="revenue" label="" />
                </div>
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Year-over-Year</h3>
                  <div className="flex items-center gap-4 text-sm mb-3">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ backgroundColor: '#e85d2c' }}></span>{yearFilter}</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-300"></span>{parseInt(yearFilter) - 1}</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-200">
                      <th className="text-left py-2 font-medium text-gray-500">Month</th>
                      <th className="text-right py-2 font-medium text-gray-500">{yearFilter}</th>
                      <th className="text-right py-2 font-medium text-gray-500">{parseInt(yearFilter) - 1}</th>
                      <th className="text-right py-2 font-medium text-gray-500">Change</th>
                    </tr></thead>
                    <tbody>
                      {monthlyFull.map((m, i) => {
                        const prev = prevMonthlyFull[i]?.revenue || 0;
                        const ch = prev > 0 ? ((m.revenue - prev) / prev * 100) : 0;
                        return (<tr key={m.month} className="border-b border-gray-100">
                          <td className="py-2 font-medium">{m.month}</td>
                          <td className="py-2 text-right">{$(m.revenue)}</td>
                          <td className="py-2 text-right text-gray-500">{$(prev)}</td>
                          <td className={`py-2 text-right font-medium ${ch >= 0 ? 'text-green-600' : 'text-red-600'}`}>{prev > 0 ? `${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%` : '-'}</td>
                        </tr>);
                      })}
                      <tr className="border-t-2 border-gray-300 font-bold">
                        <td className="py-2">Total</td>
                        <td className="py-2 text-right">{$(totalRevenue)}</td>
                        <td className="py-2 text-right text-gray-500">{$(prevYearRevenue)}</td>
                        <td className={`py-2 text-right ${yoyChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>{prevYearRevenue > 0 ? `${yoyChange >= 0 ? '+' : ''}${yoyChange.toFixed(1)}%` : '-'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card"><h3 className="font-semibold text-gray-900 mb-4">Monthly Invoices</h3><BarChart data={monthlyFull} xKey="month" yKey="orders" label="" color="#3b82f6" /></div>
                <div className="card"><h3 className="font-semibold text-gray-900 mb-4">Monthly Units</h3><BarChart data={monthlyFull} xKey="month" yKey="units" label="" color="#10b981" /></div>
              </div>

              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-4">Top 50 Customers — {yearFilter}</h3>
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium text-gray-500">#</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Customer</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">State</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Revenue</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Invoices</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Units</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Avg</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">%</th>
                  </tr></thead>
                  <tbody>{topCustomers.map((c: any, i: number) => {
                    const r = parseFloat(c.revenue) || 0; const o = parseInt(c.orders) || 0;
                    return (<tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">{c.customer_name}</td>
                      <td className="px-3 py-2 text-gray-500">{c.state || '-'}</td>
                      <td className="px-3 py-2 text-right">{$(r)}</td>
                      <td className="px-3 py-2 text-right">{o}</td>
                      <td className="px-3 py-2 text-right">{num(c.units)}</td>
                      <td className="px-3 py-2 text-right">{$(o > 0 ? r / o : 0)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{pct(r, totalRevenue)}</td>
                    </tr>);
                  })}</tbody>
                </table></div>
              </div>

              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-4">Top 50 Styles — {yearFilter}</h3>
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium text-gray-500">#</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Style</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Description</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Revenue</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Units</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">%</th>
                  </tr></thead>
                  <tbody>{topProducts.map((p: any, i: number) => {
                    const r = parseFloat(p.revenue) || 0;
                    return (<tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-brand-600">{p.style_number}</td>
                      <td className="px-3 py-2 text-gray-500 max-w-[250px] truncate">{p.description}</td>
                      <td className="px-3 py-2 text-right">{$(r)}</td>
                      <td className="px-3 py-2 text-right">{num(p.units)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{pct(r, totalRevenue)}</td>
                    </tr>);
                  })}</tbody>
                </table></div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Revenue by State</h3>
                  <BarChart data={byState.map((r: any) => ({ state: r.state, revenue: parseFloat(r.revenue) }))} xKey="state" yKey="revenue" label="" color="#8b5cf6" height={160} />
                  <div className="mt-4 overflow-y-auto max-h-[300px]"><table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-200"><th className="text-left py-1 font-medium text-gray-500">State</th><th className="text-right py-1 font-medium text-gray-500">Revenue</th><th className="text-right py-1 font-medium text-gray-500">Inv</th><th className="text-right py-1 font-medium text-gray-500">%</th></tr></thead>
                    <tbody>{byState.map((r: any) => (<tr key={r.state} className="border-b border-gray-100"><td className="py-1 font-medium">{r.state}</td><td className="py-1 text-right">{$(parseFloat(r.revenue))}</td><td className="py-1 text-right">{r.orders}</td><td className="py-1 text-right text-gray-500">{pct(parseFloat(r.revenue), totalRevenue)}</td></tr>))}</tbody>
                  </table></div>
                </div>
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Revenue by Season</h3>
                  <BarChart data={bySeason.map((s: any) => ({ season: s.season, revenue: parseFloat(s.revenue) }))} xKey="season" yKey="revenue" label="" color="#f59e0b" height={160} />
                  <div className="mt-4"><table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-200"><th className="text-left py-1 font-medium text-gray-500">Season</th><th className="text-right py-1 font-medium text-gray-500">Revenue</th><th className="text-right py-1 font-medium text-gray-500">Orders</th><th className="text-right py-1 font-medium text-gray-500">Units</th></tr></thead>
                    <tbody>{bySeason.map((s: any) => (<tr key={s.season} className="border-b border-gray-100"><td className="py-1 font-medium">{s.season}</td><td className="py-1 text-right">{$(parseFloat(s.revenue))}</td><td className="py-1 text-right">{s.orders}</td><td className="py-1 text-right">{num(s.units)}</td></tr>))}</tbody>
                  </table></div>
                </div>
              </div>

              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-4">Customer Concentration Risk</h3>
                <div className="grid grid-cols-3 gap-4">
                  {[1, 5, 10].map(n => {
                    const topRev = topCustomers.slice(0, n).reduce((s: number, c: any) => s + (parseFloat(c.revenue) || 0), 0);
                    const p = totalRevenue > 0 ? (topRev / totalRevenue * 100) : 0;
                    return (<div key={n} className="bg-gray-50 rounded-lg p-4 text-center">
                      <p className="text-sm text-gray-500">Top {n}</p>
                      <p className={`text-2xl font-bold mt-1 ${p > 50 ? 'text-red-600' : p > 30 ? 'text-yellow-600' : 'text-green-600'}`}>{p.toFixed(1)}%</p>
                      <p className="text-xs text-gray-400 mt-1">{$(topRev)}</p>
                    </div>);
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════ PRODUCT PERFORMANCE ═══════════════ */}
          {activeReport === 'product' && productData && (
            <div className="space-y-6">
              {/* Monthly product metrics */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Monthly Units Sold — {yearFilter}</h3>
                  <BarChart data={MONTHS.map((m, i) => { const f = (productData.monthly_product || []).find((r: any) => parseInt(r.month_num) === i + 1); return { month: m, units: parseFloat(f?.total_units) || 0 }; })} xKey="month" yKey="units" label="" color="#10b981" />
                </div>
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Unique Styles Sold per Month</h3>
                  <BarChart data={MONTHS.map((m, i) => { const f = (productData.monthly_product || []).find((r: any) => parseInt(r.month_num) === i + 1); return { month: m, styles: parseInt(f?.unique_styles) || 0 }; })} xKey="month" yKey="styles" label="" color="#6366f1" />
                </div>
              </div>

              {/* Top by revenue */}
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-4">Top 50 Styles by Revenue — {yearFilter}</h3>
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium text-gray-500">#</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Style</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Description</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Revenue</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Units</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Customers</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Invoices</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Avg Price</th>
                  </tr></thead>
                  <tbody>{(productData.top_by_revenue || []).map((p: any, i: number) => {
                    const r = parseFloat(p.revenue) || 0; const u = parseFloat(p.units_sold) || 0;
                    return (<tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-brand-600">{p.style_number}</td>
                      <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate">{p.description}</td>
                      <td className="px-3 py-2 text-right">{$(r)}</td>
                      <td className="px-3 py-2 text-right">{num(u)}</td>
                      <td className="px-3 py-2 text-right">{p.unique_customers}</td>
                      <td className="px-3 py-2 text-right">{p.invoice_count}</td>
                      <td className="px-3 py-2 text-right">{u > 0 ? $(r / u, 2) : '-'}</td>
                    </tr>);
                  })}</tbody>
                </table></div>
              </div>

              {/* Top by units */}
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-4">Top 50 Styles by Units Sold — {yearFilter}</h3>
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium text-gray-500">#</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Style</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Description</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Units</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Revenue</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Customers</th>
                  </tr></thead>
                  <tbody>{(productData.top_by_units || []).map((p: any, i: number) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-brand-600">{p.style_number}</td>
                      <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate">{p.description}</td>
                      <td className="px-3 py-2 text-right font-medium">{num(p.units_sold)}</td>
                      <td className="px-3 py-2 text-right">{$(parseFloat(p.revenue))}</td>
                      <td className="px-3 py-2 text-right">{p.unique_customers}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </div>

              {/* Margin analysis */}
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-4">Margin Analysis — {yearFilter}</h3>
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium text-gray-500">#</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Style</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Description</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Revenue</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Units</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Avg Sell</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Avg Cost</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Margin</th>
                  </tr></thead>
                  <tbody>{(productData.margin_analysis || []).map((p: any, i: number) => {
                    const sell = parseFloat(p.avg_sell_price) || 0; const cost = parseFloat(p.avg_cost) || 0;
                    const margin = sell > 0 ? ((sell - cost) / sell * 100) : 0;
                    return (<tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-brand-600">{p.style_number}</td>
                      <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate">{p.description}</td>
                      <td className="px-3 py-2 text-right">{$(parseFloat(p.revenue))}</td>
                      <td className="px-3 py-2 text-right">{num(p.units_sold)}</td>
                      <td className="px-3 py-2 text-right">{$(sell, 2)}</td>
                      <td className="px-3 py-2 text-right">{cost > 0 ? $(cost, 2) : '-'}</td>
                      <td className={`px-3 py-2 text-right font-medium ${margin > 40 ? 'text-green-600' : margin > 20 ? 'text-yellow-600' : margin > 0 ? 'text-red-600' : 'text-gray-400'}`}>{cost > 0 ? `${margin.toFixed(1)}%` : '-'}</td>
                    </tr>);
                  })}</tbody>
                </table></div>
              </div>

              {/* Slow movers */}
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-4">Slow Movers — In Stock, Low Sales in {yearFilter}</h3>
                <p className="text-sm text-gray-500 mb-4">Styles with 50+ units on hand and lowest sell-through this year</p>
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Style</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Description</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">On Hand</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Units Sold</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Revenue</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Sell-Through</th>
                  </tr></thead>
                  <tbody>{(productData.slow_movers || []).map((p: any, i: number) => {
                    const oh = parseFloat(p.on_hand) || 0; const sold = parseFloat(p.units_sold) || 0;
                    const sellThrough = oh > 0 ? (sold / (oh + sold) * 100) : 0;
                    return (<tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-brand-600">{p.style_number}</td>
                      <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate">{p.description}</td>
                      <td className="px-3 py-2 text-right font-medium">{num(oh)}</td>
                      <td className="px-3 py-2 text-right">{num(sold)}</td>
                      <td className="px-3 py-2 text-right">{$(parseFloat(p.revenue))}</td>
                      <td className={`px-3 py-2 text-right font-medium ${sellThrough < 10 ? 'text-red-600' : sellThrough < 30 ? 'text-yellow-600' : 'text-green-600'}`}>{sellThrough.toFixed(1)}%</td>
                    </tr>);
                  })}</tbody>
                </table></div>
              </div>
            </div>
          )}

          {/* ═══════════════ INVENTORY & AR ═══════════════ */}
          {activeReport === 'inventory' && inventoryData && (
            <div className="space-y-6">
              {/* Inventory KPIs */}
              {inventoryData.stock_summary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Metric label="Total On Hand" value={num(inventoryData.stock_summary.total_on_hand)} subtitle={`${num(inventoryData.stock_summary.in_stock_skus)} SKUs in stock`} />
                  <Metric label="Available to Sell" value={num(inventoryData.stock_summary.total_available)} />
                  <Metric label="Allocated" value={num(inventoryData.stock_summary.total_allocated)} />
                  <Metric label="Inventory Value" value={$(parseFloat(inventoryData.stock_summary.total_inventory_value))} subtitle="At cost" />
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Metric label="Open Sales Orders" value={num(inventoryData.stock_summary?.total_open_sales)} />
                <Metric label="Open Purchase Orders" value={num(inventoryData.stock_summary?.total_open_po)} />
                <Metric label="Zero Stock (Active)" value={num(inventoryData.stock_summary?.zero_stock_active)} subtitle="Active SKUs with 0 inventory" color="text-yellow-600" />
              </div>

              {/* AR Aging */}
              {inventoryData.ar_aging && (
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Accounts Receivable Aging</h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                    <div className="bg-green-50 rounded-lg p-4 text-center">
                      <p className="text-sm text-gray-500">0–30 days</p>
                      <p className="text-xl font-bold text-green-600">{$(parseFloat(inventoryData.ar_aging.aging_0_30))}</p>
                    </div>
                    <div className="bg-yellow-50 rounded-lg p-4 text-center">
                      <p className="text-sm text-gray-500">31–60 days</p>
                      <p className="text-xl font-bold text-yellow-600">{$(parseFloat(inventoryData.ar_aging.aging_31_60))}</p>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-4 text-center">
                      <p className="text-sm text-gray-500">61–90 days</p>
                      <p className="text-xl font-bold text-orange-600">{$(parseFloat(inventoryData.ar_aging.aging_61_90))}</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-4 text-center">
                      <p className="text-sm text-gray-500">90+ days</p>
                      <p className="text-xl font-bold text-red-600">{$(parseFloat(inventoryData.ar_aging.aging_over_90))}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4 text-center">
                      <p className="text-sm text-gray-500">Total Outstanding</p>
                      <p className="text-xl font-bold">{$(parseFloat(inventoryData.ar_aging.total_outstanding))}</p>
                      <p className="text-xs text-gray-400">{inventoryData.ar_aging.unpaid_count} invoices</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Top AR customers */}
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-4">Top Outstanding Balances</h3>
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium text-gray-500">#</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Customer</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Owed</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Invoices</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Oldest Due</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Latest Invoice</th>
                  </tr></thead>
                  <tbody>{(inventoryData.top_ar_customers || []).map((c: any, i: number) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">{c.customer_name}</td>
                      <td className="px-3 py-2 text-right font-medium text-red-600">{$(parseFloat(c.total_owed))}</td>
                      <td className="px-3 py-2 text-right">{c.invoice_count}</td>
                      <td className="px-3 py-2 text-gray-500">{c.oldest_due_date || '-'}</td>
                      <td className="px-3 py-2 text-gray-500">{c.latest_invoice || '-'}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </div>

              {/* Top stock value */}
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-4">Highest Inventory Value by Style</h3>
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Style</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Description</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">On Hand</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Avg Cost</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Stock Value</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Available</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Open Sales</th>
                  </tr></thead>
                  <tbody>{(inventoryData.top_stock_value || []).map((p: any, i: number) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-brand-600">{p.style_number}</td>
                      <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate">{p.description}</td>
                      <td className="px-3 py-2 text-right">{num(p.on_hand)}</td>
                      <td className="px-3 py-2 text-right">{$(parseFloat(p.avg_cost), 2)}</td>
                      <td className="px-3 py-2 text-right font-medium">{$(parseFloat(p.stock_value))}</td>
                      <td className="px-3 py-2 text-right">{num(p.available)}</td>
                      <td className="px-3 py-2 text-right">{num(p.open_sales)}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </div>

              {/* Overstock & Low stock */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-2">Overstock Alert</h3>
                  <p className="text-sm text-gray-500 mb-4">50+ on hand, zero open sales orders</p>
                  <div className="overflow-y-auto max-h-[400px]"><table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-3 py-2 font-medium text-gray-500">Style</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">On Hand</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">Value</th>
                    </tr></thead>
                    <tbody>{(inventoryData.overstock || []).map((p: any, i: number) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="px-3 py-2 font-medium">{p.style_number}</td>
                        <td className="px-3 py-2 text-right">{num(p.on_hand)}</td>
                        <td className="px-3 py-2 text-right text-red-600">{$(parseFloat(p.stock_value))}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                </div>
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-2">Low Stock / Oversold</h3>
                  <p className="text-sm text-gray-500 mb-4">Negative available-to-sell quantity</p>
                  <div className="overflow-y-auto max-h-[400px]"><table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-3 py-2 font-medium text-gray-500">Style</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">On Hand</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">Available</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">Open PO</th>
                    </tr></thead>
                    <tbody>{(inventoryData.low_stock || []).map((p: any, i: number) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="px-3 py-2 font-medium">{p.style_number}</td>
                        <td className="px-3 py-2 text-right">{num(p.on_hand)}</td>
                        <td className="px-3 py-2 text-right text-red-600 font-medium">{num(p.available)}</td>
                        <td className="px-3 py-2 text-right">{num(p.open_po)}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════ CUSTOMER ANALYTICS ═══════════════ */}
          {activeReport === 'customer' && customerData && (
            <div className="space-y-6">
              {/* Retention KPIs */}
              {customerData.retention && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Metric label={`Active Customers ${yearFilter}`} value={num(customerData.retention.current_year_total)} />
                  <Metric label={`Active Customers ${parseInt(yearFilter) - 1}`} value={num(customerData.retention.prev_year_total)} />
                  <Metric label="Retained" value={num(customerData.retention.retained)} subtitle={`${customerData.retention.prev_year_total > 0 ? ((customerData.retention.retained / customerData.retention.prev_year_total) * 100).toFixed(1) : 0}% retention rate`} color="text-green-600" />
                  <Metric label="Churned" value={num((customerData.retention.prev_year_total || 0) - (customerData.retention.retained || 0))} subtitle={`Lost from ${parseInt(yearFilter) - 1}`} color="text-red-600" />
                </div>
              )}

              {/* New customer growth */}
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-4">New Customer Acquisition</h3>
                <div className="flex items-center gap-4 text-sm mb-3">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ backgroundColor: '#e85d2c' }}></span>{yearFilter}</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-300"></span>{parseInt(yearFilter) - 1}</span>
                </div>
                <BarChart
                  data={MONTHS.map((m, i) => {
                    const curr = (customerData.new_customers || []).find((r: any) => parseInt(r.year) === parseInt(yearFilter) && parseInt(r.month_num) === i + 1);
                    return { month: m, new_count: parseInt(curr?.new_count) || 0 };
                  })}
                  xKey="month" yKey="new_count" label={`New customers by month — ${yearFilter}`} color="#e85d2c"
                />
              </div>

              {/* Purchase frequency */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Purchase Frequency — {yearFilter}</h3>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-3 py-2 font-medium text-gray-500">Bucket</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">Customers</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">Revenue</th>
                    </tr></thead>
                    <tbody>{(customerData.frequency || []).map((f: any) => (
                      <tr key={f.bucket} className="border-b border-gray-100">
                        <td className="px-3 py-2 font-medium">{f.bucket}</td>
                        <td className="px-3 py-2 text-right">{num(f.customer_count)}</td>
                        <td className="px-3 py-2 text-right">{$(parseFloat(f.total_revenue))}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className="card">
                  <h3 className="font-semibold text-gray-900 mb-4">Revenue by Customer Category — {yearFilter}</h3>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-3 py-2 font-medium text-gray-500">Category</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">Customers</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">Revenue</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-500">Invoices</th>
                    </tr></thead>
                    <tbody>{(customerData.by_category || []).map((c: any) => (
                      <tr key={c.category} className="border-b border-gray-100">
                        <td className="px-3 py-2 font-medium">{c.category}</td>
                        <td className="px-3 py-2 text-right">{c.customer_count}</td>
                        <td className="px-3 py-2 text-right">{$(parseFloat(c.revenue))}</td>
                        <td className="px-3 py-2 text-right">{c.invoice_count}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>

              {/* LTV Table */}
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-4">Customer Lifetime Value — Top 100</h3>
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium text-gray-500">#</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Customer</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">State</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Lifetime Rev</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">{yearFilter}</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">{parseInt(yearFilter) - 1}</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">YoY</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">Invoices</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">First</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Last</th>
                  </tr></thead>
                  <tbody>{(customerData.customer_ltv || []).map((c: any, i: number) => {
                    const curr = parseFloat(c.current_year_revenue) || 0; const prev = parseFloat(c.prev_year_revenue) || 0;
                    const ch = prev > 0 ? ((curr - prev) / prev * 100) : (curr > 0 ? 100 : 0);
                    return (<tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">{c.customer_name}</td>
                      <td className="px-3 py-2 text-gray-500">{c.state || '-'}</td>
                      <td className="px-3 py-2 text-right font-medium">{$(parseFloat(c.lifetime_revenue))}</td>
                      <td className="px-3 py-2 text-right">{curr > 0 ? $(curr) : '-'}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{prev > 0 ? $(prev) : '-'}</td>
                      <td className={`px-3 py-2 text-right text-xs font-medium ${ch > 0 ? 'text-green-600' : ch < 0 ? 'text-red-600' : 'text-gray-400'}`}>{prev > 0 || curr > 0 ? `${ch >= 0 ? '+' : ''}${ch.toFixed(0)}%` : '-'}</td>
                      <td className="px-3 py-2 text-right">{c.lifetime_invoices}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{c.first_invoice || '-'}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{c.last_invoice || '-'}</td>
                    </tr>);
                  })}</tbody>
                </table></div>
              </div>

              {/* Churned customers */}
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-4">Churned Customers — Bought in {parseInt(yearFilter) - 1}, Not in {yearFilter}</h3>
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium text-gray-500">#</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Customer</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">State</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-500">{parseInt(yearFilter) - 1} Revenue</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Last Invoice</th>
                  </tr></thead>
                  <tbody>{(customerData.churned || []).map((c: any, i: number) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">{c.customer_name}</td>
                      <td className="px-3 py-2 text-gray-500">{c.state || '-'}</td>
                      <td className="px-3 py-2 text-right text-red-600 font-medium">{$(parseFloat(c.prev_year_revenue))}</td>
                      <td className="px-3 py-2 text-gray-500">{c.last_invoice || '-'}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
