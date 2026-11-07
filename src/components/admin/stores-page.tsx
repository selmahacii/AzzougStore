'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Trash2, 
  ShoppingBag, 
  Package,
  Users, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  BarChart3, 
  CheckCircle, 
  Clock, 
  Loader2, 
  ExternalLink, 
  Search, 
  RefreshCw, 
  Globe,
  AlertTriangle, 
  Store as StoreIcon, 
  Pencil, 
  ArrowLeft, 
  Plus,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Eye,
  Layers
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip } from 'recharts';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api-client';
import type { Store, StoreRevenue, StoreDetailStats, RevenueDataPoint, ApiResponse, TopItem } from '@/lib/types';
import { StoreWizard } from './store-wizard';

const PERIODS = [
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
  { value: '90d', label: '90 jours' }
];

const tooltipStyle = {
  backgroundColor: '#FFFFFF',
  border: '1px solid #E9ECF0',
  borderRadius: '12px',
  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)',
  padding: '12px 16px',
  fontSize: '11px',
  fontWeight: 700,
  color: '#2D3436',
};

function formatShortCurrency(amount: number) {
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}k`;
  return amount.toString();
}

// ─── STORE GRID ──────────────────────────────────────────
function StoreGrid({ 
  onSelectStore, 
  onEditStore,
  searchQuery,
  statusFilter
}: { 
  onSelectStore: (s: Store) => void; 
  onEditStore: (s: Store) => void;
  searchQuery: string;
  statusFilter: 'ALL' | 'ACTIVE' | 'INACTIVE';
}) {
  const qc = useQueryClient();
  const { data: storesRes, isLoading, refetch, isRefetching } = useQuery<any>({
    queryKey: ['stores'],
    queryFn: () => apiFetch('/api/v1/stores'),
  });

  const { data: revRes } = useQuery<ApiResponse<StoreRevenue[]>>({
    queryKey: ['stores-revenue'],
    queryFn: () => apiFetch('/api/v1/stores/analytics?period=30d'),
    retry: false,
    throwOnError: false,
  });

  const stores: Store[] = (Array.isArray(storesRes) ? storesRes : (storesRes as any)?.data) || [];
  const revenues = useMemo(() => new Map((revRes?.data ?? []).map(r => [r.storeId, r])), [revRes]);
  const [deleteStore, setDeleteStore] = useState<Store | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/stores/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stores'] });
      toast.success('Boutique supprimée avec succès');
      setDeleteStore(null);
    },
    onError: (err: any) => toast.error(err.message || 'Erreur lors de la suppression'),
  });

  // Filtered stores
  const filteredStores = useMemo(() => {
    return stores.filter((store) => {
      if (statusFilter === 'ACTIVE' && !store.is_active) return false;
      if (statusFilter === 'INACTIVE' && store.is_active) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const name = (store.name || '').toLowerCase();
        const slug = (store.slug || '').toLowerCase();
        const domain = (store.domain || '').toLowerCase();
        return name.includes(q) || slug.includes(q) || domain.includes(q);
      }

      return true;
    });
  }, [stores, searchQuery, statusFilter]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4 animate-pulse">
            <div className="flex items-center gap-4">
              <Skeleton className="size-14 rounded-2xl" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-5 w-3/4 rounded-lg" />
                <Skeleton className="h-3 w-1/2 rounded-lg" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
              <Skeleton className="h-16 rounded-2xl" />
            </div>
            <Skeleton className="h-12 rounded-2xl" />
          </div>
        ))}
      </div>
    );
  }

  if (filteredStores.length === 0) {
    return (
      <div className="bg-white rounded-[32px] border border-slate-100 p-12 text-center shadow-sm space-y-4">
        <div className="size-16 rounded-2xl bg-indigo-50 text-[#4b7bec] flex items-center justify-center mx-auto shadow-sm">
          <StoreIcon className="size-8" />
        </div>
        <h3 className="text-base font-black text-slate-900 tracking-tight">Aucune boutique trouvée</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          {searchQuery ? `Aucun résultat pour "${searchQuery}". Essayez une autre recherche.` : 'Aucune boutique configurée pour ce filtre.'}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {filteredStores.map((store) => {
        const rev = revenues.get(store.id);
        const total = rev?.totalRevenue ?? 0;
        const change = rev?.change ?? 0;
        const counts = store._count;
        const primaryColor = store.theme_config?.primaryColor || '#4b7bec';
        const displayDomain = store.domain 
          ? (store.domain.replace(/^https?:\/\//, '')) 
          : `${store.slug}.azghub.com`;
        const fullUrl = store.domain 
          ? (store.domain.startsWith('http') ? store.domain : `https://${store.domain}`) 
          : `https://${store.slug}.azghub.com`;

        return (
          <div 
            key={store.id} 
            className="bg-white rounded-[28px] border border-slate-100 flex flex-col overflow-hidden hover:shadow-xl hover:shadow-slate-100/80 transition-all duration-300 group"
          >
            {/* Top brand color accent line */}
            <div 
              className="h-1.5 w-full transition-all group-hover:h-2" 
              style={{ background: `linear-gradient(90deg, ${primaryColor}, ${primaryColor}99)` }} 
            />

            <div className="p-6 flex-1 flex flex-col gap-5">
              {/* Store Identity Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div 
                    className="size-13 rounded-2xl shrink-0 overflow-hidden shadow-md border border-white/40 flex items-center justify-center text-white font-black text-lg"
                    style={{ background: `linear-gradient(135deg, ${primaryColor}, ${primaryColor}CC)` }}
                  >
                    {store.logo_url ? (
                      <img src={store.logo_url} alt={store.name} className="size-full object-contain bg-white p-1" />
                    ) : (
                      store.name.charAt(0).toUpperCase()
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-black text-slate-900 truncate tracking-tight">{store.name}</h3>
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider flex items-center gap-1",
                        store.is_active 
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60" 
                          : "bg-slate-100 text-slate-500 border border-slate-200"
                      )}>
                        <span className={cn("size-1.5 rounded-full", store.is_active ? "bg-emerald-500 animate-pulse" : "bg-slate-400")} />
                        {store.is_active ? 'En ligne' : 'Inactif'}
                      </span>
                    </div>

                    <a 
                      href={fullUrl} 
                      target="_blank" 
                      rel="noreferrer" 
                      className="text-[11px] font-bold text-slate-400 hover:text-[#4b7bec] transition-colors flex items-center gap-1 mt-1 truncate"
                    >
                      <Globe className="size-3 text-slate-400 shrink-0" />
                      <span className="truncate">{displayDomain}</span>
                      <ExternalLink className="size-3 shrink-0 opacity-60 group-hover:opacity-100" />
                    </a>
                  </div>
                </div>

                <button 
                  onClick={() => setDeleteStore(store)} 
                  title="Supprimer la boutique"
                  className="size-8 rounded-xl bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-all flex items-center justify-center shrink-0 border border-slate-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              {/* Core Store Metrics (Commandes, Produits, Equipe) */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="bg-slate-50/70 rounded-2xl p-3 text-center border border-slate-100/80 transition-colors group-hover:bg-white group-hover:border-slate-200/80">
                  <div className="size-7 rounded-xl bg-blue-50 text-[#4b7bec] flex items-center justify-center mx-auto mb-1.5 shadow-2xs">
                    <ShoppingBag className="size-3.5" />
                  </div>
                  <p className="text-sm font-black text-slate-900 font-mono">{counts?.orders ?? 0}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">Commandes</p>
                </div>

                <div className="bg-slate-50/70 rounded-2xl p-3 text-center border border-slate-100/80 transition-colors group-hover:bg-white group-hover:border-slate-200/80">
                  <div className="size-7 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-1.5 shadow-2xs">
                    <Package className="size-3.5" />
                  </div>
                  <p className="text-sm font-black text-slate-900 font-mono">{counts?.products ?? 0}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">Produits</p>
                </div>

                <div className="bg-slate-50/70 rounded-2xl p-3 text-center border border-slate-100/80 transition-colors group-hover:bg-white group-hover:border-slate-200/80">
                  <div className="size-7 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-1.5 shadow-2xs">
                    <Users className="size-3.5" />
                  </div>
                  <p className="text-sm font-black text-slate-900 font-mono">{counts?.employees ?? 0}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">Équipe</p>
                </div>
              </div>

              {/* Financial Performance Bar */}
              <div className="space-y-2 pt-1 border-t border-slate-100/80">
                <div className="flex items-center justify-between text-xs">
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Revenus (30j)</span>
                    <p className="text-sm font-black text-slate-900 font-mono">{formatPrice(total)}</p>
                  </div>
                  <span className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-black font-mono border",
                    change >= 0 
                      ? "text-emerald-700 bg-emerald-50 border-emerald-200" 
                      : "text-rose-700 bg-rose-50 border-rose-200"
                  )}>
                    {change >= 0 ? <TrendingUp className="size-3 mr-1" /> : <TrendingDown className="size-3 mr-1" />}
                    {Math.abs(change).toFixed(1)}%
                  </span>
                </div>

                <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all duration-700" 
                    style={{ 
                      width: `${Math.min(Math.max(total > 0 ? 30 + change * 2 : 5, 5), 100)}%`, 
                      backgroundColor: primaryColor 
                    }} 
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons Footer */}
            <div className="border-t border-slate-100 bg-slate-50/50 p-3.5 flex items-center justify-between gap-2">
              <a
                href={fullUrl}
                target="_blank"
                rel="noreferrer"
                className="h-9 px-3 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200 transition-all flex items-center gap-1.5"
              >
                <Eye className="size-3.5" /> Visiter
              </a>

              <div className="flex items-center gap-2">
                <button 
                  onClick={() => onEditStore(store)} 
                  className="h-9 px-3.5 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center gap-1.5 shadow-2xs"
                >
                  <Pencil className="size-3.5 text-slate-500" /> Configurer
                </button>
                <button 
                  onClick={() => onSelectStore(store)} 
                  className="h-9 px-4 rounded-xl text-xs font-black text-white transition-all shadow-sm hover:opacity-95 flex items-center gap-1.5" 
                  style={{ backgroundColor: primaryColor }}
                >
                  <BarChart3 className="size-3.5" /> Statistiques
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Delete Confirmation Modal */}
      <Dialog open={!!deleteStore} onOpenChange={(o) => !o && setDeleteStore(null)}>
        <DialogContent className="max-w-md bg-white rounded-[32px] border-none p-0 overflow-hidden shadow-2xl">
          <div className="p-8 text-center space-y-4">
            <div className="size-16 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center mx-auto shadow-inner">
              <AlertTriangle className="size-8" />
            </div>
            <h3 className="text-lg font-black text-slate-900 tracking-tight">Supprimer la boutique ?</h3>
            <p className="text-xs text-slate-400 font-medium leading-relaxed">
              Êtes-vous sûr de vouloir supprimer <span className="font-bold text-slate-900">"{deleteStore?.name}"</span> ? <br/>
              Les produits et vitrines seront désactivés. Les commandes et l'historique financier restent conservés.
            </p>
          </div>
          <DialogFooter className="bg-slate-50 p-6 flex flex-col sm:flex-row gap-3 border-t border-slate-100">
            <Button 
              variant="outline" 
              onClick={() => setDeleteStore(null)} 
              className="flex-1 h-11 rounded-xl font-bold text-xs border-slate-200 hover:bg-slate-100"
            >
              Annuler
            </Button>
            <Button 
              onClick={() => deleteStore && deleteMutation.mutate(deleteStore.id)}
              disabled={deleteMutation.isPending}
              className="flex-1 h-11 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md shadow-rose-100"
            >
              {deleteMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : 'Confirmer la suppression'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── STORE ANALYTICS VIEW ─────────────────────────────────
function StoreAnalytics({ store, onBack }: { store: Store; onBack: () => void }) {
  const [period, setPeriod] = useState('30d');
  const color = store.theme_config?.primaryColor || '#4b7bec';

  const statsRes = useQuery<ApiResponse<StoreDetailStats>>({
    queryKey: ['stats', store.id, period],
    queryFn: () => apiFetch(`/api/v1/analytics?type=store-stats&store_id=${store.id}&period=${period}`),
  });
  const revRes = useQuery<ApiResponse<RevenueDataPoint[]>>({
    queryKey: ['rev', store.id, period],
    queryFn: () => apiFetch(`/api/v1/analytics?store_id=${store.id}&type=revenue&period=${period}`),
  });
  const productsRes = useQuery<ApiResponse<TopItem[]>>({
    queryKey: ['top-products', store.id, period],
    queryFn: () => apiFetch(`/api/v1/analytics?store_id=${store.id}&type=products&period=${period}`),
  });

  const stats = statsRes.data?.data;
  const revData = (revRes.data?.data ?? []).map(d => ({ 
    ...d, 
    date: new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) 
  }));
  const topProducts = productsRes.data?.data ?? [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300 pb-16">
      {/* Top Navigation Bar */}
      <div className="bg-white rounded-2xl sm:rounded-[28px] border border-slate-100 p-4 sm:p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack} 
            className="size-10 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all flex items-center justify-center shrink-0"
            title="Retour aux boutiques"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">{store.name}</h2>
              <span className="px-2 py-0.5 rounded-lg text-[9px] font-black uppercase font-mono bg-indigo-50 text-[#4b7bec] border border-indigo-100">
                Statistiques
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">Analyse de conversion et de rentabilité</p>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-slate-50 border border-slate-200/80 rounded-xl p-1 shadow-2xs">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap",
                period === p.value 
                  ? "bg-white text-slate-900 shadow-xs font-black" 
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { 
              label: 'Revenu Total', 
              value: formatPrice(stats.total_revenue), 
              sub: `${stats.revenue_change >= 0 ? '+' : ''}${stats.revenue_change?.toFixed(1)}% vs période préc.`, 
              icon: <DollarSign className="size-4 text-[#4b7bec]" />, 
              bg: 'bg-blue-50', 
              positive: (stats.revenue_change ?? 0) >= 0 
            },
            { 
              label: 'Livrées & Encaissées', 
              value: formatPrice((stats.delivered_orders ?? 0) * (stats.avg_order_value ?? 0)), 
              sub: `${stats.delivered_orders} commandes livrées`, 
              icon: <CheckCircle className="size-4 text-emerald-600" />, 
              bg: 'bg-emerald-50', 
              positive: true 
            },
            { 
              label: 'En Traitement', 
              value: stats.pending_orders?.toString() ?? '0', 
              sub: 'Commandes en attente', 
              icon: <Clock className="size-4 text-amber-600" />, 
              bg: 'bg-amber-50', 
              positive: true 
            },
            { 
              label: 'Taux de Retour', 
              value: `${stats.return_rate?.toFixed(1)}%`, 
              sub: `${stats.returned_orders} retours colis`, 
              icon: <TrendingDown className="size-4 text-rose-600" />, 
              bg: 'bg-rose-50', 
              positive: false 
            },
          ].map((item, i) => (
            <div key={i} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{item.label}</p>
                <div className={cn("size-8 rounded-xl flex items-center justify-center", item.bg)}>
                  {item.icon}
                </div>
              </div>
              <div>
                <p className="text-xl font-black text-slate-900 font-mono">{item.value}</p>
                <p className={cn("text-[10px] font-bold mt-1", item.positive ? "text-emerald-600" : "text-rose-600")}>
                  {item.sub}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Main Chart + Top Products */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl sm:rounded-[28px] border border-slate-100 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <TrendingUp className="size-4 text-[#4b7bec]" /> Évolution des Revenus
            </h3>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">
              Devise : Dinar Algérien (DA)
            </span>
          </div>
          <div className="h-[320px] pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E9ECF0" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#636E72', fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#636E72', fontWeight: 600 }} axisLine={false} tickLine={false} tickFormatter={formatShortCurrency} />
                <RechartsTooltip contentStyle={tooltipStyle} cursor={{ stroke: '#4b7bec', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Area type="monotone" dataKey="revenue" stroke={color} strokeWidth={3} fillOpacity={1} fill="url(#colorStoreRev)" />
                <defs>
                  <linearGradient id="colorStoreRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-2xl sm:rounded-[28px] border border-slate-100 p-6 shadow-sm flex flex-col space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Package className="size-4 text-emerald-600" /> Top Produits
            </h3>
            <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">{topProducts.length} articles</span>
          </div>

          <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[320px] pr-1">
            {topProducts.length > 0 ? topProducts.map((p, i) => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50/70 border border-slate-100 hover:border-slate-200 transition-all">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="size-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center font-black text-[10px] text-slate-700 shrink-0 shadow-2xs">
                    #{i + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">{p.name}</p>
                    <p className="text-[10px] font-bold text-slate-400 font-mono">{p.count} ventes</p>
                  </div>
                </div>
                <p className="text-xs font-black text-slate-900 font-mono shrink-0 pl-2">{formatPrice(p.value)}</p>
              </div>
            )) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                <Package className="size-8 text-slate-300 mb-2" />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Aucune vente enregistrée</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────
export default function StoresPage() {
  const [view, setView] = useState<'grid' | 'analytics'>('grid');
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editStore, setEditStore] = useState<Store | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const qc = useQueryClient();

  const { data: storesRes, refetch, isRefetching } = useQuery<any>({
    queryKey: ['stores'],
    queryFn: () => apiFetch('/api/v1/stores'),
  });

  const { data: revRes } = useQuery<ApiResponse<StoreRevenue[]>>({
    queryKey: ['stores-revenue'],
    queryFn: () => apiFetch('/api/v1/stores/analytics?period=30d'),
    retry: false,
    throwOnError: false,
  });

  const stores: Store[] = (Array.isArray(storesRes) ? storesRes : (storesRes as any)?.data) || [];

  // Global KPIs across the multi-tenant network
  const kpiData = useMemo(() => {
    const totalStores = stores.length;
    const activeStores = stores.filter(s => s.is_active).length;
    const totalOrders = stores.reduce((sum, s) => sum + (s._count?.orders || 0), 0);
    const totalProducts = stores.reduce((sum, s) => sum + (s._count?.products || 0), 0);
    const totalEmployees = stores.reduce((sum, s) => sum + (s._count?.employees || 0), 0);
    const totalRevenue = (revRes?.data ?? []).reduce((sum, r) => sum + (r.totalRevenue || 0), 0);

    return { totalStores, activeStores, totalOrders, totalProducts, totalEmployees, totalRevenue };
  }, [stores, revRes]);

  const handleSelectStore = (store: Store) => {
    setSelectedStore(store);
    setView('analytics');
  };

  const handleEditStore = (store: Store) => {
    setEditStore(store);
    setIsCreateModalOpen(true);
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#F8F9FC] animate-in fade-in duration-500">
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1700px] mx-auto w-full">

        {/* ─── MAIN HEADER (Meta Ads Template) ─── */}
        <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 p-6 lg:p-7 shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative overflow-hidden">
          <div className="flex items-center gap-4 relative z-10">
            <div className="size-12 rounded-2xl bg-indigo-50 text-[#4b7bec] flex items-center justify-center shadow-xs shrink-0">
              <StoreIcon className="size-6 text-[#4b7bec]" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  {view === 'analytics' && selectedStore ? selectedStore.name : 'Hub Boutiques'}
                </h1>
                <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase font-mono bg-indigo-50 text-[#4b7bec] border border-indigo-100">
                  Multi-Tenant
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {view === 'analytics' 
                  ? 'Performances analytiques et rentabilité de la boutique' 
                  : 'Gérez votre réseau de boutiques multi-tenant, vitrines en ligne et configurations de marque'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full lg:w-auto relative z-10 flex-wrap sm:flex-nowrap">
            <Button
              variant="outline"
              onClick={() => { refetch(); qc.invalidateQueries({ queryKey: ['stores-revenue'] }); }}
              disabled={isRefetching}
              className="h-11 px-4 rounded-xl text-xs font-bold border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all shadow-xs"
            >
              <RefreshCw className={cn("size-3.5 mr-2", isRefetching && "animate-spin")} />
              Actualiser
            </Button>

            {view === 'grid' && (
              <Button
                onClick={() => { setEditStore(null); setIsCreateModalOpen(true); }}
                className="h-11 px-6 rounded-xl text-xs font-black bg-[#4b7bec] hover:bg-[#3867d6] text-white shadow-md shadow-blue-100 transition-all flex items-center gap-2 border-none"
              >
                <Plus className="size-4" /> Nouvelle Boutique
              </Button>
            )}
          </div>
        </div>

        {/* ─── GLOBAL NETWORK KPIS ROW ─── */}
        {view === 'grid' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl sm:rounded-[24px] border border-slate-100 p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Réseau Boutiques</span>
                <div className="size-8 rounded-xl bg-blue-50 text-[#4b7bec] flex items-center justify-center">
                  <StoreIcon className="size-4" />
                </div>
              </div>
              <div>
                <p className="text-2xl font-black text-slate-900 font-mono">{kpiData.totalStores}</p>
                <p className="text-[10px] font-bold text-emerald-600 mt-0.5">
                  {kpiData.activeStores} active{kpiData.activeStores > 1 ? 's' : ''} sur le réseau
                </p>
              </div>
            </div>

            <div className="bg-white rounded-2xl sm:rounded-[24px] border border-slate-100 p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Commandes Réseau</span>
                <div className="size-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <ShoppingBag className="size-4" />
                </div>
              </div>
              <div>
                <p className="text-2xl font-black text-slate-900 font-mono">{kpiData.totalOrders}</p>
                <p className="text-[10px] font-bold text-slate-400 mt-0.5">Toutes boutiques confondues</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl sm:rounded-[24px] border border-slate-100 p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Chiffre d'Affaires Global</span>
                <div className="size-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <DollarSign className="size-4" />
                </div>
              </div>
              <div>
                <p className="text-2xl font-black text-slate-900 font-mono">{formatPrice(kpiData.totalRevenue)}</p>
                <p className="text-[10px] font-bold text-emerald-600 mt-0.5">Volume encaissé (30j)</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl sm:rounded-[24px] border border-slate-100 p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Articles & Catalogues</span>
                <div className="size-8 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
                  <Package className="size-4" />
                </div>
              </div>
              <div>
                <p className="text-2xl font-black text-slate-900 font-mono">{kpiData.totalProducts}</p>
                <p className="text-[10px] font-bold text-slate-400 mt-0.5">{kpiData.totalEmployees} collaborateurs assignés</p>
              </div>
            </div>
          </div>
        )}

        {/* ─── TACTICAL FILTER & SEARCH BAR ─── */}
        {view === 'grid' && (
          <div className="bg-white rounded-2xl sm:rounded-[24px] border border-slate-100 p-3.5 sm:p-4 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
              <Input
                placeholder="Rechercher une boutique, slug ou domaine..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-10 bg-slate-50 border-slate-200 rounded-xl text-xs font-medium focus-visible:ring-[#4b7bec]"
              />
            </div>

            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200/80 rounded-xl p-1 shrink-0 overflow-x-auto">
              {[
                { id: 'ALL', label: `Toutes (${stores.length})` },
                { id: 'ACTIVE', label: `En ligne (${stores.filter(s => s.is_active).length})` },
                { id: 'INACTIVE', label: `Inactives (${stores.filter(s => !s.is_active).length})` },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setStatusFilter(tab.id as any)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap",
                    statusFilter === tab.id 
                      ? "bg-white text-slate-900 shadow-xs font-black" 
                      : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── MAIN CONTENT VIEW ─── */}
        {view === 'grid' ? (
          <StoreGrid 
            onSelectStore={handleSelectStore} 
            onEditStore={handleEditStore} 
            searchQuery={searchQuery}
            statusFilter={statusFilter}
          />
        ) : selectedStore ? (
          <StoreAnalytics store={selectedStore} onBack={() => { setView('grid'); setSelectedStore(null); }} />
        ) : null}

        {/* Store Creation / Configuration Wizard Modal */}
        <StoreWizard
          open={isCreateModalOpen}
          onOpenChange={(o) => { setIsCreateModalOpen(o); if (!o) setEditStore(null); }}
          initialData={editStore}
        />
      </div>
    </div>
  );
}
