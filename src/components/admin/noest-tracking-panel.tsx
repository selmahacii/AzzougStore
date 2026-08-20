'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, RefreshCw, Download, CheckCircle2, Clock, AlertTriangle, XCircle, Package, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';

interface NoestEvent {
  id: string;
  eventKey: string;
  eventLabel: string;
  causer: string | null;
  eventDate: string | null;
  createdAt: string;
}

interface Props {
  orderId: string;
  trackingNumber: string | null;
  onShipped?: (tracking: string) => void;
}

const EVENT_ICON: Record<string, React.ElementType> = {
  livre: CheckCircle2,
  livred: CheckCircle2,
  fdr_activated: Truck,
  return_dispatched_to_partenaire: XCircle,
  retour_dispatched_to_partenaires: XCircle,
  livraison_echoue_recu: AlertTriangle,
  return_validated_by_partener: XCircle,
};

const EVENT_COLOR: Record<string, string> = {
  livre: 'bg-emerald-100 text-emerald-600 border-emerald-200',
  livred: 'bg-emerald-100 text-emerald-600 border-emerald-200',
  fdr_activated: 'bg-blue-100 text-blue-600 border-blue-200',
  return_dispatched_to_partenaire: 'bg-rose-100 text-rose-600 border-rose-200',
  retour_dispatched_to_partenaires: 'bg-rose-100 text-rose-600 border-rose-200',
  livraison_echoue_recu: 'bg-amber-100 text-amber-600 border-amber-200',
  return_validated_by_partener: 'bg-rose-100 text-rose-600 border-rose-200',
};

function EventIcon({ eventKey }: { eventKey: string }) {
  const Icon = EVENT_ICON[eventKey] ?? MapPin;
  return <Icon className="size-3.5" />;
}

export function NoestTrackingPanel({ orderId, trackingNumber, onShipped }: Props) {
  const queryClient = useQueryClient();
  const { activeStore } = useAppStore();
  const storeId = activeStore?.id;

  const eventsQuery = useQuery<any>({
    queryKey: ['noest-events', trackingNumber, storeId],
    queryFn: () => apiFetch<any>(`/api/v1/noest/track/${trackingNumber}${storeId ? `?store_id=${storeId}` : ''}`),
    enabled: !!trackingNumber,
    refetchInterval: trackingNumber ? 60_000 : false,
    refetchIntervalInBackground: false,
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ success: boolean; message?: string }>(`/api/v1/noest/sync${storeId ? `?store_id=${storeId}` : ''}`, {
        method: 'POST',
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['noest-events', trackingNumber] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['noest-realtime-stats'] });
      toast.success(data?.message || 'Suivi synchronisé');
    },
  });

  const shipMutation = useMutation({
    mutationFn: () => apiFetch<any>(`/api/v1/orders/${orderId}/dispatch`, { method: 'POST' }),
    onSuccess: (data: any) => {
      const trk = data.tracking_number || data.tracking;
      if (data.success || trk) {
        toast.success(`Expédié ! N° de suivi : ${trk || 'Créé'}`);
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        onShipped?.(trk);
        setTimeout(() => syncMutation.mutate(), 1500);
      } else {
        toast.error(data.detail || data.message || 'Erreur NOEST');
      }
    },
    onError: (err: any) => {
      toast.error(err.detail || err.message || 'Erreur lors de l\'expédition chez le transporteur');
    }
  });

  const trackingData = eventsQuery.data;
  const rawActivity: any[] = trackingData?.activity ?? trackingData?.events ?? [];
  const events = rawActivity.map((ev: any, idx: number) => ({
    id: ev.id || String(idx),
    eventKey: ev.event_key || ev.eventKey || ev.event || 'update',
    eventLabel: ev.event || ev.eventLabel || ev.status || 'Mise à jour transporteur',
    causer: ev.causer || null,
    eventDate: ev.date || ev.eventDate || ev.created_at || null,
    createdAt: ev.date || ev.created_at || '',
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
          <Truck className="size-3.5" /> Suivi NOEST
        </h3>
        <div className="flex items-center gap-2">
          {trackingNumber && (
            <>
              <button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="p-1.5 rounded-lg bg-slate-50 border border-slate-100 text-slate-400 hover:text-blue-600 hover:border-blue-200 transition-all"
                title="Synchroniser"
              >
                <RefreshCw className={cn('size-3.5', syncMutation.isPending && 'animate-spin')} />
              </button>
              <a
                href={`/api/noest/label?tracking=${trackingNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-lg bg-slate-50 border border-slate-100 text-slate-400 hover:text-emerald-600 hover:border-emerald-200 transition-all"
                title="Télécharger bordereau"
              >
                <Download className="size-3.5" />
              </a>
            </>
          )}
        </div>
      </div>

      {trackingNumber ? (
        <div className="space-y-3">
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-0.5">N° de suivi</p>
              <p className="text-sm font-black font-mono text-blue-800">{trackingNumber}</p>
            </div>
            <div className="size-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
              <Package className="size-4" />
            </div>
          </div>

          {/* Timeline */}
          {eventsQuery.isLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-slate-400">
              <RefreshCw className="size-3.5 animate-spin" /> Chargement du suivi...
            </div>
          ) : events.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400 border-2 border-dashed border-slate-100 rounded-xl">
              <Clock className="size-5 mx-auto mb-2 text-slate-300" />
              Aucun événement de suivi enregistré.
              <br />
              <button
                onClick={() => syncMutation.mutate()}
                className="mt-2 text-blue-500 font-bold hover:underline"
              >
                Synchroniser maintenant
              </button>
            </div>
          ) : (
            <div className="relative pl-5 space-y-0">
              {/* Vertical line */}
              <div className="absolute left-[9px] top-3 bottom-3 w-px bg-slate-100" />
              {events.map((ev, i) => {
                const colorClass = EVENT_COLOR[ev.eventKey] ?? 'bg-slate-100 text-slate-500 border-slate-200';
                const isLast = i === events.length - 1;
                return (
                  <div key={ev.id} className="relative flex gap-3 pb-4">
                    {/* Dot */}
                    <div className={cn('absolute -left-5 top-0.5 size-[18px] rounded-full border flex items-center justify-center shrink-0 z-10', colorClass)}>
                      <EventIcon eventKey={ev.eventKey} />
                    </div>
                    <div className={cn('flex-1 rounded-xl border px-3 py-2.5', isLast ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-100')}>
                      <p className="text-xs font-bold text-slate-800 leading-tight">{ev.eventLabel}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {ev.causer && (
                          <span className="text-[10px] font-medium text-slate-400">{ev.causer}</span>
                        )}
                        {ev.eventDate && (
                          <span className="text-[10px] font-mono text-slate-300">{ev.eventDate}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => shipMutation.mutate()}
          disabled={shipMutation.isPending}
          className="w-full h-11 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 text-[11px] font-black uppercase tracking-wider hover:bg-emerald-500 hover:text-white transition-all flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {shipMutation.isPending ? (
            <RefreshCw className="size-4 animate-spin" />
          ) : (
            <Truck className="size-4" />
          )}
          {shipMutation.isPending ? 'Création en cours...' : 'Expédier via NOEST'}
        </button>
      )}
    </div>
  );
}
