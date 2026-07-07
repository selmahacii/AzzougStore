'use client';

import React, { useState } from 'react';
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
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
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
    mutationFn: (data: any) => apiFetch('/api/v1/stock/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-products-stock'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'summary'] });
      toast.success('Le protocole d’ajustement a été validé avec succès');
      setAdjustingProduct(null);
      setAdjustAmount(0);
      setAdjustReason('');
    },
    onError: (err: any) => toast.error(err.message || 'Échec de l’ajustement'),
  });

  const products = productsQuery.data?.data ?? [];

  const handleAdjustSubmit = () => {
    if (!adjustingProduct) return;
    adjustMutation.mutate({
      store_id: storeId,
      product_id: adjustingProduct.id,
      quantity: adjustAmount,
      type: adjustAmount > 0 ? 'RESTOCK' : 'MANUAL_ADJUSTMENT',
      reason: adjustReason || 'Ajustement manuel via dashboard admin'
    });
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
                   const isLow = p.stock <= (p.low_stock_threshold || 5);
                   return (
                      <tr key={p.id} className="hover:bg-[#FAFBFD] transition-colors group">
                         <td className="px-6 py-4">
                            <div className="size-11 bg-[#F8F9FC] border rounded-xl overflow-hidden shrink-0 group-hover:border-[#6C5CE7]/30 transition-all" style={{ borderColor: C.border }}>
                               {p.main_image ? <img src={p.main_image} className="size-full object-cover" /> : <Box className="size-full p-3 opacity-10 text-[#2D3436]" />}
                            </div>
                         </td>
                         <td className="px-6 py-4">
                            <p className="text-sm font-black text-[#2D3436] tracking-tight line-clamp-1 uppercase">{p.name}</p>
                            <p className="text-[10px] font-black text-[#6C5CE7] font-mono mt-0.5 tracking-wider">SKU: {p.slug || 'N/A'}</p>
                         </td>
                         {variant === 'alerts' ? (
                            <>
                               <td className="px-3 text-center"><span className="text-sm font-black text-[#E17055] tabular-nums">{p.low_stock_threshold || 5}</span></td>
                               <td className="px-3 text-center"><span className="text-sm font-black text-[#2D3436] tabular-nums">{p.stock}</span></td>
                               <td className="px-3 text-center"><span className="text-xs font-bold text-[#FDCB6E] tabular-nums">0</span></td>
                               <td className="px-3 text-right">
                                  <button onClick={() => setAdjustingProduct(p)} className="text-[10px] font-black uppercase px-4 h-9 rounded-lg text-white transition-all shadow-md hover:shadow-lg active:scale-95" style={{ backgroundColor: C.danger }}>Réappro.</button>
                               </td>
                            </>
                         ) : (
                            <>
                               <td className="px-3 text-center"><span className={cn("text-sm font-black tabular-nums", p.stock <= 0 ? "text-rose-600" : isLow ? "text-[#E17055]" : "text-[#2D3436]")}>{p.stock}</span></td>
                               <td className="px-3 text-center"><span className="text-xs font-black text-[#B2BEC3] tabular-nums">{p.reserved_stock || 0}</span></td>
                               <td className="px-3 text-center"><span className="text-xs font-black text-[#2D3436] tabular-nums">0</span></td>
                               <td className="px-3 text-center">
                                  {p.stock <= 0 ? <Badge className="bg-[#FFEDE9] text-[#E17055] border-none text-[8px] font-black tracking-widest uppercase">RUPTURE</Badge> : isLow ? <Badge className="bg-[#FFF8E6] text-[#FDCB6E] border-none text-[8px] font-black tracking-widest uppercase">FAIBLE</Badge> : <span className="text-[9px] font-black text-[#B2BEC3] uppercase">OK</span>}
                               </td>
                               <td className="px-5 text-right"><span className="text-xs font-black text-[#636E72] tabular-nums tracking-tight">{formatPrice(p.cost_price || 0)}</span></td>
                               <td className="px-5 text-right"><span className="text-xs font-black text-[#2D3436] tabular-nums tracking-tight">{formatPrice((p.cost_price || 0) * (p.stock || 0))}</span></td>
                               <td className="px-4 text-right">
                                  <button onClick={() => setAdjustingProduct(p)} className="size-9 rounded-xl flex items-center justify-center text-[#B2BEC3] hover:text-[#6C5CE7] hover:bg-[#F0EDFF] transition-all"><ArrowRightLeft className="size-4" /></button>
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
            <div className="bg-white w-full max-w-md rounded-3xl overflow-hidden shadow-2xl border border-white/20 animate-in zoom-in-95 duration-300">
               <div className="p-8 space-y-8">
                  <div className="flex justify-between items-start">
                     <div>
                        <h2 className="text-xl font-black text-[#2D3436] uppercase tracking-tight">Protocole d'Ajustement</h2>
                        <p className="text-[10px] font-bold text-[#B2BEC3] uppercase tracking-widest mt-1">Produit: {adjustingProduct.name}</p>
                     </div>
                     <button onClick={() => setAdjustingProduct(null)} className="size-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors">
                        <RotateCcw className="size-4 text-slate-400" />
                     </button>
                  </div>

                  <div className="bg-[#F8F9FC] p-6 rounded-2xl border border-[#E9ECF0] flex items-center justify-between">
                     <div className="flex flex-col">
                        <span className="text-[10px] font-black text-[#B2BEC3] uppercase">Stock Actuel</span>
                        <span className="text-2xl font-black text-[#2D3436] tracking-tight">{adjustingProduct.stock} UNITS</span>
                     </div>
                     <Package className="size-10 text-[#6C5CE7] opacity-20" />
                  </div>

                  <div className="space-y-6">
                     <div className="space-y-2">
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

                     <div className="space-y-2">
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
                        disabled={adjustAmount === 0 || adjustMutation.isPending}
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
    </div>
  );
}
