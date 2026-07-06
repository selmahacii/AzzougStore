'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Minus, Plus, ShoppingCart, CheckCircle, Package,
  AlertTriangle, Truck, Heart, ShieldCheck, Star, ChevronRight, Zap,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppStore } from '@/store/app-store';
import { useCartStore } from '@/store/cart-store';
import { formatPrice } from '@/lib/format';
import { toast } from 'sonner';
import type { Product } from '@/lib/types';
import { ProductCard } from './product-card';
import { ProductReviews } from './product-reviews';
import { motion } from 'framer-motion';
import { apiFetch } from '@/lib/api-client';

/* ─── shared data hook ─── */
function useProductDetailData() {
  const activeStore = useAppStore((s) => s.activeStore);
  const selectedProductSlug = useAppStore((s) => s.selectedProductSlug);
  const setSelectedProductSlug = useAppStore((s) => s.setSelectedProductSlug);
  const setStorefrontView = useAppStore((s) => s.setStorefrontView);
  const addItem = useCartStore((s) => s.addItem);
  const openCart = useCartStore((s) => s.openCart);
  const toggleWishlist = useCartStore((s) => s.toggleWishlist);
  const isInWishlist = useCartStore((s) => s.isInWishlist);

  const [product, setProduct] = useState<Product | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [addedToCart, setAddedToCart] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);

  const fetchProduct = useCallback(async (signal?: AbortSignal) => {
    if (!activeStore || !selectedProductSlug) { setProduct(null); setLoading(false); return; }
    setLoading(true); setQuantity(1); setAddedToCart(false); setSelectedVariant(null); setActiveImage(0);
    try {
      const json = await apiFetch<any>(`/api/v1/products?store_id=${activeStore.id}&slug=${selectedProductSlug}`, { signal });
      const productData = json.data ? (Array.isArray(json.data) ? json.data[0] : json.data) : null;
      setProduct(productData ?? null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setProduct(null);
    } finally { setLoading(false); }
  }, [activeStore, selectedProductSlug]);

  const fetchRelated = useCallback(async (signal?: AbortSignal) => {
    if (!activeStore || !product?.category) { setRelatedProducts([]); return; }
    try {
      const json = await apiFetch<any>(`/api/v1/products?store_id=${activeStore.id}&category=${encodeURIComponent(product.category)}&pageSize=5`, { signal });
      setRelatedProducts((json.data ?? []).filter((p: Product) => p.id !== product.id).slice(0, 4));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setRelatedProducts([]);
    }
  }, [activeStore, product]);

  useEffect(() => { const c = new AbortController(); fetchProduct(c.signal); return () => c.abort(); }, [fetchProduct]);
  useEffect(() => { const c = new AbortController(); fetchRelated(c.signal); return () => c.abort(); }, [fetchRelated]);

  const allImages = useMemo(() => {
    if (!product) return [];
    let imgs: string[] = [];
    if (Array.isArray(product.images)) {
      if (typeof product.images[0] === 'string' && product.images[0].startsWith('["')) {
        try { imgs = JSON.parse(product.images[0]); } catch { imgs = product.images as string[]; }
      } else { imgs = product.images as string[]; }
    } else if (typeof product.images === 'string') {
      try { const p = JSON.parse(product.images); imgs = Array.isArray(p) ? p : [p]; }
      catch { imgs = (product.images as string).startsWith('http') ? [product.images] : []; }
    }
    if (product.main_image && !imgs.includes(product.main_image)) imgs.unshift(product.main_image);
    return imgs.filter(Boolean);
  }, [product]);

  const discount = useMemo(() => {
    if (!product?.compare_price || product.compare_price <= product.price) return 0;
    return Math.round(((product.compare_price - product.price) / product.compare_price) * 100);
  }, [product]);

  const selectedVariantModifier = useMemo(() => {
    if (!product?.variants || !selectedVariant) return 0;
    return product.variants.find((v) => v.value === selectedVariant)?.priceModifier ?? 0;
  }, [product, selectedVariant]);

  const handleAddToCart = () => {
    if (!product) return;
    addItem(product, quantity, selectedVariant ?? undefined);
    setAddedToCart(true);
    setTimeout(() => { setAddedToCart(false); openCart(); }, 800);
  };

  const handleBuyNow = () => {
    if (!product) return;
    addItem(product, quantity, selectedVariant ?? undefined);
    setStorefrontView('checkout');
  };

  const handleToggleWishlist = () => {
    if (!product) return;
    toggleWishlist(product.id);
    toast.success(isInWishlist(product.id) ? `${product.name} retiré des favoris` : `${product.name} ajouté aux favoris`);
  };

  const handleBack = () => { setSelectedProductSlug(null); setStorefrontView('shop'); };

  return {
    activeStore, product, relatedProducts, loading, quantity, setQuantity,
    addedToCart, selectedVariant, setSelectedVariant, activeImage, setActiveImage,
    allImages, discount, selectedVariantModifier,
    handleAddToCart, handleBuyNow, handleToggleWishlist, handleBack,
    isInWishlist, addItem, openCart, setSelectedProductSlug,
  };
}

