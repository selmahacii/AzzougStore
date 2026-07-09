'use client';

import { useEffect, useState } from 'react';
import { Truck, Package } from 'lucide-react';
import { useCartStore } from '@/store/cart-store';
import { useAppStore } from '@/store/app-store';
import { CheckoutForm } from '@/components/storefront/checkout-form';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/use-translation';
import { FloatingLanguageSwitcher } from '@/components/storefront/floating-language-switcher';
import { optimizeCloudinaryUrl } from '@/lib/image-optimize';

interface DzCodRendererProps {
  data: any;
}

const COLOR_MAP: Record<string, string> = {
  'noir': '#2d3436',
  'noire': '#2d3436',
  'blanc': '#ffffff',
  'blanche': '#ffffff',
  'rouge': '#d63031',
  'bleu': '#0984e3',
  'bleue': '#0984e3',
  'vert': '#2ecc71',
  'verte': '#2ecc71',
  'jaune': '#f1c40f',
  'rose': '#e84393',
  'gris': '#7f8c8d',
  'grise': '#7f8c8d',
  'marron': '#a0522d',
  'orange': '#e67e22',
  'violet': '#9b59b6',
  'violette': '#9b59b6',
  'beige': '#f5f5dc',
  'black': '#2d3436',
  'white': '#ffffff',
  'red': '#d63031',
  'blue': '#0984e3',
  'green': '#2ecc71',
  'yellow': '#f1c40f',
  'pink': '#e84393',
  'gray': '#7f8c8d',
  'grey': '#7f8c8d',
  'brown': '#a0522d',
  'purple': '#9b59b6',
  'أسود': '#2d3436',
  'اسود': '#2d3436',
  'ابيض': '#ffffff',
  'أبيض': '#ffffff',
  'احمر': '#d63031',
  'أحمر': '#d63031',
  'ازرق': '#0984e3',
  'أزرق': '#0984e3',
  'اخضر': '#2ecc71',
  'أخضر': '#2ecc71',
  'اصفر': '#f1c40f',
  'أصفر': '#f1c40f',
  'وردي': '#e84393',
  'رمادي': '#7f8c8d',
  'بني': '#a0522d',
  'برتقالي': '#e67e22',
  'بنفسجي': '#9b59b6',
};

function getVariantColor(value: string, colorField?: string): string | null {
  if (colorField && colorField.startsWith('#')) return colorField;
  const val = value?.toLowerCase().trim() || '';
  return COLOR_MAP[val] || colorField || null;
}

