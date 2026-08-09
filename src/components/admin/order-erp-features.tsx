'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAppStore } from '@/store/app-store';
import { Loader2, Camera, Printer, MapPin, Trophy, Truck, X } from 'lucide-react';
import { ORDER_STATUS_LABELS, ORDER_STATUS_DOT } from '@/lib/types';

const C = {
   primary: '#6C5CE7', primaryBg: '#F0EDFF',
   success: '#00B894', successBg: '#E6FFF8',
   danger: '#E17055', dangerBg: '#FFEDE9',
   warning: '#FDCB6E', warningBg: '#FFF8E6',
   info: '#0984E3', infoBg: '#E8F4FE',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

// ─── Commissions confirmatrice / livreur ───────────────────────────────────
interface CommissionRow { name: string; orders: number; commission: number; livreur_bonus?: number }
interface CommissionsData {
   rates: { commission_confirmatrice_pct: number; commission_livreur_fixed: number };
   confirmatrices: CommissionRow[]; livreurs: CommissionRow[]; total_commandes_livrees: number;
}

export function CommissionsView() {
   const activeStore = useAppStore(s => s.activeStore);
   const queryClient = useQueryClient();
   const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]; });
   const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
   const [editingRates, setEditingRates] = useState(false);
   const [pctInput, setPctInput] = useState('');
   const [fixedInput, setFixedInput] = useState('');

   const { data, isLoading } = useQuery({
      queryKey: ['commissions', activeStore?.id, startDate, endDate],
      queryFn: () => apiFetch<{ success: boolean; data: CommissionsData }>(`/api/v1/orders/commissions?store_id=${activeStore?.id}&start_date=${startDate}T00:00:00.000Z&end_date=${endDate}T23:59:59.999Z`),
      enabled: !!activeStore?.id,
   });
   const d = data?.data;

   const saveRates = useMutation({
      mutationFn: () => apiFetch('/api/v1/orders/commissions/config', {
         method: 'PATCH',
         body: JSON.stringify({
            store_id: activeStore?.id,
            commission_confirmatrice_pct: pctInput ? parseFloat(pctInput) : undefined,
            commission_livreur_fixed: fixedInput ? parseFloat(fixedInput) : undefined,
         }),
      }),
      onSuccess: () => { toast.success('Taux mis à jour'); queryClient.invalidateQueries({ queryKey: ['commissions'] }); setEditingRates(false); },
      onError: (err: any) => toast.error('Erreur', { description: err.message }),
   });

   return (
      <div className="space-y-5 animate-in fade-in duration-500">
         <div className="bg-white rounded-2xl border p-5" style={{ borderColor: C.border }}>
            <div className="flex items-center justify-between flex-wrap gap-3">
               <div>
                  <h2 className="text-base font-black text-slate-800 flex items-center gap-2"><Trophy className="size-4 text-[#6C5CE7]" /> Commissions</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Calculées sur les commandes livrées de la période sélectionnée</p>
               </div>
               <div className="flex items-center gap-2">
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-9 px-3 rounded-xl border text-xs font-bold text-slate-600" style={{ borderColor: C.border }} />
                  <span className="text-slate-300">→</span>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="h-9 px-3 rounded-xl border text-xs font-bold text-slate-600" style={{ borderColor: C.border }} />
               </div>
            </div>
            {d && (
               <div className="mt-4 flex items-center gap-4 flex-wrap">
                  {!editingRates ? (
                     <>
                        <span className="text-xs text-slate-500">Taux : <strong className="text-slate-700">{d.rates.commission_confirmatrice_pct}%</strong> confirmatrice (<strong className="text-emerald-600">+50 DA</strong> / commande assignée livreur livrée) · <strong className="text-slate-700">{formatPrice(d.rates.commission_livreur_fixed)}</strong> / livraison livreur</span>
                        <button onClick={() => { setPctInput(String(d.rates.commission_confirmatrice_pct)); setFixedInput(String(d.rates.commission_livreur_fixed)); setEditingRates(true); }}
                           className="text-[10px] font-bold text-[#6C5CE7] hover:underline">Modifier les taux</button>
                     </>
                  ) : (
                     <div className="flex items-center gap-2">
                        <input type="number" step="0.1" value={pctInput} onChange={e => setPctInput(e.target.value)} placeholder="% confirmatrice"
                           className="h-8 w-32 px-2 rounded-lg border text-xs" style={{ borderColor: C.border }} />
                        <input type="number" value={fixedInput} onChange={e => setFixedInput(e.target.value)} placeholder="DA / livraison"
                           className="h-8 w-32 px-2 rounded-lg border text-xs" style={{ borderColor: C.border }} />
                        <button onClick={() => saveRates.mutate()} disabled={saveRates.isPending} className="h-8 px-3 rounded-lg bg-[#6C5CE7] text-white text-[10px] font-bold">Sauver</button>
                        <button onClick={() => setEditingRates(false)} className="h-8 px-3 rounded-lg border text-[10px] font-bold" style={{ borderColor: C.border }}>Annuler</button>
                     </div>
                  )}
               </div>
            )}
         </div>

         {isLoading ? <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-slate-300" /></div> : d && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {[
                  { title: 'Confirmatrices', rows: d.confirmatrices },
                  { title: 'Livreurs', rows: d.livreurs },
               ].map(col => (
                  <div key={col.title} className="bg-white rounded-2xl border p-5" style={{ borderColor: C.border }}>
                     <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">{col.title}</p>
                     {col.rows.length === 0 ? <p className="text-xs text-slate-300">Aucune commande livrée sur la période</p> : (
                        <div className="space-y-1.5">
                           {col.rows.map((r, i) => (
                              <div key={i} className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-slate-50">
                                 <div>
                                    <p className="font-bold text-slate-700">{r.name}</p>
                                    <p className="text-[10px] text-slate-400">
                                       {r.orders} commande(s)
                                       {r.livreur_bonus ? <span className="ml-1 text-emerald-600 font-bold">(incl. +{r.livreur_bonus} DA bonus assignation livreur)</span> : null}
                                    </p>
                                 </div>
                                 <span className="font-black text-emerald-600 tabular-nums">{formatPrice(r.commission)}</span>
                              </div>
                           ))}
                        </div>
                     )}
                  </div>
               ))}
            </div>
         )}
      </div>
   );
}

