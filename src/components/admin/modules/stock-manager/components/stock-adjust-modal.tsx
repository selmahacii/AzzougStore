'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Package, RotateCcw, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import { toast } from 'sonner';
import { getProductVariantItems } from '../utils';

export function StockAdjustModal({ product, storeId, onClose }: { product: any; storeId: string; onClose: () => void }) {
   const qc = useQueryClient();
   const [variantAdjustments, setVariantAdjustments] = useState<Record<string, number>>({});
   const [adjustAmount, setAdjustAmount] = useState<number>(0);
   const [adjustReason, setAdjustReason] = useState('');

   const adjustMutation = useMutation({
      mutationFn: (data: any) => {
         const payload = {
            product_id: data.product_id,
            type: 'MANUAL_ADJUSTMENT',
            reason: data.reason,
            store_id: data.store_id,
            quantity: 0,
            variant_details: {}
         };

         const results = Promise.all(
            data.adjustments.map((adj: any) => {
               payload.quantity = adj.quantity;
               if (adj.variantStr) {
                  payload.variant_details = { variant: adj.variantStr };
               }
               return apiFetch('/api/v1/stock/', {
                  method: 'POST',
                  body: JSON.stringify(payload),
               });
            })
         );
         return results.then(res => {
            const failed = res.filter(r => (r as any).status === 'rejected').length;
            if (failed > 0) throw new Error(`${failed} ajustement(s) ont échoué`);
            return res;
         });
      },
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['admin-products-stock'] });
         qc.invalidateQueries({ queryKey: ['admin-products'] });
         qc.invalidateQueries({ queryKey: ['inventory', 'summary'] });
         toast.success("Ajustement validé avec succès");
         onClose();
      },
      onError: (err: any) => toast.error(err.message || 'Échec de l\'ajustement'),
   });

   const handleAdjustSubmit = () => {
      const variantItems = getProductVariantItems(product, {}); // Note: returnsByVariant omitted here for simplicity, can be fetched if needed
      if (variantItems.length > 0) {
         const adjustments = Object.entries(variantAdjustments)
            .map(([variantStr, qty]) => ({ variantStr, quantity: qty }))
            .filter(adj => adj.quantity !== 0);

         if (adjustments.length === 0) {
            toast.error("Veuillez saisir au moins une modification de quantité.");
            return;
         }

         adjustMutation.mutate({
            store_id: storeId,
            product_id: product.id,
            reason: adjustReason || 'Ajustement manuel via protocole stock',
            adjustments
         });
      } else {
         if (adjustAmount === 0) {
            toast.error("Veuillez spécifier une quantité d'ajustement non nulle.");
            return;
         }
         adjustMutation.mutate({
            store_id: storeId,
            product_id: product.id,
            reason: adjustReason || 'Ajustement manuel via protocole stock',
            adjustments: [{ quantity: adjustAmount }]
         });
      }
   };

   return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
         <div className="bg-white w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl border border-white/20 animate-in zoom-in-95 duration-300">
            <div className="p-8 space-y-6">
               <div className="flex justify-between items-start">
                  <div className="text-start">
                     <h2 className="text-xl font-black text-[#2D3436] uppercase tracking-tight">Protocole d'Ajustement</h2>
                     <p className="text-[10px] font-bold text-[#B2BEC3] uppercase tracking-widest mt-1">Produit: {product.name}</p>
                  </div>
                  <button onClick={onClose} className="size-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors">
                     <RotateCcw className="size-4 text-slate-400" />
                  </button>
               </div>

               <div className="bg-[#F8F9FC] p-6 rounded-2xl border border-[#E9ECF0] flex items-center justify-between">
                  <div className="flex flex-col text-start">
                     <span className="text-[10px] font-black text-[#B2BEC3] uppercase">Stock Actuel</span>
                     <span className="text-2xl font-black text-[#2D3436] tracking-tight">{product.stock} UNITS</span>
                  </div>
                  <Package className="size-10 text-[#6C5CE7] opacity-20" />
               </div>

               <div className="space-y-5">
                  {getProductVariantItems(product).length > 0 ? (
                     <div className="space-y-4 max-h-[35vh] overflow-y-auto pr-1">
                        <span className="text-[10px] font-black uppercase text-[#B2BEC3] tracking-widest block text-start">Ajustement détaillé des variantes</span>
                        {getProductVariantItems(product).map((item) => {
                           const currentAdj = variantAdjustments[item.variantStr] || 0;
                           return (
                              <div key={item.variantStr} className="p-4 bg-[#F8F9FC] rounded-2xl border border-[#E9ECF0] space-y-3">
                                 <div className="flex justify-between items-start">
                                    <div className="flex flex-col text-start">
                                       <span className="text-xs font-black text-slate-700">{item.variantStr}</span>
                                       <span className="text-[10px] text-slate-400 font-bold mt-0.5">
                                          Actuel : {item.stock} units · {item.reserved} réservés
                                          {item.returned > 0 && ` · ↩ ${item.returned} retour${item.returned > 1 ? 's' : ''}`}
                                       </span>
                                    </div>
                                 </div>
                                 <div className="flex items-center gap-3">
                                    <button 
                                       type="button" 
                                       onClick={() => setVariantAdjustments(prev => ({ ...prev, [item.variantStr]: (prev[item.variantStr] || 0) - 1 }))}
                                       className="size-9 rounded-lg border border-[#E9ECF0] flex items-center justify-center text-sm font-black hover:bg-slate-100"
                                    >
                                       —
                                    </button>
                                    <Input 
                                       type="number"
                                       value={currentAdj}
                                       onChange={(e) => {
                                          const val = parseInt(e.target.value) || 0;
                                          setVariantAdjustments(prev => ({ ...prev, [item.variantStr]: val }));
                                       }}
                                       className="h-9 w-24 bg-white border-[#E9ECF0] text-center text-sm font-black rounded-lg" 
                                    />
                                    <button 
                                       type="button" 
                                       onClick={() => setVariantAdjustments(prev => ({ ...prev, [item.variantStr]: (prev[item.variantStr] || 0) + 1 }))}
                                       className="size-9 rounded-lg border border-[#E9ECF0] flex items-center justify-center text-sm font-black hover:bg-slate-100 text-[#6C5CE7]"
                                    >
                                       +
                                    </button>
                                 </div>
                              </div>
                           );
                        })}
                     </div>
                  ) : (
                     <div className="space-y-2 text-start">
                        <label className="text-[10px] font-black uppercase text-[#B2BEC3] tracking-widest">Modification de quantité (±)</label>
                        <div className="flex items-center gap-4">
                           <button onClick={() => setAdjustAmount(a => a - 1)} className="size-12 rounded-xl border border-[#E9ECF0] flex items-center justify-center text-xl font-black hover:bg-slate-50">—</button>
                           <Input 
                              type="number"
                              value={adjustAmount}
                              onChange={(e) => setAdjustAmount(parseInt(e.target.value) || 0)}
                              className="h-14 bg-[#F8F9FC] border-[#E9ECF0] text-center text-xl font-black rounded-2xl focus:bg-white" 
                           />
                           <button onClick={() => setAdjustAmount(a => a + 1)} className="size-12 rounded-xl border border-[#E9ECF0] flex items-center justify-center text-xl font-black hover:bg-slate-50 text-[#6C5CE7]">+</button>
                        </div>
                     </div>
                  )}

                  <div className="space-y-2 text-start">
                     <label className="text-[10px] font-black uppercase text-[#B2BEC3] tracking-widest">Motif de l'opération</label>
                     <Input 
                        value={adjustReason}
                        onChange={(e) => setAdjustReason(e.target.value)}
                        placeholder="Ex: Réception livraison, Correction inventaire..." 
                        className="h-12 bg-[#F8F9FC] border-[#E9ECF0] rounded-xl text-sm font-bold" 
                     />
                  </div>
               </div>

               <div className="pt-4 flex gap-3">
                  <button 
                     onClick={onClose}
                     className="flex-1 h-14 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-slate-200 hover:bg-slate-50 transition-all"
                  >
                     Annuler
                  </button>
                  <Button 
                     onClick={handleAdjustSubmit}
                     disabled={adjustMutation.isPending}
                     className="flex-1 h-14 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-black text-white hover:opacity-90 transition-all font-bold"
                  >
                     {adjustMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : 'Confirmer le Flux'}
                  </Button>
               </div>
            </div>
         </div>
      </div>
   );
}
