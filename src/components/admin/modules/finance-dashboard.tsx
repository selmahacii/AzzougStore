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
   AlertCircle,
   Info,
   Landmark,
   Truck,
   Smartphone,
   Building2,
   Calendar,
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
   const [isRebalanceOpen, setIsRebalanceOpen] = useState(false);
   const [isCreateTxOpen, setIsCreateTxOpen] = useState(false);
   const [selectedWallet, setSelectedWallet] = useState<any | null>(null);
   const [selectedTx, setSelectedTx] = useState<any | null>(null);
   const [createTxType, setCreateTxType] = useState<'payment' | 'disbursement' | 'charge'>('payment');
   const [txSearch, setTxSearch] = useState('');
   const [txDateFrom, setTxDateFrom] = useState('');
   const [txDateTo, setTxDateTo] = useState('');

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
      queryKey: ['transactions', storeId, activeTab, page, txSearch, txDateFrom, txDateTo],
      queryFn: () => {
         const typeMap: Record<string, string> = {
            disbursements: 'disbursement',
            charges: 'charge',
            payments: 'payment',
         };
         const params = new URLSearchParams({
            store_id: storeId,
            transaction_type: typeMap[activeTab] || '',
            page: String(page),
            pageSize: String(pageSize),
         });
         if (txSearch) params.set('search', txSearch);
         if (txDateFrom) params.set('date_from', txDateFrom);
         if (txDateTo) params.set('date_to', txDateTo);
         return apiFetch<{ success: boolean; data: any[]; total: number }>(`/api/v1/finance/transactions?${params.toString()}`);
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
   const rawTransactions = txResponse?.data || [];
   const transactions = React.useMemo(() => {
      if (!txSearch.trim()) return rawTransactions;
      const q = txSearch.toLowerCase().trim();
      return rawTransactions.filter((t: any) =>
         (t.reference || '').toLowerCase().includes(q) ||
         (t.beneficiary || '').toLowerCase().includes(q) ||
         (t.description || '').toLowerCase().includes(q) ||
         (t.category || '').toLowerCase().includes(q) ||
         (t.wallet?.name || '').toLowerCase().includes(q) ||
         String(t.amount || '').includes(q)
      );
   }, [rawTransactions, txSearch]);
   const totalBalance = wallets.reduce((acc, curr) => acc + curr.balance, 0);
   const totalIn = wallets.reduce((acc, curr) => acc + curr.total_in, 0);
   const totalOut = wallets.reduce((acc, curr) => acc + curr.total_out, 0);

   return (
      <div className="space-y-8 pb-32 animate-in fade-in duration-700">
         
         {/* ─── Financial Intelligence & Real-time KPIs ─── */}
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {/* 1. Trésorerie Consolidée Disponible */}
            <div className="xl:col-span-2 bg-[#2D3436] rounded-[32px] p-7 text-white relative overflow-hidden shadow-xl flex flex-col justify-between group hover:shadow-2xl transition-all">
               <div className="absolute top-0 right-0 p-6 opacity-[0.04] rotate-12">
                  <TrendingUp className="size-36" />
               </div>
               <div className="relative z-10">
                  <div className="flex items-center justify-between mb-3">
                     <div className="flex items-center gap-3">
                        <div className="size-10 bg-[#6C5CE7] rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/30">
                           <WalletIcon className="size-5 text-white" />
                        </div>
                        <div>
                           <h1 className="text-base font-black uppercase tracking-tight leading-none">Console Financière</h1>
                           <p className="text-white/40 text-[9px] font-black uppercase tracking-widest mt-1 flex items-center gap-1.5">
                              <ShieldCheck className="size-3 text-emerald-400" /> Trésorerie Consolidée Disponible
                           </p>
                        </div>
                     </div>
                  </div>
                  <div className="mt-2">
                     <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1">Liquidités Immédiatement Mobilisables</p>
                     <p className="text-4xl font-black tracking-tighter tabular-nums">{formatPrice(totalBalance)}</p>
                  </div>
               </div>
               <div className="pt-3 mt-3 border-t border-white/10 relative z-10 text-[10px] font-medium text-white/60 leading-relaxed">
                  Liquidités réelles immédiatement mobilisables réparties sur l'ensemble de vos caisses physiques et comptes bancaires/CCP.
               </div>
            </div>

            {/* 2. Ventes & Encaissements Entrants */}
            <div className="bg-white rounded-[32px] border p-6 flex flex-col justify-between shadow-xs hover:shadow-md transition-all" style={{ borderColor: C.border }}>
               <div className="flex items-center justify-between">
                  <div className="size-11 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                     <ArrowUpRight className="size-5" />
                  </div>
                  <Badge className="bg-emerald-50 text-emerald-600 border border-emerald-100 text-[9px] font-black uppercase">Entrées</Badge>
               </div>
               <div className="mt-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Ventes & Encaissements</p>
                  <p className="text-2xl font-black text-emerald-600 tabular-nums">+{formatPrice(totalIn)}</p>
               </div>
               <p className="text-[10px] text-slate-400 font-medium leading-relaxed mt-3 pt-3 border-t border-slate-100">
                  Total des entrées financières réelles (encaissements des livraisons COD payées et règlements clients).
               </p>
            </div>

            {/* 3. Charges & Décaissements Sortants */}
            <div className="bg-white rounded-[32px] border p-6 flex flex-col justify-between shadow-xs hover:shadow-md transition-all" style={{ borderColor: C.border }}>
               <div className="flex items-center justify-between">
                  <div className="size-11 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600">
                     <ArrowDownRight className="size-5" />
                  </div>
                  <Badge className="bg-rose-50 text-rose-600 border border-rose-100 text-[9px] font-black uppercase">Sorties</Badge>
               </div>
               <div className="mt-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Charges & Décaissements</p>
                  <p className="text-2xl font-black text-rose-600 tabular-nums">-{formatPrice(totalOut)}</p>
               </div>
               <p className="text-[10px] text-slate-400 font-medium leading-relaxed mt-3 pt-3 border-t border-slate-100">
                  Total des sorties d'argent (dépenses publicitaires Meta/TikTok, salaires, achats de stock, emballage, logistique).
               </p>
            </div>

            {/* 4. Bénéfice Cashflow Net (Flux Net) */}
            <div className="bg-white rounded-[32px] border p-6 flex flex-col justify-between shadow-xs hover:shadow-md transition-all" style={{ borderColor: C.border }}>
               <div className="flex items-center justify-between">
                  <div className="size-11 rounded-2xl bg-indigo-50 flex items-center justify-center text-[#6C5CE7]">
                     <TrendingUp className="size-5" />
                  </div>
                  <Badge className="bg-indigo-50 text-[#6C5CE7] border border-indigo-100 text-[9px] font-black uppercase">Flux Net</Badge>
               </div>
               <div className="mt-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Bénéfice Cashflow Net</p>
                  <p className={cn("text-2xl font-black tabular-nums", (totalIn - totalOut) >= 0 ? "text-emerald-600" : "text-rose-600")}>
                     {(totalIn - totalOut) >= 0 ? '+' : ''}{formatPrice(totalIn - totalOut)}
                  </p>
               </div>
               <p className="text-[10px] text-slate-400 font-medium leading-relaxed mt-3 pt-3 border-t border-slate-100">
                  Différence exacte entre vos entrées et sorties de trésorerie (Entrées − Sorties). Indique si l'activité crée du cash.
               </p>
            </div>

            {/* 5. Taux de Marge Nette de Cash (%) */}
            <div className="bg-white rounded-[32px] border p-6 flex flex-col justify-between shadow-xs hover:shadow-md transition-all" style={{ borderColor: C.border }}>
               <div className="flex items-center justify-between">
                  <div className="size-11 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600">
                     <Layers className="size-5" />
                  </div>
                  <Badge className="bg-amber-50 text-amber-600 border border-amber-100 text-[9px] font-black uppercase">Marge</Badge>
               </div>
               <div className="mt-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Taux Marge Nette Cash</p>
                  <p className="text-2xl font-black text-amber-600 tabular-nums">
                     {totalIn > 0 ? `${(((totalIn - totalOut) / totalIn) * 100).toFixed(1)}%` : '100%'}
                  </p>
               </div>
               <p className="text-[10px] text-slate-400 font-medium leading-relaxed mt-3 pt-3 border-t border-slate-100">
                  Ratio de rentabilité ((Flux Net / Entrées) × 100) : part de chaque dinar qui reste effectivement en trésorerie.
               </p>
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
                  onClick={() => setIsRebalanceOpen(true)}
                  className="h-12 px-6 rounded-2xl border border-[#FD7014]/20 bg-[#FFF3E8] hover:bg-white text-[#FD7014] transition-all text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
               >
                  <Layers className="size-4" /> Rééquilibrage
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
                  <div key={w.id} className={cn("bg-white rounded-[40px] border p-8 shadow-sm hover:shadow-xl hover:shadow-indigo-50/50 transition-all group overflow-hidden relative cursor-pointer", w.min_threshold && w.balance < w.min_threshold ? "border-rose-200 ring-2 ring-rose-100" : "")} style={{ borderColor: w.min_threshold && w.balance < w.min_threshold ? undefined : C.border }} onClick={() => setSelectedWallet(w)}>
                     {/* Low-balance warning banner */}
                     {w.min_threshold && w.balance < w.min_threshold && (
                        <div className="absolute top-0 left-0 right-0 bg-rose-500 text-white text-[9px] font-black uppercase tracking-widest px-4 py-1.5 flex items-center gap-2">
                           <AlertCircle className="size-3" /> Solde bas — seuil d'alerte dépassé
                        </div>
                     )}
                     <div className="absolute top-0 right-0 p-8 opacity-[0.03] text-[#6C5CE7]">
                        <CreditCard className="size-32" />
                     </div>
                     <div className={cn("flex items-center justify-between mb-8 relative z-10", w.min_threshold && w.balance < w.min_threshold && "mt-5")}>
                        <div className="size-16 rounded-[24px] bg-[#FAFBFD] border flex items-center justify-center group-hover:bg-[#F0EDFF] transition-all">
                           <CreditCard className="size-8 text-slate-300 group-hover:text-[#6C5CE7]" />
                        </div>
                        <Badge variant="outline" className="bg-white border-slate-100 text-[10px] font-black uppercase tracking-tight text-slate-400 px-3 py-1 rounded-xl">{w.type}</Badge>
                     </div>
                     <div className="relative z-10">
                        <h3 className="text-xl font-black text-[#2D3436] uppercase tracking-tight mb-1">{w.name}</h3>
                        <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1">ID CORE: {w.id.split('-')[0].toUpperCase()}</p>
                        {w.account_number && (
                           <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">N° COMPTE: {w.account_number}</p>
                        )}
                        
                        <div className="flex items-end justify-between mt-4">
                           <div>
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Disponible</p>
                              <p className={cn("text-3xl font-black tracking-tighter", w.min_threshold && w.balance < w.min_threshold ? "text-rose-500" : "text-[#6C5CE7]")}>{formatPrice(w.balance)}</p>
                           </div>
                           <button onClick={(e) => { e.stopPropagation(); setIsTransferOpen(true); }} className="size-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-300 hover:text-[#6C5CE7] hover:bg-[#F0EDFF] transition-all">
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
                           {wallets.length > 1 && (() => {
                              const totalBal = wallets.reduce((s: number, ww: any) => s + (ww.balance || 0), 0);
                              const pct = totalBal > 0 ? ((w.balance / totalBal) * 100).toFixed(0) : '0';
                              return (
                                 <div className="flex flex-col ml-2">
                                    <span className="text-[9px] font-black text-[#6C5CE7] uppercase tracking-tighter">Part</span>
                                    <span className="text-xs font-black text-[#6C5CE7]">{pct}%</span>
                                 </div>
                              );
                           })()}
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
               {/* Search & Date Filter Bar */}
                <div className="px-8 py-5 border-b flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4" style={{ borderColor: C.border }}>
                   <div className="flex items-center gap-3 flex-1 max-w-xl">
                      <div className="relative flex-1">
                         <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-300" />
                         <input
                            value={txSearch}
                            onChange={e => { setTxSearch(e.target.value); setPage(1); }}
                            placeholder="Rechercher par référence, bénéficiaire, montant, caisse..."
                            className="w-full h-11 pl-11 pr-4 text-xs font-bold text-slate-700 border border-slate-200 bg-slate-50/50 rounded-2xl outline-none focus:ring-2 focus:ring-[#6C5CE7]/20 focus:bg-white transition-all"
                         />
                      </div>
                      <div className="flex items-center gap-2">
                         <input
                            type="date"
                            value={txDateFrom}
                            onChange={e => { setTxDateFrom(e.target.value); setPage(1); }}
                            className="h-11 px-3 text-xs font-bold text-slate-700 border border-slate-200 bg-slate-50/50 rounded-2xl outline-none focus:ring-2 focus:ring-[#6C5CE7]/20"
                         />
                         <span className="text-xs text-slate-400 font-bold">→</span>
                         <input
                            type="date"
                            value={txDateTo}
                            onChange={e => { setTxDateTo(e.target.value); setPage(1); }}
                            className="h-11 px-3 text-xs font-bold text-slate-700 border border-slate-200 bg-slate-50/50 rounded-2xl outline-none focus:ring-2 focus:ring-[#6C5CE7]/20"
                         />
                      </div>
                      {(txSearch || txDateFrom || txDateTo) && (
                         <button
                            onClick={() => { setTxSearch(''); setTxDateFrom(''); setTxDateTo(''); setPage(1); }}
                            className="h-11 px-3 rounded-2xl bg-rose-50 text-rose-500 text-[10px] font-black uppercase tracking-wider flex items-center gap-1 hover:bg-rose-100 transition-all shrink-0"
                         >
                            <X className="size-3.5" />
                         </button>
                      )}
                   </div>

                   {/* Contextual Action Button */}
                   <div className="flex items-center gap-3">
                      {activeTab === 'payments' && (
                         <Button 
                            onClick={() => { setCreateTxType('payment'); setIsCreateTxOpen(true); }}
                            className="h-11 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-100 flex items-center gap-2"
                         >
                            <Plus className="size-4" /> Encaisser une Vente
                         </Button>
                      )}
                      {activeTab === 'charges' && (
                         <Button 
                            onClick={() => { setCreateTxType('charge'); setIsCreateTxOpen(true); }}
                            className="h-11 px-5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-100 flex items-center gap-2"
                         >
                            <Plus className="size-4" /> Enregistrer une Charge
                         </Button>
                      )}
                      {activeTab === 'disbursements' && (
                         <Button 
                            onClick={() => { setCreateTxType('disbursement'); setIsCreateTxOpen(true); }}
                            className="h-11 px-5 rounded-2xl bg-[#6C5CE7] hover:bg-[#5b4cc4] text-white text-xs font-bold shadow-md shadow-indigo-100 flex items-center gap-2"
                         >
                            <Plus className="size-4" /> Nouveau Décaissement
                         </Button>
                      )}
                   </div>
                </div>

                <div className="overflow-x-auto">
                   <table className="w-full text-left min-w-[1000px]">
                      <thead>
                         <tr className="border-b" style={{ borderColor: C.border, backgroundColor: '#FAFBFD' }}>
                            <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Référence Flux</th>
                            <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Catégorie</th>
                            <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Bénéficiaire</th>
                            <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Montant</th>
                            <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Compte Source/Cible</th>
                            <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Horodatage</th>
                            <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Preuve</th>
                         </tr>
                      </thead>
                      <tbody className="divide-y" style={{ borderColor: '#F8F9FC' }}>
                         {isTxLoading ? (
                            Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={7} className="px-8 py-8 animate-pulse bg-slate-50/30" /></tr>)
                         ) : transactions.length === 0 ? (
                            <tr>
                               <td colSpan={7} className="px-8 py-20 text-center">
                                  <div className="flex flex-col items-center justify-center space-y-3">
                                     <div className="size-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
                                        <Receipt className="size-6" />
                                     </div>
                                     <p className="text-xs font-bold text-slate-600">Aucun flux financier détecté</p>
                                     <p className="text-[11px] text-slate-400 max-w-sm">
                                        {activeTab === 'payments' ? "Aucun encaissement enregistré. Enregistrez une vente manuellement ou passez une commande à l'état Livré." :
                                         activeTab === 'charges' ? "Aucune charge enregistrée. Ajoutez vos dépenses de pub, loyers ou achats." :
                                         "Aucun versement ou décaissement détecté pour cette période."}
                                     </p>
                                     <Button 
                                        onClick={() => {
                                           setCreateTxType(activeTab === 'charges' ? 'charge' : activeTab === 'disbursements' ? 'disbursement' : 'payment');
                                           setIsCreateTxOpen(true);
                                        }} 
                                        className="h-9 px-4 rounded-xl text-xs font-bold bg-[#6C5CE7] text-white"
                                     >
                                        + Ajouter une opération
                                     </Button>
                                  </div>
                               </td>
                            </tr>
                         ) : transactions.map((t: any) => {
                            const txDateStr = t.transaction_date || t.created_at;
                            const txDate = txDateStr ? new Date(txDateStr) : null;
                            const isValidDate = txDate && !isNaN(txDate.getTime()) && txDate.getFullYear() > 1970;
                            const isPayment = t.type === 'payment';
                            const effectiveCat = t.category || (isPayment ? 'VENTE COD' : 'DÉCAISSEMENT');
                            const effectiveBenef = t.beneficiary || (t.reference?.startsWith('COD-') ? 'Client COD' : (isPayment ? 'Client' : 'Prestataire'));
                            const effectiveWallet = t.wallet?.name || (isPayment ? 'Caisse Principale (COD)' : 'Compte Courant');

                            return (
                               <tr key={t.id} className="hover:bg-slate-50/50 transition-colors group">
                                  <td className="px-8 py-5">
                                     <div className="flex items-center gap-3">
                                        <div className={cn("size-2 rounded-full", isPayment ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-rose-500 shadow-[0_0_8px_#f43f5e]")} />
                                        <span className="text-xs font-black text-slate-900 group-hover:text-[#6C5CE7] transition-colors font-mono">{t.reference || 'SYSTEM-TX'}</span>
                                     </div>
                                  </td>
                                  <td className="px-8 py-5 text-center">
                                     <Badge className={cn(
                                        "border text-[9px] font-black uppercase tracking-tight px-2.5 py-1 rounded-xl",
                                        isPayment ? "bg-emerald-50 text-emerald-700 border-emerald-200/60" : "bg-rose-50 text-rose-700 border-rose-200/60"
                                     )}>
                                        {effectiveCat.replace(/_/g, ' ')}
                                     </Badge>
                                  </td>
                                  <td className="px-8 py-5">
                                     <span className="text-xs font-bold text-slate-700 uppercase tracking-tight truncate max-w-[160px] block" title={effectiveBenef}>
                                        {effectiveBenef}
                                     </span>
                                  </td>
                                  <td className="px-8 py-5">
                                     <span className={cn("text-sm font-black tabular-nums font-mono", isPayment ? "text-emerald-600" : "text-rose-600")}>
                                        {isPayment ? '+' : '-'}{formatPrice(t.amount)}
                                     </span>
                                  </td>
                                  <td className="px-8 py-5">
                                     <div className="flex items-center gap-2">
                                        <div className="size-6 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                                           <WalletIcon className="size-3" />
                                        </div>
                                        <span className="text-xs font-bold text-slate-700 uppercase tracking-tight truncate max-w-[160px]">
                                           {effectiveWallet}
                                        </span>
                                     </div>
                                  </td>
                                  <td className="px-8 py-5">
                                     <div className="flex flex-col">
                                        <span className="text-xs font-black text-slate-800">
                                           {isValidDate ? txDate.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Récemment'}
                                        </span>
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">
                                           {isValidDate ? txDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                                        </span>
                                     </div>
                                  </td>
                                  <td className="px-8 py-5 text-right">
                                     <button 
                                        onClick={() => setSelectedTx(t)}
                                        className="size-9 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-[#6C5CE7] hover:border-[#6C5CE7] transition-all shadow-2xs flex items-center justify-center ml-auto group/btn cursor-pointer"
                                        title="Afficher la preuve et le reçu complet"
                                     >
                                        <Eye className="size-4 group-hover/btn:scale-110 transition-transform" />
                                     </button>
                                  </td>
                               </tr>
                            );
                         })}
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
         <TransferModal open={isTransferOpen} onOpenChange={setIsTransferOpen} wallets={wallets} storeId={storeId} />
         <RebalanceModal open={isRebalanceOpen} onOpenChange={setIsRebalanceOpen} wallets={wallets} storeId={storeId} />
         <CreateTransactionModal 
            open={isCreateTxOpen} 
            onOpenChange={setIsCreateTxOpen} 
            wallets={wallets} 
            storeId={storeId} 
            defaultType={createTxType}
         />
         <WalletDetailModal wallet={selectedWallet} storeId={storeId} onClose={() => setSelectedWallet(null)} />
         <TransactionDetailModal transaction={selectedTx} open={!!selectedTx} onClose={() => setSelectedTx(null)} />
      </div>
   );
}

// ═══════════════════════════════════════════════════════════════
// Wallet Detail Modal — full transaction history per wallet
// ═══════════════════════════════════════════════════════════════
function WalletDetailModal({ wallet, storeId, onClose }: { wallet: any; storeId: string; onClose: () => void }) {
   const [txPage, setTxPage] = useState(1);
   const [txSearch, setTxSearch] = useState('');
   const [txType, setTxType] = useState('');
   const pageSize = 15;

   const txQuery = useQuery({
      queryKey: ['wallet-tx', wallet?.id, txPage, txType],
      queryFn: () => apiFetch<{ success: boolean; data: any[]; total: number }>(
         `/api/v1/finance/transactions?store_id=${storeId}&wallet_id=${wallet.id}&page=${txPage}&pageSize=${pageSize}${txType ? `&transaction_type=${txType}` : ''}`
      ),
      enabled: !!wallet && !!storeId,
   });

   const rawList = txQuery.data?.data || [];
   const txList = txSearch
      ? rawList.filter((t: any) =>
          (t.reference || '').toLowerCase().includes(txSearch.toLowerCase()) ||
          (t.beneficiary || '').toLowerCase().includes(txSearch.toLowerCase()) ||
          (t.description || '').toLowerCase().includes(txSearch.toLowerCase())
        )
      : rawList;
   const txTotal = txQuery.data?.total || 0;
   const txPages = Math.ceil(txTotal / pageSize);

   const typeLabel: Record<string, { label: string; color: string; bg: string }> = {
      payment:      { label: 'Vente',    color: '#00B894', bg: '#E6FFF8' },
      disbursement: { label: 'Sortie',   color: '#E17055', bg: '#FFEDE9' },
      charge:       { label: 'Charge',   color: '#FD7014', bg: '#FFF3E8' },
      transfer:     { label: 'Transfert',color: '#6C5CE7', bg: '#F0EDFF' },
   };

   if (!wallet) return null;

   return (
      <Dialog open={!!wallet} onOpenChange={(open) => { if (!open) onClose(); }}>
         <DialogContent className="max-w-4xl w-[95vw] p-0 border-none bg-white rounded-[40px] overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="bg-[#2D3436] p-8 text-white shrink-0">
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-5">
                     <div className="size-16 bg-[#6C5CE7] rounded-[24px] flex items-center justify-center shadow-xl shadow-indigo-500/30">
                        <CreditCard className="size-8 text-white" />
                     </div>
                     <div>
                        <DialogTitle className="text-2xl font-black uppercase tracking-tight leading-none">{wallet.name}</DialogTitle>
                        <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mt-1">{wallet.type} · ID: {wallet.id.split('-')[0].toUpperCase()}</p>
                     </div>
                  </div>
                  <button onClick={onClose} className="p-3 rounded-2xl hover:bg-white/10 transition-all">
                     <X className="size-5 text-white/50" />
                  </button>
               </div>
               {/* KPIs */}
               <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
                  {[
                     { label: 'Solde actuel', value: formatPrice(wallet.balance), color: '#6C5CE7' },
                     { label: 'Total Entrées', value: `+${formatPrice(wallet.total_in)}`, color: '#00B894' },
                     { label: 'Total Sorties', value: `-${formatPrice(wallet.total_out)}`, color: '#E17055' },
                  ].map(kpi => (
                     <div key={kpi.label} className="bg-white/10 rounded-2xl p-4 backdrop-blur-sm">
                        <p className="text-[9px] font-black text-white/40 uppercase tracking-widest mb-1">{kpi.label}</p>
                        <p className="text-lg font-black" style={{ color: kpi.color }}>{kpi.value}</p>
                     </div>
                  ))}
               </div>
            </div>

            {/* Filters */}
            <div className="px-8 py-4 border-b border-slate-100 flex items-center gap-3 shrink-0 bg-slate-50/50">
               <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-300" />
                  <input
                     value={txSearch}
                     onChange={e => { setTxSearch(e.target.value); setTxPage(1); }}
                     placeholder="Chercher par référence, bénéficiaire..."
                     className="w-full h-10 pl-10 pr-4 rounded-xl border border-slate-100 bg-white text-xs font-bold text-slate-700 outline-none focus:border-[#6C5CE7] transition-all"
                  />
               </div>
               {['', 'payment', 'disbursement', 'charge'].map(t => (
                  <button key={t} onClick={() => { setTxType(t); setTxPage(1); }}
                     className={cn("h-10 px-4 rounded-xl text-[10px] font-black uppercase tracking-wide transition-all",
                        txType === t ? "bg-[#6C5CE7] text-white" : "bg-white border border-slate-100 text-slate-400 hover:text-slate-600"
                     )}>
                     {t === '' ? 'Tout' : typeLabel[t]?.label}
                  </button>
               ))}
            </div>

            {/* Transactions list */}
            <div className="flex-1 overflow-y-auto">
               {txQuery.isLoading ? (
                  <div className="flex items-center justify-center py-20"><Loader2 className="size-8 animate-spin text-slate-200" /></div>
               ) : txList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-slate-300">
                     <Receipt className="size-12 mb-3 opacity-30" />
                     <p className="text-xs font-black uppercase tracking-widest">Aucune transaction</p>
                  </div>
               ) : (
                  <table className="w-full text-left">
                     <thead className="bg-slate-50/80 sticky top-0">
                        <tr>
                           {['Date', 'Type', 'Référence', 'Catégorie', 'Bénéficiaire', 'Description', 'Montant'].map(h => (
                              <th key={h} className="px-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                           ))}
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-50">
                        {txList.map((t: any) => {
                           const meta = typeLabel[t.type] || { label: t.type, color: '#636E72', bg: '#F8F9FC' };
                           const isIn = t.type === 'payment';
                           return (
                              <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                                 <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-xs font-black text-slate-800">{new Date(t.created_at || t.transaction_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}</div>
                                    <div className="text-[9px] font-black text-slate-300">{new Date(t.created_at || t.transaction_date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                                 </td>
                                 <td className="px-6 py-4">
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wide" style={{ color: meta.color, backgroundColor: meta.bg }}>
                                       {meta.label}
                                    </span>
                                 </td>
                                 <td className="px-6 py-4">
                                    <span className="text-[10px] font-black font-mono text-slate-600">{t.reference || '—'}</span>
                                 </td>
                                 <td className="px-6 py-4">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase">{t.category || '—'}</span>
                                 </td>
                                 <td className="px-6 py-4">
                                    <span className="text-[10px] font-bold text-slate-700 max-w-[120px] truncate block">{t.beneficiary || '—'}</span>
                                 </td>
                                 <td className="px-6 py-4 max-w-[160px]">
                                    <span className="text-[10px] font-medium text-slate-400 truncate block">{t.description || '—'}</span>
                                 </td>
                                 <td className="px-6 py-4 text-right whitespace-nowrap">
                                    <span className={cn("text-sm font-black tabular-nums", isIn ? "text-emerald-500" : "text-rose-500")}>
                                       {isIn ? '+' : '-'}{formatPrice(t.amount)}
                                    </span>
                                 </td>
                              </tr>
                           );
                        })}
                     </tbody>
                  </table>
               )}
            </div>

            {/* Pagination */}
            <div className="px-8 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between shrink-0">
               <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{txTotal} opérations au total</span>
               <div className="flex items-center gap-2">
                  <button disabled={txPage <= 1} onClick={() => setTxPage(p => p - 1)}
                     className="size-9 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-slate-700 disabled:opacity-30 flex items-center justify-center transition-all">
                     <ChevronLeft className="size-4" />
                  </button>
                  <span className="text-[10px] font-black text-slate-700 px-3">{txPage} / {txPages || 1}</span>
                  <button disabled={txPage >= txPages} onClick={() => setTxPage(p => p + 1)}
                     className="size-9 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-slate-700 disabled:opacity-30 flex items-center justify-center transition-all">
                     <ChevronRight className="size-4" />
                  </button>
               </div>
            </div>
         </DialogContent>
      </Dialog>
   );
}


// ═══════════════════════════════════════════════════════════════
// Create Wallet Modal
// ═══════════════════════════════════════════════════════════════
function CreateWalletModal({ open, onOpenChange, storeId }: any) {
   const qc = useQueryClient();
   const [formData, setFormData] = useState({ name: '', type: 'cash', balance: 0, description: '', account_number: '', min_threshold: '' });

   const createWallet = useMutation({
      mutationFn: (data: any) => apiFetch('/api/v1/finance/wallets', { method: 'POST', body: JSON.stringify({ ...data, store_id: storeId }) }),
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['wallets'] });
         toast.success('Portefeuille déployé avec succès');
         onOpenChange(false);
         setFormData({ name: '', type: 'cash', balance: 0, description: '', account_number: '', min_threshold: '' });
      }
   });

   const walletTypes = [
      { id: 'cash', label: 'Espèces', desc: 'Caisse physique', icon: Banknote, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', active: 'ring-emerald-500' },
      { id: 'bank', label: 'Banque', desc: 'CCP, CPA, BDL...', icon: Landmark, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', active: 'ring-blue-500' },
      { id: 'mobile', label: 'Mobile', desc: 'BaridiMob, Paysera', icon: Smartphone, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', active: 'ring-purple-500' },
      { id: 'cod', label: 'Livreur', desc: 'Argent chez Yalidine', icon: Truck, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200', active: 'ring-orange-500' },
   ];

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent className="max-w-2xl p-0 border-none bg-white rounded-[40px] overflow-hidden shadow-2xl">
            <div className="bg-[#2D3436] p-10 text-white relative overflow-hidden">
               <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                  <WalletIcon className="size-32" />
               </div>
               <div className="flex items-center justify-between relative z-10">
                  <div className="flex items-center gap-6">
                     <div className="size-16 bg-[#6C5CE7] rounded-3xl flex items-center justify-center shadow-2xl shadow-indigo-500/20">
                        <Plus className="size-8 text-white" />
                     </div>
                     <div>
                        <DialogTitle className="text-2xl font-black uppercase tracking-tight leading-none">Nouveau Compte</DialogTitle>
                        <DialogDescription className="text-white/60 text-[10px] font-black uppercase tracking-widest mt-2">Ajoutez un nouveau point de stockage (Caisse, CCP...)</DialogDescription>
                     </div>
                  </div>
                  <button onClick={() => onOpenChange(false)} className="p-3 rounded-2xl hover:bg-white/10 transition-all">
                     <X className="size-6 text-white/50" />
                  </button>
               </div>
            </div>
            
            <div className="p-10 space-y-8 bg-[#F8F9FC]">
               {/* Types Grid */}
               <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Type de compte *</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                     {walletTypes.map(t => {
                        const isSelected = formData.type === t.id;
                        return (
                           <button
                              key={t.id}
                              onClick={() => setFormData({ ...formData, type: t.id })}
                              className={cn(
                                 "flex flex-col items-center justify-center p-4 rounded-[24px] border-2 transition-all duration-200 group text-center",
                                 isSelected ? cn("bg-white shadow-md ring-2 ring-offset-2", t.active, t.border) : "bg-white border-transparent hover:border-slate-200 text-slate-400 hover:shadow-sm"
                              )}
                           >
                              <div className={cn("size-12 rounded-2xl flex items-center justify-center mb-3 transition-colors", isSelected ? t.bg : "bg-slate-50 group-hover:bg-slate-100")}>
                                 <t.icon className={cn("size-6", isSelected ? t.color : "text-slate-400")} />
                              </div>
                              <span className={cn("text-xs font-black uppercase tracking-tight", isSelected ? "text-slate-800" : "text-slate-500")}>{t.label}</span>
                              <span className={cn("text-[9px] font-bold mt-1", isSelected ? "text-slate-500" : "text-slate-400")}>{t.desc}</span>
                           </button>
                        );
                     })}
                  </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                     <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Nom du compte *</label>
                     <Input 
                        value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                        placeholder="Ex: Caisse Principale, CCP Entreprise..." 
                        className="h-14 border-slate-200 bg-white focus:ring-2 focus:ring-[#6C5CE7]/20 rounded-2xl px-6 text-sm font-black transition-all shadow-sm" 
                     />
                  </div>
                  <div className="space-y-3">
                     <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Solde initial</label>
                     <div className="relative">
                        <Input
                           type="number"
                           value={formData.balance} onChange={e => setFormData({...formData, balance: parseFloat(e.target.value) || 0})}
                           placeholder="0.00" 
                           className="h-14 border-slate-200 bg-white focus:ring-2 focus:ring-[#6C5CE7]/20 rounded-2xl px-6 text-sm font-black transition-all pl-12 shadow-sm" 
                        />
                        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-slate-400" />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400 uppercase bg-slate-100 px-2 py-1 rounded-md">DZD</span>
                     </div>
                  </div>
               </div>

               <div className="space-y-3">
                  <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Description (Optionnel)</label>
                  <Input 
                     value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})}
                     placeholder="Détails, numéro de compte, remarques..." 
                     className="h-14 border-slate-200 bg-white focus:ring-2 focus:ring-[#6C5CE7]/20 rounded-2xl px-6 text-sm font-bold text-slate-600 transition-all shadow-sm" 
                  />
               </div>
            </div>

            <DialogFooter className="p-8 bg-white border-t flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
               <div className="flex items-center gap-3 text-xs font-bold text-slate-500">
                  <Info className="size-4 text-blue-500" /> Ce compte sera disponible pour l'enregistrement des opérations.
               </div>
               <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button onClick={() => onOpenChange(false)} className="h-14 px-8 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-colors w-full sm:w-auto">Annuler</button>
                  <button 
                     onClick={() => createWallet.mutate(formData)}
                     disabled={!formData.name || createWallet.isPending}
                     className="h-14 px-10 bg-[#6C5CE7] hover:bg-[#5f4fd1] disabled:opacity-50 text-white text-[11px] font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-3 shadow-xl shadow-indigo-500/20 transition-all w-full sm:w-auto hover:scale-[1.02] active:scale-[0.98]"
                  >
                     {createWallet.isPending ? 'En cours...' : 'Créer le compte'}
                  </button>
               </div>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

// ═══════════════════════════════════════════════════════════════
// Transfer Modal
// ═══════════════════════════════════════════════════════════════
function TransferModal({ open, onOpenChange, wallets, storeId }: any) {
   const qc = useQueryClient();
   const [formData, setFormData] = useState({
      from_wallet_id: '',
      to_wallet_id: '',
      amount: 0,
      note: '',
      reference: '',
      payment_method: 'transfer',
      issuing_bank: '',
      accounting_agent: '',
      transfer_date: new Date().toISOString().split('T')[0],
      fees: 0
   });

   const transferMutation = useMutation({
      mutationFn: (data: any) => {
         const detailedNote = [
            data.note.trim(),
            `--- SPECIFICATIONS DE VIREMENT ---`,
            `• Référence pièce : ${data.reference.toUpperCase() || 'TRF-INTERNE'}`,
            `• Canal & Banque : ${data.payment_method.toUpperCase()}${data.issuing_bank ? ` (${data.issuing_bank.toUpperCase()})` : ''}`,
            `• Date valeur : ${data.transfer_date}`,
            `• Frais de transfert : ${data.fees || 0} DA`,
            `• Agent Responsable : ${data.accounting_agent.trim() || 'Système'}`
         ].filter(Boolean).join('\n');

         return apiFetch('/api/v1/finance/wallets/transfer', {
            method: 'POST',
            body: JSON.stringify({
               from_wallet_id: data.from_wallet_id,
               to_wallet_id: data.to_wallet_id,
               amount: data.amount,
               note: detailedNote,
               store_id: storeId
            })
         });
      },
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['wallets'] });
         qc.invalidateQueries({ queryKey: ['transactions'] });
         toast.success('Transfert inter-comptes exécuté ✓');
         onOpenChange(false);
         setFormData({
            from_wallet_id: '',
            to_wallet_id: '',
            amount: 0,
            note: '',
            reference: '',
            payment_method: 'transfer',
            issuing_bank: '',
            accounting_agent: '',
            transfer_date: new Date().toISOString().split('T')[0],
            fees: 0
         });
      },
      onError: (err: any) => toast.error(err.message || 'Erreur lors du transfert'),
   });

   const sourceWallet = wallets.find((w: any) => w.id === formData.from_wallet_id);
   const excessBalance = sourceWallet && formData.amount > sourceWallet.balance;

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent showCloseButton={false} className="max-w-3xl w-[95vw] p-0 border-none bg-white rounded-[32px] overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            <div className="bg-[#6C5CE7] p-8 text-white shrink-0 border-b border-[#5f4fd1]">
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-5">
                     <div className="size-14 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/10">
                        <ArrowRightLeft className="size-7 text-white" />
                     </div>
                     <div>
                        <DialogTitle className="text-xl font-black uppercase tracking-tight leading-none font-sans">Transfert de Fonds</DialogTitle>
                        <p className="text-white/60 text-[10px] font-black uppercase tracking-widest mt-1.5 flex items-center gap-1">
                           <ShieldCheck className="size-3.5" /> Virement de fonds inter-comptes sécurisé
                        </p>
                     </div>
                  </div>
                  <button onClick={() => onOpenChange(false)} className="p-2.5 rounded-xl hover:bg-white/10 transition-all shrink-0">
                     <X className="size-5 text-white/50" />
                  </button>
               </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar bg-[#F8F9FC]/30">
               {/* ── 1. COMPTES IMPLIQUÉS ── */}
               <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">1. Comptes impliqués</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Débit (Compte Source) *</label>
                        <Select value={formData.from_wallet_id} onValueChange={v => setFormData({...formData, from_wallet_id: v, to_wallet_id: ''})}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold shadow-sm">
                              <SelectValue placeholder="Compte Source" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl">
                              {wallets.map((w: any) => (
                                 <SelectItem key={w.id} value={w.id} className="font-bold text-xs">{w.name} ({formatPrice(w.balance)} DA)</SelectItem>
                              ))}
                           </SelectContent>
                        </Select>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Crédit (Compte Cible) *</label>
                        <Select value={formData.to_wallet_id} onValueChange={v => setFormData({...formData, to_wallet_id: v})}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold shadow-sm" disabled={!formData.from_wallet_id}>
                              <SelectValue placeholder="Compte Cible" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl">
                              {wallets.filter((w: any) => w.id !== formData.from_wallet_id).map((w: any) => (
                                 <SelectItem key={w.id} value={w.id} className="font-bold text-xs">{w.name} ({formatPrice(w.balance)} DA)</SelectItem>
                              ))}
                           </SelectContent>
                        </Select>
                     </div>
                  </div>
               </div>

               {/* ── 2. MONTANT & DATE ── */}
               <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">2. Volume & Date de Valeur</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Volume du Flux (DZD) *</label>
                        <div className="relative">
                           <Input 
                              type="number" 
                              value={formData.amount || ''} 
                              onChange={e => setFormData({...formData, amount: parseFloat(e.target.value) || 0})}
                              placeholder="0.00" 
                              className="h-12 border-slate-100 bg-white rounded-xl pl-10 pr-12 text-xs font-black text-slate-800"
                           />
                           <Zap className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-emerald-400" />
                           <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300">DA</span>
                        </div>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Frais de virement (DZD)</label>
                        <div className="relative">
                           <Input 
                              type="number" 
                              value={formData.fees || ''} 
                              onChange={e => setFormData({...formData, fees: parseFloat(e.target.value) || 0})}
                              placeholder="0" 
                              className="h-12 border-slate-100 bg-white rounded-xl pl-10 pr-12 text-xs font-black text-slate-800"
                           />
                           <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-rose-400" />
                           <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300">DA</span>
                        </div>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Date valeur</label>
                        <div className="relative">
                           <Input 
                              type="date" 
                              value={formData.transfer_date} 
                              onChange={e => setFormData({...formData, transfer_date: e.target.value})}
                              className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold text-slate-700"
                           />
                        </div>
                     </div>
                  </div>

                  {excessBalance && (
                     <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl text-[10px] text-rose-700 font-semibold leading-relaxed flex gap-2">
                        <AlertCircle className="size-4 shrink-0 text-rose-500 mt-0.5" />
                        <span>
                           Le montant du transfert ({formatPrice(formData.amount)} DA) dépasse le solde disponible dans le portefeuille source ({formatPrice(sourceWallet?.balance)} DA).
                        </span>
                     </div>
                  )}
               </div>

               {/* ── 3. TRAÇABILITÉ & PIÈCE ── */}
               <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">3. Traçabilité & Pièce</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Mode de Transfert</label>
                        <Select value={formData.payment_method} onValueChange={v => setFormData({...formData, payment_method: v})}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold uppercase">
                              <SelectValue placeholder="Mode" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl">
                              <SelectItem value="transfer" className="font-bold text-xs">VIREMENT INTERNE</SelectItem>
                              <SelectItem value="bank_transfer" className="font-bold text-xs">VIREMENT BANCAIRE</SelectItem>
                              <SelectItem value="cash" className="font-bold text-xs">REMISE D'ESPÈCES</SelectItem>
                              <SelectItem value="check" className="font-bold text-xs">DÉPÔT CHÈQUE</SelectItem>
                           </SelectContent>
                        </Select>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Établissement / Banque</label>
                        <Input 
                           value={formData.issuing_bank} 
                           onChange={e => setFormData({...formData, issuing_bank: e.target.value})}
                           placeholder="Ex: CCP, CPA, Caisse Principale..." 
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold text-slate-800"
                        />
                     </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Numéro de pièce / Réf externe</label>
                        <Input 
                           value={formData.reference} 
                           onChange={e => setFormData({...formData, reference: e.target.value})}
                           placeholder="Ex: VIR-CCP-9102" 
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-mono font-bold"
                        />
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Agent Responsable de la pièce</label>
                        <Input 
                           value={formData.accounting_agent} 
                           onChange={e => setFormData({...formData, accounting_agent: e.target.value})}
                           placeholder="Ex: Comptable Principal" 
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold text-slate-800"
                        />
                     </div>
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Motif de l'opération / Description</label>
                     <Input
                        value={formData.note} 
                        onChange={e => setFormData({...formData, note: e.target.value})}
                        placeholder="Ex: Dépôt recettes Yalidine de la semaine..."
                        className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold text-slate-800"
                     />
                  </div>
               </div>
            </div>

            <DialogFooter className="p-8 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3 shrink-0">
               <button onClick={() => onOpenChange(false)} className="h-12 px-6 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors">Annuler Flux</button>
               <Button 
                  onClick={() => transferMutation.mutate(formData)}
                  disabled={transferMutation.isPending || !formData.from_wallet_id || !formData.to_wallet_id || formData.amount <= 0 || excessBalance}
                  className="h-12 px-10 rounded-xl bg-[#6C5CE7] hover:bg-[#5849D1] text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-indigo-200 transition-all active:scale-[0.98]"
               >
                  {transferMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "EXÉCUTER LE TRANSFERT ✓"}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}


// ═══════════════════════════════════════════════════════════════
// Treasury Rebalancing Modal (Dynamic splits, adjustment rules)
// ═══════════════════════════════════════════════════════════════
function RebalanceModal({ open, onOpenChange, wallets, storeId }: any) {
   const qc = useQueryClient();
   const [fromWalletId, setFromWalletId] = useState('');
   const [note, setNote] = useState('');
   const [userRef, setUserRef] = useState('');
   const [accountingAgent, setAccountingAgent] = useState('');
   const [strategy, setStrategy] = useState<'CUSTOM' | 'EQUIPROPORTIONAL' | 'TARGET_BALANCE'>('CUSTOM');
   const [totalAmountToDistribute, setTotalAmountToDistribute] = useState(0);
   const [targetBalanceGoal, setTargetBalanceGoal] = useState(0);

   const [targetsState, setTargetsState] = useState<Record<string, { enabled: boolean; amount: number }>>({});

   const sourceWallet = wallets.find((w: any) => w.id === fromWalletId);
   const eligibleTargets = wallets.filter((w: any) => w.id !== fromWalletId);

   React.useEffect(() => {
      const initial: Record<string, { enabled: boolean; amount: number }> = {};
      eligibleTargets.forEach((w: any) => {
         initial[w.id] = { enabled: false, amount: 0 };
      });
      setTargetsState(initial);
      setTotalAmountToDistribute(0);
      setTargetBalanceGoal(0);
   }, [fromWalletId, open]);

   const selectedTargets = Object.entries(targetsState)
      .filter(([_, t]) => t.enabled && t.amount > 0)
      .map(([id, t]) => ({ to_wallet_id: id, amount: t.amount }));

   const totalAllocated = selectedTargets.reduce((acc, curr) => acc + curr.amount, 0);
   const isOverdrawn = sourceWallet && totalAllocated > sourceWallet.balance;

   const applyStrategy = () => {
      const activeIds = Object.entries(targetsState)
         .filter(([_, t]) => t.enabled)
         .map(([id]) => id);

      if (activeIds.length === 0) {
         toast.error("Veuillez cocher au moins un compte destinataire dans l'étape 4.");
         return;
      }

      if (strategy === 'EQUIPROPORTIONAL') {
         if (totalAmountToDistribute <= 0) {
            toast.error("Veuillez indiquer un montant global supérieur à 0.");
            return;
         }
         const splitAmount = Math.floor(totalAmountToDistribute / activeIds.length);
         setTargetsState(prev => {
            const next = { ...prev };
            activeIds.forEach(id => {
               next[id] = { ...next[id], amount: splitAmount };
            });
            return next;
         });
         toast.success("Montant réparti équitablement !");
      } 
      else if (strategy === 'TARGET_BALANCE') {
         if (targetBalanceGoal <= 0) {
            toast.error("Veuillez indiquer un solde cible supérieur à 0.");
            return;
         }
         setTargetsState(prev => {
            const next = { ...prev };
            activeIds.forEach(id => {
               const walletObj = wallets.find((w: any) => w.id === id);
               const currentBal = walletObj?.balance || 0;
               const diff = Math.max(0, targetBalanceGoal - currentBal);
               next[id] = { ...next[id], amount: diff };
            });
            return next;
         });
         toast.success("Montants calculés pour atteindre le solde cible !");
      }
   };

   const rebalanceMutation = useMutation({
      mutationFn: (data: any) => {
         const richNote = [
            data.note?.trim() || 'Rééquilibrage de trésorerie',
            `--- DÉTAIL DU RÉÉQUILIBRAGE ---`,
            data.user_ref ? `• Référence : ${data.user_ref}` : null,
            `• Méthode : ${data.strategy === 'CUSTOM' ? 'Manuelle' : data.strategy === 'EQUIPROPORTIONAL' ? 'Partage Équitable' : 'Seuil Cible'}`,
            `• Montant total réparti : ${formatPrice(data.total_amount)}`,
            `• Responsable : ${data.accounting_agent?.trim() || 'Responsable Trésorerie'}`
         ].filter(Boolean).join('\n');

         return apiFetch('/api/v1/finance/wallets/rebalance', {
            method: 'POST',
            body: JSON.stringify({
               from_wallet_id: data.from_wallet_id,
               targets: data.targets,
               note: richNote,
               store_id: storeId,
               strategy: data.strategy
            })
         });
      },
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['wallets'] });
         qc.invalidateQueries({ queryKey: ['transactions'] });
         toast.success('Rééquilibrage de trésorerie effectué avec succès !');
         onOpenChange(false);
         setFromWalletId('');
         setNote('');
         setUserRef('');
         setAccountingAgent('');
         setStrategy('CUSTOM');
      },
      onError: (err: any) => toast.error(err.message || 'Erreur lors du rééquilibrage'),
   });

   const handleConfirm = () => {
      if (!fromWalletId) {
         toast.error("Veuillez sélectionner le compte source.");
         return;
      }
      if (selectedTargets.length === 0) {
         toast.error("Veuillez saisir un montant pour au moins un compte destinataire.");
         return;
      }
      if (isOverdrawn) {
         toast.error("Le montant total dépasse le solde disponible sur le compte source.");
         return;
      }

      rebalanceMutation.mutate({
         from_wallet_id: fromWalletId,
         targets: selectedTargets,
         total_amount: totalAllocated,
         note,
         user_ref: userRef,
         accounting_agent: accountingAgent,
         strategy,
      });
   };

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent showCloseButton={false} className="max-w-5xl w-[98vw] p-0 border-none bg-[#F8F9FC] rounded-[32px] overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            {/* Header */}
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-8 text-white shrink-0">
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-5">
                     <div className="size-14 bg-white/10 rounded-2xl flex items-center justify-center border border-white/10">
                        <ArrowRightLeft className="size-7 text-[#00B894]" />
                     </div>
                     <div>
                        <DialogTitle className="text-2xl font-black uppercase tracking-tight leading-none font-sans">
                           Rééquilibrage de Trésorerie
                        </DialogTitle>
                        <p className="text-white/60 text-xs font-medium mt-1.5">
                           Répartissez vos liquidités entre vos différentes caisses physiques et comptes bancaires / CCP
                        </p>
                     </div>
                  </div>
                  <button onClick={() => onOpenChange(false)} className="p-3 rounded-xl bg-white/10 hover:bg-white/20 transition-all shrink-0">
                     <X className="size-5 text-white" />
                  </button>
               </div>
            </div>

            {/* Corps du formulaire */}
            <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar bg-[#F8F9FC]">
               {/* ── ÉTAPE 1 : COMPTE SOURCE ── */}
               <div className="bg-white rounded-2xl p-6 space-y-4 shadow-xs border border-slate-200/80">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                     <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                        <span className="flex items-center justify-center size-6 rounded-full bg-slate-900 text-white text-[11px] font-bold">1</span> 
                        Compte Source (D'où partent les fonds)
                     </h4>
                     {sourceWallet && (
                        <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                           Solde disponible : {formatPrice(sourceWallet.balance)}
                        </span>
                     )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                     <div className="space-y-2">
                        <label className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">
                           Sélectionner le compte de prélèvement *
                        </label>
                        <Select value={fromWalletId} onValueChange={setFromWalletId}>
                           <SelectTrigger className="h-12 border-slate-200 bg-white rounded-xl px-4 text-xs font-bold shadow-xs">
                              <SelectValue placeholder="Choisir un compte source..." />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl">
                              {wallets.map((w: any) => (
                                 <SelectItem key={w.id} value={w.id} className="font-bold text-xs py-2.5">
                                    <div className="flex items-center justify-between w-full gap-4">
                                       <span>{w.name}</span>
                                       <span className="text-slate-500 font-mono">({formatPrice(w.balance)})</span>
                                    </div>
                                 </SelectItem>
                              ))}
                           </SelectContent>
                        </Select>
                     </div>

                     <div className="space-y-2">
                        <label className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">
                           Responsable de l'opération
                        </label>
                        <Input 
                           value={accountingAgent}
                           onChange={e => setAccountingAgent(e.target.value)}
                           placeholder="Ex: Selma Azzoug (Gérant / Trésorier)"
                           className="h-12 border-slate-200 bg-white rounded-xl px-4 text-xs font-bold text-slate-800 shadow-xs"
                        />
                     </div>
                  </div>
               </div>

               {fromWalletId && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-300">
                     {/* COLONNE GAUCHE : STRATÉGIE & INFOS */}
                     <div className="lg:col-span-5 space-y-6">
                        {/* ÉTAPE 2 : STRATÉGIE */}
                        <div className="bg-white rounded-2xl p-6 space-y-4 shadow-xs border border-slate-200/80">
                           <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3">
                              <span className="flex items-center justify-center size-6 rounded-full bg-slate-900 text-white text-[11px] font-bold">2</span> 
                              Méthode de Répartition
                           </h4>

                           <div className="space-y-4">
                              <div className="space-y-2">
                                 <label className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">Mode de calcul</label>
                                 <Select value={strategy} onValueChange={(v: any) => setStrategy(v)}>
                                    <SelectTrigger className="h-12 border-slate-200 bg-white rounded-xl px-4 text-xs font-bold shadow-xs">
                                       <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl">
                                       <SelectItem value="CUSTOM" className="font-bold text-xs py-2.5">1. Saisie Libre (Montants personnalisés)</SelectItem>
                                       <SelectItem value="EQUIPROPORTIONAL" className="font-bold text-xs py-2.5">2. Partage Équitable (Division égale)</SelectItem>
                                       <SelectItem value="TARGET_BALANCE" className="font-bold text-xs py-2.5">3. Compléter un Seuil Cible (Plafond)</SelectItem>
                                    </SelectContent>
                                 </Select>
                              </div>

                              {strategy === 'EQUIPROPORTIONAL' && (
                                 <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 space-y-3">
                                    <label className="text-[11px] font-bold uppercase text-indigo-700 tracking-wider block">
                                       Montant global à diviser (DA)
                                    </label>
                                    <div className="flex gap-2">
                                       <Input 
                                          type="number" 
                                          value={totalAmountToDistribute || ''} 
                                          onChange={e => setTotalAmountToDistribute(parseFloat(e.target.value) || 0)}
                                          placeholder="Ex: 50000"
                                          className="h-11 border-indigo-200 bg-white rounded-xl px-3 text-xs font-bold text-slate-800"
                                       />
                                       <Button 
                                          type="button" 
                                          onClick={applyStrategy} 
                                          className="h-11 px-4 rounded-xl bg-[#6C5CE7] hover:bg-[#5b4cc4] text-white font-bold text-xs shrink-0"
                                       >
                                          Diviser
                                       </Button>
                                    </div>
                                    <p className="text-[11px] text-indigo-600/80 font-medium">
                                       Ce montant sera partagé équitablement entre les comptes cochés à droite.
                                    </p>
                                 </div>
                              )}

                              {strategy === 'TARGET_BALANCE' && (
                                 <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100 space-y-3">
                                    <label className="text-[11px] font-bold uppercase text-blue-700 tracking-wider block">
                                       Solde cible à atteindre par compte (DA)
                                    </label>
                                    <div className="flex gap-2">
                                       <Input 
                                          type="number" 
                                          value={targetBalanceGoal || ''} 
                                          onChange={e => setTargetBalanceGoal(parseFloat(e.target.value) || 0)}
                                          placeholder="Ex: 30000"
                                          className="h-11 border-blue-200 bg-white rounded-xl px-3 text-xs font-bold text-slate-800"
                                       />
                                       <Button 
                                          type="button" 
                                          onClick={applyStrategy} 
                                          className="h-11 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shrink-0"
                                       >
                                          Calculer
                                       </Button>
                                    </div>
                                    <p className="text-[11px] text-blue-600/80 font-medium">
                                       Verse automatiquement la différence pour que chaque compte coché atteigne ce montant.
                                    </p>
                                 </div>
                              )}

                              {strategy === 'CUSTOM' && (
                                 <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 text-xs text-slate-600 font-medium leading-relaxed">
                                    Cochez les comptes cibles à droite et saisissez directement le montant souhaité pour chacun.
                                 </div>
                              )}
                           </div>
                        </div>

                        {/* ÉTAPE 3 : MOTIF & RÉFÉRENCE */}
                        <div className="bg-white rounded-2xl p-6 space-y-4 shadow-xs border border-slate-200/80">
                           <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3">
                              <span className="flex items-center justify-center size-6 rounded-full bg-slate-900 text-white text-[11px] font-bold">3</span> 
                              Motif & Justificatif
                           </h4>
                           <div className="space-y-4">
                              <div className="space-y-2">
                                 <label className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">
                                    Référence / N° de pièce (optionnel)
                                 </label>
                                 <Input 
                                    value={userRef} 
                                    onChange={e => setUserRef(e.target.value)}
                                    placeholder="Ex: REBAL-20260828, VIR-001"
                                    className="h-11 border-slate-200 bg-white rounded-xl px-4 text-xs font-bold text-slate-800"
                                 />
                              </div>
                              <div className="space-y-2">
                                 <label className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">
                                    Motif de l'opération
                                 </label>
                                 <Input 
                                    value={note} 
                                    onChange={e => setNote(e.target.value)}
                                    placeholder="Ex: Alimentation caisse dépenses & CCP"
                                    className="h-11 border-slate-200 bg-white rounded-xl px-4 text-xs font-bold text-slate-800"
                                 />
                              </div>
                           </div>
                        </div>
                     </div>

                     {/* COLONNE DROITE : DESTINATAIRES */}
                     <div className="lg:col-span-7 bg-white rounded-2xl p-6 shadow-xs border border-slate-200/80 flex flex-col min-h-[480px]">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                           <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                              <span className="flex items-center justify-center size-6 rounded-full bg-slate-900 text-white text-[11px] font-bold">4</span> 
                              Comptes Destinataires (Vers où va l'argent)
                           </h4>
                           <span className="text-[11px] font-bold text-slate-400">
                              {selectedTargets.length} compte{selectedTargets.length > 1 ? 's' : ''} sélectionné{selectedTargets.length > 1 ? 's' : ''}
                           </span>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
                           {eligibleTargets.map((w: any) => {
                              const item = targetsState[w.id] || { enabled: false, amount: 0 };
                              const newBalance = w.balance + (item.enabled ? item.amount : 0);
                              
                              return (
                                 <div key={w.id} className={cn(
                                    "p-4 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3",
                                    item.enabled ? "border-[#6C5CE7] bg-indigo-50/20" : "border-slate-200/80 bg-white hover:border-slate-300"
                                 )}>
                                    <div className="flex items-center gap-3.5">
                                       <input 
                                          type="checkbox" 
                                          checked={item.enabled}
                                          onChange={e => setTargetsState(p => ({ 
                                             ...p, 
                                             [w.id]: { enabled: e.target.checked, amount: e.target.checked ? item.amount : 0 } 
                                          }))}
                                          className="size-5 text-[#6C5CE7] focus:ring-[#6C5CE7] rounded cursor-pointer border-slate-300"
                                       />
                                       <div>
                                          <p className="text-xs font-bold text-slate-900 mb-0.5">{w.name}</p>
                                          <div className="flex items-center gap-2 text-[11px]">
                                             <span className="text-slate-400 font-medium">Solde actuel : {formatPrice(w.balance)}</span>
                                             {item.enabled && item.amount > 0 && (
                                                <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                                   → Estimé : {formatPrice(newBalance)}
                                                </span>
                                             )}
                                          </div>
                                       </div>
                                    </div>
                                    
                                    {item.enabled && (
                                       <div className="relative w-full sm:w-44 shrink-0">
                                          <Input 
                                             type="number" 
                                             min={0} 
                                             value={item.amount || ''}
                                             onChange={e => setTargetsState(p => ({ 
                                                ...p, 
                                                [w.id]: { ...p[w.id], amount: parseFloat(e.target.value) || 0 } 
                                             }))}
                                             placeholder="Montant à verser"
                                             className="h-10 border-slate-200 bg-white rounded-xl px-3 text-xs font-bold text-slate-900 text-right focus:border-[#6C5CE7]"
                                          />
                                       </div>
                                    )}
                                 </div>
                              );
                           })}
                        </div>

                        {isOverdrawn && (
                           <div className="mt-4 p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-bold flex items-center gap-3">
                              <AlertCircle className="size-5 shrink-0 text-rose-600" />
                              <span>
                                 Le total à prélever ({formatPrice(totalAllocated)}) dépasse le solde disponible ({formatPrice(sourceWallet?.balance)}).
                              </span>
                           </div>
                        )}
                     </div>
                  </div>
               )}
            </div>

            {/* Footer Récapitulatif */}
            <DialogFooter className="p-6 bg-white border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
               <div className="flex items-center gap-6 w-full sm:w-auto">
                  <div className="flex flex-col">
                     <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total à Prélever</span>
                     <p className={cn("text-2xl font-black tabular-nums tracking-tight", isOverdrawn ? "text-rose-600" : "text-slate-900")}>
                        -{formatPrice(totalAllocated)}
                     </p>
                  </div>
                  {sourceWallet && !isOverdrawn && totalAllocated > 0 && (
                     <div className="hidden sm:flex flex-col border-l border-slate-200 pl-6">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nouveau Solde Restant</span>
                        <p className="text-xl font-black text-emerald-600 tabular-nums tracking-tight">
                           {formatPrice(sourceWallet.balance - totalAllocated)}
                        </p>
                     </div>
                  )}
               </div>

               <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  <Button 
                     type="button" 
                     onClick={() => onOpenChange(false)} 
                     variant="outline" 
                     className="h-11 px-5 rounded-xl border-slate-200 text-xs font-bold text-slate-700"
                  >
                     Annuler
                  </Button>
                  <Button 
                     type="button" 
                     onClick={handleConfirm}
                     disabled={rebalanceMutation.isPending || !fromWalletId || selectedTargets.length === 0 || isOverdrawn}
                     className="h-11 px-6 rounded-xl bg-[#00B894] hover:bg-[#00a382] text-white text-xs font-bold shadow-md shadow-emerald-100"
                  >
                     {rebalanceMutation.isPending ? 'En cours...' : 'Valider le Rééquilibrage'}
                  </Button>
               </div>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}


function CreateTransactionModal({ open, onOpenChange, wallets, storeId }: any) {
   const qc = useQueryClient();
   const [formData, setFormData] = useState({
      type: 'payment',
      wallet_id: '',
      amount: 0,
      category: 'SALE',
      reference: '',
      beneficiary: '',
      description: '',
      transaction_date: new Date().toISOString().split('T')[0]
   });

   const [tvaRate, setTvaRate] = useState('0');
   const [paymentMethod, setPaymentMethod] = useState('cash');
   const [issuingBank, setIssuingBank] = useState('');
   const [reconStatus, setReconStatus] = useState('pending');
   const [accountingAgent, setAccountingAgent] = useState('');
   const [selectedCampaignId, setSelectedCampaignId] = useState('');

   const marketingQuery = useQuery({
      queryKey: ['marketing-expenses', storeId],
      queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/expenses?store_id=${storeId}&category=MARKETING`),
      enabled: formData.type === 'charge' && formData.category === 'MARKETING' && !!storeId,
   });
   const marketingCampaigns = marketingQuery.data?.data || [];

   const totalAmount = formData.amount || 0;
   const tvaPct = parseFloat(tvaRate) || 0;
   const htAmount = Math.round(totalAmount / (1 + tvaPct / 100));
   const tvaAmount = totalAmount - htAmount;

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
            type: 'payment',
            wallet_id: '',
            amount: 0,
            category: 'SALE',
            reference: '',
            beneficiary: '',
            description: '',
            transaction_date: new Date().toISOString().split('T')[0]
         });
         setTvaRate('0');
         setPaymentMethod('cash');
         setIssuingBank('');
         setReconStatus('pending');
         setAccountingAgent('');
         setSelectedCampaignId('');
      },
      onError: (err: any) => toast.error(err.message || 'Erreur lors de l’opération')
   });

   const categoriesByType: Record<string, string[]> = {
      payment: ['SALE', 'REFUND_CANCELLATION', 'INVESTMENT', 'OTHER'],
      disbursement: ['WITHDRAWAL', 'TRANSFER', 'SUPPLIER_PAYMENT', 'SALARY', 'OTHER'],
      charge: ['MARKETING', 'LOGISTICS', 'RENT', 'TAX', 'OTHER'],
   };

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent showCloseButton={false} className="max-w-4xl w-[95vw] p-0 border-none bg-white rounded-[32px] overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            <div className="bg-[#2D3436] p-8 text-white shrink-0 border-b border-slate-800">
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-5">
                     <div className="size-14 bg-slate-800 rounded-2xl flex items-center justify-center border border-slate-700">
                        <CreditCard className="size-7 text-slate-300" />
                     </div>
                     <div>
                        <DialogTitle className="text-xl font-black uppercase tracking-tight leading-none">Enregistrer une opération</DialogTitle>
                        <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mt-1.5 flex items-center gap-1.5">
                           <ShieldCheck className="size-3.5 text-slate-400" /> Ajouter une entrée ou sortie d'argent manuellement
                        </p>
                     </div>
                  </div>
                  <button onClick={() => onOpenChange(false)} className="p-2.5 rounded-xl hover:bg-white/10 transition-all shrink-0">
                     <X className="size-5 text-white/50" />
                  </button>
               </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
               
               <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100 flex gap-4">
                  <Info className="size-6 text-blue-500 shrink-0" />
                  <div>
                     <p className="text-sm font-bold text-blue-900 mb-1">À quoi sert cette opération ?</p>
                     <p className="text-xs text-blue-700 leading-relaxed font-medium">
                        Enregistrez ici vos entrées d'argent (ventes, investissements) ou vos sorties d'argent (achats, salaires, loyer). 
                        Cela permet de maintenir les soldes de vos comptes à jour et d'avoir une gestion précise, sans avoir besoin d'être un expert comptable.
                     </p>
                  </div>
               </div>

               {/* ── SECTION 1 : FLUX & COMPTE ── */}
               <div className="bg-slate-50 border border-slate-100 rounded-3xl p-6 space-y-6">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">1. Qu'est-ce qui s'est passé ?</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Type d'opération *</label>
                        <div className="flex p-1 bg-white rounded-xl border border-slate-100">
                           {(['payment', 'disbursement', 'charge'] as const).map((t) => (
                              <button
                                 key={t}
                                 type="button"
                                 onClick={() => setFormData({ ...formData, type: t, category: categoriesByType[t][0] })}
                                 className={cn(
                                    "flex-1 h-10 rounded-lg text-[10px] font-black uppercase tracking-tight transition-all",
                                    formData.type === t ? "bg-slate-800 text-white shadow-sm" : "text-slate-400 hover:text-slate-600"
                                 )}
                              >
                                 {t === 'payment' ? 'Entrée' : t === 'disbursement' ? 'Sortie' : 'Charge'}
                              </button>
                           ))}
                        </div>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Sélectionnez le compte concerné *</label>
                        <Select value={formData.wallet_id} onValueChange={v => setFormData({ ...formData, wallet_id: v })}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold">
                              <SelectValue placeholder="Sélectionner un compte" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl">
                              {wallets.map((w: any) => (
                                 <SelectItem key={w.id} value={w.id} className="font-bold text-xs">{w.name} ({formatPrice(w.balance)} DA)</SelectItem>
                              ))}
                           </SelectContent>
                        </Select>
                     </div>
                  </div>
               </div>

               {/* ── SECTION 2 : DETAILS DE TRANSACTION ── */}
               <div className="bg-slate-50 border border-slate-100 rounded-3xl p-6 space-y-6">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">2. Montant et date</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Montant de l'opération (DA) *</label>
                        <div className="relative">
                           <Input
                              type="number"
                              value={formData.amount || ''} 
                              onChange={e => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                              className="h-12 border-slate-100 bg-white rounded-xl pl-10 pr-12 text-sm font-black text-slate-800"
                           />
                           <Banknote className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                           <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300">DA</span>
                        </div>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Date de Valeur</label>
                        <div className="relative">
                           <Input
                              type="date"
                              value={formData.transaction_date} 
                              onChange={e => setFormData({ ...formData, transaction_date: e.target.value })}
                              className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold text-slate-700"
                           />
                           <Clock className="absolute right-4 top-1/2 -translate-y-1/2 size-4 text-slate-300 pointer-events-none" />
                        </div>
                     </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Taux de TVA (%)</label>
                        <Select value={tvaRate} onValueChange={setTvaRate}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold">
                              <SelectValue placeholder="TVA" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl">
                              <SelectItem value="0" className="font-bold text-xs">0% (Exonéré)</SelectItem>
                              <SelectItem value="9" className="font-bold text-xs">9% (Taux réduit)</SelectItem>
                              <SelectItem value="19" className="font-bold text-xs">19% (Taux standard)</SelectItem>
                           </SelectContent>
                        </Select>
                     </div>
                     
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Part HT (Hors Taxe)</label>
                        <div className="h-12 border border-slate-100 bg-slate-200/50 rounded-xl px-4 flex items-center justify-between text-xs font-black text-slate-600">
                           <span>{formatPrice(htAmount)}</span>
                           <span className="text-[9px] text-slate-400">DA</span>
                        </div>
                     </div>

                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Montant TVA</label>
                        <div className="h-12 border border-slate-100 bg-slate-200/50 rounded-xl px-4 flex items-center justify-between text-xs font-black text-[#6C5CE7]">
                           <span>{formatPrice(tvaAmount)}</span>
                           <span className="text-[9px] text-slate-400">DA</span>
                        </div>
                     </div>
                  </div>
               </div>

               {/* ── SECTION 3 : REGLEMENT & TRAÇABILITÉ ── */}
               <div className="bg-slate-50 border border-slate-100 rounded-3xl p-6 space-y-6">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">3. Comment ça a été payé ?</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Moyen de paiement utilisé</label>
                        <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold uppercase">
                              <SelectValue placeholder="Règlement" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl">
                              <SelectItem value="cash" className="font-bold text-xs">ESPÈCES (CASH)</SelectItem>
                              <SelectItem value="transfer" className="font-bold text-xs">VIREMENT BANCAIRE</SelectItem>
                              <SelectItem value="check" className="font-bold text-xs">CHÈQUE</SelectItem>
                              <SelectItem value="card" className="font-bold text-xs">CARTE BANCAIRE</SelectItem>
                              <SelectItem value="cod" className="font-bold text-xs">CONTRE REMBOURSEMENT (COD)</SelectItem>
                           </SelectContent>
                        </Select>
                     </div>

                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Établissement Bancaire / Source</label>
                        <Input
                           value={issuingBank}
                           onChange={e => setIssuingBank(e.target.value)}
                           placeholder="Ex: Al Baraka, BNA, CCP..."
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold"
                        />
                      </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Statut du Rapprochement</label>
                        <Select value={reconStatus} onValueChange={setReconStatus}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold uppercase">
                              <SelectValue placeholder="Rapprochement" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl">
                              <SelectItem value="pending" className="font-bold text-xs">EN ATTENTE</SelectItem>
                              <SelectItem value="reconciled" className="font-bold text-xs">RAPPROCHÉ / PAYÉ</SelectItem>
                              <SelectItem value="dispute" className="font-bold text-xs">EN LITIGE</SelectItem>
                           </SelectContent>
                        </Select>
                     </div>

                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Agent Comptable Responsable</label>
                        <Input
                           value={accountingAgent}
                           onChange={e => setAccountingAgent(e.target.value)}
                           placeholder="Nom ou matricule de l'agent..."
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold"
                        />
                     </div>
                  </div>
               </div>

               {/* ── SECTION 4 : VENTILATION & PIECES COMPTABLES ── */}
               <div className="bg-slate-50 border border-slate-100 rounded-3xl p-6 space-y-6">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">4. Informations complémentaires (Optionnel)</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Catégorie de l'opération</label>
                        <Select value={formData.category} onValueChange={v => setFormData({ ...formData, category: v })}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold shadow-sm">
                              <SelectValue placeholder="Choisir une catégorie" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl">
                              {categoriesByType[formData.type].map(c => (
                                 <SelectItem key={c} value={c} className="font-bold uppercase text-xs">{c.replace(/_/g, ' ')}</SelectItem>
                              ))}
                           </SelectContent>
                        </Select>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Référence / N° Pièce</label>
                        <Input
                           value={formData.reference} 
                           onChange={e => setFormData({ ...formData, reference: e.target.value })}
                           placeholder="Ex: FAC-2026-001"
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold"
                        />
                     </div>
                  </div>

                  {formData.type === 'charge' && formData.category === 'MARKETING' && (
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-[#1877F2] tracking-widest ml-1 flex items-center gap-2">
                           Lier à une Campagne Meta Ads (Optionnel)
                        </label>
                        <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                           <SelectTrigger className="h-12 border-blue-100 bg-blue-50/50 rounded-xl px-4 text-xs font-bold text-blue-900 shadow-sm">
                              <SelectValue placeholder="Sélectionner une campagne publicitaire Meta..." />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl max-h-60">
                              <SelectItem value="none" className="font-bold text-slate-400 italic text-xs">Aucune liaison</SelectItem>
                              {marketingCampaigns.map((c: any) => (
                                 <SelectItem key={c.id} value={c.id} className="font-bold text-xs">
                                    {c.label} ({formatPrice(c.amount)} DA)
                                 </SelectItem>
                              ))}
                           </SelectContent>
                        </Select>
                     </div>
                  )}

                  <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Bénéficiaire / Donneur d'ordre</label>
                     <div className="relative">
                        <Input
                           value={formData.beneficiary} 
                           onChange={e => setFormData({ ...formData, beneficiary: e.target.value })}
                           placeholder="Nom du client, fournisseur ou employé..."
                           className="h-12 border-slate-100 bg-white rounded-xl pl-10 text-xs font-bold"
                        />
                        <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-300" />
                     </div>
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Notes & Description Additionnelle</label>
                     <textarea
                        value={formData.description} 
                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Précisions sur l'opération, motifs du versement..."
                        className="w-full min-h-[100px] p-4 rounded-xl border border-slate-100 bg-white text-xs font-medium outline-none resize-none transition-all"
                     />
                  </div>
               </div>

            </div>

            <DialogFooter className="p-8 bg-slate-50 border-t border-slate-100 flex items-center justify-between shrink-0">
               <div className="flex flex-col">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Impact Trésorerie</span>
                  <p className={cn(
                     "text-xl font-black tabular-nums tracking-tighter",
                     formData.type === 'payment' ? "text-emerald-500" : "text-rose-500"
                  )}>
                     {formData.type === 'payment' ? '+' : '-'}{formatPrice(formData.amount)} DA
                  </p>
               </div>
               <div className="flex items-center gap-3">
                  <button type="button" onClick={() => onOpenChange(false)} className="h-12 px-6 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors">Annuler</button>
                  <Button
                     onClick={() => {
                        if (!formData.wallet_id) {
                           toast.error("Le compte de trésorerie est requis");
                           return;
                        }
                        if (formData.amount <= 0) {
                           toast.error("Le montant doit être supérieur à 0");
                           return;
                        }

                        const amount = formData.amount;
                        const tvaPct = parseFloat(tvaRate) || 0;
                        const ht = Math.round(amount / (1 + tvaPct / 100));
                        const tva = amount - ht;

                        const detailedDescription = [
                           formData.description.trim(),
                           `--- DETAILS COMPTABLES ---`,
                           `• Mode de règlement : ${paymentMethod.toUpperCase()}${issuingBank ? ` (${issuingBank.toUpperCase()})` : ''}`,
                           `• Fiscalité : TVA ${tvaPct}% (HT: ${formatPrice(ht)} DA | TVA: ${formatPrice(tva)} DA)`,
                           `• Statut de Rapprochement : ${reconStatus.toUpperCase()}`,
                           `• Agent Responsable : ${accountingAgent.trim() || 'Système'}`
                        ].filter(Boolean).join('\n');

                        let finalDescription = detailedDescription;
                        if (selectedCampaignId && selectedCampaignId !== 'none') {
                           const campaign = marketingCampaigns.find((c: any) => c.id === selectedCampaignId);
                           if (campaign) {
                              finalDescription += `\n--- LIAISON META ADS ---\n• Campagne: ${campaign.label}\n• ID Dépense: ${campaign.id}`;
                           }
                        }

                        createTx.mutate({
                           ...formData,
                           description: finalDescription
                        });
                     }}
                     disabled={createTx.isPending}
                     className="h-12 px-8 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-black uppercase tracking-widest transition-all"
                  >
                     {createTx.isPending ? <Loader2 className="size-4 animate-spin" /> : "VALIDER L'ÉCRITURE ✓"}
                  </Button>
               </div>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}




function TransactionDetailModal({
   transaction,
   open,
   onClose,
}: {
   transaction: any | null;
   open: boolean;
   onClose: () => void;
}) {
   const [copied, setCopied] = useState(false);

   if (!transaction) return null;

   const isPayment = transaction.type === 'payment';
   const isDisbursement = transaction.type === 'disbursement';
   const isTransfer = transaction.type === 'transfer';
   const txDateStr = transaction.transaction_date || transaction.created_at;
   const txDate = txDateStr ? new Date(txDateStr) : null;
   const formattedDate = txDate && !isNaN(txDate.getTime()) && txDate.getFullYear() > 1970
      ? txDate.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
      : 'Récemment enregistré';
   const formattedTime = txDate && !isNaN(txDate.getTime()) && txDate.getFullYear() > 1970
      ? txDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : '—';

   const handleCopyRef = () => {
      if (transaction?.reference) {
         navigator.clipboard.writeText(transaction.reference);
         setCopied(true);
         toast.success('Référence copiée !');
         setTimeout(() => setCopied(false), 2000);
      }
   };

   const handlePrint = () => {
      window.print();
   };

   const effectiveCategory = transaction.category || (isPayment ? 'VENTE_COD' : 'DÉCAISSEMENT');
   const effectiveBeneficiary = transaction.beneficiary || (transaction.reference?.startsWith('COD-') ? 'Client COD' : (isPayment ? 'Client Acheteur' : 'Fournisseur / Prestataire'));
   const effectiveWallet = transaction.wallet?.name || (isPayment ? 'Caisse Principale (COD)' : 'Compte Courant');

   return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
         <DialogContent className="max-w-xl rounded-[2rem] p-0 gap-0 border border-slate-200 shadow-2xl overflow-hidden bg-white print:m-0 print:p-0 print:border-none print:shadow-none">
            {/* ── Entête Pièce Justificative ── */}
            <div className={cn(
               "p-7 text-white relative",
               isPayment 
                  ? "bg-[#00B894]" 
                  : isTransfer
                     ? "bg-[#6C5CE7]"
                     : "bg-[#2D3436]"
            )}>
               <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-lg bg-white/20 text-white">
                     {isPayment ? 'Bon d'Encaissement (Vente)' : isTransfer ? 'Bon de Transfert Inter-Caisse' : 'Bon de Décaissement (Dépense)'}
                  </span>
                  <button 
                     onClick={handleCopyRef}
                     className="text-xs font-mono font-bold px-3 py-1 rounded-lg bg-white/15 hover:bg-white/25 transition-all flex items-center gap-1.5 text-white"
                     title="Copier la référence"
                  >
                     <span>{transaction.reference || 'SYSTEM-TX'}</span>
                     {copied ? <CheckCircle2 className="size-3 text-emerald-200" /> : <Receipt className="size-3" />}
                  </button>
               </div>

               <div className="flex items-baseline justify-between mt-1">
                  <div>
                     <p className="text-[10px] font-bold text-white/75 uppercase tracking-wider">Montant de l'opération</p>
                     <p className="text-3xl font-black tabular-nums tracking-tight mt-0.5">
                        {isPayment ? '+' : '-'}{formatPrice(transaction.amount)}
                     </p>
                  </div>
                  <div className="text-right">
                     <span className="inline-block px-3 py-1 rounded-lg bg-white/20 text-xs font-bold uppercase tracking-wider">
                        {effectiveCategory.replace(/_/g, ' ')}
                     </span>
                  </div>
               </div>
            </div>

            {/* ── Détails & Informations de la Transaction ── */}
            <div className="p-7 space-y-5 bg-white max-h-[65vh] overflow-y-auto">
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Référence Flux */}
                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-0.5">
                     <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Référence de la pièce
                     </span>
                     <p className="text-xs font-bold font-mono text-slate-800 break-all">{transaction.reference || 'SYSTEM-TX'}</p>
                  </div>

                  {/* Catégorie */}
                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-0.5">
                     <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Catégorie
                     </span>
                     <p className="text-xs font-bold text-slate-800 uppercase">{effectiveCategory.replace(/_/g, ' ')}</p>
                  </div>

                  {/* Bénéficiaire */}
                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-0.5">
                     <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Bénéficiaire / Client
                     </span>
                     <p className="text-xs font-bold text-slate-800 truncate" title={effectiveBeneficiary}>{effectiveBeneficiary}</p>
                  </div>

                  {/* Compte Source / Cible */}
                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-0.5">
                     <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Compte / Caisse rattaché
                     </span>
                     <p className="text-xs font-bold text-slate-800 truncate">{effectiveWallet}</p>
                  </div>
               </div>

               {/* Horodatage */}
               <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                     <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Date & Heure d'enregistrement
                     </span>
                     <span className="text-[10px] font-bold text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                        GMT+1 (Algérie)
                     </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                     <div>
                        <span className="text-[10px] text-slate-400 block font-medium">Date</span>
                        <span className="font-bold text-slate-800 capitalize">{formattedDate}</span>
                     </div>
                     <div>
                        <span className="text-[10px] text-slate-400 block font-medium">Heure</span>
                        <span className="font-bold text-slate-800 font-mono">{formattedTime}</span>
                     </div>
                  </div>
               </div>

               {/* Motif / Description */}
               {transaction.description && (
                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-1">
                     <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Libellé de l'opération
                     </span>
                     <p className="text-xs font-medium text-slate-700 leading-relaxed">
                        {transaction.description}
                     </p>
                  </div>
               )}
            </div>

            {/* ── Actions ── */}
            <div className="px-7 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3 print:hidden">
               <button
                  onClick={handleCopyRef}
                  className="h-10 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all flex items-center gap-1.5"
               >
                  <Receipt className="size-3.5 text-slate-400" /> Copier Référence
               </button>

               <div className="flex items-center gap-2">
                  <button
                     onClick={handlePrint}
                     className="h-10 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all flex items-center gap-1.5"
                  >
                     <Banknote className="size-3.5 text-slate-400" /> Imprimer le Bon
                  </button>
                  <button
                     onClick={onClose}
                     className="h-10 px-5 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold transition-all"
                  >
                     Fermer
                  </button>
               </div>
            </div>
         </DialogContent>
      </Dialog>
   );
}
