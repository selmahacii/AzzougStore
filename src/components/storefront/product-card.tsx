'use client';

import { useMemo } from 'react';
import { Heart, ShoppingCart, Eye, Zap } from 'lucide-react';
import { useCartStore } from '@/store/cart-store';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import type { Product } from '@/lib/types';
import { resolveTemplate } from '@/lib/template-resolver';
import { cn } from '@/lib/utils';

interface ProductCardProps {
  product: Product;
  onQuickView: (slug: string) => void;
  onAddToCart: (product: Product) => void;
}

function getDiscountPercent(price: number, compare: number): number {
  if (!compare || compare <= price) return 0;
  return Math.round(((compare - price) / compare) * 100);
}

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
  const img1 = allImages[0] || 'https://images.unsplash.com/photo-1585386959984-a4155224a1ad?q=80&w=800';
  const img2 = allImages[1] || null;

  const colors = useMemo(() => {
    if (!product.variants) return [];
    return product.variants
      .filter(v => v.name.toLowerCase().includes('couleur') && v.color)
      .map(v => v.color!)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 5);
  }, [product.variants]);

  return { parsedImages, discount, isOutOfStock, img1, img2, colors };
}

// ─────────────────────────────────────────────────────────────
// CLEAN — structured minimalist: crisp grid, editorial, premium
// ─────────────────────────────────────────────────────────────
function CleanCard({ product, primary, onQuickView, onAddToCart }: {
  product: Product; primary: string;
  onQuickView: (s: string) => void; onAddToCart: (p: Product) => void;
}) {
  const { discount, isOutOfStock, img1, img2, colors } = useCardData(product);
  const toggleWishlist = useCartStore(s => s.toggleWishlist);
  const isInWishlist = useCartStore(s => s.isInWishlist(product.id));

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="group relative flex flex-col bg-white cursor-pointer transition-all duration-300 pb-2 hover:shadow-[0_12px_30px_rgba(0,0,0,0.03)]"
      onClick={() => onQuickView(product.slug)}
    >
      {/* Image container — aspect-[4/5] with slight padding/whitespace */}
      <div className="relative aspect-[4/5] overflow-hidden bg-neutral-50 border border-neutral-100/50">
        <img
          src={img1} alt={product.name}
          className={`h-full w-full object-cover transition-all duration-1000 ease-out will-change-transform group-hover:scale-[1.03] ${img2 ? 'group-hover:opacity-0' : ''}`}
        />
        {img2 && (
          <img
            src={img2} alt={product.name}
            className="absolute inset-0 h-full w-full object-cover opacity-0 transition-all duration-1000 ease-out group-hover:opacity-100 group-hover:scale-[1.03]"
          />
        )}

        {/* Wishlist */}
        <button
          onClick={e => { e.stopPropagation(); toggleWishlist(product.id); toast.success(isInWishlist ? 'Retiré des favoris' : 'Ajouté aux favoris'); }}
          className="absolute top-3 right-3 z-20 size-8 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center shadow-sm border border-neutral-100/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        >
          <Heart className={`size-3.5 transition-colors ${isInWishlist ? 'fill-rose-500 text-rose-500' : 'text-neutral-400'}`} />
        </button>

        {/* Badge */}
        {discount > 0 ? (
          <span
            className="absolute top-3 left-3 z-20 px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.2em] text-white"
            style={{ backgroundColor: primary }}
          >
            -{discount}%
          </span>
        ) : product.featured ? (
          <span className="absolute top-3 left-3 z-20 px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.2em] bg-neutral-900 text-white">
            Best Seller
          </span>
        ) : null}

        {/* Glassmorphic Add to Cart Panel */}
        {!isOutOfStock ? (
          <div className="absolute inset-x-3 bottom-3 z-10 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300 ease-out">
            <button
              onClick={e => { e.stopPropagation(); onAddToCart(product); }}
              className="w-full py-3 backdrop-blur-md bg-white/85 border border-neutral-200/50 text-neutral-900 text-[9px] font-semibold uppercase tracking-[0.3em] flex items-center justify-center gap-1.5 hover:bg-neutral-900 hover:text-white transition-all duration-300"
            >
              <ShoppingCart className="size-3" />
              Ajouter
            </button>
          </div>
        ) : (
          <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-[1px] flex items-center justify-center">
            <span className="text-[9px] font-medium uppercase tracking-[0.25em] text-neutral-400 border border-neutral-200 bg-white/95 px-4 py-2">
              Épuisé
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="pt-4 pb-2 px-1">
        {product.category && (
          <p className="text-[8px] font-semibold uppercase tracking-[0.4em] text-neutral-400 mb-1.5">{product.category}</p>
        )}
        <h3 className="text-xs font-medium text-neutral-800 leading-relaxed line-clamp-2 group-hover:text-neutral-500 transition-colors">
          {product.name}
        </h3>
        {product.description && (
          <p className="mt-1 text-[11px] text-neutral-400 font-light leading-relaxed line-clamp-2">{product.description}</p>
        )}
        {colors.length > 0 && (
          <div className="mt-2.5 flex gap-1.5">
            {colors.map((c, i) => (
              <div key={i} className="size-2 rounded-full border border-neutral-100" style={{ backgroundColor: c }} />
            ))}
          </div>
        )}
        <div className="mt-2.5 flex items-baseline gap-2">
          <span className="text-xs font-semibold text-neutral-900">
            {formatPrice(product.price)}
          </span>
          {product.compare_price !== null && product.compare_price > product.price && (
            <span className="text-[10px] font-light text-neutral-300 line-through">
              {formatPrice(product.compare_price)}
            </span>
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
  const toggleWishlist = useCartStore(s => s.toggleWishlist);
  const isInWishlist = useCartStore(s => s.isInWishlist(product.id));

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="group relative flex flex-col cursor-pointer"
      style={{ backgroundColor: '#0C0F1A' }}
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

        {/* Wishlist */}
        <button
          onClick={e => { e.stopPropagation(); toggleWishlist(product.id); toast.success(isInWishlist ? 'Retiré' : 'Ajouté aux favoris'); }}
          className="absolute top-4 right-4 z-20 size-8 rounded-full border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300"
          style={{ borderColor: `${primary}30`, backgroundColor: 'rgba(12,15,26,0.7)' }}
        >
          <Heart className={`size-3.5 transition-colors ${isInWishlist ? 'fill-current' : ''}`} style={{ color: primary }} />
        </button>

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
              Ajouter — {formatPrice(product.price)}
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

  if (tpl === 'athletic' || tpl === 'landing') {
    return <AthleticCard product={product} primary={primary} onQuickView={onQuickView} onAddToCart={onAddToCart} />;
  }
  if (tpl === 'luxe') {
    return <LuxeCard product={product} primary={primary} onQuickView={onQuickView} onAddToCart={onAddToCart} />;
  }
  return <CleanCard product={product} primary={primary} onQuickView={onQuickView} onAddToCart={onAddToCart} />;
}
