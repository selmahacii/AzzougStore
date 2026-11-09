'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle, Package, ShoppingBag,
  MapPin, User, Loader2, Tag, X, Phone, Home, Building2, ShieldCheck, Truck, RotateCcw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAppStore } from '@/store/app-store';
import { useCartStore } from '@/store/cart-store';
import { formatPrice } from '@/lib/format';
import { useTranslation } from '@/hooks/use-translation';
import { cn } from '@/lib/utils';
import { trackMetaEvent, getOrCreateCheckoutAttemptId, clearCheckoutAttemptId } from '@/lib/meta-tracking';
import { attributionPayload, getFbp, getFbc } from '@/lib/attribution';
import { ALGERIA_WILAYAS, getStandardDeliveryFee, getWilayaByName } from '@/data/algeria-cities';
import { ALGERIAN_COMMUNES } from '@/lib/algerian-communes';
import type { CartItem } from '@/lib/types';

const COLOR_MAP: Record<string, string> = {
  'noir': '#2d3436', 'noire': '#2d3436', 'blanc': '#ffffff', 'blanche': '#ffffff',
  'rouge': '#d63031', 'bleu': '#0984e3', 'bleue': '#0984e3', 'vert': '#2ecc71',
  'verte': '#2ecc71', 'jaune': '#f1c40f', 'rose': '#e84393', 'gris': '#7f8c8d',
  'grise': '#7f8c8d', 'marron': '#a0522d', 'orange': '#e67e22', 'violet': '#9b59b6',
  'beige': '#f5f5dc', 'أسود': '#2d3436', 'اسود': '#2d3436', 'أبيض': '#ffffff',
  'ابيض': '#ffffff', 'أحمر': '#d63031', 'احمر': '#d63031', 'أزرق': '#0984e3',
  'ازرق': '#0984e3', 'رمادي': '#7f8c8d', 'وردي': '#e84393',
};

function getVariantColor(val: string): string | null {
  if (!val) return null;
  const v = val.toLowerCase().trim();
  if (v.startsWith('#')) return v;
  return COLOR_MAP[v] || null;
}

type DeliveryType = 'HOME' | 'OFFICE';

interface CustomerInfo {
  firstName: string;
  lastName: string;
  phone: string;
  phone2: string;
  wilaya: string;
  commune: string;
  address: string;
  deliveryType: DeliveryType;
}

export function normalizeAlgerianPhone(ph: string): string {
  if (!ph) return '';
  let digits = ph.replace(/\D/g, '');
  if (digits.startsWith('00213')) {
    digits = digits.substring(5);
  } else if (digits.startsWith('213')) {
    digits = digits.substring(3);
  }
  if (digits.length === 9 && ['5', '6', '7'].includes(digits[0])) {
    digits = '0' + digits;
  }
  return digits;
}

function useCheckoutTheme(activeStore: any) {
  const _rawTpl = (activeStore?.template_id ?? activeStore?.theme_config?.templateId ?? 'clean') as string;
  const tpl = _rawTpl === 'minimalist' ? 'clean' : _rawTpl === 'landing' ? 'athletic' : _rawTpl.toLowerCase();
  const primary = (activeStore?.theme_config?.primaryColor as string) || '#4b7bec';

  return {
    tpl, primary,
    pageBg: '#ffffff',
    cardBg: '#ffffff',
    cardBorder: '#f1f5f9',
    inputBg: '#f9fafb',
    inputBorder: '#e5e7eb',
    inputBorderFocus: primary,
    inputText: '#1e293b',
    inputPlaceholder: '#94a3b8',
    labelColor: '#64748b',
    textPrimary: '#0f172a',
    textSecondary: '#94a3b8',
    stepDoneBg: primary, stepDoneText: '#ffffff',
    stepActiveBg: '#ffffff', stepActiveBorder: primary, stepActiveText: primary,
    stepInactiveBg: '#ffffff', stepInactiveBorder: '#e2e8f0', stepInactiveText: '#94a3b8',
    connectorDone: primary, connectorInactive: '#e2e8f0',
    btnText: '#ffffff', dividerColor: '#f1f5f9',
    successBg: '#f0fdf4', summaryBg: '#f9fafb',
    radius: '12px', inputRadius: '10px', btnRadius: '12px',
  };
}

