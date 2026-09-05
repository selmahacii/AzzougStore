'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Box, X, Loader2, ExternalLink, User, Phone, MapPin, DollarSign, Package, TrendingUp, TrendingDown, BarChart2, Activity } from 'lucide-react';
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
            <div className="sticky top-0 bg-white/80 backdrop-blur-xl border-b p-4 flex items-center justify-between z-10">
               <div>
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Détails de la commande</h3>
                  {order && <p className="text-[10px] font-bold text-slate-500 font-mono mt-0.5">#{order.order_number}</p>}
               </div>
               <button onClick={onClose} className="size-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-full flex items-center justify-center transition-colors">
                  <X className="size-4" />
               </button>
            </div>
            
            <div className="p-6">
               {isLoading ? (
                  <div className="py-20 flex flex-col items-center justify-center gap-3">
                     <Loader2 className="size-6 text-indigo-500 animate-spin" />
                     <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Chargement de la commande...</p>
                  </div>
               ) : isError || !order ? (
                  <div className="py-20 text-center text-red-500 font-bold text-sm">Erreur ou commande introuvable</div>
               ) : (
                  <div className="space-y-6">
                     {/* En-tête client & statuts */}
                     <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div>
                           <div className="flex items-center gap-2 mb-2">
                              <h2 className="text-xl font-black text-slate-800">{order.customer_name}</h2>
                              <OrderTypeBadge order={order} />
                           </div>
                           <div className="flex flex-col gap-1.5 text-sm font-medium text-slate-600">
                              <span className="flex items-center gap-2"><Phone className="size-3.5 text-slate-400" /> <a href={`tel:${order.customer_phone}`} className="hover:text-indigo-600 hover:underline">{order.customer_phone}</a></span>
                              {order.customer_phone_2 && <span className="flex items-center gap-2"><Phone className="size-3.5 text-slate-400" /> <a href={`tel:${order.customer_phone_2}`} className="hover:text-indigo-600 hover:underline">{order.customer_phone_2}</a></span>}
                              <span className="flex items-center gap-2"><MapPin className="size-3.5 text-slate-400" /> {order.wilaya} — {order.commune}</span>
                           </div>
                        </div>
                        <div className="flex flex-col md:items-end gap-2 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                           <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total</span>
                              <span className="text-lg font-black text-emerald-600">{formatPrice(order.total_price)}</span>
                           </div>
                           <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Livraison</span>
                              <span className="text-sm font-bold text-slate-600">{formatPrice(order.shipping_cost)}</span>
                           </div>
                        </div>
                     </div>
                     
                     <div className="h-px w-full bg-slate-100" />
                     
                     {/* Produits */}
                     <div>
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Produits commandés ({order.items?.length || 0})</h4>
                        <div className="grid gap-2">
                           {order.items?.map((item: any) => (
                              <div key={item.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/50 gap-3">
                                 <div className="flex items-center gap-3">
                                    <div className="size-10 bg-white border rounded-lg overflow-hidden shrink-0">
                                       {item.product_image ? <img src={item.product_image} className="size-full object-cover" /> : <Package className="size-full p-2.5 opacity-20" />}
                                    </div>
                                    <div>
                                       <p className="text-sm font-bold text-slate-800">{item.product_name}</p>
                                       {item.variant_string && <p className="text-xs text-slate-500 mt-0.5">{item.variant_string}</p>}
                                    </div>
                                 </div>
                                 <div className="flex items-center gap-4 text-sm shrink-0">
                                    <span className="font-bold text-slate-600">{item.quantity} × {formatPrice(item.unit_price)}</span>
                                    <span className="font-black text-slate-800">{formatPrice(item.quantity * item.unit_price)}</span>
                                 </div>
                              </div>
                           ))}
                        </div>
                     </div>
                     
                     {/* Timeline */}
                     <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                        <OrderTrackingReport order={order} />
                     </div>
                  </div>
               )}
            </div>
         </div>
      </div>
   );
}


