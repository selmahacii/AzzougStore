'use client';

import { useEffect, useState, useRef } from 'react';
import {
  ShieldCheck, Truck, RotateCcw, Star, Phone,
  ShoppingCart, CheckCircle, ArrowRight, Package, Zap, ChevronDown,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { useCartStore } from '@/store/cart-store';
import { formatPrice } from '@/lib/format';
import { motion, useInView } from 'framer-motion';
import { apiFetch } from '@/lib/api-client';
import type { Product } from '@/lib/types';
import { useTranslation } from '@/hooks/use-translation';
import { FloatingLanguageSwitcher } from '@/components/storefront/floating-language-switcher';
import { optimizeCloudinaryUrl } from '@/lib/image-optimize';

// ─── Animated counter ─────────────────────────────────────────
function Counter({ target, suffix = '' }: { target: number; suffix?: string }) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const step = Math.ceil(target / 40);
    const id = setInterval(() => {
      start = Math.min(start + step, target);
      setValue(start);
      if (start >= target) clearInterval(id);
    }, 28);
    return () => clearInterval(id);
  }, [inView, target]);
  return <span ref={ref}>{value}{suffix}</span>;
}

// ─── Section fade-in wrapper ───────────────────────────────────
function FadeIn({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function LandingPage() {
  const activeStore = useAppStore((s) => s.activeStore);
  const setStorefrontView = useAppStore((s) => s.setStorefrontView);
  const setSelectedProductSlug = useAppStore((s) => s.setSelectedProductSlug);
  const addItem = useCartStore((s) => s.addItem);
  const openCart = useCartStore((s) => s.openCart);

  const [products, setProducts] = useState<Product[]>([]);
  const [hero, setHero] = useState<Product | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const { t, dir } = useTranslation();

  const tc = (activeStore?.theme_config ?? {}) as Record<string, unknown>;
  const primary = (tc.primaryColor as string) || '#e84393';
  const headline  = (tc.heroHeadline as string) || (activeStore?.name ?? 'Découvrez');
  const subtitle  = (tc.heroSubtitle as string) || (activeStore?.description ?? 'Le produit qui change tout.');
  const ctaLabel  = (tc.heroCta as string) || t('buyNow');
  const bannerUrl = optimizeCloudinaryUrl((activeStore?.banner_url as string) || '', 1600);
  const isVideo   = tc.bannerIsVideo as boolean | undefined;
  const phone     = (tc.contact as any)?.phone || '';

  const benefits = [
    { icon: Truck,       title: (tc.benefit1Title as string) || t('fastDelivery'), desc: (tc.benefit1Desc as string) || t('delivery48hDesc') },
    { icon: ShieldCheck, title: (tc.benefit2Title as string) || t('codFast'), desc: (tc.benefit2Desc as string) || t('securePaymentDesc') },
    { icon: RotateCcw,   title: (tc.benefit3Title as string) || t('return14d'), desc: (tc.benefit3Desc as string) || t('return14dDesc') },
  ];

  const testimonials = [
    { name: (tc.review1Name as string) || 'Yasmine B.', loc: 'Alger',       text: (tc.review1Text as string) || 'Reçu en 2 jours, emballage soigné, produit conforme.', stars: 5 },
    { name: (tc.review2Name as string) || 'Karim M.',   loc: 'Oran',        text: (tc.review2Text as string) || 'Exactement comme la photo. Je recommande vivement !', stars: 5 },
    { name: (tc.review3Name as string) || 'Samira L.',  loc: 'Constantine', text: (tc.review3Text as string) || 'Service client rapide, très satisfaite de mon achat.', stars: 5 },
  ];

  const steps = [
    { n: '01', title: t('chooseOption'), desc: t('notesPlaceholderVariants') },
    { n: '02', title: t('confirmTitle'), desc: t('deliveryInfoDesc') },
    { n: '03', title: t('received'),   desc: t('receivedDesc') },
  ];

  useEffect(() => {
    if (!activeStore) return;
    apiFetch<any>(`/api/v1/products/?store_id=${activeStore.id}&is_featured=true&pageSize=6&is_active=true`)
      .then(res => {
        const items: Product[] = res.data ?? [];
        if (items.length > 0) {
          setProducts(items);
          setHero(items[0] ?? null);
        } else {
          // Fallback to active products
          apiFetch<any>(`/api/v1/products/?store_id=${activeStore.id}&pageSize=6&is_active=true`)
            .then(resFallback => {
              const fallbackItems: Product[] = resFallback.data ?? [];
              setProducts(fallbackItems);
              setHero(fallbackItems[0] ?? null);
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [activeStore]);

  const handleAddToCart = (product: Product) => {
    addItem(product, 1);
    setAddedId(product.id);
    setTimeout(() => { setAddedId(null); openCart(); }, 800);
  };

  const handleOrderNow = (product: Product) => {
    addItem(product, 1);
    setStorefrontView('checkout');
  };

  const discount = hero && hero.compare_price && hero.compare_price > hero.price
    ? Math.round(((hero.compare_price - hero.price) / hero.compare_price) * 100)
    : 0;

  return (
    <div className="bg-[#080808] min-h-screen text-white" dir={dir}>
      <FloatingLanguageSwitcher primaryColor={primary} />

      {/* ── TOP BAR ─────────────────────────────────────────────── */}
      {phone && (
        <div className="w-full py-2.5 text-center text-[10px] font-black uppercase tracking-[0.4em] border-b border-white/5" style={{ backgroundColor: '#0F0F0F' }}>
          <Phone className="inline size-3 mr-2 opacity-50"/>
          {t('phoneOrder')}&nbsp;
          <a href={`tel:${phone}`} className="font-black" style={{ color: primary }}>{phone}</a>
        </div>
      )}

      {/* ── HERO ────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">

        {/* Background media */}
        {bannerUrl && !isVideo && (
          <img src={bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.18]"/>
        )}
        {bannerUrl && isVideo && (
          <video src={bannerUrl} className="absolute inset-0 w-full h-full object-cover opacity-[0.18]" muted loop autoPlay playsInline/>
        )}
        {!bannerUrl && hero?.main_image && (
          <img src={optimizeCloudinaryUrl(hero.main_image, 1600)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.12]"/>
        )}

        {/* Gradient vignette */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#080808]/80 via-transparent to-[#080808] pointer-events-none"/>
        {/* Subtle dot grid */}
        <div className="absolute inset-0 opacity-[0.025] pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.9) 1px, transparent 1px)', backgroundSize: '32px 32px' }}/>

        {/* Hero content */}
        <div className="relative z-10 max-w-3xl mx-auto px-6 text-center py-24">

          {/* Flash badge */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <span className="inline-flex items-center gap-2 px-4 py-2 text-[10px] font-black uppercase tracking-[0.4em] border mb-8"
              style={{ borderColor: `${primary}40`, color: primary, backgroundColor: `${primary}10` }}>
              <Zap className="size-3 fill-current"/> {t('limitedOffer')}
            </span>
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-4xl sm:text-6xl md:text-7xl font-black uppercase leading-[0.95] tracking-tight mb-6"
          >
            {headline}
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-sm sm:text-base text-white/50 leading-relaxed max-w-lg mx-auto mb-8"
          >
            {subtitle}
          </motion.p>

          {/* Price row */}
          {hero && (
            <div className="flex flex-col items-center justify-center mb-10">
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="flex items-baseline gap-4 mb-4"
              >
                <span className="text-4xl font-black tabular-nums" style={{ color: primary }}>{formatPrice(hero.price)}</span>
                {hero.compare_price !== null && hero.compare_price > hero.price && (
                  <>
                    <span className="text-xl text-white/25 line-through">{formatPrice(hero.compare_price)}</span>
                    <span className="text-[11px] font-black uppercase tracking-widest px-2 py-1 text-black" style={{ backgroundColor: primary }}>
                      -{discount}%
                    </span>
                  </>
                )}
              </motion.div>
              
              <motion.div
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 }}
                className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm"
              >
                <div className="size-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  Plus que {hero.stock - hero.reserved_stock} articles en stock !
                </span>
              </motion.div>
            </div>
          )}

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10"
          >
            {hero ? (
              <>
                <button
                  onClick={() => handleOrderNow(hero)}
                  className="w-full sm:w-auto px-10 py-5 text-[12px] font-black uppercase tracking-[0.3em] text-black transition-all hover:brightness-110 active:scale-[0.98] shadow-2xl"
                  style={{ backgroundColor: primary }}
                >
                  <ShoppingCart className="inline size-4 mr-2.5 -mt-0.5"/>{ctaLabel}
                </button>
                <button
                  onClick={() => handleAddToCart(hero)}
                  className="w-full sm:w-auto px-8 py-5 text-[11px] font-black uppercase tracking-widest text-white/60 border border-white/10 hover:border-white/30 hover:text-white transition-all"
                >
                  {addedId === hero.id ? <><CheckCircle className="inline size-4 mr-2 text-green-400"/>{t('added')} !</> : t('addToCart')}
                </button>
              </>
            ) : (
              <button
                onClick={() => setStorefrontView('shop')}
                className="px-10 py-5 text-[12px] font-black uppercase tracking-[0.3em] text-black"
                style={{ backgroundColor: primary }}
              >
                {ctaLabel}
              </button>
            )}
          </motion.div>

          {/* Trust micro-badges */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
            className="flex flex-wrap justify-center gap-5"
          >
            {[t('codText'), t('delivery48h'), t('return14d')].map(b => (
              <span key={b} className="text-[10px] font-black uppercase tracking-widest text-white/25">✓ {b}</span>
            ))}
          </motion.div>
        </div>

        {/* Scroll cue */}
        <motion.div
          animate={{ y: [0, 8, 0] }} transition={{ duration: 2, repeat: Infinity }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/20"
        >
          <ChevronDown className="size-5"/>
        </motion.div>
      </section>

      {/* ── BENEFITS ────────────────────────────────────────────── */}
      <section className="border-t border-white/5 py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <FadeIn className="text-center mb-14">
            <p className="text-[9px] font-black uppercase tracking-[0.5em]" style={{ color: primary }}>{t('whyUs')}</p>
          </FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {benefits.map((b, i) => (
              <FadeIn key={i} delay={i * 0.08}>
                <div className="border border-white/5 p-7 flex flex-col gap-4 hover:border-white/10 transition-colors h-full" style={{ backgroundColor: '#0F0F0F' }}>
                  <div className="size-11 flex items-center justify-center border border-white/5" style={{ backgroundColor: `${primary}15` }}>
                    <b.icon className="size-5" style={{ color: primary }}/>
                  </div>
                  <h3 className="text-[13px] font-black uppercase tracking-wide text-white">{b.title}</h3>
                  <p className="text-[12px] text-white/40 leading-relaxed">{b.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── STATS BAR ───────────────────────────────────────────── */}
      <section className="border-y border-white/5 py-12 px-6" style={{ backgroundColor: '#0D0D0D' }}>
        <div className="max-w-3xl mx-auto grid grid-cols-3 gap-6 text-center">
          {[
            { value: 500, suffix: '+', label: t('clientsSatisfied') },
            { value: 99,  suffix: '%', label: t('positiveReviews') },
            { value: 48,  suffix: 'h', label: t('deliveryTime') },
          ].map((s, i) => (
            <div key={i}>
              <p className="text-3xl sm:text-4xl font-black tabular-nums" style={{ color: primary }}>
                <Counter target={s.value} suffix={s.suffix}/>
              </p>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/25 mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURED PRODUCTS ───────────────────────────────────── */}
      {products.length > 0 && (
        <section className="py-20 px-6" style={{ backgroundColor: '#0D0D0D' }}>
          <div className="max-w-5xl mx-auto">
            <FadeIn className="flex items-end justify-between mb-12">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.5em] mb-2" style={{ color: primary }}>{t('exclusiveSelection')}</p>
                <h2 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight">{t('ourBestSellers')}</h2>
              </div>
              <button
                onClick={() => setStorefrontView('shop')}
                className="hidden sm:flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/25 hover:text-white transition-colors"
              >
                {t('seeAll')} <ArrowRight className="size-3.5"/>
              </button>
            </FadeIn>

            {/* Masonry-style product grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-white/5">
              {products.slice(0, 6).map((p, i) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0 }} whileInView={{ opacity: 1 }}
                  viewport={{ once: true }} transition={{ delay: i * 0.06 }}
                  className="group relative bg-[#080808] cursor-pointer overflow-hidden"
                  style={{ aspectRatio: i === 0 ? '1/1.2' : '1/1' }}
                  onClick={() => { setSelectedProductSlug(p.slug); setStorefrontView('product'); }}
                >
                  {p.main_image
                    ? <img src={optimizeCloudinaryUrl(p.main_image, 800)} alt={p.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"/>
                    : <div className="h-full w-full flex items-center justify-center bg-[#111]"><Package className="size-12 text-white/10"/></div>
                  }

                  {/* Discount ribbon */}
                  {p.compare_price !== null && p.compare_price > p.price && (
                    <div className="absolute top-0 right-0 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-black"
                      style={{ backgroundColor: primary }}>
                      -{Math.round(((p.compare_price - p.price) / p.compare_price) * 100)}%
                    </div>
                  )}

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-300 flex flex-col items-center justify-end p-4 gap-2 opacity-0 group-hover:opacity-100">
                    <p className="text-[11px] font-black uppercase tracking-wide text-white text-center line-clamp-2">{p.name}</p>
                    <p className="text-sm font-black" style={{ color: primary }}>{formatPrice(p.price)}</p>
                    <button
                      onClick={e => { e.stopPropagation(); handleAddToCart(p); }}
                      className="w-full py-2.5 text-[10px] font-black uppercase tracking-widest text-black mt-1"
                      style={{ backgroundColor: primary }}
                    >
                      {addedId === p.id ? `✓ ${t('added')}` : t('addToCart')}
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── HOW IT WORKS ────────────────────────────────────────── */}
      <section className="py-20 px-6 border-t border-white/5">
        <div className="max-w-4xl mx-auto">
          <FadeIn className="text-center mb-14">
            <p className="text-[9px] font-black uppercase tracking-[0.5em] mb-2" style={{ color: primary }}>{t('howItWorks')}</p>
            <h2 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight">{t('howItWorks')}</h2>
          </FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {steps.map((s, i) => (
              <FadeIn key={i} delay={i * 0.1} className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <span className="text-4xl font-black" style={{ color: `${primary}30` }}>{s.n}</span>
                  {i < steps.length - 1 && (
                    <div className="hidden sm:block flex-1 h-px border-t border-dashed border-white/10"/>
                  )}
                </div>
                <h3 className="text-base font-black text-white uppercase tracking-wide">{s.title}</h3>
                <p className="text-[12px] text-white/40 leading-relaxed">{s.desc}</p>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ────────────────────────────────────────── */}
      <section className="py-20 px-6 border-t border-white/5" style={{ backgroundColor: '#0D0D0D' }}>
        <div className="max-w-4xl mx-auto">
          <FadeIn className="text-center mb-14">
            <p className="text-[9px] font-black uppercase tracking-[0.5em] mb-2" style={{ color: primary }}>{t('testimonials')}</p>
            <h2 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight">{t('theyLovedIt')}</h2>
          </FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {testimonials.map((testi, i) => (
              <FadeIn key={i} delay={i * 0.09}>
                <div className="border border-white/5 p-6 space-y-4 h-full" style={{ backgroundColor: '#0A0A0A' }}>
                  <div className="flex gap-0.5">
                    {Array.from({ length: testi.stars }).map((_, j) => (
                      <Star key={j} className="size-3.5 fill-current" style={{ color: primary }}/>
                    ))}
                  </div>
                  <p className="text-sm text-white/50 leading-relaxed italic">"{testi.text}"</p>
                  <div className="flex items-center gap-3 pt-3 border-t border-white/5">
                    <div className="size-8 rounded-full flex items-center justify-center text-[11px] font-black text-black shrink-0"
                      style={{ backgroundColor: primary }}>
                      {testi.name[0]}
                    </div>
                    <div>
                      <p className="text-[11px] font-black text-white">{testi.name}</p>
                      <p className="text-[10px] text-white/25">{t('verifiedReview')} • {testi.loc}</p>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ───────────────────────────────────────────── */}
      <section className="py-24 px-6 border-t border-white/5">
        <div className="max-w-2xl mx-auto text-center">
          <FadeIn>
            <p className="text-[9px] font-black uppercase tracking-[0.5em] mb-4" style={{ color: primary }}>{t('limitedStock')}</p>
            <h2 className="text-3xl sm:text-5xl font-black text-white uppercase tracking-tight leading-[0.95] mb-6">
              {t('orderBeforeStock')}
            </h2>
            {hero && (
              <p className="text-lg font-black text-white/40 mb-10 tabular-nums">
                {formatPrice(hero.price)} · {t('deliveryIncluded')}
              </p>
            )}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              {hero ? (
                <button
                  onClick={() => handleOrderNow(hero)}
                  className="w-full sm:w-auto px-12 py-5 text-[12px] font-black uppercase tracking-[0.3em] text-black hover:brightness-110 active:scale-[0.98] transition-all shadow-2xl"
                  style={{ backgroundColor: primary }}
                >
                  <ShoppingCart className="inline size-5 mr-2.5"/>{ctaLabel}
                </button>
              ) : (
                <button
                  onClick={() => setStorefrontView('shop')}
                  className="px-12 py-5 text-[12px] font-black uppercase tracking-[0.3em] text-black"
                  style={{ backgroundColor: primary }}
                >
                  {t('seeAll')}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-6 mt-10">
              {[
                { icon: ShieldCheck, label: t('securePayment') },
                { icon: Truck,       label: t('delivery48h') },
                { icon: RotateCcw,  label: t('return14d') },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <Icon className="size-3.5" style={{ color: primary }}/>
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/25">{label}</span>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

    </div>
  );
}
