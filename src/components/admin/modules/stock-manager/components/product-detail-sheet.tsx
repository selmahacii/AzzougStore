'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
   Box, X, Loader2, ExternalLink, User, Phone, MapPin, DollarSign, 
   Package, TrendingUp, TrendingDown, BarChart2, Activity,
   Calendar, CheckCircle2, RotateCcw, Clock, Tag, Layers, Filter,
   ArrowRight, Search, Eye
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { C } from '../utils';
import { OrderTrackingReport } from '@/components/admin/order-tracking-report';
import { OrderTypeBadge } from '@/components/shared/order-type-badge';

function parseVariantDetails(variantDetails: any): { label: string; value: string }[] {
   if (!variantDetails) return [];
   let data = variantDetails;
   if (typeof data === 'string') {
      try {
         data = JSON.parse(data);
      } catch {
         return [{ label: 'Option', value: variantDetails }];
      }
   }
   if (typeof data !== 'object' || data === null) {
      return [{ label: 'Option', value: String(data) }];
   }
   const entries: { label: string; value: string }[] = [];
   for (const [k, v] of Object.entries(data)) {
      if (!v) continue;
      if (k === 'variant' && typeof v === 'string') {
         if (Object.keys(data).length === 1) {
            return [{ label: 'Variante', value: v }];
         }
      } else if (typeof v === 'string' || typeof v === 'number') {
         entries.push({ label: k, value: String(v) });
      }
   }
   return entries;
}

