'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { toast } from 'sonner';
import { useAppStore } from '@/store/app-store';
import { RefreshCw, Activity, AlertTriangle, CheckCircle2, Clock, Database, Zap, ShieldAlert, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';

const C = {
   primary: '#6C5CE7', primaryBg: '#F0EDFF',
   success: '#00B894', successBg: '#E6FFF8',
   danger: '#E17055', dangerBg: '#FFEDE9',
   warning: '#FDCB6E', warningBg: '#FFF8E6',
   info: '#0984E3', infoBg: '#E8F4FE',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

// Thresholds that raise a visible alert — not silent, not blocking.
const THRESHOLDS = {
   flushSuccessRateMin: 90,      // %
   counterLagMaxMinutes: 30,     // minutes since last successful flush
   failuresTotalWarn: 20,        // cumulative Redis failures this process
   compressionRatioMax: 80,      // % — if rows ≈ events, the rollup isn't compressing (traffic too low or a bug)
};

function Tile({ label, value, icon: Icon, color, alert }: { label: string; value: string | number; icon: any; color: string; alert?: boolean }) {
   return (
      <div className={cn("p-3.5 rounded-2xl border bg-white flex items-center gap-3", alert && "ring-2 ring-rose-200")} style={{ borderColor: (alert ? C.danger : color) + '33' }}>
         <div className="size-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: (alert ? C.danger : color) + '18' }}>
            <Icon className="size-4" style={{ color: alert ? C.danger : color }} />
         </div>
         <div className="min-w-0">
            <p className="text-base font-black tabular-nums leading-none" style={{ color: alert ? C.danger : color }}>{value}</p>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mt-1 truncate">{label}</p>
         </div>
      </div>
   );
}

export default function FunnelTrackingDashboard() {
   const activeStore = useAppStore(s => s.activeStore);
   const qc = useQueryClient();

   const { data, isLoading, isFetching } = useQuery({
      queryKey: ['funnel_diagnostics'],
      queryFn: () => apiFetch<{ success: boolean; data: any }>('/api/v1/meta-ads/funnel/diagnostics'),
      refetchInterval: 60000,
      refetchOnWindowFocus: false,
   });
   const d = data?.data;

   const { data: bottlenecksData, isLoading: loadingBottlenecks } = useQuery({
      queryKey: ['funnel_bottlenecks', activeStore?.id],
      queryFn: () => apiFetch<{ success: boolean; data: any }>(`/api/v1/meta-ads/funnel/bottlenecks?store_id=${activeStore?.id}&days=7`),
      enabled: !!activeStore?.id,
      refetchOnWindowFocus: false,
   });
   const bottlenecks = bottlenecksData?.data;

   const toggleMutation = useMutation({
      mutationFn: (disabled: boolean) => apiFetch('/api/v1/meta-ads/funnel/toggle', { method: 'POST', body: JSON.stringify({ disabled }) }),
      onSuccess: (res: any) => {
         toast.success(res?.status?.active ? 'Suivi du funnel réactivé' : 'Suivi du funnel désactivé (kill switch instantané)');
         qc.invalidateQueries({ queryKey: ['funnel_diagnostics'] });
      },
      onError: (err: any) => toast.error('Erreur', { description: err.message }),
   });

   if (isLoading) return <div className="p-10 flex justify-center"><RefreshCw className="size-6 animate-spin text-slate-300" /></div>;
   if (!d) return null;

   const status = d.status || {};
   const alerts: string[] = [];
   if (d.flush?.success_rate_pct != null && d.flush.success_rate_pct < THRESHOLDS.flushSuccessRateMin) {
      alerts.push(`Taux de succès du flush à ${d.flush.success_rate_pct}% (seuil: ${THRESHOLDS.flushSuccessRateMin}%)`);
   }
   if (d.counter_lag_minutes != null && d.counter_lag_minutes > THRESHOLDS.counterLagMaxMinutes) {
      alerts.push(`Dernier flush il y a ${d.counter_lag_minutes} min (seuil: ${THRESHOLDS.counterLagMaxMinutes} min)`);
   }
   if (d.failures_total > THRESHOLDS.failuresTotalWarn) {
      alerts.push(`${d.failures_total} échecs Redis cumulés (seuil: ${THRESHOLDS.failuresTotalWarn})`);
   }
   if (!status.active) {
      alerts.push(
         !status.flag_enabled ? 'Suivi désactivé (variable d\'environnement)'
         : status.killswitch_engaged ? 'Suivi désactivé (kill switch manuel engagé)'
         : status.circuit_open ? `Coupe-circuit ouvert après ${status.circuit_consecutive_failures} échecs Redis consécutifs — reprise automatique sous peu`
         : 'Suivi inactif'
      );
   }

   return (
      <div className="space-y-5 animate-in fade-in duration-500">
         {/* Health banner */}
         <div className="bg-white rounded-2xl border p-5" style={{ borderColor: C.border }}>
            <div className="flex items-center justify-between flex-wrap gap-3">
               <div className="flex items-center gap-3">
                  <div className="size-11 rounded-2xl flex items-center justify-center shrink-0"
                     style={{ backgroundColor: (status.active ? C.success : C.danger) + '18' }}>
                     <Activity className="size-5" style={{ color: status.active ? C.success : C.danger }} />
                  </div>
                  <div>
                     <h2 className="text-base font-black text-slate-800">Suivi du Funnel (PageView → InitiateCheckout)</h2>
                     <p className="text-xs text-slate-400 mt-0.5">
                        {status.active ? 'Actif — compteurs Redis en cours de collecte' : 'Inactif — voir les alertes ci-dessous'}
                     </p>
                  </div>
               </div>
               <div className="flex gap-2">
                  <button onClick={() => qc.invalidateQueries({ queryKey: ['funnel_diagnostics'] })}
                     className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors" style={{ borderColor: C.border }}>
                     <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} /> Actualiser
                  </button>
                  <button
                     onClick={() => toggleMutation.mutate(!status.killswitch_engaged)}
                     disabled={toggleMutation.isPending}
                     className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white transition-colors disabled:opacity-50"
                     style={{ backgroundColor: status.killswitch_engaged ? C.success : C.danger }}>
                     <ShieldAlert className="h-3.5 w-3.5" /> {status.killswitch_engaged ? 'Réactiver' : 'Kill switch'}
                  </button>
               </div>
            </div>

            {alerts.length > 0 && (
               <div className="mt-4 rounded-2xl border p-4 flex items-start gap-3" style={{ borderColor: C.danger + '40', backgroundColor: C.dangerBg }}>
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: C.danger }} />
                  <div className="text-xs space-y-1">
                     {alerts.map((a, i) => <p key={i} className="font-bold" style={{ color: C.danger }}>{a}</p>)}
                  </div>
               </div>
            )}
         </div>

         {/* Metrics grid */}
         <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <Tile label="Commandes Redis/min" value={d.commands_per_min ?? '—'} icon={Zap} color={C.primary} />
            <Tile label="Estimation mensuelle" value={d.estimated_monthly_commands?.toLocaleString('fr-FR') ?? '—'} icon={Database} color={C.info} />
            <Tile label="Échecs Redis (cumul)" value={d.failures_total ?? 0} icon={AlertTriangle} color={C.warning} alert={d.failures_total > THRESHOLDS.failuresTotalWarn} />
            <Tile label="File en attente" value={d.queue_length_pending_keys ?? '—'} icon={Clock} color={C.textDim} />
            <Tile label="Durée dernier flush" value={d.flush?.last_duration_ms != null ? `${d.flush.last_duration_ms}ms` : '—'} icon={Zap} color={C.success} />
            <Tile label="Taux succès flush" value={d.flush?.success_rate_pct != null ? `${d.flush.success_rate_pct}%` : '—'} icon={CheckCircle2} color={C.success}
               alert={d.flush?.success_rate_pct != null && d.flush.success_rate_pct < THRESHOLDS.flushSuccessRateMin} />
            <Tile label="Décalage compteur" value={d.counter_lag_minutes != null ? `${d.counter_lag_minutes} min` : '—'} icon={Clock} color={C.info}
               alert={d.counter_lag_minutes != null && d.counter_lag_minutes > THRESHOLDS.counterLagMaxMinutes} />
            <Tile label="Taux de compression" value={d.compression_ratio_pct != null ? `${d.compression_ratio_pct}%` : '—'} icon={Gauge} color={C.primary} />
            <Tile label="Écritures Postgres (dernier flush)" value={d.flush?.last_buckets_written ?? 0} icon={Database} color={C.text} />
            <Tile label="Événements drainés (dernier flush)" value={d.flush?.last_events_drained ?? 0} icon={Activity} color={C.text} />
            <Tile label="Latence requête dashboard" value={d.dashboard_query_ms != null ? `${d.dashboard_query_ms}ms` : '—'} icon={Gauge} color={C.success} />
            <Tile label="Lignes table rollup" value={d.rollup_table_rows ?? 0} icon={Database} color={C.textDim} />
         </div>

         {/* Bottleneck report */}
         <div className="bg-white rounded-2xl border p-5" style={{ borderColor: C.border }}>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Goulots d'étranglement — 7 derniers jours</p>
            {loadingBottlenecks ? (
               <div className="p-10 flex justify-center"><RefreshCw className="size-5 animate-spin text-slate-300" /></div>
            ) : (
               ['by_landing_page', 'by_product', 'by_campaign'].map(key => {
                  const rows = bottlenecks?.[key] || [];
                  const label = key === 'by_landing_page' ? 'Landing Pages' : key === 'by_product' ? 'Produits' : 'Campagnes';
                  return (
                     <div key={key} className="mb-5 last:mb-0">
                        <p className="text-xs font-bold text-slate-600 mb-2">{label}</p>
                        {rows.length === 0 ? (
                           <p className="text-xs text-slate-300">Aucune donnée sur cette période.</p>
                        ) : (
                           <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                 <thead><tr className="text-left text-slate-400 border-b" style={{ borderColor: C.border }}>
                                    <th className="pb-2 pr-3">ID</th><th className="pb-2 pr-3 text-right">PageView</th>
                                    <th className="pb-2 pr-3 text-right">ViewContent</th><th className="pb-2 pr-3 text-right">AddToCart</th>
                                    <th className="pb-2 pr-3 text-right">InitiateCheckout</th><th className="pb-2">Goulot</th>
                                 </tr></thead>
                                 <tbody className="divide-y" style={{ borderColor: C.border }}>
                                    {rows.slice(0, 10).map((r: any) => (
                                       <tr key={r.id}>
                                          <td className="py-2 pr-3 font-mono">{String(r.id).slice(0, 8)}</td>
                                          <td className="py-2 pr-3 text-right tabular-nums">{r.pageviews}</td>
                                          <td className="py-2 pr-3 text-right tabular-nums">{r.view_content}</td>
                                          <td className="py-2 pr-3 text-right tabular-nums">{r.add_to_cart}</td>
                                          <td className="py-2 pr-3 text-right tabular-nums">{r.initiate_checkout}</td>
                                          <td className="py-2">
                                             {r.bottleneck_stage ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: C.dangerBg, color: C.danger }}>
                                                   {r.bottleneck_stage} (-{r.bottleneck_drop_pct}%)
                                                </span>
                                             ) : '—'}
                                          </td>
                                       </tr>
                                    ))}
                                 </tbody>
                              </table>
                           </div>
                        )}
                     </div>
                  );
               })
            )}
         </div>
      </div>
   );
}
