'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, RefreshCw, AlertCircle, Package, MapPin, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAppStore } from '@/store/app-store';

interface TrackingEvent {
  label: string;
  location: string;
  date: string;
  time: string;
  raw_status: string;
}

interface TrackingData {
  tracking: string;
  status: string;
  last_event: string;
  last_location: string;
  events: TrackingEvent[];
  carrier: string;
}

interface Props {
  orderId: string;
  trackingNumber: string | null;
  onShipped?: (tracking: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  DELIVERED:        'text-emerald-700 bg-emerald-50 border-emerald-200',
  IN_TRANSIT:       'text-blue-700 bg-blue-50 border-blue-200',
  OUT_FOR_DELIVERY: 'text-amber-700 bg-amber-50 border-amber-200',
  PICKED_UP:        'text-purple-700 bg-purple-50 border-purple-200',
  RETURNED:         'text-rose-700 bg-rose-50 border-rose-200',
  PENDING:          'text-slate-500 bg-slate-50 border-slate-200',
  FAILED:           'text-rose-700 bg-rose-50 border-rose-200',
};

const STATUS_LABELS: Record<string, string> = {
  DELIVERED: 'Livré', IN_TRANSIT: 'En transit', OUT_FOR_DELIVERY: 'En livraison',
  PICKED_UP: 'Collecté', RETURNED: 'Retourné', PENDING: 'En attente', FAILED: 'Échec',
};

export function YalidineTrackingPanel({ orderId, trackingNumber, onShipped }: Props) {
  const { activeStore } = useAppStore();
  const storeId = activeStore?.id;
  const queryClient = useQueryClient();

  const trackingQuery = useQuery<TrackingData>({
    queryKey: ['yalidine-tracking', trackingNumber, storeId],
    queryFn: () =>
      fetch(`/api/yalidine/track/${trackingNumber}?store_id=${storeId}`)
        .then(async r => {
          const json = await r.json();
          if (!r.ok) throw new Error(json.error ?? 'Erreur API Yalidine');
          return json as TrackingData;
        }),
    enabled: !!trackingNumber && !!storeId,
    refetchInterval: trackingNumber ? 60_000 : false,
  });

  const shipMutation = useMutation({
    mutationFn: () =>
      fetch('/api/yalidine/ship', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      }).then(async r => {
        const json = await r.json();
        if (!r.ok || !json.success) throw new Error(json.message ?? 'Erreur Yalidine');
        return json;
      }),
    onSuccess: (data: any) => {
      toast.success(`Expédié via Yalidine — N° suivi : ${data.tracking}`);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      onShipped?.(data.tracking);
    },
    onError: (e: any) => toast.error(e.message ?? 'Erreur expédition Yalidine'),
  });

  const data = trackingQuery.data;
  const events = data?.events ?? [];
  const statusClass = STATUS_COLORS[data?.status ?? 'PENDING'] ?? STATUS_COLORS.PENDING;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
          <span className="text-base">🚀</span> Suivi Yalidine
        </h3>
        {trackingNumber && (
          <button
            onClick={() => trackingQuery.refetch()}
            disabled={trackingQuery.isFetching}
            className="p-1.5 rounded-lg bg-slate-50 border border-slate-100 text-slate-400 hover:text-[#FF6B35] hover:border-orange-200 transition-all"
            title="Actualiser"
          >
            <RefreshCw className={cn('size-3.5', trackingQuery.isFetching && 'animate-spin')} />
          </button>
        )}
      </div>

      {trackingNumber ? (
        <div className="space-y-3">
          {/* Tracking badge */}
          <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[9px] font-black text-orange-400 uppercase tracking-widest mb-0.5">N° de suivi Yalidine</p>
              <p className="text-sm font-black font-mono text-orange-800">{trackingNumber}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="size-8 rounded-lg bg-orange-100 flex items-center justify-center text-orange-600">
                <Package className="size-4" />
              </div>
              {data?.status && (
                <span className={cn('text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border', statusClass)}>
                  {STATUS_LABELS[data.status] ?? data.status}
                </span>
              )}
            </div>
          </div>

          {/* Error */}
          {trackingQuery.isError && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 rounded-xl border border-rose-100">
              <AlertCircle className="size-4 text-rose-400 shrink-0" />
              <p className="text-xs text-rose-600 font-medium">{(trackingQuery.error as any)?.message}</p>
            </div>
          )}

          {/* Timeline */}
          {trackingQuery.isLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-slate-400">
              <RefreshCw className="size-3.5 animate-spin" /> Chargement du suivi...
            </div>
          ) : events.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400 border-2 border-dashed border-slate-100 rounded-xl">
              <Clock className="size-5 mx-auto mb-2 text-slate-300" />
              Aucun événement disponible pour ce colis.
            </div>
          ) : (
            <div className="relative pl-5 space-y-0">
              <div className="absolute left-[9px] top-3 bottom-3 w-px bg-slate-100" />
              {events.map((ev, i) => {
                const isFirst = i === 0;
                return (
                  <div key={i} className="relative flex gap-3 pb-4">
                    <div className={cn(
                      'absolute -left-5 top-0.5 size-[18px] rounded-full border flex items-center justify-center shrink-0 z-10',
                      isFirst ? 'bg-[#FF6B35] border-orange-300 text-white' : 'bg-slate-100 border-slate-200 text-slate-500'
                    )}>
                      <MapPin className="size-2.5" />
                    </div>
                    <div className={cn('flex-1 rounded-xl border px-3 py-2.5', isFirst ? 'bg-orange-50 border-orange-100' : 'bg-white border-slate-100')}>
                      <p className={cn('text-xs font-bold leading-tight', isFirst ? 'text-orange-800' : 'text-slate-700')}>{ev.label}</p>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {ev.location && (
                          <span className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
                            <MapPin className="size-2.5" />{ev.location}
                          </span>
                        )}
                        {ev.date && (
                          <span className="text-[10px] font-mono text-slate-300">{ev.date} {ev.time}</span>
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
          className="w-full h-11 rounded-xl border text-[11px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 disabled:opacity-60"
          style={{
            backgroundColor: shipMutation.isPending ? '#f1f5f9' : '#FFF3EE',
            borderColor: '#FF6B35',
            color: '#FF6B35',
          }}
          onMouseEnter={e => {
            if (!shipMutation.isPending) {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#FF6B35';
              (e.currentTarget as HTMLButtonElement).style.color = 'white';
            }
          }}
          onMouseLeave={e => {
            if (!shipMutation.isPending) {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#FFF3EE';
              (e.currentTarget as HTMLButtonElement).style.color = '#FF6B35';
            }
          }}
        >
          {shipMutation.isPending ? <RefreshCw className="size-4 animate-spin" /> : <Truck className="size-4" />}
          {shipMutation.isPending ? 'Création en cours...' : 'Expédier via Yalidine'}
        </button>
      )}
    </div>
  );
}
