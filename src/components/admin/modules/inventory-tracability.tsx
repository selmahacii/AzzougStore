'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { Truck, ShieldAlert, AlertTriangle, Loader2, Search, MapPin } from 'lucide-react';

const C = {
   primary: '#6C5CE7', primaryBg: '#F0EDFF',
   success: '#00B894', successBg: '#E6FFF8',
   danger: '#E17055', dangerBg: '#FFEDE9',
   warning: '#FDCB6E', warningBg: '#FFF8E6',
   info: '#0984E3', infoBg: '#E8F4FE',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

// ─── Section 10 — Inventaire des livreurs ────────────────────────────────
interface LivreurRow {
   livreur_id: string; name: string; total_orders: number;
   stock_en_main: number; stock_vendu: number; stock_retourne: number;
   valeur_en_main: number; valeur_vendue: number; valeur_retournee: number;
   produits_perdus: number | null; produits_casses: number | null;
}

export function LivreursInventoryView() {
   const activeStore = useAppStore(s => s.activeStore);
   const { data, isLoading } = useQuery({
      queryKey: ['stock-livreurs', activeStore?.id],
      queryFn: () => apiFetch<{ success: boolean; data: LivreurRow[]; note: string }>(`/api/v1/stock/livreurs?store_id=${activeStore?.id}`),
      enabled: !!activeStore?.id,
   });
   const rows = data?.data || [];

   return (
      <div className="bg-white border rounded-2xl overflow-hidden shadow-sm animate-in slide-in-from-bottom-2 duration-400" style={{ borderColor: C.border }}>
         <div className="p-6 border-b" style={{ borderColor: C.border }}>
            <h3 className="text-sm font-extrabold text-[#2D3436] uppercase tracking-wider flex items-center gap-2">
               <Truck className="size-4 text-[#6C5CE7]" /> Inventaire des livreurs
            </h3>
            <p className="text-[10px] font-bold text-[#B2BEC3] uppercase tracking-widest mt-1">Comparaison rapide entre tous les livreurs</p>
         </div>
         {data?.note && (
            <div className="mx-6 mt-4 p-3 bg-[#FFF8E6] border border-[#FFF0CB] rounded-xl text-[11px] font-semibold text-[#B08B00] flex items-start gap-2">
               <AlertTriangle className="size-3.5 shrink-0 mt-0.5" /> {data.note}
            </div>
         )}
         <div className="overflow-x-auto p-6">
            {isLoading ? (
               <div className="p-10 flex justify-center"><Loader2 className="size-6 animate-spin text-[#6C5CE7]" /></div>
            ) : rows.length === 0 ? (
               <div className="p-16 text-center text-[10px] font-bold text-[#B2BEC3] uppercase">Aucun livreur avec des commandes assignées</div>
            ) : (
               <table className="w-full text-left">
                  <thead>
                     <tr className="border-b" style={{ borderColor: C.border }}>
                        <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Livreur</th>
                        <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3] text-center">En main</th>
                        <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-[#00B894] text-center">Vendu</th>
                        <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-[#E17055] text-center">Retourné</th>
                        <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3] text-right">Valeur en main</th>
                        <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3] text-right">Valeur vendue</th>
                        <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3] text-right">Valeur retournée</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: C.border }}>
                     {rows.map(r => (
                        <tr key={r.livreur_id} className="hover:bg-[#FAFBFD]">
                           <td className="py-3">
                              <p className="text-xs font-black text-[#2D3436]">{r.name}</p>
                              <p className="text-[9px] font-bold text-[#B2BEC3]">{r.total_orders} commande(s) au total</p>
                           </td>
                           <td className="py-3 text-center text-sm font-black text-[#2D3436] tabular-nums">{r.stock_en_main}</td>
                           <td className="py-3 text-center text-sm font-black text-[#00B894] tabular-nums">{r.stock_vendu}</td>
                           <td className="py-3 text-center text-sm font-black text-[#E17055] tabular-nums">{r.stock_retourne}</td>
                           <td className="py-3 text-right text-xs font-bold text-[#636E72] tabular-nums">{formatPrice(r.valeur_en_main)}</td>
                           <td className="py-3 text-right text-xs font-bold text-[#636E72] tabular-nums">{formatPrice(r.valeur_vendue)}</td>
                           <td className="py-3 text-right text-xs font-bold text-[#636E72] tabular-nums">{formatPrice(r.valeur_retournee)}</td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            )}
         </div>
      </div>
   );
}

// ─── Section 8 — Traçabilité complète (AuditLog) ─────────────────────────
interface AuditRow {
   id: string; entity: string; entity_id: string; action: string;
   diff: any; ip_address: string | null; user_agent: string | null;
   created_at: string; actor?: { id: string; name: string; role?: string | null };
}

export function TracabilityView() {
   const activeStore = useAppStore(s => s.activeStore);
   const [entity, setEntity] = useState('');
   const [search, setSearch] = useState('');
   const [page, setPage] = useState(1);

   const { data, isLoading } = useQuery({
      queryKey: ['audit-log', activeStore?.id, entity, search, page],
      queryFn: () => {
         const params = new URLSearchParams({ store_id: activeStore?.id || '', page: String(page), pageSize: '30' });
         if (entity) params.set('entity', entity);
         if (search) params.set('search', search);
         return apiFetch<{ success: boolean; data: AuditRow[]; total: number; totalPages: number }>(`/api/v1/audit/?${params.toString()}`);
      },
      enabled: !!activeStore?.id,
   });
   const rows = data?.data || [];

   return (
      <div className="bg-white border rounded-2xl overflow-hidden shadow-sm animate-in slide-in-from-bottom-2 duration-400" style={{ borderColor: C.border }}>
         <div className="p-6 border-b" style={{ borderColor: C.border }}>
            <h3 className="text-sm font-extrabold text-[#2D3436] uppercase tracking-wider flex items-center gap-2">
               <ShieldAlert className="size-4 text-[#6C5CE7]" /> Traçabilité complète
            </h3>
            <p className="text-[10px] font-bold text-[#B2BEC3] uppercase tracking-widest mt-1">Qui, quand, quelle action, adresse IP</p>
         </div>
         <div className="flex flex-wrap items-center gap-2 px-6 py-3 bg-[#F8F9FC] border-b" style={{ borderColor: C.border }}>
            <select value={entity} onChange={e => { setEntity(e.target.value); setPage(1); }}
               className="h-8 rounded-lg border bg-white px-2 text-[11px] font-bold text-[#2D3436]" style={{ borderColor: C.border }}>
               <option value="">Toutes les entités</option>
               <option value="product">Produit</option>
               <option value="order">Commande</option>
               <option value="stock_movement">Mouvement de stock</option>
               <option value="warehouse">Entrepôt</option>
            </select>
            <div className="relative">
               <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#B2BEC3]" />
               <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Acteur, action, référence…"
                  className="h-8 rounded-lg border bg-white pl-8 pr-2 text-[11px] font-bold text-[#2D3436] w-56" style={{ borderColor: C.border }} />
            </div>
            <span className="ml-auto text-[10px] font-bold text-[#B2BEC3]">{data?.total ?? 0} événement(s)</span>
         </div>
         <div className="divide-y" style={{ borderColor: C.border }}>
            {isLoading ? (
               <div className="p-10 flex justify-center"><Loader2 className="size-6 animate-spin text-[#6C5CE7]" /></div>
            ) : rows.length === 0 ? (
               <div className="p-16 text-center text-[10px] font-bold text-[#B2BEC3] uppercase">Aucun événement enregistré</div>
            ) : rows.map(a => (
               <div key={a.id} className="p-4 hover:bg-[#FAFBFD]">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                     <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black text-[#2D3436]">{a.action}</span>
                        <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-[#F0EDFF] text-[#6C5CE7]">{a.entity}</span>
                        <span className="text-[10px] font-bold text-[#B2BEC3] font-mono">#{a.entity_id.split('-')[0]}</span>
                     </div>
                     <span className="text-[10px] font-bold text-[#B2BEC3]">{new Date(a.created_at).toLocaleString('fr-FR')}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[10px] font-bold text-[#636E72]">
                     <span>{a.actor?.name || 'Système'}{a.actor?.role ? ` · ${a.actor.role}` : ''}</span>
                     {a.ip_address && <span className="font-mono text-[#B2BEC3]">IP: {a.ip_address}</span>}
                  </div>
                  {a.diff && (
                     <pre className="mt-2 text-[9px] bg-[#F8F9FC] border rounded-lg p-2 overflow-x-auto text-[#636E72]" style={{ borderColor: C.border }}>
                        {typeof a.diff === 'string' ? a.diff : JSON.stringify(a.diff)}
                     </pre>
                  )}
               </div>
            ))}
         </div>
         {(data?.totalPages ?? 1) > 1 && (
            <div className="p-4 bg-[#F8F9FC] border-t flex items-center justify-between" style={{ borderColor: C.border }}>
               <span className="text-[10px] font-bold text-[#B2BEC3]">Page {page} / {data?.totalPages}</span>
               <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                     className="px-3 py-1.5 rounded-lg border text-[10px] font-bold disabled:opacity-40" style={{ borderColor: C.border }}>Précédent</button>
                  <button onClick={() => setPage(p => Math.min(data?.totalPages || 1, p + 1))} disabled={page >= (data?.totalPages || 1)}
                     className="px-3 py-1.5 rounded-lg border text-[10px] font-bold disabled:opacity-40" style={{ borderColor: C.border }}>Suivant</button>
               </div>
            </div>
         )}
      </div>
   );
}

// ─── Section 9 — Analyse des écarts ──────────────────────────────────────
interface Discrepancy {
   type: string; severity: 'high' | 'medium'; detail: string;
   product_id?: string; product_name?: string; order_id?: string; order_number?: string;
}

const DISCREPANCY_LABELS: Record<string, string> = {
   STOCK_NEGATIF: 'Stock négatif',
   LIVREE_SANS_SORTIE_STOCK: 'Commande livrée sans sortie de stock',
   RETOUR_SANS_REINTEGRATION: 'Commande retournée sans retour de stock',
   REINTEGRATION_SANS_COMMANDE: 'Retour de stock sans commande',
   DOUBLE_MOUVEMENT: 'Double mouvement détecté',
   PRODUIT_ORPHELIN: 'Produit orphelin',
};

export function DiscrepanciesView() {
   const activeStore = useAppStore(s => s.activeStore);
   const { data, isLoading } = useQuery({
      queryKey: ['stock-discrepancies', activeStore?.id],
      queryFn: () => apiFetch<{ success: boolean; data: Discrepancy[]; total: number; high_severity: number }>(`/api/v1/stock/discrepancies?store_id=${activeStore?.id}`),
      enabled: !!activeStore?.id,
      refetchInterval: 120000,
      refetchIntervalInBackground: false,
   });
   const findings = data?.data || [];

   return (
      <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-400">
         <div className={cn("p-5 rounded-xl flex items-center gap-4 border", findings.length > 0 ? "bg-[#FFEDE9] border-[#FAD9D1]" : "bg-[#E6FFF8] border-[#C2F5E6]")}>
            <div className="size-10 bg-white rounded-lg flex items-center justify-center shrink-0">
               <AlertTriangle className={cn("size-5", findings.length > 0 ? "text-[#E17055]" : "text-[#00B894]")} />
            </div>
            <div>
               <h3 className={cn("text-sm font-extrabold", findings.length > 0 ? "text-[#E17055]" : "text-[#00B894]")}>
                  {findings.length === 0 ? 'Aucun écart détecté' : `${data?.total} écart(s) détecté(s), dont ${data?.high_severity} critique(s)`}
               </h3>
               <p className={cn("text-xs font-semibold mt-0.5", findings.length > 0 ? "text-[#E17055]/80" : "text-[#00B894]/80")}>
                  Stock négatif, mouvements manquants, doublons, produits orphelins — détection automatique
               </p>
            </div>
         </div>
         <div className="bg-white border rounded-xl overflow-hidden" style={{ borderColor: C.border }}>
            {isLoading ? (
               <div className="p-10 flex justify-center"><Loader2 className="size-6 animate-spin text-[#6C5CE7]" /></div>
            ) : findings.length === 0 ? (
               <div className="p-16 text-center text-[10px] font-bold text-[#B2BEC3] uppercase">Rien à signaler</div>
            ) : (
               <div className="divide-y" style={{ borderColor: C.border }}>
                  {findings.map((f, i) => (
                     <div key={i} className="p-4 flex items-center gap-3">
                        <span className={cn("size-2 rounded-full shrink-0", f.severity === 'high' ? "bg-rose-500" : "bg-amber-400")} />
                        <div className="flex-1">
                           <p className="text-xs font-black text-[#2D3436]">{DISCREPANCY_LABELS[f.type] || f.type}</p>
                           <p className="text-[10px] font-semibold text-[#636E72] mt-0.5">
                              {f.detail}
                              {f.order_number && ` · Commande #${f.order_number}`}
                              {f.product_name && ` · ${f.product_name}`}
                           </p>
                        </div>
                        <span className={cn(
                           "text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-md",
                           f.severity === 'high' ? "bg-[#FFEDE9] text-[#E17055]" : "bg-[#FFF8E6] text-[#FDCB6E]"
                        )}>{f.severity === 'high' ? 'Critique' : 'À vérifier'}</span>
                     </div>
                  ))}
               </div>
            )}
         </div>
      </div>
   );
}
