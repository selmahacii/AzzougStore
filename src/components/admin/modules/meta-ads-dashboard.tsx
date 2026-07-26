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

export default function MetaAdsDashboard() {
  const activeStore = useAppStore((s) => s.activeStore);
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
  const [activeTab, setActiveTab] = useState<'roas' | 'products' | 'integration' | 'funnel' | 'diagnostics' | 'quality' | 'registry'>('roas');
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
                      <option value="USD">🇺🇸 USD – Dollar</option>
                      <option value="EUR">🇪🇺 EUR – Euro</option>
                      <option value="DZD">🇩🇿 DZD – Dinar</option>
                      <option value="GBP">🇬🇧 GBP – Livre sterling</option>
                      <option value="CAD">🇨🇦 CAD – Dollar canadien</option>
                      <option value="MAD">🇲🇦 MAD – Dirham marocain</option>
                      <option value="TND">🇹🇳 TND – Dinar tunisien</option>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Ad Spend */}
        <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Budget Pub dépensé</span>
            <h2 className="text-2xl font-black text-[#2D3436] tabular-nums">{formatPrice(summary.total_spend)}</h2>
            <span className="text-[9px] font-bold text-[#636E72] uppercase">
              Devises converties dynamiquement en DZD
            </span>
          </div>
          <div className="size-12 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-500">
            <DollarSign className="size-5" />
          </div>
        </div>

        {/* Revenue */}
        <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Revenu Commandes (CA)</span>
            <h2 className="text-2xl font-black text-[#2D3436] tabular-nums">{formatPrice(summary.total_revenue)}</h2>
            <span className="text-[9px] font-bold text-[#636E72] uppercase">Commandes UTM associées</span>
          </div>
          <div className="size-12 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center text-green-500">
            <ShoppingBag className="size-5" />
          </div>
        </div>

        {/* Orders Generated */}
        <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Ventes Générées</span>
            <h2 className="text-2xl font-black text-[#2D3436] tabular-nums">{summary.total_orders}</h2>
            <span className="text-[9px] font-bold text-[#636E72] uppercase">Volume de commandes</span>
          </div>
          <div className="size-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-500">
            <BarChart3 className="size-5" />
          </div>
        </div>

        {/* Global ROAS */}
        <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">ROAS Global</span>
            <h2 className="text-3xl font-black text-[#6C5CE7] tabular-nums">{summary.global_roas}x</h2>
            <Badge className={cn(
              "border-none rounded-md px-1.5 py-0.5 text-[9px] font-black mt-1",
              summary.global_roas >= 3 ? "bg-[#E6FFF8] text-[#00B894]" : "bg-[#FFEDE9] text-[#E17055]"
            )}>
              {summary.global_roas >= 3 ? 'EXCELLENT ROAS' : 'ROAS FAIBLE'}
            </Badge>
          </div>
          <div className="size-12 rounded-xl bg-[#F0EDFF] border border-[#6C5CE7]/10 flex items-center justify-center text-[#6C5CE7]">
            <TrendingUp className="size-5" />
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
          <span className="flex items-center gap-1.5"><Sparkles className="size-3.5" /> Campagnes</span>
        </button>
        <button
          onClick={() => setActiveTab('products')}
          className={cn(
            "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
            activeTab === 'products'
              ? "bg-white text-[#2D3436] shadow-sm border border-[#E9ECF0]"
              : "text-[#B2BEC3] hover:text-[#636E72]"
          )}
        >
          <span className="flex items-center gap-1.5"><Package className="size-3.5" /> Produits Sponsorisés</span>
        </button>
        <button
          onClick={() => setActiveTab('funnel')}
          className={cn(
            "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
            activeTab === 'funnel'
              ? "bg-white text-[#2D3436] shadow-sm border border-[#E9ECF0]"
              : "text-[#B2BEC3] hover:text-[#636E72]"
          )}
        >
          <span className="flex items-center gap-1.5"><Activity className="size-3.5" /> Entonnoir de Conversion</span>
        </button>
        <button
          onClick={() => setActiveTab('integration')}
          className={cn(
            "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
            activeTab === 'integration'
              ? "bg-white text-[#2D3436] shadow-sm border border-[#E9ECF0]"
              : "text-[#B2BEC3] hover:text-[#636E72]"
          )}
        >
          <span className="flex items-center gap-1.5"><Layers className="size-3.5" /> Intégration Modules</span>
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

      {/* ─── TAB: CAMPAGNES ─── */}
      {activeTab === 'roas' && (
        <div className="bg-white rounded-3xl border overflow-hidden shadow-sm">
          <div className="p-6 border-b flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="size-4 text-[#6C5CE7]" /> Historique des Campagnes — {activeStore?.name || 'Boutique'}
              </h3>
              <p className="text-[10px] text-slate-400 mt-1">Données isolées par boutique • Attribution UTM automatique • Cliquez sur une ligne pour les détails</p>
              {lastSyncedAt && (
                <p className="text-[9px] text-slate-400 font-bold mt-1 flex items-center gap-1">
                  <RefreshCw className={cn("size-2.5", syncMutation.isPending && "animate-spin")} />
                  {syncMutation.isPending
                    ? 'Resynchronisation avec Meta en cours…'
                    : <>Synchronisé {formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true, locale: fr })} — Meta Ads Manager peut afficher des chiffres légèrement plus récents entre deux synchros</>}
                </p>
              )}
            </div>
            <Badge className="bg-slate-100 text-slate-600 border-none font-black">{campaigns.length} campagnes</Badge>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1100px]">
               <thead>
                  <tr className="bg-[#F8F9FC] border-b border-[#E9ECF0]">
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Campagne</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Produit Associé</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Période</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-right">Dépenses</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-right">Reach</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-right">Clics</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-center">Ventes</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-right">CA</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-center">ROAS</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-[#E9ECF0]">
                  {isLoadingCampaigns ? (
                    [1,2,3].map(i => (
                      <tr key={i} className="animate-pulse">
                        <td colSpan={9} className="px-6 py-8 bg-[#FAFBFD]/50" />
                      </tr>
                    ))
                  ) : campaigns.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-6 py-16 text-center">
                        <div className="space-y-2">
                          <div className="size-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto">
                            <BarChart3 className="size-6 text-slate-400" />
                          </div>
                          <p className="text-sm font-bold text-slate-400">Aucune campagne disponible</p>
                          <p className="text-xs text-slate-300">Cliquez sur "Synchroniser" pour récupérer vos campagnes Meta Ads</p>
                        </div>
                      </td>
                    </tr>
                  ) : campaigns.map((c: any) => {
                    const isExpanded = expandedCampaign === c.id;
                    const dateStart = c.date_start ? new Date(c.date_start) : null;
                    const dateEnd = c.date_end ? new Date(c.date_end) : null;
                    const durationDays = dateStart && dateEnd ? Math.ceil((dateEnd.getTime() - dateStart.getTime()) / (1000 * 60 * 60 * 24)) : null;
                    const statusColor = c.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : c.status === 'PAUSED' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500';
                    const statusLabel = c.status === 'ACTIVE' ? 'Actif' : c.status === 'PAUSED' ? 'En pause' : (c.status || 'Archivé');
                    return (
                    <React.Fragment key={c.id}>
                      <tr
                        className={cn("transition-colors font-bold text-xs cursor-pointer", isExpanded ? "bg-[#F8F9FC]" : "hover:bg-[#FAFBFD]")}
                        onClick={() => setExpandedCampaign(isExpanded ? null : c.id)}
                      >
                         <td className="px-6 py-5">
                            <div className="flex items-start gap-2">
                              <span className={cn("mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md font-black shrink-0", statusColor)}>{statusLabel}</span>
                              <div>
                                <p className="text-sm font-black text-[#2D3436] tracking-tight leading-tight">{c.campaign_name}</p>
                                <p className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {c.campaign_id || c.id}</p>
                              </div>
                            </div>
                         </td>
                         <td className="px-6 py-5">
                            {linkingCampaign === c.campaign_id ? (
                                <div className="flex flex-col gap-2" onClick={e => e.stopPropagation()}>
                                  <select 
                                    className="text-xs border rounded-lg px-2 py-1.5 bg-white shadow-sm focus:ring-1 focus:ring-[#6C5CE7] outline-none"
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
                                      <p className="text-xs font-black text-slate-700 leading-tight">{c.product_name}</p>
                                      {c.product_sku && <p className="text-[10px] text-slate-400 font-mono">{c.product_sku}</p>}
                                    </div>
                                  </div>
                                  <button onClick={(e) => { e.stopPropagation(); setLinkingCampaign(c.campaign_id); }} className="text-[9px] font-bold text-[#6C5CE7] hover:underline self-start flex items-center gap-1"><Link className="size-2.5" /> Modifier</button>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-2">
                                  <span className="text-[10px] text-slate-400 italic">Non identifié</span>
                                  <button onClick={(e) => { e.stopPropagation(); setLinkingCampaign(c.campaign_id); }} className="text-[9px] font-bold text-[#6C5CE7] hover:underline self-start flex items-center gap-1"><Link className="size-2.5" /> Associer</button>
                                </div>
                              )}
                         </td>
                         <td className="px-6 py-5">
                            <div className="space-y-0.5">
                              {dateStart ? (
                                <>
                                  <p className="text-[11px] font-bold text-slate-600">{dateStart.toLocaleDateString('fr-DZ', { day: '2-digit', month: 'short', year: '2-digit' })}</p>
                                  <p className="text-[10px] text-slate-400">{dateEnd ? `→ ${dateEnd.toLocaleDateString('fr-DZ', { day: '2-digit', month: 'short', year: '2-digit' })}` : '→ En cours'}</p>
                                  {durationDays !== null && <p className="text-[9px] font-black text-slate-400">{durationDays}j de diffusion</p>}
                                </>
                              ) : (
                                <span className="text-[10px] text-slate-300">—</span>
                              )}
                            </div>
                         </td>
                         <td className="px-6 py-5 text-right">
                            <div className="flex flex-col items-end">
                               <span className="text-sm font-black text-[#2D3436] tabular-nums">{formatPrice(c.spend)}</span>
                               {c.currency && c.currency !== 'DZD' && (
                                  <span className="text-[10px] text-slate-400 font-bold tabular-nums">
                                     {c.raw_spend?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {c.currency}
                                  </span>
                               )}
                            </div>
                         </td>
                         <td className="px-6 py-5 text-right text-[#636E72] tabular-nums font-mono">{(c.reach || 0).toLocaleString()}</td>
                         <td className="px-6 py-5 text-right text-[#636E72] tabular-nums font-mono">{(c.clicks || 0).toLocaleString()}</td>
                         <td className="px-6 py-5 text-center">
                            <span className="bg-[#E8F4FE] text-[#0984E3] rounded-md px-2 py-0.5 font-black font-mono">{c.orders_count || 0}</span>
                         </td>
                         <td className="px-6 py-5 text-right font-black font-mono text-[#2D3436] tabular-nums">{formatPrice(c.revenue || 0)}</td>
                         <td className="px-6 py-5 text-center">
                            <Badge className={cn(
                              "border-none rounded-md px-2.5 py-1 text-xs font-black font-mono",
                              (c.roas || 0) >= 4 ? "bg-[#E6FFF8] text-[#00B894]" : (c.roas || 0) >= 2.5 ? "bg-[#E8F4FE] text-[#0984E3]" : "bg-[#FFEDE9] text-[#E17055]"
                            )}>
                              {c.roas || 0}x
                            </Badge>
                         </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-[#F0EDFF]/30">
                          <td colSpan={9} className="px-8 py-5">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              <div className="bg-white rounded-xl p-3 border border-slate-100">
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">CPM</p>
                                <p className="text-sm font-black text-slate-700 mt-1 tabular-nums">{formatPrice(c.cpm || 0)}</p>
                                <p className="text-[9px] text-slate-400">Coût pour 1 000 vues</p>
                              </div>
                              <div className="bg-white rounded-xl p-3 border border-slate-100">
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">CPC</p>
                                <p className="text-sm font-black text-slate-700 mt-1 tabular-nums">{formatPrice(c.cpc || 0)}</p>
                                <p className="text-[9px] text-slate-400">Coût par clic</p>
                              </div>
                              <div className="bg-white rounded-xl p-3 border border-slate-100">
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Impressions</p>
                                <p className="text-sm font-black text-slate-700 mt-1 tabular-nums">{(c.impressions || 0).toLocaleString()}</p>
                                <p className="text-[9px] text-slate-400">Nombre de fois vues</p>
                              </div>
                              <div className="bg-white rounded-xl p-3 border border-slate-100">
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Objectif</p>
                                <p className="text-sm font-black text-slate-700 mt-1">{c.objective || '—'}</p>
                                <p className="text-[9px] text-slate-400">Type de campagne</p>
                              </div>
                            </div>
                            {c.product_name && (
                              <div className="mt-3 flex items-center gap-2 text-[10px] text-[#6C5CE7] font-black">
                                <Package className="size-3" />
                                Attribution : produit «{c.product_name}» identifié {c.product_sku ? `(SKU: ${c.product_sku})` : 'par correspondance du nom de campagne'}
                              </div>
                            )}

                            {/* Per-ad breakdown — this campaign row is Meta's own
                                rollup of every ad underneath it; several
                                split-tested ads under one campaign show up here
                                individually instead of only as one combined
                                total above. */}
                            <div className="mt-4 pt-4 border-t border-[#E9ECF0]">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                                  <Layers className="size-3" /> Détail par publicité
                                </p>
                                {campaignAds.length > 0 && campaignAds[0]?.last_synced_at && (
                                  <p className="text-[9px] text-slate-300 font-bold">
                                    Chiffres Meta au dernier sync — {formatDistanceToNow(new Date(campaignAds[0].last_synced_at), { addSuffix: true, locale: fr })}
                                  </p>
                                )}
                              </div>
                              {isLoadingCampaignAds ? (
                                <div className="animate-pulse h-10 bg-slate-100 rounded-xl" />
                              ) : campaignAds.length === 0 ? (
                                <p className="text-[10px] text-slate-300 italic">Aucun détail par publicité disponible pour cette campagne — resynchronisez pour le récupérer.</p>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left border-collapse min-w-[700px]">
                                    <thead>
                                      <tr>
                                        <th className="px-3 py-2 text-[9px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Publicité</th>
                                        <th className="px-3 py-2 text-[9px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-right">Dépenses</th>
                                        <th className="px-3 py-2 text-[9px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-right">Impressions</th>
                                        <th className="px-3 py-2 text-[9px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-right">Clics</th>
                                        <th className="px-3 py-2 text-[9px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-center">Achats (Meta)</th>
                                        <th className="px-3 py-2 text-[9px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-right">Coût / achat</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#E9ECF0]/60">
                                      {campaignAds.map((ad: any) => (
                                        <tr key={ad.ad_id} className="text-xs font-bold bg-white">
                                          <td className="px-3 py-2.5">
                                            <p className="text-[11px] font-black text-[#2D3436]">{ad.ad_name}</p>
                                            {ad.adset_name && <p className="text-[9px] text-slate-400">{ad.adset_name}</p>}
                                          </td>
                                          <td className="px-3 py-2.5 text-right tabular-nums">{formatPrice(ad.spend)}</td>
                                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 font-mono">{(ad.impressions || 0).toLocaleString()}</td>
                                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 font-mono">{(ad.clicks || 0).toLocaleString()}</td>
                                          <td className="px-3 py-2.5 text-center">
                                            <span className="bg-[#E8F4FE] text-[#0984E3] rounded-md px-2 py-0.5 font-black font-mono">{ad.meta_purchases || 0}</span>
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

      {/* ─── TAB: PRODUITS SPONSORISÉS ─── */}
      {activeTab === 'products' && (
        <div className="space-y-6">
          {/* Info banner */}
          <div className="flex items-start gap-3 p-4 bg-[#F0EDFF] border border-[#6C5CE7]/20 rounded-2xl">
            <Package className="size-4 text-[#6C5CE7] mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-black text-[#6C5CE7]">Comment fonctionne l'attribution produit ?</p>
              <p className="text-[10px] text-[#636E72] mt-1 leading-relaxed">
                Le système analyse vos commandes qui ont un <strong>UTM de campagne</strong> correspondant. Pour chaque commande, il identifie les produits achetés et leur attribue proportionnellement les dépenses pub. Si aucune commande UTM n'est disponible, il cherche le nom du produit dans le titre de la campagne.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-3xl border overflow-hidden shadow-sm">
            <div className="p-6 border-b flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                  <Package className="size-4 text-[#6C5CE7]" /> Produits Sponsorisés — {activeStore?.name || 'Boutique'}
                </h3>
                <p className="text-[10px] text-slate-400 mt-1">Dépenses publicitaires attribuées par produit sur la période sélectionnée</p>
              </div>
              <Badge className="bg-slate-100 text-slate-600 border-none font-black">{productsBreakdown.length} produit(s)</Badge>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[1000px]">
                <thead>
                  <tr className="bg-[#F8F9FC] border-b border-[#E9ECF0]">
                    <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Produit</th>
                    <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Attribution</th>
                    <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-right">Budget Investi</th>
                    <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-right">Impressions</th>
                    <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-right">Clics</th>
                    <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-center">Ventes</th>
                    <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-right">CA Généré</th>
                    <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-center">ROAS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E9ECF0]">
                  {isLoadingCampaigns ? (
                    [1,2,3].map(i => (
                      <tr key={i} className="animate-pulse">
                        <td colSpan={8} className="px-6 py-8 bg-[#FAFBFD]/50" />
                      </tr>
                    ))
                  ) : productsBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-16 text-center">
                        <div className="space-y-2">
                          <div className="size-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto">
                            <Package className="size-6 text-slate-400" />
                          </div>
                          <p className="text-sm font-bold text-slate-400">Aucun produit identifié dans vos campagnes</p>
                          <p className="text-[10px] text-slate-300 leading-relaxed max-w-xs mx-auto">
                            Nommez vos campagnes Meta avec le nom ou le SKU de vos produits, ou assurez-vous que vos commandes ont des UTM configurés.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : productsBreakdown.map((p: any) => {
                    const roas = p.roas || (p.spend > 0 ? p.revenue / p.spend : 0);
                    const hasImage = !!p.product_image;
                    const isUtmBased = (p.orders_count || 0) > 0;
                    return (
                      <tr key={p.product_id} className="hover:bg-[#FAFBFD] transition-colors text-xs">
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
                              <p className="text-sm font-black text-[#2D3436] leading-tight">{p.product_name || 'Produit inconnu'}</p>
                              {p.product_sku && <p className="text-[10px] text-slate-400 font-mono mt-0.5">SKU: {p.product_sku}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <Badge className={cn(
                            "border-none text-[9px] font-black px-2 py-0.5",
                            isUtmBased ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                          )}>
                            {isUtmBased ? '✓ Via commandes UTM' : '~ Par nom campagne'}
                          </Badge>
                        </td>
                        <td className="px-6 py-5 text-right">
                          <div className="flex flex-col items-end">
                            <span className="text-sm font-black text-[#2D3436] tabular-nums">{formatPrice(p.spend || 0)}</span>
                            {p.currency && p.currency !== 'DZD' && (
                              <span className="text-[10px] text-slate-400 font-bold tabular-nums">
                                {p.raw_spend?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {p.currency}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-5 text-right text-[#636E72] tabular-nums font-mono">{(p.impressions || 0).toLocaleString()}</td>
                        <td className="px-6 py-5 text-right text-[#636E72] tabular-nums font-mono">{(p.clicks || 0).toLocaleString()}</td>
                        <td className="px-6 py-5 text-center">
                          <span className="bg-[#E8F4FE] text-[#0984E3] rounded-md px-2 py-0.5 font-black font-mono">{p.orders_count || 0}</span>
                        </td>
                        <td className="px-6 py-5 text-right font-black font-mono text-[#2D3436] tabular-nums">{formatPrice(p.revenue || 0)}</td>
                        <td className="px-6 py-5 text-center">
                          <Badge className={cn(
                            "border-none rounded-md px-2.5 py-1 text-xs font-black font-mono",
                            roas >= 4 ? "bg-[#E6FFF8] text-[#00B894]" : roas >= 2.5 ? "bg-[#E8F4FE] text-[#0984E3]" : "bg-[#FFEDE9] text-[#E17055]"
                          )}>
                            {roas.toFixed(2)}x
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB: ENTONNOIR DE CONVERSION ─── */}
      {activeTab === 'funnel' && (
        <div className="space-y-6">
          {/* Funnel header banner */}
          <div className="flex items-start gap-3 p-5 bg-[#F0EDFF] border border-[#6C5CE7]/15 rounded-3xl">
            <Activity className="size-5 text-[#6C5CE7] mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-black text-[#6C5CE7]">Entonnoir de Conversion & Efficacité Publicitaire</p>
              <p className="text-xs text-[#636E72] mt-1 leading-relaxed">
                Suivez la déperdition des utilisateurs à chaque étape clé du processus de vente. Cet entonnoir croise les signaux Meta Ads (Impressions, Clics) avec l'activité réelle de votre boutique (Vues de page, Paiements initiés, Achats) pour vous donner une vision claire de votre taux d'attribution et de conversion.
              </p>
            </div>
          </div>

          {isLoadingFunnel ? (
            <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-slate-100 shadow-sm">
              <RefreshCw className="size-8 text-[#6C5CE7] animate-spin" />
              <p className="text-xs text-slate-400 mt-3 font-bold">Calcul de l'entonnoir en cours...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Funnel visualization */}
              <div className="lg:col-span-2 bg-white rounded-3xl border p-6 shadow-sm flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5 mb-6 text-[#2D3436]">
                    <Layers className="size-4 text-[#6C5CE7]" /> Visualisation de l'entonnoir
                  </h3>
                  <div className="space-y-4">
                    {funnelData?.stages?.map((stage: any, idx: number) => {
                      // Width percentage for visual presentation
                      const prevStageCount = idx > 0 ? funnelData.stages[idx - 1].count : stage.count;
                      const ratioOfPrevious = idx === 0 ? 100 : (prevStageCount > 0 ? (stage.count / prevStageCount) * 100 : 0);
                      const ratioOfTotal = funnelData.stages[0].count > 0 ? (stage.count / funnelData.stages[0].count) * 100 : 0;
                      
                      // Funnel block style
                      const funnelWidths = [100, 90, 80, 70, 60, 50, 40];
                      const currentWidth = funnelWidths[idx] || 35;
                      
                      // Gradients for stages
                      const gradients = [
                        "from-[#1877F2] to-[#3b5998]", // Impressions (Facebook blue)
                        "from-[#0984E3] to-[#74b9ff]", // Clics
                        "from-[#6C5CE7] to-[#a29bfe]", // Vues
                        "from-[#E84393] to-[#fd79a8]", // Checkout
                        "from-[#00B894] to-[#55efc4]", // Purchase
                        "from-[#F1C40F] to-[#FFEAA7]", // Recovered
                        "from-[#00CEC9] to-[#81ECEC]"  // Delivered
                      ];
                      
                      return (
                        <div key={idx} className="flex items-center gap-4">
                          <div className="w-40 shrink-0 text-left">
                            <p className="text-xs font-black text-slate-700 leading-tight">{stage.name}</p>
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">{stage.count.toLocaleString()}</p>
                          </div>
                          
                          <div className="flex-1">
                            <div className="h-9 w-full bg-slate-50 rounded-xl relative overflow-hidden flex items-center">
                              {/* Colored Funnel Segment */}
                              <div
                                style={{ width: `${currentWidth}%` }}
                                className={cn(
                                  "h-full rounded-r-xl bg-gradient-to-r flex items-center justify-end pr-4 transition-all duration-500",
                                  gradients[idx] || "from-slate-400 to-slate-500"
                                )}
                              >
                                {stage.count > 0 && (
                                  <span className="text-[10px] font-black text-white font-mono">
                                    {ratioOfTotal.toFixed(1)}%
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          
                          <div className="w-20 shrink-0 text-right font-mono">
                            {idx > 0 && (
                              <div className="text-xs font-black text-slate-600">
                                {ratioOfPrevious.toFixed(1)}%
                                <p className="text-[8px] font-black uppercase text-slate-400">vs préc.</p>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t flex items-center justify-between text-[10px] text-slate-400 font-bold">
                  <span className="flex items-center gap-1"><AlertCircle className="size-3 text-amber-500" /> Taux calculés sur la base des 30 derniers jours d'activité.</span>
                </div>
              </div>

              {/* Conversion Statistics & Recommendations */}
              <div className="space-y-6">
                {/* Funnel Metrics */}
                <div className="bg-white rounded-3xl border p-6 shadow-sm space-y-4">
                  <h3 className="text-sm font-black uppercase tracking-wider text-[#2D3436]">Statistiques Clés</h3>
                  
                  <div className="space-y-3">
                    <div className="p-3 bg-slate-50 rounded-xl flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Taux de clic (CTR)</p>
                        <p className="text-lg font-black text-[#2D3436] mt-0.5 font-mono">{funnelData?.summary?.ctr}%</p>
                      </div>
                      <Badge className={cn("border-none rounded-md px-2 py-0.5 text-[10px] font-black",
                        (funnelData?.summary?.ctr || 0) >= 2 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                      )}>
                        {(funnelData?.summary?.ctr || 0) >= 2 ? "Excellent" : "Améliorer"}
                      </Badge>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Taux de conversion (CR)</p>
                        <p className="text-lg font-black text-[#2D3436] mt-0.5 font-mono">{funnelData?.summary?.cr}%</p>
                      </div>
                      <Badge className={cn("border-none rounded-md px-2 py-0.5 text-[10px] font-black",
                        (funnelData?.summary?.cr || 0) >= 3 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                      )}>
                        {(funnelData?.summary?.cr || 0) >= 3 ? "Rentable" : "Améliorer"}
                      </Badge>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Taux de livraison (Delivered)</p>
                        <p className="text-lg font-black text-[#2D3436] mt-0.5 font-mono">{funnelData?.summary?.delivery_rate}%</p>
                      </div>
                      <Badge className={cn("border-none rounded-md px-2 py-0.5 text-[10px] font-black",
                        (funnelData?.summary?.delivery_rate || 0) >= 70 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                      )}>
                        {(funnelData?.summary?.delivery_rate || 0) >= 70 ? "Excellente" : "Améliorer"}
                      </Badge>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl flex items-center justify-between"
                      title="Vues de page de destination ÷ Clics sur un lien (définition standard Meta) — mesure la vitesse/fiabilité réelle du site, pas la conversion. Absent si aucun clic Meta sur la période.">
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Qualité du site</p>
                        <p className="text-lg font-black text-[#2D3436] mt-0.5 font-mono">{funnelData?.summary?.qualite_site_pct != null ? `${funnelData.summary.qualite_site_pct}%` : '—'}</p>
                      </div>
                      {funnelData?.summary?.qualite_site_pct != null && (
                        <Badge className={cn("border-none rounded-md px-2 py-0.5 text-[10px] font-black",
                          funnelData.summary.qualite_site_pct >= 70 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                        )}>
                          {funnelData.summary.qualite_site_pct >= 70 ? "Bonne" : "Améliorer"}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                {/* Recommendations */}
                <div className="bg-[#FAF9F5] border border-amber-200 rounded-3xl p-6 space-y-4">
                  <h4 className="text-xs font-black uppercase text-amber-800 tracking-wider flex items-center gap-1.5">
                    <Sparkles className="size-3.5" /> Recommandations d'Attribution
                  </h4>
                  <ul className="space-y-3">
                    <li className="text-[10px] text-amber-900 leading-relaxed">
                      <strong>Optimisation CAPI :</strong> Vos événements Pixel et CAPI sont liés à 100% via le paramètre <code>event_id</code>, garantissant une déduplication parfaite.
                    </li>
                    <li className="text-[10px] text-amber-900 leading-relaxed">
                      <strong>Qualité du pixel :</strong> Envoyez le maximum de données clients autorisées (téléphone sans le <code>+</code>, pays <code>co</code> de deux lettres en minuscules) pour optimiser le matching publicitaire.
                    </li>
                    <li className="text-[10px] text-amber-900 leading-relaxed">
                      <strong>Taux de déperdition :</strong> Si le passage de <em>Clics</em> à <em>Vues de Page</em> est inférieur à 70%, vérifiez le temps de chargement de la boutique ou les redirections.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB: DIAGNOSTICS ─── */}
      {activeTab === 'diagnostics' && (
        <div className="space-y-4">
          {/* ─── Widget Qualité du Tracking — temps réel/backfill, Match
              Quality, note globale. Intégré ici plutôt que dans un nouveau
              module : cette section EST le centre de pilotage tracking
              demandé, à l'intérieur de Meta Ads & ROAS. ─── */}
          <div className="bg-white rounded-3xl border shadow-sm p-6">
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="size-4 text-[#6C5CE7]" /> Qualité du Tracking
                </h3>
                <p className="text-[10px] text-slate-400 mt-1">ERP ↔ Meta, temps réel vs rattrapage, complétude des signaux envoyés.</p>
              </div>
              {trackingQuality?.tracking_score != null && (
                <div className="text-right shrink-0">
                  <p className={cn(
                    'text-2xl font-black leading-none',
                    trackingQuality.tracking_score >= 90 ? 'text-[#00B894]' : trackingQuality.tracking_score >= 70 ? 'text-[#FDCB6E]' : 'text-[#E17055]'
                  )}>{trackingQuality.tracking_score}<span className="text-xs text-slate-300">/100</span></p>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-0.5">Tracking Score</p>
                </div>
              )}
            </div>

            {isLoadingTrackingQuality ? (
              <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement…</div>
            ) : !trackingQuality ? (
              <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Aucune donnée sur cette période.</div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {[
                    { label: 'Commandes ERP', value: trackingQuality.erp_purchases, color: '#0984E3' },
                    { label: 'Reçus par Meta', value: trackingQuality.meta_purchases, color: '#00B894' },
                    { label: 'Couverture', value: `${trackingQuality.coverage_pct}%`, color: trackingQuality.coverage_pct >= 95 ? '#00B894' : '#FDCB6E' },
                    { label: 'Match Quality moy.', value: trackingQuality.avg_match_quality != null ? `${trackingQuality.avg_match_quality}%` : '—', color: '#6C5CE7' },
                  ].map(s => (
                    <div key={s.label} className="text-center p-3 rounded-2xl border bg-white" style={{ borderColor: s.color + '33' }}>
                      <p className="text-lg font-black tabular-nums" style={{ color: s.color }}>{s.value}</p>
                      <p className="text-[9px] font-bold uppercase tracking-wider mt-0.5 text-slate-400">{s.label}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  {[
                    { label: 'Temps réel', value: trackingQuality.realtime, color: '#00B894' },
                    { label: 'Rattrapage (Backfill)', value: trackingQuality.backfill, color: '#FDCB6E' },
                    { label: 'En attente', value: trackingQuality.pending, color: '#0984E3' },
                    { label: 'Échecs', value: trackingQuality.failed, color: trackingQuality.failed > 0 ? '#E17055' : '#B2BEC3' },
                  ].map(s => (
                    <div key={s.label} className="text-center p-2.5 rounded-xl bg-slate-50">
                      <p className="text-sm font-black tabular-nums" style={{ color: s.color }}>{s.value}</p>
                      <p className="text-[8px] font-bold uppercase tracking-wider mt-0.5 text-slate-400">{s.label}</p>
                    </div>
                  ))}
                </div>

                {trackingQuality.ecart_reel > 0 && (
                  <div className="p-3 mb-4 rounded-xl bg-[#FFF8E6] border border-[#FDCB6E]/30 text-[11px] text-slate-600">
                    <strong className="text-slate-700">{trackingQuality.ecart_reel} commande(s)</strong> pas encore bien transmise(s) à Meta —
                    {trackingQuality.pending > 0 && ` ${trackingQuality.pending} en attente`}
                    {trackingQuality.pending > 0 && trackingQuality.failed > 0 && ', '}
                    {trackingQuality.failed > 0 && ` ${trackingQuality.failed} en échec (voir Achats/Bons d'Achat pour relancer)`}.
                  </div>
                )}

                {trackingQuality.recommendations?.length > 0 && (
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Recommandations</p>
                    <div className="space-y-1.5">
                      {trackingQuality.recommendations.map((r: string, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-[11px] text-slate-600 p-2 rounded-lg bg-slate-50">
                          <span>{r.startsWith('Aucune') ? '✅' : '💡'}</span>
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="bg-white rounded-3xl border shadow-sm p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                  <AlertCircle className="size-4 text-[#E17055]" /> Diagnostics Meta Events
                </h3>
                <p className="text-[10px] text-slate-400 mt-1">Suivi des événements relayés, du matching pixel/CAPI et des erreurs récentes par boutique.</p>
              </div>
              <Badge className="bg-slate-100 text-slate-600 border-none font-black">{diagnosticsSummary.total_events || 0} événements</Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              <div className="rounded-2xl border bg-[#F8F9FC] p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Événements réussis</p>
                <p className="text-2xl font-black text-[#2D3436] mt-1">{diagnosticsSummary.successful_events || 0}</p>
              </div>
              <div className="rounded-2xl border bg-[#F8F9FC] p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Événements échoués</p>
                <p className="text-2xl font-black text-[#E17055] mt-1">{diagnosticsSummary.failed_events || 0}</p>
              </div>
              <div className="rounded-2xl border bg-[#F8F9FC] p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Événements suivis</p>
                <p className="text-2xl font-black text-[#2D3436] mt-1">{diagnosticsEvents.length}</p>
              </div>
            </div>
            {isLoadingDiagnostics ? (
              <div className="mt-6 rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement des diagnostics…</div>
            ) : diagnosticsEvents.length === 0 ? (
              <div className="mt-6 rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Aucun événement n’a encore été relayé pour cette boutique.</div>
            ) : (
              <div className="mt-6 overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead>
                    <tr className="bg-[#F8F9FC] border-b border-[#E9ECF0]">
                      <th className="px-4 py-3 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Événement</th>
                      <th className="px-4 py-3 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Qualité</th>
                      <th className="px-4 py-3 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Statut</th>
                      <th className="px-4 py-3 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Dernier envoi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E9ECF0]">
                    {diagnosticsEvents.map((event: any, index: number) => (
                      <tr key={`${event.event_name}-${index}`} className="hover:bg-[#FAFBFD] transition-colors text-sm">
                        <td className="px-4 py-3 font-semibold text-slate-700">{event.event_name}</td>
                        <td className="px-4 py-3 font-semibold text-slate-700">{event.match_quality || 0}%</td>
                        <td className="px-4 py-3">
                          <Badge className={cn(
                            'border-none rounded-md px-2 py-0.5 text-[10px] font-black',
                            event.failures ? 'bg-[#FFEDE9] text-[#E17055]' : 'bg-[#E6FFF8] text-[#00B894]'
                          )}>
                            {event.failures ? 'À vérifier' : 'OK'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{event.last_successful_send || event.last_failure || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB: SIGNAL QUALITY CENTER — Learning Score, EMQ, temps réel/
          backfill, dédup, latence, attribution, Circuit Breaker, Retry
          Queue, KPI Validation, recommandations, anomalies détectées. ─── */}
      {activeTab === 'quality' && (
        <div className="space-y-4">
          {/* Learning Score + Signal Score */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-3xl border shadow-sm p-6">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                    <Zap className="size-4 text-[#6C5CE7]" /> Learning Score
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1">Score global de qualité des signaux envoyés à Meta.</p>
                </div>
              </div>
              {isLoadingSignalQuality ? (
                <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement…</div>
              ) : signalQuality?.learning_score ? (
                <div className="flex items-center gap-6">
                  <div className="text-center shrink-0">
                    <p className={cn(
                      'text-4xl font-black leading-none tabular-nums',
                      signalQuality.learning_score.score >= 90 ? 'text-[#00B894]' : signalQuality.learning_score.score >= 55 ? 'text-[#FDCB6E]' : 'text-[#E17055]'
                    )}>{signalQuality.learning_score.score}<span className="text-sm text-slate-300">/100</span></p>
                    <Badge className={cn(
                      "border-none rounded-md px-1.5 py-0.5 text-[9px] font-black mt-1.5",
                      signalQuality.meta_health?.label === 'Excellent' || signalQuality.meta_health?.label === 'Bon' ? "bg-[#E6FFF8] text-[#00B894]" : "bg-[#FFF8E6] text-[#FDCB6E]"
                    )}>{signalQuality.meta_health?.label || '—'}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 flex-1">
                    {[
                      { label: 'Temps réel', value: `${signalQuality.learning_score.realtime_pct ?? '—'}%`, sub: `${signalQuality.learning_score.realtime_count ?? 0}` },
                      { label: 'Backfill', value: `${signalQuality.learning_score.backfill_pct ?? '—'}%`, sub: `${signalQuality.learning_score.backfill_count ?? 0}` },
                      { label: 'Déduplication', value: signalQuality.learning_score.dedup_pct != null ? `${signalQuality.learning_score.dedup_pct}%` : '—', sub: 'event_id' },
                      { label: 'Attribution', value: signalQuality.learning_score.attribution_pct != null ? `${signalQuality.learning_score.attribution_pct}%` : '—', sub: 'campagne connue' },
                    ].map(s => (
                      <div key={s.label} className="text-center p-2.5 rounded-xl bg-slate-50">
                        <p className="text-sm font-black tabular-nums text-slate-700">{s.value}</p>
                        <p className="text-[8px] font-bold uppercase tracking-wider mt-0.5 text-slate-400">{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Aucune donnée sur cette période.</div>
              )}
            </div>

            <div className="bg-white rounded-3xl border shadow-sm p-6">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                    <CheckCircle className="size-4 text-[#0984E3]" /> Event Match Quality (EMQ)
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1">Complétude des champs envoyés (téléphone, FBP, FBC, IP, User-Agent…).</p>
                </div>
                {signalQuality?.avg_emq != null && (
                  <div className="text-right shrink-0">
                    <p className={cn(
                      'text-2xl font-black leading-none',
                      signalQuality.avg_emq >= 80 ? 'text-[#00B894]' : signalQuality.avg_emq >= 55 ? 'text-[#FDCB6E]' : 'text-[#E17055]'
                    )}>{signalQuality.avg_emq}%</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-0.5">{signalQuality.emq_sample_size} échantillon(s)</p>
                  </div>
                )}
              </div>
              {isLoadingSignalQuality ? (
                <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement…</div>
              ) : Array.isArray(signalQuality?.field_coverage) && signalQuality.field_coverage.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {signalQuality.field_coverage.map((f: any) => (
                    <div key={f.key} className="flex items-center justify-between text-[11px] p-2 rounded-lg bg-slate-50">
                      <span className="text-slate-600 font-semibold">{f.label}</span>
                      {f.classification === 'not_applicable' ? (
                        <span className="font-bold text-[10px] text-slate-400 uppercase tracking-wider" title="Ce champ n'est pas collecté sur un tunnel COD — son absence n'est pas un défaut.">Non applicable</span>
                      ) : (
                        <span className={cn(
                          'font-black tabular-nums',
                          f.coverage_pct >= 80 ? 'text-[#00B894]' : f.coverage_pct >= 40 ? 'text-[#FDCB6E]' : 'text-[#E17055]'
                        )}>{f.coverage_pct != null ? `${f.coverage_pct}%` : '—'}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Aucune donnée sur cette période.</div>
              )}
            </div>
          </div>

          {/* Circuit Breaker + Retry Queue */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-3xl border shadow-sm p-6">
              <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5 mb-4">
                <Activity className="size-4 text-[#6C5CE7]" /> Circuit Breaker
              </h3>
              {isLoadingMetaHealth ? (
                <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement…</div>
              ) : metaHealthData?.circuit_breaker ? (
                <div className="space-y-3">
                  <Badge className={cn(
                    "border-none rounded-md px-2 py-1 text-[10px] font-black",
                    metaHealthData.circuit_breaker.is_open ? "bg-[#FFEDE9] text-[#E17055]" : "bg-[#E6FFF8] text-[#00B894]"
                  )}>
                    {metaHealthData.circuit_breaker.is_open ? 'OUVERT — envois suspendus' : 'FERMÉ — envois normaux'}
                  </Badge>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Échecs consécutifs', value: metaHealthData.circuit_breaker.consecutive_failures },
                      { label: 'Seuil', value: metaHealthData.circuit_breaker.threshold },
                      { label: 'Reprise dans', value: metaHealthData.circuit_breaker.is_open ? `${metaHealthData.circuit_breaker.seconds_until_reset}s` : '—' },
                    ].map(s => (
                      <div key={s.label} className="text-center p-2.5 rounded-xl bg-slate-50">
                        <p className="text-sm font-black tabular-nums text-slate-700">{s.value}</p>
                        <p className="text-[8px] font-bold uppercase tracking-wider mt-0.5 text-slate-400">{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Indisponible.</div>
              )}
            </div>

            <div className="bg-white rounded-3xl border shadow-sm p-6">
              <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5 mb-4">
                <RefreshCw className="size-4 text-[#FDCB6E]" /> Retry Queue
              </h3>
              {isLoadingFullDiagnostics ? (
                <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement…</div>
              ) : fullDiagnostics?.queue ? (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'En attente (global)', value: fullDiagnostics.queue.pending_count, color: fullDiagnostics.queue.pending_count > 0 ? '#FDCB6E' : '#00B894' },
                    { label: `Échecs définitifs (${fullDiagnostics.queue.failed_count_window || '7j'})`, value: fullDiagnostics.queue.failed_count, color: fullDiagnostics.queue.failed_count > 0 ? '#E17055' : '#00B894', hint: fullDiagnostics.queue.failed_count_all_time != null ? `${fullDiagnostics.queue.failed_count_all_time} au total (toutes périodes)` : undefined },
                    { label: 'Latence moy.', value: fullDiagnostics.queue.avg_latency_ms != null ? `${fullDiagnostics.queue.avg_latency_ms}ms` : '—', color: '#6C5CE7' },
                    { label: 'Latence P95', value: fullDiagnostics.queue.p95_latency_ms != null ? `${fullDiagnostics.queue.p95_latency_ms}ms` : '—', color: '#0984E3' },
                  ].map((s: any) => (
                    <div key={s.label} className="text-center p-2.5 rounded-xl bg-slate-50" title={s.hint || undefined}>
                      <p className="text-sm font-black tabular-nums" style={{ color: s.color }}>{s.value}</p>
                      <p className="text-[8px] font-bold uppercase tracking-wider mt-0.5 text-slate-400">{s.label}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Indisponible.</div>
              )}
            </div>
          </div>

          {/* Réconciliation Meta ↔ ERP — explique l'écart "Meta affiche +N" */}
          {fullDiagnostics?.reconciliation && (
            <div className="bg-white rounded-3xl border shadow-sm p-6">
              <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5 mb-1">
                <CheckCircle className="size-4 text-[#0984E3]" /> Réconciliation Meta ↔ ERP (30j)
              </h3>
              <p className="text-[10px] text-slate-400 mb-4">Pourquoi Meta peut afficher plus de Purchase que le nombre réel de commandes — chaque écart est expliqué, jamais mystérieux.</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                {[
                  { label: 'Commandes réelles ERP', value: fullDiagnostics.reconciliation.erp_real_orders, color: '#0984E3' },
                  { label: 'Purchase comptés Meta', value: fullDiagnostics.reconciliation.meta_purchase_success, color: '#6C5CE7' },
                  { label: 'Fusionnés après envoi', value: fullDiagnostics.reconciliation.merged_after_send, color: '#FDCB6E' },
                  { label: 'Orphelins (relais)', value: fullDiagnostics.reconciliation.orphan_no_order, color: '#B2BEC3' },
                ].map((s: any) => (
                  <div key={s.label} className="text-center p-3 rounded-2xl border bg-white" style={{ borderColor: s.color + '33' }}>
                    <p className="text-lg font-black tabular-nums" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-[9px] font-bold uppercase tracking-wider mt-0.5 text-slate-400">{s.label}</p>
                  </div>
                ))}
              </div>
              {fullDiagnostics.reconciliation.unexplained_gap === 0 ? (
                <div className="rounded-xl bg-[#E6FFF8] border border-[#00B894]/20 p-3 text-[11px] text-[#00B894] font-semibold">
                  ✅ Écart entièrement expliqué : les {fullDiagnostics.reconciliation.explained_gap} Purchase Meta en trop = commandes fusionnées après l'envoi + orphelins relais. Aucun écart inexpliqué.
                </div>
              ) : (
                <div className="rounded-xl bg-[#FFF8E6] border border-[#FDCB6E]/30 p-3 text-[11px] text-slate-700 font-semibold">
                  ⚠️ {fullDiagnostics.reconciliation.unexplained_gap} Purchase inexpliqué(s) — à investiguer via l'audit de réconciliation SQL.
                </div>
              )}
            </div>
          )}

          {/* Attribuabilité réelle — sépare "commandes que Meta peut
              attribuer" (clic pub valide) de "commandes qui ne le pourront
              jamais" (organique/direct, ou fbc corrompu) — l'écart ERP↔Meta
              n'est plus mystérieux : il devient une limite physique visible. */}
          {fullDiagnostics?.attribution_readiness && (
            <div className="bg-white rounded-3xl border shadow-sm p-6">
              <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5 mb-1">
                <Target className="size-4 text-[#00B894]" /> Attribuabilité réelle (30j)
              </h3>
              <p className="text-[10px] text-slate-400 mb-4">Seules les commandes avec un clic publicitaire valide peuvent être attribuées par Meta — le reste ne pourra jamais l'être, quelle que soit la configuration.</p>

              {/* Score prédictif — calculable AVANT l'envoi, contrairement à
                  l'EMQ qui note ce que Meta a déjà reçu. Répond directement
                  à "Meta aura-t-il de bonnes chances d'attribuer ce
                  Purchase ?" au lieu d'un simple score de matching. */}
              {typeof fullDiagnostics.attribution_readiness.predictive_score === 'number' && (
                <div className="mb-5 p-5 rounded-2xl border bg-gradient-to-br from-[#00B894]/5 to-transparent flex items-center gap-5" style={{ borderColor: '#00B89433' }}>
                  <div className="relative size-20 shrink-0">
                    <svg viewBox="0 0 36 36" className="size-20 -rotate-90">
                      <circle cx="18" cy="18" r="15.5" fill="none" stroke="#E2E8F0" strokeWidth="3" />
                      <circle
                        cx="18" cy="18" r="15.5" fill="none"
                        stroke={fullDiagnostics.attribution_readiness.predictive_score >= 80 ? '#00B894' : fullDiagnostics.attribution_readiness.predictive_score >= 50 ? '#FDCB6E' : '#E17055'}
                        strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={`${fullDiagnostics.attribution_readiness.predictive_score / 100 * 97.4} 97.4`}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-lg font-black text-slate-800">{fullDiagnostics.attribution_readiness.predictive_score}%</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-slate-700">Attribution Readiness</p>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-md">
                      Calculé à partir de fbc valide, fbp, téléphone, external_id, IP, user agent, event_time, value, currency, event_id —
                      avant même l'envoi, indique si Meta aura de bonnes chances d'attribuer l'achat. Plus parlant que l'EMQ seul, qui ne mesure que le matching utilisateur.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                {[
                  { label: 'Attribuables (fbc valide)', value: fullDiagnostics.attribution_readiness.attributable_valid_fbc, color: '#00B894' },
                  { label: 'fbc corrompu (à corriger)', value: fullDiagnostics.attribution_readiness.malformed_fbc_unfixable_client_side, color: '#E17055' },
                  { label: 'Organique/direct (normal)', value: fullDiagnostics.attribution_readiness.no_ad_click_signal_organic_direct, color: '#B2BEC3' },
                ].map((s: any) => (
                  <div key={s.label} className="text-center p-3 rounded-2xl border bg-white" style={{ borderColor: s.color + '33' }}>
                    <p className="text-lg font-black tabular-nums" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-[9px] font-bold uppercase tracking-wider mt-0.5 text-slate-400">{s.label}</p>
                  </div>
                ))}
              </div>
              {fullDiagnostics.attribution_readiness.malformed_fbc_unfixable_client_side > 0 ? (
                <div className="rounded-xl bg-[#FFF8E6] border border-[#FDCB6E]/30 p-3 text-[11px] text-slate-700 font-semibold">
                  ⚠️ {fullDiagnostics.attribution_readiness.malformed_fbc_unfixable_client_side} commande(s) ont un fbc mal formé — Meta accepte l'événement sans erreur mais ne peut jamais l'attribuer. Ce sont d'anciennes commandes (avant le correctif de format fbc) ; les nouvelles commandes ne devraient plus jamais tomber dans cette catégorie.
                </div>
              ) : (
                <div className="rounded-xl bg-[#E6FFF8] border border-[#00B894]/20 p-3 text-[11px] text-[#00B894] font-semibold">
                  ✅ Aucun fbc corrompu — toutes les commandes avec un signal de clic publicitaire ont un fbc structurellement valide, donc attribuable côté Meta.
                </div>
              )}
            </div>
          )}

          {/* Recommandations automatiques */}
          <div className="bg-white rounded-3xl border shadow-sm p-6">
            <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5 mb-4">
              <Sparkles className="size-4 text-[#6C5CE7]" /> Recommandations automatiques
            </h3>
            {isLoadingSignalQuality ? (
              <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement…</div>
            ) : Array.isArray(signalQuality?.recommendations) && signalQuality.recommendations.length > 0 ? (
              <div className="space-y-2">
                {signalQuality.recommendations.map((r: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] text-slate-600 p-3 rounded-xl bg-slate-50">
                    <span className="text-amber-500 tracking-tighter shrink-0">{r.stars || '★★★☆☆'}</span>
                    <div className="flex-1">
                      <p className="font-semibold text-slate-700">{r.action || String(r)}</p>
                      <p className="text-slate-500 mt-0.5">
                        {r.category === 'event_match_quality_field' ? 'Champ EMQ' : 'Composant Learning Score'}
                        {r.current != null && ` — actuellement ${r.current}%`}
                        {r.gain_points != null && ` · gain estimé +${r.gain_points} pts`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Aucune recommandation pour l'instant — signaux en bonne santé.</div>
            )}
          </div>

          {/* Problèmes détectés (anomalies) */}
          <div className="bg-white rounded-3xl border shadow-sm p-6">
            <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5 mb-4">
              <AlertCircle className="size-4 text-[#E17055]" /> Problèmes détectés
            </h3>
            {isLoadingSignalQuality ? (
              <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement…</div>
            ) : Array.isArray(signalQuality?.anomalies) && signalQuality.anomalies.length > 0 ? (
              <div className="space-y-2">
                {signalQuality.anomalies.map((a: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] p-3 rounded-xl bg-slate-50">
                    <Badge className={cn(
                      "border-none rounded-md px-1.5 py-0.5 text-[9px] font-black shrink-0",
                      a.severity === 'high' ? "bg-[#FFEDE9] text-[#E17055]" : a.severity === 'medium' ? "bg-[#FFF8E6] text-[#FDCB6E]" : "bg-slate-200 text-slate-600"
                    )}>{a.type}</Badge>
                    <div>
                      <p className="text-slate-700">{a.detail}</p>
                      {a.fix && <p className="text-slate-400 mt-0.5">{a.fix}</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border bg-[#E6FFF8] p-6 text-sm text-[#00B894] font-semibold">✅ Aucune anomalie détectée (event_id dupliqués, valeur/devise manquante, FBP/FBC absents…).</div>
            )}
          </div>

          {/* KPI Validation */}
          <div className="bg-white rounded-3xl border shadow-sm p-6">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                <CheckCircle className="size-4 text-[#6C5CE7]" /> KPI Validation
              </h3>
              {kpiValidation && (
                <Badge className={cn(
                  "border-none rounded-md px-2 py-1 text-[10px] font-black",
                  kpiValidation.all_passed ? "bg-[#E6FFF8] text-[#00B894]" : "bg-[#FFEDE9] text-[#E17055]"
                )}>
                  {kpiValidation.all_passed ? 'Tous les invariants passent' : 'Divergence détectée'}
                </Badge>
              )}
            </div>
            <p className="text-[10px] text-slate-400 mb-4">Vérifie que les chiffres affichés respectent leurs relations mathématiques attendues — recalculés indépendamment.</p>
            {isLoadingKpiValidation ? (
              <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement…</div>
            ) : Array.isArray(kpiValidation?.checks) && kpiValidation.checks.length > 0 ? (
              <div className="space-y-2">
                {kpiValidation.checks.map((c: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] p-3 rounded-xl bg-slate-50">
                    <span>{c.passed ? '✅' : '❌'}</span>
                    <div>
                      <p className="font-semibold text-slate-700">{c.name}</p>
                      <p className="text-slate-500 mt-0.5">{c.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Aucune donnée sur cette période.</div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB: EVENT REGISTRY — source de vérité unique ─── */}
      {activeTab === 'registry' && (
        <div className="space-y-4">
          {/* Instrumentation volume/coût par évènement — mesure demandée
              avant toute décision de retirer PageView/AddToWishlist du
              miroir CAPI, pas une hypothèse. */}
          <div className="bg-white rounded-3xl border shadow-sm p-6">
            <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5 mb-1">
              <Activity className="size-4 text-[#6C5CE7]" /> Volume & coût par évènement (période sélectionnée)
            </h3>
            <p className="text-[10px] text-slate-400 mb-4">Le volume CAPI est un proxy fiable du volume Pixel (chaque déclenchement Pixel actuel tente un miroir CAPI par défaut). L'usage réel dans le Learning Meta n'est jamais mesurable depuis notre système — jamais inventé ici.</p>
            {isLoadingVolumeByEvent ? (
              <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement…</div>
            ) : Array.isArray(volumeByEventData?.data) && volumeByEventData.data.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="py-2 pr-4 font-black text-slate-400 uppercase tracking-wider text-[10px]">Évènement</th>
                      <th className="py-2 pr-4 font-black text-slate-400 uppercase tracking-wider text-[10px]">Volume CAPI</th>
                      <th className="py-2 pr-4 font-black text-slate-400 uppercase tracking-wider text-[10px]">Succès</th>
                      <th className="py-2 pr-4 font-black text-slate-400 uppercase tracking-wider text-[10px]">Latence moy.</th>
                      <th className="py-2 pr-4 font-black text-slate-400 uppercase tracking-wider text-[10px]">event_id uniques</th>
                      <th className="py-2 font-black text-slate-400 uppercase tracking-wider text-[10px]">Usage Learning Meta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {volumeByEventData.data.map((e: any) => (
                      <tr key={e.event_name} className="border-b border-slate-50 last:border-0">
                        <td className="py-2.5 pr-4 font-bold text-slate-800">{e.event_name}</td>
                        <td className="py-2.5 pr-4 tabular-nums font-bold">{e.capi_attempts_total}</td>
                        <td className="py-2.5 pr-4 tabular-nums">{e.capi_success_rate_pct != null ? `${e.capi_success_rate_pct}%` : '—'}</td>
                        <td className="py-2.5 pr-4 tabular-nums">{e.avg_latency_ms != null ? `${e.avg_latency_ms}ms` : '—'}</td>
                        <td className="py-2.5 pr-4 tabular-nums">{e.unique_event_ids}</td>
                        <td className="py-2.5 text-[10px] text-slate-400 italic">{e.meta_learning_usage}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Aucune donnée sur cette période.</div>
            )}
          </div>

          {/* Registre central — chaque ligne = un évènement envoyé, avec son
              parcours publicitaire complet et son statut de synchronisation/
              déduplication. C'est la source de vérité : tout autre chiffre du
              dashboard doit pouvoir remonter jusqu'ici. */}
          <div className="bg-white rounded-3xl border shadow-sm p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="size-4 text-[#00B894]" /> Registre d'évènements
              </h3>
              <span className="text-[10px] font-bold text-slate-400">{registryData?.total ?? 0} évènement{(registryData?.total ?? 0) > 1 ? 's' : ''} — période sélectionnée en haut de page</span>
            </div>

            {/* Barre de filtres complète — indispensable dès que le volume
                dépasse quelques centaines de lignes (audit de production
                2026-07-21). Chaque champ déclenche un filtre SQL côté
                serveur, jamais un filtrage côté client sur la page chargée. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-4">
              <select value={registryEventFilter} onChange={e => { setRegistryEventFilter(e.target.value); setRegistryPage(1); }} className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-3">
                <option value="">Tous les évènements</option>
                {['PageView', 'ViewContent', 'AddToWishlist', 'AddToCart', 'InitiateCheckout', 'Purchase'].map(ev => (
                  <option key={ev} value={ev}>{ev}</option>
                ))}
              </select>
              <select value={registrySourceFilter} onChange={e => { setRegistrySourceFilter(e.target.value); setRegistryPage(1); }} className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-3">
                <option value="">Toutes les sources</option>
                <option value="capi_only">CAPI uniquement</option>
                <option value="pixel_capi">Pixel + CAPI</option>
              </select>
              <select value={registryDedupFilter} onChange={e => { setRegistryDedupFilter(e.target.value); setRegistryPage(1); }} className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-3">
                <option value="">Tout statut dédup.</option>
                <option value="unique">Unique</option>
                <option value="doublon_reel">⚠️ Doublon réel</option>
                <option value="retry_normal">Retry normal</option>
                <option value="jamais_synchronise">Jamais synchronisé</option>
              </select>
              <input value={registryEventIdSearch} onChange={e => { setRegistryEventIdSearch(e.target.value); setRegistryPage(1); }} placeholder="event_id…" className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-3" />
              <input value={registryPhoneSearch} onChange={e => { setRegistryPhoneSearch(e.target.value); setRegistryPage(1); }} placeholder="Téléphone…" className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-3" />
              <input value={registryCampaignSearch} onChange={e => { setRegistryCampaignSearch(e.target.value); setRegistryPage(1); }} placeholder="Campagne…" className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-3" />
              <input value={registryAdsetSearch} onChange={e => { setRegistryAdsetSearch(e.target.value); setRegistryPage(1); }} placeholder="Adset…" className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-3" />
              <input value={registryAdSearch} onChange={e => { setRegistryAdSearch(e.target.value); setRegistryPage(1); }} placeholder="Annonce…" className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold px-3" />
              <button onClick={resetRegistryFilters} className="h-9 rounded-xl border border-slate-200 text-xs font-black text-slate-500 hover:bg-slate-50 transition-colors">✕ Réinitialiser</button>
            </div>

            {isLoadingRegistry ? (
              <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement…</div>
            ) : Array.isArray(registryData?.data) && registryData.data.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="py-2 pr-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">Évènement</th>
                        <th className="py-2 pr-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">Étape</th>
                        <th className="py-2 pr-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">Source</th>
                        <th className="py-2 pr-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">État Meta</th>
                        <th className="py-2 pr-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">Dédup</th>
                        <th className="py-2 pr-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">Commande</th>
                        <th className="py-2 pr-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">Campagne</th>
                        <th className="py-2 pr-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">Adset</th>
                        <th className="py-2 pr-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">Annonce</th>
                        <th className="py-2 pr-3 font-black text-slate-400 uppercase tracking-wider text-[10px]">Placement</th>
                        <th className="py-2 font-black text-slate-400 uppercase tracking-wider text-[10px]">Reçu le</th>
                      </tr>
                    </thead>
                    <tbody>
                      {registryData.data.map((e: any) => (
                        <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                          <td className="py-2.5 pr-3 font-bold text-slate-800">{e.event_name}</td>
                          <td className="py-2.5 pr-3 tabular-nums text-slate-500">{e.funnel_step ?? '—'}</td>
                          <td className="py-2.5 pr-3">
                            <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-black uppercase", e.source === 'CAPI uniquement' ? "bg-purple-50 text-purple-700" : "bg-blue-50 text-blue-700")}>{e.source}</span>
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-black uppercase",
                              e.sync_status === 'success' ? "bg-emerald-50 text-emerald-700" :
                              ['error', 'failed'].includes(e.sync_status) ? "bg-rose-50 text-rose-700" :
                              "bg-amber-50 text-amber-700"
                            )}>{e.meta_state}</span>
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-black uppercase",
                              e.dedup_status === 'doublon_reel' ? "bg-rose-50 text-rose-700" :
                              e.dedup_status === 'unique' ? "bg-slate-50 text-slate-500" : "bg-amber-50 text-amber-700"
                            )} title={e.dedup_status === 'doublon_reel' ? 'Double comptage réel confirmé côté Meta' : e.dedup_status === 'retry_normal' ? 'Retry normal, un seul succès' : e.dedup_status === 'jamais_synchronise' ? 'Jamais synchronisé avec succès' : 'Aucun doublon'}>
                              {e.dedup_status === 'doublon_reel' ? '⚠️ Doublon' : e.dedup_status === 'retry_normal' ? 'Retry OK' : e.dedup_status === 'jamais_synchronise' ? 'Jamais sync.' : 'Unique'}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 font-bold text-slate-600">{e.order_number || '—'}</td>
                          <td className="py-2.5 pr-3 text-slate-500 max-w-[120px] truncate" title={e.campaign_name || e.campaign_id || ''}>{e.campaign_name || e.campaign_id || '—'}</td>
                          <td className="py-2.5 pr-3 text-slate-500 max-w-[100px] truncate" title={e.adset_name || e.adset_id || ''}>{e.adset_name || e.adset_id || '—'}</td>
                          <td className="py-2.5 pr-3 text-slate-500 max-w-[100px] truncate" title={e.ad_name || e.ad_id || ''}>{e.ad_name || e.ad_id || '—'}</td>
                          <td className="py-2.5 pr-3 text-slate-500">{e.placement || '—'}</td>
                          <td className="py-2.5 text-slate-400 whitespace-nowrap">{e.created_at ? new Date(e.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400">{registryData.total} évènement{registryData.total > 1 ? 's' : ''} au total</span>
                  <div className="flex items-center gap-2">
                    <button disabled={registryPage <= 1} onClick={() => setRegistryPage(p => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold disabled:opacity-30">← Précédent</button>
                    <span className="text-xs font-bold text-slate-500">{registryPage} / {registryData.totalPages || 1}</span>
                    <button disabled={registryPage >= (registryData.totalPages || 1)} onClick={() => setRegistryPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold disabled:opacity-30">Suivant →</button>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Aucun évènement sur cette période.</div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB: CROSS-MODULE INTEGRATION ─── */}
      {activeTab === 'integration' && (
        <div className="space-y-4">
          
          {/* Integration Status Banner */}
          <div className="bg-gradient-to-r from-[#1877F2] via-[#6C5CE7] to-[#00B894] p-px rounded-2xl shadow-md">
            <div className="bg-white rounded-2xl p-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-gradient-to-br from-[#1877F2] to-[#6C5CE7] flex items-center justify-center text-white shadow">
                  <Zap className="size-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-[#2D3436]">Intégration Cross-Module Active</h3>
                  <p className="text-[10px] font-bold text-[#636E72] mt-0.5">Meta Ads → Charges (Dépenses) → Finance (Portefeuilles) · Traçabilité complète</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-[#E6FFF8] text-[#00B894] border-none font-black text-[10px] px-2.5 py-1 rounded-md">
                  <Activity className="size-3 mr-1 inline" /> ACTIF
                </Badge>
              </div>
            </div>
          </div>

          {/* KPI Row: Cross-module metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Total Ad Spend linked */}
            <div className="bg-white p-5 rounded-2xl border shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Dépenses Pub (DZD)</span>
                <div className="size-8 rounded-lg bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-500">
                  <DollarSign className="size-4" />
                </div>
              </div>
              <p className="text-2xl font-black text-[#2D3436] tabular-nums">{formatPrice(intMetaAds.total_spend_dzd || 0)}</p>
              <p className="text-[10px] font-bold text-[#636E72] mt-1">{intMetaAds.campaigns_count || 0} campagnes · Converti en DZD</p>
            </div>

            {/* Linked Expenses */}
            <div className="bg-white p-5 rounded-2xl border shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Charges Liées</span>
                <div className="size-8 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center text-red-500">
                  <Receipt className="size-4" />
                </div>
              </div>
              <p className="text-2xl font-black text-[#2D3436] tabular-nums">{formatPrice(intCharges.advertising_expenses_total || 0)}</p>
              <p className="text-[10px] font-bold text-[#636E72] mt-1">{intCharges.advertising_expenses_count || 0} dépenses pub synchronisées</p>
            </div>

            {/* Finance Transactions */}
            <div className="bg-white p-5 rounded-2xl border shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Transactions Finance</span>
                <div className="size-8 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-500">
                  <CreditCard className="size-4" />
                </div>
              </div>
              <p className="text-2xl font-black text-[#2D3436] tabular-nums">{formatPrice(intFinance.ad_transactions_total || 0)}</p>
              <p className="text-[10px] font-bold text-[#636E72] mt-1">{intFinance.ad_transactions_count || 0} transactions portefeuille</p>
            </div>

            {/* Net Profit after Ads */}
            <div className="bg-white p-5 rounded-2xl border shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Profit Net (après pub)</span>
                <div className={cn(
                  "size-8 rounded-lg border flex items-center justify-center",
                  (intRevenue.net_profit_after_ads || 0) >= 0 
                    ? "bg-green-50 border-green-100 text-green-500" 
                    : "bg-red-50 border-red-100 text-red-500"
                )}>
                  {(intRevenue.net_profit_after_ads || 0) >= 0 
                    ? <TrendingUp className="size-4" /> 
                    : <TrendingDown className="size-4" />}
                </div>
              </div>
              <p className={cn(
                "text-2xl font-black tabular-nums",
                (intRevenue.net_profit_after_ads || 0) >= 0 ? "text-[#00B894]" : "text-[#E17055]"
              )}>
                {(intRevenue.net_profit_after_ads || 0) >= 0 ? '+' : ''}{formatPrice(intRevenue.net_profit_after_ads || 0)}
              </p>
              <p className="text-[10px] font-bold text-[#636E72] mt-1">CA UTM − Budget pub total</p>
            </div>
          </div>

          {/* Two-column detail */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Linked Expenses Panel */}
            <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
              <div className="p-5 border-b flex items-center justify-between">
                <h4 className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
                  <Receipt className="size-4 text-[#E17055]" /> Charges Publicitaires Liées
                </h4>
                <Badge className="bg-[#FFEDE9] text-[#E17055] border-none text-[10px] font-black rounded-md px-2.5">
                  Module Charges
                </Badge>
              </div>
              <div className="divide-y divide-[#F1F2F4]">
                {isLoadingIntegration ? (
                  <div className="p-6 text-center text-[#B2BEC3] text-xs font-bold animate-pulse">Chargement...</div>
                ) : (intCharges.recent_ad_expenses || []).length === 0 ? (
                  <div className="p-8 text-center">
                    <Receipt className="size-8 text-[#B2BEC3] mx-auto mb-2" />
                    <p className="text-xs font-bold text-[#B2BEC3] uppercase">Aucune charge publicitaire liée</p>
                    <p className="text-[10px] text-[#B2BEC3] mt-1">Synchronisez Meta Ads pour créer automatiquement les charges</p>
                  </div>
                ) : (intCharges.recent_ad_expenses || []).map((exp: any) => (
                  <div 
                    key={exp.id} 
                    onClick={() => setSelectedExpense(exp)}
                    className="px-5 py-3.5 flex items-center justify-between hover:bg-[#FAFBFD] transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="size-8 rounded-lg bg-[#FFEDE9] flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                        <Facebook className="size-3.5 text-[#E17055]" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-[#2D3436] truncate max-w-[180px] group-hover:text-[#E17055] transition-colors">{exp.label}</p>
                        <p className="text-[10px] text-[#B2BEC3] font-bold">{exp.date || '—'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-black font-mono text-[#E17055]">{formatPrice(exp.amount)}</span>
                      <Badge className={cn(
                        "border-none text-[9px] font-black rounded-md px-1.5",
                        exp.status === 'PAID' ? "bg-[#E6FFF8] text-[#00B894]" : "bg-[#FFF8E6] text-[#FDCB6E]"
                      )}>
                        {exp.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
              {/* Total footer */}
              <div className="p-4 bg-[#FAFBFD] border-t flex justify-between items-center">
                <span className="text-[10px] font-black uppercase text-[#B2BEC3]">Total charges pub</span>
                <span className="text-sm font-black text-[#E17055] font-mono">{formatPrice(intCharges.advertising_expenses_total || 0)}</span>
              </div>
            </div>

            {/* Finance Wallet Panel */}
            <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
              <div className="p-5 border-b flex items-center justify-between">
                <h4 className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
                  <Wallet className="size-4 text-[#6C5CE7]" /> Impact Portefeuilles & Finance
                </h4>
                <Badge className="bg-[#F0EDFF] text-[#6C5CE7] border-none text-[10px] font-black rounded-md px-2.5">
                  Module Finance
                </Badge>
              </div>

              {/* Wallets */}
              <div className="p-4 space-y-2">
                <p className="text-[10px] font-black uppercase text-[#B2BEC3] tracking-widest mb-3">Portefeuilles actifs</p>
                {isLoadingIntegration ? (
                  <div className="text-xs font-bold text-[#B2BEC3] animate-pulse">Chargement...</div>
                ) : (intFinance.wallets || []).length === 0 ? (
                  <div className="text-center py-4">
                    <Wallet className="size-7 text-[#B2BEC3] mx-auto mb-1" />
                    <p className="text-xs font-bold text-[#B2BEC3]">Aucun portefeuille configuré</p>
                    <p className="text-[10px] text-[#B2BEC3]">Créez un portefeuille dans le module Finance</p>
                  </div>
                ) : (intFinance.wallets || []).map((w: any) => (
                  <div key={w.id} className="flex items-center justify-between bg-[#F8F9FC] rounded-xl px-4 py-3 border border-[#E9ECF0]">
                    <div className="flex items-center gap-2.5">
                      <div className="size-8 rounded-lg bg-[#F0EDFF] border border-[#6C5CE7]/10 flex items-center justify-center">
                        <Wallet className="size-4 text-[#6C5CE7]" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-[#2D3436]">{w.name}</p>
                        <p className="text-[10px] text-[#B2BEC3] font-bold uppercase">{w.type}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-[#2D3436] font-mono tabular-nums">{formatPrice(w.balance)}</p>
                      <p className="text-[9px] text-[#E17055] font-bold font-mono">−{formatPrice(w.total_out)} sortie pub</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Recent transactions */}
              <div className="border-t">
                <div className="px-4 pt-4 pb-2">
                  <p className="text-[10px] font-black uppercase text-[#B2BEC3] tracking-widest">Transactions pub récentes</p>
                </div>
                <div className="divide-y divide-[#F1F2F4]">
                  {(intFinance.recent_ad_transactions || []).length === 0 ? (
                    <div className="px-4 py-4 text-center">
                      <p className="text-[10px] font-bold text-[#B2BEC3]">Aucune transaction pub enregistrée</p>
                    </div>
                  ) : (intFinance.recent_ad_transactions || []).slice(0, 4).map((tx: any) => (
                    <div key={tx.id} className="px-4 py-3 flex items-center justify-between hover:bg-[#FAFBFD] transition-colors">
                      <div className="flex items-center gap-2">
                        <div className="size-7 rounded-lg bg-[#FFEDE9] flex items-center justify-center flex-shrink-0">
                          <ArrowDownRight className="size-3.5 text-[#E17055]" />
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-[#2D3436] font-mono">{tx.reference}</p>
                          <p className="text-[9px] text-[#B2BEC3] font-bold">{tx.date?.split('T')[0] || '—'}</p>
                        </div>
                      </div>
                      <span className="text-xs font-black text-[#E17055] font-mono tabular-nums">−{formatPrice(tx.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-[#FAFBFD] border-t flex justify-between items-center">
                <span className="text-[10px] font-black uppercase text-[#B2BEC3]">Total sortie finance ads</span>
                <span className="text-sm font-black text-[#6C5CE7] font-mono">{formatPrice(intFinance.ad_transactions_total || 0)}</span>
              </div>
            </div>
          </div>

          {/* Expenses breakdown by category */}
          <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
            <div className="p-5 border-b flex items-center justify-between">
              <h4 className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
                <Package className="size-4 text-[#0984E3]" /> Répartition Totale des Charges par Catégorie
              </h4>
              <Badge className="bg-[#E8F4FE] text-[#0984E3] border-none text-[10px] font-black rounded-md px-2.5">
                {intCharges.by_category?.length || 0} catégories
              </Badge>
            </div>
            <div className="p-5">
              {isLoadingIntegration ? (
                <div className="text-xs text-[#B2BEC3] animate-pulse font-bold">Chargement...</div>
              ) : (intCharges.by_category || []).length === 0 ? (
                <p className="text-xs text-[#B2BEC3] font-bold text-center py-4">Aucune charge enregistrée</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {(intCharges.by_category || []).map((cat: any) => {
                    const isAds = cat.category === 'ADVERTISING' || cat.category === 'MARKETING';
                    const pct = intCharges.all_expenses_total > 0
                      ? Math.round((cat.total / intCharges.all_expenses_total) * 100)
                      : 0;
                    return (
                      <div key={cat.category} className={cn(
                        "p-4 rounded-xl border relative overflow-hidden",
                        isAds ? "bg-[#FFEDE9] border-[#FFD4CC]" : "bg-[#F8F9FC] border-[#E9ECF0]"
                      )}>
                        {isAds && (
                          <div className="absolute top-2 right-2">
                            <Facebook className="size-3.5 text-[#E17055] opacity-60" />
                          </div>
                        )}
                        <p className={cn(
                          "text-[10px] font-black uppercase tracking-widest mb-1",
                          isAds ? "text-[#E17055]" : "text-[#B2BEC3]"
                        )}>{cat.category}</p>
                        <p className={cn(
                          "text-lg font-black font-mono tabular-nums",
                          isAds ? "text-[#E17055]" : "text-[#2D3436]"
                        )}>{formatPrice(cat.total)}</p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-[9px] font-bold text-[#B2BEC3]">{cat.count} dép.</span>
                          <span className={cn(
                            "text-[9px] font-black rounded px-1.5 py-0.5",
                            isAds ? "bg-[#E17055]/20 text-[#E17055]" : "bg-[#E9ECF0] text-[#636E72]"
                          )}>{pct}%</span>
                        </div>
                        {/* Thin progress bar */}
                        <div className="mt-2 h-1 rounded-full bg-black/5 overflow-hidden">
                          <div 
                            className={cn("h-full rounded-full transition-all", isAds ? "bg-[#E17055]" : "bg-[#6C5CE7]")}
                            style={{ width: `${pct}%` }} 
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Revenue attribution summary */}
          <div className="bg-gradient-to-br from-[#1877F2]/5 via-white to-[#00B894]/5 rounded-2xl border shadow-sm p-6">
            <h4 className="text-sm font-black uppercase tracking-wider flex items-center gap-2 mb-5">
              <TrendingUp className="size-4 text-[#1877F2]" /> Attribution des Revenus (UTM → Commandes → Finance)
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-black font-mono tabular-nums text-[#2D3436]">{formatPrice(intRevenue.utm_revenue || 0)}</div>
                <div className="text-[10px] font-black text-[#B2BEC3] uppercase mt-1">CA via UTM</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-black font-mono tabular-nums text-[#E17055]">−{formatPrice(intMetaAds.total_spend_dzd || 0)}</div>
                <div className="text-[10px] font-black text-[#B2BEC3] uppercase mt-1">Budget Pub</div>
              </div>
              <div className="text-center">
                <div className={cn(
                  "text-2xl font-black font-mono tabular-nums",
                  (intRevenue.net_profit_after_ads || 0) >= 0 ? "text-[#00B894]" : "text-[#E17055]"
                )}>
                  {(intRevenue.net_profit_after_ads || 0) >= 0 ? '+' : ''}{formatPrice(intRevenue.net_profit_after_ads || 0)}
                </div>
                <div className="text-[10px] font-black text-[#B2BEC3] uppercase mt-1">Profit Net Ads</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-black font-mono tabular-nums text-[#6C5CE7]">{intRevenue.global_roas || 0}x</div>
                <div className="text-[10px] font-black text-[#B2BEC3] uppercase mt-1">ROAS Global</div>
              </div>
            </div>
            <div className="mt-4 h-2 bg-[#E9ECF0] rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-[#1877F2] to-[#00B894] rounded-full transition-all"
                style={{ width: `${Math.min(intRevenue.ads_revenue_ratio || 0, 100)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[9px] font-black text-[#B2BEC3] uppercase">Budget Pub</span>
              <span className="text-[9px] font-black text-[#00B894] uppercase">{intRevenue.ads_revenue_ratio || 0}% revenu attributable aux pubs</span>
            </div>
          </div>

        </div>
      )}

      {/* 🚀 DIALOG: GUIDE D'INSTALLATION 🚀 */}
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
