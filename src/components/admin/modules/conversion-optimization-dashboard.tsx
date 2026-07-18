'use client';

import React, { useState } from 'react';
import {
  Target, TrendingUp, TrendingDown, AlertTriangle, Filter, RefreshCw,
  ArrowUpRight, ArrowDownRight, Sparkles, Package, Megaphone, Award,
  ChevronRight, Info,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  BarChart, Bar, Cell,
} from 'recharts';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';

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
    <div className="rounded-2xl border bg-white p-4" style={{ borderColor: c + '33' }}>
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
  { id: 'overview', label: "Vue d'ensemble" },
  { id: 'funnel', label: 'Tunnel de conversion' },
  { id: 'bottlenecks', label: 'Freins détectés' },
  { id: 'products', label: 'Produits' },
  { id: 'campaigns', label: 'Campagnes' },
  { id: 'opportunity', label: 'Score d\'opportunité' },
] as const;

export default function ConversionOptimizationDashboard() {
  const activeStore = useAppStore(s => s.activeStore);
  const storeId = activeStore?.id ?? '';
  const [rangeDays, setRangeDays] = useState(30);
  const [tab, setTab] = useState<typeof TABS[number]['id']>('overview');
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching } = useQuery<any>({
    queryKey: ['conversion-optimization', storeId, rangeDays],
    queryFn: () => apiFetch(`/api/v1/conversion-optimization/dashboard?store_id=${storeId}&range_days=${rangeDays}`),
    enabled: !!storeId,
    refetchOnWindowFocus: false,
  });

  const d = data?.data;

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
                Analyse automatique du tunnel de conversion et recommandations priorisées — {d?.calculated_at ? new Date(d.calculated_at).toLocaleString('fr-FR') : '…'}
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
            <button onClick={() => queryClient.invalidateQueries({ queryKey: ['conversion-optimization'] })}
              className="h-9 px-3 rounded-xl border flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500 hover:bg-slate-50" style={{ borderColor: C.border }}>
              <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} /> Actualiser
            </button>
          </div>
        </div>
      </div>

      {/* ─── Tabs ─── */}
      <div className="flex items-center gap-1.5 bg-white rounded-2xl border p-1.5 w-fit overflow-x-auto" style={{ borderColor: C.border }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn("px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all",
              tab === t.id ? "bg-[#6C5CE7] text-white shadow-sm" : "text-slate-500 hover:bg-slate-50")}>
            {t.label}
            {t.id === 'bottlenecks' && d?.bottlenecks?.length > 0 && (
              <span className="ml-1.5 size-4 rounded-full bg-rose-500 text-white text-[9px] font-black inline-flex items-center justify-center">{d.bottlenecks.length}</span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="h-64 flex items-center justify-center text-sm text-slate-400">Chargement des données réelles…</div>
      ) : !d ? (
        <div className="h-64 flex items-center justify-center text-sm text-slate-400">Aucune donnée disponible.</div>
      ) : (
        <>
          {tab === 'overview' && <OverviewTab d={d} />}
          {tab === 'funnel' && <FunnelTab d={d} />}
          {tab === 'bottlenecks' && <BottlenecksTab d={d} />}
          {tab === 'products' && <ProductsTab d={d} />}
          {tab === 'campaigns' && <CampaignsTab d={d} />}
          {tab === 'opportunity' && <OpportunityTab d={d} />}
        </>
      )}
    </div>
  );
}

function OverviewTab({ d }: { d: any }) {
  const windows = d.overview?.windows || {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {([['days_7', '7 jours'], ['days_30', '30 jours'], ['days_90', '90 jours']] as const).map(([key, label]) => {
          const w = windows[key];
          return (
            <StatCard key={key} label={`Conversion — ${label}`}
              value={w?.conversion_rate != null ? `${w.conversion_rate}%` : '—'}
              sub={w?.pageviews ? `${w.purchases} achats / ${w.pageviews} visites` : 'Aucune donnée sur cette période'}
              color={C.primary} trend={w?.evolution_pct} />
          );
        })}
      </div>
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
      <div className="text-[10px] text-slate-400 px-1">{d.overview?.population}</div>
    </div>
  );
}

