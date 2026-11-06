'use client';

import { useEffect, useState } from 'react';
import { Package, ArrowRight, ShoppingBag, ChevronDown, Zap } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/store/app-store';
import type { Product, Store } from '@/lib/types';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/use-translation';
import { apiFetch } from '@/lib/api-client';
import { optimizeCloudinaryUrl } from '@/lib/image-optimize';

// ─── Template helpers ─────────────────────────────────────────
function getHeroTheme(store: Store) {
  const tpl = store.template_id || 'clean';
  const primary = store.theme_config?.primaryColor || '#4b7bec';
  const accent = store.theme_config?.accentColor || primary;
  return { tpl, primary, accent };
}

function heroText(store: Store, defaults: { headline: string; subtitle: string; cta: string; cta2: string }) {
  const tc = store.theme_config ?? ({} as any);
  return {
    headline: (tc.heroHeadline as string | undefined) || defaults.headline,
    subtitle: (tc.heroSubtitle as string | undefined) || store.description || defaults.subtitle,
    cta: (tc.heroCta as string | undefined) || defaults.cta,
    // heroCta2 was previously never read here — the secondary button text
    // was hardcoded to a fixed translation string in every hero variant,
    // unlike the primary CTA which was already store-configurable.
    cta2: (tc.heroCta2 as string | undefined) || defaults.cta2,
    fontWeight:
      tc.heroFont === 'light' ? 'font-thin' :
      tc.heroFont === 'normal' ? 'font-bold' :
      tc.heroFont === 'serif' ? 'font-serif font-bold' :
      'font-black',
    isFullLayout: tc.heroLayout === 'full',
  };
}

