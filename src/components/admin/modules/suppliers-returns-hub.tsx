'use client';

import { useState } from 'react';
import { Users, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import SupplierManager from './supplier-manager';
import ReturnManager from './return-manager';

const C = { primary: '#6C5CE7', border: '#E9ECF0' };

// Fusion de "Fournisseurs" et "Retours fournisseurs" — les deux vivaient
// séparément alors que la quasi-totalité du contexte se recoupe (un retour
// fournisseur EST toujours rattaché à un fournisseur). Composition, pas
// réécriture : chaque module garde son code/API existant intact.
export default function SuppliersReturnsHub() {
   const [tab, setTab] = useState<'suppliers' | 'returns'>('suppliers');

   return (
      <div className="space-y-5 animate-in fade-in duration-500">
         <div className="flex items-center gap-1.5 bg-white rounded-2xl border p-1.5 w-fit" style={{ borderColor: C.border }}>
            <button onClick={() => setTab('suppliers')}
               className={cn("flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all",
                  tab === 'suppliers' ? "bg-[#6C5CE7] text-white shadow-sm" : "text-slate-500 hover:bg-slate-50")}>
               <Users className="size-3.5" /> Fournisseurs
            </button>
            <button onClick={() => setTab('returns')}
               className={cn("flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all",
                  tab === 'returns' ? "bg-[#6C5CE7] text-white shadow-sm" : "text-slate-500 hover:bg-slate-50")}>
               <RotateCcw className="size-3.5" /> Retours fournisseurs
            </button>
         </div>

         {tab === 'suppliers' ? <SupplierManager /> : <ReturnManager />}
      </div>
   );
}
