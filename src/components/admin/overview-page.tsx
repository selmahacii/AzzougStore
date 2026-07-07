'use client';

import React, { type ElementType, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
   ShoppingCart,
   DollarSign,
   CheckCircle,
   Truck,
   TrendingUp,
   Home,
   Filter,
   Users,
   Target,
   RefreshCw,
   Package,
   MapPin,
   Star,
   Award,
   Briefcase,
   UserCheck,
   BarChart3,
   Wallet,
   CreditCard,
   RotateCcw,
   ShieldCheck,
   Percent,
   ArrowUpRight,
   ArrowDownRight,
   Bot,
   Youtube,
   MessageCircle,
   ThumbsUp,
   Maximize2,
   Moon,
   Bell,
   Globe,
   Box,
   Hash,
   Clock,
   Zap,
   History
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
   ResponsiveContainer,
   AreaChart,
   Area,
   XAxis,
   YAxis,
   CartesianGrid,
   Tooltip as RechartsTooltip,
   BarChart,
   Bar,
} from 'recharts';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { apiFetch } from '@/lib/api-client';
import type {
   KpiData,
   ApiResponse,
   RevenueDataPoint,
   TopItem,
} from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// CODpilot-style Color System
// ═══════════════════════════════════════════════════════════════
const COLORS = {
   primary: '#6C5CE7',    // Purple
   primaryLight: '#A29BFE',
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
   border: '#E9ECF0',
   cardBg: '#FFFFFF',
   pageBg: '#F8F9FC',
};

// ═══════════════════════════════════════════════════════════════
// Reusable Components
// ═══════════════════════════════════════════════════════════════

function KpiCard({ title, value, icon: Icon, color, bgColor, suffix, change }: {
   title: string; value: string | number; icon: ElementType; color: string; bgColor: string; suffix?: string; change?: number;
}) {
   return (
      <div className="bg-white rounded-xl border border-[#E9ECF0] p-5 flex items-center gap-4 hover:shadow-md transition-all group">
         <div className="size-12 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: bgColor }}>
            <Icon className="size-5" style={{ color }} />
         </div>
         <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color }}>{title}</p>
            <div className="flex items-baseline gap-2 mt-0.5">
               <span className="text-2xl font-extrabold text-[#2D3436] tabular-nums">{value}</span>
               {suffix && <span className="text-[10px] font-semibold text-[#B2BEC3]">{suffix}</span>}
            </div>
            {change !== undefined && (
               <div className={cn("text-[10px] font-bold mt-1 flex items-center gap-1", change >= 0 ? "text-[#00B894]" : "text-[#E17055]")}>
                  {change >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                  {Math.abs(change)}% vs période précédente
               </div>
            )}
         </div>
      </div>
   );
}

function SectionCard({ title, icon: Icon, iconColor, children, className, action }: {
   title: string; icon: ElementType; iconColor?: string; children: React.ReactNode; className?: string; action?: React.ReactNode;
}) {
   return (
      <div className={cn("bg-white rounded-xl border border-[#E9ECF0] overflow-hidden", className)}>
         <div className="px-5 py-4 border-b border-[#E9ECF0] flex items-center justify-between">
            <div className="flex items-center gap-3">
               <div className="size-8 rounded-lg flex items-center justify-center bg-[#F8F9FC]">
                  <Icon className="size-4" style={{ color: iconColor || COLORS.primary }} />
               </div>
               <h3 className="text-sm font-bold text-[#2D3436]">{title}</h3>
            </div>
            {action || <TrendingUp className="size-4 text-[#DFE6E9]" />}
         </div>
         <div className="p-5">
            {children}
         </div>
      </div>
   );
}

function EmptyState({ message = "Aucune donnée trouvée" }) {
   return (
      <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
         <p className="text-sm font-semibold text-[#B2BEC3]">{message}</p>
      </div>
   );
}

