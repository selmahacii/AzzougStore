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
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/use-translation';
import { trackMetaEvent } from '@/lib/meta-tracking';
import { optimizeCloudinaryUrl } from '@/lib/image-optimize';

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
  const [addedToCart, setAddedToCart] = useState(false);
  const [activeImage, setActiveImage] = useState(0);

  const [selections, setSelections] = useState<Record<string, { quantity: number; notes: string }>>({});

  const fetchProduct = useCallback(async (signal?: AbortSignal) => {
    if (!activeStore || !selectedProductSlug) { setProduct(null); setLoading(false); return; }
    setLoading(true); setAddedToCart(false); setActiveImage(0);
    try {
      const json = await apiFetch<any>(`/api/v1/products?store_id=${activeStore.id}&slug=${selectedProductSlug}&is_active=true`, { signal });
      const productData = json.data ? (Array.isArray(json.data) ? json.data[0] : json.data) : null;
      setProduct(productData ?? null);
      if (productData) {
        const initialSelections: Record<string, { quantity: number; notes: string }> = {};
        if (productData.variants && productData.variants.length > 0) {
          productData.variants.forEach((v: any) => {
            initialSelections[v.value] = { quantity: 0, notes: '' };
          });
        } else {
          initialSelections['default'] = { quantity: 1, notes: '' };
        }
        setSelections(initialSelections);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setProduct(null);
    } finally { setLoading(false); }
  }, [activeStore, selectedProductSlug]);

  const fetchRelated = useCallback(async (signal?: AbortSignal) => {
    if (!activeStore || !product?.category) { setRelatedProducts([]); return; }
    try {
      const json = await apiFetch<any>(`/api/v1/products?store_id=${activeStore.id}&category=${encodeURIComponent(product.category)}&pageSize=5&is_active=true`, { signal });
      setRelatedProducts((json.data ?? []).filter((p: Product) => p.id !== product.id).slice(0, 4));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setRelatedProducts([]);
    }
  }, [activeStore, product]);

  useEffect(() => { const c = new AbortController(); fetchProduct(c.signal); return () => c.abort(); }, [fetchProduct]);
  useEffect(() => { const c = new AbortController(); fetchRelated(c.signal); return () => c.abort(); }, [fetchRelated]);

  useEffect(() => {
    if (!product || typeof window === 'undefined') return;

    const title = `${product.name} | ${activeStore?.name || 'Boutique'}`;
    const description = product.description?.replace(/<[^>]+>/g, '').slice(0, 160) || `Découvrez ${product.name} avec livraison rapide.`;
    const imageUrl = product.main_image || (Array.isArray(product.images) ? product.images[0] : undefined);
    const canonicalUrl = `${window.location.origin}${window.location.pathname}`;

    document.title = title;

    const setMeta = (name: string, value: string) => {
      let tag = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('name', name);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', value);
    };

    const setPropertyMeta = (property: string, value: string) => {
      let tag = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('property', property);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', value);
    };

    const setLink = (rel: string, href: string) => {
      let tag = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
      if (!tag) {
        tag = document.createElement('link');
        tag.setAttribute('rel', rel);
        document.head.appendChild(tag);
      }
      tag.setAttribute('href', href);
    };

    setMeta('description', description);
    setPropertyMeta('og:title', title);
    setPropertyMeta('og:description', description);
    setPropertyMeta('og:type', 'product');
    setPropertyMeta('og:image', imageUrl || '');
    setPropertyMeta('twitter:title', title);
    setPropertyMeta('twitter:description', description);
    setPropertyMeta('twitter:image', imageUrl || '');
    setPropertyMeta('twitter:card', 'summary_large_image');
    setLink('canonical', canonicalUrl);

    const existingScript = document.getElementById('meta-product-jsonld');
    if (existingScript) existingScript.remove();

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description,
      image: imageUrl ? [imageUrl] : [],
      sku: product.sku || product.id,
      brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
      category: product.category || 'General',
      offers: {
        '@type': 'Offer',
        priceCurrency: 'DZD',
        price: product.price,
        availability: product.stock && product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: canonicalUrl,
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: 4.8,
        reviewCount: 12,
      },
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Accueil', item: window.location.origin },
          { '@type': 'ListItem', position: 2, name: product.category || 'Catégorie', item: canonicalUrl },
        ],
      },
    };

    const script = document.createElement('script');
    script.id = 'meta-product-jsonld';
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(jsonLd);
    document.head.appendChild(script);

    void trackMetaEvent('ViewContent', {
      content_ids: [product.id],
      content_name: product.name,
      content_type: 'product',
      value: product.price,
      currency: 'DZD',
      contents: [{ id: product.id, quantity: 1 }],
    }, {
      pixelId: undefined,
      eventId: `viewcontent-${product.id}-${Date.now()}`,
      contentName: product.name,
      contentCategory: product.category ?? undefined,
      contentType: 'product',
      value: product.price,
      currency: 'DZD',
      contents: [{ id: product.id, quantity: 1 }],
    });

    return () => {
      const tag = document.getElementById('meta-product-jsonld');
      if (tag) tag.remove();
    };
  }, [activeStore?.name, product]);

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
    if (product.main_image) {
      imgs = [product.main_image, ...imgs.filter(img => img !== product.main_image)];
    }
    // Append variant images if any
    if (product.variants && Array.isArray(product.variants)) {
      product.variants.forEach((v: any) => {
        const vImg = v.image || v.image_url || v.imageUrl || v.photo || v.img;
        if (vImg && typeof vImg === 'string' && vImg.trim() && !imgs.includes(vImg.trim())) {
          imgs.push(vImg.trim());
        }
        if (v.sub_variants && Array.isArray(v.sub_variants)) {
          v.sub_variants.forEach((sv: any) => {
            const svImg = sv.image || sv.image_url || sv.imageUrl || sv.photo || sv.img;
            if (svImg && typeof svImg === 'string' && svImg.trim() && !imgs.includes(svImg.trim())) {
              imgs.push(svImg.trim());
            }
          });
        }
      });
    }
    return imgs.filter(Boolean).map(img => optimizeCloudinaryUrl(img, 1200));
  }, [product]);

  const setActiveVariantImage = useCallback((vImg: string | undefined) => {
    if (!vImg || typeof vImg !== 'string' || !vImg.trim()) return;
    const clean = vImg.trim();
    const opt = optimizeCloudinaryUrl(clean, 1200);

    const getFilename = (u: string) => {
      try {
        const noQuery = u.split('?')[0];
        return noQuery.substring(noQuery.lastIndexOf('/') + 1);
      } catch {
        return u;
      }
    };
    const targetFile = getFilename(clean);

    const idx = allImages.findIndex(img => {
      if (img === opt || img === clean) return true;
      if (img.includes(clean) || clean.includes(img)) return true;
      const f = getFilename(img);
      return Boolean(f && targetFile && f === targetFile);
    });

    if (idx !== -1) {
      setActiveImage(idx);
    }
  }, [allImages]);

  const discount = useMemo(() => {
    if (!product?.compare_price || product.compare_price <= product.price) return 0;
    return Math.round(((product.compare_price - product.price) / product.compare_price) * 100);
  }, [product]);

  const updateSelection = (key: string, field: 'quantity' | 'notes', value: any) => {
    setSelections(prev => ({
      ...prev,
      [key]: {
        ...(prev[key] || { quantity: 0, notes: '' }),
        [field]: value
      }
    }));
  };

  const handleAddToCart = () => {
    if (!product) return;
    let added = false;
    Object.entries(selections).forEach(([key, sel]) => {
      if (sel.quantity > 0) {
        const variantVal = key === 'default' ? undefined : key;
        addItem(product, sel.quantity, variantVal, sel.notes);
        added = true;
      }
    });
    if (added) {
      setAddedToCart(true);
      setTimeout(() => { setAddedToCart(false); openCart(); }, 800);
    } else {
      toast.error('Veuillez sélectionner au moins une quantité');
    }
  };

  const handleBuyNow = () => {
    if (!product) return;
    let added = false;
    Object.entries(selections).forEach(([key, sel]) => {
      if (sel.quantity > 0) {
        const variantVal = key === 'default' ? undefined : key;
        addItem(product, sel.quantity, variantVal, sel.notes);
        added = true;
      }
    });
    if (added) {
      setStorefrontView('checkout');
    } else {
      toast.error('Veuillez sélectionner au moins une quantité');
    }
  };

  const handleToggleWishlist = () => {
    if (!product) return;
    toggleWishlist(product.id);
    toast.success(isInWishlist(product.id) ? `${product.name} retiré des favoris` : `${product.name} ajouté aux favoris`);
  };

  const handleBack = () => { setSelectedProductSlug(null); setStorefrontView('shop'); };

  return {
    activeStore, product, relatedProducts, loading, selections, updateSelection,
    addedToCart, activeImage, setActiveImage, setActiveVariantImage,
    allImages, discount,
    handleAddToCart, handleBuyNow, handleToggleWishlist, handleBack,
    isInWishlist, addItem, openCart, setSelectedProductSlug,
  };
}

