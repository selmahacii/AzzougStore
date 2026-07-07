'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Zap, Plus, Eye, EyeOff, Trash2, ExternalLink, Copy,
  LayoutTemplate, Package, FileText, Loader2, X, Check,
  ChevronRight, BarChart3, Star, ArrowRight, Palette,
  Image as ImageIcon, MessageSquare, HelpCircle, Settings,
  TrendingUp, Users, ShoppingCart, Link, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LandingPage {
  id: string;
  store_id: string;
  product_id: string | null;
  slug: string;
  mode: 'product' | 'standalone';
  is_active: boolean;
  views: number;
  orders: number;
  headline: string;
  subtitle: string;
  badge_text: string;
  cta_label: string;
  image_url: string | null;
  product_name: string | null;
  price: number | null;
  compare_price: number | null;
  primary_color: string;
  template: string;
  benefits: Array<{ icon: string; title: string; desc: string }>;
  testimonials: Array<{ name: string; location: string; text: string; stars: number }>;
  steps: Array<{ step: string; title: string; desc: string }>;
  stats: Array<{ value: number; suffix: string; label: string }>;
  faq: Array<{ question: string; answer: string }>;
  phone: string | null;
  created_at: string;
  product: { id: string; name: string; main_image: string | null; price: number } | null;
}

interface ProductOption { id: string; name: string; main_image: string | null; price: number; slug: string }

// ─── Colors ───────────────────────────────────────────────────────────────────
const C = {
  primary: '#6C5CE7', bg: '#F8F9FC', border: '#E9ECF0',
  text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3',
  success: '#00B894', danger: '#E17055', warning: '#FDCB6E',
};

const TEMPLATES = [
  { id: 'premium',  label: 'Modern Premium', preview: 'bg-gradient-to-br from-indigo-900 to-purple-900', text: 'text-white', badge: '💎 Ultra' },
  { id: 'dark',     label: 'Dark Sleek',    preview: 'bg-[#080808]', text: 'text-white',   badge: '🔥 Populaire' },
  { id: 'light',    label: 'Light Clean',   preview: 'bg-white',     text: 'text-gray-900', badge: '' },
  { id: 'brand',    label: 'Brand Color',   preview: 'bg-[#6C5CE7]', text: 'text-white',   badge: '✨ Nouveau' },
];

const PRESET_COLORS = ['#e84393','#6C5CE7','#0984E3','#00B894','#FDCB6E','#E17055','#2D3436','#FF6B35'];

