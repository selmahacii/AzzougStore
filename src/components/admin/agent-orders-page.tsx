'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Phone, CheckCircle2, Truck, Package, Clock, AlertCircle,
  ChevronDown, MessageSquare, X, Bell, BellRing, Loader2,
  PhoneCall, PhoneMissed, PhoneOff, CalendarClock, User as UserIcon,
  MapPin, Hash, RotateCcw, Eye, ClipboardList, Zap,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { apiFetch } from '@/lib/api-client';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import type { Order, OrderEvent } from '@/lib/types';

// ─── Status config ───────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  NEW:       { label: 'Nouveau',    color: '#3b82f6', bg: '#eff6ff', icon: Package },
  ASSIGNED:  { label: 'Assignée',   color: '#8b5cf6', bg: '#f5f3ff', icon: UserIcon },
  AGENT_VIEWED: { label: 'Vue',     color: '#06b6d4', bg: '#ecfeff', icon: Eye },
  CALLED:    { label: 'Appelée',    color: '#f59e0b', bg: '#fffbeb', icon: PhoneCall },
  CONFIRMED: { label: 'Confirmée',  color: '#10b981', bg: '#ecfdf5', icon: CheckCircle2 },
  SHIPPED:   { label: 'Expédiée',   color: '#6366f1', bg: '#eef2ff', icon: Truck },
  DELIVERED: { label: 'Livrée',     color: '#22c55e', bg: '#f0fdf4', icon: CheckCircle2 },
  RETURNED:  { label: 'Retournée',  color: '#ef4444', bg: '#fef2f2', icon: RotateCcw },
  CANCELLED: { label: 'Annulée',    color: '#6b7280', bg: '#f9fafb', icon: X },
};

const CALL_RESULTS = [
  { value: 'ANSWERED',     label: 'Répondu',        icon: PhoneCall,  color: '#10b981' },
  { value: 'NOT_ANSWERED', label: 'Pas de réponse', icon: PhoneMissed, color: '#f59e0b' },
  { value: 'BUSY',         label: 'Occupé',          icon: PhoneOff,   color: '#ef4444' },
  { value: 'REFUSED',      label: 'Refusé',          icon: PhoneOff,   color: '#ef4444' },
  { value: 'POSTPONED',    label: 'Rappel planifié', icon: CalendarClock, color: '#8b5cf6' },
];

