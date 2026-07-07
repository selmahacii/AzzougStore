'use client';

import React, { useState, useMemo } from 'react';
import { 
  Calculator, 
  Package, 
  Scissors, 
  Truck, 
  Plus, 
  Trash2, 
  Download, 
  Save,
  Users,
  ChevronRight,
  TrendingUp,
  AlertCircle,
  FileText,
  Boxes,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';

const C = {
   primary: '#4b7bec',
   primaryBg: '#F0F5FF',
   success: '#20bf6b',
   successBg: '#E6FFF8',
   danger: '#eb4d4b',
   dangerBg: '#FFEDE9',
   warning: '#f7b731',
   warningBg: '#FFF8E6',
   text: '#2D3436',
   textLight: '#636E72',
   textDim: '#B2BEC3',
   border: '#E9ECF0',
   bg: '#F8F9FC',
};

interface CostItem {
  id: string;
  label: string;
  amount: number;
}

interface CostCategory {
  id: string;
  title: string;
  icon: React.ElementType;
  items: CostItem[];
}

export default function CostPriceCalculator() {
  const { activeStore } = useAppStore();
  const storeId = activeStore?.id ?? '';

  const [batchSize, setBatchSize] = useState<number>(100);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');

  const [categories, setCategories] = useState<CostCategory[]>([
    {
      id: 'materials',
      title: 'Matières & Fournitures',
      icon: Boxes,
      items: [
        { id: '1', label: 'Tissu / Matière Principale', amount: 0 },
        { id: '2', label: 'Accessoires (Zips, Boutons...)', amount: 0 },
      ],
    },
    {
      id: 'labor',
      title: "Main d'œuvre (Façonnier)",
      icon: Scissors,
      items: [
        { id: '3', label: 'Coupe', amount: 0 },
        { id: '4', label: 'Couture / Assemblage', amount: 0 },
        { id: '5', label: 'Finition & Repassage', amount: 0 },
      ],
    },
    {
      id: 'logistics',
      title: 'Logistique & Divers',
      icon: Truck,
      items: [
        { id: '6', label: 'Emballage & Étiquettes', amount: 0 },
        { id: '7', label: 'Transport Atelier ➔ Dépôt', amount: 0 },
        { id: '8', label: 'Frais annexes (Imprévus)', amount: 0 },
      ],
    },
  ]);

  // --- Suppliers Fetching ---
  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers', storeId],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/suppliers?store_id=${storeId}`),
    enabled: !!storeId,
  });
  const suppliers = suppliersData?.data || [];

  const handleUpdateAmount = (catId: string, itemId: string, amount: string) => {
    const val = parseFloat(amount) || 0;
    setCategories(prev => prev.map(cat => {
      if (cat.id !== catId) return cat;
      return {
        ...cat,
        items: cat.items.map(item => item.id === itemId ? { ...item, amount: val } : item)
      };
    }));
  };

  const handleAddItem = (catId: string) => {
    setCategories(prev => prev.map(cat => {
      if (cat.id !== catId) return cat;
      return {
        ...cat,
        items: [...cat.items, { id: Math.random().toString(36).substr(2, 9), label: 'Nouvel élément', amount: 0 }]
      };
    }));
  };

  const handleRemoveItem = (catId: string, itemId: string) => {
    setCategories(prev => prev.map(cat => {
      if (cat.id !== catId) return cat;
      return {
        ...cat,
        items: cat.items.filter(item => item.id !== itemId)
      };
    }));
  };

  const totals = useMemo(() => {
    const categoryTotals = categories.map(cat => ({
      id: cat.id,
      total: cat.items.reduce((sum, item) => sum + item.amount, 0)
    }));
    const grandTotal = categoryTotals.reduce((sum, cat) => sum + cat.total, 0);
    const unitCost = batchSize > 0 ? grandTotal / batchSize : 0;
    return { categoryTotals, grandTotal, unitCost };
  }, [categories, batchSize]);

  const handleExport = () => {
    toast.success('Rapport de coût généré et prêt pour export');
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-700">
      
      {/* ─── Header Section ─── */}
      <div className="bg-white rounded-[32px] border px-6 sm:px-10 py-6 sm:py-8 shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative overflow-hidden" style={{ borderColor: C.border }}>
        <div className="absolute top-0 right-0 p-10 opacity-[0.03] text-[#4b7bec] pointer-events-none"><Calculator className="size-48" /></div>
        <div className="flex items-center gap-6 relative z-10">
          <div className="size-14 rounded-2xl flex items-center justify-center bg-indigo-50 text-[#4b7bec] shadow-inner shrink-0">
            <Calculator className="size-8" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight uppercase">Simulateur de Coût de Revient</h1>
            <p className="text-[11px] sm:text-xs font-black text-slate-400 uppercase tracking-widest mt-1.5 flex items-center gap-2">
               <Zap className="size-3.5 text-amber-500" /> Analyse de rentabilité & Production
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 relative z-10 w-full lg:w-auto">
          <Button onClick={handleExport} variant="outline" className="flex-1 lg:flex-none h-12 px-6 rounded-2xl text-[10px] font-black uppercase tracking-widest border-slate-100 bg-white hover:bg-slate-50 transition-all text-slate-500">
            <Download className="mr-2 size-4" /> Exporter PDF
          </Button>
          <Button className="flex-1 lg:flex-none h-12 px-8 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-[#2D3436] hover:bg-black text-white shadow-xl transition-all">
            <Save className="mr-2 size-4" /> Enregistrer le lot
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* ─── Main Input Column ─── */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Global Config */}
          <div className="bg-white rounded-[32px] border p-8 shadow-sm flex flex-col sm:flex-row gap-8" style={{ borderColor: C.border }}>
            <div className="flex-1 space-y-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2 ml-1">
                <Users className="size-3.5" /> Fournisseur / Atelier
              </label>
              <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
                <SelectTrigger className="h-14 bg-slate-50/50 border-slate-100 rounded-2xl px-6 text-sm font-black transition-all focus:ring-2 focus:ring-[#4b7bec]/10">
                  <SelectValue placeholder="Sélectionner l'atelier..." />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-100 rounded-2xl shadow-2xl">
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id} className="rounded-xl py-3 font-bold">{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2 ml-1">
                <Package className="size-3.5" /> Taille du lot (Quantité)
              </label>
              <div className="relative">
                <Input 
                  type="number"
                  value={batchSize}
                  onChange={(e) => setBatchSize(parseInt(e.target.value) || 0)}
                  className="h-14 bg-slate-50/50 border-slate-100 rounded-2xl px-6 text-sm font-black transition-all focus:ring-2 focus:ring-[#4b7bec]/10" 
                />
                <span className="absolute right-6 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300 uppercase">Unités</span>
              </div>
            </div>
          </div>

          {/* Categories */}
          {categories.map((cat) => (
            <div key={cat.id} className="bg-white rounded-[32px] border shadow-sm overflow-hidden" style={{ borderColor: C.border }}>
              <div className="px-8 py-5 bg-slate-50/50 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
                <div className="flex items-center gap-3">
                  <div className="size-8 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-[#4b7bec] shadow-sm">
                    <cat.icon className="size-4" />
                  </div>
                  <h3 className="text-xs font-black uppercase tracking-widest text-slate-700">{cat.title}</h3>
                </div>
                <Badge className="bg-white border text-slate-500 rounded-lg px-3 py-1 text-[10px] font-black shadow-sm uppercase tracking-tighter">
                  {formatPrice(totals.categoryTotals.find(t => t.id === cat.id)?.total || 0)}
                </Badge>
              </div>
              <div className="p-6 sm:p-8 space-y-4">
                {cat.items.map((item) => (
                  <div key={item.id} className="grid grid-cols-1 sm:grid-cols-[1fr,180px,auto] gap-4 items-center">
                    <div className="flex items-center gap-3">
                       <ChevronRight className="size-3.5 text-slate-200" />
                       <Input 
                         value={item.label}
                         onChange={(e) => {
                           const newLabel = e.target.value;
                           setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, items: c.items.map(i => i.id === item.id ? { ...i, label: newLabel } : i) } : c));
                         }}
                         className="h-11 border-transparent hover:border-slate-100 bg-transparent focus:bg-slate-50 rounded-xl px-0 sm:px-4 text-[13px] font-bold text-slate-600 transition-all focus:ring-0" 
                       />
                    </div>
                    <div className="relative">
                      <Input 
                        type="number"
                        value={item.amount || ''}
                        onChange={(e) => handleUpdateAmount(cat.id, item.id, e.target.value)}
                        className="h-11 bg-slate-50/50 border-slate-100 rounded-xl px-4 pr-10 text-sm font-black text-slate-800 text-right focus:bg-white transition-all" 
                        placeholder="0"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300">DA</span>
                    </div>
                    <button 
                      onClick={() => handleRemoveItem(cat.id, item.id)}
                      className="size-11 rounded-xl flex items-center justify-center text-slate-200 hover:text-rose-500 hover:bg-rose-50 transition-all shrink-0"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
                <button 
                  onClick={() => handleAddItem(cat.id)}
                  className="flex items-center gap-2 text-[10px] font-black text-[#4b7bec] uppercase tracking-widest hover:translate-x-1 transition-all mt-4 ml-6"
                >
                  <Plus className="size-3.5" /> Ajouter un frais
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* ─── Result Sidebar ─── */}
        <div className="space-y-6">
          <div className="bg-[#2D3436] rounded-[40px] p-8 text-white shadow-2xl sticky top-8">
            <div className="flex items-center gap-3 mb-8">
              <div className="size-10 rounded-xl bg-white/10 flex items-center justify-center">
                <TrendingUp className="size-5 text-[#4b7bec]" />
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Récapitulatif de rentabilité</p>
            </div>

            <div className="space-y-6">
              <div className="bg-white/5 rounded-3xl p-6 border border-white/5">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-2">Coût total du lot</p>
                <p className="text-4xl font-black tabular-nums">{formatPrice(totals.grandTotal)}</p>
              </div>

              <div className="bg-white/5 rounded-3xl p-6 border border-white/5">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-2">Coût de revient unitaire</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-4xl font-black tabular-nums text-emerald-400">{formatPrice(totals.unitCost)}</p>
                  <span className="text-[10px] font-black text-white/20 uppercase">/ Unité</span>
                </div>
              </div>

              <div className="space-y-4 pt-4">
                <div className="flex justify-between items-center text-xs font-bold px-1">
                  <span className="text-white/40 uppercase tracking-widest">Articles totaux</span>
                  <span className="font-black font-mono">{batchSize} PCS</span>
                </div>
                <div className="flex justify-between items-center text-xs font-bold px-1">
                  <span className="text-white/40 uppercase tracking-widest">Matières</span>
                  <span className="font-black font-mono">{Math.round((totals.categoryTotals[0]?.total / totals.grandTotal) * 100) || 0}%</span>
                </div>
                <div className="flex justify-between items-center text-xs font-bold px-1">
                  <span className="text-white/40 uppercase tracking-widest">Main d'œuvre</span>
                  <span className="font-black font-mono">{Math.round((totals.categoryTotals[1]?.total / totals.grandTotal) * 100) || 0}%</span>
                </div>
              </div>

              <div className="pt-6">
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3">
                  <AlertCircle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] font-bold text-amber-200/80 leading-relaxed italic">
                    Assurez-vous que les prix incluent la TVA et les frais de change si applicables.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-10 pt-8 border-t border-white/10 grid grid-cols-2 gap-4">
              <div className="text-center">
                 <p className="text-[18px] font-black text-white">{Math.round(totals.unitCost * 1.5).toLocaleString()} DA</p>
                 <p className="text-[8px] font-black uppercase text-white/40 tracking-widest mt-1">PV conseillé (M50)</p>
              </div>
              <div className="text-center">
                 <p className="text-[18px] font-black text-white">{Math.round(totals.unitCost * 1.3).toLocaleString()} DA</p>
                 <p className="text-[8px] font-black uppercase text-white/40 tracking-widest mt-1">PV minimum (M30)</p>
              </div>
            </div>
          </div>

          {/* Quick Actions Card */}
          <div className="bg-white rounded-[32px] border p-8 shadow-sm space-y-4" style={{ borderColor: C.border }}>
             <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Actions Rapides</h4>
             <button className="w-full h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center gap-3 px-5 text-[11px] font-black uppercase tracking-wider text-slate-600 hover:bg-slate-100 transition-all">
                <FileText className="size-4 text-slate-300" /> Historique des lots
             </button>
             <button className="w-full h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center gap-3 px-5 text-[11px] font-black uppercase tracking-wider text-slate-600 hover:bg-slate-100 transition-all">
                <Boxes className="size-4 text-slate-300" /> Comparer avec stock
             </button>
          </div>
        </div>
      </div>
    </div>
  );
}
