'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Zap, Plus, Eye, EyeOff, Trash2, ExternalLink, Copy,
  LayoutTemplate, Package, FileText, Loader2, X, Check,
  ChevronRight, BarChart3, Star, ArrowRight, Palette,
  Image as ImageIcon, MessageSquare, HelpCircle, Settings,
  TrendingUp, Users, ShoppingCart, Link, RefreshCw, Calendar,
  Truck, Upload, Sparkles, ShieldCheck, AlertTriangle, AlertCircle,
  ArrowUpRight, ArrowDownRight, Activity, Percent, Layers, Globe,
  CheckCircle2, ChevronDown, ChevronUp, Info, MousePointerClick,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { WILAYAS } from '@/lib/wilaya-data';

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
  cta2_label: string | null;
  image_url: string | null;
  cta_headline: string | null;
  cta_subtitle: string | null;
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
  offers?: any[];
  phone: string | null;
  banner_image_url?: string | null;
  metrics?: {
    orders: number;
    purchases: number;
    delivered: number;
    confirmed_delivered: number;
    recovered: number;
    abandoned: number;
    normal: number;
    cancelled: number;
    duplicates: number;
    meta_purchases?: number;
    meta_impressions?: number;
    meta_last_synced_at?: string | null;
    [key: string]: any;
  } | null;
  stock_detail?: {
    stock: number;
    variants_total: number;
    variants_in_stock: number;
  } | null;

  created_at: string;
  product: any;
}

interface ProductOption { 
  id: string; 
  name: string; 
  main_image: string | null; 
  price: number; 
  slug: string;
  delivery_fees?: any;
  deliveryFees?: any;
  variants?: any[];
}

// ─── Colors ───────────────────────────────────────────────────────────────────
const C = {
  primary: '#6C5CE7', bg: '#F8F9FC', border: '#E9ECF0',
  text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3',
  success: '#00B894', danger: '#E17055', warning: '#FDCB6E',
};

const TEMPLATES = [
  { id: 'light',    label: 'Clair & Épuré',   preview: 'bg-white',     text: 'text-slate-900' },
  { id: 'dark',     label: 'Sombre & Moderne', preview: 'bg-slate-900', text: 'text-white' },
  { id: 'brand',    label: 'Couleur Marque',   preview: 'bg-slate-50', text: 'text-slate-900' },
  { id: 'dz_cod',   label: 'Classique DZ COD', preview: 'bg-red-50', text: 'text-red-900' },
];

