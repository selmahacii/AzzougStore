'use client';

import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Store as StoreIcon, ChevronRight, ChevronLeft, Check, Globe,
  Sparkles, Zap, Crown, Loader2, X,
  ShoppingCart, Search, ArrowRight, Package,
  Upload, Video, FileImage, Type, Copyright,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api-client';

// ─── TEMPLATE DEFINITIONS ───────────────────────────────────
export const STORE_TEMPLATES = [
  {
    id: 'minimalist',
    name: 'MINIMALIST',
    tagline: 'Boutique épurée — Grille produits & Navigation rapide',
    badge: 'Recommandé',
    badgeColor: '#4b7bec',
    badgeText: '#FFFFFF',
    icon: Sparkles,
    accent: '#111827',
    bg: '#FFFFFF',
    text: '#111827',
    description: 'Layout blanc, aéré et orienté produit. Grille multi-catégories, filtres avancés, panier rapide. Idéal pour toute boutique e-commerce.',
    features: ['Grille produits multi-colonnes', 'Filtres & recherche avancés', 'Hero image/vidéo', 'Navigation rapide', 'Panier slide-out'],
  },
  {
    id: 'landing',
    name: 'LANDING PAGE',
    tagline: 'Page Ads haute-conversion — Hero · Bénéfices · Preuves · CTA',
    badge: 'Conversion',
    badgeColor: '#e84393',
    badgeText: '#FFFFFF',
    icon: Zap,
    accent: '#e84393',
    bg: '#0A0A0A',
    text: '#FFFFFF',
    description: 'Structure one-page optimisée pour les campagnes publicitaires. Hero impactant, section bénéfices, preuves sociales et blocs CTA multiples.',
    features: ['Hero plein écran image/vidéo', 'Section bénéfices produit', 'Avis clients (social proof)', 'CTA multiples sticky', 'Mobile-first & ultra-rapide'],
  },
];

// ─── MINI TEMPLATE PREVIEWS ──────────────────────────────────
interface PreviewProps { color: string; logoUrl?: string; bannerUrl?: string; bannerIsVideo?: boolean; }

