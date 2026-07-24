'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { toast } from 'sonner';
import { RefreshCw, Trash2, RotateCcw, AlertTriangle, CheckCircle2, Clock, XCircle, Loader2, Zap, Gauge, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts';

const C = {
   primary: '#6C5CE7', primaryBg: '#F0EDFF',
   success: '#00B894', successBg: '#E6FFF8',
   danger: '#E17055', dangerBg: '#FFEDE9',
   warning: '#FDCB6E', warningBg: '#FFF8E6',
   info: '#0984E3', infoBg: '#E8F4FE',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

interface QueueStats {
  queued: number; processing: number; retry: number; failed: number; skipped: number;
  success_today: number; success_30d: number; failed_30d: number;
  success_rate_30d: number | null; failure_rate_30d: number | null;
  avg_latency_ms: number | null; max_latency_ms: number | null; min_latency_ms: number | null;
  avg_attempts: number | null; queue_size: number; avg_queue_age_seconds: number | null;
  last_success_at: string | null; last_error: string | null; last_error_at: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
}
function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  return `${Math.round(seconds / 3600)}h`;
}

function Tile({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: any; color: string }) {
   return (
      <div className="p-3.5 rounded-2xl border bg-white flex items-center gap-3" style={{ borderColor: color + '33' }}>
         <div className="size-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: color + '18' }}>
            <Icon className="size-4" style={{ color }} />
         </div>
         <div className="min-w-0">
            <p className="text-base font-black tabular-nums leading-none" style={{ color }}>{value}</p>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mt-1 truncate">{label}</p>
         </div>
      </div>
   );
}

interface LpConversionRow {
  lp_id: string; slug: string; label: string;
  clicks: number; impressions: number; meta_purchases: number;
  conversion_rate_pct: number | null;
}

export default function MetaQueueDashboard() {
  const queryClient = useQueryClient();
  const activeStore = useAppStore(s => s.activeStore);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['meta_queue_stats'],
    queryFn: () => apiFetch<{ success: boolean; data: QueueStats }>('/api/v1/meta-ads/queue/stats'),
    refetchOnWindowFocus: false,
  });
  const stats = data?.data;

  // Conversion par landing page — UNIQUEMENT données déclarées par Meta
  // (clics/achats Meta), jamais l'ERP : exclut donc structurellement
  // manuelles, paniers récupérés, doublons fusionnés — voir le docstring
  // du endpoint backend pour le détail.
  const lpConversionQuery = useQuery({
    queryKey: ['meta_conversion_by_lp', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: LpConversionRow[] }>(
      `/api/v1/meta-ads/conversion-by-landing-page?store_id=${activeStore?.id}&date_start=${new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]}&date_end=${new Date().toISOString().split('T')[0]}`
    ),
    enabled: !!activeStore?.id,
    refetchOnWindowFocus: false,
  });
  const lpRows = (lpConversionQuery.data?.data ?? []).filter(r => r.conversion_rate_pct != null);

  const retryAllMutation = useMutation({
    mutationFn: () => apiFetch('/api/v1/meta-ads/queue/retry-all', { method: 'POST' }),
    onSuccess: (res: any) => { toast.success(res?.message || 'Relance effectuée'); queryClient.invalidateQueries({ queryKey: ['meta_queue_stats'] }); },
    onError: (err: any) => toast.error('Erreur', { description: err.message }),
  });
  const cleanupMutation = useMutation({
    mutationFn: () => apiFetch('/api/v1/meta-ads/queue/cleanup', { method: 'POST' }),
    onSuccess: (res: any) => { toast.success(res?.message || 'Nettoyage effectué'); queryClient.invalidateQueries({ queryKey: ['meta_queue_stats'] }); },
    onError: (err: any) => toast.error('Erreur', { description: err.message }),
  });

  const healthy = stats && stats.failed === 0 && (stats.success_rate_30d ?? 100) >= 95;

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      {/* ─── Bandeau de santé — la seule chose qu'un admin doit voir en 1 coup d'œil ─── */}
      <div className="bg-white rounded-2xl border p-5" style={{ borderColor: C.border }}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-2xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: (healthy ? C.success : C.danger) + '18' }}>
              <Zap className="size-5" style={{ color: healthy ? C.success : C.danger }} />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-800">File d'envoi Meta (Purchase)</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {isLoading ? 'Vérification…' : healthy ? 'Tout fonctionne normalement' : `${stats?.failed ?? 0} événement(s) en échec définitif — action requise`}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => queryClient.invalidateQueries({ queryKey: ['meta_queue_stats'] })}
              className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors" style={{ borderColor: C.border }}>
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} /> Actualiser
            </button>
            <button onClick={() => retryAllMutation.mutate()} disabled={retryAllMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white transition-colors disabled:opacity-50" style={{ backgroundColor: C.primary }}>
              <RotateCcw className="h-3.5 w-3.5" /> Relancer tout
            </button>
            <button onClick={() => cleanupMutation.mutate()} disabled={cleanupMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50" style={{ borderColor: C.border }}>
              <Trash2 className="h-3.5 w-3.5" /> Nettoyer
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>
      ) : (
        <>
          {(stats?.failed ?? 0) > 0 && (
            <div className="rounded-2xl border p-4 flex items-start gap-3" style={{ borderColor: C.danger + '40', backgroundColor: C.dangerBg }}>
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: C.danger }} />
              <div className="text-xs">
                <p className="font-black" style={{ color: C.danger }}>{stats?.failed} événement(s) définitivement échoué(s)</p>
                <p className="text-slate-500 mt-0.5">Budget de tentatives épuisé — jeton Meta expiré ou configuration invalide, nécessite une vérification manuelle.</p>
              </div>
            </div>
          )}

          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">File actuelle</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <Tile label="En attente" value={stats?.queued ?? 0} icon={Clock} color={C.info} />
              <Tile label="En cours" value={stats?.processing ?? 0} icon={Loader2} color={C.primary} />
              <Tile label="Nouvelle tentative" value={stats?.retry ?? 0} icon={RotateCcw} color={(stats?.retry ?? 0) > 0 ? C.warning : C.textDim} />
              <Tile label="Échec définitif" value={stats?.failed ?? 0} icon={XCircle} color={(stats?.failed ?? 0) > 0 ? C.danger : C.textDim} />
            </div>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Performance (30 jours)</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <Tile label="Réussis aujourd'hui" value={stats?.success_today ?? 0} icon={CheckCircle2} color={C.success} />
              <Tile label="Réussis (30j)" value={stats?.success_30d ?? 0} icon={CheckCircle2} color={C.success} />
              <Tile label="Taux de réussite" value={stats?.success_rate_30d != null ? `${stats.success_rate_30d}%` : '—'} icon={Gauge} color={(stats?.success_rate_30d ?? 100) >= 95 ? C.success : C.warning} />
              <Tile label="Taux d'échec" value={stats?.failure_rate_30d != null ? `${stats.failure_rate_30d}%` : '—'} icon={Gauge} color={(stats?.failure_rate_30d ?? 0) > 5 ? C.danger : C.textDim} />
            </div>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Vitesse</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <Tile label="Temps moyen" value={stats?.avg_latency_ms ? `${stats.avg_latency_ms}ms` : '—'} icon={Clock} color={C.text} />
              <Tile label="Temps maximal" value={stats?.max_latency_ms ? `${stats.max_latency_ms}ms` : '—'} icon={Clock} color={C.textLight} />
              <Tile label="Tentatives moy." value={stats?.avg_attempts ?? '—'} icon={RotateCcw} color={C.textLight} />
              <Tile label="Âge moyen file" value={formatDuration(stats?.avg_queue_age_seconds ?? null)} icon={Clock} color={(stats?.avg_queue_age_seconds ?? 0) > 900 ? C.warning : C.textDim} />
            </div>
          </div>

          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: C.border }}>
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="size-4" style={{ color: C.primary }} />
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Conversion par landing page — 30 derniers jours</p>
            </div>
            <p className="text-[10px] text-slate-400 mb-4">
              Achats déclarés par Meta ÷ clics déclarés par Meta — jamais l'ERP, donc exclut structurellement les commandes manuelles, les paniers récupérés par téléphone et les doublons fusionnés.
            </p>
            {lpConversionQuery.isLoading ? (
              <div className="h-52 flex items-center justify-center"><Loader2 className="size-6 animate-spin text-slate-300" /></div>
            ) : lpRows.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-xs font-bold text-slate-300">
                Aucune landing page avec clics Meta déclarés sur cette période.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(180, lpRows.length * 42)}>
                <BarChart data={lpRows} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                  <XAxis type="number" unit="%" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 10 }} />
                  <RechartsTooltip
                    formatter={(v: any, _n: any, p: any) => [`${v}%`, `Conversion (${p.payload.meta_purchases} achats / ${p.payload.clicks} clics)`]}
                  />
                  <Bar dataKey="conversion_rate_pct" radius={[0, 6, 6, 0]}>
                    {lpRows.map((r, i) => (
                      <Cell key={r.lp_id} fill={(r.conversion_rate_pct ?? 0) >= 3 ? C.success : (r.conversion_rate_pct ?? 0) >= 1 ? C.warning : C.danger} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-white rounded-2xl border p-4 space-y-2" style={{ borderColor: C.border }}>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400 font-bold">Dernier envoi réussi</span>
              <span className="font-bold text-slate-700">{formatDate(stats?.last_success_at ?? null)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400 font-bold">Dernière erreur</span>
              <span className="font-bold text-slate-700">{formatDate(stats?.last_error_at ?? null)}</span>
            </div>
            {stats?.last_error && (
              <div className="mt-2 rounded-xl bg-slate-50 p-2.5 text-[11px] font-mono break-all text-slate-500">{stats.last_error}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
