'use client';

import { useState, useMemo } from 'react';
import {
  Search, PackageSearch, CheckCircle2, Circle, MapPin, Phone,
  User, Hash, Loader2, ArrowRight,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import {
  ORDER_STATUS_LABELS, ORDER_STATUS_COLORS, ORDER_STATUS_DOT,
  type Order, type OrderStatus,
} from '@/lib/types';

const PIPELINE_STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'NEW', label: 'Nouvelle' },
  { status: 'ASSIGNED', label: 'Assignée' },
  { status: 'CALLED', label: 'Appelée' },
  { status: 'CONFIRMED', label: 'Confirmée' },
  { status: 'SHIPPED', label: 'Expédiée' },
  { status: 'DELIVERED', label: 'Livrée' },
];

function getStepState(orderStatus: OrderStatus, stepStatus: OrderStatus): 'completed' | 'current' | 'pending' | 'returned' {
  if (orderStatus === 'RETURNED') return 'returned';
  const statusOrder = PIPELINE_STEPS.map((s) => s.status);
  const currentIdx = statusOrder.indexOf(orderStatus);
  const stepIdx = statusOrder.indexOf(stepStatus);
  if (stepIdx < currentIdx) return 'completed';
  if (stepIdx === currentIdx) return 'current';
  return 'pending';
}

/* shared search logic */
function useOrderSearch() {
  const activeStore = useAppStore((s) => s.activeStore);
  const [orderNumber, setOrderNumber] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    const trimmed = orderNumber.trim();
    if (!trimmed) { setError('Veuillez entrer un numéro de commande'); return; }
    setLoading(true); setError(''); setOrder(null); setSearched(true);
    try {
      const params = new URLSearchParams({ order_number: trimmed });
      if (activeStore) params.set('store_id', activeStore.id);
      const res = await fetch(`/api/v1/orders/track?${params}`);
      const json = await res.json();
      if (json.success && json.data) { setOrder(json.data); }
      else { setError(json.message || 'Commande introuvable'); }
    } catch { setError('Erreur lors de la recherche.'); }
    finally { setLoading(false); }
  };

  const currentStepIndex = useMemo(() => {
    if (!order) return -1;
    return PIPELINE_STEPS.findIndex((s) => s.status === order.status);
  }, [order]);

  return { activeStore, orderNumber, setOrderNumber, order, loading, error, searched, handleSearch, currentStepIndex };
}

