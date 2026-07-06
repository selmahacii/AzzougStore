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
                              <a href={`/${store.slug}`} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-slate-400 hover:text-[#4b7bec] transition-colors flex items-center gap-1 tracking-wider uppercase">
                                 /{store.slug} <ExternalLink className="size-3" />
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

// ─── CREATE / EDIT STORE MODAL ────────────────────────────
function CreateStoreModal({ open, onOpenChange, initialData }: { open: boolean; onOpenChange: (o: boolean) => void; initialData?: Store | null }) {
   const [step, setStep] = useState(1);
   const [selectedPalette, setSelectedPalette] = useState<string>(
      PALETTES.find(p => p.primaryColor === initialData?.theme_config?.primaryColor)?.id || 'denim_blue'
   );
   const { user, activeStore, setActiveStore, setAllStores } = useAppStore();
   const [isUploadingLogo, setIsUploadingLogo] = useState(false);
   const [isUploadingBanner, setIsUploadingBanner] = useState(false);

   const [formData, setFormData] = useState({
      name: initialData?.name || '',
      slug: initialData?.slug || '',
      description: initialData?.description || '',
      template_id: initialData?.template_id || 'modern',
      primaryColor: initialData?.theme_config?.primaryColor || '#4b7bec',
      domain: initialData?.domain || '',
      social_links: initialData?.social_links || { facebook: '', instagram: '' },
      currency: initialData?.currency || 'DZD',
      language: initialData?.language || 'fr',
      logo_url: initialData?.logo_url || '',
      banner_url: initialData?.banner_url || '',
   });

   const qc = useQueryClient();
   const isEdit = !!initialData;

   const mutation = useMutation({
      mutationFn: (data: any) => isEdit
         ? apiFetch(`/api/v1/stores/${initialData!.id}`, { method: 'PUT', body: JSON.stringify(data) })
         : apiFetch('/api/v1/stores', { method: 'POST', body: JSON.stringify({ ...data, owner_id: user?.id }) }),
      onSuccess: (res: any) => {
         qc.invalidateQueries({ queryKey: ['stores'] });
         qc.invalidateQueries({ queryKey: ['stores-revenue'] });
         // Sync Zustand so storefront colors update immediately
         const updatedStore = res?.data ?? res;
         if (updatedStore?.id) {
            if (activeStore?.id === updatedStore.id) setActiveStore(updatedStore);
            qc.fetchQuery({ queryKey: ['stores'] }).then((data: any) => {
               const list = Array.isArray(data) ? data : (data?.data ?? []);
               if (list.length) setAllStores(list);
            });
         }
         toast.success(isEdit ? 'Boutique mise à jour !' : 'Boutique déployée avec succès !');
         onOpenChange(false);
         setStep(1);
      },
      onError: (err: any) => toast.error(err.message || 'Erreur lors du déploiement'),
   });

   const currentPalette = PALETTES.find(p => p.id === selectedPalette) || PALETTES[0];

   const handleSelectPalette = (palette: typeof PALETTES[0]) => {
      setSelectedPalette(palette.id);
      setFormData(prev => ({ ...prev, primaryColor: palette.primaryColor }));
   };

   const handleSave = () => {
      if (!formData.name || !formData.slug) {
         toast.error('Le nom et le slug sont requis');
         return;
      }
      mutation.mutate({
         ...formData,
         theme_config: {
            primaryColor: formData.primaryColor,
            accentColor: currentPalette.accentColor,
            bgColor: currentPalette.bgColor,
            fontFamily: 'Inter',
            borderRadius: formData.template_id === 'luxury' ? '0px' : '12px',
         },
      });
   };

   const totalSteps = 4;

   const uploadImage = async (file: File): Promise<string> => {
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
      if (!allowed.includes(file.type)) throw new Error('Format non supporté. Utilisez JPEG, PNG, WebP ou AVIF.');
      if (file.size > 20 * 1024 * 1024) throw new Error('Image trop volumineuse. Limite : 20 MB.');
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/v1/upload/image', { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' }, body: fd });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any)?.detail || 'Échec du téléversement'); }
      return ((await res.json()) as { url: string }).url;
   };

   const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]; if (!file) return;
      setIsUploadingLogo(true);
      try { setFormData(p => ({ ...p, logo_url: '' })); const url = await uploadImage(file); setFormData(p => ({ ...p, logo_url: url })); toast.success('Logo téléversé'); }
      catch (err: any) { toast.error(err.message); }
      finally { setIsUploadingLogo(false); e.target.value = ''; }
   };

   const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]; if (!file) return;
      setIsUploadingBanner(true);
      try { setFormData(p => ({ ...p, banner_url: '' })); const url = await uploadImage(file); setFormData(p => ({ ...p, banner_url: url })); toast.success('Bannière téléversée'); }
      catch (err: any) { toast.error(err.message); }
      finally { setIsUploadingBanner(false); e.target.value = ''; }
   };

   // Auto-generate slug from name
   const handleNameChange = (name: string) => {
      const slug = name.toLowerCase()
         .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
         .replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u')
         .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
      setFormData(prev => ({ ...prev, name, slug: prev.slug || slug }));
   };

   return (
      <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setStep(1); } }}>
         <DialogContent title={isEdit ? 'Modifier la Boutique' : 'Nouvelle Boutique'} className="max-w-2xl w-[96vw] p-0 bg-white border-[#E9ECF0] rounded-[40px] overflow-hidden shadow-2xl max-h-[94vh] flex flex-col">
            {/* Header */}
            <div className="shrink-0" style={{ background: `linear-gradient(135deg, ${formData.primaryColor}, ${formData.primaryColor}BB)` }}>
               <div className="px-8 py-6 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                     <div className="size-12 rounded-2xl bg-white/20 flex items-center justify-center">
                        <StoreIcon className="size-6 text-white" />
                     </div>
                     <div>
                        <h2 className="text-lg font-black text-white tracking-tight">
                           {isEdit ? 'Modifier la Boutique' : 'Nouvelle Boutique'}
                        </h2>
                        <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Étape {step} / {totalSteps}</p>
                     </div>
                  </div>
                  {/* Step progress */}
                  <div className="flex gap-2">
                     {[1, 2, 3, 4].map(s => (
                        <button key={s} onClick={() => setStep(s)} className={cn("size-7 rounded-lg text-[10px] font-black transition-all", step === s ? "bg-white text-[#2D3436] shadow-lg" : step > s ? "bg-white/30 text-white" : "bg-white/10 text-white/40")}>
                           {s}
                        </button>
                     ))}
                  </div>
               </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
               {/* STEP 1: Identité */}
               {step === 1 && (
                  <div className="p-8 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                     <div>
                        <h3 className="text-sm font-black text-slate-700 mb-1">Identité de la Boutique</h3>
                        <p className="text-[11px] text-slate-400 font-medium">Définissez le nom, l'URL et la description de votre enseigne.</p>
                     </div>
                     <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-[#636E72] uppercase tracking-wider">Nom de la boutique *</label>
                        <Input
                           placeholder="Ex. Azzoug Luxe, La Maison du Cuir..."
                           value={formData.name}
                           onChange={e => handleNameChange(e.target.value)}
                           className="h-12 border-[#E9ECF0] rounded-xl text-sm font-bold focus:ring-2" style={{ '--tw-ring-color': formData.primaryColor + '30' } as any}
                        />
                     </div>
                     <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-[#636E72] uppercase tracking-wider">URL Slug *</label>
                        <div className="flex items-center gap-0">
                           <span className="h-12 px-4 border border-r-0 border-[#E9ECF0] rounded-l-xl bg-[#F8F9FC] flex items-center text-[11px] font-bold text-slate-400">site.com/</span>
                           <Input
                              placeholder="ma-boutique"
                              value={formData.slug}
                              onChange={e => setFormData(prev => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                              className="h-12 border-[#E9ECF0] rounded-r-xl rounded-l-none font-mono text-sm border-l-0"
                           />
                        </div>
                     </div>
                     <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-[#636E72] uppercase tracking-wider">Description</label>
                        <textarea
                           className="w-full min-h-[90px] p-4 border border-[#E9ECF0] rounded-xl text-sm font-medium focus:outline-none focus:ring-2 resize-none"
                           style={{ '--tw-ring-color': formData.primaryColor + '30' } as any}
                           placeholder="Décrivez votre boutique en 2-3 phrases..."
                           value={formData.description}
                           onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                        />
                     </div>

                     {/* ── Logo ── */}
                     <div className="space-y-2">
                        <label className="text-[11px] font-bold text-[#636E72] uppercase tracking-wider">Logo de la boutique</label>
                        <div className="flex items-center gap-4">
                           <div className="size-20 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0 relative group">
                              {formData.logo_url ? (
                                 <>
                                    <img src={formData.logo_url} alt="logo" className="size-full object-contain p-1" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                                    <button type="button" onClick={() => setFormData(p => ({ ...p, logo_url: '' }))} className="absolute top-0.5 right-0.5 size-5 rounded-full bg-rose-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                                       <X className="size-3" />
                                    </button>
                                 </>
                              ) : isUploadingLogo ? (
                                 <Loader2 className="size-6 animate-spin text-slate-300" />
                              ) : (
                                 <ImageIcon className="size-8 text-slate-200" />
                              )}
                           </div>
                           <label className={cn('flex-1 flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-dashed cursor-pointer transition-all text-[11px] font-bold uppercase tracking-wider', isUploadingLogo ? 'border-indigo-200 bg-indigo-50 text-indigo-400' : 'border-slate-200 hover:border-[#4b7bec] hover:bg-indigo-50/50 text-slate-400')}>
                              {isUploadingLogo ? <><Loader2 className="size-3.5 animate-spin" /> Téléversement...</> : <><Upload className="size-3.5" /> Choisir un logo</>}
                              <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" onChange={handleLogoUpload} disabled={isUploadingLogo} />
                           </label>
                        </div>
                     </div>

                     {/* ── Bannière header ── */}
                     <div className="space-y-2">
                        <label className="text-[11px] font-bold text-[#636E72] uppercase tracking-wider">Image d'en-tête (bannière)</label>
                        <div className="relative w-full h-28 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 overflow-hidden group">
                           {formData.banner_url ? (
                              <>
                                 <img src={formData.banner_url} alt="bannière" className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                                 <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center gap-3">
                                    <label className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 rounded-lg cursor-pointer text-[11px] font-bold text-slate-700">
                                       <Upload className="size-3.5" /> Changer
                                       <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" onChange={handleBannerUpload} disabled={isUploadingBanner} />
                                    </label>
                                    <button type="button" onClick={() => setFormData(p => ({ ...p, banner_url: '' }))} className="px-3 py-1.5 bg-rose-500/90 rounded-lg text-[11px] font-bold text-white">
                                       <X className="size-3.5" />
                                    </button>
                                 </div>
                              </>
                           ) : (
                              <label className={cn('absolute inset-0 flex flex-col items-center justify-center cursor-pointer transition-all', isUploadingBanner ? 'bg-indigo-50' : 'hover:bg-slate-100/60')}>
                                 {isUploadingBanner ? (
                                    <><Loader2 className="size-6 animate-spin text-indigo-400 mb-1" /><span className="text-[11px] font-bold text-indigo-400">Téléversement...</span></>
                                 ) : (
                                    <><Upload className="size-6 text-slate-300 mb-1" /><span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Téléverser une bannière</span><span className="text-[10px] text-slate-300 mt-0.5">Recommandé : 1440 × 400 px</span></>
                                 )}
                                 <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" onChange={handleBannerUpload} disabled={isUploadingBanner} />
                              </label>
                           )}
                        </div>
                     </div>
                  </div>
               )}

               {/* STEP 2: Palette de couleurs */}
               {step === 2 && (
                  <div className="p-8 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                     <div>
                        <h3 className="text-sm font-black text-slate-700 mb-1">Identité Visuelle</h3>
                        <p className="text-[11px] text-slate-400 font-medium">Choisissez une palette de couleurs prédéfinie ou personnalisez la vôtre.</p>
                     </div>

                     {/* 3 Palettes prédéfinies */}
                     <div className="space-y-3">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Palettes Signature</label>
                        <div className="grid grid-cols-1 gap-3">
                           {PALETTES.map(palette => (
                              <button
                                 key={palette.id}
                                 onClick={() => handleSelectPalette(palette)}
                                 className={cn(
                                    "flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all",
                                    selectedPalette === palette.id ? "border-2 shadow-lg" : "border-[#E9ECF0] hover:border-slate-200 bg-white"
                                 )}
                                 style={selectedPalette === palette.id ? { borderColor: palette.primaryColor, backgroundColor: palette.bgColor } : {}}
                              >
                                 {/* Color swatch section */}
                                 <div className="shrink-0 flex items-center gap-3">
                                    <div className={cn("size-14 rounded-2xl flex items-center justify-center shadow-lg bg-gradient-to-br", palette.gradient)}>
                                       {palette.icon}
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                       <div className="flex gap-1.5">
                                          <div className="size-5 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: palette.primaryColor }} />
                                          <div className="size-5 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: palette.accentColor }} />
                                          <div className="size-5 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: palette.bgColor, border: '2px solid #E9ECF0' }} />
                                       </div>
                                       <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{palette.primaryColor}</span>
                                    </div>
                                 </div>

                                 <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                       <span className="text-sm font-black text-slate-800">{palette.name}</span>
                                       <span className="text-[9px] font-black px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: palette.badgeColor }}>
                                          {palette.badge}
                                       </span>
                                    </div>
                                    <p className="text-[11px] text-slate-400 font-medium leading-snug">{palette.description}</p>
                                 </div>

                                 {selectedPalette === palette.id && (
                                    <CheckCircle className="size-5 shrink-0" style={{ color: palette.primaryColor }} />
                                 )}
                              </button>
                           ))}
                        </div>
                     </div>

                     {/* Custom color override */}
                     <div className="bg-slate-50 rounded-2xl p-5 border border-[#E9ECF0] space-y-3">
                        <div className="flex items-center justify-between">
                           <span className="text-[11px] font-black text-slate-600 uppercase tracking-widest">Couleur personnalisée</span>
                           <span className="text-[10px] text-slate-400">Surcharge la palette</span>
                        </div>
                        <div className="flex items-center gap-4">
                           <div className="relative group">
                              <div className="size-14 rounded-xl border-4 border-white shadow-lg cursor-pointer transition-transform group-hover:scale-105" style={{ backgroundColor: formData.primaryColor }} />
                              <input
                                 type="color" value={formData.primaryColor}
                                 onChange={e => {
                                    setFormData(prev => ({ ...prev, primaryColor: e.target.value }));
                                    setSelectedPalette('custom');
                                 }}
                                 className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                              />
                           </div>
                           <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                 <div className="h-8 px-3 rounded-lg bg-white border border-[#E9ECF0] flex items-center font-mono text-xs font-bold text-slate-700">
                                    {formData.primaryColor.toUpperCase()}
                                 </div>
                              </div>
                              {/* Palette dynamique */}
                              <div className="flex gap-1.5">
                                 {[1, 0.8, 0.6, 0.4, 0.2].map((op, i) => (
                                    <div key={i} className="h-6 flex-1 rounded-md" style={{ backgroundColor: formData.primaryColor, opacity: op }} />
                                 ))}
                              </div>
                           </div>
                        </div>
                     </div>
                  </div>
               )}

               {/* STEP 3: Template */}
               {step === 3 && (
                  <div className="p-8 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                     <div>
                        <h3 className="text-sm font-black text-slate-700 mb-1">Template de Boutique</h3>
                        <p className="text-[11px] text-slate-400 font-medium">Sélectionnez la mise en page qui correspond à votre marché cible.</p>
                     </div>
                     <div className="grid grid-cols-1 gap-3">
                        {TEMPLATES.map(t => (
                           <button
                              key={t.id}
                              onClick={() => setFormData(prev => ({ ...prev, template_id: t.id }))}
                              className={cn("flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all", formData.template_id === t.id ? "border-2 bg-slate-50/50 shadow-sm" : "border-[#E9ECF0] bg-white hover:border-slate-200")}
                              style={formData.template_id === t.id ? { borderColor: formData.primaryColor } : {}}
                           >
                              <div className="size-14 rounded-2xl flex items-center justify-center shadow-md" style={{ background: `linear-gradient(135deg, ${t.preview}, ${t.preview}AA)` }}>
                                 {t.icon}
                              </div>
                              <div className="flex-1">
                                 <div className="flex items-center justify-between mb-1">
                                    <h4 className="text-sm font-bold text-slate-800">{t.name}</h4>
                                    <div className="flex gap-1">
                                       {t.tags.slice(0, 2).map(tag => (
                                          <span key={tag} className="px-2 py-0.5 rounded-md bg-slate-100 text-[9px] font-bold text-slate-500 uppercase">{tag}</span>
                                       ))}
                                    </div>
                                 </div>
                                 <p className="text-[11px] text-slate-400 font-medium">{t.description}</p>
                              </div>
                              {formData.template_id === t.id && <CheckCircle className="size-5 shrink-0" style={{ color: formData.primaryColor }} />}
                           </button>
                        ))}
                     </div>
                  </div>
               )}

               {/* STEP 4: Paramètres */}
               {step === 4 && (
                  <div className="p-8 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                     <div>
                        <h3 className="text-sm font-black text-slate-700 mb-1">Paramètres Avancés</h3>
                        <p className="text-[11px] text-slate-400 font-medium">Domaine personnalisé, réseaux sociaux et configuration régionale.</p>
                     </div>

                     <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-[#636E72] uppercase tracking-wider flex items-center gap-2">
                           <Globe className="size-3.5" /> Domaine Personnalisé
                        </label>
                        <div className="flex items-center gap-0">
                           <span className="h-12 px-4 border border-r-0 border-[#E9ECF0] rounded-l-xl bg-[#F8F9FC] flex items-center text-[11px] font-bold text-slate-400">https://</span>
                           <Input
                              placeholder="ma-boutique.com"
                              value={formData.domain}
                              onChange={e => setFormData(prev => ({ ...prev, domain: e.target.value }))}
                              className="h-12 border-[#E9ECF0] rounded-r-xl rounded-l-none font-mono text-sm border-l-0"
                           />
                        </div>
                     </div>

                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                           <label className="text-[11px] font-bold text-[#636E72] uppercase tracking-wider flex items-center gap-2">
                              <Facebook className="size-3.5 text-[#1877F2]" /> Facebook
                           </label>
                           <Input
                              placeholder="url page facebook"
                              value={formData.social_links?.facebook || ''}
                              onChange={e => setFormData(prev => ({ ...prev, social_links: { ...prev.social_links, facebook: e.target.value } }))}
                              className="h-12 border-[#E9ECF0] rounded-xl text-sm"
                           />
                        </div>
                        <div className="space-y-1.5">
                           <label className="text-[11px] font-bold text-[#636E72] uppercase tracking-wider flex items-center gap-2">
                              <Instagram className="size-3.5 text-[#E1306C]" /> Instagram
                           </label>
                           <Input
                              placeholder="@votre_compte"
                              value={formData.social_links?.instagram || ''}
                              onChange={e => setFormData(prev => ({ ...prev, social_links: { ...prev.social_links, instagram: e.target.value } }))}
                              className="h-12 border-[#E9ECF0] rounded-xl text-sm"
                           />
                        </div>
                     </div>

                     {/* Preview Card */}
                     <div className="rounded-2xl overflow-hidden border border-[#E9ECF0] shadow-sm">
                        <div className="p-4 flex items-center gap-4" style={{ background: `linear-gradient(135deg, ${formData.primaryColor}, ${formData.primaryColor}CC)` }}>
                           <div className="size-12 rounded-xl bg-white/20 flex items-center justify-center font-black text-white text-xl overflow-hidden">
                              {formData.logo_url
                                 ? <img src={formData.logo_url} alt="logo" className="size-full object-contain p-1" />
                                 : formData.name.charAt(0) || 'A'}
                           </div>
                           <div>
                              <p className="font-black text-white text-base">{formData.name || 'Ma Boutique'}</p>
                              <p className="text-[10px] text-white/60 font-bold">/{formData.slug || 'ma-boutique'}</p>
                           </div>
                        </div>
                        <div className="p-4 bg-white">
                           <p className="text-xs text-slate-400 font-medium">{formData.description || 'Description de votre boutique...'}</p>
                           <div className="flex items-center gap-2 mt-2">
                              <div className="size-4 rounded-full" style={{ backgroundColor: formData.primaryColor }} />
                              <span className="text-[10px] font-black text-slate-500 uppercase">{TEMPLATES.find(t => t.id === formData.template_id)?.name}</span>
                           </div>
                        </div>
                     </div>
                  </div>
               )}
            </div>

            {/* Footer */}
            <div className="shrink-0 px-8 py-5 border-t border-[#E9ECF0] bg-slate-50/50 flex items-center justify-between">
               <Button variant="ghost" onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1} className="text-slate-400 font-bold rounded-xl h-12 px-6">
                  ← Précédent
               </Button>
               <div className="flex gap-3">
                  <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-400 font-bold rounded-xl h-12 px-5">Annuler</Button>
                  {step < totalSteps ? (
                     <Button
                        onClick={() => setStep(step + 1)}
                        disabled={step === 1 && (!formData.name || !formData.slug)}
                        className="h-12 px-8 rounded-xl font-bold text-white shadow-lg"
                        style={{ backgroundColor: formData.primaryColor }}
                     >
                        Suivant →
                     </Button>
                  ) : (
                     <Button
                        onClick={handleSave}
                        disabled={mutation.isPending}
                        className="h-12 px-8 rounded-xl font-bold text-white shadow-lg"
                        style={{ backgroundColor: formData.primaryColor }}
                     >
                        {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : isEdit ? 'Sauvegarder' : 'Déployer la Boutique'}
                     </Button>
                  )}
               </div>
            </div>
         </DialogContent>
      </Dialog>
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
            open={isCreateModalOpen && !editStore}
            onOpenChange={(o) => { setIsCreateModalOpen(o); if (!o) setEditStore(null); }}
            onSuccess={() => qc.invalidateQueries({ queryKey: ['stores'] })}
         />
         {editStore && (
           <CreateStoreModal
              open={isCreateModalOpen}
              onOpenChange={(o) => { setIsCreateModalOpen(o); if (!o) setEditStore(null); }}
              initialData={editStore}
           />
         )}
      </div>
   );
}
