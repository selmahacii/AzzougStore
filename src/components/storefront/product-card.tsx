'use client';

import { useMemo } from 'react';
import { Heart, ShoppingCart, Eye, Zap, Truck } from 'lucide-react';
import { useCartStore } from '@/store/cart-store';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import type { Product } from '@/lib/types';
import { resolveTemplate } from '@/lib/template-resolver';
import { cn } from '@/lib/utils';
import { optimizeCloudinaryUrl } from '@/lib/image-optimize';

interface ProductCardProps {
  product: Product;
  onQuickView: (slug: string) => void;
  onAddToCart: (product: Product) => void;
}

function getDiscountPercent(price: number, compare: number): number {
  if (!compare || compare <= price) return 0;
  return Math.round(((compare - price) / compare) * 100);
}

const COLOR_MAP: Record<string, string> = {
  noir: '#111827',
  black: '#111827',
  gris: '#9CA3AF',
  grey: '#9CA3AF',
  gray: '#9CA3AF',
  blanc: '#FFFFFF',
  white: '#FFFFFF',
  bleu: '#1E3A8A',
  blue: '#1E3A8A',
  marine: '#0F172A',
  navy: '#0F172A',
  rouge: '#DC2626',
  red: '#DC2626',
  bordeaux: '#831843',
  burgundy: '#831843',
  marron: '#78350F',
  brown: '#78350F',
  beige: '#E7D8C9',
  creme: '#FDFBF7',
  rose: '#F472B6',
  pink: '#F472B6',
  vert: '#10B981',
  green: '#10B981',
  kaki: '#556B2F',
  jaune: '#FBBF24',
  yellow: '#FBBF24',
  orange: '#F97316',
  violet: '#8B5CF6',
  purple: '#8B5CF6',
};

function useCardData(product: Product) {
  const parsedImages = useMemo(() => {
    if (!product.images) return [];
    if (Array.isArray(product.images)) {
      if (typeof product.images[0] === 'string' && product.images[0].startsWith('["')) {
        try { return JSON.parse(product.images[0]); } catch { return product.images; }
      }
      return product.images;
    }
    if (typeof product.images === 'string') {
      try {
        const p = JSON.parse(product.images);
        return Array.isArray(p) ? p : [p];
      } catch {
        return (product.images as string).startsWith('http') ? [product.images] : [];
      }
    }
    return [];
  }, [product.images]);

  const allImages = useMemo(() => {
    let imgs = [...parsedImages];
    if (product.main_image) {
      imgs = [product.main_image, ...imgs.filter(img => img !== product.main_image)];
    }
    return imgs;
  }, [parsedImages, product.main_image]);

  const discount = product.compare_price ? getDiscountPercent(product.price, product.compare_price) : 0;
  const isOutOfStock = product.stock === 0;
  // Card thumbnails render at a few hundred px wide at most — capping at
  // 800 avoids shipping a full-resolution upload for a grid slot (same
  // Lighthouse-driven fix as landing-page-renderer.tsx, extended here).
  const img1 = optimizeCloudinaryUrl(allImages[0], 800) || 'https://images.unsplash.com/photo-1585386959984-a4155224a1ad?q=80&w=800';
  const img2 = allImages[1] ? optimizeCloudinaryUrl(allImages[1], 800) : null;

  const colors = useMemo(() => {
    if (!product.variants || !Array.isArray(product.variants)) return [];
    const colorList: string[] = [];
    
    product.variants.forEach((v: any) => {
      // 1. Direct color hex/name
      if (v.color && typeof v.color === 'string') {
        const c = v.color.startsWith('#') ? v.color : (COLOR_MAP[v.color.toLowerCase().trim()] || v.color);
        if (!colorList.includes(c)) colorList.push(c);
      }
      // 2. Name or value containing known color
      const name = (v.name || '').toLowerCase();
      const val = (v.value || '').toLowerCase();
      Object.keys(COLOR_MAP).forEach(k => {
        if (name.includes(k) || val.includes(k)) {
          const hex = COLOR_MAP[k];
          if (!colorList.includes(hex)) colorList.push(hex);
        }
      });
      // 3. Sub-variants
      if (v.sub_variants && Array.isArray(v.sub_variants)) {
        v.sub_variants.forEach((sv: any) => {
          const svName = (sv.name || '').toLowerCase();
          const svVal = (sv.value || '').toLowerCase();
          Object.keys(COLOR_MAP).forEach(k => {
            if (svName.includes(k) || svVal.includes(k)) {
              const hex = COLOR_MAP[k];
              if (!colorList.includes(hex)) colorList.push(hex);
            }
          });
        });
      }
    });
    return colorList.slice(0, 5);
  }, [product.variants]);

  return { parsedImages, discount, isOutOfStock, img1, img2, colors };
}