/* ─────────────────────────────── CLEAN ─────────────────────────────── */
function CleanTracking() {
  const { activeStore, orderNumber, setOrderNumber, order, loading, error, searched, handleSearch, currentStepIndex } = useOrderSearch();
  const primary = (activeStore?.theme_config?.primaryColor as string) || '#4b7bec';

  return (
    <div className="bg-white min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-slate-50 border border-slate-100">
            <PackageSearch className="size-7 text-slate-400"/>
          </div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">Suivre ma commande</h1>
          <p className="mt-2 text-sm text-slate-400 font-medium">Entrez votre numéro de commande pour suivre son état</p>
        </div>

        {/* Search */}
        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm shadow-black/5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-300"/>
              <input placeholder="Ex: ML-20250101-0001" value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                className="w-full h-12 pl-10 pr-4 text-sm font-medium text-slate-800 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:border-slate-300 font-mono placeholder:text-slate-300"/>
            </div>
            <button onClick={handleSearch} disabled={loading}
              className="h-12 px-6 rounded-xl text-[11px] font-black uppercase tracking-widest text-white flex items-center gap-2 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
              style={{ backgroundColor: primary }}>
              {loading ? <><Loader2 className="size-4 animate-spin"/>Recherche...</> : <><Search className="size-4"/>Suivre</>}
            </button>
          </div>
        </div>

        {searched && error && !loading && (
          <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 py-16 gap-4">
            <PackageSearch className="size-12 text-slate-200"/>
            <p className="text-sm font-bold text-slate-400">{error}</p>
          </div>
        )}

        {order && (
          <div className="mt-6 space-y-5">
            {/* Header card */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm shadow-black/5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl text-white" style={{ backgroundColor: primary }}><Hash className="size-5"/></div>
                  <div>
                    <p className="text-sm font-black text-slate-900 font-mono">{order.order_number}</p>
                    <p className="text-xs text-slate-400 font-medium">{new Date(order.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${ORDER_STATUS_COLORS[order.status]}`}>{ORDER_STATUS_LABELS[order.status]}</span>
                  <span className="text-lg font-black text-slate-900">{formatPrice(order.total)} DA</span>
                </div>
              </div>
            </div>

            {/* Timeline */}
            {order.status !== 'RETURNED' ? (
              <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm shadow-black/5">
                <h3 className="mb-6 text-xs font-black uppercase tracking-widest text-slate-400">Suivi de commande</h3>
                <div className="flex items-start px-2 overflow-x-auto pb-2">
                  {PIPELINE_STEPS.map((step, idx) => {
                    const state = getStepState(order.status, step.status);
                    const isLast = idx === PIPELINE_STEPS.length - 1;
                    return (
                      <div key={step.status} className="flex flex-1 items-start min-w-0">
                        <div className="flex flex-col items-center gap-2 min-w-0">
                          <div className={`flex size-8 items-center justify-center rounded-full border-2 shrink-0 ${state === 'completed' ? 'bg-emerald-500 border-emerald-500' : state === 'current' ? 'border-slate-900 bg-slate-900' : 'border-slate-200 bg-white'}`}>
                            {state === 'completed' && <CheckCircle2 className="size-4 text-white"/>}
                            {state === 'current' && <Circle className="size-3 fill-current text-white"/>}
                          </div>
                          <span className={`text-[10px] font-bold text-center truncate max-w-[60px] ${state === 'completed' ? 'text-emerald-500' : state === 'current' ? 'text-slate-900' : 'text-slate-300'}`}>{step.label}</span>
                        </div>
                        {!isLast && <div className="flex-1 h-0.5 mt-4 mx-1"><div className={`h-full rounded-full ${idx < currentStepIndex ? 'bg-emerald-400' : 'bg-slate-100'}`}/></div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="bg-white border border-red-100 rounded-2xl p-5">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-full bg-red-50"><Circle className="size-4 text-red-400 fill-red-400"/></div>
                  <div><p className="text-sm font-bold text-red-500">Commande retournée</p><p className="text-xs text-slate-400">Cette commande a été retournée</p></div>
                </div>
              </div>
            )}

            {/* Customer info */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm shadow-black/5">
              <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-slate-400">Informations</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-2.5 text-sm"><User className="size-4 text-slate-300"/><div><p className="text-xs text-slate-400">Nom</p><p className="font-bold text-slate-900">{order.customer_name}</p></div></div>
                <div className="flex items-center gap-2.5 text-sm"><Phone className="size-4 text-slate-300"/><div><p className="text-xs text-slate-400">Téléphone</p><p className="font-bold text-slate-900">{order.customer_phone}</p></div></div>
                {order.customer_wilaya && <div className="flex items-center gap-2.5 text-sm"><MapPin className="size-4 text-slate-300"/><div><p className="text-xs text-slate-400">Wilaya</p><p className="font-bold text-slate-900">{order.customer_wilaya}{order.customer_address ? ` — ${order.customer_address}` : ''}</p></div></div>}
              </div>
            </div>

            {/* Items */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm shadow-black/5">
              <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-slate-400">Articles</h3>
              <div className="divide-y divide-slate-50">
                {Array.isArray(order.items) && (order.items as Array<{ product_name: string; quantity: number; unit_price: number }>).map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-xl bg-slate-50 border border-slate-100"><span className="text-xs font-black text-slate-400">{(item.product_name ?? '').charAt(0).toUpperCase()}</span></div>
                      <div><p className="text-sm font-bold text-slate-900">{item.product_name}</p><p className="text-xs text-slate-400">Qté: {item.quantity}</p></div>
                    </div>
                    <span className="text-sm font-black text-slate-900">{formatPrice(item.unit_price * item.quantity)} DA</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-sm font-black text-slate-900">Total</span>
                <span className="text-base font-black text-slate-900">{formatPrice(order.total)} DA</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────── ATHLETIC ─────────────────────────────── */
function AthleticTracking() {
  const { activeStore, orderNumber, setOrderNumber, order, loading, error, searched, handleSearch, currentStepIndex } = useOrderSearch();
  const primary = (activeStore?.theme_config?.primaryColor as string) || '#ef4444';

  return (
    <div className="bg-[#0A0A0A] min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">

        {/* Header */}
        <div className="mb-10">
          <p className="text-[9px] font-black uppercase tracking-[0.4em] mb-3" style={{ color: primary }}>Track</p>
          <h1 className="text-3xl font-black uppercase tracking-tight text-white">Suivre ma commande</h1>
        </div>

        {/* Search */}
        <div className="border border-white/5 bg-[#111] p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-white/20"/>
              <input placeholder="N° de commande — ML-20250101-0001" value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                className="w-full h-12 pl-10 pr-4 text-xs font-mono font-bold text-white bg-[#0A0A0A] border border-white/5 focus:outline-none focus:border-white/15 placeholder:text-white/15"/>
            </div>
            <button onClick={handleSearch} disabled={loading}
              className="h-12 px-6 text-[10px] font-black uppercase tracking-[0.3em] text-black flex items-center gap-2 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              style={{ backgroundColor: primary }}>
              {loading ? <><Loader2 className="size-4 animate-spin"/>...</> : <>Suivre <ArrowRight className="size-3.5"/></>}
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
                  <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest">{new Date(order.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[9px] font-black uppercase tracking-widest px-3 py-1.5 ${ORDER_STATUS_COLORS[order.status]}`}>{ORDER_STATUS_LABELS[order.status]}</span>
                <span className="text-lg font-black text-white tabular-nums">{formatPrice(order.total)} DA</span>
              </div>
            </div>

            {/* Timeline */}
            {order.status !== 'RETURNED' ? (
              <div className="bg-[#111] border border-white/5 p-5">
                <p className="text-[9px] font-black uppercase tracking-[0.35em] text-white/20 mb-6">Progression</p>
                <div className="relative">
                  {/* line */}
                  <div className="absolute top-3 left-3 right-3 h-px bg-white/5"/>
                  <div className="absolute top-3 left-3 h-px bg-white/30 transition-all" style={{ width: `${Math.min((currentStepIndex / (PIPELINE_STEPS.length - 1)) * 100, 100)}%`, backgroundColor: primary }}/>
                  <div className="flex justify-between relative">
                    {PIPELINE_STEPS.map((step, idx) => {
                      const state = getStepState(order.status, step.status);
                      return (
                        <div key={step.status} className="flex flex-col items-center gap-2">
                          <div className={`size-6 border flex items-center justify-center transition-all ${state === 'completed' ? 'border-none' : state === 'current' ? 'border-white/60' : 'border-white/10'}`}
                            style={state === 'completed' ? { backgroundColor: primary } : state === 'current' ? { backgroundColor: 'transparent' } : {}}>
                            {state === 'completed' && <CheckCircle2 className="size-3.5 text-black"/>}
                            {state === 'current' && <div className="size-2 rounded-sm" style={{ backgroundColor: primary }}/>}
                          </div>
                          <span className={`text-[9px] font-black uppercase tracking-widest hidden sm:block ${state === 'completed' || state === 'current' ? 'text-white/60' : 'text-white/15'}`}>{step.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-[#111] border border-red-900/30 p-5">
                <p className="text-xs font-black uppercase tracking-widest text-red-400">Commande retournée</p>
              </div>
            )}

            {/* Info + items in grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-px">
              <div className="bg-[#111] border border-white/5 p-5">
                <p className="text-[9px] font-black uppercase tracking-[0.35em] text-white/20 mb-4">Client</p>
                <div className="space-y-3">
                  <div className="flex items-center gap-2"><User className="size-3.5 text-white/20"/><span className="text-xs font-bold text-white/60">{order.customer_name}</span></div>
                  <div className="flex items-center gap-2"><Phone className="size-3.5 text-white/20"/><span className="text-xs font-bold text-white/60">{order.customer_phone}</span></div>
                  {order.customer_wilaya && <div className="flex items-center gap-2"><MapPin className="size-3.5 text-white/20"/><span className="text-xs font-bold text-white/60">{order.customer_wilaya}</span></div>}
                </div>
              </div>
              <div className="bg-[#111] border border-white/5 p-5">
                <p className="text-[9px] font-black uppercase tracking-[0.35em] text-white/20 mb-4">Articles</p>
                <div className="space-y-2">
                  {Array.isArray(order.items) && (order.items as Array<{ product_name: string; quantity: number; unit_price: number }>).map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center">
                      <span className="text-xs font-bold text-white/50 truncate">{item.product_name} <span className="text-white/25">×{item.quantity}</span></span>
                      <span className="text-xs font-black text-white/60 tabular-nums shrink-0 ml-2">{formatPrice(item.unit_price * item.quantity)} DA</span>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-white/5 flex justify-between">
                    <span className="text-[9px] font-black uppercase tracking-widest text-white/20">Total</span>
                    <span className="text-xs font-black text-white tabular-nums">{formatPrice(order.total)} DA</span>
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

/* ─────────────────────────────── LUXE ─────────────────────────────── */
function LuxeTracking() {
  const { activeStore, orderNumber, setOrderNumber, order, loading, error, searched, handleSearch, currentStepIndex } = useOrderSearch();
  const primary = (activeStore?.theme_config?.primaryColor as string) || '#b8964e';

  return (
    <div className="bg-[#0C0F1A] min-h-screen">
      <div className="mx-auto max-w-2xl px-6 py-16 sm:py-24">

        {/* Header */}
        <div className="mb-14 text-center">
          <p className="text-[9px] tracking-[0.5em] uppercase mb-4 font-light" style={{ color: primary }}>Suivi</p>
          <h1 className="text-3xl font-light text-white tracking-wide" style={{ fontFamily: '"Playfair Display", serif' }}>Suivre ma commande</h1>
          <div className="mx-auto mt-5 h-px w-12" style={{ backgroundColor: primary }}/>
        </div>

        {/* Search */}
        <div className="border border-white/5 p-5 mb-6">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-white/15"/>
              <input placeholder="Numéro de commande…" value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                className="w-full h-12 pl-10 pr-4 text-xs font-light font-mono text-white/60 bg-transparent border border-white/8 focus:outline-none focus:border-white/20 placeholder:text-white/15 tracking-wide"
                style={{ borderColor: 'rgba(255,255,255,0.08)' }}/>
            </div>
            <button onClick={handleSearch} disabled={loading}
              className="h-12 px-8 text-[10px] tracking-[0.3em] uppercase font-light text-black flex items-center gap-2 transition-all hover:brightness-95 disabled:opacity-50"
              style={{ backgroundColor: primary }}>
              {loading ? <><Loader2 className="size-3.5 animate-spin"/>Recherche</> : 'Suivre'}
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
                <p className="text-[9px] tracking-[0.35em] uppercase text-white/20 mb-1.5 font-light">Commande</p>
                <p className="text-sm font-light font-mono text-white/70">{order.order_number}</p>
                <p className="text-[10px] tracking-wide text-white/25 mt-1 font-light">{new Date(order.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              </div>
              <div className="text-right">
                <span className={`inline-flex text-[9px] tracking-[0.25em] uppercase font-light px-3 py-1.5 border ${ORDER_STATUS_COLORS[order.status]}`}>{ORDER_STATUS_LABELS[order.status]}</span>
                <p className="text-lg font-light text-white/80 mt-2 tabular-nums">{formatPrice(order.total)} DA</p>
              </div>
            </div>

            {/* Timeline — minimal dots */}
            {order.status !== 'RETURNED' ? (
              <div className="border border-white/5 p-6">
                <p className="text-[9px] tracking-[0.4em] uppercase text-white/15 mb-8 font-light">Progression</p>
                <div className="flex items-center">
                  {PIPELINE_STEPS.map((step, idx) => {
                    const state = getStepState(order.status, step.status);
                    const isLast = idx === PIPELINE_STEPS.length - 1;
                    return (
                      <div key={step.status} className="flex items-center flex-1 last:flex-none">
                        <div className="flex flex-col items-center gap-2">
                          <div className={`size-2 rounded-full transition-all ${state === 'completed' ? '' : state === 'current' ? 'ring-2 ring-offset-2 ring-offset-[#0C0F1A]' : 'bg-white/10'}`}
                            style={state === 'completed' ? { backgroundColor: primary } : state === 'current' ? { backgroundColor: primary, ringColor: primary } : {}}/>
                          <span className={`text-[8px] tracking-[0.2em] uppercase font-light hidden sm:block ${state === 'pending' ? 'text-white/15' : 'text-white/35'}`}>{step.label}</span>
                        </div>
                        {!isLast && <div className="flex-1 h-px mx-2" style={{ backgroundColor: idx < currentStepIndex ? primary : 'rgba(255,255,255,0.06)' }}/>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="border border-red-900/20 p-5">
                <p className="text-xs tracking-[0.25em] uppercase text-red-400/60 font-light">Commande retournée</p>
              </div>
            )}

            {/* Info */}
            <div className="border border-white/5 p-6">
              <p className="text-[9px] tracking-[0.4em] uppercase text-white/15 mb-6 font-light">Destinataire</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-center gap-3"><User className="size-3.5 text-white/15"/><div><p className="text-[9px] tracking-[0.2em] uppercase text-white/20 font-light">Nom</p><p className="text-sm font-light text-white/50 mt-0.5">{order.customer_name}</p></div></div>
                <div className="flex items-center gap-3"><Phone className="size-3.5 text-white/15"/><div><p className="text-[9px] tracking-[0.2em] uppercase text-white/20 font-light">Téléphone</p><p className="text-sm font-light text-white/50 mt-0.5">{order.customer_phone}</p></div></div>
                {order.customer_wilaya && <div className="flex items-center gap-3 sm:col-span-2"><MapPin className="size-3.5 text-white/15"/><div><p className="text-[9px] tracking-[0.2em] uppercase text-white/20 font-light">Wilaya</p><p className="text-sm font-light text-white/50 mt-0.5">{order.customer_wilaya}{order.customer_address ? ` · ${order.customer_address}` : ''}</p></div></div>}
              </div>
            </div>

            {/* Items */}
            <div className="border border-white/5 p-6">
              <p className="text-[9px] tracking-[0.4em] uppercase text-white/15 mb-6 font-light">Articles</p>
              <div className="space-y-3">
                {Array.isArray(order.items) && (order.items as Array<{ product_name: string; quantity: number; unit_price: number }>).map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
                    <span className="text-sm font-light text-white/40">{item.product_name}<span className="text-white/20 ml-2 text-xs">×{item.quantity}</span></span>
                    <span className="text-sm font-light text-white/50 tabular-nums">{formatPrice(item.unit_price * item.quantity)} DA</span>
                  </div>
                ))}
                <div className="pt-3 flex justify-between border-t border-white/5">
                  <span className="text-[9px] tracking-[0.3em] uppercase text-white/20 font-light">Total</span>
                  <span className="text-sm font-light tabular-nums" style={{ color: primary }}>{formatPrice(order.total)} DA</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────── EXPORT ─────────────────────────────── */
export function OrderTracking() {
  const activeStore = useAppStore((s) => s.activeStore);
  const _rawTpl = (activeStore?.template_id ?? activeStore?.theme_config?.templateId ?? 'clean') as string;
  const tpl = _rawTpl === 'minimalist' ? 'clean' : _rawTpl === 'landing' ? 'athletic' : _rawTpl.toLowerCase();
  if (tpl === 'athletic') return <AthleticTracking/>;
  if (tpl === 'luxe') return <LuxeTracking/>;
  return <CleanTracking/>;
}