// ─── Preuve de livraison (photo) ───────────────────────────────────────────
export function DeliveryProofUpload({ orderId }: { orderId: string }) {
   const queryClient = useQueryClient();
   const fileRef = useRef<HTMLInputElement>(null);
   const { data } = useQuery({
      queryKey: ['delivery-proof', orderId],
      queryFn: () => apiFetch<{ success: boolean; data: { url: string; date: string | null }[] }>(`/api/v1/orders/${orderId}/delivery-proof`),
      enabled: !!orderId,
   });
   const proofs = data?.data || [];

   const uploadMutation = useMutation({
      mutationFn: async (file: File) => {
         const form = new FormData();
         form.append('file', file);
         const res = await fetch(`/api/v1/orders/${orderId}/delivery-proof`, { method: 'POST', body: form, credentials: 'include' });
         if (!res.ok) throw new Error('Échec de l\'envoi');
         return res.json();
      },
      onSuccess: () => { toast.success('Preuve de livraison ajoutée'); queryClient.invalidateQueries({ queryKey: ['delivery-proof', orderId] }); },
      onError: (err: any) => toast.error('Erreur', { description: err.message }),
   });

   return (
      <div>
         <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5"><Camera className="size-3" /> Preuve de livraison</p>
            <button onClick={() => fileRef.current?.click()} disabled={uploadMutation.isPending}
               className="text-[10px] font-bold text-[#6C5CE7] hover:underline disabled:opacity-50">
               {uploadMutation.isPending ? 'Envoi…' : '+ Ajouter une photo'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
               onChange={e => { const f = e.target.files?.[0]; if (f) uploadMutation.mutate(f); e.target.value = ''; }} />
         </div>
         {proofs.length === 0 ? (
            <p className="text-xs text-slate-300">Aucune photo enregistrée</p>
         ) : (
            <div className="flex flex-wrap gap-2">
               {proofs.map((p, i) => (
                  <a key={i} href={p.url} target="_blank" rel="noreferrer" className="block size-16 rounded-xl overflow-hidden border" style={{ borderColor: C.border }}>
                     <img src={p.url} className="w-full h-full object-cover" alt="Preuve de livraison" />
                  </a>
               ))}
            </div>
         )}
      </div>
   );
}

// ─── Facture / bon de livraison imprimable ─────────────────────────────────
export function printInvoice(order: any) {
   const win = window.open('', '_blank');
   if (!win) return;
   const items = (order.items || []).map((it: any) =>
      `<tr><td>${it.product_name}</td><td style="text-align:center">${it.quantity}</td><td style="text-align:right">${formatPrice(it.unit_price)}</td><td style="text-align:right">${formatPrice(it.unit_price * it.quantity)}</td></tr>`
   ).join('');
   win.document.write(`
      <html><head><title>Facture ${order.order_number}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:40px;color:#2D3436}
        h1{font-size:20px}
        table{width:100%;border-collapse:collapse;margin-top:20px}
        th,td{border-bottom:1px solid #E9ECF0;padding:8px;text-align:left;font-size:13px}
        .total{font-weight:bold;font-size:16px;margin-top:16px;text-align:right}
        .muted{color:#636E72;font-size:12px}
      </style></head><body>
      <h1>Facture / Bon de livraison</h1>
      <p class="muted">Commande #${order.order_number} — ${new Date(order.created_at).toLocaleDateString('fr-FR')}</p>
      <p><strong>${order.customer_name}</strong><br/>${order.customer_phone}<br/>${order.customer_address}, ${order.customer_wilaya}</p>
      <table><thead><tr><th>Produit</th><th>Qté</th><th>PU</th><th>Total</th></tr></thead><tbody>${items}</tbody></table>
      <p class="total">Total : ${formatPrice(order.total)}</p>
      <script>window.print()</script>
      </body></html>
   `);
   win.document.close();
}

export function InvoiceButton({ order }: { order: any }) {
   return (
      <button onClick={() => printInvoice(order)}
         className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors" style={{ borderColor: C.border }}>
         <Printer className="size-3.5" /> Facture / Bon de livraison
      </button>
   );
}

// ─── Vue Kanban des statuts ─────────────────────────────────────────────────
const KANBAN_COLUMNS = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED', 'CANCELLED'] as const;

export function OrdersKanbanView({ orders, onOpenOrder }: { orders: any[]; onOpenOrder: (o: any) => void }) {
   const byStatus: Record<string, any[]> = {};
   KANBAN_COLUMNS.forEach(s => { byStatus[s] = []; });
   orders.forEach(o => { if (byStatus[o.status]) byStatus[o.status].push(o); });

   return (
      <div className="overflow-x-auto pb-4">
         <div className="flex gap-3 min-w-max">
            {KANBAN_COLUMNS.map(status => (
               <div key={status} className="w-64 shrink-0 bg-slate-50 rounded-2xl p-3">
                  <div className="flex items-center gap-2 mb-3 px-1">
                     <span className={cn('size-2 rounded-full', ORDER_STATUS_DOT[status as keyof typeof ORDER_STATUS_DOT])} />
                     <p className="text-xs font-black text-slate-700">{ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS] || status}</p>
                     <span className="ml-auto text-[10px] font-bold text-slate-400 tabular-nums">{byStatus[status].length}</span>
                  </div>
                  <div className="space-y-2 max-h-[70vh] overflow-y-auto">
                     {byStatus[status].map(o => (
                        <button key={o.id} onClick={() => onOpenOrder(o)}
                           className="w-full text-left bg-white rounded-xl p-3 border hover:shadow-md transition-all" style={{ borderColor: C.border }}>
                           <p className="text-xs font-black text-slate-800 font-mono">#{o.order_number}</p>
                           <p className="text-[11px] text-slate-600 mt-1 truncate">{o.customer_name}</p>
                           <div className="flex items-center justify-between mt-1.5">
                              <span className="text-[10px] text-slate-400">{o.customer_wilaya}</span>
                              <span className="text-xs font-bold text-slate-700">{formatPrice(o.total)}</span>
                           </div>
                        </button>
                     ))}
                     {byStatus[status].length === 0 && <p className="text-[10px] text-slate-300 text-center py-4">Vide</p>}
                  </div>
               </div>
            ))}
         </div>
      </div>
   );
}

