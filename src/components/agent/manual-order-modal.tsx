
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2, Package, Search, CheckCircle, MapPin, AlertCircle, ShoppingCart, ArrowRightLeft } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { WILAYAS } from '@/lib/wilaya-data';
import { ALGERIAN_COMMUNES } from '@/lib/algerian-communes';

export function ManualOrderModal({ isOpen, setIsOpen, onSuccess }: { isOpen: boolean, setIsOpen: (v: boolean) => void, onSuccess?: () => void }) {
  const { activeStore, user } = useAppStore();
  const storeId = activeStore?.id ?? '';
  const qc = useQueryClient();
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  // States for manual order creation
  
  const [selectedOrderProduct, setSelectedOrderProduct] = useState<any | null>(null);
  const [orderPrice, setOrderPrice] = useState(0);
  const [orderQty, setOrderQty] = useState(1);
  const [orderSource, setOrderSource] = useState('MANUAL');
  const [orderWilaya, setOrderWilaya] = useState('');
  const [selectedPartnerId, setSelectedPartnerId] = useState('');
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [deliveryType, setDeliveryType] = useState('home');

  const [orderDiscount, setOrderDiscount] = useState(0);
  const [isPack, setIsPack] = useState(false);
  const [isUpsell, setIsUpsell] = useState(false);
  
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedSize, setSelectedSize] = useState('');

  useEffect(() => {
    setSelectedColor('');
    setSelectedSize('');
  }, [selectedOrderProduct]);

  const colorVariants = selectedOrderProduct?.variants || [];
  const selectedColorVar = colorVariants.find((v: any) => v.value === selectedColor);
  const sizeVariants = selectedColorVar?.sub_variants || [];

  const selectedSku = selectedSize 
    ? sizeVariants.find((sv: any) => sv.value === selectedSize)?.sku 
    : (selectedColorVar?.sku || selectedOrderProduct?.sku);

  useEffect(() => {
    if (selectedOrderProduct) {
      const basePrice = selectedOrderProduct.price ?? 0;
      const mod = selectedSize
        ? (sizeVariants.find((sv: any) => sv.value === selectedSize)?.priceModifier ?? 0)
        : (selectedColorVar?.priceModifier ?? 0);
      setOrderPrice(basePrice + mod);
    }
  }, [selectedColor, selectedSize, selectedOrderProduct]);
  

  
  const productsQuery = useQuery<any>({
    queryKey: ['admin-products-lite', storeId],
    enabled: isOpen && !!storeId,
    queryFn: () => apiFetch(`/api/v1/products?store_id=${storeId}&minimal=true`),
  });

  const deliveryPartnersQuery = useQuery<any>({
    queryKey: ['delivery-partners-lite', storeId],
    enabled: isOpen && !!storeId,
    queryFn: () => apiFetch(`/api/v1/delivery-partners?store_id=${storeId}`),
  });
    useEffect(() => {
    if (!selectedPartnerId || !orderWilaya) return;
    const fetchFee = async () => {
      try {
        const pId = selectedOrderProduct?.id || '';
        const res = await apiFetch<any>(
          `/api/v1/delivery-partners/calculate?partnerId=${selectedPartnerId}&wilayaId=${orderWilaya}&type=${deliveryType}&productIds=${pId}`
        );
        if (res?.success && typeof res?.data?.fee === 'number') {
          setDeliveryFee(res.data.fee);
          toast.success(`Tarif de livraison mis à jour : ${res.data.fee} DA`);
        }
      } catch (error) {
        console.error('Error fetching shipping fee:', error);
      }
    };
    fetchFee();
  }, [selectedPartnerId, orderWilaya, deliveryType, selectedOrderProduct]);

  const checkDuplicatePhone = async (phone: string) => {
    // simplified or skipped
  };

  const createOrderMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiFetch('/api/v1/orders', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return res;
    },
    onSuccess: () => {
      toast.success('Commande créée avec succès');
      setIsOpen(false);
      qc.invalidateQueries({ queryKey: ['agent-orders'] });
      qc.invalidateQueries({ queryKey: ['agent-perf'] });
      if (onSuccess) onSuccess();
    },
    onError: (err: any) => {
      toast.error(err.message || 'Erreur lors de la création de la commande');
    }
  });

  const primaryColor = (activeStore as any)?.theme_color || '#3b82f6';

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="w-[98vw] max-w-[1200px] bg-white border border-neutral-200 text-slate-900 p-0 rounded-[32px] overflow-hidden max-h-[95vh] overflow-y-auto custom-scrollbar shadow-2xl">
        <div className="sticky top-0 px-12 py-8 z-20 flex items-center justify-between text-white" style={{ backgroundColor: primaryColor }}>
          <div className="space-y-1">
            <DialogTitle className="text-xl font-black uppercase tracking-widest text-white shadow-sm">Saisie de Commande</DialogTitle>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/80">Création d'une nouvelle commande manuelle</p>
          </div>
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="border-white/30 text-white bg-white/10 uppercase text-[10px] font-black tracking-widest px-4 py-1.5 rounded-full backdrop-blur-sm">Saisie Manuelle (Confirmatrice)</Badge>
          </div>
        </div>

        <form 
          onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            if (!selectedOrderProduct) {
              toast.error('Veuillez selectionner un produit');
              return;
            }
            const commune = (formData.get('commune') as string) || '';
            const address = (formData.get('address') as string) || '';
            const lineTotal = orderPrice * orderQty;
            const total = Math.max(0, lineTotal + deliveryFee - orderDiscount);
            const payload = {
              store_id: storeId,
              customer_name: formData.get('customer_name') as string,
              customer_phone: formData.get('customer_phone') as string,
              customer_wilaya: orderWilaya,
              customer_commune: commune || undefined,
              customer_address: [commune, address].filter(Boolean).join(', '),
              notes: formData.get('notes') as string || undefined,
              delivery_type: deliveryType,
              delivery_fee: deliveryFee,
              subtotal: lineTotal,
              discount: orderDiscount,
              total,
              source: orderSource,
                  carrier_id: selectedPartnerId || undefined,
                  assigned_to: user?.id || undefined, // Assigned directly to this agent
                  items: [{
                    product_id: selectedOrderProduct.id,
                    product_name: selectedOrderProduct.name,
                    quantity: orderQty,
                    unit_price: orderPrice,
                    sku: selectedSku || selectedOrderProduct.sku,
                    variant_details: {
                      ...(selectedColor ? { Couleur: selectedColor, Color: selectedColor } : {}),
                      ...(selectedSize ? { Taille: selectedSize, Size: selectedSize } : {}),
                      ...(selectedColor || selectedSize ? { variant: [selectedColor, selectedSize].filter(Boolean).join(' / ') } : {})
                    }
                  }],
                  is_pack: isPack,
                  is_upsell: isUpsell,
                };
                createOrderMutation.mutate(payload);
              }}
              className="p-12 space-y-12 bg-white"
            >
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 lg:gap-12 text-slate-800">
                 <div className="space-y-10">
                    <div className="flex items-center gap-4 border-l-2 pl-4" style={{ borderColor: primaryColor }}>
                       <span className="text-sm font-bold uppercase tracking-widest text-[#2D3436]">01. Coordonnées du Client</span>
                    </div>
                    <div className="space-y-6">
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Nom du client</label>
                             <Input name="customer_name" required placeholder="Ex: Mohamed Amine" className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4 placeholder:text-neutral-400" />
                          </div>
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Téléphone *</label>
                             <Input 
                                name="customer_phone" 
                                required 
                                placeholder="0550 00 00 00" 
                                onBlur={async (e) => {
                                  const phone = e.target.value.trim();
                                  if (!phone || phone.length < 9) { setDuplicateWarning(null); return; }
                                  try {
                                    const res = await apiFetch(`/orders/check-duplicate?phone=${encodeURIComponent(phone)}&store_id=${storeId}`) as any;
                                    if (res.is_duplicate) setDuplicateWarning(`Attention : Ce client a déjà commandé récemment (${res.order_number}) !`);
                                    else setDuplicateWarning(null);
                                  } catch(e) {}
                                }}
                                className={cn("bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4 placeholder:text-neutral-400", "")} 
                             />
                             {duplicateWarning && <p className="text-[10px] font-bold text-rose-600 mt-1">{duplicateWarning}</p>}
                          </div>
                       </div>
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Wilaya *</label>
                             <Select value={orderWilaya} onValueChange={setOrderWilaya} required>
                                <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4">
                                   <SelectValue placeholder="Sélectionnez une wilaya" />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-neutral-100 text-black max-h-[300px]">
                                   {WILAYAS.map((w, idx) => <SelectItem key={w} value={w} className="text-sm font-medium py-2">{idx + 1}. {w}</SelectItem>)}
                                </SelectContent>
                             </Select>
                          </div>
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Commune *</label>
                             <Select name="commune" required disabled={!orderWilaya}>
                                <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4">
                                   <SelectValue placeholder={orderWilaya ? "Sélectionnez une commune" : "Sélectionnez une wilaya d'abord"} />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-neutral-100 text-black max-h-[300px]">
                                   {orderWilaya && ALGERIAN_COMMUNES[orderWilaya]?.map((c) => (
                                      <SelectItem key={c.id} value={c.nameAscii} className="text-sm font-medium py-2">
                                         {c.nameAscii}
                                      </SelectItem>
                                   ))}
                                </SelectContent>
                             </Select>
                          </div>
                       </div>
                       <div className="space-y-3">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Adresse</label>
                          <Input name="address" placeholder="RUE, QUARTIER, BÂTIMENT..." className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4 placeholder:text-neutral-400" />
                       </div>
                       <div className="space-y-3">
                           <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Note Globale / Remarques</label>
                           <Textarea name="notes" placeholder="Instructions pour la livraison..." className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium min-h-[100px] rounded-xl focus:bg-white transition-all p-4 resize-none placeholder:text-neutral-400" />
                        </div>
                    </div>
                 </div>

                 <div className="space-y-10">
                    <div className="flex items-center justify-between border-l-2 pl-4" style={{ borderColor: primaryColor }}>
                       <span className="text-sm font-bold uppercase tracking-widest text-[#2D3436]">02. Détails de l'Expédition</span>
                       <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 border border-indigo-100 rounded-xl">
                             <Checkbox id="isPack" checked={isPack} onCheckedChange={(c) => setIsPack(!!c)} className="size-4 border-indigo-200 data-[state=checked]:bg-[#6C5CE7] rounded-md" />
                             <label htmlFor="isPack" className="text-[11px] font-black uppercase tracking-widest text-[#6C5CE7] cursor-pointer">Pack Spécial</label>
                          </div>
                          <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 border border-emerald-100 rounded-xl">
                             <Checkbox id="isUpsell" checked={isUpsell} onCheckedChange={(c) => setIsUpsell(!!c)} className="size-4 border-emerald-200 data-[state=checked]:bg-emerald-500 rounded-md" />
                             <label htmlFor="isUpsell" className="text-[11px] font-black uppercase tracking-widest text-emerald-600 cursor-pointer">Vente Additionnelle</label>
                          </div>
                       </div>
                    </div>

                    <div className="space-y-6">
                       <div className="space-y-3">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Produit Principal *</label>
                          <Select onValueChange={(v) => {
                             const p = productsQuery.data?.data?.find((x: any) => x.id === v);
                             setSelectedOrderProduct(p);
                             if (p) setOrderPrice(p.price ?? 0);
                          }}>
                             <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-14 rounded-xl focus:bg-white transition-all px-4">
                                <SelectValue placeholder="Rechercher Produit..." />
                             </SelectTrigger>
                             <SelectContent className="bg-white border-neutral-100 text-black rounded-xl">
                                {productsQuery.data?.data?.map((p: any) => (
                                   <SelectItem key={p.id} value={p.id} className="text-sm font-medium py-2">{p.name} — SKU: {p.sku}</SelectItem>
                                ))}
                             </SelectContent>
                          </Select>

                          {selectedOrderProduct?.variants && selectedOrderProduct.variants.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 animate-in fade-in duration-250">
                              <div className="space-y-3">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-[#6C5CE7]">Couleur / Modèle</label>
                                <Select value={selectedColor} onValueChange={setSelectedColor}>
                                  <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4">
                                    <SelectValue placeholder="Choisir Couleur" />
                                  </SelectTrigger>
                                  <SelectContent className="bg-white border-neutral-100 text-black rounded-xl">
                                    {colorVariants.map((v, i) => (
                                      <SelectItem key={i} value={v.value} className="text-sm font-medium py-2">{v.value}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-3">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-[#6C5CE7]">Taille / Option</label>
                                <Select value={selectedSize} onValueChange={setSelectedSize} disabled={!selectedColor || sizeVariants.length === 0}>
                                  <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4 disabled:opacity-50">
                                    <SelectValue placeholder="Choisir Taille" />
                                  </SelectTrigger>
                                  <SelectContent className="bg-white border-neutral-100 text-black rounded-xl">
                                    {sizeVariants.map((sv, i) => (
                                      <SelectItem key={i} value={sv.value} className="text-sm font-medium py-2">{sv.value}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          )}
                       </div>

                       <div className="grid grid-cols-3 gap-4">
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">SKU</label>
                             <Input disabled value={selectedSku || selectedOrderProduct?.sku || '---'} className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] italic text-xs h-12 rounded-xl" />
                          </div>
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Stock</label>
                             <div className={cn("h-12 border flex items-center px-4 font-black rounded-xl font-mono text-[10px] uppercase", (selectedOrderProduct?.stock ?? 0) > 0 ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-rose-50 text-rose-600 border-rose-100")}>
                                {selectedOrderProduct?.stock ?? '—'} {selectedOrderProduct ? 'EN STOCK' : ''}
                             </div>
                          </div>
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Quantité</label>
                             <Input type="number" min={1} value={orderQty} onChange={e => setOrderQty(Math.max(1, parseInt(e.target.value) || 1))} className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-bold h-12 rounded-xl text-center" />
                          </div>
                       </div>

                       <div className="grid grid-cols-3 gap-4">
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Prix Unitaire (DA) *</label>
                             <Input type="number" step="1" value={orderPrice} onChange={e => setOrderPrice(Math.round(parseFloat(e.target.value) || 0))} className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-bold h-12 rounded-xl focus:bg-white transition-all px-4" />
                          </div>
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Frais Livraison (DA)</label>
                             <Input readOnly name="delivery_fee" type="number" step="1" value={deliveryFee} className="bg-[#F8F9FC] border-[#E9ECF0] text-sm font-bold h-12 rounded-xl px-4 text-[#2D3436] opacity-70 cursor-not-allowed" />
                          </div>
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Remise (DA)</label>
                             <Input name="discount" type="number" step="1" value={orderDiscount} onChange={e => setOrderDiscount(Math.round(parseFloat(e.target.value) || 0))} className="bg-[#F8F9FC] border-[#E9ECF0] text-sm font-bold h-12 rounded-xl focus:bg-white transition-all px-4 text-[#2D3436]" />
                          </div>
                       </div>

                       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Source de Commande</label>
                             <Select value={orderSource} onValueChange={setOrderSource}>
                                <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4">
                                   <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-neutral-100 text-black rounded-xl">
                                   <SelectItem value="MANUAL">Saisie Manuelle</SelectItem>
                                   <SelectItem value="PHONE">Appel Direct</SelectItem>
                                </SelectContent>
                             </Select>
                          </div>
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Mode de Réception</label>
                             <Select value={deliveryType} onValueChange={setDeliveryType}>
                                <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4">
                                   <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-neutral-100 text-black rounded-xl">
                                   <SelectItem value="home">Livraison à Domicile</SelectItem>
                                   <SelectItem value="stop_desk">Stop Desk (Bureau)</SelectItem>
                                </SelectContent>
                             </Select>
                          </div>
                          <div className="space-y-3">
                             <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Entreprise de Livraison *</label>
                             <Select value={selectedPartnerId} onValueChange={setSelectedPartnerId}>
                                <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white transition-all px-4">
                                   <SelectValue placeholder={deliveryPartnersQuery.isLoading ? "Chargement..." : "Choisir Transporteur"} />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-neutral-100 text-black rounded-xl max-h-[250px]">
                                   {deliveryPartnersQuery.data?.data?.map((partner: any) => (
                                      <SelectItem key={partner.id} value={partner.id} className="text-sm font-medium py-2">
                                         {partner.name} ({partner.carrier_id.toUpperCase()})
                                      </SelectItem>
                                   ))}
                                   {(!deliveryPartnersQuery.data?.data || deliveryPartnersQuery.data.data.length === 0) && (
                                      <SelectItem value="none" disabled>Aucun livreur configuré</SelectItem>
                                   )}
                                </SelectContent>
                             </Select>
                          </div>
                       </div>
                    </div>
                 </div>
              </div>

              <div className="pt-8 border-t flex items-center justify-between bg-white">
                 <div className="space-y-1 text-slate-800">
                    <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Total à encaisser</p>
                    <div className="text-3xl font-black text-[#2D3436] font-mono tabular-nums">
                       {formatPrice(Math.max(0, (orderPrice * orderQty) + deliveryFee - orderDiscount))}
                    </div>
                    <p className="text-[10px] text-neutral-400 font-bold">
                      {orderQty > 1 && <>{orderQty} × {formatPrice(orderPrice)} · </>}
                      + {formatPrice(deliveryFee)} (livraison) · - {formatPrice(orderDiscount)} (remise)
                    </p>
                 </div>
                 <Button type="submit" disabled={createOrderMutation.isPending} className="h-14 px-10 text-[12px] font-bold uppercase tracking-widest text-white shadow-xl group rounded-xl border-none" style={{ backgroundColor: primaryColor }}>
                    {createOrderMutation.isPending ? <Loader2 className="size-5 animate-spin" /> : <>Enregistrer la Commande <ArrowRightLeft className="ml-3 size-4 group-hover:translate-x-1 transition-transform" /></>}
                 </Button>
              </div>
            </form>
         </DialogContent>
      </Dialog>
  );
}
