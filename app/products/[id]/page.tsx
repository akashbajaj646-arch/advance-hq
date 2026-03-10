'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';

export default function ProductDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [product, setProduct] = useState<any>(null);
  const [skus, setSkus] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'skus' | 'images' | 'details'>('skus');

  useEffect(() => { load(); }, [id]);
  async function load() {
    setLoading(true);
    let { data } = await db.from('products').select('*').eq('style_number', id).single();
    if (!data) { const r = await db.from('products').select('*').eq('product_id', id).single(); data = r.data; }
    if (!data) { setLoading(false); return; }
    setProduct(data);
    const [skuRes, imgRes] = await Promise.all([
      db.from('product_skus').select('*').eq('product_id', data.product_id).order('sku_id'),
      db.from('product_images').select('*').eq('product_id', data.product_id),
    ]);
    setSkus(skuRes.data || []); setImages(imgRes.data || []);
    setLoading(false);
  }
  const fmt = (v: any) => { const n = parseFloat(v); return isNaN(n) ? '' : `$${n.toFixed(2)}`; };
  if (loading) return <div className="p-8"><div className="animate-pulse"><div className="h-6 bg-gray-200 rounded w-48 mb-4"></div><div className="h-48 bg-gray-200 rounded"></div></div></div>;
  if (!product) return <div className="p-8"><Link href="/products" className="text-sm text-brand-600 hover:underline mb-4 inline-block">&larr; Back to Products</Link><div className="card text-center py-12"><p className="text-gray-400 text-lg">Product not found</p></div></div>;
  const tabs = [{ key: 'skus' as const, label: 'SKUs', count: skus.length }, { key: 'images' as const, label: 'Images', count: images.length }, { key: 'details' as const, label: 'Details', count: 0 }];
  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6"><Link href="/products" className="hover:text-brand-600 transition-colors">Products</Link><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg><span className="text-gray-700 font-medium">{product.style_number}</span></div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <div className="flex gap-6">
          {images.length > 0 && images[0].image_url && <div className="w-32 h-32 flex-shrink-0 rounded-lg overflow-hidden border border-gray-200 bg-gray-50"><img src={images[0].image_url} alt={product.style_number} className="w-full h-full object-cover" /></div>}
          <div className="flex-1"><h1 className="text-2xl font-bold text-gray-900">{product.style_number}</h1><p className="text-sm text-gray-500 mt-1">{product.description || 'No description'}</p>
            <div className="flex flex-wrap gap-4 mt-4 text-sm">{product.category && <span className="px-2 py-0.5 bg-gray-100 rounded text-gray-600">{product.category}</span>}{product.wholesale_price && <span className="text-gray-600">Wholesale: {fmt(product.wholesale_price)}</span>}{product.retail_price && <span className="text-gray-600">Retail: {fmt(product.retail_price)}</span>}{product.cost && <span className="text-gray-600">Cost: {fmt(product.cost)}</span>}{product.vendor_name && <span className="text-gray-600">Vendor: {product.vendor_name}</span>}</div>
          </div>
        </div>
      </div>
      <div className="flex gap-1 border-b border-gray-200 mb-6">{tabs.map(t => (<button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{t.label}{t.count > 0 && ` (${t.count})`}</button>))}</div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {tab === 'skus' && (<table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b border-gray-200"><th className="px-4 py-3 text-left font-medium text-gray-500">SKU</th><th className="px-4 py-3 text-left font-medium text-gray-500">Color</th><th className="px-4 py-3 text-left font-medium text-gray-500">Size</th><th className="px-4 py-3 text-left font-medium text-gray-500">UPC</th><th className="px-4 py-3 text-left font-medium text-gray-500">Bin</th><th className="px-4 py-3 text-right font-medium text-gray-500">On Hand</th><th className="px-4 py-3 text-right font-medium text-gray-500">Available</th></tr></thead><tbody>{skus.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No SKUs</td></tr> : skus.map(s => (<tr key={s.sku_id} className="border-b border-gray-100"><td className="px-4 py-2.5 font-mono text-xs">{s.sku_id}</td><td className="px-4 py-2.5 text-gray-600">{s.attr_2 || s.color || ''}</td><td className="px-4 py-2.5 text-gray-600">{s.size || ''}</td><td className="px-4 py-2.5 text-gray-600">{s.upc || ''}</td><td className="px-4 py-2.5 text-gray-600">{s.bin_location || ''}</td><td className="px-4 py-2.5 text-right">{s.on_hand || 0}</td><td className="px-4 py-2.5 text-right">{s.available || 0}</td></tr>))}</tbody></table>)}
        {tab === 'images' && (<div className="p-6">{images.length === 0 ? <p className="text-gray-400 text-center py-8">No images</p> : <div className="grid grid-cols-4 gap-4">{images.map((img, i) => (<div key={i} className="aspect-square rounded-lg overflow-hidden border border-gray-200 bg-gray-50">{img.image_url ? <img src={img.image_url} alt={`${product.style_number} ${i+1}`} className="w-full h-full object-cover" /> : <div className="flex items-center justify-center h-full text-gray-300 text-xs">No URL</div>}</div>))}</div>}</div>)}
        {tab === 'details' && (<div className="p-6 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">{Object.entries(product).filter(([k]) => !['id','created_at','updated_at','am_last_modified_time'].includes(k)).map(([key, val]) => (<div key={key} className="flex justify-between py-1 border-b border-gray-50"><span className="text-xs text-gray-400">{key.replace(/_/g, ' ')}</span><span className="text-gray-700 text-right max-w-[60%] truncate">{String(val || '')}</span></div>))}</div>)}
      </div>
    </div>
  );
}
