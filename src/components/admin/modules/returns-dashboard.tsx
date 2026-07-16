'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { toast } from 'sonner';
import { RefreshCw, AlertTriangle, CheckCircle2, PackageCheck, Wrench } from 'lucide-react';
import { formatPrice } from '@/lib/format';

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
    </div>
  );
}
