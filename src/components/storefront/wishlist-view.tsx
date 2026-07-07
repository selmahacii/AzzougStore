'use client';

import { useCallback, useEffect, useState } from 'react';
import { Heart, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStore } from '@/store/app-store';
import { useCartStore } from '@/store/cart-store';
import type { Product } from '@/lib/types';
import { ProductCard } from './product-card';
import { useTranslation } from '@/hooks/use-translation';

export function WishlistView() {
  const activeStore = useAppStore((s) => s.activeStore);
  const setSelectedProductSlug = useAppStore((s) => s.setSelectedProductSlug);
  const addItem = useCartStore((s) => s.addItem);
  const openCart = useCartStore((s) => s.openCart);
  const wishlistItems = useCartStore((s) => s.wishlistItems);
  const { t, dir } = useTranslation();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWishlistProducts = useCallback(async (signal?: AbortSignal) => {
    if (!activeStore || wishlistItems.length === 0) { setProducts([]); setLoading(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ store_id: activeStore.id, pageSize: '50', is_active: 'true' });
      const res = await fetch(`/api/v1/products?${params}`, { signal });
      if (!res.ok) throw new Error('Fetch failed');
      const json = await res.json();
      if (json.success) {
        const wishlistSet = new Set(wishlistItems);
        setProducts((json.data ?? []).filter((p: Product) => wishlistSet.has(p.id)));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setProducts([]);
    } finally { setLoading(false); }
  }, [activeStore, wishlistItems]);

  useEffect(() => {
    const controller = new AbortController();
    fetchWishlistProducts(controller.signal);
    return () => controller.abort();
  }, [fetchWishlistProducts]);

  const handleQuickView = (slug: string) => { setSelectedProductSlug(slug); };
  const handleAddToCart = (product: Product) => { addItem(product, 1); openCart(); };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6" dir={dir}>
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gray-100">
            <Heart className="size-5 text-rose-500" fill="currentColor" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              {t('wishlist')}
            </h1>
            <p className="text-sm text-gray-500">
              {wishlistItems.length > 0
                ? (wishlistItems.length === 1 ? t('wishlistCount', { qty: 1 }) : t('wishlistCountPlural', { qty: wishlistItems.length }))
                : t('emptyWishlist')}
            </p>
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl overflow-hidden border border-gray-200 bg-white">
              <Skeleton className="h-52 w-full" />
              <div className="space-y-3 p-4">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-5 w-20" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && wishlistItems.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-20">
          <Heart className="mb-4 size-12 text-gray-300" />
          <p className="text-base font-medium text-gray-500">{t('emptyWishlistTitle')}</p>
          <p className="mt-1 text-sm text-gray-400">{t('emptyWishlistDesc')}</p>
          <Button
            variant="outline"
            className="mt-4 gap-1.5"
            onClick={() => { useAppStore.getState().setStorefrontView('shop'); }}
          >
            <ShoppingCart className="size-4" />
            {t('browseShop')}
          </Button>
        </div>
      )}

      {/* Products */}
      {!loading && products.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} onQuickView={handleQuickView} onAddToCart={handleAddToCart} />
          ))}
        </div>
      )}

      {!loading && wishlistItems.length > 0 && products.length < wishlistItems.length && (
        <p className="mt-4 text-center text-xs text-gray-400">
          {t('someProductsNotFound', { qty: wishlistItems.length - products.length })}
        </p>
      )}
    </div>
  );
}