function FunnelTab({ d }: { d: any }) {
  const stages = d.funnel?.stages || [];
  const maxVolume = Math.max(1, ...stages.map((s: any) => s.volume));
  return (
    <div className="space-y-4">
      {d.funnel?.coherence_issues?.length > 0 && (
        <div className="rounded-2xl border p-4 flex items-start gap-3" style={{ borderColor: C.warning + '55', backgroundColor: C.warningBg }}>
          <AlertTriangle className="size-4 shrink-0 mt-0.5" style={{ color: '#B7791F' }} />
          <div>
            <p className="text-xs font-black mb-1" style={{ color: '#B7791F' }}>Anomalie de tracking détectée</p>
            {d.funnel.coherence_issues.map((issue: any, i: number) => (
              <p key={i} className="text-xs font-bold" style={{ color: '#B7791F' }}>{issue.message}</p>
            ))}
          </div>
        </div>
      )}
      {d.funnel?.primary_bottleneck?.message && (
        <div className="rounded-2xl border p-4 flex items-start gap-3" style={{ borderColor: C.danger + '33', backgroundColor: C.dangerBg }}>
          <AlertTriangle className="size-4 shrink-0 mt-0.5" style={{ color: C.danger }} />
          <p className="text-xs font-bold" style={{ color: C.danger }}>{d.funnel.primary_bottleneck.message}</p>
        </div>
      )}
      <div className="bg-white rounded-2xl border p-5" style={{ borderColor: C.border }}>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">Tunnel de conversion</p>
        <div className="space-y-3">
          {stages.map((s: any, i: number) => (
            <div key={s.stage}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-slate-600">{i + 1}. {s.label}</span>
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-black tabular-nums text-slate-800">{s.volume.toLocaleString('fr-FR')}</span>
                  {s.rate_from_previous_stage != null && <span className="text-slate-400">{s.rate_from_previous_stage}%</span>}
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
      <div className="text-[10px] text-slate-400 px-1">{d.funnel?.population}</div>
    </div>
  );
}

function BottlenecksTab({ d }: { d: any }) {
  const bottlenecks = d.bottlenecks || [];
  if (bottlenecks.length === 0) {
    return (
      <div className="bg-white rounded-2xl border p-8 text-center" style={{ borderColor: C.border }}>
        <Sparkles className="size-6 mx-auto mb-2" style={{ color: C.success }} />
        <p className="text-sm font-bold text-slate-600">Aucun frein majeur détecté sur cette période.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {bottlenecks.map((b: any) => (
        <div key={b.id} className="bg-white rounded-2xl border p-4" style={{ borderColor: C.border }}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-sm font-black text-slate-800">{b.impact}</p>
            <div className="flex items-center gap-2 shrink-0">
              <SeverityBadge severity={b.severity} />
              <span className="text-[9px] font-bold text-slate-400 uppercase">Confiance: {b.confidence === 'high' ? 'Élevée' : b.confidence === 'medium' ? 'Moyenne' : 'Faible'}</span>
            </div>
          </div>
          <p className="text-xs text-slate-500 mb-2">{b.explanation}</p>
          <div className="flex items-start gap-1.5 text-xs font-bold p-2 rounded-xl" style={{ backgroundColor: C.primaryBg, color: C.primary }}>
            <ChevronRight className="size-3.5 shrink-0 mt-0.5" /> {b.fix}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProductsTab({ d }: { d: any }) {
  const products = d.products || [];
  const TAG_LABELS: Record<string, { label: string; color: string }> = {
    popular_no_convert: { label: 'Populaire, ne convertit pas', color: C.warning },
    profitable: { label: 'Rentable', color: C.success },
    low_visibility: { label: 'Peu visible', color: C.textDim },
    to_remove_candidate: { label: 'À retirer ?', color: C.danger },
    to_promote_candidate: { label: 'À promouvoir', color: C.primary },
  };
  return (
    <div className="bg-white rounded-2xl border overflow-x-auto" style={{ borderColor: C.border }}>
      <table className="w-full text-xs">
        <thead><tr className="text-left text-slate-400 border-b" style={{ borderColor: C.border }}>
          <th className="p-3">Produit</th><th className="p-3">Vues</th><th className="p-3">Panier</th>
          <th className="p-3">Achats</th><th className="p-3">Conversion</th><th className="p-3">CA</th>
          <th className="p-3">Marge</th><th className="p-3">Signaux</th>
        </tr></thead>
        <tbody className="divide-y" style={{ borderColor: C.border }}>
          {products.map((p: any) => (
            <tr key={p.product_id} className="hover:bg-slate-50">
              <td className="p-3 font-bold text-slate-700 max-w-[180px] truncate">{p.name}</td>
              <td className="p-3 tabular-nums">{p.views}</td>
              <td className="p-3 tabular-nums">{p.add_to_cart}</td>
              <td className="p-3 tabular-nums font-black">{p.purchases}</td>
              <td className="p-3 tabular-nums">{p.conversion_pct != null ? `${p.conversion_pct}%` : '—'}</td>
              <td className="p-3 tabular-nums font-black">{formatPrice(p.revenue)}</td>
              <td className="p-3 tabular-nums">{p.margin_pct != null ? `${p.margin_pct}%` : '—'}</td>
              <td className="p-3">
                <div className="flex flex-wrap gap-1">
                  {p.tags.map((t: string) => (
                    <span key={t} className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full" style={{ backgroundColor: (TAG_LABELS[t]?.color || C.textDim) + '22', color: TAG_LABELS[t]?.color || C.textDim }}>
                      {TAG_LABELS[t]?.label || t}
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
          {products.length === 0 && (
            <tr><td colSpan={8} className="p-6 text-center text-slate-300">Aucun produit avec des ventes sur cette période.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CampaignsTab({ d }: { d: any }) {
  const campaigns = d.campaigns || [];
  const FAULT_LABELS: Record<string, string> = {
    publicite: "Publicité (CTR faible)", landing_ou_checkout: "Landing/Checkout (clics ne convertissent pas)",
    produit_ou_livraison: "Produit/Livraison (annulations élevées)",
  };
  return (
    <div className="space-y-3">
      {campaigns.map((c: any) => (
        <div key={c.campaign_id} className="bg-white rounded-2xl border p-4 flex items-center justify-between gap-4 flex-wrap" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-3 min-w-0">
            <Megaphone className="size-4 shrink-0 text-slate-300" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-700 truncate">{c.campaign_name}</p>
              <p className="text-[10px] text-slate-400">{c.orders_count} commande(s) · CTR {c.ctr != null ? `${c.ctr}%` : '—'} · ROAS {c.roas != null ? `${c.roas}x` : '—'}</p>
            </div>
          </div>
          {c.fault_attribution && (
            <span className="text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full shrink-0" style={{ backgroundColor: C.dangerBg, color: C.danger }}>
              {FAULT_LABELS[c.fault_attribution] || c.fault_attribution}
            </span>
          )}
        </div>
      ))}
      {campaigns.length === 0 && (
        <div className="bg-white rounded-2xl border p-8 text-center text-sm text-slate-300" style={{ borderColor: C.border }}>Aucune campagne active avec dépenses sur cette période.</div>
      )}
    </div>
  );
}

function OpportunityTab({ d }: { d: any }) {
  const o = d.opportunity_score || {};
  const actions = d.actions || [];
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border p-6" style={{ borderColor: C.border }}>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">Conversion Opportunity Score</p>
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

      <div className="bg-white rounded-2xl border p-5" style={{ borderColor: C.border }}>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Actions priorisées</p>
        <div className="space-y-2.5">
          {actions.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border" style={{ borderColor: C.border }}>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-700 truncate">{a.title}</p>
                <p className="text-[10px] text-slate-400 truncate">{a.fix}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-[10px]">
                <div><Stars count={a.impact_stars} color={C.success} /><p className="text-slate-300 text-center mt-0.5">Impact</p></div>
                <div><Stars count={a.effort_stars} color={C.warning} /><p className="text-slate-300 text-center mt-0.5">Effort</p></div>
              </div>
            </div>
          ))}
          {actions.length === 0 && <p className="text-xs text-slate-300 text-center py-4">Aucune action prioritaire — rien de critique détecté.</p>}
        </div>
      </div>

      <div className="bg-white rounded-2xl border p-5" style={{ borderColor: C.border }}>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Benchmark</p>
        <div className="grid grid-cols-2 gap-3 text-center">
          <div>
            <p className="text-lg font-black" style={{ color: C.text }}>{d.benchmark?.current_conversion_rate != null ? `${d.benchmark.current_conversion_rate}%` : '—'}</p>
            <p className="text-[9px] font-bold uppercase text-slate-400 mt-1">Actuel</p>
          </div>
          <div>
            <p className="text-lg font-black" style={{ color: C.success }}>{d.benchmark?.store_best_period?.conversion_rate != null ? `${d.benchmark.store_best_period.conversion_rate}%` : '—'}</p>
            <p className="text-[9px] font-bold uppercase text-slate-400 mt-1">Meilleure période (historique boutique)</p>
          </div>
        </div>
        <p className="text-[10px] text-slate-300 mt-3 text-center">{d.benchmark?.sector_average_note}</p>
      </div>
    </div>
  );
}
