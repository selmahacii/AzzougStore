'use client';

import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  ShoppingBag, 
  Warehouse, 
  Calendar,
  DollarSign,
  AlertCircle,
  Activity,
  ChevronLeft,
  ChevronRight,
  Package,
  FileText,
  Filter,
  Download,
  Eye,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Trash2
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/format';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

export default function PurchaseManager() {
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const activeStore = useAppStore((s) => s.activeStore);
  const queryClient = useQueryClient();

  // --- Form State ---
  const [formData, setFormData] = useState({
    supplier_id: '',
    warehouse_id: '',
    reference: `PO-${Math.floor(Math.random() * 900000) + 100000}`,
    note: '',
    items: [{ product_id: '', quantity_ordered: 1, quantity_received: 1, unit_cost: 0 }]
  });

  // --- Data Fetching ---
  const { data: purchasesData, isLoading: isLoadingPurchases } = useQuery({
    queryKey: ['purchases', activeStore?.id, search],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(
      `/api/v1/purchases?store_id=${activeStore?.id}&search=${search}`
    ),
    enabled: !!activeStore?.id,
  });

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/suppliers?store_id=${activeStore?.id}`),
    enabled: isCreating && !!activeStore?.id,
  });

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/warehouses?store_id=${activeStore?.id}`),
    enabled: isCreating && !!activeStore?.id,
  });

  const { data: productsData } = useQuery({
    queryKey: ['products', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/products?store_id=${activeStore?.id}`),
    enabled: isCreating && !!activeStore?.id,
  });

  const purchases = purchasesData?.data || [];
  const suppliers = suppliersData?.data || [];
  const warehouses = warehousesData?.data || [];
  const products = productsData?.data || [];

  // --- Mutations ---
  const createMutation = useMutation({
    mutationFn: (payload: any) => apiFetch('/api/v1/purchases', {
      method: 'POST',
      body: JSON.stringify({ ...payload, store_id: activeStore?.id })
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      toast.success('Entrée d\'achat validée avec succès');
      setIsCreating(false);
      setFormData({
        supplier_id: '',
        warehouse_id: '',
        reference: `PO-${Math.floor(Math.random() * 900000) + 100000}`,
        note: '',
        items: [{ product_id: '', quantity_ordered: 1, quantity_received: 1, unit_cost: 0 }]
      });
    },
    onError: (err: any) => {
      toast.error('Erreur', { description: err.message });
    }
  });

  const handleAddItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { product_id: '', quantity_ordered: 1, quantity_received: 1, unit_cost: 0 }]
    });
  };

  const handleRemoveItem = (index: number) => {
    const newItems = formData.items.filter((_, i) => i !== index);
    setFormData({ ...formData, items: newItems });
  };

  const handleItemChange = (index: number, field: string, value: any) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setFormData({ ...formData, items: newItems });
  };

  const handleSubmit = () => {
    if (!formData.supplier_id || !formData.warehouse_id) return toast.error('Veuillez remplir les informations obligatoires');
    if (formData.items.some(i => !i.product_id || i.quantity_ordered <= 0)) return toast.error('Veuillez vérifier les articles');
    createMutation.mutate(formData);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* ─── SEARCH & ACTIONS ─── */}
      <div className="bg-white rounded-2xl border p-4 flex flex-col md:flex-row gap-4 items-center shadow-sm" style={{ borderColor: C.border }}>
         <div className="relative flex-1 group w-full">
            <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#B2BEC3] group-focus-within:text-[#6C5CE7] transition-colors" />
            <Input 
               value={search}
               onChange={(e) => setSearch(e.target.value)}
               placeholder="Rechercher par référence, fournisseur, entrepôt..." 
               className="h-12 bg-[#F8F9FC] border-[#E9ECF0] rounded-xl pl-11 text-sm font-bold placeholder:text-[#B2BEC3]" 
            />
         </div>
         <div className="flex gap-3 w-full md:w-auto">
            <Button variant="outline" className="h-12 px-6 rounded-xl border-[#E9ECF0] text-xs font-bold bg-white text-[#636E72] hover:bg-[#F8F9FC]">
               <Download className="mr-2 size-4 text-[#B2BEC3]" /> Export
            </Button>
            <Button onClick={() => setIsCreating(true)} className="h-12 px-6 rounded-xl bg-black text-white text-xs font-bold hover:opacity-90 transition-all shadow-md">
               <Plus className="mr-2 size-4" /> Nouvelle Entrée
            </Button>
         </div>
      </div>

      {/* ─── DATA TABLE MATRIX ─── */}
      <div className="bg-white rounded-2xl border border-[#E9ECF0] overflow-hidden shadow-sm">
         <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse min-w-[1100px]">
               <thead>
                  <tr className="bg-[#F8F9FC] border-b border-[#E9ECF0]">
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Référence</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Date & Heure</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Destination</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Fournisseur</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-right">Total (DA)</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-center">Paiement</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-center">État</th>
                     <th className="px-6 py-4 text-right"></th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-[#E9ECF0]">
                  {isLoadingPurchases ? (
                     [1,2,3].map(i => (
                        <tr key={i} className="animate-pulse">
                           <td colSpan={8} className="px-6 py-8 bg-[#FAFBFD]/50" />
                        </tr>
                     ))
                  ) : purchases.length === 0 ? (
                     <tr>
                        <td colSpan={8} className="px-6 py-20 text-center text-[#B2BEC3] font-bold">Aucune entrée d'achat trouvée</td>
                     </tr>
                  ) : purchases.map((p) => (
                     <tr key={p.id} className="hover:bg-[#FAFBFD] transition-colors group">
                        <td className="px-6 py-5 whitespace-nowrap">
                           <span className="text-sm font-black text-[#6C5CE7] tracking-wider">{p.reference}</span>
                        </td>
                        <td className="px-6 py-5 whitespace-nowrap">
                           <div className="flex flex-col">
                              <span className="text-xs font-bold text-[#2D3436] font-mono">{new Date(p.created_at).toLocaleDateString()}</span>
                              <span className="text-[10px] font-bold text-[#B2BEC3] mt-0.5 uppercase flex items-center gap-1"><Clock className="size-3" /> {new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                           </div>
                        </td>
                        <td className="px-6 py-5 whitespace-nowrap">
                           <div className="flex items-center gap-2.5">
                              <div className="size-8 bg-[#F8F9FC] border border-[#E9ECF0] flex items-center justify-center rounded-lg text-[#B2BEC3]">
                                 <Warehouse className="size-3.5" />
                              </div>
                              <div className="flex flex-col">
                                 <span className="text-xs font-bold text-[#2D3436]">{p.warehouse?.name}</span>
                                 <span className="text-[9px] font-bold text-[#B2BEC3] uppercase font-mono">{p.warehouse?.code}</span>
                              </div>
                           </div>
                        </td>
                        <td className="px-6 py-5 whitespace-nowrap">
                           <span className="text-xs font-bold text-[#636E72] uppercase tracking-tight">{p.supplier?.name}</span>
                        </td>
                        <td className="px-6 py-5 text-right whitespace-nowrap">
                           <div className="flex flex-col items-end">
                              <span className="text-sm font-black text-[#2D3436] tabular-nums">{formatPrice(p.total)}</span>
                              <span className="text-[9px] font-bold text-[#00B894] uppercase mt-0.5">{p.items?.length || 0} Articles</span>
                           </div>
                        </td>
                        <td className="px-6 py-5 text-center">
                           <Badge className={cn(
                              "border-none rounded-md px-2 py-0.5 text-[9px] font-black tracking-widest uppercase",
                              p.payment_status === 'PAID' ? "bg-[#E6FFF8] text-[#00B894]" : "bg-[#FFF8E6] text-[#FDCB6E]"
                           )}>
                              {p.payment_status === 'PAID' ? 'PAYÉ' : 'ATTENTE'}
                           </Badge>
                        </td>
                        <td className="px-6 py-5 text-center">
                           <Badge className={cn(
                              "border-none rounded-md px-2 py-0.5 text-[9px] font-black tracking-widest uppercase",
                              p.reception_status === 'RECEIVED' ? "bg-[#F0EDFF] text-[#6C5CE7]" : "bg-[#F8F9FC] text-[#B2BEC3] border"
                           )}>
                              {p.reception_status === 'RECEIVED' ? 'RÉCEPTIONNÉ' : 'EN COURS'}
                           </Badge>
                        </td>
                        <td className="px-6 py-5 text-right">
                           <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" className="size-8 p-0 text-[#B2BEC3] hover:text-[#6C5CE7] hover:bg-[#F0EDFF] transition-all"><Eye className="size-4" /></Button>
                              <Button variant="ghost" className="size-8 p-0 text-[#B2BEC3] hover:text-[#2D3436] hover:bg-[#F8F9FC] transition-all"><FileText className="size-4" /></Button>
                           </div>
                        </td>
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>

         <div className="h-20 bg-[#F8F9FC] border-t border-[#E9ECF0] px-8 flex items-center justify-between font-bold">
            <div className="flex items-center gap-8">
               <div className="flex flex-col">
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#B2BEC3]">Total Entries</span>
                  <span className="text-sm font-black text-[#2D3436] tabular-nums">{purchases.length} Documents</span>
               </div>
            </div>
            <div className="flex items-center gap-2">
               <Button variant="outline" size="icon" className="size-9 rounded-lg border-[#E9ECF0]"><ChevronLeft className="size-4 text-[#B2BEC3]" /></Button>
               <Button variant="outline" className="h-9 px-4 rounded-lg bg-black border-black text-white text-xs font-black shadow-sm">1</Button>
               <Button variant="outline" size="icon" className="size-9 rounded-lg border-[#E9ECF0]"><ChevronRight className="size-4 text-[#B2BEC3]" /></Button>
            </div>
         </div>
      </div>

      {/* ─── MODAL: NEW PURCHASE ENTRY ─── */}
      <Dialog open={isCreating} onOpenChange={setIsCreating}>
         <DialogContent className="bg-white border-none shadow-2xl max-w-3xl w-[96vw] p-0 rounded-[40px] overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-[#6C5CE7] p-8 text-white relative overflow-hidden">
               <div className="relative z-10">
                  <DialogTitle className="text-xl font-bold uppercase tracking-widest">Nouveau protocole d'achat</DialogTitle>
                  <p className="text-xs font-medium text-white/70 mt-2 uppercase tracking-tight">Initialisation d'une entrée d'inventaire fournisseur</p>
               </div>
               <div className="absolute top-0 right-0 p-8 opacity-20">
                  <ShoppingBag size={80} />
               </div>
            </div>
            
            <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto no-scrollbar">
               <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Entrepôt Cible</label>
                     <Select value={formData.warehouse_id} onValueChange={(v) => setFormData({...formData, warehouse_id: v})}>
                        <SelectTrigger className="h-12 bg-[#F8F9FC] border-[#E9ECF0] rounded-xl text-xs font-bold"><SelectValue placeholder="Choisir l'entrepôt" /></SelectTrigger>
                        <SelectContent className="bg-white border-[#E9ECF0] rounded-xl">
                           {warehouses.map(w => (
                              <SelectItem key={w.id} value={w.id}>{w.name} ({w.code})</SelectItem>
                           ))}
                        </SelectContent>
                     </Select>
                  </div>
                  <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Fournisseur</label>
                     <Select value={formData.supplier_id} onValueChange={(v) => setFormData({...formData, supplier_id: v})}>
                        <SelectTrigger className="h-12 bg-[#F8F9FC] border-[#E9ECF0] rounded-xl text-xs font-bold"><SelectValue placeholder="Sélectionner le partenaire" /></SelectTrigger>
                        <SelectContent className="bg-white border-[#E9ECF0] rounded-xl">
                           {suppliers.map(s => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                           ))}
                        </SelectContent>
                     </Select>
                  </div>
               </div>

               <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Informations Complémentaires</label>
                  <Textarea 
                     value={formData.note}
                     onChange={(e) => setFormData({...formData, note: e.target.value})}
                     className="bg-[#F8F9FC] border-[#E9ECF0] rounded-xl min-h-[100px] text-xs font-bold p-4 focus:ring-2 focus:ring-[#6C5CE7]/10" 
                     placeholder="Notes sur la livraison, état des scellés..." 
                  />
               </div>

               <div className="pt-6 border-t border-[#E9ECF0] space-y-6">
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-2">
                        <Package className="size-4 text-[#6C5CE7]" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2D3436]">Articles du Batch</span>
                     </div>
                     <Button onClick={handleAddItem} variant="ghost" size="sm" className="text-[10px] font-black text-[#6C5CE7] hover:bg-[#F0EDFF] uppercase">+ Ajouter une ligne</Button>
                  </div>
                  
                  <div className="space-y-4">
                     {formData.items.map((item, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-3 items-end bg-[#F8F9FC] p-4 rounded-2xl border border-[#E9ECF0]">
                           <div className="col-span-12 lg:col-span-5 space-y-1.5">
                              <label className="text-[9px] font-bold uppercase text-[#B2BEC3]">Produit</label>
                              <Select value={item.product_id} onValueChange={(v) => handleItemChange(idx, 'product_id', v)}>
                                 <SelectTrigger className="h-10 bg-white border-[#E9ECF0] rounded-lg text-xs font-bold"><SelectValue placeholder="Produit..." /></SelectTrigger>
                                 <SelectContent className="bg-white border-[#E9ECF0] rounded-xl">
                                    {products.map(p => (
                                       <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                    ))}
                                 </SelectContent>
                              </Select>
                           </div>
                           <div className="col-span-4 lg:col-span-2 space-y-1.5">
                              <label className="text-[9px] font-bold uppercase text-[#B2BEC3]">Commandé</label>
                              <Input 
                                 type="number" 
                                 value={item.quantity_ordered}
                                 onChange={(e) => handleItemChange(idx, 'quantity_ordered', parseInt(e.target.value))}
                                 placeholder="0" 
                                 className="h-10 bg-white border-[#E9ECF0] rounded-lg text-xs font-bold" 
                              />
                           </div>
                           <div className="col-span-4 lg:col-span-2 space-y-1.5">
                              <label className="text-[9px] font-bold uppercase text-[#00B894]">Réceptionné</label>
                              <Input 
                                 type="number" 
                                 value={item.quantity_received}
                                 onChange={(e) => handleItemChange(idx, 'quantity_received', parseInt(e.target.value))}
                                 placeholder="0" 
                                 className="h-10 bg-white border-[#E6FFF8] border-[#00B894]/20 rounded-lg text-xs font-bold text-[#00B894]" 
                              />
                           </div>
                           <div className="col-span-6 lg:col-span-4 space-y-1.5">
                              <label className="text-[9px] font-bold uppercase text-[#B2BEC3]">Prix Unitaire (DA)</label>
                              <div className="relative">
                                 <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 size-3 text-[#B2BEC3]" />
                                 <Input 
                                    type="number" 
                                    value={item.unit_cost}
                                    onChange={(e) => handleItemChange(idx, 'unit_cost', parseInt(e.target.value))}
                                    placeholder="0" 
                                    className="h-10 pl-8 bg-white border-[#E9ECF0] rounded-lg text-xs font-bold" 
                                 />
                              </div>
                           </div>
                           <div className="col-span-2 lg:col-span-1 flex justify-center pb-0.5">
                              <Button 
                                 variant="ghost" 
                                 size="icon" 
                                 onClick={() => handleRemoveItem(idx)}
                                 className="size-9 rounded-lg text-[#E17055] hover:bg-[#FFEDE9]"
                                 disabled={formData.items.length === 1}
                              >
                                 <Trash2 className="size-4" />
                              </Button>
                           </div>
                        </div>
                     ))}
                  </div>
               </div>
            </div>

            <DialogFooter className="p-8 bg-[#F8F9FC] border-t border-[#E9ECF0] flex justify-end gap-3">
               <button 
                  disabled={createMutation.isPending}
                  onClick={() => setIsCreating(false)} 
                  className="px-6 py-2.5 rounded-xl text-xs font-bold text-[#636E72] hover:bg-[#E9ECF0] transition-colors disabled:opacity-50"
               >
                  Annuler
               </button>
               <button 
                  disabled={createMutation.isPending}
                  onClick={handleSubmit} 
                  className="bg-black text-white text-xs font-black uppercase px-8 h-12 rounded-xl shadow-lg hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2"
               >
                  {createMutation.isPending ? 'Validation...' : "Valider l'entrée"}
               </button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
    </div>
  );
}
