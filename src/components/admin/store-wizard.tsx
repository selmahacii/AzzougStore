'use client';

import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Store as StoreIcon, ChevronRight, ChevronLeft, Check, Globe,
  Sparkles, Zap, Loader2, X,
  Upload, Video, FileImage, Type, Copyright, Palette, LayoutTemplate,
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
  assignment_active: boolean;
  assignment_logic: 'MANUAL' | 'ROUND_ROBIN' | 'LEAST_LOADED';
  max_nrp_normal: number;
  max_nrp_abandoned: number;
  nrp_callback_hours: number;
  auto_merge_duplicates: boolean;
}

const DEFAULT_FORM: FormData = {
  name: '',
  slug: '',
  description: '',
  logo_url: '',
  banner_url: '',
  banner_is_video: false,
  template_id: 'minimalist',
  primaryColor: '#111827',
  accentColor: '#1F2937',
  domain: '',
  facebook: '',
  instagram: '',
  tiktok: '',
  phone: '',
  email: '',
  address: '',
  footer_tagline: "L'excellence à chaque instant.",
  footer_copyright: '',
  hero_layout: 'side',
  hero_headline: "L'Élégance Épurée",
  hero_subtitle: "Découvrez nos pièces intemporelles, alliant design contemporain et finitions artisanales d'exception.",
  hero_cta: "Explorer le catalogue",
  hero_font: 'bold',
  assignment_active: false,
  assignment_logic: 'MANUAL',
  max_nrp_normal: 9,
  max_nrp_abandoned: 12,
  nrp_callback_hours: 2,
  auto_merge_duplicates: true,
};


// ─── MAIN WIZARD ─────────────────────────────────────────────
interface StoreWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialData?: any;
}

