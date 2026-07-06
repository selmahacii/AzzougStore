'use client';

import React, { useState } from 'react';
import { 
  Calendar,
  Package,
  ArrowRightLeft,
  Search,
  Filter,
  Download,
  Activity,
  User,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Clock,
  Scan,
  Database,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';

// ─── Premium Light Theme Palette ──────────────────────────
const C = {
   primary: '#6C5CE7',
   primaryBg: '#F0EDFF',
   success: '#00B894',
   successBg: '#E6FFF8',
   danger: '#E17055',
   dangerBg: '#FFEDE9',
   warning: '#FDCB6E',
   warningBg: '#FFF8E6',
   info: '#0984E3',
   infoBg: '#E8F4FE',
   text: '#2D3436',
   textLight: '#636E72',
   textDim: '#B2BEC3',
   border: '#E9ECF0',
   bg: '#F8F9FC',
};

export default function StockTracker() {
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [movementType, setMovementType] = useState('all');
  const activeStore = useAppStore((s) => s.activeStore);

  // --- Data Fetching ---
  const { data: movementsData, isLoading: isLoadingMovements } = useQuery({
    queryKey: ['stock-movements', activeStore?.id, search, movementType],
    queryFn: () => {
      let url = `/api/v1/stock/?store_id=${activeStore?.id}&search=${search}`;
      if (movementType !== 'all') url += `&movement_type=${movementType}`;
      return apiFetch<{ success: boolean; data: any[]; total: number }>(url);
    },
    enabled: !!activeStore?.id,
  });

  const { data: summaryData } = useQuery({
    queryKey: ['stock-summary', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any }>(`/api/v1/stock/summary?store_id=${activeStore?.id}`),
    enabled: !!activeStore?.id,
  });

  const events = movementsData?.data || [];
  const stats = summaryData?.data || { totalProducts: 0, totalStockValue: 0, lowStockCount: 0, outOfStockCount: 0, totalAvailableStock: 0 };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* ─── STATS CARDS ─── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
         <div className="bg-white p-6 rounded-2xl border border-[#E9ECF0] shadow-sm">
            <span className="text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Valeur Stock</span>
            <div className="text-xl font-black text-[#2D3436] mt-1">{new Intl.NumberFormat('fr-DZ', { style: 'currency', currency: 'DZD' }).format(stats.totalStockValue)}</div>
         </div>
         <div className="bg-white p-6 rounded-2xl border border-[#E9ECF0] shadow-sm">
            <span className="text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Articles Dispo</span>
            <div className="text-xl font-black text-[#2D3436] mt-1">{stats.totalAvailableStock} unités</div>
         </div>
         <div className="bg-[#FFF8E6] p-6 rounded-2xl border border-[#FFF0CB] shadow-sm">
            <span className="text-[10px] font-extrabold text-[#FDCB6E] uppercase tracking-widest">Stock Faible</span>
            <div className="text-xl font-black text-[#FDCB6E] mt-1">{stats.lowStockCount} produits</div>
         </div>
         <div className="bg-[#FFEDE9] p-6 rounded-2xl border border-[#FFDED6] shadow-sm">
            <span className="text-[10px] font-extrabold text-[#E17055] uppercase tracking-widest">Rupture</span>
            <div className="text-xl font-black text-[#E17055] mt-1">{stats.outOfStockCount} produits</div>
         </div>
      </div>

      {/* ─── SEARCH & CONTROLLERS ─── */}
      <div className="bg-white rounded-2xl border p-4 flex flex-col md:flex-row gap-4 items-center shadow-sm" style={{ borderColor: C.border }}>
         <div className="relative flex-1 group w-full">
            <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#B2BEC3] group-focus-within:text-[#6C5CE7] transition-colors" />
            <Input 
               value={search}
               onChange={(e) => setSearch(e.target.value)}
               placeholder="Rechercher code, nom, SKU, éditeur..." 
               className="h-12 bg-[#F8F9FC] border-[#E9ECF0] rounded-xl pl-11 text-sm font-bold placeholder:text-[#B2BEC3] focus:ring-2 focus:ring-[#6C5CE7]/10 transition-all" 
            />
         </div>
         <div className="flex gap-3 w-full md:w-auto">
            <Button onClick={() => setShowFilters(!showFilters)} variant="outline" className={cn("h-12 px-6 rounded-xl border-[#E9ECF0] text-xs font-bold transition-all", showFilters ? "bg-[#6C5CE7] text-white border-[#6C5CE7]" : "bg-white text-[#636E72] hover:bg-[#F8F9FC]")}>
               <Filter className={cn("mr-2 size-4", showFilters ? "text-white" : "text-[#B2BEC3]")} /> Filtres
            </Button>
            <Button variant="outline" className="h-12 px-6 rounded-xl border-[#E9ECF0] text-xs font-bold bg-white text-[#636E72] hover:bg-[#F8F9FC]">
               <Download className="mr-2 size-4 text-[#B2BEC3]" /> Export
            </Button>
         </div>
      </div>

      {showFilters && (
         <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6 bg-white border border-[#E9ECF0] rounded-2xl shadow-sm overflow-hidden"
         >
            <div className="space-y-2">
               <label className="text-[10px] font-extrabold uppercase tracking-widest text-[#B2BEC3]">Période</label>
               <div className="grid grid-cols-2 gap-2 text-xs">
                  <Input type="date" className="h-10 bg-[#F8F9FC] border-[#E9ECF0] rounded-lg font-bold" />
                  <Input type="date" className="h-10 bg-[#F8F9FC] border-[#E9ECF0] rounded-lg font-bold" />
               </div>
            </div>
            <div className="space-y-2">
               <label className="text-[10px] font-extrabold uppercase tracking-widest text-[#B2BEC3]">Type de mouvement</label>
               <Select value={movementType} onValueChange={setMovementType}>
                  <SelectTrigger className="h-10 bg-[#F8F9FC] border-[#E9ECF0] rounded-lg text-xs font-bold"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white border-[#E9ECF0] rounded-xl">
                     <SelectItem value="all">Tous les types</SelectItem>
                     <SelectItem value="RESTOCK">Entrées (Restock)</SelectItem>
                     <SelectItem value="SALE">Sorties (Ventes)</SelectItem>
                     <SelectItem value="RETURN">Retours</SelectItem>
                     <SelectItem value="MANUAL_ADJUSTMENT">Ajustements Manuels</SelectItem>
                  </SelectContent>
               </Select>
            </div>
            <div className="space-y-2">
               <label className="text-[10px] font-extrabold uppercase tracking-widest text-[#B2BEC3]">Entrepôt</label>
               <Select defaultValue="all">
                  <SelectTrigger className="h-10 bg-[#F8F9FC] border-[#E9ECF0] rounded-lg text-xs font-bold"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white border-[#E9ECF0] rounded-xl text-xs font-bold">
                     <SelectItem value="all">Tous les nœuds</SelectItem>
                  </SelectContent>
               </Select>
            </div>
         </motion.div>
      )}

      {/* ─── DATA TABLE MATRIX ─── */}
      <div className="bg-white rounded-2xl border border-[#E9ECF0] overflow-hidden shadow-sm">
         <div className="overflow-x-auto custom-scrollbar no-scrollbar">
            <table className="w-full text-left border-collapse min-w-[1100px]">
               <thead>
                  <tr className="bg-[#F8F9FC] border-b border-[#E9ECF0]">
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Date / Heure</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Produit</th>
                     <th className="px-4 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-center">Qté</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-center">Type</th>
                     <th className="px-4 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-center">Batch / Exp.</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-center text-wrap max-w-[200px]">Motif / Note</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-right">Éditeur</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-[#E9ECF0]">
                  {isLoadingMovements ? (
                     [1,2,3,4,5].map(i => (
                        <tr key={i} className="animate-pulse">
                           <td colSpan={7} className="px-6 py-8 bg-[#FAFBFD]/30" />
                        </tr>
                     ))
                  ) : events.length === 0 ? (
                     <tr>
                        <td colSpan={7} className="px-6 py-20 text-center font-bold text-[#B2BEC3]">Aucun mouvement de stock enregistré</td>
                     </tr>
                  ) : events.map((e, i) => (
                     <tr key={i} className="hover:bg-[#FAFBFD] transition-colors group">
                        <td className="px-6 py-4 whitespace-nowrap">
                           <div className="flex flex-col">
                              <span className="text-xs font-extrabold text-[#2D3436] font-mono">{new Date(e.created_at).toLocaleDateString()}</span>
                              <div className="flex items-center gap-1.5 mt-0.5 text-[10px] font-bold text-[#B2BEC3]">
                                 <Clock className="size-3" /> {new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </div>
                           </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                           <div className="flex items-center gap-3">
                              <div className="size-9 bg-[#F8F9FC] border border-[#E9ECF0] flex items-center justify-center rounded-lg text-[#B2BEC3] group-hover:text-[#6C5CE7] transition-colors">
                                 <Package className="size-4.5" />
                              </div>
                              <div className="flex flex-col">
                                 <span className="text-sm font-bold text-[#2D3436] tracking-tight">{e.product?.name}</span>
                                 <span className="text-[10px] font-bold text-[#6C5CE7] uppercase font-mono mt-0.5">{e.product?.slug}</span>
                              </div>
                           </div>
                        </td>
                        <td className="px-4 py-4 text-center">
                           <span className={cn(
                              "inline-flex h-7 px-3 items-center justify-center rounded-md border text-xs font-extrabold tabular-nums",
                              e.type.includes('IN') || e.type === 'RESTOCK' ? "bg-[#E6FFF8] border-[#D1F9ED] text-[#00B894]" : "bg-[#FFEDE9] border-[#FFDED6] text-[#E17055]"
                           )}>{e.quantity}</span>
                        </td>
                        <td className="px-6 py-4 text-center">
                           <div className="flex flex-col items-center">
                              <Badge className={cn(
                                 "border-none rounded-md px-2.5 py-1 text-[10px] font-black tracking-widest uppercase flex items-center gap-1",
                                 e.type.includes('IN') || e.type === 'RESTOCK' ? "bg-[#E6FFF8] text-[#00B894]" : "bg-[#FFEDE9] text-[#E17055]"
                              )}>
                                 {e.type.includes('IN') || e.type === 'RESTOCK' ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                                 {e.type.replace('_', ' ')}
                              </Badge>
                           </div>
                        </td>
                        <td className="px-4 py-4 text-center">
                           <div className="flex flex-col">
                              <span className="text-[10px] font-black text-[#2D3436] font-mono">{e.batch_id || '---'}</span>
                              {e.expiration_date && (
                                 <span className="text-[9px] font-bold text-[#E17055] mt-0.5 uppercase tracking-tighter">EXP: {new Date(e.expiration_date).toLocaleDateString()}</span>
                              )}
                           </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                           <span className="text-[10px] font-bold text-[#636E72] italic truncate max-w-[200px] inline-block">{e.reason || 'S/O'}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                           <div className="flex items-center justify-end gap-2 text-[#636E72] hover:text-[#2D3436] transition-colors cursor-pointer group/user">
                              <span className="text-[11px] font-bold uppercase">{e.actor?.name || 'Système'}</span>
                              <div className="size-8 bg-[#F0EDFF] border border-[#DCD5FF] flex items-center justify-center rounded-lg text-[#6C5CE7]">
                                 <User className="size-3.5" />
                              </div>
                           </div>
                        </td>
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>
         
         <div className="h-20 bg-[#F8F9FC] border-t border-[#E9ECF0] px-8 flex items-center justify-between">
            <div className="flex items-center gap-10">
               <div className="flex items-center gap-3">
                  <div className="size-8 rounded-lg bg-white border border-[#E9ECF0] flex items-center justify-center">
                     <Activity className="size-4 text-[#6C5CE7]" />
                  </div>
                  <div className="flex flex-col">
                     <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#B2BEC3]">Mouvements</span>
                     <span className="text-sm font-black text-[#2D3436] tabular-nums">{movementsData?.total || 0} Events</span>
                  </div>
               </div>
            </div>
            
            <div className="flex items-center gap-2">
               <Button variant="outline" size="icon" className="size-9 rounded-lg border-[#E9ECF0] hover:bg-white"><ChevronLeft className="size-4 text-[#B2BEC3]" /></Button>
               <Button variant="outline" className="h-9 px-4 rounded-lg bg-[#6C5CE7] border-[#6C5CE7] text-white text-xs font-black">1</Button>
               <Button variant="outline" size="icon" className="size-9 rounded-lg border-[#E9ECF0] hover:bg-white"><ChevronRight className="size-4 text-[#B2BEC3]" /></Button>
            </div>
         </div>
      </div>
    </div>
  );
}
