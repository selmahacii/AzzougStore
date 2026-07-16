'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Loader2, Clock, Package, PhoneCall, TrendingUp } from 'lucide-react';

interface ErpDetail {
   status_history: { from_status: string | null; to_status: string; actor: string; actor_role: string | null; date: string | null; note: string | null }[];
   call_history: { date: string | null; actor: string; result: string | null; attempt: number | null; note: string | null }[];
   stock_movements: { type: string; quantity: number; product_name: string | null; warehouse_name: string | null; batch_id: string | null; actor: string; reason: string | null; date: string | null }[];
   meta_tracking: { sent: boolean; status: string | null; event_id: string | null; error_message: string | null };
   kpis: Record<string, number | null>;
   livreur: string | null;
   assigned_to: string | null;
}

const KPI_LABELS: Record<string, string> = {
   temps_creation_confirmation_h: 'Création → Confirmation',
   temps_confirmation_expedition_h: 'Confirmation → Expédition',
   temps_expedition_livraison_h: 'Expédition → Livraison',
   temps_total_cycle_h: 'Cycle total',
   nombre_tentatives_livraison: 'Tentatives de livraison',
   nombre_modifications: 'Modifications',
   valeur_commande: 'Valeur',
   cout_livraison: 'Coût livraison',
   cout_produits_estime: 'Coût produits (estimé)',
   marge_estimee: 'Marge estimée',
};

function formatKpi(key: string, value: number | null): string {
   if (value == null) return '—';
   if (key.endsWith('_h')) return `${value}h`;
   if (['valeur_commande', 'cout_livraison', 'cout_produits_estime', 'marge_estimee'].includes(key)) return formatPrice(value);
   return String(value);
}

export function OrderErpDetailPanel({ orderId }: { orderId: string }) {
   const { data, isLoading } = useQuery({
      queryKey: ['order-erp-detail', orderId],
      queryFn: () => apiFetch<{ success: boolean; data: ErpDetail }>(`/api/v1/orders/${orderId}/erp-detail`),
      enabled: !!orderId,
   });
   const d = data?.data;

   if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-slate-300" /></div>;
   if (!d) return null;

   return (
      <div className="space-y-5">
         {/* KPI du cycle de vie */}
         <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5"><Clock className="size-3" /> Cycle de vie</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
               {Object.entries(KPI_LABELS).map(([key, label]) => (
                  <div key={key} className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                     <p className="text-xs font-black text-slate-800 tabular-nums">{formatKpi(key, d.kpis[key] ?? null)}</p>
                     <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wide mt-0.5">{label}</p>
                  </div>
               ))}
            </div>
         </div>

         {/* Historique des statuts */}
         <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Historique des statuts</p>
            {d.status_history.length === 0 ? (
               <p className="text-xs text-slate-400">Aucun changement de statut enregistré</p>
            ) : (
               <div className="space-y-1.5">
                  {d.status_history.map((h, i) => (
                     <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-50">
                        <span className="font-bold text-slate-700">{h.from_status || 'Création'} → {h.to_status}</span>
                        <span className="text-slate-400">{h.actor}{h.date ? ` · ${new Date(h.date).toLocaleString('fr-FR')}` : ''}</span>
                     </div>
                  ))}
               </div>
            )}
         </div>

         {/* Appels / confirmations */}
         {d.call_history.length > 0 && (
            <div>
               <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5"><PhoneCall className="size-3" /> Appels & confirmations</p>
               <div className="space-y-1.5">
                  {d.call_history.map((c, i) => (
                     <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-50">
                        <span className="font-bold text-slate-700">{c.result || 'Appel'}{c.attempt ? ` (tentative ${c.attempt})` : ''}</span>
                        <span className="text-slate-400">{c.actor}{c.date ? ` · ${new Date(c.date).toLocaleString('fr-FR')}` : ''}</span>
                     </div>
                  ))}
               </div>
            </div>
         )}

         {/* Mouvements de stock */}
         {d.stock_movements.length > 0 && (
            <div>
               <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5"><Package className="size-3" /> Mouvements de stock générés</p>
               <div className="space-y-1.5">
                  {d.stock_movements.map((m, i) => (
                     <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-50">
                        <span className="font-bold text-slate-700">{m.product_name || '—'}{m.warehouse_name ? ` · ${m.warehouse_name}` : ''}</span>
                        <span className={cn("font-black tabular-nums", m.quantity >= 0 ? "text-emerald-500" : "text-rose-500")}>{m.quantity >= 0 ? '+' : ''}{m.quantity}</span>
                     </div>
                  ))}
               </div>
            </div>
         )}

         {/* Résumé Meta */}
         <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5"><TrendingUp className="size-3" /> Suivi Meta</p>
            <div className="text-xs p-2.5 rounded-lg bg-slate-50">
               {d.meta_tracking.sent ? (
                  <span className={cn("font-bold", d.meta_tracking.status === 'success' ? "text-emerald-600" : "text-amber-600")}>
                     {d.meta_tracking.status === 'success' ? '✅ Envoyé avec succès' : `⚠️ ${d.meta_tracking.status}`}
                  </span>
               ) : (
                  <span className="text-slate-400 font-bold">Pas encore envoyé à Meta</span>
               )}
               {d.meta_tracking.error_message && <p className="text-[10px] text-rose-500 mt-1">{d.meta_tracking.error_message}</p>}
            </div>
         </div>
      </div>
   );
}
