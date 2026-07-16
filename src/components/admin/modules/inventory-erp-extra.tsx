'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { toast } from 'sonner';
import { Package, AlertTriangle, Loader2, ArrowRightLeft, Layers, Clock, X } from 'lucide-react';

const C = {
   primary: '#6C5CE7', primaryBg: '#F0EDFF',
   success: '#00B894', successBg: '#E6FFF8',
   danger: '#E17055', dangerBg: '#FFEDE9',
   warning: '#FDCB6E', warningBg: '#FFF8E6',
   info: '#0984E3', infoBg: '#E8F4FE',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

// ─── Section 4 — Suivi des lots ────────────────────────────────────────────
interface Lot {
   batch_id: string; product_id: string; product_name: string;
   expiration_date: string | null; balance: number; movements: number;
   received_at: string | null; warehouse_name: string | null; etat: string;
}

export function LotsView() {
   const activeStore = useAppStore(s => s.activeStore);
   const [openLot, setOpenLot] = useState<string | null>(null);
   const { data, isLoading } = useQuery({
      queryKey: ['stock-lots', activeStore?.id],
      queryFn: () => apiFetch<{ success: boolean; data: Lot[] }>(`/api/v1/stock/lots?store_id=${activeStore?.id}`),
      enabled: !!activeStore?.id,
   });
   const lots = data?.data || [];

   const historyQuery = useQuery({
      queryKey: ['lot-history', openLot],
      queryFn: () => apiFetch<{ success: boolean; data: { movements: any[]; orders_using_this_lot: string[] } }>(`/api/v1/stock/lots/${openLot}/history`),
      enabled: !!openLot,
   });

   const etatColor: Record<string, string> = { actif: C.success, 'épuisé': C.textDim, 'expire bientôt': C.warning, 'expiré': C.danger };

   return (
      <div className="bg-white border rounded-2xl overflow-hidden shadow-sm animate-in slide-in-from-bottom-2 duration-400" style={{ borderColor: C.border }}>
         <div className="p-6 border-b" style={{ borderColor: C.border }}>
            <h3 className="text-sm font-extrabold text-[#2D3436] uppercase tracking-wider flex items-center gap-2">
               <Layers className="size-4 text-[#6C5CE7]" /> Suivi des lots
            </h3>
            <p className="text-[10px] font-bold text-[#B2BEC3] uppercase tracking-widest mt-1">Traçabilité complète par numéro de lot</p>
         </div>
         <div className="overflow-x-auto p-6">
            {isLoading ? (
               <div className="p-10 flex justify-center"><Loader2 className="size-6 animate-spin text-[#6C5CE7]" /></div>
            ) : lots.length === 0 ? (
               <div className="p-16 text-center text-[10px] font-bold text-[#B2BEC3] uppercase">Aucun lot enregistré — le champ "lot" est optionnel lors d'un réapprovisionnement</div>
            ) : (
               <table className="w-full text-left">
                  <thead>
                     <tr className="border-b" style={{ borderColor: C.border }}>
                        <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Lot</th>
                        <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Produit</th>
                        <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Entrepôt</th>
                        <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3] text-center">Solde</th>
                        <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Expiration</th>
                        <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">État</th>
                        <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3] text-right">Historique</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: C.border }}>
                     {lots.map(l => (
                        <tr key={l.batch_id + l.product_id} className="hover:bg-[#FAFBFD]">
                           <td className="py-3 text-xs font-mono font-bold text-[#6C5CE7]">{l.batch_id.slice(0, 10)}</td>
                           <td className="py-3 text-xs font-bold text-[#2D3436]">{l.product_name}</td>
                           <td className="py-3 text-xs text-[#636E72]">{l.warehouse_name || '—'}</td>
                           <td className="py-3 text-center text-sm font-black text-[#2D3436] tabular-nums">{l.balance}</td>
                           <td className="py-3 text-xs text-[#636E72]">{l.expiration_date || '—'}</td>
                           <td className="py-3">
                              <span className="text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-md" style={{ backgroundColor: (etatColor[l.etat] || C.textDim) + '18', color: etatColor[l.etat] || C.textDim }}>{l.etat}</span>
                           </td>
                           <td className="py-3 text-right">
                              <button onClick={() => setOpenLot(l.batch_id)} className="text-[10px] font-bold text-[#6C5CE7] hover:underline">Voir</button>
                           </td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            )}
         </div>

         {openLot && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setOpenLot(null)}>
               <div className="bg-white w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                     <h4 className="text-sm font-black text-[#2D3436]">Lot {openLot.slice(0, 10)}</h4>
                     <button onClick={() => setOpenLot(null)}><X className="size-4 text-slate-400" /></button>
                  </div>
                  {historyQuery.isLoading ? <Loader2 className="size-5 animate-spin text-[#6C5CE7]" /> : (
                     <>
                        {(historyQuery.data?.data.orders_using_this_lot.length ?? 0) > 0 && (
                           <div className="mb-4 p-3 bg-[#F0EDFF] rounded-xl">
                              <p className="text-[9px] font-black uppercase text-[#6C5CE7] mb-1">Commandes utilisant ce lot</p>
                              <p className="text-xs font-bold text-[#2D3436]">{historyQuery.data?.data.orders_using_this_lot.join(', ')}</p>
                           </div>
                        )}
                        <div className="space-y-2">
                           {historyQuery.data?.data.movements.map(m => (
                              <div key={m.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-[#F8F9FC]">
                                 <div>
                                    <p className="font-bold text-[#2D3436]">{m.type}</p>
                                    <p className="text-[10px] text-[#B2BEC3]">{new Date(m.created_at).toLocaleString('fr-FR')} · {m.actor || 'Système'}{m.order_number ? ` · #${m.order_number}` : ''}</p>
                                 </div>
                                 <span className={cn("font-black tabular-nums", m.quantity >= 0 ? "text-emerald-500" : "text-rose-500")}>{m.quantity >= 0 ? '+' : ''}{m.quantity}</span>
                              </div>
                           ))}
                        </div>
                     </>
                  )}
               </div>
            </div>
         )}
      </div>
   );
}

// ─── Section 5 — Moteur d'alertes intelligent ──────────────────────────────
interface Alert {
   type: string; priority: 'high' | 'medium' | 'low';
   product_id?: string; product_name?: string; order_id?: string; order_number?: string;
   batch_id?: string; detail: string; action: string;
}

const ALERT_LABELS: Record<string, string> = {
   STOCK_FAIBLE: 'Stock faible', SURSTOCK: 'Surstock', AUCUN_MOUVEMENT: 'Aucun mouvement',
   EXPIRATION: 'Expiration', TAUX_RETOUR_ELEVE: 'Taux de retour élevé', ANNULATIONS_ELEVEES: 'Annulations élevées',
   STOCK_NEGATIF: 'Stock négatif', LIVREE_SANS_SORTIE_STOCK: 'Livrée sans sortie de stock',
   RETOUR_SANS_REINTEGRATION: 'Retour sans réintégration', REINTEGRATION_SANS_COMMANDE: 'Réintégration sans commande',
   DOUBLE_MOUVEMENT: 'Double mouvement', PRODUIT_ORPHELIN: 'Produit orphelin',
};

export function AlertsEngineView() {
   const activeStore = useAppStore(s => s.activeStore);
   const [priorityFilter, setPriorityFilter] = useState('');
   const { data, isLoading } = useQuery({
      queryKey: ['alerts-engine', activeStore?.id],
      queryFn: () => apiFetch<{ success: boolean; data: Alert[]; by_priority: Record<string, number> }>(`/api/v1/stock/alerts-engine?store_id=${activeStore?.id}`),
      enabled: !!activeStore?.id,
      refetchInterval: 120000,
   });
   const alerts = (data?.data || []).filter(a => !priorityFilter || a.priority === priorityFilter);
   const priorityColor = { high: C.danger, medium: C.warning, low: C.textDim };
   const priorityLabel = { high: 'Critique', medium: 'À surveiller', low: 'Info' };

   return (
      <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-400">
         <div className="grid grid-cols-3 gap-3">
            {(['high', 'medium', 'low'] as const).map(p => (
               <button key={p} onClick={() => setPriorityFilter(priorityFilter === p ? '' : p)}
                  className={cn("p-4 rounded-xl border text-left transition-all", priorityFilter === p && "ring-2")}
                  style={{ borderColor: priorityColor[p] + '33', backgroundColor: priorityColor[p] + '0A' }}>
                  <p className="text-lg font-black tabular-nums" style={{ color: priorityColor[p] }}>{data?.by_priority?.[p] ?? 0}</p>
                  <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: priorityColor[p] }}>{priorityLabel[p]}</p>
               </button>
            ))}
         </div>
         <div className="bg-white border rounded-2xl overflow-hidden" style={{ borderColor: C.border }}>
            {isLoading ? (
               <div className="p-10 flex justify-center"><Loader2 className="size-6 animate-spin text-[#6C5CE7]" /></div>
            ) : alerts.length === 0 ? (
               <div className="p-16 text-center text-[10px] font-bold text-[#B2BEC3] uppercase">Aucune alerte</div>
            ) : (
               <div className="divide-y" style={{ borderColor: C.border }}>
                  {alerts.map((a, i) => (
                     <div key={i} className="p-4 flex items-center gap-3 hover:bg-[#FAFBFD]">
                        <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: priorityColor[a.priority] }} />
                        <div className="flex-1">
                           <p className="text-xs font-black text-[#2D3436]">{ALERT_LABELS[a.type] || a.type}{a.product_name ? ` — ${a.product_name}` : ''}{a.order_number ? ` — Commande #${a.order_number}` : ''}</p>
                           <p className="text-[10px] text-[#636E72] mt-0.5">{a.detail}</p>
                           <p className="text-[10px] font-bold text-[#6C5CE7] mt-0.5">→ {a.action}</p>
                        </div>
                        <span className="text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-md shrink-0" style={{ backgroundColor: priorityColor[a.priority] + '18', color: priorityColor[a.priority] }}>
                           {priorityLabel[a.priority]}
                        </span>
                     </div>
                  ))}
               </div>
            )}
         </div>
      </div>
   );
}