// ─── ATHLETIC hero ────────────────────────────────────────────
function AthleticTextContent({ primary, fontWeight, headline, subtitle, cta, cta2, isFullLayout, productCount, heroTag, heroStats, onShop, onScroll }: {
  primary: string; fontWeight: string; headline: string; subtitle: string;
  cta: string; cta2: string; isFullLayout: boolean; productCount: string;
  heroTag: string; heroStats: Array<{label: string; value: string}>;
  onShop: () => void; onScroll: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: isFullLayout ? 0 : -60, y: isFullLayout ? 30 : 0 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-start text-left max-w-2xl w-full"
    >
      {/* Hero tag — shown only if configured in theme_config */}
      {(primary && (fontWeight || headline)) && (
        <div className="flex items-center gap-4 mb-6">
          <motion.div 
            animate={{ scaleX: [1, 1.5, 1] }}
            transition={{ duration: 3, repeat: Infinity }}
            className="h-1 w-12 rounded-full" 
            style={{ backgroundColor: primary }} 
          />
          {heroTag && (
            <span className="text-[10px] font-black uppercase tracking-[0.4em] flex items-center" style={{ color: primary }}>
              <Zap className="inline size-3 mr-1.5 animate-bounce" /> {heroTag}
            </span>
          )}
        </div>
      )}
      
      {(() => {
        const { locale } = useTranslation();
        return (
          <h1 
            className={cn(
              "text-5xl sm:text-7xl md:text-8xl uppercase tracking-tight text-white leading-[0.88] select-none",
              locale === 'ar' ? "font-black" : `${fontWeight} italic`
            )}
            style={locale === 'ar' ? { fontFamily: "'Cairo', 'Tajawal', 'Outfit', sans-serif" } : { fontFamily: '"Playfair Display", "Didot", serif' }}
          >
            {headline}
          </h1>
        );
      })()}
      
      <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.25em] text-white/50 max-w-md leading-relaxed">
        {subtitle}
      </p>
      
      <div className="mt-10 flex flex-col sm:flex-row items-stretch sm:items-center gap-5 w-full sm:w-auto">
        <motion.button
          whileHover={{ scale: 1.04, skewX: -6 }} 
          whileTap={{ scale: 0.98 }}
          onClick={onShop}
          className="relative overflow-hidden px-10 py-5 text-[11px] font-black uppercase tracking-[0.3em] text-black group rounded-lg"
          style={{ backgroundColor: primary }}
        >
          <span className="relative z-10 flex items-center justify-center gap-2">
            {cta} <ArrowRight className="size-4" />
          </span>
          <div className="absolute inset-0 bg-white/30 scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-300" />
        </motion.button>
        <button 
          onClick={onScroll} 
          className="text-[11px] py-4 px-6 font-black uppercase tracking-[0.3em] text-white/40 hover:text-white border border-white/10 hover:border-white/40 rounded-lg transition-colors flex items-center justify-center"
        >
          {cta2}
        </button>
      </div>
      
      {/* Dynamic stats from theme_config.heroStats or hidden */}
      {heroStats.length > 0 && (
        <div className="mt-16 flex gap-12 flex-wrap">
          {heroStats.map((s) => (
            <div key={s.label} className="flex flex-col gap-1 border-l-4 pl-4" style={{ borderColor: `${primary}30` }}>
              <span className="text-[9px] font-bold uppercase tracking-widest text-white/30">{s.label}</span>
              <span className="text-xs font-black uppercase tracking-widest text-white">{s.value}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function AthleticHero({
  store, products, onShop, onScroll,
}: { store: Store; products: Product[]; loading: boolean; onShop: () => void; onScroll: () => void }) {
  const { t, dir } = useTranslation();
  const { primary } = getHeroTheme(store);
  const heroImg = products[0]?.main_image || products[0]?.images?.[0];
  const bannerImg = optimizeCloudinaryUrl(store.banner_url || heroImg, 1600);
  const isVideo = store.theme_config?.bannerIsVideo;
  const { headline, subtitle, cta, cta2, fontWeight, isFullLayout } = heroText(store, {
    headline: store.name,
    subtitle: store.description || '',
    cta: t('exploreAll'),
    cta2: t('seeAll'),
  });
  // heroTag from theme_config only
  const heroTag = (store.theme_config?.heroTag as string | undefined) ?? '';
  // heroStats from theme_config only — no hardcoded defaults
  const rawStats = store.theme_config?.heroStats as Array<{label: string; value: string}> | undefined;
  const heroStats = rawStats ?? [];
  const productCount = String(store._count?.products ?? '—');
  const textProps = { primary, fontWeight, headline, subtitle, cta, cta2, isFullLayout, productCount, heroTag, heroStats, onShop, onScroll };

  if (isFullLayout) {
    return (
      <div className="w-full bg-[#050505] min-h-[75vh] flex items-center relative overflow-hidden">
        {/* Dynamic diagonal aesthetic slash backdrops */}
        <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-indigo-950/20 to-transparent skew-x-12 pointer-events-none" />
        <div className="absolute inset-0 z-0">
          {bannerImg && (
            isVideo ? (
              <video src={bannerImg} className="absolute inset-0 h-full w-full object-cover" muted loop autoPlay playsInline />
            ) : (
              <motion.img initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ duration: 1.5 }} src={bannerImg} alt={store.name}
                className="absolute inset-0 h-full w-full object-cover" />
            )
          )}
        </div>
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
        
        <div className="relative z-10 flex items-center justify-start w-full px-8 sm:px-24 lg:px-32">
          <AthleticTextContent {...textProps} />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-[#050505]">
      <section className="relative min-h-[75vh] w-full overflow-hidden flex lg:grid lg:grid-cols-12">
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
        
        {/* Mobile backdrop */}
        <div className="absolute inset-0 block lg:hidden z-0">
          {bannerImg && (
            isVideo
              ? <video src={bannerImg} className="h-full w-full object-cover" muted loop autoPlay playsInline />
              : <img src={bannerImg} alt={store.name} className="h-full w-full object-cover" />
          )}
        </div>

        <div className="relative lg:col-span-7 flex items-center justify-center p-8 sm:p-20 lg:p-24 z-10">
          <AthleticTextContent {...textProps} />
        </div>
        
        <div className="relative lg:col-span-5 h-full w-full overflow-hidden hidden lg:block">
          {bannerImg ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.5 }} className="absolute inset-0 h-full w-full">
              {isVideo
                ? <video src={bannerImg} className="h-full w-full object-cover" muted loop autoPlay playsInline />
                : <img src={bannerImg} alt={store.name} className="h-full w-full object-cover" />
              }
            </motion.div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#050505] to-[#121212]">
              <Package className="size-32 opacity-[0.03]" style={{ color: primary }} />
            </div>
          )}

          {/* Dynamic athletic neon accent banner float */}
          {products[0] && (
            <motion.div 
              animate={{ y: [0, -12, 0] }} 
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute bottom-16 right-16 bg-[#0A0A0A] border border-white/10 p-6 shadow-2xl z-20 rounded-2xl max-w-[280px]"
            >
              <div className="flex items-center gap-4">
                <div className="size-12 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: primary }}>
                  <Zap className="size-6 text-black" />
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: primary }}>Top Produit</p>
                  <p className="text-xs font-black uppercase tracking-tight text-white line-clamp-1 mt-0.5">{products[0].name}</p>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── MINIMALIST / CLEAN hero (Overhauled with Meta Ads Template) ────────────────
function CleanHero({
  store, products, heroTag, onShop, onScroll,
}: { store: Store; products: Product[]; loading: boolean; heroTag: string; onShop: () => void; onScroll: () => void }) {
  const { t, dir, locale } = useTranslation();
  const { primary } = getHeroTheme(store);
  const heroImg = products[0]?.main_image ?? (products[0]?.images as string[] | undefined)?.[0];
  const bannerImg = optimizeCloudinaryUrl(store.banner_url ?? heroImg, 1600);
  const isVideo = store.theme_config?.bannerIsVideo as boolean | undefined;

  const tc = store.theme_config ?? ({} as any);
  const resolvedTag = (tc.heroTag as string | undefined) || heroTag || 'Sélection Officielle 2026';
  const headline = (tc.heroHeadline as string | undefined) || store.name;
  const subtitle  = (tc.heroSubtitle  as string | undefined) || store.description || "Découvrez nos pièces intemporelles, alliant design contemporain et finitions artisanales d'exception.";
  const cta       = (tc.heroCta       as string | undefined) || "Explorer le catalogue";
  const cta2      = (tc.heroCta2      as string | undefined) || "Tout voir";
  const isFullLayout = tc.heroLayout === 'full';

  const fontStyle = {
    fontFamily: locale === 'ar'
      ? "'Cairo', 'Tajawal', 'Outfit', sans-serif"
      : store.theme_config?.fontFamily
        ? `"${store.theme_config.fontFamily}", sans-serif`
        : '"Plus Jakarta Sans", "Inter", sans-serif'
  };

  if (isFullLayout) {
    return (
      <section className="relative w-full min-h-[75vh] flex items-center justify-center overflow-hidden bg-slate-950 py-16 px-4">
        {bannerImg ? (
          <div className="absolute inset-0 z-0">
            {isVideo ? (
              <video 
                src={bannerImg} 
                className="h-full w-full object-cover opacity-85" 
                muted loop autoPlay playsInline
              />
            ) : (
              <motion.img
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1.2 }}
                src={bannerImg} alt={store.name}
                className="h-full w-full object-cover opacity-85"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-slate-950/40" />
          </div>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 z-0 opacity-95" />
        )}
        
        <div className="relative z-20 w-full max-w-5xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-3xl mx-auto space-y-6"
          >
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white shadow-sm mx-auto">
              <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest">
                {resolvedTag}
              </span>
            </div>

            <h1
              className={cn("text-4xl sm:text-6xl lg:text-7xl text-white tracking-tight leading-[1.08]", locale === 'ar' ? 'font-black' : 'font-black')}
              style={fontStyle}
            >
              {headline}
            </h1>

            <p className="text-sm sm:text-base text-white/80 font-medium max-w-xl mx-auto leading-relaxed">
              {subtitle}
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <button
                onClick={onShop}
                className="w-full sm:w-auto h-12 px-8 rounded-2xl text-xs font-black uppercase tracking-wider text-white transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 hover:opacity-95 active:scale-[0.98]"
                style={{ backgroundColor: primary }}
              >
                {cta} <ArrowRight className="size-4" />
              </button>
              <button
                onClick={onScroll}
                className="w-full sm:w-auto h-12 px-7 rounded-2xl text-xs font-bold uppercase tracking-wider text-white/90 bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-md transition-all duration-200 flex items-center justify-center gap-2"
              >
                {cta2} <ChevronDown className="size-4" />
              </button>
            </div>
          </motion.div>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full bg-[#F8F9FC] py-10 sm:py-16 overflow-hidden relative border-b border-slate-100">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-8 lg:px-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          
          {/* Left Text content */}
          <div className="lg:col-span-6 flex flex-col justify-center order-2 lg:order-1">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="max-w-xl w-full space-y-6"
            >
              {/* Badge Tag */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-50 text-[#4b7bec] border border-blue-100 shadow-2xs">
                <span className="size-2 rounded-full bg-[#4b7bec] animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-wider">
                  {resolvedTag}
                </span>
              </div>
              
              <h1 
                className={cn("text-3xl sm:text-5xl lg:text-6xl text-slate-900 tracking-tight leading-[1.08]", locale === 'ar' ? 'font-black' : 'font-black')}
                style={fontStyle}
              >
                {headline}
              </h1>
              
              <p className="text-sm sm:text-base text-slate-500 leading-relaxed font-normal">
                {subtitle}
              </p>
              
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5 pt-2">
                <button
                  onClick={onShop}
                  className="h-12 px-7 rounded-xl text-xs font-black uppercase tracking-wider text-white transition-all shadow-md shadow-blue-100 flex items-center justify-center gap-2 hover:opacity-95 active:scale-[0.98]"
                  style={{ backgroundColor: primary }}
                >
                  {cta} <ArrowRight className="size-4" />
                </button>
                <button
                  onClick={onScroll}
                  className="h-12 px-6 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-all flex items-center justify-center gap-2 shadow-2xs"
                >
                  {cta2}
                </button>
              </div>
            </motion.div>
          </div>

          {/* Right Visual frame */}
          <div className="lg:col-span-6 order-1 lg:order-2 flex justify-center lg:justify-end">
            <div className="relative w-full aspect-[4/3] sm:aspect-[16/10] lg:aspect-[4/3] max-w-lg group">
              {bannerImg ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.7 }}
                  className="relative h-full w-full overflow-hidden rounded-[28px] shadow-xl border border-slate-200/80 bg-slate-100"
                >
                  {isVideo ? (
                    <video 
                      src={bannerImg} 
                      className="h-full w-full object-cover" 
                      muted loop autoPlay playsInline
                    />
                  ) : (
                    <img 
                      src={bannerImg} 
                      alt={store.name} 
                      className="h-full w-full object-cover" 
                    />
                  )}
                  
                  {/* Floating product card highlight */}
                  {products[0] && (
                    <div className="absolute bottom-4 left-4 right-4 bg-white/95 backdrop-blur-md rounded-2xl p-3.5 border border-slate-200/80 shadow-lg flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {products[0].main_image && (
                          <div className="size-11 rounded-xl bg-slate-100 overflow-hidden shrink-0 border border-slate-200/60">
                            <img src={products[0].main_image} alt={products[0].name} className="size-full object-cover" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-blue-50 text-[#4b7bec]">
                            Produit Vedette
                          </span>
                          <p className="text-xs font-black text-slate-900 truncate mt-0.5">{products[0].name}</p>
                        </div>
                      </div>
                      <button
                        onClick={onShop}
                        className="h-9 px-3.5 rounded-xl text-xs font-black text-white shrink-0 shadow-sm"
                        style={{ backgroundColor: primary }}
                      >
                        Voir
                      </button>
                    </div>
                  )}
                </motion.div>
              ) : (
                <div className="h-full w-full rounded-[28px] bg-white flex flex-col items-center justify-center border border-slate-200 shadow-sm p-8 text-center">
                  <Package className="size-16 text-slate-300 stroke-[1.5] mb-3" />
                  <span className="text-xs font-bold text-slate-500">{store.name}</span>
                  <span className="text-[10px] text-slate-400 mt-1">Catalogue en ligne disponible</span>
                </div>
              )}
            </div>
          </div>

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
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
      {isVideo ? (
        <video 
          src={bannerImg} 
          className="h-full w-full object-cover pointer-events-none" 
          muted 
          loop 
          autoPlay 
          playsInline 
          preload="auto"
        />
      ) : (
        <img 
          src={bannerImg} 
          alt={storeName} 
          className="h-full w-full object-cover" 
        />
      )}
      {/* Dark gradient overlay to fade into page background and make text highly readable */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#07090E] via-black/50 to-black/40 z-10" />
    </div>
  );
}

function LuxeTextContent({ primary, headline, subtitle, cta, heroTag, luxeAttributes, onShop, onScroll }: {
  primary: string; fontClass: string; headline: string; subtitle: string;
  cta: string; cta2: string; heroTag: string;
  luxeAttributes: Array<{label: string; val: string}>;
  onShop: () => void; onScroll: () => void;
}) {
  const { locale } = useTranslation();
  const fontStyle = {
    fontFamily: locale === 'ar'
      ? "'Cairo', 'Tajawal', 'Outfit', sans-serif"
      : '"Playfair Display", "Didot", "Georgia", serif'
  };
  
  return (
    <div className="relative z-20 max-w-4xl">
      <motion.div 
        initial={{ opacity: 0, y: 40 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="inline-flex items-center gap-4 md:gap-6 mb-8 md:mb-10">
          {heroTag && (
            <>
              <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.6em] text-amber-100/60">{heroTag}</span>
              <div className="h-[1px] w-12 md:w-24 bg-gradient-to-r from-amber-500/40 to-transparent" />
            </>
          )}
        </div>
        
        <h1 
          className={cn("text-5xl sm:text-8xl md:text-9xl tracking-tight leading-[0.85] text-white uppercase", locale === 'ar' ? 'font-black' : 'font-light')}
          style={fontStyle}
        >
          {headline.split(' ').map((word, i) => (
            <span key={i} className="block last:text-amber-100/40 last:font-thin">{word}</span>
          ))}
        </h1>

        <div className="mt-12 md:mt-16 grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-12 items-end">
          <div className="md:col-span-8 space-y-8">
            <p className="text-[11px] md:text-xs font-semibold text-white/70 leading-relaxed uppercase tracking-[0.2em] max-w-md">
              {subtitle}
            </p>
            <div className="flex items-center gap-3 md:gap-4">
              <motion.button 
                whileHover={{ scale: 1.03, backgroundColor: '#FFFFFF', color: '#000000' }}
                whileTap={{ scale: 0.98 }}
                onClick={onShop}
                className="px-8 md:px-12 py-4 md:py-5 border border-white bg-white text-black hover:bg-transparent hover:text-white text-[9px] md:text-[10px] font-bold uppercase tracking-[0.4em] transition-all"
                style={{ borderColor: primary }}
              >
                {cta}
              </motion.button>
              <motion.button 
                whileHover={{ y: 5 }}
                onClick={onScroll} 
                className="p-4 md:p-5 border border-white/10 text-white/45 hover:text-white hover:border-white/30 transition-all rounded-full"
              >
                <ChevronDown className="size-4" />
              </motion.button>
            </div>
          </div>

          {/* Attributes from theme_config only — no hardcoded defaults */}
          {luxeAttributes.length > 0 && (
            <div className="hidden md:flex md:col-span-4 flex-col gap-6 border-l border-white/10 pl-12">
              {luxeAttributes.map(i => (
                <div key={i.label}>
                  <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-white/20 mb-1">{i.label}</p>
                  <p className="text-[10px] font-bold text-amber-100/60 uppercase tracking-widest">{i.val}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function LuxeHero({
  store, products, onShop, onScroll,
}: { store: Store; products: Product[]; loading: boolean; onShop: () => void; onScroll: () => void }) {
  const { t, dir } = useTranslation();
  const { primary } = getHeroTheme(store);
  const heroImg = products[0]?.main_image || products[0]?.images?.[0];
  const bannerImg = optimizeCloudinaryUrl(store.banner_url || heroImg, 1600);
  const isVideo = store.theme_config?.bannerIsVideo;
  const { headline, subtitle, cta, cta2 } = heroText(store, {
    headline: store.name,
    subtitle: t('luxeHeroSubtitle'),
    cta: t('seeAll'),
    cta2: t('exclusiveSelection'),
  });

  const fontClass = store.theme_config?.heroFont === 'serif' ? 'font-serif' : 'font-black';
  // heroTag from theme_config only
  const heroTag = (store.theme_config?.heroTag as string | undefined) ?? '';
  // luxeAttributes from theme_config only — no hardcoded defaults
  const rawAttrs = store.theme_config?.heroAttributes as Array<{label: string; val: string}> | undefined;
  const luxeAttributes = rawAttrs ?? [];
  const textProps = { primary, fontClass, headline, subtitle, cta, cta2, heroTag, luxeAttributes, onShop, onScroll };

  return (
    <div className="w-full bg-[#07090E]">
      <section className="relative min-h-[80vh] sm:min-h-[85vh] w-full overflow-hidden flex items-center">
        {/* Micro-frame border overlay to simulate an art gallery */}
        <div className="absolute inset-0 z-30 border-[16px] md:border-[28px] border-slate-950 pointer-events-none" />
        
        <LuxeMediaBg bannerImg={bannerImg} isVideo={isVideo} storeName={store.name} />
        
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/5 z-0 hidden lg:block" />
        
        <div className="relative z-25 w-full px-8 sm:px-24 lg:px-32 py-20">
          <LuxeTextContent {...textProps} />
        </div>

        <div className="absolute bottom-16 right-16 hidden lg:flex items-center gap-8 z-20">
           <div className="flex flex-col items-end gap-1">
              <span className="text-[9px] font-bold text-white/20 uppercase tracking-[0.5em]">{t('establishedIn')}</span>
              <span className="text-sm font-bold text-amber-100/40 tracking-widest">{new Date().getFullYear()}</span>
           </div>
           <div className="h-12 w-px bg-white/10" />
           <div className="flex flex-col gap-1">
              <span className="text-[9px] font-bold text-white/20 uppercase tracking-[0.5em]">{t('workshop')}</span>
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

  // Même queryKey que home-sections.tsx pour cette même requête — les deux
  // sections sont montées ensemble sur la page d'accueil et chacune
  // déclenchait indépendamment un fetch() brut identique (confirmé en
  // réseau : appel dupliqué à chaque chargement). React Query dédoublonne
  // les useQuery de même clé en un seul appel réseau partagé.
  const featuredQuery = useQuery({
    queryKey: ['store-products', activeStore?.id, 'featured', 4],
    queryFn: () => apiFetch<{ success: boolean; data: Product[] }>(`/api/v1/products?store_id=${activeStore!.id}&pageSize=4&is_featured=true&is_active=true`),
    enabled: !!activeStore,
    staleTime: 60 * 1000,
  });
  // Repli sur les produits actifs UNIQUEMENT si le store n'a aucun produit
  // vedette — comportement inchangé, juste sourcé via la même queryKey
  // partagée que home-sections.tsx utilise pour sa propre section "Nouveautés".
  const hasNoFeatured = featuredQuery.isSuccess && (!featuredQuery.data?.data || featuredQuery.data.data.length === 0);
  const fallbackQuery = useQuery({
    queryKey: ['store-products', activeStore?.id, 'active', 4],
    queryFn: () => apiFetch<{ success: boolean; data: Product[] }>(`/api/v1/products?store_id=${activeStore!.id}&pageSize=4&is_active=true`),
    enabled: !!activeStore && hasNoFeatured,
    staleTime: 60 * 1000,
  });
  const loading = featuredQuery.isLoading || (hasNoFeatured && fallbackQuery.isLoading);

  useEffect(() => {
    if (featuredQuery.data?.success && featuredQuery.data.data && featuredQuery.data.data.length > 0) {
      setFeaturedProducts(featuredQuery.data.data);
    } else if (hasNoFeatured && fallbackQuery.data?.success) {
      setFeaturedProducts(fallbackQuery.data.data ?? []);
    } else if (!activeStore) {
      setFeaturedProducts([]);
    }
  }, [activeStore, featuredQuery.data, hasNoFeatured, fallbackQuery.data]);

  const { t } = useTranslation();

  if (!activeStore) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-white">
        <div className="text-center">
          <Package className="mx-auto mb-4 size-12 text-gray-300" />
          <p className="text-lg text-gray-400">{t('noStoreSelected')}</p>
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
  // heroTag for CleanHero
  const cleanHeroTag = (activeStore.theme_config?.heroTag as string | undefined) ?? '';

  if (tpl === 'athletic') return <AthleticHero {...props} />;
  if (tpl === 'luxe') return <LuxeHero {...props} />;
  return <CleanHero {...props} heroTag={cleanHeroTag} />;
}