// ─── Vue Carte des livraisons — regroupée par wilaya (pas de GPS stocké) ───
export function OrdersMapView({ orders, onOpenOrder }: { orders: any[]; onOpenOrder: (o: any) => void }) {
   const byWilaya: Record<string, any[]> = {};
   orders.forEach(o => {
      const w = o.customer_wilaya || 'Non renseignée';
      (byWilaya[w] ||= []).push(o);
   });
   const sorted = Object.entries(byWilaya).sort((a, b) => b[1].length - a[1].length);

   return (
      <div className="space-y-3">
         <div className="flex items-start gap-2 p-3 bg-[#0984E3]/5 border border-[#0984E3]/15 rounded-xl text-[11px] text-slate-500">
            <MapPin className="size-3.5 text-[#0984E3] shrink-0 mt-0.5" />
            Aucune coordonnée GPS n'est enregistrée par commande — regroupement par wilaya, la donnée réellement disponible.
         </div>
         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sorted.map(([wilaya, list]) => (
               <div key={wilaya} className="bg-white rounded-2xl border p-4" style={{ borderColor: C.border }}>
                  <div className="flex items-center gap-2 mb-3">
                     <div className="size-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: C.infoBg }}>
                        <Truck className="size-4" style={{ color: C.info }} />
                     </div>
                     <div>
                        <p className="text-xs font-black text-slate-800">{wilaya}</p>
                        <p className="text-[10px] text-slate-400">{list.length} commande(s)</p>
                     </div>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                     {list.slice(0, 8).map(o => (
                        <button key={o.id} onClick={() => onOpenOrder(o)} className="w-full text-left text-[11px] p-1.5 rounded-lg hover:bg-slate-50 flex justify-between">
                           <span className="font-mono font-bold text-slate-600">#{o.order_number}</span>
                           <span className="text-slate-400">{o.customer_name}</span>
                        </button>
                     ))}
                     {list.length > 8 && <p className="text-[10px] text-slate-300 pl-1.5">+{list.length - 8} autres</p>}
                  </div>
               </div>
            ))}
         </div>
      </div>
   );
}
