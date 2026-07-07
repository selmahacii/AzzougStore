import { notFound } from 'next/navigation';
import LandingPageRenderer from '@/components/storefront/landing-page-renderer';

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
  views: number;
  orders: number;
  product: {
    id: string; name: string; slug: string;
    price: number; compare_price: number | null;
    main_image: string | null; images: string[];
    description: string;
  } | null;
}

async function fetchLandingPage(slug: string, storeId: string): Promise<LpData | null> {
  const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8003';
  try {
    const res = await fetch(
      `${backendUrl}/api/v1/landing-pages/slug/${slug}?store_id=${storeId}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}


export default async function LpPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ store?: string; store_id?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8003';

  // Resolve store_id from ?store_id= (UUID) or ?store= (slug)
  let storeId = sp.store_id || '';
  if (!storeId) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/stores`, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        const stores: { id: string; slug: string }[] = json.data ?? json ?? [];
        const storeSlug = sp.store || '';
        const matched = storeSlug ? stores.find((s) => s.slug === storeSlug) : stores[0];
        if (matched) storeId = matched.id;
      }
    } catch { /* ignore */ }
  }

  if (!storeId) return notFound();

  const lp = await fetchLandingPage(slug, storeId);
  if (!lp) return notFound();

  return <LandingPageRenderer data={lp} />;
}