/* ─────────────────────────────── CLEAN ─────────────────────────────── */
function CleanDetail() {
  const d = useProductDetailData();
  const primary = (d.activeStore?.theme_config?.primaryColor as string) || '#4b7bec';
  const p = d.product;
  const wishlisted = p ? d.isInWishlist(p.id) : false;
  const isOOS = p ? p.stock === 0 : false;
  const { t, dir } = useTranslation();

  const [activeVariantVal, setActiveVariantVal] = useState<string>('');
  const [quantity, setQuantity] = useState(1);

  // Group variants
  const colorVariants = p?.variants?.filter(v => (v.name && typeof v.name === 'string' && (v.name.toLowerCase().includes('couleur') || v.name.toLowerCase().includes('color'))) || v.color) || [];
  const textVariants = p?.variants?.filter(v => !((v.name && typeof v.name === 'string' && (v.name.toLowerCase().includes('couleur') || v.name.toLowerCase().includes('color'))) || v.color)) || [];

  useEffect(() => {
    if (p?.variants && p.variants.length > 0) {
      const firstVal = p.variants[0].value;
      setActiveVariantVal(firstVal);
      setQuantity(1);
      p.variants.forEach(v => {
        d.updateSelection(v.value, 'quantity', v.value === firstVal ? 1 : 0);
      });
      const firstImg = p.variants[0].image || (p.variants[0] as any)?.image_url || (p.variants[0] as any)?.imageUrl;
      if (firstImg) {
        d.setActiveVariantImage(firstImg);
      }
    } else {
      d.updateSelection('default', 'quantity', 1);
    }
  }, [p?.variants, d.setActiveVariantImage]);

  const handleSelectVariant = (val: string) => {
    setActiveVariantVal(val);
    p?.variants?.forEach(v => {
      d.updateSelection(v.value, 'quantity', v.value === val ? quantity : 0);
    });
    const vObj = p?.variants?.find(x => x.value === val);
    const vImg = vObj?.image || (vObj as any)?.image_url || (vObj as any)?.imageUrl || (vObj as any)?.photo || (vObj as any)?.img;
    if (vImg) {
      d.setActiveVariantImage(vImg);
    }
  };

  const handleQuantityChange = (newQty: number) => {
    setQuantity(newQty);
    if (p?.variants && p.variants.length > 0) {
      d.updateSelection(activeVariantVal, 'quantity', newQty);
    } else {
      d.updateSelection('default', 'quantity', newQty);
    }
  };

  if (d.loading) return (
    <div className="bg-[#F8F9FC] min-h-screen py-10 sm:py-16">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-8">
        <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 p-6 sm:p-10 shadow-sm">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14">
            <div className="lg:col-span-6 space-y-4">
              <Skeleton className="aspect-square w-full rounded-2xl sm:rounded-[24px] bg-slate-100" />
              <div className="flex gap-3 overflow-hidden">
                {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="size-16 sm:size-20 rounded-xl shrink-0 bg-slate-100" />)}
              </div>
            </div>
            <div className="lg:col-span-6 space-y-6">
              <Skeleton className="h-6 w-1/4 rounded-lg bg-slate-100" />
              <Skeleton className="h-10 w-3/4 rounded-xl bg-slate-100" />
              <Skeleton className="h-8 w-1/3 rounded-xl bg-slate-100" />
              <Skeleton className="h-24 w-full rounded-2xl bg-slate-100" />
              <Skeleton className="h-12 w-full rounded-xl bg-slate-100" />
              <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-14 rounded-xl bg-slate-100" />
                <Skeleton className="h-14 rounded-xl bg-slate-100" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (!p) return (
    <div className="bg-[#F8F9FC] min-h-screen flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 p-12 max-w-md w-full text-center shadow-sm space-y-4">
        <div className="size-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto text-slate-400">
          <AlertTriangle className="size-8 text-amber-500" />
        </div>
        <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">{t('productNotFound')}</h3>
        <p className="text-xs text-slate-400">Ce produit n\'est plus disponible ou a été déplacé.</p>
        <button 
          onClick={d.handleBack} 
          className="mt-2 h-11 px-6 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-slate-900 hover:bg-slate-800 transition-all inline-flex items-center gap-2"
        >
          <ArrowLeft className="size-4" /> {t('backToShop')}
        </button>
      </div>
    </div>
  );

  const savingsAmount = p.compare_price && p.compare_price > p.price ? p.compare_price - p.price : 0;

  return (
    <div className="bg-[#F8F9FC] min-h-screen py-8 sm:py-12" dir={dir}>
      <div className="mx-auto max-w-[1400px] px-4 sm:px-8 space-y-8">

        {/* Top Breadcrumbs & Back Navigation (Meta Ads Style) */}
        <div className="bg-white rounded-2xl sm:rounded-[24px] border border-slate-100 px-6 py-4 shadow-sm flex items-center justify-between gap-4 flex-wrap">
          <nav className="flex items-center gap-2 text-xs font-bold text-slate-400 flex-wrap">
            <button onClick={d.handleBack} className="hover:text-slate-900 transition-colors uppercase tracking-wider font-bold">
              {d.activeStore?.name ?? 'Boutique'}
            </button>
            <ChevronRight className="size-3.5 text-slate-300" />
            {p.category && (
              <>
                <button onClick={d.handleBack} className="hover:text-slate-900 transition-colors uppercase tracking-wider font-bold">
                  {p.category}
                </button>
                <ChevronRight className="size-3.5 text-slate-300" />
              </>
            )}
            <span className="text-slate-900 font-black uppercase tracking-wider line-clamp-1">{p.name}</span>
          </nav>

          <button 
            onClick={d.handleBack} 
            className="flex items-center gap-1.5 text-xs font-black text-slate-600 hover:text-slate-900 transition-colors uppercase tracking-wider"
          >
            <ArrowLeft className="size-3.5" /> Retour au catalogue
          </button>
        </div>

        {/* Main Product Box */}
        <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 p-6 sm:p-10 lg:p-12 shadow-sm">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14">
            
            {/* Gallery Column */}
            <div className="lg:col-span-6 flex flex-col gap-4">
              <motion.div 
                key={d.activeImage} 
                initial={{ opacity: 0.8 }} 
                animate={{ opacity: 1 }}
                className="relative aspect-square bg-slate-50 rounded-2xl sm:rounded-[28px] overflow-hidden border border-slate-100 shadow-2xs"
              >
                {d.allImages[d.activeImage] ? (
                  <img src={d.allImages[d.activeImage]} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center">
                    <Package className="size-20 text-slate-300" />
                  </div>
                )}
                
                {d.discount > 0 && (
                  <div className="absolute top-4 start-4 bg-rose-500 text-white text-[11px] font-black uppercase font-mono px-3 py-1.5 rounded-xl shadow-xs">
                    -{d.discount}%
                  </div>
                )}
                
                {isOOS && (
                  <div className="absolute inset-0 bg-white/80 backdrop-blur-xs flex items-center justify-center">
                    <span className="text-xs font-black uppercase tracking-wider text-rose-600 bg-white px-6 py-3 rounded-2xl border border-rose-100 shadow-lg">
                      {t('outOfStock')}
                    </span>
                  </div>
                )}
              </motion.div>

              {/* Responsive gallery thumbnail strip (all images accessible) */}
              {d.allImages.length > 1 && (
                <div className="flex items-center gap-3 overflow-x-auto pb-1 no-scrollbar">
                  {d.allImages.map((img, i) => (
                    <button 
                      key={i} 
                      onClick={() => d.setActiveImage(i)}
                      className={cn(
                        "size-16 sm:size-20 rounded-xl overflow-hidden border-2 shrink-0 transition-all bg-white",
                        d.activeImage === i 
                          ? "border-[#4b7bec] ring-2 ring-blue-100 shadow-xs scale-105" 
                          : "border-slate-100 opacity-60 hover:opacity-100 hover:border-slate-300"
                      )}
                      style={d.activeImage === i ? { borderColor: primary } : {}}
                    >
                      <img src={img} alt={`Vue ${i+1}`} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Product Purchase Column */}
            <div className="lg:col-span-6 flex flex-col justify-between space-y-6">
              <div className="space-y-5">
                {/* Header Pills (Badge "En stock - Expédition immédiate" removed) */}
                <div className="flex items-center gap-2 flex-wrap">
                  {p.category && (
                    <span className="px-3 py-1 rounded-lg text-[10px] font-black uppercase font-mono bg-blue-50 text-[#4b7bec] border border-blue-100">
                      {p.category}
                    </span>
                  )}
                  {isOOS && (
                    <span className="px-3 py-1 rounded-lg text-[10px] font-black uppercase font-mono bg-rose-50 text-rose-600 border border-rose-100">
                      Rupture de stock
                    </span>
                  )}
                </div>

                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-slate-900 tracking-tight leading-tight">
                  {p.name}
                </h1>

                {/* Price Section */}
                <div className="flex items-center gap-4 flex-wrap bg-slate-50/80 rounded-2xl p-4 border border-slate-100">
                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl sm:text-4xl font-black text-slate-900 font-mono tracking-tight">
                      {formatPrice(p.price)}
                    </span>
                    {p.compare_price !== null && p.compare_price > p.price && (
                      <span className="text-lg text-slate-400 font-mono line-through font-bold">
                        {formatPrice(p.compare_price)}
                      </span>
                    )}
                  </div>
                  {savingsAmount > 0 && (
                    <span className="px-3 py-1 rounded-lg text-[10px] font-black uppercase font-mono bg-emerald-50 text-emerald-600 border border-emerald-100">
                      Économisez {formatPrice(savingsAmount)}
                    </span>
                  )}
                </div>

                {p.description && (
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium">
                    {p.description}
                  </p>
                )}

                <div className="h-px bg-slate-100 w-full" />

                {/* Variants Selection with visual thumbnails */}
                {p.variants && p.variants.length > 0 && (
                  <div className="space-y-5">
                    {colorVariants.length > 0 && (
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                          {t('color')} : <span className="text-slate-900 font-black">{p.variants.find(x => x.value === activeVariantVal)?.name?.toLowerCase().includes('couleur') || p.variants.find(x => x.value === activeVariantVal)?.color ? activeVariantVal : ''}</span>
                        </label>
                        <div className="flex flex-wrap gap-2.5">
                          {colorVariants.map(v => {
                            const isSelected = activeVariantVal === v.value;
                            const vImg = v.image || (v as any).image_url || (v as any).imageUrl || (v as any).photo;
                            return (
                              <button
                                key={v.value}
                                type="button"
                                onClick={() => handleSelectVariant(v.value)}
                                className={cn(
                                  "relative size-11 rounded-xl border-2 transition-all hover:scale-105 active:scale-95 flex items-center justify-center overflow-hidden shadow-2xs",
                                  isSelected ? "border-slate-900 ring-2 ring-offset-2 ring-slate-900 shadow-sm scale-105" : "border-slate-200 hover:border-slate-400"
                                )}
                                style={!vImg && v.color ? { backgroundColor: v.color } : {}}
                                title={v.value}
                              >
                                {vImg ? (
                                  <img src={optimizeCloudinaryUrl(vImg, 120)} alt={v.value} className="size-full object-cover" />
                                ) : v.color ? (
                                  <span className="size-full" style={{ backgroundColor: v.color }} />
                                ) : (
                                  <span className="text-[10px] font-black text-slate-800 uppercase">{v.value.slice(0, 3)}</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {textVariants.length > 0 && (
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                          {t('optionSize')} : <span className="text-slate-900 font-black">{!(p.variants.find(x => x.value === activeVariantVal)?.name?.toLowerCase().includes('couleur') || p.variants.find(x => x.value === activeVariantVal)?.color) ? activeVariantVal : ''}</span>
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {textVariants.map(v => {
                            const isSelected = activeVariantVal === v.value;
                            const vImg = v.image || (v as any).image_url || (v as any).imageUrl || (v as any).photo;
                            return (
                              <button
                                key={v.value}
                                type="button"
                                onClick={() => handleSelectVariant(v.value)}
                                className={cn(
                                  "px-4 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl border transition-all active:scale-95 flex items-center gap-2",
                                  isSelected 
                                    ? "bg-slate-900 border-slate-900 text-white shadow-xs" 
                                    : "bg-white border-slate-200 text-slate-700 hover:border-slate-400"
                                )}
                              >
                                {vImg && (
                                  <img src={optimizeCloudinaryUrl(vImg, 80)} alt={v.value} className="size-5 rounded-md object-cover" />
                                )}
                                <span>{v.value}</span>
                                {(v.priceModifier ?? 0) > 0 && <span className="text-[10px] opacity-60 ml-1">+{formatPrice(v.priceModifier ?? 0)}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Quantity & Actions */}
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center bg-slate-50 border border-slate-200/80 rounded-xl p-1 shadow-2xs">
                      <button 
                        type="button" 
                        onClick={() => handleQuantityChange(Math.max(1, quantity - 1))} 
                        className="size-11 flex items-center justify-center hover:bg-white rounded-lg transition-all text-slate-600"
                      >
                        <Minus className="size-4" />
                      </button>
                      <span className="w-12 text-center text-sm font-black font-mono text-slate-900">{quantity}</span>
                      <button 
                        type="button" 
                        onClick={() => handleQuantityChange(quantity + 1)} 
                        className="size-11 flex items-center justify-center hover:bg-white rounded-lg transition-all text-slate-600"
                      >
                        <Plus className="size-4" />
                      </button>
                    </div>

                    <button 
                      type="button" 
                      onClick={d.handleToggleWishlist} 
                      className={cn(
                        "size-13 rounded-xl border flex items-center justify-center transition-all active:scale-95 shadow-2xs",
                        wishlisted 
                          ? "border-rose-200 bg-rose-50 text-rose-500" 
                          : "border-slate-200 bg-white text-slate-400 hover:text-slate-600 hover:border-slate-300"
                      )}
                    >
                      <Heart className="size-5" fill={wishlisted ? 'currentColor' : 'none'} />
                    </button>
                  </div>

                  {/* Dual CTA Buttons */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {!isOOS ? (
                      <button 
                        onClick={d.handleBuyNow}
                        className="h-13 rounded-xl flex items-center justify-center gap-2.5 text-xs font-black uppercase tracking-wider text-white shadow-xs transition-all hover:opacity-95 active:scale-[0.98]"
                        style={{ backgroundColor: primary }}
                      >
                        <Zap className="size-4" /> {t('buyNow')} (COD)
                      </button>
                    ) : null}
                    
                    <button 
                      disabled={isOOS} 
                      onClick={d.handleAddToCart}
                      className="h-13 rounded-xl flex items-center justify-center gap-2.5 text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed border-2 hover:bg-slate-50 active:scale-[0.98]"
                      style={{ borderColor: primary, color: primary }}
                    >
                      {d.addedToCart ? (
                        <><CheckCircle className="size-4" /> {t('added')}</>
                      ) : (
                        <><ShoppingCart className="size-4" /> {t('addToCart')}</>
                      )}
                    </button>
                  </div>
                </div>

              </div>

              {/* 4 Reassurance Cards (Meta Ads KPI style) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-6 border-t border-slate-100">
                <div className="bg-slate-50/70 rounded-xl p-3 border border-slate-100/80 space-y-1">
                  <Truck className="size-4 text-[#4b7bec]" />
                  <p className="text-[10px] font-black uppercase text-slate-800">58 Wilayas</p>
                  <p className="text-[9px] text-slate-400 font-medium">Livraison Express</p>
                </div>
                <div className="bg-slate-50/70 rounded-xl p-3 border border-slate-100/80 space-y-1">
                  <ShieldCheck className="size-4 text-emerald-600" />
                  <p className="text-[10px] font-black uppercase text-slate-800">Paiement COD</p>
                  <p className="text-[9px] text-slate-400 font-medium">À la réception</p>
                </div>
                <div className="bg-slate-50/70 rounded-xl p-3 border border-slate-100/80 space-y-1">
                  <CheckCircle className="size-4 text-blue-600" />
                  <p className="text-[10px] font-black uppercase text-slate-800">Garantie</p>
                  <p className="text-[9px] text-slate-400 font-medium">100% Conforme</p>
                </div>
                <div className="bg-slate-50/70 rounded-xl p-3 border border-slate-100/80 space-y-1">
                  <Zap className="size-4 text-amber-500" />
                  <p className="text-[10px] font-black uppercase text-slate-800">Service 7j/7</p>
                  <p className="text-[9px] text-slate-400 font-medium">Support rapide</p>
                </div>
              </div>

            </div>

          </div>
        </div>

        {/* Technical Specifications */}
        {(p as any).attributes && Object.keys((p as any).attributes).length > 0 && (
          <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 p-6 sm:p-10 shadow-sm space-y-6">
            <h2 className="text-lg sm:text-xl font-black text-slate-900 uppercase tracking-tight">
              {t('specification')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
              {Object.entries((p as any).attributes as Record<string, string>).map(([key, val]) => (
                <div key={key} className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50/70 border border-slate-100 text-xs">
                  <span className="font-bold text-slate-400 uppercase tracking-wider">{key}</span>
                  <span className="font-black text-slate-800">{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reviews Section */}
        <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 p-6 sm:p-10 shadow-sm">
          <ProductReviews productId={p.id} />
        </div>

        {/* Related Products Section */}
        {d.relatedProducts.length > 0 && (
          <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 p-6 sm:p-10 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-[#4b7bec]">
                  {t('exclusiveSelection')}
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 uppercase tracking-tight">
                  {t('relatedProductsHeading')}
                </h2>
              </div>
              <button 
                onClick={d.handleBack} 
                className="text-xs font-black uppercase tracking-wider text-slate-500 hover:text-slate-900 flex items-center gap-1 transition-colors"
              >
                {t('seeAll')} <ChevronRight className="size-4" />
              </button>
            </div>
            
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              {d.relatedProducts.map((rp) => (
                <ProductCard 
                  key={rp.id} 
                  product={rp}
                  onQuickView={(slug) => { 
                    d.setSelectedProductSlug(slug); 
                    window.scrollTo({ top: 0, behavior: 'smooth' }); 
                  }}
                  onAddToCart={(pr) => { d.addItem(pr, 1); d.openCart(); }}
                />
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

/* ─────────────────────────────── ATHLETIC ─────────────────────────────── */
function AthleticDetail() {
  const d = useProductDetailData();
  const primary = (d.activeStore?.theme_config?.primaryColor as string) || '#ef4444';
  const p = d.product;
  const wishlisted = p ? d.isInWishlist(p.id) : false;
  const isOOS = p ? p.stock === 0 : false;
  const { t, dir } = useTranslation();

  const [activeVariantVal, setActiveVariantVal] = useState<string>('');
  const [quantity, setQuantity] = useState(1);

  // Group variants
  const colorVariants = p?.variants?.filter(v => (v.name && typeof v.name === 'string' && (v.name.toLowerCase().includes('couleur') || v.name.toLowerCase().includes('color'))) || v.color) || [];
  const textVariants = p?.variants?.filter(v => !((v.name && typeof v.name === 'string' && (v.name.toLowerCase().includes('couleur') || v.name.toLowerCase().includes('color'))) || v.color)) || [];

  useEffect(() => {
    if (p?.variants && p.variants.length > 0) {
      const firstVal = p.variants[0].value;
      setActiveVariantVal(firstVal);
      setQuantity(1);
      p.variants.forEach(v => {
        d.updateSelection(v.value, 'quantity', v.value === firstVal ? 1 : 0);
      });
    } else {
      d.updateSelection('default', 'quantity', 1);
    }
  }, [p?.variants]);

  const handleSelectVariant = (val: string) => {
    setActiveVariantVal(val);
    p?.variants?.forEach(v => {
      d.updateSelection(v.value, 'quantity', v.value === val ? quantity : 0);
    });
    const vObj = p?.variants?.find(x => x.value === val);
    const vImg = vObj?.image || (vObj as any)?.image_url || (vObj as any)?.imageUrl;
    if (vImg) {
      d.setActiveVariantImage(vImg);
    }
  };

  const handleQuantityChange = (newQty: number) => {
    setQuantity(newQty);
    if (p?.variants && p.variants.length > 0) {
      d.updateSelection(activeVariantVal, 'quantity', newQty);
    } else {
      d.updateSelection('default', 'quantity', newQty);
    }
  };

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

  if (!p) return (
    <div className="bg-[#0A0A0A] min-h-screen flex flex-col items-center justify-center gap-6">
      <div className="size-20 bg-white/5 flex items-center justify-center">
        <AlertTriangle className="size-8 text-white/30"/>
      </div>
      <p className="text-sm font-black text-white/60 uppercase tracking-widest">{t('productNotFound')}</p>
      <button onClick={d.handleBack} className="text-xs font-black uppercase tracking-widest text-white/40 hover:text-white flex items-center gap-2 transition-colors">
        <ArrowLeft className="size-4"/> {t('backToShop')}
      </button>
    </div>
  );

  return (
    <div className="bg-[#0A0A0A] min-h-screen" dir={dir}>
      {/* Top bar */}
      <div className="border-b border-white/5 px-4 py-3 sm:px-8">
        <button onClick={d.handleBack} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-white/30 hover:text-white transition-colors">
          <ArrowLeft className="size-3.5"/> {t('back')}
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
                <div className="absolute top-0 end-0 text-black text-[9px] font-black uppercase tracking-widest px-4 py-2" style={{ backgroundColor: primary }}>
                  -{d.discount}%
                </div>
              )}
              {isOOS && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/60 border border-white/10 px-6 py-3">{t('outOfStock')}</span>
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
              <span className="text-3xl font-black tabular-nums" style={{ color: primary }}>{formatPrice(p.price)}</span>
              {p.compare_price !== null && p.compare_price > p.price && <span className="text-base text-white/20 line-through font-bold tabular-nums">{formatPrice(p.compare_price)}</span>}
            </div>
            {p.description && <p className="text-xs text-white/40 leading-relaxed font-medium border-l-2 pl-4" style={{ borderColor: primary }}>{p.description}</p>}

            {/* Variants */}
            {p.variants && p.variants.length > 0 && (
              <div className="space-y-4">
                {colorVariants.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">
                      {t('color')} : <span className="text-white/60 normal-case font-bold">{p.variants.find(x => x.value === activeVariantVal)?.name?.toLowerCase().includes('couleur') || p.variants.find(x => x.value === activeVariantVal)?.color ? activeVariantVal : ''}</span>
                    </p>
                    <div className="flex flex-wrap gap-2.5">
                      {colorVariants.map(v => {
                        const isSelected = activeVariantVal === v.value;
                        return (
                          <button
                            key={v.value}
                            type="button"
                            onClick={() => handleSelectVariant(v.value)}
                            className={cn(
                              "relative size-9 rounded-full border transition-all hover:scale-105 active:scale-95 flex items-center justify-center",
                              isSelected ? "border-white ring-2 ring-offset-2 ring-offset-[#111] ring-white" : "border-white/10"
                            )}
                            style={{ backgroundColor: v.color }}
                            title={v.value}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {textVariants.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">
                      {t('optionSize')} : <span className="text-white/60 normal-case font-bold">{!(p.variants.find(x => x.value === activeVariantVal)?.name?.toLowerCase().includes('couleur') || p.variants.find(x => x.value === activeVariantVal)?.color) ? activeVariantVal : ''}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {textVariants.map(v => {
                        const isSelected = activeVariantVal === v.value;
                        return (
                          <button
                            key={v.value}
                            type="button"
                            onClick={() => handleSelectVariant(v.value)}
                            className={cn(
                              "px-4 py-2.5 text-xs font-black uppercase tracking-[0.1em] border transition-all active:scale-95",
                              isSelected 
                                ? "bg-white border-white text-black" 
                                : "bg-transparent border-white/10 text-white/60 hover:border-white/30 hover:text-white"
                            )}
                          >
                            {v.value}
                            {(v.priceModifier ?? 0) > 0 && <span className="text-[10px] opacity-60 ml-1">+{formatPrice(v.priceModifier ?? 0)}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}


            {/* Quantity Selector & Wishlist */}
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="flex items-center gap-3">
                <div className="flex items-center border border-white/10">
                  <button type="button" onClick={() => handleQuantityChange(Math.max(1, quantity - 1))} className="size-12 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5 transition-all"><Minus className="size-3.5"/></button>
                  <span className="w-12 text-center text-sm font-black text-white tabular-nums">{quantity}</span>
                  <button type="button" onClick={() => handleQuantityChange(quantity + 1)} className="size-12 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5 transition-all"><Plus className="size-3.5"/></button>
                </div>
                <button type="button" onClick={d.handleToggleWishlist}
                  className={`size-12 flex items-center justify-center border transition-all active:scale-95 ${wishlisted ? 'border-red-500/50 text-red-400' : 'border-white/10 text-white/20 hover:border-white/30 hover:text-white/50'}`}>
                  <Heart className="size-4" fill={wishlisted ? 'currentColor' : 'none'}/>
                </button>
              </div>
            </div>
              {!isOOS ? (
                <>
                  <button onClick={d.handleBuyNow}
                    className="w-full h-14 text-[11px] font-black uppercase tracking-[0.3em] text-black transition-all hover:brightness-110 active:scale-[0.98]"
                    style={{ backgroundColor: primary }}>
                    {t('buyNow')}
                  </button>
                  <button disabled={isOOS} onClick={d.handleAddToCart}
                    className="w-full h-12 text-[10px] font-black uppercase tracking-[0.3em] text-white/60 border border-white/10 hover:border-white/30 hover:text-white transition-all active:scale-[0.98]">
                    {d.addedToCart ? <><CheckCircle className="size-3.5 inline mr-1" />{t('added')}</> : t('addToCart')}
                  </button>
                </>
              ) : (
                <div className="w-full h-14 flex items-center justify-center text-[10px] font-black uppercase tracking-[0.3em] text-white/20 border border-white/5">
                  {t('outOfStock')}
                </div>
              )}

            {/* Trust */}
            <div className="flex items-center gap-3 pt-4 border-t border-white/5">
              <Truck className="size-4 shrink-0" style={{ color: primary }}/>
              <p className="text-[9px] font-black uppercase tracking-widest text-white/20">{t('shippingPromoAthletic')}</p>
            </div>
          </div>
        </div>

        {/* Reviews */}
        <div className="mt-16 pt-12 border-t border-white/5"><ProductReviews productId={p.id}/></div>

        {/* Related */}
        {d.relatedProducts.length > 0 && (
          <section className="mt-16 pt-12 border-t border-white/5">
            <div className="flex items-end justify-between mb-8">
              <h2 className="text-xl font-black text-white uppercase tracking-tight">{t('relatedProducts')}</h2>
              <button onClick={d.handleBack} className="text-[9px] font-black uppercase tracking-widest text-white/30 hover:text-white transition-colors flex items-center gap-1">{t('seeAll')} <ChevronRight className="size-3"/></button>
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
  const p = d.product;
  const wishlisted = p ? d.isInWishlist(p.id) : false;
  const isOOS = p ? p.stock === 0 : false;
  const { t, dir } = useTranslation();

  const [activeVariantVal, setActiveVariantVal] = useState<string>('');
  const [quantity, setQuantity] = useState(1);

  // Group variants
  const colorVariants = p?.variants?.filter(v => (v.name && typeof v.name === 'string' && (v.name.toLowerCase().includes('couleur') || v.name.toLowerCase().includes('color'))) || v.color) || [];
  const textVariants = p?.variants?.filter(v => !((v.name && typeof v.name === 'string' && (v.name.toLowerCase().includes('couleur') || v.name.toLowerCase().includes('color'))) || v.color)) || [];

  useEffect(() => {
    if (p?.variants && p.variants.length > 0) {
      const firstVal = p.variants[0].value;
      setActiveVariantVal(firstVal);
      setQuantity(1);
      p.variants.forEach(v => {
        d.updateSelection(v.value, 'quantity', v.value === firstVal ? 1 : 0);
      });
    } else {
      d.updateSelection('default', 'quantity', 1);
    }
  }, [p?.variants]);

  const handleSelectVariant = (val: string) => {
    setActiveVariantVal(val);
    p?.variants?.forEach(v => {
      d.updateSelection(v.value, 'quantity', v.value === val ? quantity : 0);
    });
    const vObj = p?.variants?.find(x => x.value === val);
    const vImg = vObj?.image || (vObj as any)?.image_url || (vObj as any)?.imageUrl;
    if (vImg) {
      d.setActiveVariantImage(vImg);
    }
  };

  const handleQuantityChange = (newQty: number) => {
    setQuantity(newQty);
    if (p?.variants && p.variants.length > 0) {
      d.updateSelection(activeVariantVal, 'quantity', newQty);
    } else {
      d.updateSelection('default', 'quantity', newQty);
    }
  };

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

  if (!p) return (
    <div className="bg-[#0C0F1A] min-h-screen flex flex-col items-center justify-center gap-8">
      <Package className="size-16 text-white/10"/>
      <p className="text-xs font-light tracking-[0.3em] text-white/30 uppercase">{t('productNotFound')}</p>
      <button onClick={d.handleBack} className="text-[10px] tracking-[0.2em] text-white/30 hover:text-white/70 uppercase flex items-center gap-2 transition-colors">
        <ArrowLeft className="size-3"/> {t('back')}
      </button>
    </div>
  );

  return (
    <div className="bg-[#0C0F1A] min-h-screen" dir={dir}>
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
                  <span className="text-[10px] tracking-[0.3em] uppercase text-white/30">{t('outOfStock')}</span>
                </div>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="lg:w-[420px] shrink-0 flex flex-col gap-8">
            {p.category && <span className="text-[9px] tracking-[0.4em] uppercase text-white/20">{p.category}</span>}
            <h1 className="text-3xl sm:text-4xl font-light text-white leading-tight tracking-wide" style={{ fontFamily: '"Playfair Display", serif' }}>{p.name}</h1>

            <div className="flex items-baseline gap-6">
              <span className="text-2xl font-light tabular-nums" style={{ color: primary }}>{formatPrice(p.price)}</span>
              {p.compare_price !== null && p.compare_price > p.price && <span className="text-sm text-white/20 line-through">{formatPrice(p.compare_price)}</span>}
            </div>

            {p.description && (
              <div className="border-t border-white/5 pt-8">
                <p className="text-sm text-white/40 leading-[1.9] font-light">{p.description}</p>
              </div>
            )}

            {/* Variants */}
            {p.variants && p.variants.length > 0 && (
              <div className="space-y-6 border-t border-white/5 pt-8">
                {colorVariants.length > 0 && (
                  <div className="space-y-2.5">
                    <p className="text-[9px] tracking-[0.35em] uppercase text-white/25">
                      {t('color')} : <span className="text-white/60 normal-case font-light tracking-wider">{p.variants.find(x => x.value === activeVariantVal)?.name?.toLowerCase().includes('couleur') || p.variants.find(x => x.value === activeVariantVal)?.color ? activeVariantVal : ''}</span>
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {colorVariants.map(v => {
                        const isSelected = activeVariantVal === v.value;
                        return (
                          <button
                            key={v.value}
                            type="button"
                            onClick={() => handleSelectVariant(v.value)}
                            className={cn(
                              "relative size-8 rounded-full border transition-all hover:scale-105 active:scale-95 flex items-center justify-center",
                              isSelected ? "border-[#b8964e] ring-1 ring-offset-2 ring-offset-[#0C0F1A] ring-[#b8964e]" : "border-white/10"
                            )}
                            style={{ backgroundColor: v.color }}
                            title={v.value}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {textVariants.length > 0 && (
                  <div className="space-y-2.5">
                    <p className="text-[9px] tracking-[0.35em] uppercase text-white/25">
                      {t('optionSize')} : <span className="text-white/60 normal-case font-light tracking-wider">{!(p.variants.find(x => x.value === activeVariantVal)?.name?.toLowerCase().includes('couleur') || p.variants.find(x => x.value === activeVariantVal)?.color) ? activeVariantVal : ''}</span>
                    </p>
                    <div className="flex flex-wrap gap-2.5">
                      {textVariants.map(v => {
                        const isSelected = activeVariantVal === v.value;
                        return (
                          <button
                            key={v.value}
                            type="button"
                            onClick={() => handleSelectVariant(v.value)}
                            className={cn(
                              "px-5 py-2 text-[10px] tracking-[0.15em] uppercase border transition-all active:scale-95 font-light",
                              isSelected 
                                ? "bg-white border-white text-black font-normal" 
                                : "bg-transparent border-white/10 text-white/40 hover:border-white/30 hover:text-white"
                            )}
                          >
                            {v.value}
                            {(v.priceModifier ?? 0) > 0 && <span className="text-[9px] opacity-60 ml-1">+{formatPrice(v.priceModifier ?? 0)}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}


            {/* Quantity Selector & Wishlist */}
            <div className="space-y-4 pt-4 border-t border-white/5">
              <div className="flex items-center gap-4">
                <div className="flex items-center border border-white/10">
                  <button type="button" onClick={() => handleQuantityChange(Math.max(1, quantity - 1))} className="size-10 flex items-center justify-center text-white/20 hover:text-white/60 transition-colors"><Minus className="size-3"/></button>
                  <span className="w-12 text-center text-sm font-light text-white tabular-nums">{quantity}</span>
                  <button type="button" onClick={() => handleQuantityChange(quantity + 1)} className="size-10 flex items-center justify-center text-white/20 hover:text-white/60 transition-colors"><Plus className="size-3"/></button>
                </div>
                <button type="button" onClick={d.handleToggleWishlist}
                  className={`size-10 flex items-center justify-center border transition-all ${wishlisted ? 'border-red-400/30 text-red-400' : 'border-white/10 text-white/20 hover:text-white/40'}`}>
                  <Heart className="size-4" fill={wishlisted ? 'currentColor' : 'none'}/>
                </button>
              </div>
            </div>
              {!isOOS ? (
                <>
                  <button onClick={d.handleBuyNow}
                    className="w-full h-14 text-[10px] tracking-[0.35em] uppercase font-light text-black transition-all hover:brightness-95"
                    style={{ backgroundColor: primary }}>
                    {t('buyNow')}
                  </button>
                  <button disabled={isOOS} onClick={d.handleAddToCart}
                    className="w-full h-12 text-[10px] tracking-[0.25em] uppercase font-light text-white/40 border border-white/10 hover:border-white/20 hover:text-white/70 transition-all">
                    {d.addedToCart ? <><CheckCircle className="size-3 inline mr-1" />{t('added')}</> : t('addToCart')}
                  </button>
                </>
              ) : (
                <div className="w-full h-14 flex items-center justify-center text-[9px] tracking-[0.35em] uppercase text-white/15 border border-white/5">{t('outOfStock')}</div>
              )}

            {/* Trust */}
            <div className="flex items-center gap-3 pt-4 border-t border-white/5">
              <Truck className="size-3.5 shrink-0" style={{ color: primary }}/>
              <p className="text-[9px] tracking-[0.25em] uppercase text-white/20 font-light">{t('shippingPromoLuxe')}</p>
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
                <p className="text-[9px] tracking-[0.4em] uppercase mb-3" style={{ color: primary }}>{t('exclusiveSelection')}</p>
                <h2 className="text-2xl font-light text-white tracking-wide" style={{ fontFamily: '"Playfair Display", serif' }}>{t('relatedProducts')}</h2>
              </div>
              <button onClick={d.handleBack} className="text-[9px] tracking-[0.25em] uppercase text-white/20 hover:text-white/50 transition-colors flex items-center gap-1">{t('seeAll')} <ChevronRight className="size-3"/></button>
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
