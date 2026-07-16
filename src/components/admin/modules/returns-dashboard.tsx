'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { toast } from 'sonner';
import { RefreshCw, AlertTriangle, CheckCircle2, PackageCheck, Wrench, ChevronLeft, ChevronRight, RotateCcw, TrendingUp, ListChecks } from 'lucide-react';
import { formatPrice } from '@/lib/format';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const C = {
   primary: '#6C5CE7', primaryBg: '#F0EDFF',
   success: '#00B894', successBg: '#E6FFF8',
   danger: '#E17055', dangerBg: '#FFEDE9',
   warning: '#FDCB6E', warningBg: '#FFF8E6',
   info: '#0984E3', infoBg: '#E8F4FE',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

interface ReturnsKpis {
  total_returns: number; total_quantity_reintegrated: number; total_value_reintegrated: number;
  today: { returns: number; quantity: number }; this_week: { returns: number; quantity: number }; this_month: { returns: number; quantity: number };
  top_products: { product_id: string; product_name: string; quantity_returned: number }[];
}
interface ReturnsAudit {
  total_returned: number; restocked: number; never_restocked_but_expected: number; not_applicable_reserved_only: number;
  anomalies: { order_id: string; order_number: string; updated_at: string | null; total: number }[];
}
interface ReturnsAnalysis {
  total_returned: number; total_delivered: number; return_rate_pct: number;
  top_livreurs: { livreur_id: string; name: string; returns: number }[];
  top_clients: { phone: string; name: string; returns: number }[];
  top_causes: { cause: string; count: number }[];
  valeur_perdue: number;
}
interface ReturnedOrderRow {
  order_id: string; order_number: string; customer_name: string; customer_phone: string;
  livreur: string | null; delivered_at: string | null; returned_at: string | null; cause: string | null;
  products: { product_id: string | null; product_name: string; quantity: number }[];
  total: number; reintegration_status: 'reintegrated' | 'pending'; validated_by: string | null; reintegrated_at: string | null;
}

function KpiTile({ label, value, color, tone }: { label: string; value: string | number; color?: string; tone?: 'ok' | 'danger' }) {
   const c = tone === 'danger' ? C.danger : tone === 'ok' ? C.success : (color || C.text);
   return (
      <div className="text-center p-3 rounded-2xl border bg-white" style={{ borderColor: c + '33' }}>
         <p className="text-lg font-black tabular-nums" style={{ color: c }}>{value}</p>
         <p className="text-[9px] font-bold uppercase tracking-wider mt-0.5 text-slate-400">{label}</p>
      </div>
   );
}

const TABS = [
   { id: 'overview', label: "Vue d'ensemble", icon: TrendingUp },
   { id: 'audit', label: 'Audit de cohérence', icon: ListChecks },
   { id: 'detail', label: 'Commandes retournées', icon: RotateCcw },
] as const;

export default function ReturnsDashboard() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<typeof TABS[number]['id']>('overview');
  const pageSize = 25;

  const { data: kpisData, isLoading: loadingKpis } = useQuery({
    queryKey: ['returns_kpis'],
    queryFn: () => apiFetch<{ success: boolean; data: ReturnsKpis }>('/api/v1/orders/returns/kpis'),
    refetchOnWindowFocus: false,
  });
  const { data: auditData, isLoading: loadingAudit, isFetching } = useQuery({
    queryKey: ['returns_audit'],
    queryFn: () => apiFetch<{ success: boolean; data: ReturnsAudit }>('/api/v1/orders/returns/audit'),
    refetchOnWindowFocus: false,
  });
  const { data: analysisData, isLoading: loadingAnalysis } = useQuery({
    queryKey: ['returns_analysis'],
    queryFn: () => apiFetch<{ success: boolean; data: ReturnsAnalysis }>('/api/v1/orders/returns/analysis'),
    refetchOnWindowFocus: false,
  });
  const { data: listData, isLoading: loadingList } = useQuery({
    queryKey: ['returns_list', page],
    queryFn: () => apiFetch<{ success: boolean; data: ReturnedOrderRow[]; pagination: { page: number; page_size: number; total: number; pages: number } }>(
      `/api/v1/orders/returns/list?page=${page}&page_size=${pageSize}`
    ),
    refetchOnWindowFocus: false,
    enabled: tab === 'detail',
  });
  const analysis = analysisData?.data;
  const returnedOrders = listData?.data || [];
  const pagination = listData?.pagination;
  const kpis = kpisData?.data;
  const audit = auditData?.data;

  const reintegrateMutation = useMutation({
    mutationFn: (orderIds?: string[]) => apiFetch('/api/v1/orders/returns/reintegrate-missing', {
      method: 'POST', body: JSON.stringify({ order_ids: orderIds ?? null }),
    }),
    onSuccess: (res: any) => {
      toast.success(res?.message || 'Réintégration effectuée');
      queryClient.invalidateQueries({ queryKey: ['returns_audit'] });
      queryClient.invalidateQueries({ queryKey: ['returns_kpis'] });
    },
    onError: (err: any) => toast.error('Erreur', { description: err.message }),
  });

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      {/* ─── Header + résumé toujours visible ─── */}
      <div className="bg-white rounded-2xl border p-5" style={{ borderColor: C.border }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-black text-slate-800">Retours & Réintégration de stock</h2>
            <p className="text-xs text-slate-400 mt-0.5">Le stock est réintégré automatiquement dès qu'une commande passe au statut "Retournée".</p>
          </div>
          <button
            onClick={() => { queryClient.invalidateQueries({ queryKey: ['returns_kpis'] }); queryClient.invalidateQueries({ queryKey: ['returns_audit'] }); queryClient.invalidateQueries({ queryKey: ['returns_analysis'] }); }}
            className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors" style={{ borderColor: C.border }}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} /> Actualiser
          </button>
        </div>

        {!loadingKpis && kpis && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <KpiTile label="Retours (total)" value={kpis.total_returns} color={C.primary} />
            <KpiTile label="Valeur réintégrée" value={formatPrice(kpis.total_value_reintegrated)} color={C.success} />
            <KpiTile label="Retours aujourd'hui" value={kpis.today.returns} color={C.info} />
            {audit && <KpiTile label="Anomalies à corriger" value={audit.never_restocked_but_expected} tone={audit.never_restocked_but_expected > 0 ? 'danger' : 'ok'} />}
          </div>
        )}
      </div>

      {/* ─── Onglets — remplace 4 blocs empilés par une navigation claire ─── */}
      <div className="flex items-center gap-1.5 bg-white rounded-2xl border p-1.5 w-fit" style={{ borderColor: C.border }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn("flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all",
              tab === t.id ? "bg-[#6C5CE7] text-white shadow-sm" : "text-slate-500 hover:bg-slate-50")}>
            <t.icon className="size-3.5" /> {t.label}
            {t.id === 'audit' && (audit?.never_restocked_but_expected ?? 0) > 0 && (
              <span className="ml-0.5 size-4 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">{audit!.never_restocked_but_expected}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          {kpis?.top_products && kpis.top_products.length > 0 && (
            <div className="bg-white rounded-2xl border p-5" style={{ borderColor: C.border }}>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Top produits retournés</p>
              <div className="space-y-1.5">
                {kpis.top_products.map(p => (
                  <div key={p.product_id} className="flex justify-between text-xs p-2 rounded-lg bg-slate-50">
                    <span className="font-semibold text-slate-700">{p.product_name}</span>
                    <span className="font-black tabular-nums text-slate-800">{p.quantity_returned}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loadingAnalysis && analysis && (
            <div className="bg-white rounded-2xl border p-5 space-y-4" style={{ borderColor: C.border }}>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Analyse des retours</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                <KpiTile label="Taux de retour" value={`${analysis.return_rate_pct}%`} tone={analysis.return_rate_pct > 15 ? 'danger' : 'ok'} />
                <KpiTile label="Valeur perdue" value={formatPrice(analysis.valeur_perdue)} tone={analysis.valeur_perdue > 0 ? 'danger' : 'ok'} />
                <KpiTile label="Livrées vs retournées" value={`${analysis.total_delivered} / ${analysis.total_returned}`} color={C.info} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { title: 'Top livreurs', items: analysis.top_livreurs.map(l => ({ key: l.livreur_id, label: l.name, value: l.returns })) },
                  { title: 'Top clients', items: analysis.top_clients.map(c => ({ key: c.phone, label: `${c.name} (${c.phone})`, value: c.returns })) },
                  { title: 'Top causes', items: analysis.top_causes.map((c, i) => ({ key: String(i), label: c.cause, value: c.count })) },
                ].map(col => (
                  <div key={col.title}>
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-2">{col.title}</p>
                    {col.items.length === 0 ? <p className="text-xs text-slate-300">—</p> : (
                      <div className="space-y-1">
                        {col.items.map(it => (
                          <div key={it.key} className="flex justify-between text-xs gap-2">
                            <span className="truncate text-slate-600">{it.label}</span>
                            <span className="font-black tabular-nums text-slate-800 shrink-0">{it.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'audit' && !loadingAudit && audit && (
        <div className="bg-white rounded-2xl border p-5 space-y-4" style={{ borderColor: C.border }}>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Audit de cohérence</p>
            {audit.never_restocked_but_expected > 0 && (
              <button onClick={() => reintegrateMutation.mutate(undefined)} disabled={reintegrateMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white transition-all disabled:opacity-50" style={{ backgroundColor: C.warning }}>
                <Wrench className="h-3.5 w-3.5" /> Réintégrer le stock manquant ({audit.never_restocked_but_expected})
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <KpiTile label="Correctement restockées" value={audit.restocked} tone="ok" />
            <KpiTile label="Anomalies" value={audit.never_restocked_but_expected} tone={audit.never_restocked_but_expected > 0 ? 'danger' : 'ok'} />
            <KpiTile label="Non applicable" value={audit.not_applicable_reserved_only} color={C.textDim} />
          </div>
          {audit.never_restocked_but_expected === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600 font-bold p-3 bg-emerald-50 rounded-xl">
              <CheckCircle2 className="h-4 w-4" /> Aucune anomalie — tous les retours ont réintégré leur stock.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-slate-400 border-b" style={{ borderColor: C.border }}>
                  <th className="pb-2 pr-2">Commande</th><th className="pb-2 pr-2">Stock remis</th><th className="pb-2">Action</th>
                </tr></thead>
                <tbody className="divide-y" style={{ borderColor: C.border }}>
                  {audit.anomalies.map(a => (
                    <tr key={a.order_id}>
                      <td className="py-2 pr-2 font-mono font-bold">{a.order_number}</td>
                      <td className="py-2 pr-2 text-rose-600 font-bold flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> NON</td>
                      <td className="py-2">
                        <button onClick={() => reintegrateMutation.mutate([a.order_id])} disabled={reintegrateMutation.isPending}
                          className="inline-flex items-center gap-1 text-[#6C5CE7] hover:underline font-bold disabled:opacity-50">
                          <PackageCheck className="h-3 w-3" /> Réintégrer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'detail' && (
        <div className="bg-white rounded-2xl border p-5 space-y-3" style={{ borderColor: C.border }}>
          {loadingList ? (
            <p className="text-xs text-slate-400">Chargement…</p>
          ) : returnedOrders.length === 0 ? (
            <p className="text-xs text-slate-400">Aucune commande retournée.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-slate-400 border-b" style={{ borderColor: C.border }}>
                    <th className="pb-2 pr-3">Commande</th><th className="pb-2 pr-3">Client</th><th className="pb-2 pr-3">Livreur</th>
                    <th className="pb-2 pr-3">Livrée</th><th className="pb-2 pr-3">Retournée</th><th className="pb-2 pr-3">Produits</th>
                    <th className="pb-2 pr-3">Montant</th><th className="pb-2 pr-3">Cause</th><th className="pb-2 pr-3">Réintégration</th><th className="pb-2">Validé par</th>
                  </tr></thead>
                  <tbody className="divide-y" style={{ borderColor: C.border }}>
                    {returnedOrders.map(o => (
                      <tr key={o.order_id} className="align-top hover:bg-slate-50">
                        <td className="py-2 pr-3 font-mono font-bold whitespace-nowrap">{o.order_number}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{o.customer_name}<br /><span className="text-slate-400">{o.customer_phone}</span></td>
                        <td className="py-2 pr-3 whitespace-nowrap">{o.livreur || '—'}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{o.delivered_at ? formatDistanceToNow(new Date(o.delivered_at), { addSuffix: true, locale: fr }) : '—'}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{o.returned_at ? formatDistanceToNow(new Date(o.returned_at), { addSuffix: true, locale: fr }) : '—'}</td>
                        <td className="py-2 pr-3 max-w-[200px]">{o.products.map((p, i) => <div key={i} className="truncate">{p.quantity}× {p.product_name}</div>)}</td>
                        <td className="py-2 pr-3 font-bold whitespace-nowrap">{formatPrice(o.total)}</td>
                        <td className="py-2 pr-3 max-w-[140px] truncate" title={o.cause || undefined}>{o.cause || '—'}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {o.reintegration_status === 'reintegrated' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-bold"><CheckCircle2 className="h-3 w-3" /> Réintégré</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-rose-600 font-bold"><AlertTriangle className="h-3 w-3" /> En attente</span>
                          )}
                        </td>
                        <td className="py-2">{o.validated_by || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pagination && pagination.pages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-[11px] text-slate-400">Page {pagination.page} / {pagination.pages} · {pagination.total} commande(s)</span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                      className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-bold disabled:opacity-40 hover:bg-slate-50" style={{ borderColor: C.border }}>
                      <ChevronLeft className="h-3.5 w-3.5" /> Précédent
                    </button>
                    <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page >= pagination.pages}
                      className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-bold disabled:opacity-40 hover:bg-slate-50" style={{ borderColor: C.border }}>
                      Suivant <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
