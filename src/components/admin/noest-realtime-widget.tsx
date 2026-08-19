'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, RefreshCw, Package, CheckCircle2, Clock, Activity, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAppStore } from '@/store/app-store';

interface NoestStats {
  success: boolean;
  total_tracked: number;
  shipped: number;
  out_for_delivery: number;
  delivered: number;
  returned: number;
  sync_status: string;
  last_sync: string;
}

export function NoestRealtimeWidget() {
  const queryClient = useQueryClient();
  const { activeStore } = useAppStore();
  const storeId = activeStore?.id;

  const statsQuery = useQuery<NoestStats>({
    queryKey: ['noest-realtime-stats', storeId],
    queryFn: () => fetch(`/api/noest/stats?store_id=${storeId}`).then(r => r.json()),
    enabled: !!storeId,
    refetchInterval: 30_000, // Refresh stats every 30 seconds
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      fetch('/api/noest/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['noest-realtime-stats', storeId] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      toast.success('Synchronisation Noest effectuée en temps réel !');
    },
    onError: () => {
      toast.error('Erreur lors de la synchronisation Noest');
    },
  });

  const stats = statsQuery.data;

  return (
    <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/50 via-slate-50/80 to-white p-5 shadow-sm space-y-4">
      {/* Header Widget */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20 shrink-0">
            <Truck className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black text-slate-800 tracking-tight">Widget Suivi NOEST en Temps Réel</h3>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Synchro Live Active
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium">
              Statut global du suivi automatique et des colis expédiés via Noest Express
            </p>
          </div>
        </div>

        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold shadow-md shadow-blue-500/20 hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-60 cursor-pointer"
        >
          <RefreshCw className={cn('size-3.5', syncMutation.isPending && 'animate-spin')} />
          {syncMutation.isPending ? 'Synchronisation...' : 'Synchro Temps Réel'}
        </button>
      </div>

      {/* Grid des Statistiques */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {/* Total Tracké */}
        <div className="bg-white rounded-xl border border-slate-100 p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider">Commandes Trackées</span>
            <Package className="size-4 text-blue-500" />
          </div>
          <p className="text-xl font-black text-slate-800 tabular-nums">{stats?.total_tracked ?? 0}</p>
          <p className="text-[10px] text-slate-400 mt-0.5 font-medium">N° de suivi actif</p>
        </div>

        {/* En Livraison */}
        <div className="bg-white rounded-xl border border-blue-100 p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-blue-500 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-blue-600">En Livraison</span>
            <Zap className="size-4 text-blue-500 animate-bounce" />
          </div>
          <p className="text-xl font-black text-blue-600 tabular-nums">{stats?.out_for_delivery ?? 0}</p>
          <p className="text-[10px] text-blue-400 mt-0.5 font-bold">Colis sur le terrain</p>
        </div>

        {/* Expédiés */}
        <div className="bg-white rounded-xl border border-slate-100 p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider">En Transit</span>
            <Truck className="size-4 text-amber-500" />
          </div>
          <p className="text-xl font-black text-amber-600 tabular-nums">{stats?.shipped ?? 0}</p>
          <p className="text-[10px] text-slate-400 mt-0.5 font-medium">En route / HUB</p>
        </div>

        {/* Livrées */}
        <div className="bg-white rounded-xl border border-emerald-100 p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-emerald-500 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Livrées (COD)</span>
            <CheckCircle2 className="size-4 text-emerald-500" />
          </div>
          <p className="text-xl font-black text-emerald-600 tabular-nums">{stats?.delivered ?? 0}</p>
          <p className="text-[10px] text-emerald-500/80 mt-0.5 font-bold">Encaissements validés</p>
        </div>

        {/* Retours */}
        <div className="bg-white rounded-xl border border-slate-100 p-3.5 shadow-2xs col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-rose-500">Retours</span>
            <Activity className="size-4 text-rose-500" />
          </div>
          <p className="text-xl font-black text-rose-600 tabular-nums">{stats?.returned ?? 0}</p>
          <p className="text-[10px] text-slate-400 mt-0.5 font-medium">Colis retournés</p>
        </div>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between text-[11px] text-slate-400 border-t border-blue-100/60 pt-2.5">
        <span className="flex items-center gap-1.5 font-medium">
          <Clock className="size-3.5 text-slate-400" />
          Dernière mise à jour automatique : {stats?.last_sync ? new Date(stats.last_sync).toLocaleTimeString('fr-FR') : 'À l\'instant'}
        </span>
        <span className="font-bold text-blue-600">
          Sync automatique : Toutes les 15 min & On-demand
        </span>
      </div>
    </div>
  );
}