export default function DzCodRenderer({ data }: DzCodRendererProps) {
  const [selectedVariants, setSelectedVariants] = useState<any[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [selectedOfferIndex, setSelectedOfferIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 });
  const [isZoomed, setIsZoomed] = useState(false);
  const { t, dir } = useTranslation();
  const [showStickyCta, setShowStickyCta] = useState(true);

  const primary = data.primary_color || '#E53935';
  const heroImage = data.image_url || data.product?.main_image;
  const price = data.price ?? data.product?.price ?? null;
  const comparePrice = data.compare_price ?? data.product?.compare_price ?? null;
  const productName = data.product_name || data.product?.name || data.headline;
  const productDesc = data.product_desc || data.product?.description;
  const discount = comparePrice && price ? Math.round((1 - price / comparePrice) * 100) : 0;

  const offers = (data as any).offers && (data as any).offers.length > 0 ? (data as any).offers : [
    { quantity: 1, price: price ?? 0, compare_price: comparePrice ?? 0, name: `1 ${t('piece')}`, desc: t('tryProduct') },
    { quantity: 2, price: (price ?? 0) * 2, compare_price: (comparePrice ?? 0) * 2, name: `2 ${t('pieces')}`, desc: t('profitOffer'), popular: true }
  ];

  useEffect(() => { 
    setMounted(true); 
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const el = document.getElementById('checkout-form-container');
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.top > window.innerHeight - 80) {
          setShowStickyCta(true);
        } else {
          setShowStickyCta(false);
        }
      } else {
        setShowStickyCta(true);
      }
    };

    handleScroll();

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const currentOffer = offers[selectedOfferIndex] || offers[0];
    setQuantity(currentOffer.quantity);
  }, [selectedOfferIndex, offers]);

  const galleryImages = (data.gallery && data.gallery.length > 0)
    ? data.gallery
    : (data.product?.images || []);

  useEffect(() => {
    if (data.product?.variants && data.product.variants.length > 0) {
      const grouped: Record<string, any[]> = {};
      data.product.variants.forEach((v: any) => {
        if (!grouped[v.name]) grouped[v.name] = [];
        grouped[v.name].push(v);
      });
      data.product.variants.forEach((v: any) => {
        if (v.sub_variants && v.sub_variants.length > 0) {
          const firstSub = v.sub_variants[0];
          if (firstSub && firstSub.name && !grouped[firstSub.name]) {
            grouped[firstSub.name] = [];
          }
        }
      });

      setSelectedVariants(prev => {
        const newVars = [...prev];
        while (newVars.length < quantity) {
          const itemSelection: Record<string, any> = {};
          Object.keys(grouped).forEach(name => {
            const mainVar = grouped[name]?.[0];
            if (mainVar) {
              itemSelection[name] = mainVar;
              if (mainVar.sub_variants && mainVar.sub_variants.length > 0) {
                const firstSub = mainVar.sub_variants[0];
                itemSelection[firstSub.name] = firstSub;
              }
            }
          });
          newVars.push(itemSelection);
        }
        return newVars.slice(0, quantity);
      });
    }
  }, [data.product, quantity]);

  useEffect(() => {
    const currentActiveStore = useAppStore.getState().activeStore;
    // Use data.store.slug (the actual store slug) not data.slug (the landing page slug)
    const correctStoreSlug = data.store?.slug || currentActiveStore?.slug || '';
    const correctStoreName = data.store?.name || data.headline || 'Boutique';
    if (!currentActiveStore || currentActiveStore.id !== data.store_id) {
      useAppStore.getState().setActiveStore({
        id: data.store_id,
        name: correctStoreName,
        description: data.subtitle || '',
        slug: correctStoreSlug,
        logo_url: data.store?.logo_url || null,
        template_id: 'dz_cod',
        theme_config: { primaryColor: data.primary_color || '#E53935', templateId: 'dz_cod' },
      } as any);
    } else {
      useAppStore.getState().setActiveStore({
        ...currentActiveStore,
        slug: correctStoreSlug || currentActiveStore.slug,
        theme_config: { ...currentActiveStore.theme_config, templateId: 'dz_cod' }
      } as any);
    }
  }, [data]);

  useEffect(() => {
    const currentOffer = (offers && offers.length > 0) ? (offers[selectedOfferIndex] || offers[0]) : null;
    const qty = currentOffer ? currentOffer.quantity : quantity;

    // ── Case 1: Landing page WITH a linked product ────────────────────────────
    if (data.product) {
      let variantDetails: string | undefined = undefined;
      if (selectedVariants.length > 0) {
        variantDetails = selectedVariants.map((itemSelection, i) => {
          if (!itemSelection) return '';
          const parts = Object.keys(itemSelection)
            .map(name => { const v = itemSelection[name]; return v ? `${v.name}: ${v.value}` : ''; })
            .filter(Boolean).join(', ');
          return qty > 1 ? `P${i+1}: ${parts}` : parts;
        }).filter(Boolean).join(' | ');
      }
      const offerPrice = currentOffer ? currentOffer.price : (data.product.price || 0);
      const unitPrice = currentOffer ? Math.round(offerPrice / qty) : (data.product.price || 0);
      const selectedVarWithImg = Object.values(selectedVariants[0] || {}).find((v: any) => v?.image);
      const pImage = (selectedVarWithImg as any)?.image || heroImage || data.product.main_image;
      const cartItems = useCartStore.getState().items;
      const isMatched = cartItems.length === 1 &&
        cartItems[0]?.product?.id === data.product.id &&
        cartItems[0]?.selectedVariant === variantDetails &&
        cartItems[0]?.quantity === qty &&
        cartItems[0]?.customPrice === unitPrice;
      if (!isMatched) {
        useCartStore.getState().clearCart();
        useCartStore.getState().addItem(
          { ...data.product, price: unitPrice, main_image: pImage, sku: (selectedVarWithImg as any)?.sku || (data.product as any).sku } as any,
          qty, variantDetails, undefined, unitPrice
        );
      }
      return;
    }

    // ── Case 2: Standalone landing page (no linked product) ──────────────────
    // Build a synthetic product from landing page data so order submission works
    const unitPrice = currentOffer ? Math.round(currentOffer.price / qty) : (data.price || 0);
    const syntheticProduct = {
      id: data.id,  // Use LP id as product_id — backend now accepts optional product_id
      name: data.product_name || data.headline || 'Produit',
      slug: data.slug,
      price: unitPrice,
      compare_price: data.compare_price,
      main_image: heroImage,
      images: [],
      description: data.subtitle || '',
      variants: null,
      stock: 999,
    };
    const cartItems = useCartStore.getState().items;
    const isMatched = cartItems.length === 1 &&
      cartItems[0]?.product?.id === syntheticProduct.id &&
      cartItems[0]?.quantity === qty &&
      cartItems[0]?.customPrice === unitPrice;
    if (!isMatched) {
      useCartStore.getState().clearCart();
      useCartStore.getState().addItem(syntheticProduct as any, qty, undefined, undefined, unitPrice);
    }
  }, [data.product, data.id, data.price, data.product_name, data.headline, data.slug, data.subtitle, heroImage, selectedVariants, selectedOfferIndex, offers, quantity]);

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] text-slate-900">
        <div className="size-8 rounded-full border-2 border-slate-200 border-t-red-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-12" dir={dir}>
      <FloatingLanguageSwitcher primaryColor={primary} />
      {/* ── TOP RED BANNER ── */}
      <div className="w-full text-center py-2.5 text-sm font-bold text-white shadow-sm flex items-center justify-center gap-2" style={{ backgroundColor: primary }}>
        <span>{t('fastDelivery')}</span>
        <Truck className="size-4" />
        <span>{t('codFast')}</span>
        <Package className="size-4" />
      </div>

      <div className="max-w-[700px] mx-auto bg-white shadow-lg min-h-screen flex flex-col">
        {/* Centered Logo Header */}
        <header className="w-full py-4 border-b flex items-center justify-center bg-white border-slate-100 relative shrink-0">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
            {(data.store?.logo_url || data.product?.store?.logo_url) ? (
              <img
                src={optimizeCloudinaryUrl(data.store?.logo_url || data.product?.store?.logo_url || '', 150)}
                alt={data.headline || 'Logo'}
                className="h-11 sm:h-12 w-auto object-contain max-h-[48px] transition-all"
                onError={(e) => { 
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  const sibling = target.nextElementSibling as HTMLElement;
                  if (sibling) sibling.style.display = 'block';
                }}
              />
            ) : null}
            <span 
              className="text-lg font-black tracking-tight uppercase" 
              style={{ 
                color: primary, 
                display: (data.store?.logo_url || data.product?.store?.logo_url) ? 'none' : 'block' 
              }}
            >
              {data.headline || 'Boutique'}
            </span>
          </div>
        </header>
        
        {/* Main Image with Zoom and Inset Badge */}
        {heroImage && (() => {
          const selectedVarWithImg = Object.values(selectedVariants[0] || {}).find((v: any) => v?.image);
          const mainImgSrc = (selectedVarWithImg as any)?.image || heroImage;
          const insetImgSrc = galleryImages.find(img => img !== mainImgSrc) || galleryImages[0] || null;

          return (
            <div 
              className="w-full relative overflow-hidden cursor-zoom-in group"
              onMouseMove={(e) => {
                const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
                const x = ((e.clientX - left) / width) * 100;
                const y = ((e.clientY - top) / height) * 100;
                setZoomPos({ x, y });
                setIsZoomed(true);
              }}
              onMouseLeave={() => setIsZoomed(false)}
            >
              <img
                src={optimizeCloudinaryUrl(mainImgSrc, 800)}
                alt={productName || ''}
                className="w-full h-auto transition-transform duration-100 ease-out"
                style={{
                  transformOrigin: `${zoomPos.x}% ${zoomPos.y}%`,
                  transform: isZoomed ? 'scale(2)' : 'scale(1)'
                }}
                // This is the LCP element on the landing page — fetch it eagerly
                // and at high priority instead of the browser's default
                // discovery order (Lighthouse: "Requêtes de blocage du rendu").
                loading="eager"
                fetchPriority="high"
                decoding="async"
              />

              {/* Circular Inset Badge on Top-Right */}
              {insetImgSrc && (
                <div className="absolute top-4 right-4 z-10 flex items-center gap-1 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-full shadow-md border border-slate-200/50 select-none scale-90 sm:scale-100 origin-top-right">
                  <span className="text-sm font-bold text-slate-800">+</span>
                  <div className="size-10 sm:size-12 rounded-full overflow-hidden border border-slate-300">
                    <img src={optimizeCloudinaryUrl(insetImgSrc, 100)} className="size-full object-cover" alt="detail" loading="lazy" decoding="async" />
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Variant Image Thumbnails */}
        {(() => {
          const variantImages: any[] = [];
          const seen = new Set();
          if (data.product?.variants) {
            data.product.variants.forEach((v: any) => {
              if (v.image && !seen.has(v.image)) {
                seen.add(v.image);
                variantImages.push(v);
              }
            });
          }

          if (variantImages.length === 0) return null;

          return (
            <div className="flex gap-2.5 p-3 overflow-x-auto justify-center sm:justify-start bg-slate-50 border-b border-slate-100">
              {variantImages.map((v: any, i: number) => {
                const isSelected = selectedVariants.some(sv => Object.values(sv).some((val: any) => val?.value === v.value));
                const colorHex = getVariantColor(v.value, v.color);
                const imgStyle = v.image || data.product?.main_image || heroImage;
                
                return (
                  <button 
                    key={i}
                    type="button"
                    onClick={() => {
                      setSelectedVariants(prev => prev.map(itemSelection => {
                        const subSelection: Record<string, any> = {
                          [v.name]: v
                        };
                        if (v.sub_variants && v.sub_variants.length > 0) {
                          const firstSub = v.sub_variants[0];
                          subSelection[firstSub.name] = firstSub;
                        }
                        return {
                          ...itemSelection,
                          ...subSelection
                        };
                      }));
                    }}
                    className={cn(
                      "relative size-12 sm:size-14 rounded-full border-2 transition-all active:scale-95 flex items-center justify-center p-0.5 bg-white shadow-sm",
                      isSelected ? "ring-2 ring-offset-1 ring-slate-800/20" : "border-slate-200 hover:border-slate-300"
                    )}
                    style={{
                      borderColor: isSelected ? primary : '#e2e8f0'
                    }}
                    title={v.value}
                  >
                    {imgStyle ? (
                      <img src={optimizeCloudinaryUrl(imgStyle, 100)} className="size-full rounded-full object-cover" alt={v.value} loading="lazy" decoding="async" />
                    ) : (
                      <div className="size-full rounded-full" style={{ backgroundColor: colorHex || '#ccc' }} />
                    )}

                    {isSelected && (
                      <div 
                        className="absolute -top-1 -right-1 size-5 rounded-full flex items-center justify-center text-white text-[10px] font-black shadow-sm border border-white"
                        style={{ backgroundColor: primary }}
                      >
                        ✓
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })()}

        <div className="p-4 sm:p-6 lg:p-8">
          {/* Title & Price */}
          <div className="mb-6">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 leading-snug mb-2">
              {productName}
            </h1>
            {price !== null && (() => {
              const currentPrice = offers[selectedOfferIndex]?.price || (selectedVariants[0]?.price || price);
              const currentComparePrice = offers[selectedOfferIndex]?.compare_price || comparePrice;
              return (
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-black" style={{ color: primary }}>{formatPrice(currentPrice)}</span>
                  {currentComparePrice !== null && currentComparePrice > currentPrice && (
                    <span className="text-sm line-through text-slate-400 font-medium">{formatPrice(currentComparePrice)}</span>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Form Box */}
          <div className="bg-[#f8f9fa] border-2 border-dashed border-gray-300 rounded-xl p-4 sm:p-6 mb-8 relative">
             <div className="text-center mb-6">
                <span className="bg-[#f8f9fa] px-4 font-bold text-slate-800 text-sm">{t('confirmTitle')}</span>
             </div>

              {/* Variants & Quantity Box */}
              <div className="mb-6 space-y-4 border-b border-gray-200 pb-6">
                {data.product?.variants && data.product.variants.length > 0 && (() => {
                  const grouped: Record<string, any[]> = {};
                  data.product.variants.forEach((v: any) => {
                    if (!grouped[v.name]) grouped[v.name] = [];
                    grouped[v.name].push(v);
                  });

                  return (
                    <div className="space-y-5">
                      {Array.from({ length: quantity }).map((_, itemIndex) => {
                        const itemSelection = selectedVariants[itemIndex] || {};
                        return (
                           <div key={itemIndex} className="p-3.5 rounded-2xl bg-[#f8f9fa] border border-slate-200/50 space-y-4 text-start">
                             {quantity > 1 && (
                               <span className="text-xs font-black uppercase tracking-wider text-start block border-b pb-2 mb-2 border-slate-200/50 text-slate-800">
                                 {dir === 'rtl' ? `المنتج #${itemIndex + 1}` : `Produit #${itemIndex + 1}`}
                               </span>
                             )}
                             
                             {Object.keys(grouped).filter(optionName => grouped[optionName] && grouped[optionName].length > 0).map(optionName => {
                               const optionVariants = grouped[optionName];
                               const selectedVal = itemSelection[optionName]?.value;
                               // Look up the live variant object from data (not state) to ensure sub_variants are present
                               const selectedMainVar = selectedVal
                                 ? optionVariants.find((v: any) => v.value === selectedVal) ?? itemSelection[optionName]
                                 : itemSelection[optionName];
                               const isColorOption = optionName.toLowerCase().includes('couleur') || optionName.toLowerCase().includes('color') || optionVariants.some((v: any) => v.color);

                               return (
                                 <div key={optionName} className="space-y-4">
                                   <div className="flex flex-col gap-2">
                                     <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 text-start">
                                       {optionName}: <span className="text-slate-800 font-black">
                                         {selectedVal || '—'}
                                         {selectedMainVar && ` (${(selectedMainVar.stock || 0) - (selectedMainVar.reserved || 0)} en stock)`}
                                       </span>
                                     </label>
                                     <div className="flex flex-wrap gap-2.5">
                                       {optionVariants.map((v: any, i: number) => {
                                         const isSelected = selectedVal === v.value;
                                         const isOutOfStock = ((v.stock || 0) - (v.reserved || 0)) <= 0;
                                         const colorHex = getVariantColor(v.value, v.color);
                                         const isCircle = isColorOption || !!(v.image || v.color || colorHex);

                                         return (
                                           <button
                                             key={`var-${itemIndex}-${optionName}-${v.id || i}`}
                                             type="button"
                                             disabled={isOutOfStock}
                                             onClick={() => {
                                               setSelectedVariants(prev => {
                                                 const next = [...prev];
                                                 const subSelection = {
                                                   [optionName]: v
                                                 };
                                                 if (v.sub_variants && v.sub_variants.length > 0) {
                                                   const firstSub = v.sub_variants[0];
                                                   subSelection[firstSub.name] = firstSub;
                                                 }
                                                 next[itemIndex] = {
                                                   ...next[itemIndex],
                                                   ...subSelection
                                                 };
                                                 return next;
                                               });
                                             }}
                                             className={cn(
                                               "relative flex items-center justify-center border-2 transition-all shadow-sm active:scale-95",
                                               isCircle ? "size-11 rounded-full p-0.5 bg-white" : "px-4 py-2 h-9 rounded-xl text-xs font-bold",
                                               isSelected
                                                 ? "border-slate-900 ring-2 ring-offset-2 ring-slate-800/20"
                                                 : "border-slate-200 hover:border-slate-400 bg-white",
                                               isOutOfStock && "opacity-40 cursor-not-allowed"
                                             )}
                                             style={{
                                               borderColor: isSelected ? '#0f172a' : undefined,
                                             }}
                                             title={v.value}
                                           >
                                             {isCircle ? (
                                               colorHex ? (
                                                 <div className="size-full rounded-full border border-black/10" style={{ backgroundColor: colorHex }} />
                                               ) : v.image ? (
                                                 <img src={optimizeCloudinaryUrl(v.image, 100)} alt={v.value} className="size-full object-cover rounded-full" loading="lazy" decoding="async" />
                                               ) : (
                                                 <span className="text-[10px] font-bold text-slate-900">{v.value}</span>
                                               )
                                             ) : (
                                               <span className="font-bold text-slate-700 flex flex-col items-center">
                                                 <span>{v.value}</span>
                                                 <span className="text-[8px] text-slate-400 font-normal mt-0.5">({(v.stock || 0) - (v.reserved || 0)})</span>
                                               </span>
                                             )}

                                             {isSelected && isCircle && (
                                               <span className="absolute -top-1 -right-1 size-4 rounded-full flex items-center justify-center text-[8px] text-white font-bold shadow-md border border-white" style={{ backgroundColor: '#0f172a' }}>
                                                 ✓
                                               </span>
                                             )}

                                             {isOutOfStock && (
                                               <div className="absolute inset-0 bg-black/10 rounded-full flex items-center justify-center">
                                                 <span className="text-red-500 font-bold text-xs">✕</span>
                                               </div>
                                             )}
                                           </button>
                                         );
                                       })}
                                     </div>
                                   </div>

                                   {/* Render sub-variants (like sizes) when the main option is selected */}
                                   {selectedMainVar?.sub_variants && selectedMainVar.sub_variants.length > 0 && (() => {
                                     const subName = selectedMainVar.sub_variants[0].name || "Option";
                                     const selectedSubVal = itemSelection[subName]?.value;
                                     return (
                                       <div className="flex flex-col gap-2 mt-3">
                                         <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 text-start">
                                           {subName}: <span className="text-slate-800 font-black">{selectedSubVal || '—'}</span>
                                         </label>
                                         <div className="flex flex-wrap gap-2">
                                           {selectedMainVar.sub_variants.map((sv: any, i: number) => {
                                             const isSelected = selectedSubVal === sv.value;
                                             const isOutOfStock = ((sv.stock || 0) - (sv.reserved || 0)) <= 0;
                                             return (
                                               <button
                                                 key={`sub-${itemIndex}-${subName}-${sv.value || i}`}
                                                 type="button"
                                                 disabled={isOutOfStock}
                                                 onClick={() => {
                                                   setSelectedVariants(prev => {
                                                     const next = [...prev];
                                                     next[itemIndex] = {
                                                       ...next[itemIndex],
                                                       [subName]: sv
                                                     };
                                                     return next;
                                                   });
                                                 }}
                                                 className={cn(
                                                   "px-4 py-2 h-9 rounded-xl text-xs font-bold border-2 transition-all shadow-sm active:scale-95 flex flex-col items-center justify-center min-w-[50px]",
                                                   isSelected
                                                     ? "border-slate-900 ring-2 ring-offset-2 ring-slate-800/20"
                                                     : "border-slate-200 hover:border-slate-400 bg-white",
                                                   isOutOfStock && "opacity-40 cursor-not-allowed"
                                                 )}
                                               >
                                                 <span className="font-bold text-slate-700">{sv.value}</span>
                                                 <span className="text-[8px] text-slate-400 font-normal mt-0.5">({(sv.stock || 0) - (sv.reserved || 0)})</span>
                                               </button>
                                             );
                                           })}
                                         </div>
                                       </div>
                                     );
                                   })()}
                                 </div>
                               );
                             })}
                           </div>
                        );
                      })}
                    </div>
                  );
                })()}
                
                {/* Quantity or Offer selector */}
                {(!offers || offers.length === 0) ? (
                  <div className="flex flex-col gap-1.5 text-start">
                    <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{t('chooseQuantity') || 'Quantité'}</label>
                    <div className="flex items-center gap-3 bg-white p-2 rounded-xl border max-w-[140px] shadow-sm">
                      <button
                        type="button"
                        onClick={() => setQuantity(Math.max(1, quantity - 1))}
                        className="size-8 flex items-center justify-center rounded-lg hover:bg-slate-100 font-bold border"
                      >
                        -
                      </button>
                      <span className="flex-1 text-center font-bold text-sm">{quantity}</span>
                      <button
                        type="button"
                        onClick={() => setQuantity(quantity + 1)}
                        className="size-8 flex items-center justify-center rounded-lg hover:bg-slate-100 font-bold border"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5 text-start">
                    <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{t('chooseQuantity')}</label>
                    <div className="grid grid-cols-1 gap-2.5">
                      {offers.map((offer: any, idx: number) => {
                        const isSelected = selectedOfferIndex === idx;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setSelectedOfferIndex(idx);
                              setQuantity(offer.quantity);
                            }}
                          className={cn(
                            "p-3 rounded-lg border-2 text-left transition-all relative flex items-center justify-between",
                            isSelected
                              ? "bg-red-50/50 border-red-500 font-bold"
                              : "bg-white border-gray-200 hover:border-gray-300"
                          )}
                          style={isSelected ? { borderColor: primary, backgroundColor: `${primary}08` } : {}}
                        >
                          <div>
                            <span className="text-sm text-slate-900 font-bold">
                              {offer.name || `${offer.quantity} ${offer.quantity > 1 ? t('pieces') : t('piece')}`}
                            </span>
                            {offer.desc && (
                              <span className="block text-[11px] text-slate-500 font-medium">{offer.desc}</span>
                            )}
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-black" style={{ color: primary }}>{formatPrice(offer.price)}</span>
                            {offer.compare_price > offer.price && (
                              <span className="block text-[10px] line-through text-slate-400">{formatPrice(offer.compare_price)}</span>
                            )}
                          </div>
                         </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

             {/* Checkout Form */}
             <div id="checkout-form-container">
               <div className="text-center mb-6 px-4">
                 <p className="text-lg sm:text-xl font-black text-slate-900 tracking-wide leading-relaxed">
                   للطلب، يرجى ادخال معلوماتك هنا
                 </p>
                 <div className="w-16 h-1 mx-auto mt-2 rounded-full animate-pulse" style={{ backgroundColor: primary }} />
               </div>
               <CheckoutForm isInline={true} forceTemplate="dz_cod" />
             </div>

             {/* Publicity Banner */}
             {data.banner_image_url && (
               <div className="mt-6">
                 <img src={optimizeCloudinaryUrl(data.banner_image_url, 700)} alt="Bannière publicitaire" className="w-full h-auto rounded-2xl shadow-md" loading="lazy" decoding="async" />
               </div>
             )}
          </div>

          {/* Long Description Image / Content removed */}
        </div>
      </div>

      {/* Sticky Bottom CTA on Mobile */}
      <div className="fixed bottom-0 left-0 right-0 z-40 p-3 bg-white/90 dark:bg-black/90 backdrop-blur-md border-t border-slate-200/60 dark:border-white/10 flex justify-center items-center shadow-[0_-8px_30px_rgb(0,0,0,0.12)] md:hidden">
        <button
          onClick={() => {
            const el = document.getElementById('checkout-form-container');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }}
          className="w-full py-3.5 rounded-xl text-white font-black uppercase tracking-wider text-xs shadow-md active:scale-[0.97] transition-all flex items-center justify-center gap-2"
          style={{ backgroundColor: primary }}
        >
          <Package className="size-4" />
          <span>اضغط هنا للطلب</span>
        </button>
      </div>

    </div>
  );
}
