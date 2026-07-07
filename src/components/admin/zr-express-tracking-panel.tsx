'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, RefreshCw, AlertCircle, CheckCircle2, Clock, Zap, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAppStore } from '@/store/app-store';
import { apiFetch } from '@/lib/api-client';

interface Props {
  orderId: string;
  trackingNumber: string | null;
  partnerId: string;                          // DeliveryPartner.id for ZR Express
  onShipped?: (tracking: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  'Livré':                    'text-emerald-700 bg-emerald-50 border-emerald-200',
  'En cours de livraison':    'text-blue-700 bg-blue-50 border-blue-200',
  'Retourné':                 'text-rose-700 bg-rose-50 border-rose-200',
  'Annulé':                   'text-slate-500 bg-slate-100 border-slate-200',
  'En attente':               'text-amber-700 bg-amber-50 border-amber-200',
  'Pris en charge':           'text-purple-700 bg-purple-50 border-purple-200',
  'Au dépôt':                 'text-indigo-700 bg-indigo-50 border-indigo-200',
};

export function ZRExpressTrackingPanel({ orderId, trackingNumber, partnerId, onShipped }: Props) {
  const { activeStore } = useAppStore();
  const qc = useQueryClient();
  const [pushing, setPushing] = useState(false);

  // ── Fetch tracking ────────────────────────────────────────────
  const trackQuery = useQuery({
    queryKey: ['zr-track', orderId, trackingNumber],
    enabled: !!trackingNumber && !!partnerId,
    refetchInterval: 120_000,
    queryFn: async () => {
      const res: any = await apiFetch(
        `/api/v1/delivery-partners/${partnerId}/zr/track/${trackingNumber}`
      );
      return res?.data as {
        carrier: string;
        number: string;
        status: string;
        last_event: string;
        last_location: string;
        estimated_delivery: string | null;
        events: Array<{ date: string; label: string; location: string }>;
      };
    },
  });

  // ── Push order to ZR Express ─────────────────────────────────
  const pushMutation = useMutation({
    mutationFn: async () => {
      const res: any = await apiFetch(
        `/api/v1/delivery-partners/${partnerId}/zr/push-order/${orderId}`,
        { method: 'POST' }
      );
      return res as { tracking_number: string };
    },
    onSuccess: (data) => {
      toast.success(`Colis créé chez ZR Express — Tracking: ${data.tracking_number}`);
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['zr-track', orderId] });
      onShipped?.(data.tracking_number);
    },
    onError: (e: any) => toast.error(e?.message || 'Erreur ZR Express'),
  });

  const statusColor = STATUS_COLORS[trackQuery.data?.status ?? ''] ?? 'text-slate-600 bg-slate-50 border-slate-200';

  // ── No tracking yet — show push button ───────────────────────
  if (!trackingNumber) {
    return (
      <div className="rounded-2xl border border-dashed border-[#6C5CE7]/30 bg-[#6C5CE7]/5 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-[#6C5CE7]/10 flex items-center justify-center">
            <Zap className="size-4 text-[#6C5CE7]" />
          </div>
          <div>
            <p className="text-sm font-black text-slate-800">ZR Express</p>
            <p className="text-[10px] text-slate-400">Colis non encore créé</p>
          </div>
        </div>
        <button
          onClick={() => pushMutation.mutate()}
          disabled={pushMutation.isPending}
          className="w-full h-11 rounded-xl bg-[#6C5CE7] text-white text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-[#5a4bd1] transition-all disabled:opacity-60"
        >
          {pushMutation.isPending ? <RefreshCw className="size-4 animate-spin" /> : <Zap className="size-4" />}
          Envoyer chez ZR Express
        </button>
      </div>
    );
  }

  // ── Has tracking ─────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-xl bg-[#6C5CE7]/10 flex items-center justify-center">
            <Zap className="size-4 text-[#6C5CE7]" />
          </div>
          <div>
            <p className="text-xs font-black text-slate-700">ZR Express</p>
            <p className="text-[10px] font-mono text-slate-400">{trackingNumber}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {trackQuery.data?.status && (
            <span className={cn("px-2.5 py-1 rounded-lg text-[10px] font-black border", statusColor)}>
              {trackQuery.data.status}
            </span>
          )}
          <button
            onClick={() => trackQuery.refetch()}
            disabled={trackQuery.isFetching}
            className="size-8 rounded-xl border border-slate-200 flex items-center justify-center hover:bg-slate-100 transition-all"
          >
            <RefreshCw className={cn("size-3.5 text-slate-400", trackQuery.isFetching && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-5 space-y-4">
        {trackQuery.isLoading && (
          <div className="flex items-center justify-center py-6 gap-2 text-slate-400">
            <RefreshCw className="size-4 animate-spin" />
            <span className="text-xs">Chargement tracking...</span>
          </div>
        )}

        {trackQuery.isError && (
          <div className="flex items-center gap-2 text-rose-500 text-xs">
            <AlertCircle className="size-4 shrink-0" />
            Impossible de récupérer le statut ZR Express.
          </div>
        )}

        {trackQuery.data && (
          <>
            {/* Last event */}
            {trackQuery.data.last_event && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50">
                <Clock className="size-4 text-slate-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-slate-700">{trackQuery.data.last_event}</p>
                  {trackQuery.data.last_location && (
                    <p className="text-[10px] text-slate-400">{trackQuery.data.last_location}</p>
                  )}
                </div>
              </div>
            )}

            {/* Timeline */}
            {trackQuery.data.events.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {trackQuery.data.events.map((ev, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="size-5 rounded-full bg-[#6C5CE7]/10 flex items-center justify-center shrink-0 mt-0.5">
                      {i === 0
                        ? <CheckCircle2 className="size-3 text-[#6C5CE7]" />
                        : <div className="size-1.5 rounded-full bg-slate-300" />
                      }
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-slate-700 leading-tight">{ev.label}</p>
                      {ev.date && <p className="text-[9px] text-slate-400">{new Date(ev.date).toLocaleString('fr-DZ')}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Delivered — success banner */}
            {trackQuery.data.status === 'Livré' && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                <p className="text-xs font-bold text-emerald-700">Colis livré avec succès</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
