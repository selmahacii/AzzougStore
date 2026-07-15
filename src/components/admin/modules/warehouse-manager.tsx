'use client';

import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  Edit, 
  Trash2, 
  Phone, 
  MapPin, 
  Package, 
  MoreVertical,
  ArrowRightLeft,
  Warehouse,
  Info,
  ChevronRight,
  Boxes,
  Activity,
  ShieldCheck,
  User,
  Zap,
  Loader2,
  X,
  PlusCircle,
  Truck,
  Database,
  Grid3X3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { WILAYAS } from '@/lib/wilaya-data';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/store/app-store';
import { apiFetch } from '@/lib/api-client';

const C = {
   primary: '#6C5CE7',
   primaryBg: '#F0EDFF',
   success: '#00B894',
   successBg: '#E6FFF8',
   danger: '#E17055',
   dangerBg: '#FFEDE9',
   warning: '#FDCB6E',
   warningBg: '#FFF8E6',
   text: '#2D3436',
   textLight: '#636E72',
   textDim: '#B2BEC3',
   border: '#E9ECF0',
   bg: '#F8F9FC',
};

interface WarehouseData {
  id: string; 
  code: string; 
  name: string; 
  phone: string; 
  address: string; 
  wilaya: string; 
  manager_name?: string;
  capacity?: number;
  is_active?: boolean;
  note?: string;
}

