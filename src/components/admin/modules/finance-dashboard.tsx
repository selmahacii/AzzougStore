'use client';

import React, { useState } from 'react';
import {
   Wallet as WalletIcon,
   DollarSign,
   ArrowUpRight,
   ArrowDownRight,
   CreditCard,
   TrendingUp,
   Search,
   Plus,
   Filter,
   RefreshCw,
   ChevronLeft,
   ChevronRight,
   Edit3,
   Eye,
   Receipt,
   Banknote,
   Loader2,
   ArrowRightLeft,
   ShieldCheck,
   Activity,
   X,
   CheckCircle2,
   Clock,
   Layers,
   Zap,
   UserCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
   Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
   Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

const C = {
   primary: '#6C5CE7', primaryBg: '#F0EDFF',
   success: '#00B894', successBg: '#E6FFF8',
   danger: '#E17055', dangerBg: '#FFEDE9',
   info: '#0984E3', infoBg: '#E8F4FE',
   orange: '#FD7014', orangeBg: '#FFF3E8',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

function KpiCard({ title, value, icon: Icon, color, bgColor, trend }: {
   title: string; value: string | number; icon: React.ElementType; color: string; bgColor: string; trend?: string;
}) {
   return (
      <div className="bg-white rounded-[32px] border p-8 shadow-sm flex flex-col justify-between group hover:border-indigo-100 transition-all" style={{ borderColor: C.border }}>
         <div className="flex items-center justify-between mb-6">
            <div className="size-14 rounded-2xl flex items-center justify-center shrink-0 shadow-inner" style={{ backgroundColor: bgColor }}>
               <Icon className="size-6 transition-transform group-hover:scale-110" style={{ color }} />
            </div>
            {trend && (
               <span className="text-[10px] font-black text-emerald-500 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100 uppercase tracking-widest">{trend}</span>
            )}
         </div>
         <div>
            <p className="text-[10px] font-black text-[#636E72] uppercase tracking-[0.2em] mb-1">{title}</p>
            <p className="text-3xl font-black text-[#2D3436] tabular-nums tracking-tighter">{typeof value === 'number' ? formatPrice(value) : value}</p>
         </div>
      </div>
   );
}

export default function FinanceDashboard() {
   const { activeStore, adminSubView } = useAppStore();
   const storeId = activeStore?.id ?? '';
   const qc = useQueryClient();

   const [activeTab, setActiveTab] = useState(adminSubView || 'wallets');
   const [page, setPage] = useState(1);
   const [pageSize] = useState(20);
   const [isCreateWalletOpen, setIsCreateWalletOpen] = useState(false);
   const [isTransferOpen, setIsTransferOpen] = useState(false);
   const [isCreateTxOpen, setIsCreateTxOpen] = useState(false);

   // Sync tab with sidebar subview
   React.useEffect(() => {
      if (adminSubView) setActiveTab(adminSubView);
   }, [adminSubView]);

   // --- Queries ---
   const { data: walletsResponse, isLoading: isWalletsLoading } = useQuery({
      queryKey: ['wallets', storeId],
      queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/finance/wallets?store_id=${storeId}`),
      enabled: !!storeId,
   });

   const { data: txResponse, isLoading: isTxLoading } = useQuery({
      queryKey: ['transactions', storeId, activeTab, page],
      queryFn: () => {
         const typeMap: Record<string, string> = {
            disbursements: 'DISBURSEMENT',
            charges: 'CHARGE',
            payments: 'PAYMENT'
         };
         return apiFetch<{ success: boolean; data: any[]; total: number }>(`/api/v1/finance/transactions?store_id=${storeId}&transaction_type=${typeMap[activeTab] || ''}&page=${page}&limit=${pageSize}`);
      },
      enabled: !!storeId && activeTab !== 'wallets',
   });

   const { data: kpiResponse } = useQuery({
      queryKey: ['kpi', storeId],
      queryFn: () => apiFetch<{ success: boolean; data: any }>(`/api/v1/analytics?store_id=${storeId}&type=kpi&period=30d`),
      enabled: !!storeId,
   });

   const kpi = kpiResponse?.data;

   const wallets = walletsResponse?.data || [];
   const transactions = txResponse?.data || [];
   const totalBalance = wallets.reduce((acc, curr) => acc + curr.balance, 0);
   const totalIn = wallets.reduce((acc, curr) => acc + curr.total_in, 0);
   const totalOut = wallets.reduce((acc, curr) => acc + curr.total_out, 0);

   return (
      <div className="space-y-8 pb-32 animate-in fade-in duration-700">
         
         {/* ─── Premium Header ─── */}
         <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-2 bg-[#2D3436] rounded-[40px] p-10 text-white relative overflow-hidden shadow-2xl">
               <div className="absolute top-0 right-0 p-10 opacity-[0.05] rotate-12">
                  <TrendingUp className="size-48" />
               </div>
               <div className="relative z-10">
                  <div className="flex items-center gap-4 mb-8">
                     <div className="size-12 bg-[#6C5CE7] rounded-2xl flex items-center justify-center shadow-2xl">
                        <WalletIcon className="size-6 text-white" />
                     </div>
                     <div>
                        <h1 className="text-2xl font-black uppercase tracking-tight leading-none">Console Financière</h1>
                        <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mt-2 flex items-center gap-2">
                           <ShieldCheck className="size-3 text-emerald-400" /> Flux monétaires protégés
                        </p>
                     </div>
                  </div>
                  <div className="flex items-end gap-6">
                     <div>
                        <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-2">Trésorerie Consolidée</p>
                        <p className="text-5xl font-black tracking-tighter">{formatPrice(totalBalance)}</p>
                     </div>
                     <div className="hidden sm:block pb-1">
                        <Badge className={cn(
                           "border-none px-3 py-1 text-[10px] font-black uppercase tracking-widest",
                           (kpi?.revenueChange ?? 0) >= 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                        )}>
                           {(kpi?.revenueChange ?? 0) >= 0 ? '+' : ''}{kpi?.revenueChange ?? 0}% ce mois
                        </Badge>
                     </div>
                  </div>
               </div>
            </div>

            <div className="bg-white rounded-[40px] border p-8 flex flex-col justify-between shadow-sm group hover:border-[#6C5CE7]/30 transition-all" style={{ borderColor: C.border }}>
               <div className="flex items-center justify-between">
                  <div className="size-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                     <ArrowUpRight className="size-6" />
                  </div>
                  <Activity className="size-4 text-emerald-500 animate-pulse" />
               </div>
               <div className="mt-6">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Entrées (Lifetime)</p>
                  <p className="text-2xl font-black text-slate-900 tabular-nums">{formatPrice(totalIn)}</p>
               </div>
            </div>

            <div className="bg-white rounded-[40px] border p-8 flex flex-col justify-between shadow-sm group hover:border-orange-100 transition-all" style={{ borderColor: C.border }}>
               <div className="flex items-center justify-between">
                  <div className="size-12 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600">
                     <ArrowDownRight className="size-6" />
                  </div>
                  <Layers className="size-4 text-rose-300" />
               </div>
               <div className="mt-6">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Sorties (Lifetime)</p>
                  <p className="text-2xl font-black text-slate-900 tabular-nums">{formatPrice(totalOut)}</p>
               </div>
            </div>
         </div>

         {/* ─── Control Bar ─── */}
         <div className="bg-white rounded-[32px] border px-8 py-4 flex items-center justify-between shadow-sm sticky top-0 z-30" style={{ borderColor: C.border }}>
            <div className="flex items-center gap-2">
               {['wallets', 'disbursements', 'charges', 'payments'].map((tab) => (
                  <button 
                     key={tab}
                     onClick={() => setActiveTab(tab)}
                     className={cn(
                        "h-12 px-6 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all",
                        activeTab === tab ? "bg-[#6C5CE7] text-white shadow-lg shadow-indigo-100" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                     )}
                  >
                     {tab === 'wallets' && 'Portefeuilles'}
                     {tab === 'disbursements' && 'Versements'}
                     {tab === 'charges' && 'Charges'}
                     {tab === 'payments' && 'Ventes'}
                  </button>
               ))}
            </div>
            <div className="flex items-center gap-3">
               <button 
                  onClick={() => setIsTransferOpen(true)}
                  className="h-12 px-6 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-white text-slate-400 hover:text-[#6C5CE7] transition-all text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
               >
                  <ArrowRightLeft className="size-4" /> Transfert
               </button>
               <button 
                  onClick={() => setIsCreateTxOpen(true)}
                  className="h-12 px-6 rounded-2xl border border-[#6C5CE7]/20 bg-[#F0EDFF] hover:bg-white text-[#6C5CE7] transition-all text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
               >
                  <Plus className="size-4" /> Nouvelle Opération
               </button>
               <Button onClick={() => setIsCreateWalletOpen(true)} className="h-12 px-8 rounded-2xl bg-[#2D3436] hover:bg-black text-white text-[10px] font-black uppercase tracking-widest shadow-xl transition-all">
                  Nouveau Compte
               </Button>
            </div>
         </div>

         {/* ─── Content View ─── */}
         {activeTab === 'wallets' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
               {isWalletsLoading ? (
                  Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-64 rounded-[40px] bg-slate-100 animate-pulse" />)
               ) : wallets.map((w: any) => (
                  <div key={w.id} className="bg-white rounded-[40px] border p-8 shadow-sm hover:shadow-xl hover:shadow-indigo-50/50 transition-all group overflow-hidden relative" style={{ borderColor: C.border }}>
                     <div className="absolute top-0 right-0 p-8 opacity-[0.03] text-[#6C5CE7]">
                        <CreditCard className="size-32" />
                     </div>
                     <div className="flex items-center justify-between mb-8 relative z-10">
                        <div className="size-16 rounded-[24px] bg-[#FAFBFD] border flex items-center justify-center group-hover:bg-[#F0EDFF] transition-all">
                           <CreditCard className="size-8 text-slate-300 group-hover:text-[#6C5CE7]" />
                        </div>
                        <Badge variant="outline" className="bg-white border-slate-100 text-[10px] font-black uppercase tracking-tight text-slate-400 px-3 py-1 rounded-xl">{w.type}</Badge>
                     </div>
                     <div className="relative z-10">
                        <h3 className="text-xl font-black text-[#2D3436] uppercase tracking-tight mb-1">{w.name}</h3>
                        <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-6">ID CORE: {w.id.split('-')[0].toUpperCase()}</p>
                        
                        <div className="flex items-end justify-between">
                           <div>
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Disponible</p>
                              <p className="text-3xl font-black text-[#6C5CE7] tracking-tighter">{formatPrice(w.balance)}</p>
                           </div>
                           <button className="size-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-300 hover:text-[#6C5CE7] hover:bg-[#F0EDFF] transition-all">
                              <ArrowRightLeft className="size-5" />
                           </button>
                        </div>
                     </div>
                     <div className="mt-8 pt-8 border-t border-dashed border-slate-100 flex items-center justify-between relative z-10">
                        <div className="flex items-center gap-3">
                           <div className="flex flex-col">
                              <span className="text-[9px] font-black text-emerald-500 uppercase tracking-tighter">In</span>
                              <span className="text-xs font-black text-slate-700">+{formatPrice(w.total_in)}</span>
                           </div>
                           <div className="w-px h-6 bg-slate-100 mx-2" />
                           <div className="flex flex-col">
                              <span className="text-[9px] font-black text-rose-500 uppercase tracking-tighter">Out</span>
                              <span className="text-xs font-black text-slate-700">-{formatPrice(w.total_out)}</span>
                           </div>
                        </div>
                        <div className={cn("inline-flex items-center gap-1.5 px-3 py-1 rounded-full", w.is_active ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-400")}>
                           <div className={cn("size-1.5 rounded-full", w.is_active ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-slate-300")} />
                           <span className="text-[9px] font-black uppercase tracking-widest">{w.is_active ? 'Live' : 'Off'}</span>
                        </div>
                     </div>
                  </div>
               ))}
               
               {/* Add New Card Button */}
               <button 
                  onClick={() => setIsCreateWalletOpen(true)}
                  className="bg-slate-50/50 rounded-[40px] border border-dashed border-slate-200 p-8 flex flex-col items-center justify-center gap-4 hover:bg-white hover:border-[#6C5CE7]/30 transition-all group min-h-[300px]"
               >
                  <div className="size-16 rounded-[24px] bg-white border border-slate-100 flex items-center justify-center text-slate-300 group-hover:text-[#6C5CE7] group-hover:scale-110 shadow-sm transition-all">
                     <Plus className="size-8" />
                  </div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest group-hover:text-slate-600 transition-colors">Déployer Noeud Trésorerie</p>
               </button>
            </div>
         ) : (
            <div className="bg-white rounded-[40px] border shadow-sm overflow-hidden" style={{ borderColor: C.border }}>
               <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[1000px]">
                     <thead>
                        <tr className="border-b" style={{ borderColor: C.border, backgroundColor: '#FAFBFD' }}>
                           <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Référence Flux</th>
                           <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Catégorie</th>
                           <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Bénéficiaire</th>
                           <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Montant</th>
                           <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Compte Source/Cible</th>
                           <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Horodatage</th>
                           <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Preuve</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y" style={{ borderColor: '#F8F9FC' }}>
                        {isTxLoading ? (
                           Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={6} className="px-10 py-12 animate-pulse bg-slate-50/30" /></tr>)
                        ) : transactions.length === 0 ? (
                           <tr><td colSpan={6} className="px-10 py-32 text-center text-slate-300 text-xs font-black uppercase tracking-[0.2em] opacity-30">Aucun enregistrement détecté</td></tr>
                        ) : transactions.map((t: any) => (
                           <tr key={t.id} className="hover:bg-slate-50/50 transition-colors group">
                              <td className="px-10 py-6">
                                 <div className="flex items-center gap-3">
                                    <div className={cn("size-2 rounded-full", t.type === 'DEPOSIT' || t.type === 'PAYMENT' ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-rose-500 shadow-[0_0_8px_#f43f5e]")} />
                                    <span className="text-xs font-black text-slate-900 group-hover:text-[#6C5CE7] transition-colors font-mono">{t.reference || 'SYSTEM-TX'}</span>
                                 </div>
                              </td>
                              <td className="px-10 py-6 text-center">
                                 <Badge className="bg-slate-100 text-slate-500 border-none text-[9px] font-black uppercase tracking-tight px-3 py-1 rounded-xl">
                                    {t.category || 'OPERATION'}
                                 </Badge>
                              </td>
                              <td className="px-10 py-6">
                                 <span className="text-[10px] font-black text-slate-600 uppercase tracking-tight truncate max-w-[150px] block">
                                    {t.beneficiary || '—'}
                                 </span>
                              </td>
                              <td className="px-10 py-6">
                                 <span className={cn("text-sm font-black tabular-nums", t.type === 'DEPOSIT' || t.type === 'PAYMENT' ? "text-emerald-500" : "text-rose-500")}>
                                    {t.type === 'DEPOSIT' || t.type === 'PAYMENT' ? '+' : '-'}{formatPrice(t.amount)}
                                 </span>
                              </td>
                              <td className="px-10 py-6">
                                 <div className="flex items-center gap-2">
                                    <div className="size-6 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400">
                                       <WalletIcon className="size-3" />
                                    </div>
                                    <span className="text-xs font-bold text-slate-600 uppercase tracking-tight">{t.wallet?.name || 'Inconnu'}</span>
                                 </div>
                              </td>
                              <td className="px-10 py-6">
                                 <div className="flex flex-col">
                                    <span className="text-xs font-black text-slate-800">{new Date(t.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>
                                    <span className="text-[10px] font-black text-slate-300 uppercase tracking-tighter">{new Date(t.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                                 </div>
                              </td>
                              <td className="px-10 py-6 text-right">
                                 <button className="size-10 rounded-xl bg-white border border-slate-100 text-slate-300 hover:text-[#6C5CE7] hover:border-[#6C5CE7] transition-all shadow-sm flex items-center justify-center ml-auto">
                                    <Eye className="size-4" />
                                 </button>
                              </td>
                           </tr>
                        ))}
                     </tbody>
                  </table>
               </div>
               
               {/* Pagination Industrialized */}
               <div className="px-10 py-6 border-t border-slate-50 bg-[#FAFBFD] flex items-center justify-between">
                  <div className="flex items-center gap-4">
                     <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Affichage {transactions.length} sur {txResponse?.total || 0} Flux</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <Button 
                        disabled={page <= 1} 
                        onClick={() => setPage(page - 1)}
                        className="size-10 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-slate-600 p-0"
                     >
                        <ChevronLeft className="size-5" />
                     </Button>
                     <div className="h-10 px-4 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-[10px] font-black text-slate-900 uppercase">
                        Page {page}
                     </div>
                     <Button 
                        disabled={!txResponse || page >= Math.ceil(txResponse.total / pageSize)}
                        onClick={() => setPage(page + 1)}
                        className="size-10 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-slate-600 p-0"
                     >
                        <ChevronRight className="size-5" />
                     </Button>
                  </div>
               </div>
            </div>
         )}

         {/* ─── MODALS ─── */}
         <CreateWalletModal open={isCreateWalletOpen} onOpenChange={setIsCreateWalletOpen} storeId={storeId} />
         <TransferModal open={isTransferOpen} onOpenChange={setIsTransferOpen} wallets={wallets} />
         <CreateTransactionModal open={isCreateTxOpen} onOpenChange={setIsCreateTxOpen} wallets={wallets} storeId={storeId} />
      </div>
   );
}

// ═══════════════════════════════════════════════════════════════
// Create Wallet Modal
// ═══════════════════════════════════════════════════════════════
function CreateWalletModal({ open, onOpenChange, storeId }: any) {
   const qc = useQueryClient();
   const [formData, setFormData] = useState({ name: '', type: 'CASH', initial_balance: 0 });

   const createWallet = useMutation({
      mutationFn: (data: any) => apiFetch('/api/v1/finance/wallets/', { method: 'POST', body: JSON.stringify({ ...data, store_id: storeId }) }),
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['wallets'] });
         toast.success('Portefeuille déployé avec succès');
         onOpenChange(false);
         setFormData({ name: '', type: 'CASH', initial_balance: 0 });
      }
   });

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent className="max-w-2xl p-0 border-none bg-white rounded-[40px] overflow-hidden shadow-2xl">
            <div className="bg-[#2D3436] p-10 text-white">
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-6">
                     <div className="size-16 bg-[#6C5CE7] rounded-3xl flex items-center justify-center shadow-2xl shadow-indigo-500/20">
                        <Plus className="size-8 text-white" />
                     </div>
                     <div>
                        <DialogTitle className="text-2xl font-black uppercase tracking-tight leading-none">Nouveau Node Trésorerie</DialogTitle>
                        <DialogDescription className="text-white/40 text-[10px] font-black uppercase tracking-widest mt-2">Configuration d'un nouveau point d'encaissement</DialogDescription>
                     </div>
                  </div>
                  <button onClick={() => onOpenChange(false)} className="p-3 rounded-2xl hover:bg-white/10 transition-all">
                     <X className="size-6 text-white/50" />
                  </button>
               </div>
            </div>
            
            <div className="p-10 space-y-8">
               <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-3">
                     <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Désignation du compte *</label>
                     <Input 
                        value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                        placeholder="Ex: Caisse Centrale Oran" 
                        className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black transition-all" 
                     />
                  </div>
                  <div className="space-y-3">
                     <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Nature du Fond *</label>
                     <Select value={formData.type} onValueChange={v => setFormData({...formData, type: v})}>
                        <SelectTrigger className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black transition-all uppercase">
                           <SelectValue placeholder="Choisir un type" />
                        </SelectTrigger>
                        <SelectContent className="rounded-[24px]">
                           <SelectItem value="CASH" className="font-bold">ESPÈCES (CASH)</SelectItem>
                           <SelectItem value="BANK" className="font-bold">COMPTE BANCAIRE</SelectItem>
                           <SelectItem value="RIP" className="font-bold">COMPTE POSTAL (RIP)</SelectItem>
                           <SelectItem value="DIGITAL" className="font-bold">DIGITAL (CCP/YALIDINE)</SelectItem>
                        </SelectContent>
                     </Select>
                  </div>
               </div>

               <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Apport Initial (Solde au déploiement)</label>
                  <div className="relative">
                     <Input 
                        type="number"
                        value={formData.initial_balance} onChange={e => setFormData({...formData, initial_balance: parseFloat(e.target.value) || 0})}
                        placeholder="0.00" 
                        className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black transition-all pl-12" 
                     />
                     <DollarSign className="absolute left-6 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                     <span className="absolute right-6 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300 uppercase">DZD</span>
                  </div>
               </div>

               <div className="bg-amber-50/50 rounded-[32px] p-8 border border-amber-100/50 flex items-center gap-5">
                  <div className="size-12 rounded-2xl bg-white flex items-center justify-center text-amber-500 shadow-sm">
                     <ShieldCheck className="size-6" />
                  </div>
                  <div>
                     <p className="text-sm font-black text-amber-900 uppercase tracking-tight leading-none mb-1">Règle de sécurité</p>
                     <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest leading-relaxed">Chaque mouvement sur ce compte sera loggé avec adresse IP et acteur identifié.</p>
                  </div>
               </div>
            </div>

            <DialogFooter className="p-10 bg-slate-50/50 border-t flex items-center justify-end gap-4 shrink-0 transition-colors">
               <button onClick={() => onOpenChange(false)} className="h-14 px-10 rounded-2xl text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors">Abandonner</button>
               <Button 
                  onClick={() => createWallet.mutate(formData)}
                  disabled={createWallet.isPending}
                  className="h-14 px-14 rounded-2xl bg-[#6C5CE7] hover:bg-[#5849D1] text-white text-[11px] font-black uppercase tracking-widest shadow-2xl shadow-indigo-100"
               >
                  {createWallet.isPending ? <Loader2 className="size-5 animate-spin" /> : "CRÉER LE PORTEFEUILLE ✓"}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

// ═══════════════════════════════════════════════════════════════
// Transfer Modal
// ═══════════════════════════════════════════════════════════════
function TransferModal({ open, onOpenChange, wallets }: any) {
   const qc = useQueryClient();
   const [formData, setFormData] = useState({ from: '', to: '', amount: 0, reason: '' });

   const transferMutation = useMutation({
      mutationFn: (data: any) => apiFetch('/api/v1/finance/wallets/transfer', { method: 'POST', body: JSON.stringify(data) }),
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['wallets', 'transactions'] });
         toast.success('Transfert inter-comptes exécuté ✓');
         onOpenChange(false);
         setFormData({ from: '', to: '', amount: 0, reason: '' });
      }
   });

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent className="max-w-2xl p-0 border-none bg-white rounded-[40px] overflow-hidden shadow-2xl">
            <div className="bg-[#6C5CE7] p-10 text-white">
               <div className="flex items-center gap-6">
                  <div className="size-16 bg-white/20 backdrop-blur-md rounded-3xl flex items-center justify-center">
                     <ArrowRightLeft className="size-8 text-white" />
                  </div>
                  <div>
                     <DialogTitle className="text-2xl font-black uppercase tracking-tight leading-none">Transfert de Fond</DialogTitle>
                     <p className="text-white/60 text-[10px] font-black uppercase tracking-widest mt-2 tracking-tighter">Rééquilibrage de trésorerie entre nodes identifiés</p>
                  </div>
               </div>
            </div>

            <div className="p-10 space-y-8">
               <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-3">
                     <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Débit (Source)</label>
                     <Select value={formData.from} onValueChange={v => setFormData({...formData, from: v})}>
                        <SelectTrigger className="h-14 border-slate-100 bg-slate-50/50 rounded-2xl px-6 text-sm font-black transition-all uppercase">
                           <SelectValue placeholder="Compte Source" />
                        </SelectTrigger>
                        <SelectContent className="rounded-[24px]">
                           {wallets.map((w: any) => (
                              <SelectItem key={w.id} value={w.id} className="font-bold uppercase text-[11px]">{w.name} ({formatPrice(w.balance)})</SelectItem>
                           ))}
                        </SelectContent>
                     </Select>
                  </div>
                  <div className="space-y-3">
                     <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Crédit (Cible)</label>
                     <Select value={formData.to} onValueChange={v => setFormData({...formData, to: v})}>
                        <SelectTrigger className="h-14 border-slate-100 bg-slate-50/50 rounded-2xl px-6 text-sm font-black transition-all uppercase">
                           <SelectValue placeholder="Compte Cible" />
                        </SelectTrigger>
                        <SelectContent className="rounded-[24px]">
                           {wallets.filter((w: any) => w.id !== formData.from).map((w: any) => (
                              <SelectItem key={w.id} value={w.id} className="font-bold uppercase text-[11px]">{w.name} ({formatPrice(w.balance)})</SelectItem>
                           ))}
                        </SelectContent>
                     </Select>
                  </div>
               </div>

               <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-3">
                     <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Volume du Flux (DZD) *</label>
                     <div className="relative">
                        <Input 
                           type="number" 
                           value={formData.amount} onChange={e => setFormData({...formData, amount: parseFloat(e.target.value) || 0})}
                           placeholder="0.00" 
                           className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black transition-all pl-12"
                        />
                        <Zap className="absolute left-6 top-1/2 -translate-y-1/2 size-4 text-emerald-400" />
                     </div>
                  </div>
                  <div className="space-y-3">
                     <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Motif de l'opération</label>
                     <Input 
                        value={formData.reason} onChange={e => setFormData({...formData, reason: e.target.value})}
                        placeholder="Ex: Approvisionnement Caisse..." 
                        className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black transition-all"
                     />
                  </div>
               </div>
            </div>

            <DialogFooter className="p-10 bg-slate-50/50 border-t flex items-center justify-end gap-4 shadow-inner">
               <button onClick={() => onOpenChange(false)} className="h-14 px-10 rounded-2xl text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors">Annuler Flux</button>
               <Button 
                  onClick={() => transferMutation.mutate(formData)}
                  disabled={transferMutation.isPending || !formData.from || !formData.to || formData.amount <= 0}
                  className="h-14 px-14 rounded-2xl bg-[#6C5CE7] hover:bg-[#5849D1] text-white text-[11px] font-black uppercase tracking-widest shadow-2xl shadow-indigo-100 transition-all active:scale-[0.98]"
               >
                  {transferMutation.isPending ? <Loader2 className="size-5 animate-spin" /> : "EXÉCUTER LE TRANSFERT ⚡"}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

// ═══════════════════════════════════════════════════════════════
// Create Transaction Modal (Micro-Complete)
// ═══════════════════════════════════════════════════════════════
function CreateTransactionModal({ open, onOpenChange, wallets, storeId }: any) {
   const qc = useQueryClient();
   const [formData, setFormData] = useState({
      type: 'PAYMENT',
      wallet_id: '',
      amount: 0,
      category: 'SALE',
      reference: '',
      beneficiary: '',
      description: '',
      transaction_date: new Date().toISOString().split('T')[0]
   });

   const createTx = useMutation({
      mutationFn: (data: any) => apiFetch('/api/v1/finance/transactions', { 
         method: 'POST', 
         body: JSON.stringify({ ...data, store_id: storeId }) 
      }),
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['transactions'] });
         qc.invalidateQueries({ queryKey: ['wallets'] });
         toast.success('Opération financière enregistrée');
         onOpenChange(false);
         setFormData({
            type: 'PAYMENT',
            wallet_id: '',
            amount: 0,
            category: 'SALE',
            reference: '',
            beneficiary: '',
            description: '',
            transaction_date: new Date().toISOString().split('T')[0]
         });
      },
      onError: (err: any) => toast.error(err.message || 'Erreur lors de l’opération')
   });

   const categoriesByType: Record<string, string[]> = {
      PAYMENT: ['SALE', 'REFUND_CANCELLATION', 'INVESTMENT', 'OTHER'],
      DISBURSEMENT: ['WITHDRAWAL', 'TRANSFER', 'SUPPLIER_PAYMENT', 'SALARY', 'OTHER'],
      CHARGE: ['MARKETING', 'LOGISTICS', 'RENT', 'TAX', 'OTHER']
   };

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent className="max-w-4xl p-0 border-none bg-white rounded-[40px] overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            <div className="bg-[#2D3436] p-10 text-white shrink-0 relative overflow-hidden">
               <div className="absolute top-0 right-0 p-10 opacity-[0.05] -rotate-12">
                  <Activity className="size-48" />
               </div>
               <div className="relative z-10 flex items-center justify-between">
                  <div className="flex items-center gap-6">
                     <div className={cn(
                        "size-16 rounded-3xl flex items-center justify-center shadow-2xl transition-all",
                        formData.type === 'PAYMENT' ? "bg-emerald-500" : "bg-rose-500"
                     )}>
                        <DollarSign className="size-8 text-white" />
                     </div>
                     <div>
                        <DialogTitle className="text-2xl font-black uppercase tracking-tight leading-none">Nouvelle Écriture Comptable</DialogTitle>
                        <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mt-2 flex items-center gap-2">
                           <ShieldCheck className="size-4 text-emerald-400" /> Validation Node Trésorerie
                        </p>
                     </div>
                  </div>
                  <button onClick={() => onOpenChange(false)} className="p-3 rounded-2xl hover:bg-white/10 transition-all">
                     <X className="size-6 text-white/50" />
                  </button>
               </div>
            </div>

            <div className="flex-1 overflow-y-auto p-10 space-y-10 custom-scrollbar pb-32">
               <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                     <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Nature du Flux *</label>
                     <div className="flex p-1 bg-slate-50 rounded-2xl border border-slate-100">
                        {['PAYMENT', 'DISBURSEMENT', 'CHARGE'].map((t) => (
                           <button
                              key={t}
                              onClick={() => setFormData({ ...formData, type: t as any, category: categoriesByType[t][0] })}
                              className={cn(
                                 "flex-1 h-12 rounded-xl text-[10px] font-black uppercase tracking-tight transition-all",
                                 formData.type === t 
                                    ? (t === 'PAYMENT' ? "bg-emerald-500 text-white shadow-lg shadow-emerald-100" : "bg-rose-500 text-white shadow-lg shadow-rose-100")
                                    : "text-slate-400 hover:text-slate-600"
                              )}
                           >
                              {t === 'PAYMENT' ? 'Entrée' : t === 'DISBURSEMENT' ? 'Sortie' : 'Charge'}
                           </button>
                        ))}
                     </div>
                  </div>
                  <div className="space-y-4">
                     <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Compte de Trésorerie *</label>
                     <Select value={formData.wallet_id} onValueChange={v => setFormData({ ...formData, wallet_id: v })}>
                        <SelectTrigger className="h-14 border-slate-100 bg-slate-50/50 rounded-2xl px-6 text-sm font-black transition-all">
                           <SelectValue placeholder="Sélectionner un compte" />
                        </SelectTrigger>
                        <SelectContent className="rounded-[24px]">
                           {wallets.map((w: any) => (
                              <SelectItem key={w.id} value={w.id} className="font-bold">{w.name} ({formatPrice(w.balance)})</SelectItem>
                           ))}
                        </SelectContent>
                     </Select>
                  </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                     <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Montant Opérationnel *</label>
                     <div className="relative">
                        <Input
                           type="number"
                           value={formData.amount} onChange={e => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                           className="h-16 border-slate-100 bg-slate-50/50 focus:bg-white rounded-[24px] pl-14 text-2xl font-black transition-all"
                        />
                        <Banknote className="absolute left-6 top-1/2 -translate-y-1/2 size-6 text-slate-300" />
                        <span className="absolute right-6 top-1/2 -translate-y-1/2 text-xs font-black text-slate-300 uppercase">DZD</span>
                     </div>
                  </div>
                  <div className="space-y-4">
                     <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Date de Valeur</label>
                     <div className="relative">
                        <Input
                           type="date"
                           value={formData.transaction_date} onChange={e => setFormData({ ...formData, transaction_date: e.target.value })}
                           className="h-16 border-slate-100 bg-slate-50/50 focus:bg-white rounded-[24px] px-6 text-sm font-black transition-all"
                        />
                        <Clock className="absolute right-6 top-1/2 -translate-y-1/2 size-5 text-slate-300 pointer-events-none" />
                     </div>
                  </div>
               </div>

               <div className="bg-slate-50/50 rounded-[40px] p-10 border border-slate-100 space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                     <div className="space-y-4">
                        <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Catégorie Comptable</label>
                        <Select value={formData.category} onValueChange={v => setFormData({ ...formData, category: v })}>
                           <SelectTrigger className="h-14 border-white bg-white rounded-2xl px-6 text-sm font-black shadow-sm">
                              <SelectValue placeholder="Choisir une catégorie" />
                           </SelectTrigger>
                           <SelectContent className="rounded-[24px]">
                              {categoriesByType[formData.type].map(c => (
                                 <SelectItem key={c} value={c} className="font-bold uppercase text-[11px]">{c.replace(/_/g, ' ')}</SelectItem>
                              ))}
                           </SelectContent>
                        </Select>
                     </div>
                     <div className="space-y-4">
                        <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Référence / N° Pièce</label>
                        <div className="relative">
                           <Input
                              value={formData.reference} onChange={e => setFormData({ ...formData, reference: e.target.value })}
                              placeholder="Ex: FAC-2024-001"
                              className="h-14 border-white bg-white rounded-2xl px-6 text-sm font-black shadow-sm"
                           />
                           <Zap className="absolute right-6 top-1/2 -translate-y-1/2 size-4 text-slate-200" />
                        </div>
                     </div>
                  </div>

                  <div className="space-y-4">
                     <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Bénéficiaire / Donneur d'ordre</label>
                     <div className="relative">
                        <Input
                           value={formData.beneficiary} onChange={e => setFormData({ ...formData, beneficiary: e.target.value })}
                           placeholder="Nom du client, fournisseur ou employé..."
                           className="h-14 border-white bg-white rounded-2xl pl-12 text-sm font-black shadow-sm"
                        />
                        <UserCircle className="absolute left-5 top-1/2 -translate-y-1/2 size-5 text-slate-300" />
                     </div>
                  </div>

                  <div className="space-y-4">
                     <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Notes & Libellé Additionnel</label>
                     <textarea
                        value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Précisions sur l'opération, motifs du versement..."
                        className="w-full min-h-[120px] p-6 rounded-[24px] border border-white bg-white text-sm font-medium focus:ring-1 focus:ring-[#6C5CE7] transition-all outline-none resize-none shadow-sm"
                     />
                  </div>
               </div>
            </div>

            <DialogFooter className="p-10 bg-white border-t border-slate-50 flex items-center justify-between shrink-0">
               <div className="flex flex-col">
                  <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1">Impact Trésorerie</span>
                  <p className={cn(
                     "text-2xl font-black tabular-nums tracking-tighter",
                     formData.type === 'PAYMENT' ? "text-emerald-500" : "text-rose-500"
                  )}>
                     {formData.type === 'PAYMENT' ? '+' : '-'}{formatPrice(formData.amount)}
                  </p>
               </div>
               <div className="flex items-center gap-4">
                  <button onClick={() => onOpenChange(false)} className="h-14 px-8 rounded-2xl text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors">Annuler</button>
                  <Button
                     onClick={() => createTx.mutate(formData)}
                     disabled={createTx.isPending || !formData.wallet_id || formData.amount <= 0}
                     className={cn(
                        "h-14 px-12 rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-2xl transition-all active:scale-[0.98]",
                        formData.type === 'PAYMENT' ? "bg-emerald-500 hover:bg-emerald-600 shadow-emerald-100" : "bg-rose-500 hover:bg-rose-600 shadow-rose-100"
                     )}
                  >
                     {createTx.isPending ? <Loader2 className="size-5 animate-spin" /> : "VALIDER L'ÉCRITURE ✓"}
                  </Button>
               </div>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