function MetricRow({ label, value, suffix = "(DZD)", color }: { label: string; value: string | number; suffix?: string; color?: string }) {
   return (
      <div className="flex items-center justify-between py-3 border-b border-[#F0F3F6] last:border-0 hover:bg-[#FAFBFD] px-2 -mx-2 rounded transition-colors">
         <span className="text-[13px] font-medium text-[#636E72]">{label}</span>
         <div className="flex items-baseline gap-1.5">
            <span className="text-[13px] font-bold tabular-nums" style={{ color: color || '#2D3436' }}>{value}</span>
            {suffix && <span className="text-[10px] font-semibold text-[#B2BEC3]">{suffix}</span>}
         </div>
      </div>
   );
}

function PerformanceGauge({ label, value, color }: { label: string; value: number; color: string }) {
   const radius = 45;
   const circumference = 2 * Math.PI * radius;
   const offset = circumference - (value / 100) * circumference;

   return (
      <div className="flex flex-col items-center justify-center gap-2">
         <div className="relative size-28">
            <svg className="size-full transform -rotate-90">
               <circle cx="56" cy="56" r={radius} className="fill-transparent" stroke="#F0F3F6" strokeWidth="8" />
               <circle cx="56" cy="56" r={radius} className="fill-transparent transition-all duration-1000"
                  stroke={color}
                  strokeWidth="8"
                  strokeLinecap="round"
                  style={{ strokeDasharray: circumference, strokeDashoffset: offset }}
               />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center flex-col">
               <span className="text-lg font-extrabold tabular-nums" style={{ color }}>{value}%</span>
            </div>
         </div>
         <span className="text-[11px] font-semibold text-[#636E72] text-center max-w-[100px] leading-tight">{label}</span>
      </div>
   );
}

// ═══════════════════════════════════════════════════════════════
// Algeria SVG Map Component
// ═══════════════════════════════════════════════════════════════
function AlgeriaMap() {
   return (
      <div className="relative w-full aspect-[1/1.1] flex items-center justify-center">
         <svg viewBox="0 0 600 700" className="w-full h-full">
            <path
               d="M180,60 L220,40 L280,35 L340,30 L400,40 L450,55 L480,50 L510,70
               L530,100 L540,140 L535,180 L545,220 L530,260 L535,300
               L520,340 L530,380 L510,420 L520,460 L500,500 L480,540
               L450,570 L420,600 L380,630 L340,650 L300,660 L260,650
               L220,630 L190,600 L160,570 L140,530 L120,490 L100,450
               L90,400 L80,360 L70,310 L65,260 L70,220 L80,180
               L90,140 L110,100 L140,80 Z"
               fill="#EEF0F5"
               stroke="#D1D8E0"
               strokeWidth="2"
            />
            <path d="M200,200 L400,180 M150,300 L500,280 M180,400 L480,390 M250,500 L420,490"
               stroke="#D1D8E0" strokeWidth="1" fill="none" />
            <path d="M300,40 L290,250 M300,250 L280,500 M200,150 L250,450 M400,120 L380,480"
               stroke="#D1D8E0" strokeWidth="1" fill="none" />
            <circle cx="310" cy="100" r="12" fill={COLORS.primary} opacity="0.3" />
            <circle cx="310" cy="100" r="6" fill={COLORS.primary} opacity="0.7" />
            <circle cx="250" cy="130" r="10" fill={COLORS.success} opacity="0.3" />
            <circle cx="250" cy="130" r="5" fill={COLORS.success} opacity="0.7" />
            <circle cx="380" cy="120" r="8" fill={COLORS.warning} opacity="0.3" />
            <circle cx="380" cy="120" r="4" fill={COLORS.warning} opacity="0.7" />
         </svg>
         <div className="absolute top-2 right-2 flex flex-col gap-1">
            <button className="size-7 bg-white border border-[#E9ECF0] rounded-md flex items-center justify-center text-[#636E72] hover:bg-[#F8F9FC] text-xs font-bold">+</button>
            <button className="size-7 bg-white border border-[#E9ECF0] rounded-md flex items-center justify-center text-[#636E72] hover:bg-[#F8F9FC] text-xs font-bold">−</button>
            <button className="size-7 bg-white border border-[#E9ECF0] rounded-md flex items-center justify-center text-[#636E72] hover:bg-[#F8F9FC]">
               <Globe className="size-3" />
            </button>
         </div>
         {/* Legend */}
         <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1">
            <span className="text-[10px] font-bold text-[#636E72]">High</span>
            <div className="w-4 h-20 rounded-full overflow-hidden border border-[#E9ECF0]">
               <div className="w-full h-full bg-gradient-to-b from-[#6C5CE7] via-[#A29BFE] to-[#DFE6E9]" />
            </div>
            <div className="flex items-baseline gap-1">
               <span className="text-sm font-extrabold text-[#2D3436]">0</span>
            </div>
            <span className="text-[10px] font-bold text-[#636E72]">Low</span>
         </div>
      </div>
   );
}

