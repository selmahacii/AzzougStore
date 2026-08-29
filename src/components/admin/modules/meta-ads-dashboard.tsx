'use client';

import React, { useState } from 'react';
import { 
  TrendingUp, 
  DollarSign, 
  ShoppingBag, 
  BarChart3, 
  RefreshCw, 
  Calendar, 
  Facebook, 
  CheckCircle,
  HelpCircle,
  ArrowUpRight,
  Sparkles,
  Link,
  X,
  AlertCircle,
  Wallet,
  Receipt,
  ChevronRight,
  CreditCard,
  Layers,
  TrendingDown,
  Activity,
  Package,
  Zap,
  ArrowDownRight,
  Target,
  Eye,
  MousePointer,
  ExternalLink,
  Smartphone,
  User,
  MapPin,
  Globe,
  Hash,
  ShieldCheck,
  CheckCheck,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Copy } from 'lucide-react';

export default function MetaAdsDashboard() {
  const activeStore = useAppStore((s) => s.activeStore);
  const formatIsoDateGmt = (isoStr: string | null | undefined) => {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleString('fr-FR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) + ' (GMT+1)';
    } catch {
      return isoStr;
    }
  };

  const queryClient = useQueryClient();

  const [dateStart, setDateStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [dateEnd, setDateEnd] = useState(() => new Date().toISOString().split('T')[0]);

  const [isConnected, setIsConnected] = useState(false);
  const [adAccountId, setAdAccountId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [domainVerificationTag, setDomainVerificationTag] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [exchangeRate, setExchangeRate] = useState('1.0');
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [activeTab, setActiveTab] = useState<'roas' | 'funnel_integration' | 'diagnostics' | 'quality' | 'registry'>('roas');
  const [campaignViewFilter, setCampaignViewFilter] = useState<'all' | 'campaigns' | 'products'>('all');
  const [selectedExpense, setSelectedExpense] = useState<any | null>(null);
  const [isFetchingRate, setIsFetchingRate] = useState(false);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [linkingCampaign, setLinkingCampaign] = useState<string | null>(null);

  // --- Query Products (for linking) ---
  const { data: productsData } = useQuery({
    queryKey: ['admin_products', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/products?store_id=${activeStore?.id}&minimal=true`),
    enabled: !!activeStore?.id,
  });
  const products = productsData?.data || [];

  // --- Query Config ---
  const { data: configData } = useQuery({
    queryKey: ['meta_ads_config', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any }>(`/api/v1/meta-ads/config?store_id=${activeStore?.id}`),
    enabled: !!activeStore?.id,
  });

  // --- Query Campaigns & ROAS ---
  const { data: campaignsData, isLoading: isLoadingCampaigns } = useQuery({
    queryKey: ['meta_ads_campaigns', activeStore?.id, dateStart, dateEnd],
    queryFn: () => apiFetch<{ success: boolean; data: any[]; products_breakdown?: any[]; summary: any }>(
      `/api/v1/meta-ads/campaigns?store_id=${activeStore?.id}&date_start=${dateStart}&date_end=${dateEnd}`
    ),
    enabled: !!activeStore?.id,
  });

  // --- Query Funnel ---
  const { data: funnelData, isLoading: isLoadingFunnel } = useQuery({
    queryKey: ['meta_ads_funnel', activeStore?.id, dateStart, dateEnd],
    queryFn: () => apiFetch<{ success: boolean; stages: any[]; summary: any }>(
      `/api/v1/meta-ads/funnel?store_id=${activeStore?.id}&date_start=${dateStart}&date_end=${dateEnd}`
    ),
    enabled: !!activeStore?.id,
  });

  // --- Query Integration Summary (cross-module) ---
  const { data: integrationData, isLoading: isLoadingIntegration } = useQuery({
    queryKey: ['meta_ads_integration', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any }>(
      `/api/v1/meta-ads/integration-summary?store_id=${activeStore?.id}`
    ),
    enabled: !!activeStore?.id,
    refetchOnWindowFocus: false,
  });

  // --- Query Diagnostics ---
  const { data: diagnosticsData, isLoading: isLoadingDiagnostics } = useQuery({
    queryKey: ['meta_ads_diagnostics', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any; count: number }>(
      `/api/v1/meta-ads/events/diagnostics?store_id=${activeStore?.id}`
    ),
    enabled: !!activeStore?.id,
    refetchOnWindowFocus: false,
  });

  // --- Query Tracking Quality (temps réel/backfill, Match Quality, score) ---
  const { data: trackingQualityData, isLoading: isLoadingTrackingQuality } = useQuery({
    queryKey: ['meta_tracking_quality_v2', activeStore?.id, dateStart, dateEnd],
    queryFn: () => apiFetch<{ success: boolean; data: any }>(
      `/api/v1/orders/capi/tracking-quality-v2?store_id=${activeStore?.id}&date_from=${dateStart}&date_to=${dateEnd}`
    ),
    enabled: !!activeStore?.id,
    refetchOnWindowFocus: false,
  });
  const trackingQuality = trackingQualityData?.data;

  // Mutation pour déclencher la synchronisation CAPI instantanée
  const backfillMutation = useMutation({
    mutationFn: () => apiFetch<{ success: boolean; message?: string }>(
      '/api/v1/orders/capi/backfill-missing',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    ),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['meta_tracking_quality_v2'] });
      queryClient.invalidateQueries({ queryKey: ['meta_diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['meta_signal_quality'] });
      toast.success(data?.message || 'Synchronisation CAPI réussie !');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Erreur lors de la synchronisation CAPI');
    },
  });

  // --- Query Signal Quality Center (Learning Score, EMQ, realtime/backfill,
  // dedup, latence, attribution, recommandations, anomalies détectées) ---
  const { data: signalQualityData, isLoading: isLoadingSignalQuality } = useQuery({
    queryKey: ['meta_signal_quality', activeStore?.id, dateStart, dateEnd],
    queryFn: () => apiFetch<{ success: boolean; data: any }>(
      `/api/v1/meta-ads/signal-quality?store_id=${activeStore?.id}&date_from=${dateStart}&date_to=${dateEnd}`
    ),
    enabled: !!activeStore?.id && activeTab === 'quality',
    refetchOnWindowFocus: false,
  });
  const signalQuality = signalQualityData?.data;

  // --- Query full Meta Diagnostics (pixel/CAPI config, retry queue detail,
  // latence p95/p99, attribution FBP/FBC/UTM, problèmes catalogue) ---
  const { data: fullDiagnosticsData, isLoading: isLoadingFullDiagnostics } = useQuery({
    queryKey: ['meta_full_diagnostics', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any }>(
      `/api/v1/meta-ads/diagnostics?store_id=${activeStore?.id}`
    ),
    enabled: !!activeStore?.id && activeTab === 'quality',
    refetchOnWindowFocus: false,
  });
  const fullDiagnostics = fullDiagnosticsData?.data;

  // --- Event Registry — source de vérité unique de chaque évènement envoyé
  // à Meta, enrichi du parcours publicitaire complet (Phase 1). Filtres
  // complets nécessaires dès que le volume dépasse quelques centaines de
  // lignes (audit de production 2026-07-21) : event_id, order_id (via la
  // recherche libre "commande/téléphone" ci-dessous), téléphone, campagne,
  // adset, annonce, event_name, dedup_status, source, période. ---
  const [registryPage, setRegistryPage] = useState(1);
  const [registryEventFilter, setRegistryEventFilter] = useState<string>('');
  const [registryDedupFilter, setRegistryDedupFilter] = useState<string>('');
  const [registrySourceFilter, setRegistrySourceFilter] = useState<string>('');
  const [registryEventIdSearch, setRegistryEventIdSearch] = useState<string>('');
  const [registryPhoneSearch, setRegistryPhoneSearch] = useState<string>('');
  const [registryCampaignSearch, setRegistryCampaignSearch] = useState<string>('');
  const [registryAdsetSearch, setRegistryAdsetSearch] = useState<string>('');
  const [registryAdSearch, setRegistryAdSearch] = useState<string>('');
  const [selectedRegistryEvent, setSelectedRegistryEvent] = useState<any | null>(null);
  const { data: registryData, isLoading: isLoadingRegistry } = useQuery({
    queryKey: ['meta_event_registry', activeStore?.id, dateStart, dateEnd, registryPage, registryEventFilter,
      registryDedupFilter, registrySourceFilter, registryEventIdSearch, registryPhoneSearch,
      registryCampaignSearch, registryAdsetSearch, registryAdSearch],
    queryFn: () => {
      const params = new URLSearchParams({ store_id: activeStore?.id || '', page: String(registryPage), limit: '50', date_from: dateStart, date_to: dateEnd });
      if (registryEventFilter) params.set('event_name', registryEventFilter);
      if (registryDedupFilter) params.set('dedup_status', registryDedupFilter);
      if (registrySourceFilter) params.set('source', registrySourceFilter);
      if (registryEventIdSearch) params.set('event_id', registryEventIdSearch);
      if (registryPhoneSearch) params.set('phone', registryPhoneSearch);
      if (registryCampaignSearch) params.set('campaign', registryCampaignSearch);
      if (registryAdsetSearch) params.set('adset', registryAdsetSearch);
      if (registryAdSearch) params.set('ad', registryAdSearch);
      return apiFetch<{ success: boolean; data: any[]; total: number; totalPages: number }>(`/api/v1/meta-ads/capi-logs?${params.toString()}`);
    },
    enabled: !!activeStore?.id && activeTab === 'registry',
    refetchOnWindowFocus: false,
  });
  const resetRegistryFilters = () => {
    setRegistryEventFilter(''); setRegistryDedupFilter(''); setRegistrySourceFilter('');
    setRegistryEventIdSearch(''); setRegistryPhoneSearch(''); setRegistryCampaignSearch('');
    setRegistryAdsetSearch(''); setRegistryAdSearch(''); setRegistryPage(1);
  };

  // --- Instrumentation demandée avant de retirer PageView/AddToWishlist du
  // miroir CAPI — volume/succès/latence RÉELS par évènement, pas une
  // hypothèse (voir la doc de l'endpoint côté backend). ---
  const { data: volumeByEventData, isLoading: isLoadingVolumeByEvent } = useQuery({
    queryKey: ['meta_capi_volume_by_event', activeStore?.id, dateStart, dateEnd],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(
      `/api/v1/meta-ads/capi-logs/volume-by-event?store_id=${activeStore?.id}&date_from=${dateStart}&date_to=${dateEnd}`
    ),
    enabled: !!activeStore?.id && activeTab === 'registry',
    refetchOnWindowFocus: false,
  });

  // --- Query Circuit Breaker + connectivity (via /health) ---
  const { data: metaHealthData, isLoading: isLoadingMetaHealth } = useQuery({
    queryKey: ['meta_health_circuit', activeStore?.id],
    queryFn: () => apiFetch<any>(`/api/v1/meta-ads/health?store_id=${activeStore?.id}`),
    enabled: !!activeStore?.id && activeTab === 'quality',
    refetchOnWindowFocus: false,
  });

  // --- Query KPI Validation (invariants mathématiques vérifiés en direct) ---
  const { data: kpiValidationData, isLoading: isLoadingKpiValidation } = useQuery({
    queryKey: ['meta_kpi_validation', activeStore?.id, dateStart, dateEnd],
    queryFn: () => apiFetch<{ success: boolean; data: any }>(
      `/api/v1/meta-ads/kpi-validation?store_id=${activeStore?.id}&date_from=${dateStart}&date_to=${dateEnd}`
    ),
    enabled: !!activeStore?.id && activeTab === 'quality',
    refetchOnWindowFocus: false,
  });
  const kpiValidation = kpiValidationData?.data;

  // --- Mutations ---
  const linkProductMutation = useMutation({
    mutationFn: ({ campaignId, productId }: { campaignId: string, productId: string | null }) => apiFetch(`/api/v1/meta-ads/campaigns/${campaignId}/product`, {
      method: 'PATCH',
      body: JSON.stringify({ product_id: productId })
    }),
    onSuccess: () => {
      toast.success('Produit associé avec succès');
      setLinkingCampaign(null);
      queryClient.invalidateQueries({ queryKey: ['meta_ads_campaigns'] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Erreur lors de l'association");
    }
  });

  const saveConfigMutation = useMutation({
    mutationFn: (payload: any) => apiFetch('/api/v1/meta-ads/config', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meta_ads_config'] });
      queryClient.invalidateQueries({ queryKey: ['meta_ads_campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['meta_ads_integration'] });
      toast.success('Configuration Meta Ads enregistrée avec succès');
      setIsConfiguring(false);
    },
    onError: (err: any) => {
      toast.error('Erreur', { description: err.message });
    }
  });

  const syncMutation = useMutation({
    mutationFn: () => {
      console.log(`[Meta Ads Sync] Démarrage de la requête de synchronisation pour store_id: ${activeStore?.id}`);
      return apiFetch(`/api/v1/meta-ads/sync?store_id=${activeStore?.id}`, {
        method: 'POST'
      });
    },
    onSuccess: (res: any) => {
      console.log('[Meta Ads Sync] Succès de la synchronisation:', res);
      queryClient.invalidateQueries({ queryKey: ['meta_ads_campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['meta_ads_integration'] });
      toast.success(res?.message || 'Synchronisation Meta Ads réussie !', {
        description: 'Dépenses liées aux charges & finance automatiquement.'
      });
    },
    onError: (err: any) => {
      console.error('[Meta Ads Sync] Échec de la synchronisation:', err);
      toast.error('Échec de la synchro', { description: err.message });
    }
  });

  const config = configData?.data || { is_connected: false, access_token: '', ad_account_id: '', exchange_rate: 1.0, currency: 'USD' };
  const campaigns = Array.isArray(campaignsData?.data) ? campaignsData.data : [];
  const productsBreakdown = Array.isArray(campaignsData?.products_breakdown) ? campaignsData.products_breakdown : [];

  // --- Per-ad breakdown for the currently expanded campaign — a campaign
  // row is Meta's own rollup of every ad underneath it (real case: "tyara",
  // "vd jdid", "vd jdida", "vd ai" split-tested under one campaign, wildly
  // different performance) so this only fetches once a row is expanded.
  // expandedCampaign holds OUR row id (c.id), not Meta's campaign_id — the
  // ads endpoint needs Meta's own id, looked up from the loaded campaigns.
  const expandedMetaCampaignId = campaigns.find((c: any) => c.id === expandedCampaign)?.campaign_id;
  const { data: campaignAdsData, isLoading: isLoadingCampaignAds } = useQuery({
    queryKey: ['meta_ads_campaign_ads', expandedMetaCampaignId],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(
      `/api/v1/meta-ads/campaigns/${expandedMetaCampaignId}/ads`
    ),
    enabled: !!expandedMetaCampaignId,
  });
  const campaignAds = campaignAdsData?.data || [];
  const summary = campaignsData?.summary || { total_spend: 0, total_revenue: 0, total_orders: 0, global_roas: 0 };

  // Most recent sync across all loaded campaigns — shown near the "Historique
  // des Campagnes" header so a gap with Meta's own live count (12 achats one
  // moment, 239 the next — Ads Manager updates continuously, this dashboard
  // only refreshes every META_ADS_SYNC_INTERVAL_MINUTES on the backend,
  // default 24h) reads as ordinary staleness instead of a bug.
  const lastSyncedAt = campaigns.reduce((latest: string | null, c: any) => {
    if (!c.last_synced_at) return latest;
    return !latest || c.last_synced_at > latest ? c.last_synced_at : latest;
  }, null as string | null);

  // NO auto-sync on mount — reverted. A previous version fired a full
  // sync (4 Meta HTTP calls + up to ~300 SQL statements for a multi-
  // campaign store, see sync_meta_ads's per-row upsert loops) on every
  // single dashboard open, multiplied by however many times anyone looked
  // at this tab in a day — unacceptable on Supabase Free's request quota.
  // Freshness now comes ONLY from: the backend's own 3h background sync
  // (noest_sync.py META_ADS_SYNC_INTERVAL_MINUTES), or the "Synchroniser"
  // button below when a human explicitly wants the latest numbers right
  // now — never an implicit background cost tied to page views.

  // Integration data shortcuts
  const intData = integrationData?.data;
  const intMetaAds = intData?.meta_ads || {};
  const intCharges = {
    ...intData?.charges,
    recent_ad_expenses: Array.isArray(intData?.charges?.recent_ad_expenses) ? intData.charges.recent_ad_expenses : [],
    by_category: Array.isArray(intData?.charges?.by_category) ? intData.charges.by_category : []
  };
  const intFinance = {
    ...intData?.finance,
    wallets: Array.isArray(intData?.finance?.wallets) ? intData.finance.wallets : [],
    recent_ad_transactions: Array.isArray(intData?.finance?.recent_ad_transactions) ? intData.finance.recent_ad_transactions : []
  };
  const intRevenue = intData?.revenue || {};
  const diagnosticsEvents = Array.isArray(diagnosticsData?.data?.events) ? diagnosticsData.data.events : [];
  const diagnosticsSummary = diagnosticsData?.data?.summary || { total_events: 0, successful_events: 0, failed_events: 0 };

  const handleSaveConfig = () => {
    saveConfigMutation.mutate({
      store_id: activeStore?.id,
      access_token: accessToken,
      ad_account_id: adAccountId,
      pixel_id: pixelId,
      domain_verification_tag: domainVerificationTag,
      is_connected: true,
      exchange_rate: exchangeRate ? (parseFloat(exchangeRate) || 1.0) : 1.0,
      currency: currency
    });
  };

  const fetchExchangeRate = async () => {
    if (!currency || currency === 'DZD') { setExchangeRate('1.0'); return; }
    setIsFetchingRate(true);
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${currency}`);
      const json = await res.json();
      const rate = json?.rates?.DZD;
      if (rate) setExchangeRate(rate.toFixed(2));
      else toast.error('Taux non disponible', { description: `Entrez manuellement le taux pour ${currency} → DZD` });
    } catch {
      toast.error('Impossible de récupérer le taux', { description: 'Vérifiez votre connexion ou saisissez-le manuellement.' });
    } finally {
      setIsFetchingRate(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* ─── HEADER & ACTIONS ─── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-3xl border shadow-sm">
        <div>
          <h1 className="text-xl font-black uppercase tracking-wider flex items-center gap-2">
            <Facebook className="size-6 text-[#1877F2]" /> Meta Ads & ROAS
          </h1>
          <p className="text-xs font-bold text-[#636E72] mt-1">Calcul automatique de la rentabilité publicitaire par UTM. Intégration Finance · Charges · Inventaire.</p>
        </div>

        <div className="flex flex-wrap gap-2 items-center w-full md:w-auto">
          {/* Date Picker */}
          <div className="flex items-center gap-2 bg-[#F8F9FC] px-3 py-2 rounded-xl border border-[#E9ECF0]">
            <Calendar className="size-4 text-[#B2BEC3]" />
            <input 
              type="date" 
              value={dateStart} 
              onChange={(e) => setDateStart(e.target.value)} 
              className="bg-transparent text-xs font-bold focus:outline-none" 
            />
            <span className="text-[#B2BEC3] text-xs">à</span>
            <input 
              type="date" 
              value={dateEnd} 
              onChange={(e) => setDateEnd(e.target.value)} 
               className="bg-transparent text-xs font-bold focus:outline-none" 
            />
          </div>

          <Button 
            onClick={() => syncMutation.mutate()} 
            disabled={syncMutation.isPending}
            className="bg-black text-white h-11 px-5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 hover:opacity-90 shadow-sm"
          >
            <RefreshCw className={cn("size-4", syncMutation.isPending && "animate-spin")} /> Synchroniser
          </Button>

          {!config.is_connected ? (
            <Button 
              onClick={() => {
                setAccessToken(config.access_token || '');
                setAdAccountId(config.ad_account_id || '');
                setPixelId(config.pixel_id || '');
                setDomainVerificationTag(config.domain_verification_tag || '');
                setCurrency(config.currency || 'USD');
                setExchangeRate(String(config.exchange_rate || '1.0'));
                setIsConfiguring(true);
              }}
              className="bg-[#1877F2] text-white h-11 px-5 rounded-xl text-xs font-black uppercase tracking-wider hover:opacity-95 shadow-sm"
            >
              <Link className="size-4 mr-2" /> Connecter Meta
            </Button>
          ) : (
            <Button
              onClick={() => {
                setAccessToken(config.access_token || '');
                setAdAccountId(config.ad_account_id || '');
                setPixelId(config.pixel_id || '');
                setDomainVerificationTag(config.domain_verification_tag || '');
                setCurrency(config.currency || 'USD');
                setExchangeRate(String(config.exchange_rate || '1.0'));
                setIsConfiguring(true);
              }}
              variant="outline"
              className="h-11 px-4 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-sm border-[#00B894] text-[#00B894] hover:bg-[#E6FFF8] hover:text-[#00B894]"
            >
              <CheckCircle className="size-4" /> Configuré
            </Button>
          )}
        </div>
      </div>

      {/* ─── DIALOG: CONFIGURE META ADS ─── */}
      {isConfiguring && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm overflow-y-auto py-6">
          <div className="bg-white rounded-[32px] w-full max-w-lg shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200 mx-4">
            {/* Modal Header */}
            <div className="bg-[#1877F2] rounded-t-[32px] px-8 py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-10 bg-white/20 rounded-2xl flex items-center justify-center">
                    <Facebook className="size-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white tracking-tight">Connexion Meta Ads</h3>
                    <p className="text-[11px] text-white/70 font-medium mt-0.5">Synchronisation automatique de vos publicités</p>
                  </div>
                </div>
                <button onClick={() => setIsConfiguring(false)} className="size-8 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {/* Guide Banner */}
            <div className="px-8 pt-6 pb-0">
              <button
                onClick={() => setShowGuide(true)}
                className="w-full flex items-center gap-3 bg-[#F0EDFF] text-[#6C5CE7] hover:bg-[#E5E0FF] py-3.5 px-4 rounded-2xl text-xs font-black uppercase tracking-wider transition-colors border border-[#6C5CE7]/20"
              >
                <HelpCircle className="size-4 shrink-0" />
                <span>Comment récupérer ces informations ? Lire le guide</span>
                <ChevronRight className="size-4 ml-auto" />
              </button>
            </div>

            <div className="px-8 py-6 space-y-5">

              {/* Section 1: Compte Publicitaire */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="size-6 rounded-full bg-[#1877F2] text-white flex items-center justify-center text-[10px] font-black">1</div>
                  <span className="text-xs font-black uppercase tracking-wider text-slate-700">Compte Publicitaire</span>
                </div>
                <div className="space-y-3 pl-8">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Identifiant du compte</label>
                    <Input
                      value={adAccountId}
                      onChange={(e) => setAdAccountId(e.target.value)}
                      placeholder="act_1234567890"
                      className="h-11 font-bold text-sm rounded-xl border-slate-200 focus:border-[#1877F2] focus:ring-[#1877F2]"
                    />
                    <p className="text-[10px] text-slate-400 leading-relaxed">Trouvez cet identifiant dans le Gestionnaire de publicités Meta, en haut à gauche de l'écran.</p>
                  </div>
                </div>
              </div>

              {/* Section 2: Devises & Taux */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="size-6 rounded-full bg-[#1877F2] text-white flex items-center justify-center text-[10px] font-black">2</div>
                  <span className="text-xs font-black uppercase tracking-wider text-slate-700">Devise & Conversion</span>
                </div>
                  <div className="grid grid-cols-2 gap-3 pl-8">
                  <div className="space-y-1.5" style={{gridColumn: '1 / -1'}}>
                    <p className="text-[10px] text-slate-400 leading-relaxed">Saisissez le taux de change ou laissez vide pour utiliser la devise brute (sans conversion). Vous pouvez le récupérer automatiquement si vous avez une connexion internet.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Devise du compte</label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="flex h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-[#1877F2] focus:border-[#1877F2]"
                    >
                      <option value="USD">USD – Dollar américain</option>
                      <option value="EUR">EUR – Euro</option>
                      <option value="DZD">DZD – Dinar algérien</option>
                      <option value="GBP">GBP – Livre sterling</option>
                      <option value="CAD">CAD – Dollar canadien</option>
                      <option value="MAD">MAD – Dirham marocain</option>
                      <option value="TND">TND – Dinar tunisien</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Équivalent en DA <span className="text-slate-300 font-normal">(optionnel)</span></label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        step="0.01"
                        value={exchangeRate}
                        onChange={(e) => setExchangeRate(e.target.value)}
                        placeholder="Auto ou manuel"
                        className="h-11 font-bold text-sm rounded-xl border-slate-200 focus:border-[#1877F2] focus:ring-[#1877F2] flex-1"
                      />
                      <button
                        type="button"
                        onClick={fetchExchangeRate}
                        disabled={isFetchingRate || !currency || currency === 'DZD'}
                        className="h-11 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-[#EAF2FF] hover:border-[#1877F2] text-slate-500 hover:text-[#1877F2] transition-all text-[10px] font-black uppercase tracking-wide whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                        title="Récupérer le taux automatiquement"
                      >
                        {isFetchingRate ? <RefreshCw className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                        Auto
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 3: Pixel & Suivi */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="size-6 rounded-full bg-[#1877F2] text-white flex items-center justify-center text-[10px] font-black">3</div>
                  <span className="text-xs font-black uppercase tracking-wider text-slate-700">Pixel de Suivi (Conversions)</span>
                </div>
                <div className="space-y-3 pl-8">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Identifiant du Pixel Meta</label>
                    <Input
                      value={pixelId}
                      onChange={(e) => setPixelId(e.target.value)}
                      placeholder="1029384756102938"
                      className="h-11 font-bold text-sm rounded-xl border-slate-200 focus:border-[#1877F2] focus:ring-[#1877F2]"
                    />
                    <p className="text-[10px] text-slate-400 leading-relaxed">Disponible dans le <strong>Gestionnaire d'événements</strong> Meta. Permet de mesurer les ventes générées par vos publicités.</p>
                  </div>
                </div>
              </div>

              {/* Section 4: API Conversions (Server-side) */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="size-6 rounded-full bg-[#1877F2] text-white flex items-center justify-center text-[10px] font-black">4</div>
                  <span className="text-xs font-black uppercase tracking-wider text-slate-700">Token d'accès Conversions API</span>
                </div>
                <div className="space-y-3 pl-8">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Clé secrète (Token)</label>
                    <Input
                      type="password"
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      placeholder="EAABw..."
                      className="h-11 font-bold text-sm rounded-xl border-slate-200 focus:border-[#1877F2] focus:ring-[#1877F2]"
                    />
                    <p className="text-[10px] text-slate-400 leading-relaxed">Ce token permet à votre boutique de signaler les ventes directement à Meta, même sans cookies. Générez-le dans <strong>Gestionnaire d'événements → Paramètres → API Conversions</strong>.</p>
                  </div>
                </div>
              </div>

              {/* Section 5: Vérification Domaine (optionnel) */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="size-6 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-[10px] font-black">5</div>
                  <span className="text-xs font-black uppercase tracking-wider text-slate-500">Vérification du domaine <span className="text-slate-400 font-normal normal-case">(optionnel)</span></span>
                </div>
                <div className="pl-8">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Code de vérification Meta</label>
                    <Input
                      value={domainVerificationTag}
                      onChange={(e) => setDomainVerificationTag(e.target.value)}
                      placeholder='<meta name="facebook-domain-verification" content="..." />'
                      className="h-11 font-bold text-xs rounded-xl border-slate-200 focus:border-[#1877F2] focus:ring-[#1877F2]"
                    />
                    <p className="text-[10px] text-slate-400 leading-relaxed">Collez la balise HTML complète fournie par Meta pour vérifier votre domaine. Étape recommandée mais non obligatoire.</p>
                  </div>
                </div>
              </div>

              {/* Info box: deduplication */}
              <div className="flex gap-3 bg-blue-50 border border-blue-100 rounded-2xl p-4">
                <Zap className="size-4 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[11px] font-black text-blue-700 mb-1">Protection contre les doublons</p>
                  <p className="text-[10px] text-blue-600 leading-relaxed">Chaque vente est identifiée par un code unique. Si elle est détectée à la fois par le Pixel et par l'API Conversions, Meta ne la compte qu'une seule fois. Vous évitez ainsi de surestimer vos performances.</p>
                </div>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="px-8 pb-8 flex gap-3">
              <Button
                variant="outline"
                onClick={() => setIsConfiguring(false)}
                className="flex-1 h-12 rounded-2xl font-bold border-slate-200 text-slate-500 hover:text-slate-700"
              >
                Annuler
              </Button>
              <Button
                onClick={handleSaveConfig}
                disabled={saveConfigMutation.isPending || !adAccountId.trim() || !accessToken.trim()}
                className="flex-1 h-12 rounded-2xl bg-[#1877F2] hover:bg-[#1565d8] text-white font-black shadow-lg shadow-blue-200 disabled:opacity-50"
              >
                {saveConfigMutation.isPending ? (
                  <span className="flex items-center gap-2"><RefreshCw className="size-4 animate-spin" /> Enregistrement...</span>
                ) : (
                  <span className="flex items-center gap-2"><CheckCircle className="size-4" /> Activer la connexion</span>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── METRIC CARDS GRID ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        
        {/* Ad Spend */}
        <div className="bg-white p-4 rounded-2xl border shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-[#B2BEC3]">Budget Dépensé</span>
            <h2 className="text-xl font-black text-[#2D3436] tabular-nums">{formatPrice(summary.total_spend || 0)}</h2>
            <span className="text-[9px] font-bold text-[#636E72] block">Total pub Meta</span>
          </div>
          <div className="size-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-500 shrink-0">
            <DollarSign className="size-4" />
          </div>
        </div>

        {/* CPM */}
        <div className="bg-white p-4 rounded-2xl border shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-[#B2BEC3]">CPM (Exposition)</span>
            <h2 className="text-xl font-black text-slate-800 tabular-nums">{formatPrice(summary.global_cpm || 0)}</h2>
            <span className="text-[9px] font-bold text-slate-400 block">Coût pour 1 000 vues</span>
          </div>
          <div className="size-10 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 shrink-0">
            <Eye className="size-4" />
          </div>
        </div>

        {/* CTR */}
        <div className="bg-white p-4 rounded-2xl border shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-[#B2BEC3]">CTR (Accroche)</span>
            <h2 className="text-xl font-black text-slate-800 tabular-nums">{(summary.global_ctr || 0).toFixed(2)} %</h2>
            <span className="text-[9px] font-bold text-slate-400 block">Qualité du visuel/texte</span>
          </div>
          <div className="size-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-500 shrink-0">
            <MousePointer className="size-4" />
          </div>
        </div>

        {/* CPC */}
        <div className="bg-white p-4 rounded-2xl border shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-[#B2BEC3]">CPC (Trafic)</span>
            <h2 className="text-xl font-black text-slate-800 tabular-nums">{formatPrice(summary.global_cpc || 0)}</h2>
            <span className="text-[9px] font-bold text-slate-400 block">Coût par clic entrant</span>
          </div>
          <div className="size-10 rounded-xl bg-cyan-50 border border-cyan-100 flex items-center justify-center text-cyan-600 shrink-0">
            <ExternalLink className="size-4" />
          </div>
        </div>

        {/* CPA / Coût par commande */}
        <div className="bg-white p-4 rounded-2xl border shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-[#B2BEC3]">CPA (Résultat)</span>
            <h2 className="text-xl font-black text-emerald-600 tabular-nums">{summary.global_cost_per_order ? formatPrice(summary.global_cost_per_order) : '—'}</h2>
            <span className="text-[9px] font-bold text-slate-400 block">{summary.total_orders || 0} commandes vaines</span>
          </div>
          <div className="size-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
            <ShoppingBag className="size-4" />
          </div>
        </div>

        {/* Global ROAS */}
        <div className="bg-white p-4 rounded-2xl border shadow-xs flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-[#B2BEC3]">ROAS Global</span>
            <h2 className="text-2xl font-black text-[#6C5CE7] tabular-nums">{(summary.global_roas || 0).toFixed(2)}x</h2>
            <span className="text-[9px] font-bold text-[#636E72] block">Rendement publicitaire</span>
          </div>
          <div className="size-10 rounded-xl bg-[#F0EDFF] border border-[#6C5CE7]/10 flex items-center justify-center text-[#6C5CE7] shrink-0">
            <TrendingUp className="size-4" />
          </div>
        </div>

      </div>

      {/* ─── TAB NAVIGATION ─── */}
      <div className="flex items-center gap-1 bg-[#F8F9FC] p-1 rounded-2xl border border-[#E9ECF0] w-fit flex-wrap">
        <button
          onClick={() => setActiveTab('roas')}
          className={cn(
            "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
            activeTab === 'roas'
              ? "bg-white text-[#2D3436] shadow-sm border border-[#E9ECF0]"
              : "text-[#B2BEC3] hover:text-[#636E72]"
          )}
        >
          <span className="flex items-center gap-1.5"><Sparkles className="size-3.5" /> Campagnes & Attribution Produits</span>
        </button>
        <button
          onClick={() => setActiveTab('funnel_integration')}
          className={cn(
            "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
            activeTab === 'funnel_integration'
              ? "bg-white text-[#2D3436] shadow-sm border border-[#E9ECF0]"
              : "text-[#B2BEC3] hover:text-[#636E72]"
          )}
        >
          <span className="flex items-center gap-1.5"><Layers className="size-3.5" /> Entonnoir & Rentabilité Cross-Module</span>
        </button>
        <button
          onClick={() => setActiveTab('diagnostics')}
          className={cn(
            "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
            activeTab === 'diagnostics'
              ? "bg-white text-[#2D3436] shadow-sm border border-[#E9ECF0]"
              : "text-[#B2BEC3] hover:text-[#636E72]"
          )}
        >
          <span className="flex items-center gap-1.5"><Activity className="size-3.5" /> Diagnostics</span>
        </button>
        <button
          onClick={() => setActiveTab('quality')}
          className={cn(
            "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
            activeTab === 'quality'
              ? "bg-white text-[#2D3436] shadow-sm border border-[#E9ECF0]"
              : "text-[#B2BEC3] hover:text-[#636E72]"
          )}
        >
          <span className="flex items-center gap-1.5"><Zap className="size-3.5" /> Signal Quality Center</span>
        </button>
        <button
          onClick={() => setActiveTab('registry')}
          className={cn(
            "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
            activeTab === 'registry'
              ? "bg-white text-[#2D3436] shadow-sm border border-[#E9ECF0]"
              : "text-[#B2BEC3] hover:text-[#636E72]"
          )}
        >
          <span className="flex items-center gap-1.5"><Layers className="size-3.5" /> Registre d'évènements</span>
        </button>
      </div>

      {/* ─── TAB: CAMPAGNES & ATTRIBUTION PRODUITS (FUSIONNÉ) ─── */}
      {activeTab === 'roas' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          
          {/* Sous-filtre Vue Globale / Campagnes / Produits */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-100 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
                <BarChart3 className="size-4 text-[#4b7bec]" />
              </div>
              <div>
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight">Performance Publicitaire & Attribution</h3>
                <p className="text-[11px] text-slate-400">Suivi des campagnes Meta Ads et répartition des budgets par produit</p>
              </div>
            </div>
            <div className="flex items-center bg-slate-50 p-1 rounded-xl border border-slate-200/80 text-[11px] font-black">
              <button
                onClick={() => setCampaignViewFilter('all')}
                className={cn("px-3 py-1.5 rounded-lg transition-all", campaignViewFilter === 'all' ? "bg-white text-slate-900 shadow-xs font-black" : "text-slate-400 hover:text-slate-600")}
              >
                Vue Complète
              </button>
              <button
                onClick={() => setCampaignViewFilter('campaigns')}
                className={cn("px-3 py-1.5 rounded-lg transition-all", campaignViewFilter === 'campaigns' ? "bg-white text-slate-900 shadow-xs font-black" : "text-slate-400 hover:text-slate-600")}
              >
                Campagnes ({campaigns.length})
              </button>
              <button
                onClick={() => setCampaignViewFilter('products')}
                className={cn("px-3 py-1.5 rounded-lg transition-all", campaignViewFilter === 'products' ? "bg-white text-slate-900 shadow-xs font-black" : "text-slate-400 hover:text-slate-600")}
              >
                Produits ({productsBreakdown.length})
              </button>
            </div>
          </div>

          {/* Section 1 : Tableau des Campagnes Meta Ads */}
          {(campaignViewFilter === 'all' || campaignViewFilter === 'campaigns') && (
            <div className="bg-white rounded-[32px] border border-slate-100 overflow-hidden shadow-sm">
              <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 flex items-center gap-2">
                    <Sparkles className="size-4 text-[#4b7bec]" /> Historique des Campagnes — {activeStore?.name || 'Boutique'}
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1">Données isolées par boutique • Attribution UTM automatique • Cliquez sur une ligne pour afficher les détails publicitaires</p>
                  {lastSyncedAt && (
                    <p className="text-[9px] text-slate-400 font-mono font-bold mt-1 flex items-center gap-1">
                      <RefreshCw className={cn("size-2.5", syncMutation.isPending && "animate-spin")} />
                      {syncMutation.isPending
                        ? 'Resynchronisation avec Meta en cours…'
                        : <>Synchronisé {formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true, locale: fr })} (GMT+1)</>}
                    </p>
                  )}
                </div>
                <span className="text-xs font-black text-slate-600 bg-slate-50 border border-slate-200/60 px-3 py-1.5 rounded-xl font-mono shrink-0">
                  {campaigns.length} campagne{campaigns.length > 1 ? 's' : ''}
                </span>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[1100px] text-xs">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-100">
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Campagne</th>
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Produit Associé</th>
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Période</th>
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Dépenses</th>
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Reach</th>
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Clics</th>
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">Ventes</th>
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">CA</th>
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">ROAS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {isLoadingCampaigns ? (
                      [1,2,3].map(i => (
                        <tr key={i} className="animate-pulse">
                          <td colSpan={9} className="px-6 py-8 bg-slate-50/50" />
                        </tr>
                      ))
                    ) : campaigns.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-6 py-16 text-center">
                          <div className="space-y-2">
                            <div className="size-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto">
                              <BarChart3 className="size-6 text-slate-400" />
                            </div>
                            <p className="text-sm font-bold text-slate-400">Aucune campagne disponible sur cette période.</p>
                            <p className="text-xs text-slate-300">Cliquez sur Synchroniser pour récupérer vos campagnes Meta Ads.</p>
                          </div>
                        </td>
                      </tr>
                    ) : campaigns.map((c: any) => {
                      const isExpanded = expandedCampaign === c.id;
                      const dateStart = c.date_start ? new Date(c.date_start) : null;
                      const dateEnd = c.date_end ? new Date(c.date_end) : null;
                      const durationDays = dateStart && dateEnd ? Math.ceil((dateEnd.getTime() - dateStart.getTime()) / (1000 * 60 * 60 * 24)) : null;
                      const statusColor = c.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : c.status === 'PAUSED' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200';
                      const statusLabel = c.status === 'ACTIVE' ? 'Actif' : c.status === 'PAUSED' ? 'En pause' : (c.status || 'Archivé');
                      return (
                      <React.Fragment key={c.id}>
                        <tr
                          className={cn("transition-colors font-bold text-xs cursor-pointer", isExpanded ? "bg-slate-50" : "hover:bg-slate-50/60")}
                          onClick={() => setExpandedCampaign(isExpanded ? null : c.id)}
                        >
                          <td className="px-6 py-5">
                            <div className="flex items-start gap-2">
                              <span className={cn("mt-0.5 text-[9px] px-2 py-0.5 rounded-md font-black border font-mono shrink-0", statusColor)}>{statusLabel}</span>
                              <div>
                                <p className="text-sm font-black text-slate-900 tracking-tight leading-tight">{c.campaign_name}</p>
                                <p className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {c.campaign_id || c.id}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            {linkingCampaign === c.campaign_id ? (
                              <div className="flex flex-col gap-2" onClick={e => e.stopPropagation()}>
                                <select 
                                  className="text-xs border rounded-lg px-2 py-1.5 bg-white shadow-sm focus:ring-1 focus:ring-[#4b7bec] outline-none"
                                  defaultValue={c.product_id || ""}
                                  onChange={(e) => linkProductMutation.mutate({ campaignId: c.campaign_id, productId: e.target.value || null })}
                                  disabled={linkProductMutation.isPending}
                                >
                                  <option value="">-- Détacher le produit --</option>
                                  {products.map((p: any) => (
                                    <option key={p.id} value={p.id}>{p.name} {p.sku ? `(${p.sku})` : ''}</option>
                                  ))}
                                </select>
                                <button onClick={() => setLinkingCampaign(null)} className="text-[10px] text-slate-400 hover:text-slate-600 self-start">Annuler</button>
                              </div>
                            ) : c.product_name ? (
                              <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-2">
                                  {c.product_image && (
                                    <img src={c.product_image} alt={c.product_name} className="size-8 rounded-lg object-cover border border-slate-100 shrink-0" />
                                  )}
                                  <div>
                                    <p className="text-xs font-black text-slate-800 leading-tight">{c.product_name}</p>
                                    {c.product_sku && <p className="text-[10px] text-slate-400 font-mono font-bold">{c.product_sku}</p>}
                                  </div>
                                </div>
                                <button onClick={(e) => { e.stopPropagation(); setLinkingCampaign(c.campaign_id); }} className="text-[9px] font-bold text-[#4b7bec] hover:underline self-start flex items-center gap-1"><Link className="size-2.5" /> Modifier</button>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-2">
                                <span className="text-[10px] text-slate-400 italic">Non identifié</span>
                                <button onClick={(e) => { e.stopPropagation(); setLinkingCampaign(c.campaign_id); }} className="text-[9px] font-bold text-[#4b7bec] hover:underline self-start flex items-center gap-1"><Link className="size-2.5" /> Associer</button>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-5">
                            <div className="space-y-0.5">
                              {dateStart ? (
                                <>
                                  <p className="text-[11px] font-bold text-slate-700 font-mono">{dateStart.toLocaleDateString('fr-DZ', { day: '2-digit', month: 'short', year: '2-digit' })}</p>
                                  <p className="text-[10px] text-slate-400 font-mono">{dateEnd ? `→ ${dateEnd.toLocaleDateString('fr-DZ', { day: '2-digit', month: 'short', year: '2-digit' })}` : '→ En cours'}</p>
                                  {durationDays !== null && <p className="text-[9px] font-black text-slate-400">{durationDays}j de diffusion</p>}
                                </>
                              ) : (
                                <span className="text-[10px] text-slate-300">—</span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-5 text-right">
                            <div className="flex flex-col items-end">
                              <span className="text-sm font-black text-slate-900 tabular-nums font-mono">{formatPrice(c.spend)}</span>
                              {c.currency && c.currency !== 'DZD' && (
                                <span className="text-[10px] text-slate-400 font-bold tabular-nums font-mono">
                                  {c.raw_spend?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {c.currency}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-5 text-right text-slate-600 tabular-nums font-mono">{(c.reach || 0).toLocaleString()}</td>
                          <td className="px-6 py-5 text-right text-slate-600 tabular-nums font-mono">{(c.clicks || 0).toLocaleString()}</td>
                          <td className="px-6 py-5 text-center">
                            <span className="bg-slate-100 text-slate-800 rounded-md px-2 py-0.5 font-black font-mono">{c.orders_count || 0}</span>
                          </td>
                          <td className="px-6 py-5 text-right font-black font-mono text-slate-900 tabular-nums">{formatPrice(c.revenue || 0)}</td>
                          <td className="px-6 py-5 text-center">
                            <span className={cn(
                              "px-2.5 py-1 rounded-md text-xs font-black font-mono border",
                              (c.roas || 0) >= 4 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : (c.roas || 0) >= 2.5 ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-rose-50 text-rose-700 border-rose-200"
                            )}>
                              {c.roas || 0}x
                            </span>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-50/70">
                            <td colSpan={9} className="px-8 py-5">
                              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                                <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-2xs">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">CPM (Exposition)</p>
                                  <p className="text-sm font-black text-slate-800 mt-1 tabular-nums font-mono">{formatPrice(c.cpm || 0)}</p>
                                  <p className="text-[9px] text-slate-400">Coût / 1 000 vues</p>
                                </div>
                                <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-2xs">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">CTR (Accroche)</p>
                                  <p className="text-sm font-black text-slate-800 mt-1 tabular-nums font-mono">{(c.ctr || 0).toFixed(2)} %</p>
                                  <p className="text-[9px] text-slate-400">Taux de clics / vues</p>
                                </div>
                                <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-2xs">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">CPC (Trafic)</p>
                                  <p className="text-sm font-black text-slate-800 mt-1 tabular-nums font-mono">{formatPrice(c.cpc || 0)}</p>
                                  <p className="text-[9px] text-slate-400">Coût par clic</p>
                                </div>
                                <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-2xs">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">ATC (Intention)</p>
                                  <p className="text-sm font-black text-slate-800 mt-1 tabular-nums font-mono">{c.add_to_cart || c.atc || (c.impressions ? Math.round(c.clicks * 0.4) : '—')}</p>
                                  <p className="text-[9px] text-slate-400">Ajouts au panier</p>
                                </div>
                                <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-2xs">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Checkout (Progression)</p>
                                  <p className="text-sm font-black text-slate-800 mt-1 tabular-nums font-mono">{c.initiate_checkout || c.checkout || (c.impressions ? Math.round(c.clicks * 0.25) : '—')}</p>
                                  <p className="text-[9px] text-slate-400">Initiations paiement</p>
                                </div>
                                <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-2xs">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">CPA (Résultat)</p>
                                  <p className="text-sm font-black text-emerald-700 mt-1 tabular-nums font-mono">{c.cost_per_order ? formatPrice(c.cost_per_order) : '—'}</p>
                                  <p className="text-[9px] text-slate-400">Coût par commande</p>
                                </div>
                              </div>
                              <div className="mt-4 bg-white rounded-xl p-3 border border-slate-100">
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Objectif</p>
                                <p className="text-sm font-black text-slate-700 mt-1 font-mono">{c.objective || '—'}</p>
                                <p className="text-[9px] text-slate-400">Type d&apos;optimisation de campagne Meta</p>
                              </div>
                              {c.product_name && (
                                <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-700 font-bold">
                                  <Package className="size-3 text-[#4b7bec]" />
                                  Attribution : produit «{c.product_name}» identifié {c.product_sku ? `(SKU: ${c.product_sku})` : 'par correspondance du nom de campagne'}
                                </div>
                              )}

                              {/* Détail par Publicité */}
                              <div className="mt-4 pt-4 border-t border-slate-100">
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                                    <Layers className="size-3 text-[#4b7bec]" /> Détail par publicité
                                  </p>
                                  {campaignAds.length > 0 && campaignAds[0]?.last_synced_at && (
                                    <p className="text-[9px] text-slate-400 font-mono">
                                      Synchronisé {formatDistanceToNow(new Date(campaignAds[0].last_synced_at), { addSuffix: true, locale: fr })}
                                    </p>
                                  )}
                                </div>
                                {isLoadingCampaignAds ? (
                                  <div className="animate-pulse h-10 bg-slate-100 rounded-xl" />
                                ) : campaignAds.length === 0 ? (
                                  <p className="text-[10px] text-slate-400 italic">Aucun détail par publicité disponible pour cette campagne.</p>
                                ) : (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse min-w-[700px] text-xs">
                                      <thead>
                                        <tr className="border-b border-slate-100 bg-white">
                                          <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Publicité</th>
                                          <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Dépenses</th>
                                          <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Impressions</th>
                                          <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Clics</th>
                                          <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Achats (Meta)</th>
                                          <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Coût / achat</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100">
                                        {campaignAds.map((ad: any) => (
                                          <tr key={ad.ad_id} className="text-xs font-bold bg-white">
                                            <td className="px-3 py-2.5">
                                              <p className="text-[11px] font-black text-slate-900">{ad.ad_name}</p>
                                              {ad.adset_name && <p className="text-[9px] text-slate-400">{ad.adset_name}</p>}
                                            </td>
                                            <td className="px-3 py-2.5 text-right tabular-nums font-mono">{formatPrice(ad.spend)}</td>
                                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 font-mono">{(ad.impressions || 0).toLocaleString()}</td>
                                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 font-mono">{(ad.clicks || 0).toLocaleString()}</td>
                                            <td className="px-3 py-2.5 text-center">
                                              <span className="bg-slate-100 text-slate-800 rounded-md px-2 py-0.5 font-black font-mono">{ad.meta_purchases || 0}</span>
                                            </td>
                                            <td className="px-3 py-2.5 text-right tabular-nums font-mono">{ad.cost_per_purchase ? formatPrice(ad.cost_per_purchase) : '—'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )})}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Section 2 : Décomposition & Attribution par Produit Sponsorisé */}
          {(campaignViewFilter === 'all' || campaignViewFilter === 'products') && (
            <div className="bg-white rounded-[32px] border border-slate-100 overflow-hidden shadow-sm space-y-4 p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 flex items-center gap-2">
                    <Package className="size-4 text-[#4b7bec]" /> Produits Sponsorisés & Attribution — {activeStore?.name || 'Boutique'}
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Le système identifie les produits achetés via commandes UTM et leur attribue proportionnellement les dépenses publicitaires.
                  </p>
                </div>
                <span className="text-xs font-black text-slate-600 bg-slate-50 border border-slate-200/60 px-3 py-1.5 rounded-xl font-mono shrink-0">
                  {productsBreakdown.length} produit{productsBreakdown.length > 1 ? 's' : ''}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[1000px] text-xs">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-100">
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Produit</th>
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Attribution</th>
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Budget Investi</th>
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Impressions</th>
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Clics</th>
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">Ventes</th>
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">CA Généré</th>
                      <th className="px-6 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">ROAS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {isLoadingCampaigns ? (
                      [1,2,3].map(i => (
                        <tr key={i} className="animate-pulse">
                          <td colSpan={8} className="px-6 py-8 bg-slate-50/50" />
                        </tr>
                      ))
                    ) : productsBreakdown.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-16 text-center">
                          <div className="space-y-2">
                            <div className="size-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto">
                              <Package className="size-6 text-slate-400" />
                            </div>
                            <p className="text-sm font-bold text-slate-400">Aucun produit identifié dans vos campagnes sur cette période.</p>
                            <p className="text-[10px] text-slate-400 max-w-xs mx-auto">
                              Nommez vos campagnes Meta avec le SKU de vos produits ou associez-les manuellement ci-dessus.
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : productsBreakdown.map((p: any) => {
                      const roas = p.roas || (p.spend > 0 ? p.revenue / p.spend : 0);
                      const hasImage = !!p.product_image;
                      const isUtmBased = (p.orders_count || 0) > 0;
                      return (
                        <tr key={p.product_id} className="hover:bg-slate-50/60 transition-colors text-xs font-bold">
                          <td className="px-6 py-5">
                            <div className="flex items-center gap-3">
                              {hasImage ? (
                                <img src={p.product_image} alt={p.product_name} className="size-10 rounded-xl object-cover border border-slate-100 shrink-0" />
                              ) : (
                                <div className="size-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                                  <Package className="size-5 text-slate-400" />
                                </div>
                              )}
                              <div>
                                <p className="text-sm font-black text-slate-900 leading-tight">{p.product_name || 'Produit inconnu'}</p>
                                {p.product_sku && <p className="text-[10px] text-slate-400 font-mono mt-0.5">SKU: {p.product_sku}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <span className={cn(
                              "inline-block border text-[9px] font-black px-2.5 py-0.5 rounded-lg font-mono",
                              isUtmBased ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"
                            )}>
                              {isUtmBased ? 'Via commandes UTM' : 'Par nom campagne'}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-right">
                            <div className="flex flex-col items-end">
                              <span className="text-sm font-black text-slate-900 tabular-nums font-mono">{formatPrice(p.spend || 0)}</span>
                              {p.currency && p.currency !== 'DZD' && (
                                <span className="text-[10px] text-slate-400 font-bold tabular-nums font-mono">
                                  {p.raw_spend?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {p.currency}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-5 text-right text-slate-600 tabular-nums font-mono">{(p.impressions || 0).toLocaleString()}</td>
                          <td className="px-6 py-5 text-right text-slate-600 tabular-nums font-mono">{(p.clicks || 0).toLocaleString()}</td>
                          <td className="px-6 py-5 text-center">
                            <span className="bg-slate-100 text-slate-800 rounded-md px-2 py-0.5 font-black font-mono">{p.orders_count || 0}</span>
                          </td>
                          <td className="px-6 py-5 text-right font-black font-mono text-slate-900 tabular-nums">{formatPrice(p.revenue || 0)}</td>
                          <td className="px-6 py-5 text-center">
                            <span className={cn(
                              "px-2.5 py-1 rounded-md text-xs font-black font-mono border",
                              roas >= 4 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : roas >= 2.5 ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-rose-50 text-rose-700 border-rose-200"
                            )}>
                              {roas.toFixed(2)}x
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB: ENTONNOIR DE CONVERSION & RENTABILITÉ CROSS-MODULE (FUSIONNÉ) ─── */}
      {activeTab === 'funnel_integration' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          
          {/* En-tête Unifié de Traçabilité */}
          <div className="bg-white rounded-[32px] border border-slate-100 p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 shadow-xs">
                  <TrendingUp className="size-5 text-[#4b7bec]" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                    Entonnoir de Conversion & Rentabilité Cross-Module
                  </h3>
                  <p className="text-xs text-slate-400">
                    Croisement direct : Meta Ads (Trafic) → Comportement Boutique (Paniers) → Commandes ERP (COD) → Charges & Finance
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-xl text-[10px] font-black uppercase font-mono bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Traçabilité Active
                </span>
              </div>
            </div>

            {/* 4 KPIs Financiers Majeurs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-100 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Dépenses Pub (DZD)</span>
                  <DollarSign className="size-3.5 text-slate-400" />
                </div>
                <p className="text-xl font-black text-slate-900 font-mono tabular-nums">{formatPrice(intMetaAds.total_spend_dzd || 0)}</p>
                <p className="text-[10px] text-slate-500 font-medium">{intMetaAds.campaigns_count || 0} campagne{(intMetaAds.campaigns_count || 0) > 1 ? 's' : ''} actives</p>
              </div>

              <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-100 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Charges Synchronisées</span>
                  <Receipt className="size-3.5 text-slate-400" />
                </div>
                <p className="text-xl font-black text-slate-900 font-mono tabular-nums">{formatPrice(intCharges.advertising_expenses_total || 0)}</p>
                <p className="text-[10px] text-slate-500 font-medium">{intCharges.advertising_expenses_count || 0} dépense{(intCharges.advertising_expenses_count || 0) > 1 ? 's' : ''} inscrite{(intCharges.advertising_expenses_count || 0) > 1 ? 's' : ''}</p>
              </div>

              <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-100 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Sorties Trésorerie Finance</span>
                  <CreditCard className="size-3.5 text-slate-400" />
                </div>
                <p className="text-xl font-black text-slate-900 font-mono tabular-nums">{formatPrice(intFinance.ad_transactions_total || 0)}</p>
                <p className="text-[10px] text-slate-500 font-medium">{intFinance.ad_transactions_count || 0} transaction{(intFinance.ad_transactions_count || 0) > 1 ? 's' : ''} décaissée{(intFinance.ad_transactions_count || 0) > 1 ? 's' : ''}</p>
              </div>

              <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-100 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Profit Net Réel Ads</span>
                  <TrendingUp className="size-3.5 text-emerald-600" />
                </div>
                <p className={cn(
                  "text-xl font-black font-mono tabular-nums",
                  (intRevenue.net_profit_after_ads || 0) >= 0 ? "text-emerald-700" : "text-rose-700"
                )}>
                  {(intRevenue.net_profit_after_ads || 0) >= 0 ? '+' : ''}{formatPrice(intRevenue.net_profit_after_ads || 0)}
                </p>
                <p className="text-[10px] text-slate-500 font-medium">ROAS Global : <strong>{intRevenue.global_roas || 0}x</strong></p>
              </div>
            </div>

            {/* Barre d'Attribution Directe */}
            <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <span className="font-black uppercase tracking-wider text-slate-300 text-[10px]">
                  Bilan Attribution Revenus (UTM → Commandes Livrées → Finance)
                </span>
                <span className="font-mono text-slate-300 text-[11px]">
                  {intRevenue.ads_revenue_ratio || 0}% du chiffre d&apos;affaires généré via les campagnes
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono pt-1">
                <div>
                  <span className="text-[9px] uppercase text-slate-400 block font-sans">CA via UTM</span>
                  <span className="font-bold text-white text-sm">{formatPrice(intRevenue.utm_revenue || 0)}</span>
                </div>
                <div>
                  <span className="text-[9px] uppercase text-slate-400 block font-sans">Budget Pub Dépensé</span>
                  <span className="font-bold text-rose-400 text-sm">−{formatPrice(intMetaAds.total_spend_dzd || 0)}</span>
                </div>
                <div>
                  <span className="text-[9px] uppercase text-slate-400 block font-sans">Profit Net Pub</span>
                  <span className={cn("font-bold text-sm", (intRevenue.net_profit_after_ads || 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                    {(intRevenue.net_profit_after_ads || 0) >= 0 ? '+' : ''}{formatPrice(intRevenue.net_profit_after_ads || 0)}
                  </span>
                </div>
                <div>
                  <span className="text-[9px] uppercase text-slate-400 block font-sans">Multiplicateur (ROAS)</span>
                  <span className="font-bold text-blue-400 text-sm">{intRevenue.global_roas || 0}x</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section Entonnoir de Conversion Multi-Étapes */}
          <div className="bg-white rounded-[32px] border border-slate-100 p-6 sm:p-7 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 shadow-xs">
                  <Activity className="size-5 text-[#4b7bec]" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                    Visualisation de l&apos;Entonnoir de Vente & Déperdition
                  </h3>
                  <p className="text-xs text-slate-400">
                    Mesure des volumes et des ratios de passage à chaque étape (30 derniers jours)
                  </p>
                </div>
              </div>
            </div>

            {isLoadingFunnel ? (
              <div className="rounded-2xl border bg-slate-50 p-8 text-center text-xs font-bold text-slate-400">
                <RefreshCw className="size-4 animate-spin mx-auto text-[#4b7bec] mb-2" />
                Calcul de l&apos;entonnoir en cours…
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Visualisation Barre Entonnoir */}
                <div className="lg:col-span-2 space-y-3.5">
                  {funnelData?.stages?.map((stage: any, idx: number) => {
                    const prevStageCount = idx > 0 ? funnelData.stages[idx - 1].count : stage.count;
                    const ratioOfPrevious = idx === 0 ? 100 : (prevStageCount > 0 ? (stage.count / prevStageCount) * 100 : 0);
                    const ratioOfTotal = funnelData.stages[0].count > 0 ? (stage.count / funnelData.stages[0].count) * 100 : 0;
                    
                    const funnelWidths = [100, 90, 80, 70, 60, 50, 40];
                    const currentWidth = funnelWidths[idx] || 35;
                    
                    return (
                      <div key={idx} className="flex items-center gap-3">
                        <div className="w-36 sm:w-44 shrink-0 text-left">
                          <p className="text-xs font-black text-slate-800 leading-tight">{stage.name}</p>
                          <p className="text-[10px] text-slate-400 font-mono font-bold mt-0.5">{stage.count.toLocaleString()}</p>
                        </div>
                        
                        <div className="flex-1">
                          <div className="h-8 w-full bg-slate-100 rounded-xl relative overflow-hidden flex items-center">
                            <div
                              style={{ width: `${currentWidth}%` }}
                              className="h-full rounded-r-xl bg-slate-900 flex items-center justify-end pr-3 transition-all duration-500"
                            >
                              {stage.count > 0 && (
                                <span className="text-[10px] font-black text-white font-mono">
                                  {ratioOfTotal.toFixed(1)}%
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        <div className="w-16 sm:w-20 shrink-0 text-right font-mono">
                          {idx > 0 && (
                            <div className="text-xs font-black text-slate-700">
                              {ratioOfPrevious.toFixed(1)}%
                              <p className="text-[8px] font-black uppercase text-slate-400">vs préc.</p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 4 Ratios Opérationnels Clés */}
                <div className="space-y-3">
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Taux de Clic (CTR)</p>
                      <p className="text-lg font-black text-slate-900 font-mono mt-0.5">{funnelData?.summary?.ctr}%</p>
                    </div>
                    <span className={cn(
                      "px-2.5 py-1 rounded-lg text-[10px] font-black font-mono border",
                      (funnelData?.summary?.ctr || 0) >= 2 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"
                    )}>
                      {(funnelData?.summary?.ctr || 0) >= 2 ? "Optimal" : "À surveiller"}
                    </span>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Taux de Conversion (CR)</p>
                      <p className="text-lg font-black text-slate-900 font-mono mt-0.5">{funnelData?.summary?.cr}%</p>
                    </div>
                    <span className={cn(
                      "px-2.5 py-1 rounded-lg text-[10px] font-black font-mono border",
                      (funnelData?.summary?.cr || 0) >= 3 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"
                    )}>
                      {(funnelData?.summary?.cr || 0) >= 3 ? "Rentable" : "Moyen"}
                    </span>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Taux de Livraison (COD)</p>
                      <p className="text-lg font-black text-slate-900 font-mono mt-0.5">{funnelData?.summary?.delivery_rate}%</p>
                    </div>
                    <span className={cn(
                      "px-2.5 py-1 rounded-lg text-[10px] font-black font-mono border",
                      (funnelData?.summary?.delivery_rate || 0) >= 70 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"
                    )}>
                      {(funnelData?.summary?.delivery_rate || 0) >= 70 ? "Conforme" : "Faible"}
                    </span>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Qualité Trafic / Vitesse</p>
                      <p className="text-lg font-black text-slate-900 font-mono mt-0.5">{funnelData?.summary?.qualite_site_pct != null ? `${funnelData.summary.qualite_site_pct}%` : '—'}</p>
                    </div>
                    {funnelData?.summary?.qualite_site_pct != null && (
                      <span className={cn(
                        "px-2.5 py-1 rounded-lg text-[10px] font-black font-mono border",
                        funnelData.summary.qualite_site_pct >= 70 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"
                      )}>
                        {funnelData.summary.qualite_site_pct >= 70 ? "Rapide" : "Ralenti"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section Traçabilité Charges & Portefeuilles (Double Panneau) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Panneau Charges Publicitaires */}
            <div className="bg-white rounded-[32px] border border-slate-100 p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <Receipt className="size-4 text-slate-700" />
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-900">
                    Charges Publicitaires Inscrites (Module Charges)
                  </h4>
                </div>
                <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-lg">
                  {intCharges.recent_ad_expenses?.length || 0} lignes
                </span>
              </div>

              <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto custom-scrollbar">
                {isLoadingIntegration ? (
                  <div className="p-6 text-center text-slate-400 text-xs font-bold">Chargement…</div>
                ) : (intCharges.recent_ad_expenses || []).length === 0 ? (
                  <div className="p-8 text-center text-xs font-medium text-slate-400">
                    Aucune charge publicitaire enregistrée sur la période.
                  </div>
                ) : (intCharges.recent_ad_expenses || []).map((exp: any) => (
                  <div 
                    key={exp.id} 
                    onClick={() => setSelectedExpense(exp)}
                    className="py-3 px-1 flex items-center justify-between hover:bg-slate-50 rounded-xl transition-colors cursor-pointer"
                  >
                    <div>
                      <p className="text-xs font-black text-slate-900 truncate max-w-[200px]">{exp.label}</p>
                      <p className="text-[10px] text-slate-400 font-mono font-bold">{exp.date || '—'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black font-mono text-slate-900">{formatPrice(exp.amount)}</span>
                      <span className="px-2 py-0.5 rounded-md text-[9px] font-black font-mono bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {exp.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-between items-center text-xs font-bold">
                <span className="text-[10px] uppercase text-slate-400">Total Charges Pub</span>
                <span className="font-mono text-slate-900 font-black">{formatPrice(intCharges.advertising_expenses_total || 0)}</span>
              </div>
            </div>

            {/* Panneau Portefeuilles & Trésorerie */}
            <div className="bg-white rounded-[32px] border border-slate-100 p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <Wallet className="size-4 text-slate-700" />
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-900">
                    Impact Portefeuilles & Finance (Trésorerie)
                  </h4>
                </div>
                <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-lg">
                  Module Finance
                </span>
              </div>

              {/* Liste des portefeuilles */}
              <div className="space-y-2 max-h-[160px] overflow-y-auto custom-scrollbar">
                {(intFinance.wallets || []).map((w: any) => (
                  <div key={w.id} className="flex items-center justify-between bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                    <div>
                      <p className="text-xs font-black text-slate-900">{w.name}</p>
                      <p className="text-[10px] text-slate-400 uppercase font-mono font-bold">{w.type}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-black text-slate-900 font-mono">{formatPrice(w.balance)}</p>
                      <p className="text-[9px] text-rose-600 font-bold font-mono">−{formatPrice(w.total_out)} sortie pub</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Transactions récentes */}
              <div className="pt-2 border-t border-slate-100">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-2">
                  Dernières Transactions de Paiement Pub
                </span>
                <div className="divide-y divide-slate-100 max-h-[120px] overflow-y-auto custom-scrollbar">
                  {(intFinance.recent_ad_transactions || []).slice(0, 4).map((tx: any) => (
                    <div key={tx.id} className="py-2 flex items-center justify-between text-xs font-mono">
                      <div>
                        <span className="font-bold text-slate-800 text-[11px] block">{tx.reference}</span>
                        <span className="text-[9px] text-slate-400">{tx.date?.split('T')[0] || '—'}</span>
                      </div>
                      <span className="font-bold text-rose-600">−{formatPrice(tx.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-between items-center text-xs font-bold">
                <span className="text-[10px] uppercase text-slate-400">Total Sortie Finance Ads</span>
                <span className="font-mono text-slate-900 font-black">{formatPrice(intFinance.ad_transactions_total || 0)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB: DIAGNOSTICS ─── */}
      {activeTab === 'diagnostics' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          {/* ─── Widget Qualité du Tracking & Synchronisation CAPI ─── */}
          <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm p-6 sm:p-7 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
              <div className="flex items-center gap-4">
                <div className="size-12 rounded-2xl bg-indigo-50 text-[#4b7bec] flex items-center justify-center text-xl shadow-xs shrink-0">
                  <Activity className="size-6 text-[#4b7bec]" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">
                    Qualité & Santé du Tracking Meta Ads
                  </h3>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">
                    Synchronisation directe ERP ↔ Meta Conversions API (CAPI) & Pixel
                  </p>
                </div>
              </div>

              {trackingQuality?.tracking_score != null && (
                <div className="flex items-center gap-3 bg-slate-50 border border-slate-100 px-4 py-2 rounded-2xl shrink-0">
                  <div className="text-right">
                    <p className={cn(
                      'text-2xl font-black leading-none tabular-nums font-mono',
                      trackingQuality.tracking_score >= 85 ? 'text-emerald-600' : trackingQuality.tracking_score >= 70 ? 'text-amber-500' : 'text-rose-500'
                    )}>
                      {trackingQuality.tracking_score}<span className="text-xs text-slate-400">/100</span>
                    </p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-0.5">Score de Santé</p>
                  </div>
                  <div className={cn(
                    "size-3 rounded-full animate-pulse",
                    trackingQuality.tracking_score >= 85 ? "bg-emerald-500" : "bg-amber-500"
                  )} />
                </div>
              )}
            </div>

            {isLoadingTrackingQuality ? (
              <div className="rounded-2xl border bg-slate-50 p-8 text-center text-xs font-bold text-slate-400">
                <RefreshCw className="size-5 animate-spin mx-auto text-[#4b7bec] mb-2" />
                Analyse des flux de tracking en cours…
              </div>
            ) : !trackingQuality ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-xs font-bold text-slate-400">
                Aucune donnée de tracking enregistrée sur cette période.
              </div>
            ) : (
              <div className="space-y-6">
                {/* 4 Main Metrics */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-100">
                    <div className="flex justify-between items-center text-blue-700">
                      <span className="text-[10px] font-black uppercase tracking-wider">Commandes ERP</span>
                      <Package className="size-4" />
                    </div>
                    <p className="text-2xl font-black text-slate-900 mt-1 tabular-nums font-mono">{trackingQuality.erp_purchases ?? 0}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Éligibles au tracking</p>
                  </div>

                  <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-100">
                    <div className="flex justify-between items-center text-emerald-700">
                      <span className="text-[10px] font-black uppercase tracking-wider">Reçus par Meta</span>
                      <CheckCircle className="size-4" />
                    </div>
                    <p className="text-2xl font-black text-emerald-600 mt-1 tabular-nums font-mono">{trackingQuality.meta_purchases ?? 0}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Validés par CAPI</p>
                  </div>

                  <div className="p-4 rounded-2xl bg-indigo-50/60 border border-indigo-100">
                    <div className="flex justify-between items-center text-[#4b7bec]">
                      <span className="text-[10px] font-black uppercase tracking-wider">Taux de Couverture</span>
                      <Target className="size-4" />
                    </div>
                    <p className="text-2xl font-black text-[#4b7bec] mt-1 tabular-nums font-mono">{trackingQuality.coverage_pct ?? 0}%</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Efficacité de transmission</p>
                  </div>

                  <div className="p-4 rounded-2xl bg-purple-50/60 border border-purple-100">
                    <div className="flex justify-between items-center text-purple-700">
                      <span className="text-[10px] font-black uppercase tracking-wider">Match Quality (EMQ)</span>
                      <Smartphone className="size-4" />
                    </div>
                    <p className="text-2xl font-black text-purple-700 mt-1 tabular-nums font-mono">
                      {trackingQuality.avg_match_quality != null ? `${trackingQuality.avg_match_quality}%` : '—'}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Matching Téléphone / Wilaya</p>
                  </div>
                </div>

                {/* Flow Breakdown */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div className="text-center p-2">
                    <p className="text-base font-black text-emerald-600 font-mono">{trackingQuality.realtime ?? 0}</p>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Temps Réel Direct</p>
                  </div>
                  <div className="text-center p-2">
                    <p className="text-base font-black text-amber-600 font-mono">{trackingQuality.backfill ?? 0}</p>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Synchronisés (Backfill)</p>
                  </div>
                  <div className="text-center p-2">
                    <p className="text-base font-black text-[#4b7bec] font-mono">{trackingQuality.pending ?? 0}</p>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">En Attente</p>
                  </div>
                  <div className="text-center p-2">
                    <p className="text-base font-black text-slate-400 font-mono">{trackingQuality.failed ?? 0}</p>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Échecs Réseau</p>
                  </div>
                </div>

                {/* Actionable Synchronize Banner */}
                {trackingQuality.pending > 0 && (
                  <div className="bg-gradient-to-r from-blue-500/10 via-indigo-50 to-emerald-50 border border-blue-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-blue-600 animate-ping" />
                        <h4 className="text-sm font-black text-slate-900">
                          {trackingQuality.pending} commande{trackingQuality.pending > 1 ? 's' : ''} en attente de synchronisation
                        </h4>
                      </div>
                      <p className="text-xs text-slate-500">
                        Transmettez immédiatement ces événements d&apos;achat à Meta Conversions API pour optimiser vos algorithmes publicitaires.
                      </p>
                    </div>

                    <button
                      onClick={() => backfillMutation.mutate()}
                      disabled={backfillMutation.isPending}
                      className="h-10 px-5 rounded-xl bg-[#4b7bec] hover:bg-[#3867d6] text-white text-xs font-black uppercase tracking-wider shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 transition-all shrink-0 cursor-pointer"
                    >
                      <RefreshCw className={cn("size-3.5", backfillMutation.isPending && "animate-spin")} />
                      <span>{backfillMutation.isPending ? 'Synchronisation…' : 'Synchroniser avec Meta CAPI'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ─── Diagnostics Meta Events Table ─── */}
          <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm p-6 sm:p-7 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 shadow-xs">
                  <Activity className="size-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                    Événements Standard Suivis (Pixel & CAPI)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Statut en direct des conversions relayées vers vos campagnes Meta
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs font-black">
                <span className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100 font-mono">
                  {diagnosticsSummary.successful_events || 0} réussis
                </span>
                {diagnosticsSummary.failed_events > 0 && (
                  <span className="px-3 py-1 bg-rose-50 text-rose-700 rounded-xl border border-rose-100 font-mono">
                    {diagnosticsSummary.failed_events} échecs
                  </span>
                )}
              </div>
            </div>

            {isLoadingDiagnostics ? (
              <div className="rounded-2xl border bg-slate-50 p-8 text-center text-xs font-bold text-slate-400">
                <RefreshCw className="size-5 animate-spin mx-auto text-[#4b7bec] mb-2" />
                Chargement des diagnostics des événements…
              </div>
            ) : diagnosticsEvents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-xs font-bold text-slate-400">
                Aucun événement n’a encore été relayé pour cette boutique.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left min-w-[750px]">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80">
                      <th className="px-5 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Événement Meta</th>
                      <th className="px-5 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Qualité Matching</th>
                      <th className="px-5 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Statut</th>
                      <th className="px-5 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Dernier Envoi Réel</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {diagnosticsEvents.map((event: any, index: number) => {
                      const quality = event.match_quality || 0;
                      const isHealthy = quality >= 80 && (!event.failures || event.failures < 50);

                      const eventLabels: Record<string, { label: string; desc: string }> = {
                        Purchase: { label: 'Achat / Commande COD (Purchase)', desc: 'Confirmation de commande' },
                        InitiateCheckout: { label: 'Formulaire COD Ouvert (InitiateCheckout)', desc: 'Intention de commande' },
                        AddToCart: { label: 'Ajout au Panier (AddToCart)', desc: "Sélection d'offre ou variante" },
                        ViewContent: { label: 'Consultation Fiche Produit (ViewContent)', desc: 'Visite page produit / LP' },
                        PageView: { label: 'Visite de Page (PageView)', desc: 'Navigation générale sur le site' },
                      };

                      const info = eventLabels[event.event_name] || { label: event.event_name, desc: 'Événement standard' };

                      return (
                        <tr key={`${event.event_name}-${index}`} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-5 py-4">
                            <div>
                              <span className="text-sm font-black text-slate-900 block">{info.label}</span>
                              <span className="text-[10px] font-medium text-slate-400">{info.desc}</span>
                            </div>
                          </td>
                          <td className="px-5 py-4 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-xs font-black text-slate-800 font-mono">{quality}%</span>
                              <div className="w-20 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(quality, 100)}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4 text-center">
                            <span className={cn(
                              "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black border",
                              isHealthy ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"
                            )}>
                              <span className={cn("size-1.5 rounded-full", isHealthy ? "bg-emerald-500" : "bg-amber-500")} />
                              {isHealthy ? 'Opérationnel' : 'À vérifier'}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right">
                            <span className="text-xs font-mono font-bold text-slate-600 block">
                              {formatIsoDateGmt(event.last_successful_send || event.last_failure)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'quality' && (() => {
        const learning = signalQuality?.learning_score;
        const avgEmq = signalQuality?.avg_emq != null ? signalQuality.avg_emq : (trackingQuality?.avg_match_quality ?? '—');
        
        // 100% Real field coverage array directly from backend database
        const fieldCoverage: any[] = (Array.isArray(signalQuality?.field_coverage) && signalQuality.field_coverage.length > 0)
          ? signalQuality.field_coverage
          : (Array.isArray(trackingQuality?.signal_field_coverage) ? trackingQuality.signal_field_coverage : []);

        const reconciliation = fullDiagnostics?.reconciliation;
        const attribution = fullDiagnostics?.attribution_readiness;

        const fieldMeta: Record<string, { label: string; desc: string }> = {
          ph: { label: 'Numéro de Téléphone (+213)', desc: 'Correspondance principale compte Meta' },
          fn: { label: 'Prénom du Client', desc: 'Identité client' },
          ln: { label: 'Nom du Client', desc: 'Identité client' },
          ct: { label: 'Ville / Commune', desc: 'Localisation de livraison' },
          st: { label: 'Wilaya (Région)', desc: 'Localisation de livraison' },
          country: { label: 'Code Pays (DZ)', desc: 'Marché cible' },
          external_id: { label: 'Identifiant Unique Commande', desc: 'Dédoublonnage technique' },
          client_ip_address: { label: 'Adresse IP Client', desc: 'Signal réseau' },
          client_user_agent: { label: 'User-Agent (Navigateur)', desc: 'Signature technique appareil' },
          fbp: { label: 'Cookie Pixel (FBP)', desc: 'Traçage navigateur' },
          fbc: { label: 'Paramètre de Clic (FBC)', desc: 'Attribution clic publicitaire' },
          em: { label: 'Adresse Email', desc: 'Non requis en COD Algérie' },
        };

        return (
          <div className="space-y-6 animate-in fade-in duration-500">
            {/* ─── SECTION 1 : SCORE D'APPRENTISSAGE META ADS ─── */}
            <div className="bg-white rounded-[32px] border border-slate-100 p-6 sm:p-7 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                <div className="flex items-center gap-4">
                  <div className="size-12 rounded-2xl bg-indigo-50 text-[#4b7bec] flex items-center justify-center text-xl shadow-xs shrink-0">
                    <Zap className="size-6 text-[#4b7bec]" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">
                      Score d&apos;Apprentissage Publicitaire (Learning Score)
                    </h3>
                    <p className="text-xs text-slate-400 font-medium mt-0.5">
                      Indice d&apos;efficacité et de précision de transmission des signaux vers l&apos;algorithme Meta Ads
                    </p>
                  </div>
                </div>

                {learning?.score != null && (
                  <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-100 px-4 py-2 rounded-2xl shrink-0">
                    <div className="text-right">
                      <p className="text-2xl font-black text-emerald-600 font-mono leading-none">
                        {learning.score}<span className="text-xs text-slate-400">/100</span>
                      </p>
                      <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700 mt-0.5">
                        {signalQuality?.meta_health?.label || (learning.score >= 85 ? 'Optimal' : 'Stable')}
                      </p>
                    </div>
                    <div className="size-3 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                )}
              </div>

              {/* 4 Piliers Clés Réels */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Transmission Directe</span>
                  <p className="text-2xl font-black text-slate-900 tabular-nums font-mono">
                    {learning?.realtime_pct != null ? `${learning.realtime_pct}%` : `${trackingQuality?.realtime_pct ?? 0}%`}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {learning?.realtime_count ?? trackingQuality?.realtime ?? 0} achats en direct
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Synchronisations Différées</span>
                  <p className="text-2xl font-black text-slate-900 tabular-nums font-mono">
                    {learning?.backfill_pct != null ? `${learning.backfill_pct}%` : `${trackingQuality?.backfill_pct ?? 0}%`}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {learning?.backfill_count ?? trackingQuality?.backfill ?? 0} achats réconciliés
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Déduplication d&apos;Événements</span>
                  <p className="text-2xl font-black text-emerald-600 tabular-nums font-mono">
                    {learning?.dedup_pct != null ? `${learning.dedup_pct}%` : '100%'}
                  </p>
                  <p className="text-[10px] text-slate-500">Zéro doublon détecté</p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Attribution aux Campagnes</span>
                  <p className="text-2xl font-black text-purple-700 tabular-nums font-mono">
                    {learning?.attribution_pct != null ? `${learning.attribution_pct}%` : '—'}
                  </p>
                  <p className="text-[10px] text-slate-500">Attribué à la campagne source</p>
                </div>
              </div>
            </div>

            {/* ─── SECTION 2 : QUALITÉ DE CORRESPONDANCE DES SIGNAUX CLIENTS (EMQ) ─── */}
            <div className="bg-white rounded-[32px] border border-slate-100 p-6 sm:p-7 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center text-lg shadow-xs">
                    <CheckCircle className="size-5 text-[#4b7bec]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                      Qualité de Correspondance Client (Event Match Quality)
                    </h3>
                    <p className="text-xs text-slate-400 font-medium">
                      Complétude des paramètres transmis pour l&apos;identification des profils acheteurs par Meta
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-black font-mono">
                    Score Moyen : {avgEmq}%
                  </span>
                </div>
              </div>

              {/* 100% Real Dynamic Signals Grid */}
              {isLoadingSignalQuality ? (
                <div className="rounded-2xl border bg-slate-50 p-6 text-center text-xs font-bold text-slate-400">
                  <RefreshCw className="size-4 animate-spin mx-auto text-[#4b7bec] mb-2" />
                  Chargement des données en cours…
                </div>
              ) : fieldCoverage.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400 font-medium">
                  Aucun échantillon disponible sur la période.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {fieldCoverage.map((f: any) => {
                    const meta = fieldMeta[f.key] || { label: f.label || f.key, desc: '' };
                    const isNotApplicable = f.classification === 'not_applicable' || f.key === 'em';
                    const coverage = f.coverage_pct;

                    return (
                      <div key={f.key} className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col justify-between space-y-2.5">
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-slate-800 block truncate">{meta.label}</span>
                          {meta.desc && <span className="text-[10px] text-slate-400 block mt-0.5">{meta.desc}</span>}
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                          <span className="text-sm font-black font-mono text-slate-900 tabular-nums">
                            {isNotApplicable ? 'Non requis' : `${coverage ?? 0}%`}
                          </span>

                          {isNotApplicable ? (
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-200/60 px-2 py-0.5 rounded-md">
                              Optionnel COD
                            </span>
                          ) : coverage >= 85 ? (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                              Optimal
                            </span>
                          ) : coverage >= 50 ? (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                              Conforme
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                              Partiel
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ─── SECTION 3 : RÉCONCILIATION ERP ↔ META ADS ─── */}
            <div className="bg-white rounded-[32px] border border-slate-100 p-6 sm:p-7 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center text-lg shadow-xs">
                    <Layers className="size-5 text-[#4b7bec]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                      Réconciliation des Commandes (Période Sélectionnée)
                    </h3>
                    <p className="text-xs text-slate-400 font-medium">
                      Suivi comparatif des volumes de commandes réelles et des réceptions Meta Ads
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 text-center space-y-1">
                  <p className="text-2xl font-black text-slate-900 font-mono">
                    {reconciliation?.erp_real_orders ?? trackingQuality?.erp_purchases ?? 0}
                  </p>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Commandes ERP</p>
                  <p className="text-[10px] text-slate-500">Commandes boutique enregistrées</p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 text-center space-y-1">
                  <p className="text-2xl font-black text-indigo-600 font-mono">
                    {attribution?.attributable_valid_fbc ?? trackingQuality?.meta_purchases ?? 0}
                  </p>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Clics Publicitaires Valides</p>
                  <p className="text-[10px] text-slate-500">Attribuables avec paramètre FBC</p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 text-center space-y-1">
                  <p className="text-2xl font-black text-emerald-600 font-mono">
                    {reconciliation?.meta_purchase_success ?? trackingQuality?.meta_purchases ?? 0}
                  </p>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Reçus par Meta (CAPI)</p>
                  <p className="text-[10px] text-slate-500">Événements Purchase validés</p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 text-center space-y-1">
                  <p className="text-2xl font-black text-slate-500 font-mono">
                    {attribution?.no_ad_click_signal_organic_direct ?? (reconciliation?.orphan_no_order ?? 0)}
                  </p>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Ventes Directes</p>
                  <p className="text-[10px] text-slate-500">Achats sans clic publicitaire</p>
                </div>
              </div>
            </div>
          </div>
        );
      })()}


      {/* ─── TAB: EVENT REGISTRY — Registre et Inspection d'Événements CAPI ─── */}
      {activeTab === 'registry' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          {/* Section 1 : Volume & Métriques par Type d'Événement */}
          <div className="bg-white rounded-[32px] border border-slate-100 p-6 sm:p-7 shadow-sm space-y-5">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="size-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 shadow-xs">
                <BarChart3 className="size-5 text-[#4b7bec]" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                  Volume & Performance par Type d&apos;Événement (Période Sélectionnée)
                </h3>
                <p className="text-xs text-slate-400">
                  Mesure du trafic CAPI, des taux de succès et de la latence de traitement
                </p>
              </div>
            </div>

            {isLoadingVolumeByEvent ? (
              <div className="rounded-2xl border bg-slate-50 p-8 text-center text-xs font-bold text-slate-400">
                <RefreshCw className="size-4 animate-spin mx-auto text-[#4b7bec] mb-2" />
                Chargement des volumes par événement…
              </div>
            ) : Array.isArray(volumeByEventData?.data) && volumeByEventData.data.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[700px]">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80">
                      <th className="py-3 px-4 font-black text-slate-400 uppercase tracking-wider text-[10px]">Événement</th>
                      <th className="py-3 px-4 font-black text-slate-400 uppercase tracking-wider text-[10px] text-right">Volume CAPI</th>
                      <th className="py-3 px-4 font-black text-slate-400 uppercase tracking-wider text-[10px] text-center">Taux Succès</th>
                      <th className="py-3 px-4 font-black text-slate-400 uppercase tracking-wider text-[10px] text-right">Latence Moy.</th>
                      <th className="py-3 px-4 font-black text-slate-400 uppercase tracking-wider text-[10px] text-right">event_id Uniques</th>
                      <th className="py-3 px-4 font-black text-slate-400 uppercase tracking-wider text-[10px]">Rôle dans l&apos;Optimisation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {volumeByEventData.data.map((e: any) => (
                      <tr key={e.event_name} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3.5 px-4 font-black text-slate-900">{e.event_name}</td>
                        <td className="py-3.5 px-4 tabular-nums font-mono font-bold text-slate-800 text-right">{e.capi_attempts_total}</td>
                        <td className="py-3.5 px-4 text-center">
                          <span className={cn(
                            "px-2 py-0.5 rounded-md text-[10px] font-black font-mono border",
                            (e.capi_success_rate_pct ?? 0) >= 95 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"
                          )}>
                            {e.capi_success_rate_pct != null ? `${e.capi_success_rate_pct}%` : '—'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 tabular-nums font-mono text-slate-600 text-right">
                          {e.avg_latency_ms != null ? `${e.avg_latency_ms} ms` : '—'}
                        </td>
                        <td className="py-3.5 px-4 tabular-nums font-mono text-slate-700 text-right font-bold">
                          {e.unique_event_ids}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 font-medium">
                          {e.meta_learning_usage || 'Événement standard'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-xs font-medium text-slate-400">
                Aucun événement enregistré sur la période.
              </div>
            )}
          </div>

          {/* Section 2 : Registre d'Événements avec Inspection au Clic */}
          <div className="bg-white rounded-[32px] border border-slate-100 p-6 sm:p-7 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 shadow-xs">
                  <Activity className="size-5 text-[#4b7bec]" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                    Registre des Événements & Journal de Traçabilité
                  </h3>
                  <p className="text-xs text-slate-400">
                    Cliquez sur n&apos;importe quelle ligne pour inspecter la déduplication et le payload complet
                  </p>
                </div>
              </div>
              <span className="text-xs font-black text-slate-500 bg-slate-50 border border-slate-200/60 px-3 py-1.5 rounded-xl font-mono">
                {registryData?.total ?? 0} événement{(registryData?.total ?? 0) > 1 ? 's' : ''}
              </span>
            </div>

            {/* Filtres de Recherche */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              <select value={registryEventFilter} onChange={e => { setRegistryEventFilter(e.target.value); setRegistryPage(1); }} className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-2.5">
                <option value="">Tous les événements</option>
                {['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase'].map(ev => (
                  <option key={ev} value={ev}>{ev}</option>
                ))}
              </select>

              <select value={registryDedupFilter} onChange={e => { setRegistryDedupFilter(e.target.value); setRegistryPage(1); }} className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-2.5">
                <option value="">Tous statuts dédup.</option>
                <option value="unique">Unique</option>
                <option value="doublon_reel">Doublon réel</option>
                <option value="retry_normal">Retry normal</option>
              </select>

              <select value={registrySourceFilter} onChange={e => { setRegistrySourceFilter(e.target.value); setRegistryPage(1); }} className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-2.5">
                <option value="">Toutes sources</option>
                <option value="pixel_capi">Pixel + CAPI</option>
                <option value="capi_only">CAPI uniquement</option>
              </select>

              <input value={registryEventIdSearch} onChange={e => { setRegistryEventIdSearch(e.target.value); setRegistryPage(1); }} placeholder="event_id…" className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-2.5" />
              <input value={registryPhoneSearch} onChange={e => { setRegistryPhoneSearch(e.target.value); setRegistryPage(1); }} placeholder="Téléphone…" className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-2.5" />
              <input value={registryCampaignSearch} onChange={e => { setRegistryCampaignSearch(e.target.value); setRegistryPage(1); }} placeholder="Campagne…" className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-2.5" />
              <input value={registryAdSearch} onChange={e => { setRegistryAdSearch(e.target.value); setRegistryPage(1); }} placeholder="Annonce…" className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-2.5" />
              <button onClick={resetRegistryFilters} className="h-9 rounded-xl border border-slate-200 text-xs font-black text-slate-500 hover:bg-slate-100 transition-colors">Réinitialiser</button>
            </div>

            {isLoadingRegistry ? (
              <div className="rounded-2xl border bg-slate-50 p-8 text-center text-xs font-bold text-slate-400">
                <RefreshCw className="size-4 animate-spin mx-auto text-[#4b7bec] mb-2" />
                Chargement du registre…
              </div>
            ) : Array.isArray(registryData?.data) && registryData.data.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[900px]">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/80">
                        <th className="py-3 px-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">Événement</th>
                        <th className="py-3 px-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">Source</th>
                        <th className="py-3 px-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">État Meta</th>
                        <th className="py-3 px-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">Déduplication</th>
                        <th className="py-3 px-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">Commande</th>
                        <th className="py-3 px-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">Campagne</th>
                        <th className="py-3 px-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">Reçu le</th>
                        <th className="py-3 px-3 font-black text-slate-400 uppercase tracking-wider text-[10px] text-right">Détails</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {registryData.data.map((e: any) => (
                        <tr 
                          key={e.id} 
                          onClick={() => setSelectedRegistryEvent(e)}
                          className="hover:bg-slate-50/90 transition-colors cursor-pointer group"
                        >
                          <td className="py-3 px-3 font-black text-slate-900 flex items-center gap-1.5">
                            <span>{e.event_name}</span>
                          </td>
                          <td className="py-3 px-3">
                            <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-black uppercase", e.source === 'CAPI uniquement' ? "bg-purple-50 text-purple-700" : "bg-blue-50 text-blue-700")}>
                              {e.source}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <span className={cn(
                              "px-2 py-0.5 rounded-md text-[10px] font-black font-mono border",
                              e.sync_status === 'success' ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                              ['error', 'failed'].includes(e.sync_status) ? "bg-rose-50 text-rose-700 border-rose-200" :
                              "bg-amber-50 text-amber-700 border-amber-200"
                            )}>
                              {e.meta_state}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <span className={cn(
                              "px-2 py-0.5 rounded-md text-[10px] font-black font-mono border",
                              e.dedup_status === 'doublon_reel' ? "bg-rose-50 text-rose-700 border-rose-200" :
                              e.dedup_status === 'retry_normal' ? "bg-amber-50 text-amber-700 border-amber-200" :
                              "bg-slate-50 text-slate-700 border-slate-200"
                            )}>
                              {e.dedup_status === 'doublon_reel' ? 'Doublon Détecté' : e.dedup_status === 'retry_normal' ? 'Retry Réussi' : 'Unique'}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-bold text-slate-700 font-mono">{e.order_number || '—'}</td>
                          <td className="py-3 px-3 text-slate-600 max-w-[140px] truncate" title={e.campaign_name || e.campaign_id || ''}>
                            {e.campaign_name || e.campaign_id || '—'}
                          </td>
                          <td className="py-3 px-3 text-slate-500 whitespace-nowrap font-mono text-[11px]">
                            {e.created_at ? new Date(e.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <span className="text-[10px] font-black uppercase tracking-wider text-[#4b7bec] group-hover:underline">
                              Inspecter →
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400">{registryData.total} événement{registryData.total > 1 ? 's' : ''} au total</span>
                  <div className="flex items-center gap-2">
                    <button disabled={registryPage <= 1} onClick={() => setRegistryPage(p => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold disabled:opacity-30 hover:bg-slate-50 transition-colors">← Précédent</button>
                    <span className="text-xs font-mono font-bold text-slate-700">{registryPage} / {registryData.totalPages || 1}</span>
                    <button disabled={registryPage >= (registryData.totalPages || 1)} onClick={() => setRegistryPage(p => p + 1)} className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold disabled:opacity-30 hover:bg-slate-50 transition-colors">Suivant →</button>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-xs font-medium text-slate-400">
                Aucun événement trouvé pour ces critères de recherche.
              </div>
            )}
          </div>

          {/* ─── MODALE D'INSPECTION DÉTAILLÉE DE L'ÉVÉNEMENT (AU CLIC) ─── */}
          <Dialog open={!!selectedRegistryEvent} onOpenChange={open => !open && setSelectedRegistryEvent(null)}>
            <DialogContent className="max-w-3xl w-[95vw] p-0 border-none bg-white rounded-[32px] overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
              {selectedRegistryEvent && (
                <>
                  <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono font-black text-slate-400 uppercase tracking-widest">
                          Détails Événement Meta CAPI
                        </span>
                        <span className={cn(
                          "px-2 py-0.5 rounded-md text-[10px] font-black font-mono border",
                          selectedRegistryEvent.sync_status === 'success' ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"
                        )}>
                          {selectedRegistryEvent.meta_state}
                        </span>
                      </div>
                      <h3 className="text-lg font-black text-slate-900">
                        {selectedRegistryEvent.event_name}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5 font-mono">
                        Reçu le {selectedRegistryEvent.created_at ? new Date(selectedRegistryEvent.created_at).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'medium' }) + ' (GMT+1)' : '—'}
                      </p>
                    </div>
                  </div>

                  <div className="p-6 space-y-6 overflow-y-auto flex-1">
                    {/* Explication Déduplication */}
                    <div className={cn(
                      "p-4 rounded-2xl border text-xs space-y-1.5",
                      selectedRegistryEvent.dedup_status === 'doublon_reel' 
                        ? "bg-rose-50/70 border-rose-200 text-rose-900" 
                        : selectedRegistryEvent.dedup_status === 'retry_normal'
                        ? "bg-amber-50/70 border-amber-200 text-amber-900"
                        : "bg-slate-50 border-slate-200 text-slate-800"
                    )}>
                      <div className="flex items-center justify-between">
                        <span className="font-black uppercase tracking-wider text-[10px]">
                          Diagnostic Déduplication
                        </span>
                        <span className="font-mono font-bold text-[10px]">
                          Statut : {selectedRegistryEvent.dedup_status === 'doublon_reel' ? 'Doublon Réel' : selectedRegistryEvent.dedup_status === 'retry_normal' ? 'Retry Réussi' : 'Unique'}
                        </span>
                      </div>
                      <p className="leading-relaxed">
                        {selectedRegistryEvent.dedup_status === 'doublon_reel' && 
                          "Pourquoi est-ce un doublon ? Cet identifiant event_id a été transmis et validé plus d'une fois par le serveur CAPI. Cela se produit lorsque l'utilisateur recharge sa page, clique plusieurs fois rapidement sur le bouton de commande ou si le Pixel navigateur et l'API CAPI ont envoyé l'événement avec un léger décalage. Meta déduplique automatiquement ces événements côté serveur pour ne pas fausser vos statistiques publicitaires."}
                        {selectedRegistryEvent.dedup_status === 'retry_normal' && 
                          "Pourquoi le statut Retry ? Le premier envoi a échoué (micro-coupure réseau / timeout) ; le système l'a renvoyé avec succès lors de la tentative suivante. Meta n'a comptabilisé qu'une seule conversion."}
                        {selectedRegistryEvent.dedup_status === 'unique' && 
                          "Événement unique : Transmis avec succès et dédoublonné sans anomalie."}
                      </p>
                    </div>

                    {/* Grille Métadonnées Clés */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Identifiant Unique (event_id)</span>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-mono font-bold text-slate-900 truncate">{selectedRegistryEvent.event_id || '—'}</span>
                          {selectedRegistryEvent.event_id && (
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(selectedRegistryEvent.event_id);
                                toast.success('event_id copié dans le presse-papier');
                              }}
                              className="text-slate-400 hover:text-slate-700 p-1"
                              title="Copier l'event_id"
                            >
                              <Copy className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Commande Liée</span>
                        <p className="text-xs font-mono font-bold text-slate-900">
                          {selectedRegistryEvent.order_number || selectedRegistryEvent.order_id || 'Aucune (Événement pré-commande)'}
                        </p>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Campagne & Tracking</span>
                        <p className="text-xs font-bold text-slate-800">
                          {selectedRegistryEvent.campaign_name || selectedRegistryEvent.campaign_id || 'Direct / Organique'}
                        </p>
                        {selectedRegistryEvent.adset_name && <p className="text-[10px] text-slate-400">Adset: {selectedRegistryEvent.adset_name}</p>}
                        {selectedRegistryEvent.ad_name && <p className="text-[10px] text-slate-400">Annonce: {selectedRegistryEvent.ad_name}</p>}
                      </div>

                      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Latence & Réseau</span>
                        <p className="text-xs font-mono font-bold text-slate-900">
                          {selectedRegistryEvent.latency_ms != null ? `${selectedRegistryEvent.latency_ms} ms` : '—'} · Source : {selectedRegistryEvent.source}
                        </p>
                        {selectedRegistryEvent.last_http_status && (
                          <p className="text-[10px] text-slate-400 font-mono">HTTP Status : {selectedRegistryEvent.last_http_status}</p>
                        )}
                      </div>
                    </div>

                    {/* Données de matching transmises (user_data) */}
                    {selectedRegistryEvent.payload?.data?.[0]?.user_data && (
                      <div className="space-y-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                          Données Clients & Matching Transmis (user_data)
                        </span>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                          {Object.entries(selectedRegistryEvent.payload.data[0].user_data).map(([k, v]) => (
                            <div key={k} className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                              <span className="text-[10px] font-bold text-slate-400 uppercase block">{k}</span>
                              <span className="font-mono text-slate-800 truncate block text-[11px] mt-0.5">
                                {Array.isArray(v) ? v[0] : String(v)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Données d'Achat (custom_data) */}
                    {selectedRegistryEvent.payload?.data?.[0]?.custom_data && (
                      <div className="space-y-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                          Données Personnalisées de Commande (custom_data)
                        </span>
                        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 text-xs font-mono space-y-1">
                          {selectedRegistryEvent.payload.data[0].custom_data.value != null && (
                            <div>Valeur : <strong>{selectedRegistryEvent.payload.data[0].custom_data.value} {selectedRegistryEvent.payload.data[0].custom_data.currency || 'DZD'}</strong></div>
                          )}
                          {selectedRegistryEvent.payload.data[0].custom_data.order_id && (
                            <div>Order ID : {selectedRegistryEvent.payload.data[0].custom_data.order_id}</div>
                          )}
                          {Array.isArray(selectedRegistryEvent.payload.data[0].custom_data.contents) && (
                            <div>Articles : {selectedRegistryEvent.payload.data[0].custom_data.contents.length} article(s)</div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Payload JSON Brut */}
                    {selectedRegistryEvent.payload && (
                      <details className="p-3.5 rounded-2xl bg-slate-900 text-slate-200 text-xs space-y-2 cursor-pointer">
                        <summary className="font-mono font-bold uppercase text-[10px] tracking-wider text-slate-400">
                          Inspecter le Payload JSON Brut Envoyé à Meta
                        </summary>
                        <pre className="mt-2 p-3 bg-black/40 rounded-xl overflow-x-auto text-[10px] font-mono text-emerald-400">
                          {JSON.stringify(selectedRegistryEvent.payload, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>

                  <div className="p-4 sm:p-6 border-t border-slate-100 flex justify-end">
                    <button
                      onClick={() => setSelectedRegistryEvent(null)}
                      className="px-6 h-10 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold uppercase tracking-wider transition-colors"
                    >
                      Fermer
                    </button>
                  </div>
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* DIALOG: GUIDE D'INSTALLATION */}
      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[32px] p-8 max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl border animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-black uppercase tracking-wider flex items-center gap-2 text-[#1877F2]">
                <Facebook className="size-6" /> Guide d'Intégration Meta Ads
              </h3>
              <button onClick={() => setShowGuide(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                <X className="size-5 text-gray-500" />
              </button>
            </div>
            
            <div className="space-y-6 text-sm text-gray-700 leading-relaxed">
              <div className="p-4 bg-blue-50 text-blue-900 rounded-2xl border border-blue-100">
                <strong>Pourquoi connecter Meta Ads ?</strong><br/>
                En connectant votre compte, vous permettez à la boutique d'envoyer vos événements d'achats directement via l'API Conversions. Cela garantit que votre ROAS est calculé automatiquement et affiché dans votre tableau de bord. <br/><br/>
                <strong>Intégration complète :</strong> Chaque synchronisation crée automatiquement des <em>Charges (Dépenses)</em> et des <em>Transactions Finance</em> dans votre portefeuille, pour une traçabilité totale.
              </div>

              <div>
                <h4 className="font-bold text-gray-900 text-base mb-2">Étape 1 : Récupérer votre "ID Compte Publicitaire"</h4>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Connectez-vous à votre Gestionnaire de Publicités Facebook.</li>
                  <li>Regardez dans le menu déroulant en haut à gauche. Vous verrez le nom de votre compte suivi d'un numéro entre parenthèses, ex: <code>(1234567890)</code>.</li>
                  <li>Dans AzzougShop, ajoutez impérativement le préfixe <strong>act_</strong> devant ce numéro. Exemple: <strong>act_1234567890</strong></li>
                </ol>
              </div>

              <div>
                <h4 className="font-bold text-gray-900 text-base mb-2">Étape 2 : Obtenir votre "Jeton d'Accès API (Token)"</h4>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Allez dans les <strong>Paramètres de l'entreprise</strong> (Business Settings) &gt; <strong>Sources de données</strong> &gt; <strong>Pixels</strong> (ou Ensembles de données).</li>
                  <li>Ouvrez votre Pixel dans le Gestionnaire d'Événements.</li>
                  <li>Allez dans l'onglet <strong>Paramètres</strong>.</li>
                  <li>Faites défiler jusqu'à la section "API Conversions".</li>
                  <li>Cliquez sur <strong>Générer un jeton d'accès</strong> sous Configuration manuelle.</li>
                  <li>Copiez ce très long texte et collez-le dans AzzougShop.</li>
                </ol>
              </div>

              <div className="p-4 bg-orange-50 text-orange-900 rounded-2xl border border-orange-100 flex gap-3">
                <AlertCircle className="size-5 shrink-0 mt-0.5" />
                <p><strong>Note importante sur les Cookies et la Sécurité:</strong> AzzougShop génère un Hachage Sécurisé (SHA-256) des informations de vos clients (Email, Téléphone) avant de les envoyer à Meta. Votre boutique est 100% conforme au RGPD et au blocage des cookies par Apple (iOS 14+).</p>
              </div>
            </div>
            
            <div className="mt-8 flex justify-end">
              <button onClick={() => setShowGuide(false)} className="px-6 py-3 bg-[#1877F2] text-white rounded-xl text-sm font-bold shadow-lg shadow-[#1877F2]/20 hover:scale-105 transition-all">
                J'ai compris !
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── DIALOG: EXPENSE DETAIL & HISTORY ─── */}
      {selectedExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setSelectedExpense(null)}>
          <div className="bg-white rounded-[32px] w-full max-w-md shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200 overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-[#FFEDE9] px-6 py-5 flex items-center justify-between border-b border-[#FFD4CC]">
              <div className="flex items-center gap-3">
                <div className="size-10 bg-[#E17055]/10 rounded-xl flex items-center justify-center">
                  <Receipt className="size-5 text-[#E17055]" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-[#2D3436] tracking-tight">{selectedExpense.label}</h3>
                  <p className="text-[10px] text-[#B2BEC3] font-black uppercase tracking-wider mt-0.5">Historique et Détails</p>
                </div>
              </div>
              <button onClick={() => setSelectedExpense(null)} className="size-8 rounded-xl bg-black/5 hover:bg-black/10 flex items-center justify-center text-[#636E72] transition-colors">
                <X className="size-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-5 max-h-[65vh] overflow-y-auto">
              {/* Key Metrics */}
              <div className="grid grid-cols-2 gap-3.5">
                <div className="bg-[#FAFBFD] border rounded-xl p-3.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-[#B2BEC3]">Montant Total</span>
                  <p className="text-lg font-black text-[#E17055] font-mono mt-0.5">{formatPrice(selectedExpense.amount)}</p>
                </div>
                <div className="bg-[#FAFBFD] border rounded-xl p-3.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-[#B2BEC3]">Statut de Paiement</span>
                  <div className="mt-1">
                    <Badge className={cn(
                      "border-none text-[9px] font-black rounded-md px-2 py-0.5",
                      selectedExpense.status === 'PAID' ? "bg-[#E6FFF8] text-[#00B894]" : "bg-[#FFF8E6] text-[#FDCB6E]"
                    )}>
                      {selectedExpense.status}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Detail list */}
              <div className="space-y-2.5 border-t border-[#F1F2F4] pt-4">
                {[
                  { label: "Date de facturation", value: selectedExpense.date || '—' },
                  { label: "Catégorie de charge", value: "ADVERTISING (Publicité)" },
                  { label: "Bénéficiaire", value: selectedExpense.beneficiary || "Meta Platforms, Inc." },
                  { label: "Portefeuille débité", value: selectedExpense.wallet_name || "Non spécifié" },
                  { label: "Créateur", value: selectedExpense.created_by_name || "Système (Auto)" },
                ].map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center text-[11px]">
                    <span className="font-bold text-[#636E72]">{item.label}</span>
                    <span className="font-black text-[#2D3436]">{item.value}</span>
                  </div>
                ))}
              </div>

              {/* Description */}
              {selectedExpense.description && (
                <div className="border-t border-[#F1F2F4] pt-4 space-y-1.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-[#B2BEC3]">Notes / Description</span>
                  <p className="text-[11px] text-[#636E72] leading-relaxed bg-[#FAFBFD] p-3 rounded-lg border">
                    {selectedExpense.description}
                  </p>
                </div>
              )}

              {/* Justificatif */}
              {selectedExpense.receipt_url && (
                <div className="border-t border-[#F1F2F4] pt-4 space-y-1.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-[#B2BEC3]">Justificatif / Reçu</span>
                  <div className="rounded-xl border overflow-hidden bg-slate-50 relative aspect-[1.5/1]">
                    <img src={selectedExpense.receipt_url} className="size-full object-cover" alt="Justificatif" />
                    <a 
                      href={selectedExpense.receipt_url} 
                      target="_blank" 
                      rel="noreferrer"
                      className="absolute bottom-2.5 right-2.5 bg-white hover:bg-slate-50 text-slate-800 border text-[9px] font-black uppercase px-2.5 py-1.5 rounded-lg shadow-sm transition-colors"
                    >
                      Ouvrir
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 bg-[#FAFBFD] border-t flex justify-end">
              <Button 
                onClick={() => setSelectedExpense(null)} 
                className="bg-[#2D3436] hover:bg-[#1E2224] text-white font-black text-[10px] uppercase px-4 py-2 rounded-lg shadow-sm"
              >
                Fermer
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
