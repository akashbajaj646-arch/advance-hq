'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface CatalogProduct {
  product_id: string;
  style_number: string;
  description: string | null;
  category: string | null;
  price: number;
  content: string | null;
  origin: string | null;
  image_url?: string | null;
  image_count?: number;
  color_count?: number;
}

const PAGE_SIZE = 24;

export default function CatalogPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [productImages, setProductImages] = useState<string[]>([]);
  const [productSkus, setProductSkus] = useState<any[]>([]);
  const [activeImage, setActiveImage] = useState(0);

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    setPage(0);
  }, [search, categoryFilter]);

  useEffect(() => {
    loadProducts();
  }, [page, search, categoryFilter]);

  async function loadCategories() {
    const { data } = await supabase
      .from('products')
      .select('category')
      .not('category', 'is', null)
      .not('category', 'eq', '');

    if (data) {
      const uniqueCategories = [...new Set(data.map(d => d.category).filter(Boolean))] as string[];
      uniqueCategories.sort();
      setCategories(uniqueCategories);
    }
  }

  async function loadProducts() {
    setLoading(true);

    let query = supabase
      .from('products')
      .select('*', { count: 'exact' });

    if (search) {
      query = query.or(`style_number.ilike.%${search}%,description.ilike.%${search}%,category.ilike.%${search}%`);
    }

    if (categoryFilter) {
      query = query.eq('category', categoryFilter);
    }

    const { data, count } = await query
      .order('style_number', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (data) {
      const productIds = data.map(p => p.product_id);

      // Get first image for each product
      const { data: images } = await supabase
        .from('product_images')
        .select('product_id, image_url')
        .in('product_id', productIds)
        .eq('sort_order', 0);

      const imageMap: Record<string, string> = {};
      images?.forEach(img => {
        imageMap[img.product_id] = img.image_url;
      });

      // Get image counts
      const { data: allImages } = await supabase
        .from('product_images')
        .select('product_id')
        .in('product_id', productIds);

      const imageCountMap: Record<string, number> = {};
      allImages?.forEach(img => {
        imageCountMap[img.product_id] = (imageCountMap[img.product_id] || 0) + 1;
      });

      // Get unique color counts
      const { data: skuData } = await supabase
        .from('product_skus')
        .select('product_id, attr_2')
        .in('product_id', productIds);

      const colorMap: Record<string, Set<string>> = {};
      skuData?.forEach(sku => {
        if (!colorMap[sku.product_id]) colorMap[sku.product_id] = new Set();
        if (sku.attr_2) colorMap[sku.product_id].add(sku.attr_2);
      });

      const enrichedProducts = data.map(p => ({
        ...p,
        image_url: imageMap[p.product_id] || null,
        image_count: imageCountMap[p.product_id] || 0,
        color_count: colorMap[p.product_id]?.size || 0,
      }));

      setProducts(enrichedProducts);
      setTotalCount(count || 0);
    }

    setLoading(false);
  }

  async function openProduct(product: CatalogProduct) {
    setSelectedProduct(product);
    setActiveImage(0);

    const { data: images } = await supabase
      .from('product_images')
      .select('image_url')
      .eq('product_id', product.product_id)
      .order('sort_order', { ascending: true });

    setProductImages(images?.map(i => i.image_url) || []);

    const { data: skus } = await supabase
      .from('product_skus')
      .select('*')
      .eq('product_id', product.product_id)
      .order('attr_2', { ascending: true })
      .order('size', { ascending: true });

    setProductSkus(skus || []);
  }

  // Group SKUs by color for the matrix view
  function getSkuMatrix() {
    const colors = [...new Set(productSkus.map(s => s.attr_2).filter(Boolean))];
    const sizes = [...new Set(productSkus.map(s => s.size).filter(Boolean))];

    const matrix: Record<string, Record<string, any>> = {};
    productSkus.forEach(sku => {
      const color = sku.attr_2 || 'Default';
      const size = sku.size || 'OS';
      if (!matrix[color]) matrix[color] = {};
      matrix[color][size] = sku;
    });

    return { colors: colors.length > 0 ? colors : ['Default'], sizes: sizes.length > 0 ? sizes : ['OS'], matrix };
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Product Catalog</h1>
        <p className="text-gray-500 mt-1">Browse the Advance Apparels collection</p>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setCategoryFilter('')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              !categoryFilter ? 'bg-brand-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            All
          </button>
          {categories.slice(0, 8).map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat === categoryFilter ? '' : cat)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                categoryFilter === cat ? 'bg-brand-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Product Grid */}
      {loading ? (
        <div className="text-center py-16 text-gray-500">Loading catalog...</div>
      ) : products.length === 0 ? (
        <div className="text-center py-16 text-gray-500">No products found</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
            {products.map((product) => (
              <div
                key={product.product_id}
                onClick={() => openProduct(product)}
                className="bg-white rounded-xl overflow-hidden border border-gray-200 hover:shadow-lg hover:border-brand-300 cursor-pointer transition-all group"
              >
                <div className="aspect-square bg-gray-100 relative overflow-hidden">
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.style_number}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-12 h-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5" />
                      </svg>
                    </div>
                  )}
                  {product.image_count && product.image_count > 1 && (
                    <span className="absolute top-2 right-2 bg-black bg-opacity-60 text-white text-xs px-2 py-0.5 rounded-full">
                      {product.image_count} photos
                    </span>
                  )}
                </div>
                <div className="p-3">
                  <p className="font-semibold text-gray-900">{product.style_number}</p>
                  <p className="text-sm text-gray-500 truncate">{product.description || 'No description'}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-medium text-brand-600">${product.price.toFixed(2)}</span>
                    {product.color_count ? (
                      <span className="text-xs text-gray-400">{product.color_count} color{product.color_count > 1 ? 's' : ''}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {totalCount.toLocaleString()} products
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="px-4 py-2 text-sm text-gray-500">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* Product Detail Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              {/* Close */}
              <div className="flex justify-end mb-4">
                <button
                  onClick={() => setSelectedProduct(null)}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Left - Images */}
                <div>
                  {productImages.length > 0 ? (
                    <>
                      <div className="aspect-square rounded-xl overflow-hidden bg-gray-100 mb-3">
                        <img
                          src={productImages[activeImage]}
                          alt={selectedProduct.style_number}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      {productImages.length > 1 && (
                        <div className="grid grid-cols-6 gap-2">
                          {productImages.map((url, i) => (
                            <img
                              key={i}
                              src={url}
                              alt={`${i + 1}`}
                              className={`w-full aspect-square object-cover rounded-lg cursor-pointer border-2 transition-colors ${
                                activeImage === i ? 'border-brand-500' : 'border-transparent hover:border-gray-300'
                              }`}
                              onClick={() => setActiveImage(i)}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="aspect-square rounded-xl bg-gray-100 flex items-center justify-center">
                      <p className="text-gray-400">No images</p>
                    </div>
                  )}
                </div>

                {/* Right - Info */}
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-1">{selectedProduct.style_number}</h2>
                  <p className="text-gray-500 mb-4">{selectedProduct.description || 'No description'}</p>
                  <p className="text-3xl font-bold text-brand-600 mb-6">${selectedProduct.price.toFixed(2)}</p>

                  <div className="space-y-3 mb-6">
                    {selectedProduct.category && (
                      <div className="flex justify-between py-2 border-b border-gray-100">
                        <span className="text-gray-500">Category</span>
                        <span className="font-medium">{selectedProduct.category}</span>
                      </div>
                    )}
                    {selectedProduct.content && (
                      <div className="flex justify-between py-2 border-b border-gray-100">
                        <span className="text-gray-500">Content</span>
                        <span className="font-medium">{selectedProduct.content}</span>
                      </div>
                    )}
                    {selectedProduct.origin && (
                      <div className="flex justify-between py-2 border-b border-gray-100">
                        <span className="text-gray-500">Origin</span>
                        <span className="font-medium">{selectedProduct.origin}</span>
                      </div>
                    )}
                  </div>

                  {/* Size/Color Matrix */}
                  {productSkus.length > 0 && (() => {
                    const { colors, sizes, matrix } = getSkuMatrix();
                    return (
                      <div>
                        <h3 className="text-sm font-medium text-gray-500 mb-3">Available Sizes & Colors</h3>
                        <div className="overflow-x-auto border border-gray-200 rounded-lg">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50">
                                <th className="px-3 py-2 text-left font-medium text-gray-500">Color</th>
                                {sizes.map(size => (
                                  <th key={size} className="px-3 py-2 text-center font-medium text-gray-500">{size}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {colors.map(color => (
                                <tr key={color} className="border-t border-gray-100">
                                  <td className="px-3 py-2 font-medium">{color}</td>
                                  {sizes.map(size => {
                                    const sku = matrix[color]?.[size];
                                    return (
                                      <td key={size} className="px-3 py-2 text-center">
                                        {sku ? (
                                          <span className={sku.qty_avail_sell > 0 ? 'text-green-600 font-medium' : 'text-gray-300'}>
                                            {sku.qty_avail_sell || 0}
                                          </span>
                                        ) : (
                                          <span className="text-gray-200">-</span>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
