'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Truck, RefreshCw, Package, CheckCircle2, Clock, Activity, Zap,
  Search, Filter, ChevronRight, X, User, Phone, MapPin, History, ExternalLink, Calendar
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAppStore } from '@/store/app-store';
import { NoestTrackingPanel } from '@/components/admin/noest-tracking-panel';
import { apiFetch } from '@/lib/api-client';

interface OrderItemInfo {
  id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
}

interface TrackedOrder {
  id: string;
  order_number: string;
  store_sequence_number: number | null;
  customer_name: string;
  customer_phone: string;
  customer_wilaya: string;
  tracking_number: string;
  status: string;
  carrier_stage: string | null;
  carrier_stage_label: string | null;
  total: number;
  created_at: string | null;
  updated_at: string | null;
  items?: OrderItemInfo[];
}

interface NoestStats {
  success: boolean;
  total_tracked: number;
  shipped: number;
  out_for_delivery: number;
  delivered: number;
  returned: number;
  sync_status: string;
  last_sync: string;
  orders?: TrackedOrder[];
}

export function NoestRealtimeWidget() {
  const queryClient = useQueryClient();
  const { activeStore } = useAppStore();
  const storeId = activeStore?.id;

  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OUT_FOR_DELIVERY' | 'SHIPPED' | 'DELIVERED' | 'RETURNED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<TrackedOrder | null>(null);

  // Date and Product Filters state
  const [datePeriod, setDatePeriod] = useState<'ALL' | 'THIS_MONTH' | 'LAST_MONTH' | '30D' | '7D' | 'TODAY' | 'CUSTOM'>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filterProductId, setFilterProductId] = useState('');

  // Fetch products list for dropdown
  const productsQuery = useQuery<any>({
    queryKey: ['admin-products-lite-tracking', storeId],
    queryFn: () => apiFetch(`/api/v1/products?store_id=${storeId}&minimal=true`),
    enabled: !!storeId,
  });
  const productsList = productsQuery.data?.data ?? [];

  const statsQuery = useQuery<NoestStats>({
    queryKey: ['noest-realtime-stats', storeId, datePeriod, startDate, endDate, filterProductId],
    queryFn: () => {
      let url = `/api/noest/stats?store_id=${storeId}`;
      if (filterProductId) url += `&product_id=${filterProductId}`;
      if (datePeriod === 'CUSTOM' && startDate && endDate) {
        url += `&start_date=${startDate}&end_date=${endDate}`;
      } else if (datePeriod === 'TODAY') {
        const today = new Date().toISOString().slice(0, 10);
        url += `&start_date=${today}&end_date=${today}`;
      } else if (datePeriod === 'THIS_MONTH') {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        const today = now.toISOString().slice(0, 10);
        url += `&start_date=${firstDay}&end_date=${today}`;
      } else if (datePeriod === 'LAST_MONTH') {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
        const lastDay = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
        url += `&start_date=${firstDay}&end_date=${lastDay}`;
      } else if (datePeriod === '7D') {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        url += `&start_date=${d.toISOString().slice(0, 10)}`;
      } else if (datePeriod === '30D') {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        url += `&start_date=${d.toISOString().slice(0, 10)}`;
      }
      return fetch(url).then(r => r.json());
    },
    enabled: !!storeId,
    refetchInterval: 60_000,
  });

  const orderEventsQuery = useQuery<{ success: boolean; events: any[] }>({
    queryKey: ['order-events-history', selectedOrder?.id],
    queryFn: () => apiFetch(`/api/v1/orders/${selectedOrder?.id}/events`),
    enabled: !!selectedOrder?.id,
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
      toast.success('Synchronisation Noest effectuée avec succès !');
    },
    onError: () => {
      toast.error('Erreur lors de la synchronisation Noest');
    },
  });

  const stats = statsQuery.data;
  const orders = stats?.orders ?? [];

  // Filter orders based on status, product, date & search
  const filteredOrders = orders.filter(o => {
    // Filter by status
    if (statusFilter === 'OUT_FOR_DELIVERY') {
      const isOut = o.status === 'SHIPPED' && (!!o.carrier_stage && o.carrier_stage in { fdr_activated: 1, 'en livraison': 1 } || (o.carrier_stage_label || '').toLowerCase().includes('livraison'));
      if (!isOut) return false;
    } else if (statusFilter === 'SHIPPED') {
      const isOut = o.status === 'SHIPPED' && (!!o.carrier_stage && o.carrier_stage in { fdr_activated: 1, 'en livraison': 1 } || (o.carrier_stage_label || '').toLowerCase().includes('livraison'));
      if (o.status !== 'SHIPPED' || isOut) return false;
    } else if (statusFilter === 'DELIVERED') {
      if (o.status !== 'DELIVERED') return false;
    } else if (statusFilter === 'RETURNED') {
      if (o.status !== 'RETURNED') return false;
    }

    // Filter by product ID
    if (filterProductId && o.items && o.items.length > 0) {
      const matchesProduct = o.items.some(i => i.product_id === filterProductId);
      if (!matchesProduct) return false;
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchNum = (o.order_number || '').toLowerCase().includes(q);
      const matchSeq = o.store_sequence_number ? String(o.store_sequence_number).includes(q) : false;
      const matchName = (o.customer_name || '').toLowerCase().includes(q);
      const matchPhone = (o.customer_phone || '').includes(q);
      const matchTrk = (o.tracking_number || '').toLowerCase().includes(q);
      const matchWilaya = (o.customer_wilaya || '').toLowerCase().includes(q);
      const matchItem = o.items?.some(i => (i.product_name || '').toLowerCase().includes(q));
      return matchNum || matchSeq || matchName || matchPhone || matchTrk || matchWilaya || matchItem;
    }

    return true;
  });

  return (
    <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/50 via-slate-50/80 to-white p-5 shadow-sm space-y-5">
      {/* Header Widget */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20 shrink-0">
            <Truck className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black text-slate-800 tracking-tight">Suivi NOEST & Transporteurs en Temps Réel</h3>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Synchro Live Active
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium">
              Suivi interactif, filtration par date, statut et produits
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

      {/* Grid des Cartes Métriques Filtrables */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <button
          onClick={() => setStatusFilter('ALL')}
          className={cn(
            'text-left bg-white rounded-xl border p-3.5 transition-all cursor-pointer shadow-2xs hover:border-blue-300',
            statusFilter === 'ALL' ? 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/20' : 'border-slate-100'
          )}
        >
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider">Toutes Trackées</span>
            <Package className="size-4 text-blue-500" />
          </div>
          <p className="text-xl font-black text-slate-800 tabular-nums">{stats?.total_tracked ?? 0}</p>
          <p className="text-[10px] text-slate-400 mt-0.5 font-medium">N° de suivi actif</p>
        </button>

        <button
          onClick={() => setStatusFilter('OUT_FOR_DELIVERY')}
          className={cn(
            'text-left bg-white rounded-xl border p-3.5 transition-all cursor-pointer shadow-2xs hover:border-blue-400',
            statusFilter === 'OUT_FOR_DELIVERY' ? 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/30' : 'border-blue-100'
          )}
        >
          <div className="flex items-center justify-between text-blue-500 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-blue-600">En Livraison</span>
            <Zap className="size-4 text-blue-500 animate-bounce" />
          </div>
          <p className="text-xl font-black text-blue-600 tabular-nums">{stats?.out_for_delivery ?? 0}</p>
          <p className="text-[10px] text-blue-400 mt-0.5 font-bold">Colis avec le livreur</p>
        </button>

        <button
          onClick={() => setStatusFilter('SHIPPED')}
          className={cn(
            'text-left bg-white rounded-xl border p-3.5 transition-all cursor-pointer shadow-2xs hover:border-amber-300',
            statusFilter === 'SHIPPED' ? 'border-amber-500 ring-2 ring-amber-500/20 bg-amber-50/20' : 'border-slate-100'
          )}
        >
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider">En Transit</span>
            <Truck className="size-4 text-amber-500" />
          </div>
          <p className="text-xl font-black text-amber-600 tabular-nums">{stats?.shipped ?? 0}</p>
          <p className="text-[10px] text-slate-400 mt-0.5 font-medium">En route / HUB</p>
        </button>

        <button
          onClick={() => setStatusFilter('DELIVERED')}
          className={cn(
            'text-left bg-white rounded-xl border p-3.5 transition-all cursor-pointer shadow-2xs hover:border-emerald-300',
            statusFilter === 'DELIVERED' ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-50/20' : 'border-emerald-100'
          )}
        >
          <div className="flex items-center justify-between text-emerald-500 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Livrées (COD)</span>
            <CheckCircle2 className="size-4 text-emerald-500" />
          </div>
          <p className="text-xl font-black text-emerald-600 tabular-nums">{stats?.delivered ?? 0}</p>
          <p className="text-[10px] text-emerald-500/80 mt-0.5 font-bold">Encaissements validés</p>
        </button>

        <button
          onClick={() => setStatusFilter('RETURNED')}
          className={cn(
            'text-left bg-white rounded-xl border p-3.5 transition-all cursor-pointer shadow-2xs col-span-2 sm:col-span-1 hover:border-rose-300',
            statusFilter === 'RETURNED' ? 'border-rose-500 ring-2 ring-rose-500/20 bg-rose-50/20' : 'border-slate-100'
          )}
        >
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-rose-500">Retours</span>
            <Activity className="size-4 text-rose-500" />
          </div>
          <p className="text-xl font-black text-rose-600 tabular-nums">{stats?.returned ?? 0}</p>
          <p className="text-[10px] text-slate-400 mt-0.5 font-medium">Colis retournés</p>
        </button>
      </div>

      {/* Barre de Filtration Avancée (Produit & Période / Dates) */}
      <div className="bg-slate-900 rounded-xl p-3 text-white space-y-3 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Preset boutons date */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1">
              <Calendar className="size-3.5 text-blue-400" /> Période :
            </span>
            {[
              { id: 'ALL', label: 'Toutes dates' },
              { id: 'THIS_MONTH', label: 'Ce mois-ci' },
              { id: 'LAST_MONTH', label: 'Mois dernier' },
              { id: '30D', label: '30 jours' },
              { id: '7D', label: '7 jours' },
              { id: 'TODAY', label: "Aujourd'hui" },
              { id: 'CUSTOM', label: '📅 Période' },
            ].map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => setDatePeriod(p.id as any)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer",
                  datePeriod === p.id ? "bg-blue-600 text-white shadow-sm" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Filtre Produit */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Produit :</span>
            <select
              value={filterProductId}
              onChange={e => setFilterProductId(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-white text-[11px] px-3 py-1 rounded-lg font-bold cursor-pointer max-w-[200px]"
            >
              <option value="">Tous les produits</option>
              {productsList.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {filterProductId && (
              <button
                onClick={() => setFilterProductId('')}
                className="text-[10px] font-bold text-rose-400 hover:underline"
              >
                (Réinit)
              </button>
            )}
          </div>
        </div>

        {datePeriod === 'CUSTOM' && (
          <div className="flex items-center gap-2 pt-1 border-t border-slate-800 text-xs">
            <span className="text-[10px] text-slate-400 font-bold uppercase">Dates du suivi :</span>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-white text-[11px] px-2.5 py-1 rounded-lg font-bold"
            />
            <span className="text-slate-400 text-[10px]">au</span>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-white text-[11px] px-2.5 py-1 rounded-lg font-bold"
            />
          </div>
        )}
      </div>

      {/* Recherche et Liste des Commandes Trackées */}
      <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3 shadow-2xs">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-blue-600" />
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">
              Liste des Commandes ({filteredOrders.length})
            </h4>
            {(statusFilter !== 'ALL' || datePeriod !== 'ALL' || filterProductId || searchQuery) && (
              <button
                onClick={() => {
                  setStatusFilter('ALL');
                  setDatePeriod('ALL');
                  setFilterProductId('');
                  setSearchQuery('');
                  setStartDate('');
                  setEndDate('');
                }}
                className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1"
              >
                (Réinitialiser tous les filtres)
              </button>
            )}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 size-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Rechercher N°, Produit, Nom, Tel..."
              className="w-full h-8 pl-8 pr-3 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Grille / Liste des Commandes */}
        {filteredOrders.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-100 rounded-xl">
            Aucune commande Noest trouvée pour ce filtre.
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            {filteredOrders.map(order => {
              const isOut = order.status === 'SHIPPED' && (!!order.carrier_stage && order.carrier_stage in { fdr_activated: 1, 'en livraison': 1 } || (order.carrier_stage_label || '').toLowerCase().includes('livraison'));
              const isDelivered = order.status === 'DELIVERED';
              const isReturned = order.status === 'RETURNED';

              return (
                <div
                  key={order.id}
                  onClick={() => setSelectedOrder(order)}
                  className="group flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:border-blue-300 hover:bg-blue-50/30 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn(
                      'size-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold',
                      isDelivered ? 'bg-emerald-100 text-emerald-700' :
                      isReturned ? 'bg-rose-100 text-rose-700' :
                      isOut ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                    )}>
                      {isDelivered ? '✓' : isReturned ? '✕' : isOut ? '⚡' : '📦'}
                    </div>

                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-slate-800">
                          {order.store_sequence_number ? `Commande N°${order.store_sequence_number}` : order.order_number}
                        </span>
                        <span className="text-[10px] font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-bold">
                          {order.tracking_number}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500 truncate">
                        <span className="flex items-center gap-1 font-bold text-slate-700 truncate">
                          <User className="size-3 text-slate-400" /> {order.customer_name}
                        </span>
                        <span className="flex items-center gap-1 font-mono">
                          <Phone className="size-3 text-slate-400" /> {order.customer_phone}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="size-3 text-slate-400" /> {order.customer_wilaya}
                        </span>
                      </div>

                      {/* Items list preview */}
                      {order.items && order.items.length > 0 && (
                        <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
                          {order.items.map((item, idx) => (
                            <span key={item.id || idx} className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md">
                              📦 {item.quantity}x {item.product_name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className={cn(
                      'px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider',
                      isDelivered ? 'bg-emerald-100 text-emerald-700' :
                      isReturned ? 'bg-rose-100 text-rose-700' :
                      isOut ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                    )}>
                      {order.carrier_stage_label || order.status}
                    </span>
                    <ChevronRight className="size-4 text-slate-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal / Panel d'Historique Exact des Actions au Clic */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-2xl border border-slate-100">
            {/* Header Modal */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-black text-slate-800">
                    Historique Exact des Actions — Commande {selectedOrder.store_sequence_number ? `N°${selectedOrder.store_sequence_number}` : selectedOrder.order_number}
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Client: <strong className="text-slate-800">{selectedOrder.customer_name}</strong> ({selectedOrder.customer_phone}) · {selectedOrder.customer_wilaya}
                </p>
              </div>

              <button
                onClick={() => setSelectedOrder(null)}
                className="size-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Articles commandés */}
            {selectedOrder.items && selectedOrder.items.length > 0 && (
              <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100 space-y-2">
                <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Package className="size-3.5 text-indigo-600" /> Articles commandés ({selectedOrder.items.length})
                </h4>
                <div className="space-y-1.5">
                  {selectedOrder.items.map((item, idx) => (
                    <div key={item.id || idx} className="flex items-center justify-between text-xs bg-white p-2.5 rounded-xl border border-slate-100">
                      <span className="font-bold text-slate-800">
                        {item.quantity}× {item.product_name}
                      </span>
                      {item.unit_price > 0 && (
                        <span className="font-mono font-bold text-indigo-600">
                          {(item.unit_price * item.quantity).toLocaleString('fr-FR')} DA
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Suivi NOEST Carrier Events Timeline */}
            <div className="space-y-3">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Truck className="size-4 text-blue-600" /> Événements Transporteur NOEST ({selectedOrder.tracking_number})
              </h4>
              <NoestTrackingPanel
                orderId={selectedOrder.id}
                trackingNumber={selectedOrder.tracking_number}
              />
            </div>

            {/* Journal des Événements ERP (Audit Trail) */}
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <History className="size-4 text-emerald-600" /> Journal d'Activités & Actions de la Commande
              </h4>

              {orderEventsQuery.isLoading ? (
                <div className="py-4 text-center text-xs text-slate-400">Chargement de l'historique...</div>
              ) : !orderEventsQuery.data?.events || orderEventsQuery.data.events.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-400 italic">Aucune action système enregistrée.</div>
              ) : (
                <div className="space-y-2">
                  {orderEventsQuery.data.events.map((ev: any) => (
                    <div key={ev.id} className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-start justify-between gap-3 text-xs">
                      <div>
                        <p className="font-bold text-slate-800">{ev.note || ev.to_status || 'Action système'}</p>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                          {ev.actor_name && <span>Par : <strong>{ev.actor_name}</strong></span>}
                          {ev.from_status && ev.to_status && (
                            <span>Statut : {ev.from_status} ➔ {ev.to_status}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0">
                        {ev.created_at ? new Date(ev.created_at).toLocaleString('fr-FR') : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedOrder(null)}
                className="px-5 py-2.5 rounded-xl bg-slate-800 text-white font-bold text-xs hover:bg-slate-900 transition-all cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer Info */}
      <div className="flex items-center justify-between text-[11px] text-slate-400 border-t border-blue-100/60 pt-2.5 flex-wrap gap-2">
        <span className="flex items-center gap-1.5 font-medium">
          <Clock className="size-3.5 text-slate-400" />
          Dernière mise à jour automatique : {stats?.last_sync ? new Date(stats.last_sync).toLocaleTimeString('fr-FR') : 'À l\'instant'}
        </span>
        <span className="font-bold text-blue-600">
          Sync automatique : Toutes les 12h & On-demand
        </span>
      </div>
    </div>
  );
}