// ─── Order Card ──────────────────────────────────────────────
function OrderCard({ order, onAction, actionLoading }: {
  order: Order;
  onAction: (orderId: string, action: string, payload?: any) => void;
  actionLoading: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [callPanelOpen, setCallPanelOpen] = useState(false);
  const [callResult, setCallResult] = useState('');
  const [callNote, setCallNote] = useState('');
  const [callbackAt, setCallbackAt] = useState('');
  const [confirmNote, setConfirmNote] = useState('');
  const [confirmPanel, setConfirmPanel] = useState(false);

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
            <span className="text-xs font-black text-slate-400 font-mono">#{order.order_number}</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: cfg.bg, color: cfg.color }}>
              {cfg.label}
            </span>
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
            <span className="font-black text-slate-800">{formatPrice(order.total)} DA</span>
            {order.items.length > 0 && (
              <><span className="text-slate-200">·</span>
              <span>{order.items.length} art.</span></>
            )}
          </div>
        </div>

        <button onClick={() => setExpanded(e => !e)} className="text-slate-300 hover:text-slate-600 transition-colors mt-1">
          <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      {/* ── Items ── */}
      {expanded && (
        <div className="px-4 pb-3 border-t border-slate-50 pt-3 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Articles commandés</p>
          {order.items.map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              {item.image_url
                ? <img src={item.image_url} className="size-8 rounded-lg object-cover border border-slate-100" />
                : <div className="size-8 rounded-lg bg-slate-100 flex items-center justify-center"><Package className="size-4 text-slate-400" /></div>}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800 truncate text-xs">{item.product_name}</p>
                {item.variant_details && <p className="text-[10px] text-slate-400">{JSON.stringify(item.variant_details)}</p>}
              </div>
              <span className="text-xs font-bold text-slate-500 shrink-0">×{item.quantity}</span>
              <span className="text-xs font-black text-slate-900 shrink-0">{formatPrice(item.unit_price * item.quantity)} DA</span>
            </div>
          ))}
          <div className="flex justify-between pt-2 border-t border-slate-100 text-sm">
            <span className="text-slate-500">Livraison</span>
            <span className="font-bold">{formatPrice(order.delivery_fee)} DA</span>
          </div>
          <div className="flex justify-between text-base font-black">
            <span>Total</span>
            <span className="text-emerald-600">{formatPrice(order.total)} DA</span>
          </div>
          {order.notes && (
            <div className="mt-2 p-2 bg-amber-50 rounded-lg border border-amber-100 text-xs text-amber-700">
              <MessageSquare className="size-3 inline mr-1" />{order.notes}
            </div>
          )}
        </div>
      )}

      {/* ── Actions ── */}
      <div className="px-4 pb-4 flex flex-wrap gap-2">
        {/* APPELER */}
        {(isNew || isCalled) && !callPanelOpen && (
          <button
            onClick={() => setCallPanelOpen(true)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-white transition-all hover:brightness-110 active:scale-[0.98]"
            style={{ backgroundColor: '#3b82f6' }}
          >
            <Phone className="size-4" /> Appeler
          </button>
        )}

        {/* CONFIRMER */}
        {isCalled && !confirmPanel && (
          <button
            onClick={() => setConfirmPanel(true)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] transition-all"
          >
            <CheckCircle2 className="size-4" /> Confirmer
          </button>
        )}

        {/* EXPÉDIER */}
        {isConfirmed && (
          <button
            onClick={() => onAction(order.id, 'SHIP', {})}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-indigo-500 hover:bg-indigo-600 active:scale-[0.98] transition-all disabled:opacity-60"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
            Expédier
          </button>
        )}
      </div>

      {/* ── Call Panel ── */}
      {callPanelOpen && (
        <div className="mx-4 mb-4 p-4 bg-blue-50 rounded-2xl border border-blue-100 space-y-3">
          <p className="text-xs font-black uppercase tracking-widest text-blue-700">Résultat de l'appel</p>
          <div className="grid grid-cols-2 gap-2">
            {CALL_RESULTS.map(r => (
              <button
                key={r.value}
                onClick={() => setCallResult(r.value)}
                className={cn(
                  'flex items-center gap-2 p-2.5 rounded-xl border-2 text-xs font-bold transition-all',
                  callResult === r.value ? 'border-current text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                )}
                style={callResult === r.value ? { backgroundColor: r.color, borderColor: r.color } : {}}
              >
                <r.icon className="size-3.5 shrink-0" /> {r.label}
              </button>
            ))}
          </div>
          <Textarea
            placeholder="Note (optionnelle)..."
            value={callNote}
            onChange={e => setCallNote(e.target.value)}
            className="min-h-[60px] text-sm resize-none border-blue-200 bg-white rounded-xl"
          />
          {callResult === 'POSTPONED' && (
            <div>
              <p className="text-[10px] font-bold text-blue-600 mb-1">Date de rappel</p>
              <Input type="datetime-local" value={callbackAt} onChange={e => setCallbackAt(e.target.value)}
                className="h-9 text-sm border-blue-200 rounded-xl" />
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setCallPanelOpen(false)} className="flex-1 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50">
              Annuler
            </button>
            <button
              disabled={!callResult || loading}
              onClick={() => {
                onAction(order.id, 'CALL', { call_result: callResult, note: callNote, scheduled_callback_at: callbackAt || undefined });
                setCallPanelOpen(false);
                setCallResult('');
                setCallNote('');
                setCallbackAt('');
              }}
              className="flex-1 py-2 rounded-xl text-xs font-black text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="size-3 animate-spin inline" /> : 'Enregistrer'}
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
  const [filter, setFilter] = useState<'active' | 'done'>('active');
  const prevCountRef = useRef(0);
  const [hasNew, setHasNew] = useState(false);

  const ordersQuery = useQuery<any>({
    queryKey: ['agent-orders', storeId, user?.id],
    queryFn: () => apiFetch(`/api/v1/orders?store_id=${storeId}&pageSize=100`),
    refetchInterval: 15000,
    enabled: !!storeId,
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

  const activeOrders = orders.filter(o => !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(o.status));
  const doneOrders = orders.filter(o => ['DELIVERED', 'CANCELLED', 'RETURNED'].includes(o.status));
  const displayOrders = filter === 'active' ? activeOrders : doneOrders;

  const newCount = orders.filter(o => o.status === 'NEW' || o.status === 'ASSIGNED').length;
  const confirmedToday = orders.filter(o => {
    if (o.status !== 'CONFIRMED' && o.status !== 'SHIPPED' && o.status !== 'DELIVERED') return false;
    const today = new Date().toDateString();
    return new Date(o.updated_at).toDateString() === today;
  }).length;

  const handleAction = useCallback(async (orderId: string, action: string, payload: any) => {
    setActionLoading(orderId);
    try {
      let to_status = '';
      let eventPayload: any = {};

      if (action === 'CALL') {
        to_status = 'CALLED';
        eventPayload = { to_status, call_result: payload.call_result, note: payload.note, scheduled_callback_at: payload.scheduled_callback_at };
        if (payload.call_result === 'POSTPONED') {
          to_status = 'CALLED'; // stays in CALLED, scheduled callback noted
        }
      } else if (action === 'CONFIRM') {
        to_status = 'CONFIRMED';
        eventPayload = { to_status, note: payload.note };
      } else if (action === 'SHIP') {
        to_status = 'SHIPPED';
        eventPayload = { to_status };
      }

      // Post event (which also updates order status)
      await apiFetch(`/api/v1/orders/${orderId}/events`, {
        method: 'POST',
        body: JSON.stringify(eventPayload),
      });

      qc.invalidateQueries({ queryKey: ['agent-orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });

      const msg = action === 'CALL' ? 'Résultat de l\'appel enregistré'
        : action === 'CONFIRM' ? '✓ Commande confirmée !'
        : '📦 Commande marquée expédiée';
      toast.success(msg);
    } catch (err: any) {
      toast.error(err.message || 'Erreur');
    } finally {
      setActionLoading(null);
    }
  }, [qc]);

  // KPI bar colors
  const primaryColor = activeStore?.theme_config?.primaryColor || '#6C5CE7';

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
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
      <div className="flex gap-0 px-6 pt-3 shrink-0">
        {([['active', 'En cours', activeOrders.length], ['done', 'Terminées', doneOrders.length]] as const).map(([val, lbl, cnt]) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-black rounded-t-xl border-b-2 transition-all',
              filter === val ? 'text-slate-900 border-current' : 'text-slate-400 border-transparent hover:text-slate-600'
            )}
            style={filter === val ? { borderColor: primaryColor, color: primaryColor } : {}}
          >
            {lbl}
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-black" style={filter === val ? { backgroundColor: primaryColor, color: '#fff' } : { backgroundColor: '#f1f5f9', color: '#94a3b8' }}>
              {cnt}
            </span>
          </button>
        ))}
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
              {filter === 'active' ? 'Aucune commande en cours' : 'Aucune commande terminée'}
            </p>
            <p className="text-xs text-slate-300 mt-1">Les nouvelles commandes apparaîtront ici automatiquement</p>
          </div>
        )}

        {displayOrders.map(order => (
          <OrderCard key={order.id} order={order} onAction={handleAction} actionLoading={actionLoading} />
        ))}
      </div>
    </div>
  );
}
