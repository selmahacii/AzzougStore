'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Box, X, Loader2, ExternalLink, User, Phone, MapPin, DollarSign, Package } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { C } from '../utils';
import { OrderTrackingReport } from '@/components/admin/order-tracking-report';
import { OrderTypeBadge } from '@/components/shared/order-type-badge';

function OrderMicroDetailModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
   const { data: order, isLoading, isError } = useQuery<any>({
      queryKey: ['order-micro-detail', orderId],
      queryFn: () => apiFetch<any>(`/api/v1/orders/${orderId}`),
      enabled: !!orderId,
   });

   return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
         <div className="bg-white w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-200 text-slate-800" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-slate-100 p-6 flex items-center justify-between z-10">
               <div className="flex items-center gap-3">
                  <div className="size-10 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-bold shrink-0">
                     <Package className="size-5" />
                  </div>
                  <div>
                     <h3 className="text-base font-black text-slate-900 flex items-center gap-2 flex-wrap">
                        Commande #{order?.order_number || orderId.slice(0, 8)}
                        {order && <OrderTypeBadge order={order} />}
                     </h3>
                     <p className="text-xs text-slate-400 font-medium mt-0.5">Détails de la transaction et rapport d'attribution Meta CAPI</p>
                  </div>
               </div>
               <button onClick={onClose} className="size-9 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors shrink-0">
                  <X className="size-4 text-slate-500" />
               </button>
            </div>

            <div className="p-6 space-y-6">
               {isLoading ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
                     <Loader2 className="size-8 animate-spin text-indigo-600" />
                     <p className="text-xs font-bold uppercase tracking-wider">Chargement des micro-détails...</p>
                  </div>
               ) : isError || !order ? (
                  <div className="p-8 text-center bg-rose-50 rounded-2xl border border-rose-100 text-rose-700">
                     <p className="font-bold text-sm">Impossible de charger les détails de cette commande.</p>
                     <p className="text-xs text-rose-500 mt-1">ID: {orderId}</p>
                  </div>
               ) : (
                  <>
                     {/* Top Grid: Client & Financials */}
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Client Info */}
                        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2.5">
                           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                              <User className="size-3.5 text-indigo-500" /> Informations Client
                           </p>
                           <div>
                              <p className="font-extrabold text-sm text-slate-800">{order.customer_name || 'Client Inconnu'}</p>
                              <p className="text-xs font-mono font-bold text-slate-600 flex items-center gap-1 mt-1">
                                 <Phone className="size-3 text-slate-400" /> {order.customer_phone || '—'}
                              </p>
                              <p className="text-xs font-medium text-slate-600 flex items-center gap-1 mt-1">
                                 <MapPin className="size-3 text-slate-400" /> {order.customer_wilaya || '—'} {order.customer_commune ? `(${order.customer_commune})` : ''}
                              </p>
                              {order.customer_address && (
                                 <p className="text-[11px] text-slate-500 mt-1 italic">"{order.customer_address}"</p>
                              )}
                           </div>
                        </div>

                        {/* Financials & Status */}
                        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2.5">
                           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                              <DollarSign className="size-3.5 text-emerald-500" /> Montants & Statut
                           </p>
                           <div className="space-y-1 text-xs">
                              <div className="flex justify-between">
                                 <span className="text-slate-500">Sous-total</span>
                                 <span className="font-bold">{formatPrice(order.subtotal || (order.total || 0) - (order.delivery_fee || 0))}</span>
                              </div>
                              <div className="flex justify-between">
                                 <span className="text-slate-500">Livraison</span>
                                 <span className="font-bold">{formatPrice(order.delivery_fee || 0)}</span>
                              </div>
                              <div className="flex justify-between text-sm font-black pt-1.5 border-t border-slate-200">
                                 <span>Total à encaisser</span>
                                 <span className="text-emerald-600 font-mono">{formatPrice(order.total || 0)}</span>
                              </div>
                           </div>
                        </div>
                     </div>

                     {/* Order Items */}
                     {order.items && order.items.length > 0 && (
                        <div className="space-y-2">
                           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Articles de la commande ({order.items.length})</p>
                           <div className="border border-slate-100 rounded-2xl divide-y overflow-hidden bg-slate-50/50">
                              {order.items.map((it: any, idx: number) => (
                                 <div key={idx} className="p-3 flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-3">
                                       {it.image_url ? (
                                          <img src={it.image_url} className="size-9 rounded-lg object-cover border border-slate-200 shrink-0" />
                                       ) : (
                                          <div className="size-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                                             <Package className="size-4 text-slate-400" />
                                          </div>
                                       )}
                                       <div>
                                          <p className="font-bold text-slate-800">{it.product_name || 'Produit'}</p>
                                          <p className="text-[10px] text-slate-400">Qté: x{it.quantity || 1} · {formatPrice(it.unit_price || 0)}/unité</p>
                                       </div>
                                    </div>
                                    <span className="font-black text-slate-700 font-mono">{formatPrice((it.quantity || 1) * (it.unit_price || 0))}</span>
                                 </div>
                              ))}
                           </div>
                        </div>
                     )}

                     {/* Full Meta Tracking Report Component */}
                     <div className="pt-2">
                        <OrderTrackingReport orderId={orderId} />
                     </div>
                  </>
               )}
            </div>
         </div>
      </div>
   );
}