// ─────────────────────────────────────────────────────────────
// CLEAN — Meta Ads Template Minimalist Storefront Card
// ─────────────────────────────────────────────────────────────
function CleanCard({ product, primary, onQuickView, onAddToCart }: {
  product: Product; primary: string;
  onQuickView: (s: string) => void; onAddToCart: (p: Product) => void;
}) {
  const { discount, isOutOfStock, img1, img2, colors } = useCardData(product);

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="group relative flex flex-col bg-white border border-slate-200/90 hover:border-slate-400 hover:shadow-lg transition-all duration-300 cursor-pointer overflow-hidden rounded-none"
      style={{ 
        fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif'
      }}
      onClick={() => onQuickView(product.slug)}
    >
      {/* Image container - full width to card edges, no inner border */}
      <div 
        className="relative aspect-square w-full overflow-hidden bg-slate-50"
      >
        <img
          src={img1} 
          alt={product.name}
          className={cn(
            "h-full w-full object-cover transition-all duration-700 ease-out group-hover:scale-105",
            img2 ? "group-hover:opacity-0" : ""
          )}
        />
        {img2 && (
          <img
            src={img2} 
            alt={product.name}
            className="absolute inset-0 h-full w-full object-cover opacity-0 transition-all duration-700 ease-out group-hover:opacity-100 group-hover:scale-105"
          />
        )}

        {/* Badges - Square red badge for discount */}
        <div className="absolute top-2.5 left-2.5 sm:top-3 sm:left-3 z-20 flex flex-col gap-1">
          {discount > 0 ? (
            <span
              className="px-2 sm:px-2.5 py-0.5 sm:py-1 text-[11px] sm:text-xs font-black text-white rounded-none shadow-sm tracking-tight bg-red-600 border border-red-500/40"
            >
              -{discount}%
            </span>
          ) : product.featured ? (
            <span className="px-2 sm:px-2.5 py-0.5 sm:py-1 text-[9px] sm:text-[10px] font-black uppercase tracking-wider bg-slate-900 text-white rounded-none shadow-sm">
              Vedette
            </span>
          ) : null}
        </div>

        {/* Out of stock overlay */}
        {isOutOfStock && (
          <div className="absolute inset-0 z-10 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white bg-slate-900/95 border border-white/20 px-3 py-1 rounded-none shadow-lg">
              Épuisé
            </span>
          </div>
        )}
      </div>

      {/* Info Block */}
      <div className="p-3.5 sm:p-4.5 flex-1 flex flex-col justify-between space-y-2.5 sm:space-y-3">
        <div className="space-y-1">
          <h3 className="text-xs sm:text-base font-extrabold text-slate-900 leading-snug line-clamp-2 group-hover:text-[#4b7bec] transition-colors tracking-tight">
            {product.name}
          </h3>
          {colors.length > 0 && (
            <div className="flex items-center gap-1 sm:gap-1.5 pt-1">
              {colors.map((c, i) => (
                <div 
                  key={i} 
                  className="size-2.5 sm:size-3 rounded-none border border-slate-300 shadow-2xs transition-transform hover:scale-125 shrink-0" 
                  style={{ backgroundColor: c }} 
                  title={c}
                />
              ))}
            </div>
          )}
        </div>

        {/* Price & Action Row */}
        <div className="space-y-2.5 pt-2.5 border-t border-slate-100">
          <div className="flex items-baseline justify-between gap-1">
            <span className="text-sm sm:text-lg font-black text-slate-950 tracking-tight whitespace-nowrap">
              {formatPrice(product.price)}
            </span>
            {product.compare_price !== null && product.compare_price > product.price && (
              <span className="text-[11px] sm:text-sm font-semibold text-slate-400 line-through tracking-tight whitespace-nowrap">
                {formatPrice(product.compare_price)}
              </span>
            )}
          </div>

          {/* Delivery rate indicator visible in catalog */}
          <div className="flex items-center gap-1 text-[10px] sm:text-[11px] font-bold text-slate-500">
            <Truck className="size-3 text-slate-400 shrink-0" />
            {(product as any).delivery_fees?.is_free ? (
              <span className="text-emerald-600 font-extrabold uppercase tracking-tight">Livraison Gratuite</span>
            ) : (
              <span className="truncate">Livraison 58 Wilayas : <strong className="text-slate-800 font-black">dès 250 DA</strong></span>
            )}
          </div>

          {!isOutOfStock && (
            <button
              onClick={e => { 
                e.stopPropagation(); 
                onAddToCart(product); 
              }}
              className="w-full h-10 sm:h-11 px-2 text-[10px] sm:text-xs font-black uppercase tracking-wider text-white flex items-center justify-center gap-1.5 rounded-none transition-all shadow-2xs hover:opacity-95 active:scale-[0.98] bg-[#0F172A] hover:bg-[#1E293B] cursor-pointer whitespace-nowrap overflow-hidden"
              style={primary && primary !== '#4b7bec' ? { backgroundColor: primary } : undefined}
            >
              <Zap className="size-3.5 sm:size-4 shrink-0 fill-current" />
              <span className="truncate">Commander maintenant</span>
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// ATHLETIC — Gymshark/Nike style: black, sharp, bold, dense
// ─────────────────────────────────────────────────────────────
function AthleticCard({ product, primary, onQuickView, onAddToCart }: {
  product: Product; primary: string;
  onQuickView: (s: string) => void; onAddToCart: (p: Product) => void;
}) {
  const { discount, isOutOfStock, img1, img2, colors } = useCardData(product);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="group relative flex flex-col bg-[#0A0A0A] overflow-hidden cursor-pointer"
      style={{ fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif' }}
      onClick={() => onQuickView(product.slug)}
    >
      {/* Image */}
      <div className="relative aspect-[4/5] overflow-hidden bg-[#111]">
        <img src={img1} alt={product.name}
          className={`h-full w-full object-cover transition-all duration-700 ease-out group-hover:scale-110 ${img2 ? 'group-hover:opacity-0' : ''}`} />
        {img2 && (
          <img src={img2} alt={product.name}
            className="absolute inset-0 h-full w-full object-cover opacity-0 transition-all duration-700 ease-out group-hover:scale-110 group-hover:opacity-100" />
        )}

        {/* Bottom gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none" />

        {/* Discount — sharp corner badge */}
        {discount > 0 && (
          <div className="absolute top-0 right-0 z-20 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-black"
            style={{ backgroundColor: primary }}>
            −{discount}%
          </div>
        )}

        {/* CTA — slide up sharp bar */}
        {!isOutOfStock ? (
          <div className="absolute inset-x-0 bottom-0 z-10 translate-y-full group-hover:translate-y-0 transition-transform duration-400 ease-[0.16,1,0.3,1]">
            <button
              onClick={e => { e.stopPropagation(); onAddToCart(product); }}
              className="w-full py-4 text-black text-[10px] font-black uppercase tracking-[0.35em] flex items-center justify-center gap-2 transition-all hover:brightness-110"
              style={{ backgroundColor: primary }}
            >
              <Zap className="size-3.5" /> Buy Now
            </button>
          </div>
        ) : (
          <div className="absolute inset-0 z-10 bg-black/60 flex items-center justify-center">
            <span className="border border-white/30 text-white/60 text-[10px] font-black uppercase tracking-[0.3em] px-5 py-2">
              SOLD OUT
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-3 py-4 border-t border-white/5">
        <p className="text-[8px] font-black uppercase tracking-[0.4em] mb-1.5" style={{ color: `${primary}80` }}>
          {product.category || 'Series'}
        </p>
        <h3 className="text-[11px] font-black uppercase tracking-[0.1em] text-white leading-tight line-clamp-2">{product.name}</h3>
        {colors.length > 0 && (
          <div className="mt-2 flex gap-1">
            {colors.map((c, i) => (
              <div key={i} className="size-2 rounded-full border border-white/10" style={{ backgroundColor: c }} />
            ))}
          </div>
        )}
        <div className="mt-2.5 flex items-center gap-3">
          <span className="text-sm font-black" style={{ color: primary }}>{formatPrice(product.price)}</span>
          {product.compare_price !== null && product.compare_price > product.price && (
            <span className="text-xs font-bold text-white/20 line-through">{formatPrice(product.compare_price)}</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// LUXE — Maison de Couture: deep navy, gold, cinematic, rare
// ─────────────────────────────────────────────────────────────
function LuxeCard({ product, primary, onQuickView, onAddToCart }: {
  product: Product; primary: string;
  onQuickView: (s: string) => void; onAddToCart: (p: Product) => void;
}) {
  const { discount, isOutOfStock, img1, colors } = useCardData(product);

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="group relative flex flex-col cursor-pointer"
      style={{ backgroundColor: '#0C0F1A', fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif' }}
      onClick={() => onQuickView(product.slug)}
    >
      {/* Image — portrait tall */}
      <div className="relative aspect-[2/3] overflow-hidden" style={{ backgroundColor: '#12172A' }}>
        <img src={img1} alt={product.name}
          className="h-full w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.06]" />

        {/* Cinematic overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0C0F1A]/95 via-[#0C0F1A]/10 to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-700 pointer-events-none" />

        {/* Gold border reveal on hover */}
        <div className="absolute inset-0 border-2 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
          style={{ borderColor: `${primary}40` }} />

        {/* Discount — thin elegant */}
        {discount > 0 && (
          <div className="absolute top-4 left-4 z-20 px-3 py-1 border text-[9px] font-light tracking-[0.3em] uppercase"
            style={{ borderColor: `${primary}40`, color: primary }}>
            −{discount}%
          </div>
        )}

        {/* CTA hover reveal */}
        {!isOutOfStock ? (
          <div className="absolute inset-x-0 bottom-0 z-10 p-5 translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500">
            <button
              onClick={e => { e.stopPropagation(); onAddToCart(product); }}
              className="w-full py-3 border text-[10px] font-light tracking-[0.35em] uppercase transition-all duration-300"
              style={{ borderColor: `${primary}50`, color: primary, backgroundColor: 'rgba(12,15,26,0.8)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = primary; (e.currentTarget as HTMLButtonElement).style.color = '#0C0F1A'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(12,15,26,0.8)'; (e.currentTarget as HTMLButtonElement).style.color = primary; }}
            >
              Commander maintenant — {formatPrice(product.price)}
            </button>
          </div>
        ) : (
          <div className="absolute inset-0 z-10 bg-[#0C0F1A]/70 flex items-center justify-center">
            <span className="text-[10px] font-light tracking-[0.4em] uppercase border px-6 py-2"
              style={{ color: `${primary}50`, borderColor: `${primary}20` }}>
              Épuisé
            </span>
          </div>
        )}
      </div>

      {/* Info — minimal, elegant */}
      <div className="px-4 py-5 border-t" style={{ borderColor: `${primary}10` }}>
        <p className="text-[9px] tracking-[0.4em] uppercase mb-2" style={{ color: `${primary}50` }}>
          {product.category || 'Collection'}
        </p>
        <h3 className="text-sm font-light tracking-[0.08em] leading-snug line-clamp-2" style={{ color: 'rgba(255,255,255,0.85)' }}>
          {product.name}
        </h3>
        {colors.length > 0 && (
          <div className="mt-2 flex gap-1.5">
            {colors.map((c, i) => (
              <div key={i} className="size-2.5 rounded-full border border-white/5" style={{ backgroundColor: c }} />
            ))}
          </div>
        )}
        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-sm font-medium tracking-wider" style={{ color: primary }}>
            {formatPrice(product.price)}
          </span>
          {product.compare_price !== null && product.compare_price > product.price && (
            <span className="text-xs font-light line-through" style={{ color: 'rgba(255,255,255,0.2)' }}>
              {formatPrice(product.compare_price)}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN EXPORT — dispatches to the right template card
// ─────────────────────────────────────────────────────────────
export function ProductCard({ product, onQuickView, onAddToCart }: ProductCardProps) {
  const activeStore = useAppStore(s => s.activeStore);
  const tpl = resolveTemplate(activeStore?.template_id ?? (activeStore?.theme_config?.templateId as string));
  const primary = (activeStore?.theme_config?.primaryColor as string) || '#4b7bec';

  if (tpl === 'athletic') {
    return <AthleticCard product={product} primary={primary} onQuickView={onQuickView} onAddToCart={onAddToCart} />;
  }
  if (tpl === 'luxe') {
    return <LuxeCard product={product} primary={primary} onQuickView={onQuickView} onAddToCart={onAddToCart} />;
  }
  return <CleanCard product={product} primary={primary} onQuickView={onQuickView} onAddToCart={onAddToCart} />;
}