/* ─────────────────────────────── CLEAN ─────────────────────────────── */
function CleanDetail() {
  const d = useProductDetailData();
  const primary = (d.activeStore?.theme_config?.primaryColor as string) || '#4b7bec';

  if (d.loading) return (
    <div className="bg-white min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-8">
        <div className="flex flex-col lg:flex-row gap-10 lg:gap-16">
          <div className="flex-1 space-y-4">
            <Skeleton className="aspect-square w-full rounded-2xl bg-neutral-100" />
            <div className="grid grid-cols-4 gap-3">{[0,1,2,3].map(i=><Skeleton key={i} className="aspect-square rounded-xl bg-neutral-100"/>)}</div>
          </div>
          <div className="lg:w-[480px] space-y-6">
            <Skeleton className="h-8 w-2/3 bg-neutral-100 rounded-xl"/>
            <Skeleton className="h-12 w-full bg-neutral-100 rounded-xl"/>
            <Skeleton className="h-6 w-1/3 bg-neutral-100 rounded-xl"/>
            <Skeleton className="h-32 w-full bg-neutral-100 rounded-xl"/>
            <Skeleton className="h-14 w-full bg-neutral-100 rounded-xl"/>
          </div>
        </div>
      </div>
    </div>
  );

  if (!d.product) return (
    <div className="bg-white min-h-screen flex flex-col items-center justify-center gap-6">
      <div className="size-20 bg-neutral-100 rounded-2xl flex items-center justify-center">
        <AlertTriangle className="size-8 text-neutral-400"/>
      </div>
      <p className="text-lg font-semibold text-neutral-700">Produit introuvable</p>
      <button onClick={d.handleBack} className="text-sm font-medium text-neutral-500 hover:text-neutral-900 flex items-center gap-2 transition-colors">
        <ArrowLeft className="size-4"/> Retour à la boutique
      </button>
    </div>
  );

  const p = d.product;
  const wishlisted = d.isInWishlist(p.id);
  const isOOS = p.stock === 0;

  return (
    <div className="bg-white min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-10">
        <nav className="flex items-center gap-1.5 text-xs text-neutral-400 mb-8 flex-wrap">
          <button onClick={d.handleBack} className="hover:text-neutral-700 transition-colors uppercase tracking-widest font-bold">{d.activeStore?.name ?? 'Boutique'}</button>
          <ChevronRight className="size-3.5"/>
          {p.category && <><button onClick={d.handleBack} className="hover:text-neutral-700 transition-colors uppercase tracking-widest font-bold">{p.category}</button><ChevronRight className="size-3.5"/></>}
          <span className="text-neutral-700 font-bold uppercase tracking-widest line-clamp-1">{p.name}</span>
        </nav>

        <div className="flex flex-col lg:flex-row gap-10 lg:gap-16">
          {/* Gallery — sharp rectangular corners */}
          <div className="flex-1 flex flex-col gap-4">
            <motion.div key={d.activeImage} initial={{ opacity: 0.7 }} animate={{ opacity: 1 }}
              className="relative aspect-square bg-neutral-50 overflow-hidden border border-slate-100">
              {d.allImages[d.activeImage]
                ? <img src={d.allImages[d.activeImage]} alt={p.name} className="h-full w-full object-cover"/>
                : <div className="h-full w-full flex items-center justify-center"><Package className="size-20 text-neutral-200"/></div>}
              {d.discount > 0 && <div className="absolute top-4 left-4 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 shadow-lg" style={{ backgroundColor: primary }}>-{d.discount}%</div>}
              {isOOS && <div className="absolute inset-0 bg-white/70 flex items-center justify-center backdrop-blur-sm"><span className="text-xs font-black uppercase tracking-widest text-neutral-600 bg-white px-6 py-3 border shadow-xl">Rupture de stock</span></div>}
            </motion.div>
            {d.allImages.length > 1 && (
              <div className="grid grid-cols-5 gap-2">
                {d.allImages.slice(0, 5).map((img, i) => (
                  <button key={i} onClick={() => d.setActiveImage(i)}
                    className={`aspect-square overflow-hidden border-2 transition-all ${d.activeImage === i ? 'opacity-100' : 'border-neutral-100 hover:border-neutral-300 opacity-50 hover:opacity-80'}`}
                    style={d.activeImage === i ? { borderColor: primary } : {}}>
                    <img src={img} alt={`Vue ${i+1}`} className="h-full w-full object-cover"/>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="lg:w-[520px] shrink-0 space-y-8">
            {p.category && (
              <span className="inline-block text-[10px] font-black text-white uppercase tracking-[0.2em] px-3 py-1.5"
                style={{ backgroundColor: primary }}>
                {p.category}
              </span>
            )}
            <h1 className="text-3xl sm:text-4xl font-black text-neutral-900 leading-[1.1] tracking-tight">{p.name}</h1>
            <div className="flex items-center gap-5">
              <span className="text-4xl font-black text-neutral-900 tracking-tighter">{formatPrice(p.price + d.selectedVariantModifier)} DA</span>
              {p.compare_price && p.compare_price > p.price && <span className="text-xl text-neutral-300 line-through font-bold">{formatPrice(p.compare_price)} DA</span>}
            </div>
            {p.description && <p className="text-sm text-neutral-500 leading-relaxed font-medium">{p.description}</p>}
            <div className="h-px bg-slate-100 w-full"/>
            {p.variants && p.variants.length > 0 && (
              <div className="space-y-4">
                <p className="text-[11px] font-black text-neutral-900 uppercase tracking-widest">Options disponibles</p>
                <div className="flex flex-wrap gap-2.5">
                  {p.variants.map((v) => (
                    <button key={v.value} onClick={() => d.setSelectedVariant(d.selectedVariant === v.value ? null : v.value)}
                      className={`px-5 py-3 text-xs font-bold border-2 transition-all active:scale-95 ${d.selectedVariant === v.value ? 'text-white shadow-xl' : 'border-slate-200 text-neutral-600 hover:border-slate-400 bg-slate-50/50'}`}
                      style={d.selectedVariant === v.value ? { backgroundColor: primary, borderColor: primary } : {}}>
                      {v.value}{(v.priceModifier ?? 0) > 0 && <span className="ml-1.5 opacity-60">+{formatPrice(v.priceModifier ?? 0)}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-4">
                <div className="flex items-center bg-slate-50 border border-slate-100 p-1">
                  <button onClick={() => d.setQuantity(Math.max(1, d.quantity - 1))} className="size-12 flex items-center justify-center hover:bg-white transition-all text-neutral-600"><Minus className="size-4"/></button>
                  <span className="w-12 text-center text-sm font-black tabular-nums">{d.quantity}</span>
                  <button onClick={() => d.setQuantity(d.quantity + 1)} className="size-12 flex items-center justify-center hover:bg-white transition-all text-neutral-600"><Plus className="size-4"/></button>
                </div>
                <button onClick={d.handleToggleWishlist} className={`size-14 flex items-center justify-center border-2 transition-all active:scale-95 ${wishlisted ? 'border-red-100 bg-red-50 text-red-500' : 'border-slate-100 text-neutral-300 hover:border-slate-300 hover:text-neutral-500'}`}>
                  <Heart className="size-6" fill={wishlisted ? 'currentColor' : 'none'}/>
                </button>
              </div>
              {/* CTAs: Ajouter au panier (outline) + Commander maintenant (filled) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button disabled={isOOS} onClick={d.handleAddToCart}
                  className="h-16 flex items-center justify-center gap-3 text-xs font-black uppercase tracking-[0.2em] transition-all disabled:opacity-50 disabled:cursor-not-allowed border-2 hover:bg-slate-50 active:scale-[0.98]"
                  style={{ borderColor: primary, color: primary }}>
                  {d.addedToCart ? <><CheckCircle className="size-4"/>Ajouté</> : <><ShoppingCart className="size-4"/>Ajouter au panier</>}
                </button>
                {!isOOS && (
                  <button onClick={d.handleBuyNow}
                    className="h-16 flex items-center justify-center gap-3 text-xs font-black uppercase tracking-[0.2em] text-white transition-all hover:brightness-110 active:scale-[0.98]"
                    style={{ backgroundColor: primary }}>
                    <Zap className="size-4"/> Commander maintenant
                  </button>
                )}
              </div>
              {/* Trust badges */}
              <div className="flex items-center gap-6 pt-2">
                <div className="flex items-center gap-2 text-neutral-500">
                  <Truck className="size-4 shrink-0" style={{ color: primary }}/>
                  <span className="text-[10px] font-bold uppercase tracking-wider">Livraison offerte</span>
                </div>
                <div className="flex items-center gap-2 text-neutral-500">
                  <ShieldCheck className="size-4 shrink-0" style={{ color: primary }}/>
                  <span className="text-[10px] font-bold uppercase tracking-wider">Paiement sécurisé SSL</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Fiche technique / Specifications */}
        {(p as any).attributes && Object.keys((p as any).attributes).length > 0 && (
          <section className="mt-16 border-t border-neutral-100 pt-12">
            <h2 className="text-xl font-black text-neutral-900 uppercase tracking-tight mb-6">Fiche technique</h2>
            <table className="w-full max-w-2xl text-sm border-collapse">
              <tbody>
                {Object.entries((p as any).attributes as Record<string, string>).map(([key, val]) => (
                  <tr key={key} className="border-b border-slate-100">
                    <td className="py-3 pr-6 font-bold text-neutral-500 uppercase tracking-wider text-[11px] w-40">{key}</td>
                    <td className="py-3 text-neutral-800 font-medium">{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <div className="mt-16 border-t border-neutral-100 pt-12"><ProductReviews productId={p.id}/></div>
        {d.relatedProducts.length > 0 && (
          <section className="mt-16 border-t border-neutral-100 pt-12">
            <div className="flex items-end justify-between mb-8">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: primary }}>Sélection complémentaire</p>
                <h2 className="text-2xl font-bold text-neutral-900">Complétez votre sélection</h2>
              </div>
              <button onClick={d.handleBack} className="text-sm font-medium text-neutral-500 hover:text-neutral-900 flex items-center gap-1 transition-colors">Voir tout <ChevronRight className="size-4"/></button>
            </div>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
              {d.relatedProducts.map((rp) => (
                <ProductCard key={rp.id} product={rp}
                  onQuickView={(slug) => { d.setSelectedProductSlug(slug); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  onAddToCart={(pr) => { d.addItem(pr, 1); d.openCart(); }}/>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────── ATHLETIC ─────────────────────────────── */
function AthleticDetail() {
  const d = useProductDetailData();
  const primary = (d.activeStore?.theme_config?.primaryColor as string) || '#ef4444';

  if (d.loading) return (
    <div className="bg-[#0A0A0A] min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-8">
        <div className="flex flex-col lg:flex-row gap-8">
          <Skeleton className="flex-1 aspect-square bg-white/5"/>
          <div className="lg:w-[480px] space-y-4">
            {[...Array(5)].map((_,i) => <Skeleton key={i} className="h-10 w-full bg-white/5"/>)}
          </div>
        </div>
      </div>
    </div>
  );

  if (!d.product) return (
    <div className="bg-[#0A0A0A] min-h-screen flex flex-col items-center justify-center gap-6">
      <div className="size-20 bg-white/5 flex items-center justify-center">
        <AlertTriangle className="size-8 text-white/30"/>
      </div>
      <p className="text-sm font-black text-white/60 uppercase tracking-widest">Produit introuvable</p>
      <button onClick={d.handleBack} className="text-xs font-black uppercase tracking-widest text-white/40 hover:text-white flex items-center gap-2 transition-colors">
        <ArrowLeft className="size-4"/> Retour boutique
      </button>
    </div>
  );

  const p = d.product;
  const wishlisted = d.isInWishlist(p.id);
  const isOOS = p.stock === 0;

  return (
    <div className="bg-[#0A0A0A] min-h-screen">
      {/* Top bar */}
      <div className="border-b border-white/5 px-4 py-3 sm:px-8">
        <button onClick={d.handleBack} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-white/30 hover:text-white transition-colors">
          <ArrowLeft className="size-3.5"/> Retour
        </button>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
        <div className="flex flex-col lg:flex-row gap-0 lg:gap-0">

          {/* Gallery — full bleed left */}
          <div className="flex-1 flex flex-col gap-0">
            <div className="relative aspect-square bg-[#111] overflow-hidden">
              {d.allImages[d.activeImage]
                ? <img src={d.allImages[d.activeImage]} alt={p.name} className="h-full w-full object-cover"/>
                : <div className="h-full w-full flex items-center justify-center"><Package className="size-24 text-white/10"/></div>}
              {d.discount > 0 && (
                <div className="absolute top-0 right-0 text-black text-[9px] font-black uppercase tracking-widest px-4 py-2" style={{ backgroundColor: primary }}>
                  -{d.discount}%
                </div>
              )}
              {isOOS && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/60 border border-white/10 px-6 py-3">Rupture de stock</span>
                </div>
              )}
            </div>
            {d.allImages.length > 1 && (
              <div className="flex gap-px">
                {d.allImages.slice(0, 6).map((img, i) => (
                  <button key={i} onClick={() => d.setActiveImage(i)}
                    className={`flex-1 aspect-square overflow-hidden relative transition-all ${d.activeImage === i ? 'opacity-100' : 'opacity-30 hover:opacity-60'}`}>
                    <img src={img} alt={`Vue ${i+1}`} className="h-full w-full object-cover"/>
                    {d.activeImage === i && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: primary }}/>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="lg:w-[480px] shrink-0 bg-[#111] p-6 sm:p-10 flex flex-col gap-6">
            {p.category && <span className="text-[9px] font-black uppercase tracking-[0.4em] text-white/20">{p.category}</span>}
            <h1 className="text-3xl sm:text-5xl font-black text-white uppercase leading-none tracking-tight">{p.name}</h1>
            <div className="flex items-baseline gap-4">
              <span className="text-3xl font-black tabular-nums" style={{ color: primary }}>{formatPrice(p.price + d.selectedVariantModifier)} DA</span>
              {p.compare_price && p.compare_price > p.price && <span className="text-base text-white/20 line-through font-bold tabular-nums">{formatPrice(p.compare_price)} DA</span>}
            </div>
            {p.description && <p className="text-xs text-white/40 leading-relaxed font-medium border-l-2 pl-4" style={{ borderColor: primary }}>{p.description}</p>}

            {/* Variants */}
            {p.variants && p.variants.length > 0 && (
              <div className="space-y-3">
                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">Options</p>
                <div className="flex flex-wrap gap-2">
                  {p.variants.map((v) => (
                    <button key={v.value} onClick={() => d.setSelectedVariant(d.selectedVariant === v.value ? null : v.value)}
                      className={`px-4 py-2.5 text-xs font-black uppercase tracking-widest border transition-all active:scale-95 ${d.selectedVariant === v.value ? 'text-black' : 'border-white/10 text-white/40 hover:border-white/30 hover:text-white/80'}`}
                      style={d.selectedVariant === v.value ? { backgroundColor: primary, borderColor: primary } : {}}>
                      {v.value}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Qty + actions */}
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="flex items-center gap-3">
                <div className="flex items-center border border-white/10">
                  <button onClick={() => d.setQuantity(Math.max(1, d.quantity - 1))} className="size-10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5 transition-all"><Minus className="size-3.5"/></button>
                  <span className="w-10 text-center text-sm font-black text-white tabular-nums">{d.quantity}</span>
                  <button onClick={() => d.setQuantity(d.quantity + 1)} className="size-10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5 transition-all"><Plus className="size-3.5"/></button>
                </div>
                <button onClick={d.handleToggleWishlist}
                  className={`size-10 flex items-center justify-center border transition-all active:scale-95 ${wishlisted ? 'border-red-500/50 text-red-400' : 'border-white/10 text-white/20 hover:border-white/30 hover:text-white/50'}`}>
                  <Heart className="size-4" fill={wishlisted ? 'currentColor' : 'none'}/>
                </button>
              </div>
              {!isOOS ? (
                <>
                  <button onClick={d.handleBuyNow}
                    className="w-full h-14 text-[11px] font-black uppercase tracking-[0.3em] text-black transition-all hover:brightness-110 active:scale-[0.98]"
                    style={{ backgroundColor: primary }}>
                    Commander maintenant
                  </button>
                  <button disabled={isOOS} onClick={d.handleAddToCart}
                    className="w-full h-12 text-[10px] font-black uppercase tracking-[0.3em] text-white/60 border border-white/10 hover:border-white/30 hover:text-white transition-all active:scale-[0.98]">
                    {d.addedToCart ? '✓ Ajouté au panier' : 'Ajouter au panier'}
                  </button>
                </>
              ) : (
                <div className="w-full h-14 flex items-center justify-center text-[10px] font-black uppercase tracking-[0.3em] text-white/20 border border-white/5">
                  Rupture de stock
                </div>
              )}
            </div>

            {/* Trust */}
            <div className="flex items-center gap-3 pt-4 border-t border-white/5">
              <Truck className="size-4 shrink-0" style={{ color: primary }}/>
              <p className="text-[9px] font-black uppercase tracking-widest text-white/20">Livraison 24/48h · Partout en Algérie</p>
            </div>
          </div>
        </div>

        {/* Reviews */}
        <div className="mt-16 pt-12 border-t border-white/5"><ProductReviews productId={p.id}/></div>

        {/* Related */}
        {d.relatedProducts.length > 0 && (
          <section className="mt-16 pt-12 border-t border-white/5">
            <div className="flex items-end justify-between mb-8">
              <h2 className="text-xl font-black text-white uppercase tracking-tight">Produits similaires</h2>
              <button onClick={d.handleBack} className="text-[9px] font-black uppercase tracking-widest text-white/30 hover:text-white transition-colors flex items-center gap-1">Voir tout <ChevronRight className="size-3"/></button>
            </div>
            <div className="grid grid-cols-2 gap-px lg:grid-cols-4">
              {d.relatedProducts.map((rp) => (
                <ProductCard key={rp.id} product={rp}
                  onQuickView={(slug) => { d.setSelectedProductSlug(slug); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  onAddToCart={(pr) => { d.addItem(pr, 1); d.openCart(); }}/>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────── LUXE ─────────────────────────────── */
function LuxeDetail() {
  const d = useProductDetailData();
  const primary = (d.activeStore?.theme_config?.primaryColor as string) || '#b8964e';

  if (d.loading) return (
    <div className="bg-[#0C0F1A] min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-col lg:flex-row gap-16">
          <Skeleton className="flex-1 aspect-[3/4] bg-white/5"/>
          <div className="lg:w-[440px] space-y-8">{[...Array(5)].map((_,i) => <Skeleton key={i} className="h-8 w-full bg-white/5"/>)}</div>
        </div>
      </div>
    </div>
  );

  if (!d.product) return (
    <div className="bg-[#0C0F1A] min-h-screen flex flex-col items-center justify-center gap-8">
      <Package className="size-16 text-white/10"/>
      <p className="text-xs font-light tracking-[0.3em] text-white/30 uppercase">Produit introuvable</p>
      <button onClick={d.handleBack} className="text-[10px] tracking-[0.2em] text-white/30 hover:text-white/70 uppercase flex items-center gap-2 transition-colors">
        <ArrowLeft className="size-3"/> Retour
      </button>
    </div>
  );

  const p = d.product;
  const wishlisted = d.isInWishlist(p.id);
  const isOOS = p.stock === 0;

  return (
    <div className="bg-[#0C0F1A] min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-12 sm:py-20">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-3 text-[10px] tracking-[0.25em] text-white/20 uppercase mb-16">
          <button onClick={d.handleBack} className="hover:text-white/60 transition-colors">{d.activeStore?.name ?? 'Boutique'}</button>
          <span>·</span>
          {p.category && <><button onClick={d.handleBack} className="hover:text-white/60 transition-colors">{p.category}</button><span>·</span></>}
          <span className="text-white/40">{p.name}</span>
        </nav>

        <div className="flex flex-col lg:flex-row gap-12 lg:gap-20">

          {/* Gallery */}
          <div className="flex-1 flex gap-4">
            {d.allImages.length > 1 && (
              <div className="flex flex-col gap-3 w-16 shrink-0">
                {d.allImages.slice(0, 5).map((img, i) => (
                  <button key={i} onClick={() => d.setActiveImage(i)}
                    className={`aspect-square overflow-hidden border transition-all ${d.activeImage === i ? 'opacity-100' : 'opacity-30 hover:opacity-60'}`}
                    style={{ borderColor: d.activeImage === i ? primary : 'rgba(255,255,255,0.08)' }}>
                    <img src={img} alt="" className="h-full w-full object-cover"/>
                  </button>
                ))}
              </div>
            )}
            <div className="flex-1 relative aspect-[3/4] overflow-hidden border border-white/5">
              {d.allImages[d.activeImage]
                ? <img src={d.allImages[d.activeImage]} alt={p.name} className="h-full w-full object-cover transition-opacity duration-500"/>
                : <div className="h-full w-full bg-white/5 flex items-center justify-center"><Package className="size-20 text-white/10"/></div>}
              {d.discount > 0 && (
                <div className="absolute top-6 left-0 text-[9px] font-light tracking-[0.3em] uppercase text-white px-4 py-2" style={{ backgroundColor: primary }}>
                  -{d.discount}%
                </div>
              )}
              {isOOS && (
                <div className="absolute inset-0 bg-[#0C0F1A]/70 backdrop-blur-sm flex items-center justify-center">
                  <span className="text-[10px] tracking-[0.3em] uppercase text-white/30">Épuisé</span>
                </div>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="lg:w-[420px] shrink-0 flex flex-col gap-8">
            {p.category && <span className="text-[9px] tracking-[0.4em] uppercase text-white/20">{p.category}</span>}
            <h1 className="text-3xl sm:text-4xl font-light text-white leading-tight tracking-wide" style={{ fontFamily: '"Playfair Display", serif' }}>{p.name}</h1>

            <div className="flex items-baseline gap-6">
              <span className="text-2xl font-light tabular-nums" style={{ color: primary }}>{formatPrice(p.price + d.selectedVariantModifier)} DA</span>
              {p.compare_price && p.compare_price > p.price && <span className="text-sm text-white/20 line-through">{formatPrice(p.compare_price)} DA</span>}
            </div>

            {p.description && (
              <div className="border-t border-white/5 pt-8">
                <p className="text-sm text-white/40 leading-[1.9] font-light">{p.description}</p>
              </div>
            )}

            {/* Variants */}
            {p.variants && p.variants.length > 0 && (
              <div className="space-y-4 border-t border-white/5 pt-8">
                <p className="text-[9px] tracking-[0.35em] uppercase text-white/25">Options disponibles</p>
                <div className="flex flex-wrap gap-2">
                  {p.variants.map((v) => (
                    <button key={v.value} onClick={() => d.setSelectedVariant(d.selectedVariant === v.value ? null : v.value)}
                      className={`px-5 py-2.5 text-[10px] tracking-[0.2em] uppercase font-light border transition-all ${d.selectedVariant === v.value ? 'text-black' : 'border-white/10 text-white/30 hover:border-white/25 hover:text-white/60'}`}
                      style={d.selectedVariant === v.value ? { backgroundColor: primary, borderColor: primary } : {}}>
                      {v.value}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Qty + actions */}
            <div className="space-y-4 border-t border-white/5 pt-8">
              <div className="flex items-center gap-4">
                <div className="flex items-center border border-white/10">
                  <button onClick={() => d.setQuantity(Math.max(1, d.quantity - 1))} className="size-10 flex items-center justify-center text-white/20 hover:text-white/60 transition-colors"><Minus className="size-3"/></button>
                  <span className="w-12 text-center text-sm font-light text-white tabular-nums">{d.quantity}</span>
                  <button onClick={() => d.setQuantity(d.quantity + 1)} className="size-10 flex items-center justify-center text-white/20 hover:text-white/60 transition-colors"><Plus className="size-3"/></button>
                </div>
                <button onClick={d.handleToggleWishlist}
                  className={`size-10 flex items-center justify-center border transition-all ${wishlisted ? 'border-red-400/30 text-red-400' : 'border-white/10 text-white/20 hover:text-white/40'}`}>
                  <Heart className="size-4" fill={wishlisted ? 'currentColor' : 'none'}/>
                </button>
              </div>
              {!isOOS ? (
                <>
                  <button onClick={d.handleBuyNow}
                    className="w-full h-14 text-[10px] tracking-[0.35em] uppercase font-light text-black transition-all hover:brightness-95"
                    style={{ backgroundColor: primary }}>
                    Acquérir
                  </button>
                  <button disabled={isOOS} onClick={d.handleAddToCart}
                    className="w-full h-12 text-[10px] tracking-[0.25em] uppercase font-light text-white/40 border border-white/10 hover:border-white/20 hover:text-white/70 transition-all">
                    {d.addedToCart ? '✓ Ajouté' : 'Ajouter au panier'}
                  </button>
                </>
              ) : (
                <div className="w-full h-14 flex items-center justify-center text-[9px] tracking-[0.35em] uppercase text-white/15 border border-white/5">Épuisé</div>
              )}
            </div>

            {/* Trust */}
            <div className="flex items-center gap-3 pt-4 border-t border-white/5">
              <Truck className="size-3.5 shrink-0" style={{ color: primary }}/>
              <p className="text-[9px] tracking-[0.25em] uppercase text-white/20 font-light">Livraison express · Algérie</p>
            </div>
          </div>
        </div>

        {/* Reviews */}
        <div className="mt-24 pt-16 border-t border-white/5"><ProductReviews productId={p.id}/></div>

        {/* Related */}
        {d.relatedProducts.length > 0 && (
          <section className="mt-24 pt-16 border-t border-white/5">
            <div className="flex items-end justify-between mb-12">
              <div>
                <p className="text-[9px] tracking-[0.4em] uppercase mb-3" style={{ color: primary }}>À découvrir</p>
                <h2 className="text-2xl font-light text-white tracking-wide" style={{ fontFamily: '"Playfair Display", serif' }}>Sélection similaire</h2>
              </div>
              <button onClick={d.handleBack} className="text-[9px] tracking-[0.25em] uppercase text-white/20 hover:text-white/50 transition-colors flex items-center gap-1">Tout voir <ChevronRight className="size-3"/></button>
            </div>
            <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
              {d.relatedProducts.map((rp) => (
                <ProductCard key={rp.id} product={rp}
                  onQuickView={(slug) => { d.setSelectedProductSlug(slug); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  onAddToCart={(pr) => { d.addItem(pr, 1); d.openCart(); }}/>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────── EXPORT ─────────────────────────────── */
export function ProductDetail() {
  const activeStore = useAppStore((s) => s.activeStore);
  const _rawTpl = (activeStore?.template_id ?? activeStore?.theme_config?.templateId ?? 'clean') as string;
  const tpl = _rawTpl === 'minimalist' ? 'clean' : _rawTpl === 'landing' ? 'athletic' : _rawTpl.toLowerCase();
  if (tpl === 'athletic') return <AthleticDetail/>;
  if (tpl === 'luxe') return <LuxeDetail/>;
  return <CleanDetail/>;
}
