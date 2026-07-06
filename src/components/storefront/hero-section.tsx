'use client';

import { useEffect, useState } from 'react';
import { Package, ArrowRight, ShoppingBag, ChevronDown, Zap } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { useCartStore } from '@/store/cart-store';
import type { Product, Store } from '@/lib/types';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

// ─── Template helpers ─────────────────────────────────────────
function getHeroTheme(store: Store) {
  const tpl = store.template_id || 'clean';
  const primary = store.theme_config?.primaryColor || '#4b7bec';
  const accent = store.theme_config?.accentColor || primary;
  return { tpl, primary, accent };
}

function heroText(store: Store, defaults: { headline: string; subtitle: string; cta: string; cta2: string }) {
  const tc = store.theme_config ?? {};
  return {
    headline: (tc.heroHeadline as string | undefined) || defaults.headline,
    subtitle: (tc.heroSubtitle as string | undefined) || store.description || defaults.subtitle,
    cta: (tc.heroCta as string | undefined) || defaults.cta,
    cta2: defaults.cta2,
    fontWeight:
      tc.heroFont === 'light' ? 'font-thin' :
      tc.heroFont === 'normal' ? 'font-bold' :
      tc.heroFont === 'serif' ? 'font-serif font-bold' :
      'font-black',
    isFullLayout: tc.heroLayout === 'full',
  };
}

