'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Box, X, ArrowUpRight, ShieldCheck, Truck, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import { toast } from 'sonner';

import { getProductVariantItems } from '../utils';

export function StockEntryModal({ open, onOpenChange, products, warehouses, storeId }: any) {
   const qc = useQueryClient();
   const [formData, setFormData] = useState({
      product_id: '',
      warehouse_id: '',
      quantity: 0,
      supplier: '',
      invoice_ref: '',
      batch_id: '',
      expiration_date: '',
      quality_status: 'conforme',
      carrier_name: '',
      vehicle_plate: '',
      receiving_agent: '',
      note: ''
   });
   const [selectedVariant, setSelectedVariant] = useState<string>('ALL');
   const [variantQuantities, setVariantQuantities] = useState<Record<string, number>>({});

   const selectedProduct = products?.find((p: any) => p.id === formData.product_id);
   const variantItems = getProductVariantItems(selectedProduct, {});

   const entryMutation = useMutation({
      mutationFn: async (data: any) => {
         const richReason = [
            data.note.trim(),
            `--- SPECIFICATIONS DE RECEPTION (BON D'ENTREE) ---`,
            `• Fournisseur : ${data.supplier.trim() || 'N/A'}`,
            `• Facture / N° PO : ${data.invoice_ref.trim() || 'N/A'}`,
            `• N° de Lot / Batch : ${data.batch_id.trim() || 'N/A'}`,
            `• Expiration : ${data.expiration_date || 'N/A'}`,
            `• Statut Qualité : ${data.quality_status.toUpperCase()}`,
            `• Transporteur : ${data.carrier_name.trim() || 'N/A'}`,
            `• Véhicule : ${data.vehicle_plate.toUpperCase() || 'N/A'}`,
            `• Agent Réceptionnaire : ${data.receiving_agent.trim() || 'Système'}`
         ].filter(Boolean).join('\n');

         if (selectedVariant === 'DETAILED') {
            const entries = Object.entries(variantQuantities).filter(([_, q]) => (q as number) > 0);
            if (entries.length === 0) {
               throw new Error("Veuillez saisir au moins une quantité pour une variante.");
            }
            const results: any[] = [];
            for (const [variantStr, qty] of entries) {
               const res = await apiFetch('/api/v1/stock/', {
                  method: 'POST',
                  body: JSON.stringify({
                     product_id: data.product_id,
                     warehouse_id: data.warehouse_id,
                     quantity: qty,
                     type: 'RESTOCK',
                     reason: `${richReason}\n• Variante : ${variantStr} (${variantStr})`,
                     variant_details: { variant: variantStr },
                     store_id: storeId
                  })
               });
               results.push(res);
            }
            return results;
         } else {
            return apiFetch('/api/v1/stock/', {
               method: 'POST',
               body: JSON.stringify({
                  product_id: data.product_id,
                  warehouse_id: data.warehouse_id,
                  quantity: data.quantity,
                  type: 'RESTOCK',
                  reason: selectedVariant !== 'ALL' ? `${richReason}\n• Variante : ${selectedVariant} (${selectedVariant})` : richReason,
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
         qc.invalidateQueries({ queryKey: ['product-movements'] });
         qc.invalidateQueries({ queryKey: ['product-detail-live'] });
         toast.success("Bon d'Entrée validé avec succès ✓");
         onOpenChange(false);
         setFormData({
            product_id: '',
            warehouse_id: '',
            quantity: 0,
            supplier: '',
            invoice_ref: '',
            batch_id: '',
            expiration_date: '',
            quality_status: 'conforme',
            carrier_name: '',
            vehicle_plate: '',
            receiving_agent: '',
            note: ''
         });
         setSelectedVariant('ALL');
         setVariantQuantities({});
      },
      onError: (err: any) => toast.error(err.message || "Échec de validation du Bon d'Entrée"),
   });

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent showCloseButton={false} className="max-w-3xl w-[95vw] p-0 border-none bg-white rounded-[32px] overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            <div className="bg-[#00B894] p-8 text-white shrink-0 border-b border-[#009b7c]">
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-5">
                     <div className="size-14 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/10">
                        <ArrowUpRight className="size-7 text-white" />
                     </div>
                     <div>
                        <DialogTitle className="text-xl font-black uppercase tracking-tight leading-none font-sans">Bon d'Entrée en Stock</DialogTitle>
                        <p className="text-white/60 text-[10px] font-black uppercase tracking-widest mt-1.5 flex items-center gap-1">
                           <ShieldCheck className="size-3.5" /> Enregistrement et traçabilité de réception marchandises
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
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">1. Article & Hub Cible</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <div className="md:col-span-2 space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Produit *</label>
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
                                 <SelectItem key={p.id} value={p.id} className="font-bold text-xs">{p.name} (Stock: {p.stock})</SelectItem>
                              ))}
                           </SelectContent>
                        </Select>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Entrepôt Cible *</label>
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
                     <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-100/80 space-y-3">
                        <div className="flex items-center justify-between">
                           <label className="text-[10px] font-black uppercase text-emerald-800 tracking-wider">
                              Variantes du Produit ({variantItems.length})
                           </label>
                           <span className="text-[9px] font-bold text-emerald-600 bg-white px-2 py-0.5 rounded-md border border-emerald-200">
                              Traçabilité multi-variante
                           </span>
                        </div>
                        <div className="space-y-1">
                           <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Cible Réception</label>
                           <Select value={selectedVariant} onValueChange={v => {
                              setSelectedVariant(v);
                              if (v === 'DETAILED') {
                                 const total = Object.values(variantQuantities).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
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
                                       🏷️ {vi.variantStr} (Stock: {vi.stock})
                                    </SelectItem>
                                 ))}
                              </SelectContent>
                           </Select>
                        </div>

                        {selectedVariant === 'DETAILED' && (
                           <div className="space-y-2 pt-2 border-t border-emerald-100/70">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                 {variantItems.map((vi: any) => (
                                    <div key={vi.variantStr} className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-slate-100 shadow-sm">
                                       <div className="flex flex-col pr-2">
                                          <span className="text-xs font-bold text-slate-800 line-clamp-1">{vi.variantStr}</span>
                                          <span className="text-[9px] font-bold text-slate-400">Stock actuel : {vi.stock}</span>
                                       </div>
                                       <div className="w-24 shrink-0">
                                          <Input
                                             type="number"
                                             min={0}
                                             value={variantQuantities[vi.variantStr] || ''}
                                             onChange={e => {
                                                const val = Math.max(0, parseInt(e.target.value) || 0);
                                                const updated: Record<string, number> = { ...variantQuantities, [vi.variantStr]: val };
                                                setVariantQuantities(updated);
                                                const total = Object.values(updated).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
                                                setFormData(prev => ({ ...prev, quantity: total }));
                                             }}
                                             placeholder="+0"
                                             className="h-8 text-xs font-bold text-center border-slate-200"
                                          />
                                       </div>
                                    </div>
                                 ))}
                              </div>
                              <div className="flex justify-end pr-1 pt-1">
                                 <span className="text-[10px] font-black uppercase text-emerald-700 tracking-wider">
                                    Total calculé : {formData.quantity} unités
                                 </span>
                              </div>
                           </div>
                        )}
                     </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     {selectedVariant !== 'DETAILED' ? (
                        <div className="space-y-2">
                           <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">
                              {selectedVariant !== 'ALL' ? `Quantité pour ${selectedVariant} *` : 'Quantité à Entrer *'}
                           </label>
                           <div className="relative">
                              <Input 
                                 type="number"
                                 min={1}
                                 value={formData.quantity || ''}
                                 onChange={e => setFormData({...formData, quantity: parseInt(e.target.value) || 0})}
                                 placeholder="Nombre d'unités"
                                 className="h-12 border-slate-100 bg-white rounded-xl pl-10 pr-12 text-xs font-black text-slate-800"
                              />
                              <Box className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-emerald-400" />
                              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300">UNITÉS</span>
                           </div>
                        </div>
                     ) : (
                        <div className="space-y-2">
                           <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Total Unités Sélectionnées</label>
                           <div className="h-12 border border-emerald-100 bg-emerald-50/40 rounded-xl px-4 flex items-center justify-between">
                              <span className="text-xs font-bold text-emerald-800">Total cumulé des variantes</span>
                              <span className="text-sm font-black text-emerald-700 tabular-nums">{formData.quantity} UNITÉS</span>
                           </div>
                        </div>
                     )}
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">État de Qualité *</label>
                        <Select value={formData.quality_status} onValueChange={v => setFormData({...formData, quality_status: v})}>
                           <SelectTrigger className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold uppercase shadow-sm">
                              <SelectValue placeholder="État" />
                           </SelectTrigger>
                           <SelectContent className="rounded-xl">
                              <SelectItem value="conforme" className="font-bold text-xs">CONFORME / SCELLÉ</SelectItem>
                              <SelectItem value="conforme_partiel" className="font-bold text-xs">CONFORME AVEC RÉSÈRVE</SelectItem>
                              <SelectItem value="endommage" className="font-bold text-xs text-rose-500">EMBALLAGE ENDOMMAGÉ</SelectItem>
                              <SelectItem value="litige" className="font-bold text-xs text-amber-500">LITIGE CONSTATÉ</SelectItem>
                           </SelectContent>
                        </Select>
                     </div>
                  </div>
               </div>

               {/* ── 2. TRAÇABILITÉ FOURNISSEUR & BATCH ── */}
               <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">2. Provenance & Identification Lots</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Nom Fournisseur / Usine</label>
                        <Input 
                           value={formData.supplier}
                           onChange={e => setFormData({...formData, supplier: e.target.value})}
                           placeholder="Ex: Importations Azzoug, Usine Blida..."
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold text-slate-800"
                        />
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Numéro Facture / N° PO</label>
                        <Input 
                           value={formData.invoice_ref}
                           onChange={e => setFormData({...formData, invoice_ref: e.target.value})}
                           placeholder="Ex: FA-2026-904"
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-mono font-bold"
                        />
                     </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Numéro de Lot / Batch</label>
                        <Input 
                           value={formData.batch_id}
                           onChange={e => setFormData({...formData, batch_id: e.target.value})}
                           placeholder="Ex: LOT-SH-2026-X"
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-mono font-bold"
                        />
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Date d'Expiration (Le cas échéant)</label>
                        <div className="relative">
                           <Input 
                              type="date"
                              value={formData.expiration_date}
                              onChange={e => setFormData({...formData, expiration_date: e.target.value})}
                              className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold text-slate-700"
                           />
                        </div>
                     </div>
                  </div>
               </div>

               {/* ── 3. LOGISTIQUE & ACTEURS ── */}
               <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">3. Transporteur & Réception</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Chauffeur / Transporteur</label>
                        <div className="relative">
                           <Input 
                              value={formData.carrier_name}
                              onChange={e => setFormData({...formData, carrier_name: e.target.value})}
                              placeholder="Nom complet du chauffeur..."
                              className="h-12 border-slate-100 bg-white rounded-xl pl-10 text-xs font-bold text-slate-800"
                           />
                           <Truck className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-300" />
                        </div>
                     </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Plaque d'Immatriculation</label>
                        <Input 
                           value={formData.vehicle_plate}
                           onChange={e => setFormData({...formData, vehicle_plate: e.target.value})}
                           placeholder="Ex: 01423-116-16"
                           className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-mono font-bold"
                        />
                     </div>
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Agent Réceptionnaire (Signataire) *</label>
                     <Input 
                        value={formData.receiving_agent}
                        onChange={e => setFormData({...formData, receiving_agent: e.target.value})}
                        placeholder="Ex: Responsable Dépôt Blida"
                        className="h-12 border-slate-100 bg-white rounded-xl px-4 text-xs font-bold text-slate-800"
                     />
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Description / Note narrative libre</label>
                     <Textarea 
                        value={formData.note}
                        onChange={e => setFormData({...formData, note: e.target.value})}
                        placeholder="Note générale de l'entrée en stock..."
                        className="border-slate-100 bg-[#F8F9FC]/50 hover:bg-white rounded-xl text-xs font-bold resize-none min-h-[80px]"
                     />
                  </div>
               </div>
            </div>

            <DialogFooter className="p-8 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3 shrink-0">
               <button onClick={() => onOpenChange(false)} className="h-12 px-6 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors">Fermer</button>
               <Button 
                  onClick={() => entryMutation.mutate(formData)}
                  disabled={entryMutation.isPending || !formData.product_id || !formData.warehouse_id || formData.quantity <= 0}
                  className="h-12 px-10 rounded-xl bg-[#00B894] hover:bg-[#009b7c] text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-100 transition-all active:scale-[0.98]"
               >
                  {entryMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "VALIDER L'ENTRÉE ✓"}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
