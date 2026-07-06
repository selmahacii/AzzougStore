'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Package, UserCheck, Eye, Phone, CheckCircle2, Truck,
  CheckSquare, XCircle, RotateCcw, Clock, AlertTriangle,
  PhoneCall, PhoneMissed, PhoneOff, CalendarClock, Zap,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Actor {
  id: string;
  name: string;
  avatar?: string | null;
  role?: string | null;
}

interface TraceEvent {
  id: string;
  order_id: string;
  actor_id: string | null;
  from_status: string | null;
  to_status: string;
  note: string | null;
  call_result: string | null;
  call_attempt: number | null;
  scheduled_callback_at: string | null;
  created_at: string;
  actor?: Actor | null;
}

// ─── Event config ─────────────────────────────────────────────
const EVENT_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  NEW:          { label: 'Commande créée',       icon: Package,      color: '#3b82f6', bg: '#eff6ff' },
  ASSIGNED:     { label: 'Assignée à un agent',  icon: UserCheck,    color: '#8b5cf6', bg: '#f5f3ff' },
  AGENT_VIEWED: { label: 'Vue par l\'agent',     icon: Eye,          color: '#06b6d4', bg: '#ecfeff' },
  CALLED:       { label: 'Client appelé',        icon: Phone,        color: '#f59e0b', bg: '#fffbeb' },
  CONFIRMED:    { label: 'Commande confirmée',   icon: CheckCircle2, color: '#10b981', bg: '#ecfdf5' },
  SHIPPED:      { label: 'Expédiée',             icon: Truck,        color: '#6366f1', bg: '#eef2ff' },
  DELIVERED:    { label: 'Livrée',               icon: CheckSquare,  color: '#22c55e', bg: '#f0fdf4' },
  RETURNED:     { label: 'Retournée',            icon: RotateCcw,    color: '#ef4444', bg: '#fef2f2' },
  CANCELLED:    { label: 'Annulée',              icon: XCircle,      color: '#6b7280', bg: '#f9fafb' },
  PENDING:      { label: 'En attente',           icon: Clock,        color: '#94a3b8', bg: '#f8fafc' },
};

const CALL_RESULT_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  ANSWERED:     { label: 'Répondu',          icon: PhoneCall,     color: '#10b981' },
  NOT_ANSWERED: { label: 'Pas de réponse',   icon: PhoneMissed,   color: '#f59e0b' },
  BUSY:         { label: 'Occupé',           icon: PhoneOff,      color: '#ef4444' },
  REFUSED:      { label: 'Refusé',           icon: PhoneOff,      color: '#ef4444' },
  POSTPONED:    { label: 'Rappel planifié',  icon: CalendarClock, color: '#8b5cf6' },
};

function EventRow({ event, isLast }: { event: TraceEvent; isLast: boolean }) {
  const cfg = EVENT_CONFIG[event.to_status] ?? EVENT_CONFIG.NEW;
  const Icon = cfg.icon;
  const callCfg = event.call_result ? CALL_RESULT_LABELS[event.call_result] : null;
  const CallIcon = callCfg?.icon;

  const createdAt = new Date(event.created_at);
  const timeAgo = formatDistanceToNow(createdAt, { addSuffix: true, locale: fr });
  const exactTime = format(createdAt, 'dd/MM/yyyy HH:mm:ss', { locale: fr });

  return (
    <div className="flex gap-3">
      {/* Timeline line */}
      <div className="flex flex-col items-center">
        <div className="size-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm" style={{ backgroundColor: cfg.bg }}>
          <Icon className="size-4" style={{ color: cfg.color }} />
        </div>
        {!isLast && <div className="w-0.5 flex-1 mt-1 bg-slate-100 min-h-[20px]" />}
      </div>

      <div className="flex-1 pb-4 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-black text-slate-900">{cfg.label}</p>
            {event.from_status && event.from_status !== event.to_status && (
              <p className="text-[10px] text-slate-400 mt-0.5">
                {EVENT_CONFIG[event.from_status]?.label ?? event.from_status}
                {' → '}
                {cfg.label}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] font-bold text-slate-400" title={exactTime}>{timeAgo}</p>
            <p className="text-[10px] text-slate-300 font-mono">{format(createdAt, 'HH:mm:ss')}</p>
          </div>
        </div>

        {/* Actor */}
        {event.actor && (
          <div className="flex items-center gap-1.5 mt-1">
            {event.actor.avatar
              ? <img src={event.actor.avatar} className="size-5 rounded-full border border-slate-100" />
              : <div className="size-5 rounded-full bg-slate-200 flex items-center justify-center text-[8px] font-black text-slate-500">{event.actor.name[0]}</div>}
            <span className="text-[10px] font-bold text-slate-600">{event.actor.name}</span>
            {event.actor.role && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 font-bold uppercase">{event.actor.role}</span>
            )}
          </div>
        )}

        {/* Call result badge */}
        {callCfg && CallIcon && (
          <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-black"
            style={{ backgroundColor: `${callCfg.color}15`, color: callCfg.color }}>
            <CallIcon className="size-3" /> {callCfg.label}
          </div>
        )}

        {/* Scheduled callback */}
        {event.scheduled_callback_at && (
          <div className="mt-1 flex items-center gap-1 text-[10px] text-purple-600 font-bold">
            <CalendarClock className="size-3" />
            Rappel : {format(new Date(event.scheduled_callback_at), 'dd/MM HH:mm', { locale: fr })}
          </div>
        )}

        {/* Note */}
        {event.note && event.note !== 'Commande consultée par l\'agent' && (
          <div className="mt-1.5 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100 text-xs text-slate-600">
            {event.note}
          </div>
        )}

        {/* Full exact timestamp */}
        <p className="text-[9px] text-slate-300 font-mono mt-1">{exactTime}</p>
      </div>
    </div>
  );
}