// ─── LP Card ──────────────────────────────────────────────────────────────────
function LandingPageCard({
  lp, storeSlug, onEdit, onToggle, onDelete, onCopy,
}: {
  lp: LandingPage; storeSlug: string;
  onEdit: () => void; onToggle: () => void; onDelete: () => void; onCopy: () => void;
}) {
  const url = `${window.location.origin}/lp/${lp.slug}?store=${storeSlug}`;
  const convRate = lp.views > 0 ? ((lp.orders / lp.views) * 100).toFixed(1) : '0.0';

  return (
    <div className={cn(
      "bg-white rounded-[28px] border overflow-hidden transition-all hover:shadow-lg hover:shadow-slate-100 group",
      lp.is_active ? "border-slate-100" : "border-dashed border-slate-200 opacity-70"
    )}>
      {/* Thumbnail */}
      <div className="relative h-36 overflow-hidden" style={{ backgroundColor: lp.primary_color + '15' }}>
        {lp.image_url ? (
          <img src={lp.image_url} alt="" className="w-full h-full object-cover opacity-70" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <LayoutTemplate className="size-12 opacity-20" style={{ color: lp.primary_color }} />
          </div>
        )}
        {/* Template badge */}
        <div className="absolute top-3 left-3">
          <span className="px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider text-white"
            style={{ backgroundColor: lp.primary_color }}>
            {lp.template}
          </span>
        </div>
        {/* Active badge */}
        <div className="absolute top-3 right-3">
          <span className={cn("px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider",
            lp.is_active ? "bg-emerald-500 text-white" : "bg-slate-400 text-white")}>
            {lp.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      <div className="p-5">
        {/* Mode pill */}
        <div className="flex items-center gap-2 mb-2">
          {lp.mode === 'product' ? (
            <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full bg-[#6C5CE7]/10 text-[#6C5CE7]">
              <Package className="size-2.5" /> Produit lié
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full bg-amber-100 text-amber-700">
              <FileText className="size-2.5" /> Standalone
            </span>
          )}
        </div>

        <h3 className="text-sm font-black text-slate-800 truncate mb-1">{lp.headline || lp.product_name || '—'}</h3>
        <p className="text-[10px] text-slate-400 font-medium font-mono truncate mb-4">/lp/{lp.slug}</p>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: 'Vues',    value: lp.views,  icon: Eye },
            { label: 'Ordres',  value: lp.orders, icon: ShoppingCart },
            { label: 'Conv.',   value: `${convRate}%`, icon: TrendingUp },
          ].map(s => (
            <div key={s.label} className="text-center p-2 bg-slate-50 rounded-xl">
              <p className="text-sm font-black text-slate-800">{s.value}</p>
              <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={onEdit}
            className="flex-1 h-9 rounded-xl bg-[#6C5CE7] text-white text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 hover:bg-[#5a4bd1] transition-all">
            <Settings className="size-3.5" /> Modifier
          </button>
          <button onClick={onCopy} title="Copier le lien"
            className="h-9 w-9 rounded-xl border border-slate-200 text-slate-500 flex items-center justify-center hover:bg-slate-50 transition-all">
            <Copy className="size-3.5" />
          </button>
          <a href={url} target="_blank" rel="noreferrer" title="Voir la page"
            className="h-9 w-9 rounded-xl border border-slate-200 text-slate-500 flex items-center justify-center hover:bg-slate-50 transition-all">
            <ExternalLink className="size-3.5" />
          </a>
          <button onClick={onToggle} title={lp.is_active ? 'Désactiver' : 'Activer'}
            className="h-9 w-9 rounded-xl border border-slate-200 text-slate-500 flex items-center justify-center hover:bg-slate-50 transition-all">
            {lp.is_active ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
          <button onClick={onDelete} title="Supprimer"
            className="h-9 w-9 rounded-xl border border-rose-100 text-rose-400 flex items-center justify-center hover:bg-rose-50 transition-all">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Create / Edit Modal ───────────────────────────────────────────────────────
function LandingPageModal({
  open, onClose, storeId, existing, onSaved,
}: {
  open: boolean; onClose: () => void; storeId: string;
  existing?: LandingPage | null; onSaved: () => void;
}) {
  const isEdit = !!existing;

  // Step 1: choose mode
  const [mode, setMode] = useState<'product' | 'standalone' | 'new_product'>(existing?.mode || 'product');
  const [step, setStep] = useState<'pick' | 'form'>(isEdit ? 'form' : 'pick');

  // Product picker
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null);
  const [productSearch, setProductSearch] = useState('');

  // New Product fields
  const [newProductSku, setNewProductSku] = useState('');
  const [newProductStock, setNewProductStock] = useState('50');
  const [newProductCost, setNewProductCost] = useState('');

  // Form state
  const [headline, setHeadline] = useState(existing?.headline || '');
  const [subtitle, setSubtitle] = useState(existing?.subtitle || '');
  const [badgeText, setBadgeText] = useState(existing?.badge_text || 'Offre limitée');
  const [ctaLabel, setCtaLabel] = useState(existing?.cta_label || 'Commander maintenant');
  const [imageUrl, setImageUrl] = useState(existing?.image_url || '');
  const [phone, setPhone] = useState(existing?.phone || '');
  const [primaryColor, setPrimaryColor] = useState(existing?.primary_color || '#e84393');
  const [template, setTemplate] = useState(existing?.template || 'dark');
  const [price, setPrice] = useState(existing?.price?.toString() || '');
  const [comparePrice, setComparePrice] = useState(existing?.compare_price?.toString() || '');
  const [benefits, setBenefits] = useState(existing?.benefits || [
    { icon: 'Truck',       title: 'Livraison express', desc: '48h partout en Algérie' },
    { icon: 'ShieldCheck', title: 'Paiement à livraison', desc: 'Vous payez à réception' },
    { icon: 'RotateCcw',   title: 'Retour 14 jours', desc: 'Échange sans tracas' },
  ]);
  const [testimonials, setTestimonials] = useState(existing?.testimonials || [
    { name: 'Yasmine B.', location: 'Alger', text: 'Reçu en 2 jours, emballage soigné, produit conforme.', stars: 5 },
    { name: 'Karim M.', location: 'Oran', text: 'Exactement comme la photo. Je recommande vivement !', stars: 5 },
    { name: 'Samira L.', location: 'Constantine', text: 'Service client rapide, très satisfaite de mon achat.', stars: 5 },
  ]);
  const [faq, setFaq] = useState(existing?.faq || [] as Array<{ question: string; answer: string }>);
  const [saving, setSaving] = useState(false);

  const productsQuery = useQuery({
    queryKey: ['products-for-lp', storeId, productSearch],
    queryFn: () => apiFetch<any>(`/api/v1/products?store_id=${storeId}&search=${productSearch}&limit=30&is_active=true`),
    enabled: open && step === 'pick' && mode === 'product',
  });
  const products: ProductOption[] = productsQuery.data?.data ?? productsQuery.data ?? [];

  // Pre-fill from selected product
  useEffect(() => {
    if (selectedProduct && !isEdit) {
      setHeadline(selectedProduct.name);
      setImageUrl(selectedProduct.main_image || '');
      setPrice(selectedProduct.price?.toString() || '');
    }
  }, [selectedProduct, isEdit]);

  const handleSave = async () => {
    if (!headline.trim()) { toast.error('Le titre est requis'); return; }
    setSaving(true);
    try {
      let finalProductId = selectedProduct?.id || existing?.product_id || null;

      // If mode is new_product, create the product first
      if (mode === 'new_product' && !isEdit) {
        const slug = headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const sku = newProductSku || `LP-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
        
        const pBody = {
          name: headline,
          slug,
          sku,
          price: parseInt(price) || 0,
          compare_price: parseInt(comparePrice) || 0,
          cost_price: parseInt(newProductCost) || 0,
          stock: parseInt(newProductStock) || 0,
          store_id: storeId,
          main_image: imageUrl || null,
          description: subtitle || '',
          is_active: true
        };

        const newP = await apiFetch<any>('/api/v1/products/', { 
          method: 'POST', 
          body: JSON.stringify(pBody) 
        });
        finalProductId = newP.id || newP.data?.id;
        toast.success('Produit ERP créé !');
      }

      const body: any = {
        store_id: storeId,
        mode: mode === 'new_product' ? 'product' : mode, // Convert back to product mode for storage
        product_id: finalProductId,
        headline,
        subtitle,
        badge_text: badgeText,
        cta_label: ctaLabel,
        image_url: imageUrl || null,
        phone: phone || null,
        primary_color: primaryColor,
        template,
        price: price ? parseInt(price) : null,
        compare_price: comparePrice ? parseInt(comparePrice) : null,
        benefits,
        testimonials,
        faq,
      };

      if (isEdit) {
        await apiFetch(`/api/v1/landing-pages/${existing!.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.success('Landing page mise à jour');
      } else {
        await apiFetch('/api/v1/landing-pages', { method: 'POST', body: JSON.stringify(body) });
        toast.success('Landing page créée !');
      }
      onSaved();
      qc.invalidateQueries({ queryKey: ['admin-products-stock'] });
      qc.invalidateQueries({ queryKey: ['inventory', 'summary'] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl p-0 border-none shadow-2xl overflow-hidden flex flex-col w-[98vw] h-[95dvh] rounded-[32px]">
        {/* Header */}
        <div className="px-7 py-5 border-b border-slate-100 flex items-center justify-between shrink-0 bg-gradient-to-r from-[#6C5CE7] to-[#a855f7]">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-xl bg-white/20 flex items-center justify-center">
              <Zap className="size-5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-sm font-black text-white uppercase tracking-wider">
                {isEdit ? 'Modifier la landing page' : 'Nouvelle landing page'}
              </DialogTitle>
              <p className="text-white/50 text-[10px] font-bold mt-0.5">
                {step === 'pick' ? 'Étape 1/2 — Choisir le mode' : 'Étape 2/2 — Configurer le contenu'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/10 transition-all">
            <X className="size-4 text-white/60" />
          </button>
        </div>

        {/* Step 1: Mode picker */}
        {step === 'pick' && (
          <div className="flex-1 overflow-y-auto p-7 space-y-6">
            {/* Mode selection */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                {
                  id: 'product', icon: Package, color: '#6C5CE7',
                  title: 'Produit existant',
                  desc: 'Sélectionnez un produit déjà dans votre boutique. Les infos (nom, prix, image) sont pré-remplies automatiquement.',
                  badge: 'Recommandé',
                },
                {
                  id: 'standalone', icon: FileText, color: '#E17055',
                  title: 'Page personnalisée',
                  desc: 'Créez une landing page complète avec tous les détails manuellement. Idéal pour un produit externe ou une promotion spéciale.',
                  badge: 'Flexible',
                },
                {
                  id: 'new_product', icon: Zap, color: '#00B894',
                  title: 'Nouveau Produit ERP',
                  desc: 'Créez à la fois le produit dans votre stock/ERP et la landing page. Gère automatiquement les entrées de stock.',
                  badge: 'Complet ✨',
                },
              ].map(opt => (
                <button key={opt.id} onClick={() => setMode(opt.id as any)}
                  className={cn(
                    "p-6 rounded-[24px] border-2 text-left transition-all space-y-3",
                    mode === opt.id ? "border-[#6C5CE7] bg-[#6C5CE7]/5 shadow-lg shadow-[#6C5CE7]/10" : "border-slate-200 bg-white hover:border-slate-300"
                  )}>
                  <div className="flex items-center justify-between">
                    <div className="size-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: opt.color + '15' }}>
                      <opt.icon className="size-6" style={{ color: opt.color }} />
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full" style={{ backgroundColor: opt.color + '15', color: opt.color }}>
                      {opt.badge}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-800 mb-1">{opt.title}</h3>
                    <p className="text-[11px] text-slate-500 font-medium leading-relaxed">{opt.desc}</p>
                  </div>
                  {mode === opt.id && <div className="flex items-center gap-1.5 text-[#6C5CE7] text-[10px] font-black"><Check className="size-3.5" /> Sélectionné</div>}
                </button>
              ))}
            </div>

            {/* Product picker (if mode=product) */}
            {mode === 'product' && (
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sélectionner un produit</p>
                <div className="relative">
                  <input
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                    placeholder="Rechercher un produit..."
                    className="w-full h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-700 focus:outline-none focus:border-[#6C5CE7] transition-all"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                  {productsQuery.isLoading ? (
                    <div className="flex items-center justify-center py-8"><Loader2 className="size-5 animate-spin text-slate-300" /></div>
                  ) : products.length === 0 ? (
                    <div className="text-center py-8 text-slate-300 text-xs font-bold">Aucun produit trouvé</div>
                  ) : products.map(p => (
                    <button key={p.id} onClick={() => setSelectedProduct(p)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-2xl border transition-all text-left",
                        selectedProduct?.id === p.id ? "border-[#6C5CE7] bg-[#6C5CE7]/5" : "border-slate-100 bg-white hover:border-slate-200"
                      )}>
                      <div className="size-12 rounded-xl overflow-hidden bg-slate-100 shrink-0">
                        {p.main_image ? <img src={p.main_image} alt="" className="w-full h-full object-cover" /> : <Package className="size-5 text-slate-300 m-auto mt-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black text-slate-800 truncate">{p.name}</p>
                        <p className="text-[10px] font-bold text-[#6C5CE7] mt-0.5">{formatPrice(p.price)} DA</p>
                      </div>
                      {selectedProduct?.id === p.id && <Check className="size-4 text-[#6C5CE7] shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* New Product Extra Fields (if mode=new_product) */}
            {mode === 'new_product' && (
              <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Détails du Stock ERP</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase">Stock Initial</label>
                    <Input type="number" value={newProductStock} onChange={e => setNewProductStock(e.target.value)} className="h-11 rounded-xl border-slate-200" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase">SKU (Optionnel)</label>
                    <Input value={newProductSku} onChange={e => setNewProductSku(e.target.value)} placeholder="AUTO-GEN" className="h-11 rounded-xl border-slate-200" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase">Coût Achat (DA)</label>
                    <Input type="number" value={newProductCost} onChange={e => setNewProductCost(e.target.value)} className="h-11 rounded-xl border-slate-200" />
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button
                onClick={() => setStep('form')}
                disabled={mode === 'product' && !selectedProduct}
                className="h-12 px-8 rounded-2xl font-black uppercase tracking-wider text-[11px] bg-[#6C5CE7] text-white hover:bg-[#5a4bd1]"
              >
                Continuer <ArrowRight className="size-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Full form */}
        {step === 'form' && (
          <>
            <div className="flex-1 overflow-y-auto">
              <Tabs defaultValue="hero">
                {/* Tab bar */}
                <div className="px-7 border-b border-slate-100 bg-slate-50/50 overflow-x-auto">
                  <TabsList className="h-13 bg-transparent gap-4 border-0 flex-nowrap">
                    {[
                      { id: 'hero',     label: '🎯 Hero',         },
                      { id: 'style',    label: '🎨 Style',        },
                      { id: 'benefits', label: '✅ Avantages',    },
                      { id: 'reviews',  label: '⭐ Témoignages',  },
                      { id: 'faq',      label: '❓ FAQ',          },
                    ].map(t => (
                      <TabsTrigger key={t.id} value={t.id}
                        className="h-12 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-[#6C5CE7] rounded-none px-0 text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-slate-800 whitespace-nowrap">
                        {t.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>

                <div className="p-7 space-y-5">

                  {/* ── HERO ── */}
                  <TabsContent value="hero" className="mt-0 space-y-5">
                    {selectedProduct && (
                      <div className="flex items-center gap-3 p-3 bg-[#6C5CE7]/5 border border-[#6C5CE7]/20 rounded-2xl">
                        {selectedProduct.main_image && <img src={selectedProduct.main_image} alt="" className="size-10 rounded-xl object-cover" />}
                        <div>
                          <p className="text-xs font-black text-[#6C5CE7]">{selectedProduct.name}</p>
                          <p className="text-[10px] text-slate-400 font-medium">Produit lié · {formatPrice(selectedProduct.price)} DA</p>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="sm:col-span-2 space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Titre principal *</label>
                        <Input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="Ex: La Crème Révolutionnaire Made in DZ" className="h-12 rounded-2xl border-slate-200 text-sm font-bold" />
                      </div>
                      <div className="sm:col-span-2 space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sous-titre</label>
                        <Textarea value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="Description courte et percutante..." rows={3} className="rounded-2xl border-slate-200 text-sm font-medium resize-none" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Badge d'urgence</label>
                        <Input value={badgeText} onChange={e => setBadgeText(e.target.value)} placeholder="Offre limitée" className="h-11 rounded-2xl border-slate-200 text-sm font-bold" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bouton CTA</label>
                        <Input value={ctaLabel} onChange={e => setCtaLabel(e.target.value)} placeholder="Commander maintenant" className="h-11 rounded-2xl border-slate-200 text-sm font-bold" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Prix (DA)</label>
                        <Input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="Ex: 2900" className="h-11 rounded-2xl border-slate-200 text-sm font-bold" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Prix barré (DA)</label>
                        <Input type="number" value={comparePrice} onChange={e => setComparePrice(e.target.value)} placeholder="Ex: 4500" className="h-11 rounded-2xl border-slate-200 text-sm font-bold" />
                      </div>
                      <div className="sm:col-span-2 space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Image hero (URL)</label>
                        <div className="flex gap-2">
                          <Input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://..." className="h-11 rounded-2xl border-slate-200 text-sm font-medium flex-1" />
                          {imageUrl && <img src={imageUrl} alt="" className="size-11 rounded-xl object-cover border border-slate-200 shrink-0" onError={e => (e.currentTarget.style.display='none')} />}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Téléphone (optionnel)</label>
                        <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+213 XX XX XX XX" className="h-11 rounded-2xl border-slate-200 text-sm font-bold" />
                      </div>
                    </div>
                  </TabsContent>

                  {/* ── STYLE ── */}
                  <TabsContent value="style" className="mt-0 space-y-5">
                    <div className="space-y-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Template</p>
                      <div className="grid grid-cols-3 gap-3">
                        {TEMPLATES.map(t => (
                          <button key={t.id} onClick={() => setTemplate(t.id)}
                            className={cn("relative p-4 rounded-2xl border-2 transition-all overflow-hidden h-24",
                              template === t.id ? "border-[#6C5CE7]" : "border-slate-200 hover:border-slate-300"
                            )}>
                            <div className={cn("absolute inset-0", t.preview, "opacity-80")} />
                            <div className="relative z-10">
                              <p className={cn("text-xs font-black", t.text)}>{t.label}</p>
                              {t.badge && <p className="text-[9px] font-bold mt-1 text-amber-400">{t.badge}</p>}
                            </div>
                            {template === t.id && (
                              <div className="absolute top-2 right-2 size-5 rounded-full bg-[#6C5CE7] flex items-center justify-center">
                                <Check className="size-3 text-white" />
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Couleur principale</p>
                      <div className="flex items-center gap-3 flex-wrap">
                        {PRESET_COLORS.map(c => (
                          <button key={c} onClick={() => setPrimaryColor(c)}
                            className="size-9 rounded-full border-2 transition-all"
                            style={{ backgroundColor: c, borderColor: primaryColor === c ? '#2D3436' : 'transparent', boxShadow: primaryColor === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none' }} />
                        ))}
                        <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
                          className="size-9 rounded-full cursor-pointer border-2 border-slate-200" title="Couleur personnalisée" />
                      </div>
                      <div className="p-4 rounded-2xl border border-slate-100 flex items-center gap-4" style={{ backgroundColor: primaryColor + '10' }}>
                        <div className="size-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: primaryColor }}>
                          <Zap className="size-6 text-white" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-slate-800">Aperçu couleur</p>
                          <p className="text-[10px] font-mono text-slate-500 mt-0.5">{primaryColor}</p>
                        </div>
                        <button className="ml-auto px-4 py-2 rounded-xl text-xs font-black text-white" style={{ backgroundColor: primaryColor }}>
                          Commander
                        </button>
                      </div>
                    </div>
                  </TabsContent>

                  {/* ── BENEFITS ── */}
                  <TabsContent value="benefits" className="mt-0 space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">3 avantages clés (affichés sous le hero)</p>
                    {benefits.map((b, i) => (
                      <div key={i} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                        <p className="text-[10px] font-black text-slate-400 uppercase">Avantage {i + 1}</p>
                        <div className="grid grid-cols-2 gap-3">
                          <Input value={b.title} onChange={e => setBenefits(bens => bens.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                            placeholder="Titre" className="h-10 rounded-xl border-slate-200 text-sm font-bold" />
                          <Input value={b.desc} onChange={e => setBenefits(bens => bens.map((x, j) => j === i ? { ...x, desc: e.target.value } : x))}
                            placeholder="Description courte" className="h-10 rounded-xl border-slate-200 text-sm" />
                        </div>
                      </div>
                    ))}
                  </TabsContent>

                  {/* ── TESTIMONIALS ── */}
                  <TabsContent value="reviews" className="mt-0 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Témoignages clients</p>
                      <button onClick={() => setTestimonials(t => [...t, { name: '', location: '', text: '', stars: 5 }])}
                        className="flex items-center gap-1.5 text-[10px] font-black text-[#6C5CE7] hover:underline">
                        <Plus className="size-3.5" /> Ajouter
                      </button>
                    </div>
                    {testimonials.map((t, i) => (
                      <div key={i} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-black text-slate-400 uppercase">Avis {i + 1}</p>
                          <button onClick={() => setTestimonials(ts => ts.filter((_, j) => j !== i))} className="text-rose-400 hover:text-rose-600">
                            <X className="size-3.5" />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <Input value={t.name} onChange={e => setTestimonials(ts => ts.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                            placeholder="Nom du client" className="h-10 rounded-xl border-slate-200 text-sm font-bold" />
                          <Input value={t.location} onChange={e => setTestimonials(ts => ts.map((x, j) => j === i ? { ...x, location: e.target.value } : x))}
                            placeholder="Ville (Alger, Oran...)" className="h-10 rounded-xl border-slate-200 text-sm" />
                        </div>
                        <Textarea value={t.text} onChange={e => setTestimonials(ts => ts.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                          placeholder="Texte de l'avis..." rows={2} className="rounded-xl border-slate-200 text-sm resize-none" />
                        <div className="flex gap-1">
                          {[1,2,3,4,5].map(s => (
                            <button key={s} onClick={() => setTestimonials(ts => ts.map((x, j) => j === i ? { ...x, stars: s } : x))}>
                              <Star className={cn("size-5 transition-colors", s <= t.stars ? "fill-amber-400 text-amber-400" : "text-slate-300")} />
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </TabsContent>

                  {/* ── FAQ ── */}
                  <TabsContent value="faq" className="mt-0 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Questions fréquentes</p>
                      <button onClick={() => setFaq(f => [...f, { question: '', answer: '' }])}
                        className="flex items-center gap-1.5 text-[10px] font-black text-[#6C5CE7] hover:underline">
                        <Plus className="size-3.5" /> Ajouter
                      </button>
                    </div>
                    {faq.length === 0 && (
                      <div className="text-center py-8 text-slate-300">
                        <HelpCircle className="size-10 mx-auto mb-2" />
                        <p className="text-xs font-bold uppercase">Aucune FAQ — cliquez "Ajouter"</p>
                      </div>
                    )}
                    {faq.map((f, i) => (
                      <div key={i} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-black text-slate-400 uppercase">Q{i + 1}</p>
                          <button onClick={() => setFaq(fs => fs.filter((_, j) => j !== i))} className="text-rose-400"><X className="size-3.5" /></button>
                        </div>
                        <Input value={f.question} onChange={e => setFaq(fs => fs.map((x, j) => j === i ? { ...x, question: e.target.value } : x))}
                          placeholder="Question..." className="h-10 rounded-xl border-slate-200 text-sm font-bold" />
                        <Textarea value={f.answer} onChange={e => setFaq(fs => fs.map((x, j) => j === i ? { ...x, answer: e.target.value } : x))}
                          placeholder="Réponse détaillée..." rows={2} className="rounded-xl border-slate-200 text-sm resize-none" />
                      </div>
                    ))}
                  </TabsContent>

                </div>
              </Tabs>
            </div>

            {/* Footer */}
            <div className="px-7 py-4 border-t border-slate-100 bg-white flex items-center justify-between shrink-0">
              {!isEdit && (
                <button onClick={() => setStep('pick')} className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors">
                  <ChevronRight className="size-4 rotate-180" /> Retour
                </button>
              )}
              <div className={cn("flex items-center gap-3", isEdit && "ml-auto")}>
                <Button variant="ghost" onClick={onClose} className="h-11 px-5 rounded-2xl font-bold text-slate-400">Annuler</Button>
                <Button onClick={handleSave} disabled={saving || !headline.trim()}
                  className="h-11 px-8 rounded-2xl font-black uppercase tracking-wider text-[11px] text-white bg-[#6C5CE7] hover:bg-[#5a4bd1]">
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <><Check className="size-4 mr-1.5" />{isEdit ? 'Sauvegarder' : 'Créer la page'}</>}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export default function LandingPagesDashboard() {
  const { activeStore } = useAppStore();
  const storeId  = activeStore?.id ?? '';
  const storeSlug = activeStore?.slug ?? '';
  const qc = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [editingLP, setEditingLP]   = useState<LandingPage | null>(null);

  const { data: raw, isLoading } = useQuery({
    queryKey: ['landing-pages', storeId],
    queryFn:  () => apiFetch<any>(`/api/v1/landing-pages?store_id=${storeId}`),
    enabled:  !!storeId,
  });

  const pages: LandingPage[] = raw?.data ?? raw ?? [];

  const toggleMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/landing-pages/${id}/toggle`, { method: 'PATCH' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['landing-pages'] }); toast.success('Statut modifié'); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/landing-pages/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['landing-pages'] }); toast.success('Page supprimée'); },
  });

  const handleCopy = (slug: string) => {
    const url = `${window.location.origin}/lp/${slug}?store=${storeSlug}`;
    navigator.clipboard.writeText(url).then(() => toast.success('Lien copié !'));
  };

  const totalViews  = pages.reduce((s, p) => s + (p.views || 0), 0);
  const totalOrders = pages.reduce((s, p) => s + (p.orders || 0), 0);
  const activeCount = pages.filter(p => p.is_active).length;

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">

      {/* ── Header ── */}
      <div className="bg-gradient-to-br from-[#6C5CE7] to-[#a855f7] rounded-[40px] p-7 sm:p-8 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 opacity-10"><Zap className="size-48 text-white" /></div>
        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-center gap-5">
            <div className="size-14 rounded-3xl bg-white/20 flex items-center justify-center shrink-0">
              <Zap className="size-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white uppercase tracking-tight">Landing Pages</h1>
              <p className="text-white/50 text-xs font-bold mt-1">Pages de vente optimisées pour convertir</p>
            </div>
          </div>
          <Button onClick={() => setShowCreate(true)}
            className="h-12 px-7 rounded-2xl bg-white text-[#6C5CE7] font-black uppercase tracking-wider text-[11px] hover:bg-white/90 shadow-xl shrink-0">
            <Plus className="size-4 mr-2" /> Nouvelle landing page
          </Button>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-4 mt-7">
          {[
            { label: 'Pages actives', value: activeCount, icon: '🟢' },
            { label: 'Vues totales',  value: totalViews.toLocaleString('fr-FR'),  icon: '👁️' },
            { label: 'Commandes générées', value: totalOrders, icon: '🛒' },
          ].map(k => (
            <div key={k.label} className="bg-white/10 rounded-2xl p-4">
              <p className="text-2xl font-black text-white">{k.icon} {k.value}</p>
              <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mt-1">{k.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Grid ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1,2,3].map(i => <div key={i} className="h-64 rounded-[28px] bg-slate-100 animate-pulse" />)}
        </div>
      ) : pages.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-[32px] border border-dashed border-slate-200">
          <Zap className="size-12 mx-auto text-slate-200 mb-4" />
          <p className="text-sm font-black text-slate-400 uppercase tracking-widest mb-2">Aucune landing page</p>
          <p className="text-xs text-slate-400 mb-6">Créez votre première page de vente en quelques clics</p>
          <Button onClick={() => setShowCreate(true)} className="h-11 px-7 rounded-2xl bg-[#6C5CE7] text-white font-black uppercase tracking-wider text-[11px]">
            <Plus className="size-4 mr-2" /> Créer maintenant
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {pages.map(lp => (
            <LandingPageCard
              key={lp.id}
              lp={lp}
              storeSlug={storeSlug}
              onEdit={() => setEditingLP(lp)}
              onToggle={() => toggleMutation.mutate(lp.id)}
              onDelete={() => { if (confirm('Supprimer cette landing page ?')) deleteMutation.mutate(lp.id); }}
              onCopy={() => handleCopy(lp.slug)}
            />
          ))}

          {/* Add card */}
          <button onClick={() => setShowCreate(true)}
            className="border-2 border-dashed border-slate-200 rounded-[28px] p-7 flex flex-col items-center justify-center gap-3 hover:border-[#6C5CE7] hover:bg-[#6C5CE7]/5 transition-all group min-h-[280px]">
            <div className="size-14 rounded-2xl bg-slate-100 group-hover:bg-[#6C5CE7]/10 flex items-center justify-center transition-all">
              <Plus className="size-7 text-slate-400 group-hover:text-[#6C5CE7] transition-colors" />
            </div>
            <p className="text-xs font-black text-slate-400 group-hover:text-[#6C5CE7] uppercase tracking-wider transition-colors">Nouvelle page</p>
          </button>
        </div>
      )}

      {/* Modals */}
      <LandingPageModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        storeId={storeId}
        onSaved={() => qc.invalidateQueries({ queryKey: ['landing-pages'] })}
      />
      {editingLP && (
        <LandingPageModal
          open={!!editingLP}
          onClose={() => setEditingLP(null)}
          storeId={storeId}
          existing={editingLP}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['landing-pages'] }); setEditingLP(null); }}
        />
      )}
    </div>
  );
}
