'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Search, PackageSearch, MapPin, Phone,
  User, Hash, Loader2, ArrowRight, Truck, CheckCircle2,
  Package, ClipboardCheck, RotateCcw, XCircle,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { useTranslation } from '@/hooks/use-translation';

// ─── Types ────────────────────────────────────────────────────────────────────

type InternalStatus =
  | 'NEW' | 'ASSIGNED' | 'CALLED' | 'CONFIRMED'
  | 'SHIPPED' | 'DELIVERED' | 'RETURNED' | 'CANCELLED';

interface TrackItem { product_name: string; quantity: number; unit_price: number; image?: string | null }
interface TrackOrder {
  order_number: string;
  status: InternalStatus;
  delivery_type: 'HOME' | 'OFFICE' | string;
  customer_name: string;
  customer_phone: string;
  customer_wilaya: string;
  customer_address?: string | null;
  customer_commune?: string | null;
  total: number;
  delivery_fee: number;
  tracking_number?: string | null;
  created_at: string;
  items: TrackItem[];
}

// ─── Client-facing pipeline (4 steps, no internal detail) ────────────────────

type ClientStep = 'received' | 'confirmed' | 'shipped' | 'delivered';

interface PipelineStep { key: ClientStep; label: string; sublabel: string }

function getSteps(t: any): PipelineStep[] {
  return [
    { key: 'received',  label: t('received'),         sublabel: t('receivedDesc') },
    { key: 'confirmed', label: t('confirmed'),        sublabel: t('trackingConfirmedDesc') },
    { key: 'shipped',   label: t('shipped'),          sublabel: t('shippedDesc') },
    { key: 'delivered', label: t('delivered'),        sublabel: t('deliveredDesc') },
  ];
}

// Maps internal status → client step index (0-based)
function toClientIndex(status: InternalStatus): number {
  if (status === 'DELIVERED') return 3;
  if (status === 'SHIPPED')   return 2;
  if (status === 'CONFIRMED') return 1;
  return 0; // NEW | ASSIGNED | CALLED all map to "Reçue"
}

// ─── Shared search hook ────────────────────────────────────────────────────────

function useOrderSearch() {
  const activeStore = useAppStore((s) => s.activeStore);
  const [orderNumber, setOrderNumber] = useState('');
  const [order, setOrder] = useState<TrackOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const { t } = useTranslation();

  const handleSearch = async () => {
    const trimmed = orderNumber.trim().toUpperCase();
    if (!trimmed) { setError(t('enterOrderNumber')); return; }
    setLoading(true); setError(''); setOrder(null); setSearched(true);
    try {
      const params = new URLSearchParams({ order_number: trimmed });
      if (activeStore?.id) params.set('store_id', activeStore.id);
      const res = await fetch(`/api/v1/orders/track?${params}`);
      const json = await res.json();
      if (json.success && json.data) setOrder(json.data);
      else setError(json.message || t('orderNotFound'));
    } catch { setError(t('networkError')); }
    finally { setLoading(false); }
  };

  return { activeStore, orderNumber, setOrderNumber, order, loading, error, searched, handleSearch };
}

// ─── Status badge helpers ──────────────────────────────────────────────────────

function getClientLabel(status: InternalStatus, t: any): string {
  const map = {
    NEW: t('processing'),
    ASSIGNED: t('processing'),
    CALLED: t('processing'),
    CONFIRMED: t('confirmed'),
    SHIPPED: t('shipped'),
    DELIVERED: t('delivered'),
    RETURNED: t('returned'),
    CANCELLED: t('cancelled'),
  };
  return map[status] || status;
}

const CLIENT_COLOR: Record<InternalStatus, string> = {
  NEW: 'bg-amber-50 text-amber-700 border-amber-200',
  ASSIGNED: 'bg-amber-50 text-amber-700 border-amber-200',
  CALLED: 'bg-amber-50 text-amber-700 border-amber-200',
  CONFIRMED: 'bg-blue-50 text-blue-700 border-blue-200',
  SHIPPED: 'bg-purple-50 text-purple-700 border-purple-200',
  DELIVERED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RETURNED: 'bg-rose-50 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',
};