// ─── ATHLETIC hero ────────────────────────────────────────────
function AthleticTextContent({ primary, fontWeight, headline, subtitle, cta, cta2, isFullLayout, productCount, onShop, onScroll }: {
  primary: string; fontWeight: string; headline: string; subtitle: string;
  cta: string; cta2: string; isFullLayout: boolean; productCount: string;
  onShop: () => void; onScroll: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: isFullLayout ? 0 : -40, y: isFullLayout ? 20 : 0 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-start text-left max-w-xl w-full"
    >
      <div className="flex items-center gap-4 mb-8">
        <div className="h-0.5 w-10" style={{ backgroundColor: primary }} />
        <span className="text-[11px] font-black uppercase tracking-[0.4em]" style={{ color: primary }}>
          <Zap className="inline size-3 mr-1" />Nouvelle Collection
        </span>
      </div>
      <h1 className={`text-5xl sm:text-7xl md:text-8xl ${fontWeight} uppercase tracking-tighter text-white leading-[0.88]`}>
        {headline}
      </h1>
      <p className="mt-8 text-[12px] font-medium uppercase tracking-widest text-white/40 max-w-md leading-relaxed">
        {subtitle}
      </p>
      <div className="mt-10 flex flex-col sm:flex-row items-start sm:items-center gap-5">
        <motion.button
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
          onClick={onShop}
          className="relative overflow-hidden px-10 py-4 text-[11px] font-black uppercase tracking-[0.3em] text-black group"
          style={{ backgroundColor: primary }}
        >
          <span className="relative z-10">{cta} →</span>
          <div className="absolute inset-0 bg-white/20 scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-500" />
        </motion.button>
        <button onClick={onScroll} className="text-[11px] font-black uppercase tracking-[0.3em] text-white/40 border-b border-white/10 pb-1 hover:text-white hover:border-white/40 transition-colors">
          {cta2}
        </button>
      </div>
      <div className="mt-14 flex gap-8 flex-wrap">
        {[
          { label: 'Produits', value: productCount },
          { label: 'Livraison', value: 'Express' },
          { label: 'Retour', value: '14 Jours' },
        ].map((s) => (
          <div key={s.label} className="flex flex-col gap-1 border-l-2 pl-4" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <span className="text-[10px] font-black uppercase tracking-widest text-white/30">{s.label}</span>
            <span className="text-[12px] font-black uppercase tracking-widest text-white">{s.value}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function AthleticHero({
  store, products, onShop, onScroll,
}: { store: Store; products: Product[]; loading: boolean; onShop: () => void; onScroll: () => void }) {
  const { primary } = getHeroTheme(store);
  const heroImg = products[0]?.main_image || products[0]?.images?.[0];
  const bannerImg = store.banner_url || heroImg;
  const isVideo = store.theme_config?.bannerIsVideo;
  const { headline, subtitle, cta, cta2, fontWeight, isFullLayout } = heroText(store, {
    headline: store.name,
    subtitle: 'Performance. Qualité. Style.',
    cta: 'Explorer la collection',
    cta2: 'Best Sellers',
  });
  const textProps = { primary, fontWeight, headline, subtitle, cta, cta2, isFullLayout, productCount: String(store._count?.products ?? '—'), onShop, onScroll };

  if (isFullLayout) {
    return (
      <div className="w-full bg-[#0A0A0A]">
        <section className="relative min-h-screen w-full overflow-hidden flex items-center justify-center">
          {bannerImg && !isVideo && (
            <motion.img initial={{ scale: 1.1, opacity: 0 }} animate={{ scale: 1, opacity: 0.4 }}
              transition={{ duration: 2 }} src={bannerImg} alt={store.name}
              className="absolute inset-0 h-full w-full object-cover" />
          )}
          {bannerImg && isVideo && (
            <video src={bannerImg} className="absolute inset-0 h-full w-full object-cover opacity-40" muted loop autoPlay playsInline />
          )}
          <div className="absolute inset-0 pointer-events-none opacity-[0.04]"
            style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
          <div className="relative z-10 flex items-center justify-start w-full px-8 sm:px-32 lg:px-48">
            <AthleticTextContent {...textProps} />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="w-full bg-[#0A0A0A]">
      <section className="relative min-h-screen w-full overflow-hidden flex lg:grid lg:grid-cols-2">
        <div className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
        <div className="absolute inset-0 block lg:hidden z-0">
          {bannerImg && (
            isVideo
              ? <video src={bannerImg} className="h-full w-full object-cover opacity-25" muted loop autoPlay playsInline />
              : <img src={bannerImg} alt={store.name} className="h-full w-full object-cover opacity-25 grayscale" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/70 to-transparent" />
        </div>
        <div className="relative flex items-center justify-center p-8 sm:p-16 lg:p-20 z-10 flex-1">
          <AthleticTextContent {...textProps} />
        </div>
        <div className="relative h-full w-full overflow-hidden hidden lg:block">
          {bannerImg ? (
            <motion.div initial={{ scale: 1.15, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 2 }} className="absolute inset-0">
              {isVideo
                ? <video src={bannerImg} className="h-full w-full object-cover" muted loop autoPlay playsInline />
                : <img src={bannerImg} alt={store.name} className="h-full w-full object-cover brightness-90 contrast-110" />
              }
              <div className="absolute inset-0 bg-gradient-to-r from-[#0A0A0A] via-[#0A0A0A]/20 to-transparent" />
            </motion.div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: `linear-gradient(135deg, #0A0A0A 40%, ${primary}18)` }}>
              <Package className="size-32 opacity-10" style={{ color: primary }} />
            </div>
          )}
          {products[0] && (
            <motion.div animate={{ y: [0, -16, 0] }} transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute bottom-16 right-12 bg-white/5 backdrop-blur-xl border p-5 shadow-2xl z-20"
              style={{ borderColor: `${primary}25` }}
            >
              <div className="flex items-center gap-4">
                <div className="size-12 flex items-center justify-center" style={{ backgroundColor: primary }}>
                  <Package className="size-6 text-white" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: primary }}>Nouveauté</p>
                  <p className="text-[12px] font-black uppercase tracking-tight text-white line-clamp-1">{products[0].name}</p>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── MINIMALIST / CLEAN hero ──────────────────────────────────
function CleanHero({
  store, products, onShop, onScroll,
}: { store: Store; products: Product[]; loading: boolean; onShop: () => void; onScroll: () => void }) {
  const { primary } = getHeroTheme(store);
  const heroImg = products[0]?.main_image ?? (products[0]?.images as string[] | undefined)?.[0];
  const bannerImg = store.banner_url ?? heroImg;
  const isVideo = store.theme_config?.bannerIsVideo as boolean | undefined;

  const tc = store.theme_config ?? {};
  const headline = (tc.heroHeadline as string | undefined) ?? store.name;
  const subtitle  = (tc.heroSubtitle  as string | undefined) ?? store.description ?? 'Découvrez notre sélection de produits soigneusement conçus pour vous.';
  const cta       = (tc.heroCta       as string | undefined) ?? 'Voir la collection';
  const isFullLayout = tc.heroLayout === 'full';

  if (isFullLayout) {
    return (
      <section className="relative w-full min-h-screen flex items-center justify-center overflow-hidden bg-gray-900">
        {/* Background Media */}
        {bannerImg && !isVideo && (
          <motion.img
            initial={{ scale: 1.1 }} animate={{ scale: 1 }}
            transition={{ duration: 2, ease: 'easeOut' }}
            src={bannerImg} alt={store.name}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {bannerImg && isVideo && (
          <video src={bannerImg} className="absolute inset-0 h-full w-full object-cover" muted loop autoPlay playsInline/>
        )}
        
        {/* Aesthetic Overlay */}
        <div className="absolute inset-0 z-10" style={{ backgroundColor: 'rgba(13, 27, 42, 0.4)' }} />
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/40 z-10 pointer-events-none" />

        <div className="relative z-20 w-full max-w-5xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 
              className="text-5xl sm:text-7xl lg:text-8xl font-semibold text-white tracking-tighter leading-[0.95] mb-8"
              style={{ fontFamily: '"Montserrat", sans-serif' }}
            >
              Redéfinissez votre façon de voyager.
            </h1>
            <p 
              className="text-xl sm:text-2xl text-white/90 italic mb-12 max-w-2xl mx-auto"
              style={{ fontFamily: '"Playfair Display", serif', fontWeight: 300 }}
            >
              Le confort d'un nuage, partout avec vous.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-6">
              <button
                onClick={onShop}
                className="px-12 py-5 text-[11px] font-black uppercase tracking-[0.4em] text-white shadow-2xl hover:brightness-110 transition-all active:scale-[0.98]"
                style={{ backgroundColor: primary }}
              >
                {cta}
              </button>
              <button
                onClick={onScroll}
                className="text-[11px] font-black uppercase tracking-[0.3em] text-white border-b border-white/30 pb-1 hover:border-white transition-colors"
              >
                Découvrir plus
              </button>
            </div>
          </motion.div>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full min-h-[85vh] grid lg:grid-cols-2 overflow-hidden bg-white">
      <div className="flex items-center order-2 lg:order-1 px-6 sm:px-12 lg:px-20 xl:px-32 py-16 lg:py-0">
        <motion.div
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-xl"
        >
          <h1 className="text-5xl sm:text-6xl xl:text-7xl font-black text-gray-900 tracking-tight leading-[1.05] mb-6">
            {headline}
          </h1>
          <p className="text-base sm:text-lg text-gray-500 leading-relaxed mb-10 max-w-md">
            {subtitle}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={onShop}
              className="px-10 py-5 text-[11px] font-black uppercase tracking-[0.3em] text-white hover:brightness-110 transition-all active:scale-[0.98] shadow-xl"
              style={{ backgroundColor: primary }}
            >
              {cta}
            </button>
            <button
              onClick={onScroll}
              className="px-10 py-5 text-[11px] font-black uppercase tracking-[0.3em] text-gray-900 border border-gray-200 hover:border-gray-900 transition-colors"
            >
              Voir Lookbook
            </button>
          </div>
        </motion.div>
      </div>

      <div className="relative flex items-center justify-center order-1 lg:order-2 px-6 sm:px-12 lg:pr-20 py-12 lg:py-0">
        <div className="relative w-full aspect-[4/3] lg:aspect-square max-w-2xl group">
          {bannerImg ? (
            <motion.div
              initial={{ scale: 1.05, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
              className="relative h-full w-full overflow-hidden rounded-2xl shadow-[0_32px_64px_-16px_rgba(0,0,0,0.15)] border border-gray-100"
            >
              {isVideo
                ? <video src={bannerImg} className="h-full w-full object-cover" muted loop autoPlay playsInline/>
                : <img src={bannerImg} alt={store.name} className="h-full w-full object-cover" />
              }
              <div className="absolute inset-0 bg-gradient-to-tr from-black/5 to-transparent pointer-events-none" />
            </motion.div>
          ) : (
            <div className="h-full w-full rounded-2xl bg-gray-50 flex items-center justify-center border border-dashed border-gray-200">
              <Package className="size-20 text-gray-200"/>
            </div>
          )}

          <motion.div
            initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.8, duration: 0.8 }}
            className="absolute -bottom-6 -left-6 bg-white/80 backdrop-blur-md border border-white/40 shadow-2xl p-6 rounded-2xl max-w-[240px] z-20"
          >
            <p className="text-[9px] font-black uppercase tracking-[0.4em] mb-2" style={{ color: primary }}>
              Nouveau Lancement
            </p>
            <h3 className="text-xl font-black text-gray-900 leading-tight">The Zenith Series</h3>
            <div className="mt-4 h-1 w-12 rounded-full" style={{ backgroundColor: primary }} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ─── LUXE hero ────────────────────────────────────────────────
function LuxeMediaBg({ bannerImg, isVideo, storeName }: {
  bannerImg: string | undefined; isVideo: boolean | undefined; storeName: string;
}) {
  if (!bannerImg) return null;
  return (
    <div className="absolute inset-0 z-0">
      {isVideo ? (
        <video src={bannerImg} className="h-full w-full object-cover grayscale" muted loop autoPlay playsInline />
      ) : (
        <motion.img initial={{ scale: 1.1 }} animate={{ scale: 1 }} transition={{ duration: 2 }} src={bannerImg} alt={storeName} className="h-full w-full object-cover grayscale brightness-75" />
      )}
      <div className="absolute inset-0 bg-black/20" />
    </div>
  );
}

function LuxeTextContent({ primary, fontClass, headline, subtitle, cta, cta2, onShop, onScroll }: {
  primary: string; fontClass: string; headline: string; subtitle: string;
  cta: string; cta2: string; onShop: () => void; onScroll: () => void;
}) {
  return (
    <div className="relative z-10 max-w-4xl">
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 1 }}>
        <div className="inline-flex items-center gap-4 md:gap-6 mb-8 md:mb-12">
          <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.6em]" style={{ color: primary }}>Collection Privée</span>
          <div className="h-px w-12 md:w-24" style={{ backgroundColor: `${primary}40` }} />
        </div>
        
        <h1 className={cn("text-5xl sm:text-8xl md:text-9xl uppercase tracking-tighter leading-[0.85] text-white", fontClass)}>
          {headline.split(' ').map((word, i) => (
            <span key={i} className="block last:opacity-50">{word}</span>
          ))}
        </h1>

        <div className="mt-12 md:mt-16 grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-12 items-end">
          <div className="space-y-6 md:space-y-8">
            <p className="text-[11px] md:text-sm font-medium text-white/40 leading-relaxed uppercase tracking-widest max-w-[240px] md:max-w-xs">
              {subtitle}
            </p>
            <div className="flex items-center gap-3 md:gap-4">
               <button 
                 onClick={onShop}
                 className="px-6 md:px-10 py-3.5 md:py-5 bg-white text-black text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] md:tracking-[0.4em] hover:bg-slate-200 transition-colors"
               >
                 {cta}
               </button>
               <button onClick={onScroll} className="p-3.5 md:p-5 border border-white/10 text-white hover:border-white/40 transition-colors">
                  <ChevronDown className="size-4" />
               </button>
            </div>
          </div>

          <div className="hidden md:flex flex-col gap-6 border-l border-white/10 pl-12">
             {[
               { label: 'Matériaux', val: 'Premium' },
               { label: 'Origine', val: 'France/Italie' },
               { label: 'Edition', val: 'Limitée' }
             ].map(i => (
               <div key={i.label}>
                 <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-white/20 mb-1">{i.label}</p>
                 <p className="text-xs font-bold text-white uppercase tracking-widest">{i.val}</p>
               </div>
             ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function LuxeHero({
  store, products, onShop, onScroll,
}: { store: Store; products: Product[]; loading: boolean; onShop: () => void; onScroll: () => void }) {
  const { primary } = getHeroTheme(store);
  const heroImg = products[0]?.main_image || products[0]?.images?.[0];
  const bannerImg = store.banner_url || heroImg;
  const isVideo = store.theme_config?.bannerIsVideo;
  const { headline, subtitle, cta, cta2 } = heroText(store, {
    headline: store.name,
    subtitle: "L'art de l'exception — chaque pièce raconte une histoire unique.",
    cta: 'Découvrir',
    cta2: 'Exclusivités',
  });

  const fontClass = store.theme_config?.heroFont === 'serif' ? 'font-serif' : 'font-black';
  const textProps = { primary, fontClass, headline, subtitle, cta, cta2, onShop, onScroll };

  return (
    <div className="w-full bg-[#0C0F1A]">
      <section className="relative min-h-screen w-full overflow-hidden flex items-center">
        <LuxeMediaBg bannerImg={bannerImg} isVideo={isVideo} storeName={store.name} />
        
        <div className="absolute inset-0 z-0 border-[16px] md:border-[40px] border-black/10 pointer-events-none" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/5 z-0 hidden lg:block" />
        
        <div className="relative z-10 w-full px-6 sm:px-24 lg:px-32">
          <LuxeTextContent {...textProps} />
        </div>

        <div className="absolute bottom-12 right-12 hidden lg:flex items-center gap-8 z-20">
           <div className="flex flex-col items-end gap-1">
              <span className="text-[9px] font-bold text-white/20 uppercase tracking-[0.5em]">Est.</span>
              <span className="text-sm font-bold text-white tracking-widest">{new Date().getFullYear()}</span>
           </div>
           <div className="h-12 w-px bg-white/20" />
           <div className="flex flex-col gap-1">
              <span className="text-[9px] font-bold text-white/20 uppercase tracking-[0.5em]">Location</span>
              <span className="text-sm font-bold text-white tracking-widest uppercase">{store.name.split(' ')[0]} HQ</span>
           </div>
        </div>
      </section>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────
export function HeroSection() {
  const activeStore = useAppStore((s) => s.activeStore);
  const setStorefrontView = useAppStore((s) => s.setStorefrontView);
  const setSelectedCategory = useAppStore((s) => s.setSelectedCategory);

  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeStore) { setLoading(false); return; }
    const controller = new AbortController();
    const fetchFeatured = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/v1/products?store_id=${activeStore.id}&is_featured=true&pageSize=4`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error('Fetch failed');
        const json = await res.json();
        if (json.success) setFeaturedProducts(json.data ?? []);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFeaturedProducts([]);
      } finally {
        setLoading(false);
      }
    };
    fetchFeatured();
    return () => controller.abort();
  }, [activeStore]);

  if (!activeStore) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-white">
        <div className="text-center">
          <Package className="mx-auto mb-4 size-12 text-gray-300" />
          <p className="text-lg text-gray-400">Aucune boutique sélectionnée</p>
        </div>
      </div>
    );
  }

  const onShop = () => {
    setSelectedCategory(null);
    setStorefrontView('shop');
  };
  const onScroll = () => {
    const el = document.getElementById('best-sellers');
    el?.scrollIntoView({ behavior: 'smooth' });
  };

  const _raw = activeStore.template_id || 'clean';
  const tpl = _raw === 'minimalist' ? 'clean' : _raw === 'landing' ? 'athletic' : _raw;
  const props = { store: activeStore, products: featuredProducts, loading, onShop, onScroll };

  if (tpl === 'athletic') return <AthleticHero {...props} />;
  if (tpl === 'luxe') return <LuxeHero {...props} />;
  return <CleanHero {...props} />;
}