function ConfirmateurPerformance({ user, kpi, storeId }: { user: any; kpi: any; storeId: string }) {
   const rate = user?.payment_amount || 0;
   const paymentType = user?.payment_type || 'PER_DELIVERED_ORDER';

   let estimatedSalary = 0;
   if (paymentType === 'PER_DELIVERED_ORDER') estimatedSalary = (kpi?.deliveredOrders || 0) * rate;
   else if (paymentType === 'PER_CONFIRMED_ORDER') estimatedSalary = (kpi?.confirmedOrders || 0) * rate;
   else if (paymentType === 'MONTHLY_SALARY') estimatedSalary = rate;
   else estimatedSalary = (kpi?.confirmedOrders || 0) * 100;

   const dailyTarget = user?.dailyTarget || user?.daily_target || 10;

   const recentOrdersQuery = useQuery<any>({
      queryKey: ['agent-recent-orders', user?.id, storeId],
      queryFn: () =>
         fetch(`/api/v1/orders?store_id=${storeId}&pageSize=5&assigned_to=${user?.id}`)
            .then(r => r.json()),
      refetchInterval: 30000,
      enabled: !!user?.id && !!storeId,
   });

   const recentOrders: any[] = recentOrdersQuery.data?.data ?? [];

   const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
      CONFIRMED: { label: 'Confirmée', cls: 'bg-emerald-50 text-emerald-600' },
      DELIVERED: { label: 'Livrée', cls: 'bg-blue-50 text-blue-600' },
      CALLED:    { label: 'Appelée', cls: 'bg-amber-50 text-amber-600' },
      CANCELLED: { label: 'Annulée', cls: 'bg-red-50 text-red-600' },
      ASSIGNED:  { label: 'Assignée', cls: 'bg-purple-50 text-purple-600' },
      PENDING:   { label: 'En attente', cls: 'bg-slate-50 text-slate-500' },
      NEW:       { label: 'Nouvelle', cls: 'bg-indigo-50 text-indigo-600' },
   };

   return (
      <div className="space-y-6">
         <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KpiCard title="Salaire Estimé" value={formatPrice(estimatedSalary)} suffix="DZD" icon={Wallet} color={COLORS.success} bgColor={COLORS.successBg} />
            <KpiCard title="Commandes Confirmées" value={kpi?.confirmedOrders || 0} suffix="cmd" icon={CheckCircle} color={COLORS.primary} bgColor={COLORS.primaryBg} />
            <KpiCard title="Objectif Journalier" value={dailyTarget} suffix="cmd/j" icon={Target} color={COLORS.warning} bgColor={COLORS.warningBg} />
         </div>

         <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="Ma Progression" icon={Zap} iconColor={COLORS.primary}>
               <div className="flex flex-col items-center justify-center py-6 gap-4">
                  <PerformanceGauge label="Taux de Confirmation" value={kpi?.confirmationPerformance || 0} color={COLORS.primary} />
                  <div className="w-full bg-slate-100 rounded-full h-2">
                     <div
                        className="h-2 rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(100, Math.round(((kpi?.confirmedOrders || 0) / dailyTarget) * 100))}%`, backgroundColor: COLORS.primary }}
                     />
                  </div>
                  <p className="text-[11px] font-bold text-slate-500 text-center">
                     {kpi?.confirmedOrders || 0} / {dailyTarget} confirmations aujourd'hui
                  </p>
               </div>
            </SectionCard>

            <SectionCard title="Commandes récentes" icon={History} iconColor={COLORS.info}>
               <div className="space-y-1">
                  {recentOrdersQuery.isLoading ? (
                     <div className="py-8 text-center text-xs text-slate-400 font-bold">Chargement...</div>
                  ) : recentOrders.length === 0 ? (
                     <div className="py-8 text-center text-xs text-slate-400 font-bold">Aucune commande assignée</div>
                  ) : recentOrders.map((o: any) => {
                     const badge = STATUS_BADGE[o.status] ?? { label: o.status, cls: 'bg-slate-50 text-slate-500' };
                     const minutes = Math.round((Date.now() - new Date(o.created_at).getTime()) / 60000);
                     const timeLabel = minutes < 60 ? `Il y a ${minutes}min` : minutes < 1440 ? `Il y a ${Math.round(minutes / 60)}h` : new Date(o.created_at).toLocaleDateString('fr-FR');
                     return (
                        <div key={o.id} className="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0 hover:bg-slate-50 px-1 rounded-lg transition-colors">
                           <div className="size-8 rounded-lg bg-slate-100 flex items-center justify-center text-[9px] font-black text-slate-500 shrink-0">
                              #{o.order_number?.split('-').pop()}
                           </div>
                           <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-slate-800 truncate">{o.customer_name}</p>
                              <p className="text-[10px] text-slate-400 font-medium">{timeLabel}</p>
                           </div>
                           <span className={`text-[9px] font-black px-2 py-0.5 rounded-full shrink-0 ${badge.cls}`}>{badge.label}</span>
                        </div>
                     );
                  })}
               </div>
            </SectionCard>
         </div>
      </div>
   );
}

