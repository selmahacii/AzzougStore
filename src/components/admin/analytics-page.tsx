'use client';

import React, { useState } from 'react';
import {
   BarChart3,
   Filter,
   Wallet,
   CreditCard,
   Target,
   Users,
   Truck,
   TrendingUp,
   DollarSign,
   ShoppingCart,
   CheckCircle,
   Package,
   MapPin,
   Share2,
   UserCheck,
   RefreshCw,
   Megaphone,
   Loader2,
   AlertCircle,
   Activity,
   Cpu,
   Zap,
   Network,
   Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/store/app-store';
import type { ApiResponse, KpiData, RevenueDataPoint, TopItem } from '@/lib/types';
import { formatPrice } from '@/lib/format';
import { Skeleton } from '@/components/ui/skeleton';
import {
   ResponsiveContainer,
   AreaChart,
   CartesianGrid,
   XAxis,
   YAxis,
   Tooltip as RechartsTooltip,
   Area,
   LineChart,
   Line,
   BarChart,
   Bar,
   PieChart,
   Pie,
   Cell,
   Legend
} from 'recharts';
import { apiFetch } from '@/lib/api-client';

// ═══════════════════════════════════════════════════════════════
// CODpilot Color System
// ═══════════════════════════════════════════════════════════════
const C = {
   primary: '#6C5CE7',
   primaryBg: '#F0EDFF',
   success: '#00B894',
   successBg: '#E6FFF8',
   warning: '#FDCB6E',
   warningBg: '#FFF8E6',
   danger: '#E17055',
   dangerBg: '#FFEDE9',
   info: '#0984E3',
   infoBg: '#E8F4FE',
   orange: '#FD7014',
   orangeBg: '#FFF3E8',
   text: '#2D3436',
   textLight: '#636E72',
   textDim: '#B2BEC3',
   border: '#E9ECF0',
   bg: '#F8F9FC',
};

function MetricRow({ label, value, suffix = "DA", badge, description }: {
   label: string; value: string | number; suffix?: string; badge?: string; description?: string;
}) {
   return (
      <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50/60 px-3 -mx-3 rounded-xl transition-colors">
         <div>
            <span className="text-xs font-bold text-slate-700 block">{label}</span>
            {description && <span className="text-[10px] text-slate-400 leading-tight block mt-0.5 max-w-[240px]">{description}</span>}
         </div>
         <div className="flex items-center gap-1.5">
            <span className="text-xs sm:text-sm font-black text-slate-900 font-mono tabular-nums">{value}</span>
            {suffix && <span className="text-[10px] font-bold text-slate-400 font-mono">{suffix}</span>}
            {badge && (
               <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">{badge}</span>
            )}
         </div>
      </div>
   );
}

function PerformanceGauge({ label, value, color, description }: { label: string; value: number; color: string; description?: string; }) {
   const radius = 36;
   const circumference = 2 * Math.PI * radius;
   const offset = circumference - (Math.min(value, 100) / 100) * circumference;
   return (
      <div className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-slate-50/60 border border-slate-100 w-full hover:bg-white transition-all">
         <div className="relative size-20">
            <svg className="size-full transform -rotate-90">
               <circle cx="40" cy="40" r={radius} className="fill-transparent stroke-slate-200/60" strokeWidth="6" />
               <circle cx="40" cy="40" r={radius} className="fill-transparent transition-all duration-1000"
                  stroke={color} strokeWidth="6" strokeLinecap="round"
                  style={{ strokeDasharray: circumference, strokeDashoffset: offset }}
               />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center flex-col">
               <span className="text-xs font-black font-mono tabular-nums text-slate-900">{value}%</span>
            </div>
         </div>
         <div className="flex flex-col items-center text-center">
            <span className="text-[11px] font-black text-slate-800 uppercase tracking-tight">{label}</span>
            {description && <span className="text-[9px] text-slate-400 leading-tight mt-0.5 max-w-[120px]">{description}</span>}
         </div>
      </div>
   );
}

function SectionPanel({ title, icon: Icon, iconColor, borderColor, children }: {
   title: string; icon: React.ElementType; iconColor: string; borderColor?: string; children: React.ReactNode;
}) {
   return (
      <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 p-5 sm:p-6 shadow-sm space-y-4">
         <div className="flex items-center gap-3 border-b border-slate-100 pb-3.5">
            <div className="size-8 sm:size-9 rounded-xl flex items-center justify-center shadow-2xs shrink-0" style={{ backgroundColor: iconColor + '15' }}>
               <Icon className="size-4" style={{ color: iconColor }} />
            </div>
            <div>
               <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight">{title}</h3>
            </div>
         </div>
         <div>
            {children}
         </div>
      </div>
   );
}

function EmptyState({ message = "Aucune donnée disponible" }) {
   return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
         <AlertCircle className="size-8 text-[#B2BEC3] mb-2" />
         <p className="text-sm font-semibold text-[#B2BEC3]">{message}</p>
      </div>
   );
}

// ═══════════════════════════════════════════════════════════════
// Main Analytics Page
// ═══════════════════════════════════════════════════════════════

