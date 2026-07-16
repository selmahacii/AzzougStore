'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { toast } from 'sonner';
import { RefreshCw, AlertTriangle, CheckCircle2, PackageCheck, Wrench, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatPrice } from '@/lib/format';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ReturnsKpis {
  total_returns: number;
  total_movements: number;
  total_quantity_reintegrated: number;
  total_value_reintegrated: number;
  today: { returns: number; quantity: number };
  this_week: { returns: number; quantity: number };
  this_month: { returns: number; quantity: number };
  top_products: { product_id: string; product_name: string; quantity_returned: number }[];
}

interface ReturnsAudit {
  total_returned: number;
  restocked: number;
  never_restocked_but_expected: number;
  not_applicable_reserved_only: number;
  anomalies: { order_id: string; order_number: string; updated_at: string | null; total: number }[];
}

interface ReturnsAnalysis {
  total_returned: number;
  total_delivered: number;
  return_rate_pct: number;
  top_livreurs: { livreur_id: string; name: string; returns: number }[];
  top_clients: { phone: string; name: string; returns: number }[];
  top_causes: { cause: string; count: number }[];
  valeur_perdue: number;
}

interface ReturnedOrderRow {
  order_id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  livreur: string | null;
  delivered_at: string | null;
  returned_at: string | null;
  cause: string | null;
  products: { product_id: string | null; product_name: string; quantity: number }[];
  total: number;
  reintegration_status: 'reintegrated' | 'pending';
  validated_by: string | null;
  reintegrated_at: string | null;
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: 'ok' | 'danger' | 'default' }) {
  const toneClasses = {
    default: 'border-border bg-card',
    ok: 'border-emerald-500/40 bg-emerald-500/5',
    danger: 'border-red-500/40 bg-red-500/5',
  }[tone || 'default'];
  return (
    <div className={`rounded-lg border p-4 ${toneClasses}`}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

export default function ReturnsDashboard() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
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
  });
  const analysis = analysisData?.data;
  const returnedOrders = listData?.data || [];
  const pagination = listData?.pagination;

  const kpis = kpisData?.data;
  const audit = auditData?.data;

  const reintegrateMutation = useMutation({
    mutationFn: (orderIds?: string[]) => apiFetch('/api/v1/orders/returns/reintegrate-missing', {
      method: 'POST',
      body: JSON.stringify({ order_ids: orderIds ?? null }),
    }),
    onSuccess: (res: any) => {
      toast.success(res?.message || 'Réintégration effectuée');
      queryClient.invalidateQueries({ queryKey: ['returns_audit'] });
      queryClient.invalidateQueries({ queryKey: ['returns_kpis'] });
    },
    onError: (err: any) => toast.error('Erreur', { description: err.message }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Retours & Réintégration de stock</h2>
          <p className="text-sm text-muted-foreground">
            Le stock est réintégré automatiquement dès qu'une commande passe au statut "Retournée" — cette page audite et corrige les cas historiques.
          </p>
        </div>
        <button
          onClick={() => { queryClient.invalidateQueries({ queryKey: ['returns_kpis'] }); queryClient.invalidateQueries({ queryKey: ['returns_audit'] }); }}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      </div>

      {!loadingKpis && kpis && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Retours (total)" value={kpis.total_returns} />
            <StatCard label="Quantité réintégrée" value={kpis.total_quantity_reintegrated} />
            <StatCard label="Valeur réintégrée" value={formatPrice(kpis.total_value_reintegrated)} />
            <StatCard label="Retours aujourd'hui" value={kpis.today.returns} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Retours cette semaine" value={kpis.this_week.returns} />
            <StatCard label="Retours ce mois" value={kpis.this_month.returns} />
          </div>
          {kpis.top_products.length > 0 && (
            <div className="rounded-lg border p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Top produits retournés</p>
              <div className="space-y-1">
                {kpis.top_products.map(p => (
                  <div key={p.product_id} className="flex justify-between text-sm">
                    <span>{p.product_name}</span>
                    <span className="font-semibold tabular-nums">{p.quantity_returned}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!loadingAnalysis && analysis && (
        <div className="rounded-lg border p-4 space-y-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Analyse des retours</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="Taux de retour" value={`${analysis.return_rate_pct}%`} tone={analysis.return_rate_pct > 15 ? 'danger' : 'default'} />
            <StatCard label="Valeur perdue (jamais réintégrée)" value={formatPrice(analysis.valeur_perdue)} tone={analysis.valeur_perdue > 0 ? 'danger' : 'ok'} />
            <StatCard label="Livrées vs retournées" value={`${analysis.total_delivered} / ${analysis.total_returned}`} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Top livreurs</p>
              <div className="space-y-1">
                {analysis.top_livreurs.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
                {analysis.top_livreurs.map(l => (
                  <div key={l.livreur_id} className="flex justify-between text-sm">
                    <span className="truncate">{l.name}</span>
                    <span className="font-semibold tabular-nums">{l.returns}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Top clients</p>
              <div className="space-y-1">
                {analysis.top_clients.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
                {analysis.top_clients.map(c => (
                  <div key={c.phone} className="flex justify-between text-sm">
                    <span className="truncate">{c.name} ({c.phone})</span>
                    <span className="font-semibold tabular-nums">{c.returns}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Top causes</p>
              <div className="space-y-1">
                {analysis.top_causes.length === 0 && <p className="text-xs text-muted-foreground">Aucune cause renseignée sur les retours</p>}
                {analysis.top_causes.map((c, i) => (
                  <div key={i} className="flex justify-between text-sm gap-2">
                    <span className="truncate">{c.cause}</span>
                    <span className="font-semibold tabular-nums shrink-0">{c.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {!loadingAudit && audit && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Audit de cohérence</p>
            {audit.never_restocked_but_expected > 0 && (
              <button
                onClick={() => reintegrateMutation.mutate(undefined)}
                disabled={reintegrateMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 text-white px-3 py-1.5 text-xs font-bold hover:bg-amber-600 disabled:opacity-50"
              >
                <Wrench className="h-3.5 w-3.5" /> Réintégrer le stock manquant ({audit.never_restocked_but_expected})
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Correctement restockées" value={audit.restocked} tone="ok" />
            <StatCard label="Jamais restockées (anomalie)" value={audit.never_restocked_but_expected} tone={audit.never_restocked_but_expected > 0 ? 'danger' : 'ok'} />
            <StatCard label="Non applicable (réservation seule)" value={audit.not_applicable_reserved_only} />
          </div>

          {audit.never_restocked_but_expected === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> Aucune anomalie détectée — tous les retours ont réintégré leur stock.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pb-1 pr-2">Commande</th>
                    <th className="pb-1 pr-2">Statut</th>
                    <th className="pb-1 pr-2">Stock remis</th>
                    <th className="pb-1">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.anomalies.map(a => (
                    <tr key={a.order_id} className="border-t">
                      <td className="py-1 pr-2 font-mono">{a.order_number}</td>
                      <td className="py-1 pr-2 flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-red-500" /> Retour</td>
                      <td className="py-1 pr-2 text-red-600 font-bold">NON</td>
                      <td className="py-1">
                        <button
                          onClick={() => reintegrateMutation.mutate([a.order_id])}
                          disabled={reintegrateMutation.isPending}
                          className="inline-flex items-center gap-1 text-[#6C5CE7] hover:underline disabled:opacity-50"
                        >
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

      <div className="rounded-lg border p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Commandes retournées — détail</p>
        {loadingList ? (
          <p className="text-xs text-muted-foreground">Chargement…</p>
        ) : returnedOrders.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucune commande retournée.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pb-1 pr-2">Commande</th>
                    <th className="pb-1 pr-2">Client</th>
                    <th className="pb-1 pr-2">Livreur</th>
                    <th className="pb-1 pr-2">Livrée le</th>
                    <th className="pb-1 pr-2">Retournée le</th>
                    <th className="pb-1 pr-2">Produits</th>
                    <th className="pb-1 pr-2">Montant</th>
                    <th className="pb-1 pr-2">Cause</th>
                    <th className="pb-1 pr-2">Réintégration</th>
                    <th className="pb-1">Validé par</th>
                  </tr>
                </thead>
                <tbody>
                  {returnedOrders.map(o => (
                    <tr key={o.order_id} className="border-t align-top">
                      <td className="py-1.5 pr-2 font-mono whitespace-nowrap">{o.order_number}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{o.customer_name}<br /><span className="text-muted-foreground">{o.customer_phone}</span></td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{o.livreur || '—'}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{o.delivered_at ? formatDistanceToNow(new Date(o.delivered_at), { addSuffix: true, locale: fr }) : '—'}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{o.returned_at ? formatDistanceToNow(new Date(o.returned_at), { addSuffix: true, locale: fr }) : '—'}</td>
                      <td className="py-1.5 pr-2 max-w-[220px]">
                        {o.products.map((p, i) => (
                          <div key={i} className="truncate">{p.quantity}× {p.product_name}</div>
                        ))}
                      </td>
                      <td className="py-1.5 pr-2 font-semibold whitespace-nowrap">{formatPrice(o.total)}</td>
                      <td className="py-1.5 pr-2 max-w-[160px] truncate" title={o.cause || undefined}>{o.cause || '—'}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        {o.reintegration_status === 'reintegrated' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 font-bold"><CheckCircle2 className="h-3 w-3" /> Réintégré</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-600 font-bold"><AlertTriangle className="h-3 w-3" /> En attente</span>
                        )}
                        {o.reintegrated_at && (
                          <div className="text-muted-foreground">{formatDistanceToNow(new Date(o.reintegrated_at), { addSuffix: true, locale: fr })}</div>
                        )}
                      </td>
                      <td className="py-1.5">{o.validated_by || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pagination && pagination.pages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-[11px] text-muted-foreground">Page {pagination.page} / {pagination.pages} · {pagination.total} commande(s)</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:opacity-40 hover:bg-muted"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Précédent
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
                    disabled={page >= pagination.pages}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:opacity-40 hover:bg-muted"
                  >
                    Suivant <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
