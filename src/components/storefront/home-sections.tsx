'use client';

import { useAppStore } from '@/store/app-store';
import { useCartStore } from '@/store/cart-store';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { Product } from '@/lib/types';
import { DEFAULT_HOME_SECTIONS } from '@/lib/types';
import { ProductCard } from './product-card';
import { ArrowRight, Star, ChevronRight, Quote, CheckCircle, Truck, Package as PackageIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/use-translation';

function useStoreTheme() {
  const activeStore = useAppStore((s) => s.activeStore);
  const primary = (activeStore?.theme_config?.primaryColor as string) ?? '#111827';
  return { activeStore, primary };
}

// No static/mock testimonials — only real reviews from the API are shown

export function HomeSections() {
  const { activeStore, primary } = useStoreTheme();
  const setStorefrontView = useAppStore((s) => s.setStorefrontView);
  const addItem = useCartStore((s) => s.addItem);
  const openCart = useCartStore((s) => s.openCart);
  const { t, dir } = useTranslation();

  const [featured, setFeatured] = useState<Product[]>([]);
  const [newArrivals, setNewArrivals] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiReviews, setApiReviews] = useState<any[]>([]);

  // Mêmes clés que hero-section.tsx pour ces deux mêmes requêtes — les deux
  // composants sont montés simultanément sur la page d'accueil et
  // demandaient chacun leur propre fetch() brut (donc sans cache/
  // dédoublonnage) pour les MÊMES produits vedettes, confirmé en réseau
  // (deux appels identiques par chargement de page). React Query fusionne
  // les useQuery de même clé en un seul appel réseau partagé.
  const featuredQuery = useQuery({
    queryKey: ['store-products', activeStore?.id, 'featured', 4],
    queryFn: () => apiFetch<{ success: boolean; data: Product[] }>(`/api/v1/products?store_id=${activeStore!.id}&pageSize=4&is_featured=true&is_active=true`),
    enabled: !!activeStore,
    staleTime: 60 * 1000,
  });
  const activeQuery = useQuery({
    queryKey: ['store-products', activeStore?.id, 'active', 4],
    queryFn: () => apiFetch<{ success: boolean; data: Product[] }>(`/api/v1/products?store_id=${activeStore!.id}&pageSize=4&is_active=true`),
    enabled: !!activeStore,
    staleTime: 60 * 1000,
  });
  useEffect(() => {
    if (!activeStore) return;
    if (featuredQuery.isLoading || activeQuery.isLoading) { setLoading(true); return; }
    const f = featuredQuery.data;
    const n = activeQuery.data;
    const featuredData = f?.data && f.data.length > 0 ? f.data : (n?.data ?? []);
    setFeatured(featuredData);
    setNewArrivals(n?.data ?? []);
    setLoading(false);
  }, [activeStore, featuredQuery.data, featuredQuery.isLoading, activeQuery.data, activeQuery.isLoading]);

  useEffect(() => {
    if (!activeStore) return;
    fetch(`/api/v1/reviews?store_id=${activeStore.id}&pageSize=6&approved=true`)
      .then(r => r.json())
      .then(j => { if (j.reviews?.length) setApiReviews(j.reviews); })
      .catch(() => {});
  }, [activeStore]);

  const categories = Array.from(new Set(featured.map(p => p.category?.trim()).filter(Boolean))).slice(0, 3);

  // Only show real reviews from the API — no static fallback
  const testimonials = apiReviews.map((r: any) => ({
    name: r.author_name ?? r.authorName ?? 'Client',
    location: r.location ?? r.wilaya ?? '',
    text: r.body ?? r.content ?? r.text ?? '',
    rating: r.rating ?? 5,
    verified: true,
  }));

  // Dynamic section labels from theme_config (ThemeConfig fields are optional, hide if null)
  const tc = activeStore?.theme_config;
  const bestSellersLabel = tc?.labelBestSellers ?? t('bestSellers');
  const bestSellersTag = tc?.labelBestSellersTag ?? t('exclusiveSelection');
  const newArrivalsLabel = tc?.labelNewArrivals ?? t('newArrivals');
  const newArrivalsTag = tc?.labelNewArrivalsTag ?? t('latestReleases');

  if (!activeStore) return null;

  const _raw = activeStore.template_id || 'clean';
  const tpl = _raw === 'minimalist' ? 'clean' : _raw === 'landing' ? 'athletic' : _raw;
  
  const bgClass = 
    tpl === 'athletic' ? 'bg-[#0A0A0A] text-white min-h-screen' :
    tpl === 'luxe' ? 'bg-[#0C0F1A] text-white min-h-screen' :
    'bg-white text-neutral-900 min-h-screen';

  // Section visibility + order — configurable per store via
  // theme_config.sectionsConfig (see store-wizard.tsx's Sections step).
  // Falls back to all 3 enabled in the original fixed order when unset,
  // so a store that never touched this config renders exactly as before.
  const sectionsOrder = (activeStore.theme_config?.sectionsConfig ?? DEFAULT_HOME_SECTIONS)
    .filter(s => s.enabled)
    .map(s => s.key);

  const bestSellersSection = (
      <section
        key="bestSellers"
        id="best-sellers"
        className={cn(
          tpl === 'clean' 
            ? 'max-w-[1600px] mx-auto px-4 sm:px-8 lg:px-12 py-16 sm:py-24' 
            : 'max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-20 sm:py-32'
        )}
      >
        <div className={cn(
          "flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10 sm:mb-14",
          tpl === 'clean' && "border-b border-slate-100 pb-5"
        )}>
          <div>
            <div className={cn(
              "inline-flex items-center gap-2 mb-2",
              tpl === 'clean' && "px-3 py-1 rounded-lg bg-blue-50 text-[#4b7bec] border border-blue-100"
            )}>
              <span className="size-1.5 rounded-full bg-[#4b7bec]" />
              <span className="text-[9px] font-black uppercase tracking-wider">
                {bestSellersTag}
              </span>
            </div>
            <h2 className={cn(
              "text-2xl sm:text-4xl tracking-tight uppercase",
              tpl === 'clean' ? 'font-black text-slate-900' :
              tpl === 'luxe' ? 'font-thin text-white' :
              'font-black text-white tracking-tighter'
            )}>
              {bestSellersLabel}
            </h2>
          </div>
          <button 
            onClick={() => setStorefrontView('shop')}
            className={cn(
              "hidden sm:flex items-center gap-2 text-xs font-black uppercase tracking-wider transition-all",
              tpl === 'clean' ? 'text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-4 py-2 rounded-xl shadow-2xs hover:bg-slate-50' :
              tpl === 'luxe' ? 'text-white/40 hover:text-white border-b border-white/10 pb-1.5' :
              'text-white/40 hover:text-white'
            )}
          >
            {t('exploreAll')} 
            <ArrowRight className="size-3.5"/>
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="aspect-[4/5] bg-slate-100 animate-pulse rounded-2xl" />
            ))}
          </div>
        ) : featured.length > 0 ? (
          <div className={cn(
            "grid grid-cols-2 lg:grid-cols-4",
            tpl === 'clean' ? "gap-4 sm:gap-6" : "gap-4 lg:gap-8"
          )}>
            {featured.map(product => (
              <ProductCard 
                key={product.id} 
                product={product}
                onQuickView={(slug) => { 
                  useAppStore.getState().setSelectedProductSlug(slug); 
                  useAppStore.getState().setStorefrontView('product'); 
                }}
                onAddToCart={(p) => { addItem(p, 1); openCart(); }}
              />
            ))}
          </div>
        ) : (
          <div className={cn(
            "flex flex-col items-center justify-center gap-4 py-20 border border-dashed text-center",
            tpl === 'clean' ? 'bg-slate-50/50 border-slate-200 rounded-[24px]' :
            tpl === 'luxe' ? 'bg-[#12172A] border-white/5 rounded-none' :
            'bg-gray-50 border-gray-200 rounded-3xl'
          )}>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {t('collectionComingSoon')}
            </p>
            <button 
              onClick={() => setStorefrontView('shop')}
              className="text-xs font-black uppercase tracking-wider px-6 py-3 rounded-xl text-white shadow-md shadow-blue-100"
              style={{ backgroundColor: primary }}
            >
              {t('viewCatalog')}
            </button>
          </div>
        )}
      </section>
  );


  const newArrivalsSection = newArrivals.length > 0 ? (
        <section
          key="newArrivals"
          className={cn(
            tpl === 'clean' 
              ? 'max-w-[1600px] mx-auto px-4 sm:px-8 lg:px-12 py-16 sm:py-24' 
              : 'max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-20 sm:py-32'
          )}
        >
          <div className={cn(
            "flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10 sm:mb-14",
            tpl === 'clean' && "border-b border-slate-100 pb-5"
          )}>
            <div>
              <div className={cn(
                "inline-flex items-center gap-2 mb-2",
                tpl === 'clean' && "px-3 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100"
              )}>
                <span className="size-1.5 rounded-full bg-emerald-500" />
                <span className="text-[9px] font-black uppercase tracking-wider">
                  {newArrivalsTag}
                </span>
              </div>
              <h2 className={cn(
                "text-2xl sm:text-4xl tracking-tight uppercase",
                tpl === 'clean' ? 'font-black text-slate-900' :
                tpl === 'luxe' ? 'font-thin text-white' :
                'font-black text-white tracking-tighter'
              )}>
                {newArrivalsLabel}
              </h2>
            </div>
            <button 
              onClick={() => setStorefrontView('shop')}
              className={cn(
                "text-xs font-black uppercase tracking-wider transition-all",
                tpl === 'clean' ? 'text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-4 py-2 rounded-xl shadow-2xs hover:bg-slate-50 flex items-center gap-2' :
                tpl === 'luxe' ? 'text-white/40 border-white/10 hover:text-white' :
                'text-gray-500 border-gray-200 hover:border-gray-900'
              )}
            >
              {t('viewCollection')}
              <ArrowRight className="size-3.5" />
            </button>
          </div>
          <div className={cn(
            "grid grid-cols-2 lg:grid-cols-4",
            tpl === 'clean' ? "gap-4 sm:gap-6" : "gap-4 lg:gap-8"
          )}>
            {newArrivals.map(product => (
              <ProductCard 
                key={product.id} 
                product={product}
                onQuickView={(slug) => { 
                  useAppStore.getState().setSelectedProductSlug(slug); 
                  useAppStore.getState().setStorefrontView('product'); 
                }}
                onAddToCart={(p) => { addItem(p, 1); openCart(); }}
              />
            ))}
          </div>
        </section>
  ) : null;


  // Testimonials — only shown if real API reviews exist AND the config
  // enables the section (tpl==='clean' has never shown this section by
  // design, regardless of config — kept unchanged).
  const testimonialsSection = tpl !== 'clean' && testimonials.length > 0 ? (
        <section key="testimonials" className={cn(
          "py-24 sm:py-32 overflow-hidden border-t",
          tpl === 'clean' ? 'bg-white border-neutral-100' :
          tpl === 'luxe' ? 'bg-[#0C0F1A] border-white/5' :
          'bg-white border-gray-100'
        )}>
          <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 mb-16 text-center">
            <p className={cn(
              "text-[9px] uppercase tracking-[0.5em] mb-4",
              tpl === 'clean' ? 'font-semibold text-neutral-400' :
              tpl === 'luxe' ? 'font-light text-amber-500/60' :
              'font-black'
            )} style={tpl !== 'clean' && tpl !== 'luxe' ? { color: primary } : {}}>
              {t('testimonials')}
            </p>
            <h2 className={cn(
              "text-4xl sm:text-5xl tracking-tight leading-tight uppercase",
              tpl === 'clean' ? 'font-extralight text-neutral-900' :
              tpl === 'luxe' ? 'font-thin text-white' :
              'font-black text-gray-900 tracking-tighter'
            )}>
              {t('whatClientsSay')}
            </h2>
          </div>

          <div className="relative group">
            {/* Gradient Overlays */}
            <div className={cn(
              "absolute inset-y-0 left-0 w-32 z-10 pointer-events-none",
              tpl === 'clean' ? 'bg-gradient-to-r from-white to-transparent' :
              tpl === 'luxe' ? 'bg-gradient-to-r from-[#0C0F1A] to-transparent' :
              'bg-gradient-to-r from-[#0A0A0A] to-transparent'
            )} />
            <div className={cn(
              "absolute inset-y-0 right-0 w-32 z-10 pointer-events-none",
              tpl === 'clean' ? 'bg-gradient-to-l from-white to-transparent' :
              tpl === 'luxe' ? 'bg-gradient-to-l from-[#0C0F1A] to-transparent' :
              'bg-gradient-to-l from-[#0A0A0A] to-transparent'
            )} />

            <motion.div 
              animate={{ x: ['0%', '-50%'] }}
              transition={{ duration: 35, repeat: Infinity, ease: 'linear' }}
              className="flex gap-8 whitespace-nowrap"
            >
              {/* Double the list for seamless loop */}
              {[...testimonials, ...testimonials].map((testi, i) => (
                <div 
                  key={i}
                  className={cn(
                    "inline-block w-[350px] sm:w-[450px] p-8 sm:p-10 border transition-all duration-500 group whitespace-normal shrink-0",
                    tpl === 'clean' ? 'rounded-none bg-neutral-50/50 border-neutral-100 hover:shadow-[0_12px_30px_rgba(0,0,0,0.02)]' :
                    tpl === 'luxe' ? 'rounded-none bg-[#12172A] border-white/5' :
                    'rounded-[2.5rem] bg-[#fcfcfc] border-gray-100 hover:shadow-2xl hover:border-gray-200'
                  )}
                >
                  <div className="flex items-center gap-1 mb-6">
                    {Array.from({ length: testi.rating }).map((_, idx) => (
                      <Star key={idx} className={cn("size-3 fill-current", tpl === 'luxe' ? 'text-amber-500' : 'text-amber-400')} />
                    ))}
                  </div>
                  
                  <p className={cn(
                    "text-base sm:text-lg leading-relaxed mb-8 italic",
                    tpl === 'clean' ? 'text-neutral-600 font-light' :
                    tpl === 'luxe' ? 'text-white/70 font-light' :
                    'text-gray-700 font-medium'
                  )}>
                    "{testi.text}"
                  </p>

                  <div className="flex items-center gap-4">
                    <div 
                      className={cn(
                        "size-11 flex items-center justify-center text-xs shadow-none shrink-0",
                        tpl === 'clean' ? 'rounded-none font-semibold text-white' :
                        tpl === 'luxe' ? 'rounded-none font-light text-neutral-900' :
                        'rounded-2xl font-black text-white shadow-lg'
                      )}
                      style={{ backgroundColor: primary }}
                    >
                      {testi.name[0]}
                    </div>
                    <div>
                      <h4 className={cn(
                        "text-[10px] uppercase tracking-widest",
                        tpl === 'clean' ? 'font-semibold text-neutral-900' :
                        tpl === 'luxe' ? 'font-medium text-white' :
                        'font-black text-gray-900'
                      )}>
                        {testi.name}
                      </h4>
                      <p className={cn(
                        "text-[8px] uppercase tracking-[0.2em]",
                        tpl === 'clean' ? 'font-semibold text-neutral-400' :
                        tpl === 'luxe' ? 'font-light text-neutral-500' :
                        'font-bold text-gray-400'
                      )}>
                        {t('verifiedReview')} • {testi.location}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          </div>
        </section>
  ) : null;

  const SECTION_MAP: Record<string, ReactNode> = {
    bestSellers: bestSellersSection,
    newArrivals: newArrivalsSection,
    testimonials: testimonialsSection,
  };

  return (
    <div className={bgClass} dir={dir}>
      {sectionsOrder.map(key => SECTION_MAP[key])}
    </div>
  );
}
