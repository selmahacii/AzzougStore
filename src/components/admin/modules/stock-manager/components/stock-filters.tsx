'use client';

import React from 'react';
import { Search, Filter, ArrowUpRight, ArrowDownRight, Download } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { C } from '../utils';

export function StockFilters({ 
   search, 
   setSearch, 
   showFilters, 
   setShowFilters, 
   warehouseId, 
   setWarehouseId, 
   warehouses,
   setIsEntryOpen,
   setIsExitOpen
}: {
   search: string;
   setSearch: (val: string) => void;
   showFilters: boolean;
   setShowFilters: (val: boolean) => void;
   warehouseId: string;
   setWarehouseId: (val: string) => void;
   warehouses: any[];
   setIsEntryOpen: (val: boolean) => void;
   setIsExitOpen: (val: boolean) => void;
}) {
   return (
      <div className="space-y-4">
         <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative flex-1 w-full max-w-lg group">
               <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#B2BEC3] group-focus-within:text-[#6C5CE7] transition-colors" />
               <Input 
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher code, nom, SKU..." 
                  className="h-11 pl-10 bg-[#F8F9FC] border-[#E9ECF0] rounded-xl text-sm transition-all focus:bg-white focus:ring-2 focus:ring-[#6C5CE7]/10" 
               />
            </div>
            <div className="flex gap-3 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
               <button onClick={() => setShowFilters(!showFilters)} className={cn("px-4 h-11 py-2 rounded-xl text-xs font-black border transition-all flex items-center gap-2 whitespace-nowrap", showFilters ? "bg-black text-white border-black" : "bg-white text-[#636E72] hover:bg-[#F8F9FC]")} style={!showFilters ? { borderColor: C.border } : {}}>
                  <Filter className="size-3.5" /> Filtres
               </button>
               <button 
                  onClick={() => setIsEntryOpen(true)} 
                  className="px-4 h-11 rounded-xl text-xs font-black border border-[#00B894]/20 bg-[#E6FFF8] hover:bg-white text-[#00B894] transition-all flex items-center gap-2 whitespace-nowrap"
               >
                  <ArrowUpRight className="size-4" /> Bon d'Entrée
               </button>
               <button 
                  onClick={() => setIsExitOpen(true)} 
                  className="px-4 h-11 rounded-xl text-xs font-black border border-[#E17055]/20 bg-[#FFEDE9] hover:bg-white text-[#E17055] transition-all flex items-center gap-2 whitespace-nowrap"
               >
                  <ArrowDownRight className="size-4" /> Bon de Sortie
               </button>
               <button className="px-5 h-11 py-2 rounded-xl text-xs font-black border bg-white text-[#636E72] hover:bg-[#F8F9FC] transition-all flex items-center gap-2 whitespace-nowrap" style={{ borderColor: C.border }}>
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
      </div>
   );
}