export default function AnalyticsPage() {
   const { activeStore, adminSubView } = useAppStore();
   const storeId = activeStore?.id ?? '';
   const [period, setPeriod] = useState('30d');

   const normalizeSubView = (sv: string | null) => {
      if (!sv) return 'kpi';
      if (['Commandes', 'Intelligence Commandes', 'orders'].includes(sv)) return 'orders';
      if (['Canaux de vente', 'channels'].includes(sv)) return 'channels';
      if (['Produits', 'Top Produits', 'products'].includes(sv)) return 'products';
      if (['Livraison', 'Logistique & Livraison', 'shipping'].includes(sv)) return 'shipping';
      if (['Wilayas', 'Matrice Wilayas', 'wilayas'].includes(sv)) return 'wilayas';
      if (['Agents de Confirmation', 'Agents de Suivi', 'Télémétrie Agents', 'agents'].includes(sv)) return 'agents';
      if (['Marketer', 'Ventes Marketers', 'marketers'].includes(sv)) return 'marketers';
      if (['Système', 'Télémétrie', 'system'].includes(sv)) return 'system';
      return 'kpi';
   };

   const TAB_INFO: Record<string, { label: string; icon: any }> = {
      kpi: { label: 'Vue d\'ensemble & KPI', icon: BarChart3 },
      orders: { label: 'Statistiques des Commandes', icon: ShoppingCart },
      channels: { label: 'Performance des Canaux', icon: Share2 },
      products: { label: 'Analyse des Ventes Produits', icon: Package },
      shipping: { label: 'Suivi des Livraisons', icon: Truck },
      wilayas: { label: 'Répartition Géographique', icon: MapPin },
      agents: { label: 'Activité des Confimateurs', icon: UserCheck },
      marketers: { label: 'Performance Marketers', icon: Megaphone },
      system: { label: 'Télémétrie Système', icon: Activity },
   };

   const [activeTab, setActiveTab] = useState(normalizeSubView(adminSubView));

   React.useEffect(() => {
      setActiveTab(normalizeSubView(adminSubView));
   }, [adminSubView]);


   const kpiQuery = useQuery<ApiResponse<KpiData>>({
      queryKey: ['analytics', 'kpi', storeId, period],
      queryFn: () => apiFetch(`/api/v1/analytics?store_id=${storeId}&type=kpi&period=${period}`),
   });

   const revenueQuery = useQuery<ApiResponse<RevenueDataPoint[]>>({
      queryKey: ['analytics', 'revenue', storeId, period],
      queryFn: () => apiFetch(`/api/v1/analytics?store_id=${storeId}&type=revenue&period=${period}`),
   });

   const metaAdsQuery = useQuery<{ success: boolean; data: any }>({
      queryKey: ['analytics', 'meta-ads-summary', storeId],
      queryFn: () => apiFetch(`/api/v1/meta-ads/integration-summary?store_id=${storeId}`),
      enabled: !!storeId,
   });

   const genericQuery = useQuery<ApiResponse<any>>({
      queryKey: ['analytics', activeTab, storeId, period],
      queryFn: () => apiFetch(`/api/v1/analytics?store_id=${storeId}&type=${activeTab}&period=${period}`),
      enabled: !!storeId && activeTab !== 'kpi' && activeTab !== 'orders',
   });

   const kpi = kpiQuery.data?.data;
   const chartData = (revenueQuery.data?.data ?? []).map((d) => ({
      ...d,
      date: new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
   }));

   const tooltipStyle = {
      backgroundColor: '#FFFFFF',
      border: '1px solid #E9ECF0',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      padding: '10px 14px',
      fontSize: '12px',
      color: '#2D3436',
   };

   const metaSummary = metaAdsQuery.data?.data;
   const metaSpendDzd = metaSummary?.total_spend_dzd || 0;

   const totalOrdersCount = kpi?.totalOrders || 0;
   const confirmedOrdersCount = kpi?.confirmedOrders || 0;
   const deliveredOrdersCount = kpi?.deliveredOrders || 0;
   const returnedOrdersCount = kpi?.returnedOrders || 0;

   // Confirmation performance fallback
   const calculatedConfirmation = (kpi?.confirmationPerformance && kpi.confirmationPerformance > 0)
      ? kpi.confirmationPerformance
      : (totalOrdersCount > 0 ? Math.round((confirmedOrdersCount / totalOrdersCount) * 100) : 0);

   // Delivery performance fallback
   const calculatedDelivery = (kpi?.deliveryPerformance && kpi.deliveryPerformance > 0)
      ? kpi.deliveryPerformance
      : (confirmedOrdersCount > 0 ? Math.round((deliveredOrdersCount / confirmedOrdersCount) * 100) : (totalOrdersCount > 0 ? Math.round((deliveredOrdersCount / totalOrdersCount) * 100) : 0));

   // Return rate fallback
   const calculatedReturn = (kpi?.returnRate && kpi.returnRate > 0)
      ? kpi.returnRate
      : (totalOrdersCount > 0 ? Math.round((returnedOrdersCount / totalOrdersCount) * 100) : 0);

   // Profit & Margins
   const calculatedProfit = kpi?.totalProfit 
      ? kpi.totalProfit 
      : (kpi?.profitPerOrder && kpi?.deliveredOrders ? (kpi.profitPerOrder * kpi.deliveredOrders) : 0);
   const profitMarginPct = kpi?.totalRevenue && kpi.totalRevenue > 0 && calculatedProfit > 0
      ? ((calculatedProfit / kpi.totalRevenue) * 100).toFixed(1)
      : '0.0';

   // Dynamic CAC
   const calculatedCac = (kpi?.cac && kpi.cac > 0)
      ? kpi.cac
      : (metaSpendDzd > 0 && deliveredOrdersCount > 0
         ? Math.round(metaSpendDzd / deliveredOrdersCount)
         : (metaSpendDzd > 0 && totalOrdersCount > 0 ? Math.round(metaSpendDzd / totalOrdersCount) : 0));

   // Dynamic ROI / ROAS
   const calculatedRoas = (kpi?.roas && kpi.roas > 0)
      ? `${kpi.roas}%`
      : (metaSpendDzd > 0 && (kpi?.totalRevenue || 0) > 0
         ? `${((kpi!.totalRevenue / metaSpendDzd) * 100).toFixed(0)}%`
         : (profitMarginPct !== '0.0' ? `+${profitMarginPct}%` : '0%'));

   // Sales chart metrics
   const totalChartRevenue = (revenueQuery.data?.data ?? []).reduce((acc, d) => acc + (d.orderRevenue || 0) + (d.posRevenue || 0), 0);
   const bestDayRevenue = (revenueQuery.data?.data ?? []).reduce((max, d) => Math.max(max, (d.orderRevenue || 0) + (d.posRevenue || 0)), 0);
   const daysCount = (revenueQuery.data?.data ?? []).length;
   const dailyAverage = daysCount > 0 ? Math.round(totalChartRevenue / daysCount) : 0;

   return (
      <div className="p-3 sm:p-6 lg:p-8 space-y-4 sm:space-y-6 max-w-[1600px] mx-auto w-full pb-28 animate-in fade-in duration-500">

         {/* ─── Executive Header ─── */}
         <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 p-4 sm:p-6 lg:p-7 shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 sm:gap-6 relative overflow-hidden">
            <div className="flex items-center gap-3.5 sm:gap-5 relative z-10">
               <div className="size-10 sm:size-12 rounded-xl sm:rounded-2xl bg-indigo-50 text-[#4b7bec] flex items-center justify-center text-lg sm:text-xl shadow-xs shrink-0">
                  {React.createElement(TAB_INFO[activeTab]?.icon || BarChart3, { 
                     className: "size-5 sm:size-6 text-[#4b7bec]"
                  })}
               </div>
               <div>
                  <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
                     <h1 className="text-lg sm:text-2xl font-black text-slate-900 tracking-tight">
                        {TAB_INFO[activeTab]?.label || 'Performance & KPI'}
                     </h1>
                     <span className="px-2.5 py-0.5 rounded-lg text-[9px] sm:text-[10px] font-black uppercase font-mono bg-indigo-50 text-[#4b7bec] border border-indigo-100">
                        {activeStore?.name || 'Boutique'}
                     </span>
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                     Analyse globale de rentabilité, marge nette, coûts logistiques et télémétrie des canaux de vente
                  </p>
               </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap w-full lg:w-auto relative z-10">
               <div className="flex items-center gap-1 bg-slate-50 border border-slate-200/80 rounded-xl p-1 shadow-2xs overflow-x-auto no-scrollbar w-full sm:w-auto">
                  {['today', '7d', '30d', 'all_time'].map(p => (
                     <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className={cn(
                           "px-3 sm:px-4 py-1.5 text-[10px] sm:text-xs font-black uppercase tracking-wider rounded-lg transition-all whitespace-nowrap flex-1 sm:flex-none",
                           period === p 
                              ? "bg-white text-slate-900 shadow-xs font-black" 
                              : "text-slate-500 hover:text-slate-700"
                        )}
                     >
                        {p === 'today' ? "Aujourd'hui" : p === '7d' ? '7 Jours' : p === '30d' ? '30 Jours' : 'Tout'}
                     </button>
                  ))}
               </div>
               <button onClick={() => { kpiQuery.refetch(); revenueQuery.refetch(); }} className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 shadow-xs transition-all text-slate-500 shrink-0" title="Actualiser">
                  <RefreshCw className={cn("size-4", (kpiQuery.isFetching || revenueQuery.isFetching) && "animate-spin text-[#4b7bec]")} />
               </button>
            </div>
         </div>

         {/* ─── KPI Main View ────────────────────────── */}
         {activeTab === 'kpi' && (
            <>
               {/* ── 8 Executive KPI Cards (Row 1 Financials + Row 2 Operations) ── */}
               <div className="space-y-3.5">
                  {/* Row 1: Financials */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                     <div className="bg-white p-4 sm:p-5 rounded-2xl sm:rounded-[24px] border border-slate-100 shadow-xs space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Chiffre d&apos;Affaires Brut</span>
                        <h2 className="text-xl sm:text-2xl font-black text-slate-900 font-mono tabular-nums">
                           {kpi?.totalRevenue ? formatPrice(kpi.totalRevenue) : '0 DA'}
                        </h2>
                        <span className="text-[10px] text-slate-400 block font-medium">Total des ventes avant déductions</span>
                     </div>

                     <div className="bg-white p-4 sm:p-5 rounded-2xl sm:rounded-[24px] border border-slate-100 shadow-xs space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Chiffre d&apos;Affaires Net</span>
                        <h2 className="text-xl sm:text-2xl font-black text-indigo-600 font-mono tabular-nums">
                           {kpi?.netRevenue ? formatPrice(kpi.netRevenue) : '0 DA'}
                        </h2>
                        <span className="text-[10px] text-slate-400 block font-medium">Montant net encaissé</span>
                     </div>

                     <div className="bg-white p-4 sm:p-5 rounded-2xl sm:rounded-[24px] border border-slate-100 shadow-xs space-y-1">
                        <div className="flex items-center justify-between">
                           <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Bénéfice Net Réel</span>
                           <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              +{profitMarginPct}%
                           </span>
                        </div>
                        <h2 className="text-xl sm:text-2xl font-black text-emerald-600 font-mono tabular-nums">
                           {calculatedProfit ? formatPrice(calculatedProfit) : '0 DA'}
                        </h2>
                        <span className="text-[10px] text-slate-400 block font-medium">Profit net généré après coûts</span>
                     </div>

                     <div className="bg-white p-4 sm:p-5 rounded-2xl sm:rounded-[24px] border border-slate-100 shadow-xs space-y-1">
                        <div className="flex items-center justify-between">
                           <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Rentabilité / ROI Global</span>
                           <span className="text-[9px] font-mono text-slate-400 font-bold">Obj &gt; 200%</span>
                        </div>
                        <h2 className="text-xl sm:text-2xl font-black text-slate-900 font-mono tabular-nums">
                           {calculatedRoas}
                        </h2>
                        <span className="text-[10px] text-slate-400 block font-medium">
                           {metaSpendDzd > 0 ? `Sur ${formatPrice(metaSpendDzd)} de pub` : 'Marge commerciale nette'}
                        </span>
                     </div>
                  </div>

                  {/* Row 2: Operations & Unit Costs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                     <div className="bg-slate-50/70 p-4 rounded-2xl border border-slate-100 space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Frais de Livraison Payés</span>
                        <h3 className="text-base sm:text-lg font-black text-slate-900 font-mono tabular-nums">
                           {kpi?.shippingFeeGap ? formatPrice(Math.abs(kpi.shippingFeeGap)) : '0 DA'}
                        </h3>
                        <span className="text-[10px] text-slate-500 block font-medium">Sorties transporteurs</span>
                     </div>

                     <div className="bg-slate-50/70 p-4 rounded-2xl border border-slate-100 space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Taux Confirmation</span>
                        <div className="flex items-center justify-between">
                           <h3 className="text-base sm:text-lg font-black text-[#4b7bec] font-mono tabular-nums">
                              {calculatedConfirmation}%
                           </h3>
                           <span className="text-[9px] font-mono text-slate-400">Obj &gt; 70%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                           <div className="h-full bg-[#4b7bec] rounded-full" style={{ width: `${Math.min(100, calculatedConfirmation)}%` }} />
                        </div>
                     </div>

                     <div className="bg-slate-50/70 p-4 rounded-2xl border border-slate-100 space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Taux Livraison</span>
                        <div className="flex items-center justify-between">
                           <h3 className="text-base sm:text-lg font-black text-emerald-600 font-mono tabular-nums">
                              {calculatedDelivery}%
                           </h3>
                           <span className="text-[9px] font-mono text-slate-400">Obj &gt; 80%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                           <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, calculatedDelivery)}%` }} />
                        </div>
                     </div>

                     <div className="bg-slate-50/70 p-4 rounded-2xl border border-slate-100 space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Taux de Retour</span>
                        <div className="flex items-center justify-between">
                           <h3 className="text-base sm:text-lg font-black text-rose-600 font-mono tabular-nums">
                              {calculatedReturn}%
                           </h3>
                           <span className="text-[9px] font-mono text-slate-400">Obj &lt; 15%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                           <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.min(100, calculatedReturn)}%` }} />
                        </div>
                     </div>
                  </div>
               </div>

               {/* ── 3 Section Panels: Detailed Breakdown ── */}
               <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                  <SectionPanel title="Revenus & Profits" icon={Wallet} iconColor="#4b7bec">
                     <div className="space-y-0.5">
                        <MetricRow label="Ventes Brutes" value={kpi?.totalRevenue ? formatPrice(kpi.totalRevenue) : '0'} description="Total des ventes avant déductions (Chiffre d'Affaires Brut)" />
                        <MetricRow label="Revenus Nets" value={kpi?.netRevenue ? formatPrice(kpi.netRevenue) : '0'} description="Montant net encaissé après annulations (CA Net)" />
                        <MetricRow label="Bénéfices Réels" value={calculatedProfit ? formatPrice(calculatedProfit) : '0'} badge={profitMarginPct !== '0.0' ? `+${profitMarginPct}%` : undefined} description="Profit net généré après soustraction de tous les coûts" />
                        <MetricRow label="ROI Global" value={calculatedRoas} suffix="" description="Retour sur investissement global (Objectif: > 200%)" />
                        <MetricRow label="Capital / Ventes" value={kpi?.totalRevenue ? formatPrice(kpi.totalRevenue) : '0'} description="Fonds de roulement et liquidités disponibles" />
                     </div>
                  </SectionPanel>

                  <SectionPanel title="Dépenses & Frais" icon={CreditCard} iconColor="#FD7014">
                     <div className="space-y-0.5">
                        <MetricRow label="Frais de livraison" value={kpi?.shippingFeeGap ? formatPrice(Math.abs(kpi.shippingFeeGap)) : '0'} description="Dépenses payées aux sociétés de transport" />
                        <MetricRow 
                           label="CAC (Acquisition)" 
                           value={calculatedCac > 0 ? formatPrice(calculatedCac) : (metaSpendDzd > 0 ? formatPrice(metaSpendDzd) : '0')} 
                           badge={calculatedCac > 0 ? 'Par commande' : (metaSpendDzd === 0 ? 'Trafic Organique' : undefined)}
                           description="Coût moyen d'Acquisition d'un Client via les pubs" 
                        />
                        <MetricRow label="LTV (Valeur Client)" value={kpi?.ltv ? formatPrice(kpi.ltv) : (totalOrdersCount > 0 && kpi?.totalRevenue ? formatPrice(Math.round(kpi.totalRevenue / totalOrdersCount)) : '0')} description="Valeur à vie moyenne d'un client (Lifetime Value)" />
                        <MetricRow label="Coût Marchandises" value="Inclus dans marge" description="Coût d'achat de la marchandise vendue (COGS)" />
                     </div>
                  </SectionPanel>

                  <SectionPanel title="Efficacité Opérationnelle" icon={Target} iconColor="#00B894">
                     <div className="grid grid-cols-2 gap-3 place-items-center py-1">
                        <PerformanceGauge label="Confirmation" value={calculatedConfirmation} color="#4b7bec" description="Validées au tel (Obj: > 70%)" />
                        <PerformanceGauge label="Livraison" value={calculatedDelivery} color="#00B894" description="Arrivées client (Obj: > 80%)" />
                        <PerformanceGauge label="Conversion" value={kpi?.conversionRate || 0} color="#FD7014" description="Visites devenues achats (Obj: > 3%)" />
                        <PerformanceGauge label="Retour" value={calculatedReturn} color="#E17055" description="Refusées / retours (Obj: < 15%)" />
                     </div>
                  </SectionPanel>
               </div>

               {/* ── Charts: Sales Evolution & Channels ── */}
               <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                  <div className="lg:col-span-2 bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 p-5 sm:p-6 shadow-sm overflow-hidden space-y-4">
                     <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
                        <div className="flex items-center gap-3">
                           <div className="size-8 sm:size-9 rounded-xl bg-indigo-50 text-[#4b7bec] flex items-center justify-center shadow-2xs shrink-0">
                              <TrendingUp className="size-4" />
                           </div>
                           <div>
                              <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight">Évolution des ventes (Multi-Canal)</h3>
                              <p className="text-[10px] text-slate-400">Chronologie journalière du chiffre d&apos;affaires généré</p>
                           </div>
                        </div>

                        <div className="flex items-center gap-3 text-[10px] font-mono font-bold text-slate-500 flex-wrap">
                           <span className="bg-slate-50 px-2 py-1 rounded-lg border border-slate-200/60">
                              Moyenne : <strong>{formatPrice(dailyAverage)}</strong>/j
                           </span>
                           <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg border border-emerald-100">
                              Pic : <strong>{formatPrice(bestDayRevenue)}</strong>
                           </span>
                        </div>
                     </div>

                     <div className="h-[320px] w-full">
                        {revenueQuery.isLoading ? (
                           <Skeleton className="h-full w-full rounded-2xl bg-slate-100" />
                        ) : chartData.length === 0 ? (
                           <div className="h-full flex items-center justify-center text-slate-400 text-xs font-medium">
                              Aucune donnée de ventes disponible sur cette période
                           </div>
                        ) : (
                           <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={chartData}>
                                 <defs>
                                    <linearGradient id="orderGrad" x1="0" y1="0" x2="0" y2="1">
                                       <stop offset="5%" stopColor="#4b7bec" stopOpacity={0.25} />
                                       <stop offset="95%" stopColor="#4b7bec" stopOpacity={0.01} />
                                    </linearGradient>
                                    <linearGradient id="posGrad" x1="0" y1="0" x2="0" y2="1">
                                       <stop offset="5%" stopColor="#0984E3" stopOpacity={0.25} />
                                       <stop offset="95%" stopColor="#0984E3" stopOpacity={0.01} />
                                    </linearGradient>
                                 </defs>
                                 <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase' }} />
                                 <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                                 <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8', fontWeight: 600 }} axisLine={false} tickLine={false} />
                                 <YAxis tick={{ fontSize: 10, fill: '#94A3B8', fontWeight: 600 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`} />
                                 <RechartsTooltip 
                                    contentStyle={tooltipStyle} 
                                    formatter={(v: number, name: string) => [`${formatPrice(v)}`, name]}
                                 />
                                 <Area name="E-commerce (Web)" type="monotone" dataKey="orderRevenue" stroke="#4b7bec" strokeWidth={2.5} fillOpacity={1} fill="url(#orderGrad)" stackId="1" />
                                 <Area name="POS (Point de Vente)" type="monotone" dataKey="posRevenue" stroke="#0984E3" strokeWidth={2.5} fillOpacity={1} fill="url(#posGrad)" stackId="1" />
                              </AreaChart>
                           </ResponsiveContainer>
                        )}
                     </div>
                  </div>

                  <SectionPanel title="Répartition par Canal" icon={Share2} iconColor="#0984E3">
                     <div className="h-[220px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                           <PieChart>
                              <Pie
                                 data={[
                                    { name: 'E-commerce (Boutique)', value: (kpi?.orderRevenue || kpi?.totalRevenue || 0) },
                                    { name: 'POS (Point de vente)', value: (kpi?.posRevenue || 0) }
                                 ].filter(d => d.value > 0)}
                                 innerRadius={55}
                                 outerRadius={75}
                                 paddingAngle={5}
                                 dataKey="value"
                              >
                                 <Cell fill="#4b7bec" />
                                 <Cell fill="#0984E3" />
                              </Pie>
                              <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: number) => formatPrice(v)} />
                              <Legend verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                           </PieChart>
                        </ResponsiveContainer>
                     </div>
                     <div className="space-y-3 pt-3 border-t border-slate-100">
                        <div className="flex items-center justify-between text-xs font-bold">
                           <span className="text-slate-500">Contribution E-commerce</span>
                           <span className="text-[#4b7bec] font-mono">
                              {kpi?.totalRevenue ? (((kpi.orderRevenue || kpi.totalRevenue) / kpi.totalRevenue) * 100).toFixed(1) : '100'}%
                           </span>
                        </div>
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                           <div className="h-full bg-[#4b7bec]" style={{ width: kpi?.totalRevenue ? `${((kpi.orderRevenue || kpi.totalRevenue) / kpi.totalRevenue) * 100}%` : '100%' }} />
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1">
                           <span>Total digital : {formatPrice(kpi?.orderRevenue || kpi?.totalRevenue || 0)}</span>
                           <span>{(kpi?.posRevenue || 0) > 0 ? `POS : ${formatPrice(kpi!.posRevenue)}` : '100% canal digital'}</span>
                        </div>
                     </div>
                  </SectionPanel>
               </div>
            </>
         )}

         {/* ─── Orders Analytics (Meta Ads Executive Template) ─── */}
         {activeTab === 'orders' && (() => {
            const totalOrders = kpi?.totalOrders || 0;
            const pendingOrders = kpi?.pendingOrders || 0;
            const confirmedOrders = kpi?.confirmedOrders || 0;
            const deliveredOrders = kpi?.deliveredOrders || 0;
            const returnedOrders = kpi?.returnedOrders || 0;

            const confRate = totalOrders > 0 ? ((confirmedOrders / totalOrders) * 100).toFixed(1) : '0.0';
            const delivRate = confirmedOrders > 0 ? ((deliveredOrders / confirmedOrders) * 100).toFixed(1) : (totalOrders > 0 ? ((deliveredOrders / totalOrders) * 100).toFixed(1) : '0.0');
            const returnRate = totalOrders > 0 ? ((returnedOrders / totalOrders) * 100).toFixed(1) : '0.0';

            const avgValue = kpi?.avgOrderValue || (totalOrders > 0 && kpi?.totalRevenue ? Math.round(kpi.totalRevenue / totalOrders) : 0);

            const statusRows = [
               {
                  status: 'Nouvelles / En Attente',
                  desc: "Commandes brutes en attente d'appel de confirmation",
                  count: pendingOrders,
                  share: totalOrders > 0 ? ((pendingOrders / totalOrders) * 100).toFixed(1) : '0.0',
                  color: '#F59E0B',
                  bgColor: 'bg-amber-50',
                  textColor: 'text-amber-700',
                  borderColor: 'border-amber-200',
                  estimatedValue: pendingOrders * avgValue,
                  badge: 'Pipeline Entrant',
               },
               {
                  status: 'Confirmées & Validées',
                  desc: "Commandes validées au téléphone prêtes à l'expédition",
                  count: confirmedOrders,
                  share: totalOrders > 0 ? ((confirmedOrders / totalOrders) * 100).toFixed(1) : '0.0',
                  color: '#4b7bec',
                  bgColor: 'bg-blue-50',
                  textColor: 'text-[#4b7bec]',
                  borderColor: 'border-blue-200',
                  estimatedValue: confirmedOrders * avgValue,
                  badge: `${confRate}% Conversion`,
               },
               {
                  status: 'Livrées avec Succès',
                  desc: 'Colis réceptionnés par les clients et fonds encaissés',
                  count: deliveredOrders,
                  share: totalOrders > 0 ? ((deliveredOrders / totalOrders) * 100).toFixed(1) : '0.0',
                  color: '#10B981',
                  bgColor: 'bg-emerald-50',
                  textColor: 'text-emerald-700',
                  borderColor: 'border-emerald-200',
                  estimatedValue: kpi?.netRevenue || (deliveredOrders * avgValue),
                  badge: `${delivRate}% Succès`,
               },
               {
                  status: 'Retournées & Refusées',
                  desc: 'Colis refusés, injoignables ou retournés en entrepôt',
                  count: returnedOrders,
                  share: totalOrders > 0 ? ((returnedOrders / totalOrders) * 100).toFixed(1) : '0.0',
                  color: '#EF4444',
                  bgColor: 'bg-rose-50',
                  textColor: 'text-rose-700',
                  borderColor: 'border-rose-200',
                  estimatedValue: returnedOrders * avgValue,
                  badge: `${returnRate}% Échec`,
               },
            ];

            return (
               <div className="space-y-4 sm:space-y-6">
                  {/* 5 Top Executive KPI Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 sm:gap-4">
                     <div className="bg-white p-4 sm:p-5 rounded-2xl sm:rounded-[24px] border border-slate-100 shadow-xs space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Total Commandes</span>
                        <h2 className="text-xl sm:text-2xl font-black text-slate-900 font-mono tabular-nums">
                           {totalOrders}
                        </h2>
                        <span className="text-[10px] text-slate-400 block font-medium">Volume global période</span>
                     </div>

                     <div className="bg-white p-4 sm:p-5 rounded-2xl sm:rounded-[24px] border border-slate-100 shadow-xs space-y-1">
                        <div className="flex items-center justify-between">
                           <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Nouvelles</span>
                           <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                              En attente
                           </span>
                        </div>
                        <h2 className="text-xl sm:text-2xl font-black text-amber-600 font-mono tabular-nums">
                           {pendingOrders}
                        </h2>
                        <span className="text-[10px] text-slate-400 block font-medium">À confirmer</span>
                     </div>

                     <div className="bg-white p-4 sm:p-5 rounded-2xl sm:rounded-[24px] border border-slate-100 shadow-xs space-y-1">
                        <div className="flex items-center justify-between">
                           <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Confirmées</span>
                           <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded bg-blue-50 text-[#4b7bec] border border-blue-200">
                              {confRate}%
                           </span>
                        </div>
                        <h2 className="text-xl sm:text-2xl font-black text-[#4b7bec] font-mono tabular-nums">
                           {confirmedOrders}
                        </h2>
                        <span className="text-[10px] text-slate-400 block font-medium">Validées par agents</span>
                     </div>

                     <div className="bg-white p-4 sm:p-5 rounded-2xl sm:rounded-[24px] border border-slate-100 shadow-xs space-y-1">
                        <div className="flex items-center justify-between">
                           <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Livrées</span>
                           <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {delivRate}%
                           </span>
                        </div>
                        <h2 className="text-xl sm:text-2xl font-black text-emerald-600 font-mono tabular-nums">
                           {deliveredOrders}
                        </h2>
                        <span className="text-[10px] text-slate-400 block font-medium">Encaissées avec succès</span>
                     </div>

                     <div className="bg-white p-4 sm:p-5 rounded-2xl sm:rounded-[24px] border border-slate-100 shadow-xs space-y-1">
                        <div className="flex items-center justify-between">
                           <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Retournées</span>
                           <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                              {returnRate}%
                           </span>
                        </div>
                        <h2 className="text-xl sm:text-2xl font-black text-rose-600 font-mono tabular-nums">
                           {returnedOrders}
                        </h2>
                        <span className="text-[10px] text-slate-400 block font-medium">Refus / Non aboutis</span>
                     </div>
                  </div>

                  {/* Funnel Progress Conversion Bar */}
                  <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 p-5 sm:p-6 shadow-sm space-y-4">
                     <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2.5">
                           <div className="size-8 rounded-xl bg-indigo-50 text-[#4b7bec] flex items-center justify-center shadow-2xs">
                              <Target className="size-4" />
                           </div>
                           <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight">Entonnoir de Conversion des Commandes</h3>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 font-bold">Panier moyen : {formatPrice(avgValue)}</span>
                     </div>

                     <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-1">
                        <div className="bg-slate-50/70 p-3.5 rounded-2xl border border-slate-100 space-y-1">
                           <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">1. Total Reçues</span>
                           <span className="text-base font-black font-mono text-slate-900">{totalOrders} cmds</span>
                           <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mt-1">
                              <div className="h-full bg-slate-800 rounded-full w-full" />
                           </div>
                        </div>

                        <div className="bg-slate-50/70 p-3.5 rounded-2xl border border-slate-100 space-y-1">
                           <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">2. Confirmées</span>
                              <span className="text-[9px] font-mono text-[#4b7bec] font-black">{confRate}%</span>
                           </div>
                           <span className="text-base font-black font-mono text-[#4b7bec]">{confirmedOrders} cmds</span>
                           <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mt-1">
                              <div className="h-full bg-[#4b7bec] rounded-full" style={{ width: `${confRate}%` }} />
                           </div>
                        </div>

                        <div className="bg-slate-50/70 p-3.5 rounded-2xl border border-slate-100 space-y-1">
                           <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">3. Livrées</span>
                              <span className="text-[9px] font-mono text-emerald-600 font-black">{delivRate}%</span>
                           </div>
                           <span className="text-base font-black font-mono text-emerald-600">{deliveredOrders} cmds</span>
                           <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mt-1">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${delivRate}%` }} />
                           </div>
                        </div>

                        <div className="bg-slate-50/70 p-3.5 rounded-2xl border border-slate-100 space-y-1">
                           <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">4. Retours</span>
                              <span className="text-[9px] font-mono text-rose-600 font-black">{returnRate}%</span>
                           </div>
                           <span className="text-base font-black font-mono text-rose-600">{returnedOrders} cmds</span>
                           <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mt-1">
                              <div className="h-full bg-rose-500 rounded-full" style={{ width: `${returnRate}%` }} />
                           </div>
                        </div>
                     </div>
                  </div>

                  {/* High-Density Pipeline Ledger Table */}
                  <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
                     <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                           <ShoppingCart className="size-4 text-[#4b7bec]" />
                           <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight">Détail par Statut & Valeur Marchande</h3>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 font-bold">4 flux surveillés</span>
                     </div>
                     <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-left min-w-[650px]">
                           <thead>
                              <tr className="border-b border-slate-100 bg-slate-50/40">
                                 <th className="px-5 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider">Statut du Flux</th>
                                 <th className="px-5 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">Quantité</th>
                                 <th className="px-5 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">Part du Volume</th>
                                 <th className="px-5 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">Performance</th>
                                 <th className="px-5 py-3.5 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Valeur Estimée</th>
                              </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                              {statusRows.map((r, i) => (
                                 <tr key={i} className="hover:bg-slate-50/60 transition-colors">
                                    <td className="px-5 py-4">
                                       <div className="flex items-center gap-3">
                                          <div className="size-3 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                                          <div>
                                             <span className="text-xs font-black text-slate-900 block">{r.status}</span>
                                             <span className="text-[10px] text-slate-400 leading-tight block">{r.desc}</span>
                                          </div>
                                       </div>
                                    </td>
                                    <td className="px-5 py-4 text-center">
                                       <span className="text-sm font-black font-mono text-slate-900 tabular-nums">{r.count}</span>
                                    </td>
                                    <td className="px-5 py-4 text-center">
                                       <div className="flex flex-col items-center gap-1">
                                          <span className="text-[10px] font-black font-mono text-slate-700">{r.share}%</span>
                                          <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                             <div className="h-full rounded-full" style={{ width: `${r.share}%`, backgroundColor: r.color }} />
                                          </div>
                                       </div>
                                    </td>
                                    <td className="px-5 py-4 text-center">
                                       <span className={cn("px-2 py-0.5 rounded-lg text-[9px] font-black font-mono border", r.bgColor, r.textColor, r.borderColor)}>
                                          {r.badge}
                                       </span>
                                    </td>
                                    <td className="px-5 py-4 text-right">
                                       <span className="text-xs sm:text-sm font-black font-mono text-slate-900 tabular-nums">
                                          {formatPrice(r.estimatedValue)}
                                       </span>
                                    </td>
                                 </tr>
                              ))}
                           </tbody>
                        </table>
                     </div>
                  </div>
               </div>
            );
         })()}

         {/* ─── Shipping Analytics ──────────────────────── */}
         {activeTab === 'shipping' && (
            <div className="space-y-6">
               <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <SectionPanel title="Performance des Transporteurs" icon={Truck} iconColor={C.primary} borderColor={C.primary}>
                     <div className="h-[300px] mt-4">
                        {genericQuery.isLoading ? <Loader2 className="size-6 animate-spin mx-auto mt-20 text-[#B2BEC3]" /> : (
                           <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={genericQuery.data?.data?.carriers || []}>
                                 <CartesianGrid strokeDasharray="3 3" stroke="#F0F3F6" vertical={false} />
                                 <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#B2BEC3' }} axisLine={false} tickLine={false} />
                                 <YAxis tick={{ fontSize: 10, fill: '#B2BEC3' }} axisLine={false} tickLine={false} />
                                 <RechartsTooltip contentStyle={tooltipStyle} />
                                 <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                                 <Bar name="Taux Livraison (%)" dataKey="deliveryRate" fill={C.success} radius={[4, 4, 0, 0]} />
                                 <Bar name="Taux Retour (%)" dataKey="returnRate" fill={C.danger} radius={[4, 4, 0, 0]} />
                              </BarChart>
                           </ResponsiveContainer>
                        )}
                     </div>
                  </SectionPanel>

                  <SectionPanel title="Délai Moyen de Livraison (Jours)" icon={Clock} iconColor={C.info} borderColor={C.info}>
                     <div className="h-[300px] mt-4">
                        {genericQuery.isLoading ? <Loader2 className="size-6 animate-spin mx-auto mt-20 text-[#B2BEC3]" /> : (
                           <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={genericQuery.data?.data?.carriers || []}>
                                 <CartesianGrid strokeDasharray="3 3" stroke="#F0F3F6" vertical={false} />
                                 <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#B2BEC3' }} axisLine={false} tickLine={false} />
                                 <YAxis tick={{ fontSize: 10, fill: '#B2BEC3' }} axisLine={false} tickLine={false} />
                                 <RechartsTooltip contentStyle={tooltipStyle} />
                                 <Line type="monotone" dataKey="avgDays" stroke={C.info} strokeWidth={3} dot={{ r: 4, fill: C.info, strokeWidth: 2, stroke: '#fff' }} />
                              </LineChart>
                           </ResponsiveContainer>
                        )}
                     </div>
                  </SectionPanel>

                  <div className="bg-white rounded-xl border p-6 flex flex-col justify-between" style={{ borderColor: C.border }}>
                     <div>
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3] mb-4">Volume par Partenaire</h4>
                        <div className="space-y-4">
                           {genericQuery.data?.data?.carriers?.map((c: any, i: number) => (
                              <div key={i} className="space-y-1.5">
                                 <div className="flex justify-between text-[11px] font-bold">
                                    <span className="text-[#2D3436]">{c.name}</span>
                                    <span className="text-[#636E72]">{c.totalOrders} colis</span>
                                 </div>
                                 <div className="w-full h-1.5 bg-[#F8F9FC] rounded-full overflow-hidden">
                                    <div className="h-full bg-[#6C5CE7]" style={{ width: `${(c.totalOrders / (genericQuery.data?.data?.totalShippingOrders || 1)) * 100}%` }} />
                                 </div>
                              </div>
                           ))}
                        </div>
                     </div>
                     <div className="pt-6 border-t mt-6">
                        <div className="flex items-center justify-between">
                           <span className="text-[11px] font-black text-[#B2BEC3] uppercase">Efficacité Globale</span>
                           <span className="text-xl font-black text-[#00B894]">{kpi?.deliveryPerformance || 0}%</span>
                        </div>
                     </div>
                  </div>
               </div>
            </div>
         )}

         {/* ─── Channels Analytics ──────────────────────── */}
         {activeTab === 'channels' && (() => {
            const channelColors: Record<string, string> = {
               Facebook: '#1877F2', Instagram: '#E4405F', TikTok: '#010101',
               WhatsApp: '#25D366', Direct: C.primary, Manuel: C.orange, Autre: C.textDim,
            };
            const _rawChannels = genericQuery.data?.data?.channels ?? genericQuery.data?.data;
            const channels: any[] = Array.isArray(_rawChannels) ? _rawChannels : [];
            const totalOrders = channels.reduce((s: number, c: any) => s + (c.orders ?? c.count ?? 0), 0);
            const totalRevenue = channels.reduce((s: number, c: any) => s + (c.revenue ?? c.value ?? 0), 0);
            const bestChannel = channels.length > 0 ? channels.reduce((a: any, b: any) =>
               (a.orders ?? a.count ?? 0) > (b.orders ?? b.count ?? 0) ? a : b) : null;
            const pieData = channels.map((c: any) => ({
               name: c.name ?? c.source ?? c.channel,
               value: c.orders ?? c.count ?? 0,
               revenue: c.revenue ?? c.value ?? 0,
            }));
            const barData = channels.map((c: any) => ({
               name: c.name ?? c.source ?? c.channel,
               commandes: c.orders ?? c.count ?? 0,
               revenue: Math.round((c.revenue ?? c.value ?? 0) / 1000),
               taux: c.conversionRate ?? c.rate ?? (totalOrders > 0 ? (((c.orders ?? c.count ?? 0) / totalOrders) * 100).toFixed(1) : 0),
            }));
            return (
               <div className="space-y-6">
                  {/* KPI cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                     {[
                        { l: 'CANAUX ACTIFS', v: channels.length, c: C.primary, icon: Share2 },
                        { l: 'TOTAL COMMANDES', v: totalOrders, c: C.success, icon: ShoppingCart },
                        { l: 'REVENUE TOTAL', v: formatPrice(totalRevenue), c: C.orange, icon: DollarSign },
                        { l: 'MEILLEUR CANAL', v: bestChannel?.name ?? bestChannel?.source ?? '—', c: C.info, icon: TrendingUp },
                     ].map((k, i) => (
                        <div key={i} className="bg-white rounded-xl border p-4 flex items-center gap-4" style={{ borderColor: C.border }}>
                           <div className="size-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: k.c + '15' }}>
                              <k.icon className="size-5" style={{ color: k.c }} />
                           </div>
                           <div className="min-w-0">
                              <p className="text-[9px] font-black uppercase tracking-widest text-[#B2BEC3] truncate">{k.l}</p>
                              <p className="text-lg font-black text-[#2D3436] truncate">{k.v}</p>
                           </div>
                        </div>
                     ))}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                     <SectionPanel title="Répartition par Canal d'Acquisition" icon={Share2} iconColor={C.primary} borderColor={C.primary}>
                        {genericQuery.isLoading ? (
                           <div className="h-[300px] flex items-center justify-center"><Loader2 className="size-6 animate-spin text-[#B2BEC3]" /></div>
                        ) : pieData.length === 0 ? <EmptyState /> : (
                           <div className="h-[300px] mt-4">
                              <ResponsiveContainer width="100%" height="100%">
                                 <PieChart>
                                    <Pie data={pieData} innerRadius={70} outerRadius={100} paddingAngle={4} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                                       {pieData.map((entry, idx) => (
                                          <Cell key={idx} fill={channelColors[entry.name] ?? Object.values(channelColors)[idx % Object.values(channelColors).length]} />
                                       ))}
                                    </Pie>
                                    <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: number, n: string, p: any) => [`${v} cmds · ${formatPrice(p.payload?.revenue ?? 0)} DA`, n]} />
                                    <Legend verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                                 </PieChart>
                              </ResponsiveContainer>
                           </div>
                        )}
                     </SectionPanel>

                     <SectionPanel title="Commandes & Revenue par Canal" icon={BarChart3} iconColor={C.success} borderColor={C.success}>
                        {genericQuery.isLoading ? (
                           <div className="h-[300px] flex items-center justify-center"><Loader2 className="size-6 animate-spin text-[#B2BEC3]" /></div>
                        ) : barData.length === 0 ? <EmptyState /> : (
                           <div className="h-[300px] mt-4">
                              <ResponsiveContainer width="100%" height="100%">
                                 <BarChart data={barData} barGap={4}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F3F6" vertical={false} />
                                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#B2BEC3' }} axisLine={false} tickLine={false} />
                                    <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#B2BEC3' }} axisLine={false} tickLine={false} />
                                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#B2BEC3' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}K`} />
                                    <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => n === 'revenue' ? [`${v}K DA`, 'Revenue'] : [v, 'Commandes']} />
                                    <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                                    <Bar yAxisId="left" name="Commandes" dataKey="commandes" fill={C.primary} radius={[4, 4, 0, 0]} />
                                    <Bar yAxisId="right" name="Revenue (K DA)" dataKey="revenue" fill={C.success} radius={[4, 4, 0, 0]} />
                                 </BarChart>
                              </ResponsiveContainer>
                           </div>
                        )}
                     </SectionPanel>
                  </div>

                  {/* Detailed channel table */}
                  <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
                     <div className="px-5 py-4 border-b bg-[#F8F9FC] flex items-center gap-3" style={{ borderColor: C.border }}>
                        <Share2 className="size-4" style={{ color: C.primary }} />
                        <h3 className="text-sm font-bold text-[#2D3436]">Détail par Canal</h3>
                     </div>
                     <div className="overflow-x-auto">
                        <table className="w-full text-left">
                           <thead>
                              <tr className="border-b bg-[#F8F9FC]" style={{ borderColor: C.border }}>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72]">Canal</th>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72] text-center">Commandes</th>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72] text-center">Part (%)</th>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72] text-right">Revenue (DZD)</th>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72] text-right">Part Revenue</th>
                              </tr>
                           </thead>
                           <tbody className="divide-y">
                              {genericQuery.isLoading ? (
                                 <tr><td colSpan={5} className="py-16 text-center"><Loader2 className="size-6 animate-spin mx-auto text-[#B2BEC3]" /></td></tr>
                              ) : channels.length === 0 ? (
                                 <tr><td colSpan={5}><EmptyState /></td></tr>
                              ) : channels.map((ch: any, i: number) => {
                                 const name = ch.name ?? ch.source ?? ch.channel ?? '—';
                                 const orders = ch.orders ?? ch.count ?? 0;
                                 const rev = ch.revenue ?? ch.value ?? 0;
                                 const share = totalOrders > 0 ? ((orders / totalOrders) * 100).toFixed(1) : '0';
                                 const revShare = totalRevenue > 0 ? ((rev / totalRevenue) * 100).toFixed(1) : '0';
                                 const color = channelColors[name] ?? C.primary;
                                 return (
                                    <tr key={i} className="hover:bg-[#FAFBFD] transition-colors">
                                       <td className="px-5 py-3.5">
                                          <div className="flex items-center gap-2.5">
                                             <div className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                             <span className="text-xs font-bold text-[#2D3436]">{name}</span>
                                          </div>
                                       </td>
                                       <td className="px-5 py-3.5 text-center">
                                          <span className="text-xs font-extrabold text-[#6C5CE7]">{orders}</span>
                                       </td>
                                       <td className="px-5 py-3.5 text-center">
                                          <div className="flex flex-col items-center gap-1">
                                             <span className="text-[10px] font-bold text-[#636E72]">{share}%</span>
                                             <div className="w-16 h-1 bg-[#F0F3F6] rounded-full overflow-hidden">
                                                <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: color }} />
                                             </div>
                                          </div>
                                       </td>
                                       <td className="px-5 py-3.5 text-right text-xs font-black text-[#2D3436]">{formatPrice(rev)}</td>
                                       <td className="px-5 py-3.5 text-right">
                                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: color + '15', color }}>{revShare}%</span>
                                       </td>
                                    </tr>
                                 );
                              })}
                           </tbody>
                        </table>
                     </div>
                  </div>
               </div>
            );
         })()}

         {/* ─── Products Analytics ────────────────────── */}
         {activeTab === 'products' && (
            <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
               <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[1000px]">
                     <thead>
                        <tr className="border-b bg-[#F8F9FC]" style={{ borderColor: C.border }}>
                           <th className="px-5 py-4 text-xs font-bold text-[#636E72]">Désignation Produit</th>
                           <th className="px-5 py-4 text-xs font-bold text-[#636E72] text-center">Unités Vendues</th>
                           <th className="px-5 py-4 text-xs font-bold text-[#636E72] text-right">Revenue Généré (DZD)</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y">
                        {genericQuery.isLoading ? (
                           <tr><td colSpan={3} className="px-5 py-20 text-center"><Loader2 className="size-6 animate-spin mx-auto text-[#B2BEC3]" /></td></tr>
                        ) : genericQuery.data?.data?.length === 0 ? (
                           <tr><td colSpan={3}><EmptyState /></td></tr>
                        ) : (
                           genericQuery.data?.data?.map((p, i) => (
                              <tr key={i} className="hover:bg-[#FAFBFD] transition-colors">
                                 <td className="px-5 py-4 text-xs font-bold text-[#2D3436]">{p.name}</td>
                                 <td className="px-5 py-4 text-xs font-extrabold text-center text-[#6C5CE7]">{p.count}</td>
                                 <td className="px-5 py-4 text-xs font-black text-right">{formatPrice(p.value)}</td>
                              </tr>
                           ))
                        )}
                     </tbody>
                  </table>
               </div>
            </div>
         )}

         {/* ─── Wilayas Analytics ─────────────────────── */}
         {activeTab === 'wilayas' && (
            <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
               <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[800px]">
                     <thead>
                        <tr className="border-b bg-[#F8F9FC]" style={{ borderColor: C.border }}>
                           <th className="px-5 py-4 text-xs font-bold text-[#636E72]">Wilaya</th>
                           <th className="px-5 py-4 text-xs font-bold text-[#636E72] text-center">Volume de Commandes</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y">
                        {genericQuery.isLoading ? (
                           <tr><td colSpan={2} className="px-5 py-20 text-center"><Loader2 className="size-6 animate-spin mx-auto text-[#B2BEC3]" /></td></tr>
                        ) : genericQuery.data?.data?.length === 0 ? (
                           <tr><td colSpan={2}><EmptyState /></td></tr>
                        ) : (
                           genericQuery.data?.data?.map((w, i) => (
                              <tr key={i} className="hover:bg-[#FAFBFD] transition-colors">
                                 <td className="px-5 py-4 text-xs font-bold text-[#2D3436]">{w.name}</td>
                                 <td className="px-5 py-4 text-xs font-extrabold text-center text-[#0984E3]">{w.value.toFixed(0)}</td>
                              </tr>
                           ))
                        )}
                     </tbody>
                  </table>
               </div>
            </div>
         )}

         {/* ─── Agents Analytics ──────────────────────── */}
         {activeTab === 'agents' && (() => {
            const agents: any[] = genericQuery.data?.data || [];
            const totalHandled = agents.reduce((s: number, a: any) => s + (a.count ?? a.total ?? 0), 0);
            const avgRate = agents.length > 0
               ? (agents.reduce((s: number, a: any) => s + (a.value ?? a.successRate ?? a.confirmationRate ?? 0), 0) / agents.length).toFixed(1)
               : '0';
            const best = agents.length > 0 ? agents.reduce((a: any, b: any) =>
               (a.value ?? a.successRate ?? 0) > (b.value ?? b.successRate ?? 0) ? a : b) : null;
            const chartAgents = agents.map((a: any) => ({
               name: a.name?.split(' ')[0] ?? a.name ?? '?',
               confirmées: a.confirmed ?? a.count ?? 0,
               taux: parseFloat((a.value ?? a.successRate ?? 0).toFixed(1)),
            }));
            return (
               <div className="space-y-6">
                  {/* KPI cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                     {[
                        { l: 'AGENTS ACTIFS', v: agents.length, c: C.primary, icon: UserCheck },
                        { l: 'TOTAL TRAITÉ', v: totalHandled, c: C.success, icon: ShoppingCart },
                        { l: 'TAUX MOY. CONFIRMATION', v: `${avgRate}%`, c: C.info, icon: Target },
                        { l: 'MEILLEUR AGENT', v: best?.name ?? '—', c: C.orange, icon: TrendingUp },
                     ].map((k, i) => (
                        <div key={i} className="bg-white rounded-xl border p-4 flex items-center gap-4" style={{ borderColor: C.border }}>
                           <div className="size-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: k.c + '15' }}>
                              <k.icon className="size-5" style={{ color: k.c }} />
                           </div>
                           <div className="min-w-0">
                              <p className="text-[9px] font-black uppercase tracking-widest text-[#B2BEC3] truncate leading-tight">{k.l}</p>
                              <p className="text-lg font-black text-[#2D3436] truncate">{k.v}</p>
                           </div>
                        </div>
                     ))}
                  </div>

                  {/* Bar chart */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                     <SectionPanel title="Commandes Traitées par Agent" icon={ShoppingCart} iconColor={C.primary} borderColor={C.primary}>
                        {genericQuery.isLoading ? (
                           <div className="h-[260px] flex items-center justify-center"><Loader2 className="size-6 animate-spin text-[#B2BEC3]" /></div>
                        ) : chartAgents.length === 0 ? <EmptyState /> : (
                           <div className="h-[260px] mt-4">
                              <ResponsiveContainer width="100%" height="100%">
                                 <BarChart data={chartAgents}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F3F6" vertical={false} />
                                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#B2BEC3' }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: '#B2BEC3' }} axisLine={false} tickLine={false} />
                                    <RechartsTooltip contentStyle={tooltipStyle} />
                                    <Bar name="Commandes" dataKey="confirmées" fill={C.primary} radius={[6, 6, 0, 0]}>
                                       {chartAgents.map((_: any, idx: number) => (
                                          <Cell key={idx} fill={idx === 0 ? C.primary : C.primary + 'AA'} />
                                       ))}
                                    </Bar>
                                 </BarChart>
                              </ResponsiveContainer>
                           </div>
                        )}
                     </SectionPanel>

                     <SectionPanel title="Taux de Confirmation par Agent (%)" icon={Target} iconColor={C.success} borderColor={C.success}>
                        {genericQuery.isLoading ? (
                           <div className="h-[260px] flex items-center justify-center"><Loader2 className="size-6 animate-spin text-[#B2BEC3]" /></div>
                        ) : chartAgents.length === 0 ? <EmptyState /> : (
                           <div className="h-[260px] mt-4">
                              <ResponsiveContainer width="100%" height="100%">
                                 <BarChart data={chartAgents} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F3F6" horizontal={false} />
                                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#B2BEC3' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
                                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#B2BEC3' }} axisLine={false} tickLine={false} width={60} />
                                    <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`, 'Confirmation']} />
                                    <Bar dataKey="taux" radius={[0, 6, 6, 0]} name="Taux">
                                       {chartAgents.map((entry: any, idx: number) => (
                                          <Cell key={idx} fill={entry.taux >= 70 ? C.success : entry.taux >= 50 ? C.warning : C.danger} />
                                       ))}
                                    </Bar>
                                 </BarChart>
                              </ResponsiveContainer>
                           </div>
                        )}
                     </SectionPanel>
                  </div>

                  {/* Detailed table */}
                  <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
                     <div className="px-5 py-4 border-b bg-[#F8F9FC]" style={{ borderColor: C.border }}>
                        <h3 className="text-sm font-bold text-[#2D3436] flex items-center gap-2">
                           <UserCheck className="size-4" style={{ color: C.primary }} />
                           Classement des Agents de Confirmation
                        </h3>
                     </div>
                     <div className="overflow-x-auto">
                        <table className="w-full text-left min-w-[800px]">
                           <thead>
                              <tr className="border-b bg-[#F8F9FC]" style={{ borderColor: C.border }}>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72] w-8">#</th>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72]">Agent</th>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72] text-center">Commandes Traitées</th>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72] text-center">Confirmées</th>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72] text-center">Taux Confirmation</th>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72] text-center">Performance</th>
                              </tr>
                           </thead>
                           <tbody className="divide-y">
                              {genericQuery.isLoading ? (
                                 <tr><td colSpan={6} className="py-16 text-center"><Loader2 className="size-6 animate-spin mx-auto text-[#B2BEC3]" /></td></tr>
                              ) : agents.length === 0 ? (
                                 <tr><td colSpan={6}><EmptyState /></td></tr>
                              ) : agents
                                 .slice()
                                 .sort((a: any, b: any) => (b.value ?? b.successRate ?? 0) - (a.value ?? a.successRate ?? 0))
                                 .map((a: any, i: number) => {
                                    const total = a.count ?? a.total ?? 0;
                                    const confirmed = a.confirmed ?? Math.round(total * ((a.value ?? a.successRate ?? 0) / 100));
                                    const rate = parseFloat((a.value ?? a.successRate ?? a.confirmationRate ?? 0).toFixed(1));
                                    const perf = rate >= 75 ? { label: 'Excellent', color: C.success } : rate >= 55 ? { label: 'Bon', color: C.info } : rate >= 35 ? { label: 'Moyen', color: C.warning } : { label: 'Faible', color: C.danger };
                                    return (
                                       <tr key={i} className="hover:bg-[#FAFBFD] transition-colors">
                                          <td className="px-5 py-3.5">
                                             <span className={`text-xs font-black ${i === 0 ? 'text-amber-500' : 'text-[#B2BEC3]'}`}>{i + 1}</span>
                                          </td>
                                          <td className="px-5 py-3.5">
                                             <div className="flex items-center gap-2.5">
                                                <div className="size-7 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0" style={{ backgroundColor: C.primary }}>
                                                   {(a.name ?? '?').charAt(0).toUpperCase()}
                                                </div>
                                                <span className="text-xs font-bold text-[#2D3436]">{a.name}</span>
                                             </div>
                                          </td>
                                          <td className="px-5 py-3.5 text-center text-xs font-extrabold text-[#636E72]">{total}</td>
                                          <td className="px-5 py-3.5 text-center text-xs font-extrabold text-[#6C5CE7]">{confirmed}</td>
                                          <td className="px-5 py-3.5 text-center">
                                             <div className="flex flex-col items-center gap-1">
                                                <span className="text-xs font-black text-[#2D3436]">{rate}%</span>
                                                <div className="w-20 h-1.5 bg-[#F0F3F6] rounded-full overflow-hidden">
                                                   <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(rate, 100)}%`, backgroundColor: perf.color }} />
                                                </div>
                                             </div>
                                          </td>
                                          <td className="px-5 py-3.5 text-center">
                                             <span className="text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: perf.color + '15', color: perf.color }}>{perf.label}</span>
                                          </td>
                                       </tr>
                                    );
                                 })
                              }
                           </tbody>
                        </table>
                     </div>
                  </div>
               </div>
            );
         })()}

         {/* ─── Marketers Analytics ─────────────────────── */}
         {activeTab === 'marketers' && (() => {
            // Backend TopItem for this endpoint: value=order count,
            // secondaryValue=revenue, count=delivered count (conversion
            // rate is derived here, not sent pre-computed).
            const marketers: any[] = (genericQuery.data?.data || []).map((m: any) => {
               const orders = m.value ?? 0;
               const delivered = m.count ?? 0;
               return {
                  name: m.name,
                  orders,
                  revenue: m.secondaryValue ?? 0,
                  conversionRate: orders > 0 ? (delivered / orders) * 100 : 0,
               };
            });
            const totalOrders = marketers.reduce((s: number, m: any) => s + m.orders, 0);
            const totalRevenue = marketers.reduce((s: number, m: any) => s + m.revenue, 0);
            const avgConv = marketers.length > 0
               ? (marketers.reduce((s: number, m: any) => s + m.conversionRate, 0) / marketers.length).toFixed(1)
               : '0';
            const best = marketers.length > 0 ? marketers.reduce((a: any, b: any) =>
               a.revenue > b.revenue ? a : b) : null;
            const barData = marketers.map((m: any) => ({
               name: (m.name ?? '?').split(' ')[0],
               commandes: m.orders,
               revenue: Math.round(m.revenue / 1000),
               taux: parseFloat(m.conversionRate.toFixed(1)),
            }));
            return (
               <div className="space-y-6">
                  {/* KPI cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                     {[
                        { l: 'MARKETERS ACTIFS', v: marketers.length, c: C.primary, icon: Megaphone },
                        { l: 'COMMANDES GÉNÉRÉES', v: totalOrders, c: C.success, icon: ShoppingCart },
                        { l: 'REVENUE TOTAL', v: formatPrice(totalRevenue), c: C.orange, icon: DollarSign },
                        { l: 'TOP MARKETER', v: best?.name ?? '—', c: C.info, icon: TrendingUp },
                     ].map((k, i) => (
                        <div key={i} className="bg-white rounded-xl border p-4 flex items-center gap-4" style={{ borderColor: C.border }}>
                           <div className="size-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: k.c + '15' }}>
                              <k.icon className="size-5" style={{ color: k.c }} />
                           </div>
                           <div className="min-w-0">
                              <p className="text-[9px] font-black uppercase tracking-widest text-[#B2BEC3] truncate leading-tight">{k.l}</p>
                              <p className="text-lg font-black text-[#2D3436] truncate">{k.v}</p>
                           </div>
                        </div>
                     ))}
                  </div>

                  {/* Charts */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                     <SectionPanel title="Commandes & Revenue par Marketer" icon={BarChart3} iconColor={C.primary} borderColor={C.primary}>
                        {genericQuery.isLoading ? (
                           <div className="h-[260px] flex items-center justify-center"><Loader2 className="size-6 animate-spin text-[#B2BEC3]" /></div>
                        ) : barData.length === 0 ? <EmptyState /> : (
                           <div className="h-[260px] mt-4">
                              <ResponsiveContainer width="100%" height="100%">
                                 <BarChart data={barData} barGap={4}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F3F6" vertical={false} />
                                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#B2BEC3' }} axisLine={false} tickLine={false} />
                                    <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#B2BEC3' }} axisLine={false} tickLine={false} />
                                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#B2BEC3' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}K`} />
                                    <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => n === 'revenue' ? [`${v}K DA`, 'Revenue'] : [v, 'Commandes']} />
                                    <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                                    <Bar yAxisId="left" name="Commandes" dataKey="commandes" fill={C.primary} radius={[4, 4, 0, 0]} />
                                    <Bar yAxisId="right" name="Revenue (K DA)" dataKey="revenue" fill={C.orange} radius={[4, 4, 0, 0]} />
                                 </BarChart>
                              </ResponsiveContainer>
                           </div>
                        )}
                     </SectionPanel>

                     <SectionPanel title="Part des Commandes par Marketer" icon={Share2} iconColor={C.success} borderColor={C.success}>
                        {genericQuery.isLoading ? (
                           <div className="h-[260px] flex items-center justify-center"><Loader2 className="size-6 animate-spin text-[#B2BEC3]" /></div>
                        ) : barData.length === 0 ? <EmptyState /> : (
                           <div className="h-[260px] mt-4">
                              <ResponsiveContainer width="100%" height="100%">
                                 <PieChart>
                                    <Pie data={barData} dataKey="commandes" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={4}>
                                       {barData.map((_: any, idx: number) => {
                                          const colors = [C.primary, C.success, C.orange, C.info, C.danger, C.warning];
                                          return <Cell key={idx} fill={colors[idx % colors.length]} />;
                                       })}
                                    </Pie>
                                    <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: number, n: string, p: any) => [`${v} cmds`, p.payload?.name]} />
                                    <Legend verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                                 </PieChart>
                              </ResponsiveContainer>
                           </div>
                        )}
                     </SectionPanel>
                  </div>

                  {/* Detailed leaderboard table */}
                  <div className="bg-white rounded-2xl sm:rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
                     <div className="px-5 py-4 border-b bg-[#F8F9FC]" style={{ borderColor: C.border }}>
                        <h3 className="text-sm font-bold text-[#2D3436] flex items-center gap-2">
                           <Megaphone className="size-4" style={{ color: C.primary }} />
                           Classement des Marketers
                        </h3>
                     </div>
                     <div className="overflow-x-auto">
                        <table className="w-full text-left min-w-[800px]">
                           <thead>
                              <tr className="border-b bg-[#F8F9FC]" style={{ borderColor: C.border }}>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72] w-8">#</th>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72]">Marketer</th>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72] text-center">Commandes</th>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72] text-right">Revenue Généré</th>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72] text-center">Part (%)</th>
                                 <th className="px-5 py-3 text-xs font-bold text-[#636E72] text-center">Taux Conv.</th>
                              </tr>
                           </thead>
                           <tbody className="divide-y">
                              {genericQuery.isLoading ? (
                                 <tr><td colSpan={6} className="py-16 text-center"><Loader2 className="size-6 animate-spin mx-auto text-[#B2BEC3]" /></td></tr>
                              ) : marketers.length === 0 ? (
                                 <tr><td colSpan={6}><EmptyState /></td></tr>
                              ) : marketers
                                 .slice()
                                 .sort((a: any, b: any) => b.revenue - a.revenue)
                                 .map((m: any, i: number) => {
                                    const orders = m.orders;
                                    const rev = m.revenue;
                                    const conv = m.conversionRate;
                                    const share = totalOrders > 0 ? ((orders / totalOrders) * 100).toFixed(1) : '0';
                                    const colors = [C.primary, C.success, C.orange, C.info, C.danger, C.warning];
                                    const color = colors[i % colors.length];
                                    return (
                                       <tr key={i} className="hover:bg-[#FAFBFD] transition-colors">
                                          <td className="px-5 py-3.5">
                                             <span className={`text-xs font-black ${i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-orange-700' : 'text-[#B2BEC3]'}`}>{i + 1}</span>
                                          </td>
                                          <td className="px-5 py-3.5">
                                             <div className="flex items-center gap-2.5">
                                                <div className="size-7 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0" style={{ backgroundColor: color }}>
                                                   {(m.name ?? '?').charAt(0).toUpperCase()}
                                                </div>
                                                <span className="text-xs font-bold text-[#2D3436]">{m.name}</span>
                                             </div>
                                          </td>
                                          <td className="px-5 py-3.5 text-center text-xs font-extrabold text-[#6C5CE7]">{orders}</td>
                                          <td className="px-5 py-3.5 text-right text-xs font-black text-[#2D3436]">{formatPrice(rev)}</td>
                                          <td className="px-5 py-3.5 text-center">
                                             <div className="flex flex-col items-center gap-1">
                                                <span className="text-[10px] font-bold text-[#636E72]">{share}%</span>
                                                <div className="w-16 h-1 bg-[#F0F3F6] rounded-full overflow-hidden">
                                                   <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: color }} />
                                                </div>
                                             </div>
                                          </td>
                                          <td className="px-5 py-3.5 text-center">
                                             <span className="text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: C.success + '15', color: C.success }}>
                                                {typeof conv === 'number' ? conv.toFixed(1) : conv}%
                                             </span>
                                          </td>
                                       </tr>
                                    );
                                 })
                              }
                           </tbody>
                        </table>
                     </div>
                  </div>
               </div>
            );
         })()}

         {/* ─── System Telemetry ──────────────────────── */}
         {activeTab === 'system' && (
            <div className="space-y-6">
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                     { l: 'UPTIME SYSTÈME', v: genericQuery.data?.data?.metrics?.uptime || '99.9%', c: C.success, i: CheckCircle },
                     { l: 'RÉPONSE MOYENNE', v: genericQuery.data?.data?.metrics?.avgResponse || '45ms', c: C.primary, i: Zap },
                     { l: 'TAUX D\'ERREUR', v: genericQuery.data?.data?.metrics?.errorRate || '0.01%', c: C.danger, i: AlertCircle },
                     { l: 'CHARGE CLUSTER', v: genericQuery.data?.data?.metrics?.clusterLoad || '42%', c: C.warning, i: Cpu },
                  ].map((k, i) => (
                     <div key={i} className="bg-white rounded-xl border p-5 flex items-center justify-between" style={{ borderColor: C.border }}>
                        <div className="space-y-1">
                           <span className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">{k.l}</span>
                           <p className="text-xl font-black text-[#2D3436] tracking-tighter">{k.v}</p>
                        </div>
                        <div className="size-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: k.c + '15' }}>
                           <k.i className="size-5" style={{ color: k.c }} />
                        </div>
                     </div>
                  ))}
               </div>

               <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <SectionPanel title="Pulsation Système (Requests/min)" icon={Activity} iconColor={C.primary} borderColor={C.primary}>
                     <div className="h-[250px] mt-4">
                        {genericQuery.isLoading ? <Skeleton className="h-full w-full rounded-lg" /> : (
                           <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={genericQuery.data?.data?.throughput || []}>
                                 <defs>
                                    <linearGradient id="pulseGrad" x1="0" y1="0" x2="0" y2="1">
                                       <stop offset="5%" stopColor={C.primary} stopOpacity={0.3} />
                                       <stop offset="95%" stopColor={C.primary} stopOpacity={0.01} />
                                    </linearGradient>
                                 </defs>
                                 <CartesianGrid strokeDasharray="3 3" stroke="#F0F3F6" vertical={false} />
                                 <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#B2BEC3' }} axisLine={false} tickLine={false} />
                                 <YAxis tick={{ fontSize: 9, fill: '#B2BEC3' }} axisLine={false} tickLine={false} />
                                 <RechartsTooltip contentStyle={tooltipStyle} />
                                 <Area type="step" dataKey="value" stroke={C.primary} strokeWidth={2} fill="url(#pulseGrad)" />
                              </AreaChart>
                           </ResponsiveContainer>
                        )}
                     </div>
                  </SectionPanel>

                  <SectionPanel title="Latence Serveur (ms)" icon={Network} iconColor={C.info} borderColor={C.info}>
                     <div className="h-[250px] mt-4">
                        {genericQuery.isLoading ? <Skeleton className="h-full w-full rounded-lg" /> : (
                           <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={genericQuery.data?.data?.latency || []}>
                                 <defs>
                                    <linearGradient id="latGrad" x1="0" y1="0" x2="0" y2="1">
                                       <stop offset="5%" stopColor={C.info} stopOpacity={0.3} />
                                       <stop offset="95%" stopColor={C.info} stopOpacity={0.01} />
                                    </linearGradient>
                                 </defs>
                                 <CartesianGrid strokeDasharray="3 3" stroke="#F0F3F6" vertical={false} />
                                 <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#B2BEC3' }} axisLine={false} tickLine={false} />
                                 <YAxis tick={{ fontSize: 9, fill: '#B2BEC3' }} axisLine={false} tickLine={false} domain={[0, 100]} />
                                 <RechartsTooltip contentStyle={tooltipStyle} />
                                 <Area type="monotone" dataKey="value" stroke={C.info} strokeWidth={2} fill="url(#latGrad)" />
                              </AreaChart>
                           </ResponsiveContainer>
                        )}
                     </div>
                  </SectionPanel>
               </div>

               <div className="bg-[#2D3436] rounded-2xl p-8 border border-neutral-800 text-white relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-8 opacity-10">
                     <Cpu className="size-32" />
                  </div>
                  <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
                     <div>
                        <h3 className="text-xl font-bold tracking-tight">Status du Cluster Central</h3>
                        <p className="text-neutral-400 text-sm mt-1">Tous les nœuds de calcul sont en mode NOMINAL.</p>
                        <div className="flex items-center gap-6 mt-6">
                           <div className="flex flex-col">
                              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Zone</span>
                              <span className="text-sm font-bold">NORTH-AFRICA-1</span>
                           </div>
                           <div className="flex flex-col">
                              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Version</span>
                              <span className="text-sm font-bold">AZ-CORE v4.2.0</span>
                           </div>
                        </div>
                     </div>
                     <button className="px-8 py-3 bg-white text-black text-xs font-black rounded-xl hover:scale-105 transition-all uppercase tracking-widest">Redémarrer Nœuds</button>
                  </div>
               </div>
            </div>
         )}
      </div>
   );
}