function extractFirstPartyMetaCookies(): { fbp?: string; fbc?: string } {
  if (typeof document === 'undefined') return {};
  const getCookie = (name: string) => {
    const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[1]) : undefined;
  };
  const fbp = getCookie('_fbp') || getFbp();
  const fbc = getCookie('_fbc') || getFbc();
  return { fbp, fbc };
}

interface CheckoutFormProps {
  isInline?: boolean;
  forceTemplate?: string;
  children?: React.ReactNode;
  data?: any;
  product?: any;
  offers?: any[];
}

export function CheckoutForm({
  isInline = false,
  forceTemplate,
  children,
  data,
  product: initialProduct,
  offers: initialOffers,
}: CheckoutFormProps) {
  const activeStore = useAppStore((s) => s.activeStore);
  const setStorefrontView = useAppStore((s) => s.setStorefrontView);
  const items = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clearCart);
  const { t, dir } = useTranslation();

  const product = initialProduct || data?.product || items[0]?.product || null;

  // ── Offers configuration (Admin personalized or high-converting defaults) ──
  const configuredOffers = useMemo(() => {
    const dbOffers = data?.offers || initialOffers;
    if (Array.isArray(dbOffers) && dbOffers.length > 0) {
      return dbOffers.map((o: any, idx: number) => ({
        name: o.name || `Pack ${o.quantity} Pièce${o.quantity > 1 ? 's' : ''}`,
        quantity: Number(o.quantity) || idx + 1,
        price: Number(o.price) || 2900,
        compare_price: Number(o.compare_price) || (Number(o.price) ? Math.round(Number(o.price) * 1.25) : 3500),
        desc: o.desc || (o.quantity >= 2 ? 'Livraison Gratuite' : "+ Frais d'envoi"),
        popular: Boolean(o.popular || idx === 1),
        free_shipping: o.free_shipping !== undefined ? Boolean(o.free_shipping) : o.quantity >= 2,
      }));
    }
    // High-converting CRO bundles for Coussin / COD DZ
    return [
      {
        name: dir === 'rtl' ? 'عرض 1 وسادة' : 'Pack 1 Coussin',
        quantity: 1,
        price: 2900,
        compare_price: 3500,
        desc: dir === 'rtl' ? '+ مصاريف التوصيل' : "+ Frais de livraison standard",
        popular: false,
        free_shipping: false,
      },
      {
        name: dir === 'rtl' ? 'عرض 2 وسائد (الأكثر طلباً)' : 'Pack 2 Coussins (Le plus choisi)',
        quantity: 2,
        price: 4900,
        compare_price: 5800,
        desc: dir === 'rtl' ? 'توصيل مجاني (-50% على الثانية)' : 'Livraison Gratuite (-50% sur le 2e)',
        popular: true,
        free_shipping: true,
      },
      {
        name: dir === 'rtl' ? 'عرض 3 وسائد (العائلة)' : 'Pack 3 Coussins (Famille)',
        quantity: 3,
        price: 6500,
        compare_price: 8700,
        desc: dir === 'rtl' ? 'توصيل مجاني (أفضل سعر)' : 'Livraison Gratuite (Meilleure offre)',
        popular: false,
        free_shipping: true,
      },
    ];
  }, [data?.offers, initialOffers, dir]);

  // Pre-select Pack 2 by default for max AOV and free shipping incentive
  const [selectedOfferIndex, setSelectedOfferIndex] = useState(1);
  const currentOffer = configuredOffers[selectedOfferIndex] || configuredOffers[0];

  // Selected variant colors per unit in pack
  const variantsList = useMemo(() => {
    return product?.variants || [];
  }, [product]);

  const [selectedColors, setSelectedColors] = useState<string[]>(() => {
    const firstVal = variantsList[0]?.value || variantsList[0]?.name || 'Noir';
    return [firstVal, firstVal, firstVal];
  });

  const submittingRef = useRef(false);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [abandonedCartId, setAbandonedCartId] = useState<string | null>(null);

  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    firstName: '', lastName: '', phone: '', phone2: '',
    wilaya: 'Alger', commune: '', address: '', deliveryType: 'HOME',
  });

  const baseT = useCheckoutTheme(activeStore);
  const T = forceTemplate ? { ...baseT, tpl: forceTemplate } : baseT;
  const primary = T.primary;

  // Single-fire InitiateCheckout attached strictly to first interaction
  const initiateCheckoutFiredRef = useRef(false);
  const handleInitiateCheckoutOnInteraction = useCallback(() => {
    if (initiateCheckoutFiredRef.current) return;
    initiateCheckoutFiredRef.current = true;
    try {
      void trackMetaEvent('InitiateCheckout', {
        content_name: product?.name || 'Commande Coussin',
        value: currentOffer.price,
        currency: 'DZD',
      }, {
        storeId: activeStore?.id || data?.store_id,
        lpId: data?.id,
        value: currentOffer.price,
        currency: 'DZD',
      });
    } catch {}
  }, [currentOffer.price, product?.name, activeStore?.id, data?.store_id, data?.id]);

  // Instant delivery fee calculation (0ms, zero network fetch)
  const currentDeliveryFee = useMemo(() => {
    if (currentOffer.free_shipping) return 0;
    return getStandardDeliveryFee(customerInfo.wilaya, customerInfo.deliveryType);
  }, [currentOffer.free_shipping, customerInfo.wilaya, customerInfo.deliveryType]);

  const finalTotal = useMemo(() => {
    return currentOffer.price + currentDeliveryFee;
  }, [currentOffer.price, currentDeliveryFee]);

  // Abandoned cart background capture (only after valid 10-digit phone)
  useEffect(() => {
    const cleanPh = normalizeAlgerianPhone(customerInfo.phone);
    if (cleanPh.length !== 10 || orderSuccess) return;

    const timeout = setTimeout(async () => {
      try {
        const payload = {
          store_id: activeStore?.id || data?.store_id,
          customer_phone: cleanPh,
          customer_name: customerInfo.firstName.trim() || undefined,
          customer_wilaya: customerInfo.wilaya,
          customer_commune: customerInfo.commune.trim() || undefined,
          total: finalTotal,
          source: isInline ? 'landing_page' : 'storefront',
          items: [{
            product_id: product?.id || 'coussin-de-voyage',
            product_name: product?.name || currentOffer.name,
            quantity: currentOffer.quantity,
            unit_price: Math.round(currentOffer.price / currentOffer.quantity),
            variant_details: {
              colors: selectedColors.slice(0, currentOffer.quantity),
              offer: currentOffer.name,
            },
          }],
          checkout_attempt_id: getOrCreateCheckoutAttemptId(),
          ...attributionPayload(),
          ...extractFirstPartyMetaCookies(),
        };

        const res = await fetch('/api/v1/orders/abandoned', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.data?.id || json.id) setAbandonedCartId(json.data?.id || json.id);
        }
      } catch {}
    }, 2500);

    return () => clearTimeout(timeout);
  }, [customerInfo.phone, customerInfo.firstName, customerInfo.wilaya, customerInfo.commune, finalTotal, orderSuccess, currentOffer, selectedColors, activeStore?.id, data?.store_id, isInline, product?.id, product?.name]);

  // Submit order handler
  const handleSubmit = async () => {
    if (submittingRef.current) return;
    setErrors({});

    const cleanPhone = normalizeAlgerianPhone(customerInfo.phone);
    const newErrors: Record<string, string> = {};

    if (!cleanPhone || cleanPhone.length !== 10) {
      newErrors.phone = dir === 'rtl' ? 'يرجى إدخال رقم هاتف صحيح (10 أرقام)' : 'Veuillez saisir un numéro de téléphone valide (10 chiffres)';
    }
    if (!customerInfo.firstName.trim()) {
      newErrors.firstName = dir === 'rtl' ? 'الاسم مطلوب' : 'Le nom complet est requis';
    }
    if (!customerInfo.wilaya) {
      newErrors.wilaya = dir === 'rtl' ? 'يرجى اختيار الولاية' : 'Veuillez sélectionner la wilaya';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);

    try {
      const { fbp, fbc } = extractFirstPartyMetaCookies();

      const orderItems = [{
        product_id: product?.id || 'coussin-de-voyage',
        product_name: product?.name || currentOffer.name,
        quantity: currentOffer.quantity,
        unit_price: Math.round(currentOffer.price / currentOffer.quantity),
        variant_details: {
          colors: selectedColors.slice(0, currentOffer.quantity),
          offer: currentOffer.name,
        },
      }];

      const payload = {
        store_id: activeStore?.id || data?.store_id,
        customer_name: customerInfo.firstName.trim(),
        customer_phone: cleanPhone,
        customer_phone2: customerInfo.phone2.trim() || undefined,
        customer_wilaya: customerInfo.wilaya,
        customer_commune: customerInfo.commune.trim() || undefined,
        customer_address: customerInfo.commune.trim() || customerInfo.wilaya,
        shipping_fee: currentDeliveryFee,
        total: finalTotal,
        discount: 0,
        source: isInline ? 'landing_page' : 'storefront',
        items: orderItems,
        abandoned_cart_id: abandonedCartId,
        checkout_attempt_id: getOrCreateCheckoutAttemptId(),
        ...attributionPayload(),
        fbp,
        fbc,
      };

      const res = await fetch('/api/v1/orders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (res.ok && (json.id || json.order_number || json.orderNumber)) {
        const orderId = String(json.order_number ?? json.orderNumber ?? json.id ?? '');
        const finalOrderId = json.id || orderId;
        const purchaseEventId = `purchase-${orderId}`;

        // Synchronous Pixel Lead
        void trackMetaEvent('Lead', {
          content_name: product?.name || 'Commande Coussin',
          value: finalTotal,
          currency: 'DZD',
        }, {
          eventId: `lead-${orderId}`,
          storeId: activeStore?.id || data?.store_id,
          orderId: finalOrderId,
          userData: {
            phone: cleanPhone,
            first_name: customerInfo.firstName.trim(),
            wilaya: customerInfo.wilaya,
          },
          value: finalTotal,
          currency: 'DZD',
        });

        // Synchronous Browser Pixel Purchase deduplicated with CAPI via identical eventId
        void trackMetaEvent('Purchase', {
          content_type: 'product',
          contents: orderItems.map((item: any) => ({ id: item.product_id, quantity: item.quantity })),
          value: finalTotal,
          currency: 'DZD',
        }, {
          eventId: purchaseEventId,
          storeId: activeStore?.id || data?.store_id,
          orderId: finalOrderId,
          userData: {
            phone: cleanPhone,
            first_name: customerInfo.firstName.trim(),
            wilaya: customerInfo.wilaya,
          },
          value: finalTotal,
          currency: 'DZD',
          contents: orderItems.map((item: any) => ({ id: item.product_id, quantity: item.quantity })),
        });

        clearCheckoutAttemptId();
        setOrderNumber(orderId);
        clearCart();
        setStep(2);
        setOrderSuccess(true);
      } else {
        const msg = json.detail ?? json.message ?? 'Une erreur est survenue. Veuillez vérifier vos informations.';
        setErrors({ general: typeof msg === 'string' ? msg : JSON.stringify(msg) });
      }
    } catch {
      setErrors({ general: 'Erreur de connexion. Vérifiez votre réseau et réessayez.' });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const scrollToCheckout = () => {
    const el = document.getElementById('checkout-form-container') || document.getElementById('checkout-form');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const ph = document.getElementById('phone');
      if (ph) ph.focus();
    }
  };

  return (
    <div id="checkout-form" className="w-full">
      <div
        className={cn(
          "w-full transition-all",
          isInline ? "p-0" : "max-w-xl mx-auto p-4 sm:p-6 rounded-2xl border shadow-sm bg-white dark:bg-slate-900"
        )}
      >
        {/* ── STEP 0: Formulaire Principal ── */}
        {step === 0 && (
          <div
            className="space-y-5"
            onFocusCapture={handleInitiateCheckoutOnInteraction}
            onPointerDownCapture={handleInitiateCheckoutOnInteraction}
          >
            {errors.general && (
              <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-bold">
                {errors.general}
              </div>
            )}

            {/* Custom Children from parent OR Built-in Offer & Variant Selectors */}
            {children ? (
              <div className="mb-4">{children}</div>
            ) : (
              <div className="space-y-5">
                {/* 1. Bundling / Offer Pack Selector */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-800 dark:text-white/80">
                      {dir === 'rtl' ? '1. اختر العرض المناسب :' : '1. Choisissez votre pack :'}
                    </p>
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
                      {dir === 'rtl' ? 'ضمان الرضا 100%' : 'Satisfaction garantie'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5">
                    {configuredOffers.map((offer: any, idx: number) => {
                      const isSelected = selectedOfferIndex === idx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setSelectedOfferIndex(idx)}
                          className={cn(
                            "relative w-full p-3.5 sm:p-4 rounded-2xl border-2 text-left rtl:text-right transition-all flex items-center justify-between overflow-hidden",
                            isSelected
                              ? "border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 shadow-sm ring-1 ring-emerald-500"
                              : "border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 bg-white dark:bg-white/[0.02]"
                          )}
                        >
                          {offer.popular && (
                            <div className="absolute top-0 right-0 rtl:right-auto rtl:left-0 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white bg-rose-500 rounded-bl-lg rtl:rounded-bl-none rtl:rounded-br-lg shadow-sm">
                              {dir === 'rtl' ? 'الأكثر طلباً ⭐' : 'Le plus choisi ⭐'}
                            </div>
                          )}

                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                "size-5 rounded-full border-2 flex items-center justify-center transition-all",
                                isSelected ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 dark:border-white/20"
                              )}
                            >
                              {isSelected && <Check className="size-3 stroke-[3]" />}
                            </div>
                            <div>
                              <p className="text-sm font-black text-slate-900 dark:text-white">
                                {offer.name}
                              </p>
                              <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                                {offer.desc}
                              </p>
                            </div>
                          </div>

                          <div className="text-right rtl:text-left">
                            <p className="text-base font-black text-slate-900 dark:text-white">
                              {formatPrice(offer.price)}
                            </p>
                            {offer.compare_price > offer.price && (
                              <p className="text-[10px] line-through text-slate-400 font-medium">
                                {formatPrice(offer.compare_price)}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Variant / Color Selector (if product has variants) */}
                {variantsList.length > 0 && (
                  <div className="space-y-3 pt-2">
                    <p className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-800 dark:text-white/80">
                      {dir === 'rtl' ? '2. اختر الألوان المفضلة :' : '2. Choisissez les couleurs :'}
                    </p>
                    <div className="space-y-2">
                      {Array.from({ length: currentOffer.quantity }).map((_, unitIdx) => (
                        <div
                          key={unitIdx}
                          className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/[0.02]"
                        >
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                            {dir === 'rtl' ? `وسادة ${unitIdx + 1} : ` : `Coussin ${unitIdx + 1} : `}
                          </span>
                          <div className="flex items-center gap-2">
                            {variantsList.map((v: any, vIdx: number) => {
                              const val = v.value || v.name;
                              const isPicked = (selectedColors[unitIdx] || variantsList[0]?.value) === val;
                              const hex = getVariantColor(val);
                              return (
                                <button
                                  key={vIdx}
                                  type="button"
                                  onClick={() => {
                                    const next = [...selectedColors];
                                    next[unitIdx] = val;
                                    setSelectedColors(next);
                                  }}
                                  className={cn(
                                    "px-2.5 py-1 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5",
                                    isPicked
                                      ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 ring-1 ring-emerald-500"
                                      : "border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                                  )}
                                >
                                  {hex && (
                                    <span
                                      className="size-3 rounded-full border border-black/10 shrink-0"
                                      style={{ backgroundColor: hex }}
                                    />
                                  )}
                                  <span>{val}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 3. Coordonnées de Livraison COD */}
            <div className="space-y-3 pt-2">
              <p className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-800 dark:text-white/80">
                {dir === 'rtl' ? 'معلومات التوصيل :' : 'Coordonnées de livraison :'}
              </p>

              {/* Téléphone */}
              <div className="space-y-1">
                <label htmlFor="phone" className="text-[11px] font-black uppercase tracking-wider flex items-center gap-1 text-slate-700 dark:text-slate-300">
                  <Phone className="size-3 text-emerald-500" /> {dir === 'rtl' ? 'رقم الهاتف (ضروري لتأكيد الطلب)' : 'Numéro de téléphone'}
                </label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder={dir === 'rtl' ? '0555 12 34 56' : '0555 123 456'}
                  value={customerInfo.phone}
                  onChange={e => setCustomerInfo({ ...customerInfo, phone: e.target.value })}
                  className={cn("h-12 text-base font-mono font-bold tracking-wider", errors.phone && "border-rose-500")}
                  dir="ltr"
                />
                {errors.phone && <p className="text-[11px] font-bold text-rose-500">{errors.phone}</p>}
              </div>

              {/* Nom Complet */}
              <div className="space-y-1">
                <label htmlFor="firstName" className="text-[11px] font-black uppercase tracking-wider flex items-center gap-1 text-slate-700 dark:text-slate-300">
                  <User className="size-3 text-emerald-500" /> {dir === 'rtl' ? 'الاسم الكامل' : 'Nom complet'}
                </label>
                <Input
                  id="firstName"
                  placeholder={dir === 'rtl' ? 'محمد بن علي' : 'Mohamed Benali'}
                  value={customerInfo.firstName}
                  onChange={e => setCustomerInfo({ ...customerInfo, firstName: e.target.value })}
                  className={cn("h-12 text-sm font-bold", errors.firstName && "border-rose-500")}
                />
                {errors.firstName && <p className="text-[11px] font-bold text-rose-500">{errors.firstName}</p>}
              </div>

              {/* Wilaya (Instant 58 Wilayas Dropdown - Zero Network Delay) */}
              <div className="space-y-1">
                <label htmlFor="wilaya" className="text-[11px] font-black uppercase tracking-wider flex items-center gap-1 text-slate-700 dark:text-slate-300">
                  <MapPin className="size-3 text-emerald-500" /> {dir === 'rtl' ? 'الولاية (58 ولاية)' : 'Wilaya (58 Wilayas)'}
                </label>
                <Select
                  value={customerInfo.wilaya}
                  onValueChange={v => setCustomerInfo({ ...customerInfo, wilaya: v, commune: '' })}
                >
                  <SelectTrigger id="wilaya" className="h-12 text-sm font-bold w-full bg-white dark:bg-slate-900 border-2">
                    <SelectValue placeholder={dir === 'rtl' ? 'اختر الولاية' : 'Sélectionnez votre wilaya'} />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {ALGERIA_WILAYAS.map(w => (
                      <SelectItem key={w.code} value={w.name} className="font-medium">
                        {w.code} - {dir === 'rtl' ? `${w.nameAr} (${w.name})` : `${w.name} (${w.nameAr})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.wilaya && <p className="text-[11px] font-bold text-rose-500">{errors.wilaya}</p>}
              </div>

              {/* Commune (Simple text with native datalist autocomplete - No mobile popup locks) */}
              <div className="space-y-1">
                <label htmlFor="commune" className="text-[11px] font-black uppercase tracking-wider flex items-center gap-1 text-slate-700 dark:text-slate-300">
                  <Building2 className="size-3 text-emerald-500" /> {dir === 'rtl' ? 'البلدية' : 'Commune'}
                </label>
                <Input
                  id="commune"
                  list="communes-list"
                  placeholder={dir === 'rtl' ? 'اكتب اسم البلدية' : 'Nom de votre commune'}
                  value={customerInfo.commune}
                  onChange={e => setCustomerInfo({ ...customerInfo, commune: e.target.value })}
                  className="h-12 text-sm font-medium"
                />
                <datalist id="communes-list">
                  {(ALGERIAN_COMMUNES[customerInfo.wilaya] || []).map(c => (
                    <option key={c.id} value={dir === 'rtl' ? c.name : c.nameAscii} />
                  ))}
                </datalist>
              </div>

              {/* Delivery Type: Home vs Desk */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCustomerInfo({ ...customerInfo, deliveryType: 'HOME' })}
                  className={cn(
                    "p-3 rounded-xl border-2 text-xs font-bold transition-all flex items-center justify-center gap-2",
                    customerInfo.deliveryType === 'HOME'
                      ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                      : "border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400"
                  )}
                >
                  <Home className="size-4 shrink-0" />
                  <span>{dir === 'rtl' ? 'توصيل للبيت' : 'À domicile'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCustomerInfo({ ...customerInfo, deliveryType: 'OFFICE' })}
                  className={cn(
                    "p-3 rounded-xl border-2 text-xs font-bold transition-all flex items-center justify-center gap-2",
                    customerInfo.deliveryType === 'OFFICE'
                      ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                      : "border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400"
                  )}
                >
                  <Building2 className="size-4 shrink-0" />
                  <span>{dir === 'rtl' ? 'مكتب التوصيل' : 'Stop Desk'}</span>
                </button>
              </div>
            </div>

            {/* 4. Real-time Pricing Summary */}
            <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-400">
                <span>{dir === 'rtl' ? 'سعر المنتجات :' : 'Prix du pack :'}</span>
                <span>{formatPrice(currentOffer.price)}</span>
              </div>
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-slate-600 dark:text-slate-400">{dir === 'rtl' ? 'التوصيل :' : 'Livraison :'}</span>
                {currentDeliveryFee === 0 ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-black uppercase text-[11px] bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 rounded">
                    {dir === 'rtl' ? 'مجاني 100%' : 'Gratuite'}
                  </span>
                ) : (
                  <span className="text-slate-800 dark:text-slate-200">{formatPrice(currentDeliveryFee)}</span>
                )}
              </div>
              <div className="pt-2 border-t border-slate-200 dark:border-white/10 flex items-center justify-between">
                <span className="text-sm font-black text-slate-900 dark:text-white">{dir === 'rtl' ? 'المبلغ الإجمالي :' : 'Total à payer :'}</span>
                <span className="text-xl font-black text-emerald-600 dark:text-emerald-400">{formatPrice(finalTotal)}</span>
              </div>
            </div>

            {/* 5. CTA Validation Button */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className={cn(
                "w-full h-14 rounded-2xl font-black uppercase tracking-wider text-base text-white shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2",
                submitting ? "opacity-75 cursor-not-allowed" : "hover:brightness-110"
              )}
              style={{ backgroundColor: primary }}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  <span>{dir === 'rtl' ? 'جاري تأكيد طلبك...' : 'Validation en cours...'}</span>
                </>
              ) : (
                <>
                  <CheckCircle className="size-5" />
                  <span>{dir === 'rtl' ? 'اضغط هنا لتأكيد الطلب — الدفع عند الاستلام' : 'Confirmer la commande — COD'}</span>
                </>
              )}
            </button>

            {/* 6. Badges de Réassurance Visuels (Immediately below Submit CTA) */}
            <div className="pt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-slate-100/70 dark:bg-white/5 border border-slate-200/60 dark:border-white/10 text-[11px] font-bold text-slate-700 dark:text-slate-300">
                <Truck className="size-3.5 text-emerald-500 shrink-0" />
                <span>{dir === 'rtl' ? 'الدفع عند الاستلام' : 'Paiement à la livraison'}</span>
              </div>
              <div className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-slate-100/70 dark:bg-white/5 border border-slate-200/60 dark:border-white/10 text-[11px] font-bold text-slate-700 dark:text-slate-300">
                <Package className="size-3.5 text-blue-500 shrink-0" />
                <span>{dir === 'rtl' ? 'معاينة قبل الدفع' : 'Vérification autorisée'}</span>
              </div>
              <div className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-slate-100/70 dark:bg-white/5 border border-slate-200/60 dark:border-white/10 text-[11px] font-bold text-slate-700 dark:text-slate-300">
                <RotateCcw className="size-3.5 text-amber-500 shrink-0" />
                <span>{dir === 'rtl' ? 'إرجاع واستبدال 48 ساعة' : 'Échange garanti 48h'}</span>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2: Écran de Succès (Instant Confirmation) ── */}
        {step === 2 && orderSuccess && (
          <div className="py-12 px-4 text-center space-y-5 animate-in fade-in duration-300">
            <div className="size-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center text-emerald-600">
              <CheckCircle className="size-10 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900 dark:text-white">
                {dir === 'rtl' ? 'تم تسجيل طلبك بنجاح !' : 'Commande confirmée avec succès !'}
              </h2>
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
                {dir === 'rtl' ? 'سيتصل بك فريقنا هاتفياً لتأكيد العنوان وموعد الاستلام.' : 'Notre équipe vous contactera par téléphone pour confirmer votre livraison.'}
              </p>
            </div>

            {orderNumber && (
              <div className="p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 inline-block">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {dir === 'rtl' ? 'رقم الطلب' : 'Numéro de commande'}
                </p>
                <p className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                  #{orderNumber}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 7. Sticky CTA Mobile Button (Persistent at bottom of mobile screen) */}
      {isInline && step === 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 p-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-white/10 md:hidden shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
          <div className="flex items-center justify-between gap-3 max-w-md mx-auto">
            <div className="text-left rtl:text-right">
              <p className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400">
                {currentOffer.free_shipping ? (dir === 'rtl' ? 'توصيل مجاني' : 'Livraison Offerte') : (dir === 'rtl' ? 'الدفع عند الاستلام' : 'Paiement COD')}
              </p>
              <p className="text-sm font-black text-slate-900 dark:text-white">
                {formatPrice(finalTotal)}
              </p>
            </div>
            <button
              type="button"
              onClick={scrollToCheckout}
              className="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-white shadow-md active:scale-95 transition-all flex items-center gap-1.5"
              style={{ backgroundColor: primary }}
            >
              <span>{dir === 'rtl' ? 'اطلب الآن — الدفع عند الاستلام' : 'Commander maintenant'}</span>
              <ArrowRight className="size-3.5 rtl:rotate-180" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export default CheckoutForm;