// ─── SLA indicators ───────────────────────────────────────────
function SLAPanel({ events }: { events: TraceEvent[] }) {
  const getTimestamp = (status: string) =>
    events.find(e => e.to_status === status)?.created_at ?? null;

  const created = getTimestamp('NEW');
  const assigned = getTimestamp('ASSIGNED');
  const viewed = getTimestamp('AGENT_VIEWED');
  const called = getTimestamp('CALLED');
  const confirmed = getTimestamp('CONFIRMED');
  const shipped = getTimestamp('SHIPPED');

  const diff = (a: string | null, b: string | null) => {
    if (!a || !b) return null;
    const ms = new Date(b).getTime() - new Date(a).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 60) return `${min}m`;
    return `${Math.floor(min / 60)}h${min % 60}m`;
  };

  const slaItems = [
    { label: 'Création → Assignation', value: diff(created, assigned), warn: 30 * 60000, a: created, b: assigned },
    { label: 'Assignation → Vue agent', value: diff(assigned, viewed), warn: 15 * 60000, a: assigned, b: viewed },
    { label: 'Vue → Premier appel',    value: diff(viewed, called),    warn: 20 * 60000, a: viewed, b: called },
    { label: 'Appel → Confirmation',   value: diff(called, confirmed), warn: 60 * 60000, a: called, b: confirmed },
    { label: 'Confirmation → Expédition', value: diff(confirmed, shipped), warn: 24 * 3600000, a: confirmed, b: shipped },
  ].filter(s => s.a && s.b);

  if (!slaItems.length) return null;

  return (
    <div className="mt-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
        <Zap className="size-3" /> Indicateurs SLA
      </p>
      {slaItems.map(item => {
        const ms = item.a && item.b ? new Date(item.b!).getTime() - new Date(item.a!).getTime() : 0;
        const ok = ms <= item.warn;
        return (
          <div key={item.label} className="flex items-center justify-between">
            <span className="text-xs text-slate-500">{item.label}</span>
            <span className={cn(
              'text-xs font-black px-2 py-0.5 rounded-full',
              ok ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            )}>
              {ok ? '✓' : '⚠'} {item.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────
interface OrderTraceabilityPanelProps {
  orderId: string;
}

export function OrderTraceabilityPanel({ orderId }: OrderTraceabilityPanelProps) {
  const eventsQuery = useQuery<{ success: boolean; data: TraceEvent[] }>({
    queryKey: ['order-events', orderId],
    queryFn: () => apiFetch(`/api/v1/orders/${orderId}/events`),
    refetchInterval: 10000,
    enabled: !!orderId,
  });

  const events = eventsQuery.data?.data ?? [];

  if (eventsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2 text-slate-400">
          <div className="size-4 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Chargement de la traçabilité...</span>
        </div>
      </div>
    );
  }

  if (!events.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertTriangle className="size-8 text-slate-300 mb-2" />
        <p className="text-sm text-slate-400 font-bold">Aucun événement enregistré</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-black uppercase tracking-widest text-slate-400">
          Historique complet ({events.length} événements)
        </p>
        <span className="text-[10px] text-slate-400 font-mono">
          Auto-refresh 10s
        </span>
      </div>

      <SLAPanel events={events} />

      <div className="mt-4 space-y-0">
        {events.map((event, i) => (
          <EventRow key={event.id} event={event} isLast={i === events.length - 1} />
        ))}
      </div>
    </div>
  );
}
