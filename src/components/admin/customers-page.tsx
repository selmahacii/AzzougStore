'use client';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
   Users, Search, Plus, Phone, AlertCircle, RefreshCw, Trash2, Eye,
   Loader2, ShieldX, ShieldCheck, ShoppingBag, MapPin, Mail, DollarSign,
   ChevronLeft, ChevronRight, X, Package, Calendar, Clock, Star,
   UserPlus, Link2, Copy, Check, Tag, Hash, TrendingUp,
   UserCircle2, BadgeCheck, BadgeX, Activity, Wallet, CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useAppStore } from '@/store/app-store';
import type { Customer, CustomerSource, PaginatedResponse } from '@/lib/types';
import { formatPrice } from '@/lib/format';
import { apiFetch } from '@/lib/api-client';

// ─── Color palette ─────────────────────────────────────────────
const C = {
   primary: '#6C5CE7', primaryBg: '#F0EDFF',
   success: '#00B894', successBg: '#E6FFF8',
   danger: '#E17055', dangerBg: '#FFEDE9',
   warning: '#FDCB6E', warningBg: '#FFF8E6',
   info: '#0984E3', infoBg: '#E8F4FE',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

// ─── Constants ─────────────────────────────────────────────────
const WILAYAS = [
   'Adrar','Chlef','Laghouat','Oum El Bouaghi','Batna','Béjaïa','Biskra','Béchar','Blida','Bouira',
   'Tamanrasset','Tébessa','Tlemcen','Tiaret','Tizi Ouzou','Alger','Djelfa','Jijel','Sétif','Saïda',
   'Skikda','Sidi Bel Abbès','Annaba','Guelma','Constantine','Médéa','Mostaganem','M\'sila','Mascara',
   'Ouargla','Oran','El Bayadh','Illizi','Bordj Bou Arréridj','Boumerdès','El Tarf','Tindouf',
   'Tissemsilt','El Oued','Khenchela','Souk Ahras','Tipaza','Mila','Aïn Defla','Naâma',
   'Aïn Témouchent','Ghardaïa','Relizane','Timimoun','Bordj Badji Mokhtar','Ouled Djellal',
   'Béni Abbès','In Salah','In Guezzam','Touggourt','Djanet','El M\'Ghair','El Meniaa',
];

const TIER_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
   BRONZE: { label: 'Bronze', color: '#CD7F32', bg: '#FDF3E7', icon: '🥉' },
   SILVER: { label: 'Silver', color: '#A0A0A0', bg: '#F5F5F5', icon: '🥈' },
   GOLD: { label: 'Gold', color: '#FFD700', bg: '#FFFDE7', icon: '🥇' },
   PLATINUM: { label: 'Platinum', color: '#6C5CE7', bg: '#F0EDFF', icon: '💎' },
   DIAMOND: { label: 'Diamond', color: '#0984E3', bg: '#E8F4FE', icon: '💠' },
};

const SOURCE_CONFIG: Record<CustomerSource, { label: string; color: string; bg: string; icon: React.ElementType; desc: string }> = {
   MANUAL:  { label: 'Ajouté',   color: '#6C5CE7', bg: '#F0EDFF', icon: UserPlus, desc: 'Créé manuellement par l\'admin' },
   INVITED: { label: 'Invité',   color: '#FDCB6E', bg: '#FFF8E6', icon: Link2,    desc: 'Inscrit via lien d\'invitation' },
   ACCOUNT: { label: 'Compte',   color: '#00B894', bg: '#E6FFF8', icon: Users,    desc: 'Compte créé sur la boutique' },
   ORDER:   { label: 'Commande', color: '#0984E3', bg: '#E8F4FE', icon: ShoppingBag, desc: 'Généré automatiquement via commande' },
};

// ─── Small helpers ─────────────────────────────────────────────
function TierBadge({ tier }: { tier?: string }) {
   const t = TIER_CONFIG[tier || 'BRONZE'] ?? TIER_CONFIG.BRONZE;
   return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black" style={{ color: t.color, backgroundColor: t.bg }}>
         {t.icon} {t.label}
      </span>
   );
}

function SourceBadge({ source }: { source?: CustomerSource | null }) {
   const s = SOURCE_CONFIG[source ?? 'MANUAL'] ?? SOURCE_CONFIG.MANUAL;
   const Icon = s.icon;
   return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black" style={{ color: s.color, backgroundColor: s.bg }}>
         <Icon className="size-2.5" /> {s.label}
      </span>
   );
}