// ─── Delivery type label ───────────────────────────────────────────────────────

function deliveryLabel(type: string, t: any) {
  return type === 'OFFICE' ? t('stopDesk') : t('homeDelivery');
}

// ─── CLEAN theme ──────────────────────────────────────────────────────────────

function CleanTracking() {
  const { activeStore, orderNumber, setOrderNumber, order, loading, error, searched, handleSearch } = useOrderSearch();
  const primary = (activeStore?.theme_config?.primaryColor as string) || '#4b7bec';
  const clientIdx = order ? toClientIndex(order.status) : -1;
  const { t, dir, locale } = useTranslation();
  const steps = getSteps(t);

  return (
    <div className="bg-white min-h-screen" dir={dir}>
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">

        {/* Header */}
        <div className="mb-10 text-center">
          <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-slate-50 border border-slate-100">
            <PackageSearch className="size-7 text-slate-400"/>
          </div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">{t('trackOrder')}</h1>
          <p className="mt-2 text-sm text-slate-400 font-medium">{t('enterOrderNumberDesc')}</p>
        </div>

        {/* Search */}
        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm shadow-black/5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-300"/>
              <input
                placeholder="Ex: ORD-20250101-ABCD12"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                className="w-full h-12 ps-10 pe-4 text-sm font-mono font-medium text-slate-800 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:border-slate-300 placeholder:text-slate-300"/>
            </div>
            <button onClick={handleSearch} disabled={loading}
              className="h-12 px-6 rounded-xl text-[11px] font-black uppercase tracking-widest text-white flex items-center gap-2 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
              style={{ backgroundColor: primary }}>
              {loading ? <><Loader2 className="size-4 animate-spin"/>{t('searching')}</> : <><Search className="size-4"/>{t('trackOrder')}</>}
            </button>
          </div>
        </div>

        {/* Error */}
        {searched && error && !loading && (
          <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 py-16 gap-4">
            <PackageSearch className="size-12 text-slate-200"/>
            <p className="text-sm font-bold text-slate-400">{error}</p>
          </div>
        )}

        {order && (
          <div className="mt-6 space-y-4">

            {/* Order header */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm shadow-black/5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl text-white" style={{ backgroundColor: primary }}>
                    <Hash className="size-5"/>
                  </div>
                  <div>
                    <p className="text-sm font-black font-mono text-slate-900">{order.order_number}</p>
                    <p className="text-xs text-slate-400">
                      {new Date(order.created_at).toLocaleDateString(locale === 'ar' ? 'ar-DZ' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  </div>
                </div>
                <span className={`self-start sm:self-auto inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold border ${CLIENT_COLOR[order.status]}`}>
                  {getClientLabel(order.status, t)}
                </span>
              </div>
            </div>

            {/* Pipeline */}
            {order.status !== 'RETURNED' && order.status !== 'CANCELLED' ? (
              <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm shadow-black/5">
                <h3 className="mb-6 text-xs font-black uppercase tracking-widest text-slate-400">{t('howItWorks')}</h3>
                <div className="flex items-start">
                  {steps.map((step, idx) => {
                    const done = idx < clientIdx;
                    const current = idx === clientIdx;
                    const isLast = idx === steps.length - 1;
                    return (
                      <div key={step.key} className="flex flex-1 items-start min-w-0">
                        <div className="flex flex-col items-center gap-2 min-w-0 flex-1">
                          <div className={`flex size-9 items-center justify-center rounded-full border-2 shrink-0 transition-all ${done ? 'border-emerald-500 bg-emerald-500' : current ? 'border-2 bg-white' : 'border-slate-200 bg-white'}`}
                            style={current ? { borderColor: primary } : {}}>
                            {done && <CheckCircle2 className="size-4 text-white"/>}
                            {current && <div className="size-3 rounded-full" style={{ backgroundColor: primary }}/>}
                          </div>
                          <span className={`text-[10px] font-bold text-center leading-tight px-1 ${done ? 'text-emerald-500' : current ? 'text-slate-900' : 'text-slate-300'}`}>
                            {step.label}
                          </span>
                        </div>
                        {!isLast && (
                          <div className="flex-1 h-0.5 mt-4 mx-1">
                            <div className={`h-full rounded-full ${done ? 'bg-emerald-400' : 'bg-slate-100'}`}/>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Current step sublabel */}
                <p className="mt-5 text-center text-xs text-slate-400 font-medium">{steps[Math.max(0, clientIdx)]?.sublabel}</p>
              </div>
            ) : (
              <div className={`rounded-2xl border p-5 flex items-center gap-3 ${order.status === 'RETURNED' ? 'bg-rose-50 border-rose-100' : 'bg-slate-50 border-slate-200'}`}>
                {order.status === 'RETURNED'
                  ? <><RotateCcw className="size-5 text-rose-400 shrink-0"/><div><p className="text-sm font-bold text-rose-700">{t('returned')}</p><p className="text-xs text-rose-400 mt-0.5">{t('returnedDesc')}</p></div></>
                  : <><XCircle className="size-5 text-slate-400 shrink-0"/><div><p className="text-sm font-bold text-slate-600">{t('cancelled')}</p><p className="text-xs text-slate-400 mt-0.5">{t('cancelledDesc')}</p></div></>
                }
              </div>
            )}

            {/* Tracking number */}
            {order.tracking_number && (
              <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm shadow-black/5 flex items-center gap-3">
                <Truck className="size-5 text-slate-400 shrink-0"/>
                <div>
                  <p className="text-xs text-slate-400 font-medium">{t('carrierTrackingNumber')}</p>
                  <p className="text-sm font-black font-mono text-slate-900 mt-0.5">{order.tracking_number}</p>
                </div>
              </div>
            )}

            {/* Customer info */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm shadow-black/5">
              <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-slate-400">{t('deliveryInfo')}</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-start gap-3">
                  <User className="size-4 text-slate-300 mt-0.5 shrink-0"/>
                  <div>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{t('lastName')}</p>
                    <p className="text-sm font-bold text-slate-900 mt-0.5">{order.customer_name}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Phone className="size-4 text-slate-300 mt-0.5 shrink-0"/>
                  <div>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{t('phone')}</p>
                    <p className="text-sm font-bold text-slate-900 mt-0.5">{order.customer_phone}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 sm:col-span-2">
                  <MapPin className="size-4 text-slate-300 mt-0.5 shrink-0"/>
                  <div>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{t('address')}</p>
                    <p className="text-sm font-bold text-slate-900 mt-0.5">
                      {order.customer_wilaya}{order.customer_commune ? `, ${order.customer_commune}` : ''}{order.customer_address ? ` — ${order.customer_address}` : ''}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{deliveryLabel(order.delivery_type, t)}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Items + total */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm shadow-black/5">
              <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-slate-400">{t('itemsOrdered')}</h3>
              <div className="divide-y divide-slate-50">
                {order.items.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex size-9 items-center justify-center rounded-xl bg-slate-50 border border-slate-100 shrink-0">
                        <Package className="size-4 text-slate-300"/>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{item.product_name}</p>
                        <p className="text-xs text-slate-400">{t('quantity')} : {item.quantity}</p>
                      </div>
                    </div>
                    <span className="text-sm font-black text-slate-900 shrink-0 ml-3">{formatPrice(item.unit_price * item.quantity)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
                <div className="flex items-center justify-between text-sm text-slate-500">
                  <span>{t('deliveryFee')}</span>
                  <span className="font-bold">{formatPrice(order.delivery_fee)}</span>
                </div>
                <div className="flex items-center justify-between text-sm font-black text-slate-900">
                  <span>{t('total')}</span>
                  <span>{formatPrice(order.total)}</span>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

// ─── ATHLETIC theme ───────────────────────────────────────────────────────────

function AthleticTracking() {
  const { activeStore, orderNumber, setOrderNumber, order, loading, error, searched, handleSearch } = useOrderSearch();
  const primary = (activeStore?.theme_config?.primaryColor as string) || '#ef4444';
  const clientIdx = order ? toClientIndex(order.status) : -1;
  const { t, dir, locale } = useTranslation();
  const steps = getSteps(t);

  return (
    <div className="bg-[#0A0A0A] min-h-screen" dir={dir}>
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
        <div className="mb-10">
          <p className="text-[9px] font-black uppercase tracking-[0.4em] mb-3" style={{ color: primary }}>{t('trackOrder')}</p>
          <h1 className="text-3xl font-black uppercase tracking-tight text-white">{t('trackOrder')}</h1>
        </div>

        {/* Search */}
        <div className="border border-white/5 bg-[#111] p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-white/20"/>
              <input placeholder="ORD-20250101-ABCD12" value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                className="w-full h-12 ps-10 pe-4 text-xs font-mono font-bold text-white bg-[#0A0A0A] border border-white/5 focus:outline-none focus:border-white/15 placeholder:text-white/15"/>
            </div>
            <button onClick={handleSearch} disabled={loading}
              className="h-12 px-6 text-[10px] font-black uppercase tracking-[0.3em] text-black flex items-center gap-2 transition-all hover:brightness-110 disabled:opacity-50"
              style={{ backgroundColor: primary }}>
              {loading ? <><Loader2 className="size-4 animate-spin"/>...</> : <>{t('trackOrder')} <ArrowRight className="size-3.5"/></>}
            </button>
          </div>
        </div>

        {searched && error && !loading && (
          <div className="mt-6 flex flex-col items-center justify-center border border-white/5 py-16 gap-4">
            <PackageSearch className="size-12 text-white/10"/>
            <p className="text-xs font-black uppercase tracking-widest text-white/30">{error}</p>
          </div>
        )}

        {order && (
          <div className="mt-4 space-y-px">
            {/* Header */}
            <div className="bg-[#111] border border-white/5 p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center text-black" style={{ backgroundColor: primary }}><Hash className="size-4"/></div>
                <div>
                  <p className="text-xs font-black text-white font-mono">{order.order_number}</p>
                  <p className="text-[10px] text-white/30 uppercase tracking-widest">
                    {new Date(order.created_at).toLocaleDateString(locale === 'ar' ? 'ar-DZ' : 'fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[9px] font-black uppercase tracking-widest px-3 py-1.5 border" style={{ borderColor: primary, color: primary }}>{getClientLabel(order.status, t)}</span>
                <span className="text-lg font-black text-white tabular-nums">{formatPrice(order.total)}</span>
              </div>
            </div>

            {/* Pipeline */}
            {order.status !== 'RETURNED' && order.status !== 'CANCELLED' ? (
              <div className="bg-[#111] border border-white/5 p-5">
                <p className="text-[9px] font-black uppercase tracking-[0.35em] text-white/20 mb-6">{t('howItWorks')}</p>
                <div className="flex justify-between relative">
                  <div className="absolute top-3 start-3 end-3 h-px bg-white/5"/>
                  <div className="absolute top-3 start-3 h-px transition-all" style={{ width: `${Math.min((clientIdx / (steps.length - 1)) * 100, 100)}%`, backgroundColor: primary }}/>
                  {steps.map((step, idx) => {
                    const done = idx < clientIdx;
                    const current = idx === clientIdx;
                    return (
                      <div key={step.key} className="flex flex-col items-center gap-2 relative">
                        <div className={`size-6 border flex items-center justify-center transition-all ${done ? 'border-none' : current ? '' : 'border-white/10'}`}
                          style={done ? { backgroundColor: primary } : current ? { borderColor: primary } : {}}>
                          {done && <CheckCircle2 className="size-3.5 text-black"/>}
                          {current && <div className="size-2" style={{ backgroundColor: primary }}/>}
                        </div>
                        <span className={`text-[9px] font-black uppercase tracking-widest hidden sm:block ${done || current ? 'text-white/60' : 'text-white/15'}`}>{step.label}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-5 text-center text-[10px] text-white/30 uppercase tracking-widest">{steps[Math.max(0, clientIdx)]?.sublabel}</p>
              </div>
            ) : (
              <div className={`border border-white/5 bg-[#111] p-5 flex items-center gap-3`}>
                <p className="text-xs font-black uppercase tracking-widest" style={{ color: order.status === 'RETURNED' ? '#f87171' : '#6b7280' }}>
                  {order.status === 'RETURNED' ? t('returned') : t('cancelled')}
                </p>
              </div>
            )}

            {/* Tracking number */}
            {order.tracking_number && (
              <div className="bg-[#111] border border-white/5 p-4 flex items-center gap-3">
                <Truck className="size-4 shrink-0" style={{ color: primary }}/>
                <div>
                  <p className="text-[9px] text-white/20 uppercase tracking-widest">{t('carrierTrackingNumber')}</p>
                  <p className="text-xs font-black font-mono text-white/70 mt-0.5">{order.tracking_number}</p>
                </div>
              </div>
            )}

            {/* Info + items */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-px">
              <div className="bg-[#111] border border-white/5 p-5">
                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/20 mb-4">{t('deliveryInfo')}</p>
                <div className="space-y-3">
                  <div className="flex items-center gap-2"><User className="size-3.5 text-white/20"/><span className="text-xs font-bold text-white/60">{order.customer_name}</span></div>
                  <div className="flex items-center gap-2"><Phone className="size-3.5 text-white/20"/><span className="text-xs font-bold text-white/60">{order.customer_phone}</span></div>
                  <div className="flex items-start gap-2"><MapPin className="size-3.5 text-white/20 mt-0.5 shrink-0"/>
                    <div>
                      <span className="text-xs font-bold text-white/60 block">{order.customer_wilaya}{order.customer_commune ? `, ${order.customer_commune}` : ''}</span>
                      {order.customer_address && <span className="text-[10px] text-white/30 block">{order.customer_address}</span>}
                      <span className="text-[10px] text-white/25 block mt-0.5">{deliveryLabel(order.delivery_type, t)}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-[#111] border border-white/5 p-5">
                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/20 mb-4">{t('itemsOrdered')}</p>
                <div className="space-y-2">
                  {order.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center">
                      <span className="text-xs font-bold text-white/50 truncate">{item.product_name} <span className="text-white/25">×{item.quantity}</span></span>
                      <span className="text-xs font-black text-white/60 tabular-nums shrink-0 ml-2">{formatPrice(item.unit_price * item.quantity)}</span>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-white/5 space-y-1">
                    <div className="flex justify-between text-[10px] text-white/25 uppercase tracking-widest">
                      <span>{t('deliveryFee')}</span><span>{formatPrice(order.delivery_fee)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[9px] font-black uppercase tracking-widest text-white/20">{t('total')}</span>
                      <span className="text-xs font-black text-white tabular-nums">{formatPrice(order.total)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LUXE theme ───────────────────────────────────────────────────────────────

function LuxeTracking() {
  const { activeStore, orderNumber, setOrderNumber, order, loading, error, searched, handleSearch } = useOrderSearch();
  const primary = (activeStore?.theme_config?.primaryColor as string) || '#b8964e';
  const clientIdx = order ? toClientIndex(order.status) : -1;
  const { t, dir, locale } = useTranslation();
  const steps = getSteps(t);

  return (
    <div className="bg-[#0C0F1A] min-h-screen" dir={dir}>
      <div className="mx-auto max-w-2xl px-6 py-16 sm:py-24">
        <div className="mb-14 text-center">
          <p className="text-[9px] tracking-[0.5em] uppercase mb-4 font-light" style={{ color: primary }}>{t('trackOrder')}</p>
          <h1 className="text-3xl font-light text-white tracking-wide" style={{ fontFamily: '"Playfair Display", serif' }}>{t('trackOrder')}</h1>
          <div className="mx-auto mt-5 h-px w-12" style={{ backgroundColor: primary }}/>
        </div>

        {/* Search */}
        <div className="border border-white/5 p-5 mb-6">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute start-4 top-1/2 size-3.5 -translate-y-1/2 text-white/15"/>
              <input placeholder={`${t('orderNumber')}…`} value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                className="w-full h-12 ps-10 pe-4 text-xs font-light font-mono text-white/60 bg-transparent border border-white/8 focus:outline-none focus:border-white/20 placeholder:text-white/15 tracking-wide"
                style={{ borderColor: 'rgba(255,255,255,0.08)' }}/>
            </div>
            <button onClick={handleSearch} disabled={loading}
              className="h-12 px-8 text-[10px] tracking-[0.3em] uppercase font-light text-black flex items-center gap-2 transition-all hover:brightness-95 disabled:opacity-50"
              style={{ backgroundColor: primary }}>
              {loading ? <><Loader2 className="size-3.5 animate-spin"/>...</> : t('trackOrder')}
            </button>
          </div>
        </div>

        {searched && error && !loading && (
          <div className="flex flex-col items-center justify-center border border-white/5 py-16 gap-6">
            <PackageSearch className="size-10 text-white/10"/>
            <p className="text-xs tracking-[0.2em] uppercase text-white/25 font-light">{error}</p>
          </div>
        )}

        {order && (
          <div className="space-y-4">
            {/* Header */}
            <div className="border border-white/5 p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[9px] tracking-[0.35em] uppercase text-white/20 mb-1.5 font-light">{t('product')}</p>
                <p className="text-sm font-light font-mono text-white/70">{order.order_number}</p>
                <p className="text-[10px] tracking-wide text-white/25 mt-1 font-light">
                  {new Date(order.created_at).toLocaleDateString(locale === 'ar' ? 'ar-DZ' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>
              <div className="text-right">
                <span className="inline-flex text-[9px] tracking-[0.25em] uppercase font-light px-3 py-1.5 border" style={{ borderColor: primary, color: primary }}>{getClientLabel(order.status, t)}</span>
                <p className="text-lg font-light text-white/80 mt-2 tabular-nums">{formatPrice(order.total)}</p>
              </div>
            </div>

            {/* Pipeline */}
            {order.status !== 'RETURNED' && order.status !== 'CANCELLED' ? (
              <div className="border border-white/5 p-6">
                <p className="text-[9px] tracking-[0.4em] uppercase text-white/15 mb-8 font-light">{t('howItWorks')}</p>
                <div className="flex items-center">
                  {steps.map((step, idx) => {
                    const done = idx < clientIdx;
                    const current = idx === clientIdx;
                    const isLast = idx === steps.length - 1;
                    return (
                      <div key={step.key} className="flex items-center flex-1 last:flex-none">
                        <div className="flex flex-col items-center gap-2">
                          <div className={`size-2 rounded-full transition-all`}
                            style={done ? { backgroundColor: primary } : current ? { backgroundColor: primary, boxShadow: `0 0 0 3px rgba(255,255,255,0.05), 0 0 0 5px transparent` } : { backgroundColor: 'rgba(255,255,255,0.08)' }}/>
                          <span className={`text-[8px] tracking-[0.2em] uppercase font-light hidden sm:block ${done || current ? 'text-white/40' : 'text-white/15'}`}>{step.label}</span>
                        </div>
                        {!isLast && <div className="flex-1 h-px mx-2" style={{ backgroundColor: done ? primary : 'rgba(255,255,255,0.06)' }}/>}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-6 text-center text-xs font-light text-white/25 tracking-wide italic">{steps[Math.max(0, clientIdx)]?.sublabel}</p>
              </div>
            ) : (
              <div className={`border border-white/5 p-5 ${order.status === 'RETURNED' ? 'border-red-900/20' : ''}`}>
                <p className="text-xs tracking-[0.25em] uppercase font-light" style={{ color: order.status === 'RETURNED' ? '#f87171' : '#6b7280' }}>
                  {order.status === 'RETURNED' ? t('returned') : t('cancelled')}
                </p>
              </div>
            )}

            {/* Tracking */}
            {order.tracking_number && (
              <div className="border border-white/5 p-5 flex items-center gap-3">
                <Truck className="size-4 shrink-0" style={{ color: primary }}/>
                <div>
                  <p className="text-[9px] tracking-[0.3em] uppercase text-white/20 font-light">{t('carrierTrackingNumber')}</p>
                  <p className="text-sm font-light font-mono text-white/60 mt-0.5">{order.tracking_number}</p>
                </div>
              </div>
            )}

            {/* Info */}
            <div className="border border-white/5 p-6">
              <p className="text-[9px] tracking-[0.4em] uppercase text-white/15 mb-6 font-light">{t('deliveryInfo')}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-center gap-3"><User className="size-3.5 text-white/15"/>
                  <div><p className="text-[9px] tracking-[0.2em] uppercase text-white/20 font-light">{t('lastName')}</p><p className="text-sm font-light text-white/50 mt-0.5">{order.customer_name}</p></div>
                </div>
                <div className="flex items-center gap-3"><Phone className="size-3.5 text-white/15"/>
                  <div><p className="text-[9px] tracking-[0.2em] uppercase text-white/20 font-light">{t('phone')}</p><p className="text-sm font-light text-white/50 mt-0.5">{order.customer_phone}</p></div>
                </div>
                <div className="flex items-start gap-3 sm:col-span-2"><MapPin className="size-3.5 text-white/15 mt-0.5 shrink-0"/>
                  <div>
                    <p className="text-[9px] tracking-[0.2em] uppercase text-white/20 font-light">{t('address')}</p>
                    <p className="text-sm font-light text-white/50 mt-0.5">{order.customer_wilaya}{order.customer_commune ? `, ${order.customer_commune}` : ''}{order.customer_address ? ` · ${order.customer_address}` : ''}</p>
                    <p className="text-xs font-light text-white/25 mt-0.5">{deliveryLabel(order.delivery_type, t)}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="border border-white/5 p-6">
              <p className="text-[9px] tracking-[0.4em] uppercase text-white/15 mb-6 font-light">{t('itemsOrdered')}</p>
              <div className="space-y-3">
                {order.items.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
                    <span className="text-sm font-light text-white/40">{item.product_name}<span className="text-white/20 ml-2 text-xs">×{item.quantity}</span></span>
                    <span className="text-sm font-light text-white/50 tabular-nums">{formatPrice(item.unit_price * item.quantity)}</span>
                  </div>
                ))}
                <div className="pt-3 border-t border-white/5 space-y-1.5">
                  <div className="flex justify-between text-xs font-light text-white/25">
                    <span>{t('deliveryFee')}</span><span>{formatPrice(order.delivery_fee)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[9px] tracking-[0.3em] uppercase text-white/20 font-light">{t('total')}</span>
                    <span className="text-sm font-light tabular-nums" style={{ color: primary }}>{formatPrice(order.total)}</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function OrderTracking() {
  const activeStore = useAppStore((s) => s.activeStore);
  const raw = (activeStore?.template_id ?? (activeStore?.theme_config as any)?.templateId ?? 'clean') as string;
  const tpl = raw === 'minimalist' ? 'clean' : raw === 'landing' ? 'athletic' : raw.toLowerCase();
  if (tpl === 'athletic') return <AthleticTracking/>;
  if (tpl === 'luxe')     return <LuxeTracking/>;
  return <CleanTracking/>;
}
