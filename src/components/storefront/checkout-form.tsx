'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle, Package, ShoppingBag,
  MapPin, User, Loader2, Tag, X, Phone, Home, Building2, ShieldCheck, Truck,
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
import { WILAYAS, DEFAULT_DELIVERY_FEE, getDeliveryFee } from '@/lib/types';
import type { CartItem, ApiResponse } from '@/lib/types';

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

export function CheckoutForm() {
  const activeStore = useAppStore((s) => s.activeStore);
  const setStorefrontView = useAppStore((s) => s.setStorefrontView);
  const setSelectedProductSlug = useAppStore((s) => s.setSelectedProductSlug);
  const items = useCartStore((s) => s.items);
  const totalPrice = useCartStore((s) => s.totalPrice);
  const clearCart = useCartStore((s) => s.clearCart);

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);

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

  const T = useCheckoutTheme(activeStore);

  const cartSubtotal = totalPrice();

  const discountAmount = useMemo(() => {
    if (!appliedPromo) return 0;
    if (appliedPromo.type === 'PERCENTAGE') return Math.round(cartSubtotal * (appliedPromo.value / 100));
    if (appliedPromo.type === 'FIXED_AMOUNT') return Math.min(appliedPromo.value, cartSubtotal);
    return 0;
  }, [appliedPromo, cartSubtotal]);

  const currentDeliveryFee = deliveryFee ?? (
    customerInfo.wilaya
      ? getDeliveryFee(customerInfo.wilaya, customerInfo.deliveryType.toLowerCase() as 'home' | 'bureau')
      : DEFAULT_DELIVERY_FEE.home
  );

  const finalTotal = cartSubtotal - discountAmount + currentDeliveryFee;

  useEffect(() => {
    if (!activeStore) return;
    const pIds = items.map(i => i.product.id).join(',');
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
    fetch(`/api/v1/delivery-partners/calculate?partnerId=${selectedPartnerId}&wilayaId=${customerInfo.wilaya}&type=${customerInfo.deliveryType}`)
      .then(r => r.json())
      .then((res: any) => {
        const fee = res.success ? res.data?.fee : (res.fee ?? null);
        setDeliveryFee(fee);
      })
      .catch(() => setDeliveryFee(null))
      .finally(() => setDeliveryLoading(false));
  }, [customerInfo.wilaya, customerInfo.deliveryType, activeStore, selectedPartnerId]);

  const handleApplyPromo = useCallback(async () => {
    if (!promoCode.trim() || !activeStore) return;
    setPromoLoading(true);
    setPromoError('');
    try {
      const res = await fetch(`/api/v1/promotions?storeId=${activeStore.id}&code=${promoCode.trim().toUpperCase()}`);
      const json = await res.json();
      const promo = json.data?.find?.((p: { isActive: boolean }) => p.isActive);
      if (!promo) { setPromoError('Code invalide ou expiré'); setAppliedPromo(null); return; }
      if (promo.endsAt && new Date(promo.endsAt) < new Date()) { setPromoError('Code expiré'); setAppliedPromo(null); return; }
      if (promo.minOrderAmount > 0 && cartSubtotal < promo.minOrderAmount) { setPromoError(`Commande minimum : ${formatPrice(promo.minOrderAmount)} DA`); setAppliedPromo(null); return; }
      if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) { setPromoError('Code épuisé'); setAppliedPromo(null); return; }
      const label = promo.type === 'PERCENTAGE' ? `−${promo.value}%` : promo.type === 'FIXED_AMOUNT' ? `−${formatPrice(promo.value)} DA` : 'Livraison gratuite';
      setAppliedPromo({ code: promo.code, type: promo.type, value: promo.value, label });
    } catch { setPromoError('Erreur de connexion'); setAppliedPromo(null); }
    finally { setPromoLoading(false); }
  }, [promoCode, activeStore, cartSubtotal]);

  const normalizePhone = (p: string) => p.replace(/[\s\-\.]/g, '');

  const validateCustomerInfo = (): boolean => {
    const e: Record<string, string> = {};
    const phone = normalizePhone(customerInfo.phone);
    if (!customerInfo.firstName.trim()) e.firstName = 'Prénom requis';
    if (!customerInfo.lastName.trim()) e.lastName = 'Nom requis';
    if (!phone) e.phone = 'Numéro de téléphone requis';
    else if (!/^0[5-7]\d{8}$/.test(phone)) e.phone = 'Format invalide — doit commencer par 05/06/07 et contenir 10 chiffres';
    if (customerInfo.phone2.trim() && !/^0[5-7]\d{8}$/.test(normalizePhone(customerInfo.phone2))) e.phone2 = 'Format invalide';
    if (!customerInfo.wilaya) e.wilaya = 'Veuillez sélectionner votre wilaya';
    if (!customerInfo.address.trim()) e.address = 'Adresse requise';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = async () => {
    if (step === 0) {
      if (!validateCustomerInfo()) return;
      if (!duplicateWarning && activeStore) {
        setCheckingDuplicate(true);
        try {
          const phone = normalizePhone(customerInfo.phone);
          const res = await fetch(`/api/v1/orders/check-duplicate?customer_phone=${encodeURIComponent(phone)}&store_id=${activeStore.id}&limit=1`);
          const json = await res.json();
          const existing = Array.isArray(json) ? json : (json?.data ?? json?.items ?? []);
          if (existing.length > 0) {
            setDuplicateWarning(true);
            setCheckingDuplicate(false);
            return;
          }
        } catch { /* ignore, allow to proceed */ }
        setCheckingDuplicate(false);
      }
      setDuplicateWarning(false);
    }
    setStep(s => Math.min(s + 1, 2));
  };
  const handleBack = () => setStep(s => Math.max(s - 1, 0));

  const handleSubmit = async () => {
    if (!activeStore || items.length === 0) return;
    setSubmitting(true);
    try {
      const orderItems = items.map((item: CartItem) => ({
        product_id: item.product.id,
        product_name: item.product.name,
        quantity: item.quantity,
        unit_price: item.product.price + (item.selectedVariant
          ? (item.product.variants?.find(v => v.value === item.selectedVariant)?.priceModifier ?? 0)
          : 0),
      }));
      const res = await fetch('/api/v1/orders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({
          store_id: activeStore.id,
          customer_name: `${customerInfo.firstName.trim()} ${customerInfo.lastName.trim()}`,
          customer_phone: customerInfo.phone.trim(),
          customer_phone2: customerInfo.phone2.trim() || undefined,
          customer_wilaya: customerInfo.wilaya,
          customer_commune: customerInfo.commune.trim() || undefined,
          customer_address: customerInfo.address.trim(),
          delivery_type: customerInfo.deliveryType,
          items: orderItems,
          subtotal: cartSubtotal,
          delivery_fee: currentDeliveryFee,
          carrier_id: selectedPartnerId,
          source: 'storefront',
          promo_code: appliedPromo?.code || undefined,
          total: finalTotal,
          discount: discountAmount,
        }),
      });
      const json = await res.json();
      // FastAPI returns the order object directly (not wrapped in { success, data })
      if (res.ok && (json.id || json.order_number || json.orderNumber)) {
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
    setCustomerInfo({ firstName: '', lastName: '', phone: '', phone2: '', wilaya: '', commune: '', address: '', deliveryType: 'HOME' });
  };

  if (items.length === 0 && !orderSuccess) {
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

  const STEPS = [
    { label: 'Livraison', icon: MapPin },
    { label: 'Récapitulatif', icon: Package },
    { label: 'Confirmation', icon: CheckCircle },
  ];

  return (
    <div style={{ backgroundColor: T.pageBg }} className="min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        {/* Title */}
        <div className="mb-8">
          <h1 className="text-2xl font-black tracking-tight"
            style={{ color: T.textPrimary, letterSpacing: T.tpl === 'athletic' ? '0.05em' : undefined, textTransform: T.tpl !== 'clean' ? 'uppercase' : undefined }}>
            {T.tpl === 'athletic' ? 'FINALISER' : T.tpl === 'luxe' ? 'Votre Commande' : 'Finaliser ma commande'}
          </h1>
          <p className="text-xs mt-1 font-medium" style={{ color: T.textSecondary }}>
            {T.tpl === 'athletic' ? 'PAIEMENT À LA LIVRAISON · SÉCURISÉ' : T.tpl === 'luxe' ? 'Livraison sécurisée · Paiement à réception' : 'Commande sécurisée · Paiement à la livraison'}
          </p>
        </div>

        {/* Step indicator */}
        <div className="mb-10">
          {T.tpl === 'athletic' ? (
            /* Athletic: thin accent line progress */
            <div className="space-y-3">
              <div className="h-0.5 w-full rounded-full" style={{ backgroundColor: T.connectorInactive }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(step / (STEPS.length - 1)) * 100}%`, backgroundColor: T.primary }} />
              </div>
              <div className="flex justify-between">
                {STEPS.map((s, i) => (
                  <span key={i} className="text-[9px] font-black uppercase tracking-[0.3em] transition-colors"
                    style={{ color: i <= step ? T.primary : T.textSecondary }}>{s.label}</span>
                ))}
              </div>
            </div>
          ) : T.tpl === 'luxe' ? (
            /* Luxe: thin gold line + dot markers */
            <div className="relative">
              <div className="flex items-center">
                {STEPS.map((s, i) => {
                  const isDone = i < step || orderSuccess;
                  const isActive = i === step;
                  return (
                    <div key={i} className="flex items-center flex-1">
                      <div className="flex flex-col items-center gap-2">
                        <div className="size-2 rounded-full transition-all" style={{ backgroundColor: isDone ? T.primary : isActive ? T.primary : `${T.primary}20` }} />
                        <span className="text-[9px] tracking-[0.3em] uppercase font-light whitespace-nowrap"
                          style={{ color: isActive || isDone ? T.primary : T.textSecondary }}>{s.label}</span>
                      </div>
                      {i < STEPS.length - 1 && (
                        <div className="flex-1 mx-3 mb-5 h-px transition-all" style={{ backgroundColor: isDone ? `${T.primary}40` : `${T.primary}10` }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Clean: circles */
            <div className="flex items-center">
              {STEPS.map((s, i) => {
                const isDone = i < step || orderSuccess;
                const isActive = i === step;
                return (
                  <div key={i} className="flex items-center flex-1">
                    <div className="flex flex-col items-center">
                      <div className="size-10 rounded-full flex items-center justify-center border-2 text-xs font-black transition-all"
                        style={isDone ? { backgroundColor: T.stepDoneBg, borderColor: T.stepDoneBg, color: T.stepDoneText }
                          : isActive ? { backgroundColor: T.stepActiveBg, borderColor: T.stepActiveBorder, color: T.stepActiveText }
                          : { backgroundColor: T.stepInactiveBg, borderColor: T.stepInactiveBorder, color: T.stepInactiveText }}>
                        {isDone ? <Check className="size-4" /> : <s.icon className="size-4" />}
                      </div>
                      <span className="mt-1.5 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap"
                        style={{ color: isActive || isDone ? T.textPrimary : T.textSecondary }}>{s.label}</span>
                    </div>
                    {i < STEPS.length - 1 && (
                      <div className="flex-1 mx-2 mb-5 h-0.5 rounded-full transition-all"
                        style={{ backgroundColor: isDone ? T.connectorDone : T.connectorInactive }} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

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
            <div>
              <h2 className="text-base font-bold tracking-tight"
                style={{ color: T.textPrimary, textTransform: T.tpl !== 'clean' ? 'uppercase' : undefined }}>
                Informations de livraison
              </h2>
              <p className="text-xs mt-0.5" style={{ color: T.textSecondary }}>
                Renseignez vos coordonnées pour recevoir votre commande
              </p>
            </div>

            {errors.general && (
              <div className="border px-4 py-3 text-sm text-red-400"
                style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)', borderRadius: T.radius }}>
                {errors.general}
              </div>
            )}

            {/* Nom */}
            <div className="grid grid-cols-2 gap-4">
              {[
                { id: 'firstName', label: 'Prénom *', placeholder: 'Mohamed', key: 'firstName' as const, err: errors.firstName },
                { id: 'lastName',  label: 'Nom *',    placeholder: 'Benali',  key: 'lastName'  as const, err: errors.lastName  },
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="phone" className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: T.labelColor }}>
                  <Phone className="size-3" /> Téléphone *
                </label>
                <Input id="phone" placeholder="0555 123 456" value={customerInfo.phone}
                  onChange={e => setCustomerInfo({ ...customerInfo, phone: e.target.value })}
                  className={`co-input text-sm h-11 font-mono ${errors.phone ? 'border-red-400!' : ''}`} />
                {errors.phone && <p className="text-[10px] text-red-400">{errors.phone}</p>}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="phone2" className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.labelColor }}>
                  Tél. 2 <span className="normal-case font-normal opacity-50">(optionnel)</span>
                </label>
                <Input id="phone2" placeholder="0661 234 567" value={customerInfo.phone2}
                  onChange={e => setCustomerInfo({ ...customerInfo, phone2: e.target.value })}
                  className={`co-input text-sm h-11 font-mono ${errors.phone2 ? 'border-red-400!' : ''}`} />
                {errors.phone2 && <p className="text-[10px] text-red-400">{errors.phone2}</p>}
              </div>
            </div>

            {/* Wilaya */}
            <div className="space-y-1.5">
              <label htmlFor="wilaya" className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: T.labelColor }}>
                <MapPin className="size-3" /> Wilaya *
              </label>
              <Select value={customerInfo.wilaya} onValueChange={v => setCustomerInfo({ ...customerInfo, wilaya: v })}>
                <SelectTrigger id="wilaya" className={`co-select h-11 text-sm ${errors.wilaya ? 'border-red-400!' : ''}`}
                  style={{ backgroundColor: T.inputBg, borderColor: T.inputBorder, color: customerInfo.wilaya ? T.inputText : T.inputPlaceholder, borderRadius: T.inputRadius }}>
                  <SelectValue placeholder="Sélectionnez votre wilaya" />
                </SelectTrigger>
                <SelectContent className="max-h-64" style={{ backgroundColor: T.cardBg, borderColor: T.cardBorder }}>
                  {WILAYAS.map(w => (
                    <SelectItem key={w} value={w} style={{ color: T.inputText }}>{w}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.wilaya && <p className="text-[10px] text-red-400">{errors.wilaya}</p>}
            </div>

            {/* Commune + Adresse */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="commune" className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.labelColor }}>
                  Commune <span className="normal-case font-normal opacity-50">(optionnel)</span>
                </label>
                <Input id="commune" placeholder="Bab El Oued" value={customerInfo.commune}
                  onChange={e => setCustomerInfo({ ...customerInfo, commune: e.target.value })}
                  className="co-input text-sm h-11" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="address" className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.labelColor }}>Adresse *</label>
                <Input id="address" placeholder="Rue, N° bâtiment..." value={customerInfo.address}
                  onChange={e => setCustomerInfo({ ...customerInfo, address: e.target.value })}
                  className={`co-input text-sm h-11 ${errors.address ? 'border-red-400!' : ''}`} />
                {errors.address && <p className="text-[10px] text-red-400">{errors.address}</p>}
              </div>
            </div>

            {/* Transporteur */}
            {availablePartners.length > 0 && (
              <div className="space-y-3 pt-2">
                <label className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: T.labelColor }}>
                  <Package className="size-3" /> Choisir un transporteur
                </label>
                <div className="space-y-2">
                  {availablePartners.map(p => (
                    <button key={p.id} type="button" onClick={() => setSelectedPartnerId(p.id)}
                      className="w-full flex items-center justify-between p-3 border-2 transition-all"
                      style={{
                        borderRadius: T.radius,
                        borderColor: selectedPartnerId === p.id ? T.primary : T.cardBorder,
                        backgroundColor: selectedPartnerId === p.id ? `${T.primary}10` : T.cardBg,
                      }}>
                      <div className="flex items-center gap-3">
                        <div className="size-10 flex items-center justify-center border overflow-hidden"
                          style={{ borderRadius: T.inputRadius, backgroundColor: T.inputBg, borderColor: T.cardBorder }}>
                          {p.logoUrl ? <img src={p.logoUrl} alt={p.name} className="size-full object-contain p-1" />
                            : <Truck className="size-5" style={{ color: T.textSecondary }} />}
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-bold" style={{ color: T.textPrimary }}>{p.name}</p>
                          <p className="text-[10px] capitalize" style={{ color: T.textSecondary }}>{p.code}</p>
                        </div>
                      </div>
                      {selectedPartnerId === p.id && (
                        <div className="size-5 rounded-full flex items-center justify-center" style={{ backgroundColor: T.primary }}>
                          <Check className="size-3" style={{ color: T.btnText }} />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Type de livraison */}
            <div className="space-y-2 pt-2">
              <label className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: T.labelColor }}>
                <MapPin className="size-3" /> Mode de remise
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'HOME' as DeliveryType, label: 'À domicile', icon: Home, desc: 'Livré chez vous' },
                  { value: 'OFFICE' as DeliveryType, label: 'Stop-desk', icon: Building2, desc: 'Retrait en agence' },
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
                    <Truck className="size-3.5 text-emerald-500" /> Frais de livraison estimés
                  </span>
                  <span className="text-sm font-black" style={{ color: T.textPrimary }}>
                    {deliveryLoading ? <Loader2 className="size-3.5 animate-spin" /> : `${formatPrice(currentDeliveryFee)} DA`}
                  </span>
                </div>
              )}
            </div>

            {/* Code promo */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: T.labelColor }}>
                <Tag className="size-3" /> Code promo <span className="normal-case font-normal opacity-50">(optionnel)</span>
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
                    {promoLoading ? <Loader2 className="size-4 animate-spin" /> : 'Appliquer'}
                  </button>
                </div>
              )}
              {promoError && <p className="text-[10px] text-red-400">{promoError}</p>}
            </div>

            {/* Doublon warning */}
            {duplicateWarning && (
              <div className="border px-4 py-3 space-y-2"
                style={{ borderRadius: T.radius, borderColor: 'rgba(251,191,36,0.3)', backgroundColor: 'rgba(251,191,36,0.08)' }}>
                <p className="text-sm font-bold text-amber-400">⚠️ Ce numéro a déjà passé une commande dans cette boutique.</p>
                <p className="text-xs text-amber-500/70">Voulez-vous continuer ou vérifier votre numéro ?</p>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setDuplicateWarning(false)}
                    className="px-4 py-2 text-xs font-bold text-amber-400 border border-amber-400/30 hover:bg-amber-400/10 transition-all"
                    style={{ borderRadius: T.radius }}>
                    Modifier le numéro
                  </button>
                  <button type="button" onClick={() => { setDuplicateWarning(false); setStep(s => Math.min(s + 1, 2)); }}
                    className="px-4 py-2 text-xs font-bold text-black bg-amber-400 hover:bg-amber-500 transition-all"
                    style={{ borderRadius: T.radius }}>
                    Continuer quand même
                  </button>
                </div>
              </div>
            )}

            {/* CTA */}
            <div className="pt-2">
              <button onClick={handleNext} disabled={checkingDuplicate}
                className="w-full h-13 flex items-center justify-center gap-2 text-sm font-black uppercase tracking-widest transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                style={{ backgroundColor: T.primary, color: T.btnText, borderRadius: T.btnRadius }}>
                {checkingDuplicate
                  ? <><Loader2 className="size-4 animate-spin" /> Vérification...</>
                  : <>Continuer <ArrowRight className="size-4" /></>}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 1: Récapitulatif ── */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-bold tracking-tight"
                style={{ color: T.textPrimary, textTransform: T.tpl !== 'clean' ? 'uppercase' : undefined }}>
                Récapitulatif de commande
              </h2>
              <p className="text-xs mt-0.5" style={{ color: T.textSecondary }}>Vérifiez votre commande avant de confirmer</p>
            </div>

            {/* Adresse */}
            <div className="p-4 border space-y-1"
              style={{ borderRadius: T.radius, borderColor: T.cardBorder, backgroundColor: T.summaryBg }}>
              <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: T.textSecondary }}>Livraison à</p>
              <p className="text-sm font-bold" style={{ color: T.textPrimary }}>{customerInfo.firstName} {customerInfo.lastName}</p>
              <p className="text-sm font-mono" style={{ color: T.textSecondary }}>{customerInfo.phone}{customerInfo.phone2 ? ` / ${customerInfo.phone2}` : ''}</p>
              <p className="text-sm" style={{ color: T.textSecondary }}>{customerInfo.address}{customerInfo.commune ? `, ${customerInfo.commune}` : ''} — {customerInfo.wilaya}</p>
              <span className="inline-block mt-1 px-2 py-0.5 text-[10px] font-medium border"
                style={{ borderRadius: T.inputRadius, borderColor: T.cardBorder, color: T.textSecondary, backgroundColor: T.cardBg }}>
                {customerInfo.deliveryType === 'HOME' ? '🏠 Livraison à domicile' : '🏢 Bureau / Stop-desk'}
              </span>
            </div>

            {/* Articles */}
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: T.textSecondary }}>Articles commandés</p>
              {items.map((item: CartItem) => {
                const modifier = item.selectedVariant && item.product.variants
                  ? (item.product.variants.find(v => v.value === item.selectedVariant)?.priceModifier ?? 0) : 0;
                const lineTotal = (item.product.price + modifier) * item.quantity;
                return (
                  <div key={item.selectedVariant ? `${item.product.id}-${item.selectedVariant}` : item.product.id}
                    onClick={() => setSelectedProductSlug(item.product.slug)}
                    className="flex items-center gap-3 p-3 border cursor-pointer transition-all"
                    style={{ borderRadius: T.radius, borderColor: T.cardBorder, backgroundColor: T.cardBg }}>
                    <div className="size-11 flex items-center justify-center text-sm font-black shrink-0"
                      style={{ borderRadius: T.inputRadius, backgroundColor: T.summaryBg, color: T.textSecondary }}>
                      {item.product.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: T.textPrimary }}>{item.product.name}</p>
                      <p className="text-xs" style={{ color: T.textSecondary }}>
                        {formatPrice(item.product.price + modifier)} DA × {item.quantity}{item.selectedVariant ? ` · ${item.selectedVariant}` : ''}
                      </p>
                    </div>
                    <span className="text-sm font-black shrink-0 tabular-nums" style={{ color: T.textPrimary }}>{formatPrice(lineTotal)} DA</span>
                  </div>
                );
              })}
            </div>

            {/* Totaux */}
            <div className="border overflow-hidden" style={{ borderRadius: T.radius, borderColor: T.cardBorder }}>
              <div className="divide-y" style={{ borderColor: T.dividerColor }}>
                {[
                  { label: 'Sous-total', value: cartSubtotal },
                  { label: 'Livraison', value: currentDeliveryFee, icon: <Truck className="size-3.5" /> },
                ].map(row => (
                  <div key={row.label} className="flex justify-between px-4 py-3 text-sm"
                    style={{ borderBottomColor: T.dividerColor }}>
                    <span className="flex items-center gap-1.5" style={{ color: T.textSecondary }}>{row.icon}{row.label}</span>
                    <span className="font-semibold tabular-nums" style={{ color: T.textPrimary }}>{formatPrice(row.value)} DA</span>
                  </div>
                ))}
                {appliedPromo && discountAmount > 0 && (
                  <div className="flex justify-between px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(52,211,153,0.06)' }}>
                    <span className="text-emerald-400 flex items-center gap-1.5"><Tag className="size-3.5" /> {appliedPromo.code}</span>
                    <span className="font-bold text-emerald-400">−{formatPrice(discountAmount)} DA</span>
                  </div>
                )}
                <div className="flex justify-between px-4 py-4" style={{ backgroundColor: T.summaryBg }}>
                  <span className="text-sm font-bold" style={{ color: T.textPrimary }}>Total à payer</span>
                  <span className="text-xl font-black tabular-nums" style={{ color: T.primary }}>{formatPrice(finalTotal)} DA</span>
                </div>
              </div>
            </div>

            {/* Trust */}
            <div className="flex items-center gap-3 py-1 text-[11px]" style={{ color: T.textSecondary }}>
              <ShieldCheck className="size-4 text-emerald-500 shrink-0" />
              Paiement à la livraison · Commande 100% sécurisée
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
                <ArrowLeft className="size-4" /> Retour
              </button>
              <button onClick={handleSubmit} disabled={submitting}
                className="flex-1 h-13 flex items-center justify-center gap-2 text-sm font-black uppercase tracking-widest transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                style={{ backgroundColor: T.primary, color: T.btnText, borderRadius: T.btnRadius }}>
                {submitting
                  ? <><Loader2 className="size-4 animate-spin" /> Envoi en cours...</>
                  : <><CheckCircle className="size-4" /> Confirmer ma commande</>}
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
                {T.tpl === 'athletic' ? 'ORDER CONFIRMED' : T.tpl === 'luxe' ? 'Commande reçue' : 'Commande confirmée !'}
              </h2>
              <p className="mt-2 max-w-sm text-sm" style={{ color: T.textSecondary }}>
                Merci pour votre commande. Notre équipe vous contactera bientôt pour confirmer la livraison.
              </p>
            </div>
            {orderNumber && (
              <div className="border px-8 py-4 text-center"
                style={{ borderRadius: T.radius, borderColor: T.cardBorder, backgroundColor: T.summaryBg }}>
                <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: T.textSecondary }}>
                  Numéro de commande
                </p>
                <p className="text-xl font-black font-mono" style={{ color: T.primary }}>#{orderNumber}</p>
              </div>
            )}
            {orderDiscount > 0 && (
              <div className="flex items-center gap-2 text-sm text-emerald-400 font-medium">
                <Tag className="size-4" /> Réduction appliquée : −{formatPrice(orderDiscount)} DA
              </div>
            )}
            <button onClick={resetForm}
              className="mt-2 px-10 py-3.5 text-sm font-black uppercase tracking-widest transition-all hover:brightness-110 active:scale-[0.98]"
              style={{ backgroundColor: T.primary, color: T.btnText, borderRadius: T.btnRadius }}>
              Continuer mes achats
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