export default function WarehouseManager() {
  const { activeStore } = useAppStore();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [editingWh, setEditingWh] = useState<WarehouseData | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    phone: '',
    address: '',
    wilaya: 'Alger',
    manager_name: '',
    capacity: 0,
    note: ''
  });

  // --- Data Fetching ---
  const { data: whResponse, isLoading } = useQuery({
     queryKey: ['warehouses', activeStore?.id, search],
     queryFn: () => apiFetch<{ success: boolean; data: WarehouseData[] }>(
        `/api/v1/warehouses?store_id=${activeStore?.id}&search=${search}`
     ),
     enabled: !!activeStore?.id,
  });

  const warehouses = whResponse?.data || [];

  // --- Mutations ---
  const saveMutation = useMutation({
      mutationFn: (data: Partial<WarehouseData>) => {
          const url = editingWh ? `/api/v1/warehouses/${editingWh.id}` : '/api/v1/warehouses';
          const method = editingWh ? 'PATCH' : 'POST';
          return apiFetch(url, {
              method,
              body: JSON.stringify({ ...data, store_id: activeStore?.id })
          });
      },
      onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['warehouses'] });
          toast.success(editingWh ? "Entrepôt mis à jour" : "Entrepôt créé avec succès");
          closeModal();
      },
      onError: (err: any) => {
        toast.error('Erreur technique', { description: err.message });
      }
  });

  const deleteMutation = useMutation({
      mutationFn: (id: string) => apiFetch(`/api/v1/warehouses/${id}`, { method: 'DELETE' }),
      onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['warehouses'] });
          toast.success("Structure d'avitaillement retirée");
      }
  });

  // --- Helpers ---
  const openEdit = (wh: WarehouseData) => {
     setEditingWh(wh);
     setFormData({
        name: wh.name,
        code: wh.code,
        phone: wh.phone || '',
        address: wh.address || '',
        wilaya: wh.wilaya || 'Alger',
        manager_name: wh.manager_name || '',
        capacity: wh.capacity || 0,
        note: wh.note || ''
     });
     setIsCreating(true);
  };

  const closeModal = () => {
     setIsCreating(false);
     setEditingWh(null);
     setFormData({ name: '', code: '', phone: '', address: '', wilaya: 'Alger', manager_name: '', capacity: 0, note: '' });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      
      {/* ─── Industrial Header & Dashboard ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
         <div className="lg:col-span-2 bg-white rounded-[40px] border p-10 shadow-sm relative overflow-hidden" style={{ borderColor: C.border }}>
            <div className="absolute top-0 right-0 p-8 opacity-[0.03] text-[#6C5CE7] rotate-12">
               <Warehouse className="size-48" />
            </div>
            <div className="relative z-10">
               <div className="flex items-center gap-4 mb-4">
                  <div className="size-12 rounded-2xl bg-[#F0EDFF] flex items-center justify-center text-[#6C5CE7] shadow-inner">
                     <Warehouse className="size-6" />
                  </div>
                  <div>
                     <h2 className="text-xl font-black text-[#2D3436] uppercase tracking-tight">Registre Logistique</h2>
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Maillage territorial des stocks</p>
                  </div>
               </div>
               <div className="flex items-center gap-2">
                  <Badge className="bg-emerald-50 text-emerald-600 border-none px-3 py-1 text-[10px] font-black uppercase">Statut: Opérationnel</Badge>
                  <button onClick={() => setIsCreating(true)} className="ml-4 flex items-center gap-2 text-[10px] font-black text-[#6C5CE7] uppercase tracking-widest hover:translate-x-1 transition-transform">
                     Secteur d'extension <PlusCircle className="size-3" />
                  </button>
               </div>
            </div>
         </div>

         <div className="bg-[#2D3436] rounded-[40px] p-8 flex flex-col justify-between shadow-xl">
            <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Capacité Globale</p>
            <div className="flex items-end justify-between mt-4">
               <div>
                  <span className="text-4xl font-black text-white tracking-tighter">840</span>
                  <span className="text-xs font-black text-white/40 ml-2 uppercase">Palettes</span>
               </div>
               <div className="size-12 rounded-2xl bg-white/10 flex items-center justify-center text-[#6C5CE7]">
                  <Boxes className="size-7" />
               </div>
            </div>
            <div className="w-full h-1.5 bg-white/10 rounded-full mt-4 overflow-hidden">
               <div className="h-full bg-gradient-to-r from-[#6C5CE7] to-[#8c7ae6]" style={{ width: '64%' }} />
            </div>
         </div>

         <div className="bg-white rounded-[40px] border p-8 flex flex-col justify-between shadow-sm" style={{ borderColor: C.border }}>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Points Relais</p>
            <div className="flex items-center justify-between mt-4">
               <span className="text-4xl font-black text-[#2D3436] tracking-tighter">{warehouses.length}</span>
               <div className="size-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300">
                  <MapPin className="size-7" />
               </div>
            </div>
            <p className="text-[10px] font-black text-emerald-500 uppercase mt-4 flex items-center gap-1"><Zap className="size-3" /> +1 cette semaine</p>
         </div>
      </div>

      {/* ─── Control Bar ─── */}
      <div className="bg-white rounded-[24px] sm:rounded-[32px] border px-4 sm:px-8 py-3 sm:py-4 flex items-center gap-3 sm:gap-4 shadow-sm" style={{ borderColor: C.border }}>
         <div className="relative flex-1 group">
            <Search className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 size-4 sm:size-5 text-slate-300 group-focus-within:text-[#6C5CE7]" />
            <Input
               value={search}
               onChange={(e) => setSearch(e.target.value)}
               placeholder="Rechercher..."
               className="h-12 sm:h-14 bg-transparent border-none rounded-none pl-10 sm:pl-14 text-sm font-black placeholder:text-slate-300 focus-visible:ring-0"
            />
         </div>
         <div className="flex items-center gap-2 sm:gap-3">
            <button className="hidden sm:flex h-12 px-6 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-white text-slate-400 hover:text-slate-600 transition-all text-[11px] font-black uppercase tracking-widest shadow-sm">
               Tous les Wilayas
            </button>
            <Button onClick={() => setIsCreating(true)} className="h-10 sm:h-12 px-5 sm:px-8 rounded-xl sm:rounded-2xl bg-[#6C5CE7] hover:bg-[#5849D1] text-white text-[10px] sm:text-[11px] font-black uppercase tracking-widest shadow-xl shadow-indigo-100 transition-all">
               <span className="hidden sm:inline">Nouveau Node</span>
               <Plus className="size-4 sm:hidden" />
            </Button>
         </div>
      </div>

      {/* ─── Grid View ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
         {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-[40px]" />)
         ) : warehouses.length === 0 ? (
            <div className="col-span-full py-40 bg-white rounded-[40px] border border-dashed border-slate-200 text-center opacity-30">
               <Database className="size-20 mx-auto mb-6" />
               <p className="text-sm font-black uppercase tracking-widest font-mono">Système de stockage vide</p>
            </div>
         ) : warehouses.map((w) => (
            <div key={w.id} className="bg-white rounded-[40px] border p-8 shadow-sm hover:shadow-xl hover:shadow-indigo-50/50 transition-all group relative overflow-hidden" style={{ borderColor: C.border }}>
               <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-100 transition-all scale-90 group-hover:scale-100">
                  <div className="flex gap-2">
                     <button onClick={() => openEdit(w)} className="size-11 rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-slate-400 hover:text-[#6C5CE7] hover:shadow-lg transition-all">
                        <Edit className="size-5" />
                     </button>
                     <button onClick={() => { if(confirm('Retirer cette installation ?')) deleteMutation.mutate(w.id); }} className="size-11 rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:shadow-lg transition-all">
                        <Trash2 className="size-5" />
                     </button>
                  </div>
               </div>

               <div className="flex items-center gap-5 mb-8">
                  <div className="size-16 rounded-[24px] bg-[#FAFBFD] border flex items-center justify-center shadow-inner group-hover:bg-[#F0EDFF] transition-all" style={{ borderColor: C.border }}>
                     <Warehouse className="size-8 text-slate-300 group-hover:text-[#6C5CE7]" />
                  </div>
                  <div className="min-w-0">
                     <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] font-black text-[#6C5CE7] bg-[#F0EDFF] px-2 py-0.5 rounded-lg font-mono">{w.code}</span>
                        <div className={cn("size-2 rounded-full", w.is_active !== false ? "bg-emerald-500 shadow-[0_0_5px_#10b981]" : "bg-slate-200")} />
                     </div>
                     <h3 className="text-lg font-black text-[#2D3436] truncate leading-none uppercase">{w.name}</h3>
                  </div>
               </div>

               <div className="space-y-4">
                  <div className="flex items-start gap-4 p-4 rounded-3xl bg-slate-50/50 border border-slate-100">
                     <div className="size-10 rounded-2xl bg-white flex items-center justify-center text-slate-300 shadow-sm shrink-0">
                        <MapPin className="size-5" />
                     </div>
                     <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{w.wilaya || 'Algérie'}</p>
                        <p className="text-xs font-bold text-slate-700 leading-relaxed truncate max-w-[180px]">{w.address || 'Quartier Industriel'}</p>
                     </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                     <div className="flex items-center gap-3">
                        <div className="size-8 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-300">
                           <User className="size-4" />
                        </div>
                        <div>
                           <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Manager</p>
                           <p className="text-[11px] font-black text-slate-700">{w.manager_name || 'N/A'}</p>
                        </div>
                     </div>
                     <div className="flex items-center gap-3">
                        <div className="size-8 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-300">
                           <Phone className="size-4" />
                        </div>
                        <div>
                           <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Ligne Directe</p>
                           <p className="text-[11px] font-black text-slate-700 font-mono tracking-tighter">{w.phone || 'N/A'}</p>
                        </div>
                     </div>
                  </div>
               </div>

               <div className="mt-8 pt-8 border-t border-slate-50 flex items-center justify-between">
                  <div className="flex flex-col">
                     <span className="text-[9px] font-black text-slate-300 uppercase tracking-[0.2em] mb-1">Capacité Remplie</span>
                     <p className="text-xs font-black text-slate-800">420 / {w.capacity || 1000} PCS</p>
                  </div>
                  <button className="flex items-center gap-2 text-[10px] font-black text-[#6C5CE7] uppercase tracking-widest group-hover:translate-x-1 transition-all">
                     Audit Stock <ChevronRight className="size-3" />
                  </button>
               </div>
            </div>
         ))}
      </div>

      {/* ─── Industrial Installation Modal ─── */}
      <Dialog open={isCreating} onOpenChange={(o) => { if(!o) closeModal(); }}>
         <DialogContent className="max-w-4xl p-0 border-none bg-white rounded-[24px] sm:rounded-[40px] overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">

            <div className="bg-[#2D3436] p-4 sm:p-10 text-white shrink-0">
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 sm:gap-6">
                     <div className="size-11 sm:size-16 bg-[#6C5CE7] rounded-2xl sm:rounded-3xl flex items-center justify-center shadow-2xl shadow-indigo-500/20 shrink-0">
                        {editingWh ? <Edit className="size-5 sm:size-8 text-white" /> : <Warehouse className="size-5 sm:size-8 text-white" />}
                     </div>
                     <div>
                        <DialogTitle className="text-lg sm:text-2xl font-black uppercase tracking-tight leading-none">
                           {editingWh ? 'Édition Installation' : 'Nouvel Entrepôt Core'}
                        </DialogTitle>
                        <DialogDescription className="text-white/40 text-[10px] font-black uppercase tracking-widest mt-1 sm:mt-2 hidden sm:block">
                           Configuration de la matrice de stockage et flux logistiques
                        </DialogDescription>
                     </div>
                  </div>
                  <button onClick={closeModal} className="p-2 sm:p-3 rounded-xl sm:rounded-2xl hover:bg-white/10 transition-all shrink-0">
                     <X className="size-5 sm:size-6 text-white/50" />
                  </button>
               </div>
            </div>
            
            <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(formData); }} className="flex-1 flex flex-col min-h-0">
               <Tabs defaultValue="base" className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <div className="px-3 sm:px-10 border-b bg-slate-50/50 overflow-x-auto">
                     <TabsList className="h-14 sm:h-16 bg-transparent gap-4 sm:gap-8 border-0 flex-nowrap w-max min-w-full">
                        <TabsTrigger value="base" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#6C5CE7] rounded-none px-0 text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436] whitespace-nowrap">
                           <Database className="size-3.5 sm:size-4 mr-1.5 sm:mr-2" /> <span className="hidden sm:inline">Identité Infrastructure</span><span className="sm:hidden">Identité</span>
                        </TabsTrigger>
                        <TabsTrigger value="logistics" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#6C5CE7] rounded-none px-0 text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436] whitespace-nowrap">
                           <Truck className="size-3.5 sm:size-4 mr-1.5 sm:mr-2" /> <span className="hidden sm:inline">Logistique & Capacité</span><span className="sm:hidden">Logistique</span>
                        </TabsTrigger>
                        <TabsTrigger value="advanced" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#6C5CE7] rounded-none px-0 text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436] whitespace-nowrap">
                           <ShieldCheck className="size-3.5 sm:size-4 mr-1.5 sm:mr-2" /> <span className="hidden sm:inline">Accès & Notes</span><span className="sm:hidden">Notes</span>
                        </TabsTrigger>
                     </TabsList>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 sm:p-10 custom-scrollbar">
                     <TabsContent value="base" className="mt-0 space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-8">
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Nom du Hub Logistique *</label>
                              <Input 
                                 value={formData.name}
                                 onChange={(e) => setFormData({...formData, name: e.target.value})}
                                 placeholder="Ex: Hub Oran Central" 
                                 className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black transition-all" 
                              />
                           </div>
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Code Technique Hub *</label>
                              <Input 
                                 value={formData.code}
                                 onChange={(e) => setFormData({...formData, code: e.target.value})}
                                 placeholder="W-ORN-01" 
                                 className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black font-mono transition-all uppercase" 
                              />
                           </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-8">
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Wilaya d'Implantation *</label>
                              <Select value={formData.wilaya} onValueChange={(v) => setFormData({...formData, wilaya: v})}>
                                 <SelectTrigger className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black transition-all">
                                    <SelectValue placeholder="Choisir wilaya" />
                                 </SelectTrigger>
                                 <SelectContent className="rounded-[24px] border-slate-100 shadow-2xl">
                                    {WILAYAS.map(w => <SelectItem key={w} value={w} className="font-bold text-xs">{w}</SelectItem>)}
                                 </SelectContent>
                              </Select>
                           </div>
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Ligne Directe (Fixe/Mobile)</label>
                              <Input 
                                 value={formData.phone}
                                 onChange={(e) => setFormData({...formData, phone: e.target.value})}
                                 placeholder="0550..." 
                                 className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black font-mono transition-all" 
                              />
                           </div>
                        </div>

                        <div className="space-y-3">
                           <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Adresse Géo-Physique</label>
                           <Input 
                              value={formData.address}
                              onChange={(e) => setFormData({...formData, address: e.target.value})}
                              placeholder="Zone Industrielle, Lot..." 
                              className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black transition-all" 
                           />
                        </div>
                     </TabsContent>

                     <TabsContent value="logistics" className="mt-0 space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-8">
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Nom Responsable de Site</label>
                              <Input 
                                 value={formData.manager_name}
                                 onChange={(e) => setFormData({...formData, manager_name: e.target.value})}
                                 placeholder="Prénom & Nom" 
                                 className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black transition-all" 
                              />
                           </div>
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Capacité d'Acquisition (PCS)</label>
                              <div className="relative">
                                 <Input 
                                    type="number"
                                    value={formData.capacity}
                                    onChange={(e) => setFormData({...formData, capacity: parseInt(e.target.value) || 0})}
                                    placeholder="1000" 
                                    className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black transition-all" 
                                 />
                                 <Grid3X3 className="absolute right-6 top-1/2 -translate-y-1/2 size-5 text-slate-300" />
                              </div>
                           </div>
                        </div>

                        <div className="bg-emerald-50/30 rounded-[32px] p-8 border border-emerald-100/50 flex items-center justify-between">
                           <div className="flex items-center gap-5">
                              <div className="size-14 rounded-2xl bg-white flex items-center justify-center text-emerald-500 shadow-sm border border-emerald-100">
                                 <ShieldCheck className="size-7" />
                              </div>
                              <div>
                                 <p className="text-sm font-black text-slate-800 uppercase tracking-tight leading-none mb-1">Hub Intelligent</p>
                                 <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Optimisation automatique des slots de stockage</p>
                              </div>
                           </div>
                           <Badge className="bg-emerald-500 text-white border-none px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-200">Activé</Badge>
                        </div>
                     </TabsContent>

                     <TabsContent value="advanced" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2">
                        <div className="space-y-3">
                           <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1 flex items-center gap-2">Notes Logistiques & Accès Spéciaux</label>
                           <textarea 
                              value={formData.note}
                              onChange={(e) => setFormData({...formData, note: e.target.value})}
                              placeholder="Codes d'accès, horaires de réception, contraintes de hauteur..." 
                              className="w-full min-h-[160px] p-8 rounded-[32px] border border-slate-100 bg-slate-50/50 text-sm font-medium focus:bg-white transition-all outline-none resize-none shadow-inner"
                           />
                        </div>
                     </TabsContent>
                  </div>
               </Tabs>

               <div className="p-4 sm:p-10 bg-white/80 backdrop-blur-md border-t border-slate-100 flex items-center justify-end gap-3 sm:gap-4 shrink-0">
                  <button
                     type="button"
                     onClick={closeModal}
                     className="h-12 sm:h-14 px-6 sm:px-10 rounded-2xl text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
                  >
                     Annuler
                  </button>
                  <Button
                     type="submit"
                     disabled={saveMutation.isPending}
                     className="h-12 sm:h-14 px-8 sm:px-14 rounded-2xl bg-[#6C5CE7] hover:bg-[#5849D1] text-white text-[10px] sm:text-[11px] font-black uppercase tracking-widest shadow-2xl shadow-indigo-100 transition-all active:scale-[0.98]"
                  >
                     {saveMutation.isPending ? <Loader2 className="size-5 animate-spin" /> : editingWh ? "FINALISER ✓" : "DÉPLOYER 🚀"}
                  </Button>
               </div>
            </form>
         </DialogContent>
      </Dialog>
    </div>
  );
}
