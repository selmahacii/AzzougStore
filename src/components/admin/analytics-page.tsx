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

function MetricRow({ label, value, suffix = "(DZD)", badge }: {
   label: string; value: string | number; suffix?: string; badge?: string;
}) {
   return (
      <div className="flex items-center justify-between py-3 border-b border-[#F0F3F6] last:border-0 hover:bg-[#FAFBFD] px-3 -mx-3 rounded transition-colors">
         <span className="text-[13px] font-medium text-[#636E72]">{label}</span>
         <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-[#2D3436] tabular-nums">{value}</span>
            {suffix && <span className="text-[10px] font-semibold text-[#B2BEC3]">{suffix}</span>}
            {badge && (
               <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">{badge}</span>
            )}
         </div>
      </div>
   );
}

function PerformanceGauge({ label, value, color }: { label: string; value: number; color: string }) {
   const radius = 42;
   const circumference = 2 * Math.PI * radius;
   const offset = circumference - (Math.min(value, 100) / 100) * circumference;
   return (
      <div className="flex flex-col items-center gap-2">
         <div className="relative size-24">
            <svg className="size-full transform -rotate-90">
               <circle cx="48" cy="48" r={radius} className="fill-transparent" stroke="#F0F3F6" strokeWidth="7" />
               <circle cx="48" cy="48" r={radius} className="fill-transparent transition-all duration-1000"
                  stroke={color} strokeWidth="7" strokeLinecap="round"
                  style={{ strokeDasharray: circumference, strokeDashoffset: offset }}
               />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center flex-col">
               <span className="text-[13px] font-extrabold tabular-nums" style={{ color }}>{value}%</span>
            </div>
         </div>
         <span className="text-[10px] font-bold text-[#636E72] text-center max-w-[90px] leading-tight">{label}</span>
      </div>
   );
}

function SectionPanel({ title, icon: Icon, iconColor, borderColor, children }: {
   title: string; icon: React.ElementType; iconColor: string; borderColor: string; children: React.ReactNode;
}) {
   return (
      <div className="bg-white rounded-xl border border-[#E9ECF0] overflow-hidden">
         <div className="px-5 py-4 border-b-2" style={{ borderColor }}>
            <div className="flex items-center gap-3">
               <div className="size-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: iconColor + '15' }}>
                  <Icon className="size-4" style={{ color: iconColor }} />
               </div>
               <h3 className="text-sm font-bold" style={{ color: iconColor }}>{title}</h3>
            </div>
         </div>
         <div className="p-5">
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

   return (
      <div className="space-y-5 animate-in fade-in duration-500 pb-28" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

         {/* ─── Dynamic Header ────────────────────────── */}
         <div className="bg-white rounded-xl border px-8 py-10" style={{ borderColor: C.border }}>
            <div className="flex items-center justify-between">
               <div className="flex items-center gap-6">
                  <div className="size-16 rounded-2xl flex items-center justify-center shadow-sm" style={{ backgroundColor: C.primaryBg }}>
                     {React.createElement(TAB_INFO[activeTab]?.icon || BarChart3, { 
                        className: "size-8", 
                        style: { color: C.primary } 
                     })}
                  </div>
                  <div className="space-y-1">
                     <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Suivi d'activité & Performance</span>
                        <div className="size-1.5 rounded-full bg-emerald-500" />
                     </div>
                     <h1 className="text-4xl font-black uppercase tracking-tighter text-[#2D3436]">
                        {TAB_INFO[activeTab]?.label || 'Performance (KPI)'}
                     </h1>
                  </div>
               </div>
               <div className="flex bg-[#F8F9FC] border border-[#E9ECF0] rounded-lg p-1">
                  {['today', '7d', '30d', 'all_time'].map(p => (
                     <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className={cn(
                           "px-4 py-1.5 text-xs font-bold rounded transition-all",
                           period === p ? "bg-white text-[#2D3436] shadow-sm border border-[#E9ECF0]" : "text-[#B2BEC3] hover:text-[#2D3436]"
                        )}
                     >
                        {p === 'today' ? "Aujourd'hui" : p === '7d' ? '7 Jours' : p === '30d' ? '30 Jours' : 'Tout'}
                     </button>
                  ))}
               </div>
            </div>
         </div>

         {/* ─── KPI Main View ────────────────────────── */}
         {activeTab === 'kpi' && (
            <>
               <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <SectionPanel title="Revenus & Profits" icon={Wallet} iconColor={C.primary} borderColor={C.primary}>
                     <div className="space-y-0">
                        <MetricRow label="Ventes" value={kpi?.totalRevenue ? formatPrice(kpi.totalRevenue) : '0'} />
                        <MetricRow label="Revenus" value={kpi?.netRevenue ? formatPrice(kpi.netRevenue) : '0'} />
                        <MetricRow label="Bénéfices" value={kpi?.totalProfit ? formatPrice(kpi.totalProfit) : (kpi?.profitPerOrder && kpi?.deliveredOrders ? formatPrice(kpi.profitPerOrder * kpi.deliveredOrders) : '0')} badge={kpi?.avgOrderValue && kpi?.profitPerOrder && kpi.avgOrderValue > 0 ? `${((kpi.profitPerOrder / kpi.avgOrderValue) * 100).toFixed(0)}%` : undefined} />
                        <MetricRow label="ROI" value={`${kpi?.roas || 0}%`} suffix="" />
                        <MetricRow label="Capital" value={kpi?.totalRevenue ? formatPrice(kpi.totalRevenue) : '0'} />
                     </div>
                  </SectionPanel>

                  <SectionPanel title="Dépenses & Frais" icon={CreditCard} iconColor={C.orange} borderColor={C.orange}>
                     <div className="space-y-0">
                        <MetricRow label="Frais de livraison" value={kpi?.shippingFeeGap ? formatPrice(Math.abs(kpi.shippingFeeGap)) : '0'} />
                        <MetricRow label="CAC" value={kpi?.cac ? formatPrice(kpi.cac) : '0'} />
                        <MetricRow label="LTV" value={kpi?.ltv ? formatPrice(kpi.ltv) : '0'} />
                        <MetricRow label="Coût des Produits" value="Indisponible" />
                     </div>
                  </SectionPanel>

                  <SectionPanel title="Performance" icon={Target} iconColor={C.success} borderColor={C.success}>
                     <div className="grid grid-cols-2 gap-6 place-items-center py-4">
                        <PerformanceGauge label="Confirmation" value={kpi?.confirmationPerformance || 0} color={C.primary} />
                        <PerformanceGauge label="Livraison" value={kpi?.deliveryPerformance || 0} color={C.success} />
                        <PerformanceGauge label="Conversion" value={kpi?.conversionRate || 0} color={C.orange} />
                        <PerformanceGauge label="Retour" value={kpi?.returnRate || 0} color={C.danger} />
                     </div>
                  </SectionPanel>
               </div>

               <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 bg-white rounded-xl border overflow-hidden" style={{ borderColor: C.border }}>
                     <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
                        <div className="flex items-center gap-3">
                           <div className="size-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: C.primaryBg }}>
                              <TrendingUp className="size-4" style={{ color: C.primary }} />
                           </div>
                           <h3 className="text-sm font-bold text-[#2D3436]">Évolution des ventes (Multi-Canal)</h3>
                        </div>
                     </div>
                     <div className="p-5 h-[350px]">
                        {revenueQuery.isLoading ? (
                           <Skeleton className="h-full w-full rounded-lg" style={{ backgroundColor: C.bg }} />
                        ) : (
                           <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={chartData}>
                                 <defs>
                                    <linearGradient id="orderGrad" x1="0" y1="0" x2="0" y2="1">
                                       <stop offset="5%" stopColor={C.primary} stopOpacity={0.3} />
                                       <stop offset="95%" stopColor={C.primary} stopOpacity={0.02} />
                                    </linearGradient>
                                    <linearGradient id="posGrad" x1="0" y1="0" x2="0" y2="1">
                                       <stop offset="5%" stopColor={C.info} stopOpacity={0.3} />
                                       <stop offset="95%" stopColor={C.info} stopOpacity={0.02} />
                                    </linearGradient>
                                 </defs>
                                 <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase' }} />
                                 <CartesianGrid strokeDasharray="3 3" stroke="#F0F3F6" vertical={false} />
                                 <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#B2BEC3', fontWeight: 600 }} axisLine={false} tickLine={false} />
                                 <YAxis tick={{ fontSize: 10, fill: '#B2BEC3', fontWeight: 600 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`} />
                                 <RechartsTooltip contentStyle={tooltipStyle} />
                                 <Area name="E-commerce" type="monotone" dataKey="orderRevenue" stroke={C.primary} strokeWidth={2.5} fillOpacity={1} fill="url(#orderGrad)" stackId="1" />
                                 <Area name="POS (Magasin)" type="monotone" dataKey="posRevenue" stroke={C.info} strokeWidth={2.5} fillOpacity={1} fill="url(#posGrad)" stackId="1" />
                              </AreaChart>
                           </ResponsiveContainer>
                        )}
                     </div>
                  </div>

                  <SectionPanel title="Répartition par Canal" icon={Share2} iconColor={C.info} borderColor={C.info}>
                     <div className="h-[280px] w-full mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                           <PieChart>
                              <Pie
                                 data={[
                                    { name: 'E-commerce', value: kpi?.orderRevenue || 0 },
                                    { name: 'POS (Magasin)', value: kpi?.posRevenue || 0 }
                                 ].filter(d => d.value > 0)}
                                 innerRadius={60}
                                 outerRadius={80}
                                 paddingAngle={5}
                                 dataKey="value"
                              >
                                 <Cell fill={C.primary} />
                                 <Cell fill={C.info} />
                              </Pie>
                              <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: number) => formatPrice(v)} />
                              <Legend verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                           </PieChart>
                        </ResponsiveContainer>
                     </div>
                     <div className="space-y-3 mt-4">
                        <div className="flex items-center justify-between text-[11px] font-bold">
                           <span className="text-[#636E72]">Contribution Digitale</span>
                           <span className="text-[#6C5CE7]">
                              {kpi?.totalRevenue ? ((kpi.orderRevenue / kpi.totalRevenue) * 100).toFixed(1) : '100'}%
                           </span>
                        </div>
                        <div className="w-full h-1.5 bg-[#F0F3F6] rounded-full overflow-hidden">
                           <div className="h-full bg-[#6C5CE7]" style={{ width: kpi?.totalRevenue ? `${(kpi.orderRevenue / kpi.totalRevenue) * 100}%` : '100%' }} />
                        </div>
                     </div>
                  </SectionPanel>
               </div>
            </>
         )}

         {/* ─── Orders Analytics ──────────────────────── */}
         {activeTab === 'orders' && (
            <div className="space-y-6">
               <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                  {[
                     { l: 'TOTAL', v: kpi?.totalOrders || 0, c: C.primary },
                     { l: 'NOUVELLES', v: kpi?.pendingOrders || 0, c: C.warning },
                     { l: 'CONFIRMÉES', v: kpi?.confirmedOrders || 0, c: C.success },
                     { l: 'LIVRÉES', v: kpi?.deliveredOrders || 0, c: C.success },
                     { l: 'RETOURNÉES', v: kpi?.returnedOrders || 0, c: C.danger },
                  ].map((k, i) => (
                     <div key={i} className="bg-white rounded-xl border p-3 flex flex-col justify-between h-24" style={{ borderColor: C.border }}>
                        <span className="text-[9px] font-black uppercase tracking-tight text-[#B2BEC3] leading-tight">{k.l}</span>
                        <div className="mt-auto">
                           <span className="text-xl font-black text-[#2D3436] tracking-tighter">{k.v}</span>
                        </div>
                     </div>
                  ))}
               </div>

               <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: C.border }}>
                  <div className="overflow-x-auto">
                     <table className="w-full text-left">
                        <thead>
                           <tr className="border-b bg-[#F8F9FC]" style={{ borderColor: C.border }}>
                              <th className="px-5 py-4 text-xs font-bold text-[#636E72]">Statut de la Commande</th>
                              <th className="px-5 py-4 text-xs font-bold text-[#636E72] text-center">Quantité</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y">
                           {[
                              { s: 'Nouvelles', v: kpi?.pendingOrders || 0 },
                              { s: 'Confirmées', v: kpi?.confirmedOrders || 0 },
                              { s: 'Livrées', v: kpi?.deliveredOrders || 0 },
                              { s: 'Retournées', v: kpi?.returnedOrders || 0 },
                           ].map((r, i) => (
                              <tr key={i} className="hover:bg-[#FAFBFD] transition-colors">
                                 <td className="px-5 py-4 text-[11px] font-bold text-[#2D3436]">{r.s}</td>
                                 <td className="px-5 py-4 text-xs font-extrabold text-[#2D3436] text-center">{r.v}</td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                  </div>
               </div>
            </div>
         )}

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
                        { l: 'REVENUE TOTAL', v: `${formatPrice(totalRevenue)} DA`, c: C.orange, icon: DollarSign },
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
                  <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: C.border }}>
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
            <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: C.border }}>
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
            <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: C.border }}>
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
                  <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: C.border }}>
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
            const marketers: any[] = genericQuery.data?.data || [];
            const totalOrders = marketers.reduce((s: number, m: any) => s + (m.count ?? m.orders ?? 0), 0);
            const totalRevenue = marketers.reduce((s: number, m: any) => s + (m.revenue ?? m.value ?? 0), 0);
            const avgConv = marketers.length > 0
               ? (marketers.reduce((s: number, m: any) => s + (m.conversionRate ?? m.rate ?? 0), 0) / marketers.length).toFixed(1)
               : '0';
            const best = marketers.length > 0 ? marketers.reduce((a: any, b: any) =>
               (a.revenue ?? a.value ?? 0) > (b.revenue ?? b.value ?? 0) ? a : b) : null;
            const barData = marketers.map((m: any) => ({
               name: (m.name ?? '?').split(' ')[0],
               commandes: m.count ?? m.orders ?? 0,
               revenue: Math.round((m.revenue ?? m.value ?? 0) / 1000),
               taux: parseFloat((m.conversionRate ?? m.rate ?? 0).toFixed(1)),
            }));
            return (
               <div className="space-y-6">
                  {/* KPI cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                     {[
                        { l: 'MARKETERS ACTIFS', v: marketers.length, c: C.primary, icon: Megaphone },
                        { l: 'COMMANDES GÉNÉRÉES', v: totalOrders, c: C.success, icon: ShoppingCart },
                        { l: 'REVENUE TOTAL', v: `${formatPrice(totalRevenue)} DA`, c: C.orange, icon: DollarSign },
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
                  <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: C.border }}>
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
                                 .sort((a: any, b: any) => (b.revenue ?? b.value ?? 0) - (a.revenue ?? a.value ?? 0))
                                 .map((m: any, i: number) => {
                                    const orders = m.count ?? m.orders ?? 0;
                                    const rev = m.revenue ?? m.value ?? 0;
                                    const conv = m.conversionRate ?? m.rate ?? 0;
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
                                          <td className="px-5 py-3.5 text-right text-xs font-black text-[#2D3436]">{formatPrice(rev)} DA</td>
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
