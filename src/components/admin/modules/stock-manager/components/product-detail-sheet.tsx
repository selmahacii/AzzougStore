'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Box, X, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { C } from '../utils';

export function ProductDetailSheet({ product, storeId, onClose }: { product: any; storeId: string; onClose: () => void }) {
   const available = Math.max(0, (product.stock || 0) - (product.reserved_stock || 0));
   const stockValue = (product.cost_price || 0) * (product.stock || 0);
   const margin = (product.price || 0) - (product.cost_price || 0);
   const marginPct = product.price > 0 ? Math.round((margin / product.price) * 100) : 0;

   const queryClientPds = useQueryClient();
   const [editingPrice, setEditingPrice] = useState(false);
   const [priceInput, setPriceInput] = useState(String(product.price || 0));
   const priceMutation = useMutation({
      mutationFn: () => apiFetch(`/api/v1/products/${product.id}`, {
         method: 'PATCH',
         body: JSON.stringify({ price: parseInt(priceInput) || 0 }),
      }),
      onSuccess: () => {
         toast.success('Prix mis à jour');
         setEditingPrice(false);
         queryClientPds.invalidateQueries({ queryKey: ['admin-products-stock'] });
      },
      onError: (err: any) => toast.error('Erreur', { description: err.message }),
   });

   const movementsQuery = useQuery({
      queryKey: ['product-movements', product.id],
      queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/stock/?product_id=${product.id}&pageSize=15`),
      enabled: !!product.id,
   });
   const movements = movementsQuery.data?.data || [];

   const variantItems = (() => {
      if (!product.variants || product.variants.length === 0) return [];
      const items: Array<{ variantStr: string; stock: number; reserved: number }> = [];
      product.variants.forEach((v: any) => {
         let vars = v;
         if (typeof vars === 'string') { try { vars = JSON.parse(vars); } catch { return; } }
         if (vars.sub_variants && vars.sub_variants.length > 0) {
            vars.sub_variants.forEach((sv: any) => {
               items.push({ variantStr: `${vars.name}: ${vars.value}, ${sv.name || 'Taille'}: ${sv.value}`, stock: sv.stock || 0, reserved: sv.reserved || 0 });
            });
         } else {
            items.push({ variantStr: `${vars.name}: ${vars.value}`, stock: vars.stock || 0, reserved: vars.reserved || 0 });
         }
      });
      return items;
   })();

   return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={onClose}>
         <div className="bg-white w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-3xl shadow-2xl border border-white/20 animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
            <div className="p-8 space-y-6">
               <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                     <div className="size-16 bg-[#F8F9FC] border rounded-2xl overflow-hidden shrink-0" style={{ borderColor: C.border }}>
                        {product.main_image ? <img src={product.main_image} className="size-full object-cover" /> : <Box className="size-full p-4 opacity-10 text-[#2D3436]" />}
                     </div>
                     <div>
                        <h2 className="text-lg font-black text-[#2D3436] uppercase tracking-tight">{product.name}</h2>
                        <p className="text-[10px] font-black text-[#6C5CE7] font-mono tracking-wider mt-0.5">SKU: {product.slug || 'N/A'}</p>
                        {product.category && <p className="text-[10px] font-bold text-[#B2BEC3] uppercase mt-0.5">{product.category}</p>}
                     </div>
                  </div>
                  <button onClick={onClose} className="size-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors shrink-0">
                     <X className="size-4 text-slate-400" />
                  </button>
               </div>

               <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                     { label: 'Prix vente', value: formatPrice(product.price || 0) },
                     { label: 'Prix achat', value: formatPrice(product.cost_price || 0) },
                     { label: 'Marge', value: `${formatPrice(margin)} (${marginPct}%)` },
                     { label: 'Valeur du stock', value: formatPrice(stockValue) },
                     { label: 'Disponible', value: product.stock ?? 0 },
                     { label: 'Réservé', value: product.reserved_stock ?? 0 },
                     { label: 'En cours (vendable)', value: available },
                     { label: 'Seuil alerte', value: product.low_stock_threshold ?? 5 },
                  ].map(s => (
                     <div key={s.label} className="p-3 rounded-xl bg-[#F8F9FC] border" style={{ borderColor: C.border }}>
                        <p className="text-[9px] font-black text-[#B2BEC3] uppercase tracking-widest">{s.label}</p>
                        <p className="text-sm font-black text-[#2D3436] mt-0.5 tabular-nums">{s.value}</p>
                     </div>
                  ))}
               </div>

               {product.is_upsell_only && (
                  <div className="p-4 rounded-2xl border bg-[#F0EDFF] border-[#6C5CE7]/20">
                     <p className="text-[9px] font-black text-[#6C5CE7] uppercase tracking-widest mb-2">Produit Upsell Indépendant — prix modifiable ici</p>
                     {editingPrice ? (
                        <div className="flex items-center gap-2">
                           <Input type="number" value={priceInput} onChange={e => setPriceInput(e.target.value)} className="h-9 w-32 bg-white" />
                           <span className="text-xs font-bold text-[#636E72]">DA</span>
                           <Button size="sm" onClick={() => priceMutation.mutate()} disabled={priceMutation.isPending} className="h-9">
                              {priceMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : 'Enregistrer'}
                           </Button>
                           <Button size="sm" variant="outline" onClick={() => { setEditingPrice(false); setPriceInput(String(product.price || 0)); }} className="h-9">Annuler</Button>
                        </div>
                     ) : (
                        <Button size="sm" variant="outline" onClick={() => setEditingPrice(true)} className="h-9">
                           Modifier le prix ({formatPrice(product.price || 0)})
                        </Button>
                     )}
                  </div>
               )}

               {variantItems.length > 0 && (
                  <div>
                     <p className="text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest mb-2">Variantes</p>
                     <div className="flex flex-wrap gap-1.5">
                        {variantItems.map((vi, i) => (
                           <span key={i} className="px-2 py-1 rounded-lg bg-[#F8F9FC] border text-[10px] font-bold text-[#636E72]" style={{ borderColor: C.border }}>
                              {vi.variantStr} — {vi.stock} dispo{vi.reserved > 0 ? ` / ${vi.reserved} résa` : ''}
                           </span>
                        ))}
                     </div>
                  </div>
               )}

               <div>
                  <p className="text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest mb-2">Historique récent de ce produit</p>
                  <div className="border rounded-xl divide-y max-h-[280px] overflow-y-auto" style={{ borderColor: C.border }}>
                     {movementsQuery.isLoading ? (
                        <div className="p-6 flex justify-center"><Loader2 className="size-5 animate-spin text-[#6C5CE7]" /></div>
                     ) : movements.length === 0 ? (
                        <p className="p-6 text-center text-[10px] font-bold text-[#B2BEC3] uppercase">Aucun mouvement enregistré</p>
                     ) : movements.map((m: any) => (
                        <div key={m.id} className="p-3 flex items-center justify-between text-xs">
                           <div>
                              <p className="font-bold text-[#2D3436]">{m.type.replace(/_/g, ' ')}</p>
                              <p className="text-[10px] text-[#B2BEC3]">
                                 {new Date(m.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                 {m.actor?.name && ` · ${m.actor.name}`}
                                 {m.order_number && ` · Cmd #${m.order_number}`}
                              </p>
                           </div>
                           <span className={cn("font-black tabular-nums", m.quantity >= 0 ? "text-[#00B894]" : "text-[#E17055]")}>
                              {m.quantity >= 0 ? '+' : ''}{m.quantity}
                           </span>
                        </div>
                     ))}
                  </div>
               </div>
            </div>
         </div>
      </div>
   );
}
