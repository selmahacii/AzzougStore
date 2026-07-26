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

   const exitMutation = useMutation({
      mutationFn: (data: any) => {
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

         // Exit quantities MUST be negative for withdrawal!
         const negativeQty = -Math.abs(data.quantity);

         return apiFetch('/api/v1/stock/', {
            method: 'POST',
            body: JSON.stringify({
               product_id: data.product_id,
               warehouse_id: data.warehouse_id,
               quantity: negativeQty,
               type: 'MANUAL_ADJUSTMENT',
               reason: richReason,
               store_id: storeId
            })
         });
      },
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['admin-products-stock'] });
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
      },
      onError: (err: any) => toast.error(err.message || "Échec de validation du Bon de Sortie"),
   });

   const selectedProduct = products.find((p: any) => p.id === formData.product_id);
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
                        <Select value={formData.product_id} onValueChange={v => setFormData({...formData, product_id: v})}>
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

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <div className="flex items-center justify-between ml-1">
                           <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Quantité à Sortir *</label>
                           {selectedProduct && <span className="text-[9px] font-bold text-[#6C5CE7]">Max dispo : {selectedProduct.stock}</span>}
                        </div>
                        <div className="relative">
                           <Input 
                              type="number"
                              min={1}
                              max={selectedProduct?.stock || undefined}
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
