'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Phone, CheckCircle2, Truck, Package, Clock, AlertCircle,
  ChevronDown, MessageSquare, X, Bell, BellRing, Loader2,
  PhoneCall, PhoneMissed, PhoneOff, CalendarClock, User as UserIcon,
  MapPin, Hash, RotateCcw, Eye, ClipboardList, Zap, Plus, ArrowRightLeft, Calendar, Search,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { apiFetch } from '@/lib/api-client';
import { formatPrice, formatOrderRef } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { WILAYAS } from '@/lib/wilaya-data';
import { OrderTraceabilityPanel } from '@/components/admin/order-traceability-panel';
import { OrderTrackingReport } from '@/components/admin/order-tracking-report';
import type { Order, OrderEvent } from '@/lib/types';

const formatVariantDetails = (variantDetails: any): string => {
  if (!variantDetails) return '';
  try {
    const details = typeof variantDetails === 'string'
      ? (variantDetails.trim().startsWith('{') ? JSON.parse(variantDetails) : variantDetails)
      : variantDetails;

    if (typeof details === 'string') {
      return details;
    }

    if (details && typeof details === 'object') {
      if (details.variant) {
        return String(details.variant);
      }
      return Object.entries(details)
        .filter(([k]) => k !== 'notes')
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');
    }
  } catch {
    return String(variantDetails);
  }
  return '';
};

// ─── Status config ───────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  NEW:         { label: 'Nouveau',      color: '#3b82f6', bg: '#eff6ff', icon: Package },
  ASSIGNED:    { label: 'Assignée',     color: '#8b5cf6', bg: '#f5f3ff', icon: UserIcon },
  AGENT_VIEWED:{ label: 'Vue',          color: '#06b6d4', bg: '#ecfeff', icon: Eye },
  CALLED:      { label: 'Appelée',      color: '#f59e0b', bg: '#fffbeb', icon: PhoneCall },
  IN_PROGRESS: { label: 'En cours',     color: '#f59e0b', bg: '#fffbeb', icon: Clock },
  RESCHEDULED: { label: 'Reportée',     color: '#8b5cf6', bg: '#f5f3ff', icon: CalendarClock },
  CONFIRMED:   { label: 'Confirmée',    color: '#10b981', bg: '#ecfdf5', icon: CheckCircle2 },
  SHIPPED:     { label: 'Expédiée',     color: '#6366f1', bg: '#eef2ff', icon: Truck },
  DELIVERED:   { label: 'Livrée',       color: '#22c55e', bg: '#f0fdf4', icon: CheckCircle2 },
  RETURNED:    { label: 'Retournée',    color: '#ef4444', bg: '#fef2f2', icon: RotateCcw },
  CANCELLED:   { label: 'Annulée',      color: '#6b7280', bg: '#f9fafb', icon: X },
};

function PendingTimer({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    const start = new Date(startTime).getTime();
    const tick = () => {
      const diff = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsed(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const int = setInterval(tick, 1000);
    return () => clearInterval(int);
  }, [startTime]);
  return <span className="font-mono text-xs">{elapsed}</span>;
}

function CallbackCountdown({ nextCallbackTime }: { nextCallbackTime: string }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const target = new Date(nextCallbackTime).getTime();
    
    function update() {
      const diff = target - Date.now();
      if (diff <= 0) {
        setTimeLeft('Rappel immédiat');
        return;
      }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      const parts: string[] = [];
      if (hours > 0) parts.push(`${hours}h`);
      if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
      parts.push(`${seconds}s`);
      
      setTimeLeft(parts.join(' '));
    }

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [nextCallbackTime]);

  const isUrgent = new Date(nextCallbackTime).getTime() - Date.now() <= 0;

  return (
    <span className={cn(
      "text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 border transition-all",
      isUrgent 
        ? "bg-red-50 text-red-700 border-red-200 animate-pulse" 
        : "bg-amber-50 text-amber-800 border-amber-200"
    )}>
      <Clock className="size-3" />
      <span>Rappel dans : {timeLeft}</span>
    </span>
  );
}

