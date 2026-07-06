'use client';

import { useEffect, useState, useRef } from 'react';
import {
  ShieldCheck, Truck, RotateCcw, Star, Phone,
  ShoppingCart, CheckCircle, ArrowRight, Package, Zap,
  ChevronDown, ChevronUp, Award, Clock,
} from 'lucide-react';
import { motion, useInView } from 'framer-motion';
import { useCartStore } from '@/store/cart-store';
import { formatPrice } from '@/lib/format';

// ── icon map for benefits ──────────────────────────────────────
const ICON_MAP: Record<string, React.ElementType> = {
  Truck, ShieldCheck, RotateCcw, Package, Zap, Award, Clock, Star,
};

// ── helpers ────────────────────────────────────────────────────
function Counter({ target, suffix = '' }: { target: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView) return;
    let cur = 0;
    const step = Math.ceil(target / 45);
    const id = setInterval(() => {
      cur = Math.min(cur + step, target);
      setVal(cur);
      if (cur >= target) clearInterval(id);
    }, 24);
    return () => clearInterval(id);
  }, [inView, target]);
  return <span ref={ref}>{val}{suffix}</span>;
}

function FadeIn({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

interface LpData {
  id: string;
  store_id: string;
  slug: string;
  headline: string;
  subtitle: string;
  badge_text: string;
  cta_label: string;
  cta2_label: string;
  image_url: string | null;
  video_url: string | null;
  product_name: string | null;
  product_desc: string | null;
  price: number | null;
  compare_price: number | null;
  primary_color: string;
  template: string;
  benefits: { icon: string; title: string; desc: string }[];
  testimonials: { name: string; location: string; text: string; stars: number; avatar?: string }[];
  steps: { step: string; title: string; desc: string }[];
  stats: { value: number; suffix: string; label: string }[];
  faq: { question: string; answer: string }[];
  gallery: string[];
  phone: string | null;
  product?: Record<string, any>;
}

export default function LandingPageRenderer({ data }: { data: LpData }) {
  const addItem = useCartStore((s) => s.addItem);
  const openCart = useCartStore((s) => s.openCart);
  const [added, setAdded] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const primary = data.primary_color || '#e84393';
  const isDark = data.template !== 'light';
  const isPremium = data.template === 'premium';

  const bg = isPremium 
    ? 'bg-[#050505] text-white selection:bg-purple-500/30'
    : isDark ? 'bg-black text-white' : 'bg-white text-gray-900';
    
  const cardBg = isPremium
    ? 'bg-white/[0.03] border-white/5 backdrop-blur-xl hover:border-white/10 transition-all'
    : isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200';

  const heroImage = data.image_url || data.product?.main_image;
  const price = data.price ?? data.product?.price ?? null;
  const comparePrice = data.compare_price ?? data.product?.compare_price ?? null;
  const productName = data.product_name || data.product?.name || data.headline;
  const productDesc = data.product_desc || data.product?.description || data.subtitle;

  function handleOrder() {
    if (data.product) {
      addItem(
        {
          ...data.product,
          price: price ?? data.product.price,
          main_image: heroImage ?? data.product.main_image,
        } as any,
        1
      );
      setAdded(true);
      openCart();
      setTimeout(() => setAdded(false), 2000);
    } else if (data.phone) {
      window.open(`https://wa.me/${data.phone.replace(/\D/g, '')}`, '_blank');
    }
  }

  const discount = comparePrice && price ? Math.round((1 - price / comparePrice) * 100) : 0;

  // ─── PREMIUM LAYOUT ───
  if (isPremium) {
    return (
      <div className={`min-h-screen font-sans ${bg} overflow-x-hidden`} style={{ '--primary': primary } as React.CSSProperties}>
        {/* Animated Background Elements */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-purple-600/10 blur-[120px] animate-pulse" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/10 blur-[120px] animate-pulse" style={{ animationDelay: '2s' }} />
        </div>

        {/* ── HERO ── */}
        <section className="relative pt-32 pb-20 px-4">
          <div className="max-w-7xl mx-auto flex flex-col items-center text-center">
             {data.badge_text && (
                <FadeIn>
                  <span className="px-5 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-md text-[10px] font-black uppercase tracking-[0.2em] mb-8 inline-block" style={{ color: primary }}>
                    {data.badge_text}
                  </span>
                </FadeIn>
             )}
             <FadeIn delay={0.1}>
                <h1 className="text-5xl sm:text-7xl lg:text-8xl font-black leading-[0.95] tracking-tight mb-8 bg-gradient-to-b from-white to-white/50 bg-clip-text text-transparent">
                  {data.headline}
                </h1>
             </FadeIn>
             <FadeIn delay={0.2}>
                <p className="text-lg sm:text-xl text-white/50 max-w-2xl font-medium mb-12">
                  {data.subtitle}
                </p>
             </FadeIn>

             {/* Price & CTA Float */}
             <FadeIn delay={0.3}>
                <div className="flex flex-col items-center gap-6 p-2 rounded-[40px] bg-white/5 border border-white/10 backdrop-blur-2xl shadow-2xl">
                  <div className="flex items-center gap-10 px-8 py-4">
                    <div className="flex flex-col items-start">
                      <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">Prix Exclusif</span>
                      <div className="flex items-center gap-3">
                        <span className="text-3xl font-black">{formatPrice(price || 0)}</span>
                        {comparePrice && <span className="text-lg text-white/20 line-through">{formatPrice(comparePrice)}</span>}
                      </div>
                    </div>
                    <button 
                      onClick={handleOrder}
                      className="h-16 px-10 rounded-[30px] bg-white text-black font-black text-lg hover:scale-105 active:scale-95 transition-all shadow-xl shadow-white/10 flex items-center gap-3"
                    >
                      {added ? <CheckCircle className="size-6 text-green-600" /> : <ShoppingCart className="size-6" />}
                      {added ? 'Ajouté !' : data.cta_label || 'Commander'}
                    </button>
                  </div>
                </div>
             </FadeIn>

             {/* Hero Image / Video */}
             <FadeIn delay={0.4} className="mt-20 w-full max-w-5xl">
                <div className="relative aspect-video rounded-[40px] overflow-hidden border border-white/10 shadow-2xl group">
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-60 z-10" />
                  <img src={heroImage || ''} alt="" className="size-full object-cover group-hover:scale-110 transition-all duration-[2s]" />
                  <div className="absolute bottom-8 left-8 z-20 flex items-center gap-4">
                     <div className="size-12 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center">
                        <Package className="size-5" />
                     </div>
                     <span className="text-sm font-bold uppercase tracking-widest text-white/80">Premium Quality Edition</span>
                  </div>
                </div>
             </FadeIn>
          </div>
        </section>

        {/* ── STATS / TRUST ── */}
        <section className="py-20 border-y border-white/5">
           <div className="max-w-6xl mx-auto px-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
                {data.stats?.map((s, i) => (
                  <FadeIn key={i} delay={i*0.1} className="text-center">
                    <p className="text-4xl font-black mb-1 bg-gradient-to-r from-white to-white/40 bg-clip-text text-transparent">
                      <Counter target={s.value} suffix={s.suffix} />
                    </p>
                    <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">{s.label}</p>
                  </FadeIn>
                ))}
                {!data.stats?.length && [
                  { v: 98, s: '%', l: 'Satisfaction' },
                  { v: 15, s: 'k+', l: 'Clients' },
                  { v: 48, s: 'h', l: 'Livraison' },
                  { v: 5, s: '/5', l: 'Note' }
                ].map((s, i) => (
                  <FadeIn key={i} delay={i*0.1} className="text-center">
                    <p className="text-4xl font-black mb-1 bg-gradient-to-r from-white to-white/40 bg-clip-text text-transparent">
                      <Counter target={s.v} suffix={s.s} />
                    </p>
                    <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">{s.l}</p>
                  </FadeIn>
                ))}
              </div>
           </div>
        </section>

        {/* ── BENEFITS GRID ── */}
        <section className="py-32 px-4 relative">
          <div className="max-w-6xl mx-auto">
            <FadeIn className="mb-20 text-center">
              <h2 className="text-4xl sm:text-6xl font-black uppercase tracking-tight mb-4">L'Excellence Sans Compromis</h2>
              <div className="h-1.5 w-24 bg-white mx-auto rounded-full" style={{ background: primary }} />
            </FadeIn>
            
            <div className="grid md:grid-cols-3 gap-6">
              {data.benefits?.map((b, i) => {
                const Icon = ICON_MAP[b.icon] || ShieldCheck;
                return (
                  <FadeIn key={i} delay={i*0.1} className={`p-10 rounded-[40px] ${cardBg} flex flex-col items-center text-center`}>
                    <div className="size-20 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-8 rotate-3">
                       <Icon className="size-10" style={{ color: primary }} />
                    </div>
                    <h3 className="text-2xl font-black mb-4">{b.title}</h3>
                    <p className="text-white/40 leading-relaxed font-medium">{b.desc}</p>
                  </FadeIn>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── FEATURE SHOWCASE ── */}
        <section className="py-32 bg-white/[0.02]">
           <div className="max-w-7xl mx-auto px-4 grid lg:grid-cols-2 gap-20 items-center">
              <FadeIn className="relative">
                 <div className="absolute inset-0 bg-purple-500/20 blur-[100px] rounded-full" />
                 <img src={data.gallery?.[0] || heroImage || ''} alt="" className="relative z-10 rounded-[40px] border border-white/10 shadow-2xl" />
                 <div className="absolute -bottom-10 -right-10 p-8 rounded-3xl bg-white/5 backdrop-blur-3xl border border-white/10 hidden sm:block">
                    <p className="text-sm font-black uppercase tracking-widest text-white/40 mb-2">Authenticité</p>
                    <div className="flex items-center gap-2">
                       <CheckCheck className="size-6 text-green-500" />
                       <span className="text-xl font-bold">100% Certifié</span>
                    </div>
                 </div>
              </FadeIn>
              <FadeIn delay={0.2}>
                 <span className="text-[10px] font-black uppercase tracking-[0.3em] mb-6 inline-block" style={{ color: primary }}>Focus Produit</span>
                 <h2 className="text-4xl sm:text-5xl font-black mb-8 leading-tight">{productName}</h2>
                 <p className="text-xl text-white/50 leading-relaxed mb-12">{productDesc}</p>
                 <div className="space-y-6">
                    {['Matériaux de haute qualité', 'Design ergonomique breveté', 'Durabilité exceptionnelle'].map((f, i) => (
                       <div key={i} className="flex items-center gap-4">
                          <div className="size-6 rounded-full bg-green-500/20 flex items-center justify-center">
                             <Check className="size-4 text-green-500" />
                          </div>
                          <span className="font-bold text-white/80">{f}</span>
                       </div>
                    ))}
                 </div>
              </FadeIn>
           </div>
        </section>

        {/* ── TESTIMONIALS ── */}
        <section className="py-32 px-4">
           <div className="max-w-7xl mx-auto">
              <FadeIn className="text-center mb-20">
                 <h2 className="text-4xl sm:text-6xl font-black uppercase tracking-tight">Ils nous font confiance</h2>
              </FadeIn>
              <div className="grid md:grid-cols-3 gap-6">
                 {data.testimonials?.map((t, i) => (
                    <FadeIn key={i} delay={i*0.1} className={`p-8 rounded-[32px] ${cardBg}`}>
                       <div className="flex gap-1 mb-6">
                          {Array.from({ length: t.stars }).map((_, j) => (
                             <Star key={j} className="size-5 fill-amber-400 text-amber-400" />
                          ))}
                       </div>
                       <p className="text-lg font-medium italic text-white/80 mb-8 leading-relaxed">"{t.text}"</p>
                       <div className="flex items-center gap-4">
                          <div className="size-12 rounded-full bg-white/10 border border-white/20 flex items-center justify-center font-black">
                             {t.name.charAt(0)}
                          </div>
                          <div>
                             <p className="font-black text-sm">{t.name}</p>
                             <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">{t.location}</p>
                          </div>
                       </div>
                    </FadeIn>
                 ))}
              </div>
           </div>
        </section>

        {/* ── FINAL BANNER ── */}
        <section className="py-20 px-4">
           <FadeIn>
              <div className="max-w-7xl mx-auto rounded-[60px] p-12 sm:p-24 relative overflow-hidden text-center group">
                 <div className="absolute inset-0 bg-gradient-to-r from-purple-600 to-blue-600 opacity-90 transition-all duration-1000 group-hover:scale-110" style={{ background: `linear-gradient(135deg, ${primary} 0%, #000 100%)` }} />
                 <div className="relative z-10">
                    <h2 className="text-5xl sm:text-7xl font-black mb-8">N'attendez plus.</h2>
                    <p className="text-xl text-white/70 mb-12 max-w-xl mx-auto font-medium">Rejoignez des milliers de clients satisfaits et profitez de notre offre exclusive aujourd'hui.</p>
                    <button 
                      onClick={handleOrder}
                      className="h-20 px-16 rounded-full bg-white text-black font-black text-xl hover:scale-105 active:scale-95 transition-all shadow-2xl"
                    >
                      Démarrer l'Expérience
                    </button>
                 </div>
              </div>
           </FadeIn>
        </section>

        {/* ── FOOTER ── */}
        <footer className="py-12 border-t border-white/5 text-center">
           <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.4em]">
             AzzougShop • Excellence Logistique • Algérie
           </p>
        </footer>
      </div>
    );
  }

  return (
    <div className={`min-h-screen font-sans ${bg}`} style={{ '--primary': primary } as React.CSSProperties}>
      {/* ── HERO ─────────────────────────────────────────────── */}
      <section
        className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-4"
        style={{ background: isDark ? `linear-gradient(135deg, #0a0a0a 0%, #1a0a14 60%, #0a0a0a 100%)` : `linear-gradient(135deg, #fff 0%, #fdf2f8 60%, #fff 100%)` }}
      >
        {/* glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[120px] opacity-20"
            style={{ background: primary }}
          />
        </div>

        <div className="relative z-10 max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center py-24 lg:py-32">
          {/* left: copy */}
          <div className="text-center lg:text-left">
            {data.badge_text && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="inline-block mb-4 px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase border"
                style={{ borderColor: primary, color: primary, background: `${primary}18` }}
              >
                {data.badge_text}
              </motion.div>
            )}

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.1] mb-4"
            >
              {data.headline}
            </motion.h1>

            {data.subtitle && (
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className={`text-lg mb-6 max-w-xl mx-auto lg:mx-0 ${isDark ? 'text-white/70' : 'text-gray-600'}`}
              >
                {data.subtitle}
              </motion.p>
            )}

            {/* price */}
            {price !== null && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="flex items-center gap-3 justify-center lg:justify-start mb-6"
              >
                <span className="text-4xl font-black" style={{ color: primary }}>
                  {formatPrice(price)}
                </span>
                {comparePrice && comparePrice > price && (
                  <>
                    <span className={`text-xl line-through ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
                      {formatPrice(comparePrice)}
                    </span>
                    <span className="text-sm font-bold px-2 py-0.5 rounded-full bg-green-500 text-white">
                      -{discount}%
                    </span>
                  </>
                )}
              </motion.div>
            )}

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start"
            >
              <button
                onClick={handleOrder}
                className="flex items-center justify-center gap-2 px-8 py-4 rounded-2xl font-bold text-lg text-white shadow-xl transition-all hover:scale-105 active:scale-95"
                style={{ background: primary, boxShadow: `0 8px 30px ${primary}55` }}
              >
                {added ? <CheckCircle className="w-5 h-5" /> : <ShoppingCart className="w-5 h-5" />}
                {added ? 'Ajouté !' : data.cta_label || 'Commander maintenant'}
              </button>

              {data.phone && (
                <a
                  href={`tel:${data.phone}`}
                  className={`flex items-center justify-center gap-2 px-8 py-4 rounded-2xl font-bold text-lg border-2 transition-all hover:scale-105 ${isDark ? 'border-white/20 text-white hover:border-white/40' : 'border-gray-300 text-gray-700 hover:border-gray-500'}`}
                >
                  <Phone className="w-5 h-5" />
                  {data.cta2_label || 'Nous appeler'}
                </a>
              )}
            </motion.div>
          </div>

          {/* right: hero image */}
          {heroImage && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="relative flex justify-center"
            >
              <div
                className="absolute inset-0 rounded-3xl blur-3xl opacity-30"
                style={{ background: primary }}
              />
              <img
                src={heroImage}
                alt={productName}
                className="relative z-10 w-full max-w-md rounded-3xl object-cover shadow-2xl"
              />
            </motion.div>
          )}
        </div>
      </section>

      {/* ── STATS ─────────────────────────────────────────────── */}
      {data.stats?.length > 0 && (
        <section className={`py-12 border-y ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <div className="max-w-5xl mx-auto px-4 grid grid-cols-3 gap-4 text-center">
            {data.stats.map((s, i) => (
              <FadeIn key={i} delay={i * 0.1}>
                <div className="text-4xl font-black" style={{ color: primary }}>
                  <Counter target={s.value} suffix={s.suffix} />
                </div>
                <div className={`text-sm mt-1 ${isDark ? 'text-white/60' : 'text-gray-500'}`}>{s.label}</div>
              </FadeIn>
            ))}
          </div>
        </section>
      )}

      {/* ── BENEFITS ──────────────────────────────────────────── */}
      {data.benefits?.length > 0 && (
        <section className="py-20 px-4">
          <div className="max-w-5xl mx-auto">
            <FadeIn>
              <h2 className="text-3xl font-black text-center mb-12">Pourquoi nous choisir ?</h2>
            </FadeIn>
            <div className="grid sm:grid-cols-3 gap-6">
              {data.benefits.map((b, i) => {
                const Icon = ICON_MAP[b.icon] || ShieldCheck;
                return (
                  <FadeIn key={i} delay={i * 0.1}>
                    <div className={`p-6 rounded-2xl border text-center ${cardBg}`}>
                      <div
                        className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
                        style={{ background: `${primary}20` }}
                      >
                        <Icon className="w-7 h-7" style={{ color: primary }} />
                      </div>
                      <h3 className="font-bold text-lg mb-2">{b.title}</h3>
                      <p className={`text-sm ${isDark ? 'text-white/60' : 'text-gray-500'}`}>{b.desc}</p>
                    </div>
                  </FadeIn>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── PRODUCT DETAIL ────────────────────────────────────── */}
      {(productDesc || (data.gallery?.length > 0)) && (
        <section className={`py-20 px-4 ${isDark ? 'bg-white/3' : 'bg-gray-50'}`}>
          <div className="max-w-5xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
            {data.gallery?.length > 0 && (
              <FadeIn>
                <div className="grid grid-cols-2 gap-3">
                  {data.gallery.slice(0, 4).map((url, i) => (
                    <img key={i} src={url} alt="" className="rounded-2xl w-full object-cover aspect-square" />
                  ))}
                </div>
              </FadeIn>
            )}
            <FadeIn delay={0.15}>
              <h2 className="text-3xl font-black mb-4">{productName}</h2>
              <p className={`text-base leading-relaxed ${isDark ? 'text-white/70' : 'text-gray-600'}`}>{productDesc}</p>
              <button
                onClick={handleOrder}
                className="mt-8 flex items-center gap-2 px-8 py-4 rounded-2xl font-bold text-white transition-all hover:scale-105"
                style={{ background: primary }}
              >
                {data.cta_label || 'Commander maintenant'} <ArrowRight className="w-5 h-5" />
              </button>
            </FadeIn>
          </div>
        </section>
      )}

      {/* ── HOW IT WORKS ──────────────────────────────────────── */}
      {data.steps?.length > 0 && (
        <section className="py-20 px-4">
          <div className="max-w-4xl mx-auto">
            <FadeIn>
              <h2 className="text-3xl font-black text-center mb-12">Comment ça marche ?</h2>
            </FadeIn>
            <div className="grid sm:grid-cols-3 gap-8">
              {data.steps.map((s, i) => (
                <FadeIn key={i} delay={i * 0.12}>
                  <div className="text-center">
                    <div
                      className="text-5xl font-black mb-4 opacity-20"
                      style={{ color: primary }}
                    >
                      {s.step}
                    </div>
                    <h3 className="font-bold text-xl mb-2">{s.title}</h3>
                    <p className={`text-sm ${isDark ? 'text-white/60' : 'text-gray-500'}`}>{s.desc}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── TESTIMONIALS ──────────────────────────────────────── */}
      {data.testimonials?.length > 0 && (
        <section className={`py-20 px-4 ${isDark ? 'bg-white/3' : 'bg-gray-50'}`}>
          <div className="max-w-5xl mx-auto">
            <FadeIn>
              <h2 className="text-3xl font-black text-center mb-12">Ce que disent nos clients</h2>
            </FadeIn>
            <div className="grid sm:grid-cols-3 gap-6">
              {data.testimonials.map((t, i) => (
                <FadeIn key={i} delay={i * 0.1}>
                  <div className={`p-6 rounded-2xl border ${cardBg}`}>
                    <div className="flex gap-0.5 mb-3">
                      {Array.from({ length: t.stars }).map((_, j) => (
                        <Star key={j} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                      ))}
                    </div>
                    <p className={`text-sm mb-4 italic ${isDark ? 'text-white/70' : 'text-gray-600'}`}>"{t.text}"</p>
                    <div>
                      <p className="font-bold text-sm">{t.name}</p>
                      <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{t.location}</p>
                    </div>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── FAQ ───────────────────────────────────────────────── */}
      {data.faq?.length > 0 && (
        <section className="py-20 px-4">
          <div className="max-w-2xl mx-auto">
            <FadeIn>
              <h2 className="text-3xl font-black text-center mb-10">Questions fréquentes</h2>
            </FadeIn>
            <div className="space-y-3">
              {data.faq.map((item, i) => (
                <FadeIn key={i} delay={i * 0.05}>
                  <div className={`rounded-2xl border overflow-hidden ${cardBg}`}>
                    <button
                      onClick={() => setOpenFaq(openFaq === i ? null : i)}
                      className="w-full flex items-center justify-between px-6 py-4 text-left font-semibold"
                    >
                      {item.question}
                      {openFaq === i ? <ChevronUp className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />}
                    </button>
                    {openFaq === i && (
                      <div className={`px-6 pb-4 text-sm ${isDark ? 'text-white/70' : 'text-gray-600'}`}>
                        {item.answer}
                      </div>
                    )}
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── FINAL CTA ─────────────────────────────────────────── */}
      <section
        className="py-24 px-4 text-center"
        style={{ background: `linear-gradient(135deg, ${primary}22 0%, transparent 60%)` }}
      >
        <FadeIn>
          <h2 className="text-4xl font-black mb-4">{data.headline}</h2>
          {price !== null && (
            <div className="flex items-center justify-center gap-3 mb-8">
              <span className="text-5xl font-black" style={{ color: primary }}>{formatPrice(price)}</span>
              {comparePrice && comparePrice > price && (
                <span className={`text-2xl line-through ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
                  {formatPrice(comparePrice)}
                </span>
              )}
            </div>
          )}
          <button
            onClick={handleOrder}
            className="inline-flex items-center gap-3 px-10 py-5 rounded-2xl font-bold text-xl text-white shadow-2xl transition-all hover:scale-105"
            style={{ background: primary, boxShadow: `0 12px 40px ${primary}55` }}
          >
            <ShoppingCart className="w-6 h-6" />
            {data.cta_label || 'Commander maintenant'}
          </button>
          {data.phone && (
            <p className={`mt-4 text-sm ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
              Ou appelez-nous : <a href={`tel:${data.phone}`} className="font-bold" style={{ color: primary }}>{data.phone}</a>
            </p>
          )}
        </FadeIn>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────── */}
      <footer className={`py-8 text-center text-xs border-t ${isDark ? 'border-white/10 text-white/30' : 'border-gray-200 text-gray-400'}`}>
        Livraison partout en Algérie · Paiement à la livraison · Retour sous 14 jours
      </footer>
    </div>
  );
}