const PRESET_COLORS = ['#1e293b', '#475569', '#3b82f6', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'];

function toLocalYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── LP Analytics & Performance Center ─────────────────────────────────────────
function LandingPageAnalyticsDialog({ lp, onClose, onEdit }: { lp: LandingPage; onClose: () => void; onEdit?: () => void }) {
  const [periodPreset, setPeriodPreset] = useState<string>('this_month');
  const [dStart, setDStart] = useState(() => {
    const now = new Date();
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    return toLocalYYYYMMDD(s);
  });
  const [dEnd, setDEnd] = useState(() => toLocalYYYYMMDD(new Date()));
  const [comparePrevious, setComparePrevious] = useState(true);
  const [activeChartTab, setActiveChartTab] = useState<'orders' | 'conversion' | 'funnel' | 'status' | 'logistics'>('orders');
  const [showReconciliationModal, setShowReconciliationModal] = useState(false);
  const [showHealthBreakdown, setShowHealthBreakdown] = useState(false);
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  const [isVariantsOpen, setIsVariantsOpen] = useState(false);

  const applyPreset = (preset: string) => {
    setPeriodPreset(preset);
    const now = new Date();
    if (preset === 'today') {
      const todayStr = toLocalYYYYMMDD(now);
      setDStart(todayStr);
      setDEnd(todayStr);
    } else if (preset === 'yesterday') {
      const y = new Date(); y.setDate(y.getDate() - 1);
      const yStr = toLocalYYYYMMDD(y);
      setDStart(yStr);
      setDEnd(yStr);
    } else if (preset === '7d') {
      const s = new Date(); s.setDate(s.getDate() - 7);
      setDStart(toLocalYYYYMMDD(s));
      setDEnd(toLocalYYYYMMDD(now));
    } else if (preset === '14d') {
      const s = new Date(); s.setDate(s.getDate() - 14);
      setDStart(toLocalYYYYMMDD(s));
      setDEnd(toLocalYYYYMMDD(now));
    } else if (preset === '30d') {
      const s = new Date(); s.setDate(s.getDate() - 30);
      setDStart(toLocalYYYYMMDD(s));
      setDEnd(toLocalYYYYMMDD(now));
    } else if (preset === 'this_month') {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      setDStart(toLocalYYYYMMDD(s));
      setDEnd(toLocalYYYYMMDD(now));
    } else if (preset === 'last_month') {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      setDStart(toLocalYYYYMMDD(s));
      setDEnd(toLocalYYYYMMDD(e));
    }
  };

  const analyticsQuery = useQuery<any>({
    queryKey: ['lp-performance-center', lp.id, dStart, dEnd, comparePrevious],
    queryFn: () =>
      apiFetch(`/api/v1/landing-pages/${lp.id}/analytics?start_date=${dStart}T00:00:00.000Z&end_date=${dEnd}T23:59:59.999Z&compare_previous=${comparePrevious}`),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const reconQuery = useQuery<any>({
    queryKey: ['lp-recon-events', lp.id, dStart, dEnd],
    queryFn: () =>
      apiFetch(`/api/v1/landing-pages/${lp.id}/reconciliation-events?start_date=${dStart}T00:00:00.000Z&end_date=${dEnd}T23:59:59.999Z`),
    enabled: showReconciliationModal,
    staleTime: 30 * 1000,
  });

  const data = analyticsQuery.data?.data;
  const kpis = data?.kpis || {};
  const health = data?.health_score || {};
  const meta = data?.meta_performance || {};
  const funnel = data?.funnel || [];
  const charts = data?.charts || {};
  const alerts = data?.alerts || [];
  const quality = data?.quality || {};
  const reconciliation = data?.reconciliation || {};
  const diagnostic = data?.diagnostic_table || [];
  const period = data?.period || {};
  const variantsList = data?.variants_breakdown || [];
  const totalDeliveredVariants = variantsList.reduce((acc: number, v: any) => acc + (v.delivered || 0), 0);
  const totalOrderedVariants = variantsList.reduce((acc: number, v: any) => acc + (v.total_ordered || 0), 0);

  const copyUrl = () => {
    const url = `${window.location.origin}/lp/${lp.slug}`;
    navigator.clipboard.writeText(url);
    toast.success('URL copiée dans le presse-papier !');
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[96vw] max-w-[1100px] max-h-[92dvh] overflow-y-auto custom-scrollbar bg-white dark:bg-slate-950 p-0 border border-slate-200/80 dark:border-slate-800 rounded-3xl shadow-2xl">
        {/* ─── 1. Header & Health Score ────────────────────────────────────── */}
        <div className="px-6 py-5 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 sticky top-0 z-20">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <DialogTitle className="text-lg font-black text-slate-900 dark:text-slate-100 truncate">
                  {lp.headline || lp.product_name || lp.slug}
                </DialogTitle>
                <span className={cn(
                  "px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1",
                  lp.is_active ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400"
                )}>
                  <span className={cn("size-1.5 rounded-full", lp.is_active ? "bg-emerald-500 animate-pulse" : "bg-slate-400")} />
                  {lp.is_active ? "Actif" : "Inactif"}
                </span>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono">
                  /lp/{lp.slug}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                <span>Créée le {lp.created_at ? new Date(lp.created_at).toLocaleDateString('fr-FR') : '—'}</span>
                <span>·</span>
                <span>Source dominante : <strong className="text-slate-600 dark:text-slate-300">Paid Social (Meta Ads)</strong></span>
              </p>
            </div>

            {/* Health Score Badge & Quick Action Buttons */}
            <div className="flex items-center gap-2 shrink-0">
              {health.score != null && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowHealthBreakdown(!showHealthBreakdown)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all hover:scale-[1.02] shadow-sm bg-white dark:bg-slate-900"
                    style={{ borderColor: health.color + '44' }}
                    title="Cliquer pour voir le détail du calcul du score de santé"
                  >
                    <ShieldCheck className="size-4" style={{ color: health.color }} />
                    <div className="text-left">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Health Score</div>
                      <div className="text-xs font-black" style={{ color: health.color }}>
                        {health.score} / 100
                      </div>
                    </div>
                  </button>

                  {/* Health Score Breakdown Popover */}
                  {showHealthBreakdown && (
                    <div className="absolute right-0 top-12 w-80 p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl z-30 space-y-3 text-xs">
                      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                        <span className="font-extrabold text-slate-900 dark:text-slate-100">Calcul du Health Score</span>
                        <button onClick={() => setShowHealthBreakdown(false)} className="text-slate-400 hover:text-slate-600">
                          <X className="size-4" />
                        </button>
                      </div>
                      <div className="space-y-1.5 text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Performance Conversion (max 30)</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">+{health.breakdown?.conversion_score} pts</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Transmission Meta CAPI (max 25)</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">+{health.breakdown?.tracking_quality_score} pts</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Succès Livraison / Retours (max 25)</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">+{health.breakdown?.delivery_success_score} pts</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Numéros de suivi Noest (max 10)</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">+{health.breakdown?.tracking_completeness_score} pts</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Fiabilité & Zéro Erreur CAPI (max 10)</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">+{health.breakdown?.capi_reliability_score} pts</span>
                        </div>
                      </div>
                      {health.reasons?.length > 0 && (
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] space-y-1 text-slate-500">
                          {health.reasons.map((r: string, idx: number) => (
                            <div key={idx} className="flex items-start gap-1">
                              <span>•</span>
                              <span>{r}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-xl text-xs font-bold gap-1.5 bg-white dark:bg-slate-900 hover:bg-slate-100"
                onClick={() => window.open(`/lp/${lp.slug}`, '_blank')}
              >
                <ExternalLink className="size-3.5" /> Aperçu
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-xl text-xs font-bold gap-1.5 bg-white dark:bg-slate-900 hover:bg-slate-100"
                onClick={copyUrl}
              >
                <Copy className="size-3.5" /> Copier URL
              </Button>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* ─── 2. Global Date Filter Bar ───────────────────────────────── */}
          <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Calendar className="size-4 text-slate-400 mr-1" />
              {[
                { id: 'today', label: "Aujourd'hui" },
                { id: 'yesterday', label: 'Hier' },
                { id: '7d', label: '7 jours' },
                { id: '14d', label: '14 jours' },
                { id: '30d', label: '30 jours' },
                { id: 'this_month', label: 'Ce mois' },
                { id: 'last_month', label: 'Mois dernier' },
              ].map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={cn(
                    "px-2.5 py-1 rounded-xl text-xs font-bold transition-colors",
                    periodPreset === p.id
                      ? "bg-[#6C5CE7] text-white shadow-sm"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 ml-auto flex-wrap">
              <input
                type="date"
                value={dStart}
                onChange={e => { setPeriodPreset('custom'); setDStart(e.target.value); }}
                className="h-8 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold outline-none"
              />
              <span className="text-slate-400">→</span>
              <input
                type="date"
                value={dEnd}
                onChange={e => { setPeriodPreset('custom'); setDEnd(e.target.value); }}
                className="h-8 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold outline-none"
              />

              <label className="flex items-center gap-1.5 cursor-pointer ml-2 text-xs font-bold text-slate-500">
                <input
                  type="checkbox"
                  checked={comparePrevious}
                  onChange={e => setComparePrevious(e.target.checked)}
                  className="rounded text-[#6C5CE7]"
                />
                <span>vs période précédente</span>
              </label>

              <button
                type="button"
                onClick={() => analyticsQuery.refetch()}
                disabled={analyticsQuery.isFetching}
                className="h-8 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition-colors ml-1"
                title="Actualiser les métriques"
              >
                <RefreshCw className={cn("size-3.5", analyticsQuery.isFetching && "animate-spin text-[#6C5CE7]")} />
                <span>Actualiser</span>
              </button>
            </div>
          </div>

          {/* Period Range Subtitle */}
          {period.date_start_str && (
            <div className="flex items-center justify-between text-xs text-slate-400 px-1">
              <div>
                Période analysée : <strong className="text-slate-700 dark:text-slate-300">{period.date_start_str} au {period.date_end_str}</strong> ({period.days_count} jours)
                {comparePrevious && period.previous_start_str && (
                  <span className="ml-2 text-slate-400">· Comparée à : {period.previous_start_str} au {period.previous_end_str}</span>
                )}
              </div>
            </div>
          )}

          {/* ─── 3. Section Alertes Intelligentes (Si Anomalies) ─────────── */}
          {alerts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-500">
                <AlertTriangle className="size-4 text-amber-500" />
                <span>Alertes & Anomalies Détectées ({alerts.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {alerts.map((a: any, idx: number) => (
                  <div
                    key={idx}
                    className={cn(
                      "p-3.5 rounded-2xl border flex items-start gap-3",
                      a.severity === 'critical'
                        ? "bg-rose-50/70 border-rose-200 dark:bg-rose-950/20 dark:border-rose-900/50 text-rose-900 dark:text-rose-200"
                        : "bg-amber-50/70 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/50 text-amber-900 dark:text-amber-200"
                    )}
                  >
                    {a.severity === 'critical' ? (
                      <AlertCircle className="size-4 text-rose-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-1">
                      <p className="text-xs font-black">{a.title}</p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">{a.description}</p>
                      {a.action && (
                        <p className="text-[10px] font-bold text-slate-500 mt-1">
                          <em>Action recommandée :</em> {a.action}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── 4. KPIs Principaux (6 Cartes Épurées) ───────────────────── */}
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">KPIs Principaux (First-Party ERP)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* KPI 1 - Commandes */}
              <div className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Commandes</p>
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-black text-slate-900 dark:text-slate-100 tabular-nums">
                    {kpis.orders?.value ?? 0}
                  </span>
                  {kpis.orders?.variation_pct != null && (
                    <span className={cn("text-[10px] font-bold flex items-center", kpis.orders.variation_pct >= 0 ? "text-emerald-600" : "text-rose-600")}>
                      {kpis.orders.variation_pct >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                      {Math.abs(kpis.orders.variation_pct)}%
                    </span>
                  )}
                </div>
                <p className="text-[9px] text-slate-400 leading-tight">Total attribué à la LP</p>
              </div>

              {/* KPI 2 - Taux de Conversion */}
              <div className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Conversion</p>
                  <span title="Commandes / Visiteurs qualifiés" className="text-slate-300 hover:text-slate-500 cursor-help">
                    <Info className="size-3" />
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {kpis.conversion_rate?.formatted ?? '—'}
                  </span>
                  {kpis.conversion_rate?.variation_pct != null && (
                    <span className={cn("text-[10px] font-bold flex items-center", kpis.conversion_rate.variation_pct >= 0 ? "text-emerald-600" : "text-rose-600")}>
                      {kpis.conversion_rate.variation_pct >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                      {Math.abs(kpis.conversion_rate.variation_pct)}%
                    </span>
                  )}
                </div>
                <p className="text-[9px] text-slate-400 leading-tight">{kpis.conversion_rate?.sessions_count ?? 0} sessions qualifiées</p>
              </div>

              {/* KPI 3 - Paniers Récupérés */}
              <div className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Paniers Récupérés</p>
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-black text-purple-600 dark:text-purple-400 tabular-nums">
                    {kpis.recovered_carts?.recovered_count ?? 0}
                  </span>
                  <span className="text-[10px] font-bold text-slate-500">
                    {kpis.recovered_carts?.formatted_rate ?? '—'}
                  </span>
                </div>
                <p className="text-[9px] text-slate-400 leading-tight">sur {kpis.recovered_carts?.abandoned_count ?? 0} abandons</p>
              </div>

              {/* KPI 4 - Commandes Livrées */}
              <div className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Livrées</p>
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-black text-[#00B894] tabular-nums">
                    {kpis.delivered?.value ?? 0}
                  </span>
                  {kpis.delivered?.delivery_rate_pct != null && (
                    <span className="text-[10px] font-bold text-[#00B894]">
                      {kpis.delivered.delivery_rate_pct}%
                    </span>
                  )}
                </div>
                <p className="text-[9px] text-slate-400 leading-tight">Statut DELIVERED</p>
              </div>

              {/* KPI 5 - Retours */}
              <div className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Retours</p>
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-black text-[#D63031] tabular-nums">
                    {kpis.returned?.value ?? 0}
                  </span>
                  {kpis.returned?.return_rate_pct != null && (
                    <span className="text-[10px] font-bold text-[#D63031]">
                      {kpis.returned.return_rate_pct}%
                    </span>
                  )}
                </div>
                <p className="text-[9px] text-slate-400 leading-tight">Statut RETURNED</p>
              </div>

              {/* KPI 6 - Expédiées & Tracking */}
              <div className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Expédiées & Suivi</p>
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-black text-[#0984E3] tabular-nums">
                    {kpis.shipped?.shipped_count ?? 0}
                  </span>
                  <span className="text-[10px] font-bold text-[#0984E3]">
                    {kpis.shipped?.with_tracking_count ?? 0} trackés
                  </span>
                </div>
                <p className="text-[9px] text-slate-400 leading-tight">Numéro de bordereau Noest</p>
              </div>
            </div>
          </div>

          {/* ─── 4.5. Section Répartition des Livraisons par Variante (Pliable) ──────── */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4 transition-all">
            <button
              type="button"
              onClick={() => setIsVariantsOpen(!isVariantsOpen)}
              className="w-full flex items-center justify-between flex-wrap gap-2 text-left group cursor-pointer"
            >
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <span>Ventes & Livraisons par Variante</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 font-bold">
                    {variantsList.length} variante{variantsList.length > 1 ? 's' : ''}
                  </span>
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Nombre exact de pièces livrées avec succès, commandées et taux de livraison pour chaque variante.
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs font-bold text-slate-500">
                <span>Total Commandé : <strong className="text-slate-800 dark:text-slate-200 font-black">{totalOrderedVariants} pcs</strong></span>
                <span>•</span>
                <span>Total Livré : <strong className="text-emerald-600 font-black">{totalDeliveredVariants} pcs</strong></span>
                <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 group-hover:bg-slate-200 dark:group-hover:bg-slate-700 transition-colors ml-1">
                  {isVariantsOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </div>
              </div>
            </button>

            {isVariantsOpen && (
              <>
                {variantsList.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400 italic bg-slate-50 dark:bg-slate-800/40 rounded-xl">
                    Aucune commande avec variante enregistrée pour cette période.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                    {variantsList.map((v: any, idx: number) => (
                      <div key={idx} className="p-4 bg-slate-50/80 dark:bg-slate-800/40 rounded-2xl border border-slate-200/70 dark:border-slate-700/60 space-y-3 transition-all hover:shadow-xs">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-black text-slate-900 dark:text-slate-100 line-clamp-1" title={v.variant_name}>
                            {v.variant_name}
                          </span>
                          <span className="px-2.5 py-0.5 rounded-md text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 whitespace-nowrap">
                            {v.delivered} livrée{v.delivered > 1 ? 's' : ''}
                          </span>
                        </div>

                        <div className="space-y-1.5 text-xs">
                          <div className="flex items-center justify-between text-[11px] text-slate-500">
                            <span>Taux de livraison :</span>
                            <strong className="text-emerald-600 font-bold">{v.delivery_rate}%</strong>
                          </div>
                          {/* Progress bar */}
                          <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                              style={{ width: `${Math.min(100, Math.max(0, v.delivery_rate || 0))}%` }}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-1 text-center pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-[10px]">
                          <div>
                            <p className="font-bold text-slate-400">Total</p>
                            <p className="font-black text-slate-800 dark:text-slate-200">{v.total_ordered}</p>
                          </div>
                          <div>
                            <p className="font-bold text-slate-400">Livrées</p>
                            <p className="font-black text-emerald-600">{v.delivered}</p>
                          </div>
                          <div>
                            <p className="font-bold text-slate-400">En cours</p>
                            <p className="font-black text-blue-600">{v.confirmed + v.shipped}</p>
                          </div>
                          <div>
                            <p className="font-bold text-slate-400">Retours</p>
                            <p className="font-black text-rose-600">{v.returned}</p>
                          </div>
                        </div>

                        {v.revenue_delivered > 0 && (
                          <div className="text-[10px] text-slate-400 text-right pt-0.5">
                            CA Livré : <strong className="text-slate-700 dark:text-slate-300 font-mono font-bold">{Math.round(v.revenue_delivered).toLocaleString('fr-FR')} DA</strong>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ─── 5. Section Performance Meta Ads (Séparée de l'ERP) ──────── */}
          <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-purple-700 dark:text-purple-400 flex items-center gap-1.5">
                  <span>Performance Meta Ads</span>
                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 font-bold">
                    Données déclarées par Meta Ads Insights
                  </span>
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Source de vérité publicitaire distincte de l'ERP interne — basée sur la campagne Meta associée.
                </p>
              </div>
              {meta.last_meta_sync_at && (
                <div className="text-[10px] text-slate-400 font-mono">
                  Dernière synchro : {new Date(meta.last_meta_sync_at).toLocaleTimeString('fr-FR')}
                </div>
              )}
            </div>

            {meta.is_available ? (
              <div className="space-y-3">
                {/* Matched Campaign Banner */}
                <div className="p-2.5 bg-purple-50/50 dark:bg-purple-950/20 rounded-xl border border-purple-100 dark:border-purple-900/40 text-xs flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-700 dark:text-slate-300">Campagne liée :</span>
                    <strong className="text-purple-700 dark:text-purple-300">{meta.campaign_name}</strong>
                    <span className="text-[10px] text-slate-400 font-mono">({meta.campaign_id})</span>
                  </div>
                  <div className="text-xs font-black text-purple-700 dark:text-purple-300">
                    Dépense : {meta.spend_raw} {meta.currency} {meta.currency !== 'DZD' && `(${meta.spend_dzd.toLocaleString('fr-FR')} DA)`}
                  </div>
                </div>

                {/* 6 Meta Metric Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-center">
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/50 dark:border-slate-800">
                    <p className="text-base font-black text-slate-900 dark:text-slate-100 tabular-nums">{(meta.impressions ?? 0).toLocaleString('fr-FR')}</p>
                    <p className="text-[9px] font-bold uppercase text-slate-400 mt-0.5">Impressions</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/50 dark:border-slate-800">
                    <p className="text-base font-black text-slate-900 dark:text-slate-100 tabular-nums">{(meta.reach ?? 0).toLocaleString('fr-FR')}</p>
                    <p className="text-[9px] font-bold uppercase text-slate-400 mt-0.5">Portée (Reach)</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/50 dark:border-slate-800">
                    <p className="text-base font-black text-slate-900 dark:text-slate-100 tabular-nums">{(meta.clicks ?? 0).toLocaleString('fr-FR')}</p>
                    <p className="text-[9px] font-bold uppercase text-slate-400 mt-0.5">Clics sur liens</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/50 dark:border-slate-800">
                    <p className="text-base font-black text-slate-900 dark:text-slate-100 tabular-nums">{meta.ctr_pct != null ? `${meta.ctr_pct}%` : '—'}</p>
                    <p className="text-[9px] font-bold uppercase text-slate-400 mt-0.5">CTR Meta</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/50 dark:border-slate-800">
                    <p className="text-base font-black text-emerald-600 dark:text-emerald-400 tabular-nums">{meta.purchases ?? 0}</p>
                    <p className="text-[9px] font-bold uppercase text-slate-400 mt-0.5">Achats Meta</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/50 dark:border-slate-800">
                    <p className="text-base font-black text-emerald-600 dark:text-emerald-400 tabular-nums">{meta.conversion_rate_pct != null ? `${meta.conversion_rate_pct}%` : '—'}</p>
                    <p className="text-[9px] font-bold uppercase text-slate-400 mt-0.5">Taux Conv. Meta</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl text-center space-y-1">
                <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Données Meta non associées</p>
                <p className="text-[11px] text-slate-400">{meta.reason || "Aucune campagne publicitaire Meta active n'a été liée à cette landing page pour cette période."}</p>
              </div>
            )}
          </div>

          {/* ─── 6. Grand Funnel Visuel (Pipeline Complet) ───────────────── */}
          <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                Entonnoir de Conversion Global (Funnel)
              </p>
              <span className="text-[10px] text-slate-400">Taux de passage étape par étape</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              {funnel.map((f: any, idx: number) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-center space-y-1 relative"
                >
                  <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 truncate" title={f.stage}>
                    {f.stage}
                  </p>
                  <p className="text-base font-black text-slate-900 dark:text-slate-100 tabular-nums">
                    {(f.volume ?? 0).toLocaleString('fr-FR')}
                  </p>
                  {f.conversion_from_prev_pct != null && (
                    <div className="text-[10px] font-bold text-purple-600 dark:text-purple-400 flex items-center justify-center gap-0.5">
                      <span>↓</span> {f.conversion_from_prev_pct}%
                    </div>
                  )}
                  <p className="text-[8px] text-slate-400 truncate" title={f.source}>{f.source}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ─── 7. Graphiques Analytiques (Onglets Épurés) ──────────────── */}
          <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 flex-wrap gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {[
                  { id: 'orders', label: 'Évolution Commandes', icon: TrendingUp },
                  { id: 'status', label: 'Par Statut Réel', icon: BarChart3 },
                  { id: 'logistics', label: 'Qualité Livraison', icon: Truck },
                ].map(t => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActiveChartTab(t.id as any)}
                      className={cn(
                        "px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors",
                        activeChartTab === t.id
                          ? "bg-[#6C5CE7] text-white shadow-sm"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                      )}
                    >
                      <Icon className="size-3.5" />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Chart Area */}
            <div className="h-64 w-full">
              {analyticsQuery.isLoading ? (
                <div className="h-full flex items-center justify-center"><Loader2 className="size-6 animate-spin text-slate-300" /></div>
              ) : activeChartTab === 'orders' ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={charts.orders_timeline || []} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="date" tickFormatter={v => v.slice(5)} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                    <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }} />
                    <Legend wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
                    <Bar dataKey="normal" name="Commandes Normales" stackId="a" fill="#6C5CE7" radius={[4, 4, 0, 0]} maxBarSize={35} />
                    <Bar dataKey="recovered" name="Paniers Récupérés" stackId="a" fill="#00B894" radius={[4, 4, 0, 0]} maxBarSize={35} />
                    <Line type="monotone" dataKey="delivered" name="Livrées" stroke="#0984E3" strokeWidth={2.5} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="returned" name="Retours" stroke="#D63031" strokeWidth={2.5} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : activeChartTab === 'status' ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={charts.status_breakdown || []} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="status" tick={{ fontSize: 10, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                    <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }} />
                    <Bar dataKey="count" name="Nombre de commandes" fill="#6C5CE7" radius={[6, 6, 0, 0]} maxBarSize={45} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={charts.delivery_quality || []} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                    <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }} />
                    <Bar dataKey="value" name="Nombre de commandes" fill="#00B894" radius={[6, 6, 0, 0]} maxBarSize={45} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* ─── 8. Réconciliation & Justification de l'Écart Meta ↔ ERP ──── */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <span>Réconciliation & Justification de l'Écart Meta ↔ ERP</span>
                  {reconciliation.gap && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 font-bold">
                      Écart : {reconciliation.gap} commandes
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Décomposition détaillée expliquant l'écart entre les achats déclarés par Meta et le total réel encaissé dans l'ERP.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-xl text-xs font-bold gap-1.5 bg-slate-50 hover:bg-slate-100"
                onClick={() => setShowReconciliationModal(true)}
              >
                <Eye className="size-3.5" />
                <span>Voir les événements concernés</span>
              </Button>
            </div>

            {/* Justification Breakdown Cards */}
            {reconciliation.justification && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <div className="p-3 bg-purple-50/60 dark:bg-purple-950/20 rounded-xl border border-purple-200/60 dark:border-purple-800/40">
                  <p className="text-[10px] font-bold text-purple-700 dark:text-purple-300">Clic Publicité Direct Meta</p>
                  <p className="text-lg font-black text-purple-900 dark:text-purple-100 mt-0.5">
                    {reconciliation.justification.meta_direct_orders ?? 0} <span className="text-[10px] font-medium text-purple-600">cmd</span>
                  </p>
                  <p className="text-[9px] text-slate-400 mt-0.5">Avec tag pub / campagne UTM</p>
                </div>

                <div className="p-3 bg-emerald-50/60 dark:bg-emerald-950/20 rounded-xl border border-emerald-200/60 dark:border-emerald-800/40">
                  <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">Paniers Récupérés (Téléphone)</p>
                  <p className="text-lg font-black text-emerald-900 dark:text-emerald-100 mt-0.5">
                    +{reconciliation.justification.recovered_carts ?? 0} <span className="text-[10px] font-medium text-emerald-600">cmd</span>
                  </p>
                  <p className="text-[9px] text-slate-400 mt-0.5">Relance confirmatrice / appel</p>
                </div>

                <div className="p-3 bg-blue-50/60 dark:bg-blue-950/20 rounded-xl border border-blue-200/60 dark:border-blue-800/40">
                  <p className="text-[10px] font-bold text-blue-700 dark:text-blue-300">Saisies Manuelles / Staff</p>
                  <p className="text-lg font-black text-blue-900 dark:text-blue-100 mt-0.5">
                    +{reconciliation.justification.manual_orders ?? 0} <span className="text-[10px] font-medium text-blue-600">cmd</span>
                  </p>
                  <p className="text-[9px] text-slate-400 mt-0.5">Créées par agents / confirmatrices</p>
                </div>

                <div className="p-3 bg-amber-50/60 dark:bg-amber-950/20 rounded-xl border border-amber-200/60 dark:border-amber-800/40">
                  <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300">Trafic Direct & WhatsApp</p>
                  <p className="text-lg font-black text-amber-900 dark:text-amber-100 mt-0.5">
                    +{reconciliation.justification.organic_direct_orders ?? 0} <span className="text-[10px] font-medium text-amber-600">cmd</span>
                  </p>
                  <p className="text-[9px] text-slate-400 mt-0.5">Partage de lien, revisites directes</p>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 text-left">
                    <th className="pb-2 font-bold">Indicateur</th>
                    <th className="pb-2 font-bold text-right">Déclaré par Meta</th>
                    <th className="pb-2 font-bold text-right">Enregistré ERP</th>
                    <th className="pb-2 font-bold text-right">Écart Justifié</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                  {(reconciliation.metrics || []).map((m: any, idx: number) => (
                    <tr key={idx}>
                      <td className="py-2.5 font-bold text-slate-700 dark:text-slate-300">{m.name}</td>
                      <td className="py-2.5 text-right font-mono">{m.meta_value}</td>
                      <td className="py-2.5 text-right font-mono font-bold">{m.erp_value}</td>
                      <td className="py-2.5 text-right font-mono font-black text-purple-600">{m.gap}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-slate-400 italic">
              {reconciliation.notice}
            </p>
          </div>

          {/* ─── 9. Tableau de Diagnostic Détaillé (Pliable) ──────────────── */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setIsDiagnosticOpen(!isDiagnosticOpen)}
              className="w-full p-4 flex items-center justify-between text-left hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors"
            >
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                  Tableau de Diagnostic Quotidien (Audit Détaillé)
                </p>
                <p className="text-[10px] text-slate-400">Historique jour par jour de toutes les étapes</p>
              </div>
              {isDiagnosticOpen ? <ChevronUp className="size-4 text-slate-400" /> : <ChevronDown className="size-4 text-slate-400" />}
            </button>

            {isDiagnosticOpen && (
              <div className="p-4 pt-0 overflow-x-auto border-t border-slate-100 dark:border-slate-800">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold">
                      <th className="py-2">Date</th>
                      <th className="py-2 text-right">Commandes</th>
                      <th className="py-2 text-right">Normales</th>
                      <th className="py-2 text-right">Abandons</th>
                      <th className="py-2 text-right">Récupérées</th>
                      <th className="py-2 text-right">Expédiées</th>
                      <th className="py-2 text-right">Trackées</th>
                      <th className="py-2 text-right">Livrées</th>
                      <th className="py-2 text-right">Retours</th>
                      <th className="py-2 text-right">Chiffre d'Affaires</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 tabular-nums">
                    {diagnostic.map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="py-2 font-mono font-bold text-slate-700 dark:text-slate-300">
                          {row.date ? row.date.split('-').reverse().join('/') : '—'}
                        </td>
                        <td className="py-2 text-right font-black">{row.orders}</td>
                        <td className="py-2 text-right text-slate-500">{row.normal}</td>
                        <td className="py-2 text-right text-amber-600">{row.abandoned}</td>
                        <td className="py-2 text-right text-purple-600">{row.recovered}</td>
                        <td className="py-2 text-right text-blue-600">{row.shipped}</td>
                        <td className="py-2 text-right text-sky-600">{row.with_tracking}</td>
                        <td className="py-2 text-right text-emerald-600 font-bold">{row.delivered}</td>
                        <td className="py-2 text-right text-rose-600">{row.returned}</td>
                        <td className="py-2 text-right font-mono">{Math.round(row.revenue_dzd).toLocaleString('fr-FR')} DA</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ─── Sub-Modal: Reconciliation Events Drilldown ───────────────── */}
        {showReconciliationModal && (
          <Dialog open={showReconciliationModal} onOpenChange={setShowReconciliationModal}>
            <DialogContent className="max-w-3xl w-[90vw] max-h-[80vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-2xl p-5 space-y-4">
              <DialogHeader>
                <DialogTitle className="text-sm font-black flex items-center justify-between">
                  <span>Événements & Commandes — Audit Meta CAPI</span>
                  <span className="text-xs font-mono text-slate-400">{reconQuery.data?.count ?? 0} commandes analysées</span>
                </DialogTitle>
              </DialogHeader>

              {reconQuery.isLoading ? (
                <div className="py-12 flex justify-center"><Loader2 className="size-6 animate-spin text-slate-300" /></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-slate-400 text-left">
                        <th className="pb-2">N° Commande</th>
                        <th className="pb-2">Date</th>
                        <th className="pb-2">Client</th>
                        <th className="pb-2">Statut ERP</th>
                        <th className="pb-2">Statut Meta CAPI</th>
                        <th className="pb-2">Détails / Erreurs</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {(reconQuery.data?.events || []).map((ev: any) => (
                        <tr key={ev.order_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="py-2 font-mono font-bold">{ev.order_number}</td>
                          <td className="py-2 text-slate-400 text-[11px]">{ev.created_at ? new Date(ev.created_at).toLocaleDateString('fr-FR') : '—'}</td>
                          <td className="py-2">{ev.customer_name}</td>
                          <td className="py-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                              {ev.status}
                            </span>
                          </td>
                          <td className="py-2">
                            <span className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold",
                              ev.capi_status === 'success' ? "bg-emerald-50 text-emerald-700" :
                              ev.capi_status === 'queued' ? "bg-sky-50 text-sky-700" :
                              ev.capi_status === 'failed' || ev.capi_status === 'error' ? "bg-rose-50 text-rose-700" :
                              "bg-slate-100 text-slate-500"
                            )}>
                              {ev.capi_status}
                            </span>
                          </td>
                          <td className="py-2 text-[10px] text-slate-500 truncate max-w-[200px]" title={ev.capi_error || ev.capi_event_id}>
                            {ev.capi_error ? `⚠️ ${ev.capi_error}` : ev.capi_event_id ? `ID: ${ev.capi_event_id}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── LP Card ──────────────────────────────────────────────────────────────────
function LandingPageCard({
  lp, storeSlug, allStores, onEdit, onToggle, onDelete, onCopy, onShowAnalytics,
}: {
  lp: LandingPage; storeSlug: string; allStores: any[];
  onEdit: () => void; onToggle: () => void; onDelete: () => void; onCopy: () => void;
  onShowAnalytics: () => void;
}) {
  // Always resolve from the LP's *own* store, never from the current admin store
  const matchingStore = allStores.find(s => s.id === lp.store_id);
  const lpStoreSlug = matchingStore?.slug || storeSlug;
  const storeDomain = matchingStore?.domain || `${lpStoreSlug}.azghub.com`;
  const isLocal = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.includes('hf.space') ||
    window.location.hostname.includes('huggingface.co')
  );
  const url = isLocal
    ? `${window.location.origin}/lp/${lp.slug}?store=${lpStoreSlug}`
    : `https://${storeDomain}/lp/${lp.slug}`;

  return (
    <div className={cn(
      "bg-white rounded-[28px] border overflow-hidden transition-all hover:shadow-lg hover:shadow-slate-100 group",
      lp.is_active ? "border-slate-100" : "border-dashed border-slate-200 opacity-70"
    )}>
      {/* Thumbnail — tap anywhere on it to open the full analytics panel */}
      <div
        className="relative h-36 overflow-hidden cursor-pointer"
        style={{ backgroundColor: lp.primary_color + '15' }}
        onClick={onShowAnalytics}
        title="Voir les détails & analytics de cette page"
      >
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

        <h3 className="text-sm font-black text-slate-800 truncate mb-1 cursor-pointer hover:text-[#6C5CE7] transition-colors" onClick={onShowAnalytics}>{lp.headline || lp.product_name || '—'}</h3>
        <p className="text-[10px] text-slate-400 font-medium font-mono truncate mb-4">/lp/{lp.slug}</p>

        {/* KPIs live in the analytics modal (onShowAnalytics) only — the
            card stays a lightweight launcher, not a duplicate dashboard. */}
        <button onClick={onShowAnalytics}
          className="w-full h-9 rounded-xl border border-dashed border-slate-200 text-slate-500 text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 hover:bg-slate-50 hover:border-slate-300 transition-all mb-4">
          <TrendingUp className="size-3.5" /> Voir les statistiques
        </button>

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
  const queryClient = useQueryClient();

  // Step 1: choose mode
  const [mode, setMode] = useState<'product' | 'standalone' | 'new_product'>(existing?.mode || 'product');
  const [step, setStep] = useState<'pick' | 'form' | 'new_product_details'>(isEdit ? 'form' : 'pick');

  // Product picker
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null);
  const [productSearch, setProductSearch] = useState('');

  // Unified Product fields
  const [prodName, setProdName] = useState('');
  const [prodDesc, setProdDesc] = useState('');
  const [prodSku, setProdSku] = useState('');
  const [prodStock, setProdStock] = useState('50');
  const [prodCost, setProdCost] = useState('');
  const [prodPrice, setProdPrice] = useState('');
  const [prodComparePrice, setProdComparePrice] = useState('');
  const [prodVariants, setProdVariants] = useState<Array<{ name: string; value: string; color?: string; sku: string; stock: number; cost?: number; image?: string; sub_variants?: any[] }>>([]);
  const [uploadingVariantIdx, setUploadingVariantIdx] = useState<number | null>(null);
  const [sizeRangeModal, setSizeRangeModal] = useState<{
    isOpen: boolean;
    variantIndex: number;
    rangeStr: string;
    qtyStr: string;
    onSuccess: (range: string, qty: string) => void;
  } | null>(null);
  const [offers, setOffers] = useState<Array<{ quantity: number; price: number; compare_price: number; cost_price?: number; name?: string; desc?: string; popular?: boolean }>>(existing?.offers || []);

  // Delivery states
  const [isFreeShipping, setIsFreeShipping] = useState<boolean>(false);
  const [deliveryFees, setDeliveryFees] = useState<any>({});
  const [selectedCarrierId, setSelectedCarrierId] = useState<string>('');
  const [selectedWilayaId, setSelectedWilayaId] = useState<string>('16');
  const [customHomeFee, setCustomHomeFee] = useState<string>('');
  const [customDeskFee, setCustomDeskFee] = useState<string>('');

  const carriersQuery = useQuery<any>({
    queryKey: ['delivery-partners-select', storeId],
    queryFn: () => apiFetch<any>(`/api/v1/delivery-partners?store_id=${storeId}`),
  });
  const carriers = carriersQuery.data?.data || [];

  const [freshProductDetails, setFreshProductDetails] = useState<any>(null);

  useEffect(() => {
    const productId = selectedProduct?.id || existing?.product?.id || existing?.product_id;
    if (!productId) {
      setFreshProductDetails(null);
      return;
    }
    
    let active = true;
    apiFetch<any>(`/api/v1/products/${productId}`)
      .then(res => {
        if (active && res) {
          setFreshProductDetails(res.data || res);
        }
      })
      .catch(err => {
        console.error("Failed to fetch fresh product details", err);
      });
      
    return () => {
      active = false;
    };
  }, [selectedProduct?.id, existing?.product?.id, existing?.product_id]);

  useEffect(() => {
    const targetProduct = (freshProductDetails || selectedProduct || existing?.product) as any;
    if (targetProduct) {
      setProdName(targetProduct.name || '');
      setProdDesc(targetProduct.description || '');
      setProdSku(targetProduct.sku || '');
      setProdStock(targetProduct.stock?.toString() || '50');
      setProdCost(targetProduct.cost_price?.toString() || targetProduct.costPrice?.toString() || '');
      setProdPrice(targetProduct.price?.toString() || '');
      setProdComparePrice(targetProduct.compare_price?.toString() || targetProduct.comparePrice?.toString() || '');
      
      let vars = targetProduct.variants || [];
      if (typeof vars === 'string') {
        try { vars = JSON.parse(vars); } catch { vars = []; }
      }
      setProdVariants(vars || []);

      const raw = targetProduct.delivery_fees || targetProduct.deliveryFees;
      let parsed: any = { is_free: false, fees: {} };
      if (raw) {
        if (typeof raw === 'string') {
          try { parsed = JSON.parse(raw); } catch { /* ignore */ }
        } else {
          parsed = raw;
        }
      }
      setIsFreeShipping(parsed.is_free || parsed.isFree || false);
      setDeliveryFees(parsed.fees || {});
    } else {
      setProdName('');
      setProdDesc('');
      setProdSku('');
      setProdStock('50');
      setProdCost('');
      setProdPrice('');
      setProdComparePrice('');
      setProdVariants([]);
      setIsFreeShipping(false);
      setDeliveryFees({});
    }
    if (existing?.offers) {
      setOffers(existing.offers);
    }
  }, [selectedProduct, existing, freshProductDetails]);

  // Auto-calculate total stock when variants stock changes
  useEffect(() => {
    if (prodVariants && prodVariants.length > 0) {
      const total = prodVariants.reduce((sum, v) => sum + (v.stock || 0), 0);
      setProdStock(total.toString());
    }
  }, [prodVariants]);

  const handleAddCustomFee = () => {
    if (!selectedCarrierId || !customHomeFee) return;
    const next = { ...deliveryFees };
    if (!next[selectedCarrierId]) {
      next[selectedCarrierId] = {};
    }
    next[selectedCarrierId][selectedWilayaId] = {
      home: parseInt(customHomeFee) || 0,
      desk: parseInt(customDeskFee) || 0
    };
    setDeliveryFees(next);
    setCustomHomeFee('');
    setCustomDeskFee('');
  };

  const handleRemoveCustomFee = (carrier: string, wilayaId: string) => {
    const next = { ...deliveryFees };
    if (next[carrier]) {
      delete next[carrier][wilayaId];
      if (Object.keys(next[carrier]).length === 0) {
        delete next[carrier];
      }
    }
    setDeliveryFees(next);
  };

  // Form state
  const [headline, setHeadline] = useState(existing?.headline || '');
  const [subtitle, setSubtitle] = useState(existing?.subtitle || '');
  const [badgeText, setBadgeText] = useState(existing?.badge_text || 'Offre limitée');
  const [ctaLabel, setCtaLabel] = useState(existing?.cta_label || 'Commander maintenant');
  const [imageUrl, setImageUrl] = useState(existing?.image_url || '');
  const [bannerImageUrl, setBannerImageUrl] = useState(existing?.banner_image_url || '');
  const [phone, setPhone] = useState(existing?.phone || '');
  const [primaryColor, setPrimaryColor] = useState(existing?.primary_color || '#e84393');
  const [template, setTemplate] = useState(existing?.template || 'premium');
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
  const [steps, setSteps] = useState(existing?.steps || [
    { step: '01', title: 'Choisissez', desc: 'Sélectionnez votre produit et quantité.' },
    { step: '02', title: 'Confirmez',  desc: 'Laissez votre nom et numéro de téléphone.' },
    { step: '03', title: 'Recevez',    desc: 'Livraison à domicile sous 48h, payez à la porte.' },
  ]);
  const [stats, setStats] = useState(existing?.stats || [
    { value: 12000, suffix: '+', label: 'Clients satisfaits' },
    { value: 98,    suffix: '%', label: 'Avis positifs' },
    { value: 48,    suffix: 'h', label: 'Délai livraison' },
  ]);
  const [ctaHeadline, setCtaHeadline] = useState(existing?.cta_headline || "N'attendez plus.");
  const [ctaSubtitle, setCtaSubtitle] = useState(existing?.cta_subtitle || "Rejoignez des milliers de clients satisfaits et profitez de notre offre exclusive aujourd'hui.");
  const [cta2Label, setCta2Label] = useState(existing?.cta2_label || '');
  const [saving, setSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Type non supporté. Utilisez JPEG, PNG, WebP, GIF ou AVIF.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('Image trop volumineuse. Limite: 20 MB.');
      return;
    }

    setIsUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (imageUrl) form.append('old_url', imageUrl);
      const res = await fetch('/api/v1/upload/image', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any)?.detail || 'Échec du téléversement');
      }
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!data.url) throw new Error("Le serveur n'a pas renvoyé d'URL d'image");
      setImageUrl(data.url);
      toast.success('Image téléversée avec succès');
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors du téléversement');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleBannerImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Type non supporté. Utilisez JPEG, PNG, WebP, GIF ou AVIF.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('Image trop volumineuse. Limite: 20 MB.');
      return;
    }

    setIsUploadingBanner(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (bannerImageUrl) form.append('old_url', bannerImageUrl);
      const res = await fetch('/api/v1/upload/image', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any)?.detail || 'Échec du téléversement');
      }
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!data.url) throw new Error("Le serveur n'a pas renvoyé d'URL d'image");
      setBannerImageUrl(data.url);
      toast.success('Bannière publicitaire téléversée avec succès');
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors du téléversement');
    } finally {
      setIsUploadingBanner(false);
      e.target.value = '';
    }
  };

  const handleVariantImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Type non supporté. Utilisez JPEG, PNG, WebP, GIF ou AVIF.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('Image trop volumineuse. Limite: 20 MB.');
      return;
    }

    setUploadingVariantIdx(index);
    try {
      const form = new FormData();
      form.append('file', file);
      const oldVariantImg = prodVariants[index]?.image;
      if (oldVariantImg) form.append('old_url', oldVariantImg);
      const res = await fetch('/api/v1/upload/image', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any)?.detail || 'Échec du téléversement');
      }
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!data.url) throw new Error("Le serveur n'a pas renvoyé d'URL d'image");
      
      const nextVariants = [...prodVariants];
      nextVariants[index] = { ...nextVariants[index], image: data.url };
      setProdVariants(nextVariants);
      toast.success('Image variante téléversée');
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors du téléversement');
    } finally {
      setUploadingVariantIdx(null);
      e.target.value = '';
    }
  };

  const productsQuery = useQuery({
    queryKey: ['products-for-lp', storeId, productSearch],
    queryFn: () => apiFetch<any>(`/api/v1/products?store_id=${storeId}&search=${productSearch}&pageSize=30&is_active=true`),
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

  useEffect(() => {
    if (open && !isEdit) {
      setProdSku(`LP-${Math.random().toString(36).substring(2, 7).toUpperCase()}`);
    }
  }, [open, isEdit]);

  const handleSave = async () => {
    if (!headline.trim()) { toast.error('Le titre est requis'); return; }
    setSaving(true);
    try {
      let finalProductId = selectedProduct?.id || existing?.product_id || null;

      // If mode is new_product, create the product first
      if (mode === 'new_product' && !isEdit) {
        const slug = headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const sku = prodSku || `LP-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
        
        const pBody: any = {
          name: prodName || headline,
          slug,
          sku,
          price: parseInt(prodPrice) || parseInt(price) || 0,
          compare_price: parseInt(prodComparePrice) || parseInt(comparePrice) || 0,
          cost_price: parseInt(prodCost) || 0,
          stock: parseInt(prodStock) || 0,
          store_id: storeId,
          main_image: imageUrl || null,
          description: prodDesc || subtitle || '',
          is_active: true,
          is_featured: true,
          delivery_fees: {
            is_free: isFreeShipping,
            fees: deliveryFees
          }
        };
        
        if (prodVariants.length > 0) {
           pBody.variants = prodVariants.map((v, index) => ({
             ...v,
             sku: v.sku?.trim() || `${sku}-${v.value.toUpperCase().replace(/[^A-Z0-9]/g, '') || index}`
           }));
        }

        const newP = await apiFetch<any>('/api/v1/products/', { 
          method: 'POST', 
          body: JSON.stringify(pBody) 
        });
        finalProductId = newP.id || newP.data?.id;
        toast.success('Produit ERP créé !');
      } else if (finalProductId) {
        // Update product details including variants and delivery fees
        const sku = prodSku || `LP-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
        await apiFetch(`/api/v1/products/${finalProductId}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: prodName,
            description: prodDesc,
            price: parseInt(prodPrice) || 0,
            compare_price: parseInt(prodComparePrice) || 0,
            cost_price: parseInt(prodCost) || 0,
            stock: parseInt(prodStock) || 0,
            sku,
            variants: prodVariants.map((v, index) => ({
              ...v,
              sku: v.sku?.trim() || `${sku}-${v.value.toUpperCase().replace(/[^A-Z0-9]/g, '') || index}`
            })),
            delivery_fees: {
              is_free: isFreeShipping,
              fees: deliveryFees
            }
          })
        });
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
        cta_headline: ctaHeadline,
        cta_subtitle: ctaSubtitle,
        cta2_label: cta2Label || null,
        benefits,
        testimonials,
        steps,
        stats,
        faq,
        offers,
        banner_image_url: bannerImageUrl || null,
      };

      if (isEdit) {
        await apiFetch(`/api/v1/landing-pages/${existing!.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.success('Landing page mise à jour');
      } else {
        await apiFetch('/api/v1/landing-pages', { method: 'POST', body: JSON.stringify(body) });
        toast.success('Landing page créée !');
      }
      onSaved();
      queryClient.invalidateQueries({ queryKey: ['landing-pages'] });
      queryClient.invalidateQueries({ queryKey: ['landing-page'] });
      queryClient.invalidateQueries({ queryKey: ['admin-products-stock'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'summary'] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl p-0 border border-slate-200 shadow-xl overflow-hidden flex flex-col w-[95vw] h-[90dvh] rounded-2xl bg-white">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-lg bg-slate-100 flex items-center justify-center">
              <LayoutTemplate className="size-4 text-slate-600" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-slate-900">
                {isEdit ? 'Modifier la landing page' : 'Nouvelle landing page'}
              </DialogTitle>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 transition-all">
            <X className="size-4 text-slate-400 hover:text-slate-600" />
          </button>
        </div>

        {/* Step 1: Mode picker */}
        {step === 'pick' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                {
                  id: 'product', icon: Package,
                  title: 'Produit existant',
                  desc: 'Lier la page à un produit de votre boutique.',
                },
                {
                  id: 'new_product', icon: Plus,
                  title: 'Nouveau produit',
                  desc: 'Créer automatiquement un nouveau produit dans votre catalogue.',
                },
                {
                  id: 'standalone', icon: FileText,
                  title: 'Page libre',
                  desc: 'Créer une page personnalisée non liée au catalogue.',
                },
              ].map(opt => (
                <button key={opt.id} onClick={() => setMode(opt.id as any)}
                  className={cn(
                    "p-5 rounded-xl border text-left transition-all flex flex-col justify-between h-full min-h-[120px]",
                    mode === opt.id ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900" : "border-slate-200 bg-white hover:border-slate-300"
                  )}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className={cn("size-8 rounded-lg flex items-center justify-center shrink-0", mode === opt.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500")}>
                      <opt.icon className="size-4" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">{opt.title}</h3>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{opt.desc}</p>
                </button>
              ))}
            </div>

            {/* Product picker (if mode=product) */}
            {mode === 'product' && (
              <div className="space-y-3">
                <p className="text-xs font-bold text-slate-700">Sélectionner un produit</p>
                <input
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  placeholder="Rechercher un produit..."
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:border-slate-400 transition-all"
                />
                <div className="max-h-64 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {productsQuery.isLoading ? (
                    <div className="flex items-center justify-center py-8"><Loader2 className="size-5 animate-spin text-slate-300" /></div>
                  ) : products.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-xs">Aucun produit trouvé</div>
                  ) : products.map(p => (
                    <button key={p.id} onClick={() => setSelectedProduct(p)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
                        selectedProduct?.id === p.id ? "border-slate-900 bg-slate-50" : "border-slate-100 bg-white hover:border-slate-200"
                      )}>
                      <div className="size-10 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                        {p.main_image ? <img src={p.main_image} alt="" className="w-full h-full object-cover" /> : <Package className="size-4 text-slate-300 m-auto mt-3" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{p.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{formatPrice(p.price)} DA</p>
                      </div>
                      {selectedProduct?.id === p.id && <Check className="size-4 text-slate-900 shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-4 border-t border-slate-100">
              <Button
                onClick={() => setStep('form')}
                disabled={mode === 'product' && !selectedProduct}
                className="h-10 px-6 rounded-lg font-bold text-sm bg-slate-900 text-white hover:bg-slate-800"
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
              <Tabs defaultValue="general">
                {/* Tab bar */}
                <div className="px-6 border-b border-slate-200 bg-slate-50/50 overflow-x-auto">
                  <TabsList className="h-12 bg-transparent gap-4 border-0 flex-nowrap">
                    {(() => {
                      const tabs = [
                        { id: 'general',     label: 'Général & Produit' },
                        { id: 'offers',      label: 'Offres & Tarifs' },
                        { id: 'style',       label: 'Design & Style' },
                        { id: 'content',     label: 'Contenu Marketing' },
                        { id: 'reassurance', label: 'Réassurance & FAQ' },
                      ];
                      return tabs.map(t => (
                        <TabsTrigger key={t.id} value={t.id}
                          className="h-12 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-slate-900 rounded-none px-2 text-sm font-medium text-slate-500 data-[state=active]:text-slate-900 whitespace-nowrap transition-colors">
                          {t.label}
                        </TabsTrigger>
                      ));
                    })()}
                  </TabsList>
                </div>

                <div className="p-7 space-y-5">

                  {/* ── GÉNERAL & PRODUIT ── */}
                  <TabsContent value="general" className="mt-0 space-y-6">
                    {/* Part 1: Page details */}
                    <div className="bg-white rounded-[24px] border p-6 space-y-5 border-slate-100">
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
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-700">Titre principal *</label>
                          <Input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="Ex: Produit Révolutionnaire" className="h-10 rounded-lg text-sm" />
                        </div>
                        <div className="sm:col-span-2 space-y-1.5">
                          <label className="text-xs font-bold text-slate-700">Sous-titre</label>
                          <Textarea value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="Description courte et percutante..." rows={3} className="rounded-lg text-sm resize-none" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-700">Badge</label>
                          <Input value={badgeText} onChange={e => setBadgeText(e.target.value)} placeholder="Offre limitée" className="h-10 rounded-lg text-sm" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-700">Bouton d'action</label>
                          <Input value={ctaLabel} onChange={e => setCtaLabel(e.target.value)} placeholder="Commander maintenant" className="h-10 rounded-lg text-sm" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-700">Prix (DA)</label>
                          <Input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="Ex: 2900" className="h-10 rounded-lg text-sm" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-700">Prix barré (DA)</label>
                          <Input type="number" value={comparePrice} onChange={e => setComparePrice(e.target.value)} placeholder="Ex: 4500" className="h-10 rounded-lg text-sm" />
                        </div>
                        <div className="sm:col-span-2 space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Image hero (Galerie)</label>
                          <div className="flex items-center gap-4 p-4 border border-dashed border-slate-200 rounded-2xl bg-slate-50 relative group hover:border-[#6C5CE7]/50 transition-all">
                            {imageUrl ? (
                              <div className="relative size-16 shrink-0 rounded-xl overflow-hidden border border-slate-200">
                                <img src={imageUrl} alt="" className="size-full object-cover" />
                                <button type="button" onClick={() => setImageUrl('')} className="absolute top-1 right-1 p-1 bg-white/80 rounded-lg hover:bg-white text-rose-500 transition-all z-10">
                                  <X className="size-3" />
                                </button>
                              </div>
                            ) : (
                              <div className="size-16 shrink-0 rounded-xl bg-white flex items-center justify-center border border-slate-200">
                                <ImageIcon className="size-6 text-slate-300" />
                              </div>
                            )}
                            <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                              <div>
                                <p className="text-sm font-bold text-slate-700">
                                  {isUploading ? 'Téléversement en cours...' : 'Image principale de la page'}
                                </p>
                                <p className="text-[10px] font-medium text-slate-400 mt-0.5">Format JPG, PNG, WebP (max 20 Mo)</p>
                              </div>
                              <div className="relative shrink-0">
                                <Button type="button" variant="outline" className="h-10 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-2 relative">
                                  <Upload className="size-4 text-slate-500" />
                                  {isUploading ? 'Téléchargement...' : 'Choisir un fichier'}
                                </Button>
                                <input
                                   type="file"
                                   accept="image/jpeg, image/png, image/webp, image/gif, image/avif"
                                   onChange={handleImageUpload}
                                   className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
                                   disabled={isUploading}
                                   title="Cliquez pour uploader"
                                />
                              </div>
                            </div>
                            {isUploading && <Loader2 className="size-5 animate-spin text-[#6C5CE7]" />}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bouton secondaire (optionnel)</label>
                          <Input value={cta2Label} onChange={e => setCta2Label(e.target.value)} placeholder="Nous appeler" className="h-11 rounded-2xl border-slate-200 text-sm font-bold" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Téléphone (optionnel)</label>
                          <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+213 XX XX XX XX" className="h-11 rounded-2xl border-slate-200 text-sm font-bold" />
                        </div>
                      </div>

                      <div className="border-t border-slate-100 pt-4 space-y-1.5 col-span-1 sm:col-span-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Photo Panneau Publicitaire (Bannière de publicité tout en bas de la page de la landing page)</label>
                        <div className="flex items-center gap-4 p-4 border border-dashed border-slate-200 rounded-2xl bg-slate-50 relative group hover:border-[#6C5CE7]/50 transition-all">
                          {bannerImageUrl ? (
                            <div className="relative size-16 shrink-0 rounded-xl overflow-hidden border border-slate-200">
                              <img src={bannerImageUrl} alt="" className="size-full object-cover" />
                              <button type="button" onClick={() => setBannerImageUrl('')} className="absolute top-1 right-1 p-1 bg-white/80 rounded-lg hover:bg-white text-rose-500 transition-all z-10">
                                <X className="size-3" />
                              </button>
                            </div>
                          ) : (
                            <div className="size-16 shrink-0 rounded-xl bg-white flex items-center justify-center border border-slate-200">
                              <ImageIcon className="size-6 text-slate-300" />
                            </div>
                          )}
                          <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div>
                              <p className="text-sm font-bold text-slate-700">
                                {isUploadingBanner ? 'Téléversement en cours...' : 'Bannière publicitaire de bas de page'}
                              </p>
                              <p className="text-[10px] font-medium text-slate-400 mt-0.5">Format JPG, PNG, WebP (max 20 Mo)</p>
                            </div>
                            <div className="relative shrink-0">
                              <Button type="button" variant="outline" className="h-10 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-2 relative">
                                <Upload className="size-4 text-slate-500" />
                                {isUploadingBanner ? 'Téléchargement...' : 'Choisir un fichier'}
                              </Button>
                              <input
                                 type="file"
                                 accept="image/jpeg, image/png, image/webp, image/gif, image/avif"
                                 onChange={handleBannerImageUpload}
                                 className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
                                 disabled={isUploadingBanner}
                                 title="Cliquez pour uploader la bannière"
                              />
                            </div>
                          </div>
                          {isUploadingBanner && <Loader2 className="size-5 animate-spin text-[#6C5CE7]" />}
                        </div>
                      </div>
                    </div>

                    {/* Part 2: Product & Variants details (conditional) */}
                    {(mode === 'new_product' || selectedProduct || existing?.product_id) && (
                      <div className="space-y-6">
                        <div className="bg-white rounded-[24px] border p-6 space-y-6 border-slate-100">
                          <div className="flex items-center gap-2 border-b pb-4">
                            <Package className="size-5 text-slate-800" />
                            <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider">Détails du Produit ERP</h4>
                          </div>
                          
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="space-y-1.5">
                              <label className="text-xs font-bold text-slate-700">Nom du produit</label>
                              <Input value={prodName} onChange={e => setProdName(e.target.value)} placeholder="Nom du produit" className="h-10 rounded-lg text-sm bg-white" />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-bold text-slate-700">SKU (Optionnel)</label>
                              <Input value={prodSku} onChange={e => setProdSku(e.target.value)} placeholder="Auto-généré si vide" className="h-10 rounded-lg text-sm bg-white" />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-bold text-slate-700">
                                 Stock Global * {prodVariants.length > 0 && <span className="text-[10px] text-[#6C5CE7] font-medium">(Calculé)</span>}
                              </label>
                              <Input 
                                type="number" 
                                value={prodStock} 
                                onChange={e => setProdStock(e.target.value)} 
                                placeholder="Ex: 50" 
                                className="h-10 rounded-lg text-sm bg-white disabled:bg-slate-50 disabled:text-slate-500" 
                                disabled={prodVariants.length > 0}
                                title={prodVariants.length > 0 ? "Calculé automatiquement à partir des variantes" : ""}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-bold text-slate-700">Coût d'achat (DA)</label>
                              <Input type="number" value={prodCost} onChange={e => setProdCost(e.target.value)} placeholder="Ex: 1200" className="h-10 rounded-lg text-sm bg-white" />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <label className="text-xs font-bold text-slate-700">Prix de vente (DA)</label>
                              <Input type="number" value={prodPrice} onChange={e => setProdPrice(e.target.value)} placeholder="Ex: 2900" className="h-10 rounded-lg text-sm bg-white" />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-bold text-slate-700">Prix comparé / barré (DA)</label>
                              <Input type="number" value={prodComparePrice} onChange={e => setProdComparePrice(e.target.value)} placeholder="Ex: 4500" className="h-10 rounded-lg text-sm bg-white" />
                            </div>
                          </div>
                        </div>

                        {/* Variants list */}
                        <div className="bg-white rounded-[24px] border p-6 space-y-6 border-slate-100">
                          <div className="flex items-center justify-between border-b pb-4">
                            <div className="flex items-center gap-2">
                              <Palette className="size-5 text-slate-800" />
                              <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider">Variantes du produit</h4>
                            </div>
                            <button
                              type="button"
                              onClick={() => setProdVariants([...prodVariants, { name: 'Couleur', value: '', sku: '', stock: 10, cost: 0, image: '' }])}
                              className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 flex items-center gap-1.5 transition-all"
                            >
                              <Plus className="size-3.5" /> Ajouter variante
                            </button>
                          </div>

                          {prodVariants.length === 0 ? (
                            <p className="text-xs text-slate-400 italic">Aucune variante configurée pour ce produit.</p>
                          ) : (
                            <div className="space-y-4">
                              {prodVariants.map((v, i) => (
                                <div key={i} className="p-4 bg-slate-50/50 rounded-2xl border border-slate-100 space-y-3 relative">
                                  <button
                                    type="button"
                                    onClick={() => setProdVariants(prodVariants.filter((_, idx) => idx !== i))}
                                    className="absolute top-3 right-3 p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                                  >
                                    <Trash2 className="size-4" />
                                  </button>
                                  
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    <div className="space-y-1">
                                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Type</label>
                                      <Input
                                        value={v.name}
                                        onChange={e => {
                                          const next = [...prodVariants];
                                          next[i].name = e.target.value;
                                          setProdVariants(next);
                                        }}
                                        placeholder="Couleur, Taille..."
                                        className="h-9 text-xs rounded-lg bg-white"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Valeur</label>
                                      <div className="flex gap-1.5">
                                        <Input
                                          value={v.value}
                                          onChange={e => {
                                            const next = [...prodVariants];
                                            next[i].value = e.target.value;
                                            setProdVariants(next);
                                          }}
                                          placeholder="Ex: Rouge, XL"
                                          className="h-9 text-xs rounded-lg bg-white flex-1"
                                        />
                                        {v.name.toLowerCase().includes('couleur') && (
                                          <input
                                            type="color"
                                            value={v.color || '#ffffff'}
                                            onChange={e => {
                                              const next = [...prodVariants];
                                              next[i].color = e.target.value;
                                              setProdVariants(next);
                                            }}
                                            className="size-9 rounded-lg border border-slate-200 cursor-pointer shrink-0"
                                          />
                                        )}
                                      </div>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">SKU</label>
                                      <Input
                                        value={v.sku || ''}
                                        onChange={e => {
                                          const next = [...prodVariants];
                                          next[i].sku = e.target.value;
                                          setProdVariants(next);
                                        }}
                                        placeholder="Auto-généré si vide"
                                        className="h-9 text-xs rounded-lg bg-white"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Stock</label>
                                      <Input
                                        type="number"
                                        value={v.stock}
                                        readOnly={v.sub_variants && v.sub_variants.length > 0}
                                        onChange={e => {
                                          const next = [...prodVariants];
                                          next[i].stock = parseInt(e.target.value) || 0;
                                          setProdVariants(next);
                                        }}
                                        placeholder="Stock"
                                        className="h-9 text-xs rounded-lg bg-white"
                                      />
                                    </div>
                                  </div>

                                   {/* ── Sub-variants (Pointures/Tailles) ── */}
                                   <div className="p-3 bg-slate-100/50 rounded-xl border border-slate-200/50 space-y-2.5">
                                     <div className="flex items-center justify-between">
                                       <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Sous-variantes (ex: Pointures)</span>
                                       {!v.sub_variants || v.sub_variants.length === 0 ? (
                                         <button
                                           type="button"
                                           onClick={() => {
                                             const next = [...prodVariants];
                                             next[i].sub_variants = [{ name: 'Taille', value: '', sku: v.sku ? `${v.sku}-1` : '', stock: 10 }];
                                             next[i].stock = 10;
                                             setProdVariants(next);
                                           }}
                                           className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 uppercase tracking-wider"
                                         >
                                           + Activer les sous-variantes
                                         </button>
                                       ) : (
                                         <button
                                           type="button"
                                           onClick={() => {
                                             const next = [...prodVariants];
                                             delete next[i].sub_variants;
                                             setProdVariants(next);
                                           }}
                                           className="text-[10px] font-black text-rose-600 hover:text-rose-800 uppercase tracking-wider"
                                         >
                                           Désactiver
                                         </button>
                                       )}
                                     </div>

                                     {v.sub_variants && v.sub_variants.length > 0 && (
                                       <div className="space-y-2">
                                         {v.sub_variants.map((sv: any, svIdx: number) => (
                                           <div key={svIdx} className="grid grid-cols-12 gap-2 items-center">
                                             <div className="col-span-4">
                                               <Input
                                                 value={sv.value}
                                                 onChange={e => {
                                                   const next = [...prodVariants];
                                                   next[i].sub_variants![svIdx].value = e.target.value;
                                                   setProdVariants(next);
                                                 }}
                                                 placeholder="Ex: 41"
                                                 className="h-8 text-xs rounded-lg border-slate-200 bg-white font-bold"
                                               />
                                             </div>
                                             <div className="col-span-4">
                                               <Input
                                                 value={sv.sku}
                                                 onChange={e => {
                                                   const next = [...prodVariants];
                                                   next[i].sub_variants![svIdx].sku = e.target.value;
                                                   setProdVariants(next);
                                                 }}
                                                 placeholder="SKU"
                                                 className="h-8 text-[10px] rounded-lg border-slate-200 bg-white font-mono"
                                               />
                                             </div>
                                             <div className="col-span-3">
                                               <Input
                                                 type="number"
                                                 value={sv.stock}
                                                 onChange={e => {
                                                   const next = [...prodVariants];
                                                   next[i].sub_variants![svIdx].stock = parseInt(e.target.value) || 0;
                                                   next[i].stock = next[i].sub_variants!.reduce((sum: number, item: any) => sum + (item.stock || 0), 0);
                                                   setProdVariants(next);
                                                 }}
                                                 placeholder="Stock"
                                                 className="h-8 text-xs rounded-lg border-slate-200 bg-white font-black text-[#20bf6b]"
                                               />
                                             </div>
                                             <div className="col-span-1 flex justify-end">
                                               <button
                                                 type="button"
                                                 onClick={() => {
                                                   const next = [...prodVariants];
                                                   next[i].sub_variants = next[i].sub_variants!.filter((_: any, idx: number) => idx !== svIdx);
                                                   next[i].stock = next[i].sub_variants!.reduce((sum: number, item: any) => sum + (item.stock || 0), 0);
                                                   setProdVariants(next);
                                                 }}
                                                 className="text-rose-500 hover:text-rose-700 p-1"
                                               >
                                                 <X className="size-3.5" />
                                               </button>
                                             </div>
                                           </div>
                                         ))}
                                         <div className="flex gap-2 w-full mt-2">
                                            <button
                                               type="button"
                                               onClick={() => {
                                                  const next = [...prodVariants];
                                                  next[i].sub_variants!.push({ name: 'Taille', value: '', sku: v.sku ? `${v.sku}-${v.sub_variants!.length + 1}` : '', stock: 10 });
                                                  next[i].stock = next[i].sub_variants!.reduce((sum, item) => sum + (item.stock || 0), 0);
                                                  setProdVariants(next);
                                               }}
                                               className="flex-1 py-1.5 border border-dashed rounded-lg text-[9px] font-black text-slate-500 hover:text-indigo-600 hover:bg-white hover:border-indigo-300 transition-all uppercase tracking-wider"
                                            >
                                               + Unitaire
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                   setSizeRangeModal({
                                                      isOpen: true,
                                                      variantIndex: i,
                                                      rangeStr: '',
                                                      qtyStr: '10',
                                                      onSuccess: (range, qty) => {
                                                         const parts = range.split('-');
                                                         const min = parseInt(parts[0]);
                                                         const max = parseInt(parts[1]);
                                                         if (isNaN(min) || isNaN(max) || min > max) {
                                                            toast.error("Intervalle invalide. Format attendu : Min-Max (ex: 40-45)");
                                                            return;
                                                         }
                                                         const stockQty = parseInt(qty || '10') || 0;
                                                         
                                                         const next = [...prodVariants];
                                                         if (!next[i].sub_variants) next[i].sub_variants = [];
                                                         
                                                         for (let val = min; val <= max; val++) {
                                                            next[i].sub_variants.push({
                                                               name: 'Taille',
                                                               value: String(val),
                                                               sku: v.sku ? `${v.sku}-${val}` : `SKU-${val}`,
                                                               stock: stockQty
                                                            });
                                                         }
                                                         next[i].stock = next[i].sub_variants.reduce((sum: number, item: any) => sum + (item.stock || 0), 0);
                                                         setProdVariants(next);
                                                         toast.success("Pointures générées avec succès !");
                                                      }
                                                   });
                                                }}
                                                className="flex-1 py-1.5 border border-dashed rounded-lg text-[9px] font-black text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50/50 hover:border-indigo-400 transition-all uppercase tracking-wider bg-indigo-50/20"
                                             >
                                                ⚡ Par Intervalle (ex: 40-45)
                                            </button>
                                          </div>
                                       </div>
                                     )}
                                   </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                                    <div className="space-y-1">
                                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Coût d'achat de la variante (DA)</label>
                                      <Input
                                        type="number"
                                        value={v.cost || ''}
                                        onChange={e => {
                                          const next = [...prodVariants];
                                          next[i].cost = parseInt(e.target.value) || 0;
                                          setProdVariants(next);
                                        }}
                                        placeholder="Optionnel"
                                        className="h-9 text-xs rounded-lg bg-white"
                                      />
                                    </div>
                                    {/* Toute variante (Couleur, Motif, Modèle…) peut avoir sa
                                        propre photo — plus limité aux seules variantes "Couleur". */}
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Photo de la variante</label>
                                        <div className="flex items-center gap-2">
                                          {v.image && (
                                            <div className="relative size-9 shrink-0 rounded-lg overflow-hidden border border-slate-200 bg-white">
                                              <img src={v.image} alt="" className="size-full object-cover" />
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const next = [...prodVariants];
                                                  next[i].image = '';
                                                  setProdVariants(next);
                                                }}
                                                className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 flex items-center justify-center transition-all"
                                              >
                                                <X className="size-3.5 text-white" />
                                              </button>
                                            </div>
                                          )}
                                          <div className="relative h-9 px-3 rounded-lg border border-dashed border-slate-300 hover:border-slate-400 bg-slate-50 hover:bg-slate-100 flex items-center justify-center cursor-pointer transition-all text-xs font-bold text-slate-600 gap-1.5 shrink-0">
                                            {uploadingVariantIdx === i ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                                            {v.image ? 'Changer' : 'Photo'}
                                            <input
                                              type="file"
                                              className="absolute inset-0 opacity-0 cursor-pointer"
                                              accept="image/*"
                                              onChange={(e) => handleVariantImageUpload(e, i)}
                                              disabled={uploadingVariantIdx !== null}
                                            />
                                          </div>
                                        </div>
                                      </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Part 3: Shipping / Livraison */}
                        <div className="p-6 bg-white rounded-[24px] border border-slate-100 space-y-4">
                          <div className="flex items-center justify-between border-b pb-4">
                            <div className="flex items-center gap-2">
                              <Truck className="size-5 text-slate-800" />
                              <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider">Frais de livraison du produit</h4>
                            </div>
                            <input 
                              type="checkbox" 
                              checked={isFreeShipping} 
                              onChange={e => setIsFreeShipping(e.target.checked)} 
                              className="size-6 rounded-lg border-slate-300 text-[#6C5CE7] focus:ring-[#6C5CE7]" 
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500 font-medium">Offrir la livraison gratuite pour ce produit</span>
                          </div>
                        </div>

                        {!isFreeShipping && (
                          <div className="space-y-5">
                            {/* Default Carrier Fees */}
                            <div className="p-6 bg-slate-50 rounded-[24px] border border-slate-200/60 space-y-4">
                              <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider">Tarifs par défaut de la boutique</h4>
                              <p className="text-xs text-slate-400">Voici les tarifs par défaut de vos transporteurs. Ils s'appliqueront si aucune exception n'est configurée ci-dessous.</p>
                              
                              {carriers.length === 0 ? (
                                <p className="text-xs text-slate-400 italic">Aucun transporteur connecté. Configurez-les dans les paramètres de livraison.</p>
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  {carriers.map((p: any) => {
                                    const carrierId = p.id ?? p.carrier_id ?? p.name;
                                    const carrierName = p.name ?? p.carrier_name ?? carrierId;
                                    return (
                                      <div key={carrierId} className="p-4 bg-white border border-slate-100 rounded-2xl flex flex-col gap-1 shadow-sm">
                                        <div className="flex items-center gap-3">
                                          {p.logo_url ? (
                                            <img src={p.logo_url} alt={carrierName} className="size-8 object-contain rounded-lg border border-slate-100" />
                                          ) : (
                                            <div className="size-8 rounded-lg bg-slate-100 flex items-center justify-center text-[9px] font-black text-slate-400 uppercase">{carrierName.slice(0, 2)}</div>
                                          )}
                                          <div>
                                            <p className="text-xs font-bold text-slate-700">{carrierName}</p>
                                            {p.fee_home !== undefined && (
                                              <p className="text-[10px] text-slate-400 font-medium">
                                                Forfait: Dom {p.fee_home} DA | Bur {p.fee_relay} DA
                                              </p>
                                            )}
                                          </div>
                                        </div>

                                        {p.pricing_grid && p.pricing_grid.length > 0 ? (
                                          <details className="group mt-2">
                                            <summary className="text-[10px] font-black text-[#6C5CE7] hover:underline cursor-pointer list-none flex items-center gap-1 select-none">
                                              <span>Grille tarifaire par Wilaya ({p.pricing_grid.length})</span>
                                              <span className="transition-transform group-open:rotate-180 text-[8px]">▼</span>
                                            </summary>
                                            <div className="grid grid-cols-2 gap-2 mt-2 p-2.5 bg-slate-50 rounded-xl max-h-[140px] overflow-y-auto custom-scrollbar border border-slate-100">
                                              {p.pricing_grid.map((g: any) => {
                                                const wName = WILAYAS[g.wilaya_id - 1] || `Wilaya ${g.wilaya_id}`;
                                                return (
                                                  <div key={g.wilaya_id} className="text-[9px] p-1.5 bg-white rounded-lg border border-slate-200/60">
                                                    <p className="font-bold text-slate-700">{wName}</p>
                                                    <p className="text-slate-400 mt-0.5 font-medium">Dom: {g.home_fee} DA | Bur: {g.office_fee} DA</p>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </details>
                                        ) : (
                                          <p className="text-[10px] text-slate-400 mt-1 italic">Tarif forfaitaire appliqué.</p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            <div className="p-6 bg-white rounded-[24px] border border-slate-100 space-y-4">
                              <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider">Coûts de livraison personnalisés par Wilaya</h4>
                              <p className="text-xs text-slate-400">Configurez des tarifs personnalisés par transporteur et wilaya pour ce produit.</p>
                              
                              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Transporteur</label>
                                  <select 
                                    value={selectedCarrierId} 
                                    onChange={e => setSelectedCarrierId(e.target.value)}
                                    className="w-full h-10 rounded-lg border border-slate-200 text-xs bg-white px-2"
                                  >
                                    <option value="">Choisir...</option>
                                    {carriers.map((c: any) => {
                                      const carrierId = c.id ?? c.carrier_id ?? c.name;
                                      const carrierName = c.name ?? c.carrier_name ?? carrierId;
                                      return <option key={carrierId} value={carrierId}>{carrierName}</option>;
                                    })}
                                  </select>
                                </div>
                                
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Wilaya</label>
                                  <select 
                                    value={selectedWilayaId} 
                                    onChange={e => setSelectedWilayaId(e.target.value)}
                                    className="w-full h-10 rounded-lg border border-slate-200 text-xs bg-white px-2"
                                  >
                                    {WILAYAS.map((w, index) => (
                                      <option key={index + 1} value={String(index + 1)}>{index + 1} - {w}</option>
                                    ))}
                                  </select>
                                </div>

                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Domicile (DA)</label>
                                  <Input 
                                    type="number" 
                                    value={customHomeFee} 
                                    onChange={e => setCustomHomeFee(e.target.value)} 
                                    placeholder="Ex: 500" 
                                    className="h-10 text-xs bg-white"
                                  />
                                </div>

                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Bureau (DA)</label>
                                  <div className="flex gap-2">
                                    <Input 
                                      type="number" 
                                      value={customDeskFee} 
                                      onChange={e => setCustomDeskFee(e.target.value)} 
                                      placeholder="Ex: 300" 
                                      className="h-10 text-xs bg-white flex-1"
                                    />
                                    <Button 
                                      type="button" 
                                      onClick={handleAddCustomFee} 
                                      disabled={!selectedCarrierId || !customHomeFee}
                                      className="h-10 bg-slate-900 text-white font-bold hover:bg-slate-800 rounded-lg text-xs shrink-0 px-4"
                                    >
                                      Ajouter
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Configured fees list */}
                            <div className="space-y-3">
                              <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Tarifs de livraison configurés</h5>
                              {Object.keys(deliveryFees).length === 0 ? (
                                <p className="text-xs text-slate-400 italic">Aucun tarif personnalisé. Les tarifs par défaut s'appliqueront.</p>
                              ) : (
                                <div className="border border-slate-100 rounded-[20px] overflow-hidden divide-y divide-slate-50 bg-white">
                                  {Object.entries(deliveryFees).map(([carrier, wilayasObj]: any) => (
                                    <div key={carrier} className="p-4 space-y-2">
                                      <h6 className="text-xs font-bold text-slate-800 uppercase flex items-center gap-1.5">
                                        <Truck className="size-3.5 text-slate-500" /> Transporteur: {carrier}
                                      </h6>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pl-5">
                                        {Object.entries(wilayasObj || {}).map(([wilayaId, rates]: any) => {
                                          const wName = WILAYAS[parseInt(wilayaId) - 1] || `Wilaya ${wilayaId}`;
                                          return (
                                            <div key={wilayaId} className="flex items-center justify-between p-2.5 bg-slate-50/50 rounded-xl border border-slate-100 text-xs">
                                              <div className="min-w-0">
                                                <p className="font-bold text-slate-700 truncate">{wName}</p>
                                                <p className="text-[10px] text-slate-400 mt-0.5">
                                                  Domicile: {rates.home} DA | Bureau: {rates.desk || rates.office || 0} DA
                                                </p>
                                              </div>
                                              <button 
                                                type="button" 
                                                onClick={() => handleRemoveCustomFee(carrier, wilayaId)}
                                                className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-all ml-2"
                                              >
                                                <Trash2 className="size-3.5" />
                                              </button>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  {/* ── OFFRES & TARIFS ── */}
                  <TabsContent value="offers" className="mt-0 space-y-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">Offres de quantité</h4>
                        <p className="text-xs text-slate-500 mt-0.5">Configurez des remises sur quantité (ex: 2 pièces pour 2400 DA). Laissez vide pour utiliser les prix par défaut.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOffers([...offers, { quantity: offers.length + 1, price: price ? parseInt(price) * (offers.length + 1) : 0, compare_price: comparePrice ? parseInt(comparePrice) * (offers.length + 1) : 0, name: `${offers.length + 1} Pièces`, desc: 'Profiter de l\'offre', popular: false }])}
                        className="px-3 py-1.5 bg-[#6C5CE7] hover:bg-[#5a4bd1] text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all"
                      >
                        <Plus className="size-3.5" /> Ajouter une offre
                      </button>
                    </div>

                    {offers.length === 0 ? (
                      <div className="p-8 text-center border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                        <Package className="size-8 text-slate-300 mx-auto mb-2" />
                        <p className="text-xs font-bold text-slate-600">Aucune offre de quantité configurée</p>
                        <p className="text-[10px] text-slate-400 mt-1">Le système proposera automatiquement une option simple de 1 et 2 pièces basée sur le prix général.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {offers.map((offer, idx) => (
                          <div key={idx} className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm relative group space-y-4 animate-in fade-in duration-200">
                            <button
                              type="button"
                              onClick={() => setOffers(offers.filter((_, i) => i !== idx))}
                              className="absolute top-3 right-3 p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                            >
                              <Trash2 className="size-4" />
                            </button>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                              <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-700">Titre de l'offre</label>
                                <Input
                                  value={offer.name || ''}
                                  onChange={e => {
                                    const next = [...offers];
                                    next[idx].name = e.target.value;
                                    setOffers(next);
                                  }}
                                  placeholder="Ex: 2 Pièces (Offre Populaire)"
                                  className="h-10 rounded-lg text-xs"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-700">Quantité</label>
                                <Input
                                  type="number"
                                  value={offer.quantity}
                                  onChange={e => {
                                    const next = [...offers];
                                    next[idx].quantity = parseInt(e.target.value) || 0;
                                    setOffers(next);
                                  }}
                                  placeholder="Ex: 2"
                                  className="h-10 rounded-lg text-xs"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-700">Prix spécial (DA)</label>
                                <Input
                                  type="number"
                                  value={offer.price}
                                  onChange={e => {
                                    const next = [...offers];
                                    next[idx].price = parseInt(e.target.value) || 0;
                                    setOffers(next);
                                  }}
                                  placeholder="Ex: 4800"
                                  className="h-10 rounded-lg text-xs font-bold text-slate-800"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-700">Prix barré (DA)</label>
                                <Input
                                  type="number"
                                  value={offer.compare_price}
                                  onChange={e => {
                                    const next = [...offers];
                                    next[idx].compare_price = parseInt(e.target.value) || 0;
                                    setOffers(next);
                                  }}
                                  placeholder="Ex: 9000"
                                  className="h-10 rounded-lg text-xs"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-700">Description courte (optionnel)</label>
                                <Input
                                  value={offer.desc || ''}
                                  onChange={e => {
                                    const next = [...offers];
                                    next[idx].desc = e.target.value;
                                    setOffers(next);
                                  }}
                                  placeholder="Ex: Économisez 1000 DA + Livraison Gratuite"
                                  className="h-10 rounded-lg text-xs"
                                />
                              </div>
                              <div className="flex items-center gap-2 pt-6">
                                <input
                                  type="checkbox"
                                  checked={offer.popular || false}
                                  onChange={e => {
                                    const next = [...offers];
                                    next[idx].popular = e.target.checked;
                                    setOffers(next);
                                  }}
                                  className="size-4 rounded border-slate-300 text-[#6C5CE7] focus:ring-[#6C5CE7]"
                                />
                                <span className="text-xs font-bold text-slate-700">Marquer comme offre populaire</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  {/* ── DESIGN & STYLE ── */}
                  <TabsContent value="style" className="mt-0 space-y-5">
                    <div className="space-y-3">
                      <p className="text-xs font-bold text-slate-700">Template</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {TEMPLATES.map(t => (
                          <button key={t.id} onClick={() => setTemplate(t.id)}
                            className={cn("relative p-4 rounded-xl border transition-all overflow-hidden h-24",
                              template === t.id ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200 hover:border-slate-300"
                            )}>
                            <div className={cn("absolute inset-0", t.preview)} />
                            <div className="relative z-10 flex flex-col h-full justify-end">
                              <p className={cn("text-sm font-bold text-left", t.text)}>{t.label}</p>
                            </div>
                            {template === t.id && (
                              <div className="absolute top-3 right-3 size-5 rounded-full bg-slate-900 flex items-center justify-center">
                                <Check className="size-3 text-white" />
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-xs font-bold text-slate-700">Couleur Primaire (Boutons, accents…)</p>
                      <div className="flex gap-4 items-center">
                        <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
                          className="size-12 rounded-xl border border-slate-200 cursor-pointer shrink-0" />
                        <Input value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
                          placeholder="#e84393" className="h-10 rounded-lg text-sm w-32 font-mono uppercase" />
                        <div className="flex gap-2">
                          {['#e84393', '#6c5ce7', '#0984e3', '#00b894', '#fdcb6e', '#2d3436'].map(c => (
                            <button key={c} onClick={() => setPrimaryColor(c)} className="size-6 rounded-full border border-white ring-1 ring-slate-200" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  {/* ── CONTENU MARKETING ── */}
                  <TabsContent value="content" className="mt-0 space-y-6">
                    {/* Avantages */}
                    <div className="bg-white rounded-[24px] border p-6 space-y-4 border-slate-100">
                      <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider border-b pb-3">3 avantages clés (affichés sous le hero)</h4>
                      {benefits.map((b, i) => (
                        <div key={i} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                          <p className="text-[10px] font-black text-slate-400 uppercase">Avantage {i + 1}</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Input value={b.title} onChange={e => setBenefits(bens => bens.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                              placeholder="Titre" className="h-10 rounded-xl border-slate-200 text-sm font-bold" />
                            <Input value={b.desc} onChange={e => setBenefits(bens => bens.map((x, j) => j === i ? { ...x, desc: e.target.value } : x))}
                              placeholder="Description courte" className="h-10 rounded-xl border-slate-200 text-sm" />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Étapes */}
                    <div className="bg-white rounded-[24px] border p-6 space-y-4 border-slate-100">
                      <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider border-b pb-3">Section "Comment ça marche ?" — 3 étapes</h4>
                      {steps.map((s, i) => (
                        <div key={i} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                          <div className="flex items-center gap-2">
                            <div className="size-8 rounded-xl bg-[#6C5CE7]/10 flex items-center justify-center">
                              <span className="text-[11px] font-black text-[#6C5CE7]">{s.step}</span>
                            </div>
                            <p className="text-[10px] font-black text-slate-400 uppercase">Étape {i + 1}</p>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Input
                              value={s.title}
                              onChange={e => setSteps(arr => arr.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                              placeholder="Titre de l'étape"
                              className="h-10 rounded-xl border-slate-200 text-sm font-bold"
                            />
                            <Input
                              value={s.step}
                              onChange={e => setSteps(arr => arr.map((x, j) => j === i ? { ...x, step: e.target.value } : x))}
                              placeholder="N° (01, 02…)"
                              className="h-10 rounded-xl border-slate-200 text-sm font-mono"
                            />
                          </div>
                          <Textarea
                            value={s.desc}
                            onChange={e => setSteps(arr => arr.map((x, j) => j === i ? { ...x, desc: e.target.value } : x))}
                            placeholder="Description de l'étape..."
                            rows={2}
                            className="rounded-xl border-slate-200 text-sm resize-none"
                          />
                        </div>
                      ))}
                    </div>

                    {/* Statistiques */}
                    <div className="bg-white rounded-[24px] border p-6 space-y-4 border-slate-100">
                      <div className="flex items-center justify-between border-b pb-3">
                        <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider">Compteurs animés (affichés sous le hero)</h4>
                        <button
                          onClick={() => setStats(s => [...s, { value: 0, suffix: '+', label: '' }])}
                          className="flex items-center gap-1.5 text-[10px] font-black text-[#6C5CE7] hover:underline"
                        >
                          <Plus className="size-3.5" /> Ajouter
                        </button>
                      </div>
                      {stats.length === 0 && (
                        <p className="text-xs text-slate-400 italic">Aucun compteur configuré.</p>
                      )}
                      {stats.map((s, i) => (
                        <div key={i} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] font-black text-slate-400 uppercase">Stat {i + 1}</p>
                            {stats.length > 1 && (
                              <button onClick={() => setStats(arr => arr.filter((_, j) => j !== i))} className="text-rose-400">
                                <X className="size-3.5" />
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <Input
                              type="number"
                              value={s.value}
                              onChange={e => setStats(arr => arr.map((x, j) => j === i ? { ...x, value: parseInt(e.target.value) || 0 } : x))}
                              placeholder="Valeur (ex: 12000)"
                              className="h-10 rounded-xl border-slate-200 text-sm font-black"
                            />
                            <Input
                              value={s.suffix}
                              onChange={e => setStats(arr => arr.map((x, j) => j === i ? { ...x, suffix: e.target.value } : x))}
                              placeholder="Suffixe (+, %, h…)"
                              className="h-10 rounded-xl border-slate-200 text-sm font-mono text-center"
                            />
                            <Input
                              value={s.label}
                              onChange={e => setStats(arr => arr.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                              placeholder="Libellé"
                              className="h-10 rounded-xl border-slate-200 text-sm font-bold"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  {/* ── RÉASSURANCE & FAQ ── */}
                  <TabsContent value="reassurance" className="mt-0 space-y-6">
                    {/* Témoignages */}
                    <div className="bg-white rounded-[24px] border p-6 space-y-4 border-slate-100">
                      <div className="flex items-center justify-between border-b pb-3">
                        <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider">Témoignages clients</h4>
                        <button onClick={() => setTestimonials(t => [...t, { name: '', location: '', text: '', stars: 5 }])}
                          className="flex items-center gap-1.5 text-[10px] font-black text-[#6C5CE7] hover:underline">
                          <Plus className="size-3.5" /> Ajouter
                        </button>
                      </div>
                      {testimonials.length === 0 && (
                        <p className="text-xs text-slate-400 italic">Aucun témoignage configuré.</p>
                      )}
                      {testimonials.map((t, i) => (
                        <div key={i} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] font-black text-slate-400 uppercase">Avis {i + 1}</p>
                            <button onClick={() => setTestimonials(ts => ts.filter((_, j) => j !== i))} className="text-rose-400 hover:text-rose-600">
                              <X className="size-3.5" />
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    </div>

                    {/* Bannière de réassurance finale */}
                    <div className="bg-white rounded-[24px] border p-6 space-y-4 border-slate-100">
                      <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider border-b pb-3">Bannière de réassurance finale (Bas de page)</h4>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Titre de la bannière</label>
                        <Input value={ctaHeadline} onChange={e => setCtaHeadline(e.target.value)} placeholder="Ex: Redéfinissez votre façon de voyager" className="h-11 rounded-2xl border-slate-200 text-sm font-bold" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sous-titre / Texte de réassurance</label>
                        <Textarea value={ctaSubtitle} onChange={e => setCtaSubtitle(e.target.value)} placeholder="Ex: Le confort d'un nuage, partout avec vous." rows={3} className="rounded-2xl border-slate-200 text-sm font-medium resize-none" />
                      </div>

                      <div className="border-t border-slate-200 pt-4 space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Photo Panneau Publicitaire (Bannière de publicité tout en bas de la page)</label>
                        <div className="flex items-center gap-4 p-4 border border-dashed border-slate-200 rounded-2xl bg-white relative group hover:border-[#6C5CE7]/50 transition-all">
                          {bannerImageUrl ? (
                            <div className="relative size-16 shrink-0 rounded-xl overflow-hidden border border-slate-200">
                              <img src={bannerImageUrl} alt="" className="size-full object-cover" />
                              <button type="button" onClick={() => setBannerImageUrl('')} className="absolute top-1 right-1 p-1 bg-white/80 rounded-lg hover:bg-white text-rose-500 transition-all z-10">
                                <X className="size-3" />
                              </button>
                            </div>
                          ) : (
                            <div className="size-16 shrink-0 rounded-xl bg-slate-50 flex items-center justify-center border border-slate-200">
                              <ImageIcon className="size-6 text-slate-300" />
                            </div>
                          )}
                          <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div>
                              <p className="text-sm font-bold text-slate-700">
                                {isUploadingBanner ? 'Téléversement en cours...' : 'Bannière publicitaire de bas de page'}
                              </p>
                              <p className="text-[10px] font-medium text-slate-400 mt-0.5">Format JPG, PNG, WebP (max 20 Mo)</p>
                            </div>
                            <div className="relative shrink-0">
                              <Button type="button" variant="outline" className="h-10 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-2 relative">
                                <Upload className="size-4 text-slate-500" />
                                {isUploadingBanner ? 'Téléchargement...' : 'Choisir un fichier'}
                              </Button>
                              <input
                                 type="file"
                                 accept="image/jpeg, image/png, image/webp, image/gif, image/avif"
                                 onChange={handleBannerImageUpload}
                                 className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
                                 disabled={isUploadingBanner}
                                 title="Cliquez pour uploader la bannière"
                              />
                            </div>
                          </div>
                          {isUploadingBanner && <Loader2 className="size-5 animate-spin text-[#6C5CE7]" />}
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                </div>
              </Tabs>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 bg-white flex items-center justify-between shrink-0">
              {!isEdit && (
                <button onClick={() => setStep('pick')} className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors">
                  <ChevronRight className="size-4 rotate-180" /> Retour
                </button>
              )}
              <div className={cn("flex items-center gap-3", isEdit && "ml-auto")}>
                <Button variant="ghost" onClick={onClose} className="h-10 px-4 rounded-lg font-medium text-slate-600">Annuler</Button>
                <Button onClick={handleSave} disabled={saving || !headline.trim()}
                  className="h-10 px-6 rounded-lg font-bold text-white bg-slate-900 hover:bg-slate-800">
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <>{isEdit ? 'Enregistrer' : 'Créer la page'}</>}
                </Button>
              </div>
            </div>
          </>
        )}
      {sizeRangeModal && sizeRangeModal.isOpen && (
        <Dialog open onOpenChange={(open) => { if (!open) setSizeRangeModal(null); }}>
          <DialogContent className="max-w-sm bg-white rounded-3xl border border-slate-100 shadow-2xl p-6 gap-0 z-[10000]">
            <div className="space-y-5">
              <div className="space-y-1.5 text-center">
                <DialogTitle className="text-sm font-black uppercase tracking-widest text-slate-700">
                  ⚡ Générer des pointures
                </DialogTitle>
                <p className="text-xs text-slate-500 font-medium">Créez rapidement une série de pointures avec leur stock.</p>
              </div>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Intervalle de pointures</label>
                  <Input
                    type="text"
                    placeholder="ex: 40-45"
                    value={sizeRangeModal.rangeStr}
                    onChange={(e) => setSizeRangeModal({ ...sizeRangeModal, rangeStr: e.target.value })}
                    className="h-11 rounded-xl border-slate-200 bg-slate-50 font-bold text-sm"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Stock par pointure</label>
                  <Input
                    type="number"
                    placeholder="ex: 10"
                    value={sizeRangeModal.qtyStr}
                    onChange={(e) => setSizeRangeModal({ ...sizeRangeModal, qtyStr: e.target.value })}
                    className="h-11 rounded-xl border-slate-200 bg-slate-50 font-black text-sm text-emerald-600"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setSizeRangeModal(null)}
                  className="flex-1 h-11 rounded-xl text-xs font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-all uppercase tracking-wider active:scale-95"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { rangeStr, qtyStr, onSuccess } = sizeRangeModal;
                    onSuccess(rangeStr, qtyStr);
                    setSizeRangeModal(null);
                  }}
                  className="flex-1 h-11 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-all uppercase tracking-wider active:scale-95 shadow-md shadow-indigo-500/30"
                >
                  Générer
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export default function LandingPagesDashboard() {
  const { activeStore, allStores } = useAppStore();
  const storeId  = activeStore?.id ?? '';
  const storeSlug = activeStore?.slug ?? '';
  const queryClient = useQueryClient();

  // Debug log to trace storeId issues
  useEffect(() => {
    console.log('[LandingPages] activeStore:', activeStore?.id, activeStore?.slug);
    console.log('[LandingPages] allStores count:', allStores.length);
    if (!activeStore && allStores.length > 0) {
      console.warn('[LandingPages] activeStore is null but allStores has data — possible hydration race');
    }
  }, [activeStore, allStores]);

  const [showCreate, setShowCreate] = useState(false);
  const [editingLP, setEditingLP]   = useState<LandingPage | null>(null);
  const [deletingLP, setDeletingLP] = useState<LandingPage | null>(null);
  const [analyticsLP, setAnalyticsLP] = useState<LandingPage | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  // Filtres qui agissent réellement sur la liste affichée — le sélecteur de
  // dates ci-dessus ne filtre QUE les métriques (vues/commandes) de chaque
  // carte, jamais les pages elles-mêmes (c'est voulu côté backend), ce qui
  // donnait l'impression que "les filtres ne marchent pas". Ceux-ci changent
  // vraiment quelles cartes apparaissent.
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const buildQueryStr = () => {
    const params = new URLSearchParams({ store_id: storeId });
    if (startDate) params.set('start_date', startDate + 'T00:00:00.000Z');
    if (endDate) params.set('end_date', endDate + 'T23:59:59.999Z');
    return params.toString();
  };

  const { data: raw, isLoading } = useQuery({
    queryKey: ['landing-pages', storeId, startDate, endDate],
    queryFn:  () => {
      console.log('[LandingPages] Fetching for store_id:', storeId);
      return apiFetch<any>(`/api/v1/landing-pages?${buildQueryStr()}`);
    },
    enabled:  !!storeId,
    // Vues/Ordres/Conv. only refreshed on manual reload or after an edit —
    // a landing page taking live traffic could sit on stale numbers for as
    // long as the admin kept the tab open. Poll so the cards stay current
    // without her having to refresh the page herself.
    refetchInterval: 2 * 60 * 60 * 1000,
    refetchIntervalInBackground: false,
  });

  const pages: LandingPage[] = raw?.data ?? raw ?? [];

  const filteredPages = pages.filter(p => {
    if (statusFilter === 'active' && !p.is_active) return false;
    if (statusFilter === 'inactive' && p.is_active) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      const haystack = [p.slug, p.headline, p.product_name].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/landing-pages/${id}/toggle`, { method: 'PATCH' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['landing-pages'] }); toast.success('Statut modifié'); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/landing-pages/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['landing-pages'] }); toast.success('Page supprimée'); setDeletingLP(null); },
  });

  const handleCopy = (slug: string) => {
    // Find the LP by slug to determine its own store
    const lp = pages.find(p => p.slug === slug);
    const lpOwnStore = lp ? allStores.find(s => s.id === lp.store_id) : allStores.find(s => s.slug === storeSlug);
    const lpStoreSlug = lpOwnStore?.slug || storeSlug;
    const storeDomain = lpOwnStore?.domain || `${lpStoreSlug}.azghub.com`;
    const isLocal = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' || 
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.includes('hf.space') ||
      window.location.hostname.includes('huggingface.co')
    );
    const url = isLocal 
      ? `${window.location.origin}/lp/${slug}?store=${lpStoreSlug}`
      : `https://${storeDomain}/lp/${slug}`;
    navigator.clipboard.writeText(url).then(() => toast.success('Lien copié !'));
  };

  const totalViews  = pages.reduce((s, p) => s + (p.views || 0), 0);
  const totalOrders = pages.reduce((s, p) => s + (p.orders || 0), 0);
  const activeCount = pages.filter(p => p.is_active).length;
  // Manuel = commandes créées à la main (téléphone/admin) — jamais vues par
  // Meta, pas de clic pub. Détecté Meta = achats que Meta a lui-même
  // attribué à sa propre publicité (son pixel/CAPI), indépendamment de nos
  // commandes ERP. Les deux répondent à des questions différentes, d'où des
  // totaux qui ne coïncident jamais exactement — normal, pas une erreur.
  const totalManual = pages.reduce((s, p) => s + ((p.metrics as any)?.manual ?? 0), 0);
  const totalMetaDetected = pages.reduce((s, p) => s + ((p.metrics as any)?.meta_purchases ?? 0), 0);
  const metaSyncTimestamps = pages
    .map(p => (p.metrics as any)?.meta_last_synced_at)
    .filter(Boolean) as string[];
  const oldestMetaSync = metaSyncTimestamps.length
    ? metaSyncTimestamps.reduce((oldest, t) => (t < oldest ? t : oldest))
    : null;

  // NO auto-sync on mount — reverted. This page has no sync button of its
  // own; it only ever DISPLAYS Meta numbers that meta-ads-dashboard.tsx (or
  // the backend's own 3h background sync) already wrote to the DB. Firing
  // a full sync (4 Meta HTTP calls + up to ~300 SQL statements for a
  // multi-campaign store) every time this page is opened, on top of the
  // Meta Ads tab doing the same, would double the request volume against
  // Supabase Free for zero benefit — this page was never the right place
  // to trigger a sync from in the first place.

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">

      {/* ── Header ── */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 border-b border-slate-100 pb-5">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Landing Pages</h1>
            <p className="text-sm text-slate-500 mt-1">Créez des pages de vente pour mettre en avant vos produits.</p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
             <input
               type="text"
               value={searchTerm}
               onChange={e => setSearchTerm(e.target.value)}
               placeholder="Rechercher (nom, produit, slug)…"
               className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-sm font-bold text-slate-600 outline-none w-full sm:w-[220px]"
             />
             <select
               value={statusFilter}
               onChange={e => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
               className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-sm font-bold text-slate-600 outline-none shrink-0"
             >
               <option value="all">Toutes les pages</option>
               <option value="active">Actives</option>
               <option value="inactive">Inactives</option>
             </select>
             <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 shrink-0" title="Filtre les statistiques (vues/commandes) de chaque page, pas la liste elle-même">
                <Calendar className="size-4 text-slate-400" />
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent text-sm font-bold text-slate-600 outline-none w-[120px]" />
                <span className="text-slate-300">-</span>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent text-sm font-bold text-slate-600 outline-none w-[120px]" />
             </div>
             <Button onClick={() => setShowCreate(true)}
               className="h-10 px-5 rounded-lg bg-slate-900 text-white font-bold hover:bg-slate-800 shrink-0">
               <Plus className="size-4 mr-2" /> Nouvelle landing page
             </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mt-5">
          {[
            { label: 'Pages actives', value: activeCount, Icon: LayoutTemplate },
            { label: 'Vues totales',  value: totalViews.toLocaleString('fr-FR'),  Icon: Eye },
            { label: 'Commandes générées', value: totalOrders, Icon: ShoppingCart },
            {
              label: 'Dont manuelles', value: totalManual, Icon: Users,
              title: "Commandes créées à la main par un agent (téléphone, réseaux sociaux) — jamais vues par Meta, aucun clic publicitaire derrière.",
            },
            {
              label: 'Détectées Meta', value: totalMetaDetected, Icon: Sparkles, accent: '#1877F2',
              title: "Achats que Meta a lui-même attribués à sa propre publicité (son pixel + API Conversions), tous produits confondus. Chiffre indépendant de nos commandes ERP ci-dessus — voir la note plus bas.",
            },
          ].map(k => (
            <div key={k.label} title={(k as any).title} className="bg-slate-50 rounded-xl p-4 border border-slate-100 flex items-center gap-4">
              <div className="size-10 rounded-lg bg-slate-200/50 flex items-center justify-center shrink-0"
                style={(k as any).accent ? { backgroundColor: (k as any).accent + '15' } : undefined}>
                <k.Icon className="size-5 text-slate-600" style={(k as any).accent ? { color: (k as any).accent } : undefined} />
              </div>
              <div>
                 <p className="text-lg font-bold text-slate-900 leading-none">{k.value}</p>
                 <p className="text-xs font-medium text-slate-500 mt-1">{k.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Note simplifiée — l'utilisateur de ce module n'est pas technique :
            une explication courte en langage clair, pas un mode d'emploi. */}
        <div className="mt-4 flex items-start gap-2.5 p-3.5 bg-[#1877F2]/5 border border-[#1877F2]/15 rounded-xl">
          <HelpCircle className="size-4 text-[#1877F2] shrink-0 mt-0.5" />
          <div className="text-[11px] text-slate-600 leading-relaxed">
            <p>
              <strong>Commandes générées</strong> = vos vraies commandes. <strong>Détectées Meta</strong> = ce que Facebook compte de son côté. Un petit écart entre les deux est normal.
            </p>
            <p className="mt-1 text-slate-400">
              Chiffres Meta mis à jour automatiquement {oldestMetaSync && <>· dernière fois <strong>{formatDistanceToNow(new Date(oldestMetaSync), { addSuffix: true, locale: fr })}</strong></>}.
            </p>
          </div>
        </div>
      </div>

      {/* ── Grid ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1,2,3].map(i => <div key={i} className="h-64 rounded-[28px] bg-slate-100 animate-pulse" />)}
        </div>
      ) : pages.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-300">
          <LayoutTemplate className="size-10 mx-auto text-slate-300 mb-4" />
          <p className="text-base font-bold text-slate-700 mb-1">Aucune landing page</p>
          <p className="text-sm text-slate-500 mb-6">Créez votre première page de vente pour commencer à vendre.</p>
          <Button onClick={() => setShowCreate(true)} className="h-10 px-5 rounded-lg bg-slate-900 text-white font-bold">
            <Plus className="size-4 mr-2" /> Créer une page
          </Button>
        </div>
      ) : filteredPages.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-300">
          <LayoutTemplate className="size-10 mx-auto text-slate-300 mb-4" />
          <p className="text-base font-bold text-slate-700 mb-1">Aucun résultat</p>
          <p className="text-sm text-slate-500">Aucune page ne correspond à ce filtre ou à cette recherche.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredPages.map(lp => (
            <LandingPageCard
              key={lp.id}
              lp={lp}
              storeSlug={storeSlug}
              allStores={allStores}
              onEdit={() => setEditingLP(lp)}
              onToggle={() => toggleMutation.mutate(lp.id)}
              onDelete={() => setDeletingLP(lp)}
              onCopy={() => handleCopy(lp.slug)}
              onShowAnalytics={() => setAnalyticsLP(lp)}
            />
          ))}

          {/* Add card */}
          <button onClick={() => setShowCreate(true)}
            className="border-2 border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center gap-3 hover:border-slate-300 hover:bg-slate-50 transition-all group min-h-[250px]">
            <div className="size-12 rounded-xl bg-slate-100 flex items-center justify-center">
              <Plus className="size-6 text-slate-400" />
            </div>
            <p className="text-sm font-bold text-slate-600">Nouvelle page</p>
          </button>
        </div>
      )}

      {/* Modals */}
      <LandingPageModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        storeId={storeId}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['landing-pages'] })}
      />
      {editingLP && (
        <LandingPageModal
          open={!!editingLP}
          onClose={() => setEditingLP(null)}
          storeId={storeId}
          existing={editingLP}
          onSaved={() => { queryClient.invalidateQueries({ queryKey: ['landing-pages'] }); setEditingLP(null); }}
        />
      )}
      
      {analyticsLP && (
        <LandingPageAnalyticsDialog lp={analyticsLP} onClose={() => setAnalyticsLP(null)} />
      )}

      <AlertDialog open={!!deletingLP} onOpenChange={(open) => !open && setDeletingLP(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la page ?</AlertDialogTitle>
            <AlertDialogDescription>Cette action est irréversible.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => deletingLP && deleteMutation.mutate(deletingLP.id)} className="bg-rose-500">Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
