'use client';

import React, { useState } from 'react';
import {
   Receipt,
   Search,
   Plus,
   Filter,
   RefreshCw,
   Zap,
   UserCircle,
   Monitor,
   Package,
   Truck,
   Warehouse,
   MoreHorizontal,
   ChevronLeft,
   ChevronRight,
   DollarSign,
   Repeat,
   Edit3,
   Trash2,
   Eye,
   Clock,
   ShieldCheck,
   X,
   Activity,
   Building2,
   FileText,
   AlertTriangle,
   Banknote,
   MoreVertical,
   Loader2,
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
   DialogTitle,
   DialogFooter,
   DialogHeader,
   DialogDescription,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/format';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const C = {
   primary: '#6C5CE7', primaryBg: '#F0EDFF',
   success: '#00B894', successBg: '#E6FFF8',
   danger: '#E17055', dangerBg: '#FFEDE9',
   warning: '#FDCB6E', warningBg: '#FFF8E6',
   info: '#0984E3', infoBg: '#E8F4FE',
   orange: '#FD7014', orangeBg: '#FFF3E8',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

function ExpenseKpiCard({ label, value, icon: Icon, color, bgColor }: {
   label: string; value: number; icon: React.ElementType; color: string; bgColor: string;
}) {
   return (
      <div className="bg-white rounded-[32px] border p-8 flex items-center gap-6 shadow-sm hover:border-indigo-100 transition-all group" style={{ borderColor: C.border }}>
         <div className="size-14 rounded-2xl flex items-center justify-center shrink-0 shadow-inner group-hover:scale-105 transition-transform" style={{ backgroundColor: bgColor }}>
            <Icon className="size-6" style={{ color }} />
         </div>
         <div className="min-w-0">
            <p className="text-[10px] font-black text-[#636E72] uppercase tracking-[0.2em] mb-1">{label}</p>
            <p className="text-2xl font-black text-[#2D3436] tabular-nums tracking-tighter">{formatPrice(value)}</p>
         </div>
      </div>
   );
}

export default function ExpensesDashboard() {
   const [search, setSearch] = useState('');
   const [isCreating, setIsCreating] = useState(false);
   const [category, setCategory] = useState('all');
   const { activeStore } = useAppStore();
   const queryClient = useQueryClient();

   // Short-term: operational charges recurring ≤ monthly. Long-term: structural investments ≥ yearly.
   const TERM_BY_CATEGORY: Record<string, 'SHORT_TERM' | 'LONG_TERM'> = {
      MARKETING: 'SHORT_TERM', HR: 'SHORT_TERM', IT: 'SHORT_TERM',
      LOGISTICS: 'SHORT_TERM', TAX: 'SHORT_TERM',
      RENT: 'LONG_TERM', OTHER: 'SHORT_TERM',
   };

   // --- Form State ---
   const [formData, setFormData] = useState({
      label: '',
      amount: 0,
      tax_amount: 0,
      category: 'MARKETING',
      term_type: 'SHORT_TERM' as 'SHORT_TERM' | 'LONG_TERM',
      description: '',
      is_recurring: false,
      beneficiary: '',
      wallet_id: '',
      recurrence_period: 'MONTHLY',
      expense_date: new Date().toISOString().split('T')[0],
      receipt_url: ''
   });

   // --- Data Fetching ---
   const { data: expensesData, isLoading } = useQuery({
      queryKey: ['expenses', activeStore?.id, search, category],
      queryFn: () => {
         let url = `/api/v1/expenses?store_id=${activeStore?.id}&search=${search}`;
         if (category !== 'all' && category !== 'SHORT_TERM' && category !== 'LONG_TERM') url += `&category=${category}`;
         return apiFetch<{ success: boolean; data: any[] }>(url);
      },
      enabled: !!activeStore?.id,
   });

   const { data: walletsResponse } = useQuery({
      queryKey: ['wallets', activeStore?.id],
      queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/finance/wallets?store_id=${activeStore?.id}`),
      enabled: !!activeStore?.id,
   });

   const allExpenses = expensesData?.data || [];
   const expenses = (category === 'SHORT_TERM' || category === 'LONG_TERM')
      ? allExpenses.filter((e: any) => (e.term_type ?? TERM_BY_CATEGORY[e.category] ?? 'SHORT_TERM') === category)
      : allExpenses;
   const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

   // --- Mutation ---
   const createMutation = useMutation({
      mutationFn: (data: any) => apiFetch('/api/v1/expenses', {
         method: 'POST',
         body: JSON.stringify({ ...data, store_id: activeStore?.id, total_amount: data.amount + data.tax_amount })
      }),
      onSuccess: () => {
         queryClient.invalidateQueries({ queryKey: ['expenses'] });
         toast.success('Dépense enregistrée dans le grand livre');
         setIsCreating(false);
         setFormData({ 
            label: '', amount: 0, tax_amount: 0, category: 'MARKETING', 
            term_type: 'SHORT_TERM', description: '', is_recurring: false, 
            beneficiary: '', wallet_id: '', recurrence_period: 'MONTHLY',
            expense_date: new Date().toISOString().split('T')[0],
            receipt_url: ''
         });
      },
      onError: (err: any) => toast.error('Erreur technique', { description: err.message })
   });

   const shortTermTotal = expenses.filter(e => (e.term_type ?? TERM_BY_CATEGORY[e.category] ?? 'SHORT_TERM') === 'SHORT_TERM').reduce((s: number, e: any) => s + e.amount, 0);
   const longTermTotal = expenses.filter(e => (e.term_type ?? TERM_BY_CATEGORY[e.category] ?? 'SHORT_TERM') === 'LONG_TERM').reduce((s: number, e: any) => s + e.amount, 0);

   const summaryCards = [
      { label: 'Flux de Sortie Global', value: totalExpenses, icon: DollarSign, color: C.text, bgColor: '#F0F3F6' },
      { label: 'Charges Court Terme', value: shortTermTotal, icon: Clock, color: C.warning, bgColor: C.warningBg },
      { label: 'Charges Long Terme', value: longTermTotal, icon: Building2, color: C.danger, bgColor: C.dangerBg },
      { label: 'Marketing & ADS', value: expenses.filter(e => e.category === 'MARKETING').reduce((s: number, e: any) => s + e.amount, 0), icon: Zap, color: C.primary, bgColor: C.primaryBg },
   ];

   return (
      <div className="space-y-8 pb-32 animate-in fade-in duration-700">
         
         {/* ─── Industrial Header ─── */}
         <div className="bg-[#2D3436] rounded-[40px] p-10 text-white relative overflow-hidden shadow-2xl">
            <div className="absolute top-0 right-0 p-10 opacity-[0.05] -rotate-12 translate-x-12 translate-y-[-20%]">
               <Receipt className="size-64" />
            </div>
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
               <div className="flex items-center gap-6">
                  <div className="size-16 bg-[#E17055] rounded-3xl flex items-center justify-center shadow-2xl shadow-rose-500/20">
                     <Receipt className="size-8 text-white" />
                  </div>
                  <div>
                     <h1 className="text-2xl font-black uppercase tracking-tight leading-none">Registre des Charges</h1>
                     <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mt-2 flex items-center gap-2">
                        <ShieldCheck className="size-4 text-emerald-400" /> Bilan financier consolidé
                     </p>
                  </div>
               </div>
               <div className="flex items-end gap-10">
                  <div className="text-right">
                     <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1">Dépenses Cumulées</p>
                     <p className="text-4xl font-black tabular-nums tracking-tighter">{formatPrice(totalExpenses)}</p>
                  </div>
                  <Button onClick={() => setIsCreating(true)} className="h-16 px-10 rounded-2xl bg-white text-[#2D3436] hover:bg-slate-50 text-[11px] font-black uppercase tracking-widest shadow-2xl transition-all active:scale-[0.98]">
                     <Plus className="size-4 mr-2" /> Déclarer une charge
                  </Button>
               </div>
            </div>
         </div>

         {/* ─── KPI Grid ─── */}
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {summaryCards.map((card, i) => (
               <ExpenseKpiCard key={i} {...card} />
            ))}
         </div>

         {/* ─── Data Controls ─── */}
         <div className="bg-white rounded-[32px] border p-6 flex flex-col md:flex-row gap-6 items-center shadow-sm sticky top-0 z-30" style={{ borderColor: C.border }}>
            <div className="relative flex-1 group w-full">
               <Search className="absolute left-5 top-1/2 -translate-y-1/2 size-5 text-slate-300 group-focus-within:text-[#6C5CE7]" />
               <Input 
                  value={search} onChange={(e) => setSearch(e.target.value)} 
                  placeholder="Rechercher par libellé, bénéficiaire ou motif..." 
                  className="h-14 bg-[#F8F9FC] border-none rounded-2xl pl-14 text-sm font-black placeholder:text-slate-300 focus-visible:ring-1 focus-visible:ring-indigo-100 transition-all" 
               />
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
               <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="h-14 w-full md:w-48 bg-white border-slate-100 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-sm">
                     <SelectValue placeholder="Catégorie" />
                  </SelectTrigger>
                  <SelectContent className="rounded-[24px]">
                     <SelectItem value="all">TOUTES CHARGES</SelectItem>
                     <SelectItem value="SHORT_TERM">⚡ COURT TERME</SelectItem>
                     <SelectItem value="LONG_TERM">🏗 LONG TERME</SelectItem>
                     <SelectItem value="MARKETING">MARKETING & ADS</SelectItem>
                     <SelectItem value="HR">SALAIRES & RH</SelectItem>
                     <SelectItem value="IT">INFRA & SAAS</SelectItem>
                     <SelectItem value="LOGISTICS">LOGISTIQUE</SelectItem>
                     <SelectItem value="RENT">LOYERS & LOCAUX</SelectItem>
                     <SelectItem value="OTHER">DIVERS</SelectItem>
                  </SelectContent>
               </Select>
               <button className="size-14 rounded-2xl border border-slate-100 flex items-center justify-center text-slate-400 hover:bg-[#F0EDFF] hover:text-[#6C5CE7] transition-all shrink-0">
                  <Filter className="size-5" />
               </button>
            </div>
         </div>

         {/* ─── Industrial Table ─── */}
         <div className="bg-white rounded-[40px] border shadow-sm overflow-hidden" style={{ borderColor: C.border }}>
            <div className="overflow-x-auto">
               <table className="w-full text-left min-w-[1100px]">
                  <thead>
                     <tr className="border-b" style={{ borderColor: '#F8F9FC', backgroundColor: '#FAFBFD' }}>
                        <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Horodatage</th>
                        <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Catégorie / Terme</th>
                        <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Libellé Operationnel</th>
                        <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Montant Exporté</th>
                        <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Récurence</th>
                        <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Contrôle</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: '#F8F9FC' }}>
                     {isLoading ? (
                        Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={6} className="px-10 py-8 animate-pulse bg-slate-50/20" /></tr>)
                     ) : expenses.length === 0 ? (
                        <tr><td colSpan={6} className="px-10 py-32 text-center text-slate-300 text-xs font-black uppercase tracking-[0.3em] opacity-30">Archive des charges vide</td></tr>
                     ) : expenses.map((e: any) => (
                        <tr key={e.id} className="hover:bg-slate-50/50 transition-colors group">
                           <td className="px-10 py-6">
                              <div className="flex flex-col">
                                 <span className="text-xs font-black text-slate-900">{new Date(e.created_at).toLocaleDateString('fr-FR')}</span>
                                 <span className="text-[10px] font-bold text-slate-300 uppercase mt-0.5">{new Date(e.created_at).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })}</span>
                              </div>
                           </td>
                           <td className="px-10 py-6 text-center">
                              <div className="flex flex-col items-center gap-1">
                                 <Badge className="bg-slate-100 text-slate-500 border-none text-[9px] font-black uppercase tracking-tight px-3 py-1 rounded-xl">{e.category}</Badge>
                                 {(() => {
                                    const term = e.term_type ?? TERM_BY_CATEGORY[e.category] ?? 'SHORT_TERM';
                                    return term === 'LONG_TERM'
                                       ? <span className="text-[8px] font-black text-rose-500 uppercase tracking-wider">Long Terme</span>
                                       : <span className="text-[8px] font-black text-amber-500 uppercase tracking-wider">Court Terme</span>;
                                 })()}
                              </div>
                           </td>
                           <td className="px-10 py-6">
                              <div className="flex flex-col min-w-0">
                                 <span className="text-sm font-black text-slate-900 uppercase truncate max-w-[250px]">{e.label}</span>
                                 <span className="text-[10px] font-bold text-slate-400 truncate max-w-[250px] italic">{e.description || 'Sans description additionnelle'}</span>
                              </div>
                           </td>
                           <td className="px-10 py-6">
                              <div className="flex flex-col">
                                 <span className="text-base font-black text-rose-500 tabular-nums">-{formatPrice(e.amount)}</span>
                                 {e.tax_amount > 0 && <span className="text-[10px] font-bold text-slate-300">Incl. Tax: {formatPrice(e.tax_amount)}</span>}
                              </div>
                           </td>
                           <td className="px-10 py-6 text-center">
                              {e.is_recurring ? (
                                 <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-[#6C5CE7]">
                                    <Repeat className="size-3" />
                                    <span className="text-[9px] font-black uppercase">{e.recurrence_period || 'MONTH'}</span>
                                 </div>
                              ) : (
                                 <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Ponctuel</span>
                              )}
                           </td>
                           <td className="px-10 py-6 text-right">
                              <div className="flex items-center justify-end gap-2 translate-x-2 opacity-0 group-hover:opacity-100 group-hover:translate-x-0 transition-all">
                                 <button className="size-10 rounded-xl bg-white border border-slate-100 text-slate-300 hover:text-[#6C5CE7] hover:border-[#6C5CE7] transition-all shadow-sm flex items-center justify-center">
                                    <Eye className="size-4" />
                                 </button>
                                 <button className="size-10 rounded-xl bg-white border border-slate-100 text-slate-300 hover:text-red-500 hover:border-red-500 transition-all shadow-sm flex items-center justify-center">
                                    <Trash2 className="size-4" />
                                 </button>
                              </div>
                           </td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
         </div>

         {/* ─── Expense Creation Dialog ─── */}
         <Dialog open={isCreating} onOpenChange={setIsCreating}>
            <DialogContent className="max-w-4xl p-0 border-none bg-white rounded-[40px] overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
               <div className="bg-[#2D3436] p-10 text-white shrink-0">
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-6">
                        <div className="size-16 bg-[#E17055] rounded-3xl flex items-center justify-center shadow-2xl shadow-rose-500/20">
                           <Receipt className="size-8 text-white" />
                        </div>
                        <div>
                           <DialogTitle className="text-2xl font-black uppercase tracking-tight leading-none">Déclaration de Charge</DialogTitle>
                           <DialogDescription className="text-white/40 text-[10px] font-black uppercase tracking-widest mt-2">Enregistrement manuel dans le Grand Livre Comptable</DialogDescription>
                        </div>
                     </div>
                     <button onClick={() => setIsCreating(false)} className="p-3 rounded-2xl hover:bg-white/10 transition-all">
                        <X className="size-6 text-white/50" />
                     </button>
                  </div>
               </div>

               <Tabs defaultValue="basis" className="flex-1 flex flex-col min-h-0">
                  <div className="px-10 border-b bg-slate-50/50 shrink-0">
                     <TabsList className="h-16 bg-transparent gap-8 border-0">
                        <TabsTrigger value="basis" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#E17055] rounded-none px-0 text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436]">
                           <FileText className="size-4 mr-2" /> Details Financiers
                        </TabsTrigger>
                        <TabsTrigger value="advanced" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#E17055] rounded-none px-0 text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436]">
                           <Repeat className="size-4 mr-2" /> Récurrence & Notes
                        </TabsTrigger>
                     </TabsList>
                  </div>

                  <div className="flex-1 overflow-y-auto p-10 custom-scrollbar pb-32">
                     <TabsContent value="basis" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2">
                        <div className="grid grid-cols-2 gap-8">
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Libellé de la dépense *</label>
                              <Input 
                                 value={formData.label} onChange={e => setFormData({...formData, label: e.target.value})}
                                 placeholder="ex: Abonnement Yalidine Premium" 
                                 className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black transition-all"
                              />
                           </div>
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Catégorie de Flux *</label>
                              <Select value={formData.category} onValueChange={v => setFormData({...formData, category: v, term_type: TERM_BY_CATEGORY[v] ?? 'SHORT_TERM'})}>
                                 <SelectTrigger className="h-14 border-slate-100 bg-slate-50/50 rounded-2xl px-6 text-sm font-black transition-all uppercase">
                                    <SelectValue placeholder="Choisir" />
                                 </SelectTrigger>
                                 <SelectContent className="rounded-[24px]">
                                    <SelectItem value="MARKETING" className="font-bold">MARKETING & ADS</SelectItem>
                                    <SelectItem value="HR" className="font-bold">SALAIRES & RH</SelectItem>
                                    <SelectItem value="IT" className="font-bold">INFRA & SAAS</SelectItem>
                                    <SelectItem value="LOGISTICS" className="font-bold">LOGISTIQUE</SelectItem>
                                    <SelectItem value="RENT" className="font-bold">LOYERS & LOCAUX</SelectItem>
                                    <SelectItem value="TAX" className="font-bold">TAXES & IMPÔTS</SelectItem>
                                    <SelectItem value="OTHER" className="font-bold">AUTRES DÉPENSES</SelectItem>
                                 </SelectContent>
                              </Select>
                              {/* Term type auto-set; allow override */}
                              <div className="flex gap-2 mt-2">
                                 {(['SHORT_TERM', 'LONG_TERM'] as const).map(t => (
                                    <button
                                       key={t}
                                       type="button"
                                       onClick={() => setFormData(f => ({ ...f, term_type: t }))}
                                       className={`flex-1 h-10 rounded-xl text-[10px] font-black uppercase tracking-wider border-2 transition-all ${formData.term_type === t ? (t === 'SHORT_TERM' ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-rose-400 bg-rose-50 text-rose-700') : 'border-slate-100 bg-slate-50 text-slate-400'}`}
                                    >
                                       {t === 'SHORT_TERM' ? '⚡ Court Terme' : '🏗 Long Terme'}
                                    </button>
                                 ))}
                              </div>
                           </div>
                        </div>

                        <div className="grid grid-cols-2 gap-8">
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Montant Hors Taxe (HT) *</label>
                              <div className="relative">
                                 <Input 
                                    type="number" value={formData.amount} onChange={e => setFormData({...formData, amount: parseFloat(e.target.value) || 0})}
                                    placeholder="0.00" className="h-14 border-slate-100 bg-slate-50/50 rounded-2xl pl-12 text-sm font-black"
                                 />
                                 <Banknote className="absolute left-5 top-1/2 -translate-y-1/2 size-4 text-emerald-400" />
                              </div>
                           </div>
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Montant de la Taxe (DZD)</label>
                                 <Input 
                                    type="number" value={formData.tax_amount} onChange={e => setFormData({...formData, tax_amount: parseFloat(e.target.value) || 0})}
                                    placeholder="0.00" className="h-14 border-slate-100 bg-slate-50/50 rounded-2xl px-6 text-sm font-black"
                                 />
                           </div>
                        </div>

                        <div className="grid grid-cols-2 gap-8">
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Portefeuille Source *</label>
                              <Select value={formData.wallet_id} onValueChange={v => setFormData({...formData, wallet_id: v})}>
                                 <SelectTrigger className="h-14 border-slate-100 bg-slate-50/50 rounded-2xl px-6 text-sm font-black transition-all uppercase">
                                    <SelectValue placeholder="Sélectionner le compte" />
                                 </SelectTrigger>
                                 <SelectContent className="rounded-[24px]">
                                    {walletsResponse?.data?.map((w: any) => (
                                       <SelectItem key={w.id} value={w.id} className="font-bold">{w.name} ({formatPrice(w.balance)})</SelectItem>
                                    ))}
                                 </SelectContent>
                              </Select>
                           </div>
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Date de la Charge *</label>
                              <div className="relative">
                                 <Input 
                                    type="date"
                                    value={formData.expense_date} onChange={e => setFormData({...formData, expense_date: e.target.value})}
                                    className="h-14 border-slate-100 bg-slate-50/50 rounded-2xl px-6 text-sm font-black"
                                 />
                                 <Clock className="absolute right-6 top-1/2 -translate-y-1/2 size-4 text-slate-300 pointer-events-none" />
                              </div>
                           </div>
                        </div>

                        <div className="grid grid-cols-2 gap-8">
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Bénéficiaire (Nom/Entrep.)</label>
                              <div className="relative">
                                 <Input 
                                    value={formData.beneficiary} onChange={e => setFormData({...formData, beneficiary: e.target.value})}
                                    placeholder="ex: Meta Platforms Inc." className="h-14 border-slate-100 bg-slate-50/50 rounded-2xl pl-12 text-sm font-black"
                                 />
                                 <Building2 className="absolute left-5 top-1/2 -translate-y-1/2 size-4 text-slate-300" />
                              </div>
                           </div>
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">URL du Justificatif (Reçu/Facture)</label>
                              <div className="relative">
                                 <Input 
                                    value={formData.receipt_url} onChange={e => setFormData({...formData, receipt_url: e.target.value})}
                                    placeholder="https://..." className="h-14 border-slate-100 bg-slate-50/50 rounded-2xl pl-12 text-sm font-black"
                                 />
                                 <FileText className="absolute left-5 top-1/2 -translate-y-1/2 size-4 text-slate-300" />
                              </div>
                           </div>
                        </div>
                     </TabsContent>

                     <TabsContent value="advanced" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2">
                        <div className="flex items-center gap-4 p-8 rounded-[32px] border border-slate-100 bg-[#FAFBFD]">
                           <Checkbox 
                              id="recurring" 
                              checked={formData.is_recurring} 
                              onCheckedChange={(c) => setFormData({...formData, is_recurring: !!c})}
                              className="size-6 border-slate-200 data-[state=checked]:bg-[#E17055] data-[state=checked]:border-[#E17055]" 
                           />
                           <div className="flex-1">
                              <label htmlFor="recurring" className="text-sm font-black text-slate-900 uppercase tracking-tight cursor-pointer">Activer la Récurrence Automatique</label>
                              <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">La charge sera déduite périodiquement de la trésorerie active.</p>
                           </div>
                           {formData.is_recurring && (
                              <Select value={formData.recurrence_period} onValueChange={v => setFormData({...formData, recurrence_period: v})}>
                                 <SelectTrigger className="h-12 w-40 bg-white border-slate-100 rounded-xl text-[10px] font-black uppercase">
                                    <SelectValue />
                                 </SelectTrigger>
                                 <SelectContent className="rounded-xl">
                                    <SelectItem value="DAILY">CHAQUE JOUR</SelectItem>
                                    <SelectItem value="WEEKLY">CHAQUE SEMAINE</SelectItem>
                                    <SelectItem value="MONTHLY">CHAQUE MOIS</SelectItem>
                                    <SelectItem value="YEARLY">CHAQUE ANNÉE</SelectItem>
                                 </SelectContent>
                              </Select>
                           )}
                        </div>

                        <div className="space-y-3">
                           <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Description Technique & Audit</label>
                           <textarea 
                              value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})}
                              placeholder="Justification de la charge, spécifications du versement..." 
                              className="w-full min-h-[160px] p-8 rounded-[32px] border border-slate-100 bg-slate-50/50 text-sm font-medium focus:bg-white transition-all outline-none resize-none shadow-inner"
                           />
                        </div>
                     </TabsContent>
                  </div>
               </Tabs>

               <DialogFooter className="p-10 bg-white/80 backdrop-blur-md border-t border-slate-100 flex items-center justify-between shrink-0">
                  <div className="flex flex-col">
                     <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] mb-1">Total à décaisser</span>
                     <p className="text-2xl font-black text-[#2D3436] tracking-tighter tabular-nums">{formatPrice(formData.amount + formData.tax_amount)}</p>
                  </div>
                  <div className="flex items-center gap-4">
                     <button onClick={() => setIsCreating(false)} className="h-14 px-10 rounded-2xl text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors">Abandonner</button>
                     <Button 
                        disabled={createMutation.isPending || !formData.label || formData.amount <= 0 || !formData.wallet_id}
                        onClick={() => createMutation.mutate(formData)}
                        className="h-14 px-14 rounded-2xl bg-[#E17055] hover:bg-[#c0392b] text-white text-[11px] font-black uppercase tracking-widest shadow-2xl shadow-rose-100 transition-all active:scale-[0.98]"
                     >
                        {createMutation.isPending ? <Loader2 className="size-5 animate-spin" /> : "VALIDER LA DÉPENSE ✓"}
                     </Button>
                  </div>
               </DialogFooter>
            </DialogContent>
         </Dialog>
      </div>
   );
}