const MOVEMENT_LABELS: Record<string, { label: string; badge: string }> = {
   RESTOCK: { label: 'Réapprovisionnement', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
   ORDER_CONFIRM: { label: 'Commande Confirmée (Sortie)', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
   ORDER_RESERVE: { label: 'Réservation Commande', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
   ORDER_RELEASE: { label: 'Libération Réservation (Annulée)', badge: 'bg-sky-50 text-sky-700 border-sky-200' },
   RETURN_RESTOCK: { label: 'Retour Client Réintégré', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
   POS_SALE: { label: 'Vente Directe POS', badge: 'bg-purple-50 text-purple-700 border-purple-200' },
   MANUAL_ADJUSTMENT: { label: 'Ajustement Manuel', badge: 'bg-slate-50 text-slate-700 border-slate-200' },
};

function extractVariantFromMovement(m: any): string {
   if (m.variant_name && m.variant_name !== 'Général') {
      return m.variant_name;
   }
   if (m.reason) {
      const parenMatch = m.reason.match(/\(([^)]+)\)/);
      if (parenMatch && parenMatch[1] && parenMatch[1] !== 'Général') {
         return parenMatch[1].trim();
      }
      const bulletMatch = m.reason.match(/[•\-]?\s*Variante\s*:\s*([^\r\n]+)/i);
      if (bulletMatch && bulletMatch[1] && bulletMatch[1] !== 'Général') {
         return bulletMatch[1].trim();
      }
   }
   return 'Article standard';
}

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
                              <span className="flex items-center gap-2"><MapPin className="size-3.5 text-slate-400" /> {order.wilaya || '—'} — {order.commune || '—'}</span>
                              {order.delivery_address && <span className="text-xs text-slate-400 ml-5.5">{order.delivery_address}</span>}
                              {order.tracking_number && <span className="text-xs font-mono text-slate-500 ml-5.5">Tracking: <span className="font-bold text-slate-700">{order.tracking_number}</span></span>}
                           </div>
                        </div>
                        {(() => {
                           const calculatedItemsTotal = (order.items ?? []).reduce(
                              (acc: number, item: any) => acc + ((item.unit_price ?? item.price ?? 0) * (item.quantity ?? 1)), 
                              0
                           );
                           const shippingFee = Number(order.delivery_fee ?? order.shipping_cost ?? 0);
                           const discountAmount = Number(order.discount ?? 0);
                           const finalTotal = Number(order.total ?? order.total_price ?? (calculatedItemsTotal + shippingFee - discountAmount));
                           const subtotalAmount = Number(order.subtotal ?? calculatedItemsTotal);

                           return (
                              <div className="flex flex-col md:items-end gap-1.5 bg-slate-50 p-4 rounded-2xl border border-slate-100 min-w-[220px]">
                                 <div className="flex items-center justify-between w-full md:justify-end gap-4 text-xs">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sous-total</span>
                                    <span className="font-bold text-slate-700">{formatPrice(subtotalAmount)}</span>
                                 </div>
                                 <div className="flex items-center justify-between w-full md:justify-end gap-4 text-xs">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Livraison</span>
                                    <span className="font-bold text-slate-600">{formatPrice(shippingFee)}</span>
                                 </div>
                                 {discountAmount > 0 && (
                                    <div className="flex items-center justify-between w-full md:justify-end gap-4 text-xs">
                                       <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest">Réduction</span>
                                       <span className="font-bold text-rose-600">-{formatPrice(discountAmount)}</span>
                                    </div>
                                 )}
                                 <div className="flex items-center justify-between w-full md:justify-end gap-4 pt-2 border-t border-slate-200">
                                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total</span>
                                    <span className="text-lg font-black text-emerald-600">{formatPrice(finalTotal)}</span>
                                 </div>
                              </div>
                           );
                        })()}
                     </div>
                     
                     <div className="h-px w-full bg-slate-100" />
                     
                     {/* Produits */}
                     <div>
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Produits commandés ({order.items?.length || 0})</h4>
                        <div className="grid gap-2">
                           {order.items?.map((item: any) => {
                              const variants = parseVariantDetails(item.variant_details);
                              const fallbackVariant = item.variant_string || item.variant_title || (typeof item.variant_details === 'string' ? item.variant_details : null);
                              const itemImg = item.image_url || item.product_image;

                              return (
                                 <div key={item.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                       <div className="size-12 bg-white border border-slate-100 rounded-xl overflow-hidden shrink-0 flex items-center justify-center">
                                          {itemImg ? <img src={itemImg} alt="" className="size-full object-cover" /> : <Package className="size-5 text-slate-300" />}
                                       </div>
                                       <div className="min-w-0">
                                          <p className="text-sm font-bold text-slate-800 truncate">{item.product_name}</p>
                                          
                                          {variants.length > 0 ? (
                                             <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                {variants.map((v, vIdx) => (
                                                   <span key={vIdx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100/80">
                                                      <span className="text-indigo-400 font-semibold">{v.label} :</span>
                                                      <span className="font-black">{v.value}</span>
                                                   </span>
                                                ))}
                                             </div>
                                          ) : fallbackVariant ? (
                                             <p className="text-xs text-slate-500 font-semibold mt-0.5">{fallbackVariant}</p>
                                          ) : null}

                                          {item.sku && <p className="text-[10px] font-mono text-slate-400 mt-0.5">SKU: {item.sku}</p>}
                                       </div>
                                    </div>
                                    <div className="flex items-center justify-between sm:justify-end gap-4 text-sm shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
                                       <span className="font-bold text-slate-600 text-xs">{item.quantity} × {formatPrice(item.unit_price ?? item.price ?? 0)}</span>
                                       <span className="font-black text-slate-900">{formatPrice((item.quantity ?? 1) * (item.unit_price ?? item.price ?? 0))}</span>
                                    </div>
                                 </div>
                              );
                           })}
                        </div>
                     </div>
                     
                     {/* Timeline */}
                     <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                        <OrderTrackingReport orderId={order.id} />
                     </div>
                  </div>
               )}
            </div>
         </div>
      </div>
   );
}

function VariantOrdersModal({
   variant,
   initialFilter = 'ALL',
   onClose,
   onSelectOrder,
}: {
   variant: any;
   initialFilter?: 'ALL' | 'RESERVED' | 'CONFIRMED' | 'RELEASED' | 'RETURNED';
   onClose: () => void;
   onSelectOrder: (orderId: string) => void;
}) {
   const [activeFilter, setActiveFilter] = useState<'ALL' | 'RESERVED' | 'CONFIRMED' | 'RELEASED' | 'RETURNED'>(initialFilter);
   const [searchQuery, setSearchQuery] = useState('');

   const allOrders = (variant?.ordersList || []) as Array<{
      orderId: string;
      orderNumber?: string;
      customerName?: string;
      customerPhone?: string;
      orderStatus?: string;
      reservedQty: number;
      confirmedQty: number;
      releasedQty: number;
      returnedQty: number;
      lastMovementDate?: string;
      movements: any[];
   }>;

   const filteredByTab = useMemo(() => {
      if (activeFilter === 'RESERVED') return allOrders.filter(o => o.reservedQty > 0);
      if (activeFilter === 'CONFIRMED') return allOrders.filter(o => o.confirmedQty > 0);
      if (activeFilter === 'RELEASED') return allOrders.filter(o => o.releasedQty > 0);
      if (activeFilter === 'RETURNED') return allOrders.filter(o => o.returnedQty > 0);
      return allOrders;
   }, [allOrders, activeFilter]);

   const displayedOrders = useMemo(() => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return filteredByTab;
      return filteredByTab.filter(o => 
         (o.orderNumber || '').toLowerCase().includes(q) ||
         (o.customerName || '').toLowerCase().includes(q) ||
         (o.customerPhone || '').toLowerCase().includes(q) ||
         (o.orderId || '').toLowerCase().includes(q)
      );
   }, [filteredByTab, searchQuery]);

   const reservedCount = allOrders.filter(o => o.reservedQty > 0).length;
   const confirmedCount = allOrders.filter(o => o.confirmedQty > 0).length;
   const releasedCount = allOrders.filter(o => o.releasedQty > 0).length;
   const returnedCount = allOrders.filter(o => o.returnedQty > 0).length;

   return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
         <div className="bg-white w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-200 text-slate-800 overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-900 p-6 text-white shrink-0 border-b border-indigo-800/40">
               <div className="flex items-start justify-between gap-4">
                  <div>
                     <div className="flex items-center gap-2 mb-1.5">
                        <span className="size-7 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-indigo-300">
                           <Tag className="size-4" />
                        </span>
                        <h3 className="text-lg font-black tracking-tight">{variant.name}</h3>
                     </div>
                     <p className="text-xs text-indigo-200 font-medium">
                        Commandes associées à cette variante ({allOrders.length} commande{allOrders.length > 1 ? 's' : ''} au total)
                     </p>
                  </div>
                  <button onClick={onClose} className="size-8 bg-white/10 hover:bg-white/20 text-white/70 hover:text-white rounded-full flex items-center justify-center transition-colors">
                     <X className="size-4" />
                  </button>
               </div>

               {/* Micro KPI Bar in Header */}
               <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-5">
                  <div 
                     onClick={() => setActiveFilter('CONFIRMED')}
                     className={cn(
                        "p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between",
                        activeFilter === 'CONFIRMED' ? "bg-rose-500/30 border-rose-400" : "bg-white/10 border-white/10 hover:bg-white/15"
                     )}
                  >
                     <span className="text-[10px] font-black uppercase tracking-wider text-rose-300 flex items-center gap-1">
                        <CheckCircle2 className="size-3" /> Confirmé
                     </span>
                     <span className="text-base font-black text-white tabular-nums">{variant.confirmed}</span>
                  </div>
                  <div 
                     onClick={() => setActiveFilter('RESERVED')}
                     className={cn(
                        "p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between",
                        activeFilter === 'RESERVED' ? "bg-amber-500/30 border-amber-400" : "bg-white/10 border-white/10 hover:bg-white/15"
                     )}
                  >
                     <span className="text-[10px] font-black uppercase tracking-wider text-amber-300 flex items-center gap-1">
                        <Clock className="size-3" /> Réservé
                     </span>
                     <span className="text-base font-black text-white tabular-nums">{variant.reserved}</span>
                  </div>
                  <div 
                     onClick={() => setActiveFilter('RELEASED')}
                     className={cn(
                        "p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between",
                        activeFilter === 'RELEASED' ? "bg-sky-500/30 border-sky-400" : "bg-white/10 border-white/10 hover:bg-white/15"
                     )}
                  >
                     <span className="text-[10px] font-black uppercase tracking-wider text-sky-300 flex items-center gap-1">
                        <RotateCcw className="size-3" /> Libéré
                     </span>
                     <span className="text-base font-black text-white tabular-nums">{variant.released}</span>
                  </div>
                  <div 
                     onClick={() => setActiveFilter('RETURNED')}
                     className={cn(
                        "p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between",
                        activeFilter === 'RETURNED' ? "bg-indigo-500/30 border-indigo-400" : "bg-white/10 border-white/10 hover:bg-white/15"
                     )}
                  >
                     <span className="text-[10px] font-black uppercase tracking-wider text-indigo-300 flex items-center gap-1">
                        <Package className="size-3" /> Retour
                     </span>
                     <span className="text-base font-black text-white tabular-nums">{variant.returned}</span>
                  </div>
               </div>
            </div>

            {/* Sub-bar: Search & Filter Tabs */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
               {/* Filter Tabs */}
               <div className="flex flex-wrap items-center gap-1.5">
                  <button
                     onClick={() => setActiveFilter('ALL')}
                     className={cn(
                        "px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all",
                        activeFilter === 'ALL'
                           ? "bg-indigo-600 text-white shadow-xs"
                           : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                     )}
                  >
                     Toutes ({allOrders.length})
                  </button>
                  <button
                     onClick={() => setActiveFilter('RESERVED')}
                     className={cn(
                        "px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all flex items-center gap-1",
                        activeFilter === 'RESERVED'
                           ? "bg-amber-500 text-white shadow-xs"
                           : "bg-white text-amber-700 border border-amber-200 hover:bg-amber-50"
                     )}
                  >
                     <Clock className="size-3" /> Réservées ({reservedCount})
                  </button>
                  <button
                     onClick={() => setActiveFilter('CONFIRMED')}
                     className={cn(
                        "px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all flex items-center gap-1",
                        activeFilter === 'CONFIRMED'
                           ? "bg-rose-600 text-white shadow-xs"
                           : "bg-white text-rose-700 border border-rose-200 hover:bg-rose-50"
                     )}
                  >
                     <CheckCircle2 className="size-3" /> Confirmées ({confirmedCount})
                  </button>
                  <button
                     onClick={() => setActiveFilter('RELEASED')}
                     className={cn(
                        "px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all flex items-center gap-1",
                        activeFilter === 'RELEASED'
                           ? "bg-sky-600 text-white shadow-xs"
                           : "bg-white text-sky-700 border border-sky-200 hover:bg-sky-50"
                     )}
                  >
                     <RotateCcw className="size-3" /> Libérées ({releasedCount})
                  </button>
                  {returnedCount > 0 && (
                     <button
                        onClick={() => setActiveFilter('RETURNED')}
                        className={cn(
                           "px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all flex items-center gap-1",
                           activeFilter === 'RETURNED'
                              ? "bg-indigo-600 text-white shadow-xs"
                              : "bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50"
                        )}
                     >
                        <Package className="size-3" /> Retours ({returnedCount})
                     </button>
                  )}
               </div>

               {/* Search bar */}
               <div className="relative min-w-[240px]">
                  <Input
                     type="text"
                     placeholder="Rechercher (#ORD, client, tél...)"
                     value={searchQuery}
                     onChange={e => setSearchQuery(e.target.value)}
                     className="h-8 text-xs bg-white pr-7 rounded-xl border-slate-200"
                  />
                  {searchQuery && (
                     <button onClick={() => setSearchQuery('')} className="absolute right-2 top-2 text-slate-400 hover:text-slate-600">
                        <X className="size-3.5" />
                     </button>
                  )}
               </div>
            </div>

            {/* Orders List */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 custom-scrollbar bg-slate-100/50">
               {displayedOrders.length === 0 ? (
                  <div className="py-16 text-center">
                     <Package className="size-10 text-slate-300 mx-auto mb-2" />
                     <p className="text-xs font-black text-slate-400 uppercase tracking-wider">
                        Aucune commande trouvée
                     </p>
                  </div>
               ) : (
                  displayedOrders.map((ord, i) => (
                     <div
                        key={ord.orderId || i}
                        onClick={() => onSelectOrder(ord.orderId)}
                        className="bg-white p-4.5 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer group flex flex-col md:flex-row md:items-center justify-between gap-4"
                     >
                        <div className="space-y-1.5 flex-1">
                           <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-sm font-black text-indigo-950 group-hover:text-indigo-600 transition-colors">
                                 #{ord.orderNumber || ord.orderId.slice(0, 8)}
                              </span>
                              {ord.orderStatus && (
                                 <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-slate-100 text-slate-700 border border-slate-200">
                                    {ord.orderStatus}
                                 </span>
                              )}
                              {ord.lastMovementDate && (
                                 <span className="text-[11px] text-slate-400 font-medium">
                                    • {new Date(ord.lastMovementDate).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                                 </span>
                              )}
                           </div>

                           {/* Customer info */}
                           <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 font-medium">
                              {ord.customerName && (
                                 <span className="flex items-center gap-1 font-bold text-slate-800">
                                    <User className="size-3.5 text-slate-400" /> {ord.customerName}
                                 </span>
                              )}
                              {ord.customerPhone && (
                                 <span className="flex items-center gap-1 text-slate-500">
                                    <Phone className="size-3 text-slate-400" /> {ord.customerPhone}
                                 </span>
                              )}
                           </div>

                           {/* Quantities breakdown */}
                           <div className="flex flex-wrap items-center gap-1.5 pt-1">
                              {ord.reservedQty > 0 && (
                                 <span className="px-2.5 py-0.5 rounded-md text-[10px] font-black bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1">
                                    <Clock className="size-3 text-amber-500" /> Réservé : +{ord.reservedQty} {ord.reservedQty > 1 ? 'unités' : 'unité'}
                                 </span>
                              )}
                              {ord.confirmedQty > 0 && (
                                 <span className="px-2.5 py-0.5 rounded-md text-[10px] font-black bg-rose-50 text-rose-800 border border-rose-200 flex items-center gap-1">
                                    <CheckCircle2 className="size-3 text-rose-500" /> Confirmé : {ord.confirmedQty} {ord.confirmedQty > 1 ? 'unités' : 'unité'}
                                 </span>
                              )}
                              {ord.releasedQty > 0 && (
                                 <span className="px-2.5 py-0.5 rounded-md text-[10px] font-black bg-sky-50 text-sky-800 border border-sky-200 flex items-center gap-1">
                                    <RotateCcw className="size-3 text-sky-500" /> Libéré : {ord.releasedQty} {ord.releasedQty > 1 ? 'unités' : 'unité'}
                                 </span>
                              )}
                              {ord.returnedQty > 0 && (
                                 <span className="px-2.5 py-0.5 rounded-md text-[10px] font-black bg-indigo-50 text-indigo-800 border border-indigo-200 flex items-center gap-1">
                                    <Package className="size-3 text-indigo-500" /> Retour : +{ord.returnedQty} {ord.returnedQty > 1 ? 'unités' : 'unité'}
                                 </span>
                              )}
                           </div>
                        </div>

                        {/* CTA button */}
                        <div className="flex items-center justify-between md:justify-end gap-2 shrink-0 border-t md:border-t-0 pt-2 md:pt-0 border-slate-100">
                           <span className="text-[11px] font-black text-indigo-600 group-hover:text-indigo-800 group-hover:translate-x-0.5 transition-all flex items-center gap-1 bg-indigo-50 group-hover:bg-indigo-100 px-3 py-1.5 rounded-xl border border-indigo-200">
                              Ouvrir la fiche <ExternalLink className="size-3" />
                           </span>
                        </div>
                     </div>
                  ))
               )}
            </div>
         </div>
      </div>
   );
}


export function ProductDetailSheet({ product: initialProduct, onClose }: { product: any; onClose: () => void }) {
   const qc = useQueryClient();

   const productQuery = useQuery({
      queryKey: ['product-detail-live', initialProduct?.id],
      queryFn: () => apiFetch<any>(`/api/v1/products/${initialProduct?.id}`),
      enabled: !!initialProduct?.id,
      refetchInterval: 5000,
   });
   const liveData = productQuery.data as any;
   const product = (liveData && (liveData.id || liveData.variants)) 
      ? liveData 
      : (liveData?.data || initialProduct);

   const [editingPrice, setEditingPrice] = useState(false);
   const [priceInput, setPriceInput] = useState(String(product.price || 0));
   const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
   const [activeVariantForOrders, setActiveVariantForOrders] = useState<{
      variant: any;
      initialFilter?: 'ALL' | 'RESERVED' | 'CONFIRMED' | 'RELEASED' | 'RETURNED';
   } | null>(null);
   const [selectedVariantFilter, setSelectedVariantFilter] = useState<string | null>(null);
   const [dateFrom, setDateFrom] = useState<string>('');
   const [dateTo, setDateTo] = useState<string>('');
   
   // Tabs Meta Ads Style
   const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'settings'>('overview');

   const movementsQuery = useQuery({
      queryKey: ['product-movements', product.id, dateFrom, dateTo],
      queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/stock/?product_id=${product.id}&pageSize=300${dateFrom ? `&date_from=${dateFrom}` : ''}${dateTo ? `&date_to=${dateTo}` : ''}`),
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
   const marginGenerated = breakdown?.marge_generee !== undefined ? breakdown.marge_generee : (livree * margin);

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

   const setToday = () => {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const str = `${yyyy}-${mm}-${dd}`;
      setDateFrom(str);
      setDateTo(str);
   };
   const setLast7Days = () => {
      const now = new Date();
      const d7 = new Date(now.getTime() - 7 * 86400000);
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      setDateFrom(fmt(d7));
      setDateTo(fmt(now));
   };
   const setLast30Days = () => {
      const now = new Date();
      const d30 = new Date(now.getTime() - 30 * 86400000);
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      setDateFrom(fmt(d30));
      setDateTo(fmt(now));
   };
   const setAllTime = () => {
      setDateFrom('');
      setDateTo('');
   };

   const globalStats = useMemo(() => {
      let totalConfirmed = 0;
      let totalReserved = 0;
      let totalReleased = 0;
      let totalReturned = 0;
      const uniqueOrders = new Set<string>();

      movements.forEach((m: any) => {
         const qty = Math.abs(m.quantity || 0);
         if (m.order_id) uniqueOrders.add(m.order_id);
         if (m.type === 'ORDER_CONFIRM') totalConfirmed += qty;
         else if (m.type === 'ORDER_RESERVE') totalReserved += qty;
         else if (m.type === 'ORDER_RELEASE') totalReleased += qty;
         else if (m.type === 'RETURN_RESTOCK') totalReturned += qty;
      });

      return {
         totalConfirmed,
         totalReserved,
         totalReleased,
         totalReturned,
         ordersCount: uniqueOrders.size,
         totalMovements: movements.length,
      };
   }, [movements]);

   const variantStats = useMemo(() => {
      const map: Record<string, {
         name: string;
         confirmed: number;
         reserved: number;
         released: number;
         returned: number;
         currentStock?: number;
         currentReserved?: number;
         uniqueOrders: Set<string>;
         ordersMap: Record<string, {
            orderId: string;
            orderNumber?: string;
            customerName?: string;
            customerPhone?: string;
            orderStatus?: string;
            reservedQty: number;
            confirmedQty: number;
            releasedQty: number;
            returnedQty: number;
            lastMovementDate?: string;
            movements: any[];
         }>;
      }> = {};

      variantItems.forEach(vi => {
         map[vi.variantStr] = {
            name: vi.variantStr,
            confirmed: 0,
            reserved: 0,
            released: 0,
            returned: 0,
            currentStock: vi.stock,
            currentReserved: vi.reserved,
            uniqueOrders: new Set<string>(),
            ordersMap: {},
         };
      });

      movements.forEach((m: any) => {
         const rawVariant = extractVariantFromMovement(m);
         
         let key = Object.keys(map).find(k => 
            k.toLowerCase() === rawVariant.toLowerCase() ||
            k.toLowerCase().includes(rawVariant.toLowerCase()) ||
            rawVariant.toLowerCase().includes(k.toLowerCase())
         );

         if (!key) {
            key = rawVariant;
            map[key] = {
               name: rawVariant,
               confirmed: 0,
               reserved: 0,
               released: 0,
               returned: 0,
               uniqueOrders: new Set<string>(),
               ordersMap: {},
            };
         }

         const qty = Math.abs(Number(m.quantity) || 0);
         if (m.order_id) {
            map[key].uniqueOrders.add(m.order_id);
            if (!map[key].ordersMap[m.order_id]) {
               map[key].ordersMap[m.order_id] = {
                  orderId: m.order_id,
                  orderNumber: m.order_number,
                  customerName: m.customer_name,
                  customerPhone: m.customer_phone,
                  orderStatus: m.order_status,
                  reservedQty: 0,
                  confirmedQty: 0,
                  releasedQty: 0,
                  returnedQty: 0,
                  lastMovementDate: m.created_at,
                  movements: [],
               };
            }
            const ord = map[key].ordersMap[m.order_id];
            ord.movements.push(m);
            if (m.order_number && !ord.orderNumber) ord.orderNumber = m.order_number;
            if (m.customer_name && !ord.customerName) ord.customerName = m.customer_name;
            if (m.customer_phone && !ord.customerPhone) ord.customerPhone = m.customer_phone;
            if (m.order_status && !ord.orderStatus) ord.orderStatus = m.order_status;
            if (m.created_at && (!ord.lastMovementDate || new Date(m.created_at) > new Date(ord.lastMovementDate))) {
               ord.lastMovementDate = m.created_at;
            }

            if (m.type === 'ORDER_CONFIRM') ord.confirmedQty += qty;
            else if (m.type === 'ORDER_RESERVE') ord.reservedQty += qty;
            else if (m.type === 'ORDER_RELEASE') ord.releasedQty += qty;
            else if (m.type === 'RETURN_RESTOCK') ord.returnedQty += qty;
         }

         if (m.type === 'ORDER_CONFIRM') map[key].confirmed += qty;
         else if (m.type === 'ORDER_RESERVE') map[key].reserved += qty;
         else if (m.type === 'ORDER_RELEASE') map[key].released += qty;
         else if (m.type === 'RETURN_RESTOCK') map[key].returned += qty;
      });

      return Object.values(map).map((item: any) => ({
         ...item,
         ordersCount: item.uniqueOrders.size,
         ordersList: Object.values(item.ordersMap).sort((a: any, b: any) => {
            const dateA = new Date(a.lastMovementDate || 0).getTime();
            const dateB = new Date(b.lastMovementDate || 0).getTime();
            return dateB - dateA;
         }),
      }));
   }, [movements, variantItems]);

   const displayedMovements = useMemo(() => {
      if (!selectedVariantFilter) return movements;
      return movements.filter((m: any) => {
         const vName = extractVariantFromMovement(m);
         return (
            vName.toLowerCase() === selectedVariantFilter.toLowerCase() ||
            vName.toLowerCase().includes(selectedVariantFilter.toLowerCase()) ||
            selectedVariantFilter.toLowerCase().includes(vName.toLowerCase())
         );
      });
   }, [movements, selectedVariantFilter]);

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
                     <div className="space-y-6">
                        {/* 1. FILTER & CONTROLS HEADER */}
                        <div className="bg-white rounded-2xl border shadow-sm p-5" style={{ borderColor: C.border }}>
                           <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                              <div>
                                 <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                                    <BarChart2 className="size-4 text-indigo-600" /> 
                                    Historique des Mouvements ({movements.length})
                                 </h3>
                                 <p className="text-[11px] font-medium text-slate-500 mt-0.5">
                                    Analyse dynamique des confirmations, réservations et retours par variante
                                 </p>
                              </div>

                              {/* Date Filters & Presets */}
                              <div className="flex flex-wrap items-center gap-2">
                                 <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                                    <button
                                       type="button"
                                       onClick={setAllTime}
                                       className={cn("px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition-all", !dateFrom && !dateTo ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500 hover:text-slate-800")}
                                    >
                                       Tout
                                    </button>
                                    <button
                                       type="button"
                                       onClick={setToday}
                                       className={cn("px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition-all", dateFrom && dateFrom === dateTo ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500 hover:text-slate-800")}
                                    >
                                       Aujourd'hui
                                    </button>
                                    <button
                                       type="button"
                                       onClick={setLast7Days}
                                       className={cn("px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition-all", "text-slate-500 hover:text-slate-800")}
                                    >
                                       7J
                                    </button>
                                    <button
                                       type="button"
                                       onClick={setLast30Days}
                                       className={cn("px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition-all", "text-slate-500 hover:text-slate-800")}
                                    >
                                       30J
                                    </button>
                                 </div>

                                 <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-xl border shadow-xs" style={{ borderColor: C.border }}>
                                    <Calendar className="size-3.5 text-slate-400" />
                                    <Input 
                                       type="date" 
                                       value={dateFrom} 
                                       onChange={e => setDateFrom(e.target.value)} 
                                       className="h-6 text-xs w-auto bg-transparent border-none shadow-none focus-visible:ring-0 p-0 text-slate-700 font-semibold" 
                                    />
                                    <span className="text-slate-400 text-xs font-bold">à</span>
                                    <Input 
                                       type="date" 
                                       value={dateTo} 
                                       onChange={e => setDateTo(e.target.value)} 
                                       className="h-6 text-xs w-auto bg-transparent border-none shadow-none focus-visible:ring-0 p-0 text-slate-700 font-semibold" 
                                    />
                                 </div>
                              </div>
                           </div>

                           {/* 2. GLOBAL KPI SUMMARY BAR */}
                           <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t" style={{ borderColor: C.border }}>
                              <div className="p-3.5 rounded-xl bg-rose-50/70 border border-rose-100 flex items-center justify-between">
                                 <div>
                                    <p className="text-[10px] font-black uppercase tracking-wider text-rose-600 flex items-center gap-1">
                                       <CheckCircle2 className="size-3" /> Confirmées
                                    </p>
                                    <p className="text-xl font-black text-rose-700 tabular-nums mt-0.5">{globalStats.totalConfirmed}</p>
                                 </div>
                                 <span className="text-[10px] font-bold text-rose-500">Sorties</span>
                              </div>

                              <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-100 flex items-center justify-between">
                                 <div>
                                    <p className="text-[10px] font-black uppercase tracking-wider text-amber-600 flex items-center gap-1">
                                       <Clock className="size-3" /> Réservées
                                    </p>
                                    <p className="text-xl font-black text-amber-700 tabular-nums mt-0.5">{globalStats.totalReserved}</p>
                                 </div>
                                 <span className="text-[10px] font-bold text-amber-500">En cours</span>
                              </div>

                              <div className="p-3.5 rounded-xl bg-sky-50/70 border border-sky-100 flex items-center justify-between">
                                 <div>
                                    <p className="text-[10px] font-black uppercase tracking-wider text-sky-600 flex items-center gap-1">
                                       <RotateCcw className="size-3" /> Libérées
                                    </p>
                                    <p className="text-xl font-black text-sky-700 tabular-nums mt-0.5">{globalStats.totalReleased}</p>
                                 </div>
                                 <span className="text-[10px] font-bold text-sky-500">Annulées</span>
                              </div>

                              <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-100 flex items-center justify-between">
                                 <div>
                                    <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600 flex items-center gap-1">
                                       <Package className="size-3" /> Retours
                                    </p>
                                    <p className="text-xl font-black text-indigo-700 tabular-nums mt-0.5">{globalStats.totalReturned}</p>
                                 </div>
                                 <span className="text-[10px] font-bold text-indigo-500">Réintégrés</span>
                              </div>
                           </div>
                        </div>

                        {/* 3. SYNTHÈSE DES VARIANTES (CARTES PAR VARIANTE) */}
                        <div className="bg-white rounded-2xl border shadow-sm p-5" style={{ borderColor: C.border }}>
                           <div className="flex items-center justify-between mb-4">
                              <div>
                                 <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                                    <Layers className="size-3.5 text-indigo-600" />
                                    Bilan par Variante sur la période filtrée ({variantStats.length})
                                 </h4>
                                 <p className="text-[11px] text-slate-500 font-medium">
                                    Nombre d'unités confirmées, réservées et libérées pour chaque variante
                                 </p>
                              </div>
                              {dateFrom || dateTo ? (
                                 <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200">
                                    Filtré : {dateFrom || '...'} au {dateTo || '...'}
                                 </span>
                              ) : (
                                 <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-slate-100 text-slate-600">
                                    Toutes les dates
                                 </span>
                              )}
                           </div>

                           <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                              {variantStats.map((vs, idx) => (
                                 <div 
                                    key={idx} 
                                    onClick={() => setActiveVariantForOrders({ variant: vs, initialFilter: 'ALL' })}
                                    className={cn(
                                       "p-4 rounded-2xl border transition-all cursor-pointer group relative flex flex-col justify-between",
                                       selectedVariantFilter === vs.name 
                                          ? "bg-indigo-50/50 border-indigo-400 shadow-md ring-2 ring-indigo-500/20" 
                                          : "bg-slate-50/70 border-slate-200/80 hover:border-indigo-300 hover:bg-indigo-50/20 hover:shadow-md"
                                    )}
                                 >
                                    <div>
                                       <div className="flex items-start justify-between gap-3 mb-2">
                                          <div className="flex items-center gap-2">
                                             <span className="size-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-indigo-600 shrink-0 shadow-2xs group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                                <Tag className="size-4" />
                                             </span>
                                             <div>
                                                <p className="text-xs font-black text-slate-800 group-hover:text-indigo-900 transition-colors">{vs.name}</p>
                                                <p className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                                                   {vs.ordersCount > 0 ? (
                                                      <span className="text-indigo-600 font-black">{vs.ordersCount} commande{vs.ordersCount > 1 ? 's' : ''} associée{vs.ordersCount > 1 ? 's' : ''}</span>
                                                   ) : (
                                                      <span>Aucune commande</span>
                                                   )}
                                                </p>
                                             </div>
                                          </div>

                                          <div className="flex items-center gap-1.5">
                                             {(vs.currentStock !== undefined || vs.currentReserved !== undefined) && (
                                                <div className="flex items-center gap-2 text-[10px] font-bold bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-2xs">
                                                   <span className="text-slate-500">Stock: <strong className="text-emerald-600">{vs.currentStock ?? 0}</strong></span>
                                                   <span className="text-slate-300">|</span>
                                                   <span className="text-slate-500">Résa: <strong className="text-amber-600">{vs.currentReserved ?? 0}</strong></span>
                                                </div>
                                             )}
                                             <button
                                                type="button"
                                                title={selectedVariantFilter === vs.name ? "Retirer le filtre sur la timeline" : "Filtrer la timeline sur cette variante"}
                                                onClick={(e) => {
                                                   e.stopPropagation();
                                                   setSelectedVariantFilter(selectedVariantFilter === vs.name ? null : vs.name);
                                                }}
                                                className={cn(
                                                   "size-7 rounded-lg flex items-center justify-center transition-colors border",
                                                   selectedVariantFilter === vs.name 
                                                      ? "bg-indigo-600 text-white border-indigo-600" 
                                                      : "bg-white text-slate-400 border-slate-200 hover:text-slate-700 hover:bg-slate-50"
                                                )}
                                             >
                                                <Filter className="size-3.5" />
                                             </button>
                                          </div>
                                       </div>

                                       {/* Call to action prompt */}
                                       <div className="flex items-center justify-between py-1 text-[10px] font-black text-indigo-600 group-hover:text-indigo-800">
                                          <span className="flex items-center gap-1">
                                             <Eye className="size-3" /> Voir la liste des commandes ({vs.ordersCount})
                                          </span>
                                          <ArrowRight className="size-3 transition-transform group-hover:translate-x-1" />
                                       </div>
                                    </div>

                                    {/* Micro stats grid for this variant */}
                                    <div className="grid grid-cols-4 gap-2 pt-2 mt-2 border-t border-slate-200/60">
                                       <div 
                                          onClick={(e) => { e.stopPropagation(); setActiveVariantForOrders({ variant: vs, initialFilter: 'CONFIRMED' }); }}
                                          className="bg-white p-2 rounded-xl border border-slate-100 text-center hover:border-rose-300 hover:bg-rose-50/50 hover:shadow-2xs transition-all cursor-pointer"
                                          title="Cliquez pour afficher les commandes confirmées"
                                       >
                                          <p className="text-[9px] font-black uppercase text-rose-500">Confirmé</p>
                                          <p className="text-sm font-black text-rose-700 tabular-nums">{vs.confirmed}</p>
                                       </div>
                                       <div 
                                          onClick={(e) => { e.stopPropagation(); setActiveVariantForOrders({ variant: vs, initialFilter: 'RESERVED' }); }}
                                          className="bg-white p-2 rounded-xl border border-slate-100 text-center hover:border-amber-300 hover:bg-amber-50/50 hover:shadow-2xs transition-all cursor-pointer"
                                          title="Cliquez pour afficher les commandes réservées"
                                       >
                                          <p className="text-[9px] font-black uppercase text-amber-500">Réservé</p>
                                          <p className="text-sm font-black text-amber-700 tabular-nums">{vs.reserved}</p>
                                       </div>
                                       <div 
                                          onClick={(e) => { e.stopPropagation(); setActiveVariantForOrders({ variant: vs, initialFilter: 'RELEASED' }); }}
                                          className="bg-white p-2 rounded-xl border border-slate-100 text-center hover:border-sky-300 hover:bg-sky-50/50 hover:shadow-2xs transition-all cursor-pointer"
                                          title="Cliquez pour afficher les réservations libérées/annulées"
                                       >
                                          <p className="text-[9px] font-black uppercase text-sky-500">Libéré</p>
                                          <p className="text-sm font-black text-sky-700 tabular-nums">{vs.released}</p>
                                       </div>
                                       <div 
                                          onClick={(e) => { e.stopPropagation(); setActiveVariantForOrders({ variant: vs, initialFilter: 'RETURNED' }); }}
                                          className="bg-white p-2 rounded-xl border border-slate-100 text-center hover:border-indigo-300 hover:bg-indigo-50/50 hover:shadow-2xs transition-all cursor-pointer"
                                          title="Cliquez pour afficher les commandes retournées"
                                       >
                                          <p className="text-[9px] font-black uppercase text-indigo-500">Retour</p>
                                          <p className="text-sm font-black text-indigo-700 tabular-nums">{vs.returned}</p>
                                       </div>
                                    </div>
                                 </div>
                              ))}
                           </div>
                        </div>

                        {/* 4. LISTE DÉTAILLÉE DES MOUVEMENTS AVEC CARTES PAR VARIANTE */}
                        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: C.border }}>
                           <div className="p-4 border-b bg-slate-50/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2" style={{ borderColor: C.border }}>
                              <div className="flex flex-wrap items-center gap-2">
                                 <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                                    Détail chronologique des mouvements ({displayedMovements.length})
                                 </h4>
                                 {selectedVariantFilter && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 text-indigo-800 border border-indigo-200 flex items-center gap-1">
                                       Filtre variante : {selectedVariantFilter}
                                       <button onClick={() => setSelectedVariantFilter(null)} className="hover:text-indigo-950 ml-0.5">
                                          <X className="size-3" />
                                       </button>
                                    </span>
                                 )}
                              </div>
                              <span className="text-[10px] font-bold text-slate-400">Cliquez sur une commande pour ouvrir sa fiche</span>
                           </div>

                           <div className="divide-y" style={{ borderColor: C.border }}>
                              {movementsQuery.isLoading ? (
                                 <div className="p-12 flex justify-center"><Loader2 className="size-6 animate-spin text-indigo-500" /></div>
                              ) : displayedMovements.length === 0 ? (
                                 <p className="p-12 text-center text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                                    {selectedVariantFilter ? `Aucun mouvement trouvé pour la variante "${selectedVariantFilter}"` : "Aucun mouvement trouvé pour cette période"}
                                 </p>
                              ) : displayedMovements.map((m: any) => {
                                 const hasOrder = !!m.order_id;
                                 const meta = MOVEMENT_LABELS[m.type] || {
                                    label: m.type.replace(/_/g, ' '),
                                    badge: 'bg-slate-50 text-slate-700 border-slate-200',
                                 };
                                 const variantName = extractVariantFromMovement(m);

                                 return (
                                    <div
                                       key={m.id}
                                       onClick={() => { if (m.order_id) setSelectedOrderId(m.order_id); }}
                                       className={cn(
                                          "p-4.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors hover:bg-slate-50/70",
                                          hasOrder ? "cursor-pointer group" : ""
                                       )}
                                    >
                                       <div className="space-y-2 flex-1">
                                          <div className="flex flex-wrap items-center gap-2">
                                             <span className={cn("px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-2xs", meta.badge)}>
                                                {meta.label}
                                             </span>

                                             {hasOrder && (
                                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-black bg-slate-100 text-slate-700 group-hover:bg-indigo-100 group-hover:text-indigo-700 border border-slate-200/60 transition-colors">
                                                 <ExternalLink className="size-2.5" /> #{m.order_number || m.order_id.slice(0, 8)}
                                              </span>
                                           )}

                                           {m.customer_name && (
                                              <span className="text-[10px] font-bold text-slate-700 flex items-center gap-1">
                                                 <User className="size-2.5 text-slate-400" /> {m.customer_name}
                                                 {m.customer_phone && <span className="text-slate-400 font-normal">({m.customer_phone})</span>}
                                              </span>
                                           )}

                                           {m.order_status && (
                                              <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-slate-100 text-slate-600 border border-slate-200">
                                                 {m.order_status}
                                              </span>
                                           )}

                                           <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium ml-auto sm:ml-0">
                                              <span>
                                                 {new Date(m.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                              </span>
                                              {m.actor?.name && (
                                                 <>
                                                    <span className="text-slate-300">•</span>
                                                    <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1"><User className="size-3" /> {m.actor.name}</span>
                                                 </>
                                              )}
                                           </div>
                                        </div>

                                        {/* CARTE DE LA VARIANTE & ACTION */}
                                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 flex flex-wrap items-center justify-between gap-3">
                                           <div className="flex items-center gap-2.5">
                                              <span className="size-6 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                                                 <Layers className="size-3" />
                                              </span>
                                              <div>
                                                 <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Variante concernée</span>
                                                 <span className="text-xs font-black text-slate-800">{variantName}</span>
                                              </div>
                                           </div>

                                           <div className="flex items-center gap-2">
                                              {m.type === 'ORDER_RESERVE' && (
                                                 <span className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200">
                                                    Réservé : +{Math.abs(m.quantity)} unité{Math.abs(m.quantity) > 1 ? 's' : ''}
                                                 </span>
                                              )}
                                              {m.type === 'ORDER_CONFIRM' && (
                                                 <span className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-200">
                                                    Confirmé (Sortie) : -{Math.abs(m.quantity)} unité{Math.abs(m.quantity) > 1 ? 's' : ''}
                                                 </span>
                                              )}
                                              {m.type === 'ORDER_RELEASE' && (
                                                 <span className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-sky-50 text-sky-700 border border-sky-200">
                                                    Libéré (Remis en vente) : +{Math.abs(m.quantity)} unité{Math.abs(m.quantity) > 1 ? 's' : ''}
                                                 </span>
                                              )}
                                              {m.type === 'RETURN_RESTOCK' && (
                                                 <span className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200">
                                                    Réintégré : +{Math.abs(m.quantity)} unité{Math.abs(m.quantity) > 1 ? 's' : ''}
                                                 </span>
                                              )}
                                           </div>
                                        </div>

                                        {m.reason && (
                                           <p className="text-[11px] text-slate-500 font-medium line-clamp-1 px-1">
                                              {m.reason}
                                           </p>
                                        )}
                                     </div>

                                     <div className="text-right shrink-0 self-end sm:self-center">
                                        <span className={cn("text-xl font-black tabular-nums block", m.quantity >= 0 ? "text-emerald-600" : "text-rose-600")}>
                                           {m.quantity >= 0 ? '+' : ''}{m.quantity}
                                        </span>
                                        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Impact stock</span>
                                     </div>
                                  </div>
                               );
                            })}
                         </div>
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

         {activeVariantForOrders && (
            <VariantOrdersModal
               variant={activeVariantForOrders.variant}
               initialFilter={activeVariantForOrders.initialFilter}
               onClose={() => setActiveVariantForOrders(null)}
               onSelectOrder={(orderId) => setSelectedOrderId(orderId)}
            />
         )}

         {selectedOrderId && (
            <OrderMicroDetailModal
               orderId={selectedOrderId}
               onClose={() => setSelectedOrderId(null)}
            />
         )}
      </>
   );
}
