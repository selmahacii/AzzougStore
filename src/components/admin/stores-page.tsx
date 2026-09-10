'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, ShoppingBag, Package,
   Users, TrendingUp, TrendingDown, DollarSign, Target, BarChart3, CheckCircle, XCircle,
   Clock, Loader2, ChevronRight, ExternalLink, Search, RefreshCw, LayoutTemplate, Globe,
   Facebook, Instagram, Palette, Sparkles, Zap, Crown, Shield,
   Upload, Image as ImageIcon, X, AlertTriangle, Store as StoreIcon, Pencil, ArrowLeft, Plus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip } from 'recharts';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import type { Store, StoreRevenue, StoreDetailStats, RevenueDataPoint, ApiResponse, ThemeConfig, TopItem } from '@/lib/types';
import { StoreWizard } from './store-wizard';

const C = {
   primary: '#4b7bec', primaryBg: '#F0F5FF',
   success: '#20bf6b', successBg: '#E6FFF8',
   danger: '#eb4d4b', dangerBg: '#FFEDE9',
   warning: '#f7b731', warningBg: '#FFF8E6',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

const CHART_COLORS = ['#4b7bec', '#20bf6b', '#0984E3', '#f7b731', '#eb4d4b', '#FD7014'];
const PERIODS = [{ value: '7d', label: '7 jours' }, { value: '30d', label: '30 jours' }, { value: '90d', label: '90 jours' }];

// ─── 3 PALETTES PRÉDÉFINIES ─────────────────────────────
const PALETTES = [
   {
      id: 'denim_blue',
      name: 'Denim Blue',
      icon: <Zap className="size-5 text-white" />,
      primaryColor: '#4b7bec',
      accentColor: '#3867d6',
      bgColor: '#F0F5FF',
      textColor: '#2D3436',
      badge: 'Recommandé',
      badgeColor: '#4b7bec',
      description: 'Confiance, professionnalisme & conversion optimale. La palette signature AzzougShop.',
      gradient: 'from-[#4b7bec] to-[#3867d6]',
   },
   {
      id: 'luxury_noir',
      name: 'Luxury Noir',
      icon: <Crown className="size-5 text-white" />,
      primaryColor: '#2D3436',
      accentColor: '#FDCB6E',
      bgColor: '#F8F9FC',
      textColor: '#2D3436',
      badge: 'Premium',
      badgeColor: '#FDCB6E',
      description: 'Élégance absolue. Pour les marques mode, bijoux et maroquinerie haut de gamme.',
      gradient: 'from-[#2D3436] to-[#636E72]',
   },
   {
      id: 'emerald_fresh',
      name: 'Emerald Fresh',
      icon: <Sparkles className="size-5 text-white" />,
      primaryColor: '#00B894',
      accentColor: '#00cec9',
      bgColor: '#E6FFF8',
      textColor: '#2D3436',
      badge: 'Naturel',
      badgeColor: '#00B894',
      description: 'Fraîcheur, santé et nature. Idéal pour le bio, la beauté et l\'alimentation.',
      gradient: 'from-[#00B894] to-[#00cec9]',
   },
];

const TEMPLATES = [
   {
      id: 'minimalist',
      name: 'Minimalist Store',
      preview: '#4b7bec',
      description: 'Grille produits épurée, navigation rapide, design neutre & réutilisable.',
      tags: ['Grille Produits', 'Navigation Rapide', 'Design Neutre', 'Multi-catégories'],
      icon: <Zap className="size-5 text-white"/>,
      badge: 'Boutique',
   },
   {
      id: 'landing',
      name: 'Landing Page',
      preview: '#e84393',
      description: 'Page ads haute-conversion avec Hero, bénéfices produit, preuves sociales et CTA.',
      tags: ['Hero Impact', 'Social Proof', 'CTA Multiples', 'Mobile-First'],
      icon: <Crown className="size-5 text-white"/>,
      badge: 'Conversion',
   },
];

const tooltipStyle = {
   backgroundColor: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: '8px',
   boxShadow: '0 4px 12px rgba(0,0,0,0.05)', padding: '12px', fontSize: '11px',
   fontWeight: 600, color: C.textLight,
};

function formatShortCurrency(amount: number) {
   if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
   if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
   return amount.toString();
}

function StoreGrid({ onSelectStore, onEditStore }: { onSelectStore: (s: Store) => void; onEditStore: (s: Store) => void }) {
   console.log('[StoreGrid] Component Rendered');
   const qc = useQueryClient();
   const { data: storesRes, isLoading } = useQuery<any>({
      queryKey: ['stores'],
      queryFn: () => apiFetch('/api/v1/stores'),
   });
   const { data: revRes } = useQuery<ApiResponse<StoreRevenue[]>>({
      queryKey: ['stores-revenue'],
      queryFn: () => apiFetch('/api/v1/stores/analytics?period=30d'),
      retry: false,
      throwOnError: false,
   });

   // Handle both direct array and wrapped ApiResponse response
   const stores = (Array.isArray(storesRes) ? storesRes : (storesRes as any)?.data) || [];
   
   if (typeof window !== 'undefined') {
      (window as any).STORES_RAW = storesRes;
      (window as any).STORES_PROCESSED = stores;
   }

   if (!Array.isArray(stores)) {
      console.error('[StoreGrid] CRITICAL: stores is not an array after processing:', stores);
      return <div className="p-12 text-center bg-rose-50 rounded-[32px] border border-rose-100 text-rose-500 font-bold">Erreur de structure de données (voir console)</div>;
   }

   const revenues = new Map((revRes?.data ?? []).map(r => [r.storeId, r]));
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

   if (isLoading) return <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{[1, 2, 3].map(i => <Skeleton key={i} className="h-64 rounded-3xl" />)}</div>;

   return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
         {stores.map((store) => {
            const rev = revenues.get(store.id);
            const total = rev?.totalRevenue ?? 0;
            const change = rev?.change ?? 0;
            const counts = store._count;
            const primaryColor = store.theme_config?.primaryColor || C.primary;

            return (
               <div key={store.id} className="bg-white rounded-[32px] border flex flex-col overflow-hidden hover:shadow-xl hover:shadow-indigo-50/50 transition-all group" style={{ borderColor: C.border }}>
                  {/* Color bar top */}
                  <div className="h-1.5 w-full" style={{ background: `linear-gradient(to right, ${primaryColor}, ${primaryColor}99)` }} />
                  <div className="p-8 flex-1 flex flex-col gap-6">
                     <div className="flex items-center gap-4">
                        <div className="size-14 rounded-2xl shrink-0 overflow-hidden shadow-lg" style={{ background: `linear-gradient(135deg, ${primaryColor}, ${primaryColor}CC)` }}>
                           {store.logo_url ? (
                              <img src={store.logo_url} alt={store.name} className="size-full object-contain bg-white p-1" />
                           ) : (
                              <div className="size-full flex items-center justify-center font-bold text-white text-xl">{store.name.charAt(0)}</div>
                           )}
                        </div>
                        <div className="flex-1 min-w-0">
                           <div className="flex items-center gap-2">
                              <h3 className="text-base font-bold text-slate-900 truncate">{store.name}</h3>
                              <div className={cn("size-2 rounded-full", store.is_active ? "bg-emerald-500" : "bg-rose-500")} />
                           </div>
                           <div className="flex items-center gap-2 mt-0.5">
                              <a 
                                 href={store.domain ? (store.domain.startsWith('http') ? store.domain : `https://${store.domain}`) : `https://${store.slug}.azghub.com`} 
                                 target="_blank" 
                                 rel="noreferrer" 
                                 className="text-[10px] font-bold text-slate-400 hover:text-[#4b7bec] transition-colors flex items-center gap-1 tracking-wider uppercase"
                              >
                                 {store.domain ? store.domain : `${store.slug}.azghub.com`} <ExternalLink className="size-3" />
                              </a>
                              <button onClick={() => setDeleteStore(store)} className="size-6 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all">
                                 <Trash2 className="size-3" />
                              </button>
                           </div>
                        </div>
                     </div>

                     <div className="grid grid-cols-3 gap-3">
                        {[
                           { icon: <ShoppingBag className="mx-auto size-4 text-slate-300 mb-1.5" />, value: counts?.orders ?? 0, label: 'Commandes' },
                           { icon: <Package className="mx-auto size-4 text-slate-300 mb-1.5" />, value: counts?.products ?? 0, label: 'Produits' },
                           { icon: <Users className="mx-auto size-4 text-slate-300 mb-1.5" />, value: counts?.employees ?? 0, label: 'Équipe' },
                        ].map((item, i) => (
                           <div key={i} className="bg-slate-50/50 rounded-2xl p-3 text-center border border-slate-50 group-hover:bg-white group-hover:border-slate-100 transition-colors">
                              {item.icon}
                              <p className="text-sm font-bold text-slate-800">{item.value}</p>
                              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{item.label}</p>
                           </div>
                        ))}
                     </div>

                     <div className="pt-2">
                        <div className="flex justify-between items-center text-xs font-bold mb-2">
                           <span className="text-slate-400 font-mono">{formatPrice(total)}</span>
                           <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px]", change >= 0 ? "text-emerald-500 bg-emerald-50" : "text-rose-500 bg-rose-50")}>
                              {change >= 0 ? <TrendingUp className="size-3 mr-1" /> : <TrendingDown className="size-3 mr-1" />}
                              {Math.abs(change).toFixed(1)}%
                           </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                           <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${Math.min(Math.max(total > 0 ? 30 + change * 2 : 5, 5), 100)}%`, backgroundColor: primaryColor }} />
                        </div>
                     </div>
                  </div>

                  <div className="border-t bg-slate-50/50 p-4 flex items-center justify-between" style={{ borderColor: C.border }}>
                     <button onClick={() => onEditStore(store)} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-900 hover:bg-white hover:shadow-sm transition-all flex items-center gap-2">
                        <Pencil className="size-3.5" /> Configurer
                     </button>
                     <button onClick={() => onSelectStore(store)} className="px-4 py-2 rounded-xl text-xs font-bold text-white transition-all shadow-md flex items-center gap-2" style={{ backgroundColor: primaryColor }}>
                        <BarChart3 className="size-3.5" /> Statistiques
                     </button>
                  </div>
               </div>
            );
         })}

         {/* Delete Confirmation Dialog */}
         <Dialog open={!!deleteStore} onOpenChange={(o) => !o && setDeleteStore(null)}>
            <DialogContent title="Supprimer la boutique" className="max-w-md bg-white rounded-[32px] border-none p-0 overflow-hidden shadow-2xl">
               <div className="p-8 text-center">
                  <div className="size-20 rounded-[32px] bg-rose-50 text-rose-500 flex items-center justify-center mx-auto mb-6 shadow-inner">
                     <AlertTriangle className="size-10" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900 mb-2">Supprimer la boutique ?</h3>
                  <p className="text-sm text-slate-400 font-medium leading-relaxed">
                     Êtes-vous sûr de vouloir supprimer <span className="font-bold text-slate-900">"{deleteStore?.name}"</span> ? <br/>
                     Les produits seront désactivés. Les commandes et revenus sont conservés. Cette action est irréversible.
                  </p>
               </div>
               <DialogFooter className="bg-slate-50/80 p-6 flex flex-col sm:flex-row gap-3 border-t">
                  <Button variant="ghost" onClick={() => setDeleteStore(null)} className="flex-1 h-12 rounded-2xl font-bold text-slate-400">
                     Annuler
                  </Button>
                  <Button 
                     onClick={() => deleteStore && deleteMutation.mutate(deleteStore.id)}
                     disabled={deleteMutation.isPending}
                     className="flex-1 h-12 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-bold shadow-lg shadow-rose-200"
                  >
                     {deleteMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : 'Confirmer la suppression'}
                  </Button>
               </DialogFooter>
            </DialogContent>
         </Dialog>
      </div>
   );
}

// ─── STORE ANALYTICS ────────────────────────────────────
function StoreAnalytics({ store, onBack }: { store: Store; onBack: () => void }) {
   const [period, setPeriod] = useState('30d');
   const color = store.theme_config?.primaryColor || C.primary;

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
   const revData = (revRes.data?.data ?? []).map(d => ({ ...d, date: new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) }));
   const topProducts = productsRes.data?.data ?? [];

   return (
      <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 pb-20">
         <div className="flex items-center justify-between">
            <button onClick={onBack} className="flex items-center gap-2 text-xs font-bold text-[#636E72] hover:text-[#2D3436] bg-white border px-4 py-2 rounded-xl" style={{ borderColor: C.border }}>
               <ArrowLeft className="size-4" /> Retour aux magasins
            </button>
            <div className="flex gap-1 bg-[#F8F9FC] p-1 rounded-lg border" style={{ borderColor: C.border }}>
               {PERIODS.map(p => (
                  <button key={p.value} onClick={() => setPeriod(p.value)} className={cn("px-4 py-1.5 text-[11px] font-bold rounded-md transition-all", period === p.value ? "bg-white shadow text-[#2D3436]" : "text-[#B2BEC3] hover:text-[#636E72]")}>
                     {p.label}
                  </button>
               ))}
            </div>
         </div>

         {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
               {[
                  { label: 'Revenu Total', value: formatPrice(stats.total_revenue), sub: `${stats.revenue_change >= 0 ? '+' : ''}${stats.revenue_change?.toFixed(1)}%`, icon: <DollarSign className="size-4 text-[#6C5CE7]" />, bg: '#F0EDFF', positive: (stats.revenue_change ?? 0) >= 0 },
                  { label: 'Livrées', value: formatPrice((stats.delivered_orders ?? 0) * (stats.avg_order_value ?? 0)), sub: `${stats.delivered_orders} commandes`, icon: <CheckCircle className="size-4 text-[#00B894]" />, bg: '#E6FFF8', positive: true },
                  { label: 'En Attente', value: stats.pending_orders?.toString(), sub: 'À confirmer', icon: <Clock className="size-4 text-[#FDCB6E]" />, bg: '#FFF8E6', positive: true },
                  { label: 'Taux Retour', value: `${stats.return_rate?.toFixed(1)}%`, sub: `${stats.returned_orders} retours`, icon: <TrendingDown className="size-4 text-[#E17055]" />, bg: '#FFEDE9', positive: false },
               ].map((item, i) => (
                  <div key={i} className="bg-white p-5 rounded-2xl border shadow-sm" style={{ borderColor: C.border }}>
                     <div className="flex items-center gap-3 mb-3">
                        <div className="size-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: item.bg }}>{item.icon}</div>
                        <p className="text-[10px] font-bold text-[#636E72] uppercase tracking-wider">{item.label}</p>
                     </div>
                     <p className="text-xl font-extrabold text-[#2D3436]">{item.value}</p>
                     <p className={cn("text-[10px] font-bold mt-1", item.positive ? "text-[#00B894]" : "text-[#E17055]")}>{item.sub}</p>
                  </div>
               ))}
            </div>
         )}

         <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-2xl border p-6 shadow-sm" style={{ borderColor: C.border }}>
               <h3 className="text-xs font-extrabold text-[#2D3436] uppercase tracking-widest flex items-center gap-2 mb-6">
                  <TrendingUp className="size-4 text-[#6C5CE7]" /> Évolution des revenus
               </h3>
               <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                     <AreaChart data={revData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E9ECF0" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#B2BEC3' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: '#B2BEC3' }} axisLine={false} tickLine={false} tickFormatter={formatShortCurrency} />
                        <RechartsTooltip contentStyle={tooltipStyle} cursor={{ stroke: '#E9ECF0' }} />
                        <Area type="monotone" dataKey="revenue" stroke={color} strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
                        <defs>
                           <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                              <stop offset="95%" stopColor={color} stopOpacity={0} />
                           </linearGradient>
                        </defs>
                     </AreaChart>
                  </ResponsiveContainer>
               </div>
            </div>

            <div className="bg-white rounded-2xl border p-6 shadow-sm flex flex-col" style={{ borderColor: C.border }}>
               <h3 className="text-xs font-extrabold text-[#2D3436] uppercase tracking-widest mb-6 flex items-center gap-2">
                  <ShoppingBag className="size-4 text-[#00B894]" /> Top Produits
               </h3>
               <div className="flex-1 space-y-4 overflow-y-auto max-h-[320px] pr-2">
                  {topProducts.length > 0 ? topProducts.map((p, i) => (
                     <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-[#F8F9FC] border border-[#E9ECF0] hover:border-[#6C5CE7]/30 transition-all">
                        <div className="flex items-center gap-3">
                           <div className="size-8 rounded-lg bg-white border flex items-center justify-center font-bold text-[10px] text-[#6C5CE7]">#{i + 1}</div>
                           <div>
                              <p className="text-xs font-bold text-[#2D3436] truncate max-w-[120px]">{p.name}</p>
                              <p className="text-[9px] font-bold text-[#B2BEC3]">{p.count} ventes</p>
                           </div>
                        </div>
                        <p className="text-xs font-extrabold text-[#2D3436]">{formatPrice(p.value)}</p>
                     </div>
                  )) : (
                     <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-[#F8F9FC] rounded-2xl border border-dashed">
                        <Package className="size-8 text-[#B2BEC3] mb-2 opacity-50" />
                        <p className="text-[10px] font-bold text-[#B2BEC3] uppercase">Aucune donnée</p>
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
   const qc = useQueryClient();

   const handleSelectStore = (store: Store) => {
      setSelectedStore(store);
      setView('analytics');
   };

   const handleEditStore = (store: Store) => {
      setEditStore(store);
      setIsCreateModalOpen(true);
   };

   // Toggle store active
   const toggleMutation = useMutation({
      mutationFn: (id: string) => apiFetch(`/api/v1/stores/${id}/toggle`, { method: 'PATCH' }),
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['stores'] });
         toast.success('Statut de la boutique mis à jour');
      },
   });

   return (
      <div className="space-y-8 p-8 max-w-[1800px] mx-auto">
         {/* Header */}
         <div className="flex items-center justify-between">
            <div>
               <div className="flex items-center gap-3 mb-1">
                  <div className="size-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: C.primaryBg }}>
                     <StoreIcon className="size-6" style={{ color: C.primary }} />
                  </div>
                  <div>
                     <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight">
                        {view === 'analytics' && selectedStore ? selectedStore.name : 'Hub Boutiques'}
                     </h1>
                     <p className="text-xs font-bold text-slate-400">
                        {view === 'analytics' ? 'Analytics de performance' : 'Gérez votre réseau de boutiques multi-tenant'}
                     </p>
                  </div>
               </div>
            </div>
            {view === 'grid' && (
               <Button
                  onClick={() => { setEditStore(null); setIsCreateModalOpen(true); }}
                  className="h-12 px-6 rounded-xl font-bold text-white shadow-lg"
                  style={{ backgroundColor: C.primary }}
               >
                  <Plus className="size-4 mr-2" /> Nouvelle Boutique
               </Button>
            )}
         </div>

         {view === 'grid' ? (
            <StoreGrid onSelectStore={handleSelectStore} onEditStore={handleEditStore} />
         ) : selectedStore ? (
            <StoreAnalytics store={selectedStore} onBack={() => { setView('grid'); setSelectedStore(null); }} />
         ) : null}

         <StoreWizard
            open={isCreateModalOpen}
            onOpenChange={(o) => { setIsCreateModalOpen(o); if (!o) setEditStore(null); }}
            initialData={editStore}
         />
      </div>
   );
}
