'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  ShieldCheck, Truck, RotateCcw, Star, Phone,
  CheckCircle, CheckCheck, ChevronDown, ChevronUp, ArrowRight,
  ShoppingBag, Check, MessageCircle, Clock, Sparkles,
} from 'lucide-react';
import { useCartStore } from '@/store/cart-store';
import { useAppStore } from '@/store/app-store';
import { CheckoutForm } from '@/components/storefront/checkout-form';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/use-translation';
import { FloatingLanguageSwitcher } from '@/components/storefront/floating-language-switcher';
import { trackMetaEvent, setCurrentLpId } from '@/lib/meta-tracking';
import { optimizeCloudinaryUrl } from '@/lib/image-optimize';
import { captureAttribution } from '@/lib/attribution';

const parseBannerImages = (urlStr: string | null | undefined): string[] => {
  if (!urlStr) return [];
  if (urlStr.startsWith('[')) {
    try {
      const parsed = JSON.parse(urlStr);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (e) {}
  }
  return urlStr.split(',').map(s => s.trim()).filter(Boolean);
};

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
  benefits: { icon?: string; title?: string; desc?: string; [key: string]: any }[];
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
  'noir': '#000000',
  'noire': '#000000',
  'black': '#000000',
  'blanc': '#ffffff',
  'blanche': '#ffffff',
  'rouge': '#d63031',
  'bleu': '#1e3545',
  'bleue': '#1e3545',
  'bleu canard': '#1e3545',
  'vert': '#2ecc71',
  'verte': '#2ecc71',
  'jaune': '#f1c40f',
  'rose': '#eaa48e',
  'rose poudré': '#eaa48e',
  'gris': '#b5b5b5',
  'grise': '#b5b5b5',
  'gris souris': '#b5b5b5',
  'marron': '#a0522d',
  'orange': '#e67e22',
  'violet': '#9b59b6',
  'violette': '#9b59b6',
  'beige': '#f5f5dc',
  'bordeaux': '#5e121e',
  'أسود': '#000000',
  'اسود': '#000000',
  'ابيض': '#ffffff',
  'أبيض': '#ffffff',
  'احمر': '#d63031',
  'أحمر': '#d63031',
  'ازرق': '#1e3545',
  'أزرق': '#1e3545',
  'كحلي': '#1e3545',
  'اخضر': '#2ecc71',
  'أخضر': '#2ecc71',
  'اصفر': '#f1c40f',
  'أصفر': '#f1c40f',
  'وردي': '#eaa48e',
  'رمادي': '#b5b5b5',
  'عنابي': '#5e121e',
  'بني': '#a0522d',
  'برتقالي': '#e67e22',
  'بنفسجي': '#9b59b6',
};

const COLOR_NAMES_AR: Record<string, string> = {
  'noir': 'أسود',
  'noire': 'أسود',
  'black': 'أسود',
  'gris': 'رمادي',
  'grise': 'رمادي',
  'grey': 'رمادي',
  'gray': 'رمادي',
  'gris souris': 'رمادي',
  'bordeaux': 'عنابي',
  'bleu': 'كحلي',
  'bleue': 'كحلي',
  'blue': 'كحلي',
  'bleu canard': 'كحلي',
  'rose': 'وردي',
  'rose poudré': 'وردي',
  'pink': 'وردي',
  'blanc': 'أبيض',
  'rouge': 'أحمر',
  'vert': 'أخضر',
};

function getVariantColor(value: string, colorField?: string): string | null {
  if (colorField && colorField.startsWith('#')) return colorField;
  const val = value?.toLowerCase().trim() || '';
  return COLOR_MAP[val] || colorField || null;
}

function getArabicVariantName(val: string): string {
  if (!val) return '';
  const key = val.toLowerCase().trim();
  return COLOR_NAMES_AR[key] || val;
}