// ─── Section 2 — Entrepôts : détail + transfert ────────────────────────────
export function WarehouseTransferPanel() {
   const activeStore = useAppStore(s => s.activeStore);
   const queryClient = useQueryClient();
   const { data: whData } = useQuery({
      queryKey: ['warehouses', activeStore?.id],
      queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/warehouses?store_id=${activeStore?.id}`),
      enabled: !!activeStore?.id,
   });
   const { data: prodData } = useQuery({
      queryKey: ['admin-products-light', activeStore?.id],
      queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/products?store_id=${activeStore?.id}&limit=200`),
      enabled: !!activeStore?.id,
   });
   const warehouses = whData?.data || [];
   const products = prodData?.data || [];

   const [selectedWh, setSelectedWh] = useState<string | null>(null);
   const [form, setForm] = useState({ product_id: '', quantity: 1, from_warehouse_id: '', to_warehouse_id: '' });

   const detailQuery = useQuery({
      queryKey: ['warehouse-detail', selectedWh],
      queryFn: () => apiFetch<{ success: boolean; data: { warehouse: any; products: any[] } }>(`/api/v1/warehouses/${selectedWh}/detail`),
      enabled: !!selectedWh,
   });

   const transferMutation = useMutation({
      mutationFn: () => apiFetch('/api/v1/warehouses/transfer', { method: 'POST', body: JSON.stringify(form) }),
      onSuccess: (res: any) => {
         toast.success(res.message || 'Transfert effectué');
         queryClient.invalidateQueries({ queryKey: ['warehouse-detail'] });
         queryClient.invalidateQueries({ queryKey: ['warehouses'] });
         setForm({ product_id: '', quantity: 1, from_warehouse_id: '', to_warehouse_id: '' });
      },
      onError: (err: any) => toast.error('Échec du transfert', { description: err.message }),
   });

   return (
      <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-400">
         <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {warehouses.map((w: any) => (
               <button key={w.id} onClick={() => setSelectedWh(w.id)}
                  className={cn("p-4 rounded-xl border text-left transition-all bg-white hover:shadow-md", selectedWh === w.id && "ring-2 ring-[#6C5CE7]")}
                  style={{ borderColor: C.border }}>
                  <p className="text-xs font-black text-[#2D3436]">{w.name}</p>
                  <p className="text-[9px] font-bold text-[#B2BEC3] font-mono">{w.code}</p>
                  <p className="text-[10px] font-bold text-[#6C5CE7] mt-2">{w.current_load ?? 0}{w.capacity ? ` / ${w.capacity}` : ''} unités</p>
               </button>
            ))}
         </div>

         {selectedWh && detailQuery.data?.data && (
            <div className="bg-white border rounded-2xl p-6" style={{ borderColor: C.border }}>
               <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {[
                     { label: 'Valeur stock', value: formatPrice(detailQuery.data.data.warehouse.valeur_stock) },
                     { label: 'Produits', value: detailQuery.data.data.warehouse.nombre_produits },
                     { label: 'Lots', value: detailQuery.data.data.warehouse.nombre_lots },
                     { label: 'Taux occupation', value: detailQuery.data.data.warehouse.taux_occupation != null ? `${detailQuery.data.data.warehouse.taux_occupation}%` : '—' },
                  ].map(s => (
                     <div key={s.label} className="p-3 rounded-xl bg-[#F8F9FC]">
                        <p className="text-sm font-black text-[#2D3436]">{s.value}</p>
                        <p className="text-[8px] font-bold text-[#B2BEC3] uppercase">{s.label}</p>
                     </div>
                  ))}
               </div>
               <table className="w-full text-left text-xs">
                  <thead><tr className="text-[9px] font-black uppercase text-[#B2BEC3] border-b" style={{ borderColor: C.border }}>
                     <th className="pb-2">Produit</th><th className="pb-2 text-center">Disponible</th><th className="pb-2 text-center">Retourné</th><th className="pb-2 text-center">Transféré</th><th className="pb-2 text-center">Lots</th>
                  </tr></thead>
                  <tbody className="divide-y" style={{ borderColor: C.border }}>
                     {detailQuery.data.data.products.map((p: any) => (
                        <tr key={p.product_id}>
                           <td className="py-2 font-bold text-[#2D3436]">{p.product_name}</td>
                           <td className="py-2 text-center tabular-nums">{p.disponible}</td>
                           <td className="py-2 text-center tabular-nums">{p.retourne}</td>
                           <td className="py-2 text-center tabular-nums">{p.transfere}</td>
                           <td className="py-2 text-center tabular-nums">{p.lots}</td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
         )}

         <div className="bg-white border rounded-2xl p-6" style={{ borderColor: C.border }}>
            <h4 className="text-xs font-black text-[#2D3436] uppercase tracking-wider mb-4 flex items-center gap-2"><ArrowRightLeft className="size-3.5 text-[#6C5CE7]" /> Transfert entre entrepôts</h4>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
               <select value={form.product_id} onChange={e => setForm(f => ({ ...f, product_id: e.target.value }))} className="h-9 rounded-lg border px-2 text-xs" style={{ borderColor: C.border }}>
                  <option value="">Produit…</option>
                  {products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
               </select>
               <select value={form.from_warehouse_id} onChange={e => setForm(f => ({ ...f, from_warehouse_id: e.target.value }))} className="h-9 rounded-lg border px-2 text-xs" style={{ borderColor: C.border }}>
                  <option value="">Depuis…</option>
                  {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
               </select>
               <select value={form.to_warehouse_id} onChange={e => setForm(f => ({ ...f, to_warehouse_id: e.target.value }))} className="h-9 rounded-lg border px-2 text-xs" style={{ borderColor: C.border }}>
                  <option value="">Vers…</option>
                  {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
               </select>
               <input type="number" min={1} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: parseInt(e.target.value) || 1 }))} className="h-9 rounded-lg border px-2 text-xs" style={{ borderColor: C.border }} />
               <button
                  onClick={() => transferMutation.mutate()}
                  disabled={!form.product_id || !form.from_warehouse_id || !form.to_warehouse_id || transferMutation.isPending}
                  className="h-9 rounded-lg bg-[#6C5CE7] text-white text-xs font-bold disabled:opacity-40">
                  {transferMutation.isPending ? '…' : 'Transférer'}
               </button>
            </div>
         </div>
      </div>
   );
}
