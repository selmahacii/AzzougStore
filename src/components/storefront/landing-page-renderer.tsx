import Image from 'next/image';
import {
  ShieldCheck, Truck, RotateCcw, Star, Phone,
  CheckCircle, ArrowRight, ShoppingBag, Check,
} from 'lucide-react';
import { CheckoutForm } from '@/components/storefront/checkout-form';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { optimizeCloudinaryUrl } from '@/lib/image-optimize';

const parseBannerImages = (urlStr: string | null | undefined): string[] => {
  if (!urlStr) return [];
  if (urlStr.startsWith('[')) {
    try {
      const parsed = JSON.parse(urlStr);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (e) {}
  }
  return urlStr.split(',').map(s => s.trim()).filter(Boolean);
};

export interface LpData {
  id: string;
  store_id: string;
  slug: string;
  headline: string;
  subtitle: string;
  badge_text: string;
  cta_label: string;
  cta2_label: string;
  cta_headline?: string | null;
  cta_subtitle?: string | null;
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
  banner_image_url?: string | null;
  offers?: any[];
  product: {
    id: string; name: string; slug: string;
    price: number; compare_price: number | null;
    main_image: string | null; images: string[];
    description: string;
    variants: any[] | null;
    stock: number;
  } | null;
  store?: {
    id: string;
    name: string;
    logo_url: string | null;
    slug: string;
  } | null;
}

export default function LandingPageRenderer({ data, configuredDeliveryFees }: { data: LpData; configuredDeliveryFees?: Record<number, { home: number; office: number }> }) {
  const primary = data.primary_color || '#4b7bec';
  const price = data.price ?? data.product?.price ?? 2900;
  const comparePrice = data.compare_price ?? data.product?.compare_price ?? 3500;
  const discountPercent = comparePrice && price ? Math.round((1 - price / comparePrice) * 100) : 0;

  const heroImage = data.image_url || data.product?.main_image || '/placeholder.png';
  const galleryImages = [
    heroImage,
    ...(data.product?.images || []),
    ...(data.gallery || []),
  ].filter(Boolean);
  const uniqueGallery = Array.from(new Set(galleryImages));

  const banners = parseBannerImages(data.banner_image_url);

  return (
    <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#050505] text-slate-900 dark:text-white font-sans antialiased" dir="rtl">
      
      {/* ── HEADER MINIMALISTE AVEC LOGO & BOUTON D'ACTION ── */}
      <header className="w-full py-3 border-b border-slate-200/80 dark:border-white/5 bg-white/95 dark:bg-black/90 backdrop-blur sticky top-0 z-30 shadow-sm">
        <div className="max-w-[1200px] w-full mx-auto px-4 flex items-center justify-between h-12">
          {/* Logo boutique ou Nom */}
          <div className="flex items-center gap-3">
            {data.store?.logo_url ? (
              <div className="relative h-9 sm:h-10 w-28 sm:w-36">
                <Image
                  src={optimizeCloudinaryUrl(data.store.logo_url, 200)}
                  alt={data.store.name || 'Logo Boutique'}
                  fill
                  sizes="150px"
                  className="object-contain"
                  priority
                />
              </div>
            ) : (
              <span className="text-base sm:text-lg font-black tracking-tight" style={{ color: primary }}>
                {data.store?.name || 'AZ Confort'}
              </span>
            )}
          </div>

          {/* Badge & Quick CTA */}
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-block text-[11px] font-black uppercase text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded-full border border-emerald-200/60 dark:border-emerald-800/40">
              ✓ الدفع عند الاستلام (COD)
            </span>
            <a
              href="#checkout-form"
              className="px-4 py-2 rounded-full text-xs font-black uppercase tracking-wider text-white shadow-sm transition-all hover:brightness-110 active:scale-95"
              style={{ backgroundColor: primary }}
            >
              اطلب الآن
            </a>
          </div>
        </div>
      </header>

      {/* ── CORPS DE LA LANDING PAGE (DOUBLE COLONNE CRO) ── */}
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-10">
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-12 items-start">
          
          {/* COLONNE GAUCHE (Présentation Produit - HTML Pur Server Side) */}
          <div className="flex-1 w-full space-y-6">
            
            {/* Titre & Badges */}
            <div className="space-y-3">
              {data.badge_text && (
                <span
                  className="px-3 py-1 rounded-full text-[11px] sm:text-xs font-black uppercase tracking-wider inline-block shadow-sm"
                  style={{ backgroundColor: `${primary}18`, color: primary }}
                >
                  {data.badge_text}
                </span>
              )}
              
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black leading-tight text-slate-900 dark:text-white">
                {data.headline}
              </h1>

              {data.subtitle && (
                <p className="text-sm sm:text-base font-medium text-slate-600 dark:text-slate-300 leading-relaxed">
                  {data.subtitle}
                </p>
              )}

              {/* Prix en tête */}
              <div className="flex items-center gap-3 pt-1">
                <span className="text-3xl sm:text-4xl font-black" style={{ color: primary }}>
                  {formatPrice(price)}
                </span>
                {comparePrice && comparePrice > price && (
                  <div className="flex items-center gap-2">
                    <span className="text-base line-through text-slate-400 font-medium">
                      {formatPrice(comparePrice)}
                    </span>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded bg-rose-500 text-white uppercase">
                      -{discountPercent}% تخفيض
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Image Hero Principale (Optimisée LCP Next/Image) */}
            <div className="relative w-full aspect-square sm:aspect-[4/3] rounded-3xl overflow-hidden shadow-lg border border-slate-200/60 dark:border-white/10 bg-white dark:bg-white/5">
              <Image
                src={optimizeCloudinaryUrl(heroImage, 800) || heroImage}
                alt={data.product_name || data.headline || 'Coussin de voyage ergonomique'}
                fill
                priority={true}
                fetchPriority="high"
                sizes="(max-width: 768px) 100vw, 600px"
                className="object-cover"
              />
            </div>

            {/* Galerie Secondaire */}
            {uniqueGallery.length > 1 && (
              <div className="grid grid-cols-4 gap-2.5 sm:gap-3">
                {uniqueGallery.slice(0, 4).map((imgUrl, i) => (
                  <div
                    key={i}
                    className="relative aspect-square rounded-2xl overflow-hidden border-2 border-slate-200 dark:border-white/10 shadow-sm bg-white"
                  >
                    <Image
                      src={optimizeCloudinaryUrl(imgUrl, 250) || imgUrl}
                      alt={`Vue ${i + 1}`}
                      fill
                      loading="lazy"
                      sizes="(max-width: 768px) 25vw, 150px"
                      className="object-cover transition-transform hover:scale-105 duration-300"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Avantages & Spécifications (Customisables par l'admin) */}
            {data.benefits && data.benefits.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                {data.benefits.map((b, i) => (
                  <div
                    key={i}
                    className="p-3.5 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] shadow-sm flex items-start gap-3"
                  >
                    <div className="size-8 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${primary}15`, color: primary }}>
                      <Check className="size-4 stroke-[3]" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-slate-900 dark:text-white">{b.title}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{b.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Description Produit détaillée */}
            {(data.product_desc || data.product?.description) && (
              <div className="p-5 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] shadow-sm space-y-2">
                <p className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white/80">
                  مميزات ومواصفات المنتج :
                </p>
                <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                  {data.product_desc || data.product?.description}
                </div>
              </div>
            )}

            {/* Bannières Publicitaires (Stack sans couture) */}
            {banners.length > 0 && (
              <div className="space-y-2 pt-2">
                {banners.map((url, i) => (
                  <div key={i} className="relative w-full aspect-[2/1] sm:aspect-[3/1] rounded-2xl overflow-hidden shadow-md border border-slate-200/60 dark:border-white/10">
                    <Image
                      src={optimizeCloudinaryUrl(url, 1000) || url}
                      alt={`Bannière promo ${i + 1}`}
                      fill
                      loading="lazy"
                      sizes="(max-width: 768px) 100vw, 800px"
                      className="object-cover"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Avis Clients (Testimonials) */}
            {data.testimonials && data.testimonials.length > 0 && (
              <div className="pt-4 space-y-3">
                <h2 className="text-lg font-black text-slate-900 dark:text-white">
                  آراء وتجارب الزبائن :
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {data.testimonials.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] shadow-sm space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex gap-0.5">
                          {Array.from({ length: item.stars || 5 }).map((_, s) => (
                            <Star key={s} className="size-3.5 fill-amber-400 text-amber-400" />
                          ))}
                        </div>
                        <span className="text-[10px] font-bold text-slate-400">{item.location}</span>
                      </div>
                      <p className="text-xs text-slate-700 dark:text-slate-300 italic leading-relaxed">
                        "{item.text}"
                      </p>
                      <p className="text-[11px] font-black text-slate-900 dark:text-white">
                        {item.name}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* FAQ (Native HTML details/summary - 0 byte JS) */}
            {data.faq && data.faq.length > 0 && (
              <div className="pt-4 space-y-3">
                <h2 className="text-lg font-black text-slate-900 dark:text-white">
                  الأسئلة الشائعة :
                </h2>
                <div className="space-y-2">
                  {data.faq.map((item, idx) => (
                    <details
                      key={idx}
                      className="group rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] p-4 transition-all"
                    >
                      <summary className="cursor-pointer font-black text-xs sm:text-sm list-none flex items-center justify-between select-none text-slate-900 dark:text-white">
                        <span>{item.question}</span>
                        <span className="transition-transform duration-200 group-open:rotate-180 text-slate-400 text-xs">
                          ▼
                        </span>
                      </summary>
                      <div className="mt-2.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed pt-2 border-t border-slate-100 dark:border-white/5">
                        {item.answer}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* COLONNE DROITE : Tunnel de Commande Sticky (Client Island) */}
          <div className="w-full lg:w-[460px] shrink-0 sticky top-20 z-20">
            <div id="checkout-form-container" className="p-5 sm:p-7 rounded-3xl border-2 border-slate-200/80 dark:border-white/10 bg-white dark:bg-[#0A0A0A] shadow-xl">
              <div className="text-center mb-5 pb-3 border-b border-slate-100 dark:border-white/5">
                <p className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                  للطلب، يرجى ملء الاستمارة أسفله
                </p>
                <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  الدفع بعد الاستلام والمعاينة
                </p>
              </div>

              {/* Formulaire Client Island */}
              <CheckoutForm
                isInline={true}
                data={data}
                product={data.product}
                offers={data.offers}
                configuredDeliveryFees={configuredDeliveryFees}
              />
            </div>
          </div>

        </div>
      </main>

      {/* FOOTER */}
      <footer className="mt-16 py-8 text-center text-xs text-slate-400 dark:text-slate-500 border-t border-slate-200 dark:border-white/10">
        <p className="font-bold">
          {data.store?.name || 'AZ Confort'} • الدفع عند الاستلام • توصيل 58 ولاية • {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}
