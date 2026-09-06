'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDownRight, Package, Truck, X, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import { toast } from 'sonner';

import { getProductVariantItems } from '../utils';

export function StockExitModal({ open, onOpenChange, products, warehouses, storeId }: any) {
   const qc = useQueryClient();
   const [formData, setFormData] = useState({
      product_id: '',
      warehouse_id: '',
      quantity: 0,
      destination: '',
      dispatch_ref: '',
      driver_name: '',
      vehicle_plate: '',
      shipping_fees: 0,
      package_status: 'parfait',
      shipping_agent: '',
      note: ''
   });
   const [selectedVariant, setSelectedVariant] = useState<string>('ALL');
   const [variantQuantities, setVariantQuantities] = useState<Record<string, number>>({});

   const selectedProduct = products?.find((p: any) => p.id === formData.product_id);
   const variantItems = getProductVariantItems(selectedProduct, {});

   const exitMutation = useMutation({
      mutationFn: async (data: any) => {
         const richReason = [
            data.note.trim(),
            `--- SPECIFICATIONS D'EXPEDITION (BON DE SORTIE) ---`,
            `• Destination / Cible : ${data.destination.trim() || 'N/A'}`,
            `• N° Bon de Dispatch : ${data.dispatch_ref.trim() || 'N/A'}`,
            `• Livreur / Chauffeur : ${data.driver_name.trim() || 'N/A'}`,
            `• Véhicule Immatriculé : ${data.vehicle_plate.toUpperCase() || 'N/A'}`,
            `• Frais d'Expédition : ${data.shipping_fees || 0} DA`,
            `• Condition Colis : ${data.package_status.toUpperCase()}`,
            `• Agent Expéditeur : ${data.shipping_agent.trim() || 'Système'}`
         ].filter(Boolean).join('\n');

         if (selectedVariant === 'DETAILED') {
            const entries = Object.entries(variantQuantities).filter(([_, q]) => (q as number) > 0);
            if (entries.length === 0) {
               throw new Error("Veuillez saisir au moins une quantité à sortir.");
            }
            const results: any[] = [];
            for (const [variantStr, qty] of entries) {
               const negativeQty = -Math.abs(qty);
               const res = await apiFetch('/api/v1/stock/', {
                  method: 'POST',
                  body: JSON.stringify({
                     product_id: data.product_id,
                     warehouse_id: data.warehouse_id,
                     quantity: negativeQty,
                     type: 'MANUAL_ADJUSTMENT',
                     reason: `${richReason}\n• Variante : ${variantStr}`,
                     variant_details: { variant: variantStr },
                     store_id: storeId
                  })
               });
               results.push(res);
            }
            return results;
         } else {
            const negativeQty = -Math.abs(data.quantity);
            return apiFetch('/api/v1/stock/', {
               method: 'POST',
               body: JSON.stringify({
                  product_id: data.product_id,
                  warehouse_id: data.warehouse_id,
                  quantity: negativeQty,
                  type: 'MANUAL_ADJUSTMENT',
                  reason: selectedVariant !== 'ALL' ? `${richReason}\n• Variante : ${selectedVariant}` : richReason,
                  variant_details: selectedVariant !== 'ALL' ? { variant: selectedVariant } : undefined,
                  store_id: storeId
               })
            });
         }
      },
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['admin-products-stock'] });
         qc.invalidateQueries({ queryKey: ['admin-products'] });
         qc.invalidateQueries({ queryKey: ['inventory', 'summary'] });
         qc.invalidateQueries({ queryKey: ['inventory', 'movements'] });
         toast.success("Bon de Sortie validé avec succès ✓");
         onOpenChange(false);
         setFormData({
            product_id: '',
            warehouse_id: '',
            quantity: 0,
            destination: '',
            dispatch_ref: '',
            driver_name: '',
            vehicle_plate: '',
            shipping_fees: 0,
            package_status: 'parfait',
            shipping_agent: '',
            note: ''
         });
         setSelectedVariant('ALL');
         setVariantQuantities({});
      },
      onError: (err: any) => toast.error(err.message || "Échec de validation du Bon de Sortie"),
   });

   const excessStock = selectedProduct ? formData.quantity > selectedProduct.stock : false;

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent showCloseButton={false} className="max-w-3xl w-[95vw] p-0 border-none bg-white rounded-[32px] overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            <div className="bg-[#E17055] p-8 text-white shrink-0 border-b border-[#c9583d]">
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-5">
                     <div className="size-14 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/10">
                        <ArrowDownRight className="size-7 text-white" />
                     </div>
                     <div>
                        <DialogTitle className="text-xl font-black uppercase tracking-tight leading-none font-sans">Bon de Sortie Stock</DialogTitle>
                        <p className="text-white/60 text-[10px] font-black uppercase tracking-widest mt-1.5 flex items-center gap-1">
                           <Package className="size-3.5" /> Traçabilité des expéditions & retraits marchandises
                        </p>
                     </div>
                  </div>
                  <button onClick={() => onOpenChange(false)} className="p-2.5 rounded-xl hover:bg-white/10 transition-all shrink-0">
                     <X className="size-5 text-white/50" />
                  </button>
               </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar bg-[#F8F9FC]/30 font-sans">
               {/* ── 1. ARTICLE & HUB ── */}
               <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">1. Article & Hub Source</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <div className="md:col-span-2 space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Produit à sortir *</label>
                        <Select value={formData.product_id} onValueChange={v => {
                           setFormData({...formData, product_id: v, quantity: 0});
                           setSelectedVariant('ALL');
                           setVariantQuantities({});
                        }}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold shadow-sm">
                              <SelectValue placeholder="Sélectionner le produit" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl max-h-[300px]">
                              {products.map((p: any) => (
                                 <SelectItem key={p.id} value={p.id} className="font-bold text-xs">{p.name} (Dispo: {p.stock})</SelectItem>
                              ))}
                           </SelectContent>
                        </Select>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Entrepôt Source *</label>
                        <Select value={formData.warehouse_id} onValueChange={v => setFormData({...formData, warehouse_id: v})}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold shadow-sm">
                              <SelectValue placeholder="Hub" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl">
                              {warehouses.map((w: any) => (
                                 <SelectItem key={w.id} value={w.id} className="font-bold text-xs">{w.name}</SelectItem>
                              ))}
                           </SelectContent>
                        </Select>
                     </div>
                  </div>

                  {variantItems.length > 0 && (
                     <div className="p-4 rounded-xl bg-rose-50/50 border border-rose-100/80 space-y-3">
                        <div className="flex items-center justify-between">
                           <label className="text-[10px] font-black uppercase text-rose-800 tracking-wider">
                              Variantes du Produit ({variantItems.length})
                           </label>
                           <span className="text-[9px] font-bold text-rose-600 bg-white px-2 py-0.5 rounded-md border border-rose-200">
                              Retrait ciblé
                           </span>
                        </div>
                        <div className="space-y-1">
                           <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Variante à Déstocker</label>
                           <Select value={selectedVariant} onValueChange={v => {
                              setSelectedVariant(v);
                              if (v === 'DETAILED') {
                                 const total = Object.values(variantQuantities).reduce((a, b) => a + (b as number), 0);
                                 setFormData(prev => ({ ...prev, quantity: total }));
                              }
                           }}>
                              <SelectTrigger className="h-11 border-slate-200 bg-white rounded-xl px-3 text-xs font-bold">
                                 <SelectValue placeholder="Choisir la variante" />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl max-h-[260px]">
                                 <SelectItem value="ALL" className="font-bold text-xs">🌐 Toutes les variantes (Ventilation globale)</SelectItem>
                                 <SelectItem value="DETAILED" className="font-bold text-xs">📋 Saisie détaillée par variante (Recommandé)</SelectItem>
                                 {variantItems.map((vi: any) => (
                                    <SelectItem key={vi.variantStr} value={vi.variantStr} className="font-bold text-xs">
                                       🏷️ {vi.variantStr} (Dispo: {vi.stock})
                                    </SelectItem>
                                 ))}
                              </SelectContent>
                           </Select>
                        </div>

                        {selectedVariant === 'DETAILED' && (
                           <div className="space-y-2 pt-2 border-t border-rose-100/70">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                 {variantItems.map((vi: any) => (
                                    <div key={vi.variantStr} className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-slate-100 shadow-sm">
                                       <div className="flex flex-col pr-2">
                                          <span className="text-xs font-bold text-slate-800 line-clamp-1">{vi.variantStr}</span>
                                          <span className="text-[9px] font-bold text-slate-400">Max dispo : {vi.stock}</span>
                                       </div>
                                       <div className="w-24 shrink-0">
                                          <Input
                                             type="number"
                                             min={0}
                                             max={vi.stock}
                                             value={variantQuantities[vi.variantStr] || ''}
                                             onChange={e => {
                                                const val = Math.min(vi.stock, Math.max(0, parseInt(e.target.value) || 0));
                                                const updated = { ...variantQuantities, [vi.variantStr]: val };
                                                setVariantQuantities(updated);
                                                const total = Object.values(updated).reduce((a, b) => a + (b as number), 0);
                                                setFormData(prev => ({ ...prev, quantity: total }));
                                             }}
                                             placeholder="-0"
                                             className="h-8 text-xs font-bold text-center border-slate-200 text-rose-600"
                                          />
                                       </div>
                                    </div>
                                 ))}
                              </div>
                              <div className="flex justify-end pr-1 pt-1">
                                 <span className="text-[10px] font-black uppercase text-rose-700 tracking-wider">
                                    Total à sortir : {formData.quantity} unités
                                 </span>
                              </div>
                           </div>
                        )}
                     </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     {selectedVariant !== 'DETAILED' ? (
                        <div className="space-y-2">
                           <div className="flex items-center justify-between ml-1">
                              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
                                 {selectedVariant !== 'ALL' ? `Quantité pour ${selectedVariant} *` : 'Quantité à Sortir *'}
                              </label>
                              {(() => {
                                 const targetStock = selectedVariant !== 'ALL'
                                    ? variantItems.find((v: any) => v.variantStr === selectedVariant)?.stock ?? selectedProduct?.stock ?? 0
                                    : selectedProduct?.stock ?? 0;
                                 return <span className="text-[9px] font-bold text-[#6C5CE7]">Max dispo : {targetStock}</span>;
                              })()}
                           </div>
                           <div className="relative">
                              <Input 
                                 type="number"
                                 min={1}
                                 max={selectedVariant !== 'ALL' ? variantItems.find((v: any) => v.variantStr === selectedVariant)?.stock : selectedProduct?.stock || undefined}
                                 value={formData.quantity || ''}
                                 onChange={e => setFormData({...formData, quantity: parseInt(e.target.value) || 0})}
                                 placeholder="Nombre d'unités"
                                 className={`h-12 border-slate-100 bg-white rounded-xl pl-10 pr-12 text-xs font-black ${excessStock ? 'text-rose-500 border-rose-200' : 'text-slate-800'}`}
                              />
                              <Package className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#E17055]" />
                              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300">UNITÉS</span>
                           </div>
                           {excessStock && <p className="text-[9px] font-bold text-rose-500 mt-1">La quantité demandée dépasse le stock disponible.</p>}
                        </div>
                     ) : (
                        <div className="space-y-2">
                           <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Total Retrait</label>
                           <div className="h-12 border border-rose-100 bg-rose-50/40 rounded-xl px-4 flex items-center justify-between">
                              <span className="text-xs font-bold text-rose-800">Total cumulé à déstocker</span>
                              <span className="text-sm font-black text-rose-600 tabular-nums">-{formData.quantity} UNITÉS</span>
                           </div>
                        </div>
                     )}
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">État des Colis *</label>
                        <Select value={formData.package_status} onValueChange={v => setFormData({...formData, package_status: v})}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold uppercase shadow-sm">
                              <SelectValue placeholder="État" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl">
                              <SelectItem value="parfait" className="font-bold text-xs">PARFAIT ÉTAT</SelectItem>
                              <SelectItem value="reconditionne" className="font-bold text-xs text-amber-500">RECONDITIONNÉ</SelectItem>
                              <SelectItem value="defaillant" className="font-bold text-xs text-rose-500">DÉFAILLANT (RETOUR)</SelectItem>
                           </SelectContent>
                        </Select>
                     </div>
                  </div>
               </div>

               {/* ── 2. DESTINATION & DISPATCH ── */}
               <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">2. Destination & Numéro d'Ordre</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Destination / Partenaire</label>
                        <Input 
                           value={formData.destination}
                           onChange={e => setFormData({...formData, destination: e.target.value})}
                           placeholder="Ex: Hub Oran, Client B2B, Yalidine..."
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold text-slate-800"
                        />
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Numéro Bon de Dispatch (Si applicable)</label>
                        <Input 
                           value={formData.dispatch_ref}
                           onChange={e => setFormData({...formData, dispatch_ref: e.target.value})}
                           placeholder="Ex: BD-2026-001"
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-mono font-bold"
                        />
                     </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Coût / Frais d'Expédition (Optionnel)</label>
                        <div className="relative">
                           <Input 
                              type="number"
                              value={formData.shipping_fees || ''}
                              onChange={e => setFormData({...formData, shipping_fees: parseFloat(e.target.value) || 0})}
                              placeholder="0.00"
                              className="h-12 border-slate-100 bg-white rounded-xl pl-10 pr-12 text-xs font-black text-slate-800"
                           />
                           <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-300">DA</span>
                        </div>
                     </div>
                  </div>
               </div>

               {/* ── 3. LOGISTIQUE & ACTEURS ── */}
               <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">3. Logistique & Agent Expéditeur</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Nom du Chauffeur / Livreur</label>
                        <div className="relative">
                           <Input 
                              value={formData.driver_name}
                              onChange={e => setFormData({...formData, driver_name: e.target.value})}
                              placeholder="Chauffeur en charge..."
                              className="h-12 border-slate-100 bg-white rounded-xl pl-10 text-xs font-bold text-slate-800"
                           />
                           <Truck className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-300" />
                        </div>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Plaque d'Immatriculation Véhicule</label>
                        <Input 
                           value={formData.vehicle_plate}
                           onChange={e => setFormData({...formData, vehicle_plate: e.target.value})}
                           placeholder="Ex: 09841-118-31"
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-mono font-bold"
                        />
                     </div>
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Agent Expéditeur Responsable *</label>
                     <Input 
                        value={formData.shipping_agent}
                        onChange={e => setFormData({...formData, shipping_agent: e.target.value})}
                        placeholder="Ex: Responsable Expédition Oran"
                        className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold text-slate-800"
                     />
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Description / Note narrative libre</label>
                     <Textarea 
                        value={formData.note}
                        onChange={e => setFormData({...formData, note: e.target.value})}
                        placeholder="Note générale de la sortie de stock..."
                        className="border-slate-100 bg-[#F8F9FC]/50 hover:bg-white rounded-xl text-xs font-bold resize-none min-h-[80px]"
                     />
                  </div>
               </div>
            </div>

            <DialogFooter className="p-8 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3 shrink-0">
               <button onClick={() => onOpenChange(false)} className="h-12 px-6 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors">Fermer</button>
               <Button
                  onClick={() => exitMutation.mutate(formData)}
                  disabled={exitMutation.isPending || !formData.product_id || !formData.warehouse_id || formData.quantity <= 0 || excessStock}
                  className="h-12 px-10 rounded-xl bg-[#E17055] hover:bg-[#c9583d] text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-rose-100 transition-all active:scale-[0.98]"
               >
                  {exitMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "VALIDER LA SORTIE ✓"}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
