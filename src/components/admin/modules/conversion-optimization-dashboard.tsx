'use client';

import React, { useState } from 'react';
import {
  Target, TrendingUp, TrendingDown, AlertTriangle, Filter, RefreshCw,
  ArrowUpRight, ArrowDownRight, Sparkles, Package, Megaphone, Award,
  ChevronRight, Info, Activity, Gauge
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
} from 'recharts';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import MetaQueueDashboard from './meta-queue-dashboard';
import FunnelTrackingDashboard from './funnel-tracking-dashboard';

const C = {
  primary: '#6C5CE7', primaryBg: '#F0EDFF',
  success: '#00B894', successBg: '#E6FFF8',
  danger: '#E17055', dangerBg: '#FFEDE9',
  warning: '#FDCB6E', warningBg: '#FFF8E6',
  info: '#0984E3', infoBg: '#E8F4FE',
  text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

function StatCard({ label, value, sub, color, trend }: { label: string; value: React.ReactNode; sub?: string; color?: string; trend?: number | null }) {
  const c = color || C.text;
  return (
    <div className="rounded-2xl border bg-white p-4 w-full" style={{ borderColor: c + '33' }}>
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <div className="flex items-end justify-between mt-1.5">
        <p className="text-2xl font-black tabular-nums" style={{ color: c }}>{value}</p>
        {trend != null && (
          <span className={cn("flex items-center gap-0.5 text-xs font-black", trend >= 0 ? "text-emerald-500" : "text-rose-500")}>
            {trend >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    high: { bg: '#FFEDE9', text: '#C0392B', label: 'Critique' },
    medium: { bg: '#FFF8E6', text: '#B7791F', label: 'Moyen' },
    low: { bg: '#E8F4FE', text: '#0984E3', label: 'Faible' },
  };
  const s = map[severity] || map.low;
  return <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ backgroundColor: s.bg, color: s.text }}>{s.label}</span>;
}

function Stars({ count, max = 5, color }: { count: number; max?: number; color: string }) {
  return (
    <span className="tracking-tight" style={{ color }} aria-hidden="true">
      {'★'.repeat(Math.max(0, Math.min(max, count)))}
      <span className="text-slate-200">{'★'.repeat(max - Math.max(0, Math.min(max, count)))}</span>
    </span>
  );
}

const TABS = [
  { id: 'global', label: "Vue Globale & Opportunités" },
  { id: 'funnel_bottlenecks', label: 'Entonnoir & Freins' },
  { id: 'performances', label: 'Performances' },
  { id: 'health', label: 'Santé Technique & Tracking' },
] as const;

export default function ConversionOptimizationDashboard() {
  const activeStore = useAppStore(s => s.activeStore);
  const storeId = activeStore?.id ?? '';
  const [rangeDays, setRangeDays] = useState(30);
  const [tab, setTab] = useState<typeof TABS[number]['id']>('global');
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching } = useQuery<any>({
    queryKey: ['conversion-optimization', storeId, rangeDays],
    queryFn: () => apiFetch(`/api/v1/conversion-optimization/dashboard?store_id=${storeId}&range_days=${rangeDays}`),
    enabled: !!storeId,
    refetchOnWindowFocus: false,
  });

  const d = data?.data;

  // Fetch bottlenecks specifically for the FunnelTracking tables
  const { data: bottlenecksData, isLoading: loadingBottlenecks } = useQuery({
     queryKey: ['funnel_bottlenecks', storeId],
     queryFn: () => apiFetch<{ success: boolean; data: any }>(`/api/v1/meta-ads/funnel/bottlenecks?store_id=${storeId}&days=7`),
     enabled: !!storeId,
     refetchOnWindowFocus: false,
  });
  const bottlenecksTables = bottlenecksData?.data;

  if (!storeId) return null;

  return (
    <div className="space-y-5 animate-in fade-in duration-500 pb-24">
      {/* ─── Header ─── */}
      <div className="bg-white rounded-2xl border p-5" style={{ borderColor: C.border }}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-2xl flex items-center justify-center" style={{ backgroundColor: C.primaryBg, color: C.primary }}>
              <Target className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-800 uppercase tracking-tight">Conversion Optimization Center</h2>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Analyse automatique et recommandations priorisées — {d?.calculated_at ? new Date(d.calculated_at).toLocaleString('fr-FR') : '…'}
                {d?._cache?.hit && <span className="ml-1 text-slate-300">(mise en cache)</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-50 rounded-xl p-1 border" style={{ borderColor: C.border }}>
              {[7, 30, 90].map(n => (
                <button key={n} onClick={() => setRangeDays(n)}
                  className={cn("h-8 px-3 rounded-lg text-[10px] font-black uppercase transition-all", rangeDays === n ? "bg-[#6C5CE7] text-white" : "text-slate-500 hover:bg-white")}>
                  {n}j
                </button>
              ))}
            </div>
            <button onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['conversion-optimization'] });
                queryClient.invalidateQueries({ queryKey: ['funnel_bottlenecks'] });
              }}
              className="h-9 px-3 rounded-xl border flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500 hover:bg-slate-50" style={{ borderColor: C.border }}>
              <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} /> Actualiser
            </button>
          </div>
        </div>
      </div>

      {/* ─── Tabs ─── */}
      <div className="flex items-center gap-1.5 bg-white rounded-2xl border p-1.5 w-fit overflow-x-auto max-w-full" style={{ borderColor: C.border }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn("px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all",
              tab === t.id ? "bg-[#6C5CE7] text-white shadow-sm" : "text-slate-500 hover:bg-slate-50")}>
            {t.label}
            {t.id === 'funnel_bottlenecks' && d?.bottlenecks?.length > 0 && (
              <span className="ml-1.5 size-4 rounded-full bg-rose-500 text-white text-[9px] font-black inline-flex items-center justify-center">{d.bottlenecks.length}</span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="h-64 flex items-center justify-center text-sm text-slate-400">Chargement des données réelles…</div>
      ) : !d && tab !== 'health' ? (
        <div className="h-64 flex items-center justify-center text-sm text-slate-400">Aucune donnée disponible.</div>
      ) : (
        <>
          {tab === 'global' && <GlobalTab d={d} />}
          {tab === 'funnel_bottlenecks' && <FunnelBottlenecksTab d={d} bottlenecksTables={bottlenecksTables} loadingBottlenecks={loadingBottlenecks} />}
          {tab === 'performances' && <PerformancesTab d={d} />}
          {tab === 'health' && (
            <div className="space-y-6">
               <MetaQueueDashboard />
               <div className="h-px bg-slate-200 w-full my-6"></div>
               <FunnelTrackingDashboard />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ==========================================
// PÔLE 1 : VUE GLOBALE & OPPORTUNITÉS
// ==========================================
function GlobalTab({ d }: { d: any }) {
  const windows = d.overview?.windows || {};
  const o = d.opportunity_score || {};
  const actions = d.actions || [];

  return (
    <div className="space-y-4">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {([['days_7', '7 jours'], ['days_30', '30 jours'], ['days_90', '90 jours']] as const).map(([key, label]) => {
          const w = windows[key];
          return (
            <StatCard key={key} label={`Conversion — ${label}`}
              value={w?.conversion_rate != null ? `${w.conversion_rate}%` : '—'}
              sub={w?.pageviews ? `${w.purchases} achats / ${w.pageviews} visites` : 'Aucune donnée'}
              color={C.primary} trend={w?.evolution_pct} />
          );
        })}
      </div>

      {/* Opportunity Score */}
      <div className="bg-white rounded-2xl border p-6" style={{ borderColor: C.border }}>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
            <Sparkles className="size-4 text-emerald-500" /> Score d'Opportunité
        </p>
        {o.current_conversion_rate == null ? (
          <p className="text-sm text-slate-400">{o.explanation}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-center">
            <div className="text-center">
              <p className="text-2xl font-black tabular-nums" style={{ color: C.text }}>{o.current_conversion_rate}%</p>
              <p className="text-[9px] font-bold uppercase text-slate-400 mt-1">Actuelle</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-black tabular-nums" style={{ color: o.potential_conversion_rate ? C.success : C.textDim }}>
                {o.potential_conversion_rate != null ? `${o.potential_conversion_rate}%` : '—'}
              </p>
              <p className="text-[9px] font-bold uppercase text-slate-400 mt-1">Potentielle</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-black tabular-nums" style={{ color: C.success }}>{o.gain_pct != null ? `+${o.gain_pct}%` : '—'}</p>
              <p className="text-[9px] font-bold uppercase text-slate-400 mt-1">Gain</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-black tabular-nums" style={{ color: C.success }}>
                {o.estimated_extra_orders != null ? `+${o.estimated_extra_orders} ventes` : '—'}
              </p>
              <p className="text-xs font-black" style={{ color: C.success }}>{o.estimated_extra_revenue != null ? `+${formatPrice(o.estimated_extra_revenue)}` : ''}</p>
            </div>
          </div>
        )}
        {o.explanation && o.current_conversion_rate != null && (
          <p className="text-[10px] text-slate-400 mt-4 flex items-start gap-1.5"><Info className="size-3 shrink-0 mt-0.5" /> {o.explanation}</p>
        )}
      </div>

      {/* Prioritized Actions */}
      <div className="bg-white rounded-2xl border p-5" style={{ borderColor: C.border }}>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Actions priorisées</p>
        <div className="space-y-2.5">
          {actions.map((a: any) => (
            <div key={a.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border" style={{ borderColor: C.border }}>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-700 truncate">{a.title}</p>
                <p className="text-[10px] text-slate-400 truncate">{a.fix}</p>
              </div>
              <div className="flex items-center gap-4 shrink-0 text-[10px]">
                <div><Stars count={a.impact_stars} color={C.success} /><p className="text-slate-300 text-center mt-0.5">Impact</p></div>
                <div><Stars count={a.effort_stars} color={C.warning} /><p className="text-slate-300 text-center mt-0.5">Effort</p></div>
              </div>
            </div>
          ))}
          {actions.length === 0 && <p className="text-xs text-slate-300 text-center py-4">Aucune action prioritaire — rien de critique détecté.</p>}
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-2xl border p-5" style={{ borderColor: C.border }}>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Évolution quotidienne du taux de conversion</p>
        {d.history?.daily?.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={d.history.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="period" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} unit="%" />
              <RechartsTooltip formatter={(v: any) => [`${v}%`, 'Conversion']} />
              <Line type="monotone" dataKey="conversion_rate" stroke={C.primary} strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-32 flex items-center justify-center text-xs text-slate-300">Pas assez de données pour un historique.</div>
        )}
      </div>
    </div>
  );
}


// ==========================================
// PÔLE 2 : ENTONNOIR & FREINS
// ==========================================
function FunnelBottlenecksTab({ d, bottlenecksTables, loadingBottlenecks }: { d: any, bottlenecksTables: any, loadingBottlenecks: boolean }) {
  const stages = d.funnel?.stages || [];
  const maxVolume = Math.max(1, ...stages.map((s: any) => s.volume));
  const bottlenecks = d.bottlenecks || [];

  return (
    <div className="space-y-4">
      {/* Funnel Overview */}
      <div className="bg-white rounded-2xl border p-5" style={{ borderColor: C.border }}>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">Tunnel de conversion global</p>
        <div className="space-y-4">
          {stages.map((s: any, i: number) => (
            <div key={s.stage}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-1.5 gap-1">
                <span className="text-xs font-bold text-slate-600">{i + 1}. {s.label}</span>
                <div className="flex items-center gap-3 text-xs flex-wrap">
                  <span className="font-black tabular-nums text-slate-800">{s.volume.toLocaleString('fr-FR')}</span>
                  {s.rate_from_previous_stage != null && <span className="text-slate-400">Déperdition: {100 - s.rate_from_previous_stage}%</span>}
                  {s.vs_previous_period_pct != null && (
                    <span className={cn("font-black", s.vs_previous_period_pct >= 0 ? "text-emerald-500" : "text-rose-500")}>
                      {s.vs_previous_period_pct >= 0 ? '+' : ''}{s.vs_previous_period_pct}%
                    </span>
                  )}
                </div>
              </div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{
                  width: `${Math.max(2, (s.volume / maxVolume) * 100)}%`,
                  backgroundColor: s.stage === d.funnel.primary_bottleneck?.stage ? C.danger : C.primary,
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottlenecks Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: General textual bottlenecks */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-700 ml-1">Freins Majeurs Détectés</h3>
            {bottlenecks.length === 0 ? (
                <div className="bg-white rounded-2xl border p-8 text-center h-full flex flex-col justify-center" style={{ borderColor: C.border }}>
                    <Sparkles className="size-6 mx-auto mb-2" style={{ color: C.success }} />
                    <p className="text-sm font-bold text-slate-600">Aucun frein majeur détecté.</p>
                </div>
            ) : (
                bottlenecks.map((b: any) => (
                    <div key={b.id} className="bg-white rounded-2xl border p-4" style={{ borderColor: C.border }}>
                        <div className="flex items-center justify-between gap-3 mb-2">
                        <p className="text-sm font-black text-slate-800 leading-tight">{b.impact}</p>
                        <div className="flex items-center gap-2 shrink-0">
                            <SeverityBadge severity={b.severity} />
                        </div>
                        </div>
                        <p className="text-xs text-slate-500 mb-2">{b.explanation}</p>
                        <div className="flex items-start gap-1.5 text-xs font-bold p-2 rounded-xl" style={{ backgroundColor: C.primaryBg, color: C.primary }}>
                        <ChevronRight className="size-3.5 shrink-0 mt-0.5" /> {b.fix}
                        </div>
                    </div>
                ))
            )}
          </div>

          {/* Right: Detailed bottlenecks table (from Funnel Tracking) */}
          <div className="bg-white rounded-2xl border p-5" style={{ borderColor: C.border }}>
            <h3 className="text-xs font-bold text-slate-700 mb-4">Détails des Déperditions (7 derniers jours)</h3>
            {loadingBottlenecks ? (
               <div className="p-10 flex justify-center"><RefreshCw className="size-5 animate-spin text-slate-300" /></div>
            ) : (
               <div className="space-y-6">
               {['by_landing_page', 'by_product'].map(key => {
                  const rows = bottlenecksTables?.[key] || [];
                  const label = key === 'by_landing_page' ? 'Par Landing Page' : 'Par Produit';
                  return (
                     <div key={key}>
                        <p className="text-[10px] font-black uppercase text-slate-400 mb-2">{label}</p>
                        {rows.length === 0 ? (
                           <p className="text-xs text-slate-300">Aucune donnée sur cette période.</p>
                        ) : (
                           <div className="overflow-x-auto">
                              <table className="w-full text-[10px] text-left">
                                 <thead><tr className="text-slate-400 border-b" style={{ borderColor: C.border }}>
                                    <th className="pb-1 pr-2">ID</th>
                                    <th className="pb-1 pr-2 text-right">Vue</th>
                                    <th className="pb-1 pr-2 text-right">Panier</th>
                                    <th className="pb-1 text-right">Alerte</th>
                                 </tr></thead>
                                 <tbody className="divide-y" style={{ borderColor: C.border }}>
                                    {rows.slice(0, 5).map((r: any) => (
                                       <tr key={r.id}>
                                          <td className="py-1.5 pr-2 font-mono truncate max-w-[80px]">{String(r.id)}</td>
                                          <td className="py-1.5 pr-2 text-right tabular-nums">{r.pageviews}</td>
                                          <td className="py-1.5 pr-2 text-right tabular-nums">{r.add_to_cart}</td>
                                          <td className="py-1.5 text-right">
                                             {r.bottleneck_stage ? (
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-rose-50 text-rose-600">
                                                   Drop {r.bottleneck_drop_pct}%
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
               })}
               </div>
            )}
          </div>
      </div>
    </div>
  );
}


// ==========================================
// PÔLE 3 : PERFORMANCES
// ==========================================
function PerformancesTab({ d }: { d: any }) {
  const products = d.products || [];
  const campaigns = d.campaigns || [];
  
  const TAG_LABELS: Record<string, { label: string; color: string }> = {
    popular_no_convert: { label: 'Trafic sans conversion', color: C.warning },
    profitable: { label: 'Haute rentabilité', color: C.success },
    low_visibility: { label: 'Manque de visibilité', color: C.textDim },
    to_remove_candidate: { label: 'À retirer ?', color: C.danger },
    to_promote_candidate: { label: 'À promouvoir', color: C.primary },
  };

  const FAULT_LABELS: Record<string, string> = {
    publicite: "Pub / Créa (Faible CTR)", 
    landing_ou_checkout: "Landing Page (Visite sans achat)",
    produit_ou_livraison: "Offre (Taux d'annulation)",
  };

  return (
    <div className="space-y-6">
        {/* Products */}
        <div>
            <div className="flex items-center gap-2 mb-3 px-1">
                <Package className="size-4" style={{ color: C.primary }} />
                <h3 className="text-sm font-black text-slate-800">Performances Produits</h3>
            </div>
            <div className="bg-white rounded-2xl border overflow-x-auto" style={{ borderColor: C.border }}>
                <table className="w-full text-xs">
                    <thead><tr className="text-left text-slate-400 border-b" style={{ borderColor: C.border }}>
                    <th className="p-3">Produit</th>
                    <th className="p-3 text-right">Vues</th>
                    <th className="p-3 text-right">Panier</th>
                    <th className="p-3 text-right">Achats</th>
                    <th className="p-3 text-right">Conversion</th>
                    <th className="p-3 text-right">CA</th>
                    <th className="p-3 text-right">Drop-off</th>
                    <th className="p-3">Analyse IA</th>
                    </tr></thead>
                    <tbody className="divide-y" style={{ borderColor: C.border }}>
                    {products.map((p: any) => {
                        const dropOff = p.views > 0 && p.add_to_cart > 0 ? Math.round(((p.views - p.add_to_cart) / p.views) * 100) : null;
                        return (
                            <tr key={p.product_id} className="hover:bg-slate-50 transition-colors">
                                <td className="p-3 font-bold text-slate-700 min-w-[150px] max-w-[200px] truncate">{p.name}</td>
                                <td className="p-3 text-right tabular-nums">{p.views}</td>
                                <td className="p-3 text-right tabular-nums">{p.add_to_cart}</td>
                                <td className="p-3 text-right tabular-nums font-black">{p.purchases}</td>
                                <td className="p-3 text-right tabular-nums">
                                    <span className={cn("px-1.5 py-0.5 rounded-md", p.conversion_pct >= 2 ? "bg-emerald-50 text-emerald-600" : "")}>
                                        {p.conversion_pct != null ? `${p.conversion_pct}%` : '—'}
                                    </span>
                                </td>
                                <td className="p-3 text-right tabular-nums font-black text-slate-800">{formatPrice(p.revenue)}</td>
                                <td className="p-3 text-right tabular-nums text-rose-500 font-bold">{dropOff != null ? `-${dropOff}%` : '—'}</td>
                                <td className="p-3 min-w-[200px]">
                                    <div className="flex flex-wrap gap-1.5">
                                    {p.tags.map((t: string) => (
                                        <span key={t} className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: (TAG_LABELS[t]?.color || C.textDim) + '15', color: TAG_LABELS[t]?.color || C.textDim }}>
                                        {TAG_LABELS[t]?.label || t}
                                        </span>
                                    ))}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                    {products.length === 0 && (
                        <tr><td colSpan={8} className="p-6 text-center text-slate-300">Aucun produit avec des ventes sur cette période.</td></tr>
                    )}
                    </tbody>
                </table>
            </div>
        </div>

        {/* Campaigns */}
        <div>
            <div className="flex items-center gap-2 mb-3 px-1 mt-4">
                <Megaphone className="size-4" style={{ color: C.info }} />
                <h3 className="text-sm font-black text-slate-800">Performances Campagnes</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {campaigns.map((c: any) => (
                <div key={c.campaign_id} className="bg-white rounded-2xl border p-4 flex flex-col justify-between" style={{ borderColor: C.border }}>
                    <div className="flex items-start gap-3 mb-3">
                        <div className="size-8 rounded-xl bg-slate-50 flex items-center justify-center shrink-0 border" style={{ borderColor: C.border }}>
                            <Megaphone className="size-3.5 text-slate-400" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-700 truncate" title={c.campaign_name}>{c.campaign_name}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">{c.orders_count} commande(s)</p>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 mb-3">
                        <div className="bg-slate-50 rounded-lg p-2 text-center">
                            <p className="text-xs font-black tabular-nums">{c.ctr != null ? `${c.ctr}%` : '—'}</p>
                            <p className="text-[9px] font-bold uppercase text-slate-400 mt-0.5">CTR</p>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 text-center">
                            <p className="text-xs font-black tabular-nums" style={{ color: c.roas >= 2 ? C.success : C.text }}>{c.roas != null ? `${c.roas}x` : '—'}</p>
                            <p className="text-[9px] font-bold uppercase text-slate-400 mt-0.5">ROAS</p>
                        </div>
                    </div>

                    {c.fault_attribution && (
                        <div className="mt-auto inline-flex justify-center w-full">
                            <span className="text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full text-center" style={{ backgroundColor: C.dangerBg, color: C.danger }}>
                            Origine de perte : {FAULT_LABELS[c.fault_attribution] || c.fault_attribution}
                            </span>
                        </div>
                    )}
                </div>
            ))}
            {campaigns.length === 0 && (
                <div className="col-span-full bg-white rounded-2xl border p-8 text-center text-sm text-slate-300" style={{ borderColor: C.border }}>Aucune campagne active avec dépenses sur cette période.</div>
            )}
            </div>
        </div>
    </div>
  );
}
