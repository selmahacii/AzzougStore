'use client';

import React, { useState } from 'react';
import {
  TrendingUp,
  DollarSign,
  ShoppingBag,
  BarChart3,
  RefreshCw,
  CheckCircle,
  Sparkles,
  X,
  Music2,
  Activity,
  Zap,
  AlertCircle,
  Package,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function TikTokAdsDashboard() {
  const activeStore = useAppStore((s) => s.activeStore);
  const queryClient = useQueryClient();

  const [advertiserId, setAdvertiserId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [appId, setAppId] = useState('');
  const [catalogId, setCatalogId] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [exchangeRate, setExchangeRate] = useState('220');
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'campaigns' | 'funnel' | 'quality' | 'catalog'>('campaigns');

  const { data: configData } = useQuery({
    queryKey: ['tiktok_ads_config', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any }>(`/api/v1/tiktok-ads/config?store_id=${activeStore?.id}`),
    enabled: !!activeStore?.id,
  });

  const { data: campaignsData, isLoading: isLoadingCampaigns } = useQuery({
    queryKey: ['tiktok_ads_campaigns', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any[]; summary: any }>(
      `/api/v1/tiktok-ads/campaigns?store_id=${activeStore?.id}`
    ),
    enabled: !!activeStore?.id,
  });

  // --- Funnel Analytics (PageView -> CompletePayment) ---
  const { data: funnelData, isLoading: isLoadingFunnel } = useQuery({
    queryKey: ['tiktok_ads_funnel', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any }>(
      `/api/v1/tiktok-ads/funnel?store_id=${activeStore?.id}`
    ),
    enabled: !!activeStore?.id && activeTab === 'funnel',
  });
  const funnel = funnelData?.data;

  // --- Signal Quality Center (Learning Score, EMQ, dédup, statuts) ---
  const { data: signalQualityData, isLoading: isLoadingSignalQuality } = useQuery({
    queryKey: ['tiktok_signal_quality', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any }>(
      `/api/v1/tiktok-ads/signal-quality?store_id=${activeStore?.id}`
    ),
    enabled: !!activeStore?.id && activeTab === 'quality',
  });
  const signalQuality = signalQualityData?.data;

  // --- Diagnostics (config status, delivery 7j/30j) ---
  const { data: diagnosticsData, isLoading: isLoadingDiagnostics } = useQuery({
    queryKey: ['tiktok_diagnostics', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any }>(
      `/api/v1/tiktok-ads/diagnostics?store_id=${activeStore?.id}`
    ),
    enabled: !!activeStore?.id && activeTab === 'quality',
  });
  const diagnostics = diagnosticsData?.data;

  // --- KPI Validation ERP <-> TikTok ---
  const { data: kpiValidationData, isLoading: isLoadingKpiValidation } = useQuery({
    queryKey: ['tiktok_kpi_validation', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any }>(
      `/api/v1/tiktok-ads/kpi-validation?store_id=${activeStore?.id}`
    ),
    enabled: !!activeStore?.id && activeTab === 'quality',
  });
  const kpiValidation = kpiValidationData?.data;

  // --- Catalog Health ---
  const { data: catalogHealthData, isLoading: isLoadingCatalogHealth } = useQuery({
    queryKey: ['tiktok_catalog_health', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any }>(
      `/api/v1/tiktok-ads/catalog-health?store_id=${activeStore?.id}`
    ),
    enabled: !!activeStore?.id && activeTab === 'catalog',
  });
  const catalogHealth = catalogHealthData?.data;

  const catalogSyncMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tiktok-ads/catalog-sync?store_id=${activeStore?.id}`, { method: 'POST' }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['tiktok_catalog_health'] });
      if (res?.success) {
        const d = res.data || {};
        toast.success(`Catalogue synchronisé : ${d.created || 0} créé(s), ${d.updated || 0} mis à jour, ${d.deleted || 0} supprimé(s)`);
      } else {
        toast.error(res?.message || 'Configurez le Catalog ID TikTok d\'abord.');
      }
    },
    onError: (err: any) => toast.error('Échec de la synchro catalogue', { description: err.message }),
  });

  const saveConfigMutation = useMutation({
    mutationFn: (payload: any) => apiFetch('/api/v1/tiktok-ads/config', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tiktok_ads_config'] });
      queryClient.invalidateQueries({ queryKey: ['tiktok_ads_campaigns'] });
      toast.success('Configuration TikTok Ads enregistrée avec succès');
      setIsConfiguring(false);
    },
    onError: (err: any) => toast.error('Erreur', { description: err.message }),
  });

  const syncMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tiktok-ads/sync?store_id=${activeStore?.id}`, { method: 'POST' }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['tiktok_ads_campaigns'] });
      if (res?.success) {
        toast.success(res?.message || 'Synchronisation TikTok Ads réussie !');
      } else {
        toast.error(res?.message || 'Configurez votre compte TikTok Ads d\'abord.');
      }
    },
    onError: (err: any) => toast.error('Échec de la synchro', { description: err.message }),
  });

  const config = configData?.data || { is_connected: false };
  const campaigns = Array.isArray(campaignsData?.data) ? campaignsData.data : [];
  const summary = campaignsData?.summary || { total_spend: 0, total_revenue: 0, total_orders: 0, global_roas: 0 };

  // --- Per-ad (Ad Group + Ad) breakdown for the currently expanded campaign —
  // expandedCampaign holds OUR row id (c.id), the ads endpoint needs TikTok's
  // own campaign_id, looked up from the already-loaded campaigns list. ---
  const expandedTikTokCampaignId = campaigns.find((c: any) => c.id === expandedCampaign)?.campaign_id;
  const { data: campaignAdsData, isLoading: isLoadingCampaignAds } = useQuery({
    queryKey: ['tiktok_ads_campaign_ads', expandedTikTokCampaignId],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(
      `/api/v1/tiktok-ads/campaigns/${expandedTikTokCampaignId}/ads`
    ),
    enabled: !!expandedTikTokCampaignId,
  });
  const campaignAds = Array.isArray(campaignAdsData?.data) ? campaignAdsData.data : [];

  const openConfig = () => {
    setAdvertiserId(config.advertiser_id || '');
    setAccessToken(config.access_token || '');
    setPixelId(config.pixel_id || '');
    setAppId(config.app_id || '');
    setCatalogId(config.catalog_id || '');
    setCurrency(config.currency || 'USD');
    setExchangeRate(String(config.exchange_rate ?? 220));
    setIsConfiguring(true);
  };

  const handleSaveConfig = () => {
    saveConfigMutation.mutate({
      store_id: activeStore?.id,
      advertiser_id: advertiserId.trim(),
      access_token: accessToken.trim(),
      pixel_id: pixelId.trim(),
      app_id: appId.trim(),
      catalog_id: catalogId.trim(),
      is_connected: true,
      currency,
      exchange_rate: parseFloat(exchangeRate) || 1.0,
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-[#2D3436] flex items-center gap-2">
            <span className="size-9 rounded-xl bg-black flex items-center justify-center">
              <Music2 className="size-5 text-white" />
            </span>
            TikTok Ads & ROAS — {activeStore?.name || 'Boutique'}
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Compte publicitaire TikTok propre à cette boutique • Attribution UTM automatique
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={cn(
            'border-none font-black text-[10px] px-2.5 py-1 rounded-lg',
            config.is_connected ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
          )}>
            {config.is_connected ? '● CONNECTÉ' : '○ NON CONNECTÉ'}
          </Badge>
          <Button onClick={openConfig} variant="outline" className="h-10 rounded-xl text-xs font-black">
            {config.is_connected ? 'Modifier la connexion' : 'Connecter TikTok Ads'}
          </Button>
          <Button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || !config.is_connected}
            className="h-10 rounded-xl bg-black hover:bg-slate-800 text-white text-xs font-black"
          >
            <RefreshCw className={cn('size-4 mr-1.5', syncMutation.isPending && 'animate-spin')} />
            Synchroniser
          </Button>
        </div>
      </div>

      {/* Config modal */}
      {isConfiguring && (
        <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-8 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black flex items-center gap-2">
                <span className="size-8 rounded-lg bg-black flex items-center justify-center"><Music2 className="size-4 text-white" /></span>
                Connexion TikTok Ads
              </h2>
              <button onClick={() => setIsConfiguring(false)} className="p-2 hover:bg-slate-50 rounded-lg">
                <X className="size-5 text-slate-300" />
              </button>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Récupérez ces informations dans <strong>TikTok Ads Manager → Outils → Business API</strong>.
              L'Advertiser ID est visible dans l'URL du gestionnaire de publicités. L'Access Token se génère
              depuis <strong>business-api.tiktok.com</strong> (application développeur).
            </p>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-600">Advertiser ID *</label>
                <Input value={advertiserId} onChange={e => setAdvertiserId(e.target.value)} placeholder="ex: 7001234567890123456" className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-600">Access Token *</label>
                <Input value={accessToken} onChange={e => setAccessToken(e.target.value)} type="password" placeholder="Token Business API longue durée" className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-600">Pixel ID (optionnel)</label>
                <Input value={pixelId} onChange={e => setPixelId(e.target.value)} placeholder="Pixel TikTok pour le suivi des conversions" className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-600">App ID (optionnel)</label>
                <Input value={appId} onChange={e => setAppId(e.target.value)} placeholder="ID de l'application développeur TikTok" className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-black text-slate-600">Catalog ID (optionnel — flux produits)</label>
                <Input value={catalogId} onChange={e => setCatalogId(e.target.value)} placeholder="ID du catalogue TikTok Catalog Manager" className="rounded-xl" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-600">Devise du compte</label>
                  <select value={currency} onChange={e => setCurrency(e.target.value)} className="w-full h-10 text-xs px-3 border rounded-xl bg-white font-bold">
                    {['USD', 'EUR', 'GBP', 'CAD', 'DZD'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-600">Taux → DZD</label>
                  <Input value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} type="number" step="0.01" className="rounded-xl" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button onClick={() => setIsConfiguring(false)} variant="outline" className="flex-1 h-12 rounded-2xl font-black">
                Annuler
              </Button>
              <Button
                onClick={handleSaveConfig}
                disabled={saveConfigMutation.isPending || !advertiserId.trim() || !accessToken.trim()}
                className="flex-1 h-12 rounded-2xl bg-black hover:bg-slate-800 text-white font-black disabled:opacity-50"
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

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Budget TikTok dépensé</span>
            <h2 className="text-2xl font-black text-[#2D3436] tabular-nums">{formatPrice(summary.total_spend)}</h2>
            {summary.raw_spend_by_currency && Object.keys(summary.raw_spend_by_currency).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {Object.entries(summary.raw_spend_by_currency as Record<string, number>).map(([cur, amt]) => (
                  <span key={cur} className="text-[9px] font-black text-[#636E72] bg-slate-50 border border-slate-100 rounded-md px-1.5 py-0.5 tabular-nums">
                    {amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {cur}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="size-12 rounded-xl bg-slate-900 flex items-center justify-center text-white">
            <DollarSign className="size-5" />
          </div>
        </div>
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
        <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">ROAS Global</span>
            <h2 className="text-3xl font-black text-[#2D3436] tabular-nums">{summary.global_roas}x</h2>
            <Badge className={cn(
              'border-none rounded-md px-1.5 py-0.5 text-[9px] font-black mt-1',
              summary.global_roas >= 3 ? 'bg-[#E6FFF8] text-[#00B894]' : 'bg-[#FFEDE9] text-[#E17055]'
            )}>
              {summary.global_roas >= 3 ? 'EXCELLENT ROAS' : 'ROAS FAIBLE'}
            </Badge>
          </div>
          <div className="size-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
            <TrendingUp className="size-5" />
          </div>
        </div>
      </div>

      {/* Global micro-metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: 'Impressions', value: (summary.total_impressions || 0).toLocaleString(), hint: 'Affichages totaux' },
          { label: 'Portée', value: (summary.total_reach || 0).toLocaleString(), hint: 'Personnes uniques' },
          { label: 'Clics', value: (summary.total_clicks || 0).toLocaleString(), hint: 'Clics totaux' },
          { label: 'CTR', value: `${summary.global_ctr || 0}%`, hint: 'Taux de clic' },
          { label: 'CPC', value: formatPrice(summary.global_cpc || 0), hint: 'Coût par clic' },
          { label: 'CPM', value: formatPrice(summary.global_cpm || 0), hint: 'Coût / 1000 vues' },
          { label: 'Coût / Vente', value: formatPrice(summary.global_cost_per_order || 0), hint: `Taux conv. ${summary.global_conversion_rate || 0}%` },
          { label: 'Profit Net Pub', value: formatPrice(summary.global_profit || 0), hint: `Panier moyen ${formatPrice(summary.global_aov || 0)}`, highlight: (summary.global_profit || 0) >= 0 },
          { label: 'Conversions déclarées par TikTok', value: (summary.global_tiktok_conversions || 0).toLocaleString(), hint: 'Attribution TikTok (pixel/events)' },
          { label: 'Écart vs nos commandes', value: `${(summary.global_conversion_gap || 0) > 0 ? '+' : ''}${summary.global_conversion_gap || 0}`, hint: 'Fenêtres d\'attribution différentes', highlight: (summary.global_conversion_gap || 0) === 0 },
        ].map((m: any) => (
          <div key={m.label} className="bg-white p-3 rounded-2xl border shadow-sm">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#B2BEC3]">{m.label}</p>
            <p className={cn(
              'text-sm font-black tabular-nums mt-1',
              m.highlight === undefined ? 'text-[#2D3436]' : m.highlight ? 'text-[#00B894]' : 'text-[#E17055]'
            )}>{m.value}</p>
            <p className="text-[9px] text-slate-400 mt-0.5">{m.hint}</p>
          </div>
        ))}
      </div>

      {/* ─── TAB NAVIGATION ─── */}
      <div className="flex items-center gap-1 bg-[#F8F9FC] p-1 rounded-2xl border border-[#E9ECF0] w-fit flex-wrap">
        <button
          onClick={() => setActiveTab('campaigns')}
          className={cn(
            "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
            activeTab === 'campaigns'
              ? "bg-white text-[#2D3436] shadow-sm border border-[#E9ECF0]"
              : "text-[#B2BEC3] hover:text-[#636E72]"
          )}
        >
          <span className="flex items-center gap-1.5"><Sparkles className="size-3.5" /> Campagnes</span>
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
          onClick={() => setActiveTab('catalog')}
          className={cn(
            "px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
            activeTab === 'catalog'
              ? "bg-white text-[#2D3436] shadow-sm border border-[#E9ECF0]"
              : "text-[#B2BEC3] hover:text-[#636E72]"
          )}
        >
          <span className="flex items-center gap-1.5"><Package className="size-3.5" /> Catalogue</span>
        </button>
      </div>

      {/* Campaigns table */}
      {activeTab === 'campaigns' && (
      <div className="bg-white rounded-3xl border overflow-hidden shadow-sm">
        <div className="p-6 border-b flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="size-4 text-slate-700" /> Campagnes TikTok — {activeStore?.name || 'Boutique'}
            </h3>
            <p className="text-[10px] text-slate-400 mt-1">Données isolées par boutique • Cliquez sur une ligne pour les micro-détails</p>
          </div>
          <Badge className="bg-slate-100 text-slate-600 border-none font-black">{campaigns.length} campagnes</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-[#F8F9FC] border-b border-[#E9ECF0]">
                {['Campagne', 'Dépenses', 'Portée', 'Clics', 'Ventes', 'CA', 'ROAS'].map((h, i) => (
                  <th key={h} className={cn(
                    'px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest',
                    i >= 1 && i <= 3 ? 'text-right' : i >= 4 ? 'text-center' : ''
                  )}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E9ECF0]">
              {isLoadingCampaigns ? (
                [1, 2].map(i => (
                  <tr key={i} className="animate-pulse"><td colSpan={7} className="px-6 py-8 bg-[#FAFBFD]/50" /></tr>
                ))
              ) : campaigns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <div className="space-y-2">
                      <div className="size-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto">
                        <Music2 className="size-6 text-slate-400" />
                      </div>
                      <p className="text-sm font-bold text-slate-400">Aucune campagne TikTok disponible</p>
                      <p className="text-xs text-slate-300">Connectez votre compte puis cliquez sur "Synchroniser"</p>
                    </div>
                  </td>
                </tr>
              ) : campaigns.map((c: any) => {
                const isExpanded = expandedCampaign === c.id;
                return (
                  <React.Fragment key={c.id}>
                    <tr
                      className={cn('transition-colors font-bold text-xs cursor-pointer', isExpanded ? 'bg-[#F8F9FC]' : 'hover:bg-[#FAFBFD]')}
                      onClick={() => setExpandedCampaign(isExpanded ? null : c.id)}
                    >
                      <td className="px-6 py-5">
                        <p className="text-sm font-black text-[#2D3436] tracking-tight leading-tight">{c.campaign_name}</p>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {c.campaign_id}</p>
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
                      <td className="px-6 py-5 text-center font-black font-mono text-[#2D3436] tabular-nums">{formatPrice(c.revenue || 0)}</td>
                      <td className="px-6 py-5 text-center">
                        <Badge className={cn(
                          'border-none rounded-md px-2.5 py-1 text-xs font-black font-mono',
                          (c.roas || 0) >= 4 ? 'bg-[#E6FFF8] text-[#00B894]' : (c.roas || 0) >= 2.5 ? 'bg-[#E8F4FE] text-[#0984E3]' : 'bg-[#FFEDE9] text-[#E17055]'
                        )}>
                          {c.roas || 0}x
                        </Badge>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={7} className="px-8 py-5">
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
                            <div className="bg-white rounded-xl p-3 border-2 border-slate-300">
                              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Conversions déclarées par TikTok</p>
                              <p className="text-sm font-black text-slate-700 mt-1 tabular-nums">{c.tiktok_conversions || 0}</p>
                              {c.conversion_gap !== 0 && (
                                <p className={cn('text-[9px] font-bold mt-0.5', c.conversion_gap > 0 ? 'text-[#0984E3]' : 'text-[#E17055]')}>
                                  {c.conversion_gap > 0 ? '+' : ''}{c.conversion_gap} vs nos commandes
                                </p>
                              )}
                            </div>
                            <div className="bg-white rounded-xl p-3 border border-slate-100">
                              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Impressions</p>
                              <p className="text-sm font-black text-slate-700 mt-1 tabular-nums">{(c.impressions || 0).toLocaleString()}</p>
                              <p className="text-[9px] text-slate-400">Fréquence {c.frequency || 0}x / personne</p>
                            </div>
                            <div className="bg-white rounded-xl p-3 border border-slate-100">
                              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">CTR</p>
                              <p className="text-sm font-black text-slate-700 mt-1 tabular-nums">{c.ctr || 0}%</p>
                              <p className="text-[9px] text-slate-400">Taux de clic</p>
                            </div>
                            <div className="bg-white rounded-xl p-3 border border-slate-100">
                              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">CPC</p>
                              <p className="text-sm font-black text-slate-700 mt-1 tabular-nums">{formatPrice(c.cpc || 0)}</p>
                              {c.currency && c.currency !== 'DZD' && (
                                <p className="text-[9px] text-slate-400 tabular-nums">{c.cpc_raw || 0} {c.currency}</p>
                              )}
                            </div>
                            <div className="bg-white rounded-xl p-3 border border-slate-100">
                              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">CPM</p>
                              <p className="text-sm font-black text-slate-700 mt-1 tabular-nums">{formatPrice(c.cpm || 0)}</p>
                              {c.currency && c.currency !== 'DZD' && (
                                <p className="text-[9px] text-slate-400 tabular-nums">{c.cpm_raw || 0} {c.currency}</p>
                              )}
                            </div>
                            <div className="bg-white rounded-xl p-3 border border-slate-100">
                              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Coût / Vente</p>
                              <p className="text-sm font-black text-slate-700 mt-1 tabular-nums">{c.orders_count > 0 ? formatPrice(c.cost_per_order || 0) : '—'}</p>
                              {c.orders_count > 0 && c.currency && c.currency !== 'DZD' && (
                                <p className="text-[9px] text-slate-400 tabular-nums">{c.cost_per_order_raw || 0} {c.currency}</p>
                              )}
                              <p className="text-[9px] text-slate-400">Taux conv. {c.conversion_rate || 0}%</p>
                            </div>
                            <div className="bg-white rounded-xl p-3 border border-slate-100">
                              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Profit Net</p>
                              <p className={cn('text-sm font-black mt-1 tabular-nums', (c.profit || 0) >= 0 ? 'text-[#00B894]' : 'text-[#E17055]')}>{formatPrice(c.profit || 0)}</p>
                              <p className="text-[9px] text-slate-400">Panier moyen {c.orders_count > 0 ? formatPrice(c.aov || 0) : '—'}</p>
                            </div>
                          </div>

                          {/* Détail par Ad Group / Annonce — TikTok hiérarchie
                              Campagne > Ad Group > Ad, un seul rollup par
                              campagne ne dit pas quelle annonce split-testée
                              performe. */}
                          <div className="mt-4">
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Détail par Annonce (Ad Group / Ad)</p>
                            {isLoadingCampaignAds ? (
                              <div className="rounded-xl border bg-white p-4 text-xs text-slate-400">Chargement…</div>
                            ) : campaignAds.length === 0 ? (
                              <div className="rounded-xl border bg-white p-4 text-xs text-slate-400">Aucune annonce synchronisée pour cette campagne.</div>
                            ) : (
                              <div className="overflow-x-auto rounded-xl border bg-white">
                                <table className="w-full text-left border-collapse min-w-[700px]">
                                  <thead>
                                    <tr className="bg-slate-50 border-b">
                                      <th className="px-3 py-2 text-[9px] font-extrabold text-slate-400 uppercase tracking-widest">Annonce</th>
                                      <th className="px-3 py-2 text-[9px] font-extrabold text-slate-400 uppercase tracking-widest">Ad Group</th>
                                      <th className="px-3 py-2 text-[9px] font-extrabold text-slate-400 uppercase tracking-widest text-right">Dépenses</th>
                                      <th className="px-3 py-2 text-[9px] font-extrabold text-slate-400 uppercase tracking-widest text-right">CTR</th>
                                      <th className="px-3 py-2 text-[9px] font-extrabold text-slate-400 uppercase tracking-widest text-right">CPC</th>
                                      <th className="px-3 py-2 text-[9px] font-extrabold text-slate-400 uppercase tracking-widest text-right">Conversions</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {campaignAds.map((ad: any) => (
                                      <tr key={ad.ad_id} className="text-xs">
                                        <td className="px-3 py-2.5 font-bold text-slate-700">{ad.ad_name}</td>
                                        <td className="px-3 py-2.5 text-slate-400">{ad.adgroup_name || '—'}</td>
                                        <td className="px-3 py-2.5 text-right font-bold tabular-nums">{formatPrice(ad.spend)}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{ad.ctr}%</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{formatPrice(ad.cpc)}</td>
                                        <td className="px-3 py-2.5 text-right font-bold tabular-nums text-[#0984E3]">{ad.tiktok_conversions}</td>
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
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* ─── TAB: ENTONNOIR DE CONVERSION ─── */}
      {activeTab === 'funnel' && (
        <div className="bg-white rounded-3xl border shadow-sm p-6">
          <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5 mb-1">
            <Activity className="size-4 text-slate-700" /> Entonnoir de Conversion TikTok
          </h3>
          <p className="text-[10px] text-slate-400 mb-5">PageView → ViewContent → AddToCart → InitiateCheckout → CompletePayment.</p>
          {isLoadingFunnel ? (
            <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement…</div>
          ) : Array.isArray(funnel?.stages) && funnel.stages.length > 0 ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                {funnel.stages.map((s: any, i: number) => (
                  <div key={s.stage} className="text-center p-4 rounded-2xl border bg-slate-50">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{s.label}</p>
                    <p className="text-xl font-black text-slate-700 mt-1 tabular-nums">{s.volume.toLocaleString()}</p>
                    {i > 0 && (
                      <p className={cn('text-[10px] font-bold mt-1', (s.loss_pct || 0) > 50 ? 'text-[#E17055]' : 'text-slate-400')}>
                        {s.rate_from_previous_stage != null ? `${s.rate_from_previous_stage}%` : '—'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {funnel.primary_bottleneck?.message && (
                <div className="mt-4 p-3 rounded-xl bg-[#FFF8E6] border border-[#FDCB6E]/30 text-[11px] text-slate-600">
                  <AlertCircle className="size-3.5 inline mr-1.5 text-[#FDCB6E]" />
                  {funnel.primary_bottleneck.message}
                </div>
              )}
              {funnel.population && <p className="text-[10px] text-slate-400 mt-3">{funnel.population}</p>}
            </>
          ) : (
            <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Aucune donnée sur cette période.</div>
          )}
        </div>
      )}

      {/* ─── TAB: SIGNAL QUALITY CENTER ─── */}
      {activeTab === 'quality' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-3xl border shadow-sm p-6">
              <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5 mb-4">
                <Zap className="size-4 text-slate-700" /> Learning Score
              </h3>
              {isLoadingSignalQuality ? (
                <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement…</div>
              ) : signalQuality?.learning_score ? (
                <div className="flex items-center gap-6">
                  <div className="text-center shrink-0">
                    <p className={cn(
                      'text-4xl font-black leading-none tabular-nums',
                      signalQuality.learning_score.score >= 90 ? 'text-[#00B894]' : signalQuality.learning_score.score >= 55 ? 'text-[#FDCB6E]' : 'text-[#E17055]'
                    )}>{signalQuality.learning_score.score}<span className="text-sm text-slate-300">/100</span></p>
                    <Badge className="border-none rounded-md px-1.5 py-0.5 text-[9px] font-black mt-1.5 bg-slate-100 text-slate-600">
                      {signalQuality.learning_score.label || '—'}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 flex-1">
                    {[
                      { label: 'Envois réussis', value: signalQuality.status_counts?.success ?? '—' },
                      { label: 'Échecs', value: signalQuality.status_counts?.failed ?? '—' },
                      { label: 'Déduplication', value: signalQuality.dedup_pct != null ? `${signalQuality.dedup_pct}%` : '—' },
                      { label: 'EMQ', value: signalQuality.event_match_quality != null ? `${signalQuality.event_match_quality}%` : '—' },
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
                <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                  <CheckCircle className="size-4 text-slate-700" /> Event Match Quality (EMQ)
                </h3>
                {signalQuality?.event_match_quality != null && (
                  <div className="text-right shrink-0">
                    <p className={cn(
                      'text-2xl font-black leading-none',
                      signalQuality.event_match_quality >= 80 ? 'text-[#00B894]' : signalQuality.event_match_quality >= 55 ? 'text-[#FDCB6E]' : 'text-[#E17055]'
                    )}>{signalQuality.event_match_quality}%</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-0.5">{signalQuality.sample_size} échantillon(s)</p>
                  </div>
                )}
              </div>
              {isLoadingSignalQuality ? (
                <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement…</div>
              ) : Array.isArray(signalQuality?.field_coverage) && signalQuality.field_coverage.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {signalQuality.field_coverage.map((f: any) => (
                    <div key={f.key} className="flex items-center justify-between text-[11px] p-2 rounded-lg bg-slate-50">
                      <span className="text-slate-600 font-semibold">{f.key}</span>
                      <span className={cn(
                        'font-black tabular-nums',
                        f.coverage_pct >= 80 ? 'text-[#00B894]' : f.coverage_pct >= 40 ? 'text-[#FDCB6E]' : 'text-[#E17055]'
                      )}>{f.coverage_pct != null ? `${f.coverage_pct}%` : '—'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Aucune donnée sur cette période.</div>
              )}
            </div>
          </div>

          {/* Config status + Delivery 7j/30j */}
          <div className="bg-white rounded-3xl border shadow-sm p-6">
            <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5 mb-4">
              <AlertCircle className="size-4 text-slate-700" /> Diagnostics
            </h3>
            {isLoadingDiagnostics ? (
              <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement…</div>
            ) : diagnostics ? (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <Badge className={cn(
                    "border-none rounded-md px-2 py-1 text-[10px] font-black",
                    diagnostics.config_status?.connected ? "bg-[#E6FFF8] text-[#00B894]" : "bg-[#FFEDE9] text-[#E17055]"
                  )}>
                    {diagnostics.config_status?.connected ? 'Connecté' : 'Non connecté'}
                  </Badge>
                  <Badge className={cn(
                    "border-none rounded-md px-2 py-1 text-[10px] font-black",
                    diagnostics.config_status?.pixel_configured ? "bg-[#E6FFF8] text-[#00B894]" : "bg-slate-100 text-slate-500"
                  )}>
                    Pixel {diagnostics.config_status?.pixel_configured ? 'configuré' : 'absent'}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">7 derniers jours</p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Envoyés', value: diagnostics.delivery_7d?.total_sent ?? 0 },
                        { label: 'Réussis', value: diagnostics.delivery_7d?.success ?? 0 },
                        { label: 'Couverture', value: diagnostics.delivery_7d?.tracking_coverage != null ? `${diagnostics.delivery_7d.tracking_coverage}%` : '—' },
                      ].map(s => (
                        <div key={s.label} className="text-center">
                          <p className="text-sm font-black tabular-nums text-slate-700">{s.value}</p>
                          <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border bg-slate-50 p-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">30 derniers jours</p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Envoyés', value: diagnostics.delivery_30d?.total_sent ?? 0 },
                        { label: 'Réussis', value: diagnostics.delivery_30d?.success ?? 0 },
                        { label: 'Couverture', value: diagnostics.delivery_30d?.tracking_coverage != null ? `${diagnostics.delivery_30d.tracking_coverage}%` : '—' },
                      ].map(s => (
                        <div key={s.label} className="text-center">
                          <p className="text-sm font-black tabular-nums text-slate-700">{s.value}</p>
                          <p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Aucune donnée disponible.</div>
            )}
          </div>

          {/* KPI Validation ERP <-> TikTok */}
          <div className="bg-white rounded-3xl border shadow-sm p-6">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                <CheckCircle className="size-4 text-slate-700" /> Validation ERP ↔ TikTok
              </h3>
              {kpiValidation && (
                <Badge className={cn(
                  "border-none rounded-md px-2 py-1 text-[10px] font-black",
                  (kpiValidation.gap || 0) === 0 ? "bg-[#E6FFF8] text-[#00B894]" : "bg-[#FFF8E6] text-[#FDCB6E]"
                )}>
                  {(kpiValidation.gap || 0) === 0 ? 'Aucun écart' : `Écart de ${kpiValidation.gap}`}
                </Badge>
              )}
            </div>
            <p className="text-[10px] text-slate-400 mb-4">Compare le nombre réel de commandes ERP au nombre de Purchase réellement acceptés par TikTok.</p>
            {isLoadingKpiValidation ? (
              <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement…</div>
            ) : kpiValidation ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Commandes ERP', value: kpiValidation.erp_orders_count, color: '#0984E3' },
                  { label: 'Acceptées TikTok', value: kpiValidation.tiktok_accepted_purchases, color: '#00B894' },
                  { label: 'Couverture', value: kpiValidation.coverage_pct != null ? `${kpiValidation.coverage_pct}%` : '—', color: '#6C5CE7' },
                  { label: 'Déduplication', value: kpiValidation.dedup_pct != null ? `${kpiValidation.dedup_pct}%` : '—', color: '#FDCB6E' },
                ].map(s => (
                  <div key={s.label} className="text-center p-3 rounded-2xl border bg-white" style={{ borderColor: s.color + '33' }}>
                    <p className="text-lg font-black tabular-nums" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-[9px] font-bold uppercase tracking-wider mt-0.5 text-slate-400">{s.label}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Aucune donnée sur cette période.</div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB: CATALOGUE (Catalog Health) ─── */}
      {activeTab === 'catalog' && (
        <div className="bg-white rounded-3xl border shadow-sm p-6">
          <div className="flex items-center justify-between gap-4 mb-1">
            <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
              <Package className="size-4 text-slate-700" /> Catalog Health
            </h3>
            <Button
              onClick={() => catalogSyncMutation.mutate()}
              disabled={catalogSyncMutation.isPending}
              className="h-9 rounded-xl bg-black hover:bg-slate-800 text-white text-xs font-black"
            >
              <RefreshCw className={cn('size-3.5 mr-1.5', catalogSyncMutation.isPending && 'animate-spin')} />
              Synchroniser le catalogue
            </Button>
          </div>
          <p className="text-[10px] text-slate-400 mb-5">Synchronisation incrémentale du catalogue produits vers TikTok Catalog Manager (créations, mises à jour, suppressions, ruptures de stock).</p>
          {isLoadingCatalogHealth ? (
            <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Chargement…</div>
          ) : catalogHealth ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Produits suivis', value: catalogHealth.total_tracked, color: '#0984E3' },
                  { label: 'Synchronisés', value: catalogHealth.success, color: '#00B894' },
                  { label: 'Échecs', value: catalogHealth.failed, color: catalogHealth.failed > 0 ? '#E17055' : '#B2BEC3' },
                  { label: 'Taux de réussite', value: catalogHealth.success_rate_pct != null ? `${catalogHealth.success_rate_pct}%` : '—', color: '#6C5CE7' },
                ].map(s => (
                  <div key={s.label} className="text-center p-3 rounded-2xl border bg-white" style={{ borderColor: s.color + '33' }}>
                    <p className="text-lg font-black tabular-nums" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-[9px] font-bold uppercase tracking-wider mt-0.5 text-slate-400">{s.label}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="text-center p-2.5 rounded-xl bg-slate-50">
                  <p className="text-sm font-black tabular-nums text-slate-700">{catalogHealth.avg_latency_ms != null ? `${catalogHealth.avg_latency_ms}ms` : '—'}</p>
                  <p className="text-[8px] font-bold uppercase tracking-wider mt-0.5 text-slate-400">Latence moyenne</p>
                </div>
                <div className="text-center p-2.5 rounded-xl bg-slate-50">
                  <p className="text-sm font-black tabular-nums text-slate-700">{catalogHealth.last_success_at ? new Date(catalogHealth.last_success_at).toLocaleString('fr-FR') : '—'}</p>
                  <p className="text-[8px] font-bold uppercase tracking-wider mt-0.5 text-slate-400">Dernière synchro réussie</p>
                </div>
              </div>
              {catalogHealth.errors_by_category && Object.keys(catalogHealth.errors_by_category).length > 0 && (
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Erreurs par catégorie</p>
                  <div className="space-y-1.5">
                    {Object.entries(catalogHealth.errors_by_category as Record<string, number>).map(([cat, count]) => (
                      <div key={cat} className="flex items-center justify-between text-[11px] text-slate-600 p-2 rounded-lg bg-[#FFF8E6]">
                        <span className="font-semibold">{cat}</span>
                        <span className="font-black">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Aucune donnée — configurez le Catalog ID puis synchronisez.</div>
          )}
        </div>
      )}
    </div>
  );
}