function AthleticPreview({ color, logoUrl, bannerUrl, bannerIsVideo }: PreviewProps) {
  return (
    <div className="bg-[#0A0A0A] rounded-lg overflow-hidden w-full h-full select-none">
      {/* Nav */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        {logoUrl ? (
          <img src={logoUrl} alt="logo" className="h-4 max-w-[60px] object-contain" style={{ filter: 'brightness(0) invert(1)' }} />
        ) : (
        <div className="text-[8px] font-black text-white tracking-widest uppercase">SPORT<span style={{ color }}>X</span></div>
        )}
        <div className="flex gap-2">
          {['SHOP','DROPS','ABOUT'].map(n => <span key={n} className="text-[5px] font-black text-white/40 uppercase tracking-widest">{n}</span>)}
        </div>
        <div className="flex gap-1.5">
          <Search className="size-2.5 text-white/40" />
          <ShoppingCart className="size-2.5 text-white/40" />
        </div>
      </div>
      {/* Hero */}
      <div className="relative px-3 py-4 overflow-hidden" style={{ background: `linear-gradient(135deg, #0A0A0A 60%, ${color}20)` }}>
        {bannerUrl && !bannerIsVideo && (
          <img src={bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-20" />
        )}
        {bannerUrl && bannerIsVideo && (
          <video src={bannerUrl} className="absolute inset-0 w-full h-full object-cover opacity-20" muted loop autoPlay playsInline />
        )}
        <div className="relative flex items-start justify-between">
          <div>
            <div className="text-[6px] font-black uppercase tracking-[0.3em] mb-1" style={{ color }}>NEW DROP 2026</div>
            <div className="text-[12px] font-black text-white leading-tight uppercase tracking-tight">PUSH<br/>YOUR<br/>LIMITS</div>
            <div className="mt-2 px-3 py-1 text-[5px] font-black uppercase tracking-widest rounded-full text-[#0A0A0A]" style={{ backgroundColor: color, display: 'inline-block' }}>SHOP NOW →</div>
          </div>
          <div className="size-16 rounded-xl flex items-center justify-center" style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
            <Package className="size-6" style={{ color }} />
          </div>
        </div>
      </div>
      {/* Grid */}
      <div className="px-3 pb-3">
        <div className="text-[5px] font-black text-white/30 uppercase tracking-widest mb-2">BEST SELLERS</div>
        <div className="grid grid-cols-2 gap-1.5">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white/5 rounded-lg p-2 border border-white/5">
              <div className="aspect-square bg-white/10 rounded-md mb-1.5 flex items-center justify-center">
                <Package className="size-4 text-white/20" />
              </div>
              <div className="text-[5px] font-black text-white/60 truncate uppercase">PRODUIT {i}</div>
              <div className="text-[6px] font-black mt-0.5" style={{ color }}>4 200 DA</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CleanPreview({ color, logoUrl, bannerUrl, bannerIsVideo }: PreviewProps) {
  return (
    <div className="bg-white rounded-lg overflow-hidden w-full h-full select-none">
      {/* Announcement */}
      <div className="py-1 px-3 text-center text-[5px] font-bold text-white" style={{ backgroundColor: color }}>
        Livraison gratuite dès 5 000 DA
      </div>
      {/* Nav */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
        <button className="size-4 flex flex-col gap-0.5 justify-center">
          {[1,2,3].map(i => <div key={i} className="h-px bg-slate-600 w-3" />)}
        </button>
        {logoUrl ? (
          <img src={logoUrl} alt="logo" className="h-4 max-w-[60px] object-contain" />
        ) : (
          <div className="text-[9px] font-black text-slate-900 tracking-tight">La Maison</div>
        )}
        <ShoppingCart className="size-2.5 text-slate-600" />
      </div>
      {/* Hero */}
      <div className="relative flex items-center gap-3 p-3">
        <div className="flex-1">
          <div className="text-[5px] text-slate-400 font-medium mb-1 uppercase tracking-widest">Collection Printemps</div>
          <div className="text-[11px] font-black text-slate-900 leading-tight">Découvrez<br/>l'essentiel</div>
          <div className="mt-2">
            <div className="inline-flex items-center gap-1 border-b border-slate-900 pb-0.5">
              <span className="text-[5px] font-black text-slate-900 uppercase tracking-wider">Voir la collection</span>
              <ArrowRight className="size-2 text-slate-900" />
            </div>
          </div>
        </div>
        <div className="w-20 aspect-[3/4] bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center">
          {bannerUrl && !bannerIsVideo ? (
            <img src={bannerUrl} alt="" className="w-full h-full object-cover" />
          ) : bannerUrl && bannerIsVideo ? (
            <video src={bannerUrl} className="w-full h-full object-cover" muted loop autoPlay playsInline />
          ) : (
            <Package className="size-6 text-slate-300" />
          )}
        </div>
      </div>
      {/* Products */}
      <div className="px-3 pb-3 border-t border-slate-100 pt-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[6px] font-black text-slate-900 uppercase tracking-wider">Meilleures ventes</span>
          <span className="text-[5px] text-slate-400 font-medium underline">Voir tout</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {[1,2,3].map(i => (
            <div key={i}>
              <div className="aspect-square bg-slate-100 rounded-md mb-1 flex items-center justify-center">
                <Package className="size-3 text-slate-300" />
              </div>
              <div className="text-[4.5px] font-medium text-slate-700 truncate">Article {i}</div>
              <div className="text-[5px] font-bold text-slate-900">3 500 DA</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LuxePreview({ color, logoUrl, bannerUrl, bannerIsVideo }: PreviewProps) {
  return (
    <div className="bg-[#0C0F1A] rounded-lg overflow-hidden w-full h-full select-none">
      {/* Nav */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        {logoUrl ? (
          <img src={logoUrl} alt="logo" className="h-4 max-w-[60px] object-contain" style={{ filter: 'brightness(0) invert(1)' }} />
        ) : (
        <div className="text-[8px] font-thin text-white tracking-[0.4em] uppercase">MAISON</div>
        )}
        <div className="flex gap-2">
          {['Collection','Univers','Contact'].map(n => <span key={n} className="text-[5px] font-light text-white/40 tracking-widest">{n}</span>)}
        </div>
        <div className="flex gap-1.5">
          <Search className="size-2.5 text-white/30" />
          <ShoppingCart className="size-2.5 text-white/30" />
        </div>
      </div>
      {/* Hero — fullscreen feel */}
      <div className="relative px-4 py-5 overflow-hidden" style={{ background: `linear-gradient(160deg, #0C0F1A 40%, ${color}10 100%)` }}>
        {bannerUrl && !bannerIsVideo && (
          <img src={bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-15" />
        )}
        {bannerUrl && bannerIsVideo && (
          <video src={bannerUrl} className="absolute inset-0 w-full h-full object-cover opacity-15" muted loop autoPlay playsInline />
        )}
        <div className="relative">
          <div className="text-[5px] font-light uppercase tracking-[0.5em] mb-3" style={{ color }}>Saison 2026</div>
          <div className="text-[13px] font-thin text-white leading-tight tracking-[0.05em] mb-1">L'ART</div>
          <div className="text-[13px] font-thin text-white leading-tight tracking-[0.05em]">DU RARE</div>
          <div className="mt-3 flex items-center gap-2">
            <div className="h-px w-6" style={{ backgroundColor: color }} />
            <span className="text-[5px] font-light text-white/40 tracking-[0.3em] uppercase">Découvrir</span>
          </div>
          {/* Decorative */}
          <div className="absolute right-0 top-0 size-14 rounded-full border flex items-center justify-center" style={{ borderColor: `${color}30` }}>
            <div className="size-10 rounded-full flex items-center justify-center" style={{ backgroundColor: `${color}15` }}>
              <Crown className="size-4" style={{ color }} />
            </div>
          </div>
        </div>
      </div>
      {/* Products horizontal */}
      <div className="px-3 pb-3">
        <div className="text-[4.5px] font-light uppercase tracking-[0.4em] mb-2" style={{ color }}>Pièces Exclusives</div>
        <div className="flex gap-2 overflow-hidden">
          {[1,2,3].map(i => (
            <div key={i} className="flex-shrink-0 w-16">
              <div className="aspect-[3/4] rounded-md mb-1 flex items-center justify-center border" style={{ backgroundColor: `${color}08`, borderColor: `${color}20` }}>
                <Package className="size-3" style={{ color: `${color}60` }} />
              </div>
              <div className="text-[4.5px] font-light text-white/40 uppercase tracking-widest truncate">Pièce {i}</div>
              <div className="text-[5px] font-light mt-0.5" style={{ color }}>{(i * 8500).toLocaleString()} DA</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MinimalistPreview({ color, logoUrl, bannerUrl, bannerIsVideo }: PreviewProps) {
  return (
    <div className="bg-white w-full h-full select-none flex flex-col overflow-hidden rounded-lg text-left">
      <div className="shrink-0 py-1 px-3 text-center text-[4px] font-black tracking-widest text-white" style={{ backgroundColor: color }}>
        Livraison express · Paiement à la livraison · Retour 14j
      </div>
      <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-gray-100">
        {logoUrl
          ? <img src={logoUrl} alt="" className="h-3 max-w-[48px] object-contain"/>
          : <div className="text-[7px] font-black text-gray-900 tracking-tight">BOUTIQUE</div>
        }
        <div className="flex gap-2">
          {['Catalogue','Promos'].map(n => <span key={n} className="text-[4px] font-bold text-gray-400">{n}</span>)}
        </div>
        <div className="flex items-center gap-1">
          <Search className="size-2 text-gray-400"/>
          <ShoppingCart className="size-2 text-gray-400"/>
        </div>
      </div>
      <div className="shrink-0 grid grid-cols-2 border-b border-gray-100">
        <div className="flex flex-col justify-center px-3 py-3 gap-1">
          <div className="text-[4px] font-black uppercase tracking-[0.3em]" style={{ color }}>Nouvelle collection</div>
          <div className="text-[9px] font-black text-gray-900 leading-tight tracking-tight">L'essentiel<br/>du style</div>
          <div className="text-[3.5px] text-gray-400 mt-0.5 leading-relaxed">Conçu pour votre quotidien.</div>
          <div className="flex gap-1 mt-1.5">
            <div className="px-2 py-0.5 text-[4px] font-black text-white" style={{ backgroundColor: color }}>Voir →</div>
            <div className="px-2 py-0.5 text-[4px] font-black text-gray-400 border border-gray-200">Best-sellers</div>
          </div>
        </div>
        <div className="relative overflow-hidden bg-gray-100" style={{ aspectRatio: '1/1.1' }}>
          {bannerUrl && !bannerIsVideo
            ? <img src={bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover"/>
            : bannerUrl && bannerIsVideo
              ? <video src={bannerUrl} className="absolute inset-0 w-full h-full object-cover" muted loop autoPlay playsInline/>
              : <div className="absolute inset-0 flex items-center justify-center"><Package className="size-4 text-gray-300"/></div>
          }
        </div>
      </div>
      <div className="flex-1 px-3 py-2 min-h-0 overflow-hidden">
        <div className="text-[3.5px] font-black uppercase tracking-[0.4em] mb-1.5" style={{ color }}>Best-sellers</div>
        <div className="grid grid-cols-3 gap-1.5">
          {[1,2,3,4,5,6].map(i => (
            <div key={i}>
              <div className="aspect-[3/4] bg-gray-100 mb-0.5 flex items-center justify-center">
                <Package className="size-2 text-gray-300"/>
              </div>
              <div className="text-[3.5px] text-gray-600 truncate">Article {i}</div>
              <div className="text-[4px] font-black mt-0.5" style={{ color }}>{(i * 1200 + 2900).toLocaleString()} DA</div>
            </div>
          ))}
        </div>
      </div>
      <div className="shrink-0 grid grid-cols-3 border-t border-gray-100">
        {[['🚚','Express'],['✅','Sécurisé'],['🔄','14j']].map(([icon, label]) => (
          <div key={label} className="flex flex-col items-center py-1.5 gap-0.5 border-r border-gray-100 last:border-0">
            <span className="text-[7px]">{icon}</span>
            <span className="text-[3px] font-bold text-gray-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LandingPreview({ color, logoUrl, bannerUrl, bannerIsVideo }: PreviewProps) {
  return (
    <div className="bg-[#080808] w-full h-full select-none flex flex-col overflow-hidden rounded-lg">
      <div className="shrink-0 py-1 px-3 text-center text-[3.5px] font-black uppercase tracking-[0.3em] border-b border-white/5" style={{ color }}>
        ✦ Offre limitée · Livraison Algérie ✦
      </div>
      <div className="relative flex-1 flex flex-col items-center justify-center overflow-hidden px-4 py-3 min-h-0">
        {bannerUrl && !bannerIsVideo && (
          <img src={bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.18]"/>
        )}
        {bannerUrl && bannerIsVideo && (
          <video src={bannerUrl} className="absolute inset-0 w-full h-full object-cover opacity-[0.18]" muted loop autoPlay playsInline/>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-[#080808]/60 via-transparent to-[#080808] pointer-events-none"/>
        <div className="relative z-10 text-center flex flex-col items-center gap-1.5 w-full">
          <div className="px-2 py-0.5 text-[3.5px] font-black uppercase tracking-[0.3em] border" style={{ borderColor: `${color}40`, color }}>
            ⚡ Offre limitée
          </div>
          <div className="text-[11px] font-black text-white leading-[0.92] uppercase tracking-tight">
            LE PRODUIT<br/><span style={{ color }}>QUI CHANGE TOUT</span>
          </div>
          <div className="text-[3.5px] text-white/40 max-w-[100px] text-center leading-relaxed">Qualité premium · Résultats garantis</div>
          <div className="text-[8px] font-black" style={{ color }}>2 990 DA</div>
          <div className="flex flex-col gap-0.5 w-full mt-0.5">
            <div className="py-1 text-[4.5px] font-black text-black text-center uppercase" style={{ backgroundColor: color }}>
              Commander →
            </div>
            <div className="py-0.5 text-[3.5px] font-black text-white/25 text-center border border-white/10">
              Ajouter au panier
            </div>
          </div>
        </div>
      </div>
      <div className="shrink-0 grid grid-cols-3 border-t border-white/5">
        {[['🚚','48h'],['💳','Livraison'],['↩️','14j']].map(([icon, label]) => (
          <div key={label} className="flex flex-col items-center py-1.5 gap-0.5 border-r border-white/5 last:border-0">
            <span className="text-[6px]">{icon}</span>
            <span className="text-[3px] font-bold text-white/30">{label}</span>
          </div>
        ))}
      </div>
      <div className="shrink-0 px-3 py-1.5 border-t border-white/5 flex flex-col gap-1">
        <div className="text-[3px] font-black uppercase tracking-widest text-white/20 mb-0.5">Avis vérifiés</div>
        {[1,2].map(i => (
          <div key={i} className="flex items-start gap-1 p-1 bg-white/5">
            <div className="size-3 rounded-full bg-white/10 shrink-0 flex items-center justify-center text-[4px] text-white/40">Y</div>
            <div>
              <div className="flex gap-0.5">{[1,2,3,4,5].map(s => <span key={s} className="text-[4px]" style={{ color }}>★</span>)}</div>
              <div className="text-[3px] text-white/35 mt-0.5">Produit incroyable, je recommande !</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TemplatePreview({ templateId, color, logoUrl, bannerUrl, bannerIsVideo }: PreviewProps & { templateId: string }) {
  if (templateId === 'landing') return <LandingPreview color={color} logoUrl={logoUrl} bannerUrl={bannerUrl} bannerIsVideo={bannerIsVideo} />;
  return <MinimalistPreview color={color} logoUrl={logoUrl} bannerUrl={bannerUrl} bannerIsVideo={bannerIsVideo} />;
}

// ─── MEDIA UPLOAD HELPER ─────────────────────────────────────
async function uploadMedia(file: File, endpoint: 'image' | 'media'): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/v1/upload/${endpoint}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Erreur upload' }));
    throw new Error(err.detail ?? 'Erreur upload');
  }
  const data = await res.json();
  return data.url as string;
}

// ─── STEP COMPONENTS ────────────────────────────────────────
interface FormData {
  name: string;
  slug: string;
  description: string;
  logo_url: string;
  banner_url: string;
  banner_is_video: boolean;
  template_id: string;
  primaryColor: string;
  accentColor: string;
  domain: string;
  facebook: string;
  instagram: string;
  tiktok: string;
  phone: string;
  email: string;
  address: string;
  footer_tagline: string;
  footer_copyright: string;
  hero_layout: 'full' | 'side';
  hero_headline: string;
  hero_subtitle: string;
  hero_cta: string;
  hero_font: 'bold' | 'normal' | 'light' | 'serif';
}

const DEFAULT_FORM: FormData = {
  name: '',
  slug: '',
  description: '',
  logo_url: '',
  banner_url: '',
  banner_is_video: false,
  template_id: 'minimalist',
  primaryColor: '#4b7bec',
  accentColor: '#3867d6',
  domain: '',
  facebook: '',
  instagram: '',
  tiktok: '',
  phone: '',
  email: '',
  address: '',
  footer_tagline: '',
  footer_copyright: '',
  hero_layout: 'side',
  hero_headline: '',
  hero_subtitle: '',
  hero_cta: '',
  hero_font: 'bold',
};

// ─── MAIN WIZARD ─────────────────────────────────────────────
interface StoreWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const STEPS = ['Template', 'Identité', 'Couleurs', 'Aperçu & Lancer'];

export function StoreWizard({ open, onOpenChange, onSuccess }: StoreWizardProps) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAppStore();
  const qc = useQueryClient();

  const handleLogoUpload = async (file: File) => {
    setUploadingLogo(true);
    try {
      const url = await uploadMedia(file, 'image');
      setForm(f => ({ ...f, logo_url: url }));
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur upload logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleBannerUpload = async (file: File) => {
    setUploadingBanner(true);
    try {
      const isVideo = file.type.startsWith('video/');
      const url = await uploadMedia(file, 'media');
      setForm(f => ({ ...f, banner_url: url, banner_is_video: isVideo }));
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur upload bannière');
    } finally {
      setUploadingBanner(false);
    }
  };

  const selectedTemplate = STORE_TEMPLATES.find(t => t.id === form.template_id) ?? STORE_TEMPLATES[1];

  const mutation = useMutation({
    mutationFn: (data: any) => apiFetch('/api/v1/stores', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stores'] });
      toast.success('Boutique déployée avec succès !', { description: `/${form.slug} est en ligne.` });
      onOpenChange(false);
      setStep(0);
      setForm(DEFAULT_FORM);
      onSuccess?.();
    },
    onError: (e: any) => toast.error(e.message ?? 'Erreur lors de la création'),
  });

  const handleCreate = () => {
    if (!form.name || !form.slug) return toast.error('Nom et slug requis');
    mutation.mutate({
      name: form.name,
      slug: form.slug,
      description: form.description,
      logo_url: form.logo_url || null,
      banner_url: form.banner_url || null,
      domain: form.domain || `${form.slug}.azzougshop.dz`,
      owner_id: user?.id,
      theme_config: {
        templateId: form.template_id,
        primaryColor: form.primaryColor,
        accentColor: form.accentColor,
        fontFamily: form.template_id === 'luxe' ? 'Playfair Display' : 'Inter',
        borderRadius: form.template_id === 'luxe' ? '4px' : form.template_id === 'landing' ? '8px' : '12px',
        darkMode: form.template_id === 'landing' || form.template_id === 'athletic' || form.template_id === 'luxe',
        bannerIsVideo: form.banner_is_video,
        heroLayout: form.hero_layout,
        heroHeadline: form.hero_headline || null,
        heroSubtitle: form.hero_subtitle || null,
        heroCta: form.hero_cta || null,
        heroFont: form.hero_font,
        footerTagline: form.footer_tagline || null,
        footerCopyright: form.footer_copyright || `© ${new Date().getFullYear()} ${form.name}. Tous droits réservés.`,
        contact: {
          phone: form.phone,
          email: form.email,
          address: form.address,
        },
      },
      social_links: {
        facebook: form.facebook,
        instagram: form.instagram,
        tiktok: form.tiktok,
      },
      contact: {
        phone: form.phone,
        email: form.email,
        address: form.address,
      },
    });
  };

  const slugify = (s: string) =>
    s.toLowerCase()
      .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e')
      .replace(/[ìíîï]/g, 'i').replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u')
      .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();

  const canProceed = step === 0 ? true : step === 1 ? !!(form.name && form.slug) : true;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setStep(0); setForm(DEFAULT_FORM); } onOpenChange(o); }}>
      <DialogContent className="max-w-[1400px] w-[98vw] h-[94vh] p-0 overflow-hidden rounded-[40px] border-none shadow-2xl flex flex-col gap-0">
        <DialogTitle className="sr-only">Créer une nouvelle boutique</DialogTitle>

        {/* ── TOP BAR ── */}
        <div className="flex items-center gap-4 px-8 py-5 border-b border-slate-100 bg-white shrink-0">
          <div className="size-10 rounded-2xl flex items-center justify-center text-white shadow-lg" style={{ backgroundColor: selectedTemplate.accent }}>
            <StoreIcon className="size-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-black text-slate-900 uppercase tracking-tight">Créer une nouvelle boutique</h2>
            <div className="flex items-center gap-1 mt-1">
              {STEPS.map((s, i) => (
                <div key={i} className="flex items-center gap-1">
                  <button
                    onClick={() => i <= step && setStep(i)}
                    className={cn(
                      "text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md transition-all",
                      i === step ? "text-white" : i < step ? "text-slate-600 hover:bg-slate-100" : "text-slate-300 cursor-default"
                    )}
                    style={i === step ? { backgroundColor: selectedTemplate.accent, color: selectedTemplate.badgeText } : {}}
                  >
                    {i < step ? <Check className="size-3 inline mr-0.5" /> : null}{s}
                  </button>
                  {i < STEPS.length - 1 && <ChevronRight className="size-3 text-slate-200" />}
                </div>
              ))}
            </div>
          </div>
          <button onClick={() => onOpenChange(false)} className="size-9 rounded-xl border border-slate-100 flex items-center justify-center text-slate-400 hover:bg-slate-50 transition-all">
            <X className="size-4" />
          </button>
        </div>

        {/* ── BODY ── */}
        <div className="flex-1 flex overflow-hidden">

          {/* LEFT PANEL — form */}
          <div className="w-[420px] shrink-0 flex flex-col border-r border-slate-100 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-8 space-y-6">

              {/* STEP 0 — Template */}
              {step === 0 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h3 className="text-base font-black text-slate-900 mb-1">Choisissez votre template</h3>
                    <p className="text-sm text-slate-400 font-medium">Chaque template est un univers visuel complet. Vous pourrez personnaliser les couleurs à l'étape suivante.</p>
                  </div>
                  <div className="space-y-3">
                    {STORE_TEMPLATES.map(t => {
                      const Icon = t.icon;
                      const active = form.template_id === t.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => setForm(f => ({ ...f, template_id: t.id, primaryColor: t.accent }))}
                          className={cn("w-full text-left p-4 rounded-2xl border-2 transition-all", active ? "shadow-lg" : "border-slate-100 bg-white hover:border-slate-200")}
                          style={active ? { borderColor: t.accent, backgroundColor: `${t.bg}08` } : {}}
                        >
                          <div className="flex items-start gap-3">
                            <div className="size-11 rounded-xl flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: t.bg }}>
                              <Icon className="size-5" style={{ color: t.accent }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-black text-slate-900">{t.name}</span>
                                <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ backgroundColor: t.badgeColor, color: t.badgeText }}>{t.badge}</span>
                              </div>
                              <p className="text-[10px] text-slate-400 font-medium leading-snug">{t.tagline}</p>
                              <div className="flex flex-wrap gap-1 mt-2">
                                {t.features.slice(0, 3).map(f => (
                                  <span key={f} className="text-[8px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 uppercase tracking-wider">{f}</span>
                                ))}
                              </div>
                            </div>
                            {active && <div className="size-5 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: t.accent }}><Check className="size-3 text-white" /></div>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* STEP 1 — Identité */}
              {step === 1 && (
                <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h3 className="text-base font-black text-slate-900 mb-1">Identité de votre boutique</h3>
                    <p className="text-sm text-slate-400 font-medium">Ces informations définissent votre marque. Prenez le temps d'être précis.</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nom de la boutique *</label>
                    <Input
                      placeholder="Ex: Azzoug Sport, La Belle Maison..."
                      value={form.name}
                      onChange={e => {
                        const name = e.target.value;
                        setForm(f => ({ ...f, name, slug: f.slug || slugify(name) }));
                      }}
                      className="h-12 rounded-2xl border-slate-100 bg-slate-50/50 text-sm font-bold px-5 focus-visible:ring-2"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Slug URL *</label>
                    <div className="flex overflow-hidden rounded-2xl border border-slate-100">
                      <span className="px-4 bg-slate-100 flex items-center text-[11px] font-bold text-slate-400 border-r border-slate-100 whitespace-nowrap">azzougshop.dz/</span>
                      <Input
                        placeholder="ma-boutique"
                        value={form.slug}
                        onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                        className="h-12 border-0 font-mono text-sm bg-white rounded-none flex-1 focus-visible:ring-0"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Domaine personnalisé</label>
                    <div className="flex overflow-hidden rounded-2xl border border-slate-100">
                      <span className="px-4 bg-slate-100 flex items-center text-[11px] font-bold text-slate-400 border-r border-slate-100">https://</span>
                      <Input
                        placeholder="maboutique.dz (optionnel)"
                        value={form.domain}
                        onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}
                        className="h-12 border-0 font-mono text-sm bg-white rounded-none flex-1 focus-visible:ring-0"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 ml-1">En dev, un domaine test sera auto-généré: <span className="font-mono font-bold">{form.slug || 'slug'}.azzougshop.dz</span></p>
                  </div>

                  {/* Logo upload */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Logo de la boutique</label>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); }}
                    />
                    {form.logo_url ? (
                      <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="size-16 rounded-xl border border-slate-200 bg-white overflow-hidden shrink-0">
                          <img src={form.logo_url} alt="logo" className="size-full object-contain" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-700 truncate">Logo uploadé</p>
                          <p className="text-[10px] text-slate-400 truncate font-mono">{form.logo_url.split('/').pop()}</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => logoInputRef.current?.click()}
                            className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider border border-slate-200 rounded-xl hover:bg-slate-100 transition-all"
                          >
                            Changer
                          </button>
                          <button
                            onClick={() => setForm(f => ({ ...f, logo_url: '' }))}
                            className="size-7 rounded-xl border border-rose-100 hover:bg-rose-50 transition-all flex items-center justify-center text-rose-400"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => logoInputRef.current?.click()}
                        disabled={uploadingLogo}
                        className="w-full h-20 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50 transition-all flex flex-col items-center justify-center gap-1.5 group"
                      >
                        {uploadingLogo ? (
                          <Loader2 className="size-5 animate-spin text-slate-400" />
                        ) : (
                          <>
                            <div className="size-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center shadow-sm group-hover:shadow-md transition-all">
                              <Upload className="size-4 text-slate-400" />
                            </div>
                            <span className="text-[10px] font-bold text-slate-400">Cliquer pour uploader le logo</span>
                            <span className="text-[9px] text-slate-300">PNG, JPG, WebP · max 10 MB</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Banner / Hero media */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Image ou vidéo Hero (bannière)</label>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${selectedTemplate.accent}20`, color: selectedTemplate.accent }}>Grande section</span>
                    </div>
                    <input
                      ref={bannerInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleBannerUpload(f); }}
                    />
                    {form.banner_url ? (
                      <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-900">
                        {form.banner_is_video ? (
                          <video src={form.banner_url} className="w-full h-36 object-cover" muted loop autoPlay />
                        ) : (
                          <img src={form.banner_url} alt="banner" className="w-full h-36 object-cover" />
                        )}
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-3 opacity-0 hover:opacity-100 transition-all">
                          <button
                            onClick={() => bannerInputRef.current?.click()}
                            className="px-4 py-2 text-[10px] font-black uppercase tracking-wider bg-white text-slate-900 rounded-xl hover:bg-slate-100 transition-all"
                          >
                            Changer
                          </button>
                          <button
                            onClick={() => setForm(f => ({ ...f, banner_url: '', banner_is_video: false }))}
                            className="size-8 rounded-xl bg-rose-500 text-white flex items-center justify-center"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                        <div className="absolute top-2 right-2">
                          <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-black/60 text-white text-[9px] font-bold">
                            {form.banner_is_video ? <Video className="size-2.5" /> : <FileImage className="size-2.5" />}
                            {form.banner_is_video ? 'Vidéo' : 'Image'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => bannerInputRef.current?.click()}
                        disabled={uploadingBanner}
                        className="w-full h-32 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50 transition-all flex flex-col items-center justify-center gap-2 group"
                      >
                        {uploadingBanner ? (
                          <Loader2 className="size-5 animate-spin text-slate-400" />
                        ) : (
                          <>
                            <div className="flex gap-2">
                              <div className="size-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center shadow-sm group-hover:shadow-md transition-all">
                                <FileImage className="size-4 text-slate-400" />
                              </div>
                              <div className="size-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center shadow-sm group-hover:shadow-md transition-all">
                                <Video className="size-4 text-slate-400" />
                              </div>
                            </div>
                            <span className="text-[10px] font-bold text-slate-400">Photo ou vidéo hero</span>
                            <span className="text-[9px] text-slate-300">JPG, PNG, MP4, WebM · Image 10 MB · Vidéo 100 MB</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Description</label>
                    <textarea
                      value={form.description}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="Décrivez votre boutique en 2-3 phrases..."
                      className="w-full min-h-[80px] p-4 border border-slate-100 rounded-2xl bg-slate-50/50 text-sm font-medium resize-none outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
                    />
                  </div>

                  {/* Contact */}
                  <div className="space-y-3 pt-2 border-t border-slate-100">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Contact & Réseaux</label>
                    <div className="grid grid-cols-2 gap-3">
                      <Input placeholder="Téléphone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="h-11 rounded-xl border-slate-100 bg-slate-50/50 text-sm" />
                      <Input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="h-11 rounded-xl border-slate-100 bg-slate-50/50 text-sm" />
                    </div>
                    <Input placeholder="Adresse physique" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="h-11 rounded-xl border-slate-100 bg-slate-50/50 text-sm" />
                    <div className="grid grid-cols-3 gap-3">
                      <Input placeholder="Facebook URL" value={form.facebook} onChange={e => setForm(f => ({ ...f, facebook: e.target.value }))} className="h-10 rounded-xl border-slate-100 bg-slate-50/50 text-xs" />
                      <Input placeholder="Instagram @" value={form.instagram} onChange={e => setForm(f => ({ ...f, instagram: e.target.value }))} className="h-10 rounded-xl border-slate-100 bg-slate-50/50 text-xs" />
                      <Input placeholder="TikTok @" value={form.tiktok} onChange={e => setForm(f => ({ ...f, tiktok: e.target.value }))} className="h-10 rounded-xl border-slate-100 bg-slate-50/50 text-xs" />
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="space-y-3 pt-2 border-t border-slate-100">
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pied de page (Footer)</label>
                    </div>
                    <div className="space-y-2">
                      <div className="relative">
                        <Type className="absolute left-3.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-300" />
                        <Input
                          placeholder="Slogan ou accroche du footer..."
                          value={form.footer_tagline}
                          onChange={e => setForm(f => ({ ...f, footer_tagline: e.target.value }))}
                          className="h-11 rounded-xl border-slate-100 bg-slate-50/50 text-sm pl-9"
                        />
                      </div>
                      <div className="relative">
                        <Copyright className="absolute left-3.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-300" />
                        <Input
                          placeholder={`© ${new Date().getFullYear()} ${form.name || 'Votre boutique'}. Tous droits réservés.`}
                          value={form.footer_copyright}
                          onChange={e => setForm(f => ({ ...f, footer_copyright: e.target.value }))}
                          className="h-11 rounded-xl border-slate-100 bg-slate-50/50 text-sm pl-9"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2 — Couleurs */}
              {step === 2 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h3 className="text-base font-black text-slate-900 mb-1">Identité visuelle</h3>
                    <p className="text-sm text-slate-400 font-medium">Affinez les couleurs. L'aperçu se met à jour en temps réel.</p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Couleur principale</label>
                      <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="relative shrink-0">
                          <div className="size-14 rounded-xl border-4 border-white shadow-lg cursor-pointer" style={{ backgroundColor: form.primaryColor }} />
                          <input
                            type="color"
                            value={form.primaryColor}
                            onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                        </div>
                        <div className="flex-1">
                          <div className="font-mono text-sm font-bold text-slate-700 mb-1">{form.primaryColor.toUpperCase()}</div>
                          <div className="flex gap-1">
                            {[1, 0.75, 0.5, 0.25, 0.1].map((op, i) => (
                              <div key={i} className="h-5 flex-1 rounded-md" style={{ backgroundColor: form.primaryColor, opacity: op }} />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Couleur secondaire</label>
                      <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="relative shrink-0">
                          <div className="size-14 rounded-xl border-4 border-white shadow-lg cursor-pointer" style={{ backgroundColor: form.accentColor }} />
                          <input
                            type="color"
                            value={form.accentColor}
                            onChange={e => setForm(f => ({ ...f, accentColor: e.target.value }))}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                        </div>
                        <div className="flex-1">
                          <div className="font-mono text-sm font-bold text-slate-700 mb-1">{form.accentColor.toUpperCase()}</div>
                          <div className="flex gap-1">
                            {[1, 0.75, 0.5, 0.25, 0.1].map((op, i) => (
                              <div key={i} className="h-5 flex-1 rounded-md" style={{ backgroundColor: form.accentColor, opacity: op }} />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Quick presets */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Palettes rapides</label>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { label: 'Indigo', p: '#4b7bec', a: '#3867d6' },
                          { label: 'Lime', p: '#C5F135', a: '#a3cc1a' },
                          { label: 'Gold', p: '#C9A84C', a: '#a87c2a' },
                          { label: 'Rouge', p: '#eb4d4b', a: '#c0392b' },
                          { label: 'Émeraude', p: '#20bf6b', a: '#00a854' },
                          { label: 'Violet', p: '#6C5CE7', a: '#5641c2' },
                          { label: 'Coral', p: '#ff6b6b', a: '#ee5a24' },
                          { label: 'Navy', p: '#0C0F1A', a: '#1a1f35' },
                        ].map(preset => (
                          <button
                            key={preset.label}
                            onClick={() => setForm(f => ({ ...f, primaryColor: preset.p, accentColor: preset.a }))}
                            className="flex flex-col items-center gap-1 p-2 rounded-xl border border-slate-100 hover:border-slate-200 bg-white transition-all group"
                          >
                            <div className="size-8 rounded-lg border-2 border-white shadow-sm" style={{ backgroundColor: preset.p }} />
                            <span className="text-[8px] font-bold text-slate-400 group-hover:text-slate-600 transition-colors">{preset.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Hero Configuration */}
                    <div className="space-y-4 pt-4 border-t border-slate-100">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Configuration de la section Hero</label>

                      {/* Layout toggle */}
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mise en page</p>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            { value: 'side', label: 'Côte à côte', desc: 'Texte + image côté droit' },
                            { value: 'full', label: 'Plein écran', desc: 'Image en fond, texte par-dessus' },
                          ] as const).map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => setForm(f => ({ ...f, hero_layout: opt.value }))}
                              className={cn(
                                'p-3 rounded-xl border-2 text-left transition-all',
                                form.hero_layout === opt.value
                                  ? 'shadow-sm'
                                  : 'border-slate-100 bg-white hover:border-slate-200'
                              )}
                              style={form.hero_layout === opt.value ? { borderColor: form.primaryColor, backgroundColor: `${form.primaryColor}08` } : {}}
                            >
                              <p className="text-[11px] font-black text-slate-800">{opt.label}</p>
                              <p className="text-[9px] text-slate-400 mt-0.5">{opt.desc}</p>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Font style */}
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Style de police du titre</p>
                        <div className="grid grid-cols-4 gap-2">
                          {([
                            { value: 'bold', label: 'Gras', preview: 'font-black' },
                            { value: 'normal', label: 'Normal', preview: 'font-semibold' },
                            { value: 'light', label: 'Fin', preview: 'font-thin' },
                            { value: 'serif', label: 'Serif', preview: 'font-serif' },
                          ] as const).map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => setForm(f => ({ ...f, hero_font: opt.value }))}
                              className={cn(
                                'p-2.5 rounded-xl border-2 text-center transition-all',
                                form.hero_font === opt.value ? 'shadow-sm' : 'border-slate-100 bg-white hover:border-slate-200'
                              )}
                              style={form.hero_font === opt.value ? { borderColor: form.primaryColor, backgroundColor: `${form.primaryColor}08` } : {}}
                            >
                              <span className={`text-sm ${opt.preview} text-slate-700 block`}>Aa</span>
                              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider mt-0.5 block">{opt.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Headline */}
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Titre principal</p>
                        <Input
                          placeholder={form.name || 'Ex: La Nouvelle Collection'}
                          value={form.hero_headline}
                          onChange={e => setForm(f => ({ ...f, hero_headline: e.target.value }))}
                          className="h-11 rounded-xl border-slate-100 bg-slate-50/50 text-sm"
                        />
                        <p className="text-[9px] text-slate-400 ml-1">Laisser vide pour utiliser le nom de la boutique</p>
                      </div>

                      {/* Subtitle */}
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sous-titre / Accroche</p>
                        <textarea
                          placeholder={form.description || 'Ex: Performance. Qualité. Style.'}
                          value={form.hero_subtitle}
                          onChange={e => setForm(f => ({ ...f, hero_subtitle: e.target.value }))}
                          className="w-full p-3 border border-slate-100 rounded-xl bg-slate-50/50 text-sm font-medium resize-none outline-none focus:ring-2 focus:ring-indigo-100 transition-all min-h-[60px]"
                        />
                      </div>

                      {/* CTA */}
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Texte du bouton CTA</p>
                        <Input
                          placeholder="Ex: Voir la collection, Shop Now..."
                          value={form.hero_cta}
                          onChange={e => setForm(f => ({ ...f, hero_cta: e.target.value }))}
                          className="h-11 rounded-xl border-slate-100 bg-slate-50/50 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3 — Review */}
              {step === 3 && (
                <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h3 className="text-base font-black text-slate-900 mb-1">Prêt à déployer !</h3>
                    <p className="text-sm text-slate-400 font-medium">Vérifiez les informations avant de lancer votre boutique.</p>
                  </div>

                  <div className="space-y-3">
                    {[
                      { label: 'Nom', value: form.name || '—' },
                      { label: 'Domaine', value: form.domain || `${form.slug}.azzougshop.dz` },
                      { label: 'Template', value: selectedTemplate.name },
                      { label: 'Couleur', value: form.primaryColor.toUpperCase(), color: form.primaryColor },
                      { label: 'Logo', value: form.logo_url ? 'Uploadé ✓' : 'Non défini' },
                      { label: 'Bannière', value: form.banner_url ? (form.banner_is_video ? 'Vidéo ✓' : 'Image ✓') : 'Non définie' },
                    ].map(item => (
                      <div key={item.label} className="flex items-center justify-between py-3 border-b border-slate-50">
                        <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">{item.label}</span>
                        <div className="flex items-center gap-2">
                          {item.color && <div className="size-4 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: item.color }} />}
                          <span className="text-sm font-bold text-slate-900">{item.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Banner preview in review */}
                  {form.banner_url && (
                    <div className="rounded-2xl overflow-hidden border border-slate-100">
                      {form.banner_is_video ? (
                        <video src={form.banner_url} className="w-full h-24 object-cover" muted loop autoPlay />
                      ) : (
                        <img src={form.banner_url} alt="banner preview" className="w-full h-24 object-cover" />
                      )}
                    </div>
                  )}

                  <div className="p-5 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 text-center">
                    <Globe className="size-8 mx-auto text-slate-300 mb-3" />
                    <p className="text-sm font-black text-slate-700">La boutique sera accessible à:</p>
                    <p className="text-base font-black mt-1 font-mono" style={{ color: form.primaryColor }}>
                      {form.domain || `${form.slug || 'ma-boutique'}.azzougshop.dz`}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-2 font-medium">En mode dev, cette URL est simulée localement.</p>
                  </div>

                  <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-start gap-3">
                    <Check className="size-5 text-emerald-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-emerald-800">La boutique sera immédiatement disponible</p>
                      <p className="text-xs text-emerald-600 font-medium mt-0.5">Elle apparaîtra dans votre dashboard admin et sera gérable depuis le panneau de contrôle.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* NAV BUTTONS */}
            <div className="shrink-0 px-8 py-5 border-t border-slate-100 flex items-center justify-between bg-white">
              <Button variant="ghost" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0} className="text-slate-400 font-bold h-12 px-6 rounded-2xl">
                <ChevronLeft className="size-4 mr-1" /> Précédent
              </Button>
              {step < STEPS.length - 1 ? (
                <Button
                  onClick={() => setStep(s => s + 1)}
                  disabled={!canProceed}
                  className="h-12 px-8 rounded-2xl font-black uppercase tracking-widest text-[11px] text-white shadow-lg"
                  style={{ backgroundColor: form.primaryColor }}
                >
                  Suivant <ChevronRight className="size-4 ml-1" />
                </Button>
              ) : (
                <Button
                  onClick={handleCreate}
                  disabled={mutation.isPending || !form.name || !form.slug}
                  className="h-12 px-8 rounded-2xl font-black uppercase tracking-widest text-[11px] text-white shadow-xl"
                  style={{ backgroundColor: form.primaryColor }}
                >
                  {mutation.isPending ? <Loader2 className="size-5 animate-spin" /> : '🚀 Déployer la boutique'}
                </Button>
              )}
            </div>
          </div>

          {/* RIGHT PANEL — live preview */}
          <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
            <div className="px-6 py-4 border-b border-slate-100 bg-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  <div className="size-3 rounded-full bg-rose-400" />
                  <div className="size-3 rounded-full bg-amber-400" />
                  <div className="size-3 rounded-full bg-emerald-400" />
                </div>
                <div className="px-4 py-1.5 bg-slate-100 rounded-lg text-[10px] font-mono font-bold text-slate-500">
                  {form.domain || `${form.slug || 'ma-boutique'}.azzougshop.dz`}
                </div>
              </div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Aperçu en direct</div>
            </div>
            <div className="flex-1 flex items-center justify-center p-8 overflow-auto">
              <div className="w-full max-w-[420px] aspect-[9/16] sm:aspect-[3/4] rounded-[20px] overflow-hidden shadow-2xl border border-slate-200 relative">
                <TemplatePreview templateId={form.template_id} color={form.primaryColor} logoUrl={form.logo_url} bannerUrl={form.banner_url} bannerIsVideo={form.banner_is_video} />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {STORE_TEMPLATES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setForm(f => ({ ...f, template_id: t.id, primaryColor: t.accent }))}
                      className={cn("px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border-2", form.template_id === t.id ? "text-white" : "border-slate-100 text-slate-400 hover:border-slate-200")}
                      style={form.template_id === t.id ? { backgroundColor: t.accent, color: t.badgeText, borderColor: t.accent } : {}}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <div className="size-5 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: form.primaryColor }} />
                  <span className="text-[10px] font-mono font-bold text-slate-500">{form.primaryColor.toUpperCase()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