// ═══════════════════════════════════════════════════════════════
// Main Overview Page
// ═══════════════════════════════════════════════════════════════
export default function OverviewPage() {
   const { activeStore, user: currentUser } = useAppStore();
   const storeId = activeStore?.id ?? '';

   // ─── State for Filters ───────────────────────────
   const [selectedPeriod, setSelectedPeriod] = React.useState('all_time');
   const [displayMode, setDisplayMode] = React.useState<'numbers' | 'percentage'>('numbers');

   const kpiQuery = useQuery<ApiResponse<KpiData>>({
      queryKey: ['analytics', 'kpi', storeId, selectedPeriod],
      queryFn: () => apiFetch(`/api/v1/analytics?store_id=${storeId}&type=kpi&period=${selectedPeriod}`),
   });

   const revenueQuery = useQuery<ApiResponse<RevenueDataPoint[]>>({
      queryKey: ['analytics', 'revenue', storeId, selectedPeriod],
      queryFn: () => apiFetch(`/api/v1/analytics?store_id=${storeId}&type=revenue&period=${selectedPeriod}`),
   });

   const topProductsQuery = useQuery<ApiResponse<TopItem[]>>({
      queryKey: ['analytics', 'products', storeId, selectedPeriod],
      queryFn: () => apiFetch(`/api/v1/analytics?store_id=${storeId}&type=products&period=${selectedPeriod}`),
   });

   const topWilayasQuery = useQuery<ApiResponse<TopItem[]>>({
      queryKey: ['analytics', 'wilayas', storeId, selectedPeriod],
      queryFn: () => apiFetch(`/api/v1/analytics?store_id=${storeId}&type=wilayas&period=${selectedPeriod}`),
   });

   const topAgentsQuery = useQuery<ApiResponse<TopItem[]>>({
      queryKey: ['analytics', 'agents', storeId, selectedPeriod],
      queryFn: () => apiFetch(`/api/v1/analytics?store_id=${storeId}&type=agents&period=${selectedPeriod}`),
   });

   const kpi = kpiQuery.data?.data;
   const revenueData = revenueQuery.data?.data ?? [];
   const topProducts = topProductsQuery.data?.data ?? [];
   const topWilayas = topWilayasQuery.data?.data ?? [];
   const topAgents = topAgentsQuery.data?.data ?? [];

   const chartData = revenueData.map((d) => ({
      ...d,
      date: new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
   }));

   const filterOptions = [
      { label: 'Tout le temps', value: 'all_time' },
      { label: "Aujourd'hui", value: 'today' },
      { label: 'Hier', value: 'yesterday' },
      { label: 'La semaine dernière', value: 'last_week' },
      { label: 'Le mois dernier', value: 'last_month' },
   ];

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
      <div className="space-y-6 animate-in fade-in duration-500" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

         {/* ─── Header & Filters ─────────────────────────── */}
         <div className="bg-white rounded-xl border border-[#E9ECF0] px-4 sm:px-6 py-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 mb-6">
               <div className="flex items-center gap-3">
                  <div className="size-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: COLORS.primaryBg }}>
                     <Home className="size-4" style={{ color: COLORS.primary }} />
                  </div>
                  <h1 className="text-sm sm:text-base font-extrabold uppercase tracking-wider text-[#2D3436]">Tableau de Bord</h1>
               </div>
               <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-xs font-bold w-full sm:w-auto justify-center" style={{ backgroundColor: COLORS.primary }}>
                  <Filter className="size-3.5" />
                  Filtres
               </button>
            </div>

            <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-4">
               <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {filterOptions.map(f => (
                     <button
                        key={f.value}
                        onClick={() => setSelectedPeriod(f.value)}
                        className={cn(
                           "px-4 py-2 text-xs font-bold rounded-full transition-all border",
                           selectedPeriod === f.value
                              ? "text-white border-transparent"
                              : "bg-[#F8F9FC] text-[#636E72] border-[#E9ECF0] hover:border-[#B2BEC3]"
                        )}
                        style={selectedPeriod === f.value ? { backgroundColor: COLORS.primary } : undefined}
                     >
                        {f.label}
                     </button>
                  ))}
               </div>
               <div className="flex bg-[#F8F9FC] border border-[#E9ECF0] rounded-lg p-1">
                  <button 
                     onClick={() => setDisplayMode('percentage')}
                     className={cn(
                        "px-4 py-1.5 text-xs font-bold rounded transition-colors",
                        displayMode === 'percentage' ? "bg-white text-[#2D3436] shadow-sm border border-[#E9ECF0]" : "text-[#B2BEC3] hover:text-[#2D3436]"
                     )}
                  >
                     Pourcentage %
                  </button>
                  <button 
                     onClick={() => setDisplayMode('numbers')}
                     className={cn(
                        "px-4 py-1.5 text-xs font-bold rounded transition-colors",
                        displayMode === 'numbers' ? "bg-white text-[#2D3436] shadow-sm border border-[#E9ECF0]" : "text-[#B2BEC3] hover:text-[#2D3436]"
                     )}
                  >
                     <Hash className="size-3 inline mr-1" />Nombres
                  </button>
               </div>
            </div>
         </div>

         {/* ─── Role Based View ─────────────────────────── */}
         {currentUser?.role === 'CONFIRMATEUR' ? (
            <ConfirmateurPerformance user={currentUser} kpi={kpi} storeId={storeId} />
         ) : (
            <>
               {/* ─── Top KPI Cards ─────────────────────────── */}
               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <KpiCard title="Total des Commandes" value={kpi?.totalOrders || 0} icon={ShoppingCart} color={COLORS.danger} bgColor={COLORS.dangerBg} change={kpi?.ordersChange} />
                  <KpiCard title="Commandes Confirmées" value={kpi?.confirmedOrders || 0} icon={CheckCircle} color={COLORS.success} bgColor={COLORS.successBg} />
                  <KpiCard title="Commandes Livrées" value={kpi?.deliveredOrders || 0} icon={Truck} color={COLORS.info} bgColor={COLORS.infoBg} />
                  <KpiCard title="Ventes" value={kpi?.totalRevenue ? formatPrice(kpi.totalRevenue) : '0'} suffix="(DZD)" icon={DollarSign} color={COLORS.primary} bgColor={COLORS.primaryBg} change={kpi?.revenueChange} />
               </div>

               {/* ─── Revenue & Maps Row ─────────────────────── */}
               <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <SectionCard title="Meilleurs produits" icon={Package} iconColor={COLORS.primary}>
                     <div className="space-y-1">
                        {topProducts.length === 0 ? <EmptyState /> : topProducts.map((p, idx) => (
                           <div key={p.id} className="flex items-center justify-between py-2 border-b border-[#F0F3F6] last:border-0 hover:bg-[#FAFBFD] px-2 -mx-2 rounded transition-colors">
                              <div className="flex items-center gap-3">
                                 <span className="text-[10px] font-bold text-[#B2BEC3] w-4">{idx + 1}</span>
                                 <span className="text-[13px] font-medium text-[#2D3436] truncate max-w-[180px]">{p.name}</span>
                              </div>
                              <div className="flex flex-col items-end">
                                 <span className="text-[13px] font-bold text-[#2D3436]">{formatPrice(p.value)}</span>
                                 <span className="text-[10px] font-semibold text-[#6C5CE7]">{p.count} vendus</span>
                              </div>
                           </div>
                        ))}
                     </div>
                  </SectionCard>

                  <SectionCard title="Top Wilayas" icon={MapPin} iconColor={COLORS.success}>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
                        <div className="flex flex-col gap-1 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar">
                           {topWilayas.map((w, idx) => (
                              <div key={w.id} className="flex items-center justify-between py-1.5 border-b border-[#F0F3F6] last:border-0">
                                 <span className="text-[12px] font-medium text-[#636E72]">{idx + 1}. {w.name}</span>
                                 <span className="text-[12px] font-bold text-[#2D3436]">{w.count || w.value} cmd.</span>
                              </div>
                           ))}
                           {topWilayas.length === 0 && <EmptyState />}
                        </div>
                        <AlgeriaMap />
                     </div>
                  </SectionCard>
               </div>

               {/* ─── Performance Hub (4 Columns) ──────────────── */}
               <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                  {/* Top Agents */}
                  <div className="bg-white rounded-xl border border-[#E9ECF0] overflow-hidden">
                     <div className="px-5 py-4 border-b-2" style={{ borderColor: COLORS.info }}>
                        <div className="flex items-center gap-3">
                           <div className="size-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: COLORS.infoBg }}>
                              <UserCheck className="size-4" style={{ color: COLORS.info }} />
                           </div>
                           <h3 className="text-sm font-bold" style={{ color: COLORS.info }}>Top Agents</h3>
                        </div>
                     </div>
                     <div className="p-4 space-y-1">
                        {topAgents.map((a, idx) => (
                           <div key={a.id} className="flex items-center justify-between py-2 border-b border-[#F0F3F6] last:border-0 hover:bg-[#FAFBFD] px-1 rounded transition-colors">
                              <div className="flex items-center gap-2">
                                 <span className="text-[11px] font-bold text-[#6C5CE7]">{a.value.toFixed(0)}%</span>
                                 <span className="text-[12px] font-medium text-[#2D3436]">{a.name}</span>
                              </div>
                              <span className="text-[11px] font-semibold text-[#B2BEC3]">{a.count} traitées</span>
                           </div>
                        ))}
                        {topAgents.length === 0 && <EmptyState message="Aucun agent actif" />}
                     </div>
                  </div>

                  {/* Revenue & Profits */}
                  <div className="bg-white rounded-xl border border-[#E9ECF0] overflow-hidden">
                     <div className="px-5 py-4 border-b-2" style={{ borderColor: COLORS.primary }}>
                        <div className="flex items-center gap-3">
                           <div className="size-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: COLORS.primaryBg }}>
                              <Wallet className="size-4" style={{ color: COLORS.primary }} />
                           </div>
                           <h3 className="text-sm font-bold" style={{ color: COLORS.primary }}>Revenus & Profits</h3>
                        </div>
                     </div>
                     <div className="p-5 space-y-0">
                        <MetricRow label="Ventes" value={kpi?.totalRevenue ? formatPrice(kpi.totalRevenue) : '0'} />
                        <MetricRow label="Revenus" value={kpi?.netRevenue ? formatPrice(kpi.netRevenue) : '0'} />
                        <MetricRow label="Bénéfices" value={kpi?.totalProfit ? formatPrice(kpi.totalProfit) : '0'} />
                        <MetricRow label="ROI" value={`${kpi?.roas || 0}%`} suffix="" />
                        <MetricRow label="Capitaux engagés" value={formatPrice(kpi?.totalRevenue || 0)} />
                     </div>
                  </div>

                  {/* Expenses & Fees */}
                  <div className="bg-white rounded-xl border border-[#E9ECF0] overflow-hidden">
                     <div className="px-5 py-4 border-b-2" style={{ borderColor: COLORS.orange }}>
                        <div className="flex items-center gap-3">
                           <div className="size-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: COLORS.orangeBg }}>
                              <CreditCard className="size-4" style={{ color: COLORS.orange }} />
                           </div>
                           <h3 className="text-sm font-bold" style={{ color: COLORS.orange }}>Dépenses & Frais</h3>
                        </div>
                     </div>
                     <div className="p-5 space-y-0">
                        <MetricRow label="Frais de livraison" value={kpi?.shippingFeeGap ? formatPrice(kpi.shippingFeeGap) : '0'} />
                        <MetricRow label="Remises accordées" value={kpi?.totalDiscounts ? formatPrice(kpi.totalDiscounts) : '0'} />
                        <MetricRow label="Frais de retour" value={kpi?.returnedOrders ? formatPrice(kpi.returnedOrders * (kpi.avgOrderValue || 0)) : '0'} />
                        <MetricRow label="Coût des produits (COGS)" value={kpi?.totalProfit !== undefined && kpi?.netRevenue !== undefined ? formatPrice(Math.max(0, (kpi.netRevenue || 0) - (kpi.totalProfit || 0))) : '—'} />
                     </div>
                  </div>

                  {/* Performance Gauges */}
                  <div className="bg-white rounded-xl border border-[#E9ECF0] overflow-hidden">
                     <div className="px-5 py-4 border-b-2" style={{ borderColor: COLORS.success }}>
                        <div className="flex items-center gap-3">
                           <div className="size-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: COLORS.successBg }}>
                              <Target className="size-4" style={{ color: COLORS.success }} />
                           </div>
                           <h3 className="text-sm font-bold" style={{ color: COLORS.success }}>Performance Real-time</h3>
                        </div>
                     </div>
                     <div className="p-5 flex-1 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-2 gap-4 place-items-center">
                        <PerformanceGauge label="Confirmation" value={kpi?.confirmationPerformance || 0} color={COLORS.primary} />
                        <PerformanceGauge label="Livraison" value={kpi?.deliveryPerformance || 0} color={COLORS.success} />
                        <PerformanceGauge label="Retour" value={kpi?.returnRate || 0} color={COLORS.danger} />
                        <PerformanceGauge label="Conversion" value={kpi?.conversionRate || 0} color={COLORS.orange} />
                     </div>
                  </div>
               </div>

               {/* ─── Sales Chart ─────────────────────── */}
               <div className="bg-white rounded-xl border border-[#E9ECF0] overflow-hidden">
                  <div className="px-5 py-4 border-b border-[#E9ECF0] flex items-center justify-between">
                     <div className="flex items-center gap-3">
                        <div className="size-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: COLORS.primaryBg }}>
                           <BarChart3 className="size-4" style={{ color: COLORS.primary }} />
                        </div>
                        <h3 className="text-sm font-bold text-[#2D3436]">Évolution des ventes ({filterOptions.find(f => f.value === selectedPeriod)?.label})</h3>
                     </div>
                  </div>
                  <div className="p-4 h-[300px]">
                     <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData}>
                           <defs>
                              <linearGradient id="colorRevCod" x1="0" y1="0" x2="0" y2="1">
                                 <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.3} />
                                 <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0.02} />
                              </linearGradient>
                           </defs>
                           <CartesianGrid strokeDasharray="3 3" stroke="#F0F3F6" vertical={false} />
                           <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#B2BEC3', fontWeight: 600 }} axisLine={false} tickLine={false} />
                           <YAxis tick={{ fontSize: 10, fill: '#B2BEC3', fontWeight: 600 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`} />
                           <RechartsTooltip contentStyle={tooltipStyle} />
                           <Area type="monotone" dataKey="revenue" stroke={COLORS.primary} strokeWidth={2.5} fillOpacity={1} fill="url(#colorRevCod)" />
                        </AreaChart>
                     </ResponsiveContainer>
                  </div>
               </div>
            </>
         )}

      </div>
   );
}
