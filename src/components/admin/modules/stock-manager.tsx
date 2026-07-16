'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Search, 
  Package, 
  ArrowUpRight, 
  ArrowDownRight, 
  History,
  AlertTriangle,
  RotateCcw,
  Save,
  Filter,
  Download,
  Activity,
  Box,
  TrendingDown,
  ChevronRight,
  ChevronLeft,
  ArrowRightLeft,
  Loader2,
  X,
  ShieldCheck,
  Truck,
  Calendar,
  User,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { useAppStore } from '@/store/app-store';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api-client';

// ─── CODpilot Styling ─────────────────────────────────────
const C = {
   primary: '#6C5CE7', primaryBg: '#F0EDFF',
   success: '#00B894', successBg: '#E6FFF8',
   danger: '#E17055', dangerBg: '#FFEDE9',
   warning: '#FDCB6E', warningBg: '#FFF8E6',
   info: '#0984E3', infoBg: '#E8F4FE',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

export default function StockManager({ variant = 'all' }: { variant?: 'all' | 'alerts' | 'history' }) {
  const { activeStore } = useAppStore();
  const storeId = activeStore?.id ?? '';
  
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [adjustingProduct, setAdjustingProduct] = useState<any>(null);
  const [adjustAmount, setAdjustAmount] = useState<number>(0);
  const [adjustReason, setAdjustReason] = useState('');
  const [isEntryOpen, setIsEntryOpen] = useState(false);
  const [isExitOpen, setIsExitOpen] = useState(false);
  const [fetchingProductId, setFetchingProductId] = useState<string | null>(null);
  const [variantAdjustments, setVariantAdjustments] = useState<Record<string, number>>({});
  const queryClient = useQueryClient();

  const { data: warehousesRes } = useQuery({
    queryKey: ['admin-warehouses', storeId],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/warehouses?store_id=${storeId}`),
    enabled: !!storeId,
  });
  const warehouses = warehousesRes?.data || [];

  const productsQuery = useQuery({
    queryKey: ['admin-products-stock', storeId, search, variant, warehouseId],
    queryFn: () => {
      let url = `/api/v1/products?store_id=${storeId}&search=${search}&limit=50`;
      if (variant === 'alerts') url += '&low_stock=true';
      if (warehouseId !== 'all') url += `&warehouse_id=${warehouseId}`;
      return apiFetch<{ success: boolean; data: any[]; total: number }>(url);
    },
    enabled: !!storeId,
  });

  const adjustMutation = useMutation({
    mutationFn: async (data: { store_id: string; product_id: string; reason: string; adjustments: Array<{ variantStr?: string; quantity: number }> }) => {
      if (data.adjustments.length === 0) return;
      
      const results = await Promise.allSettled(
        data.adjustments.map(adj => {
          const payload: any = {
            store_id: data.store_id,
            product_id: data.product_id,
            quantity: adj.quantity,
            type: adj.quantity > 0 ? 'RESTOCK' : 'MANUAL_ADJUSTMENT',
            reason: data.reason
          };
          if (adj.variantStr) {
            payload.variant_details = { variant: adj.variantStr };
          }
          return apiFetch('/api/v1/stock/', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        })
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) {
        throw new Error(`${failed} ajustement(s) ont échoué`);
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-products-stock'] });
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'summary'] });
      toast.success('Le protocole d’ajustement a été validé avec succès');
      setAdjustingProduct(null);
      setAdjustAmount(0);
      setAdjustReason('');
      setVariantAdjustments({});
    },
    onError: (err: any) => toast.error(err.message || 'Échec de l’ajustement'),
  });

  const products = productsQuery.data?.data ?? [];

  const getProductVariantItems = (product: any) => {
    if (!product || !product.variants || product.variants.length === 0) return [];
    const items: Array<{ variantStr: string; stock: number; reserved: number }> = [];
    
    product.variants.forEach((v: any) => {
      let vars = v;
      if (typeof vars === 'string') {
        try { vars = JSON.parse(vars); } catch { return; }
      }
      if (vars.sub_variants && vars.sub_variants.length > 0) {
        vars.sub_variants.forEach((sv: any) => {
          items.push({
            variantStr: `${vars.name}: ${vars.value}, ${sv.name || 'Taille'}: ${sv.value}`,
            stock: sv.stock || 0,
            reserved: sv.reserved || 0
          });
        });
      } else {
        items.push({
          variantStr: `${vars.name}: ${vars.value}`,
          stock: vars.stock || 0,
          reserved: vars.reserved || 0
        });
      }
    });
    return items;
  };

  const handleAdjustClick = async (product: any) => {
    setFetchingProductId(product.id);
    try {
      const res = await apiFetch<any>(`/api/v1/products/${product.id}`);
      const freshProduct = res.data || res || product;
      setAdjustingProduct(freshProduct);
      setVariantAdjustments({});
      setAdjustAmount(0);
      setAdjustReason('');
    } catch (err) {
      console.error(err);
      setAdjustingProduct(product);
    } finally {
      setFetchingProductId(null);
    }
  };

  const quickAdjustProduct = useAppStore(s => s.quickAdjustProduct);
  const setQuickAdjustProduct = useAppStore(s => s.setQuickAdjustProduct);

  useEffect(() => {
     if (quickAdjustProduct) {
        handleAdjustClick(quickAdjustProduct);
        setQuickAdjustProduct(null);
     }
  }, [quickAdjustProduct, setQuickAdjustProduct]);

  const handleAdjustSubmit = () => {
    if (!adjustingProduct) return;
    
    const variantItems = getProductVariantItems(adjustingProduct);
    if (variantItems.length > 0) {
      const adjustments = Object.entries(variantAdjustments)
        .map(([variantStr, qty]) => ({ variantStr, quantity: qty }))
        .filter(adj => adj.quantity !== 0);
        
      if (adjustments.length === 0) {
         toast.error("Veuillez saisir au moins une modification de quantité.");
         return;
      }
      
      adjustMutation.mutate({
         store_id: storeId,
         product_id: adjustingProduct.id,
         reason: adjustReason || 'Ajustement manuel via protocole stock',
         adjustments
      });
    } else {
      if (adjustAmount === 0) {
         toast.error("Veuillez spécifier une quantité d'ajustement non nulle.");
         return;
      }
      adjustMutation.mutate({
         store_id: storeId,
         product_id: adjustingProduct.id,
         reason: adjustReason || 'Ajustement manuel via protocole stock',
         adjustments: [{ quantity: adjustAmount }]
      });
    }
  };

  return (
     <div className="space-y-6 animate-in fade-in duration-500">
       {/* ─── FILTERS & SEARCH ─── */}
       <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative flex-1 w-full max-w-lg group">
             <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#B2BEC3] group-focus-within:text-[#6C5CE7] transition-colors" />
             <Input 
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher code, nom, SKU..." 
                className="h-11 pl-10 bg-[#F8F9FC] border-[#E9ECF0] rounded-xl text-sm transition-all focus:bg-white focus:ring-2 focus:ring-[#6C5CE7]/10" 
             />
          </div>
          <div className="flex gap-3 w-full md:w-auto">
             <button onClick={() => setShowFilters(!showFilters)} className={cn("px-4 h-11 py-2 rounded-xl text-xs font-black border transition-all flex items-center gap-2", showFilters ? "bg-black text-white border-black" : "bg-white text-[#636E72] hover:bg-[#F8F9FC]")} style={!showFilters ? { borderColor: C.border } : {}}>
                <Filter className="size-3.5" /> Filtres
             </button>
             <button 
                onClick={() => setIsEntryOpen(true)} 
                className="px-4 h-11 rounded-xl text-xs font-black border border-[#00B894]/20 bg-[#E6FFF8] hover:bg-white text-[#00B894] transition-all flex items-center gap-2"
             >
                <ArrowUpRight className="size-4" /> Bon d'Entrée
             </button>
             <button 
                onClick={() => setIsExitOpen(true)} 
                className="px-4 h-11 rounded-xl text-xs font-black border border-[#E17055]/20 bg-[#FFEDE9] hover:bg-white text-[#E17055] transition-all flex items-center gap-2"
             >
                <ArrowDownRight className="size-4" /> Bon de Sortie
             </button>
             <button className="px-5 h-11 py-2 rounded-xl text-xs font-black border bg-white text-[#636E72] hover:bg-[#F8F9FC] transition-all flex items-center gap-2" style={{ borderColor: C.border }}>
                <Download className="size-3.5" /> Exporter Matrix
             </button>
          </div>
       </div>

       {showFilters && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 p-6 bg-[#F8F9FC] border rounded-2xl animate-in slide-in-from-top-2" style={{ borderColor: C.border }}>
             <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-[#B2BEC3] tracking-widest">Entrepôt / Hub</label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger className="h-10 bg-white border-[#E9ECF0] text-xs font-bold rounded-lg">
                    <SelectValue placeholder="Tous les entrepôts" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-[#E9ECF0] rounded-xl text-xs font-bold">
                     <SelectItem value="all">Tous les entrepôts</SelectItem>
                     {warehouses.map(w => (
                       <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                     ))}
                  </SelectContent>
                </Select>
             </div>
             <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-[#B2BEC3] tracking-widest">Catégorie</label>
                <Select defaultValue="all"><SelectTrigger className="h-10 bg-white border-[#E9ECF0] text-xs font-bold rounded-lg"><SelectValue /></SelectTrigger><SelectContent className="bg-white border-[#E9ECF0] rounded-xl text-xs font-bold"><SelectItem value="all">Toutes les catégories</SelectItem></SelectContent></Select>
             </div>
          </div>
       )}

       {/* ─── DATA TABLE ─── */}
       <div className="overflow-x-auto border rounded-2xl bg-white shadow-sm" style={{ borderColor: C.border }}>
          <table className="w-full text-left" style={{ minWidth: variant === 'alerts' ? '1000px' : '1200px' }}>
             <thead>
                <tr className="border-b bg-[#FAFBFD]" style={{ borderColor: C.border }}>
                   <th className="px-6 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest w-16">Asset</th>
                   <th className="px-6 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest">Produit Identifiant</th>
                   {variant === 'alerts' ? (
                      <>
                         <th className="px-3 py-4 text-[10px] font-black text-[#E17055] uppercase tracking-widest text-center">Seuil Min.</th>
                         <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center">Disponible</th>
                         <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center">En Transit</th>
                         <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-right">Action</th>
                      </>
                   ) : (
                      <>
                         <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center">Dispo.</th>
                         <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center">Réservé</th>
                         <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center">En Cours</th>
                         <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center text-[#E17055]">Rupture</th>
                         <th className="px-5 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-right">Prix Achat</th>
                         <th className="px-5 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-right">Valeur Stock</th>
                         <th className="px-4 py-4 w-12"></th>
                      </>
                   )}
                </tr>
             </thead>
             <tbody className="divide-y" style={{ borderColor: C.border }}>
                {productsQuery.isLoading ? (
                   [1,2,3].map(i => <tr key={i}><td colSpan={10} className="py-10 animate-pulse bg-[#FAFBFD]/30" /></tr>)
                ) : products.length === 0 ? (
                   <tr><td colSpan={10} className="py-20 text-center text-[#B2BEC3] text-sm font-black uppercase tracking-widest">Aucune donnée disponible</td></tr>
                ) : products.map((p) => {
                   const available = Math.max(0, (p.stock || 0) - (p.reserved_stock || 0));
                   const isLow = available <= (p.low_stock_threshold || 5);
                   return (
                      <tr key={p.id} className="hover:bg-[#FAFBFD] transition-colors group">
                         <td className="px-6 py-4">
                            <div className="size-11 bg-[#F8F9FC] border rounded-xl overflow-hidden shrink-0 group-hover:border-[#6C5CE7]/30 transition-all" style={{ borderColor: C.border }}>
                               {p.main_image ? <img src={p.main_image} className="size-full object-cover" /> : <Box className="size-full p-3 opacity-10 text-[#2D3436]" />}
                            </div>
                         </td>
                         <td className="px-6 py-4">
                            <div className="flex items-center gap-2 flex-wrap">
                               <p className="text-sm font-black text-[#2D3436] tracking-tight line-clamp-1 uppercase">{p.name}</p>
                               {/* Availability badge repeated here (not just in the
                                   far-right column) so it's visible without
                                   horizontal scroll on narrow screens — the
                                   livreur's Produits/Inventaire tabs run this
                                   same table on mobile. */}
                               {variant !== 'alerts' && (
                                  available <= 0
                                     ? <Badge className="bg-[#FFEDE9] text-[#E17055] border-none text-[8px] font-black tracking-widest uppercase shrink-0">RUPTURE</Badge>
                                     : isLow
                                        ? <Badge className="bg-[#FFF8E6] text-[#FDCB6E] border-none text-[8px] font-black tracking-widest uppercase shrink-0">FAIBLE</Badge>
                                        : <Badge className="bg-[#E6FFF8] text-[#00B894] border-none text-[8px] font-black tracking-widest uppercase shrink-0">DISPONIBLE</Badge>
                               )}
                            </div>
                            <p className="text-[10px] font-black text-[#6C5CE7] font-mono mt-0.5 tracking-wider">SKU: {p.slug || 'N/A'}</p>
                            {/* Per-variant availability, right in the row — no need
                                to open "Ajuster" just to see which color/size is
                                low. Already-loaded product.variants, no extra
                                fetch. Color follows the same rupture/faible/ok
                                logic as the product-level badge above. */}
                            {variant !== 'alerts' && getProductVariantItems(p).length > 0 && (
                               <div className="flex items-center gap-1 flex-wrap mt-1.5 max-w-[280px]">
                                  {getProductVariantItems(p).map((vi, vIdx) => {
                                     const vAvailable = Math.max(0, vi.stock - vi.reserved);
                                     const vColor = vAvailable <= 0 ? { bg: '#FFEDE9', text: '#E17055' }
                                        : vAvailable <= (p.low_stock_threshold || 5) ? { bg: '#FFF8E6', text: '#FDCB6E' }
                                        : { bg: '#E6FFF8', text: '#00B894' };
                                     return (
                                        <span
                                           key={vIdx}
                                           title={vi.variantStr}
                                           className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[8px] font-black tracking-wide whitespace-nowrap"
                                           style={{ backgroundColor: vColor.bg, color: vColor.text }}
                                        >
                                           {vi.variantStr.length > 18 ? vi.variantStr.slice(0, 18) + '…' : vi.variantStr}
                                           <span className="opacity-70">· {vAvailable} dispo{vi.reserved > 0 ? ` / ${vi.reserved} résa` : ''}</span>
                                        </span>
                                     );
                                  })}
                               </div>
                            )}
                         </td>
                         {variant === 'alerts' ? (
                            <>
                               <td className="px-3 text-center"><span className="text-sm font-black text-[#E17055] tabular-nums">{p.low_stock_threshold || 5}</span></td>
                               <td className="px-3 text-center"><span className="text-sm font-black text-[#2D3436] tabular-nums">{p.stock}</span></td>
                               <td className="px-3 text-center"><span className="text-xs font-bold text-[#FDCB6E] tabular-nums">0</span></td>
                               <td className="px-3 py-4 text-right">
                                   <button 
                                      disabled={fetchingProductId === p.id}
                                      onClick={() => handleAdjustClick(p)} 
                                      className="text-[10px] font-black uppercase px-4 h-9 rounded-lg text-white transition-all shadow-md hover:shadow-lg active:scale-95 flex items-center justify-center gap-1 ml-auto" 
                                      style={{ backgroundColor: C.danger }}
                                   >
                                      {fetchingProductId === p.id ? <Loader2 className="size-3 animate-spin text-white" /> : 'Réappro.'}
                                   </button>
                                </td>
                            </>
                         ) : (
                            <>
                               <td className="px-3 text-center"><span className={cn("text-sm font-black tabular-nums", p.stock <= 0 ? "text-rose-600" : isLow ? "text-[#E17055]" : "text-[#2D3436]")}>{p.stock}</span></td>
                               <td className="px-3 text-center"><span className="text-xs font-black text-amber-500 tabular-nums">{p.reserved_stock || 0}</span></td>
                               <td className="px-3 text-center"><span className={cn("text-xs font-black tabular-nums", available <= 0 ? "text-rose-600 font-black" : available <= (p.low_stock_threshold || 5) ? "text-amber-500" : "text-[#00B894]")}>{available}</span></td>
                               <td className="px-3 text-center">
                                  {available <= 0 ? <Badge className="bg-[#FFEDE9] text-[#E17055] border-none text-[8px] font-black tracking-widest uppercase">RUPTURE</Badge> : isLow ? <Badge className="bg-[#FFF8E6] text-[#FDCB6E] border-none text-[8px] font-black tracking-widest uppercase">FAIBLE</Badge> : <span className="text-[9px] font-black text-[#B2BEC3] uppercase">OK</span>}
                               </td>
                               <td className="px-5 text-right"><span className="text-xs font-black text-[#636E72] tabular-nums tracking-tight">{formatPrice(p.cost_price || 0)}</span></td>
                               <td className="px-5 text-right"><span className="text-xs font-black text-[#2D3436] tabular-nums tracking-tight">{formatPrice((p.cost_price || 0) * (p.stock || 0))}</span></td>
                               <td className="px-4 text-right">
                                  <button 
                                      disabled={fetchingProductId === p.id}
                                      onClick={() => handleAdjustClick(p)} 
                                      className="size-9 rounded-xl flex items-center justify-center text-[#B2BEC3] hover:text-[#6C5CE7] hover:bg-[#F0EDFF] transition-all ml-auto"
                                   >
                                      {fetchingProductId === p.id ? <Loader2 className="size-4 animate-spin text-[#6C5CE7]" /> : <ArrowRightLeft className="size-4" />}
                                   </button>
                               </td>
                            </>
                         )}
                      </tr>
                   );
                })}
             </tbody>
          </table>
       </div>

       {/* Adjustment Modal */}
       {adjustingProduct && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl border border-white/20 animate-in zoom-in-95 duration-300">
               <div className="p-8 space-y-6">
                  <div className="flex justify-between items-start">
                     <div className="text-start">
                        <h2 className="text-xl font-black text-[#2D3436] uppercase tracking-tight">Protocole d'Ajustement</h2>
                        <p className="text-[10px] font-bold text-[#B2BEC3] uppercase tracking-widest mt-1">Produit: {adjustingProduct.name}</p>
                     </div>
                     <button onClick={() => setAdjustingProduct(null)} className="size-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors">
                        <RotateCcw className="size-4 text-slate-400" />
                     </button>
                  </div>

                  <div className="bg-[#F8F9FC] p-6 rounded-2xl border border-[#E9ECF0] flex items-center justify-between">
                     <div className="flex flex-col text-start">
                        <span className="text-[10px] font-black text-[#B2BEC3] uppercase">Stock Actuel</span>
                        <span className="text-2xl font-black text-[#2D3436] tracking-tight">{adjustingProduct.stock} UNITS</span>
                     </div>
                     <Package className="size-10 text-[#6C5CE7] opacity-20" />
                  </div>

                  <div className="space-y-5">
                     {getProductVariantItems(adjustingProduct).length > 0 ? (
                        <div className="space-y-4 max-h-[35vh] overflow-y-auto pr-1">
                           <span className="text-[10px] font-black uppercase text-[#B2BEC3] tracking-widest block text-start">Ajustement détaillé des variantes</span>
                           {getProductVariantItems(adjustingProduct).map((item) => {
                              const currentAdj = variantAdjustments[item.variantStr] || 0;
                              return (
                                 <div key={item.variantStr} className="p-4 bg-[#F8F9FC] rounded-2xl border border-[#E9ECF0] space-y-3">
                                    <div className="flex justify-between items-start">
                                       <div className="flex flex-col text-start">
                                          <span className="text-xs font-black text-slate-700">{item.variantStr}</span>
                                          <span className="text-[10px] text-slate-400 font-bold mt-0.5">Actuel : {item.stock} units · {item.reserved} réservés</span>
                                       </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                       <button 
                                          type="button" 
                                          onClick={() => setVariantAdjustments(prev => ({ ...prev, [item.variantStr]: (prev[item.variantStr] || 0) - 1 }))}
                                          className="size-9 rounded-lg border border-[#E9ECF0] flex items-center justify-center text-sm font-black hover:bg-slate-100"
                                       >
                                          —
                                       </button>
                                       <Input 
                                          type="number"
                                          value={currentAdj}
                                          onChange={(e) => {
                                             const val = parseInt(e.target.value) || 0;
                                             setVariantAdjustments(prev => ({ ...prev, [item.variantStr]: val }));
                                          }}
                                          className="h-9 w-24 bg-white border-[#E9ECF0] text-center text-sm font-black rounded-lg" 
                                       />
                                       <button 
                                          type="button" 
                                          onClick={() => setVariantAdjustments(prev => ({ ...prev, [item.variantStr]: (prev[item.variantStr] || 0) + 1 }))}
                                          className="size-9 rounded-lg border border-[#E9ECF0] flex items-center justify-center text-sm font-black hover:bg-slate-100 text-[#6C5CE7]"
                                       >
                                          +
                                       </button>
                                    </div>
                                 </div>
                              );
                           })}
                        </div>
                     ) : (
                        <div className="space-y-2 text-start">
                           <label className="text-[10px] font-black uppercase text-[#B2BEC3] tracking-widest">Modification de quantité (±)</label>
                           <div className="flex items-center gap-4">
                              <button onClick={() => setAdjustAmount(a => a - 1)} className="size-12 rounded-xl border border-[#E9ECF0] flex items-center justify-center text-xl font-black hover:bg-slate-50">—</button>
                              <Input 
                                 type="number"
                                 value={adjustAmount}
                                 onChange={(e) => setAdjustAmount(parseInt(e.target.value) || 0)}
                                 className="h-14 bg-[#F8F9FC] border-[#E9ECF0] text-center text-xl font-black rounded-2xl focus:bg-white" 
                              />
                              <button onClick={() => setAdjustAmount(a => a + 1)} className="size-12 rounded-xl border border-[#E9ECF0] flex items-center justify-center text-xl font-black hover:bg-slate-50 text-[#6C5CE7]">+</button>
                           </div>
                        </div>
                     )}

                     <div className="space-y-2 text-start">
                        <label className="text-[10px] font-black uppercase text-[#B2BEC3] tracking-widest">Motif de l'opération</label>
                        <Input 
                           value={adjustReason}
                           onChange={(e) => setAdjustReason(e.target.value)}
                           placeholder="Ex: Réception livraison, Correction inventaire..." 
                           className="h-12 bg-[#F8F9FC] border-[#E9ECF0] rounded-xl text-sm font-bold" 
                        />
                     </div>
                  </div>

                  <div className="pt-4 flex gap-3">
                     <button 
                        onClick={() => setAdjustingProduct(null)}
                        className="flex-1 h-14 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-slate-200 hover:bg-slate-50 transition-all"
                     >
                        Annuler
                     </button>
                     <Button 
                        onClick={handleAdjustSubmit}
                        disabled={adjustMutation.isPending}
                        className="flex-1 h-14 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-black text-white hover:opacity-90 transition-all font-bold"
                     >
                        {adjustMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : 'Confirmer le Flux'}
                     </Button>
                  </div>
               </div>
            </div>
         </div>
       )}

       {/* PAGINATION */}
       <div className="px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-10">
             <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Total Matrix</span>
                <span className="text-sm font-black text-[#2D3436] tabular-nums">{productsQuery.data?.total || 0} Articles</span>
             </div>
          </div>
          <div className="flex items-center gap-2">
             <button className="size-10 rounded-xl flex items-center justify-center border text-[#636E72] hover:bg-[#F8F9FC] transition-colors disabled:opacity-30" style={{ borderColor: C.border }}>
                <ChevronLeft className="size-4" />
             </button>
             <span className="text-xs font-black text-white size-10 flex items-center justify-center rounded-xl shadow-lg shadow-indigo-100" style={{ backgroundColor: C.primary }}>1</span>
             <button className="size-10 rounded-xl flex items-center justify-center border text-[#636E72] hover:bg-[#F8F9FC] transition-colors disabled:opacity-30" style={{ borderColor: C.border }}>
                <ChevronRight className="size-4" />
             </button>
          </div>
       </div>

       <StockEntryModal 
          open={isEntryOpen} 
          onOpenChange={setIsEntryOpen} 
          products={products} 
          warehouses={warehouses} 
          storeId={storeId} 
       />

       <StockExitModal 
          open={isExitOpen} 
          onOpenChange={setIsExitOpen} 
          products={products} 
          warehouses={warehouses} 
          storeId={storeId} 
       />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Stock Entry Voucher Modal (Bon d'Entrée)
// ═══════════════════════════════════════════════════════════════
function StockEntryModal({ open, onOpenChange, products, warehouses, storeId }: any) {
   const qc = useQueryClient();
   const [formData, setFormData] = useState({
      product_id: '',
      warehouse_id: '',
      quantity: 0,
      supplier: '',
      invoice_ref: '',
      batch_id: '',
      expiration_date: '',
      quality_status: 'conforme',
      carrier_name: '',
      vehicle_plate: '',
      receiving_agent: '',
      note: ''
   });

   const entryMutation = useMutation({
      mutationFn: (data: any) => {
         const richReason = [
            data.note.trim(),
            `--- SPECIFICATIONS DE RECEPTION (BON D'ENTREE) ---`,
            `• Fournisseur : ${data.supplier.trim() || 'N/A'}`,
            `• Facture / N° PO : ${data.invoice_ref.trim() || 'N/A'}`,
            `• N° de Lot / Batch : ${data.batch_id.trim() || 'N/A'}`,
            `• Expiration : ${data.expiration_date || 'N/A'}`,
            `• Statut Qualité : ${data.quality_status.toUpperCase()}`,
            `• Transporteur : ${data.carrier_name.trim() || 'N/A'}`,
            `• Véhicule : ${data.vehicle_plate.toUpperCase() || 'N/A'}`,
            `• Agent Réceptionnaire : ${data.receiving_agent.trim() || 'Système'}`
         ].filter(Boolean).join('\n');

         return apiFetch('/api/v1/stock/', {
            method: 'POST',
            body: JSON.stringify({
               product_id: data.product_id,
               warehouse_id: data.warehouse_id,
               quantity: data.quantity,
               type: 'RESTOCK',
               reason: richReason,
               store_id: storeId
            })
         });
      },
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['admin-products-stock'] });
         qc.invalidateQueries({ queryKey: ['inventory', 'summary'] });
         qc.invalidateQueries({ queryKey: ['inventory', 'movements'] });
         toast.success("Bon d'Entrée validé avec succès ✓");
         onOpenChange(false);
         setFormData({
            product_id: '',
            warehouse_id: '',
            quantity: 0,
            supplier: '',
            invoice_ref: '',
            batch_id: '',
            expiration_date: '',
            quality_status: 'conforme',
            carrier_name: '',
            vehicle_plate: '',
            receiving_agent: '',
            note: ''
         });
      },
      onError: (err: any) => toast.error(err.message || "Échec de validation du Bon d'Entrée"),
   });

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent showCloseButton={false} className="max-w-3xl w-[95vw] p-0 border-none bg-white rounded-[32px] overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            <div className="bg-[#00B894] p-8 text-white shrink-0 border-b border-[#009b7c]">
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-5">
                     <div className="size-14 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/10">
                        <ArrowUpRight className="size-7 text-white" />
                     </div>
                     <div>
                        <DialogTitle className="text-xl font-black uppercase tracking-tight leading-none font-sans">Bon d'Entrée en Stock</DialogTitle>
                        <p className="text-white/60 text-[10px] font-black uppercase tracking-widest mt-1.5 flex items-center gap-1">
                           <ShieldCheck className="size-3.5" /> Enregistrement et traçabilité de réception marchandises
                        </p>
                     </div>
                  </div>
                  <button onClick={() => onOpenChange(false)} className="p-2.5 rounded-xl hover:bg-white/10 transition-all shrink-0">
                     <X className="size-5 text-white/50" />
                  </button>
               </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar bg-[#F8F9FC]/30 font-sans">
               {/* ── 1. ARTICLE & HUB ── */}
               <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">1. Article & Hub Cible</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <div className="md:col-span-2 space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Produit *</label>
                        <Select value={formData.product_id} onValueChange={v => setFormData({...formData, product_id: v})}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold shadow-sm">
                              <SelectValue placeholder="Sélectionner le produit" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl max-h-[300px]">
                              {products.map((p: any) => (
                                 <SelectItem key={p.id} value={p.id} className="font-bold text-xs">{p.name} (Stock: {p.stock})</SelectItem>
                              ))}
                           </SelectContent>
                        </Select>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Entrepôt Cible *</label>
                        <Select value={formData.warehouse_id} onValueChange={v => setFormData({...formData, warehouse_id: v})}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold shadow-sm">
                              <SelectValue placeholder="Hub" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl">
                              {warehouses.map((w: any) => (
                                 <SelectItem key={w.id} value={w.id} className="font-bold text-xs">{w.name}</SelectItem>
                              ))}
                           </SelectContent>
                        </Select>
                     </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Quantité à Entrer *</label>
                        <div className="relative">
                           <Input 
                              type="number"
                              min={1}
                              value={formData.quantity || ''}
                              onChange={e => setFormData({...formData, quantity: parseInt(e.target.value) || 0})}
                              placeholder="Nombre d'unités"
                              className="h-12 border-slate-100 bg-white rounded-xl pl-10 pr-12 text-xs font-black text-slate-800"
                           />
                           <Box className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-emerald-400" />
                           <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300">UNITÉS</span>
                        </div>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">État de Qualité *</label>
                        <Select value={formData.quality_status} onValueChange={v => setFormData({...formData, quality_status: v})}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold uppercase shadow-sm">
                              <SelectValue placeholder="État" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl">
                              <SelectItem value="conforme" className="font-bold text-xs">CONFORME / SCELLÉ</SelectItem>
                              <SelectItem value="conforme_partiel" className="font-bold text-xs">CONFORME AVEC RÉSÈRVE</SelectItem>
                              <SelectItem value="endommage" className="font-bold text-xs text-rose-500">EMBALLAGE ENDOMMAGÉ</SelectItem>
                              <SelectItem value="litige" className="font-bold text-xs text-amber-500">LITIGE CONSTATÉ</SelectItem>
                           </SelectContent>
                        </Select>
                     </div>
                  </div>
               </div>

               {/* ── 2. TRAÇABILITÉ FOURNISSEUR & BATCH ── */}
               <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">2. Provenance & Identification Lots</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Nom Fournisseur / Usine</label>
                        <Input 
                           value={formData.supplier}
                           onChange={e => setFormData({...formData, supplier: e.target.value})}
                           placeholder="Ex: Importations Azzoug, Usine Blida..."
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold text-slate-800"
                        />
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Numéro Facture / N° PO</label>
                        <Input 
                           value={formData.invoice_ref}
                           onChange={e => setFormData({...formData, invoice_ref: e.target.value})}
                           placeholder="Ex: FA-2026-904"
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-mono font-bold"
                        />
                     </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Numéro de Lot / Batch</label>
                        <Input 
                           value={formData.batch_id}
                           onChange={e => setFormData({...formData, batch_id: e.target.value})}
                           placeholder="Ex: LOT-SH-2026-X"
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-mono font-bold"
                        />
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Date d'Expiration (Le cas échéant)</label>
                        <div className="relative">
                           <Input 
                              type="date"
                              value={formData.expiration_date}
                              onChange={e => setFormData({...formData, expiration_date: e.target.value})}
                              className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold text-slate-700"
                           />
                        </div>
                     </div>
                  </div>
               </div>

               {/* ── 3. LOGISTIQUE & ACTEURS ── */}
               <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">3. Transporteur & Réception</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Chauffeur / Transporteur</label>
                        <div className="relative">
                           <Input 
                              value={formData.carrier_name}
                              onChange={e => setFormData({...formData, carrier_name: e.target.value})}
                              placeholder="Nom complet du chauffeur..."
                              className="h-12 border-slate-100 bg-white rounded-xl pl-10 text-xs font-bold text-slate-800"
                           />
                           <Truck className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-300" />
                        </div>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Plaque d'Immatriculation</label>
                        <Input 
                           value={formData.vehicle_plate}
                           onChange={e => setFormData({...formData, vehicle_plate: e.target.value})}
                           placeholder="Ex: 01423-116-16"
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-mono font-bold"
                        />
                     </div>
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Agent Réceptionnaire (Signataire) *</label>
                     <Input 
                        value={formData.receiving_agent}
                        onChange={e => setFormData({...formData, receiving_agent: e.target.value})}
                        placeholder="Ex: Responsable Dépôt Blida"
                        className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold text-slate-800"
                     />
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Description / Note narrative libre</label>
                     <Textarea 
                        value={formData.note}
                        onChange={e => setFormData({...formData, note: e.target.value})}
                        placeholder="Note générale de l'entrée en stock..."
                        className="border-slate-100 bg-[#F8F9FC]/50 hover:bg-white rounded-xl text-xs font-bold resize-none min-h-[80px]"
                     />
                  </div>
               </div>
            </div>

            <DialogFooter className="p-8 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3 shrink-0">
               <button onClick={() => onOpenChange(false)} className="h-12 px-6 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors">Fermer</button>
               <Button 
                  onClick={() => entryMutation.mutate(formData)}
                  disabled={entryMutation.isPending || !formData.product_id || !formData.warehouse_id || formData.quantity <= 0}
                  className="h-12 px-10 rounded-xl bg-[#00B894] hover:bg-[#009b7c] text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-100 transition-all active:scale-[0.98]"
               >
                  {entryMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "VALIDER L'ENTRÉE ✓"}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}


// ═══════════════════════════════════════════════════════════════
// Stock Exit Voucher Modal (Bon de Sortie)
// ═══════════════════════════════════════════════════════════════
function StockExitModal({ open, onOpenChange, products, warehouses, storeId }: any) {
   const qc = useQueryClient();
   const [formData, setFormData] = useState({
      product_id: '',
      warehouse_id: '',
      quantity: 0,
      destination: '',
      dispatch_ref: '',
      driver_name: '',
      vehicle_plate: '',
      shipping_fees: 0,
      package_status: 'parfait',
      shipping_agent: '',
      note: ''
   });

   const exitMutation = useMutation({
      mutationFn: (data: any) => {
         const richReason = [
            data.note.trim(),
            `--- SPECIFICATIONS D'EXPEDITION (BON DE SORTIE) ---`,
            `• Destination / Cible : ${data.destination.trim() || 'N/A'}`,
            `• N° Bon de Dispatch : ${data.dispatch_ref.trim() || 'N/A'}`,
            `• Livreur / Chauffeur : ${data.driver_name.trim() || 'N/A'}`,
            `• Véhicule Immatriculé : ${data.vehicle_plate.toUpperCase() || 'N/A'}`,
            `• Frais d'Expédition : ${data.shipping_fees || 0} DA`,
            `• Condition Colis : ${data.package_status.toUpperCase()}`,
            `• Agent Expéditeur : ${data.shipping_agent.trim() || 'Système'}`
         ].filter(Boolean).join('\n');

         // Exit quantities MUST be negative for withdrawal!
         const negativeQty = -Math.abs(data.quantity);

         return apiFetch('/api/v1/stock/', {
            method: 'POST',
            body: JSON.stringify({
               product_id: data.product_id,
               warehouse_id: data.warehouse_id,
               quantity: negativeQty,
               type: 'MANUAL_ADJUSTMENT',
               reason: richReason,
               store_id: storeId
            })
         });
      },
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['admin-products-stock'] });
         qc.invalidateQueries({ queryKey: ['inventory', 'summary'] });
         qc.invalidateQueries({ queryKey: ['inventory', 'movements'] });
         toast.success("Bon de Sortie validé avec succès ✓");
         onOpenChange(false);
         setFormData({
            product_id: '',
            warehouse_id: '',
            quantity: 0,
            destination: '',
            dispatch_ref: '',
            driver_name: '',
            vehicle_plate: '',
            shipping_fees: 0,
            package_status: 'parfait',
            shipping_agent: '',
            note: ''
         });
      },
      onError: (err: any) => toast.error(err.message || "Échec de validation du Bon de Sortie"),
   });

   const activeProduct = products.find((p: any) => p.id === formData.product_id);
   const activeProductAvailable = activeProduct ? Math.max(0, (activeProduct.stock || 0) - (activeProduct.reserved_stock || 0)) : 0;
   const excessStock = activeProduct && formData.quantity > activeProductAvailable;

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent showCloseButton={false} className="max-w-3xl w-[95vw] p-0 border-none bg-white rounded-[32px] overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            <div className="bg-[#E17055] p-8 text-white shrink-0 border-b border-[#c9583d]">
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-5">
                     <div className="size-14 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/10">
                        <ArrowDownRight className="size-7 text-white" />
                     </div>
                     <div>
                        <DialogTitle className="text-xl font-black uppercase tracking-tight leading-none font-sans">Bon de Sortie de Stock</DialogTitle>
                        <p className="text-white/60 text-[10px] font-black uppercase tracking-widest mt-1.5 flex items-center gap-1">
                           <ShieldCheck className="size-3.5" /> Enregistrement et traçabilité d'expédition marchandises
                        </p>
                     </div>
                  </div>
                  <button onClick={() => onOpenChange(false)} className="p-2.5 rounded-xl hover:bg-white/10 transition-all shrink-0">
                     <X className="size-5 text-white/50" />
                  </button>
               </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar bg-[#F8F9FC]/30 font-sans">
               {/* ── 1. ARTICLE & HUB SOURCE ── */}
               <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">1. Article & Hub Source</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <div className="md:col-span-2 space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Produit *</label>
                        <Select value={formData.product_id} onValueChange={v => setFormData({...formData, product_id: v})}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold shadow-sm">
                              <SelectValue placeholder="Sélectionner le produit" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl max-h-[300px]">
                              {products.map((p: any) => (
                                 <SelectItem key={p.id} value={p.id} className="font-bold text-xs">{p.name} (Stock: {p.stock})</SelectItem>
                              ))}
                           </SelectContent>
                        </Select>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Entrepôt Source *</label>
                        <Select value={formData.warehouse_id} onValueChange={v => setFormData({...formData, warehouse_id: v})}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold shadow-sm">
                              <SelectValue placeholder="Hub" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl">
                              {warehouses.map((w: any) => (
                                 <SelectItem key={w.id} value={w.id} className="font-bold text-xs">{w.name}</SelectItem>
                              ))}
                           </SelectContent>
                        </Select>
                     </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Quantité à Sortir *</label>
                        <div className="relative">
                           <Input 
                              type="number"
                              min={1}
                              value={formData.quantity || ''}
                              onChange={e => setFormData({...formData, quantity: parseInt(e.target.value) || 0})}
                              placeholder="Nombre d'unités"
                              className="h-12 border-slate-100 bg-white rounded-xl pl-10 pr-12 text-xs font-black text-slate-800"
                           />
                           <Box className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-rose-400" />
                           <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300">UNITÉS</span>
                        </div>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Conditionnement *</label>
                        <Select value={formData.package_status} onValueChange={v => setFormData({...formData, package_status: v})}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold uppercase shadow-sm">
                              <SelectValue placeholder="État" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl">
                              <SelectItem value="parfait" className="font-bold text-xs">PARFAIT / SCELLÉ</SelectItem>
                              <SelectItem value="standard" className="font-bold text-xs">CARTON STANDARD ACCORDÉ</SelectItem>
                              <SelectItem value="fragile" className="font-bold text-xs text-amber-500">SIGNALÉ FRAGILE</SelectItem>
                              <SelectItem value="abime" className="font-bold text-xs text-rose-500">ENVELOPPE ALTERÉE</SelectItem>
                           </SelectContent>
                        </Select>
                     </div>
                  </div>

                  {excessStock && (
                     <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-[10px] text-rose-700 font-semibold leading-relaxed flex gap-2">
                        <AlertCircle className="size-4 shrink-0 text-rose-500 mt-0.5" />
                        <span>
                            La quantité demandée ({formData.quantity} unités) dépasse le stock disponible de ce produit ({activeProductAvailable} unités disponibles sur {activeProduct?.stock} en stock physique, dont {activeProduct?.reserved_stock || 0} réservés).
                        </span>
                     </div>
                  )}
               </div>

               {/* ── 2. DESTINATION & DISPATCH ── */}
               <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">2. Destination & Expédition</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Destination / Cible / Client</label>
                        <Input 
                           value={formData.destination}
                           onChange={e => setFormData({...formData, destination: e.target.value})}
                           placeholder="Ex: Client Particulier, Boutique Alger, Yalidine..."
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold text-slate-800"
                        />
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Numéro du Bon de Dispatch / Envoi</label>
                        <Input 
                           value={formData.dispatch_ref}
                           onChange={e => setFormData({...formData, dispatch_ref: e.target.value})}
                           placeholder="Ex: BD-901-ORAN"
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-mono font-bold"
                        />
                     </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Frais d'Expédition / Port (DZD)</label>
                        <div className="relative">
                           <Input 
                              type="number"
                              value={formData.shipping_fees || ''}
                              onChange={e => setFormData({...formData, shipping_fees: parseFloat(e.target.value) || 0})}
                              placeholder="0.00"
                              className="h-12 border-slate-100 bg-white rounded-xl pl-10 pr-12 text-xs font-black text-slate-800"
                           />
                           <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-300">DA</span>
                        </div>
                     </div>
                  </div>
               </div>

               {/* ── 3. LOGISTIQUE & ACTEURS ── */}
               <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">3. Logistique & Agent Expéditeur</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Nom du Chauffeur / Livreur</label>
                        <div className="relative">
                           <Input 
                              value={formData.driver_name}
                              onChange={e => setFormData({...formData, driver_name: e.target.value})}
                              placeholder="Chauffeur en charge..."
                              className="h-12 border-slate-100 bg-white rounded-xl pl-10 text-xs font-bold text-slate-800"
                           />
                           <Truck className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-300" />
                        </div>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Plaque d'Immatriculation Véhicule</label>
                        <Input 
                           value={formData.vehicle_plate}
                           onChange={e => setFormData({...formData, vehicle_plate: e.target.value})}
                           placeholder="Ex: 09841-118-31"
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-mono font-bold"
                        />
                     </div>
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Agent Expéditeur Responsable *</label>
                     <Input 
                        value={formData.shipping_agent}
                        onChange={e => setFormData({...formData, shipping_agent: e.target.value})}
                        placeholder="Ex: Responsable Expédition Oran"
                        className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold text-slate-800"
                     />
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Description / Note narrative libre</label>
                     <Textarea 
                        value={formData.note}
                        onChange={e => setFormData({...formData, note: e.target.value})}
                        placeholder="Note générale de la sortie de stock..."
                        className="border-slate-100 bg-[#F8F9FC]/50 hover:bg-white rounded-xl text-xs font-bold resize-none min-h-[80px]"
                     />
                  </div>
               </div>
            </div>

            <DialogFooter className="p-8 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3 shrink-0">
               <button onClick={() => onOpenChange(false)} className="h-12 px-6 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors">Fermer</button>
               <Button 
                  onClick={() => exitMutation.mutate(formData)}
                  disabled={exitMutation.isPending || !formData.product_id || !formData.warehouse_id || formData.quantity <= 0 || excessStock}
                  className="h-12 px-10 rounded-xl bg-[#E17055] hover:bg-[#c9583d] text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-rose-100 transition-all active:scale-[0.98]"
               >
                  {exitMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "VALIDER LA SORTIE ✓"}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
