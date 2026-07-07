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

function useStoreTheme() {
  const activeStore = useAppStore((s) => s.activeStore);
  const primary = (activeStore?.theme_config?.primaryColor as string) ?? '#111827';
  return { activeStore, primary };
}

const STATIC_TESTIMONIALS = [
  { name: 'Yasmine B.', location: 'Alger',     text: 'Qualité au-delà de mes attentes. Livraison rapide, emballage soigné.', rating: 5 },
  { name: 'Karim M.',   location: 'Oran',      text: 'Exactement comme la photo. Je commande régulièrement maintenant.', rating: 5 },
  { name: 'Samira H.',  location: 'Constantine', text: 'Service client excellent. Ils ont résolu mon problème en minutes.', rating: 5 },
  { name: 'Amira L.',   location: 'Sétif',     text: 'Rapide, sérieux et les produits sont exactement conformes à la description.', rating: 5 },
  { name: 'Riad D.',    location: 'Tizi Ouzou', text: 'Très bon rapport qualité/prix. Je recommande vivement cette boutique.', rating: 5 },
  { name: 'Nadia K.',   location: 'Annaba',    text: 'Commande reçue en 2 jours. Emballage impeccable, je suis ravie !', rating: 5 },
];

export function HomeSections() {
  const { activeStore, primary } = useStoreTheme();
  const setStorefrontView = useAppStore((s) => s.setStorefrontView);
  const addItem = useCartStore((s) => s.addItem);
  const openCart = useCartStore((s) => s.openCart);

  const [featured, setFeatured] = useState<Product[]>([]);
  const [newArrivals, setNewArrivals] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiReviews, setApiReviews] = useState<any[]>([]);

  useEffect(() => {
    if (!activeStore) return;
    const load = async () => {
      try {
        const [f, n] = await Promise.all([
          fetch(`/api/v1/products?store_id=${activeStore.id}&pageSize=4&is_featured=true`).then(r => r.json()),
          fetch(`/api/v1/products?store_id=${activeStore.id}&pageSize=4`).then(r => r.json()),
        ]);
        setFeatured(f.data ?? []);
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

  const testimonials = apiReviews.length > 0
    ? apiReviews.map((r: any) => ({
        name: r.author_name ?? r.authorName ?? 'Client',
        location: r.location ?? r.wilaya ?? '',
        text: r.body ?? r.content ?? r.text ?? '',
        rating: r.rating ?? 5,
        verified: true,
      }))
    : STATIC_TESTIMONIALS;

  if (!activeStore) return null;

  return (
    <div className="bg-white">

      {/* ── LEFT-TO-RIGHT ROLLING STRIP (Sync with Header Style) ──── */}
      <div className="border-y border-white/10 py-3.5 overflow-hidden relative group" style={{ backgroundColor: primary }}>
        <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-black/20 to-transparent z-10 pointer-events-none" />
        <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-black/20 to-transparent z-10 pointer-events-none" />
        
        <motion.div 
          animate={{ x: ['-50%', '0%'] }}
          transition={{ duration: 35, repeat: Infinity, ease: 'linear' }}
          className="flex whitespace-nowrap items-center"
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-12 px-6">
              <span className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.4em] text-white transition-opacity hover:opacity-80 opacity-90">
                <Truck className="size-3.5 text-white/60" />
                Livraison <span className="text-white">Express</span> Algérie
              </span>
              <span className="text-white/30">/</span>
              <span className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.4em] text-white transition-opacity hover:opacity-80 opacity-90">
                <Star className="size-3.5 text-white/60" />
                Qualité <span className="text-white">Certifiée</span>
              </span>
              <span className="text-white/30">/</span>
              <span className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.4em] text-white transition-opacity hover:opacity-80 opacity-90">
                <CheckCircle className="size-3.5 text-white/60" />
                Paiement à la <span className="text-white">Livraison</span>
              </span>
              <span className="text-white/30">/</span>
            </div>
          ))}
        </motion.div>
      </div>

      {/* ── BEST SELLERS ──────────────────────────────────────────── */}
      <section id="best-sellers" className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-20 sm:py-32">
        <div className="flex items-end justify-between mb-12 sm:mb-16">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.6em] mb-3" style={{ color: primary }}>
              Sélection Exclusive
            </p>
            <h2 className="text-4xl sm:text-5xl font-black text-gray-900 tracking-tighter leading-none">
              Best-Sellers
            </h2>
          </div>
          <button 
            onClick={() => setStorefrontView('shop')}
            className="hidden sm:flex items-center gap-2.5 text-[11px] font-black uppercase tracking-[0.3em] text-gray-400 hover:text-gray-900 transition-colors group"
          >
            Tout explorer 
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1"/>
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="aspect-[4/5] bg-gray-50 animate-pulse rounded-2xl" />
            ))}
          </div>
        ) : featured.length > 0 ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-8">
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
          <div className="flex flex-col items-center justify-center gap-6 py-32 bg-gray-50 rounded-3xl border border-dashed border-gray-200">
            <p className="text-sm text-gray-400 font-medium tracking-widest uppercase">La collection arrive bientôt</p>
            <button 
              onClick={() => setStorefrontView('shop')}
              className="text-[11px] font-black uppercase tracking-[0.4em] px-8 py-4 text-white shadow-xl hover:brightness-110 transition-all active:scale-[0.98]"
              style={{ backgroundColor: primary }}
            >
              Voir le catalogue
            </button>
          </div>
        )}
      </section>


      {/* ── NEW ARRIVALS ──────────────────────────────────────────── */}
      {newArrivals.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-20 sm:py-32">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-12 sm:mb-16">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.6em] mb-3" style={{ color: primary }}>
                Dernières pépites
              </p>
              <h2 className="text-4xl sm:text-5xl font-black text-gray-900 tracking-tighter leading-none">
                Nouveautés
              </h2>
            </div>
            <button 
              onClick={() => setStorefrontView('shop')}
              className="text-[11px] font-black uppercase tracking-[0.4em] border-b border-gray-200 pb-1 hover:border-gray-900 transition-colors"
            >
              Voir la collection
            </button>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-8">
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

      {/* ── ROLLING TESTIMONIALS ──────────────────────────────────── */}
      <section className="bg-white border-t border-gray-100 py-24 sm:py-32 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 mb-16 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.7em] mb-4" style={{ color: primary }}>
            Témoignages
          </p>
          <h2 className="text-4xl sm:text-5xl font-black text-gray-900 tracking-tighter leading-tight">
            Ce que nos clients adorent
          </h2>
        </div>

        <div className="relative group">
          {/* Gradient Overlays */}
          <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
          <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />

          <motion.div 
            animate={{ x: ['0%', '-50%'] }}
            transition={{ duration: 35, repeat: Infinity, ease: 'linear' }}
            className="flex gap-8 whitespace-nowrap"
          >
            {/* Double the list for seamless loop */}
            {[...testimonials, ...testimonials].map((t, i) => (
              <div 
                key={i}
                className="inline-block w-[350px] sm:w-[450px] p-8 sm:p-10 rounded-[2.5rem] bg-[#fcfcfc] border border-gray-100 hover:shadow-2xl hover:border-gray-200 transition-all duration-500 group whitespace-normal shrink-0"
              >
                <div className="flex items-center gap-1 mb-6">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="size-3 fill-current text-amber-400" />
                  ))}
                </div>
                
                <p className="text-lg sm:text-xl leading-relaxed mb-8 italic text-gray-700 font-medium">
                  "{t.text}"
                </p>

                <div className="flex items-center gap-4">
                  <div 
                    className="size-12 rounded-2xl flex items-center justify-center text-sm font-black text-white shadow-lg shrink-0"
                    style={{ backgroundColor: primary }}
                  >
                    {t.name[0]}
                  </div>
                  <div>
                    <h4 className="text-[13px] font-black uppercase tracking-widest text-gray-900">
                      {t.name}
                    </h4>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
                      Avis Vérifié • {t.location}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>



    </div>
  );
}
