'use client';

import { useAppStore } from '@/store/app-store';
import { useCartStore } from '@/store/cart-store';
import { useEffect, useState } from 'react';
import type { Product } from '@/lib/types';
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

  useEffect(() => {
    if (!activeStore) return;
    const load = async () => {
      try {
        const [f, n] = await Promise.all([
          fetch(`/api/v1/products?store_id=${activeStore.id}&pageSize=4&is_featured=true&is_active=true`).then(r => r.json()),
          fetch(`/api/v1/products?store_id=${activeStore.id}&pageSize=4&is_active=true`).then(r => r.json()),
        ]);
        const featuredData = f.data && f.data.length > 0 ? f.data : (n.data ?? []);
        setFeatured(featuredData);
        setNewArrivals(n.data ?? []);
      } catch { /* silent */ } finally { setLoading(false); }
    };
    load();
  }, [activeStore]);

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

  return (
    <div className={bgClass} dir={dir}>



      {/* ── BEST SELLERS ──────────────────────────────────────────── */}
      <section 
        id="best-sellers" 
        className={cn(
          tpl === 'clean' 
            ? 'max-w-[1600px] mx-auto px-6 sm:px-12 py-24 sm:py-36' 
            : 'max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-20 sm:py-32'
        )}
      >
        <div className={cn(
          "flex items-end justify-between mb-12 sm:mb-16",
          tpl === 'clean' && "border-b border-neutral-100 pb-6"
        )}>
          <div>
            <p className={cn(
              "text-[9px] uppercase tracking-[0.4em] mb-2.5",
              tpl === 'clean' ? 'font-semibold text-neutral-400' : 
              tpl === 'luxe' ? 'font-light text-amber-500/80' : 
              'font-black'
            )} style={tpl !== 'clean' && tpl !== 'luxe' ? { color: primary } : {}}>
              {bestSellersTag}
            </p>
            <h2 className={cn(
              "text-4xl sm:text-5xl tracking-tight leading-none uppercase",
              tpl === 'clean' ? 'font-extralight text-neutral-900' :
              tpl === 'luxe' ? 'font-thin text-white' :
              'font-black text-white tracking-tighter'
            )}>
              {bestSellersLabel}
            </h2>
          </div>
          <button 
            onClick={() => setStorefrontView('shop')}
            className={cn(
              "hidden sm:flex items-center gap-2.5 text-[9px] font-semibold uppercase tracking-[0.25em] transition-colors group",
              tpl === 'clean' ? 'text-neutral-400 hover:text-neutral-900' :
              tpl === 'luxe' ? 'text-white/40 hover:text-white border-b border-white/10 pb-1.5' :
              'text-white/40 hover:text-white'
            )}
          >
            {t('exploreAll')} 
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1"/>
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="aspect-[4/5] bg-gray-50/10 animate-pulse rounded-none" />
            ))}
          </div>
        ) : featured.length > 0 ? (
          <div className={cn(
            "grid grid-cols-2 lg:grid-cols-4",
            tpl === 'clean' ? "gap-x-8 gap-y-16 lg:gap-x-10 lg:gap-y-20" : "gap-4 lg:gap-8"
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
            "flex flex-col items-center justify-center gap-6 py-32 border border-dashed",
            tpl === 'clean' ? 'bg-neutral-50/50 border-neutral-200 rounded-none' :
            tpl === 'luxe' ? 'bg-[#12172A] border-white/5 rounded-none' :
            'bg-gray-50 border-gray-200 rounded-3xl'
          )}>
            <p className={cn(
              "text-[10px] uppercase tracking-widest",
              tpl === 'clean' ? 'text-neutral-400 font-medium' :
              tpl === 'luxe' ? 'text-white/40 font-light' :
              'text-gray-400 font-medium'
            )}>
              {t('collectionComingSoon')}
            </p>
            <button 
              onClick={() => setStorefrontView('shop')}
              className={cn(
                "text-[9px] font-semibold uppercase tracking-[0.25em] px-9 py-4 transition-all duration-300",
                tpl === 'clean' ? 'text-white bg-neutral-900 hover:bg-neutral-800 rounded-none' :
                tpl === 'luxe' ? 'text-neutral-950 rounded-none bg-white' :
                'text-white shadow-xl hover:brightness-110 active:scale-[0.98]'
              )}
              style={tpl !== 'clean' && tpl !== 'luxe' ? { backgroundColor: primary } : {}}
            >
              {t('viewCatalog')}
            </button>
          </div>
        )}
      </section>


      {/* ── NEW ARRIVALS ──────────────────────────────────────────── */}
      {newArrivals.length > 0 && (
        <section 
          className={cn(
            tpl === 'clean' 
              ? 'max-w-[1600px] mx-auto px-6 sm:px-12 py-24 sm:py-36' 
              : 'max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-20 sm:py-32'
          )}
        >
          <div className={cn(
            "flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-12 sm:mb-16",
            tpl === 'clean' && "border-b border-neutral-100 pb-6"
          )}>
            <div>
              <p className={cn(
                "text-[9px] uppercase tracking-[0.4em] mb-2.5",
                tpl === 'clean' ? 'font-semibold text-neutral-400' :
                tpl === 'luxe' ? 'font-light text-amber-500/80' :
                'font-black'
              )} style={tpl !== 'clean' && tpl !== 'luxe' ? { color: primary } : {}}>
                {newArrivalsTag}
              </p>
              <h2 className={cn(
                "text-4xl sm:text-5xl tracking-tight leading-none uppercase",
                tpl === 'clean' ? 'font-extralight text-neutral-900' :
                tpl === 'luxe' ? 'font-thin text-white' :
                'font-black text-white tracking-tighter'
              )}>
                {newArrivalsLabel}
              </h2>
            </div>
            <button 
              onClick={() => setStorefrontView('shop')}
              className={cn(
                "text-[9px] font-semibold uppercase tracking-[0.25em] border-b pb-1.5 transition-colors",
                tpl === 'clean' ? 'text-neutral-400 border-neutral-200 hover:text-neutral-900 hover:border-neutral-900' :
                tpl === 'luxe' ? 'text-white/40 border-white/10 hover:text-white hover:border-white' :
                'text-gray-500 border-gray-200 hover:border-gray-900'
              )}
            >
              {t('viewCollection')}
            </button>
          </div>
          <div className={cn(
            "grid grid-cols-2 lg:grid-cols-4",
            tpl === 'clean' ? "gap-x-8 gap-y-16 lg:gap-x-10 lg:gap-y-20" : "gap-4 lg:gap-8"
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
      )}

      {/* ── ROLLING TESTIMONIALS — only shown if real API reviews exist ──── */}
      {tpl !== 'clean' && testimonials.length > 0 && (
        <section className={cn(
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
      )}

    </div>
  );
}
