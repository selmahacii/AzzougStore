'use client';

import { useEffect, useState } from 'react';
import {
  ShieldCheck, Truck, RotateCcw, Star, Phone,
  CheckCircle, CheckCheck, ChevronDown, ChevronUp, ArrowRight,
  ShoppingBag, Check,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useCartStore } from '@/store/cart-store';
import { useAppStore } from '@/store/app-store';
import { CheckoutForm } from '@/components/storefront/checkout-form';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/use-translation';
import { FloatingLanguageSwitcher } from '@/components/storefront/floating-language-switcher';
import { trackMetaEvent } from '@/lib/meta-tracking';
import { optimizeCloudinaryUrl } from '@/lib/image-optimize';
import { captureAttribution } from '@/lib/attribution';

interface LpData {
  id: string;
  store_id: string;
  slug: string;
  headline: string;
  subtitle: string;
  badge_text: string;
  cta_label: string;
  cta2_label: string;
  cta_headline?: string | null;
  cta_subtitle?: string | null;
  image_url: string | null;
  video_url: string | null;
  product_name: string | null;
  product_desc: string | null;
  price: number | null;
  compare_price: number | null;
  primary_color: string;
  template: string;
  benefits: { icon: string; title: string; desc: string }[];
  testimonials: { name: string; location: string; text: string; stars: number; avatar?: string }[];
  steps: { step: string; title: string; desc: string }[];
  stats: { value: number; suffix: string; label: string }[];
  faq: { question: string; answer: string }[];
  gallery: string[];
  phone: string | null;
  banner_image_url?: string | null;
  product: {
    id: string; name: string; slug: string;
    price: number; compare_price: number | null;
    main_image: string | null; images: string[];
    description: string;
    variants: any[] | null;
    stock: number;
  } | null;
  store?: {
    id: string;
    name: string;
    logo_url: string | null;
    slug: string;
  } | null;
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

const getExpandedVariants = (selected: any[], count: number) => {
  if (!selected || selected.length === 0) return [];
  const res: any[] = [];
  for (let i = 0; i < count; i++) {
    res.push(selected[i % selected.length]);
  }
  return res;
};

export default function LandingPageRenderer({ data }: { data: LpData }) {
  const activeStore = useAppStore((s) => s.activeStore);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [selectedVariants, setSelectedVariants] = useState<any[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [selectedOfferIndex, setSelectedOfferIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 });
  const [isZoomed, setIsZoomed] = useState(false);
  const { t, dir, setLocale } = useTranslation();
  const [showNavbar, setShowNavbar] = useState(true);
  const [showStickyCta, setShowStickyCta] = useState(true);

  useEffect(() => {
    setMounted(true);
    if (setLocale) {
      setLocale('ar');
    }
    // Landing pages are where paid-traffic clicks actually land (the URL
    // still carries utm_*/fbclid here) — captureAttribution() was built but
    // never called anywhere, so every order shipped with fully empty
    // utm_source/campaign_id/fbclid columns despite the backend already
    // supporting and storing them end-to-end.
    captureAttribution();
  }, [setLocale]);

  // Meta Pixel + CAPI ViewContent — once per landing page product. A stable
  // eventId (not time-based) so meta-tracking.ts's own sessionStorage dedup
  // catches a re-render/refresh instead of re-firing.
  useEffect(() => {
    const pid = data?.product?.id || (data as any)?.product_id;
    if (!pid || !activeStore?.id) return;
    void trackMetaEvent('ViewContent', {
      content_ids: [String(pid)],
      content_name: data.product_name || data.product?.name || data.headline,
      content_type: 'product',
      value: Number(data.price ?? data.product?.price ?? 0) || undefined,
    }, { storeId: activeStore.id, eventId: `viewcontent-lp-${pid}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.product?.id, activeStore?.id]);

  useEffect(() => {
    let lastScrollY = window.scrollY;
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      // Navbar visibility
      if (currentScrollY > lastScrollY && currentScrollY > 50) {
        setShowNavbar(false);
      } else {
        setShowNavbar(true);
      }
      lastScrollY = currentScrollY;

      // Sticky CTA visibility
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

  const handleSelectVariant = (variant: any) => {
    setSelectedVariants(prev => {
      return prev.map(itemSelection => {
        const subSelection: Record<string, any> = {
          [variant.name]: variant
        };
        if (variant.sub_variants && variant.sub_variants.length > 0) {
          const firstSub = variant.sub_variants[0];
          subSelection[firstSub.name] = firstSub;
        }
        return {
          ...itemSelection,
          ...subSelection
        };
      });
    });
  };

  const handleSelectVariantForIndex = (variant: any, itemIndex: number) => {
    setSelectedVariants(prev => {
      const next = [...prev];
      const subSelection: Record<string, any> = {
        [variant.name]: variant
      };
      if (variant.sub_variants && variant.sub_variants.length > 0) {
        const firstSub = variant.sub_variants[0];
        subSelection[firstSub.name] = firstSub;
      }
      next[itemIndex] = {
        ...next[itemIndex],
        ...subSelection
      };
      return next;
    });
  };

  useEffect(() => {
    const currentActiveStore = useAppStore.getState().activeStore;
    if (!currentActiveStore || currentActiveStore.id !== data.store_id) {
      useAppStore.getState().setActiveStore({
        id: data.store_id,
        name: data.store?.name || data.headline || 'Boutique',
        description: data.subtitle || '',
        slug: data.store?.slug || data.slug,
        logo_url: data.store?.logo_url,
        template_id: data.template || 'clean',
        theme_config: {
          primaryColor: data.primary_color,
          templateId: data.template || 'clean',
        },
      } as any);
    }
  }, [data]);

  const primary = data.primary_color || '#e84393';
  const isTestErp = data.slug === 'test-produit-erp';
  const isDark = isTestErp ? false : (data.template === 'premium' || data.template === 'dark');

  const heroImage = data.image_url || data.product?.main_image;
  const price = data.price ?? data.product?.price ?? null;
  const comparePrice = data.compare_price ?? data.product?.compare_price ?? null;
  const productName = data.product_name || data.product?.name || data.headline;
  const productDesc = data.product_desc || data.product?.description;
  const discount = comparePrice && price ? Math.round((1 - price / comparePrice) * 100) : 0;

  // Une landing page n'a pas TOUJOURS d'offre par palier configurée — quand
  // le champ Offres est laissé vide côté admin, le client doit pouvoir
  // choisir librement la quantité de chaque variante (pas de palier imposé),
  // au lieu de forcer un choix entre deux paliers fictifs "1 pièce"/"2 pièces".
  const hasRealOffers = !!((data as any).offers && (data as any).offers.length > 0);
  const offers = hasRealOffers ? (data as any).offers : [];
  // Plafond de commande = stock total disponible sur le premier groupe de
  // variantes (ex: toutes les couleurs) — un client ne doit jamais pouvoir
  // choisir une quantité au-delà de ce que le stock permet réellement de
  // livrer, avec ou sans offre par palier. `undefined` = pas de variantes
  // suivies en stock sur ce produit → pas de plafond connu, pas de blocage.
  const maxOrderableQuantity = (() => {
    const variants = data.product?.variants;
    if (!variants || variants.length === 0) {
      // Produit SANS variantes suivies (le cas le plus courant) — le
      // plafond doit venir du stock du produit lui-même, pas rester
      // "undefined" (= aucun plafond). Sans ce fallback, un client pouvait
      // incrémenter le stepper de quantité au-delà du stock réel
      // (confirmé en prod : 20 en stock, commande passée à 21).
      // GET /landing-pages/slug/{slug} only ever sends the raw `stock`
      // figure for a non-variant product (no reserved_stock field in this
      // payload) — the backend's own reserve_stock() is still the
      // authoritative gate at order-creation time regardless; this is a
      // client-side UX guard, not the source of truth.
      const p = data.product as any;
      if (!p) return undefined;
      const available = Math.max(0, p.stock || 0);
      return available > 0 ? available : undefined;
    }
    const firstGroupName = variants[0]?.name;
    const firstGroupOptions = variants.filter((v: any) => v.name === firstGroupName);
    const total = firstGroupOptions.reduce((sum: number, v: any) => sum + Math.max(0, (v.stock || 0) - (v.reserved || 0)), 0);
    return total > 0 ? total : undefined;
  })();
  const currentOffer = hasRealOffers
    ? (offers[selectedOfferIndex] || offers[0])
    : {
        quantity,
        price: (price ?? 0) * quantity,
        compare_price: (comparePrice ?? 0) * quantity,
        name: `${quantity} ${quantity > 1 ? t('pieces') : t('piece')}`,
      };

  useEffect(() => {
    // Le stepper +/- n'est pas le SEUL moyen de fixer la quantité — un
    // palier d'offre configuré côté admin (ex: "pack de 30") la fixe
    // directement via selectedOfferIndex, en contournant totalement le
    // plafond du stepper. Un seul point de vérité : quelle que soit la
    // source, la quantité ajoutée au panier ne dépasse jamais le stock
    // disponible (bug confirmé en prod : un palier configuré au-delà du
    // stock réel restait commandable).
    const qty = maxOrderableQuantity !== undefined
      ? Math.min(currentOffer.quantity, maxOrderableQuantity)
      : currentOffer.quantity;

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
      const offerPrice = currentOffer.price;
      const unitPrice = Math.round(offerPrice / qty);
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
    const unitPrice = Math.round(currentOffer.price / qty);
    const syntheticProduct = {
      id: data.id,
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
  }, [data.product, data.id, data.price, data.product_name, data.headline, data.slug, data.subtitle, heroImage, selectedVariants, selectedOfferIndex, offers, quantity, currentOffer.price, currentOffer.quantity, maxOrderableQuantity]);

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] text-slate-900 font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="size-8 rounded-full border-2 border-slate-200 border-t-slate-800 animate-spin" />
        </div>
      </div>
    );
  }

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const headerOffset = 70; // height of the sticky header
      const elementPosition = el.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
      window.scrollTo({
        top: offsetPosition,
        behavior: 'auto' // Instant navigation for excellent speed
      });
    }
  };

  const handleOrder = () => {
    scrollToSection('checkout-form-container');
  };

  return (
    <div className={cn("min-h-screen font-sans", isDark ? "bg-[#050505] text-white" : "bg-[#FAFAFA] text-slate-900")} dir={dir}>
      <FloatingLanguageSwitcher primaryColor={primary} />
      
      {/* MINIMALIST HEADER WITH STORE LOGO & NAVIGATION */}
      <header className={cn(
        "w-full py-3 border-b flex items-center justify-center sticky top-0 z-45 backdrop-blur-md shadow-sm transition-all duration-355 ease-in-out",
        isDark ? "bg-black/90 border-white/5" : "bg-white/95 border-slate-100/80",
        showNavbar ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none"
      )}>
        <div className="max-w-[1200px] w-full px-4 flex items-center justify-between relative h-10">
          {/* Left Side Placeholder */}
          <div className="w-10 sm:w-20" />

          {/* Logo Centered */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
            {(data.store?.logo_url || activeStore?.logo_url) ? (
              <img
                src={optimizeCloudinaryUrl(data.store?.logo_url || activeStore?.logo_url || '', 150)}
                alt={data.store?.name || activeStore?.name || 'Logo'}
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
                display: (data.store?.logo_url || activeStore?.logo_url) ? 'none' : 'block' 
              }}
            >
              {data.store?.name || activeStore?.name || 'Boutique'}
            </span>
          </div>

          {/* Navigation Links in Center (Desktop) */}
          <nav className="hidden md:flex items-center gap-6">
            <button 
              onClick={() => scrollToSection('presentation-section')}
              className={cn("text-xs font-black uppercase tracking-wider transition-all hover:opacity-100 opacity-60", isDark ? "text-white" : "text-slate-700")}
            >
              {dir === 'rtl' ? 'المنتج' : (t('presentation') || 'Présentation')}
            </button>
            {data.testimonials && data.testimonials.length > 0 && (
              <button 
                onClick={() => scrollToSection('testimonials-section')}
                className={cn("text-xs font-black uppercase tracking-wider transition-all hover:opacity-100 opacity-60", isDark ? "text-white" : "text-slate-700")}
              >
                {dir === 'rtl' ? 'آراء العملاء' : (t('customerReviews') || 'Avis')}
              </button>
            )}
            {data.faq && data.faq.length > 0 && (
              <button 
                onClick={() => scrollToSection('faq-section')}
                className={cn("text-xs font-black uppercase tracking-wider transition-all hover:opacity-100 opacity-60", isDark ? "text-white" : "text-slate-700")}
              >
                {dir === 'rtl' ? 'الأسئلة الشائعة' : (t('faqTitle') || 'FAQ')}
              </button>
            )}
            <button 
              onClick={() => scrollToSection('checkout-form-container')}
              className="text-xs font-black uppercase tracking-wider px-4 py-2 rounded-full text-white shadow-sm transition-all hover:scale-105 active:scale-95"
              style={{ backgroundColor: primary }}
            >
              {dir === 'rtl' ? 'اطلب الآن' : (t('buyNow') || 'Commander')}
            </button>
          </nav>

          {/* Mobile Right Action or Secure Badge */}
          <div className="flex items-center gap-3">
            <button 
              onClick={() => scrollToSection('checkout-form-container')}
              className="md:hidden text-[10px] font-black uppercase tracking-wider px-3.5 py-1.5 rounded-full text-white shadow-sm transition-all active:scale-95"
              style={{ backgroundColor: primary }}
            >
              {dir === 'rtl' ? 'طلب' : (t('buyNow') || 'Commander')}
            </button>
            <div className="hidden md:block">
              <span className="text-[10px] font-black uppercase tracking-widest opacity-60">
                {dir === 'rtl' ? 'شراء آمن' : (t('confirmedTitleLuxe') || 'Achat Sécurisé')}
              </span>
            </div>
          </div>
        </div>
      </header>
      

      <div id="presentation-section" className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 lg:py-16">
        
        {/* TWO COLUMN LAYOUT */}
        <div className="flex flex-col lg:flex-row gap-10 lg:gap-16">
          
          {/* LEFT COLUMN: Product Presentation */}
          <div className="flex-1 space-y-8">
            
            {/* Header section (Mobile shows this at the very top, Desktop shows it left) */}
            <div>
              {data.badge_text && (
                <span 
                  className="px-3 py-1 rounded-full text-[10px] sm:text-xs font-black uppercase tracking-widest mb-4 inline-block shadow-sm"
                  style={{ backgroundColor: `${primary}15`, color: primary }}
                >
                  {data.badge_text}
                </span>
              )}
              
              <h1 className={cn("text-3xl sm:text-4xl lg:text-5xl font-black leading-[1.1] mb-4 tracking-tight", isDark ? "text-white" : "text-slate-900")}>
                {data.headline}
              </h1>



              {price !== null && (() => {
                const currentPrice = currentOffer?.price || (selectedVariants[0]?.price || price);
                const currentComparePrice = currentOffer?.compare_price || comparePrice;
                const currentDiscount = currentComparePrice && currentPrice ? Math.round((1 - currentPrice / currentComparePrice) * 100) : 0;
                return (
                  <div className="flex items-end gap-3 mb-6">
                    <span className="text-4xl sm:text-5xl font-black leading-none" style={{ color: primary }}>
                      {formatPrice(currentPrice)}
                    </span>
                    {currentComparePrice !== null && currentComparePrice > currentPrice && (
                      <div className="flex flex-col items-start leading-none mb-1">
                        <span className={cn("text-base line-through font-medium mb-1", isDark ? "text-white/40" : "text-slate-400")}>
                          {formatPrice(currentComparePrice)}
                        </span>
                        <span className="text-[10px] font-black px-2 py-0.5 rounded bg-rose-500 text-white uppercase">
                          -{currentDiscount}% Promo
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Subtitle removed */}
            </div>

            {/* Main Image with Zoom */}
            {heroImage && (() => {
              const selectedVarWithImg = Object.values(selectedVariants[0] || {}).find((v: any) => v?.image);
              const mainImgSrc = (selectedVarWithImg as any)?.image || heroImage;

              return (
                <div className="space-y-4 w-full">
                  <div 
                    className="w-full relative rounded-2xl overflow-hidden shadow-lg cursor-zoom-in group"
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
                      loading="eager"
                      fetchPriority="high"
                      decoding="async"
                      className="w-full h-auto transition-transform duration-100 ease-out"
                      style={{
                        transformOrigin: `${zoomPos.x}% ${zoomPos.y}%`,
                        transform: isZoomed ? 'scale(2)' : 'scale(1)'
                      }}
                    />
                  </div>

                  {/* Galerie de miniatures des variantes — toute variante avec
                      une photo (Couleur, Motif, Modèle…) apparaît ici en
                      grand format sous la photo de couverture, pas seulement
                      comme petit cercle de sélection dans le sélecteur plus
                      bas. Cliquer une miniature sélectionne cette variante ET
                      change la photo principale. */}
                  {data.product?.variants && data.product.variants.some((v: any) => v.image) && (
                    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                      {data.product.variants.filter((v: any) => v.image).map((v: any, i: number) => {
                        const isSelected = Object.values(selectedVariants[0] || {}).some((val: any) => val?.value === v.value && val?.name === v.name);
                        return (
                          <button
                            key={`thumb-${i}`}
                            type="button"
                            onClick={() => handleSelectVariant(v)}
                            className={cn(
                              "relative shrink-0 size-16 sm:size-20 rounded-xl overflow-hidden border-2 transition-all hover:scale-105 active:scale-95",
                              isSelected ? "shadow-md" : "border-slate-200 opacity-80 hover:opacity-100"
                            )}
                            style={{ borderColor: isSelected ? primary : undefined }}
                            title={v.value}
                          >
                            <img src={optimizeCloudinaryUrl(v.image, 160)} alt={v.value} className="size-full object-cover" />
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Le bloc "Variant Selector" (couleurs en cercles + options
                      en boutons) a été entièrement retiré — doublon exact de :
                      1. la galerie de miniatures juste au-dessus (photos des
                         variantes, sous la photo principale) ;
                      2. le sélecteur "اختر خيارك" du formulaire de commande.
                      Sous la photo principale, on ne garde donc QUE la galerie
                      de miniatures, puis directement le container d'infos/détails. */}
                </div>
              );
            })()}

            {/* Description or Gallery if needed */}

            {/* Gallery Miniatures */}
            {galleryImages && galleryImages.length > 0 && (
              <div className="mt-8">
                <div className="flex gap-2 justify-center overflow-x-auto py-2">
                  {galleryImages.slice(0, 4).map((url: string, i: number) => (
                    <button
                      key={i}
                      type="button"
                      className="size-16 rounded-xl overflow-hidden border-2 bg-white shrink-0 transition-all active:scale-95 border-slate-200"
                    >
                      <img src={optimizeCloudinaryUrl(url, 150)} className="size-full object-cover" alt={`Gallery ${i}`} />
                    </button>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* RIGHT COLUMN: The Sticky Form */}
          <div className="w-full lg:w-[450px] shrink-0">
            <div className="sticky top-6">
              <div className={cn("rounded-3xl border shadow-xl p-6 sm:p-8 relative", isDark ? "border-white/10 bg-[#0A0A0A]" : "border-slate-200/60 bg-white")}>
                
                {/* Checkout Form (contains fields at top, selectors in middle, CTA at bottom) */}
                <div id="checkout-form-container">
                  <div className="text-center mb-6 px-4">
                    <p className={cn("text-lg sm:text-xl font-black tracking-wide leading-relaxed", isDark ? "text-white" : "text-slate-900")}>
                      للطلب، يرجى ادخال معلوماتك هنا
                    </p>
                    <div className="w-16 h-1 mx-auto mt-2 rounded-full animate-pulse" style={{ backgroundColor: primary }} />
                  </div>
                  <CheckoutForm isInline={true}>
                    
                    {/* Variant Selector (One per product in pack) */}
                    {data.product?.variants && data.product.variants.length > 0 && (() => {
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

                      return (
                        <div className="mb-6 space-y-5 pt-4 border-t border-slate-100 dark:border-white/10">
                          <div className="flex items-center justify-between">
                            <p className={cn("text-sm sm:text-base font-black uppercase tracking-wider text-start", isDark ? "text-white/75" : "text-slate-800")}>
                              {t('chooseOption')}
                            </p>
                          </div>

                          <div className="space-y-6">
                            {Array.from({ length: quantity }).map((_, itemIndex) => {
                              const itemSelection = selectedVariants[itemIndex] || {};
                              return (
                                <div key={itemIndex} className="p-4 rounded-2xl bg-slate-50/50 dark:bg-white/[0.02] border border-slate-100 dark:border-white/5 space-y-4">
                                  {quantity > 1 && (
                                    <span className={cn("text-xs font-black uppercase tracking-wider text-start block border-b pb-2 mb-2 border-slate-200/50 dark:border-white/5", isDark ? "text-white/80" : "text-slate-800")}>
                                      {dir === 'rtl' ? `المنتج #${itemIndex + 1}` : `Produit #${itemIndex + 1}`}
                                    </span>
                                  )}
                                  
                                  {Object.keys(grouped).map(optionName => {
                                    const mainOptionName = Object.keys(grouped).find(k => k.toLowerCase().includes('couleur') || k.toLowerCase().includes('color')) || Object.keys(grouped)[0];
                                    let optionVariants = grouped[optionName];
                                    
                                    if (optionName !== mainOptionName) {
                                      const mainSelectedVal = itemSelection[mainOptionName]?.value;
                                      const selectedMainVar = mainSelectedVal
                                        ? grouped[mainOptionName]?.find(v => v.value === mainSelectedVal) ?? itemSelection[mainOptionName]
                                        : itemSelection[mainOptionName];
                                      if (selectedMainVar?.sub_variants && selectedMainVar.sub_variants.length > 0) {
                                        optionVariants = selectedMainVar.sub_variants;
                                      }
                                    }
                                    
                                    const selectedVal = itemSelection[optionName]?.value;
                                    const isColorOption = optionName.toLowerCase().includes('couleur') || optionName.toLowerCase().includes('color') || optionVariants.some(v => v.color);

                                    if (isColorOption) {
                                      return (
                                        <div key={optionName} className="flex flex-col gap-2">
                                          <span className={cn("text-[10px] font-extrabold uppercase tracking-wider text-start", isDark ? "text-white/40" : "text-slate-400")}>
                                            {optionName}: <span className={isDark ? "text-white" : "text-slate-800"}>{selectedVal || '—'}</span>
                                          </span>
                                          <div className="flex flex-wrap gap-2.5">
                                          {optionVariants.map((v: any, i: number) => {
                                            const isSelected = selectedVal === v.value;
                                            // Synchronisé sur le stock RÉEL restant, pas juste "en rupture ou pas" :
                                            // si 2 unités sont en stock et que 2 des N produits de la commande
                                            // ont déjà choisi cette valeur, la 3e ne peut plus la choisir non
                                            // plus, même si stock > 0 dans l'absolu.
                                            const availableForValue = (v.stock || 0) - (v.reserved || 0);
                                            const selectedElsewhere = selectedVariants.reduce(
                                              (acc: number, sel: any, idx: number) => (idx !== itemIndex && sel?.[optionName]?.value === v.value ? acc + 1 : acc), 0,
                                            );
                                            const isOutOfStock = !isSelected && selectedElsewhere >= availableForValue;
                                            const colorHex = getVariantColor(v.value, v.color);
                                            const isCircle = isColorOption || !!(v.image || v.color || colorHex);

                                            return (
                                              <button
                                                key={`var-${itemIndex}-${optionName}-${v.id || i}`}
                                                type="button"
                                                disabled={isOutOfStock}
                                                onClick={() => handleSelectVariantForIndex(v, itemIndex)}
                                                className={cn(
                                                  "relative flex items-center justify-center border-2 transition-all shadow-sm active:scale-95",
                                                  isCircle ? "size-10 rounded-full p-0.5 bg-white" : "px-4 py-2 h-9 rounded-xl text-xs font-bold",
                                                  isSelected
                                                    ? "border-slate-900 ring-2 ring-offset-2 dark:ring-offset-[#0A0A0A] dark:border-white"
                                                    : (isDark ? "border-white/10 hover:border-white/30 bg-white/[0.02]" : "border-slate-200 hover:border-slate-400 bg-white"),
                                                  isOutOfStock && "opacity-40 cursor-not-allowed"
                                                )}
                                                style={{
                                                  borderColor: isSelected ? primary : undefined,
                                                  // @ts-ignore
                                                  "--tw-ring-color": isSelected ? primary : undefined,
                                                }}
                                                title={v.value}
                                              >
                                                {isCircle ? (
                                                  colorHex ? (
                                                    <div className="size-full rounded-full border border-black/10" style={{ backgroundColor: colorHex }} />
                                                  ) : v.image ? (
                                                    <img src={optimizeCloudinaryUrl(v.image, 100)} alt={v.value} className="size-full object-cover rounded-full" />
                                                  ) : (
                                                    <span className="text-[10px] font-bold text-slate-900 dark:text-white">{v.value}</span>
                                                  )
                                                ) : (
                                                  <span className={cn("font-bold", isSelected ? "text-white" : (isDark ? "text-white/85" : "text-slate-800"))}>
                                                    {v.value}
                                                  </span>
                                                )}

                                                {isSelected && isCircle && (
                                                  <span className="absolute -top-1 -right-1 size-4 rounded-full flex items-center justify-center text-[8px] text-white font-bold shadow-md border border-white" style={{ backgroundColor: primary }}>
                                                    ✓
                                                  </span>
                                                )}

                                                {isOutOfStock && (
                                                  <div className="absolute inset-0 bg-black/10 dark:bg-white/10 rounded-full flex items-center justify-center">
                                                    <span className="text-red-500 font-bold text-xs">✕</span>
                                                  </div>
                                                )}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                    } else {
                                      return (
                                        <div key={optionName} className="flex flex-col gap-1.5 text-start">
                                          <span className={cn("text-[10px] font-extrabold uppercase tracking-wider", isDark ? "text-white/40" : "text-slate-400")}>
                                            {optionName}
                                          </span>
                                          <select
                                            value={selectedVal || ''}
                                            onChange={(e) => {
                                              const matched = optionVariants.find(v => v.value === e.target.value);
                                              if (matched) {
                                                handleSelectVariantForIndex(matched, itemIndex);
                                              }
                                            }}
                                            className={cn(
                                              "w-full h-11 px-4 text-xs font-bold border-2 rounded-xl focus:border-slate-900 outline-none transition-all cursor-pointer",
                                              isDark 
                                                ? "bg-neutral-900 border-white/10 text-white focus:border-white" 
                                                : "bg-white border-slate-200 text-slate-800 focus:border-slate-800"
                                            )}
                                            style={{
                                              borderColor: selectedVal ? primary : undefined,
                                            }}
                                          >
                                            <option value="" disabled>{dir === 'rtl' ? 'اختر المقاس / الخيار' : 'Sélectionnez une option'}</option>
                                            {optionVariants.map((v, i) => {
                                              const availableForValue = (v.stock || 0) - (v.reserved || 0);
                                              const selectedElsewhere = selectedVariants.reduce(
                                                (acc: number, sel: any, idx: number) => (idx !== itemIndex && sel?.[optionName]?.value === v.value ? acc + 1 : acc), 0,
                                              );
                                              const isOutOfStock = selectedVal !== v.value && selectedElsewhere >= availableForValue;
                                              return (
                                                <option key={`opt-${v.id || i}`} value={v.value} disabled={isOutOfStock} className={isDark ? "bg-neutral-900 text-white" : "bg-white text-slate-800"}>
                                                  {v.value} {isOutOfStock ? (dir === 'rtl' ? '(غير متوفر)' : '(Rupture)') : ''}
                                                </option>
                                              );
                                            })}
                                          </select>
                                        </div>
                                      );
                                    }
                                  })}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Quantity Pack Selector — paliers d'offre SI configurés,
                        sinon un choix libre de quantité (aucune offre remplie
                        par l'admin ne doit jamais forcer un palier fictif). */}
                    <div className="mb-6 space-y-3 pt-4 border-t border-slate-100 dark:border-white/10">
                      <p className={cn("text-sm sm:text-base font-black uppercase tracking-wider", isDark ? "text-white/75" : "text-slate-800")}>
                        {t('chooseQuantity')}
                      </p>
                      {!hasRealOffers ? (
                        <div className={cn(
                          "flex items-center justify-between gap-4 p-4 rounded-2xl border",
                          isDark ? "border-white/10 bg-white/[0.02]" : "border-slate-200 bg-white"
                        )}>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => setQuantity(Math.max(1, quantity - 1))}
                              disabled={quantity <= 1}
                              className={cn(
                                "size-10 rounded-xl border font-black text-lg flex items-center justify-center transition-all disabled:opacity-30",
                                isDark ? "border-white/20 text-white hover:bg-white/10" : "border-slate-200 text-slate-700 hover:bg-slate-50"
                              )}
                            >
                              −
                            </button>
                            <span className={cn("min-w-[2ch] text-center text-lg font-black", isDark ? "text-white" : "text-slate-900")}>{quantity}</span>
                            <button
                              type="button"
                              onClick={() => {
                                if (maxOrderableQuantity !== undefined && quantity >= maxOrderableQuantity) return;
                                setQuantity(quantity + 1);
                              }}
                              disabled={maxOrderableQuantity !== undefined && quantity >= maxOrderableQuantity}
                              className={cn(
                                "size-10 rounded-xl border font-black text-lg flex items-center justify-center transition-all disabled:opacity-30",
                                isDark ? "border-white/20 text-white hover:bg-white/10" : "border-slate-200 text-slate-700 hover:bg-slate-50"
                              )}
                            >
                              +
                            </button>
                          </div>
                          <div className="text-right">
                            {maxOrderableQuantity !== undefined && quantity >= maxOrderableQuantity && (
                              <p className="text-[10px] font-bold text-rose-500 mb-0.5">{dir === 'rtl' ? 'الحد الأقصى للمخزون المتاح' : 'Stock maximum disponible atteint'}</p>
                            )}
                            <p className="text-sm font-black" style={{ color: primary }}>{formatPrice(currentOffer.price)}</p>
                            {currentOffer.compare_price > currentOffer.price && (
                              <p className="text-[10px] line-through opacity-50">{formatPrice(currentOffer.compare_price)}</p>
                            )}
                          </div>
                        </div>
                      ) : (
                      <div className="grid grid-cols-1 gap-3">
                        {offers.map((offer: any, idx: number) => {
                          const isSelected = selectedOfferIndex === idx;
                          // Un palier d'offre (ex: "3 Pièces") configuré par
                          // l'admin ne vérifiait jamais le stock réel — un
                          // client pouvait cliquer "3 Pièces" alors qu'il ne
                          // reste que 2 unités en stock. Désactivé dès que la
                          // quantité du palier dépasse ce qui est réellement
                          // disponible (maxOrderableQuantity, calculé plus haut).
                          const offerExceedsStock = maxOrderableQuantity !== undefined && offer.quantity > maxOrderableQuantity;
                          return (
                            <button
                              key={idx}
                              type="button"
                              disabled={offerExceedsStock}
                              onClick={() => {
                                  if (offerExceedsStock) return;
                                  setSelectedOfferIndex(idx);
                                  setQuantity(offer.quantity);
                              }}
                              className={cn(
                                "p-4 rounded-2xl border text-left transition-all relative flex items-center justify-between overflow-hidden",
                                offerExceedsStock
                                  ? "opacity-40 cursor-not-allowed grayscale"
                                  : isSelected
                                  ? (isDark ? "border-white bg-white/5 ring-1 ring-white" : "border-slate-900 bg-slate-900/5 ring-1 ring-slate-900")
                                  : (isDark ? "border-white/10 bg-white/[0.02] hover:border-white/20" : "border-slate-200 bg-white hover:border-slate-300")
                              )}
                            >
                              {offer.popular && !offerExceedsStock && (
                                <div className="absolute top-0 right-0 px-2.5 py-0.5 text-[8px] font-black uppercase text-white tracking-widest bg-rose-500 rounded-bl-lg">
                                  {t('popular')}
                                </div>
                              )}
                              <div>
                                <p className={cn("text-sm font-black", isDark ? "text-white" : "text-slate-900")}>
                                  {offer.name || `${offer.quantity} ${offer.quantity > 1 ? t('pieces') : t('piece')}`}
                                </p>
                                {offerExceedsStock ? (
                                  <p className="text-[11px] mt-0.5 font-bold text-rose-500">{dir === 'rtl' ? 'غير متوفر بهذه الكمية' : `Stock insuffisant (${maxOrderableQuantity} disponible${(maxOrderableQuantity ?? 0) > 1 ? 's' : ''})`}</p>
                                ) : offer.desc && (
                                  <p className={cn("text-[11px] mt-0.5", isDark ? "text-white/50" : "text-slate-500")}>{offer.desc}</p>
                                )}
                              </div>
                              <div className={cn("text-right", offer.popular && !offerExceedsStock ? "mr-3" : "")}>
                                <p className="text-sm font-black" style={{ color: primary }}>{formatPrice(offer.price)}</p>
                                {offer.compare_price > offer.price && (
                                  <p className="text-[10px] line-through opacity-50">{formatPrice(offer.compare_price)}</p>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      )}
                    </div>
                  </CheckoutForm>
                </div>

                {/* Publicity Banner */}
                {data.banner_image_url && (
                  <div className="mt-6">
                    <img src={optimizeCloudinaryUrl(data.banner_image_url, 1600)} alt="Bannière publicitaire" className="w-full h-auto rounded-2xl shadow-md" />
                  </div>
                )}

                {/* Inline Delivery Info / Trust Badges (Replaces the modal) */}
                <div className="mt-8 pt-6 border-t border-slate-100 dark:border-white/10 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="size-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-emerald-600">
                      <Truck className="size-4" />
                    </div>
                    <div>
                      <p className={cn("text-xs font-bold", isDark ? "text-white" : "text-slate-800")}>{t('delivery58')}</p>
                      <p className={cn("text-[11px] mt-0.5", isDark ? "text-white/60" : "text-slate-500")}>
                        {t('delivery58Desc')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="size-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-blue-600">
                      <ShieldCheck className="size-4" />
                    </div>
                    <div>
                      <p className={cn("text-xs font-bold", isDark ? "text-white" : "text-slate-800")}>{t('securePayment')}</p>
                      <p className={cn("text-[11px] mt-0.5", isDark ? "text-white/60" : "text-slate-500")}>
                        {t('securePaymentDesc')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="size-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 text-amber-600">
                      <RotateCcw className="size-4" />
                    </div>
                    <div>
                      <p className={cn("text-xs font-bold", isDark ? "text-white" : "text-slate-800")}>{t('satisfiedOrRefunded')}</p>
                      <p className={cn("text-[11px] mt-0.5", isDark ? "text-white/60" : "text-slate-500")}>
                        {t('satisfiedOrRefundedDesc')}
                      </p>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>

      </div>

      {/* REVIEWS & FAQ SECTION (Optional, Minimalist style) */}
      <div className={cn("border-t", isDark ? "border-white/5 bg-[#080808]" : "border-slate-100 bg-white")}>
        <div className="max-w-[800px] mx-auto px-4 py-16">
          
          {/* Testimonials */}
          {data.testimonials && data.testimonials.length > 0 && (
            <div id="testimonials-section" className="mb-20">
               <h2 className="text-3xl font-black mb-8 text-center">{t('customerReviews')}</h2>
               <div className="space-y-6">
                 {data.testimonials.map((t, i) => (
                   <div key={i} className={cn("p-6 rounded-2xl border", isDark ? "border-white/5 bg-white/[0.02]" : "border-slate-100 bg-slate-50")}>
                     <div className="flex gap-1 mb-3">
                       {Array.from({ length: t.stars }).map((_, j) => (
                         <Star key={j} className="size-4 fill-amber-400 text-amber-400" />
                       ))}
                     </div>
                     <p className={cn("text-sm font-medium mb-4 italic", isDark ? "text-white/80" : "text-slate-700")}>"{t.text}"</p>
                     <div className="flex items-center gap-3">
                       <div className="size-8 rounded-full font-bold text-xs flex items-center justify-center" style={{ backgroundColor: `${primary}15`, color: primary }}>
                         {t.name.charAt(0)}
                       </div>
                       <div>
                         <p className="text-xs font-bold">{t.name}</p>
                         <p className={cn("text-[10px]", isDark ? "text-white/40" : "text-slate-400")}>{t.location}</p>
                       </div>
                     </div>
                   </div>
                 ))}
               </div>
            </div>
          )}

          {/* FAQ */}
          {data.faq && data.faq.length > 0 && (
            <div id="faq-section">
              <h2 className="text-3xl font-black mb-8 text-center">{t('faqTitle')}</h2>
              <div className="space-y-3">
                {data.faq.map((item, i) => (
                  <div key={i} className={cn("rounded-xl border", isDark ? "border-white/5 bg-[#0A0A0A]" : "border-slate-200 bg-white")}>
                    <button
                      onClick={() => setOpenFaq(openFaq === i ? null : i)}
                      className="w-full flex items-center justify-between p-5 text-left font-bold text-sm"
                    >
                      <span>{item.question}</span>
                      {openFaq === i ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    </button>
                    {openFaq === i && (
                      <div className={cn("px-5 pb-5 text-sm leading-relaxed", isDark ? "text-white/60" : "text-slate-600")}>
                        {item.answer}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className={cn("py-8 text-center text-[10px] font-bold uppercase tracking-[0.2em] border-t pb-24 md:pb-8", isDark ? "border-white/5 text-white/30" : "border-slate-200 text-slate-400")}>
        {t('codText')} • {t('delivery58')} • {new Date().getFullYear()}
      </footer>

      {/* Sticky Bottom CTA on Mobile */}
      <div className="fixed bottom-0 left-0 right-0 z-40 p-3 bg-white/90 dark:bg-black/90 backdrop-blur-md border-t border-slate-200/60 dark:border-white/10 flex justify-center items-center shadow-[0_-8px_30px_rgb(0,0,0,0.12)] md:hidden">
        <button
          onClick={() => scrollToSection('checkout-form-container')}
          className="w-full py-3.5 rounded-xl text-white font-black uppercase tracking-wider text-xs shadow-md active:scale-[0.97] transition-all flex items-center justify-center gap-2"
          style={{ backgroundColor: primary }}
        >
          <ShoppingBag className="size-4" />
          <span>اضغط هنا للطلب</span>
        </button>
      </div>

    </div>
  );
}
