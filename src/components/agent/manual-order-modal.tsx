
import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { 
  Loader2, 
  Package, 
  Search, 
  AlertCircle, 
  ShoppingCart, 
  ArrowRightLeft, 
  X, 
  Building2, 
  Zap, 
  Plus, 
  Minus, 
  Trash2, 
  Layers,
  ShoppingBag,
  Store
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { WILAYAS } from '@/lib/wilaya-data';
import { ALGERIAN_COMMUNES, getCommunesForWilaya } from '@/lib/algerian-communes';
import { NOEST_BUREAUX } from '@/lib/noest-bureaux-data';

// ─── Interfaces & Types ───────────────────────────────────────────────────────

interface NormalizedSubVariant {
  name: string;
  value: string;
  sku?: string;
  stock?: number;
  reserved?: number;
  priceModifier?: number;
  price?: number;
}

interface NormalizedVariant {
  name: string;
  value: string;
  color?: string;
  sku?: string;
  stock?: number;
  reserved?: number;
  priceModifier?: number;
  price?: number;
  image?: string;
  sub_variants: NormalizedSubVariant[];
}

export type OrderLine = {
  product_id: string;
  product_name: string;
  sku?: string;
  quantity: number;
  unit_price: number;
  color?: string;
  size?: string;
  is_upsell?: boolean;
};

// ─── Variant Normalizer ───────────────────────────────────────────────────────

function normalizeProductVariants(product: any): NormalizedVariant[] {
  if (!product || !product.variants) return [];
  const raw = product.variants;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  // Case 1: Array of { name, value, sub_variants, ... }
  if (raw[0] && typeof raw[0] === 'object' && 'value' in raw[0]) {
    return raw.map((v: any) => ({
      name: v.name || 'Option',
      value: String(v.value || '').trim(),
      color: v.color,
      sku: v.sku || product.sku,
      stock: typeof v.stock === 'number' ? v.stock : product.stock,
      reserved: v.reserved || 0,
      priceModifier: Number(v.priceModifier || 0),
      price: v.price,
      image: v.image,
      sub_variants: Array.isArray(v.sub_variants)
        ? v.sub_variants.map((sv: any) => ({
            name: sv.name || 'Taille',
            value: String(sv.value || '').trim(),
            sku: sv.sku || v.sku || product.sku,
            stock: typeof sv.stock === 'number' ? sv.stock : v.stock,
            reserved: sv.reserved || 0,
            priceModifier: Number(sv.priceModifier || 0),
            price: sv.price,
          }))
        : [],
    }));
  }

  // Case 2: Array of { name, options: [...] }
  if (raw[0] && typeof raw[0] === 'object' && 'options' in raw[0] && Array.isArray(raw[0].options)) {
    const primaryGroup = raw[0];
    const secondaryGroup = raw.length > 1 && raw[1].options && Array.isArray(raw[1].options) ? raw[1] : null;

    return (primaryGroup.options || []).map((opt: any) => {
      const optVal = typeof opt === 'object' ? (opt.value || opt.name || opt.title || '') : String(opt || '').trim();
      const subVars: NormalizedSubVariant[] = secondaryGroup
        ? (secondaryGroup.options || []).map((sopt: any) => {
            const sVal = typeof sopt === 'object' ? (sopt.value || sopt.name || sopt.title || '') : String(sopt || '').trim();
            return {
              name: secondaryGroup.name || 'Taille',
              value: sVal,
              sku: typeof sopt === 'object' ? sopt.sku : undefined,
              stock: typeof sopt === 'object' && typeof sopt.stock === 'number' ? sopt.stock : product.stock,
              priceModifier: typeof sopt === 'object' ? Number(sopt.priceModifier || 0) : 0,
            };
          })
        : [];

      return {
        name: primaryGroup.name || 'Couleur',
        value: optVal,
        sku: typeof opt === 'object' ? opt.sku : product.sku,
        stock: typeof opt === 'object' && typeof opt.stock === 'number' ? opt.stock : product.stock,
        priceModifier: typeof opt === 'object' ? Number(opt.priceModifier || 0) : 0,
        sub_variants: subVars,
      };
    });
  }

  // Case 3: Flat array of strings e.g. ['Noir', 'Bleu', 'Gris']
  if (typeof raw[0] === 'string') {
    return raw.map((str: string) => ({
      name: 'Option',
      value: String(str).trim(),
      sku: product.sku,
      stock: product.stock,
      priceModifier: 0,
      sub_variants: [],
    }));
  }

  // Case 4: Array of objects with title/name
  return raw.map((item: any) => ({
    name: item.name || 'Option',
    value: String(item.title || item.name || item.value || 'Standard').trim(),
    sku: item.sku || product.sku,
    stock: typeof item.stock === 'number' ? item.stock : product.stock,
    reserved: item.reserved || 0,
    priceModifier: Number(item.priceModifier || 0),
    price: item.price,
    sub_variants: [],
  }));
}

// ─── Main Modal Component ─────────────────────────────────────────────────────

export function ManualOrderModal({ 
  isOpen, 
  setIsOpen, 
  onSuccess 
}: { 
  isOpen: boolean; 
  setIsOpen: (v: boolean) => void; 
  onSuccess?: () => void; 
}) {
  const { activeStore, user, allStores } = useAppStore();
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const qc = useQueryClient();
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  // Determine effective store ID
  const effectiveStoreId = selectedStoreId
    || activeStore?.id
    || user?.employee_store_id
    || (Array.isArray(user?.assigned_store_ids) && user.assigned_store_ids[0])
    || (allStores?.[0]?.id)
    || '';

  // Product Selection & Filter States
  const [productTypeFilter, setProductTypeFilter] = useState<'all' | 'standard' | 'upsell'>('all');
  const [productSearch, setProductSearch] = useState('');
  const [selectedOrderProduct, setSelectedOrderProduct] = useState<any | null>(null);

  // Price & Quantity States for Line Composer
  const [orderPrice, setOrderPrice] = useState<number>(0);
  const [orderQty, setOrderQty] = useState<number>(1);
  const [selectedColor, setSelectedColor] = useState<string>('');
  const [selectedSize, setSelectedSize] = useState<string>('');

  // General Order States
  const [orderSource, setOrderSource] = useState('MANUAL');
  const [orderWilaya, setOrderWilaya] = useState('');
  const [selectedPartnerId, setSelectedPartnerId] = useState('');
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [deliveryType, setDeliveryType] = useState('home');
  const [selectedBureauCode, setSelectedBureauCode] = useState('');
  const [customBureauName, setCustomBureauName] = useState('');
  const [orderDiscount, setOrderDiscount] = useState(0);

  // Order Flags
  const [isPack, setIsPack] = useState(false);
  const [isUpsell, setIsUpsell] = useState(false);
  const [isMarketplaceUpsell, setIsMarketplaceUpsell] = useState(false);

  // Multi-line Cart State
  const [orderLines, setOrderLines] = useState<OrderLine[]>([]);

  // Reset product variant sub-selections when product changes
  useEffect(() => {
    setSelectedColor('');
    setSelectedSize('');
  }, [selectedOrderProduct]);

  // Fresh state initialization on open
  useEffect(() => {
    if (isOpen) {
      const defaultStoreId = activeStore?.id 
        || user?.employee_store_id 
        || (Array.isArray(user?.assigned_store_ids) && user.assigned_store_ids[0])
        || (allStores?.[0]?.id)
        || '';
      setSelectedStoreId(defaultStoreId);
      setOrderLines([]);
      setSelectedOrderProduct(null);
      setSelectedColor('');
      setSelectedSize('');
      setOrderQty(1);
      setOrderPrice(0);
      setOrderDiscount(0);
      setDuplicateWarning(null);
      setSelectedBureauCode('');
      setCustomBureauName('');
      setProductTypeFilter('all');
      setProductSearch('');
      setIsPack(false);
      setIsUpsell(false);
      setIsMarketplaceUpsell(false);
    }
  }, [isOpen, activeStore, user, allStores]);

  // Load all products including Upsell-only items
  const productsQuery = useQuery<any>({
    queryKey: ['admin-products-full-catalogue', effectiveStoreId],
    enabled: isOpen && !!effectiveStoreId,
    queryFn: () => apiFetch(`/api/v1/products?store_id=${effectiveStoreId}&include_upsell_only=true&pageSize=1000`),
    staleTime: 10_000,
    refetchInterval: isOpen ? 20_000 : false,
    refetchIntervalInBackground: false,
  });

  const productsList: any[] = useMemo(() => {
    return Array.isArray(productsQuery.data)
      ? productsQuery.data
      : (productsQuery.data?.data || productsQuery.data?.products || []);
  }, [productsQuery.data]);

  // Filtered Products based on Type Filter and Search term
  const filteredProducts = useMemo(() => {
    let list = productsList;
    if (productTypeFilter === 'standard') {
      list = list.filter(p => !p.is_upsell_only);
    } else if (productTypeFilter === 'upsell') {
      list = list.filter(p => !!p.is_upsell_only);
    }

    if (productSearch.trim()) {
      const q = productSearch.trim().toLowerCase();
      list = list.filter(p => 
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q))
      );
    }
    return list;
  }, [productsList, productTypeFilter, productSearch]);

  const upsellProductsCount = useMemo(() => {
    return productsList.filter(p => !!p.is_upsell_only).length;
  }, [productsList]);

  const standardProductsCount = useMemo(() => {
    return productsList.filter(p => !p.is_upsell_only).length;
  }, [productsList]);

  // Delivery Partners Query
  const deliveryPartnersQuery = useQuery<any>({
    queryKey: ['delivery-partners-lite', effectiveStoreId],
    enabled: isOpen && !!effectiveStoreId,
    queryFn: () => apiFetch(`/api/v1/delivery-partners?store_id=${effectiveStoreId}`),
  });

  const deliveryPartnersList: any[] = Array.isArray(deliveryPartnersQuery.data)
    ? deliveryPartnersQuery.data
    : (deliveryPartnersQuery.data?.data || deliveryPartnersQuery.data?.partners || []);

  useEffect(() => {
    if (!selectedPartnerId && deliveryPartnersList.length > 0) {
      setSelectedPartnerId(deliveryPartnersList[0].id);
    }
  }, [deliveryPartnersList, selectedPartnerId]);

  // Wilaya & Bureau resolution
  const matchedWilayaId = orderWilaya ? WILAYAS.indexOf(orderWilaya as any) + 1 : null;
  const availableBureaux = matchedWilayaId ? NOEST_BUREAUX.filter(b => b.wilayaId === matchedWilayaId) : [];
  const matchedBureauObj = availableBureaux.find(b => b.code === selectedBureauCode);

  // Normalized Variant Details for the Selected Product
  const normalizedVariants: NormalizedVariant[] = useMemo(() => {
    return normalizeProductVariants(selectedOrderProduct);
  }, [selectedOrderProduct]);

  const selectedVariantObj = useMemo(() => {
    return normalizedVariants.find(v => v.value === selectedColor) || null;
  }, [normalizedVariants, selectedColor]);

  const availableSubVariants: NormalizedSubVariant[] = useMemo(() => {
    return selectedVariantObj?.sub_variants || [];
  }, [selectedVariantObj]);

  const selectedSubVariantObj = useMemo(() => {
    return availableSubVariants.find(sv => sv.value === selectedSize) || null;
  }, [availableSubVariants, selectedSize]);

  // Effective Variant Micro-details
  const effectiveVariant = selectedSubVariantObj || (selectedVariantObj && availableSubVariants.length === 0 ? selectedVariantObj : null);
  
  const selectedSku = effectiveVariant?.sku || selectedOrderProduct?.sku || '—';
  
  const variantStockAvailable = effectiveVariant
    ? Number(effectiveVariant.stock || 0) - Number(effectiveVariant.reserved || 0)
    : (normalizedVariants.length === 0 ? Number(selectedOrderProduct?.stock || 0) - Number(selectedOrderProduct?.reserved_stock || 0) : null);

  // Auto-set unit price when product or variant changes
  useEffect(() => {
    if (selectedOrderProduct) {
      const basePrice = Number(selectedOrderProduct.price ?? 0);
      const varMod = Number(selectedVariantObj?.priceModifier ?? 0);
      const subMod = Number(selectedSubVariantObj?.priceModifier ?? 0);
      const computedPrice = basePrice + varMod + subMod;
      setOrderPrice(computedPrice);

      // Auto-set upsell flag if an upsell product is picked
      if (selectedOrderProduct.is_upsell_only) {
        setIsUpsell(true);
      }
    }
  }, [selectedOrderProduct, selectedVariantObj, selectedSubVariantObj]);

  // Dynamic Shipping Fee Calculation
  useEffect(() => {
    if (deliveryType === 'STORE_PICKUP') {
      setDeliveryFee(0);
      return;
    }
    if (!selectedPartnerId || !orderWilaya) return;
    const fetchFee = async () => {
      try {
        const pId = Array.from(new Set(
          [selectedOrderProduct?.id, ...orderLines.map(l => l.product_id)].filter(Boolean)
        )).join(',');
        const res = await apiFetch<any>(
          `/api/v1/delivery-partners/calculate?partnerId=${selectedPartnerId}&wilayaId=${encodeURIComponent(orderWilaya)}&type=${deliveryType}&productIds=${pId}`
        );
        const fee = typeof res?.fee === 'number' ? res.fee : (typeof res?.data?.fee === 'number' ? res.data.fee : null);
        if (fee !== null) {
          setDeliveryFee(fee);
          toast.success(`Frais de livraison calculés : ${fee} DA`);
        }
      } catch (error) {
        console.error('Error fetching shipping fee:', error);
      }
    };
    fetchFee();
  }, [selectedPartnerId, orderWilaya, deliveryType, selectedOrderProduct, orderLines]);

  // ── Cart Manipulation Helpers ──────────────────────────────────────────────

  const addCurrentLine = (): boolean => {
    if (!selectedOrderProduct) {
      toast.error('Sélectionnez un produit avant de l\'ajouter au panier');
      return false;
    }
    if (normalizedVariants.length > 0 && !selectedColor) {
      toast.error(`Choisissez la variante (${normalizedVariants[0]?.name || 'Couleur / Modèle'})`);
      return false;
    }
    if (selectedColor && availableSubVariants.length > 0 && !selectedSize) {
      toast.error(`Choisissez l'option (${availableSubVariants[0]?.name || 'Taille / Format'})`);
      return false;
    }

    const newLine: OrderLine = {
      product_id: selectedOrderProduct.id,
      product_name: selectedOrderProduct.name,
      sku: selectedSku !== '—' ? selectedSku : selectedOrderProduct.sku,
      quantity: orderQty,
      unit_price: orderPrice,
      color: selectedColor || undefined,
      size: selectedSize || undefined,
      is_upsell: !!selectedOrderProduct.is_upsell_only,
    };

    setOrderLines(prev => {
      const idx = prev.findIndex(l =>
        l.product_id === newLine.product_id && l.color === newLine.color && l.size === newLine.size
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { 
          ...next[idx], 
          quantity: next[idx].quantity + newLine.quantity, 
          unit_price: newLine.unit_price 
        };
        return next;
      }
      return [...prev, newLine];
    });

    // Auto-mark order as upsell if at least one item is an upsell product
    if (selectedOrderProduct.is_upsell_only) {
      setIsUpsell(true);
    }

    toast.success(`${selectedOrderProduct.name} ajouté au panier`);

    // Reset composer for next item
    setSelectedColor('');
    setSelectedSize('');
    setOrderQty(1);
    return true;
  };

  const removeLine = (idx: number) => {
    setOrderLines(prev => prev.filter((_, i) => i !== idx));
  };

  const updateLineQty = (idx: number, delta: number) => {
    setOrderLines(prev => {
      const next = [...prev];
      if (next[idx]) {
        const newQ = Math.max(1, next[idx].quantity + delta);
        next[idx] = { ...next[idx], quantity: newQ };
      }
      return next;
    });
  };

  const setLineDirectQty = (idx: number, qty: number) => {
    setOrderLines(prev => {
      const next = [...prev];
      if (next[idx]) {
        next[idx] = { ...next[idx], quantity: Math.max(1, qty) };
      }
      return next;
    });
  };

  const setLineDirectPrice = (idx: number, price: number) => {
    setOrderLines(prev => {
      const next = [...prev];
      if (next[idx]) {
        next[idx] = { ...next[idx], unit_price: Math.max(0, price) };
      }
      return next;
    });
  };

  const lineToItem = (l: OrderLine) => ({
    product_id: l.product_id,
    product_name: l.product_name,
    quantity: l.quantity,
    unit_price: l.unit_price,
    sku: l.sku,
    variant_details: {
      ...(l.color ? { Couleur: l.color, Color: l.color } : {}),
      ...(l.size ? { Taille: l.size, Size: l.size } : {}),
      ...(l.color || l.size ? { variant: [l.color, l.size].filter(Boolean).join(' / ') } : {}),
    },
  });

  const linesSubtotal = orderLines.reduce((acc, l) => acc + l.quantity * l.unit_price, 0);

  const composerComplete = !!selectedOrderProduct
    && !(normalizedVariants.length > 0 && !selectedColor)
    && !(selectedColor && availableSubVariants.length > 0 && !selectedSize);

  const grandSubtotal = linesSubtotal + (composerComplete ? orderPrice * orderQty : 0);

  // ─── Mutation: Create Order ─────────────────────────────────────────────────

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
      <DialogContent showCloseButton={false} className="w-[98vw] max-w-[1250px] bg-white border border-slate-200 text-slate-900 p-0 rounded-[32px] overflow-hidden max-h-[92vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 px-4 py-4 sm:px-8 sm:py-6 lg:px-10 lg:py-6 z-20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-white shrink-0" style={{ backgroundColor: primaryColor }}>
          <div className="space-y-1 min-w-0">
            <DialogTitle className="text-xl font-black uppercase tracking-widest text-white shadow-sm flex items-center gap-2.5">
              <ShoppingBag className="size-5" />
              <span>Saisie de Commande Manuelle</span>
            </DialogTitle>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/80">
              Création et encaissement direct · Produits standards & Upsell
            </p>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 shrink-0 self-start sm:self-auto">
            <Badge variant="outline" className="border-white/30 text-white bg-white/10 uppercase text-[10px] font-black tracking-widest px-4 py-1.5 rounded-full backdrop-blur-sm">
              Saisie Confirmatrice
            </Badge>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Fermer"
              className="p-2 rounded-xl bg-white/15 hover:bg-white/25 transition-all shrink-0 cursor-pointer"
            >
              <X className="size-5 text-white" />
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form 
          onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);

            const finalLines: OrderLine[] = [...orderLines];
            if (selectedOrderProduct) {
              const needsColor = normalizedVariants.length > 0 && !selectedColor;
              const needsSize = !!selectedColor && availableSubVariants.length > 0 && !selectedSize;
              
              if (needsColor || needsSize) {
                if (finalLines.length === 0) {
                  toast.error(needsColor ? 'Choisissez la variante du produit sélectionné' : 'Choisissez la taille / option de la variante');
                  return;
                }
              } else {
                const composed: OrderLine = {
                  product_id: selectedOrderProduct.id,
                  product_name: selectedOrderProduct.name,
                  sku: selectedSku !== '—' ? selectedSku : selectedOrderProduct.sku,
                  quantity: orderQty,
                  unit_price: orderPrice,
                  color: selectedColor || undefined,
                  size: selectedSize || undefined,
                  is_upsell: !!selectedOrderProduct.is_upsell_only,
                };
                const idx = finalLines.findIndex(l =>
                  l.product_id === composed.product_id && l.color === composed.color && l.size === composed.size
                );
                if (idx >= 0) finalLines[idx] = { ...finalLines[idx], quantity: finalLines[idx].quantity + composed.quantity };
                else finalLines.push(composed);
              }
            }

            if (finalLines.length === 0) {
              toast.error('Veuillez sélectionner au moins un produit pour valider la commande');
              return;
            }

            const rawName = (formData.get('customer_name') as string)?.trim();
            const rawPhone = (formData.get('customer_phone') as string)?.trim();
            const commune = (formData.get('commune') as string)?.trim() || '';
            const address = (formData.get('address') as string)?.trim() || '';
            const lineTotal = finalLines.reduce((acc, l) => acc + l.quantity * l.unit_price, 0);
            const total = Math.max(0, lineTotal + deliveryFee - orderDiscount);

            const bureauInfoText = matchedBureauObj
              ? `Bureau ${matchedBureauObj.code} - ${matchedBureauObj.name} (${matchedBureauObj.address})`
              : (customBureauName ? `Bureau ${customBureauName}` : '');

            const addressParts = deliveryType === 'stop_desk'
              ? [bureauInfoText, commune, address].filter(Boolean)
              : [commune, address].filter(Boolean);

            const customerAddress = addressParts.join(', ') || orderWilaya || 'Algérie';

            const containsUpsell = isUpsell || finalLines.some(l => l.is_upsell);

            const payload = {
              store_id: effectiveStoreId,
              customer_name: rawName || 'Client',
              customer_phone: rawPhone,
              customer_wilaya: orderWilaya || 'Alger',
              customer_commune: commune || undefined,
              customer_address: customerAddress,
              notes: (formData.get('notes') as string)?.trim() || undefined,
              delivery_type: (deliveryType || 'HOME').toUpperCase(),
              delivery_fee: deliveryFee || 0,
              subtotal: lineTotal || 0,
              discount: orderDiscount || 0,
              total: total,
              items: finalLines.map(lineToItem),
              status: 'CONFIRMED',
              source: orderSource || 'MANUAL',
              carrier_id: selectedPartnerId || undefined,
              assigned_to: user?.id || undefined,
              is_abandoned_cart: false,
              is_pack: isPack,
              is_upsell: containsUpsell,
              is_marketplace_upsell: isMarketplaceUpsell,
            };
            createOrderMutation.mutate(payload);
          }}
          className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white"
        >
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-10 space-y-8 bg-white custom-scrollbar">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 lg:gap-10 text-slate-800">
              
              {/* ── COLONNE GAUCHE: COORDONNÉES CLIENT ──────────────────────── */}
              <div className="space-y-6">
                <div className="flex items-center justify-between border-l-4 pl-3" style={{ borderColor: primaryColor }}>
                  <span className="text-xs font-black uppercase tracking-widest text-slate-900">01. Coordonnées du Client</span>
                </div>

                {allStores && allStores.length > 1 && (
                  <div className="space-y-2 p-3 bg-slate-50 border border-slate-200/80 rounded-2xl">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Boutique Concernée *</label>
                    <Select value={effectiveStoreId} onValueChange={(v) => { setSelectedStoreId(v); setSelectedOrderProduct(null); }}>
                      <SelectTrigger className="bg-white border-slate-200 text-slate-900 text-sm font-bold h-11 rounded-xl focus:bg-white transition-all px-4">
                        <SelectValue placeholder="Sélectionner la boutique..." />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200 text-slate-900 rounded-xl">
                        {allStores.map((s: any) => (
                          <SelectItem key={s.id} value={s.id} className="text-sm font-bold py-2">{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Nom & Prénom du Client *</label>
                      <Input name="customer_name" required placeholder="Ex: Mohamed Amine" className="bg-slate-50 border-slate-200 text-slate-900 text-sm font-medium h-11 rounded-xl focus:bg-white transition-all px-4 placeholder:text-slate-400" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Numéro de Téléphone *</label>
                      <Input 
                        name="customer_phone" 
                        required 
                        placeholder="0550 00 00 00" 
                        onBlur={async (e) => {
                          const phone = e.target.value.trim();
                          if (!phone || phone.length < 9) { setDuplicateWarning(null); return; }
                          try {
                            const res = await apiFetch(`/api/v1/orders/check-duplicate?phone=${encodeURIComponent(phone)}&store_id=${effectiveStoreId}`) as any;
                            if (res.is_duplicate) setDuplicateWarning(`Attention : Ce client a déjà commandé récemment (${res.order_number}) !`);
                            else setDuplicateWarning(null);
                          } catch(e) {}
                        }}
                        className="bg-slate-50 border-slate-200 text-slate-900 text-sm font-bold h-11 rounded-xl focus:bg-white transition-all px-4 placeholder:text-slate-400 font-mono" 
                      />
                    </div>
                  </div>

                  {duplicateWarning && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-bold text-amber-800 flex items-center gap-2">
                      <AlertCircle className="size-4 shrink-0 text-amber-600" />
                      <span>{duplicateWarning}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Wilaya de Destination *</label>
                      <Select value={orderWilaya} onValueChange={(w) => setOrderWilaya(w)}>
                        <SelectTrigger className="bg-slate-50 border-slate-200 text-slate-900 text-sm font-medium h-11 rounded-xl focus:bg-white transition-all px-4">
                          <SelectValue placeholder="Sélectionner Wilaya..." />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-slate-200 text-slate-900 rounded-xl max-h-[300px]">
                          {WILAYAS.map((w, idx) => (
                            <SelectItem key={w} value={w} className="text-sm font-medium py-2">
                              {idx + 1}. {w}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Commune</label>
                      <Select name="commune">
                        <SelectTrigger className="bg-slate-50 border-slate-200 text-slate-900 text-sm font-medium h-11 rounded-xl focus:bg-white transition-all px-4">
                          <SelectValue placeholder="Sélectionner Commune..." />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-slate-200 text-slate-900 rounded-xl max-h-[300px]">
                          {(orderWilaya ? getCommunesForWilaya(orderWilaya) : []).map((c) => (
                            <SelectItem key={`${c.id}-${c.nameAscii}`} value={c.nameAscii} className="text-sm font-medium py-2">
                              {c.nameAscii}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Mode de Réception *</label>
                    <Select value={deliveryType} onValueChange={setDeliveryType}>
                      <SelectTrigger className="bg-slate-50 border-slate-200 text-slate-900 text-sm font-medium h-11 rounded-xl focus:bg-white transition-all px-4">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200 text-slate-900 rounded-xl z-[100]">
                        <SelectItem value="home">Livraison à Domicile</SelectItem>
                        <SelectItem value="stop_desk">Stop Desk (Retrait Bureau)</SelectItem>
                        <SelectItem value="STORE_PICKUP">Retrait Point de Vente / Magasin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {deliveryType === 'stop_desk' && (
                    <div className="space-y-3 p-4 bg-amber-50/80 border border-amber-300 rounded-2xl animate-in fade-in duration-200 shadow-xs">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                          <Building2 className="size-3.5 text-amber-600 shrink-0" />
                          Bureau / Stop Desk de Destination *
                        </label>
                        <Select value={selectedBureauCode} onValueChange={setSelectedBureauCode}>
                          <SelectTrigger className="bg-white border-amber-300 text-slate-900 text-xs sm:text-sm font-bold h-11 rounded-xl focus:bg-white transition-all px-3 sm:px-4">
                            <SelectValue placeholder={!orderWilaya ? "Sélectionnez d'abord une Wilaya..." : (availableBureaux.length === 0 ? "Aucun bureau pré-enregistré pour cette wilaya" : "Sélectionner un bureau disponible...")} />
                          </SelectTrigger>
                          <SelectContent className="bg-white border-amber-300 text-slate-900 rounded-xl max-h-[280px] z-[100]">
                            {availableBureaux.map((b) => (
                              <SelectItem key={b.code} value={b.code} className="text-xs font-bold py-2.5">
                                {b.code} — {b.name} ({b.address})
                              </SelectItem>
                            ))}
                            {availableBureaux.length === 0 && (
                              <SelectItem value="none" disabled>Précisez le bureau manuellement ci-dessous</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-amber-800 uppercase">Ou Saisissez le Nom du Bureau Manuellement</label>
                        <Input
                          value={customBureauName}
                          onChange={(e) => setCustomBureauName(e.target.value)}
                          placeholder="Ex: Bureau Yalidine 05A, StopDesk Barika..."
                          className="bg-white border-amber-300 text-slate-900 text-xs font-bold h-10 rounded-xl px-4 placeholder:text-slate-400"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Adresse Complète</label>
                    <Input name="address" placeholder="Rue, Quartier, Bâtiment..." className="bg-slate-50 border-slate-200 text-slate-900 text-sm font-medium h-11 rounded-xl focus:bg-white transition-all px-4 placeholder:text-slate-400" />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Notes & Instructions Confirmatrice</label>
                    <Textarea name="notes" placeholder="Instructions particulières pour la livraison ou le colis..." className="bg-slate-50 border-slate-200 text-slate-900 text-sm font-medium min-h-[85px] rounded-xl focus:bg-white transition-all p-3.5 resize-none placeholder:text-slate-400" />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Source de Commande</label>
                      <Select value={orderSource} onValueChange={setOrderSource}>
                        <SelectTrigger className="bg-slate-50 border-slate-200 text-slate-900 text-sm font-medium h-11 rounded-xl focus:bg-white transition-all px-4">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-slate-200 text-slate-900 rounded-xl">
                          <SelectItem value="MANUAL">Saisie Manuelle (Staff)</SelectItem>
                          <SelectItem value="PHONE">Appel Téléphonique Entrant</SelectItem>
                          <SelectItem value="WHATSAPP">WhatsApp / Message Direct</SelectItem>
                          <SelectItem value="POS">Point de Vente / Magasin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Société de Livraison *</label>
                      <Select value={selectedPartnerId} onValueChange={setSelectedPartnerId}>
                        <SelectTrigger className="bg-slate-50 border-slate-200 text-slate-900 text-sm font-medium h-11 rounded-xl focus:bg-white transition-all px-4">
                          <SelectValue placeholder={deliveryPartnersQuery.isLoading ? "Chargement..." : "Choisir Transporteur"} />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-slate-200 text-slate-900 rounded-xl max-h-[250px]">
                          {deliveryPartnersList.map((partner: any) => (
                            <SelectItem key={partner.id} value={partner.id} className="text-sm font-medium py-2">
                              {partner.name} {partner.carrier_id ? `(${partner.carrier_id.toUpperCase()})` : ''}
                            </SelectItem>
                          ))}
                          {deliveryPartnersList.length === 0 && (
                            <SelectItem value="none" disabled>Aucun livreur configuré</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── COLONNE DROITE: SÉLECTION PRODUITS, VARIANTES & UPSELLS ──── */}
              <div className="space-y-6">
                <div className="flex items-center justify-between border-l-4 pl-3" style={{ borderColor: primaryColor }}>
                  <span className="text-xs font-black uppercase tracking-widest text-slate-900">02. Catalogue, Variantes & Articles</span>
                  
                  {/* Flags */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-indigo-50 px-2.5 py-1 border border-indigo-100 rounded-lg">
                      <Checkbox id="isPack" checked={isPack} onCheckedChange={(c) => setIsPack(!!c)} className="size-3.5 border-indigo-300 data-[state=checked]:bg-[#6C5CE7] rounded" />
                      <label htmlFor="isPack" className="text-[10px] font-black uppercase text-[#6C5CE7] cursor-pointer">Pack</label>
                    </div>
                    <div className="flex items-center gap-1.5 bg-purple-50 px-2.5 py-1 border border-purple-200 rounded-lg">
                      <Checkbox id="isUpsell" checked={isUpsell} onCheckedChange={(c) => setIsUpsell(!!c)} className="size-3.5 border-purple-300 data-[state=checked]:bg-purple-600 rounded" />
                      <label htmlFor="isUpsell" className="text-[10px] font-black uppercase text-purple-700 cursor-pointer flex items-center gap-1">
                        <Zap className="size-3 text-purple-600" />
                        Upsell
                      </label>
                    </div>
                    <div className="flex items-center gap-1.5 bg-pink-50 px-2.5 py-1 border border-pink-200 rounded-lg">
                      <Checkbox 
                        id="isMarketplaceUpsell" 
                        checked={isMarketplaceUpsell} 
                        onCheckedChange={(c) => {
                          const isChecked = !!c;
                          setIsMarketplaceUpsell(isChecked);
                          if (isChecked) {
                            setOrderSource('MARKETPLACE');
                            setProductTypeFilter('all');
                          } else if (orderSource === 'MARKETPLACE') {
                            setOrderSource('MANUAL');
                          }
                        }} 
                        className="size-3.5 border-pink-300 data-[state=checked]:bg-pink-600 rounded" 
                      />
                      <label htmlFor="isMarketplaceUpsell" className="text-[10px] font-black uppercase text-pink-700 cursor-pointer flex items-center gap-1">
                        <Store className="size-3 text-pink-600" />
                        Marketplace (50 DA)
                      </label>
                    </div>
                  </div>
                </div>

                {/* Marketplace Info Banner */}
                {isMarketplaceUpsell && (
                  <div className="p-3 bg-pink-50 border border-pink-200 rounded-xl flex items-center justify-between gap-3 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2">
                      <Store className="size-4 text-pink-600 shrink-0" />
                      <div>
                        <p className="text-xs font-black text-pink-900">
                          Commande Marketplace sélectionnée (Commission: +50 DA)
                        </p>
                        <p className="text-[10px] text-pink-700 font-medium">
                          Tous les produits standards du catalogue et produits upsells sont affichés et éligibles.
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] font-black font-mono text-pink-700 bg-white px-2.5 py-1 rounded-full border border-pink-200 shrink-0">
                      +50 DA
                    </span>
                  </div>
                )}

                {/* Filter Tabs: Tous vs Standard vs Upsell */}
                <div className="flex items-center justify-between gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setProductTypeFilter('all')}
                    className={cn(
                      "flex-1 py-1.5 px-2 text-xs font-black rounded-lg transition-all text-center flex items-center justify-center gap-1.5",
                      productTypeFilter === 'all' 
                        ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs" 
                        : "text-slate-500 hover:text-slate-800"
                    )}
                  >
                    <Package className="size-3.5 text-blue-600" />
                    Tous ({productsList.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setProductTypeFilter('standard')}
                    className={cn(
                      "flex-1 py-1.5 px-2 text-xs font-black rounded-lg transition-all text-center flex items-center justify-center gap-1.5",
                      productTypeFilter === 'standard' 
                        ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs" 
                        : "text-slate-500 hover:text-slate-800"
                    )}
                  >
                    <Layers className="size-3.5 text-indigo-600" />
                    Standards ({standardProductsCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setProductTypeFilter('upsell')}
                    className={cn(
                      "flex-1 py-1.5 px-2 text-xs font-black rounded-lg transition-all text-center flex items-center justify-center gap-1.5",
                      productTypeFilter === 'upsell' 
                        ? "bg-purple-600 text-white shadow-xs" 
                        : "text-purple-700 hover:text-purple-900"
                    )}
                  >
                    <Zap className="size-3.5" />
                    Upsell ({upsellProductsCount})
                  </button>
                </div>

                {/* Search Bar for Quick Filtering */}
                <div className="relative">
                  <Search className="size-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Rechercher par nom, SKU ou catégorie..."
                    className="pl-9 bg-slate-50 border-slate-200 text-xs font-medium h-10 rounded-xl"
                  />
                  {productSearch && (
                    <button 
                      type="button" 
                      onClick={() => setProductSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>

                {/* Product Dropdown Selector */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center justify-between">
                    <span>Sélectionner le Produit *</span>
                    {selectedOrderProduct?.is_upsell_only && (
                      <span className="text-[10px] text-purple-700 font-black flex items-center gap-1 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">
                        <Zap className="size-3" /> Produit Upsell Détecté
                      </span>
                    )}
                  </label>
                  <Select 
                    value={selectedOrderProduct?.id || ''} 
                    onValueChange={(v) => {
                      const p = productsList.find((x: any) => x.id === v);
                      setSelectedOrderProduct(p);
                    }}
                  >
                    <SelectTrigger className="bg-slate-50 border-slate-200 text-slate-900 text-sm font-bold h-12 rounded-xl focus:bg-white transition-all px-4">
                      <SelectValue placeholder={productsQuery.isLoading ? "Chargement des produits..." : (filteredProducts.length === 0 ? "Aucun produit trouvé" : "Choisir un produit...")} />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200 text-slate-900 rounded-xl max-h-[320px] z-[100]">
                      {filteredProducts.map((p: any) => (
                        <SelectItem key={p.id} value={p.id} className="text-xs font-bold py-2.5">
                          <div className="flex items-center justify-between gap-2 w-full">
                            <span className="truncate">
                              {p.is_upsell_only && <strong className="text-purple-600 mr-1.5">[UPSELL]</strong>}
                              {p.name}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono shrink-0">
                              {formatPrice(p.price)} · {(p.stock || 0) - (p.reserved_stock || 0)} disp.
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* ── Micro-détails des Variantes ── */}
                {selectedOrderProduct && (
                  <div className="p-4 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-4 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-black uppercase text-slate-700 flex items-center gap-1.5">
                        <Layers className="size-3.5 text-[#6C5CE7]" />
                        Micro-détails & Variantes
                      </p>
                      <span className="text-[10px] font-mono text-slate-500 font-bold">
                        Prix Base : {formatPrice(selectedOrderProduct.price)}
                      </span>
                    </div>

                    {/* Variant Level 1 (Couleur / Modèle / Option) */}
                    {normalizedVariants.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase text-[#6C5CE7]">
                            {normalizedVariants[0]?.name || 'Variante / Couleur'} *
                          </label>
                          <Select value={selectedColor} onValueChange={setSelectedColor}>
                            <SelectTrigger className="bg-white border-slate-200 text-slate-900 text-xs font-bold h-10 rounded-xl focus:bg-white px-3">
                              <SelectValue placeholder="Choisir Variante" />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-slate-200 text-slate-900 rounded-xl z-[100]">
                              {normalizedVariants.map((v, i) => {
                                const stockDisp = Number(v.stock || 0) - Number(v.reserved || 0);
                                return (
                                  <SelectItem key={i} value={v.value} className="text-xs font-bold py-2">
                                    <div className="flex items-center justify-between gap-3 w-full">
                                      <span>{v.value}</span>
                                      <span className={cn("text-[9px] font-mono", stockDisp > 0 ? "text-emerald-600" : "text-rose-500")}>
                                        ({stockDisp > 0 ? `${stockDisp} en stock` : 'Rupture'})
                                        {v.priceModifier ? ` · ${v.priceModifier > 0 ? '+' : ''}${v.priceModifier} DA` : ''}
                                      </span>
                                    </div>
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Variant Level 2 (Taille / Format / Dimension) */}
                        {availableSubVariants.length > 0 && (
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-[#6C5CE7]">
                              {availableSubVariants[0]?.name || 'Taille / Option'} *
                            </label>
                            <Select value={selectedSize} onValueChange={setSelectedSize} disabled={!selectedColor}>
                              <SelectTrigger className="bg-white border-slate-200 text-slate-900 text-xs font-bold h-10 rounded-xl focus:bg-white px-3 disabled:opacity-50">
                                <SelectValue placeholder="Choisir Taille" />
                              </SelectTrigger>
                              <SelectContent className="bg-white border-slate-200 text-slate-900 rounded-xl z-[100]">
                                {availableSubVariants.map((sv, i) => {
                                  const subStock = Number(sv.stock || 0) - Number(sv.reserved || 0);
                                  return (
                                    <SelectItem key={i} value={sv.value} className="text-xs font-bold py-2">
                                      <div className="flex items-center justify-between gap-3 w-full">
                                        <span>{sv.value}</span>
                                        <span className={cn("text-[9px] font-mono", subStock > 0 ? "text-emerald-600" : "text-rose-500")}>
                                          ({subStock > 0 ? `${subStock} en stock` : 'Rupture'})
                                          {sv.priceModifier ? ` · ${sv.priceModifier > 0 ? '+' : ''}${sv.priceModifier} DA` : ''}
                                        </span>
                                      </div>
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Live Micro-Details Summary (SKU, Stock, Prix unitaire modifiable, Quantité) */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                      <div className="p-2.5 bg-white rounded-xl border border-slate-200/80">
                        <p className="text-[9px] font-bold uppercase text-slate-400">SKU</p>
                        <p className="text-xs font-black text-slate-800 font-mono truncate mt-0.5">{selectedSku}</p>
                      </div>

                      <div className="p-2.5 bg-white rounded-xl border border-slate-200/80">
                        <p className="text-[9px] font-bold uppercase text-slate-400">Stock Réel</p>
                        <p className={cn(
                          "text-xs font-black font-mono mt-0.5",
                          variantStockAvailable === null ? "text-slate-400" : variantStockAvailable > 5 ? "text-emerald-600" : variantStockAvailable > 0 ? "text-amber-600" : "text-rose-600"
                        )}>
                          {variantStockAvailable === null ? 'Choisir...' : `${variantStockAvailable} disp.`}
                        </p>
                      </div>

                      <div className="p-2.5 bg-white rounded-xl border border-slate-200/80">
                        <p className="text-[9px] font-bold uppercase text-slate-400">Prix Unitaire (DA)</p>
                        <Input
                          type="number"
                          step="1"
                          value={orderPrice}
                          onChange={(e) => setOrderPrice(Math.round(parseFloat(e.target.value) || 0))}
                          className="h-7 text-xs font-black font-mono text-slate-900 border-slate-200 p-1 mt-0.5"
                        />
                      </div>

                      <div className="p-2.5 bg-white rounded-xl border border-slate-200/80">
                        <p className="text-[9px] font-bold uppercase text-slate-400">Quantité</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <button
                            type="button"
                            onClick={() => setOrderQty(Math.max(1, orderQty - 1))}
                            className="size-7 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-bold"
                          >
                            <Minus className="size-3" />
                          </button>
                          <Input
                            type="number"
                            min={1}
                            value={orderQty}
                            onChange={(e) => setOrderQty(Math.max(1, parseInt(e.target.value) || 1))}
                            className="h-7 text-xs font-black font-mono text-center border-slate-200 p-0 flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => setOrderQty(orderQty + 1)}
                            className="size-7 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-bold"
                          >
                            <Plus className="size-3" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Add to Multi-line Cart Button */}
                    <button
                      type="button"
                      onClick={() => addCurrentLine()}
                      className="w-full h-11 rounded-xl bg-[#6C5CE7] hover:bg-[#5b4bd4] text-white text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                    >
                      <ShoppingCart className="size-4" />
                      Ajouter au Panier ({formatPrice(orderPrice * orderQty)})
                    </button>
                  </div>
                )}

                {/* ── Multi-line Cart & Direct Price/Qty Modification ── */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-black uppercase text-slate-700 flex items-center gap-1.5">
                      <ShoppingCart className="size-3.5 text-slate-500" />
                      Panier de la Commande ({orderLines.length} article{orderLines.length > 1 ? 's' : ''})
                    </p>
                    {orderLines.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setOrderLines([])}
                        className="text-[10px] font-bold text-rose-500 hover:text-rose-700 underline"
                      >
                        Vider le panier
                      </button>
                    )}
                  </div>

                  {orderLines.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400 italic bg-slate-50 border border-slate-200/60 rounded-2xl">
                      Aucun article dans le panier pour l'instant. Choisissez un produit ci-dessus pour l'ajouter.
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-2xl divide-y divide-slate-100 bg-white overflow-hidden shadow-xs">
                      {orderLines.map((line, idx) => (
                        <div key={idx} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60 transition-colors">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-xs font-bold text-slate-900 truncate">{line.product_name}</p>
                              {line.is_upsell && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 border border-purple-200 font-black">
                                  UPSELL ⚡
                                </span>
                              )}
                              {(line.color || line.size) && (
                                <span className="text-[10px] font-black text-[#6C5CE7] bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                                  {[line.color, line.size].filter(Boolean).join(' / ')}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 font-mono">
                              SKU: {line.sku || '—'}
                            </p>
                          </div>

                          {/* Interactive Price & Qty Steppers */}
                          <div className="flex items-center gap-3 shrink-0">
                            {/* Editable Unit Price */}
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] font-bold text-slate-400">P.U:</span>
                              <Input
                                type="number"
                                step="1"
                                value={line.unit_price}
                                onChange={(e) => setLineDirectPrice(idx, parseFloat(e.target.value) || 0)}
                                className="h-8 w-20 text-xs font-black font-mono text-slate-800 border-slate-200 p-1 text-right"
                              />
                              <span className="text-[10px] text-slate-400 font-bold">DA</span>
                            </div>

                            {/* Editable Quantity */}
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => updateLineQty(idx, -1)}
                                className="size-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-bold"
                              >
                                <Minus className="size-3" />
                              </button>
                              <Input
                                type="number"
                                min={1}
                                value={line.quantity}
                                onChange={(e) => setLineDirectQty(idx, parseInt(e.target.value) || 1)}
                                className="h-8 w-12 text-xs font-black font-mono text-center border-slate-200 p-0"
                              />
                              <button
                                type="button"
                                onClick={() => updateLineQty(idx, 1)}
                                className="size-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center text-xs font-bold"
                              >
                                <Plus className="size-3" />
                              </button>
                            </div>

                            {/* Line Total */}
                            <div className="text-right min-w-[75px]">
                              <p className="text-xs font-black text-slate-900 font-mono">
                                {formatPrice(line.quantity * line.unit_price)}
                              </p>
                            </div>

                            {/* Remove */}
                            <button
                              type="button"
                              onClick={() => removeLine(idx)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                              title="Retirer cet article"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Récapitulatif Frais & Remise ── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Frais de Livraison (DA)</label>
                    <Input readOnly name="delivery_fee" type="number" step="1" value={deliveryFee} className="bg-slate-50 border-slate-200 text-sm font-black h-11 rounded-xl px-4 text-slate-700 font-mono opacity-80 cursor-not-allowed" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Remise / Réduction Spéciale (DA)</label>
                    <Input 
                      name="discount" 
                      type="number" 
                      step="1" 
                      value={orderDiscount} 
                      onChange={e => setOrderDiscount(Math.round(parseFloat(e.target.value) || 0))} 
                      className="bg-slate-50 border-slate-200 text-sm font-black h-11 rounded-xl focus:bg-white transition-all px-4 text-slate-900 font-mono" 
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sticky Footer */}
          <div className="shrink-0 sticky bottom-0 bg-white border-t border-slate-200 p-4 sm:p-6 lg:px-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 z-30 shadow-[0_-10px_25px_-5px_rgba(0,0,0,0.08)]">
            <div className="space-y-1 text-slate-800">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Net à Encaisser</p>
              <div className="text-3xl font-black text-slate-900 font-mono tabular-nums">
                {formatPrice(Math.max(0, grandSubtotal + deliveryFee - orderDiscount))}
              </div>
              <p className="text-[10px] text-slate-500 font-bold">
                {orderLines.length > 0
                  ? <>{orderLines.reduce((a, l) => a + l.quantity, 0)} article(s) · </>
                  : orderQty > 1 && <>{orderQty} × {formatPrice(orderPrice)} · </>}
                Sous-total {formatPrice(grandSubtotal)} + {formatPrice(deliveryFee)} (livraison) - {formatPrice(orderDiscount)} (remise)
              </p>
            </div>
            <Button 
              type="submit" 
              disabled={createOrderMutation.isPending} 
              className="h-13 px-8 sm:px-10 w-full sm:w-auto text-xs font-black uppercase tracking-widest text-white shadow-lg group rounded-xl border-none cursor-pointer" 
              style={{ backgroundColor: primaryColor }}
            >
              {createOrderMutation.isPending ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <>
                  <span>Enregistrer la Commande</span>
                  <ArrowRightLeft className="ml-2.5 size-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