// ─── Order Card ──────────────────────────────────────────────
function OrderCard({ order, onAction, actionLoading, onEdit }: {
  order: Order;
  onAction: (orderId: string, action: string, payload?: any) => void;
  actionLoading: string | null;
  onEdit: (order: Order) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [callPanelOpen, setCallPanelOpen] = useState(false);
  const [callResult, setCallResult] = useState('');
  const [callNote, setCallNote] = useState('');
  const [callbackAt, setCallbackAt] = useState('');
  const [confirmNote, setConfirmNote] = useState('');
  const [confirmPanel, setConfirmPanel] = useState(false);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [tempNote, setTempNote] = useState(order.notes || '');

  useEffect(() => {
    setTempNote(order.notes || '');
  }, [order.notes]);

  const handleSaveNote = () => {
    onAction(order.id, 'STATUS', { notes: tempNote });
    setIsEditingNote(false);
  };

  const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.NEW;
  const StatusIcon = cfg.icon;
  const isNew = order.status === 'NEW' || order.status === 'ASSIGNED' || (order.status as string) === 'AGENT_VIEWED';
  const isCalled = order.status === 'CALLED';
  const isConfirmed = order.status === 'CONFIRMED';
  const loading = actionLoading === order.id;

  const ageMs = Date.now() - new Date(order.created_at).getTime();
  const ageMin = Math.floor(ageMs / 60000);
  const ageStr = ageMin < 60 ? `${ageMin}m` : `${Math.floor(ageMin / 60)}h${ageMin % 60}m`;
  const isUrgent = ageMin > 30 && isNew;

  return (
    <div className={cn(
      'bg-white rounded-2xl border transition-all duration-200',
      isUrgent ? 'border-amber-300 shadow-amber-100/60 shadow-md' : 'border-slate-100 shadow-sm hover:shadow-md',
      isConfirmed && 'border-emerald-200',
    )}>
      {/* ── Header ── */}
      <div className="flex items-start gap-3 p-4">
        {/* Status indicator */}
        <div className="size-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: cfg.bg }}>
          <StatusIcon className="size-5" style={{ color: cfg.color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-black text-[#6C5CE7] font-mono">{formatOrderRef(order, 'admin')}</span>
            {order.status === 'NEW' && (
              <span className="px-2 py-0.5 text-[9px] font-black text-white bg-rose-500 rounded-full animate-pulse">
                Nouveau
              </span>
            )}
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: cfg.bg, color: cfg.color }}>
              {cfg.label}
            </span>
            {order.source === 'MANUAL' ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">Manuel</span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                {order.source === 'landing_page' ? 'Landing Page' : order.source === 'FACEBOOK' ? 'Meta Ads' : order.source || 'Manuel'}
              </span>
            )}
            {order.status === 'CANCELLED' && order.nrp_count && order.nrp_count >= (order.is_abandoned_cart ? 15 : 9) ? (
               <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200" title="Ne Répond Pas - Annulation automatique">📞 Tentative {order.nrp_count}/{order.is_abandoned_cart ? 15 : 9} (NRP - Annulée)</span>
            ) : order.nrp_count && order.nrp_count > 0 ? (
               <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700" title="Ne Répond Pas - Tentatives d'appel">📞 Tentative {order.nrp_count}/{order.is_abandoned_cart ? 15 : 9} (NRP)</span>
            ) : null}
            {order.confirmation_start_time && order.status === 'IN_PROGRESS' && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 flex items-center gap-1">
                <Clock className="size-3" /> <PendingTimer startTime={order.confirmation_start_time} />
              </span>
            )}
            {order.next_callback_time && (
              <CallbackCountdown nextCallbackTime={order.next_callback_time} />
            )}
            {isUrgent && (
              <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 animate-pulse">
                ⚡ Urgent — {ageStr}
              </span>
            )}
            {!isUrgent && (
              <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                <Clock className="size-3" /> {ageStr}
              </span>
            )}
          </div>

          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-sm font-black text-slate-900 truncate">{order.customer_name}</span>
            <a href={`tel:${order.customer_phone}`} className="text-sm font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1">
              <Phone className="size-3" />{order.customer_phone}
            </a>
          </div>

          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
            <MapPin className="size-3" /> {order.customer_wilaya}
            <span className="text-slate-200">·</span>
            <span className="font-black text-slate-800">{formatPrice(order.total)}</span>
            {order.delivery_fee > 0 && (
              <><span className="text-slate-200">·</span>
              <span className="text-slate-500 font-medium">Livraison: {formatPrice(order.delivery_fee)}</span></>
            )}
            {order.items.length > 0 && (
              <><span className="text-slate-200">·</span>
              <span>{order.items.length} art.</span></>
            )}
          </div>

          <div className="mt-2.5 pt-2 border-t border-dashed border-slate-100 flex items-start gap-2 text-xs bg-slate-50/50 p-2 rounded-xl">
            <MessageSquare className="size-3.5 text-slate-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              {isEditingNote ? (
                <div className="flex gap-1.5 items-center">
                  <Input
                    value={tempNote}
                    onChange={e => setTempNote(e.target.value)}
                    placeholder="Note..."
                    className="h-7 text-xs bg-white border-slate-200 focus-visible:ring-indigo-500 py-0.5 px-2 rounded-lg flex-1"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        handleSaveNote();
                      } else if (e.key === 'Escape') {
                        setIsEditingNote(false);
                      }
                    }}
                  />
                  <button
                    disabled={loading}
                    onClick={handleSaveNote}
                    className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-[10px] uppercase tracking-wider shrink-0 transition-colors disabled:opacity-50"
                  >
                    Enregistrer
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingNote(false);
                      setTempNote(order.notes || '');
                    }}
                    className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-bold text-[10px] uppercase tracking-wider shrink-0 transition-colors"
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3 group/note">
                  <p className={cn("text-xs font-semibold leading-relaxed break-words flex-1", order.notes ? "text-slate-700" : "text-slate-400 italic")}>
                    {order.notes ? (
                      <>
                        <span className="font-extrabold text-slate-800 mr-1">Note:</span>
                        {order.notes}
                      </>
                    ) : (
                      "Aucune note laissée pour cette commande..."
                    )}
                  </p>
                  <button
                    onClick={() => {
                      setTempNote(order.notes || '');
                      setIsEditingNote(true);
                    }}
                    className="text-indigo-600 hover:text-indigo-800 font-extrabold text-[9px] uppercase tracking-widest shrink-0 opacity-100 md:opacity-0 group-hover/note:opacity-100 transition-opacity"
                  >
                    {order.notes ? "Modifier" : "Ajouter note"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <button onClick={() => setExpanded(e => !e)} className="text-slate-300 hover:text-slate-600 transition-colors mt-1">
          <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      {/* ── Items & Micro-details ── */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-50 pt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Détails de la Commande</p>
            <button
              onClick={() => onEdit(order)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"
            >
              <Zap className="size-3 text-indigo-500" /> Modifier la commande
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            {/* Left Column: Items, Notes & Totals */}
            <div className="space-y-4">
              <div className="space-y-2">
                {order.items.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {item.image_url
                      ? <img src={item.image_url} className="size-8 rounded-lg object-cover border border-slate-100" />
                      : <div className="size-8 rounded-lg bg-slate-100 flex items-center justify-center"><Package className="size-4 text-slate-400" /></div>}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-800 truncate text-xs">{item.product_name}</p>
                      {(() => {
                        const vText = formatVariantDetails(item.variant_details);
                        let notes = '';
                        try {
                          const details = typeof item.variant_details === 'string' ? JSON.parse(item.variant_details) : item.variant_details;
                          notes = details?.notes || '';
                        } catch {}

                        if (!vText && !notes) return null;

                        return (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {vText && <span className="inline-block px-1.5 py-0.5 bg-slate-100 rounded text-[9px] font-bold text-slate-500 uppercase tracking-widest">{vText}</span>}
                            {notes && <span className="inline-block px-1.5 py-0.5 bg-blue-50 border border-blue-100 text-blue-700 rounded text-[9px] font-bold">Note: {notes}</span>}
                          </div>
                        );
                      })()}
                    </div>
                    <span className="text-xs font-bold text-slate-500 shrink-0">×{item.quantity}</span>
                    <span className="text-xs font-black text-slate-900 shrink-0">{formatPrice(item.unit_price * item.quantity)}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5 pt-2 border-t border-slate-100 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Sous-total</span>
                  <span className="font-bold">{formatPrice(order.subtotal || (order.total - order.delivery_fee))}</span>
                </div>
                {order.discount > 0 && (
                  <div className="flex justify-between text-rose-500">
                    <span>Remise</span>
                    <span className="font-bold">-{formatPrice(order.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Livraison</span>
                  <span className="font-bold">{formatPrice(order.delivery_fee)}</span>
                </div>
                <div className="flex justify-between text-sm font-black pt-1.5 border-t border-dashed">
                  <span>Total à encaisser</span>
                  <span className="text-emerald-600">{formatPrice(order.total)}</span>
                </div>
              </div>

              {order.notes && (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-100 text-xs text-amber-700">
                  <MessageSquare className="size-3.5 inline mr-1.5 align-text-bottom" />
                  <span className="font-bold">Note Client :</span> {order.notes}
                </div>
              )}
            </div>

            {/* Right Column: Rich Micro-Details */}
            <div className="space-y-4 bg-slate-50/50 p-4 rounded-2xl border border-slate-100/80 text-xs">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b pb-1.5 mb-2">Micro-Détails Commande</p>
              
              <div className="grid grid-cols-2 gap-y-3.5 gap-x-4">
                <div className="space-y-0.5">
                  <p className="font-bold text-slate-400 text-[10px] uppercase tracking-wider">Créée le</p>
                  <p className="font-extrabold text-slate-800">{new Date(order.created_at).toLocaleString('fr-FR')}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="font-bold text-slate-400 text-[10px] uppercase tracking-wider">Provenance</p>
                  <p className="font-extrabold text-slate-800 uppercase tracking-wide">
                    {order.source === 'landing_page' ? 'Landing Page' : order.source === 'FACEBOOK' ? 'Meta Ads' : order.source || 'Direct'}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <p className="font-bold text-slate-400 text-[10px] uppercase tracking-wider">Commune</p>
                  <p className="font-bold text-slate-800">{order.customer_commune || '—'}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="font-bold text-slate-400 text-[10px] uppercase tracking-wider">Type de livraison</p>
                  <p className="font-bold text-slate-800">{order.delivery_type === 'stopdesk' ? 'Bureau / Stopdesk' : 'À domicile'}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="font-bold text-slate-400 text-[10px] uppercase tracking-wider">Transporteur</p>
                  <p className="font-extrabold text-indigo-600">{order.carrier?.name || 'Aucun transporteur'}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="font-bold text-slate-400 text-[10px] uppercase tracking-wider">N° de suivi (Tracking)</p>
                  <p className="font-mono font-extrabold text-slate-800">{order.tracking_number || 'Aucun'}</p>
                </div>
                {order.customer_phone2 && (
                  <div className="space-y-0.5">
                    <p className="font-bold text-slate-400 text-[10px] uppercase tracking-wider">Téléphone 2</p>
                    <p className="font-mono font-bold text-slate-800">{order.customer_phone2}</p>
                  </div>
                )}
                {typeof (order as any).commission === 'number' && (
                  <div className="space-y-0.5">
                    <p className="font-bold text-slate-400 text-[10px] uppercase tracking-wider">Ma Commission</p>
                    <p className="font-extrabold text-emerald-600">{formatPrice((order as any).commission)}</p>
                  </div>
                )}
                <div className="space-y-0.5 col-span-2">
                  <p className="font-bold text-slate-400 text-[10px] uppercase tracking-wider">Adresse complète</p>
                  <p className="font-bold text-slate-800 leading-relaxed bg-white p-2 rounded-lg border border-slate-100">{order.customer_address || 'Non renseignée'}</p>
                </div>
                <div className="space-y-1 col-span-2 border-t border-slate-200/50 pt-2 mt-1">
                  <p className="font-bold text-slate-400 text-[10px] uppercase tracking-wider">Métadonnées Techniques</p>
                  <div className="space-y-1 font-mono text-[9px] text-slate-500 bg-white p-2.5 rounded-lg border border-slate-100 leading-normal">
                    <p><span className="font-bold text-slate-400">IP:</span> {(order as any).ip_address || 'Non enregistrée'}</p>
                    <p className="break-all"><span className="font-bold text-slate-400">Appareil:</span> {(order as any).user_agent || 'Non enregistré'}</p>
                    {(order as any).referrer && <p className="break-all"><span className="font-bold text-slate-400">Referrer:</span> {(order as any).referrer}</p>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Traceability Toggle */}
          <div className="mt-4 pt-3 border-t border-slate-100">
            <button
              onClick={() => setShowTrace(t => !t)}
              className="text-slate-400 hover:text-slate-700 flex items-center gap-1 transition-colors font-bold text-[10px] uppercase tracking-wider"
            >
              <ClipboardList className="size-3.5" />
              {showTrace ? "Masquer l'historique" : "Voir l'historique & SLA"}
            </button>
            {showTrace && (
              <div className="mt-3 bg-slate-50 rounded-xl p-4 border border-slate-100 text-left space-y-4">
                <OrderTraceabilityPanel orderId={order.id} />
                <OrderTrackingReport orderId={order.id} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Actions ── */}
      <div className="px-4 pb-4 flex flex-col gap-2">
        {/* ACTION BUTTONS (CONFIRMATION WORKFLOW) */}
        {(['NEW', 'ASSIGNED', 'CALLED', 'IN_PROGRESS', 'RESCHEDULED'].includes(order.status as string)) && (
          <>
            <div className="flex gap-2">
              <button
                disabled={loading}
                onClick={() => setConfirmPanel(true)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <CheckCircle2 className="size-4" /> Confirmé
              </button>
              <button
                disabled={loading}
                onClick={() => onAction(order.id, 'STATUS', { status: 'CANCELLED' })}
                className="flex-[0.5] flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-slate-600 bg-slate-100 hover:bg-slate-200 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <X className="size-4" /> Annulé
              </button>
            </div>
            <div className="flex gap-2">
              <button
                disabled={loading}
                onClick={() => onAction(order.id, 'STATUS', { call_result: 'NRP' })}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-amber-500 hover:bg-amber-600 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <PhoneMissed className="size-4" /> NRP (Ne Répond Pas)
              </button>
              <button
                onClick={() => setCallPanelOpen(true)}
                className="flex-[0.5] flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-purple-500 hover:bg-purple-600 active:scale-[0.98] transition-all"
              >
                <CalendarClock className="size-4" /> Reporté
              </button>
            </div>
          </>
        )}

        {/* EXPÉDIER */}
        {isConfirmed && (
          <button
            onClick={() => onAction(order.id, 'STATUS', { status: 'SHIPPED' })}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-indigo-500 hover:bg-indigo-600 active:scale-[0.98] transition-all disabled:opacity-60"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
            Expédier
          </button>
        )}
      </div>

      {/* ── Postpone Panel ── */}
      {callPanelOpen && (
        <div className="mx-4 mb-4 p-4 bg-purple-50 rounded-2xl border border-purple-100 space-y-3">
          <p className="text-xs font-black uppercase tracking-widest text-purple-700">Planifier un rappel</p>
          <div>
            <p className="text-[10px] font-bold text-purple-600 mb-1">Date et heure du rappel</p>
            <Input type="datetime-local" value={callbackAt} onChange={e => setCallbackAt(e.target.value)}
              className="h-9 text-sm border-purple-200 rounded-xl" />
          </div>
          <Textarea
            placeholder="Raison du report..."
            value={callNote}
            onChange={e => setCallNote(e.target.value)}
            className="min-h-[60px] text-sm resize-none border-purple-200 bg-white rounded-xl"
          />
          <div className="flex gap-2">
            <button onClick={() => setCallPanelOpen(false)} className="flex-1 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50">
              Annuler
            </button>
            <button
              disabled={!callbackAt || loading}
              onClick={() => {
                onAction(order.id, 'STATUS', { status: 'RESCHEDULED', note: callNote, scheduled_callback_at: callbackAt + ':00Z' });
                setCallPanelOpen(false);
                setCallNote('');
                setCallbackAt('');
              }}
              className="flex-1 py-2 rounded-xl text-xs font-black text-white bg-purple-500 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="size-3 animate-spin inline" /> : 'Planifier'}
            </button>
          </div>
        </div>
      )}

      {/* ── Confirm Panel ── */}
      {confirmPanel && (
        <div className="mx-4 mb-4 p-4 bg-emerald-50 rounded-2xl border border-emerald-100 space-y-3">
          <p className="text-xs font-black uppercase tracking-widest text-emerald-700">Confirmer la commande</p>
          <Textarea
            placeholder="Note de confirmation (optionnelle)..."
            value={confirmNote}
            onChange={e => setConfirmNote(e.target.value)}
            className="min-h-[60px] text-sm resize-none border-emerald-200 bg-white rounded-xl"
          />
          <div className="flex gap-2">
            <button onClick={() => setConfirmPanel(false)} className="flex-1 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50">
              Annuler
            </button>
            <button
              disabled={loading}
              onClick={() => {
                onAction(order.id, 'CONFIRM', { note: confirmNote });
                setConfirmPanel(false);
                setConfirmNote('');
              }}
              className="flex-1 py-2 rounded-xl text-xs font-black text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50"
            >
              {loading ? <Loader2 className="size-3 animate-spin inline" /> : '✓ Confirmer'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Agent Orders Page ───────────────────────────────────
export default function AgentOrdersPage() {
  const { activeStore, user } = useAppStore();
  const storeId = activeStore?.id ?? '';
  const qc = useQueryClient();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | 'reminder' | 'done'>('active');
  const [search, setSearch] = useState('');
  const prevCountRef = useRef(0);
  const [hasNew, setHasNew] = useState(false);

  // States for manual order creation
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [orderItems, setOrderItems] = useState<{product: any | null, quantity: number, unit_price: number}[]>([
    { product: null, quantity: 1, unit_price: 0 }
  ]);
  const [orderSource, setOrderSource] = useState('MANUAL');
  const [orderWilaya, setOrderWilaya] = useState('');
  const [selectedPartnerId, setSelectedPartnerId] = useState('');
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [deliveryType, setDeliveryType] = useState('home');
  const [orderDiscount, setOrderDiscount] = useState(0);
  const [isPack, setIsPack] = useState(false);
  const [isUpsell, setIsUpsell] = useState(false);
  const [isMarketplaceUpsell, setIsMarketplaceUpsell] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const ordersQuery = useQuery<any>({
    queryKey: ['agent-orders', storeId, user?.id],
    queryFn: () => apiFetch(`/api/v1/orders?store_id=${storeId}&pageSize=100`),
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
    enabled: !!storeId,
  });

  const productsQuery = useQuery<any>({
    queryKey: ['admin-products-lite', storeId, isMarketplaceUpsell],
    enabled: isCreatingOrder && !!storeId,
    queryFn: () => apiFetch(`/api/v1/products?store_id=${storeId}&minimal=true${isMarketplaceUpsell ? '&upsell_only=true' : ''}`),
  });

  const deliveryPartnersQuery = useQuery<any>({
    queryKey: ['delivery-partners-lite', storeId],
    enabled: !!storeId,
    queryFn: () => apiFetch(`/api/v1/delivery-partners?store_id=${storeId}`),
  });

  // Calculate shipping fees dynamically
  useEffect(() => {
    if (!selectedPartnerId || !orderWilaya) return;
    const fetchFee = async () => {
      try {
        const productIds = orderItems.map(item => item.product?.id).filter(Boolean).join(',');
        const res = await apiFetch<any>(
          `/api/v1/delivery-partners/calculate?partnerId=${selectedPartnerId}&wilayaId=${orderWilaya}&type=${deliveryType}&productIds=${productIds}`
        );
        if (res?.success && typeof res?.data?.fee === 'number') {
          setDeliveryFee(res.data.fee);
          toast.success(`Tarif de livraison mis à jour : ${res.data.fee} DA`);
        }
      } catch (error) {
        console.error('Error fetching shipping fee:', error);
      }
    };
    fetchFee();
  }, [selectedPartnerId, orderWilaya, deliveryType, orderItems]);

  const createOrderMutation = useMutation({
    mutationFn: (data: any) => apiFetch('/api/v1/orders/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      toast.success('Commande manuelle créée avec succès');
      setIsCreatingOrder(false);
      // Reset states
      setOrderItems([{ product: null, quantity: 1, unit_price: 0 }]);
      setOrderSource('MANUAL');
      setOrderWilaya('');
      setSelectedPartnerId('');
      setDeliveryFee(0);
      setDeliveryType('home');
      setOrderDiscount(0);
      setIsPack(false);
      setIsUpsell(false);
      setIsMarketplaceUpsell(false);
      setDuplicateWarning(null);
    },
    onError: (err: any) => toast.error(err.message || 'Échec de création'),
  });

  // States for editing order
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editOrderOpen, setEditOrderOpen] = useState(false);
  const [editIsPack, setEditIsPack] = useState(false);
  const [editIsUpsell, setEditIsUpsell] = useState(false);
  const [editIsAbandonedCart, setEditIsAbandonedCart] = useState(false);
  const [editRecoveryFee, setEditRecoveryFee] = useState(0);

  const editOrderMutation = useMutation({
    mutationFn: (data: any) => apiFetch(`/api/v1/orders/${data.id}/info`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      qc.invalidateQueries({ queryKey: ['admin-products-stock'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      setEditOrderOpen(false);
      setEditingOrder(null);
      toast.success('Commande mise à jour avec succès');
    },
    onError: (err: any) => toast.error(err.message || 'Échec de mise à jour'),
  });

  const orders: Order[] = ordersQuery.data?.data ?? [];

  // Detect new orders since last poll
  useEffect(() => {
    const count = orders.filter(o => o.status === 'NEW' || o.status === 'ASSIGNED').length;
    if (prevCountRef.current > 0 && count > prevCountRef.current) {
      setHasNew(true);
      toast.success(`${count - prevCountRef.current} nouvelle(s) commande(s) assignée(s) !`, {
        icon: '🔔',
        duration: 5000,
      });
    }
    prevCountRef.current = count;
  }, [orders]);

  const activeOrders = orders.filter(o => !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(o.status as string));
  const doneOrders = orders.filter(o => ['DELIVERED', 'CANCELLED', 'RETURNED'].includes(o.status as string));
  
  const reminderOrders = orders.filter(o => {
    if (o.status !== 'IN_PROGRESS' && o.status !== 'RESCHEDULED') return false;
    if (!o.next_callback_time) return false;
    return new Date(o.next_callback_time).getTime() <= Date.now();
  });

  const baseDisplayOrders = filter === 'active' ? activeOrders : filter === 'reminder' ? reminderOrders : doneOrders;

  const displayOrders = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return baseDisplayOrders;
    return baseDisplayOrders.filter(o =>
      o.order_number?.toLowerCase().includes(q) ||
      o.customer_name?.toLowerCase().includes(q) ||
      o.customer_phone?.includes(q),
    );
  })();

  const newCount = orders.filter(o => o.status === 'NEW' || o.status === 'ASSIGNED').length;
  const confirmedToday = orders.filter(o => {
    if (o.status !== 'CONFIRMED' && o.status !== 'SHIPPED' && o.status !== 'DELIVERED') return false;
    const today = new Date().toDateString();
    return new Date(o.updated_at).toDateString() === today;
  }).length;

  const handleAction = useCallback(async (orderId: string, action: string, payload: any) => {
    setActionLoading(orderId);
    try {
      if (action === 'STATUS' || action === 'CONFIRM') {
        const updatePayload = action === 'CONFIRM' ? { status: 'CONFIRMED', notes: payload.note } : payload;
        await apiFetch(`/api/v1/orders/${orderId}`, {
          method: 'PATCH',
          body: JSON.stringify(updatePayload),
        });

        // Auto-dispatch when status becomes CONFIRMED
        if (updatePayload.status === 'CONFIRMED') {
          toast.info("Envoi en cours à l'entreprise de livraison...");
          try {
            const dispatchRes = await apiFetch<any>(`/api/v1/orders/${orderId}/dispatch`, {
              method: 'POST',
            });
            if (dispatchRes?.success) {
              toast.success(`Commande créée chez le transporteur ! N° de suivi : ${dispatchRes.tracking_number}`);
            } else {
              toast.warning("Commande confirmée, mais échec d'envoi automatique au transporteur.");
            }
          } catch (dispatchErr: any) {
            toast.warning(`Commande confirmée, mais échec d'envoi au transporteur : ${dispatchErr.message || 'erreur'}`);
          }
        }
      }

      qc.invalidateQueries({ queryKey: ['agent-orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      qc.invalidateQueries({ queryKey: ['admin-products-stock'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      if (action === 'STATUS' && payload?.status === 'RESCHEDULED') {
        toast.success('Rappel planifié avec succès !');
      } else {
        toast.success('Action enregistrée');
      }
    } catch (err: any) {
      toast.error(err.message || 'Erreur');
    } finally {
      setActionLoading(null);
    }
  }, [qc]);

  // KPI bar colors
  const primaryColor = activeStore?.theme_config?.primaryColor || '#6C5CE7';

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden text-slate-800">
      {/* ── Header ── */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <ClipboardList className="size-5" style={{ color: primaryColor }} />
              Mes Commandes
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">Espace de traitement · {activeStore?.name}</p>
          </div>
          <div className="flex items-center gap-2">
            {hasNew && (
              <button onClick={() => { setHasNew(false); setFilter('active'); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black text-white bg-amber-500 hover:bg-amber-600 animate-bounce">
                <BellRing className="size-3.5" /> Nouvelles commandes
              </button>
            )}
            <button
              onClick={() => setIsCreatingOrder(true)}
              className="h-9 px-4 rounded-xl text-xs font-bold text-white shadow-md transition-all flex items-center gap-2 border-none hover:opacity-90 active:scale-95 duration-150 shrink-0"
              style={{ backgroundColor: primaryColor }}
            >
              <Plus className="size-4" /> Nouvelle commande
            </button>
            <button onClick={() => { qc.invalidateQueries({ queryKey: ['agent-orders'] }); }}
              className="size-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-slate-50">
              {ordersQuery.isFetching ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
            </button>
          </div>
        </div>

        {/* ── KPI Row ── */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          {[
            { label: 'À traiter', value: newCount, color: '#f59e0b', bg: '#fffbeb', icon: Bell },
            { label: 'En cours', value: activeOrders.filter(o => o.status === 'CALLED').length, color: primaryColor, bg: '#f5f3ff', icon: PhoneCall },
            { label: 'Confirmées aujourd\'hui', value: confirmedToday, color: '#10b981', bg: '#ecfdf5', icon: CheckCircle2 },
          ].map(kpi => (
            <div key={kpi.label} className="flex items-center gap-3 px-4 py-3 rounded-2xl" style={{ backgroundColor: kpi.bg }}>
              <kpi.icon className="size-5 shrink-0" style={{ color: kpi.color }} />
              <div>
                <div className="text-xl font-black" style={{ color: kpi.color }}>{kpi.value}</div>
                <div className="text-[10px] font-bold text-slate-500 leading-tight">{kpi.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-0 px-6 pt-3 shrink-0 border-b border-slate-200">
        {([['active', 'En cours', activeOrders.length], ['reminder', 'À rappeler', reminderOrders.length], ['done', 'Terminées', doneOrders.length]] as const).map(([val, lbl, cnt]) => (
          <button
            key={val}
            onClick={() => setFilter(val as any)}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm font-black transition-all border-b-2',
              filter === val ? 'text-slate-900 border-current' : 'text-slate-400 border-transparent hover:text-slate-600'
            )}
            style={filter === val ? { borderColor: primaryColor, color: primaryColor } : {}}
          >
            {lbl}
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full font-black",
              filter === val ? "bg-current text-white" : "bg-slate-100 text-slate-500",
              val === 'reminder' && cnt > 0 && "bg-amber-500 text-white animate-pulse"
            )}>
              {cnt}
            </span>
          </button>
        ))}
      </div>

      {/* ── Search ── */}
      <div className="px-6 pt-3 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-300 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par n° de commande, nom ou téléphone..."
            className="w-full h-10 pl-9 pr-9 rounded-xl border border-slate-200 bg-white text-sm font-medium outline-none focus:border-slate-400 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Orders List ── */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-3 space-y-3">
        {ordersQuery.isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-8 animate-spin text-slate-300" />
          </div>
        )}

        {!ordersQuery.isLoading && displayOrders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="size-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <Package className="size-8 text-slate-300" />
            </div>
            <p className="text-sm font-bold text-slate-400">
              {search
                ? 'Aucun résultat pour cette recherche'
                : filter === 'active' ? 'Aucune commande en cours' : filter === 'reminder' ? 'Aucun rappel prévu pour le moment' : 'Aucune commande terminée'}
            </p>
            <p className="text-xs text-slate-300 mt-1">
              {search ? 'Essayez un autre numéro, nom ou téléphone' : 'Les nouvelles commandes apparaîtront ici automatiquement'}
            </p>
          </div>
        )}

        {displayOrders.map(order => (
          <OrderCard 
            key={order.id} 
            order={order} 
            onAction={handleAction} 
            actionLoading={actionLoading} 
            onEdit={(ord) => {
              setEditingOrder(ord);
              setEditIsPack(!!ord.is_pack);
              setEditIsUpsell(!!ord.is_upsell);
              setEditIsAbandonedCart(!!ord.is_abandoned_cart);
              setEditRecoveryFee(ord.abandoned_cart_recovery_fee ?? 0);
              setEditOrderOpen(true);
            }} 
          />
        ))}
      </div>

      {/* ── Manual Order Creation Dialog ── */}
      <Dialog open={isCreatingOrder} onOpenChange={setIsCreatingOrder}>
         <DialogContent className="w-[98vw] max-w-[1200px] bg-white border border-neutral-200 text-slate-900 p-0 rounded-[32px] overflow-hidden max-h-[95vh] overflow-y-auto custom-scrollbar shadow-2xl">
            <div className="sticky top-0 px-12 py-8 z-20 flex items-center justify-between text-white" style={{ backgroundColor: primaryColor }}>
              <div className="space-y-1">
                 <DialogTitle className="text-xl font-black uppercase tracking-widest text-white shadow-sm">Saisie de Commande</DialogTitle>
                 <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/80">Création d'une nouvelle commande manuelle</p>
              </div>
              <div className="flex items-center gap-4">
                 <Badge variant="outline" className="border-white/30 text-white bg-white/10 uppercase text-[10px] font-black tracking-widest px-4 py-1.5 rounded-full backdrop-blur-sm">Saisie Manuelle (Confirmatrice)</Badge>
              </div>
            </div>

            <form 
              onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const validItems = orderItems.filter(item => item.product);
                if (validItems.length === 0) {
                  toast.error('Veuillez selectionner au moins un produit');
                  return;
                }
                const commune = (formData.get('commune') as string) || '';
                const address = (formData.get('address') as string) || '';
                const lineTotal = validItems.reduce((acc, item) => acc + (item.unit_price * item.quantity), 0);
                const total = Math.max(0, lineTotal + deliveryFee - orderDiscount);
                const payload = {
                  store_id: storeId,
                  customer_name: formData.get('customer_name') as string,
                  customer_phone: formData.get('customer_phone') as string,
                  customer_wilaya: orderWilaya,
                  customer_commune: commune || undefined,
                  customer_address: [commune, address].filter(Boolean).join(', '),
                  notes: formData.get('notes') as string || undefined,
                  delivery_type: deliveryType,
                  delivery_fee: deliveryFee,
                  subtotal: lineTotal,
                  discount: orderDiscount,
                  total,
                  source: orderSource,
                  carrier_id: selectedPartnerId || undefined,
                  assigned_to: user?.id || undefined, // Assigned directly to this agent
                  items: validItems.map(item => ({
                    product_id: item.product.id,
                    product_name: item.product.name,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                  })),
                  is_abandoned_cart: false,
                  is_pack: isPack,
                  is_upsell: isUpsell,
                  is_marketplace_upsell: isMarketplaceUpsell,
                };
                createOrderMutation.mutate(payload);
              }}
              className="p-12 space-y-12 bg-white"
            >
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 lg:gap-12 text-slate-800">
                 <div className="space-y-10">
                    <div className="flex items-center gap-4 border-l-2 pl-4" style={{ borderColor: primaryColor }}>
                       <span className="text-sm font-bold uppercase tracking-widest text-[#2D3436]">01. Coordonnées du Client</span>
                    </div>
                    <div className="space-y-6">
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Nom du client</label>
                             <Input name="customer_name" required placeholder="Ex: Mohamed Amine" className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4 placeholder:text-neutral-400" />
                          </div>
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Téléphone *</label>
                             <Input 
                                name="customer_phone" 
                                required 
                                placeholder="0550 00 00 00" 
                                onBlur={async (e) => {
                                  const phone = e.target.value.trim();
                                  if (!phone || phone.length < 9) { setDuplicateWarning(null); return; }
                                  try {
                                    const res = await apiFetch(`/orders/check-duplicate?phone=${encodeURIComponent(phone)}&store_id=${storeId}`) as any;
                                    if (res.is_duplicate) setDuplicateWarning(`Attention : Ce client a déjà commandé récemment (${res.order_number}) !`);
                                    else setDuplicateWarning(null);
                                  } catch(e) {}
                                }}
                                className={cn("bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4 placeholder:text-neutral-400", duplicateWarning && "border-rose-400 ring-rose-100 bg-rose-50")} 
                             />
                             {duplicateWarning && <p className="text-[10px] font-bold text-rose-600 mt-1">{duplicateWarning}</p>}
                          </div>
                       </div>
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Wilaya *</label>
                             <Select value={orderWilaya} onValueChange={setOrderWilaya} required>
                                <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4">
                                   <SelectValue placeholder="Sélectionnez une wilaya" />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-neutral-100 text-black max-h-[300px]">
                                   {WILAYAS.map((w, idx) => <SelectItem key={w} value={w} className="text-sm font-medium py-2">{idx + 1}. {w}</SelectItem>)}
                                </SelectContent>
                             </Select>
                          </div>
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Commune</label>
                             <Input name="commune" placeholder="Entrez la commune" className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4 placeholder:text-neutral-400" />
                          </div>
                       </div>
                       <div className="space-y-3">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Adresse</label>
                          <Input name="address" placeholder="RUE, QUARTIER, BÂTIMENT..." className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4 placeholder:text-neutral-400" />
                       </div>
                       <div className="space-y-3">
                           <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Note Globale / Remarques</label>
                           <Textarea name="notes" placeholder="Instructions pour la livraison..." className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium min-h-[100px] rounded-xl focus:bg-white transition-all p-4 resize-none placeholder:text-neutral-400" />
                        </div>
                    </div>
                 </div>

                 <div className="space-y-10">
                    <div className="flex items-center justify-between border-l-2 pl-4" style={{ borderColor: primaryColor }}>
                       <span className="text-sm font-bold uppercase tracking-widest text-[#2D3436]">02. Détails de l'Expédition</span>
                       <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 border border-indigo-100 rounded-xl">
                             <Checkbox id="isPack" checked={isPack} onCheckedChange={(c) => setIsPack(!!c)} className="size-4 border-indigo-200 data-[state=checked]:bg-[#6C5CE7] rounded-md" />
                             <label htmlFor="isPack" className="text-[11px] font-black uppercase tracking-widest text-[#6C5CE7] cursor-pointer">Pack Spécial</label>
                          </div>
                          <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 border border-emerald-100 rounded-xl">
                             <Checkbox id="isUpsell" checked={isUpsell} onCheckedChange={(c) => setIsUpsell(!!c)} className="size-4 border-emerald-200 data-[state=checked]:bg-emerald-500 rounded-md" />
                             <label htmlFor="isUpsell" className="text-[11px] font-black uppercase tracking-widest text-emerald-600 cursor-pointer">Vente Additionnelle</label>
                          </div>
                          <div className="flex items-center gap-2 bg-pink-50 px-3 py-1.5 border border-pink-100 rounded-xl hover:bg-pink-100/50 transition-colors">
                             <Checkbox id="isMarketplaceUpsell" checked={isMarketplaceUpsell} onCheckedChange={(c) => setIsMarketplaceUpsell(!!c)} className="size-4 border-pink-200 data-[state=checked]:bg-pink-500 rounded-md" />
                             <label htmlFor="isMarketplaceUpsell" className="text-[11px] font-black uppercase tracking-widest text-pink-600 cursor-pointer">Commande Marketplace</label>
                          </div>
                       </div>
                    </div>

                    <div className="space-y-6">
                        {orderItems.map((item, idx) => (
                           <div key={idx} className="p-4 border border-slate-200 rounded-xl space-y-4 bg-slate-50 relative">
                             {orderItems.length > 1 && (
                               <button 
                                 type="button" 
                                 onClick={() => setOrderItems(orderItems.filter((_, i) => i !== idx))} 
                                 className="absolute top-4 right-4 text-rose-500 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 p-2 rounded-lg transition-colors"
                               >
                                 <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                               </button>
                             )}
                             <div className="space-y-3 pr-12">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Produit {idx + 1} *</label>
                                <Select value={item.product?.id || ''} onValueChange={(v) => {
                                   const p = productsQuery.data?.data?.find((x: any) => x.id === v);
                                   const newItems = [...orderItems];
                                   newItems[idx].product = p;
                                   if (p) newItems[idx].unit_price = p.price ?? 0;
                                   setOrderItems(newItems);
                                }}>
                                   <SelectTrigger className="bg-white border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 transition-all px-4">
                                      <SelectValue placeholder="Rechercher Produit..." />
                                   </SelectTrigger>
                                   <SelectContent className="bg-white border-neutral-100 text-black rounded-xl max-h-[250px]">
                                      {productsQuery.data?.data?.map((p: any) => (
                                         <SelectItem key={p.id} value={p.id} className="text-sm font-medium py-2">{p.name} — SKU: {p.sku}</SelectItem>
                                      ))}
                                   </SelectContent>
                                </Select>
                             </div>
      
                             <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-3">
                                   <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Stock</label>
                                   <div className={cn("h-10 border flex items-center px-3 font-black rounded-xl font-mono text-[10px] uppercase", (item.product?.stock ?? 0) > 0 ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-rose-50 text-rose-600 border-rose-100")}>
                                      {item.product?.stock ?? '—'}
                                   </div>
                                </div>
                                <div className="space-y-3">
                                   <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Quantité</label>
                                   <Input type="number" min={1} value={item.quantity} onChange={e => {
                                      const newItems = [...orderItems];
                                      newItems[idx].quantity = Math.max(1, parseInt(e.target.value) || 1);
                                      setOrderItems(newItems);
                                   }} className="bg-white border-[#E9ECF0] text-[#2D3436] text-sm font-bold h-10 rounded-xl text-center" />
                                </div>
                                <div className="space-y-3">
                                   <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Prix Unit. (DA)</label>
                                   <Input type="number" step="1" value={item.unit_price} onChange={e => {
                                      const newItems = [...orderItems];
                                      newItems[idx].unit_price = Math.max(0, parseInt(e.target.value) || 0);
                                      setOrderItems(newItems);
                                   }} className="bg-white border-[#E9ECF0] text-[#2D3436] text-sm font-bold h-10 rounded-xl" />
                                </div>
                             </div>
                           </div>
                        ))}

                        <button
                           type="button"
                           onClick={() => setOrderItems([...orderItems, { product: null, quantity: 1, unit_price: 0 }])}
                           className="w-full h-12 rounded-xl border-2 border-dashed border-slate-200 text-xs font-bold text-slate-500 hover:border-[#6C5CE7]/50 hover:text-[#6C5CE7] hover:bg-indigo-50/50 transition-colors flex items-center justify-center gap-2"
                        >
                           + Ajouter un autre produit
                        </button>
                        
                        <div className="grid grid-cols-2 gap-4">
                           <div className="space-y-3">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Frais Livraison (DA)</label>
                              <Input readOnly name="delivery_fee" type="number" step="1" value={deliveryFee} className="bg-[#F8F9FC] border-[#E9ECF0] text-sm font-bold h-12 rounded-xl px-4 text-[#2D3436] opacity-70 cursor-not-allowed" />
                           </div>
                           <div className="space-y-3">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Remise (DA)</label>
                              <Input name="discount" type="number" step="1" value={orderDiscount} onChange={e => setOrderDiscount(Math.round(parseFloat(e.target.value) || 0))} className="bg-[#F8F9FC] border-[#E9ECF0] text-sm font-bold h-12 rounded-xl focus:bg-white transition-all px-4 text-[#2D3436]" />
                           </div>
                        </div>

                       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Source de Commande</label>
                             <Select value={orderSource} onValueChange={setOrderSource}>
                                <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4">
                                   <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-neutral-100 text-black rounded-xl">
                                   <SelectItem value="MANUAL">Saisie Manuelle</SelectItem>
                                   <SelectItem value="PHONE">Appel Direct</SelectItem>
                                </SelectContent>
                             </Select>
                          </div>
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Mode de Réception</label>
                             <Select value={deliveryType} onValueChange={setDeliveryType}>
                                <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4">
                                   <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-neutral-100 text-black rounded-xl">
                                   <SelectItem value="home">Livraison à Domicile</SelectItem>
                                   <SelectItem value="stop_desk">Stop Desk (Bureau)</SelectItem>
                                </SelectContent>
                             </Select>
                          </div>
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Entreprise de Livraison *</label>
                             <Select value={selectedPartnerId} onValueChange={setSelectedPartnerId}>
                                <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4">
                                   <SelectValue placeholder={deliveryPartnersQuery.isLoading ? "Chargement..." : "Choisir Transporteur"} />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-neutral-100 text-black rounded-xl max-h-[250px]">
                                   {deliveryPartnersQuery.data?.data?.map((partner: any) => (
                                      <SelectItem key={partner.id} value={partner.id} className="text-sm font-medium py-2">
                                         {partner.name} ({partner.carrier_id.toUpperCase()})
                                      </SelectItem>
                                   ))}
                                   {(!deliveryPartnersQuery.data?.data || deliveryPartnersQuery.data.data.length === 0) && (
                                      <SelectItem value="none" disabled>Aucun livreur configuré</SelectItem>
                                   )}
                                </SelectContent>
                             </Select>
                          </div>
                       </div>
                    </div>
                 </div>
              </div>

              <div className="pt-8 border-t flex items-center justify-between bg-white">
                 <div className="space-y-1 text-slate-800">
                    <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Total à encaisser</p>
                    <div className="text-3xl font-black text-[#2D3436] font-mono tabular-nums">
                       {formatPrice(Math.max(0, orderItems.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0) + deliveryFee - orderDiscount))}
                    </div>
                    <p className="text-[10px] text-neutral-400 font-bold">
                      {orderItems.length} article(s) · Livraison: {formatPrice(deliveryFee)}
                    </p>
                 </div>
                 <Button type="submit" disabled={createOrderMutation.isPending} className="h-14 px-10 text-[12px] font-bold uppercase tracking-widest text-white shadow-xl group rounded-xl border-none" style={{ backgroundColor: primaryColor }}>
                    {createOrderMutation.isPending ? <Loader2 className="size-5 animate-spin" /> : <>Enregistrer la Commande <ArrowRightLeft className="ml-3 size-4 group-hover:translate-x-1 transition-transform" /></>}
                 </Button>
              </div>
            </form>
         </DialogContent>
      </Dialog>

      {/* ── Edit Order Modal (Confirmatrice) ── */}
      <Dialog open={editOrderOpen} onOpenChange={setEditOrderOpen}>
        <DialogContent className="max-w-2xl w-[95vw] bg-white border-none p-0 rounded-[40px] shadow-2xl overflow-hidden text-slate-900">
          <div className="px-10 py-8 text-white" style={{ backgroundColor: primaryColor }}>
            <DialogTitle className="text-xl font-black uppercase tracking-tight text-white">Modifier la Commande</DialogTitle>
            <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mt-1">{editingOrder ? formatOrderRef(editingOrder, 'admin') : ''}</p>
          </div>
          {editingOrder && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                editOrderMutation.mutate({
                  id: editingOrder.id,
                  customer_name: fd.get('customer_name') as string,
                  customer_phone: fd.get('customer_phone') as string,
                  customer_phone2: fd.get('customer_phone2') as string || undefined,
                  customer_address: fd.get('customer_address') as string,
                  customer_wilaya: fd.get('customer_wilaya') as string,
                  customer_commune: fd.get('customer_commune') as string || undefined,
                  delivery_fee: parseInt(fd.get('delivery_fee') as string) || 0,
                  notes: fd.get('notes') as string || undefined,
                  carrier_id: fd.get('carrier_id') as string || undefined,
                  delivery_type: fd.get('delivery_type') as string || undefined,
                  is_pack: editIsPack,
                  is_upsell: editIsUpsell,
                  is_abandoned_cart: editIsAbandonedCart,
                  abandoned_cart_recovery_fee: editIsAbandonedCart ? editRecoveryFee : 0,
                });
              }}
              className="p-10 space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar bg-white"
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nom client</label>
                  <Input name="customer_name" defaultValue={editingOrder.customer_name} required className="h-11 rounded-xl bg-slate-50 border-slate-100 text-sm font-bold" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Téléphone 1</label>
                  <Input name="customer_phone" defaultValue={editingOrder.customer_phone} required className="h-11 rounded-xl bg-slate-50 border-slate-100 font-mono text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Téléphone 2</label>
                  <Input name="customer_phone2" defaultValue={editingOrder.customer_phone2 ?? ''} placeholder="Optionnel" className="h-11 rounded-xl bg-slate-50 border-slate-100 font-mono text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Wilaya</label>
                  <select name="customer_wilaya" defaultValue={editingOrder.customer_wilaya ?? undefined} className="w-full h-11 rounded-xl bg-slate-50 border border-slate-100 text-sm font-bold px-3">
                    {WILAYAS.map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Commune</label>
                  <Input name="customer_commune" defaultValue={editingOrder.customer_commune ?? ''} className="h-11 rounded-xl bg-slate-50 border-slate-100 text-sm font-bold" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Type de livraison</label>
                  <select name="delivery_type" defaultValue={editingOrder.delivery_type ?? 'home'} className="w-full h-11 rounded-xl bg-slate-50 border border-slate-100 text-sm font-bold px-3">
                    <option value="home">À domicile</option>
                    <option value="stopdesk">Bureau (Stopdesk)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Transporteur</label>
                  <select name="carrier_id" defaultValue={editingOrder.carrier_id ?? ''} className="w-full h-11 rounded-xl bg-slate-50 border border-slate-100 text-sm font-bold px-3">
                    <option value="">Aucun transporteur</option>
                    {deliveryPartnersQuery.data?.data?.map((partner: any) => (
                      <option key={partner.id} value={partner.id}>
                        {partner.name} ({partner.carrier_id.toUpperCase()})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Frais livraison (DA)</label>
                  <Input name="delivery_fee" type="number" defaultValue={editingOrder.delivery_fee ?? 0} className="h-11 rounded-xl bg-slate-50 border-slate-100 text-sm font-bold" />
                </div>
                <div className="col-span-2 space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Adresse</label>
                  <Input name="customer_address" defaultValue={editingOrder.customer_address ?? ''} className="h-11 rounded-xl bg-slate-50 border-slate-100 text-sm" />
                </div>
                
                <div className="col-span-2 pt-2 border-t border-slate-100">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 block">Propriétés Spéciales</label>
                  <div className="flex flex-wrap gap-4">
                    <div className="flex items-center gap-2">
                       <Checkbox id="editIsPack" checked={editIsPack} onCheckedChange={(c) => setEditIsPack(!!c)} className="size-4" />
                       <label htmlFor="editIsPack" className="text-xs font-bold text-slate-600">Pack Spécial</label>
                    </div>
                    <div className="flex items-center gap-2">
                       <Checkbox id="editIsUpsell" checked={editIsUpsell} onCheckedChange={(c) => setEditIsUpsell(!!c)} className="size-4" />
                       <label htmlFor="editIsUpsell" className="text-xs font-bold text-slate-600">Vente Additionnelle</label>
                    </div>
                    <div className="flex items-center gap-2">
                       <Checkbox id="editIsAbandonedCart" checked={editIsAbandonedCart} onCheckedChange={(c) => setEditIsAbandonedCart(!!c)} className="size-4" />
                       <label htmlFor="editIsAbandonedCart" className="text-xs font-bold text-slate-600">Panier Abandonné</label>
                    </div>
                  </div>
                </div>

                {editIsAbandonedCart && (
                  <div className="col-span-2 space-y-2 bg-amber-50 p-4 rounded-xl border border-amber-100">
                    <label className="text-[10px] font-black uppercase tracking-widest text-amber-700">Commission Agent (DA)</label>
                    <Input type="number" step="1" value={editRecoveryFee} onChange={e => setEditRecoveryFee(Math.round(parseFloat(e.target.value) || 0))} className="h-11 rounded-xl bg-white border-amber-200 text-sm font-bold text-amber-900" />
                  </div>
                )}
                <div className="col-span-2 space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Notes</label>
                  <Textarea name="notes" defaultValue={editingOrder.notes ?? ''} rows={3} className="rounded-xl bg-slate-50 border-slate-100 text-sm resize-none" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditOrderOpen(false)} className="flex-1 h-12 rounded-2xl font-bold text-sm">Annuler</Button>
                <Button type="submit" disabled={editOrderMutation.isPending} className="flex-1 h-12 rounded-2xl text-white font-bold text-sm shadow-lg border-none" style={{ backgroundColor: primaryColor }}>
                  {editOrderMutation.isPending ? <Loader2 className="size-5 animate-spin" /> : 'Enregistrer les modifications'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
