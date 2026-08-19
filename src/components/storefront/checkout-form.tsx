'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle, Package, ShoppingBag,
  MapPin, User, Loader2, Tag, X, Phone, Home, Building2, ShieldCheck, Truck, Search,
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
import { attributionPayload } from '@/lib/attribution';
import { WILAYAS, DEFAULT_DELIVERY_FEE, getDeliveryFee } from '@/lib/types';
import { optimizeCloudinaryUrl } from '@/lib/image-optimize';
import type { CartItem, ApiResponse } from '@/lib/types';
import { ALGERIAN_COMMUNES } from '@/lib/algerian-communes';
import { NOEST_BUREAUX } from '@/lib/noest-bureaux-data';

const primary = 'var(--store-primary, #4b7bec)';

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

// ─── Template theming helper ──────────────────────────────────
function useCheckoutTheme(activeStore: any) {
  const _rawTpl = (activeStore?.template_id ?? activeStore?.theme_config?.templateId ?? 'clean') as string;
  const tpl = _rawTpl === 'minimalist' ? 'clean' : _rawTpl === 'landing' ? 'athletic' : _rawTpl.toLowerCase();
  const primary = (activeStore?.theme_config?.primaryColor as string) || '#4b7bec';

  if (tpl === 'athletic') return {
    tpl, primary,
    pageBg: '#0A0A0A',
    cardBg: '#111111',
    cardBorder: 'rgba(255,255,255,0.06)',
    inputBg: '#0A0A0A',
    inputBorder: 'rgba(255,255,255,0.08)',
    inputBorderFocus: primary,
    inputText: '#ffffff',
    inputPlaceholder: 'rgba(255,255,255,0.25)',
    labelColor: 'rgba(255,255,255,0.4)',
    textPrimary: '#ffffff',
    textSecondary: 'rgba(255,255,255,0.35)',
    stepDoneBg: primary, stepDoneText: '#000000',
    stepActiveBg: '#111', stepActiveBorder: primary, stepActiveText: primary,
    stepInactiveBg: '#111', stepInactiveBorder: 'rgba(255,255,255,0.08)', stepInactiveText: 'rgba(255,255,255,0.2)',
    connectorDone: primary, connectorInactive: 'rgba(255,255,255,0.06)',
    btnText: '#000000', dividerColor: 'rgba(255,255,255,0.05)',
    successBg: '#111', summaryBg: '#0D0D0D',
    radius: '0px', inputRadius: '0px', btnRadius: '0px',
  };
  if (tpl === 'luxe') return {
    tpl, primary,
    pageBg: '#0C0F1A',
    cardBg: '#12172A',
    cardBorder: `${primary}12`,
    inputBg: '#0C0F1A',
    inputBorder: `${primary}18`,
    inputBorderFocus: `${primary}60`,
    inputText: 'rgba(255,255,255,0.85)',
    inputPlaceholder: 'rgba(255,255,255,0.18)',
    labelColor: `${primary}60`,
    textPrimary: 'rgba(255,255,255,0.9)',
    textSecondary: 'rgba(255,255,255,0.3)',
    stepDoneBg: primary, stepDoneText: '#0C0F1A',
    stepActiveBg: 'transparent', stepActiveBorder: primary, stepActiveText: primary,
    stepInactiveBg: 'transparent', stepInactiveBorder: `${primary}15`, stepInactiveText: `${primary}30`,
    connectorDone: primary, connectorInactive: `${primary}10`,
    btnText: '#0C0F1A', dividerColor: `${primary}08`,
    successBg: '#12172A', summaryBg: '#0E1220',
    radius: '0px', inputRadius: '2px', btnRadius: '0px',
  };
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

async function sha256(message: string): Promise<string> {
  try {
    const msgBuffer = new TextEncoder().encode(message.trim().toLowerCase());
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    console.error('SHA-256 hash failed, falling back to plaintext representation or empty', e);
    return '';
  }
}

function formatAlgerianPhone(ph: string): string {
  const digits = ph.replace(/\D/g, '');
  if (digits.startsWith('213') && digits.length >= 11) {
    return digits;
  }
  if (digits.startsWith('0') && digits.length >= 10) {
    return '213' + digits.substring(1);
  }
  if (digits.length === 9 && ['5', '6', '7'].includes(digits[0])) {
    return '213' + digits;
  }
  return digits;
}

interface SearchableCommuneSelectProps {
  wilaya: string;
  value: string;
  onChange: (communeName: string) => void;
  dir: string;
  T: any;
  placeholder?: string;
  error?: boolean;
}

export function SearchableCommuneSelect({
  wilaya,
  value,
  onChange,
  dir,
  T,
  placeholder = 'Sélectionnez une commune',
  error
}: SearchableCommuneSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const communes = useMemo(() => {
    if (!wilaya) return [];
    const cleanW = wilaya.replace(/^\d+\s*[-_–]\s*/, '').trim();
    const foundKey = Object.keys(ALGERIAN_COMMUNES).find(
      k => k.toLowerCase() === cleanW.toLowerCase() || k.toLowerCase() === wilaya.toLowerCase()
    );
    return foundKey ? ALGERIAN_COMMUNES[foundKey] : [];
  }, [wilaya]);

  const filtered = useMemo(() => {
    if (!search) return communes;
    const s = search.toLowerCase().trim();
    return communes.filter(c => 
      c.name.toLowerCase().includes(s) || 
      c.nameAscii.toLowerCase().includes(s)
    );
  }, [communes, search]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const displayValue = useMemo(() => {
    if (!value) return '';
    const match = communes.find(c => 
      c.nameAscii.toLowerCase() === value.toLowerCase() || 
      `${c.name} · ${c.nameAscii}`.toLowerCase() === value.toLowerCase() || 
      c.name.toLowerCase() === value.toLowerCase()
    );
    if (!match) return value;
    return dir === 'rtl' ? `${match.name} (${match.nameAscii})` : match.nameAscii;
  }, [value, communes, dir]);

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => {
          if (!wilaya) return;
          setOpen(!open);
          setSearch('');
        }}
        disabled={!wilaya}
        className={cn(
          "w-full flex items-center justify-between px-3 h-11 text-sm border-2 transition-all outline-none",
          error ? "border-red-500" : "",
          !wilaya ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
        )}
        style={{
          backgroundColor: T.inputBg,
          borderColor: T.inputBorder,
          color: value ? T.inputText : T.inputPlaceholder,
          borderRadius: T.inputRadius,
        }}
      >
        <span className="truncate">
          {wilaya 
            ? (displayValue || placeholder)
            : (dir === 'rtl' ? 'الرجاء اختيار الولاية أولاً' : 'Sélectionnez d\'abord la wilaya')
          }
        </span>
        <span className="text-[10px] opacity-60">▼</span>
      </button>

      {open && wilaya && (
        <div 
          className="absolute z-50 mt-1 w-full border-2 rounded-xl shadow-xl max-h-72 overflow-hidden flex flex-col"
          style={{
            backgroundColor: T.cardBg || '#ffffff',
            borderColor: T.cardBorder || T.inputBorder || '#e2e8f0',
          }}
        >
          {/* Search bar */}
          <div className="p-2 border-b flex items-center gap-2" style={{ borderColor: T.cardBorder || '#e2e8f0' }}>
            <Search className="size-3.5 opacity-60 shrink-0" style={{ color: T.inputText }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={dir === 'rtl' ? 'بحث أو كتابة اسم البلدية...' : 'Rechercher ou saisir la commune...'}
              className="w-full bg-transparent text-xs border-none outline-none focus:ring-0 focus:outline-none"
              style={{ color: T.inputText }}
              autoFocus
            />
          </div>

          {/* Custom typed commune option */}
          {search.trim() && (
            <button
              type="button"
              onClick={() => {
                onChange(search.trim());
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2.5 text-xs font-bold text-blue-600 bg-blue-50/60 hover:bg-blue-100 border-b flex items-center justify-between transition-all"
            >
              <span>✍️ {dir === 'rtl' ? `استخدام "${search.trim()}"` : `Utiliser "${search.trim()}"`}</span>
              <span className="text-[10px] font-semibold opacity-75">Valider</span>
            </button>
          )}

          {/* List */}
          <div className="overflow-y-auto flex-1 max-h-56 py-1 scrollbar-thin">
            {filtered.length === 0 && !search.trim() ? (
              <div className="px-3 py-4 text-xs text-center opacity-60" style={{ color: T.inputText }}>
                {dir === 'rtl' ? 'لا توجد نتائج' : 'Aucun résultat'}
              </div>
            ) : (
              filtered.map(c => {
                const label = dir === 'rtl' ? `${c.name} (${c.nameAscii})` : c.nameAscii;
                const isSelected = value.toLowerCase() === c.nameAscii.toLowerCase() || value === `${c.name} · ${c.nameAscii}`;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      onChange(c.nameAscii);
                      setOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2.5 text-xs transition-all hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between",
                      isSelected ? "font-bold" : ""
                    )}
                    style={{
                      color: T.inputText,
                      backgroundColor: isSelected ? `${T.primary}12` : 'transparent',
                      textAlign: dir === 'rtl' ? 'right' : 'left'
                    }}
                  >
                    <span>{label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CheckoutForm({ isInline = false, forceTemplate, children }: { isInline?: boolean; forceTemplate?: string; children?: React.ReactNode }) {
  const activeStore = useAppStore((s) => s.activeStore);
  const setStorefrontView = useAppStore((s) => s.setStorefrontView);
  const setSelectedProductSlug = useAppStore((s) => s.setSelectedProductSlug);
  const items = useCartStore((s) => s.items);
  const totalPrice = useCartStore((s) => s.totalPrice);
  const clearCart = useCartStore((s) => s.clearCart);
  const { t, dir } = useTranslation();

  const submittingRef = useRef(false); // prevents double-submit on fast multi-click
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [abandonedCartId, setAbandonedCartId] = useState<string | null>(null);

  const [promoCode, setPromoCode] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; type: string; value: number; label: string } | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState('');
  const [orderDiscount, setOrderDiscount] = useState(0);

  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);

  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    firstName: '', lastName: '', phone: '', phone2: '',
    wilaya: '', commune: '', address: '', deliveryType: 'HOME',
  });

  const [availablePartners, setAvailablePartners] = useState<any[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);

  const baseT = useCheckoutTheme(activeStore);
  const T = forceTemplate ? { ...baseT, tpl: forceTemplate } : baseT;

  const isWilayaActive = useCallback((wilayaName: string) => {
    if (availablePartners.length === 0) return true;
    const wilayaId = (WILAYAS as readonly string[]).indexOf(wilayaName) + 1;
    return availablePartners.some(partner => {
      if (Array.isArray(partner.pricing_grid) && partner.pricing_grid.length > 0) {
        const gridEntry = partner.pricing_grid.find((g: any) => g.wilaya_id === wilayaId);
        return gridEntry && (Number(gridEntry.home_fee) > 0 || Number(gridEntry.office_fee) > 0);
      }
      return Number(partner.fee_home) > 0 || Number(partner.fee_relay) > 0;
    });
  }, [availablePartners]);

  const cartSubtotal = totalPrice();

  const discountAmount = useMemo(() => {
    if (!appliedPromo) return 0;
    if (appliedPromo.type === 'PERCENTAGE') return Math.round(cartSubtotal * (appliedPromo.value / 100));
    if (appliedPromo.type === 'FIXED_AMOUNT') return Math.min(appliedPromo.value, cartSubtotal);
    return 0;
  }, [appliedPromo, cartSubtotal]);

  const currentDeliveryFee = deliveryFee ?? 0;

  const finalTotal = cartSubtotal - discountAmount + currentDeliveryFee;

  useEffect(() => {
    if (!items.length) return;
    // One event_id per real checkout ATTEMPT (see getOrCreateCheckoutAttemptId
    // in meta-tracking.ts) — not per render, not per cart content, not per
    // time window. This effect legitimately re-runs several times for the
    // SAME attempt (delivery fee resolving async as the shopper picks a
    // wilaya/commune/partner changes finalTotal each time), and reusing the
    // attempt id means every one of those re-runs is a no-op past the first
    // (trackMetaEvent's own sessionStorage dedup on event_id) — while a
    // genuinely new attempt (new tab, or this tab reopened after being
    // closed) gets a fresh id and fires again even with the identical cart.
    const attemptId = getOrCreateCheckoutAttemptId();
    void trackMetaEvent('InitiateCheckout', {
      content_type: 'product',
      contents: items.map(item => ({ id: item.product?.id, quantity: item.quantity })),
      value: finalTotal,
      currency: 'DZD',
    }, {
      eventId: attemptId ? `initiatecheckout-${attemptId}` : undefined,
      value: finalTotal,
      currency: 'DZD',
      contents: items.map(item => ({ id: item.product?.id, quantity: item.quantity })),
    });
  }, [finalTotal, items]);

  useEffect(() => {
    if (!activeStore) return;
    const pIds = items.map(i => i.product?.id || '').filter(Boolean).join(',');
    fetch(`/api/v1/delivery-partners/availability?storeId=${activeStore.id}&productIds=${pIds}`)
      .then(r => r.json())
      .then(res => {
        const list = res.success ? res.data : (Array.isArray(res) ? res : []);
        setAvailablePartners(list);
        if (list.length > 0 && !selectedPartnerId) {
          setSelectedPartnerId(list[0].id);
        }
      })
      .catch(() => setAvailablePartners([]));
  }, [items, activeStore]);

  useEffect(() => {
    if (!customerInfo.wilaya || !activeStore || !selectedPartnerId) return;
    setDeliveryLoading(true);
    const productIds = items.map(i => i.product?.id || '').filter(Boolean).join(',');
    fetch(`/api/v1/delivery-partners/calculate?partnerId=${selectedPartnerId}&wilayaId=${customerInfo.wilaya}&type=${customerInfo.deliveryType}&productIds=${productIds}`)
      .then(r => r.json())
      .then((res: any) => {
        const fee = res.success ? res.data?.fee : (res.fee ?? null);
        setDeliveryFee(fee);
      })
      .catch(() => setDeliveryFee(null))
      .finally(() => setDeliveryLoading(false));
  }, [customerInfo.wilaya, customerInfo.deliveryType, activeStore, selectedPartnerId, items]);

  // Track abandoned cart
  useEffect(() => {
    if (!activeStore || items.length === 0 || orderSuccess) return;
    
    // We only track abandoned carts if a valid phone number (exactly 10 digits) has been entered.
    // This ensures every abandoned cart listed in the agent dashboard is actionable.
    const phone = normalizePhone(customerInfo.phone);
    if (phone.length !== 10) return;

    const timeoutId = setTimeout(async () => {
      try {
        const orderItems = items
          .filter((item: CartItem) => item?.product)
          .map((item: CartItem) => {
            const vDetails: any = {};
            if (item.selectedVariant) vDetails.variant = item.selectedVariant;
            return {
              product_id: item.product.id,
              product_name: item.product.name,
              quantity: item.quantity,
              unit_price: item.product.price,
              variant_details: Object.keys(vDetails).length > 0 ? vDetails : null,
            };
          });

        const payload = {
          abandoned_cart_id: abandonedCartId,
          store_id: activeStore.id,
          customer_name: `${customerInfo.firstName.trim()} ${customerInfo.lastName.trim()}`.trim() || 'Inconnu',
          customer_phone: customerInfo.phone.trim() || 'Inconnu',
          customer_phone2: customerInfo.phone2.trim() || undefined,
          customer_wilaya: customerInfo.wilaya || 'Alger',
          customer_commune: customerInfo.commune.trim() || undefined,
          customer_address: customerInfo.address.trim() || 'Inconnu',
          delivery_type: customerInfo.deliveryType === 'OFFICE' ? 'stop_desk' : 'HOME',
          items: orderItems,
          subtotal: cartSubtotal,
          delivery_fee: currentDeliveryFee,
          carrier_id: selectedPartnerId,
          total: finalTotal,
          discount: discountAmount,
          source: isInline ? 'landing_page' : 'storefront',
          ...attributionPayload(),
        };

        const res = await fetch('/api/v1/orders/abandoned', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (res.ok && json.id) {
          setAbandonedCartId(json.id);
        }
      } catch (err) {
        // ignore errors for background tracking
      }
    }, 2000); // 2 seconds debounce

    return () => clearTimeout(timeoutId);
  }, [customerInfo, items, activeStore, cartSubtotal, finalTotal, abandonedCartId, orderSuccess, selectedPartnerId]);

  const handleApplyPromo = useCallback(async () => {
    if (!promoCode.trim() || !activeStore) return;
    setPromoLoading(true);
    setPromoError('');
    try {
      const payload = {
        code: promoCode.trim().toUpperCase(),
        store_id: activeStore.id,
        order_total: cartSubtotal,
      };
      const res = await fetch(`/api/v1/promotions/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      
      if (!json.valid) {
        setPromoError(json.message || 'Code invalide ou expiré');
        setAppliedPromo(null);
        return;
      }
      
      const label = json.type === 'PERCENTAGE' ? `−${json.value}%` : json.type === 'FIXED_AMOUNT' ? `−${formatPrice(json.value)}` : 'Livraison gratuite';
      setAppliedPromo({ code: json.code, type: json.type, value: json.value, label });
    } catch { 
      setPromoError('Erreur de connexion'); 
      setAppliedPromo(null); 
    }
    finally { setPromoLoading(false); }
  }, [promoCode, activeStore, cartSubtotal]);

  const normalizePhone = (p: string) => p.replace(/[\s\-\.]/g, '');

  const validateCustomerInfo = (): boolean => {
    const e: Record<string, string> = {};
    const phone = normalizePhone(customerInfo.phone);
    if (isInline) {
      if (!customerInfo.firstName.trim()) e.firstName = 'الاسم الكامل مطلوب';
    } else {
      if (!customerInfo.firstName.trim()) e.firstName = t('firstNameRequired');
      if (!customerInfo.lastName.trim()) e.lastName = t('lastNameRequired');
    }
    if (!phone) e.phone = t('phoneRequired');
    else if (!/^0[5-7]\d{8}$/.test(phone)) e.phone = t('phoneInvalid');
    if (!isInline && customerInfo.phone2.trim() && !/^0[5-7]\d{8}$/.test(normalizePhone(customerInfo.phone2))) e.phone2 = t('phone2Invalid');
    if (!customerInfo.wilaya) e.wilaya = t('wilayaRequired');
    if (!customerInfo.commune.trim()) e.commune = dir === 'rtl' ? 'البلدية مطلوبة' : 'La commune est requise';
    if (!isInline && !customerInfo.address.trim()) e.address = t('addressRequired');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = async () => {
    if (step === 0) {
      if (!validateCustomerInfo()) return;
      
      if (T.tpl === 'dz_cod' || isInline) {
        handleSubmit();
        return;
      }
    }
    setStep(s => Math.min(s + 1, 2));
  };
  const handleBack = () => setStep(s => Math.max(s - 1, 0));

  const handleSubmit = async () => {
    if (!activeStore || items.length === 0) return;
    if (submittingRef.current) return; // block concurrent submissions
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const orderItems = items
        .filter((item: CartItem) => item?.product)
        .map((item: CartItem) => {
          const vDetails: any = {};
          if (item.selectedVariant) vDetails.variant = item.selectedVariant;
          if (item.customNotes) vDetails.notes = item.customNotes;
          return {
            product_id: item.product.id,
            product_name: item.product.name,
            quantity: item.quantity,
            unit_price: item.customPrice !== undefined && item.customPrice !== null
              ? item.customPrice
              : item.product.price + (item.selectedVariant
                  ? (item.product.variants?.find(v => v.value === item.selectedVariant)?.priceModifier ?? 0)
                  : 0),
            variant_details: Object.keys(vDetails).length > 0 ? vDetails : null,
          };
        });
      const payload = {
        store_id: activeStore.id,
        customer_name: isInline ? customerInfo.firstName.trim() : `${customerInfo.firstName.trim()} ${customerInfo.lastName.trim()}`,
        customer_phone: customerInfo.phone.trim(),
        customer_phone2: !isInline && customerInfo.phone2.trim() ? customerInfo.phone2.trim() : undefined,
        customer_wilaya: customerInfo.wilaya,
        customer_commune: customerInfo.commune.trim() || undefined,
        customer_address: isInline ? (customerInfo.commune.trim() || customerInfo.wilaya) : customerInfo.address.trim(),
        delivery_type: customerInfo.deliveryType === 'OFFICE' ? 'stop_desk' : 'HOME',
        items: orderItems,
        subtotal: cartSubtotal,
        delivery_fee: currentDeliveryFee,
        carrier_id: selectedPartnerId,
        source: isInline ? 'landing_page' : 'storefront',
        promo_code: appliedPromo?.code || undefined,
        total: finalTotal,
        discount: discountAmount,
        abandoned_cart_id: abandonedCartId,
        checkout_attempt_id: getOrCreateCheckoutAttemptId(),
        ...attributionPayload(),
      };

      console.log('Sending order payload:', payload);
      
      const res = await fetch('/api/v1/orders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      console.log('Order response status:', res.status, 'data:', json);
      // FastAPI returns the order object directly (not wrapped in { success, data })
      if (res.ok && (json.id || json.order_number || json.orderNumber)) {
        // Purchase is DELIBERATELY never fired from here. It used to be
        // sent immediately on this 201, before the backend had any chance
        // to decide whether this submission is a duplicate of an existing
        // order (auto_merge_duplicates only runs synchronously in the
        // backend, right after order_service.create_order returns — see
        // orders.py's POST / handler). A duplicate double-submit (double-
        // click, page refresh) would still get merged correctly in the
        // ERP, but Meta had already permanently counted a Purchase for a
        // submission that no longer operationally exists as its own order
        // — the exact root cause of "Meta shows more Purchases than the
        // ERP has orders". The backend is now the SOLE sender of Purchase
        // (see orders.py's send_purchase_for_order queue, triggered only
        // after the merge decision is committed) — the frontend only ever
        // sends navigation events (ViewContent/AddToCart/InitiateCheckout).
        // This branch covers BOTH a freshly created order AND the backend's
        // 15-minute duplicate-basket guard (orders.py) returning an existing
        // order untouched — both return the identical { id, order_number, ... }
        // shape, so the attempt has concluded either way. Clearing here (not
        // in a separate "was this a duplicate?" branch, which the response
        // shape has no way to signal) is what makes one call site enough.
        clearCheckoutAttemptId();
        setOrderNumber(json.order_number ?? json.orderNumber ?? json.id ?? '');
        setOrderDiscount(json.discount ?? 0);
        clearCart();
        setStep(2);
        setOrderSuccess(true);
      } else {
        const msg = json.detail ?? json.message ?? 'Une erreur est survenue. Veuillez réessayer.';
        setErrors({ general: typeof msg === 'string' ? msg : JSON.stringify(msg) });
        handleBack();
      }
    } catch {
      setErrors({ general: 'Erreur de connexion. Vérifiez votre réseau et réessayez.' });
      handleBack();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setStorefrontView('home');
    setOrderSuccess(false);
    setStep(0);
    setOrderDiscount(0);
    setAppliedPromo(null);
    setPromoCode('');
    setPromoError('');
    setAbandonedCartId(null);
    setCustomerInfo({ firstName: '', lastName: '', phone: '', phone2: '', wilaya: '', commune: '', address: '', deliveryType: 'HOME' });
  };

  if (items.length === 0 && !orderSuccess) {
    if (!isInline) {
      return (
      <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center px-6 text-center gap-5">
        <div className="size-20 rounded-3xl bg-slate-50 border border-slate-100 flex items-center justify-center">
          <ShoppingBag className="size-9 text-slate-300" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">Votre panier est vide</h2>
          <p className="mt-1 text-sm text-slate-400">Ajoutez des produits avant de passer commande</p>
        </div>
        <button
          className="px-6 py-3 rounded-xl text-sm font-bold text-white transition-all hover:brightness-110"
          style={{ backgroundColor: primary }}
          onClick={() => setStorefrontView('shop')}
        >
          Voir la boutique
        </button>
      </div>
    );
    }
  }

  const STEPS = [
    { label: t('deliveryInfo'), icon: MapPin },
    { label: t('orderSummary'), icon: Package },
    { label: t('confirmedTitle'), icon: CheckCircle },
  ];

  return (
    <div style={{ backgroundColor: isInline ? 'transparent' : T.pageBg }} className={isInline ? "" : "min-h-screen"} dir={dir}>
      <div className={isInline ? "w-full py-2" : "mx-auto max-w-2xl px-4 py-10 sm:px-6"}>
        {/* Title */}
        {T.tpl !== 'dz_cod' && !isInline && (
          <div className="mb-8">
            <h1 className="text-2xl font-black tracking-tight"
              style={{ color: T.textPrimary, letterSpacing: T.tpl === 'athletic' ? '0.05em' : undefined, textTransform: T.tpl !== 'clean' ? 'uppercase' : undefined }}>
              {T.tpl === 'athletic' ? 'FINALISER' : T.tpl === 'luxe' ? t('confirmedTitleLuxe') : t('deliveryInfo')}
            </h1>
            <p className="text-xs mt-1 font-medium" style={{ color: T.textSecondary }}>
              {T.tpl === 'athletic' ? 'PAIEMENT À LA LIVRAISON · SÉCURISÉ' : T.tpl === 'luxe' ? 'Livraison sécurisée · Paiement à réception' : t('paymentOnDeliverySecure')}
            </p>
          </div>
        )}



        {/* ── Helper styles ── */}
        <style>{`
          .co-input {
            background-color: ${T.inputBg} !important;
            border-color: ${T.inputBorder} !important;
            color: ${T.inputText} !important;
            border-radius: ${T.inputRadius} !important;
          }
          .co-input::placeholder { color: ${T.inputPlaceholder} !important; }
          .co-input:focus { border-color: ${T.inputBorderFocus} !important; }
          .co-select [role="combobox"] {
            background-color: ${T.inputBg} !important;
            color: ${T.inputText} !important;
            border-color: ${T.inputBorder} !important;
            border-radius: ${T.inputRadius} !important;
          }
        `}</style>

        {/* ── STEP 0: Informations de livraison ── */}
        {step === 0 && (
          <div className="space-y-5">
            {!isInline && (
              <div className="text-center mb-6">
                <h2 className="text-lg sm:text-xl font-black uppercase tracking-tight"
                  style={{ color: T.textPrimary }}>
                  {dir === 'rtl' ? 'معلومات التوصيل' : t('deliveryInfo') || 'Informations de livraison'}
                </h2>
                <p className="text-xs mt-1 font-medium" style={{ color: T.textSecondary }}>
                  {dir === 'rtl' ? 'يرجى ملء الاستمارة لتأكيد طلبك' : t('deliveryInfoDesc') || 'Veuillez remplir le formulaire pour confirmer votre commande'}
                </p>
              </div>
            )}

            {errors.general && (
              <div className="border px-4 py-3 text-sm text-red-400"
                style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)', borderRadius: T.radius }}>
                {errors.general}
              </div>
            )}

             {isInline ? (
              // Simplified 4-field COD form for landing page
              <div className="space-y-4">
                {/* 1. Téléphone */}
                <div className="space-y-1.5">
                  <label htmlFor="phone" className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5" style={{ color: T.labelColor }}>
                    <Phone className="size-3" /> {dir === 'rtl' ? 'رقم الهاتف' : t('phone')}
                  </label>
                  <Input id="phone" type="tel" placeholder={dir === 'rtl' ? '0555 12 34 56' : '0555 123 456'} value={customerInfo.phone}
                    onChange={e => setCustomerInfo({ ...customerInfo, phone: e.target.value })}
                    className={`co-input text-sm h-11 font-mono ${errors.phone ? 'border-red-400!' : ''}`}
                    dir="ltr" style={{ textAlign: 'left' }} />
                  {errors.phone && <p className="text-[10px] text-red-400">{errors.phone}</p>}
                </div>

                {/* 2. Nom Complet */}
                <div className="space-y-1.5">
                  <label htmlFor="firstName" className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5" style={{ color: T.labelColor }}>
                    <User className="size-3" /> {dir === 'rtl' ? 'الاسم الكامل' : t('fullName') || 'Nom Complet'}
                  </label>
                  <Input id="firstName" placeholder={dir === 'rtl' ? 'محمد بن علي' : 'Mohamed Benali'} value={customerInfo.firstName}
                    onChange={e => setCustomerInfo({ ...customerInfo, firstName: e.target.value })}
                    className={`co-input text-sm h-11 ${errors.firstName ? 'border-red-400!' : ''}`} />
                  {errors.firstName && <p className="text-[10px] text-red-400">{errors.firstName}</p>}
                </div>

                {/* 3. Wilaya */}
                <div className="space-y-1.5">
                  <label htmlFor="wilaya" className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5" style={{ color: T.labelColor }}>
                    <MapPin className="size-3" /> {dir === 'rtl' ? 'الولاية' : t('wilaya')}
                  </label>
                  <Select value={customerInfo.wilaya} onValueChange={v => setCustomerInfo({ ...customerInfo, wilaya: v })}>
                    <SelectTrigger id="wilaya" className={`co-select h-11 text-sm w-full ${errors.wilaya ? 'border-red-400!' : ''}`}
                      style={{ backgroundColor: T.inputBg, borderColor: T.inputBorder, color: customerInfo.wilaya ? T.inputText : T.inputPlaceholder, borderRadius: T.inputRadius }}>
                      <SelectValue placeholder={t('selectWilaya')} />
                    </SelectTrigger>
                    <SelectContent className="max-h-64" style={{ backgroundColor: T.cardBg, borderColor: T.cardBorder }}>
                      {WILAYAS.filter(isWilayaActive).map(w => (
                        <SelectItem key={w} value={w} style={{ color: T.inputText }}>{w}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.wilaya && <p className="text-[10px] text-red-400">{errors.wilaya}</p>}
                </div>

                {/* 4. Commune */}
                <div className="space-y-1.5">
                  <label htmlFor="commune" className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5" style={{ color: T.labelColor }}>
                    <Building2 className="size-3" /> {dir === 'rtl' ? 'البلدية' : t('commune')}
                  </label>
                  <SearchableCommuneSelect
                    wilaya={customerInfo.wilaya}
                    value={customerInfo.commune}
                    onChange={v => setCustomerInfo({ ...customerInfo, commune: v })}
                    dir={dir}
                    T={T}
                    placeholder={dir === 'rtl' ? 'اختر البلدية...' : 'Sélectionnez la commune...'}
                    error={!!errors.commune}
                  />
                  {errors.commune && <p className="text-[10px] text-red-400">{errors.commune}</p>}
                </div>

                {/* 5. Mode de Livraison / طريقة الاستلام */}
                <div className="space-y-2 pt-1">
                  <label className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5" style={{ color: T.labelColor }}>
                    <Truck className="size-3.5" /> {dir === 'rtl' ? 'طريقة الاستلام' : 'Mode de livraison'}
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setCustomerInfo({ ...customerInfo, deliveryType: 'HOME' })}
                      className="flex flex-col items-center justify-center gap-2 p-3 border-2 transition-all text-center"
                      style={{
                        borderRadius: '16px',
                        borderColor: customerInfo.deliveryType === 'HOME' ? T.primary : T.inputBorder,
                        backgroundColor: customerInfo.deliveryType === 'HOME' ? `${T.primary}08` : 'transparent',
                      }}
                    >
                      <Home className="size-4" style={{ color: customerInfo.deliveryType === 'HOME' ? T.primary : T.textSecondary }} />
                      <span className="text-xs font-bold" style={{ color: T.textPrimary }}>
                        {dir === 'rtl' ? 'توصيل للمنزل' : 'À domicile'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomerInfo({ ...customerInfo, deliveryType: 'OFFICE' })}
                      className="flex flex-col items-center justify-center gap-2 p-3 border-2 transition-all text-center"
                      style={{
                        borderRadius: '16px',
                        borderColor: customerInfo.deliveryType === 'OFFICE' ? T.primary : T.inputBorder,
                        backgroundColor: customerInfo.deliveryType === 'OFFICE' ? `${T.primary}08` : 'transparent',
                      }}
                    >
                      <Building2 className="size-4" style={{ color: customerInfo.deliveryType === 'OFFICE' ? T.primary : T.textSecondary }} />
                      <span className="text-xs font-bold" style={{ color: T.textPrimary }}>
                        {dir === 'rtl' ? 'استلام من المكتب' : 'Stop Desk (Bureau)'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              // Standard checkout form
              <>
                {/* Nom */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { id: 'firstName', label: t('firstName'), placeholder: 'Mohamed', key: 'firstName' as const, err: errors.firstName },
                    { id: 'lastName',  label: t('lastName'),    placeholder: 'Benali',  key: 'lastName'  as const, err: errors.lastName  },
                  ].map(f => (
                    <div key={f.id} className="space-y-1.5">
                      <label htmlFor={f.id} className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.labelColor }}>{f.label}</label>
                      <Input id={f.id} placeholder={f.placeholder} value={customerInfo[f.key]}
                        onChange={e => setCustomerInfo({ ...customerInfo, [f.key]: e.target.value })}
                        className={`co-input text-sm h-11 ${f.err ? 'border-red-400!' : ''}`} />
                      {f.err && <p className="text-[10px] text-red-400">{f.err}</p>}
                    </div>
                  ))}
                </div>

                {/* Téléphone */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor="phone" className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: T.labelColor }}>
                      <Phone className="size-3" /> {t('phone')}
                    </label>
                    <Input id="phone" type="tel" placeholder="0555 123 456" value={customerInfo.phone}
                      onChange={e => setCustomerInfo({ ...customerInfo, phone: e.target.value })}
                      className={`co-input text-sm h-11 font-mono ${errors.phone ? 'border-red-400!' : ''}`}
                      dir="ltr" style={{ textAlign: 'left' }} />
                    {errors.phone && <p className="text-[10px] text-red-400">{errors.phone}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="phone2" className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.labelColor }}>
                      {t('phone2')}
                    </label>
                    <Input id="phone2" type="tel" placeholder="0661 234 567" value={customerInfo.phone2}
                      onChange={e => setCustomerInfo({ ...customerInfo, phone2: e.target.value })}
                      className={`co-input text-sm h-11 font-mono ${errors.phone2 ? 'border-red-400!' : ''}`}
                      dir="ltr" style={{ textAlign: 'left' }} />
                    {errors.phone2 && <p className="text-[10px] text-red-400">{errors.phone2}</p>}
                  </div>
                </div>

                {/* Wilaya */}
                <div className="space-y-1.5">
                  <label htmlFor="wilaya" className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: T.labelColor }}>
                    <MapPin className="size-3" /> {t('wilaya')}
                  </label>
                  <Select value={customerInfo.wilaya} onValueChange={v => setCustomerInfo({ ...customerInfo, wilaya: v })}>
                    <SelectTrigger id="wilaya" className={`co-select h-11 text-sm w-full ${errors.wilaya ? 'border-red-400!' : ''}`}
                      style={{ backgroundColor: T.inputBg, borderColor: T.inputBorder, color: customerInfo.wilaya ? T.inputText : T.inputPlaceholder, borderRadius: T.inputRadius }}>
                      <SelectValue placeholder={t('selectWilaya')} />
                    </SelectTrigger>
                    <SelectContent className="max-h-64" style={{ backgroundColor: T.cardBg, borderColor: T.cardBorder }}>
                      {WILAYAS.filter(isWilayaActive).map(w => (
                        <SelectItem key={w} value={w} style={{ color: T.inputText }}>{w}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.wilaya && <p className="text-[10px] text-red-400">{errors.wilaya}</p>}
                </div>

                {/* Commune + Adresse */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor="commune" className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.labelColor }}>
                      {t('commune')}
                    </label>
                    <SearchableCommuneSelect
                      wilaya={customerInfo.wilaya}
                      value={customerInfo.commune}
                      onChange={v => setCustomerInfo({ ...customerInfo, commune: v })}
                      dir={dir}
                      T={T}
                      placeholder={dir === 'rtl' ? 'اختر البلدية...' : 'Sélectionnez la commune...'}
                      error={!!errors.commune}
                    />
                    {errors.commune && <p className="text-[10px] text-red-400">{errors.commune}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="address" className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.labelColor }}>
                      {customerInfo.deliveryType === 'OFFICE' ? 'Bureau de livraison' : t('address')}
                    </label>
                    {customerInfo.deliveryType === 'OFFICE' ? (
                      <Select value={customerInfo.address} onValueChange={v => setCustomerInfo({ ...customerInfo, address: v })}>
                        <SelectTrigger className={`co-select h-11 text-[16px] md:text-sm w-full ${errors.address ? 'border-red-400!' : ''}`}
                          style={{ backgroundColor: T.inputBg, borderColor: T.inputBorder, color: customerInfo.address ? T.inputText : T.inputPlaceholder, borderRadius: T.inputRadius }}>
                          <SelectValue placeholder="Sélectionnez un bureau..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-64" style={{ backgroundColor: T.cardBg, borderColor: T.cardBorder }}>
                          {NOEST_BUREAUX.filter(b => b.wilayaId === (WILAYAS.indexOf(customerInfo.wilaya as typeof WILAYAS[number]) + 1)).map(b => (
                            <SelectItem key={b.code} value={b.name + ' - ' + b.address} style={{ color: T.inputText }}>
                              {b.name} - {b.address}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input id="address" placeholder="Rue, N° bâtiment..." value={customerInfo.address}
                        onChange={e => setCustomerInfo({ ...customerInfo, address: e.target.value })}
                        className={`co-input text-[16px] md:text-sm h-11 ${errors.address ? 'border-red-400!' : ''}`} />
                    )}
                    {errors.address && <p className="text-[10px] text-red-400">{errors.address}</p>}
                  </div>
                </div>



                {/* Type de livraison */}
                <div className="space-y-2 pt-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: T.labelColor }}>
                    <MapPin className="size-3" /> {t('remiseMode')}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { value: 'HOME' as DeliveryType, label: t('homeDelivery'), icon: Home, desc: t('homeDeliveryDesc') },
                      { value: 'OFFICE' as DeliveryType, label: t('stopDesk'), icon: Building2, desc: t('stopDeskDesc') },
                    ].map(opt => {
                      const isSelected = customerInfo.deliveryType === opt.value;
                      return (
                        <button key={opt.value} type="button"
                          onClick={() => setCustomerInfo({ ...customerInfo, deliveryType: opt.value })}
                          className="flex items-start gap-3 p-3.5 border-2 text-left transition-all"
                          style={{
                            borderRadius: T.radius,
                            borderColor: isSelected ? T.primary : T.cardBorder,
                            backgroundColor: isSelected ? `${T.primary}10` : T.cardBg,
                          }}>
                          <opt.icon className="size-4 mt-0.5 shrink-0" style={{ color: isSelected ? T.primary : T.textSecondary }} />
                          <div>
                            <p className="text-xs font-bold" style={{ color: T.textPrimary }}>{opt.label}</p>
                            <p className="text-[10px]" style={{ color: T.textSecondary }}>{opt.desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {customerInfo.wilaya && (
                    <div className="mt-3 p-3 border flex items-center justify-between"
                      style={{ borderRadius: T.radius, backgroundColor: T.summaryBg, borderColor: T.cardBorder }}>
                      <span className="text-xs font-medium flex items-center gap-2" style={{ color: T.textSecondary }}>
                        <Truck className="size-3.5 text-emerald-500" /> {t('deliveryFeeEstimated')}
                      </span>
                      <span className="text-sm font-black" style={{ color: T.textPrimary }}>
                        {deliveryLoading ? <Loader2 className="size-3.5 animate-spin" /> : `${formatPrice(currentDeliveryFee)}`}
                      </span>
                    </div>
                  )}
                </div>

                {/* Code promo */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: T.labelColor }}>
                    <Tag className="size-3" /> {t('promoCode')}
                  </label>
                  {appliedPromo ? (
                    <div className="flex items-center gap-2 border px-3 py-2.5"
                      style={{ borderRadius: T.radius, borderColor: 'rgba(52,211,153,0.3)', backgroundColor: 'rgba(52,211,153,0.08)' }}>
                      <span className="text-xs font-bold text-emerald-400">{appliedPromo.code} · {appliedPromo.label}</span>
                      <button type="button" className="ml-auto text-emerald-400 hover:text-emerald-300"
                        onClick={() => { setPromoCode(''); setAppliedPromo(null); setPromoError(''); }}>
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Input placeholder="CODE PROMO" value={promoCode} maxLength={20}
                        onChange={e => { setPromoCode(e.target.value.toUpperCase()); setPromoError(''); }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleApplyPromo(); } }}
                        className={`co-input flex-1 text-sm font-mono uppercase tracking-wider h-11 ${promoError ? 'border-red-400!' : ''}`} />
                      <button type="button" onClick={handleApplyPromo} disabled={promoLoading || !promoCode.trim()}
                        className="px-4 border text-xs font-bold transition-all disabled:opacity-40"
                        style={{ borderRadius: T.radius, borderColor: T.cardBorder, color: T.textSecondary, backgroundColor: T.cardBg }}>
                        {promoLoading ? <Loader2 className="size-4 animate-spin" /> : t('applyPromo')}
                      </button>
                    </div>
                  )}
                  {promoError && <p className="text-[10px] text-red-400">{promoError}</p>}
                </div>
              </>
            )}



            {/* Render any child components (like variant & pack selectors) */}
            {children}

            {/* Real-time Pricing Summary */}
            <div className="pt-2 space-y-2">
              <div className="border overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ borderRadius: T.radius, borderColor: T.cardBorder }}>
                <div className="divide-y" style={{ borderColor: T.dividerColor }}>
                  <div className="flex justify-between px-4 py-2.5 text-xs font-semibold" style={{ color: T.textSecondary }}>
                    <span>{t('subtotal')}</span>
                    <span className="tabular-nums font-mono" style={{ color: T.textPrimary }}>{formatPrice(cartSubtotal)}</span>
                  </div>
                  <div className="flex justify-between px-4 py-2.5 text-xs font-semibold" style={{ color: T.textSecondary }}>
                    <span className="flex items-center gap-1.5"><Truck className="size-3.5" /> {t('deliveryFee')}</span>
                    <span className="tabular-nums font-mono" style={{ color: T.textPrimary }}>
                      {customerInfo.wilaya ? (
                        deliveryLoading ? (
                          <Loader2 className="size-3 animate-spin inline" />
                        ) : (
                          formatPrice(currentDeliveryFee)
                        )
                      ) : (
                        <span className="text-[10px] font-normal italic opacity-60">{t('selectWilaya') || 'Sélectionnez votre wilaya'}</span>
                      )}
                    </span>
                  </div>
                  {appliedPromo && discountAmount > 0 && (
                    <div className="flex justify-between px-4 py-2.5 text-xs font-semibold text-emerald-400" style={{ backgroundColor: 'rgba(52,211,153,0.06)' }}>
                      <span className="flex items-center gap-1.5"><Tag className="size-3.5" /> {appliedPromo.code}</span>
                      <span className="tabular-nums font-mono">-{formatPrice(discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between px-4 py-3 bg-slate-50/50" style={{ backgroundColor: T.summaryBg }}>
                    <span className="text-sm font-bold" style={{ color: T.textPrimary }}>{t('totalToPay')}</span>
                    <span className="text-lg font-black tabular-nums" style={{ color: T.primary }}>{formatPrice(finalTotal)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* CTA */}
            <div className="pt-2">
              <button onClick={handleNext} disabled={checkingDuplicate || submitting}
                className={cn(
                  "w-full flex items-center justify-center gap-2 font-black uppercase tracking-widest transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60",
                  isInline ? "h-14 text-base" : (T.tpl === 'dz_cod' ? "h-16 text-xl bg-red-600 hover:bg-red-700" : "h-13 text-sm")
                )}
                style={isInline ? { backgroundColor: T.primary, color: T.btnText, borderRadius: T.btnRadius }
                  : (T.tpl === 'dz_cod' ? { color: '#ffffff', borderRadius: '8px' } : { backgroundColor: T.primary, color: T.btnText, borderRadius: T.btnRadius })}>
                {checkingDuplicate || submitting
                  ? <><Loader2 className="size-5 animate-spin" /> {submitting ? t('submitting') : t('checking')}</>
                  : isInline ? (dir === 'rtl' ? 'اضغط هنا للطلب' : 'Acheter maintenant') 
                  : (T.tpl === 'dz_cod' ? t('buyNowCod') : <>{t('continue')} <ArrowRight className="size-4" /></>)}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 1: Récapitulatif ── */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-lg font-black tracking-tight"
                style={{ color: T.textPrimary, textTransform: T.tpl !== 'clean' ? 'uppercase' : undefined }}>
                {t('orderSummary')}
              </h2>
              <p className="text-xs mt-0.5" style={{ color: T.textSecondary }}>{t('orderSummaryDesc')}</p>
            </div>

            {/* Adresse */}
            <div className="p-4 border space-y-1"
              style={{ borderRadius: T.radius, borderColor: T.cardBorder, backgroundColor: T.summaryBg }}>
              <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: T.textSecondary }}>{t('addressDeliverTo')}</p>
              <p className="text-sm font-bold" style={{ color: T.textPrimary }}>{customerInfo.firstName} {customerInfo.lastName}</p>
              <p className="text-sm font-mono" style={{ color: T.textSecondary }}>{customerInfo.phone}{customerInfo.phone2 ? ` / ${customerInfo.phone2}` : ''}</p>
              <p className="text-sm" style={{ color: T.textSecondary }}>{customerInfo.address}{customerInfo.commune ? `, ${customerInfo.commune}` : ''} — {customerInfo.wilaya}</p>
              <span className="inline-block mt-1 px-2 py-0.5 text-[10px] font-medium border"
                style={{ borderRadius: T.inputRadius, borderColor: T.cardBorder, color: T.textSecondary, backgroundColor: T.cardBg }}>
                {customerInfo.deliveryType === 'HOME' ? t('shippingHome') : t('shippingOffice')}
              </span>
            </div>

            {/* Articles */}
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: T.textSecondary }}>{t('itemsOrdered')}</p>
              {items.map((item: CartItem) => {
                if (!item?.product) return null;
                const modifier = item.selectedVariant && item.product.variants
                  ? (item.product.variants.find(v => v.value === item.selectedVariant)?.priceModifier ?? 0) : 0;
                const lineTotal = (item.product.price + modifier) * item.quantity;
                return (
                  <div key={item.selectedVariant ? `${item.product.id}-${item.selectedVariant}` : item.product.id}
                    onClick={() => setSelectedProductSlug(item.product.slug)}
                    className="flex items-center gap-3 p-3 border cursor-pointer transition-all"
                    style={{ borderRadius: T.radius, borderColor: T.cardBorder, backgroundColor: T.cardBg }}>
                    <div className="size-11 rounded-lg overflow-hidden border shrink-0 bg-slate-50 flex items-center justify-center"
                      style={{ borderRadius: T.inputRadius, borderColor: T.cardBorder }}>
                      {item.image_url ? (
                        <img src={optimizeCloudinaryUrl(item.image_url, 100)} alt={item.product.name} className="size-full object-cover" />
                      ) : item.product.main_image ? (
                        <img src={optimizeCloudinaryUrl(item.product.main_image, 100)} alt={item.product.name} className="size-full object-cover" />
                      ) : (
                        <span className="text-sm font-black" style={{ color: T.textSecondary }}>
                          {item.product.name?.charAt(0) || 'P'}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: T.textPrimary }}>{item.product.name}</p>
                      <p className="text-xs" style={{ color: T.textSecondary }}>
                        {formatPrice(item.product.price + modifier)} × {item.quantity}{item.selectedVariant ? ` · ${item.selectedVariant}` : ''}
                      </p>
                    </div>
                    <span className="text-sm font-black shrink-0 tabular-nums" style={{ color: T.textPrimary }}>{formatPrice(lineTotal)}</span>
                  </div>
                );
              })}
            </div>

            {/* Totaux */}
            <div className="border overflow-hidden" style={{ borderRadius: T.radius, borderColor: T.cardBorder }}>
              <div className="divide-y" style={{ borderColor: T.dividerColor }}>
                {[
                  { label: t('subtotal'), value: cartSubtotal },
                  { label: t('deliveryFee'), value: currentDeliveryFee, icon: <Truck className="size-3.5" /> },
                ].map(row => (
                  <div key={row.label} className="flex justify-between px-4 py-3 text-sm"
                    style={{ borderBottomColor: T.dividerColor }}>
                    <span className="flex items-center gap-1.5" style={{ color: T.textSecondary }}>{row.icon}{row.label}</span>
                    <span className="font-semibold tabular-nums" style={{ color: T.textPrimary }}>{formatPrice(row.value)}</span>
                  </div>
                ))}
                {appliedPromo && discountAmount > 0 && (
                  <div className="flex justify-between px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(52,211,153,0.06)' }}>
                    <span className="text-emerald-400 flex items-center gap-1.5"><Tag className="size-3.5" /> {appliedPromo.code}</span>
                    <span className="font-bold text-emerald-400">−{formatPrice(discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between px-4 py-4" style={{ backgroundColor: T.summaryBg }}>
                  <span className="text-sm font-bold" style={{ color: T.textPrimary }}>{t('totalToPay')}</span>
                  <span className="text-xl font-black tabular-nums" style={{ color: T.primary }}>{formatPrice(finalTotal)}</span>
                </div>
              </div>
            </div>

            {/* Trust */}
            <div className="flex items-center gap-3 py-1 text-[11px]" style={{ color: T.textSecondary }}>
              <ShieldCheck className="size-4 text-emerald-500 shrink-0" />
              {t('paymentOnDeliverySecure')}
            </div>

            {errors.general && (
              <div className="border px-4 py-3 text-sm text-red-400"
                style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)', borderRadius: T.radius }}>
                {errors.general}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={handleBack}
                className="h-13 px-5 border text-sm font-bold transition-all flex items-center gap-2 hover:brightness-110"
                style={{ borderRadius: T.btnRadius, borderColor: T.cardBorder, color: T.textSecondary, backgroundColor: T.cardBg }}>
                <ArrowLeft className="size-4" /> {t('back')}
              </button>
              <button onClick={handleSubmit} disabled={submitting}
                className="flex-1 h-13 flex items-center justify-center gap-2 text-sm font-black uppercase tracking-widest transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                style={{ backgroundColor: T.primary, color: T.btnText, borderRadius: T.btnRadius }}>
                {submitting
                  ? <><Loader2 className="size-4 animate-spin" /> {t('sendingOrder')}</>
                  : <><CheckCircle className="size-4" /> {t('confirmOrder')}</>}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Succès ── */}
        {step === 2 && orderSuccess && (
          <div className="flex flex-col items-center py-16 text-center gap-6">
            {/* Icon */}
            <div className="size-20 flex items-center justify-center"
              style={{ borderRadius: T.tpl === 'clean' ? '9999px' : '0px', backgroundColor: 'rgba(52,211,153,0.1)', border: `2px solid rgba(52,211,153,0.2)` }}>
              <CheckCircle className="size-10 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight"
                style={{ color: T.textPrimary, textTransform: T.tpl !== 'clean' ? 'uppercase' : undefined }}>
                {T.tpl === 'athletic' ? t('confirmedTitleAthletic') : T.tpl === 'luxe' ? t('confirmedTitleLuxe') : t('confirmedTitle')}
              </h2>
              <p className="mt-2 max-w-sm text-sm" style={{ color: T.textSecondary }}>
                {t('confirmedDesc')}
              </p>
            </div>
            {orderNumber && (
              <div className="border px-8 py-4 text-center"
                style={{ borderRadius: T.radius, borderColor: T.cardBorder, backgroundColor: T.summaryBg }}>
                <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: T.textSecondary }}>
                  {t('orderNumber')}
                </p>
                <p className="text-xl font-black font-mono" style={{ color: T.primary }}>#{orderNumber}</p>
              </div>
            )}
            {orderDiscount > 0 && (
              <div className="flex items-center gap-2 text-sm text-emerald-400 font-medium">
                <Tag className="size-4" /> {t('discount')} : −{formatPrice(orderDiscount)}
              </div>
            )}
            <button onClick={resetForm}
              className="mt-2 px-10 py-3.5 text-sm font-black uppercase tracking-widest transition-all hover:brightness-110 active:scale-[0.98]"
              style={{ backgroundColor: T.primary, color: T.btnText, borderRadius: T.btnRadius }}>
              {t('continueShopping')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
