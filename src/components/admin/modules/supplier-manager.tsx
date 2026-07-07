'use client';

import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  Edit, 
  Trash2, 
  Phone, 
  Wallet,
  Activity,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  Mail,
  MapPin,
  Building2,
  TrendingUp,
  ExternalLink,
  ShieldCheck,
  CreditCard,
  Briefcase,
  Loader2,
  UserCircle2,
  X,
  PlusCircle,
  Banknote,
  Receipt,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { formatPrice } from '@/lib/format';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';

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

export default function SupplierManager() {
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<any | null>(null);
  const [fees, setFees] = useState([{ id: Date.now(), label: '', amount: '', fee_type: 'fixed', is_recurring: false }]);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    tax_id: '',
    bank_account: '',
    supply_category: '',
    note: '',
    payment_terms_days: '30',
    min_order_qty: '',
    min_order_amount: '',
    lead_time_days: '7',
    currency: 'DZD',
    credit_limit: '',
    discount_rate: '',
    return_policy: '',
    delivery_method: 'standard',
  });

  const activeStore = useAppStore((s) => s.activeStore);
  const queryClient = useQueryClient();

  // --- Data Fetching ---
  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', activeStore?.id, search],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(
      `/api/v1/suppliers?store_id=${activeStore?.id}&search=${search}`
    ),
    enabled: !!activeStore?.id,
  });

  const suppliers = data?.data || [];

  // --- Mutations ---
  const mutation = useMutation({
    mutationFn: (payload: any) => {
        const url = editingSupplier ? `/api/v1/suppliers/${editingSupplier.id}` : '/api/v1/suppliers';
        const method = editingSupplier ? 'PATCH' : 'POST';
        return apiFetch(url, {
           method,
           body: JSON.stringify({ ...payload, store_id: activeStore?.id })
        });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(editingSupplier ? 'Partenaire mis à jour' : 'Partenaire enregistré avec succès');
      closeModal();
    },
    onError: (err: any) => {
      toast.error('Erreur lors de l\'enregistrement', { description: err.message });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/suppliers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Partenaire supprimé');
    }
  });

  // --- Functions ---
  const openEdit = (supplier: any) => {
    setEditingSupplier(supplier);
    setFormData({
       name: supplier.name,
       phone: supplier.phone || '',
       email: supplier.email || '',
       address: supplier.address || '',
       city: supplier.city || '',
       tax_id: supplier.tax_id || '',
       bank_account: supplier.bank_account || '',
       supply_category: supplier.supply_category || '',
       note: supplier.note || '',
       payment_terms_days: String(supplier.payment_terms_days || '30'),
       min_order_qty: String(supplier.min_order_qty || ''),
       min_order_amount: String(supplier.min_order_amount || ''),
       lead_time_days: String(supplier.lead_time_days || '7'),
       currency: supplier.currency || 'DZD',
       credit_limit: String(supplier.credit_limit || ''),
       discount_rate: String(supplier.discount_rate || ''),
       return_policy: supplier.return_policy || '',
       delivery_method: supplier.delivery_method || 'standard',
    });
    setFees([{ id: Date.now(), label: '', amount: '', fee_type: 'fixed', is_recurring: false }]); 
    setIsCreating(true);
  };

  const closeModal = () => {
    setIsCreating(false);
    setEditingSupplier(null);
    setFormData({ name: '', phone: '', email: '', address: '', city: '', tax_id: '', bank_account: '', supply_category: '', note: '', payment_terms_days: '30', min_order_qty: '', min_order_amount: '', lead_time_days: '7', currency: 'DZD', credit_limit: '', discount_rate: '', return_policy: '', delivery_method: 'standard' });
    setFees([{ id: Date.now(), label: '', amount: '', fee_type: 'fixed', is_recurring: false }]);
  };

  const addFee = () => setFees([...fees, { id: Date.now(), label: '', amount: '', fee_type: 'fixed', is_recurring: false }]);
  const removeFee = (id: number) => setFees(fees.filter(f => f.id !== id));
  const updateFee = (id: number, field: string, value: any) => {
    setFees(fees.map(f => f.id === id ? { ...f, [field]: value } : f));
  };
  const totalFees = fees.filter(f => f.amount && f.fee_type === 'fixed').reduce((s, f) => s + parseFloat(f.amount || '0'), 0);

  const handleSubmit = () => {
    if (!formData.name) return toast.error('Le nom est requis');
    
    // Structure fees info for the note if backend doesn't have specific fields
    const feesFormatted = fees.filter(f => f.label && f.amount)
      .map(f => `[Frais] ${f.label}: ${f.amount} DA`)
      .join('\n');
    
    const payload = { 
        ...formData, 
        note: formData.note ? `${formData.note}\n\nStatut Frais:\n${feesFormatted}` : feesFormatted 
    };
    
    mutation.mutate(payload);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      
      {/* ─── Search & Global Stats ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
         <div className="lg:col-span-3 bg-white rounded-[24px] sm:rounded-[32px] border p-3 sm:p-4 flex items-center shadow-sm" style={{ borderColor: C.border }}>
            <div className="relative flex-1 group">
               <Search className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 size-4 sm:size-5 text-slate-300 group-focus-within:text-[#6C5CE7] transition-colors" />
               <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher..."
                  className="h-12 sm:h-14 bg-slate-50 border-none rounded-[20px] sm:rounded-[24px] pl-10 sm:pl-14 text-sm font-black placeholder:text-slate-300 focus-visible:ring-2 focus-visible:ring-[#6C5CE7]/20"
               />
            </div>
            <Button onClick={() => setIsCreating(true)} className="ml-3 sm:ml-4 h-10 sm:h-14 px-4 sm:px-8 rounded-xl sm:rounded-2xl bg-[#6C5CE7] hover:bg-[#5849D1] text-white text-[10px] sm:text-[11px] font-black uppercase tracking-widest shadow-2xl shadow-indigo-100 transition-all border-none">
               <UserPlus className="size-4 sm:mr-3 sm:size-5" /> <span className="hidden sm:inline">Nouveau Partenaire</span>
            </Button>
         </div>
         <div className="bg-[#2D3436] rounded-[32px] px-8 py-6 flex items-center justify-between shadow-xl">
            <div>
               <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1">Actifs Sourcing</p>
               <p className="text-3xl font-black text-white leading-none">{suppliers.length}</p>
            </div>
            <div className="size-14 rounded-2xl bg-white/10 flex items-center justify-center text-[#6C5CE7]">
               <Building2 className="size-8" />
            </div>
         </div>
      </div>

      {/* ─── Supplier Cards Grid ─── */}
      {isLoading ? (
         <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-72 rounded-[40px]" />)}
         </div>
      ) : suppliers.length === 0 ? (
         <div className="bg-white rounded-[40px] border p-32 text-center" style={{ borderColor: C.border }}>
            <Building2 className="size-20 mx-auto mb-6 text-slate-100" />
            <p className="text-sm font-black text-slate-400 uppercase tracking-[0.2em]">Aucun partenaire référencé</p>
         </div>
      ) : (
         <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
            {suppliers.map((s) => (
               <div key={s.id} className="bg-white rounded-[40px] border p-8 shadow-sm hover:shadow-xl hover:shadow-indigo-50/50 transition-all group relative overflow-hidden" style={{ borderColor: C.border }}>
                  <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-100 transition-opacity">
                     <div className="flex gap-2">
                        <button onClick={() => openEdit(s)} className="size-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 hover:text-[#6C5CE7] hover:bg-white border hover:border-slate-100 transition-all shadow-sm">
                           <Edit className="size-5" />
                        </button>
                        <button onClick={() => { if(confirm('Supprimer ce partenaire ?')) deleteMutation.mutate(s.id); }} className="size-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-white border hover:border-slate-100 transition-all shadow-sm">
                           <Trash2 className="size-5" />
                        </button>
                     </div>
                  </div>

                  <div className="flex items-start gap-6">
                     <div className="size-16 bg-[#F0EDFF] rounded-[24px] flex items-center justify-center text-[#6C5CE7] shrink-0 shadow-inner">
                        <Building2 className="size-8" />
                     </div>
                     <div className="min-w-0 pr-12">
                        <h3 className="text-lg font-black text-[#2D3436] truncate leading-tight">{s.name}</h3>
                        <p className="text-[10px] font-black text-[#6C5CE7] uppercase tracking-widest mt-1.5">{s.supply_category || 'Sourcing Général'}</p>
                        <div className="flex items-center gap-3 mt-4">
                           <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5"><Phone className="size-3" /> {s.phone || 'N/A'}</span>
                           <span className="h-1 w-1 rounded-full bg-slate-200" />
                           <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5"><MapPin className="size-3" /> {s.city || 'Alger'}</span>
                        </div>
                     </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-8 pt-8 border-t border-slate-50">
                     <div className="bg-slate-50/50 rounded-2xl p-4">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Dû Total</p>
                        <p className="text-base font-black text-slate-900">{formatPrice(s.total_due || 0)}</p>
                     </div>
                     <div className="bg-emerald-50/30 rounded-2xl p-4">
                        <p className="text-[9px] font-black text-[#00B894] uppercase tracking-widest mb-1.5">Réglé</p>
                        <p className="text-base font-black text-[#00B894]">{formatPrice(s.total_paid || 0)}</p>
                     </div>
                  </div>

                  <div className="mt-6 flex items-center justify-between">
                     <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                           <ShieldCheck className="size-3.5 text-[#00B894]" />
                           <span className="text-[10px] font-black text-slate-800 uppercase tracking-tighter">Indice Fiabilité {s.reliability_score || 100}%</span>
                        </div>
                        <div className="w-28 h-1.5 bg-slate-50 rounded-full mt-2 overflow-hidden border border-slate-100">
                           <div className="h-full bg-gradient-to-r from-[#00B894] to-[#00cec9]" style={{ width: `${s.reliability_score || 100}%` }} />
                        </div>
                     </div>
                     <button className="flex items-center gap-2 text-[10px] font-black text-[#6C5CE7] uppercase tracking-widest hover:translate-x-1 transition-transform">
                        Détails Finances <ChevronRight className="size-3" />
                     </button>
                  </div>
               </div>
            ))}
         </div>
      )}

      {/* ─── Advanced Supplier Modal ─── */}
      <Dialog open={isCreating} onOpenChange={(o) => { if(!o) closeModal(); }}>
         <DialogContent className="max-w-3xl p-0 border-none bg-white rounded-[24px] sm:rounded-[40px] overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">

            <div className="bg-[#2D3436] p-4 sm:p-10 text-white shrink-0">
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 sm:gap-6">
                     <div className="size-11 sm:size-16 bg-[#6C5CE7] rounded-2xl sm:rounded-3xl flex items-center justify-center shadow-2xl shadow-indigo-500/20 shrink-0">
                        {editingSupplier ? <Edit className="size-5 sm:size-8 text-white" /> : <Plus className="size-5 sm:size-8 text-white" />}
                     </div>
                     <div>
                        <DialogTitle className="text-lg sm:text-2xl font-black uppercase tracking-tight leading-none">
                           {editingSupplier ? 'Édition Dossier' : 'Référencement Partenaire'}
                        </DialogTitle>
                        <DialogDescription className="text-white/40 text-[10px] font-black uppercase tracking-widest mt-1 sm:mt-2 hidden sm:block">
                           Gestion des flux d'approvisionnement et paiements
                        </DialogDescription>
                     </div>
                  </div>
                  <button onClick={closeModal} className="p-2 sm:p-3 rounded-xl sm:rounded-2xl hover:bg-white/10 transition-all shrink-0">
                     <X className="size-5 sm:size-6 text-white/50" />
                  </button>
               </div>
            </div>
            
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="flex-1 overflow-hidden flex flex-col min-h-0">
               <Tabs defaultValue="identity" className="flex-1 flex flex-col min-h-0">
                  <div className="px-3 sm:px-10 border-b bg-slate-50/50 overflow-x-auto">
                     <TabsList className="h-14 sm:h-16 bg-transparent gap-3 sm:gap-8 border-0 flex-nowrap w-max min-w-full">
                        <TabsTrigger value="identity" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#6C5CE7] rounded-none px-0 text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436] whitespace-nowrap">
                           <UserCircle2 className="size-3.5 sm:size-4 mr-1.5 sm:mr-2" /> <span className="hidden sm:inline">Identification</span><span className="sm:hidden">Identité</span>
                        </TabsTrigger>
                        <TabsTrigger value="banking" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#6C5CE7] rounded-none px-0 text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436] whitespace-nowrap">
                           <Banknote className="size-3.5 sm:size-4 mr-1.5 sm:mr-2" /> <span className="hidden sm:inline">Banque & Fiscal</span><span className="sm:hidden">Banque</span>
                        </TabsTrigger>
                        <TabsTrigger value="fees" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#6C5CE7] rounded-none px-0 text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436] whitespace-nowrap">
                           <Receipt className="size-3.5 sm:size-4 mr-1.5 sm:mr-2" /> <span className="hidden sm:inline">Structure Frais</span><span className="sm:hidden">Frais</span>
                        </TabsTrigger>
                        <TabsTrigger value="conditions" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#6C5CE7] rounded-none px-0 text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436] whitespace-nowrap">
                           <Briefcase className="size-3.5 sm:size-4 mr-1.5 sm:mr-2" /> Conditions
                        </TabsTrigger>
                     </TabsList>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 sm:p-10 custom-scrollbar pb-32">
                     <TabsContent value="identity" className="mt-0 space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-8">
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Nom / Enseigne Commerciale *</label>
                              <Input 
                                 value={formData.name}
                                 onChange={(e) => setFormData({...formData, name: e.target.value})}
                                 placeholder="Nom du fournisseur" 
                                 className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black transition-all" 
                              />
                           </div>
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Catégorie de fourniture</label>
                              <Input 
                                 value={formData.supply_category}
                                 onChange={(e) => setFormData({...formData, supply_category: e.target.value})}
                                 placeholder="Ex: Tissus, Accessoires, Machines" 
                                 className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black transition-all" 
                              />
                           </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-8">
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Téléphone Direct</label>
                              <Input 
                                 value={formData.phone}
                                 onChange={(e) => setFormData({...formData, phone: e.target.value})}
                                 placeholder="0550..." 
                                 className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black font-mono transition-all" 
                              />
                           </div>
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Email Professionnel</label>
                              <Input 
                                 value={formData.email}
                                 onChange={(e) => setFormData({...formData, email: e.target.value})}
                                 placeholder="contact@fournisseur.dz" 
                                 className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-bold" 
                              />
                           </div>
                        </div>

                        <div className="space-y-3">
                           <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Adresse Siège / Entrepôt</label>
                           <Input 
                              value={formData.address}
                              onChange={(e) => setFormData({...formData, address: e.target.value})}
                              placeholder="Adresse complète..." 
                              className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-bold" 
                           />
                        </div>
                     </TabsContent>

                     <TabsContent value="banking" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2">
                        <div className="bg-[#F8F9FC] rounded-[32px] p-8 border border-slate-100">
                           <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                              <CreditCard className="size-4 text-[#6C5CE7]" /> Coordonnées Bancaires (RIB/RIP)
                           </h4>
                           <div className="space-y-4">
                              <Input 
                                 value={formData.bank_account}
                                 onChange={(e) => setFormData({...formData, bank_account: e.target.value})}
                                 placeholder="RIB : 007..." 
                                 className="h-14 border-slate-200 bg-white rounded-2xl px-6 text-sm font-mono tracking-widest font-black" 
                              />
                              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter italic px-2 flex items-center gap-1.5"><ShieldCheck className="size-3" /> Données chiffrées & sécurisées (Protocole AzzougShield)</p>
                           </div>
                        </div>

                        <div className="space-y-3">
                           <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">N° Identification Fiscale (NIF)</label>
                           <Input 
                              value={formData.tax_id}
                              onChange={(e) => setFormData({...formData, tax_id: e.target.value})}
                              placeholder="0001..." 
                              className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-mono font-black transition-all" 
                           />
                        </div>
                     </TabsContent>

                     <TabsContent value="fees" className="mt-0 space-y-6 animate-in fade-in slide-in-from-bottom-2">
                        {/* Total banner */}
                        <div className="flex items-center justify-between p-5 bg-[#F0EDFF] rounded-2xl border border-[#6C5CE7]/10">
                           <div>
                              <p className="text-[10px] font-black text-[#6C5CE7] uppercase tracking-widest mb-0.5">Total frais fixes</p>
                              <p className="text-2xl font-black text-[#2D3436]">{formatPrice(totalFees)}</p>
                           </div>
                           <Button type="button" onClick={addFee} className="h-10 px-5 rounded-xl bg-[#6C5CE7] text-white text-[10px] font-black uppercase tracking-widest">
                              <PlusCircle className="mr-2 size-3.5" /> Ajouter
                           </Button>
                        </div>

                        {/* Column headers — desktop only */}
                        <div className="hidden sm:grid grid-cols-[1fr,120px,110px,auto,40px] gap-3 items-center px-2">
                           {['Nature du frais', 'Montant', 'Type', 'Récurrent', ''].map(h => (
                              <span key={h} className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{h}</span>
                           ))}
                        </div>

                        <div className="space-y-3">
                           <AnimatePresence>
                           {fees.map((fee) => (
                              <motion.div
                                 key={fee.id}
                                 initial={{ opacity: 0, y: 10 }}
                                 animate={{ opacity: 1, y: 0 }}
                                 exit={{ opacity: 0, x: -20 }}
                                 className="flex flex-col sm:grid sm:grid-cols-[1fr,120px,110px,auto,40px] gap-2 sm:gap-3 sm:items-center p-3 sm:p-0 bg-slate-50/50 sm:bg-transparent rounded-2xl sm:rounded-none"
                              >
                                 <Input
                                    value={fee.label}
                                    onChange={(e) => updateFee(fee.id, 'label', e.target.value)}
                                    placeholder="Ex: Douane, Transport..."
                                    className="h-11 sm:h-12 border-slate-100 bg-white sm:bg-slate-50/50 rounded-xl px-4 text-sm font-black"
                                 />
                                 <div className="relative flex gap-2">
                                    <div className="relative flex-1 sm:flex-none">
                                       <Input
                                          type="number"
                                          value={fee.amount}
                                          onChange={(e) => updateFee(fee.id, 'amount', e.target.value)}
                                          placeholder="0"
                                          className="h-11 sm:h-12 border-slate-100 bg-white sm:bg-slate-50 rounded-xl pl-4 pr-12 text-sm font-black text-[#00B894]"
                                       />
                                       <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300">
                                          {fee.fee_type === 'percentage' ? '%' : 'DA'}
                                       </span>
                                    </div>
                                    <button type="button" onClick={() => removeFee(fee.id)} disabled={fees.length === 1} className="size-11 sm:hidden flex items-center justify-center rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all border border-slate-100 bg-white shrink-0">
                                       <Trash2 className="size-4" />
                                    </button>
                                 </div>
                                 <select
                                    value={fee.fee_type}
                                    onChange={(e) => updateFee(fee.id, 'fee_type', e.target.value)}
                                    className="h-11 sm:h-12 rounded-xl border border-slate-100 bg-white text-[11px] font-black text-slate-600 px-3"
                                 >
                                    <option value="fixed">Fixe</option>
                                    <option value="percentage">% Prix</option>
                                    <option value="per_unit">Par unité</option>
                                    <option value="per_kg">Par kg</option>
                                 </select>
                                 <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                       type="checkbox"
                                       checked={fee.is_recurring}
                                       onChange={(e) => updateFee(fee.id, 'is_recurring', e.target.checked)}
                                       className="size-4 rounded text-[#6C5CE7]"
                                    />
                                    <span className="text-[10px] font-bold text-slate-500">Mensuel</span>
                                 </label>
                                 <button type="button" onClick={() => removeFee(fee.id)} disabled={fees.length === 1} className="size-10 hidden sm:flex items-center justify-center rounded-xl text-slate-200 hover:text-rose-500 hover:bg-rose-50 transition-all">
                                    <Trash2 className="size-4" />
                                 </button>
                              </motion.div>
                           ))}
                           </AnimatePresence>
                        </div>

                        {/* Fee presets */}
                        <div className="pt-4 border-t border-slate-100">
                           <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-3">Frais standards courants</p>
                           <div className="flex flex-wrap gap-2">
                             {[
                               { label: 'Transport national', amount: '3500', fee_type: 'fixed' },
                               { label: 'Douane import', amount: '5', fee_type: 'percentage' },
                               { label: 'Assurance marchandise', amount: '2', fee_type: 'percentage' },
                               { label: 'Manutention', amount: '1500', fee_type: 'fixed' },
                               { label: 'Stockage/mois', amount: '8000', fee_type: 'fixed', is_recurring: true },
                             ].map(preset => (
                               <button
                                 key={preset.label}
                                 type="button"
                                 onClick={() => setFees(f => [...f.filter(x => x.label !== ''), { id: Date.now(), ...preset, is_recurring: preset.is_recurring ?? false }])}
                                 className="px-3 py-1.5 text-[10px] font-bold rounded-xl bg-slate-100 text-slate-600 hover:bg-[#F0EDFF] hover:text-[#6C5CE7] transition-colors border border-transparent hover:border-[#6C5CE7]/20"
                               >
                                 + {preset.label}
                               </button>
                             ))}
                           </div>
                        </div>

                        <div className="space-y-3 pt-4 border-t border-slate-100">
                           <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Note Interne</label>
                           <textarea
                              value={formData.note}
                              onChange={(e) => setFormData({...formData, note: e.target.value})}
                              placeholder="Horaires, préférences, historique des litiges..."
                              className="w-full min-h-[100px] p-5 rounded-2xl border border-slate-100 bg-slate-50/50 text-sm font-medium focus:bg-white transition-all outline-none resize-none"
                           />
                        </div>
                     </TabsContent>

                     <TabsContent value="conditions" className="mt-0 space-y-6 animate-in fade-in slide-in-from-bottom-2">
                        <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                           <Briefcase className="size-4 text-[#6C5CE7]" /> Conditions commerciales
                        </h3>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                           <div className="space-y-2 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Délai paiement</label>
                              <div className="flex items-baseline gap-1">
                                 <Input type="number" value={formData.payment_terms_days} onChange={e => setFormData({...formData, payment_terms_days: e.target.value})} className="h-10 border-0 bg-transparent p-0 text-2xl font-black text-[#6C5CE7] w-20 focus-visible:ring-0" />
                                 <span className="text-[10px] font-black text-slate-400">jours</span>
                              </div>
                              <p className="text-[9px] text-slate-400">Net 30 / 60 / 90</p>
                           </div>
                           <div className="space-y-2 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Délai livraison</label>
                              <div className="flex items-baseline gap-1">
                                 <Input type="number" value={formData.lead_time_days} onChange={e => setFormData({...formData, lead_time_days: e.target.value})} className="h-10 border-0 bg-transparent p-0 text-2xl font-black text-[#20bf6b] w-20 focus-visible:ring-0" />
                                 <span className="text-[10px] font-black text-slate-400">jours</span>
                              </div>
                              <p className="text-[9px] text-slate-400">Lead time moyen</p>
                           </div>
                           <div className="space-y-2 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Remise négociée</label>
                              <div className="flex items-baseline gap-1">
                                 <Input type="number" value={formData.discount_rate} onChange={e => setFormData({...formData, discount_rate: e.target.value})} placeholder="0" className="h-10 border-0 bg-transparent p-0 text-2xl font-black text-orange-500 w-20 focus-visible:ring-0" />
                                 <span className="text-[10px] font-black text-slate-400">%</span>
                              </div>
                              <p className="text-[9px] text-slate-400">Sur le catalogue</p>
                           </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                           <div className="space-y-2">
                              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Qté minimum commande (MOQ)</label>
                              <Input type="number" value={formData.min_order_qty} onChange={e => setFormData({...formData, min_order_qty: e.target.value})} placeholder="Ex: 10 unités" className="h-12 border-slate-100 bg-slate-50/50 rounded-2xl px-5 text-sm font-black" />
                           </div>
                           <div className="space-y-2">
                              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Montant minimum (DA)</label>
                              <Input type="number" value={formData.min_order_amount} onChange={e => setFormData({...formData, min_order_amount: e.target.value})} placeholder="Ex: 50 000 DA" className="h-12 border-slate-100 bg-slate-50/50 rounded-2xl px-5 text-sm font-black" />
                           </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                           <div className="space-y-2">
                              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Plafond crédit (DA)</label>
                              <Input type="number" value={formData.credit_limit} onChange={e => setFormData({...formData, credit_limit: e.target.value})} placeholder="Ligne de crédit max" className="h-12 border-slate-100 bg-slate-50/50 rounded-2xl px-5 text-sm font-black" />
                           </div>
                           <div className="space-y-2">
                              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Mode de livraison</label>
                              <select value={formData.delivery_method} onChange={e => setFormData({...formData, delivery_method: e.target.value})} className="w-full h-12 rounded-2xl border border-slate-100 bg-slate-50/50 text-sm font-bold text-slate-700 px-5">
                                 <option value="standard">Standard (camion)</option>
                                 <option value="express">Express (coursier)</option>
                                 <option value="port">Port (import)</option>
                                 <option value="air">Aérien</option>
                                 <option value="pickup">Récupération entrepôt</option>
                              </select>
                           </div>
                        </div>

                        <div className="space-y-2">
                           <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Politique de retour</label>
                           <textarea
                              value={formData.return_policy}
                              onChange={e => setFormData({...formData, return_policy: e.target.value})}
                              placeholder="Conditions de retour marchandise, délais, procédure..."
                              className="w-full min-h-[80px] p-4 rounded-2xl border border-slate-100 bg-slate-50/50 text-sm font-medium focus:bg-white outline-none resize-none transition-all"
                           />
                        </div>

                        <div className="space-y-2">
                           <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Devise</label>
                           <div className="flex gap-2">
                             {['DZD', 'EUR', 'USD', 'CNY', 'AED'].map(c => (
                               <button key={c} type="button" onClick={() => setFormData({...formData, currency: c})}
                                 className={cn("px-4 py-2 rounded-xl text-[11px] font-black transition-all border-2", formData.currency === c ? "border-[#6C5CE7] bg-[#F0EDFF] text-[#6C5CE7]" : "border-slate-100 text-slate-400 hover:border-slate-200")}
                               >{c}</button>
                             ))}
                           </div>
                        </div>
                     </TabsContent>
                  </div>
               </Tabs>

               <div className="absolute bottom-0 inset-x-0 p-4 sm:p-10 bg-white/80 backdrop-blur-md border-t border-slate-100 flex items-center justify-end gap-3 sm:gap-4 shrink-0 z-20">
                  <button
                     type="button"
                     onClick={closeModal}
                     className="h-12 sm:h-14 px-6 sm:px-10 rounded-2xl text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
                  >
                     Annuler
                  </button>
                  <Button
                     onClick={handleSubmit}
                     disabled={mutation.isPending}
                     className="h-12 sm:h-14 px-8 sm:px-14 rounded-2xl bg-[#6C5CE7] hover:bg-[#5849D1] text-white text-[10px] sm:text-[11px] font-black uppercase tracking-widest shadow-2xl shadow-indigo-100 transition-all active:scale-[0.98]"
                  >
                     {mutation.isPending ? <Loader2 className="size-5 animate-spin" /> : editingSupplier ? "METTRE À JOUR ✓" : "DÉPLOYER 🚀"}
                  </Button>
               </div>
            </form>
         </DialogContent>
      </Dialog>
    </div>
  );
}