export function ProductDetailSheet({ product, storeId, onClose }: { product: any; storeId: string; onClose: () => void }) {
   const available = Math.max(0, (product.stock || 0) - (product.reserved_stock || 0));
   const stockValue = (product.cost_price || 0) * (product.stock || 0);
   const margin = (product.price || 0) - (product.cost_price || 0);
   const marginPct = product.price > 0 ? Math.round((margin / product.price) * 100) : 0;

   const queryClientPds = useQueryClient();
   const [editingPrice, setEditingPrice] = useState(false);
   const [priceInput, setPriceInput] = useState(String(product.price || 0));
   const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
   const [dateFrom, setDateFrom] = useState<string>('');
   const [dateTo, setDateTo] = useState<string>('');

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
      queryKey: ['product-movements', product.id, dateFrom, dateTo],
      queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/stock/?product_id=${product.id}&pageSize=50${dateFrom ? `&date_from=${dateFrom}` : ''}${dateTo ? `&date_to=${dateTo}` : ''}`),
      enabled: !!product.id,
   });
   const movements = movementsQuery.data?.data || [];
   
   const breakdownQuery = useQuery({
      queryKey: ['product-breakdown', product.id, dateFrom, dateTo],
      queryFn: () => apiFetch<{ success: boolean; data: any }>(`/api/v1/stock/product/${product.id}/breakdown?${dateFrom ? `date_from=${dateFrom}&` : ''}${dateTo ? `date_to=${dateTo}` : ''}`),
      enabled: !!product.id,
   });
   const breakdown = breakdownQuery.data?.data;

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
      <>
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
                     <div className="flex items-center justify-between mb-3">
                         <p className="text-[10px] font-black text-[#B2BEC3] uppercase tracking-widest">Historique & Performances</p>
                         <div className="flex items-center gap-2">
                             <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-xs w-auto" />
                             <span className="text-[#B2BEC3] text-xs">à</span>
                             <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-xs w-auto" />
                         </div>
                     </div>
                     
                     {breakdown && (
                        <div className="grid grid-cols-2 gap-3 mb-4">
                           <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 flex justify-between items-center">
                              <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Livrée</span>
                              <span className="text-sm font-black text-emerald-700">{breakdown.stock_livree || 0} pcs</span>
                           </div>
                           <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 flex justify-between items-center">
                              <span className="text-[10px] font-black text-rose-600 uppercase tracking-widest">Retournée</span>
                              <span className="text-sm font-black text-rose-700">{breakdown.stock_retourne || 0} pcs</span>
                           </div>
                        </div>
                     )}

                     <div className="border rounded-xl divide-y max-h-[280px] overflow-y-auto" style={{ borderColor: C.border }}>
                        {movementsQuery.isLoading ? (
                           <div className="p-6 flex justify-center"><Loader2 className="size-5 animate-spin text-[#6C5CE7]" /></div>
                        ) : movements.length === 0 ? (
                           <p className="p-6 text-center text-[10px] font-bold text-[#B2BEC3] uppercase">Aucun mouvement enregistré</p>
                        ) : movements.map((m: any) => {
                           const hasOrder = !!m.order_id;
                           return (
                              <div
                                 key={m.id}
                                 onClick={() => { if (m.order_id) setSelectedOrderId(m.order_id); }}
                                 className={cn(
                                    "p-3 flex items-center justify-between text-xs transition-all my-0.5 rounded-lg",
                                    hasOrder ? "cursor-pointer hover:bg-indigo-50/80 hover:border-indigo-200 group border border-transparent" : ""
                                 )}
                              >
                                 <div>
                                    <div className="flex items-center gap-1.5">
                                       <p className="font-bold text-[#2D3436]">{m.type.replace(/_/g, ' ')}</p>
                                       {hasOrder && (
                                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black bg-indigo-100 text-indigo-700 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                             <ExternalLink className="size-2.5" /> Voir commande #{m.order_number || m.order_id.slice(0, 8)}
                                          </span>
                                       )}
                                    </div>
                                    <p className="text-[10px] text-[#B2BEC3] mt-0.5">
                                       {new Date(m.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                       {m.actor?.name && ` · ${m.actor.name}`}
                                       {m.order_number && !m.order_id && ` · Cmd #${m.order_number}`}
                                    </p>
                                 </div>
                                 <span className={cn("font-black tabular-nums shrink-0 ml-2", m.quantity >= 0 ? "text-[#00B894]" : "text-[#E17055]")}>
                                    {m.quantity >= 0 ? '+' : ''}{m.quantity}
                                 </span>
                              </div>
                           );
                        })}
                     </div>
                  </div>
               </div>
            </div>
         </div>

         {selectedOrderId && (
            <OrderMicroDetailModal
               orderId={selectedOrderId}
               onClose={() => setSelectedOrderId(null)}
            />
         )}
      </>
   );
}
