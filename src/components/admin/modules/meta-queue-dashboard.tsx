'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { toast } from 'sonner';
import { RefreshCw, Trash2, RotateCcw, AlertTriangle, CheckCircle2, Clock, XCircle, Loader2 } from 'lucide-react';

interface QueueStats {
  queued: number;
  processing: number;
  retry: number;
  failed: number;
  success_today: number;
  success_30d: number;
  avg_latency_ms: number | null;
  avg_attempts: number | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
}

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: any; tone: 'default' | 'warn' | 'danger' | 'ok' }) {
  const toneClasses: Record<string, string> = {
    default: 'border-border bg-card',
    warn: 'border-amber-500/40 bg-amber-500/5',
    danger: 'border-red-500/40 bg-red-500/5',
    ok: 'border-emerald-500/40 bg-emerald-500/5',
  };
  return (
    <div className={`rounded-lg border p-4 ${toneClasses[tone]}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

export default function MetaQueueDashboard() {
  const queryClient = useQueryClient();

  // Admin monitoring page opened occasionally, not embedded in a hot path —
  // no polling interval, manual refresh only, to stay off the Supabase Free
  // traffic the whole rest of this pipeline was rebuilt to minimize.
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['meta_queue_stats'],
    queryFn: () => apiFetch<{ success: boolean; data: QueueStats }>('/api/v1/meta-ads/queue/stats'),
    refetchOnWindowFocus: false,
  });

  const stats = data?.data;

  const retryAllMutation = useMutation({
    mutationFn: () => apiFetch('/api/v1/meta-ads/queue/retry-all', { method: 'POST' }),
    onSuccess: (res: any) => {
      toast.success(res?.message || 'Relance effectuée');
      queryClient.invalidateQueries({ queryKey: ['meta_queue_stats'] });
    },
    onError: (err: any) => toast.error('Erreur', { description: err.message }),
  });

  const cleanupMutation = useMutation({
    mutationFn: () => apiFetch('/api/v1/meta-ads/queue/cleanup', { method: 'POST' }),
    onSuccess: (res: any) => {
      toast.success(res?.message || 'Nettoyage effectué');
      queryClient.invalidateQueries({ queryKey: ['meta_queue_stats'] });
    },
    onError: (err: any) => toast.error('Erreur', { description: err.message }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Meta Queue</h2>
          <p className="text-sm text-muted-foreground">
            File persistante des événements Purchase (PostgreSQL) — aucun événement n'est perdu, même après un redémarrage du conteneur.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['meta_queue_stats'] })}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Actualiser
          </button>
          <button
            onClick={() => retryAllMutation.mutate()}
            disabled={retryAllMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Relancer tout
          </button>
          <button
            onClick={() => cleanupMutation.mutate()}
            disabled={cleanupMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Nettoyer anciens logs
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Queued" value={stats?.queued ?? 0} icon={Clock} tone="default" />
            <StatCard label="Processing" value={stats?.processing ?? 0} icon={Loader2} tone="default" />
            <StatCard label="Retry" value={stats?.retry ?? 0} icon={RotateCcw} tone={stats && stats.retry > 0 ? 'warn' : 'default'} />
            <StatCard label="Failed" value={stats?.failed ?? 0} icon={XCircle} tone={stats && stats.failed > 0 ? 'danger' : 'default'} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Success aujourd'hui" value={stats?.success_today ?? 0} icon={CheckCircle2} tone="ok" />
            <StatCard label="Success 30 jours" value={stats?.success_30d ?? 0} icon={CheckCircle2} tone="ok" />
            <StatCard label="Temps moyen" value={stats?.avg_latency_ms ? `${stats.avg_latency_ms} ms` : '—'} icon={Clock} tone="default" />
            <StatCard label="Tentatives moyennes" value={stats?.avg_attempts ?? '—'} icon={RotateCcw} tone="default" />
          </div>

          {(stats?.failed ?? 0) > 0 && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <div className="font-medium">{stats?.failed} événement(s) définitivement échoué(s)</div>
                <div className="text-muted-foreground">Budget de tentatives épuisé — nécessite une investigation manuelle (jeton expiré, config invalide, etc.)</div>
              </div>
            </div>
          )}

          <div className="rounded-lg border p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dernier envoi réussi</span>
              <span>{formatDate(stats?.last_success_at ?? null)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dernière erreur</span>
              <span>{formatDate(stats?.last_error_at ?? null)}</span>
            </div>
            {stats?.last_error && (
              <div className="mt-2 rounded bg-muted p-2 text-xs font-mono break-all">{stats.last_error}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
