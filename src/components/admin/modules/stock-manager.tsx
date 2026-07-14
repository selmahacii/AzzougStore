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
  ChevronDown,
  ChevronUp,
  Zap,
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

// Module-scope so StockEntryModal/StockExitModal can offer per-variant
// quantity entry too — Bon d'Entrée/Bon de Sortie used to only ever touch
// the aggregate product.stock, which _update_product_stock_from_variants
// (backend) silently overwrites back to sum-of-variants on the next
// variant-scoped operation, making a manual restock look like it "didn't
// stick" for any product that has variants.
function getProductVariantItems(product: any) {
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
}

export default function StockManager({ variant = 'all' }: { variant?: 'all' | 'alerts' | 'history' }) {
  const { activeStore } = useAppStore();
  const storeId = activeStore?.id ?? '';
  const user = useAppStore(s => s.user);
  const isConfirmateur = user?.role === 'CONFIRMATEUR';

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
  const [expandedVariants, setExpandedVariants] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const toggleVariants = (productId: string) => setExpandedVariants(prev => {
    const next = new Set(prev);
    next.has(productId) ? next.delete(productId) : next.add(productId);
    return next;
  });

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
    // Order/adjustment mutations already invalidate ['admin-products-stock']
    // on success, so this slow interval only backstops changes made elsewhere.
    refetchInterval: 2 * 60 * 60 * 1000,
    staleTime: 3_000,
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
         toast.error("Veuillez spécifier une quantité d’ajustement non nulle.");
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

  // Column count for colSpan
  const colCount = variant === 'alerts' ? 6 : (isConfirmateur ? 7 : 9);

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
          <div className="flex flex-wrap gap-3 w-full md:w-auto">
             <button onClick={() => setShowFilters(!showFilters)} className={cn("px-4 h-11 py-2 rounded-xl text-xs font-black border transition-all flex items-center gap-2", showFilters ? "bg-black text-white border-black" : "bg-white text-[#636E72] hover:bg-[#F8F9FC]")} style={!showFilters ? { borderColor: C.border } : {}}>
                <Filter className="size-3.5" /> Filtres
             </button>
             {!isConfirmateur && (
               <>
                 <button
                    onClick={() => setIsEntryOpen(true)}
                    className="px-4 h-11 rounded-xl text-xs font-black border border-[#00B894]/20 bg-[#E6FFF8] hover:bg-white text-[#00B894] transition-all flex items-center gap-2"
                 >
                    <ArrowUpRight className="size-4" /> Bon d&apos;Entrée
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
               </>
             )}
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

       {/* ─── ALERTS SUMMARY BAR (confirmateur only, alerts view) ─── */}
       {variant === 'alerts' && isConfirmateur && products.length > 0 && (() => {
         const critique = products.filter((p: any) => (p.stock || 0) <= 0).length;
         const faible = products.filter((p: any) => (p.stock || 0) > 0 && (p.stock || 0) <= (p.low_stock_threshold || 5)).length;
         return (
           <div className="flex flex-col sm:flex-row gap-3">
             {critique > 0 && (
               <div className="flex items-center gap-3 px-5 py-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex-1">
                 <div className="size-8 bg-rose-100 rounded-xl flex items-center justify-center shrink-0">
                   <AlertCircle className="size-4 text-rose-500" />
                 </div>
                 <div>
                   <p className="text-[10px] font-black uppercase tracking-widest text-rose-400">Rupture totale</p>
                   <p className="text-lg font-black text-rose-600 leading-none">{critique} produit{critique > 1 ? 's' : ''}</p>
                 </div>
               </div>
             )}
             {faible > 0 && (
               <div className="flex items-center gap-3 px-5 py-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex-1">
                 <div className="size-8 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                   <AlertTriangle className="size-4 text-amber-500" />
                 </div>
                 <div>
                   <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">Stock faible</p>
                   <p className="text-lg font-black text-amber-600 leading-none">{faible} produit{faible > 1 ? 's' : ''}</p>
                 </div>
               </div>
             )}
             <div className="flex items-center gap-3 px-5 py-3.5 bg-indigo-50 border border-indigo-100 rounded-2xl flex-1">
               <div className="size-8 bg-indigo-100 rounded-xl flex items-center justify-center shrink-0">
                 <Zap className="size-4 text-indigo-500" />
               </div>
               <div>
                 <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Total alertes</p>
                 <p className="text-lg font-black text-indigo-600 leading-none">{products.length} produit{products.length > 1 ? 's' : ''}</p>
               </div>
             </div>
           </div>
         );
       })()}

       {/* ─── DATA TABLE ─── */}
       <div className="overflow-x-auto border rounded-2xl bg-white shadow-sm" style={{ borderColor: C.border }}>
          <table className="w-full text-left" style={{ minWidth: variant === 'alerts' ? '700px' : (isConfirmateur ? '900px' : '1200px') }}>
             <thead>
                <tr className="border-b bg-[#FAFBFD]" style={{ borderColor: C.border }}>
                   <th className="px-6 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest w-16">Asset</th>
                   <th className="px-6 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest">Produit</th>
                   {variant === 'alerts' ? (
                      <>
                         <th className="px-3 py-4 text-[10px] font-black text-[#E17055] uppercase tracking-widest text-center">Seuil Min.</th>
                         <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center">En Stock</th>
                         <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center">Urgence</th>
                         <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-right">Action</th>
                      </>
                   ) : (
                      <>
                         <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center">Dispo.</th>
                         <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center">Réservé</th>
                         <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center">Disponible</th>
                         <th className="px-3 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-center text-[#E17055]">Statut</th>
                         {!isConfirmateur && <th className="px-5 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-right">Prix Achat</th>}
                         {!isConfirmateur && <th className="px-5 py-4 text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest text-right">Valeur Stock</th>}
                         <th className="px-4 py-4 w-12"></th>
                      </>
                   )}
                </tr>
             </thead>
             <tbody className="divide-y" style={{ borderColor: C.border }}>
                {productsQuery.isLoading ? (
                   [1,2,3].map(i => <tr key={i}><td colSpan={colCount} className="py-10 animate-pulse bg-[#FAFBFD]/30" /></tr>)
                ) : products.length === 0 ? (
                   <tr><td colSpan={colCount} className="py-20 text-center text-[#B2BEC3] text-sm font-black uppercase tracking-widest">Aucune donnée disponible</td></tr>
                ) : products.map((p: any) => {
                   const available = Math.max(0, (p.stock || 0) - (p.reserved_stock || 0));
                   const isLow = available <= (p.low_stock_threshold || 5);
                   const variantItems = getProductVariantItems(p);
                   const isExpanded = expandedVariants.has(p.id);
                   return (
                      <React.Fragment key={p.id}>
                        <tr className={cn("hover:bg-[#FAFBFD] transition-colors group", variant === 'alerts' && (p.stock || 0) <= 0 && "bg-rose-50/40")}>
                           <td className="px-6 py-4">
                              <div className="size-11 bg-[#F8F9FC] border rounded-xl overflow-hidden shrink-0 group-hover:border-[#6C5CE7]/30 transition-all" style={{ borderColor: C.border }}>
                                 {p.main_image ? <img src={p.main_image} className="size-full object-cover" alt={p.name} /> : <Box className="size-full p-3 opacity-10 text-[#2D3436]" />}
                              </div>
                           </td>
                           <td className="px-6 py-4">
                              <p className="text-sm font-black text-[#2D3436] tracking-tight line-clamp-1 uppercase">{p.name}</p>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <p className="text-[10px] font-black text-[#6C5CE7] font-mono tracking-wider">SKU: {p.slug || 'N/A'}</p>
                                {variantItems.length > 0 && (
                                  <button
                                    onClick={() => toggleVariants(p.id)}
                                    className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-500 hover:bg-indigo-100 transition-colors flex items-center gap-0.5"
                                  >
                                    {variantItems.length} var.{isExpanded ? <ChevronUp className="size-2.5 ml-0.5" /> : <ChevronDown className="size-2.5 ml-0.5" />}
                                  </button>
                                )}
                              </div>
                              {/* Per-variant stock/reserved badges — visible directly in the row,
                                  no need to expand, so a confirmatrice can see at a glance what's
                                  actually available per variant vs. held for unconfirmed orders. */}
                              {variantItems.length > 0 && (
                                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                  {variantItems.map((item, i) => (
                                    <span
                                      key={i}
                                      className={cn(
                                        "inline-flex items-center gap-1 text-[8px] font-black px-1.5 py-0.5 rounded border uppercase tracking-wide",
                                        item.stock - item.reserved <= 0
                                          ? "bg-rose-50 text-rose-600 border-rose-200"
                                          : "bg-[#F8F9FC] text-[#636E72] border-[#E9ECF0]"
                                      )}
                                      title={`${item.variantStr} — ${item.stock} en stock, ${item.reserved} réservé(s)`}
                                    >
                                      {item.variantStr}: {item.stock}
                                      {item.reserved > 0 && <span className="text-amber-500">· {item.reserved} rés.</span>}
                                    </span>
                                  ))}
                                </div>
                              )}
                           </td>
                           {variant === 'alerts' ? (
                              <>
                                 <td className="px-3 text-center"><span className="text-sm font-black text-[#E17055] tabular-nums">{p.low_stock_threshold || 5}</span></td>
                                 <td className="px-3 text-center">
                                   <span className={cn("text-sm font-black tabular-nums", (p.stock || 0) <= 0 ? "text-rose-600" : "text-amber-600")}>
                                     {p.stock || 0}
                                   </span>
                                 </td>
                                 <td className="px-3 text-center">
                                   {(p.stock || 0) <= 0
                                     ? <Badge className="bg-rose-100 text-rose-600 border-none text-[8px] font-black tracking-widest uppercase">CRITIQUE</Badge>
                                     : <Badge className="bg-amber-100 text-amber-600 border-none text-[8px] font-black tracking-widest uppercase">FAIBLE</Badge>
                                   }
                                 </td>
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
                                 {!isConfirmateur && <td className="px-5 text-right"><span className="text-xs font-black text-[#636E72] tabular-nums tracking-tight">{formatPrice(p.cost_price || 0)}</span></td>}
                                 {!isConfirmateur && <td className="px-5 text-right"><span className="text-xs font-black text-[#2D3436] tabular-nums tracking-tight">{formatPrice((p.cost_price || 0) * (p.stock || 0))}</span></td>}
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
                        {/* Variant sub-rows */}
                        {variantItems.length > 0 && isExpanded && variantItems.map((item) => {
                          const varAvailable = Math.max(0, item.stock - item.reserved);
                          const varIsLow = varAvailable <= (p.low_stock_threshold || 5);
                          return (
                            <tr key={item.variantStr} className="bg-slate-50/70" style={{ borderLeft: '2px solid #E0DBFF' }}>
                              <td className="px-6 py-2" />
                              <td className="px-6 py-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="w-0.5 h-4 bg-indigo-200 rounded-full shrink-0" />
                                  <span className="text-[11px] font-bold text-slate-600 leading-tight">{item.variantStr}</span>
                                </div>
                              </td>
                              {variant === 'alerts' ? (
                                <>
                                  <td className="px-3 text-center"><span className="text-[10px] text-slate-300">—</span></td>
                                  <td className="px-3 text-center">
                                    <span className={cn("text-xs font-bold tabular-nums", item.stock <= 0 ? "text-rose-500" : varIsLow ? "text-amber-500" : "text-slate-600")}>{item.stock}</span>
                                  </td>
                                  <td className="px-3 text-center">
                                    {item.stock <= 0
                                      ? <span className="text-[8px] font-black text-rose-400 uppercase">CRITIQUE</span>
                                      : <span className="text-[8px] font-black text-amber-400 uppercase">FAIBLE</span>
                                    }
                                  </td>
                                  <td />
                                </>
                              ) : (
                                <>
                                  <td className="px-3 text-center"><span className={cn("text-xs font-bold tabular-nums", item.stock <= 0 ? "text-rose-500" : varIsLow ? "text-amber-500" : "text-slate-600")}>{item.stock}</span></td>
                                  <td className="px-3 text-center"><span className="text-[10px] text-amber-400 tabular-nums">{item.reserved}</span></td>
                                  <td className="px-3 text-center"><span className={cn("text-xs font-bold tabular-nums", varAvailable <= 0 ? "text-rose-500" : varIsLow ? "text-amber-500" : "text-emerald-500")}>{varAvailable}</span></td>
                                  <td className="px-3 text-center">
                                    {varAvailable <= 0 ? <span className="text-[9px] font-black text-rose-400 uppercase">RUPTURE</span> : varIsLow ? <span className="text-[9px] font-black text-amber-400 uppercase">FAIBLE</span> : <span className="text-[9px] text-slate-300 uppercase">OK</span>}
                                  </td>
                                  {!isConfirmateur && <td />}
                                  {!isConfirmateur && <td />}
                                  <td />
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </React.Fragment>
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
                        <h2 className="text-xl font-black text-[#2D3436] uppercase tracking-tight">Protocole d&apos;Ajustement</h2>
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
                        <label className="text-[10px] font-black uppercase text-[#B2BEC3] tracking-widest">Motif de l&apos;opération</label>
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

       {!isConfirmateur && (
         <>
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
         </>
       )}
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
   // Per-variant quantities — a product with variants tracks stock on each
   // variant, not on the aggregate product.stock. Entering a plain quantity
   // here used to bump product.stock directly; the very next variant-scoped
   // operation (an order, a manual variant adjustment…) recalculates
   // product.stock as the sum of variants and silently wipes that addition
   // out again, making the restock look like it never stuck.
   const [variantQuantities, setVariantQuantities] = useState<Record<string, number>>({});

   const activeProduct = products.find((p: any) => p.id === formData.product_id);
   const variantItems = getProductVariantItems(activeProduct);
   const hasValidQuantity = variantItems.length > 0
      ? Object.values(variantQuantities).some(q => q > 0)
      : formData.quantity > 0;

   const entryMutation = useMutation({
      mutationFn: async (data: any) => {
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

         const adjustments = variantItems.length > 0
            ? Object.entries(variantQuantities)
                 .map(([variantStr, quantity]) => ({ variantStr, quantity }))
                 .filter(adj => adj.quantity > 0)
            : [{ quantity: data.quantity }];

         if (adjustments.length === 0) {
            throw new Error('Veuillez saisir une quantité pour au moins une variante.');
         }

         const results = await Promise.allSettled(
            adjustments.map(adj => apiFetch('/api/v1/stock/', {
               method: 'POST',
               body: JSON.stringify({
                  product_id: data.product_id,
                  warehouse_id: data.warehouse_id,
                  quantity: adj.quantity,
                  type: 'RESTOCK',
                  reason: richReason,
                  store_id: storeId,
                  ...(adj.variantStr ? { variant_details: { variant: adj.variantStr } } : {}),
               })
            }))
         );
         const failed = results.filter(r => r.status === 'rejected').length;
         if (failed > 0) throw new Error(`${failed} entrée(s) sur ${adjustments.length} ont échoué`);
         return results;
      },
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['admin-products-stock'] });
         qc.invalidateQueries({ queryKey: ['admin-products'] });
         qc.invalidateQueries({ queryKey: ['admin-products-lite'] });
         qc.invalidateQueries({ queryKey: ['inventory', 'summary'] });
         qc.invalidateQueries({ queryKey: ['inventory', 'movements'] });
         toast.success("Bon d’Entrée validé avec succès ✓");
         onOpenChange(false);
         setVariantQuantities({});
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
      onError: (err: any) => toast.error(err.message || "Échec de validation du Bon d’Entrée"),
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
                        <DialogTitle className="text-xl font-black uppercase tracking-tight leading-none font-sans">Bon d&apos;Entrée en Stock</DialogTitle>
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

                  {variantItems.length > 0 ? (
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">
                           Quantités par Variante * <span className="text-slate-300 normal-case font-bold">— renseigne une ou plusieurs variantes</span>
                        </label>
                        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                           {variantItems.map(vi => (
                              <div key={vi.variantStr} className="flex items-center gap-3 p-3 bg-white border border-slate-100 rounded-xl">
                                 <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-slate-700 truncate">{vi.variantStr}</p>
                                    <p className="text-[10px] text-slate-400 font-semibold">Stock actuel : {vi.stock}</p>
                                 </div>
                                 <Input
                                    type="number"
                                    min={0}
                                    value={variantQuantities[vi.variantStr] || ''}
                                    onChange={e => setVariantQuantities(prev => ({ ...prev, [vi.variantStr]: parseInt(e.target.value) || 0 }))}
                                    placeholder="0"
                                    className="w-28 h-10 border-slate-100 bg-[#F8F9FC] rounded-lg text-xs font-black text-slate-800 text-center shrink-0"
                                 />
                              </div>
                           ))}
                        </div>
                     </div>
                  ) : (
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
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Date d&apos;Expiration (Le cas échéant)</label>
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
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Plaque d&apos;Immatriculation</label>
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
                  disabled={entryMutation.isPending || !formData.product_id || !formData.warehouse_id || !hasValidQuantity}
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
   // Same rationale as StockEntryModal: a variant product's stock lives on
   // each variant, not on the aggregate — a plain quantity here silently
   // got wiped by the next variant-scoped stock operation.
   const [variantQuantities, setVariantQuantities] = useState<Record<string, number>>({});

   const activeProduct = products.find((p: any) => p.id === formData.product_id);
   const variantItems = getProductVariantItems(activeProduct);
   const activeProductAvailable = activeProduct ? Math.max(0, (activeProduct.stock || 0) - (activeProduct.reserved_stock || 0)) : 0;
   const excessStock = variantItems.length === 0 && activeProduct && formData.quantity > activeProductAvailable;
   const hasValidQuantity = variantItems.length > 0
      ? Object.values(variantQuantities).some(q => q > 0)
      : formData.quantity > 0;
   const hasVariantExcess = variantItems.length > 0 && variantItems.some(vi => (variantQuantities[vi.variantStr] || 0) > Math.max(0, vi.stock - vi.reserved));

   const exitMutation = useMutation({
      mutationFn: async (data: any) => {
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

         const adjustments = variantItems.length > 0
            ? Object.entries(variantQuantities)
                 .map(([variantStr, quantity]) => ({ variantStr, quantity: -Math.abs(quantity) }))
                 .filter(adj => adj.quantity < 0)
            : [{ quantity: -Math.abs(data.quantity) }];

         if (adjustments.length === 0) {
            throw new Error('Veuillez saisir une quantité pour au moins une variante.');
         }

         const results = await Promise.allSettled(
            adjustments.map(adj => apiFetch('/api/v1/stock/', {
               method: 'POST',
               body: JSON.stringify({
                  product_id: data.product_id,
                  warehouse_id: data.warehouse_id,
                  quantity: adj.quantity,
                  type: 'MANUAL_ADJUSTMENT',
                  reason: richReason,
                  store_id: storeId,
                  ...(adj.variantStr ? { variant_details: { variant: adj.variantStr } } : {}),
               })
            }))
         );
         const failed = results.filter(r => r.status === 'rejected').length;
         if (failed > 0) throw new Error(`${failed} sortie(s) sur ${adjustments.length} ont échoué`);
         return results;
      },
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['admin-products-stock'] });
         qc.invalidateQueries({ queryKey: ['admin-products'] });
         qc.invalidateQueries({ queryKey: ['admin-products-lite'] });
         qc.invalidateQueries({ queryKey: ['inventory', 'summary'] });
         qc.invalidateQueries({ queryKey: ['inventory', 'movements'] });
         toast.success("Bon de Sortie validé avec succès ✓");
         onOpenChange(false);
         setVariantQuantities({});
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
                           <ShieldCheck className="size-3.5" /> Enregistrement et traçabilité d&apos;expédition marchandises
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

                  {variantItems.length > 0 ? (
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">
                           Quantités par Variante * <span className="text-slate-300 normal-case font-bold">— renseigne une ou plusieurs variantes</span>
                        </label>
                        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                           {variantItems.map(vi => {
                              const requested = variantQuantities[vi.variantStr] || 0;
                              const vAvailable = Math.max(0, vi.stock - vi.reserved);
                              const vExcess = requested > vAvailable;
                              return (
                                 <div key={vi.variantStr} className="space-y-1">
                                    <div className="flex items-center gap-3 p-3 bg-white border border-slate-100 rounded-xl">
                                       <div className="flex-1 min-w-0">
                                          <p className="text-xs font-bold text-slate-700 truncate">{vi.variantStr}</p>
                                          <p className="text-[10px] text-slate-400 font-semibold">Disponible : {vAvailable}</p>
                                       </div>
                                       <Input
                                          type="number"
                                          min={0}
                                          value={variantQuantities[vi.variantStr] || ''}
                                          onChange={e => setVariantQuantities(prev => ({ ...prev, [vi.variantStr]: parseInt(e.target.value) || 0 }))}
                                          placeholder="0"
                                          className="w-28 h-10 border-slate-100 bg-[#F8F9FC] rounded-lg text-xs font-black text-slate-800 text-center shrink-0"
                                       />
                                    </div>
                                    {vExcess && (
                                       <p className="text-[10px] text-rose-600 font-semibold pl-1">Dépasse le disponible ({vAvailable}) pour cette variante.</p>
                                    )}
                                 </div>
                              );
                           })}
                        </div>
                     </div>
                  ) : (
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
                     </div>
                  )}

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
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Frais d&apos;Expédition / Port (DZD)</label>
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
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Plaque d&apos;Immatriculation Véhicule</label>
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
                  disabled={exitMutation.isPending || !formData.product_id || !formData.warehouse_id || !hasValidQuantity || excessStock || hasVariantExcess}
                  className="h-12 px-10 rounded-xl bg-[#E17055] hover:bg-[#c9583d] text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-rose-100 transition-all active:scale-[0.98]"
               >
                  {exitMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "VALIDER LA SORTIE ✓"}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
