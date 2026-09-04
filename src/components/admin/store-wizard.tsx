'use client';

import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Store as StoreIcon, 
  ChevronRight, 
  ChevronLeft, 
  Check, 
  Globe,
  Sparkles, 
  Zap, 
  Loader2, 
  X,
  Upload, 
  Video, 
  FileImage, 
  Type, 
  Copyright, 
  Palette, 
  LayoutTemplate,
  ShieldCheck,
  CheckCircle2,
  Users,
  Eye,
  Crown
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api-client';
import { DEFAULT_HOME_SECTIONS } from '@/lib/types';

// ─── TEMPLATE DEFINITIONS ───────────────────────────────────
export const STORE_TEMPLATES = [
  {
    id: 'minimalist',
    name: 'MINIMALIST STORE',
    tagline: 'Vitesse, clarté & conversion optimale — Grille produits & navigation rapide',
    badge: 'Recommandé',
    badgeColor: '#4b7bec',
    badgeText: '#FFFFFF',
    icon: Sparkles,
    accent: '#4b7bec',
    bg: '#111827',
    text: '#111827',
    description: 'Structure épurée et aérée orientée conversion directe. Grille responsive multi-colonnes, recherche dynamique, filtres avancés et panier instantané.',
    features: ['Grille produits multi-colonnes', 'Filtres & recherche instantanés', 'Hero image / vidéo responsive', 'Panier rapide slide-out', 'Optimisé mobile'],
  },
  {
    id: 'landing',
    name: 'LANDING PAGE CONVERSION',
    tagline: 'Architecture orientée publicité Meta / TikTok avec sections storytelling & CTA',
    badge: 'Haute Conversion',
    badgeColor: '#6C5CE7',
    badgeText: '#FFFFFF',
    icon: Crown,
    accent: '#6C5CE7',
    bg: '#1E1B4B',
    text: '#1E1B4B',
    description: 'Conçu pour les campagnes publicitaires directes avec Hero grand format, mise en avant des arguments clés, preuves sociales et formulaires de commande rapide.',
    features: ['Hero plein écran avec CTA percutant', 'Arguments & bénéfices détaillés', 'Témoignages & preuve sociale', 'Formulaire express intégré'],
  },
];

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

// ─── FORM DATA INTERFACE ────────────────────────────────────
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
  hero_cta2: string;
  hero_tag: string;
  hero_stats: Array<{ label: string; value: string }>;
  hero_font: 'bold' | 'normal' | 'light' | 'serif';
  sections_config: Array<{ key: 'bestSellers' | 'newArrivals' | 'testimonials'; enabled: boolean }>;
  assignment_active: boolean;
  assignment_logic: 'MANUAL' | 'ROUND_ROBIN' | 'LEAST_LOADED';
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
  footer_tagline: "L'excellence et la qualité au quotidien.",
  footer_copyright: '',
  hero_layout: 'side',
  hero_headline: "L'Élégance Épurée",
  hero_subtitle: "Découvrez nos pièces intemporelles, alliant design contemporain et finitions artisanales d'exception.",
  hero_cta: "Explorer le catalogue",
  hero_cta2: "Tout voir",
  hero_tag: "Sélection Officielle 2026",
  hero_stats: [],
  hero_font: 'bold',
  sections_config: DEFAULT_HOME_SECTIONS,
  assignment_active: false,
  assignment_logic: 'MANUAL',
};

// ─── MAIN WIZARD ─────────────────────────────────────────────
interface StoreWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialData?: any;
}

const STEPS = ['Template', 'Identité', 'Design', 'Sections', 'Assignation', 'Déploiement'];

const SECTION_LABELS: Record<string, string> = {
  bestSellers: 'Meilleures ventes',
  newArrivals: 'Nouveautés',
  testimonials: 'Avis clients',
};

