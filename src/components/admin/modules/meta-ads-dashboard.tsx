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
  const [activeTab, setActiveTab] = useState<'roas' | 'products' | 'integration' | 'diagnostics'>('roas');
  const [selectedExpense, setSelectedExpense] = useState<any | null>(null);
  const [isFetchingRate, setIsFetchingRate] = useState(false);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);

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
    // 24h poll to conserve Neon free-tier compute — use the "Actualiser"
    // button for an on-demand refresh; the backend auto-sync still runs
    // every 3 min server-side, this just controls how often the browser polls.
    refetchInterval: 24 * 60 * 60 * 1000,
  });

  // --- Products (for the manual campaign -> product link picker) ---
  const { data: metaProductsData } = useQuery({
    queryKey: ['admin-products-lite', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/products?store_id=${activeStore?.id}&minimal=true`),
    enabled: !!activeStore?.id,
  });
  const metaProducts = metaProductsData?.data ?? [];

  const linkProductMutation = useMutation({
    mutationFn: ({ campaignId, productId }: { campaignId: string; productId: string | null }) =>
      apiFetch(`/api/v1/meta-ads/campaigns/${campaignId}/product`, {
        method: 'PATCH',
        body: JSON.stringify({ product_id: productId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meta_ads_campaigns'] });
      toast.success('Campagne liée au produit');
    },
    onError: (err: any) => toast.error(err.message || 'Échec de la liaison produit'),
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

  // --- Tracking health (Pixel / CAPI / attribution / catalog) ---
  const { data: diagnosticsData } = useQuery({
    queryKey: ['meta_ads_diagnostics', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any }>(
      `/api/v1/meta-ads/diagnostics?store_id=${activeStore?.id}`
    ),
    enabled: !!activeStore?.id,
    refetchInterval: 24 * 60 * 60 * 1000,
  });

  // --- Rule-based optimization recommendations ---
  const { data: recommendationsData } = useQuery({
    queryKey: ['meta_ads_recommendations', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(
      `/api/v1/meta-ads/recommendations?store_id=${activeStore?.id}`
    ),
    enabled: !!activeStore?.id,
    refetchInterval: 24 * 60 * 60 * 1000,
  });

  // --- Live connectivity/token/circuit-breaker diagnostic ---
  const { data: healthData, isLoading: isLoadingHealth, refetch: refetchHealth } = useQuery({
    queryKey: ['meta_ads_health', activeStore?.id],
    queryFn: () => apiFetch<any>(`/api/v1/meta-ads/health?store_id=${activeStore?.id}`),
    enabled: !!activeStore?.id && activeTab === 'diagnostics',
    refetchInterval: 24 * 60 * 60 * 1000,
  });

  const retryNowMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/meta-ads/capi-logs/retry-now?store_id=${activeStore?.id}`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Nouvelle tentative déclenchée en arrière-plan');
      setTimeout(() => refetchHealth(), 3_000);
    },
    onError: (err: any) => toast.error(err.message || 'Erreur lors du déclenchement'),
  });

  // --- Mutations ---
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
      // Without this, the sync always pulled Meta's fixed "last 30 days"
      // regardless of the range picked above — spend/history older than
      // that could never be fetched no matter what was selected here.
      return apiFetch(`/api/v1/meta-ads/sync?store_id=${activeStore?.id}&date_start=${dateStart}&date_end=${dateEnd}`, {
        method: 'POST'
      });
    },
    onSuccess: (res: any) => {
      console.log('[Meta Ads Sync] Résultat de la synchronisation:', res);
      queryClient.invalidateQueries({ queryKey: ['meta_ads_campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['meta_ads_integration'] });
      if (res?.success) {
        toast.success(res?.message || 'Synchronisation Meta Ads réussie !', {
          description: 'Dépenses liées aux charges & finance automatiquement.'
        });
      } else {
        toast.error(res?.message || 'Connexion Meta invalide — vérifiez le token et le compte publicitaire.');
      }
    },
    onError: (err: any) => {
      console.error('[Meta Ads Sync] Échec de la synchronisation:', err);
      toast.error('Échec de la synchro', { description: err.message });
    }
  });

  const config = configData?.data || { is_connected: false, access_token: '', ad_account_id: '', exchange_rate: 1.0, currency: 'USD' };
  const campaigns = Array.isArray(campaignsData?.data) ? campaignsData.data : [];
  const productsBreakdown = Array.isArray(campaignsData?.products_breakdown) ? campaignsData.products_breakdown : [];
  const summary = campaignsData?.summary || { total_spend: 0, total_revenue: 0, total_orders: 0, global_roas: 0 };

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

  const diag = diagnosticsData?.data;
  const recommendations = Array.isArray(recommendationsData?.data) ? recommendationsData.data : [];

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

      {/* ─── SANTÉ DU TRACKING (Pixel / CAPI / Attribution / Catalogue) ─── */}
      {diag && (
        <div className="bg-white p-6 rounded-3xl border shadow-sm space-y-4">
          <h2 className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
            <CheckCircle className="size-4 text-[#00B894]" /> Santé du tracking
            <span className="text-[9px] font-bold text-slate-400 normal-case tracking-normal">(mise à jour automatique)</span>
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
            <div className={cn("rounded-2xl border p-3", diag.pixel?.configured ? "bg-emerald-50 border-emerald-100" : "bg-rose-50 border-rose-100")}>
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Pixel</p>
              <p className={cn("text-sm font-black mt-1", diag.pixel?.configured ? "text-emerald-600" : "text-rose-600")}>
                {diag.pixel?.configured ? 'Actif' : 'Non configuré'}
              </p>
            </div>
            <div className={cn("rounded-2xl border p-3", diag.capi?.configured ? "bg-emerald-50 border-emerald-100" : "bg-rose-50 border-rose-100")}>
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">CAPI (serveur)</p>
              <p className={cn("text-sm font-black mt-1", diag.capi?.configured ? "text-emerald-600" : "text-rose-600")}>
                {diag.capi?.configured ? 'Actif' : 'Non configuré'}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Événements 7j</p>
              <p className="text-sm font-black mt-1 text-slate-800">
                {diag.capi?.sent_7d ?? 0} ✓ {(diag.capi?.errors_7d ?? 0) > 0 && <span className="text-rose-500">· {diag.capi.errors_7d} ✗</span>}
              </p>
              {diag.capi?.success_rate != null && <p className="text-[9px] font-bold text-slate-400">{diag.capi.success_rate}% succès</p>}
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Déduplication</p>
              <p className="text-sm font-black mt-1 text-slate-800">event_id partagé</p>
              <p className="text-[9px] font-bold text-emerald-600">100% des événements</p>
            </div>
            <div className={cn("rounded-2xl border p-3", (diag.attribution?.fbp_rate ?? 0) >= 50 ? "bg-emerald-50 border-emerald-100" : "bg-amber-50 border-amber-100")}>
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Signal fbp (30j)</p>
              <p className="text-sm font-black mt-1 text-slate-800">{diag.attribution?.fbp_rate ?? 0}%</p>
              <p className="text-[9px] font-bold text-slate-400">{diag.attribution?.with_fbp ?? 0}/{diag.attribution?.orders_30d ?? 0} commandes</p>
            </div>
            <div className={cn("rounded-2xl border p-3",
              (diag.catalog?.missing_image?.length || diag.catalog?.ephemeral_image_urls?.length) ? "bg-amber-50 border-amber-100" : "bg-emerald-50 border-emerald-100")}>
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Catalogue</p>
              <p className="text-sm font-black mt-1 text-slate-800">{diag.catalog?.active_products ?? 0} produits</p>
              {(diag.catalog?.missing_image?.length || 0) + (diag.catalog?.ephemeral_image_urls?.length || 0) > 0 ? (
                <p className="text-[9px] font-bold text-amber-600">
                  {(diag.catalog?.missing_image?.length || 0) + (diag.catalog?.ephemeral_image_urls?.length || 0)} image(s) à corriger
                </p>
              ) : (
                <p className="text-[9px] font-bold text-emerald-600">Aucune erreur</p>
              )}
            </div>
          </div>
          {diag.capi?.last_error && (
            <div className="rounded-2xl bg-rose-50 border border-rose-100 p-3 text-[11px] font-bold text-rose-700">
              Dernière erreur CAPI ({diag.capi.last_error.event}) : {diag.capi.last_error.message}
            </div>
          )}
          {(diag.catalog?.ephemeral_image_urls?.length || 0) > 0 && (
            <div className="rounded-2xl bg-amber-50 border border-amber-100 p-3 text-[11px] font-bold text-amber-700">
              ⚠️ Images non permanentes (exclues du feed) : {diag.catalog.ephemeral_image_urls.join(', ')} — re-téléversez-les depuis la fiche produit.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Feed catalogue (Dynamic Ads / Advantage+) :</span>
            <code className="text-[10px] font-bold bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 select-all">
              {`${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/meta-ads/catalog-feed?store_id=${activeStore?.id}`}
            </code>
            <span className="text-[9px] font-bold text-slate-400">→ à coller dans Meta Commerce Manager (flux de données planifié)</span>
          </div>
        </div>
      )}

      {/* ─── FILE DE REPRISE CAPI (monitoring opérationnel) ─── */}
      {diag && (
        <div className="bg-white p-6 rounded-3xl border shadow-sm space-y-4">
          <h2 className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
            <RefreshCw className="size-4 text-[#4b7bec]" /> File de reprise Meta CAPI
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <div className={cn("rounded-2xl border p-3", (diag.queue?.pending_count ?? 0) > 0 ? "bg-amber-50 border-amber-100" : "bg-emerald-50 border-emerald-100")}>
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">En attente</p>
              <p className="text-sm font-black mt-1 text-slate-800">{diag.queue?.pending_count ?? 0}</p>
            </div>
            <div className={cn("rounded-2xl border p-3", (diag.queue?.failed_count ?? 0) > 0 ? "bg-rose-50 border-rose-100" : "bg-emerald-50 border-emerald-100")}>
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Échecs définitifs</p>
              <p className="text-sm font-black mt-1 text-slate-800">{diag.queue?.failed_count ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Événement le + ancien en attente</p>
              <p className="text-sm font-black mt-1 text-slate-800">{diag.queue?.oldest_pending_event ?? '—'}</p>
              <p className="text-[9px] font-bold text-slate-400">{diag.queue?.oldest_pending_at ? new Date(diag.queue.oldest_pending_at).toLocaleString('fr-FR') : ''}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Latence (moy / P95 / P99)</p>
              <p className="text-sm font-black mt-1 text-slate-800">
                {diag.queue?.avg_latency_ms != null ? `${diag.queue.avg_latency_ms}` : '—'}
                {' / '}{diag.queue?.p95_latency_ms ?? '—'}
                {' / '}{diag.queue?.p99_latency_ms ?? '—'} ms
              </p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Événements retentés (7j)</p>
              <p className="text-sm font-black mt-1 text-slate-800">{diag.queue?.retried_count_7d ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Délai moyen avant succès</p>
              <p className="text-sm font-black mt-1 text-slate-800">
                {diag.queue?.avg_time_to_success_s != null ? `${Math.round(diag.queue.avg_time_to_success_s)} s` : '—'}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Tentatives max / événement</p>
              <p className="text-sm font-black mt-1 text-slate-800">{diag.queue?.max_retries_configured ?? '—'}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 col-span-2 md:col-span-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Erreurs 7j — réseau vs API Meta</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {Object.entries(diag.queue?.error_categories_7d ?? {}).length === 0 && (
                  <span className="text-[11px] font-bold text-emerald-600">Aucune erreur</span>
                )}
                {Object.entries(diag.queue?.error_categories_7d ?? {}).map(([cat, count]) => {
                  const isNetwork = cat.startsWith('network');
                  const label: Record<string, string> = {
                    network_timeout: 'Timeout réseau', network_error: 'Erreur réseau',
                    api_4xx: 'Erreur API (config/jeton)', api_5xx: 'Erreur serveur Meta', unknown: 'Non catégorisé',
                  };
                  return (
                    <span key={cat} className={cn(
                      "px-2 py-1 rounded-full text-[10px] font-black",
                      isNetwork ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"
                    )}>
                      {label[cat] || cat}: {count as number}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Dernière synchro réussie</p>
              <p className="text-sm font-black mt-1 text-slate-800">{diag.queue?.last_synced_at ? new Date(diag.queue.last_synced_at).toLocaleString('fr-FR') : '—'}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Taux d'échec 7j</p>
              <p className="text-sm font-black mt-1 text-slate-800">
                {diag.capi?.success_rate != null ? `${(100 - diag.capi.success_rate).toFixed(1)}%` : '—'}
              </p>
            </div>
          </div>
          <CapiLogsTable storeId={activeStore?.id} />
        </div>
      )}

      {/* ─── RECOMMANDATIONS D'OPTIMISATION ─── */}
      {recommendations.length > 0 && (
        <div className="bg-white p-6 rounded-3xl border shadow-sm space-y-3">
          <h2 className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
            <TrendingUp className="size-4 text-[#6C5CE7]" /> Recommandations d'optimisation
          </h2>
          <div className="space-y-2">
            {recommendations.map((r: any, i: number) => (
              <div key={i} className={cn(
                "rounded-2xl border p-3 flex items-start gap-3",
                r.severity === 'high' ? 'bg-rose-50/60 border-rose-100' :
                r.severity === 'medium' ? 'bg-amber-50/60 border-amber-100' : 'bg-emerald-50/60 border-emerald-100'
              )}>
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[9px] font-black uppercase shrink-0 mt-0.5",
                  r.severity === 'high' ? 'bg-rose-100 text-rose-700' :
                  r.severity === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                )}>
                  {r.severity === 'high' ? 'Priorité' : r.severity === 'medium' ? 'À traiter' : 'Opportunité'}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-black text-slate-800">{r.title}</p>
                  <p className="text-[11px] font-medium text-slate-500 mt-0.5 leading-snug">{r.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
            {summary.raw_spend_by_currency && Object.keys(summary.raw_spend_by_currency).length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {Object.entries(summary.raw_spend_by_currency as Record<string, number>).map(([cur, amt]) => (
                  <span key={cur} className="text-[9px] font-black text-[#636E72] bg-slate-50 border border-slate-100 rounded-md px-1.5 py-0.5 tabular-nums">
                    {amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {cur}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-[9px] font-bold text-[#636E72] uppercase">
                Devises converties dynamiquement en DZD
              </span>
            )}
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

      {/* ─── MICRO-MÉTRIQUES GLOBALES ─── */}
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
          { label: 'Achats déclarés par Meta', value: (summary.global_meta_purchases || 0).toLocaleString(), hint: `${formatPrice(summary.global_meta_purchase_value || 0)} déclarés` },
          { label: 'Écart vs nos commandes', value: `${(summary.global_conversion_gap || 0) > 0 ? '+' : ''}${summary.global_conversion_gap || 0}`, hint: 'Fenêtres d\'attribution différentes', highlight: (summary.global_conversion_gap || 0) === 0 },
        ].map((m: any) => (
          <div key={m.label} className="bg-white p-3 rounded-2xl border shadow-sm">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#B2BEC3]">{m.label}</p>
            <p className={cn(
              "text-sm font-black tabular-nums mt-1",
              m.highlight === undefined ? "text-[#2D3436]" : m.highlight ? "text-[#00B894]" : "text-[#E17055]"
            )}>{m.value}</p>
            <p className="text-[9px] text-slate-400 mt-0.5">{m.hint}</p>
          </div>
        ))}
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
                          <p className="text-xs text-slate-300">
                            {config.is_connected
                              ? 'Cliquez sur "Synchroniser" — si rien n\'apparaît, le token ou l\'ID du compte publicitaire est invalide.'
                              : 'Connectez d\'abord votre vrai compte Meta (token + ID compte pub), puis cliquez sur "Synchroniser". Aucune donnée fictive n\'est affichée.'}
                          </p>
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
                         <td className="px-6 py-5" onClick={e => e.stopPropagation()}>
                            <div className="space-y-1.5">
                              {c.product_name ? (
                                <div className="flex items-center gap-2">
                                  {c.product_image && (
                                    <img src={c.product_image} alt={c.product_name} className="size-8 rounded-lg object-cover border border-slate-100 shrink-0" />
                                  )}
                                  <div>
                                    <p className="text-xs font-black text-slate-700 leading-tight">{c.product_name}</p>
                                    {c.product_sku && <p className="text-[10px] text-slate-400 font-mono">{c.product_sku}</p>}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-[10px] text-slate-300 italic">Non identifié</span>
                              )}
                              {/* Manual link — plusieurs ad sets peuvent cibler le même
                                  produit sous des noms de campagne arbitraires ; l'attribution
                                  automatique (UTM ou nom) rate ces cas, ce sélecteur force le
                                  rattachement une bonne fois pour toutes. */}
                              <select
                                value={c.product_id || ''}
                                onChange={ev => linkProductMutation.mutate({ campaignId: c.campaign_id || c.id, productId: ev.target.value || null })}
                                className="text-[10px] font-bold bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 max-w-[160px] outline-none cursor-pointer text-slate-500"
                              >
                                <option value="">— Lier un produit —</option>
                                {metaProducts.map((p: any) => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                            </div>
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
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
                              <div className="bg-white rounded-xl p-3 border-2 border-[#6C5CE7]/30">
                                <p className="text-[9px] font-black uppercase tracking-widest text-[#6C5CE7]">Achats déclarés par Meta</p>
                                <p className="text-sm font-black text-slate-700 mt-1 tabular-nums">{c.meta_purchases || 0}</p>
                                <p className="text-[9px] text-slate-400">
                                  {formatPrice(c.meta_purchase_value || 0)} · conv. {c.meta_conversion_rate || 0}%
                                </p>
                                {c.conversion_gap !== 0 && (
                                  <p className={cn("text-[9px] font-bold mt-0.5", c.conversion_gap > 0 ? "text-[#0984E3]" : "text-[#E17055]")}>
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
                                <p className={cn("text-sm font-black mt-1 tabular-nums", (c.profit || 0) >= 0 ? "text-[#00B894]" : "text-[#E17055]")}>{formatPrice(c.profit || 0)}</p>
                                <p className="text-[9px] text-slate-400">Panier moyen {c.orders_count > 0 ? formatPrice(c.aov || 0) : '—'}</p>
                              </div>
                            </div>
                            {c.product_name && (
                              <div className="mt-3 flex items-center gap-2 text-[10px] text-[#6C5CE7] font-black">
                                <Package className="size-3" />
                                Attribution : produit «{c.product_name}» identifié {c.product_sku ? `(SKU: ${c.product_sku})` : 'par correspondance du nom de campagne'}
                              </div>
                            )}
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

      {/* ─── TAB: DIAGNOSTICS ─── */}
      {activeTab === 'diagnostics' && (
        <div className="space-y-4">
          <div className="bg-white rounded-3xl border shadow-sm p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="size-4 text-[#0984E3]" /> Diagnostic Connexion Meta
                </h3>
                <p className="text-[10px] text-slate-400 mt-1">
                  Vérifie en direct la validité du token, l&apos;accessibilité du pixel, le disjoncteur (circuit breaker) et la file d&apos;attente CAPI.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => refetchHealth()} disabled={isLoadingHealth}>
                <RefreshCw className={cn("size-3.5 mr-1.5", isLoadingHealth && "animate-spin")} /> Actualiser
              </Button>
            </div>

            {isLoadingHealth && !healthData ? (
              <div className="mt-6 rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Vérification en cours…</div>
            ) : healthData ? (
              <div className="mt-6 space-y-4">
                {(healthData.warnings?.length ?? 0) > 0 && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-1.5">
                    {healthData.warnings.map((w: string, i: number) => (
                      <p key={i} className="text-[11px] font-bold text-amber-700">⚠️ {w}</p>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className={cn("rounded-2xl border p-3", healthData.token?.status === 'valid' ? "bg-emerald-50 border-emerald-100" : "bg-rose-50 border-rose-100")}>
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Access Token</p>
                    <p className="text-sm font-black mt-1 text-slate-800">{healthData.token?.status ?? '—'}</p>
                  </div>
                  <div className={cn("rounded-2xl border p-3", healthData.token_scopes?.has_ads_management ? "bg-emerald-50 border-emerald-100" : "bg-rose-50 border-rose-100")}>
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Permission ads_management</p>
                    <p className="text-sm font-black mt-1 text-slate-800">{healthData.token_scopes?.has_ads_management ? 'Accordée' : 'Absente'}</p>
                  </div>
                  <div className={cn("rounded-2xl border p-3", healthData.pixel?.status === 'accessible' ? "bg-emerald-50 border-emerald-100" : "bg-rose-50 border-rose-100")}>
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Pixel</p>
                    <p className="text-sm font-black mt-1 text-slate-800">{healthData.pixel?.status ?? '—'}</p>
                  </div>
                  <div className={cn("rounded-2xl border p-3", healthData.circuit_breaker?.is_open ? "bg-rose-50 border-rose-100" : "bg-emerald-50 border-emerald-100")}>
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Disjoncteur</p>
                    <p className="text-sm font-black mt-1 text-slate-800">{healthData.circuit_breaker?.is_open ? 'Ouvert' : 'Fermé'}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-[#F8F9FC] rounded-2xl border">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">File d&apos;attente CAPI</p>
                    <p className="text-sm font-black text-slate-800 mt-1">
                      {healthData.queue?.pending_count ?? 0} événement(s) en attente
                      {healthData.queue?.oldest_age_minutes != null && ` — le plus ancien depuis ${healthData.queue.oldest_age_minutes} min`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => retryNowMutation.mutate()}
                    disabled={retryNowMutation.isPending || !healthData.queue?.pending_count}
                  >
                    <RefreshCw className={cn("size-3.5 mr-1.5", retryNowMutation.isPending && "animate-spin")} /> Relancer maintenant
                  </Button>
                </div>

                <div className="text-[10px] text-slate-400 font-medium">
                  API Meta : v{healthData.api_version} · Python {healthData.versions?.python} · OpenSSL {healthData.versions?.openssl}
                  {healthData.last_success_at && ` · Dernier succès : ${new Date(healthData.last_success_at).toLocaleString('fr-FR')}`}
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-2xl border bg-slate-50 p-6 text-sm text-slate-500">Aucune donnée disponible.</div>
            )}
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

/** Filterable operational table over meta_capi_logs — store/date/type/status. */
function CapiLogsTable({ storeId }: { storeId?: string }) {
  const [statusFilter, setStatusFilter] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const purgeMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/meta-ads/capi-logs/pending?store_id=${storeId}`, { method: 'DELETE' }),
    onSuccess: (res: any) => {
      toast.success(`${res?.cancelled ?? 0} événement(s) annulé(s)`);
      refetch();
    },
    onError: () => toast.error('Erreur lors de la purge'),
  });

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['meta_capi_logs', storeId, statusFilter, eventFilter, dateFrom, dateTo],
    queryFn: () => {
      const params = new URLSearchParams({ store_id: storeId || '' });
      if (statusFilter) params.set('status', statusFilter);
      if (eventFilter) params.set('event_name', eventFilter);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      return apiFetch<{ success: boolean; data: any[] }>(`/api/v1/meta-ads/capi-logs?${params.toString()}`);
    },
    enabled: !!storeId,
  });

  const rows = data?.data ?? [];
  const statusLabel: Record<string, string> = {
    success: 'Envoyé', error: 'Échec', pending_retry: 'En reprise', failed: 'Abandonné',
  };
  const statusColor: Record<string, string> = {
    success: 'text-emerald-600 bg-emerald-50', error: 'text-rose-600 bg-rose-50',
    pending_retry: 'text-amber-600 bg-amber-50', failed: 'text-slate-500 bg-slate-100',
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="text-[10px] font-bold border rounded-lg px-2 py-1.5 bg-white">
          <option value="">Tous statuts</option>
          <option value="success">Envoyé</option>
          <option value="error">Échec</option>
          <option value="pending_retry">En reprise</option>
          <option value="failed">Abandonné</option>
        </select>
        <select value={eventFilter} onChange={e => setEventFilter(e.target.value)}
          className="text-[10px] font-bold border rounded-lg px-2 py-1.5 bg-white">
          <option value="">Tous événements</option>
          <option value="PageView">PageView</option>
          <option value="ViewContent">ViewContent</option>
          <option value="AddToCart">AddToCart</option>
          <option value="InitiateCheckout">InitiateCheckout</option>
          <option value="Purchase">Purchase</option>
          <option value="Lead">Lead</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="text-[10px] font-bold border rounded-lg px-2 py-1.5 bg-white" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="text-[10px] font-bold border rounded-lg px-2 py-1.5 bg-white" />
        <button onClick={() => refetch()} className="text-[10px] font-black uppercase px-3 py-1.5 rounded-lg border bg-slate-50 hover:bg-slate-100">
          {isFetching ? '…' : 'Rafraîchir'}
        </button>
        <button
          onClick={() => purgeMutation.mutate()}
          disabled={purgeMutation.isPending}
          className="text-[10px] font-black uppercase px-3 py-1.5 rounded-lg border bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-50"
        >
          {purgeMutation.isPending ? '…' : 'Vider la file'}
        </button>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-100">
        <table className="w-full text-[10px]">
          <thead className="bg-slate-50 text-slate-400 uppercase font-black tracking-wider">
            <tr>
              <th className="text-left px-3 py-2">Événement</th>
              <th className="text-left px-3 py-2">Statut</th>
              <th className="text-left px-3 py-2">Tentatives</th>
              <th className="text-left px-3 py-2">Latence</th>
              <th className="text-left px-3 py-2">Prochaine reprise</th>
              <th className="text-left px-3 py-2">Erreur</th>
              <th className="text-left px-3 py-2">Créé</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-400 font-bold">Chargement…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-400 font-bold">Aucun événement pour ces filtres</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-50">
                <td className="px-3 py-2 font-bold text-slate-700">{r.event_name}</td>
                <td className="px-3 py-2">
                  <span className={cn("px-2 py-0.5 rounded-full font-black", statusColor[r.status] || 'bg-slate-100 text-slate-500')}>
                    {statusLabel[r.status] || r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-500">{r.retry_count}</td>
                <td className="px-3 py-2 text-slate-500">{r.latency_ms != null ? `${r.latency_ms} ms` : '—'}</td>
                <td className="px-3 py-2 text-slate-500">{r.next_retry_at ? new Date(r.next_retry_at).toLocaleString('fr-FR') : '—'}</td>
                <td className="px-3 py-2 text-rose-500 max-w-[220px] truncate" title={r.error_message || ''}>{r.error_message || '—'}</td>
                <td className="px-3 py-2 text-slate-400">{r.created_at ? new Date(r.created_at).toLocaleString('fr-FR') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