function getArabicOfferTitle(qty: number, customName?: string): string {
  if (customName && /[\u0600-\u06FF]/.test(customName)) return customName;
  if (qty === 1) return 'قطعة 1';
  if (qty === 2) return 'قطعتين';
  if (qty === 3) return '3 قطع';
  if (qty === 4) return '4 قطع';
  return `${qty} قطع`;
}

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
  const [selectedActiveImage, setSelectedActiveImage] = useState<string | null>(null);

  // Extraction de la configuration de réassurance et personnalisation
  const reassuranceConfig = useMemo(() => {
    if (!data.benefits || !Array.isArray(data.benefits)) return {};
    const found = data.benefits.find(
      (b: any) => b && (b.id === 'reassurance_config' || b.show_announcement_bar !== undefined)
    );
    return (found as any) || {};
  }, [data.benefits]);

  const validFaq = useMemo(() => {
    if (!data.faq || !Array.isArray(data.faq)) return [];
    return data.faq.filter(
      (item) => item && item.question && !item.question.includes('__DISABLED__') && item.question.trim().length > 0
    );
  }, [data.faq]);

  const storeName = data.store?.name || activeStore?.name || 'AZ Confort';
  const storeLogo = data.store?.logo_url || activeStore?.logo_url;
  const storePhone = data.phone || reassuranceConfig.whatsapp_phone || (activeStore as any)?.phone || '0770041321';
  const cleanPhone = String(storePhone).replace(/\s+/g, '');
  const formattedPhone = cleanPhone.replace(/(\d{4})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4');
  const whatsappPhone = cleanPhone.replace(/^0/, '');
  const whatsappMessage = encodeURIComponent(
    reassuranceConfig.whatsapp_message || `مرحباً، أود الاستفسار بخصوص منتج: ${data.headline || data.product_name || 'وسادة السفر'}`
  );
  const whatsappUrl = `https://wa.me/213${whatsappPhone}?text=${whatsappMessage}`;

  useEffect(() => {
    setMounted(true);
    if (setLocale) {
      setLocale('ar');
    }
    captureAttribution();
  }, [setLocale]);

  // Meta Pixel + CAPI ViewContent
  useEffect(() => {
    const pid = data?.product?.id || (data as any)?.product_id;
    if (!pid || !activeStore?.id) return;
    setCurrentLpId(data.id);
    void trackMetaEvent('ViewContent', {
      content_ids: [String(pid)],
      content_name: data.product_name || data.product?.name || data.headline,
      content_type: 'product',
      value: Number(data.price ?? data.product?.price ?? 0) || undefined,
    }, { storeId: activeStore.id, eventId: `viewcontent-lp-${pid}`, lpId: data.id });
  }, [data?.product?.id, activeStore?.id, data.headline, data.id, data.price, data.product?.name, data.product_name]);

  useEffect(() => {
    let lastScrollY = window.scrollY;
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY && currentScrollY > 60) {
        setShowNavbar(false);
      } else {
        setShowNavbar(true);
      }
      lastScrollY = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const variantWithImg = data.product?.variants?.find((v: any) => v.image);
  const heroImage = variantWithImg?.image || data.product?.main_image || data.image_url;
  const price = data.product?.price ?? data.price ?? 1400;
  const comparePrice = data.product?.compare_price ?? data.compare_price ?? 1600;
  const productName = data.headline || data.product_name || data.product?.name || 'وسادة سفر مريحة';

  // Real offers list with smart Arabic naming fallback matching screenshot
  const rawOffers = (data as any).offers && (data as any).offers.length > 0 ? (data as any).offers : [
    { quantity: 1, price: price, compare_price: comparePrice, name: 'قطعة 1', popular: false },
    { quantity: 2, price: 2400, compare_price: 3200, name: 'قطعتين', popular: true },
    { quantity: 3, price: 3500, compare_price: 4800, name: '3 قطع', popular: false },
    { quantity: 4, price: 4400, compare_price: 6400, name: '4 قطع', popular: false },
  ];

  const offers = useMemo(() => {
    return rawOffers.map((o: any, idx: number) => ({
      ...o,
      arabicTitle: getArabicOfferTitle(o.quantity, o.name),
      popular: o.popular !== undefined ? o.popular : idx === 1,
    }));
  }, [rawOffers]);

  const maxOrderableQuantity = useMemo(() => {
    const variants = data.product?.variants;
    if (!variants || variants.length === 0) {
      const p = data.product as any;
      if (!p) return undefined;
      const available = Math.max(0, p.stock || 0);
      return available > 0 ? available : undefined;
    }
    const firstGroupName = variants[0]?.name;
    const firstGroupOptions = variants.filter((v: any) => v.name === firstGroupName);
    const total = firstGroupOptions.reduce((sum: number, v: any) => sum + Math.max(0, (v.stock || 0) - (v.reserved || 0)), 0);
    return total > 0 ? total : undefined;
  }, [data.product]);

  useEffect(() => {
    if (selectedOfferIndex >= offers.length) {
      setSelectedOfferIndex(0);
    }
  }, [offers, selectedOfferIndex]);

  const currentOffer = useMemo(() => {
    return offers[selectedOfferIndex] || offers[0];
  }, [offers, selectedOfferIndex]);

  // Synchronisation des variantes sélectionnées
  useEffect(() => {
    if (data.product?.variants && data.product.variants.length > 0) {
      const grouped: Record<string, any[]> = {};
      data.product.variants.forEach((v: any) => {
        if (!grouped[v.name]) grouped[v.name] = [];
        grouped[v.name].push(v);
      });

      const targetQty = currentOffer ? currentOffer.quantity : quantity;
      setSelectedVariants(prev => {
        const newVars = [...prev];
        while (newVars.length < targetQty) {
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
        return newVars.slice(0, targetQty);
      });
    }
  }, [data.product, quantity, currentOffer]);

  const handleSelectVariant = (variant: any) => {
    if (variant.image) {
      setSelectedActiveImage(variant.image);
    }
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
    if (itemIndex === 0 && variant.image) {
      setSelectedActiveImage(variant.image);
    }
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

  // Sync avec le panier d'achat
  const selectedVariantsSerialized = JSON.stringify(selectedVariants);
  useEffect(() => {
    if (!mounted) return;
    const qty = maxOrderableQuantity !== undefined
      ? Math.min(currentOffer.quantity, maxOrderableQuantity)
      : currentOffer.quantity;

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
      const unitPrice = Math.round(offerPrice / (qty || 1));
      const selectedVarWithImg = Object.values(selectedVariants[0] || {}).find((v: any) => v?.image);
      const pImage = (selectedVarWithImg as any)?.image || selectedActiveImage || heroImage || data.product.main_image;
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

    const unitPrice = Math.round(currentOffer.price / (qty || 1));
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
  }, [mounted, data.product, data.id, data.product_name, data.headline, data.slug, data.subtitle, data.compare_price, heroImage, selectedActiveImage, selectedVariantsSerialized, currentOffer.price, currentOffer.quantity, maxOrderableQuantity]);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const headerOffset = 65;
      const elementPosition = el.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }
  };

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-900 font-sans">
        <div className="size-8 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />
      </div>
    );
  }

  // Active color info
  const selectedColorVal = selectedVariants[0]?.Couleur?.value || 'Noir';
  const activeColorArabic = getArabicVariantName(selectedColorVal);

  // Variant photos list for thumbnails
  const allVariantPhotos: Array<{ url: string; label: string; variant: any }> = [];
  const seenVariantUrls = new Set<string>();
  if (data.product?.variants && data.product.variants.length > 0) {
    data.product.variants.forEach((v: any) => {
      if (v.image && !seenVariantUrls.has(v.image)) {
        seenVariantUrls.add(v.image);
        allVariantPhotos.push({ url: v.image, label: v.value, variant: v });
      }
    });
  }

  const currentMainImgSrc = selectedActiveImage || (Object.values(selectedVariants[0] || {}).find((v: any) => v?.image) as any)?.image || heroImage;

  return (
    <div className="min-h-screen bg-slate-100/70 dark:bg-black font-sans text-slate-900 antialiased" dir={dir}>
      <FloatingLanguageSwitcher primaryColor="#2563EB" />

      {/* ── 1. TOP ANNOUNCEMENT BAR ── */}
      {reassuranceConfig.show_announcement_bar !== false && (
        <div
          className="w-full py-2 px-4 text-center text-xs font-bold tracking-wide relative z-50 shadow-xs"
          style={{
            backgroundColor: reassuranceConfig.announcement_bar_bg || '#0B1329',
            color: reassuranceConfig.announcement_bar_text_color || '#FACC15',
          }}
          dir="rtl"
        >
          <span>
            {reassuranceConfig.announcement_bar_text && !reassuranceConfig.announcement_bar_text.endsWith('•')
              ? reassuranceConfig.announcement_bar_text
              : '🔒 الدفع عند الاستلام • 🚚 توصيل لـ 58 ولاية • ⏳ العرض ساري حتى نهاية الأسبوع'}
          </span>
        </div>
      )}

      {/* ── 2. STICKY HEADER ── */}
      <header
        className={cn(
          "w-full py-2 sm:py-2.5 border-b bg-white/95 dark:bg-black/95 backdrop-blur-md border-slate-200/80 sticky top-0 z-40 shadow-xs transition-all duration-300",
          showNavbar ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none"
        )}
        dir={dir}
      >
        <div className="max-w-[620px] w-full mx-auto px-4 flex items-center justify-between h-12">
          {/* RTL Right: STORE LOGO */}
          <div className="flex items-center justify-start min-w-0">
            {storeLogo ? (
              <img
                src={optimizeCloudinaryUrl(storeLogo, 200)}
                alt={storeName}
                className="h-8 sm:h-9 w-auto object-contain max-h-[38px] transition-all"
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement;
                  target.style.display = 'none';
                  const sibling = target.nextElementSibling as HTMLElement;
                  if (sibling) sibling.style.display = 'block';
                }}
              />
            ) : null}
            <span
              className="text-base font-black tracking-tight text-slate-900 dark:text-white"
              style={{ display: storeLogo ? 'none' : 'block' }}
            >
              {storeName}
            </span>
          </div>

          {/* RTL Center: Trust Badge */}
          {reassuranceConfig.show_header_badge !== false && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/80 shadow-2xs">
              <ShieldCheck className="size-3.5 text-emerald-600 shrink-0" />
              <span>{reassuranceConfig.header_badge_text || 'شراء آمن'}</span>
            </div>
          )}

          {/* RTL Left: Red Quick Order CTA Button */}
          <button
            type="button"
            onClick={() => scrollToSection('checkout-form-container')}
            className="text-xs sm:text-sm font-black px-4 py-2 rounded-xl text-white shadow-md transition-all hover:brightness-110 active:scale-95 cursor-pointer bg-[#B91C1C] hover:bg-[#991B1B]"
          >
            {reassuranceConfig.header_cta_text || 'اطلب الآن'}
          </button>
        </div>
      </header>

      {/* ── MAIN CONTENT CONTAINER (Centered Mobile & Desktop Frame) ── */}
      <div className="max-w-[600px] mx-auto bg-white dark:bg-[#0A0A0A] shadow-xl sm:border-x sm:border-slate-200/80 min-h-screen px-4 sm:px-6 py-6 sm:py-8 space-y-6">

        {/* ── 3. HERO CONTENT & HEADINGS ── */}
        <div className="text-right space-y-3">
          {/* Limited offer badge */}
          {reassuranceConfig.show_badge !== false && (
            <div className="flex justify-start">
              <span className="px-3.5 py-1 rounded-full text-xs font-bold shadow-2xs border bg-rose-50 text-rose-700 border-rose-200 inline-flex items-center gap-1">
                <span>⏳</span>
                <span>{data.badge_text || reassuranceConfig.badge_text || 'عرض محدود'}</span>
              </span>
            </div>
          )}

          {/* Main Title */}
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-slate-900 dark:text-white tracking-tight leading-tight">
            {productName}
          </h1>

          {/* Subtitle */}
          {reassuranceConfig.show_subtitle !== false && (() => {
            const isCoussinProduct = /coussin|وسادة/i.test(productName);
            const raw = reassuranceConfig.subtitle !== undefined ? reassuranceConfig.subtitle : data.subtitle;
            const text = (raw === 'نوم هادئ في الطائرة والسيارة – ودّع آلام الرقبة 🌙' && !isCoussinProduct)
              ? ''
              : (raw || '');
            if (!text || !text.trim()) return null;
            return (
              <p className="text-sm sm:text-base font-medium text-slate-600 dark:text-slate-300 leading-relaxed max-w-md">
                {text}
              </p>
            );
          })()}

          {/* Gift Ribbon Banner */}
          {reassuranceConfig.show_gift_ribbon !== false && (
            <div className="py-2.5 px-4 rounded-2xl border font-black text-xs sm:text-sm flex items-center justify-start gap-2 shadow-2xs bg-amber-50/90 text-amber-900 border-amber-300/80 max-w-md">
              <span>{reassuranceConfig.gift_ribbon_text || '🎁 مع كل قطعة: قناع عين للنوم هدية'}</span>
            </div>
          )}

          {/* Price & Rating Row */}
          <div className="pt-1 space-y-2">
            <div className="flex items-center justify-start gap-3">
              <span className="text-3xl sm:text-4xl font-black text-red-600 leading-none" dir="ltr">
                {formatPrice(currentOffer.price)}
              </span>
              {Boolean(currentOffer.compare_price && currentOffer.compare_price > currentOffer.price) && (
                <span className="text-xl sm:text-2xl font-bold line-through text-slate-400" dir="ltr">
                  {formatPrice(currentOffer.compare_price!)}
                </span>
              )}
              {Boolean(currentOffer.compare_price && currentOffer.compare_price > currentOffer.price) && (
                <span className="px-3 py-1 rounded-full text-xs font-black shadow-xs bg-emerald-600 text-white">
                  {reassuranceConfig.savings_badge_text || 'وفّر'} {Math.round(currentOffer.compare_price! - currentOffer.price)} دج
                </span>
              )}
            </div>

            {/* Rating */}
            {reassuranceConfig.show_rating !== false && (
              <div className="flex items-center justify-start gap-1.5 pt-0.5">
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} className="size-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  {reassuranceConfig.rating_text || '4.7/5 – تقييم زبائننا'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── 4. HERO MAIN IMAGE & THUMBNAILS ── */}
        <div className="space-y-3">
          {heroImage && (
            <div
              className="w-full relative rounded-3xl overflow-hidden shadow-lg border border-slate-200/80 cursor-zoom-in group bg-slate-50"
              onMouseMove={(e) => {
                const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
                const x = ((e.clientX - left) / width) * 100;
                const y = ((e.clientY - top) / height) * 100;
                setZoomPos({ x, y });
                setIsZoomed(true);
              }}
              onMouseLeave={() => setIsZoomed(false)}
            >
              {/* Floating Image Badge */}
              {reassuranceConfig.show_image_badge !== false && (
                <div className="absolute top-3 right-3 z-10 px-3 py-1.5 rounded-full text-xs font-black shadow-md bg-amber-500 text-white flex items-center gap-1">
                  <span>{reassuranceConfig.image_badge_text || '🎁 + قناع عين هدية'}</span>
                </div>
              )}

              <img
                src={optimizeCloudinaryUrl(currentMainImgSrc, 800)}
                alt={productName}
                width={800}
                height={800}
                fetchPriority="high"
                decoding="async"
                className="w-full h-auto transition-transform duration-100 ease-out object-cover"
                style={{
                  transformOrigin: `${zoomPos.x}% ${zoomPos.y}%`,
                  transform: isZoomed ? 'scale(2)' : 'scale(1)',
                }}
              />
            </div>
          )}

          {/* 5 Variant Image Thumbnails */}
          {allVariantPhotos.length > 1 && (
            <div className="flex gap-2 sm:gap-3 overflow-x-auto py-1 justify-start">
              {allVariantPhotos.map((item, i) => {
                const isSelected = selectedVariants[0]?.Couleur?.value === item.variant?.value;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSelectVariant(item.variant)}
                    className={cn(
                      "relative shrink-0 size-14 sm:size-16 rounded-2xl overflow-hidden border-2 transition-all p-0.5 bg-white shadow-xs cursor-pointer hover:scale-105 active:scale-95",
                      isSelected
                        ? "border-blue-600 ring-2 ring-blue-300 ring-offset-1"
                        : "border-slate-200 hover:border-slate-300 opacity-80 hover:opacity-100"
                    )}
                    title={item.label}
                  >
                    <img
                      src={optimizeCloudinaryUrl(item.url, 160)}
                      alt={item.label}
                      className="size-full object-cover rounded-xl"
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── 5. CHECKOUT FORM CARD ── */}
        <div id="checkout-form-container" className="rounded-3xl border border-slate-200/80 dark:border-white/10 bg-white dark:bg-[#0E0E0E] shadow-xl p-5 sm:p-7 relative">
          {/* Card Header Title */}
          <div className="text-center mb-6 px-2">
            <h2 className="text-xl sm:text-2xl font-black text-blue-600 dark:text-blue-400 tracking-tight">
              {reassuranceConfig.form_title || 'للطلب، أدخل معلوماتك هنا'}
            </h2>
            <div className="w-16 h-1 mx-auto mt-2 rounded-full bg-blue-600 dark:bg-blue-400" />
          </div>

          <CheckoutForm
            isInline={true}
            customCtaText={reassuranceConfig.form_cta_text || 'اطلب الآن – الدفع عند الاستلام'}
            customCtaSubtext={reassuranceConfig.form_cta_subtext || 'ما تخلص حتى توصلك السلعة وتشوفها بعينيك'}
            customCtaBg={reassuranceConfig.form_cta_bg || '#B91C1C'}
            customBadges={[
              reassuranceConfig.form_badge_1 || '🔒 الدفع عند الاستلام',
              reassuranceConfig.form_badge_2 || '🚚 التوصيل 24-72 ساعة',
              reassuranceConfig.form_badge_3 || '🔄 استبدال مجاني في حال وجود عيب',
            ]}
          >
            {/* Color Swatch Circles */}
            {data.product?.variants && data.product.variants.length > 0 && (
              <div className="pt-4 border-t border-slate-100 dark:border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-black text-slate-800 dark:text-white">
                    اللون: <span className="text-slate-900 dark:text-slate-100 font-black">{activeColorArabic}</span>
                  </span>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  {allVariantPhotos.map((vItem, i) => {
                    const isSelected = selectedVariants[0]?.Couleur?.value === vItem.variant.value;
                    const colorHex = getVariantColor(vItem.variant.value, vItem.variant.color);

                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleSelectVariant(vItem.variant)}
                        className={cn(
                          "relative size-10 rounded-full border-2 transition-all p-0.5 shadow-sm active:scale-95 cursor-pointer",
                          isSelected
                            ? "border-white ring-2 ring-blue-600 ring-offset-2 dark:ring-offset-black scale-105"
                            : "border-slate-200 hover:border-slate-400 bg-white"
                        )}
                        title={vItem.label}
                      >
                        <div
                          className="size-full rounded-full border border-black/10"
                          style={{ backgroundColor: colorHex || '#333' }}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Quantity Packages Selection */}
            <div className="pt-4 border-t border-slate-100 dark:border-white/10 space-y-3">
              <p className="text-sm font-black text-slate-900 dark:text-white">
                حدد الكمية
              </p>

              <div className="grid grid-cols-1 gap-2.5">
                {offers.map((offer: any, idx: number) => {
                  const isSelected = selectedOfferIndex === idx;
                  const offerExceedsStock = maxOrderableQuantity !== undefined && offer.quantity > maxOrderableQuantity;
                  const savings = offer.compare_price > offer.price ? Math.round(offer.compare_price - offer.price) : 0;
                  const perPiece = Math.round(offer.price / offer.quantity);

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
                        "p-3.5 sm:p-4 rounded-2xl border-2 text-start transition-all relative flex items-center justify-between cursor-pointer",
                        offerExceedsStock
                          ? "opacity-40 cursor-not-allowed grayscale bg-slate-50 border-slate-200"
                          : isSelected
                          ? "bg-blue-50/60 dark:bg-blue-950/20 border-blue-500 shadow-sm"
                          : "bg-white dark:bg-white/[0.02] border-slate-200 hover:border-slate-300"
                      )}
                    >
                      {/* Popular Badge */}
                      {offer.popular && !offerExceedsStock && (
                        <div className="absolute top-2 left-3 sm:top-2.5 sm:left-4 px-2.5 py-0.5 text-[10px] font-black text-white bg-amber-500 rounded-full shadow-xs flex items-center gap-1">
                          <span>🔥</span>
                          <span>الأكثر طلباً</span>
                        </div>
                      )}

                      <div className="space-y-0.5">
                        <span className="text-sm sm:text-base font-black text-slate-900 dark:text-white block">
                          {offer.arabicTitle}
                        </span>
                        {offerExceedsStock ? (
                          <span className="block text-xs font-bold text-rose-500">غير متوفر بهذه الكمية</span>
                        ) : savings > 0 ? (
                          <span className="text-xs font-bold text-emerald-600 block">
                            {offer.quantity === 4 ? `وفّر ${savings} دج – ${perPiece} دج/قطعة` : `وفّر ${savings} دج`}
                          </span>
                        ) : null}
                      </div>

                      <div className="text-end">
                        <span className="text-base sm:text-lg font-black text-red-600 block" dir="ltr">
                          {formatPrice(offer.price)}
                        </span>
                        {Boolean(offer.compare_price && offer.compare_price > offer.price) && (
                          <span className="text-xs line-through text-slate-400 block font-bold" dir="ltr">
                            {formatPrice(offer.compare_price!)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </CheckoutForm>
        </div>

        {/* ── 6. SPECIAL OFFER YELLOW STRIP ── */}
        {reassuranceConfig.show_yellow_alert !== false && (
          <div className="w-full py-3 px-4 rounded-2xl bg-amber-100/90 border border-amber-300/80 text-center font-bold text-amber-900 text-xs sm:text-sm shadow-xs flex items-center justify-center gap-1.5">
            <span>{reassuranceConfig.yellow_alert_text || '🎁 عرض خاص: قناع عين للنوم هدية مجانية مع كل قطعة تطلبها'}</span>
          </div>
        )}

        {/* ── 7. LIFESTYLE IMAGE CARD 1 (Airplane Window Pillow + Mask) ── */}
        {reassuranceConfig.show_lifestyle_1 !== false && (
          <div className="w-full rounded-3xl overflow-hidden border border-slate-200/80 shadow-md bg-white">
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-50">
              <img
                src={reassuranceConfig.lifestyle_1_image || '/images/coussin/lifestyle-window.jpg'}
                alt="راحة في كل رحلة"
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
          </div>
        )}

        {/* ── 8. BEFORE / AFTER COMPARISON SECTION ── */}
        {reassuranceConfig.show_before_after !== false && (
          <div className="w-full space-y-4 pt-2">
            <div className="text-center space-y-1">
              <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                {reassuranceConfig.before_after_title || 'ودّع آلام الرقبة أثناء السفر'}
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 font-medium">
                {reassuranceConfig.before_after_subtitle || 'الفرق واضح من أول استعمال'}
              </p>
            </div>

            <div className="bg-white dark:bg-[#0E0E0E] rounded-3xl border border-slate-200/80 p-3 sm:p-4 shadow-md">
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                {/* Before (Right in RTL / Pain) */}
                <div className="space-y-2">
                  <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 border border-slate-200">
                    <img
                      src={reassuranceConfig.before_image || '/images/coussin/before-pain.jpg'}
                      alt="Before"
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="p-2 sm:p-2.5 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-100 text-center">
                    <p className="text-[10px] sm:text-xs font-bold text-slate-700 dark:text-slate-200 leading-snug">
                      {reassuranceConfig.before_text || 'ألم الرقبة، نوم غير مريح، تعب بعد الاستيقاظ'}
                    </p>
                  </div>
                </div>

                {/* After (Left in RTL / Relief) */}
                <div className="space-y-2">
                  <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 border border-blue-200">
                    <img
                      src={reassuranceConfig.after_image || '/images/coussin/after-relief.jpg'}
                      alt="After"
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="p-2 sm:p-2.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/20 border border-blue-100 text-center">
                    <p className="text-[10px] sm:text-xs font-bold text-slate-800 dark:text-slate-100 leading-snug">
                      {reassuranceConfig.after_text || 'دعم مثالي للرقبة، نوم هادئ، راحة طوال الرحلة'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 9. WHY CHOOSE SECTION ── */}
        {reassuranceConfig.show_why_choose !== false && (
          <div className="w-full space-y-4 pt-2">
            <div className="text-center space-y-1">
              <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                {reassuranceConfig.why_choose_title || `لماذا تختار وسادة ${storeName}؟`}
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 font-medium">
                {reassuranceConfig.why_choose_subtitle || 'مصممة لراحتك في كل رحلة'}
              </p>
            </div>

            <div className="bg-white dark:bg-[#0E0E0E] rounded-3xl border border-slate-200/80 p-3 sm:p-4 shadow-md overflow-hidden">
              <img
                src={reassuranceConfig.why_choose_image || '/images/coussin/why-choose-features.jpg'}
                alt="لماذا تختار وسادة السفر"
                className="w-full h-auto rounded-2xl object-cover"
                loading="lazy"
              />
            </div>
          </div>
        )}

        {/* ── 10. LIFESTYLE IMAGE CARD 2 (Passenger Sleeping) ── */}
        {reassuranceConfig.show_lifestyle_2 !== false && (
          <div className="w-full rounded-3xl overflow-hidden border border-slate-200/80 shadow-md bg-white">
            <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-50">
              <img
                src={reassuranceConfig.lifestyle_2_image || '/images/coussin/lifestyle-passenger.jpg'}
                alt="راحة ونوم هادئ في السفر"
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
          </div>
        )}

        {/* ── 11. COLORS SHOWCASE SECTION ── */}
        {reassuranceConfig.show_colors_showcase !== false && allVariantPhotos.length > 0 && (
          <div className="w-full space-y-4 pt-2">
            <div className="text-center space-y-1">
              <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                {reassuranceConfig.colors_showcase_title || 'متوفر بـ 5 ألوان'}
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 font-medium">
                {reassuranceConfig.colors_showcase_subtitle || 'اختر اللون لي يعجبك'}
              </p>
            </div>

            <div className="bg-white dark:bg-[#0E0E0E] rounded-3xl border border-slate-200/80 p-3 sm:p-4 shadow-md flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
              {allVariantPhotos.map((vItem, idx) => {
                const isSelected = selectedVariants[0]?.Couleur?.value === vItem.variant.value;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      handleSelectVariant(vItem.variant);
                      scrollToSection('checkout-form-container');
                    }}
                    className={cn(
                      "size-14 sm:size-16 rounded-2xl overflow-hidden border-2 transition-all p-0.5 bg-white shadow-xs cursor-pointer hover:scale-105 active:scale-95",
                      isSelected
                        ? "border-blue-600 ring-2 ring-blue-300 ring-offset-1"
                        : "border-slate-200 hover:border-slate-300"
                    )}
                    title={vItem.label}
                  >
                    <img
                      src={optimizeCloudinaryUrl(vItem.url, 160)}
                      alt={vItem.label}
                      className="size-full object-cover rounded-xl"
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── 12. CUSTOMER REVIEWS SECTION ── */}
        {reassuranceConfig.show_reviews_section !== false && (
          <div className="w-full space-y-4 pt-4 border-t border-slate-100 dark:border-white/10">
            <div className="text-center space-y-1.5">
              <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                {reassuranceConfig.reviews_title || 'ماذا قال زبائننا؟'}
              </h3>
              <div className="flex items-center justify-center gap-1.5 pt-0.5">
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} className="size-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {reassuranceConfig.reviews_rating_text || '4.7 من 5 – بناءً على تقييمات زبائننا عبر 58 ولاية'}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {(reassuranceConfig.reviews_list && reassuranceConfig.reviews_list.length > 0
                ? reassuranceConfig.reviews_list
                : (data.testimonials && data.testimonials.length > 0
                  ? data.testimonials.map((t: any) => ({
                      name: t.name,
                      city: t.location,
                      stars: t.stars || 5,
                      text: t.text,
                      verified: true,
                    }))
                  : [
                      {
                        name: 'أمينة ب.',
                        city: 'الجزائر العاصمة',
                        stars: 5,
                        text: 'جربتها في رحلة طويلة، رقبتي ما وجعتنيش والقناع زادني راحة. التوصيل جا في يومين برك.',
                        verified: true,
                      },
                      {
                        name: 'كريم م.',
                        city: 'وهران',
                        stars: 5,
                        text: 'جودة روعة إسفنج ميموري فوم مريح جداً، والقناع الهدية ممتاز. ننصح بيها لأي واحد يسافر بزاف.',
                        verified: true,
                      },
                      {
                        name: 'سارة ت.',
                        city: 'قسنطينة',
                        stars: 5,
                        text: 'وصلتني في وقت قياسي وتغليف متقن، خفيفة وسهلة الحمل في الحقيبة.',
                        verified: true,
                      },
                    ]
                )
              ).map((review: any, idx: number) => (
                <div
                  key={idx}
                  className="bg-white dark:bg-[#0E0E0E] rounded-3xl border border-slate-200/80 p-4 sm:p-5 shadow-xs space-y-2.5 text-start"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-black text-slate-900 dark:text-white">{review.name}</p>
                      <p className="text-[11px] text-slate-400 font-medium">{review.city}</p>
                    </div>
                    <div className="flex gap-0.5">
                      {Array.from({ length: review.stars || 5 }).map((_, j) => (
                        <Star key={j} className="size-3.5 fill-amber-400 text-amber-400" />
                      ))}
                    </div>
                  </div>

                  <p className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 leading-relaxed">
                    {review.text}
                  </p>

                  {review.verified !== false && (
                    <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 pt-1 border-t border-slate-100 dark:border-white/5">
                      <span>✓</span>
                      <span>مشترية موثّقة</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 13. FAQ ACCORDION ── */}
        {validFaq.length > 0 && (
          <div className="w-full space-y-4 pt-4 border-t border-slate-100 dark:border-white/10">
            <div className="text-center space-y-1">
              <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                أسئلة شائعة
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 font-medium">
                كل ما تحتاج لمعرفته قبل الطلب
              </p>
            </div>

            <div className="space-y-2.5">
              {validFaq.map((item, i) => {
                const isOpen = openFaq === i;
                return (
                  <div
                    key={i}
                    className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white dark:bg-[#0E0E0E] overflow-hidden shadow-xs"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaq(isOpen ? null : i)}
                      className="w-full flex items-center justify-between p-4 text-right font-bold text-xs sm:text-sm text-slate-800 dark:text-white gap-3 select-none cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="size-6 rounded-full bg-rose-50 text-rose-500 font-black text-xs flex items-center justify-center shrink-0">
                          ؟
                        </span>
                        <span className="text-right font-bold leading-snug">{item.question}</span>
                      </div>
                      <ChevronDown className={cn("size-4 text-slate-400 transition-transform duration-200 shrink-0", isOpen ? "rotate-180" : "")} />
                    </button>
                    {isOpen && (
                      <div className="px-5 pb-4 pt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed border-t border-slate-100 dark:border-white/5 font-medium">
                        {item.answer}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── 14. BOTTOM REASSURANCE BANNER CARD ── */}
        {reassuranceConfig.show_bottom_card !== false && (
          <div
            className="mt-8 rounded-3xl overflow-hidden shadow-xl border"
            style={{
              backgroundColor: reassuranceConfig.bottom_card_bg || '#0F172A',
              borderColor: reassuranceConfig.bottom_card_border || 'rgba(226, 232, 240, 0.8)',
            }}
          >
            {reassuranceConfig.bottom_card_image && (
              <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-800">
                <img
                  src={optimizeCloudinaryUrl(reassuranceConfig.bottom_card_image, 800)}
                  alt="Bottom card"
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            )}
            <div className="p-6 text-center space-y-3">
              <h4
                className="text-xl font-black"
                style={{ color: reassuranceConfig.bottom_card_title_color || '#FFFFFF' }}
              >
                {reassuranceConfig.bottom_card_title || 'اجعل كل رحلة أكثر راحة'}
              </h4>
              <p
                className="text-xs sm:text-sm leading-relaxed max-w-sm mx-auto"
                style={{ color: reassuranceConfig.bottom_card_subtitle_color || '#CBD5E1' }}
              >
                {reassuranceConfig.bottom_card_subtitle || 'وسادة سفر مريحة مع قناع عين هدية 🎁 - في السيارة أو الطائرة • الدفع عند الاستلام والتوصيل لباب دارك'}
              </p>
              <button
                type="button"
                onClick={() => scrollToSection('checkout-form-container')}
                className="w-full max-w-xs mx-auto py-3.5 px-6 rounded-2xl font-black text-sm tracking-wide shadow-lg active:scale-95 transition-all cursor-pointer"
                style={{
                  backgroundColor: reassuranceConfig.bottom_card_btn_bg || '#B91C1C',
                  color: reassuranceConfig.bottom_card_btn_text_color || '#FFFFFF',
                }}
              >
                {reassuranceConfig.bottom_card_btn_text || `اطلب الآن — ${price} دج فقط`}
              </button>
            </div>
          </div>
        )}

      </div>

      {/* ── 15. ELEGANT FOOTER ── */}
      {reassuranceConfig.show_footer !== false && (
        <footer
          className="w-full pt-10 pb-28 sm:pb-12 border-t text-center mt-8"
          style={{
            backgroundColor: reassuranceConfig.footer_bg || '#0B132B',
            borderColor: reassuranceConfig.footer_border || '#1E293B',
            color: reassuranceConfig.footer_text_color || '#CBD5E1',
          }}
        >
          <div className="max-w-[600px] mx-auto px-4 flex flex-col items-center">
            {storeLogo ? (
              <div className="mb-4">
                <img
                  src={optimizeCloudinaryUrl(storeLogo, 200)}
                  alt={storeName}
                  className="h-10 sm:h-11 w-auto object-contain bg-transparent mx-auto"
                />
              </div>
            ) : (
              <div className="text-lg font-black tracking-widest uppercase mb-4" style={{ color: reassuranceConfig.footer_text_color || '#FFFFFF' }}>
                {storeName}
              </div>
            )}

            {/* Contact & WhatsApp */}
            <div className="flex flex-wrap items-center justify-center gap-3 text-xs font-bold mb-2" dir="rtl">
              <a href={`tel:${cleanPhone}`} className="hover:opacity-80 transition-opacity flex items-center gap-1.5" style={{ color: reassuranceConfig.footer_text_color || '#CBD5E1' }}>
                <Phone className="size-3.5 text-emerald-400 shrink-0" />
                <span>للتواصل: <span className="font-mono">{formattedPhone}</span></span>
              </a>
              <span className="opacity-40">•</span>
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:opacity-80 transition-opacity flex items-center gap-1.5"
                style={{ color: reassuranceConfig.footer_text_color || '#CBD5E1' }}
              >
                <span className="text-emerald-400 font-black">واتساب:</span>
                <span className="font-mono">{formattedPhone}</span>
              </a>
            </div>

            {/* Dedicated WhatsApp Button */}
            {reassuranceConfig.whatsapp_enabled !== false && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#20ba59] text-white font-bold px-6 py-2.5 rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 text-xs sm:text-sm my-3"
              >
                <MessageCircle className="size-4.5" />
                <span>{reassuranceConfig.whatsapp_btn_text || 'تواصل معنا عبر واتساب'}</span>
              </a>
            )}

            <p className="text-[11px] font-medium mb-3 mt-1 opacity-80">
              {reassuranceConfig.footer_disclaimer_text || 'الدفع عند الاستلام • توصيل سريع لـ 58 ولاية • ضمان الاستبدال'}
            </p>

            <p className="text-[10px] font-semibold tracking-wider opacity-60">
              © {new Date().getFullYear()} {storeName}. جميع الحقوق محفوظة.
            </p>
          </div>
        </footer>
      )}

      {/* ── 16. FLOATING WHATSAPP BUTTON ── */}
      {reassuranceConfig.whatsapp_enabled !== false && (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Contact WhatsApp"
          className="fixed bottom-20 sm:bottom-6 left-6 z-40 size-13 sm:size-14 rounded-full bg-[#25D366] hover:bg-[#20ba59] text-white shadow-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 cursor-pointer"
          title="تواصل معنا عبر واتساب"
        >
          <MessageCircle className="size-6 sm:size-7 fill-white/20" />
        </a>
      )}

      {/* ── 17. MOBILE FIXED BOTTOM CTA BUTTON ── */}
      {reassuranceConfig.show_mobile_sticky_cta !== false && (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 p-3 backdrop-blur-md border-t flex justify-center items-center shadow-[0_-8px_30px_rgb(0,0,0,0.12)] sm:hidden"
          style={{
            backgroundColor: reassuranceConfig.mobile_sticky_bar_bg || 'rgba(255, 255, 255, 0.95)',
            borderColor: reassuranceConfig.mobile_sticky_border || 'rgba(226, 232, 240, 0.8)',
          }}
        >
          <button
            type="button"
            onClick={() => scrollToSection('checkout-form-container')}
            className="w-full py-3.5 rounded-2xl font-black uppercase tracking-wider text-xs shadow-md active:scale-[0.97] transition-all flex items-center justify-center gap-2 cursor-pointer"
            style={{
              backgroundColor: reassuranceConfig.mobile_sticky_btn_bg || '#B91C1C',
              color: reassuranceConfig.mobile_sticky_btn_text_color || '#FFFFFF',
            }}
          >
            <ShoppingBag className="size-4" />
            <span>{reassuranceConfig.mobile_sticky_cta_text || reassuranceConfig.header_cta_text || 'اضغط هنا للطلب'}</span>
          </button>
        </div>
      )}

    </div>
  );
}