const STEPS = ['Template', 'Identité', 'Design', 'Assignation', 'Aperçu & Lancer'];

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
          primaryColor: initialData.theme_config?.primaryColor || '#111827',
          accentColor: initialData.theme_config?.accentColor || '#1F2937',
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
          hero_font: initialData.theme_config?.heroFont || 'bold',
          assignment_active: initialData.assignment_active || false,
          assignment_logic: initialData.assignment_logic || 'MANUAL',
          max_nrp_normal: initialData.operations_config?.max_nrp_normal ?? 9,
          max_nrp_abandoned: initialData.operations_config?.max_nrp_abandoned ?? 12,
          nrp_callback_hours: initialData.operations_config?.nrp_callback_hours ?? 2,
          auto_merge_duplicates: initialData.operations_config?.auto_merge_duplicates ?? true,
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

  const selectedTemplate = STORE_TEMPLATES.find(t => t.id === form.template_id) ?? STORE_TEMPLATES[0];

  const mutation = useMutation({
    mutationFn: (data: any) => isEdit
      ? apiFetch(`/api/v1/stores/${initialData.id}`, { method: 'PUT', body: JSON.stringify(data) })
      : apiFetch('/api/v1/stores', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stores'] });
      toast.success(isEdit ? 'Boutique modifiée avec succès !' : 'Boutique déployée avec succès !');
      onOpenChange(false);
      setStep(0);
      setForm(DEFAULT_FORM);
      onSuccess?.();
    },
    onError: (e: any) => toast.error(e.message ?? 'Erreur lors de la sauvegarde'),
  });

  const handleCreate = () => {
    if (!form.name || !form.slug) return toast.error('Nom et slug requis');
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
      assignment_active: form.assignment_active,
      assignment_logic: form.assignment_logic,
      operations_config: {
        max_nrp_normal: form.max_nrp_normal,
        max_nrp_abandoned: form.max_nrp_abandoned,
        nrp_callback_hours: form.nrp_callback_hours,
        auto_merge_duplicates: form.auto_merge_duplicates,
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
      <DialogContent className="max-w-2xl w-[95vw] h-[85vh] p-0 overflow-hidden rounded-[40px] border-none shadow-2xl flex flex-col gap-0">
        <DialogTitle className="sr-only">Créer une nouvelle boutique</DialogTitle>

        {/* ── TOP BAR ── */}
        <div className="flex items-center gap-4 px-8 py-5 border-b border-slate-100 bg-white shrink-0">
          <div className="size-10 rounded-2xl flex items-center justify-center text-white shadow-lg" style={{ backgroundColor: selectedTemplate.accent }}>
            <StoreIcon className="size-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-black text-slate-900 uppercase tracking-tight">{isEdit ? 'Modifier la boutique' : 'Créer une nouvelle boutique'}</h2>
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
          <div className="w-full flex-1 flex flex-col overflow-hidden">
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
                          onClick={() => setForm(f => {
                            const isMin = t.id === 'minimalist';
                            return {
                              ...f,
                              template_id: t.id,
                              primaryColor: t.accent,
                              accentColor: isMin ? '#1F2937' : '#D63031',
                              hero_headline: isMin ? "L'Élégance Épurée" : "Performance & Style",
                              hero_subtitle: isMin 
                                ? "Découvrez nos pièces intemporelles, alliant design contemporain et finitions artisanales d'exception."
                                : "Le produit révolutionnaire conçu pour dépasser toutes vos attentes au quotidien. Commandez le vôtre dès aujourd'hui.",
                              hero_cta: isMin ? "Explorer le catalogue" : "Profiter de l'offre",
                              hero_layout: isMin ? 'side' : 'full',
                              footer_tagline: isMin ? "L'excellence à chaque instant." : "L'efficacité sans compromis."
                            };
                          })}
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
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h3 className="text-base font-black text-slate-900 mb-1">Identité de votre boutique</h3>
                    <p className="text-sm text-slate-400 font-medium">Ces informations définissent votre marque. Prenez le temps d'être précis.</p>
                  </div>

                  {/* CARD 1: NOM & ADRESSAGE */}
                  <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-5">
                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-indigo-500" /> Nom & Adressage
                    </h4>

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
                        <span className="px-4 bg-slate-100 flex items-center text-[11px] font-bold text-slate-400 border-r border-slate-100 whitespace-nowrap">azghub.com/</span>
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
                      <p className="text-[10px] text-slate-400 ml-1">En dev, un domaine test sera auto-généré: <span className="font-mono font-bold">{form.slug || 'slug'}.azghub.com</span></p>
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
                  </div>

                  {/* CARD 2: MÉDIAS */}
                  <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-5">
                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" /> Médias
                    </h4>

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
                    <div className="space-y-2 pt-4 border-t border-slate-100">
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
                  </div>

                  {/* CARD 3: CONTACT, RÉSEAUX & FOOTER */}
                  <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-5">
                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" /> Contact, Réseaux & Footer
                    </h4>

                    <div className="space-y-3">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Contact</label>
                      <div className="grid grid-cols-2 gap-3">
                        <Input placeholder="Téléphone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="h-11 rounded-xl border-slate-100 bg-slate-50/50 text-sm" />
                        <Input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="h-11 rounded-xl border-slate-100 bg-slate-50/50 text-sm" />
                      </div>
                      <Input placeholder="Adresse physique" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className="h-11 rounded-xl border-slate-100 bg-slate-50/50 text-sm" />
                    </div>

                    <div className="space-y-3 pt-4 border-t border-slate-100">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Réseaux sociaux</label>
                      <div className="grid grid-cols-3 gap-3">
                        <Input placeholder="Facebook URL" value={form.facebook} onChange={e => setForm(f => ({ ...f, facebook: e.target.value }))} className="h-10 rounded-xl border-slate-100 bg-slate-50/50 text-xs" />
                        <Input placeholder="Instagram @" value={form.instagram} onChange={e => setForm(f => ({ ...f, instagram: e.target.value }))} className="h-10 rounded-xl border-slate-100 bg-slate-50/50 text-xs" />
                        <Input placeholder="TikTok @" value={form.tiktok} onChange={e => setForm(f => ({ ...f, tiktok: e.target.value }))} className="h-10 rounded-xl border-slate-100 bg-slate-50/50 text-xs" />
                      </div>
                    </div>

                    <div className="space-y-2 pt-4 border-t border-slate-100">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pied de page (Footer)</label>
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

              {/* STEP 2 — Design & Apparence */}
              {step === 2 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h3 className="text-base font-black text-slate-900 mb-1">Design & Apparence</h3>
                    <p className="text-sm text-slate-400 font-medium">Personnalisez les couleurs et la structure visuelle de votre boutique. L'aperçu se met à jour en temps réel.</p>
                  </div>

                  <div className="space-y-6">
                    {/* CARD 1: COULEURS */}
                    <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-6 relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                        <Palette className="w-24 h-24" />
                      </div>
                      <div className="relative">
                        <h4 className="text-xs font-black uppercase tracking-widest text-slate-900 mb-4 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-indigo-500" /> Palette de couleurs
                        </h4>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                          <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Couleur principale</label>
                            <div className="flex items-center gap-4 p-3 bg-slate-50/50 rounded-2xl border border-slate-100 transition-all hover:bg-slate-50">
                              <div className="relative shrink-0">
                                <div className="size-12 rounded-xl border-4 border-white shadow-sm cursor-pointer" style={{ backgroundColor: form.primaryColor }} />
                                <input
                                  type="color"
                                  value={form.primaryColor}
                                  onChange={e => setForm(f => ({ ...f, primaryColor: e.target.value }))}
                                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                />
                              </div>
                              <div className="flex-1">
                                <div className="font-mono text-xs font-bold text-slate-700 mb-1">{form.primaryColor.toUpperCase()}</div>
                                <div className="flex gap-0.5">
                                  {[1, 0.75, 0.5, 0.25, 0.1].map((op, i) => (
                                    <div key={i} className="h-3 flex-1 rounded-sm" style={{ backgroundColor: form.primaryColor, opacity: op }} />
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Couleur secondaire</label>
                            <div className="flex items-center gap-4 p-3 bg-slate-50/50 rounded-2xl border border-slate-100 transition-all hover:bg-slate-50">
                              <div className="relative shrink-0">
                                <div className="size-12 rounded-xl border-4 border-white shadow-sm cursor-pointer" style={{ backgroundColor: form.accentColor }} />
                                <input
                                  type="color"
                                  value={form.accentColor}
                                  onChange={e => setForm(f => ({ ...f, accentColor: e.target.value }))}
                                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                />
                              </div>
                              <div className="flex-1">
                                <div className="font-mono text-xs font-bold text-slate-700 mb-1">{form.accentColor.toUpperCase()}</div>
                                <div className="flex gap-0.5">
                                  {[1, 0.75, 0.5, 0.25, 0.1].map((op, i) => (
                                    <div key={i} className="h-3 flex-1 rounded-sm" style={{ backgroundColor: form.accentColor, opacity: op }} />
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Quick presets */}
                        <div className="space-y-2 pt-2 border-t border-slate-100">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-2 block">Palettes rapides pré-configurées</label>
                          <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
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
                                className="flex flex-col items-center gap-1.5 p-2 rounded-xl border border-slate-100 hover:border-slate-300 hover:bg-slate-50 transition-all group"
                              >
                                <div className="size-6 rounded-md border border-slate-200 shadow-sm" style={{ backgroundColor: preset.p }} />
                                <span className="text-[8px] font-bold text-slate-400 group-hover:text-slate-700 transition-colors">{preset.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* CARD 2: HERO CONFIGURATION */}
                    <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-6 relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                        <LayoutTemplate className="w-24 h-24" />
                      </div>
                      <div className="relative">
                        <h4 className="text-xs font-black uppercase tracking-widest text-slate-900 mb-6 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" /> Section d'en-tête (Hero)
                        </h4>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                          {/* Layout toggle */}
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Mise en page de l'en-tête</label>
                            <div className="grid grid-cols-1 gap-2">
                              {([
                                { value: 'side', label: 'Côte à côte', desc: 'Texte à gauche, image à droite' },
                                { value: 'full', label: 'Plein écran', desc: 'Image en fond avec texte par-dessus' },
                              ] as const).map(opt => (
                                <button
                                  key={opt.value}
                                  onClick={() => setForm(f => ({ ...f, hero_layout: opt.value }))}
                                  className={cn(
                                    'p-3 rounded-xl border-2 text-left transition-all flex flex-col',
                                    form.hero_layout === opt.value
                                      ? 'shadow-sm'
                                      : 'border-slate-100 bg-slate-50/50 hover:bg-white hover:border-slate-200'
                                  )}
                                  style={form.hero_layout === opt.value ? { borderColor: form.primaryColor, backgroundColor: `${form.primaryColor}08` } : {}}
                                >
                                  <span className="text-[11px] font-black text-slate-800">{opt.label}</span>
                                  <span className="text-[9px] text-slate-400 mt-0.5 font-medium">{opt.desc}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Font style */}
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Style de police du grand titre</label>
                            <div className="grid grid-cols-2 gap-2">
                              {([
                                { value: 'bold', label: 'Moderne Gras', preview: 'font-black' },
                                { value: 'normal', label: 'Standard', preview: 'font-semibold' },
                                { value: 'light', label: 'Épuré Fin', preview: 'font-thin' },
                                { value: 'serif', label: 'Classique Serif', preview: 'font-serif' },
                              ] as const).map(opt => (
                                <button
                                  key={opt.value}
                                  onClick={() => setForm(f => ({ ...f, hero_font: opt.value }))}
                                  className={cn(
                                    'py-3 px-2 rounded-xl border-2 text-center transition-all',
                                    form.hero_font === opt.value ? 'shadow-sm' : 'border-slate-100 bg-slate-50/50 hover:bg-white hover:border-slate-200'
                                  )}
                                  style={form.hero_font === opt.value ? { borderColor: form.primaryColor, backgroundColor: `${form.primaryColor}08` } : {}}
                                >
                                  <span className={`text-base ${opt.preview} text-slate-800 block leading-none mb-1`}>Aa</span>
                                  <span className="text-[9px] font-bold text-slate-400 block">{opt.label}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Texts */}
                        <div className="space-y-4 pt-6 border-t border-slate-100">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Headline */}
                            <div className="space-y-2">
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Titre principal</label>
                              <Input
                                placeholder={form.name || 'Ex: La Nouvelle Collection'}
                                value={form.hero_headline}
                                onChange={e => setForm(f => ({ ...f, hero_headline: e.target.value }))}
                                className="h-11 rounded-xl border-slate-200 bg-slate-50/50 text-sm font-bold shadow-inner focus-visible:bg-white"
                              />
                              <p className="text-[9px] text-slate-400 mt-1 font-medium">Laissez vide pour afficher automatiquement le nom de votre boutique.</p>
                            </div>

                            {/* CTA */}
                            <div className="space-y-2">
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Texte du bouton principal (CTA)</label>
                              <Input
                                placeholder="Ex: Découvrir le catalogue"
                                value={form.hero_cta}
                                onChange={e => setForm(f => ({ ...f, hero_cta: e.target.value }))}
                                className="h-11 rounded-xl border-slate-200 bg-slate-50/50 text-sm font-bold shadow-inner focus-visible:bg-white"
                              />
                            </div>
                          </div>

                          {/* Subtitle */}
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Sous-titre / Accroche</label>
                            <textarea
                              placeholder={form.description || 'Ex: Découvrez nos produits exceptionnels pour un style de vie unique.'}
                              value={form.hero_subtitle}
                              onChange={e => setForm(f => ({ ...f, hero_subtitle: e.target.value }))}
                              className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50/50 text-sm font-medium resize-none outline-none focus:ring-2 focus:ring-slate-300 shadow-inner focus:bg-white transition-all min-h-[70px]"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3 — Assignation */}
              {step === 3 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h3 className="text-base font-black text-slate-900 mb-1">Assignation & Équipe</h3>
                    <p className="text-sm text-slate-400 font-medium">Configurez comment les commandes seront automatiquement assignées aux membres de votre équipe.</p>
                  </div>

                  <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-indigo-500" /> Assignation Automatique
                        </h4>
                        <p className="text-[10px] text-slate-400 mt-1">Activer ou désactiver l'assignation automatique des nouvelles commandes.</p>
                      </div>
                      <button
                        onClick={() => setForm(f => ({ ...f, assignment_active: !f.assignment_active }))}
                        className={cn(
                          "w-12 h-6 rounded-full transition-colors relative",
                          form.assignment_active ? "bg-emerald-500" : "bg-slate-200"
                        )}
                      >
                        <div className={cn(
                          "size-5 rounded-full bg-white absolute top-0.5 transition-all shadow-sm",
                          form.assignment_active ? "left-6" : "left-0.5"
                        )} />
                      </button>
                    </div>

                    {form.assignment_active && (
                      <div className="space-y-4 pt-4 border-t border-slate-100">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Règle de distribution</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {([
                            { id: 'ROUND_ROBIN', label: 'Tour de rôle (Round Robin)', desc: 'Distribue équitablement chaque commande à l\'agent suivant.', icon: Zap },
                            { id: 'LEAST_LOADED', label: 'Moins chargé (Least Loaded)', desc: 'Assigne à l\'agent ayant le moins de commandes en cours.', icon: Check },
                          ] as const).map(logic => {
                            const active = form.assignment_logic === logic.id;
                            const Icon = logic.icon;
                            return (
                              <button
                                key={logic.id}
                                onClick={() => setForm(f => ({ ...f, assignment_logic: logic.id }))}
                                className={cn(
                                  "text-left p-4 rounded-2xl border-2 transition-all group",
                                  active ? "border-indigo-500 bg-indigo-50/20 shadow-sm" : "border-slate-100 bg-slate-50/50 hover:bg-white hover:border-slate-200"
                                )}
                              >
                                <div className="flex items-start gap-3">
                                  <div className={cn(
                                    "size-8 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                                    active ? "bg-indigo-500 text-white" : "bg-white border border-slate-200 text-slate-400 group-hover:text-slate-600"
                                  )}>
                                    <Icon className="size-4" />
                                  </div>
                                  <div>
                                    <h5 className={cn("text-[11px] font-black", active ? "text-indigo-900" : "text-slate-800")}>{logic.label}</h5>
                                    <p className="text-[10px] font-medium text-slate-400 mt-0.5 leading-snug">{logic.desc}</p>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Règles opérationnelles (NRP, rappels, doublons) ── */}
                  <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-5">
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-rose-500" /> Règles NRP & Rappels
                      </h4>
                      <p className="text-[10px] text-slate-400 mt-1">Plafonds de tentatives sans réponse et délai de rappel automatique, propres à cette boutique.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Max NRP — commandes</label>
                        <input
                          type="number" min={1} max={50}
                          value={form.max_nrp_normal}
                          onChange={e => setForm(f => ({ ...f, max_nrp_normal: Math.max(1, parseInt(e.target.value) || 9) }))}
                          className="w-full h-11 px-4 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 outline-none focus:border-indigo-400"
                        />
                        <p className="text-[9px] text-slate-400">Annulation auto après N tentatives</p>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Max NRP — paniers aband.</label>
                        <input
                          type="number" min={1} max={50}
                          value={form.max_nrp_abandoned}
                          onChange={e => setForm(f => ({ ...f, max_nrp_abandoned: Math.max(1, parseInt(e.target.value) || 12) }))}
                          className="w-full h-11 px-4 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 outline-none focus:border-indigo-400"
                        />
                        <p className="text-[9px] text-slate-400">Plafond dédié aux paniers abandonnés</p>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Délai de rappel (heures)</label>
                        <input
                          type="number" min={0.5} max={72} step={0.5}
                          value={form.nrp_callback_hours}
                          onChange={e => setForm(f => ({ ...f, nrp_callback_hours: Math.max(0.5, parseFloat(e.target.value) || 2) }))}
                          className="w-full h-11 px-4 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 outline-none focus:border-indigo-400"
                        />
                        <p className="text-[9px] text-slate-400">Rappel auto planifié après chaque NRP</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                      <div>
                        <h4 className="text-xs font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-500" /> Fusion automatique des doublons
                        </h4>
                        <p className="text-[10px] text-slate-400 mt-1">Regroupe automatiquement les commandes du même téléphone en une seule commande opérationnelle (historique conservé).</p>
                      </div>
                      <button
                        onClick={() => setForm(f => ({ ...f, auto_merge_duplicates: !f.auto_merge_duplicates }))}
                        className={cn(
                          "w-12 h-6 rounded-full transition-colors relative shrink-0",
                          form.auto_merge_duplicates ? "bg-emerald-500" : "bg-slate-200"
                        )}
                      >
                        <div className={cn(
                          "size-5 rounded-full bg-white absolute top-0.5 transition-all shadow-sm",
                          form.auto_merge_duplicates ? "left-6" : "left-0.5"
                        )} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 4 — Review */}
              {step === 4 && (
                <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h3 className="text-base font-black text-slate-900 mb-1">{isEdit ? 'Prêt à modifier !' : 'Prêt à déployer !'}</h3>
                    <p className="text-sm text-slate-400 font-medium">Vérifiez les informations avant de {isEdit ? 'sauvegarder les modifications' : 'lancer votre boutique'}.</p>
                  </div>

                  <div className="space-y-3">
                    {[
                      { label: 'Nom', value: form.name || '—' },
                      { label: 'Domaine', value: form.domain || `${form.slug}.azghub.com` },
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
                      {form.domain || `${form.slug || 'ma-boutique'}.azghub.com`}
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
                  {mutation.isPending ? <Loader2 className="size-5 animate-spin" /> : (isEdit ? '✓ Enregistrer' : '🚀 Déployer la boutique')}
                </Button>
              )}
            </div>
          </div>


        </div>
      </DialogContent>
    </Dialog>
  );
}