function fmtDate(d?: string | null, short = false) {
   if (!d) return '—';
   return new Date(d).toLocaleDateString('fr-FR', short
      ? { day: '2-digit', month: 'short' }
      : { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateFull(d?: string | null) {
   if (!d) return '—';
   return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Pagination ────────────────────────────────────────────────
function TablePagination({ total, page, totalPages, onPageChange }: { total: number; page: number; totalPages: number; onPageChange: (p: number) => void }) {
   return (
      <div className="px-4 sm:px-8 py-4 sm:py-5 flex flex-col sm:flex-row items-center gap-3 sm:justify-between border-t" style={{ borderColor: C.border }}>
         <span className="text-xs font-bold text-slate-400">Total <span className="font-black text-slate-700">{total}</span> clients</span>
         <div className="flex gap-2">
            <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1} className="p-2.5 rounded-xl border border-slate-100 bg-white hover:bg-slate-50 disabled:opacity-30 transition-all">
               <ChevronLeft className="size-5 text-slate-600" />
            </button>
            <span className="h-10 px-4 rounded-xl border bg-white flex items-center text-xs font-black text-slate-600">{page} / {totalPages || 1}</span>
            <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="p-2.5 rounded-xl border border-slate-100 bg-white hover:bg-slate-50 disabled:opacity-30 transition-all">
               <ChevronRight className="size-5 text-slate-600" />
            </button>
         </div>
      </div>
   );
}

// ─── Customer Detail Modal ─────────────────────────────────────
function CustomerDetailModal({ customer, open, onClose, onBlacklist, storeId }: {
   customer: Customer | null; open: boolean; onClose: () => void;
   onBlacklist: (id: string, note?: string) => void; storeId: string;
}) {
   const [blacklistNote, setBlacklistNote] = useState('');
   const [showBlacklistConfirm, setShowBlacklistConfirm] = useState(false);
   const qc = useQueryClient();

   const ordersQuery = useQuery({
      queryKey: ['customer-orders', customer?.id],
      queryFn: () => apiFetch<any>(`/api/v1/customers/${customer!.id}/orders`),
      enabled: !!customer?.id && open,
   });

   const accountQuery = useQuery({
      queryKey: ['customer-account', customer?.id],
      queryFn: () => apiFetch<any>(`/api/v1/customers/${customer!.id}/account`),
      enabled: !!customer?.id && open,
   });
   const account = (accountQuery.data as any)?.account ?? null;
   const hasAccount = !!(accountQuery.data as any)?.has_account;

   const updateNoteMutation = useMutation({
      mutationFn: ({ id, note }: { id: string; note: string }) =>
         apiFetch(`/api/v1/customers/${id}`, { method: 'PATCH', body: JSON.stringify({ note }) }),
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); toast.success('Note mise à jour'); },
   });

   const [editNote, setEditNote] = useState('');
   const [editingNote, setEditingNote] = useState(false);

   React.useEffect(() => {
      if (customer) { setEditNote(customer.note ?? ''); setEditingNote(false); setShowBlacklistConfirm(false); setBlacklistNote(''); }
   }, [customer]);

   const orders = Array.isArray(ordersQuery.data) ? ordersQuery.data : (ordersQuery.data as any)?.data ?? [];

   if (!customer) return null;

   const sourceInfo = SOURCE_CONFIG[customer.source ?? 'MANUAL'] ?? SOURCE_CONFIG.MANUAL;
   const SourceIcon = sourceInfo.icon;
   const tier = TIER_CONFIG[customer.tier ?? 'BRONZE'] ?? TIER_CONFIG.BRONZE;

   return (
      <Dialog open={open} onOpenChange={onClose}>
         <DialogContent className="max-w-3xl w-[96vw] p-0 border-none rounded-[40px] overflow-hidden shadow-2xl max-h-[94vh] flex flex-col">
            <DialogTitle className="sr-only">Fiche client</DialogTitle>

            {/* Header gradient */}
            <div className={cn("p-8 text-white shrink-0", customer.is_blacklisted ? "bg-gradient-to-br from-rose-600 to-rose-400" : "bg-gradient-to-br from-[#6C5CE7] to-[#a29bfe]")}>
               <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-5">
                     <div className="size-20 rounded-3xl bg-white/20 flex items-center justify-center font-black text-4xl shrink-0">
                        {customer.name.charAt(0).toUpperCase()}
                     </div>
                     <div>
                        <div className="flex items-center gap-3 mb-2">
                           <h2 className="text-2xl font-black tracking-tight">{customer.name}</h2>
                           {customer.is_guest && <span className="text-[9px] font-black bg-sky-100 text-sky-700 border border-sky-200 px-3 py-1 rounded-full uppercase tracking-wider">👁 Visiteur</span>}
                           {customer.is_blacklisted && <span className="text-[9px] font-black bg-white/20 px-3 py-1 rounded-full uppercase tracking-wider">🚫 Blacklisté</span>}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                           <TierBadge tier={customer.tier} />
                           {/* Source badge in detail */}
                           <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black bg-white/20 text-white">
                              <SourceIcon className="size-3" /> {sourceInfo.label} · {sourceInfo.desc}
                           </span>
                        </div>
                        <p className="text-white/40 text-[10px] font-mono mt-2">UID: {customer.id.substring(0, 16)}...</p>
                     </div>
                  </div>
                  <button onClick={onClose} className="size-9 rounded-xl bg-white/20 flex items-center justify-center hover:bg-white/30 transition-all">
                     <X className="size-4" />
                  </button>
               </div>

               {/* KPI strip */}
               <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                     { label: 'Commandes', value: customer.total_orders, icon: <ShoppingBag className="size-4" /> },
                     { label: 'Total dépensé', value: `${formatPrice(customer.total_spent)} DA`, icon: <DollarSign className="size-4" /> },
                     { label: 'Retours', value: customer.total_returned ?? 0, icon: <Package className="size-4" /> },
                     { label: 'Client depuis', value: fmtDate(customer.created_at, true), icon: <Calendar className="size-4" /> },
                  ].map((kpi, i) => (
                     <div key={i} className="bg-white/10 rounded-2xl p-3 backdrop-blur-sm">
                        <div className="flex items-center gap-1.5 mb-1.5 text-white/60">{kpi.icon}<span className="text-[9px] font-black uppercase tracking-widest">{kpi.label}</span></div>
                        <p className="text-base font-black leading-tight">{kpi.value}</p>
                     </div>
                  ))}
               </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto bg-white">
               <div className="p-8 space-y-6">

                  {/* Timestamps & metadata */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                     {[
                        { label: 'Inscrit le', value: fmtDateFull(customer.created_at), icon: <Calendar className="size-3.5 text-[#6C5CE7]" /> },
                        { label: 'Dernière commande', value: fmtDateFull(customer.last_order_at), icon: <Clock className="size-3.5 text-[#00B894]" /> },
                        { label: 'Score RFM', value: customer.rfm_score ?? '—', icon: <TrendingUp className="size-3.5 text-[#FDCB6E]" /> },
                     ].map((item, i) => (
                        <div key={i} className="p-3 rounded-2xl bg-slate-50 border border-slate-100 flex items-start gap-2">
                           <div className="mt-0.5">{item.icon}</div>
                           <div>
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">{item.label}</p>
                              <p className="text-xs font-bold text-slate-700 mt-0.5">{item.value}</p>
                           </div>
                        </div>
                     ))}
                  </div>

                  {/* Tags */}
                  {customer.tags && customer.tags.length > 0 && (
                     <div className="flex items-center gap-2 flex-wrap">
                        <Tag className="size-3.5 text-slate-300" />
                        {customer.tags.map(tag => (
                           <span key={tag} className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#F0EDFF] text-[#6C5CE7]">{tag}</span>
                        ))}
                     </div>
                  )}

                  {/* Contact info */}
                  <div>
                     <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3">Coordonnées</h3>
                     <div className="grid grid-cols-2 gap-3">
                        {[
                           { icon: <Phone className="size-4" />, label: 'Téléphone principal', value: customer.phone },
                           { icon: <Phone className="size-4" />, label: 'Tél. secondaire', value: customer.secondary_phone || '—' },
                           { icon: <Mail className="size-4" />, label: 'Email', value: customer.email || '—' },
                           { icon: <MapPin className="size-4" />, label: 'Wilaya', value: customer.wilaya || '—' },
                        ].map((item, i) => (
                           <div key={i} className="flex items-start gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                              <div className="size-8 rounded-xl bg-[#F0EDFF] flex items-center justify-center text-[#6C5CE7] shrink-0">{item.icon}</div>
                              <div className="min-w-0">
                                 <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{item.label}</p>
                                 <p className="text-sm font-bold text-slate-800 mt-0.5 truncate">{item.value}</p>
                              </div>
                           </div>
                        ))}
                     </div>
                     {customer.address && (
                        <div className="mt-3 flex items-start gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                           <div className="size-8 rounded-xl bg-[#F0EDFF] flex items-center justify-center text-[#6C5CE7] shrink-0"><MapPin className="size-4" /></div>
                           <div>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Adresse</p>
                              <p className="text-sm font-bold text-slate-800 mt-0.5">{customer.address}</p>
                           </div>
                        </div>
                     )}
                  </div>

                  {/* Note interne */}
                  <div>
                     <div className="flex items-center justify-between mb-3">
                        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Note interne</h3>
                        {!editingNote && (
                           <button onClick={() => setEditingNote(true)} className="text-[10px] font-black text-[#6C5CE7] hover:underline">Modifier</button>
                        )}
                     </div>
                     {editingNote ? (
                        <div className="space-y-2">
                           <textarea
                              value={editNote}
                              onChange={e => setEditNote(e.target.value)}
                              rows={3}
                              className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium resize-none focus:outline-none focus:border-[#6C5CE7]"
                              placeholder="Observations, préférences..."
                           />
                           <div className="flex gap-2">
                              <button onClick={() => setEditingNote(false)} className="flex-1 py-2 rounded-xl border border-slate-200 text-slate-500 font-bold text-xs">Annuler</button>
                              <button onClick={() => { updateNoteMutation.mutate({ id: customer.id, note: editNote }); setEditingNote(false); }}
                                 className="flex-[2] py-2 rounded-xl bg-[#6C5CE7] text-white font-black text-xs">Enregistrer</button>
                           </div>
                        </div>
                     ) : (
                        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 min-h-[56px]">
                           <p className="text-sm font-medium text-slate-600">{customer.note || <span className="text-slate-300 italic">Aucune note</span>}</p>
                        </div>
                     )}
                  </div>

                  {/* Blacklist note */}
                  {customer.blacklist_note && (
                     <div className="p-4 rounded-2xl bg-rose-50 border border-rose-100">
                        <p className="text-[10px] font-black text-rose-500 uppercase tracking-wider mb-1">🚫 Motif de liste noire</p>
                        <p className="text-sm font-medium text-rose-600">{customer.blacklist_note}</p>
                     </div>
                  )}

                  {/* ─── Compte Client Portal ─── */}
                  <div>
                     <div className="flex items-center justify-between mb-3">
                        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                           <UserCircle2 className="size-3.5" /> Compte Portail Client
                        </h3>
                        {!accountQuery.isLoading && (
                           hasAccount
                             ? <span className="inline-flex items-center gap-1 text-[9px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full uppercase tracking-wider"><BadgeCheck className="size-3" /> Compte actif</span>
                             : <span className="inline-flex items-center gap-1 text-[9px] font-black text-slate-400 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full uppercase tracking-wider"><BadgeX className="size-3" /> Pas de compte</span>
                        )}
                     </div>
                     {accountQuery.isLoading ? (
                        <Skeleton className="h-24 rounded-2xl" />
                     ) : hasAccount && account ? (
                        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 overflow-hidden">
                           {/* Account header */}
                           <div className="flex items-center gap-3 p-4 border-b border-emerald-100">
                              <div className="size-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600 font-black text-lg shrink-0">
                                 {(account.name ?? '?').charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                 <p className="text-sm font-black text-slate-800 truncate">{account.name}</p>
                                 <p className="text-[10px] text-slate-400 font-medium truncate">{account.email}</p>
                              </div>
                              <div className="ml-auto text-right shrink-0">
                                 <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Membre depuis</p>
                                 <p className="text-[10px] font-bold text-slate-600">
                                    {account.created_at ? new Date(account.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                 </p>
                              </div>
                           </div>
                           {/* Account KPIs */}
                           <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-emerald-100">
                              {[
                                 { label: 'Commandes', value: account.total_orders ?? 0, icon: <ShoppingBag className="size-3.5 text-[#6C5CE7]" /> },
                                 { label: 'Livrées', value: account.delivered_orders ?? 0, icon: <CheckCircle className="size-3.5 text-emerald-500" /> },
                                 { label: 'Retours', value: account.returned_orders ?? 0, icon: <Package className="size-3.5 text-rose-400" /> },
                                 { label: 'Budget dépensé', value: `${formatPrice(account.total_spent ?? 0)} DA`, icon: <Wallet className="size-3.5 text-amber-500" /> },
                              ].map((kpi, i) => (
                                 <div key={i} className="flex flex-col items-center justify-center py-3 px-2 text-center">
                                    <div className="mb-1">{kpi.icon}</div>
                                    <p className="text-xs font-black text-slate-700 leading-tight">{kpi.value}</p>
                                    <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wider mt-0.5 leading-tight">{kpi.label}</p>
                                 </div>
                              ))}
                           </div>
                           {/* Avg order */}
                           {(account.avg_order_value ?? 0) > 0 && (
                              <div className="px-4 py-2.5 border-t border-emerald-100 flex items-center justify-between">
                                 <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1.5"><Activity className="size-3 text-[#6C5CE7]" /> Panier moyen</span>
                                 <span className="text-sm font-black text-slate-700">{formatPrice(account.avg_order_value)} DA</span>
                              </div>
                           )}
                        </div>
                     ) : (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center space-y-3">
                           <UserCircle2 className="size-8 text-slate-200 mx-auto" />
                           <div>
                              <p className="text-xs font-bold text-slate-500">Ce client n'a pas encore créé de compte portail.</p>
                              <p className="text-[10px] text-slate-400 mt-1">Il peut s'inscrire depuis la page de connexion pour suivre ses commandes.</p>
                           </div>
                        </div>
                     )}
                  </div>

                  {/* Order history */}
                  <div>
                     <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3">Historique des commandes</h3>
                     {ordersQuery.isLoading ? (
                        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
                     ) : orders.length === 0 ? (
                        <div className="text-center py-8 rounded-2xl bg-slate-50 border border-dashed border-slate-200">
                           <ShoppingBag className="size-8 text-slate-200 mx-auto mb-2" />
                           <p className="text-xs font-bold text-slate-400">Aucune commande enregistrée</p>
                        </div>
                     ) : (
                        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                           {orders.map((o: any, idx: number) => (
                              <div key={o.id ?? idx} className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 border border-slate-100 hover:border-[#6C5CE7]/20 transition-all">
                                 <div className="flex items-center gap-3">
                                    <div className="size-9 rounded-xl bg-[#F0EDFF] flex items-center justify-center text-[#6C5CE7] font-black text-[10px]">
                                       #{(o.order_number ?? o.id ?? '').slice(-4)}
                                    </div>
                                    <div>
                                       <p className="text-xs font-black text-slate-700">{o.order_number ?? o.id}</p>
                                       <p className="text-[10px] text-slate-400">{fmtDate(o.created_at)}</p>
                                    </div>
                                 </div>
                                 <div className="flex items-center gap-3">
                                    <span className={cn("text-[9px] font-black px-2.5 py-1 rounded-full uppercase", {
                                       'bg-emerald-50 text-emerald-600': o.status === 'DELIVERED',
                                       'bg-blue-50 text-blue-600': o.status === 'CONFIRMED' || o.status === 'SHIPPED',
                                       'bg-yellow-50 text-yellow-700': o.status === 'PENDING' || o.status === 'NEW',
                                       'bg-rose-50 text-rose-600': ['RETURNED', 'CANCELLED'].includes(o.status),
                                       'bg-slate-100 text-slate-500': !['DELIVERED', 'CONFIRMED', 'SHIPPED', 'PENDING', 'NEW', 'RETURNED', 'CANCELLED'].includes(o.status),
                                    })}>{o.status}</span>
                                    <span className="text-sm font-black text-slate-700">{formatPrice(o.total ?? 0)} DA</span>
                                 </div>
                              </div>
                           ))}
                        </div>
                     )}
                  </div>

                  {/* Blacklist action */}
                  {!showBlacklistConfirm ? (
                     <button
                        onClick={() => setShowBlacklistConfirm(true)}
                        className={cn("w-full py-4 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2", customer.is_blacklisted ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200" : "bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200")}
                     >
                        {customer.is_blacklisted ? <><ShieldCheck className="size-4" />Réhabiliter ce client</> : <><ShieldX className="size-4" />Mettre en liste noire</>}
                     </button>
                  ) : (
                     <div className="p-5 rounded-2xl border border-rose-200 bg-rose-50 space-y-4">
                        <p className="text-sm font-black text-rose-600">
                           {customer.is_blacklisted ? 'Confirmer la réhabilitation ?' : '⚠️ Motif de blacklist (optionnel)'}
                        </p>
                        {!customer.is_blacklisted && (
                           <textarea
                              value={blacklistNote}
                              onChange={e => setBlacklistNote(e.target.value)}
                              placeholder="Ex: Fraude détectée, chargeback, commandes non récupérées..."
                              className="w-full p-3 rounded-xl border border-rose-200 bg-white text-sm font-medium resize-none focus:outline-none focus:border-rose-300 h-20"
                           />
                        )}
                        <div className="flex gap-3">
                           <button onClick={() => setShowBlacklistConfirm(false)} className="flex-1 py-3 rounded-xl bg-white border border-rose-200 text-rose-500 font-bold text-sm">Annuler</button>
                           <button onClick={() => { onBlacklist(customer.id, blacklistNote); setShowBlacklistConfirm(false); }}
                              className="flex-[2] py-3 rounded-xl bg-rose-500 text-white font-black text-sm">Confirmer</button>
                        </div>
                     </div>
                  )}
               </div>
            </div>
         </DialogContent>
      </Dialog>
   );
}

// ─── Create Customer Modal ─────────────────────────────────────
function CreateCustomerModal({ open, onClose, storeId }: { open: boolean; onClose: () => void; storeId: string }) {
   const qc = useQueryClient();
   const [form, setForm] = useState({
      name: '', phone: '', secondary_phone: '', email: '',
      wilaya: '', address: '', note: '',
   });

   const createMutation = useMutation({
      mutationFn: (data: any) => apiFetch('/api/v1/customers', {
         method: 'POST',
         body: JSON.stringify({ ...data, store_id: storeId, source: 'MANUAL' }),
      }),
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['customers'] });
         qc.invalidateQueries({ queryKey: ['customers-stats'] });
         toast.success('Client enregistré ✓');
         onClose();
         setForm({ name: '', phone: '', secondary_phone: '', email: '', wilaya: '', address: '', note: '' });
      },
      onError: (err: any) => toast.error(err?.detail ?? err?.message ?? 'Erreur'),
   });

   return (
      <Dialog open={open} onOpenChange={onClose}>
         <DialogContent className="max-w-2xl w-[96vw] p-0 border-none rounded-[40px] overflow-hidden shadow-2xl max-h-[94vh] flex flex-col">
            <DialogTitle className="sr-only">Nouveau Client</DialogTitle>
            <div className="bg-gradient-to-br from-[#6C5CE7] to-[#a29bfe] p-8 shrink-0">
               <div className="flex items-center gap-4">
                  <div className="size-14 rounded-2xl bg-white/20 flex items-center justify-center">
                     <Users className="size-7 text-white" />
                  </div>
                  <div>
                     <h2 className="text-xl font-black text-white">Nouveau Client</h2>
                     <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] font-black bg-white/20 text-white px-2.5 py-1 rounded-full uppercase tracking-wider">
                           Source · Ajout Manuel
                        </span>
                     </div>
                  </div>
               </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 bg-white space-y-6">
               <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Identité</p>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                     placeholder="Nom et prénom *" className="h-12 rounded-xl border-slate-100 bg-slate-50 font-bold" />
               </div>
               <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Coordonnées</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                     <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                        placeholder="Téléphone principal *" type="tel" className="h-12 rounded-xl border-slate-100 bg-slate-50 font-mono font-bold" />
                     <Input value={form.secondary_phone} onChange={e => setForm(f => ({ ...f, secondary_phone: e.target.value }))}
                        placeholder="Tél. secondaire" type="tel" className="h-12 rounded-xl border-slate-100 bg-slate-50 font-mono font-bold" />
                  </div>
                  <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                     placeholder="Email" type="email" className="h-12 rounded-xl border-slate-100 bg-slate-50 font-bold" />
               </div>
               <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Localisation</p>
                  <div className="grid grid-cols-2 gap-3">
                     <select value={form.wilaya} onChange={e => setForm(f => ({ ...f, wilaya: e.target.value }))}
                        className="h-12 rounded-xl border border-slate-100 bg-slate-50 px-4 text-sm font-bold text-slate-700 focus:outline-none focus:border-[#6C5CE7]">
                        <option value="">Wilaya *</option>
                        {WILAYAS.map(w => <option key={w} value={w}>{w}</option>)}
                     </select>
                     <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                        placeholder="Commune / quartier" className="h-12 rounded-xl border-slate-100 bg-slate-50 font-bold" />
                  </div>
               </div>
               <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Note interne</p>
                  <textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                     placeholder="Observations, préférences de livraison..."
                     className="w-full p-4 rounded-xl border border-slate-100 bg-slate-50 text-sm font-medium resize-none focus:outline-none focus:border-[#6C5CE7] h-20" />
               </div>
            </div>

            <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3 shrink-0">
               <Button variant="ghost" onClick={onClose} className="flex-1 h-12 rounded-xl font-bold text-slate-400">Annuler</Button>
               <Button onClick={() => createMutation.mutate(form)} disabled={createMutation.isPending || !form.name || !form.phone}
                  className="flex-[2] h-12 rounded-xl bg-[#6C5CE7] hover:bg-[#5A4AD1] text-white font-black shadow-lg shadow-indigo-200">
                  {createMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : 'Créer la Fiche Client'}
               </Button>
            </div>
         </DialogContent>
      </Dialog>
   );
}

// ─── Invite Modal ──────────────────────────────────────────────
function InviteModal({ open, onClose, storeId, storeSlug }: { open: boolean; onClose: () => void; storeId: string; storeSlug?: string }) {
   const qc = useQueryClient();
   const [phone, setPhone] = useState('');
   const [note, setNote] = useState('');
   const [inviteLink, setInviteLink] = useState<string | null>(null);
   const [copied, setCopied] = useState(false);

   const inviteMutation = useMutation({
      mutationFn: () => apiFetch('/api/v1/customers/invite', {
         method: 'POST',
         body: JSON.stringify({ store_id: storeId, phone: phone.trim(), note: note.trim() }),
      }),
      onSuccess: (res: any) => {
         qc.invalidateQueries({ queryKey: ['customers'] });
         const token = res?.invite_token ?? res?.data?.invite_token;
         if (token) {
            const base = typeof window !== 'undefined' ? window.location.origin : '';
            setInviteLink(`${base}/boutique/${storeSlug ?? storeId}/join?token=${token}`);
         } else {
            toast.success('Invitation envoyée');
            onClose();
         }
      },
      onError: (err: any) => toast.error(err?.detail ?? err?.message ?? 'Erreur'),
   });

   const handleCopy = () => {
      if (!inviteLink) return;
      navigator.clipboard?.writeText(inviteLink);
      setCopied(true);
      toast.success('Lien copié !');
      setTimeout(() => setCopied(false), 2000);
   };

   return (
      <Dialog open={open} onOpenChange={onClose}>
         <DialogContent className="max-w-md p-0 border-none rounded-3xl overflow-hidden shadow-2xl">
            <DialogTitle className="sr-only">Inviter un client</DialogTitle>
            <div className="bg-gradient-to-br from-[#FDCB6E] to-[#e17055] p-7 flex items-center gap-4">
               <div className="size-12 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                  <Link2 className="size-6 text-white" />
               </div>
               <div>
                  <h2 className="text-lg font-black text-white">Inviter un client</h2>
                  <p className="text-white/70 text-[10px] font-bold uppercase tracking-wider">Génère un lien d'inscription unique</p>
               </div>
            </div>

            {!inviteLink ? (
               <div className="p-7 space-y-4">
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-xs font-medium text-amber-700">
                     Le client recevra un lien pour créer son compte directement sur votre boutique. Il sera automatiquement lié à votre registre clients.
                  </div>
                  <div className="space-y-1.5">
                     <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Numéro de téléphone</label>
                     <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="0555 00 00 00" type="tel"
                        className="h-11 rounded-xl border-[#E9ECF0] font-mono font-bold" />
                  </div>
                  <div className="space-y-1.5">
                     <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Note (optionnel)</label>
                     <Input value={note} onChange={e => setNote(e.target.value)} placeholder="VIP, partenaire..."
                        className="h-11 rounded-xl border-[#E9ECF0] font-bold" />
                  </div>
                  <div className="flex gap-3 pt-2">
                     <Button variant="ghost" onClick={onClose} className="flex-1 h-11 rounded-xl font-bold text-slate-400">Annuler</Button>
                     <Button onClick={() => inviteMutation.mutate()} disabled={inviteMutation.isPending || !phone.trim()}
                        className="flex-[2] h-11 rounded-xl font-black text-white text-[11px] uppercase tracking-wider bg-[#FDCB6E] hover:bg-[#e0b450] text-slate-800 border-none">
                        {inviteMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <><Link2 className="size-4 mr-1.5" />Générer le lien</>}
                     </Button>
                  </div>
               </div>
            ) : (
               <div className="p-7 space-y-4">
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-xs font-bold text-emerald-700 flex items-center gap-2">
                     <Check className="size-4 shrink-0" /> Lien d'invitation généré avec succès
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 font-mono text-[11px] text-slate-600 break-all select-all">
                     {inviteLink}
                  </div>
                  <div className="flex gap-3">
                     <Button onClick={handleCopy} className="flex-1 h-11 rounded-xl font-black text-sm border-none" style={{ backgroundColor: copied ? '#00B894' : '#6C5CE7', color: 'white' }}>
                        {copied ? <><Check className="size-4 mr-1.5" />Copié !</> : <><Copy className="size-4 mr-1.5" />Copier le lien</>}
                     </Button>
                     <Button variant="ghost" onClick={onClose} className="h-11 px-5 rounded-xl font-bold text-slate-400">Fermer</Button>
                  </div>
               </div>
            )}
         </DialogContent>
      </Dialog>
   );
}

// ─── Main Page ─────────────────────────────────────────────────
export default function CustomersPage() {
   const { activeStore, adminSubView } = useAppStore();
   const storeId = activeStore?.id ?? '';
   const qc = useQueryClient();

   const [activeTab, setActiveTab] = useState<'clients' | 'blacklist'>(
      adminSubView === 'blacklist' ? 'blacklist' : 'clients'
   );
   const [searchQuery, setSearchQuery] = useState('');
   const [sourceFilter, setSourceFilter] = useState<CustomerSource | ''>('');
   const [startDate, setStartDate] = useState('');
   const [endDate, setEndDate] = useState('');
   const [page, setPage] = useState(1);
   const [isCreateOpen, setIsCreateOpen] = useState(false);
   const [isInviteOpen, setIsInviteOpen] = useState(false);
   const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);

   const customersQuery = useQuery<PaginatedResponse<Customer>>({
      queryKey: ['customers', storeId, activeTab, searchQuery, sourceFilter, page],
      queryFn: () => {
         const params = new URLSearchParams({
            store_id: storeId, page: page.toString(), pageSize: '20',
            blacklisted: (activeTab === 'blacklist').toString(),
         });
         if (searchQuery) params.append('search', searchQuery);
         if (sourceFilter) params.append('source', sourceFilter);
         if (startDate) params.append('start_date', startDate + 'T00:00:00.000Z');
         if (endDate) params.append('end_date', endDate + 'T23:59:59.999Z');
         return apiFetch(`/api/v1/customers?${params}`);
      },
      enabled: !!storeId,
      // A new order/manual add/invite acceptance elsewhere shouldn't require
      // reopening this page to show up here.
      refetchInterval: 30000,
   });

   React.useEffect(() => {
      setPage(1);
   }, [startDate, endDate]);

   const statsQuery = useQuery({
      queryKey: ['customers-stats', storeId],
      queryFn: () => apiFetch<any>(`/api/v1/customers/stats?store_id=${storeId}`),
      enabled: !!storeId,
      refetchInterval: 30000,
   });

   const toggleBlacklistMutation = useMutation({
      mutationFn: ({ id, note }: { id: string; note?: string }) =>
         apiFetch(`/api/v1/customers/${id}/blacklist`, {
            method: 'PATCH',
            body: JSON.stringify({ blacklist_note: note }),
         }),
      onSuccess: (_, vars) => {
         qc.invalidateQueries({ queryKey: ['customers'] });
         qc.invalidateQueries({ queryKey: ['customers-stats'] });
         const c = customersQuery.data?.data?.find(c => c.id === vars.id);
         toast.success(c?.is_blacklisted ? 'Client réhabilité ✓' : '🚫 Client mis en liste noire');
         setDetailCustomer(null);
      },
      onError: (e: any) => toast.error(e?.detail ?? e?.message ?? 'Erreur'),
   });

   const deleteMutation = useMutation({
      mutationFn: (id: string) => apiFetch(`/api/v1/customers/${id}`, { method: 'DELETE' }),
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); qc.invalidateQueries({ queryKey: ['customers-stats'] }); toast.success('Dossier client supprimé'); },
      onError: (e: any) => toast.error(e?.detail ?? e?.message ?? 'Erreur'),
   });

   const customers = customersQuery.data?.data ?? [];
   const total = customersQuery.data?.total ?? 0;
   const totalPages = customersQuery.data?.totalPages ?? 1;
   const stats = Array.isArray(statsQuery.data) ? null : (statsQuery.data as any)?.data ?? statsQuery.data;

   return (
      <div className="space-y-6 animate-in fade-in duration-500 max-w-[1600px] mx-auto w-full p-6">

         {/* ─── Header ─── */}
         <div className="bg-white rounded-[40px] border p-8 shadow-sm relative overflow-hidden" style={{ borderColor: C.border }}>
            <div className="absolute top-0 right-0 p-12 opacity-[0.02] text-[#6C5CE7] rotate-12">
               <Users className="size-56" />
            </div>
            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
               <div className="flex items-center gap-6">
                  <div className="size-16 rounded-[28px] flex items-center justify-center bg-[#F0EDFF] shadow-inner text-[#6C5CE7]">
                     <Users className="size-8" />
                  </div>
                  <div>
                     <div className="flex items-center gap-3 mb-1">
                        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[#6C5CE7]/60">CRM Industrial</span>
                        <div className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                     </div>
                     <h1 className="text-3xl font-black text-[#2D3436] tracking-tight uppercase">Registre Clients</h1>
                     <p className="text-sm font-bold text-slate-400 mt-0.5">Capital client, historique et gestion des accès.</p>
                  </div>
               </div>

               <div className="flex items-center gap-3 flex-wrap">
                  {/* Quick stats */}
                  {stats && (
                     <div className="hidden lg:flex items-center gap-3">
                        {[
                           { v: stats.totalCustomers ?? 0, l: 'Total', c: C.primary, bg: C.primaryBg },
                           { v: stats.newThisMonth ?? 0, l: 'Ce mois', c: C.success, bg: C.successBg },
                           { v: stats.blacklistedCount ?? 0, l: 'Blacklist', c: C.danger, bg: C.dangerBg },
                        ].map((s, i) => (
                           <div key={i} className="text-center px-5 py-3 rounded-2xl border" style={{ backgroundColor: s.bg, borderColor: s.c + '30' }}>
                              <p className="text-xl font-black" style={{ color: s.c }}>{s.v}</p>
                              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: s.c + 'AA' }}>{s.l}</p>
                           </div>
                        ))}
                     </div>
                  )}

                  {/* Tab toggle */}
                  <div className="bg-slate-50 p-1.5 rounded-2xl border border-slate-100 flex gap-1">
                     <button onClick={() => { setActiveTab('clients'); setPage(1); }}
                        className={cn("px-5 py-2.5 rounded-xl text-[11px] font-black uppercase transition-all",
                           activeTab === 'clients' ? "bg-white text-[#6C5CE7] shadow-md" : "text-slate-400 hover:text-slate-600"
                        )}>Actifs</button>
                     <button onClick={() => { setActiveTab('blacklist'); setPage(1); }}
                        className={cn("px-5 py-2.5 rounded-xl text-[11px] font-black uppercase transition-all",
                           activeTab === 'blacklist' ? "bg-white text-rose-500 shadow-md" : "text-slate-400 hover:text-slate-600"
                        )}>Liste Noire</button>
                  </div>

                  <Button onClick={() => setIsInviteOpen(true)}
                     className="h-12 px-6 rounded-2xl font-black uppercase tracking-widest text-[11px] border-none text-slate-800"
                     style={{ backgroundColor: C.warning }}>
                     <Link2 className="mr-2 size-4" /> Inviter
                  </Button>
                  <Button onClick={() => setIsCreateOpen(true)}
                     className="h-12 px-7 rounded-2xl bg-[#6C5CE7] hover:bg-[#5A4AD1] text-white font-black uppercase tracking-widest text-[11px] shadow-xl shadow-indigo-200 border-none">
                     <Plus className="mr-2 size-5" /> Nouveau Client
                  </Button>
               </div>
            </div>
         </div>

         {/* ─── Source breakdown cards ─── */}
         <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(Object.entries(SOURCE_CONFIG) as [CustomerSource, typeof SOURCE_CONFIG[CustomerSource]][]).map(([key, s]) => {
               const Icon = s.icon;
               const count = (stats as any)?.[`source_${key.toLowerCase()}`] ?? (stats as any)?.sources?.[key] ?? null;
               return (
                  <button key={key} onClick={() => setSourceFilter(sourceFilter === key ? '' : key)}
                     className={cn("bg-white rounded-2xl border p-4 flex items-center gap-3 transition-all text-left hover:shadow-md",
                        sourceFilter === key ? 'ring-2' : ''
                     )}
                     style={{ borderColor: sourceFilter === key ? s.color : C.border }}>
                     <div className="size-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: s.bg }}>
                        <Icon className="size-5" style={{ color: s.color }} />
                     </div>
                     <div>
                        <p className="text-lg font-black text-slate-800">{count ?? '—'}</p>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{s.label}</p>
                        <p className="text-[9px] text-slate-300 leading-tight mt-0.5">{s.desc}</p>
                     </div>
                  </button>
               );
            })}
         </div>

         {/* ─── Search bar & Dates ─── */}
         <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex items-center gap-2 bg-white rounded-[24px] border px-4 py-2 shadow-sm shrink-0" style={{ borderColor: C.border }}>
               <Calendar className="size-5 text-slate-300" />
               <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent text-sm font-bold text-slate-600 outline-none w-[120px]" />
               <span className="text-slate-300">-</span>
               <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent text-sm font-bold text-slate-600 outline-none w-[120px]" />
            </div>
            <div className="flex-1 bg-white rounded-[24px] border px-6 py-3.5 flex items-center gap-4 shadow-sm" style={{ borderColor: C.border }}>
               <Search className="size-5 text-slate-300 shrink-0" />
               <Input placeholder="Nom, téléphone, wilaya..."
                  className="border-0 bg-transparent p-0 h-auto text-sm font-bold focus-visible:ring-0 placeholder:text-slate-300"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setPage(1); }} />
               {(searchQuery || sourceFilter) && (
                  <button onClick={() => { setSearchQuery(''); setSourceFilter(''); }} className="text-slate-300 hover:text-slate-600 shrink-0">
                     <X className="size-4" />
                  </button>
               )}
            </div>
            <button onClick={() => customersQuery.refetch()} className="p-3.5 rounded-2xl border border-slate-100 bg-white hover:bg-slate-50 text-slate-400 shadow-sm">
               <RefreshCw className={cn("size-5", customersQuery.isFetching && "animate-spin")} />
            </button>
         </div>

         {/* ─── Table ─── */}
         <div className="bg-white rounded-[32px] border shadow-sm overflow-hidden" style={{ borderColor: C.border }}>
            <div className="overflow-x-auto">
               <table className="w-full text-left min-w-[960px]">
                  <thead>
                     <tr className="border-b bg-[#FAFBFD]" style={{ borderColor: C.border }}>
                        <th className="px-7 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Client</th>
                        <th className="px-7 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Contact</th>
                        <th className="px-7 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Localisation</th>
                        <th className="px-7 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Source</th>
                        <th className="px-7 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Fidélité</th>
                        <th className="px-7 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Commandes</th>
                        <th className="px-7 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: C.border }}>
                     {customersQuery.isLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                           <tr key={i}><td colSpan={7} className="px-7 py-3"><Skeleton className="h-14 w-full rounded-xl" /></td></tr>
                        ))
                     ) : customers.length === 0 ? (
                        <tr><td colSpan={7} className="px-7 py-28 text-center">
                           <div className="flex flex-col items-center gap-4 opacity-20">
                              <AlertCircle className="size-14" />
                              <p className="text-sm font-black uppercase">Aucun client trouvé</p>
                           </div>
                        </td></tr>
                     ) : customers.map(customer => (
                        <tr key={customer.id} className="hover:bg-slate-50/50 transition-all group cursor-pointer" onClick={() => setDetailCustomer(customer)}>
                           {/* Client */}
                           <td className="px-7 py-4">
                              <div className="flex items-center gap-4">
                                 <div className={cn("size-11 rounded-2xl flex items-center justify-center font-black text-base shrink-0", customer.is_blacklisted ? "bg-rose-100 text-rose-500" : "bg-[#F0EDFF] text-[#6C5CE7]")}>
                                    {customer.name.charAt(0).toUpperCase()}
                                 </div>
                                 <div>
                                    <p className="text-sm font-black text-slate-800 leading-tight">{customer.name}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                       <span className="text-[9px] text-slate-300 font-mono">{customer.id.substring(0, 8)}…</span>
                                       {customer.is_guest && (
                                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-700 border border-sky-200 inline-flex items-center gap-0.5">👁 Visiteur</span>
                                       )}
                                       {(customer as any).has_account && (
                                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200 inline-flex items-center gap-0.5">
                                             <UserCircle2 className="size-2.5" /> Compte
                                          </span>
                                       )}
                                       {customer.tags && customer.tags.length > 0 && (
                                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#F0EDFF] text-[#6C5CE7]">{customer.tags[0]}</span>
                                       )}
                                    </div>
                                 </div>
                              </div>
                           </td>

                           {/* Contact */}
                           <td className="px-7 py-4">
                              <div className="space-y-1">
                                 <div className="flex items-center gap-1.5 text-xs font-black text-slate-700 font-mono bg-slate-50 w-fit px-2.5 py-1.5 rounded-lg border border-slate-100">
                                    <Phone className="size-3 text-[#6C5CE7]" /> {customer.phone}
                                 </div>
                                 {customer.email && (
                                    <p className="text-[10px] text-slate-400 flex items-center gap-1">
                                       <Mail className="size-3" /> {customer.email}
                                    </p>
                                 )}
                              </div>
                           </td>

                           {/* Location */}
                           <td className="px-7 py-4">
                              <div className="space-y-1">
                                 <div className="flex items-center gap-1.5">
                                    <MapPin className="size-3.5 text-slate-300 shrink-0" />
                                    <span className="text-sm font-bold text-slate-600">{customer.wilaya || '—'}</span>
                                 </div>
                                 {customer.last_order_at && (
                                    <p className="text-[9px] text-slate-300 pl-5">
                                       Dernière cmd: {fmtDate(customer.last_order_at, true)}
                                    </p>
                                 )}
                              </div>
                           </td>

                           {/* Source */}
                           <td className="px-7 py-4 text-center">
                              <SourceBadge source={customer.source} />
                              <p className="text-[9px] text-slate-300 mt-1">{fmtDate(customer.created_at, true)}</p>
                           </td>

                           {/* Tier */}
                           <td className="px-7 py-4 text-center">
                              <TierBadge tier={customer.tier} />
                              {customer.rfm_score && (
                                 <p className="text-[9px] font-mono text-slate-300 mt-1">RFM: {customer.rfm_score}</p>
                              )}
                           </td>

                           {/* Orders */}
                           <td className="px-7 py-4 text-center">
                              <div className="inline-flex flex-col items-center">
                                 <span className="text-lg font-black text-slate-800">{customer.total_orders}</span>
                                 <span className="text-[9px] font-bold text-slate-400 tabular-nums">{formatPrice(customer.total_spent)} DA</span>
                                 {(customer.total_returned ?? 0) > 0 && (
                                    <span className="text-[9px] font-bold text-rose-400">{customer.total_returned} retour(s)</span>
                                 )}
                              </div>
                           </td>

                           {/* Actions */}
                           <td className="px-7 py-4 text-right" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                 <button onClick={() => setDetailCustomer(customer)}
                                    className="size-9 rounded-xl flex items-center justify-center bg-[#F0EDFF] text-[#6C5CE7] hover:bg-[#6C5CE7] hover:text-white transition-all">
                                    <Eye className="size-4" />
                                 </button>
                                 <button onClick={() => toggleBlacklistMutation.mutate({ id: customer.id })}
                                    disabled={toggleBlacklistMutation.isPending}
                                    className={cn("size-9 rounded-xl flex items-center justify-center border transition-all",
                                       customer.is_blacklisted ? "bg-emerald-50 text-emerald-500 border-emerald-100 hover:bg-emerald-500 hover:text-white" : "bg-rose-50 text-rose-500 border-rose-100 hover:bg-rose-500 hover:text-white"
                                    )}>
                                    {customer.is_blacklisted ? <ShieldCheck className="size-4" /> : <ShieldX className="size-4" />}
                                 </button>
                                 <button onClick={() => { if (confirm('Supprimer définitivement ce dossier client ?')) deleteMutation.mutate(customer.id); }}
                                    disabled={deleteMutation.isPending}
                                    className="size-9 rounded-xl flex items-center justify-center bg-white border border-slate-100 text-slate-300 hover:text-rose-500 hover:border-rose-200 transition-all">
                                    <Trash2 className="size-4" />
                                 </button>
                              </div>
                           </td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
            <TablePagination total={total} page={page} totalPages={totalPages} onPageChange={setPage} />
         </div>

         {/* ─── Modals ─── */}
         <CreateCustomerModal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} storeId={storeId} />
         <InviteModal open={isInviteOpen} onClose={() => setIsInviteOpen(false)} storeId={storeId} storeSlug={activeStore?.slug ?? activeStore?.id} />
         <CustomerDetailModal
            customer={detailCustomer}
            open={!!detailCustomer}
            onClose={() => setDetailCustomer(null)}
            onBlacklist={(id, note) => toggleBlacklistMutation.mutate({ id, note })}
            storeId={storeId}
         />
      </div>
   );
}
