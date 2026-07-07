'use client';

import { Minus, Plus, Trash2, Package, ArrowRight, ShieldCheck, Tag, Truck, X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useAppStore } from '@/store/app-store';
import { useCartStore } from '@/store/cart-store';
import { formatPrice } from '@/lib/format';
import { useTranslation } from '@/hooks/use-translation';

/* ─── shared cart item renderer ─── */
function CartItem({
  item, updateQuantity, removeItem,
  variant = 'clean',
}: {
  item: any; updateQuantity: any; removeItem: any; variant?: 'clean' | 'athletic' | 'luxe';
}) {
  const modifier = item.selectedVariant && item.product.variants
    ? (item.product.variants.find((v: any) => v.value === item.selectedVariant)?.priceModifier ?? 0)
    : 0;
  const unitPrice = item.product.price + modifier;
  const lineTotal = unitPrice * item.quantity;
  const parsedImages = (() => {
    try { return typeof item.product.images === 'string' ? JSON.parse(item.product.images) : (item.product.images ?? []); }
    catch { return []; }
  })();
  const key = `${item.product.id}-${item.selectedVariant || ''}-${item.customNotes || ''}`;

  if (variant === 'athletic') return (
    <div key={key} className="flex gap-3 py-4 border-b border-white/5">
      <div className="h-20 w-16 shrink-0 overflow-hidden bg-white/5">
        {parsedImages[0]
          ? <img src={parsedImages[0]} alt={item.product.name} className="h-full w-full object-cover"/>
          : <div className="h-full w-full flex items-center justify-center"><Package className="size-5 text-white/20"/></div>}
      </div>
      <div className="flex flex-1 flex-col justify-between min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-white leading-tight line-clamp-2">{item.product.name}</p>
            {item.selectedVariant && <span className="mt-1 mr-1 inline-block text-[9px] px-2 py-0.5 bg-white/5 text-white/40 font-bold uppercase tracking-widest">{item.selectedVariant}</span>}
            {item.customNotes && <span className="mt-1 inline-block text-[9px] px-2 py-0.5 bg-white/10 text-white/60 font-bold tracking-widest">"{item.customNotes}"</span>}
          </div>
          <button onClick={() => removeItem(item.product.id, item.selectedVariant, item.customNotes)} className="shrink-0 text-white/20 hover:text-red-400 transition-colors p-0.5"><Trash2 className="size-3.5"/></button>
        </div>
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center border border-white/10">
            <button onClick={() => updateQuantity(item.product.id, item.quantity - 1, item.selectedVariant, item.customNotes)} className="size-7 flex items-center justify-center text-white/30 hover:bg-white/5 transition-colors"><Minus className="size-3"/></button>
            <span className="w-7 text-center text-xs font-black text-white tabular-nums">{item.quantity}</span>
            <button onClick={() => updateQuantity(item.product.id, item.quantity + 1, item.selectedVariant, item.customNotes)} className="size-7 flex items-center justify-center text-white/30 hover:bg-white/5 transition-colors"><Plus className="size-3"/></button>
          </div>
          <span className="text-xs font-black tabular-nums text-white">{formatPrice(lineTotal)}</span>
        </div>
      </div>
    </div>
  );

  if (variant === 'luxe') return (
    <div key={key} className="flex gap-4 py-5 border-b border-white/5">
      <div className="h-24 w-18 shrink-0 overflow-hidden border border-white/5" style={{ width: '4.5rem' }}>
        {parsedImages[0]
          ? <img src={parsedImages[0]} alt={item.product.name} className="h-full w-full object-cover"/>
          : <div className="h-full w-full flex items-center justify-center bg-white/5"><Package className="size-5 text-white/15"/></div>}
      </div>
      <div className="flex flex-1 flex-col justify-between min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-light tracking-wide text-white leading-snug line-clamp-2">{item.product.name}</p>
            {item.selectedVariant && <span className="mt-1 mr-2 inline-block text-[9px] tracking-[0.2em] uppercase text-white/25">{item.selectedVariant}</span>}
            {item.customNotes && <span className="mt-1 inline-block text-[9px] tracking-[0.1em] text-white/40 italic">"{item.customNotes}"</span>}
          </div>
          <button onClick={() => removeItem(item.product.id, item.selectedVariant, item.customNotes)} className="shrink-0 text-white/15 hover:text-red-400/60 transition-colors p-0.5"><X className="size-3"/></button>
        </div>
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center border border-white/10">
            <button onClick={() => updateQuantity(item.product.id, item.quantity - 1, item.selectedVariant, item.customNotes)} className="size-7 flex items-center justify-center text-white/20 hover:text-white/60 transition-colors"><Minus className="size-2.5"/></button>
            <span className="w-8 text-center text-xs font-light text-white/50 tabular-nums">{item.quantity}</span>
            <button onClick={() => updateQuantity(item.product.id, item.quantity + 1, item.selectedVariant, item.customNotes)} className="size-7 flex items-center justify-center text-white/20 hover:text-white/60 transition-colors"><Plus className="size-2.5"/></button>
          </div>
          <span className="text-sm font-light text-white/70 tabular-nums">{formatPrice(lineTotal)}</span>
        </div>
      </div>
    </div>
  );

  // clean (default)
  return (
    <div key={key} className="flex gap-4 py-4">
      <div className="h-20 w-16 shrink-0 rounded-xl overflow-hidden bg-slate-50 border border-slate-100">
        {parsedImages[0]
          ? <img src={parsedImages[0]} alt={item.product.name} className="h-full w-full object-cover"/>
          : <div className="h-full w-full flex items-center justify-center"><Package className="size-5 text-slate-300"/></div>}
      </div>
      <div className="flex flex-1 flex-col justify-between min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-slate-900 leading-tight line-clamp-2">{item.product.name}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {item.selectedVariant && <span className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">{item.selectedVariant}</span>}
              {item.customNotes && <span className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium line-clamp-1 max-w-[120px]">"{item.customNotes}"</span>}
            </div>
          </div>
          <button onClick={() => removeItem(item.product.id, item.selectedVariant, item.customNotes)} className="shrink-0 text-slate-300 hover:text-red-400 transition-colors p-0.5"><Trash2 className="size-3.5"/></button>
        </div>
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden">
            <button onClick={() => updateQuantity(item.product.id, item.quantity - 1, item.selectedVariant, item.customNotes)} className="size-7 flex items-center justify-center text-slate-400 hover:bg-slate-50 transition-colors"><Minus className="size-3"/></button>
            <span className="w-7 text-center text-xs font-bold text-slate-800 tabular-nums">{item.quantity}</span>
            <button onClick={() => updateQuantity(item.product.id, item.quantity + 1, item.selectedVariant, item.customNotes)} className="size-7 flex items-center justify-center text-slate-400 hover:bg-slate-50 transition-colors"><Plus className="size-3"/></button>
          </div>
          <span className="text-sm font-black text-slate-900 tabular-nums">{formatPrice(lineTotal)}</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── CLEAN ─────────────────────────────── */
function CleanCart() {
  const setStorefrontView = useAppStore((s) => s.setStorefrontView);
  const activeStore = useAppStore((s) => s.activeStore);
  const items = useCartStore((s) => s.items);
  const isOpen = useCartStore((s) => s.isOpen);
  const closeCart = useCartStore((s) => s.closeCart);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const totalItems = useCartStore((s) => s.totalItems);
  const totalPrice = useCartStore((s) => s.totalPrice);
  const primary = (activeStore?.theme_config?.primaryColor as string) || '#4b7bec';
  const itemCount = totalItems();
  const cartTotal = totalPrice();
  const { t } = useTranslation();

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && closeCart()}>
      <SheetContent side="right" className="flex w-full flex-col p-0 border-l border-slate-100 bg-white sm:max-w-[420px]">
        <SheetHeader className="px-5 py-4 border-b border-slate-100 shrink-0">
          <SheetTitle className="flex items-center justify-between">
            <span className="text-base font-black uppercase tracking-tight text-slate-900">{t('cart')}</span>
            {itemCount > 0 && <span className="flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[10px] font-black text-white" style={{ backgroundColor: primary }}>{itemCount}</span>}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 py-20 text-center gap-4">
              <div className="size-16 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center"><Package className="size-7 text-slate-300"/></div>
              <div><p className="text-sm font-bold text-slate-700">{t('emptyCart')}</p><p className="text-xs text-slate-400 mt-1">{t('emptyCartDesc')}</p></div>
              <button onClick={() => { closeCart(); setStorefrontView('shop'); }} className="mt-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white transition-all hover:brightness-110" style={{ backgroundColor: primary }}>{t('allProducts')}</button>
            </div>
          ) : (
            <div className="divide-y divide-slate-50 px-4 py-2">
              {items.map((item) => <CartItem key={`${item.product.id}-${item.selectedVariant || ''}-${item.customNotes || ''}`} item={item} updateQuantity={updateQuantity} removeItem={removeItem} variant="clean"/>)}
            </div>
          )}
        </div>
        {items.length > 0 && (
          <div className="shrink-0 border-t border-slate-100 bg-slate-50/50 px-5 py-5 space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm"><span className="text-slate-500 font-medium">{t('subtotal')}</span><span className="font-bold text-slate-880 tabular-nums">{formatPrice(cartTotal)}</span></div>
              <div className="flex items-center justify-between text-xs text-slate-400"><span className="flex items-center gap-1.5"><Truck className="size-3.5 text-emerald-500"/>{t('carrierEstimated')}</span></div>
            </div>
            <div className="flex items-center gap-4 py-2 border-t border-slate-100">
              <span className="flex items-center gap-1.5 text-[10px] text-slate-400 font-medium"><ShieldCheck className="size-3.5 text-emerald-500"/>{t('securePayment')}</span>
              <span className="flex items-center gap-1.5 text-[10px] text-slate-400 font-medium"><Tag className="size-3.5 text-blue-400"/>{t('codText')}</span>
            </div>
            <button onClick={() => { closeCart(); setStorefrontView('checkout'); }} className="w-full h-12 rounded-xl flex items-center justify-center gap-2.5 text-[12px] font-black uppercase tracking-widest text-white transition-all hover:brightness-110 active:scale-[0.98] shadow-sm" style={{ backgroundColor: primary }}>
              {t('checkoutNow')}<ArrowRight className="size-4"/>
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ─────────────────────────────── ATHLETIC ─────────────────────────────── */
function AthleticCart() {
  const setStorefrontView = useAppStore((s) => s.setStorefrontView);
  const activeStore = useAppStore((s) => s.activeStore);
  const items = useCartStore((s) => s.items);
  const isOpen = useCartStore((s) => s.isOpen);
  const closeCart = useCartStore((s) => s.closeCart);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const totalItems = useCartStore((s) => s.totalItems);
  const totalPrice = useCartStore((s) => s.totalPrice);
  const primary = (activeStore?.theme_config?.primaryColor as string) || '#ef4444';
  const itemCount = totalItems();
  const cartTotal = totalPrice();
  const { t } = useTranslation();

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && closeCart()}>
      <SheetContent side="right" className="flex w-full flex-col p-0 border-l border-white/5 sm:max-w-[400px]" style={{ backgroundColor: '#111111' }}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/5 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs font-black uppercase tracking-[0.25em] text-white">{t('cart')}</span>
            {itemCount > 0 && <span className="h-5 min-w-5 flex items-center justify-center text-[9px] font-black text-black px-1.5" style={{ backgroundColor: primary }}>{itemCount}</span>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 py-20 text-center gap-6">
              <div className="size-16 bg-white/5 flex items-center justify-center"><Package className="size-7 text-white/20"/></div>
              <div><p className="text-xs font-black uppercase tracking-widest text-white/40">{t('emptyCart')}</p><p className="text-[10px] text-white/20 mt-1 font-medium">{t('emptyCartDesc')}</p></div>
              <button onClick={() => { closeCart(); setStorefrontView('shop'); }} className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-black transition-all hover:brightness-110" style={{ backgroundColor: primary }}>
                {t('allProducts')}
              </button>
            </div>
          ) : (
            <div className="px-4 py-2">
              {items.map((item) => <CartItem key={`${item.product.id}-${item.selectedVariant || ''}-${item.customNotes || ''}`} item={item} updateQuantity={updateQuantity} removeItem={removeItem} variant="athletic"/>)}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="shrink-0 border-t border-white/5 px-5 py-5 space-y-4 bg-[#0A0A0A]">
            <div className="flex justify-between items-baseline">
              <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">{t('total')}</span>
              <span className="text-lg font-black text-white tabular-nums">{formatPrice(cartTotal)}</span>
            </div>
            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-white/20">
              <Truck className="size-3" style={{ color: primary }}/> {t('carrierEstimated')}
            </div>
            <button onClick={() => { closeCart(); setStorefrontView('checkout'); }}
              className="w-full h-12 text-[10px] font-black uppercase tracking-[0.3em] text-black transition-all hover:brightness-110 active:scale-[0.98] flex items-center justify-center gap-2"
              style={{ backgroundColor: primary }}>
              {t('checkoutNow')} <ArrowRight className="size-3.5"/>
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ─────────────────────────────── LUXE ─────────────────────────────── */
function LuxeCart() {
  const setStorefrontView = useAppStore((s) => s.setStorefrontView);
  const activeStore = useAppStore((s) => s.activeStore);
  const items = useCartStore((s) => s.items);
  const isOpen = useCartStore((s) => s.isOpen);
  const closeCart = useCartStore((s) => s.closeCart);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const totalItems = useCartStore((s) => s.totalItems);
  const totalPrice = useCartStore((s) => s.totalPrice);
  const primary = (activeStore?.theme_config?.primaryColor as string) || '#b8964e';
  const itemCount = totalItems();
  const cartTotal = totalPrice();
  const { t } = useTranslation();

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && closeCart()}>
      <SheetContent side="right" className="flex w-full flex-col p-0 border-l border-white/5 sm:max-w-[420px]" style={{ backgroundColor: '#0C0F1A' }}>
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/5 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] tracking-[0.4em] uppercase text-white/20 mb-1">{t('wishlist')}</p>
              <p className="text-sm font-light tracking-wide text-white" style={{ fontFamily: '"Playfair Display", serif' }}>{t('cart')}{itemCount > 0 && <span className="ml-2 text-xs font-light" style={{ color: primary }}>({itemCount})</span>}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-8 py-20 text-center gap-8">
              <Package className="size-12 text-white/10"/>
              <div><p className="text-xs font-light tracking-[0.2em] uppercase text-white/30">{t('emptyCart')}</p><p className="text-[10px] text-white/15 mt-2 font-light tracking-wide">{t('emptyCartDesc')}</p></div>
              <button onClick={() => { closeCart(); setStorefrontView('shop'); }} className="px-8 py-3 text-[10px] tracking-[0.3em] uppercase font-light text-black transition-all hover:brightness-95" style={{ backgroundColor: primary }}>
                {t('allProducts')}
              </button>
            </div>
          ) : (
            <div className="px-6 py-2">
              {items.map((item) => <CartItem key={`${item.product.id}-${item.selectedVariant || ''}-${item.customNotes || ''}`} item={item} updateQuantity={updateQuantity} removeItem={removeItem} variant="luxe"/>)}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="shrink-0 border-t border-white/5 px-6 py-6 space-y-5" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <div className="flex justify-between items-baseline">
              <span className="text-[9px] tracking-[0.35em] uppercase text-white/20 font-light">{t('subtotal')}</span>
              <span className="text-base font-light text-white/70 tabular-nums">{formatPrice(cartTotal)}</span>
            </div>
            <div className="flex items-center gap-2 text-[9px] tracking-[0.2em] uppercase text-white/15 font-light">
              <Truck className="size-3" style={{ color: primary }}/> {t('carrierEstimated')}
            </div>
            <button onClick={() => { closeCart(); setStorefrontView('checkout'); }}
              className="w-full h-13 text-[10px] tracking-[0.35em] uppercase font-light text-black transition-all hover:brightness-95 active:scale-[0.99] flex items-center justify-center gap-2 h-12"
              style={{ backgroundColor: primary }}>
              {t('checkoutNow')}
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ─────────────────────────────── EXPORT ─────────────────────────────── */
export function CartDrawer() {
  const activeStore = useAppStore((s) => s.activeStore);
  const _rawTpl = (activeStore?.template_id ?? activeStore?.theme_config?.templateId ?? 'clean') as string;
  const tpl = _rawTpl === 'minimalist' ? 'clean' : _rawTpl === 'landing' ? 'athletic' : _rawTpl.toLowerCase();
  if (tpl === 'athletic') return <AthleticCart/>;
  if (tpl === 'luxe') return <LuxeCart/>;
  return <CleanCart/>;
}