export function ProductDetailSheet({ product, onClose }: { product: any; onClose: () => void }) {
   const qc = useQueryClient();
   const [editingPrice, setEditingPrice] = useState(false);
   const [priceInput, setPriceInput] = useState(String(product.price || 0));
   const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
   const [dateFrom, setDateFrom] = useState<string>('');
   const [dateTo, setDateTo] = useState<string>('');
   
   // Tabs Meta Ads Style
   const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'settings'>('overview');

   const movementsQuery = useQuery({
      queryKey: ['product-movements', product.id, dateFrom, dateTo],
      queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/stock/?product_id=${product.id}&pageSize=100${dateFrom ? `&date_from=${dateFrom}` : ''}${dateTo ? `&date_to=${dateTo}` : ''}`),
      enabled: !!product.id,
   });
   const movements = movementsQuery.data?.data || [];
   
   const breakdownQuery = useQuery({
      queryKey: ['product-breakdown', product.id, dateFrom, dateTo],
      queryFn: () => apiFetch<{ success: boolean; data: any }>(`/api/v1/stock/product/${product.id}/breakdown?${dateFrom ? `date_from=${dateFrom}&` : ''}${dateTo ? `date_to=${dateTo}` : ''}`),
      enabled: !!product.id,
   });
   const breakdown = breakdownQuery.data?.data;

   const priceMutation = useMutation({
      mutationFn: () => apiFetch(`/api/v1/products/${product.id}`, {
         method: 'PATCH',
         body: JSON.stringify({ price: parseFloat(priceInput) })
      }),
      onSuccess: () => {
         toast.success("Prix mis à jour");
         setEditingPrice(false);
         qc.invalidateQueries({ queryKey: ['products'] });
      },
      onError: (e: any) => toast.error(e.message)
   });

   const available = Math.max(0, (product.stock || 0) - (product.reserved_stock || 0));
   const stockValue = (product.stock || 0) * (product.cost_price || 0);
   const margin = (product.price || 0) - (product.cost_price || 0);
   const marginPct = product.cost_price ? Math.round((margin / product.cost_price) * 100) : 100;
   
   const livree = breakdown?.stock_livree || 0;
   const retournee = breakdown?.stock_retourne || 0;
   const totalShipped = livree + retournee;
   const returnRate = totalShipped > 0 ? Math.round((retournee / totalShipped) * 100) : 0;
   const marginGenerated = livree * margin;

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
         <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={onClose}>
            {/* Slide-over Meta Ads Style */}
            <div className="bg-white w-full max-w-4xl h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300" onClick={e => e.stopPropagation()}>
               
               {/* Meta Ads Header */}
               <div className="border-b bg-slate-50/50" style={{ borderColor: C.border }}>
                  <div className="p-6 pb-4">
                     <div className="flex items-start justify-between">
                        <div className="flex items-center gap-5">
                           <div className="size-20 bg-white border rounded-2xl overflow-hidden shrink-0 shadow-sm" style={{ borderColor: C.border }}>
                              {product.main_image ? <img src={product.main_image} className="size-full object-cover" /> : <Box className="size-full p-5 opacity-10 text-slate-800" />}
                           </div>
                           <div>
                              <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tight">{product.name}</h2>
                              <div className="flex items-center gap-3 mt-1.5">
                                 <span className="px-2 py-0.5 rounded bg-indigo-50 border border-indigo-100 text-indigo-700 text-[10px] font-black font-mono tracking-wider">SKU: {product.slug || 'N/A'}</span>
                                 {product.category && <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1"><Box className="size-3" /> {product.category}</span>}
                              </div>
                           </div>
                        </div>
                        <button onClick={onClose} className="size-10 rounded-full flex items-center justify-center bg-white border shadow-sm hover:bg-slate-50 transition-colors shrink-0" style={{ borderColor: C.border }}>
                           <X className="size-5 text-slate-500" />
                        </button>
                     </div>
                  </div>
                  
                  {/* Meta Ads Tabs */}
                  <div className="flex items-center gap-8 px-6">
                     {[
                        { id: 'overview', label: 'Aperçu & Performances', icon: Activity },
                        { id: 'history', label: 'Historique des mouvements', icon: BarChart2 },
                        { id: 'settings', label: 'Paramètres du produit', icon: Package },
                     ].map(t => {
                        const active = activeTab === t.id;
                        const Icon = t.icon;
                        return (
                           <button
                              key={t.id}
                              onClick={() => setActiveTab(t.id as any)}
                              className={cn(
                                 "flex items-center gap-2 pb-3 border-b-2 transition-colors",
                                 active ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700"
                              )}
                           >
                              <Icon className={cn("size-4", active ? "text-indigo-600" : "text-slate-400")} />
                              <span className="text-[11px] font-black uppercase tracking-wider">{t.label}</span>
                           </button>
                        );
                     })}
                  </div>
               </div>

               {/* Tab Content Area */}
               <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
                  
                  {/* TAB: OVERVIEW */}
                  {activeTab === 'overview' && (
                     <div className="space-y-6">
                        {/* KPI SECTION (Meta Ads Style) */}
                        <div className="bg-white rounded-2xl border shadow-sm p-5" style={{ borderColor: C.border }}>
                           <div className="flex items-center justify-between mb-5">
                              <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                                 <TrendingUp className="size-3.5" /> Métriques de Performance
                              </h3>
                              <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border" style={{ borderColor: C.border }}>
                                 <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-7 text-xs w-auto bg-transparent border-none shadow-none focus-visible:ring-0" />
                                 <span className="text-slate-400 text-xs font-bold">à</span>
                                 <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-7 text-xs w-auto bg-transparent border-none shadow-none focus-visible:ring-0" />
                              </div>
                           </div>

                           <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              <div className="space-y-1">
                                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Quantité Livrée</p>
                                 <div className="flex items-baseline gap-2">
                                    <p className="text-2xl font-black text-emerald-600">{livree}</p>
                                    <span className="text-xs font-bold text-emerald-600/70">pcs</span>
                                 </div>
                              </div>
                              <div className="space-y-1">
                                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Quantité Retournée</p>
                                 <div className="flex items-baseline gap-2">
                                    <p className="text-2xl font-black text-rose-600">{retournee}</p>
                                    <span className="text-xs font-bold text-rose-600/70">pcs</span>
                                 </div>
                              </div>
                              <div className="space-y-1">
                                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Taux de Retour</p>
                                 <div className="flex items-baseline gap-2">
                                    <p className="text-2xl font-black text-slate-800">{returnRate}%</p>
                                    {returnRate > 30 ? <TrendingDown className="size-4 text-rose-500" /> : <TrendingUp className="size-4 text-emerald-500" />}
                                 </div>
                              </div>
                              <div className="space-y-1">
                                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Marge Générée</p>
                                 <p className="text-2xl font-black text-indigo-600">{formatPrice(marginGenerated)}</p>
                              </div>
                           </div>
                        </div>

                        {/* STOCK METRICS */}
                        <div className="bg-white rounded-2xl border shadow-sm p-5" style={{ borderColor: C.border }}>
                           <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 mb-5">
                              <Package className="size-3.5" /> État du Stock
                           </h3>
                           <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                              {[
                                 { label: 'Disponible', value: product.stock ?? 0, color: 'text-slate-800' },
                                 { label: 'Réservé', value: product.reserved_stock ?? 0, color: 'text-amber-600' },
                                 { label: 'En cours', value: available, color: 'text-emerald-600' },
                                 { label: 'Seuil alerte', value: product.low_stock_threshold ?? 5, color: 'text-rose-600' },
                                 { label: 'Valeur', value: formatPrice(stockValue), color: 'text-slate-800' },
                              ].map(s => (
                                 <div key={s.label} className="p-3 rounded-xl bg-slate-50 border" style={{ borderColor: C.border }}>
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{s.label}</p>
                                    <p className={cn("text-sm font-black mt-1 tabular-nums", s.color)}>{s.value}</p>
                                 </div>
                              ))}
                           </div>
                        </div>
                        
                        {/* VARIANTS OVERVIEW */}
                        {variantItems.length > 0 && (
                           <div className="bg-white rounded-2xl border shadow-sm p-5" style={{ borderColor: C.border }}>
                              <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-4">Stock par Variante</h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                 {variantItems.map((vi, i) => (
                                    <div key={i} className="p-3 rounded-xl bg-slate-50 border flex items-center justify-between" style={{ borderColor: C.border }}>
                                       <span className="text-xs font-bold text-slate-700">{vi.variantStr}</span>
                                       <div className="flex items-center gap-3">
                                          <div className="text-right">
                                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Dispo</p>
                                             <p className="text-xs font-black text-emerald-600">{vi.stock}</p>
                                          </div>
                                          {vi.reserved > 0 && (
                                             <div className="text-right border-l pl-3" style={{ borderColor: C.border }}>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Résa</p>
                                                <p className="text-xs font-black text-amber-600">{vi.reserved}</p>
                                             </div>
                                          )}
                                       </div>
                                    </div>
                                 ))}
                              </div>
                           </div>
                        )}
                     </div>
                  )}

                  {/* TAB: HISTORY */}
                  {activeTab === 'history' && (
                     <div className="bg-white rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: C.border }}>
                        <div className="p-4 border-b bg-slate-50 flex items-center justify-between" style={{ borderColor: C.border }}>
                           <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                              <BarChart2 className="size-3.5" /> Historique des Mouvements ({movements.length})
                           </h3>
                           <div className="flex items-center gap-2 bg-white p-1 rounded-lg border shadow-sm" style={{ borderColor: C.border }}>
                              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-7 text-xs w-auto bg-transparent border-none shadow-none focus-visible:ring-0" />
                              <span className="text-slate-400 text-xs font-bold">à</span>
                              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-7 text-xs w-auto bg-transparent border-none shadow-none focus-visible:ring-0" />
                           </div>
                        </div>
                        
                        <div className="divide-y" style={{ borderColor: C.border }}>
                           {movementsQuery.isLoading ? (
                              <div className="p-12 flex justify-center"><Loader2 className="size-6 animate-spin text-indigo-500" /></div>
                           ) : movements.length === 0 ? (
                              <p className="p-12 text-center text-[11px] font-bold text-slate-400 uppercase tracking-widest">Aucun mouvement trouvé pour cette période</p>
                           ) : movements.map((m: any) => {
                              const hasOrder = !!m.order_id;
                              return (
                                 <div
                                    key={m.id}
                                    onClick={() => { if (m.order_id) setSelectedOrderId(m.order_id); }}
                                    className={cn(
                                       "p-4 flex items-center justify-between transition-colors",
                                       hasOrder ? "cursor-pointer hover:bg-slate-50 group" : ""
                                    )}
                                 >
                                    <div>
                                       <div className="flex items-center gap-2">
                                          <p className="text-xs font-black text-slate-800 uppercase tracking-tight">{m.type.replace(/_/g, ' ')}</p>
                                          {hasOrder && (
                                             <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-black bg-slate-100 text-slate-600 group-hover:bg-indigo-100 group-hover:text-indigo-700 transition-colors">
                                                <ExternalLink className="size-2.5" /> #{m.order_number || m.order_id.slice(0, 8)}
                                             </span>
                                          )}
                                       </div>
                                       <div className="flex items-center gap-2 mt-1">
                                          <p className="text-[11px] text-slate-500 font-medium">
                                             {new Date(m.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                          </p>
                                          {m.actor?.name && (
                                             <>
                                                <span className="text-slate-300">•</span>
                                                <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1"><User className="size-3" /> {m.actor.name}</span>
                                             </>
                                          )}
                                       </div>
                                    </div>
                                    <span className={cn("text-lg font-black tabular-nums shrink-0", m.quantity >= 0 ? "text-emerald-600" : "text-rose-600")}>
                                       {m.quantity >= 0 ? '+' : ''}{m.quantity}
                                    </span>
                                 </div>
                              );
                           })}
                        </div>
                     </div>
                  )}

                  {/* TAB: SETTINGS */}
                  {activeTab === 'settings' && (
                     <div className="space-y-6 max-w-2xl">
                        {/* FINANCIAL SETTINGS */}
                        <div className="bg-white rounded-2xl border shadow-sm p-6" style={{ borderColor: C.border }}>
                           <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 mb-6">
                              <DollarSign className="size-3.5" /> Paramètres Financiers
                           </h3>
                           
                           <div className="grid grid-cols-2 gap-6">
                              <div>
                                 <p className="text-xs font-bold text-slate-500 mb-1">Prix de vente</p>
                                 {editingPrice ? (
                                    <div className="flex items-center gap-2">
                                       <div className="relative flex-1">
                                          <Input type="number" value={priceInput} onChange={e => setPriceInput(e.target.value)} className="h-10 pl-3 pr-8 font-black text-slate-800" />
                                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">DA</span>
                                       </div>
                                       <Button size="sm" onClick={() => priceMutation.mutate()} disabled={priceMutation.isPending} className="h-10 bg-indigo-600 hover:bg-indigo-700">
                                          {priceMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : 'Sauver'}
                                       </Button>
                                       <Button size="sm" variant="outline" onClick={() => { setEditingPrice(false); setPriceInput(String(product.price || 0)); }} className="h-10">Annuler</Button>
                                    </div>
                                 ) : (
                                    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border" style={{ borderColor: C.border }}>
                                       <span className="font-black text-slate-800 text-lg">{formatPrice(product.price || 0)}</span>
                                       <Button size="sm" variant="secondary" onClick={() => setEditingPrice(true)} className="h-7 text-xs font-bold">Modifier</Button>
                                    </div>
                                 )}
                              </div>

                              <div>
                                 <p className="text-xs font-bold text-slate-500 mb-1">Prix d'achat (Coût)</p>
                                 <div className="p-3 rounded-xl bg-slate-50 border opacity-80" style={{ borderColor: C.border }}>
                                    <span className="font-black text-slate-700 text-lg">{formatPrice(product.cost_price || 0)}</span>
                                 </div>
                              </div>
                           </div>
                           
                           <div className="mt-6 p-4 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-between">
                              <div>
                                 <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Marge unitaire nette</p>
                                 <p className="text-xs text-emerald-700/80 font-medium mt-0.5">La marge dégagée par vente</p>
                              </div>
                              <div className="text-right">
                                 <p className="text-xl font-black text-emerald-700">{formatPrice(margin)}</p>
                                 <p className="text-[10px] font-black text-emerald-600 bg-emerald-100 inline-block px-1.5 rounded">{marginPct}% de rentabilité</p>
                              </div>
                           </div>
                        </div>
                     </div>
                  )}

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