export function StoreWizard({ open, onOpenChange, onSuccess, initialData }: StoreWizardProps) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAppStore();
  const qc = useQueryClient();

  const isEdit = !!initialData;

  useEffect(() => {
    if (open) {
      if (initialData) {
        setForm({
          name: initialData.name || '',
          slug: initialData.slug || '',
          description: initialData.description || '',
          logo_url: initialData.logo_url || '',
          banner_url: initialData.banner_url || '',
          banner_is_video: initialData.theme_config?.bannerIsVideo || false,
          template_id: initialData.template_id || 'minimalist',
          primaryColor: initialData.theme_config?.primaryColor || '#4b7bec',
          accentColor: initialData.theme_config?.accentColor || '#3867d6',
          domain: initialData.domain || '',
          facebook: initialData.social_links?.facebook || '',
          instagram: initialData.social_links?.instagram || '',
          tiktok: initialData.social_links?.tiktok || '',
          phone: initialData.contact?.phone || '',
          email: initialData.contact?.email || '',
          address: initialData.contact?.address || '',
          footer_tagline: initialData.theme_config?.footerTagline || '',
          footer_copyright: initialData.theme_config?.footerCopyright || '',
          hero_layout: initialData.theme_config?.heroLayout || 'side',
          hero_headline: initialData.theme_config?.heroHeadline || '',
          hero_subtitle: initialData.theme_config?.heroSubtitle || '',
          hero_cta: initialData.theme_config?.heroCta || '',
          hero_cta2: initialData.theme_config?.heroCta2 || '',
          hero_tag: initialData.theme_config?.heroTag || '',
          hero_stats: initialData.theme_config?.heroStats || [],
          sections_config: initialData.theme_config?.sectionsConfig || DEFAULT_HOME_SECTIONS,
          hero_font: initialData.theme_config?.heroFont || 'bold',
          assignment_active: initialData.assignment_active || false,
          assignment_logic: initialData.assignment_logic || 'MANUAL',
        });
      } else {
        setForm(DEFAULT_FORM);
      }
      setStep(0);
    }
  }, [open, initialData]);

  const handleLogoUpload = async (file: File) => {
    setUploadingLogo(true);
    try {
      const url = await uploadMedia(file, 'image');
      setForm(f => ({ ...f, logo_url: url }));
      toast.success('Logo uploadé avec succès');
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
      toast.success('Média Hero uploadé avec succès');
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur upload bannière');
    } finally {
      setUploadingBanner(false);
    }
  };

  const selectedTemplate = STORE_TEMPLATES.find(t => t.id === form.template_id) ?? STORE_TEMPLATES[0];

  const mutation = useMutation({
    mutationFn: (data: any) => isEdit
      ? apiFetch(`/api/v1/stores/${initialData.id}`, { method: 'PUT', body: JSON.stringify(data) })
      : apiFetch('/api/v1/stores', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stores'] });
      qc.invalidateQueries({ queryKey: ['stores-revenue'] });
      toast.success(isEdit ? 'Boutique modifiée avec succès' : 'Boutique créée et déployée avec succès');
      onOpenChange(false);
      setStep(0);
      setForm(DEFAULT_FORM);
      onSuccess?.();
    },
    onError: (e: any) => toast.error(e.message ?? 'Erreur lors de la sauvegarde'),
  });

  const handleCreate = () => {
    if (!form.name || !form.slug) return toast.error('Le nom et le slug URL sont obligatoires');
    mutation.mutate({
      name: form.name,
      slug: form.slug,
      description: form.description,
      logo_url: form.logo_url || null,
      banner_url: form.banner_url || null,
      domain: form.domain || `${form.slug}.azghub.com`,
      owner_id: user?.id,
      theme_config: {
        templateId: form.template_id,
        primaryColor: form.primaryColor,
        accentColor: form.accentColor,
        fontFamily: 'Inter',
        borderRadius: '12px',
        bannerIsVideo: form.banner_is_video,
        heroLayout: form.hero_layout,
        heroHeadline: form.hero_headline || null,
        heroSubtitle: form.hero_subtitle || null,
        heroCta: form.hero_cta || null,
        heroCta2: form.hero_cta2 || null,
        heroTag: form.hero_tag || null,
        heroStats: form.hero_stats.filter(s => s.label.trim() && s.value.trim()).length > 0
          ? form.hero_stats.filter(s => s.label.trim() && s.value.trim())
          : null,
        heroFont: form.hero_font,
        sectionsConfig: form.sections_config,
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
      assignment_active: form.assignment_active,
      assignment_logic: form.assignment_logic,
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
      <DialogContent className="max-w-3xl w-[95vw] h-[88vh] p-0 overflow-hidden rounded-[32px] border-none shadow-2xl flex flex-col gap-0 bg-white">
        <DialogTitle className="sr-only">{isEdit ? 'Modifier la boutique' : 'Créer une nouvelle boutique'}</DialogTitle>

        {/* ─── MODAL HEADER (Meta Ads Template) ─── */}
        <div className="bg-[#1877F2] px-6 sm:px-8 py-5 text-white shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              <div className="size-11 rounded-2xl bg-white/15 flex items-center justify-center text-white backdrop-blur-md shadow-xs shrink-0">
                <StoreIcon className="size-5.5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base sm:text-lg font-black tracking-tight text-white">
                    {isEdit ? 'Modifier la boutique' : 'Créer une nouvelle boutique'}
                  </h2>
                  <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-white/20 text-white font-mono">
                    {form.name || 'Nouveau Site'}
                  </span>
                </div>
                <p className="text-[11px] text-white/80 font-medium mt-0.5">
                  Configuration et déploiement de votre vitrine e-commerce multi-tenant
                </p>
              </div>
            </div>

            <button 
              onClick={() => onOpenChange(false)} 
              className="size-8 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Stepper Navigation Bar */}
          <div className="flex items-center gap-1 sm:gap-2 mt-4 pt-3 border-t border-white/15 overflow-x-auto no-scrollbar">
            {STEPS.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => i <= step && setStep(i)}
                className={cn(
                  "px-2.5 sm:px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap flex items-center gap-1.5",
                  i === step 
                    ? "bg-white text-[#1877F2] shadow-xs font-black" 
                    : i < step 
                    ? "bg-white/20 text-white hover:bg-white/30" 
                    : "text-white/50 cursor-default"
                )}
              >
                <span className={cn(
                  "size-4 rounded-full flex items-center justify-center text-[9px] font-black",
                  i === step ? "bg-[#1877F2] text-white" : i < step ? "bg-white/30 text-white" : "bg-white/10 text-white/50"
                )}>
                  {i < step ? <Check className="size-2.5" /> : (i + 1)}
                </span>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* ─── MODAL BODY ─── */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 bg-white">

          {/* STEP 0 — Template */}
          {step === 0 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">01. Architecture & Modèle de Vitrine</h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5">Sélectionnez le style de présentation adapté à votre activité commerciale.</p>
              </div>

              <div className="space-y-3">
                {STORE_TEMPLATES.map(t => {
                  const Icon = t.icon;
                  const active = form.template_id === t.id;
                  return (
                    <div
                      key={t.id}
                      onClick={() => setForm(f => ({ ...f, template_id: t.id }))}
                      className={cn(
                        "p-5 rounded-2xl border-2 transition-all cursor-pointer relative",
                        active 
                          ? "border-[#4b7bec] bg-blue-50/20 shadow-sm" 
                          : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50/40"
                      )}
                    >
                      <div className="flex items-start gap-4">
                        <div className={cn(
                          "size-12 rounded-xl flex items-center justify-center shrink-0 shadow-xs",
                          active ? "bg-[#4b7bec] text-white" : "bg-slate-100 text-slate-600"
                        )}>
                          <Icon className="size-6" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-black text-slate-900 tracking-tight">{t.name}</span>
                            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-50 text-[#4b7bec] border border-blue-200/60">
                              {t.badge}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 font-medium leading-relaxed">{t.description}</p>
                          <div className="flex flex-wrap gap-1.5 mt-3">
                            {t.features.map(f => (
                              <span key={f} className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 uppercase tracking-wider">
                                {f}
                              </span>
                            ))}
                          </div>
                        </div>

                        {active && (
                          <div className="size-6 rounded-full bg-[#4b7bec] text-white flex items-center justify-center shrink-0 shadow-xs">
                            <Check className="size-3.5" />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 1 — Identité */}
          {step === 1 && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">02. Identité & Coordonnées de la Boutique</h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5">Définissez les informations de base et l'adresse web de votre vitrine.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nom de la boutique *</label>
                  <Input
                    placeholder="Ex: AZ Confort, Chic Outfit..."
                    value={form.name}
                    onChange={e => {
                      const name = e.target.value;
                      setForm(f => ({ ...f, name, slug: f.slug || slugify(name) }));
                    }}
                    className="h-11 rounded-xl border-slate-200 bg-slate-50 text-sm font-bold focus-visible:bg-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sous-domaine AZGHUB *</label>
                  <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    <Input
                      placeholder="azconfort"
                      value={form.slug}
                      onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                      className="h-11 border-0 font-mono text-xs font-bold bg-transparent rounded-none flex-1 focus-visible:ring-0 px-3"
                    />
                    <span className="px-3 bg-slate-100 flex items-center text-[10px] font-black text-slate-500 border-l border-slate-200">
                      .azghub.com
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Domaine personnalisé (Optionnel)</label>
                <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  <span className="px-3 bg-slate-100 flex items-center text-[11px] font-bold text-slate-400 border-r border-slate-200">
                    https://
                  </span>
                  <Input
                    placeholder="www.maboutique.com"
                    value={form.domain}
                    onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}
                    className="h-11 border-0 font-mono text-xs font-bold bg-transparent rounded-none flex-1 focus-visible:ring-0 px-3"
                  />
                </div>
              </div>

              {/* Logo & Hero Upload Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                {/* Logo */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Logo Officiel</label>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); }}
                  />
                  {form.logo_url ? (
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                      <div className="size-12 rounded-xl border border-slate-200 bg-white overflow-hidden shrink-0 flex items-center justify-center p-1">
                        <img src={form.logo_url} alt="logo" className="size-full object-contain" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-800 truncate">Logo importé</p>
                        <p className="text-[10px] text-emerald-600 font-bold">Actif sur la boutique</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => logoInputRef.current?.click()}
                          className="px-2.5 py-1 text-[10px] font-black uppercase tracking-wider border border-slate-200 bg-white rounded-lg hover:bg-slate-100 transition-all"
                        >
                          Changer
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, logo_url: '' }))}
                          className="size-7 rounded-lg border border-rose-100 bg-rose-50 text-rose-500 hover:bg-rose-100 flex items-center justify-center transition-all"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={uploadingLogo}
                      className="w-full h-24 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50 transition-all flex flex-col items-center justify-center gap-1.5"
                    >
                      {uploadingLogo ? (
                        <Loader2 className="size-5 animate-spin text-[#4b7bec]" />
                      ) : (
                        <>
                          <Upload className="size-4 text-slate-400" />
                          <span className="text-[10px] font-bold text-slate-600">Importer le logo</span>
                          <span className="text-[9px] text-slate-400">PNG, JPG, WebP</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* Banner */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bannière / Image Hero</label>
                  <input
                    ref={bannerInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,video/mp4"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleBannerUpload(f); }}
                  />
                  {form.banner_url ? (
                    <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-900 h-24">
                      {form.banner_is_video ? (
                        <video src={form.banner_url} className="w-full h-full object-cover" muted loop autoPlay />
                      ) : (
                        <img src={form.banner_url} alt="banner" className="w-full h-full object-cover" />
                      )}
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-2 opacity-0 hover:opacity-100 transition-all">
                        <button
                          type="button"
                          onClick={() => bannerInputRef.current?.click()}
                          className="px-3 py-1 text-[10px] font-black uppercase tracking-wider bg-white text-slate-900 rounded-lg"
                        >
                          Changer
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, banner_url: '', banner_is_video: false }))}
                          className="size-7 rounded-lg bg-rose-600 text-white flex items-center justify-center"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => bannerInputRef.current?.click()}
                      disabled={uploadingBanner}
                      className="w-full h-24 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50 transition-all flex flex-col items-center justify-center gap-1.5"
                    >
                      {uploadingBanner ? (
                        <Loader2 className="size-5 animate-spin text-[#4b7bec]" />
                      ) : (
                        <>
                          <FileImage className="size-4 text-slate-400" />
                          <span className="text-[10px] font-bold text-slate-600">Importer bannière hero</span>
                          <span className="text-[9px] text-slate-400">JPG, PNG, WebP ou MP4</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Description & Contact */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Description de la boutique</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Courte présentation de vos offres et produits..."
                  className="w-full min-h-[70px] p-3 border border-slate-200 rounded-xl bg-slate-50 text-xs font-medium resize-none outline-none focus:bg-white focus:ring-2 focus:ring-[#4b7bec]/20"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Téléphone contact</label>
                  <Input placeholder="0550 00 00 00" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="h-10 rounded-xl text-xs bg-slate-50" />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Email commercial</label>
                  <Input placeholder="contact@maboutique.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="h-10 rounded-xl text-xs bg-slate-50" />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Adresse / Siège</label>
                  <Input placeholder="Alger, Algérie" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="h-10 rounded-xl text-xs bg-slate-50" />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2 — Design & Apparence */}
          {step === 2 && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">03. Palette de Couleurs & Personnalisation Hero</h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5">Ajustez la charte graphique et l'accroche promotionnelle.</p>
              </div>

              {/* Color Presets */}
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Palettes de marque pré-configurées</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[
                    { label: 'Denim Blue', p: '#4b7bec', a: '#3867d6' },
                    { label: 'Luxury Noir', p: '#1E293B', a: '#F59E0B' },
                    { label: 'Emerald Fresh', p: '#10B981', a: '#059669' },
                    { label: 'Royal Violet', p: '#6C5CE7', a: '#5B4BC4' },
                    { label: 'Ruby Red', p: '#EF4444', a: '#B91C1C' },
                    { label: 'Ocean Teal', p: '#0EA5E9', a: '#0284C7' },
                    { label: 'Amber Gold', p: '#F59E0B', a: '#D97706' },
                    { label: 'Deep Navy', p: '#0F172A', a: '#1E293B' },
                  ].map(preset => {
                    const active = form.primaryColor.toLowerCase() === preset.p.toLowerCase();
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, primaryColor: preset.p, accentColor: preset.a }))}
                        className={cn(
                          "p-3 rounded-xl border transition-all flex items-center gap-2.5 text-left",
                          active ? "border-[#4b7bec] bg-blue-50/30 ring-2 ring-[#4b7bec]/20" : "border-slate-100 bg-slate-50/60 hover:bg-white hover:border-slate-200"
                        )}
                      >
                        <div className="size-6 rounded-lg shadow-2xs shrink-0 border border-white" style={{ backgroundColor: preset.p }} />
                        <span className="text-[11px] font-bold text-slate-800 truncate">{preset.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Color Pickers */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Couleur Principale (Hex)</label>
                  <div className="flex items-center gap-3 p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                    <input
                      type="color"
                      value={form.primaryColor}
                      onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))}
                      className="size-8 rounded-lg cursor-pointer border-0 bg-transparent"
                    />
                    <Input
                      value={form.primaryColor}
                      onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))}
                      className="h-9 border-0 bg-transparent font-mono text-xs font-bold"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Couleur Secondaire (Hex)</label>
                  <div className="flex items-center gap-3 p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                    <input
                      type="color"
                      value={form.accentColor}
                      onChange={e => setForm(f => ({ ...f, accentColor: e.target.value }))}
                      className="size-8 rounded-lg cursor-pointer border-0 bg-transparent"
                    />
                    <Input
                      value={form.accentColor}
                      onChange={e => setForm(f => ({ ...f, accentColor: e.target.value }))}
                      className="h-9 border-0 bg-transparent font-mono text-xs font-bold"
                    />
                  </div>
                </div>
              </div>

              {/* Hero Customization Section */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Personnalisation du Hero (Bannière d'accueil)</label>
                  <span className="text-[9px] font-bold text-slate-400">Visible sur la page principale</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Badge / Tag Supérieur</label>
                    <Input
                      placeholder="Sélection Officielle 2026"
                      value={form.hero_tag}
                      onChange={e => setForm(f => ({ ...f, hero_tag: e.target.value }))}
                      className="h-10 rounded-xl text-xs bg-slate-50 font-bold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Titre Principal Hero</label>
                    <Input
                      placeholder="L'Élégance Épurée"
                      value={form.hero_headline}
                      onChange={e => setForm(f => ({ ...f, hero_headline: e.target.value }))}
                      className="h-10 rounded-xl text-xs bg-slate-50 font-bold"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sous-titre / Message descriptif</label>
                  <textarea
                    rows={2}
                    placeholder="Découvrez nos pièces intemporelles, alliant design contemporain et finitions artisanales d'exception."
                    value={form.hero_subtitle}
                    onChange={e => setForm(f => ({ ...f, hero_subtitle: e.target.value }))}
                    className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50 text-xs font-medium resize-none outline-none focus:bg-white focus:ring-2 focus:ring-[#4b7bec]/20"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bouton d'Action Principal (CTA 1)</label>
                    <Input
                      placeholder="Explorer le catalogue"
                      value={form.hero_cta}
                      onChange={e => setForm(f => ({ ...f, hero_cta: e.target.value }))}
                      className="h-10 rounded-xl text-xs bg-slate-50 font-bold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bouton Secondaire (CTA 2)</label>
                    <Input
                      placeholder="Tout voir"
                      value={form.hero_cta2}
                      onChange={e => setForm(f => ({ ...f, hero_cta2: e.target.value }))}
                      className="h-10 rounded-xl text-xs bg-slate-50 font-bold"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3 — Sections */}
          {step === 3 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">04. Sections de la Page d'Accueil</h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5">Activez ou désactivez les blocs affichés sur votre page d'accueil.</p>
              </div>

              <div className="space-y-3">
                {form.sections_config.map((section, i) => (
                  <div
                    key={section.key}
                    className={cn(
                      "flex items-center justify-between p-4 rounded-2xl border transition-all",
                      section.enabled ? "bg-white border-slate-200 shadow-2xs" : "bg-slate-50/50 border-slate-100 opacity-60"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "size-9 rounded-xl flex items-center justify-center font-black text-xs",
                        section.enabled ? "bg-indigo-50 text-[#4b7bec]" : "bg-slate-100 text-slate-400"
                      )}>
                        {i + 1}
                      </div>
                      <div>
                        <p className="text-xs font-black text-slate-900">{SECTION_LABELS[section.key] || section.key}</p>
                        <p className="text-[10px] text-slate-400 font-medium">Position #{i + 1} dans la structure</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setForm(f => ({
                        ...f,
                        sections_config: f.sections_config.map(s => s.key === section.key ? { ...s, enabled: !s.enabled } : s)
                      }))}
                      className={cn(
                        "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border",
                        section.enabled 
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                          : "bg-slate-100 text-slate-500 border-slate-200"
                      )}
                    >
                      {section.enabled ? 'Activé' : 'Désactivé'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 4 — Assignation */}
          {step === 4 && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">05. Règles d'Assignation des Commandes</h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5">Automatisez l'attribution des commandes de cette boutique aux membres de votre équipe.</p>
              </div>

              <div className="p-5 rounded-2xl border border-slate-100 bg-slate-50/50 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-900">Distribution Automatique</h4>
                    <p className="text-[11px] text-slate-400 font-medium mt-0.5">Assigner les nouvelles commandes aux confirmatrices en temps réel</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, assignment_active: !f.assignment_active }))}
                    className={cn(
                      "px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border",
                      form.assignment_active 
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                        : "bg-slate-200 text-slate-600 border-slate-300"
                    )}
                  >
                    {form.assignment_active ? 'Actif' : 'Inactif'}
                  </button>
                </div>

                {form.assignment_active && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-200">
                    {[
                      { id: 'ROUND_ROBIN', label: 'Tour de rôle (Round Robin)', desc: 'Distribue équitablement chaque commande à l\'agent suivant.' },
                      { id: 'LEAST_LOADED', label: 'Moins chargé (Least Loaded)', desc: 'Assigne en priorité à l\'agent ayant le moins de commandes en cours.' },
                    ].map(logic => {
                      const active = form.assignment_logic === logic.id;
                      return (
                        <div
                          key={logic.id}
                          onClick={() => setForm(f => ({ ...f, assignment_logic: logic.id as any }))}
                          className={cn(
                            "p-3.5 rounded-xl border transition-all cursor-pointer",
                            active ? "border-[#4b7bec] bg-blue-50/40 ring-1 ring-[#4b7bec]" : "border-slate-200 bg-white hover:border-slate-300"
                          )}
                        >
                          <p className="text-xs font-black text-slate-900">{logic.label}</p>
                          <p className="text-[10px] text-slate-400 mt-1 leading-snug font-medium">{logic.desc}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 5 — Déploiement */}
          {step === 5 && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">06. Récapitulatif & Déploiement</h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5">Vérifiez les paramètres avant la mise en ligne.</p>
              </div>

              <div className="bg-slate-50/70 rounded-2xl p-5 border border-slate-100 space-y-3">
                {[
                  { label: 'Nom de la Boutique', value: form.name || '—' },
                  { label: 'URL Principale', value: `${form.slug || 'slug'}.azghub.com` },
                  { label: 'Domaine Personnalisé', value: form.domain || 'Non configuré' },
                  { label: 'Template Vitrine', value: selectedTemplate.name },
                  { label: 'Couleur de Marque', value: form.primaryColor.toUpperCase(), color: form.primaryColor },
                  { label: 'Logo', value: form.logo_url ? 'Configuré' : 'Non défini' },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100 last:border-b-0">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{item.label}</span>
                    <div className="flex items-center gap-2">
                      {item.color && <div className="size-3.5 rounded-full border border-white shadow-2xs" style={{ backgroundColor: item.color }} />}
                      <span className="font-bold text-slate-900 font-mono">{item.value}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 flex items-start gap-3">
                <CheckCircle2 className="size-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-emerald-900">Prêt pour la mise en ligne immédiate</p>
                  <p className="text-[10px] text-emerald-700/80 font-medium mt-0.5">
                    La boutique sera immédiatement disponible dans le réseau multi-tenant et accessible via son sous-domaine.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─── MODAL FOOTER ─── */}
        <div className="shrink-0 px-6 sm:px-8 py-4 border-t border-slate-100 flex items-center justify-between bg-white">
          <Button 
            variant="outline" 
            onClick={() => setStep(s => Math.max(0, s - 1))} 
            disabled={step === 0} 
            className="text-slate-600 font-bold h-11 px-5 rounded-xl text-xs border-slate-200 hover:bg-slate-50"
          >
            <ChevronLeft className="size-3.5 mr-1" /> Précédent
          </Button>

          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Étape {step + 1} / {STEPS.length}
          </span>

          {step < STEPS.length - 1 ? (
            <Button
              onClick={() => setStep(s => s + 1)}
              disabled={!canProceed}
              className="h-11 px-6 rounded-xl font-black uppercase tracking-wider text-xs text-white bg-[#1877F2] hover:bg-[#166fe5] shadow-sm flex items-center gap-1.5"
            >
              Suivant <ChevronRight className="size-3.5" />
            </Button>
          ) : (
            <Button
              onClick={handleCreate}
              disabled={mutation.isPending || !form.name || !form.slug}
              className="h-11 px-7 rounded-xl font-black uppercase tracking-wider text-xs text-white bg-[#00B894] hover:bg-[#00a884] shadow-md shadow-emerald-100 flex items-center gap-2"
            >
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : (isEdit ? 'Enregistrer les modifications' : 'Déployer la boutique')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
