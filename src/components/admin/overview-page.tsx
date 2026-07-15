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
   Calendar,
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
import { ALGERIA_MAP_WILAYAS } from './algeria-map-data';
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

function MetricRow({ label, value, suffix = "(DZD)", color, description }: { label: string; value: string | number; suffix?: string; color?: string; description?: string }) {
   return (
      <div className="flex items-center justify-between py-3 border-b border-[#F0F3F6] last:border-0 hover:bg-[#FAFBFD] px-2 -mx-2 rounded transition-colors">
         <div>
            <span className="text-[13px] font-medium text-[#636E72] block">{label}</span>
            {description && <span className="text-[9px] text-[#B2BEC3] leading-tight block mt-0.5 max-w-[180px]">{description}</span>}
         </div>
         <div className="flex items-baseline gap-1.5">
            <span className="text-[13px] font-bold tabular-nums" style={{ color: color || '#2D3436' }}>{value}</span>
            {suffix && <span className="text-[10px] font-semibold text-[#B2BEC3]">{suffix}</span>}
         </div>
      </div>
   );
}

function PerformanceGauge({ label, value, color, displayMode = 'percentage', rawValue, description }: { label: string; value: number; color: string; displayMode?: 'numbers' | 'percentage'; rawValue?: number; description?: string }) {
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
               <span className="text-lg font-extrabold tabular-nums" style={{ color }}>
                  {displayMode === 'numbers' && rawValue !== undefined ? rawValue : `${value}%`}
               </span>
            </div>
         </div>
         <div className="flex flex-col items-center">
            <span className="text-[11px] font-semibold text-[#636E72] text-center max-w-[100px] leading-tight">{label}</span>
            {description && <span className="text-[8px] text-[#B2BEC3] text-center max-w-[100px] leading-tight mt-0.5">{description}</span>}
         </div>
      </div>
   );
}

// ═══════════════════════════════════════════════════════════════
// Algeria SVG Map Component
// ═══════════════════════════════════════════════════════════════
function AlgeriaMap({ data }: { data: TopItem[] }) {
   const [zoom, setZoom] = useState(1);
   const [pan, setPan] = useState({ x: 0, y: 0 });
   const [isDragging, setIsDragging] = useState(false);
   const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
   const [hoveredWilaya, setHoveredWilaya] = useState<{ name: string; count: number; x: number; y: number } | null>(null);

   const maxCount = Math.max(...data.map(d => d.count || d.value || 0), 1);

   const normalizeString = (str: string) => 
      str
         .toLowerCase()
         .normalize("NFD")
         .replace(/[\u0300-\u036f]/g, "")
         .replace(/[^a-z0-9]/g, "");

   const getWilayaStats = (name: string) => {
      const normalized = normalizeString(name);
      const match = data.find(d => normalizeString(d.name) === normalized || normalizeString(d.id) === normalized);
      return match ? (match.count || match.value || 0) : 0;
   };

   const getFillColor = (name: string) => {
      const count = getWilayaStats(name);
      if (count === 0) return '#F5F6FA'; // Premium light gray
      
      const ratio = Math.min(1, count / maxCount);
      // Interpolate from a light grayish lavender (#DFE6E9) to primary purple (#6C5CE7)
      const r = Math.round(223 + (108 - 223) * ratio);
      const g = Math.round(230 + (92 - 230) * ratio);
      const b = Math.round(233 + (231 - 233) * ratio);
      return `rgb(${r}, ${g}, ${b})`;
   };

   // Zoom controls
   const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 4));
   const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.75));
   const handleReset = () => {
      setZoom(1);
      setPan({ x: 0, y: 0 });
   };

   // Drag & Pan handlers
   const handleMouseDown = (e: React.MouseEvent) => {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
   };

   const handleMouseMoveContainer = (e: React.MouseEvent) => {
      if (!isDragging) return;
      setPan({
         x: e.clientX - dragStart.x,
         y: e.clientY - dragStart.y,
      });
   };

   const handleMouseUp = () => setIsDragging(false);

   const showTooltip = (e: React.MouseEvent, name: string) => {
      const count = getWilayaStats(name);
      const rect = e.currentTarget.getBoundingClientRect();
      const parentRect = e.currentTarget.parentElement?.getBoundingClientRect();
      if (parentRect) {
         setHoveredWilaya({
            name,
            count,
            x: e.clientX - parentRect.left,
            y: e.clientY - parentRect.top - 40,
         });
      }
   };

   return (
      <div 
         className="relative w-full aspect-[1/1.1] flex items-center justify-center bg-slate-50/50 rounded-xl overflow-hidden select-none border border-slate-100/85 cursor-grab active:cursor-grabbing"
         onMouseDown={handleMouseDown}
         onMouseMove={handleMouseMoveContainer}
         onMouseUp={handleMouseUp}
         onMouseLeave={handleMouseUp}
      >
         <svg 
            viewBox="-248.385 -239.386 982.451 955.452" 
            className="w-full h-full transition-transform duration-100 ease-out"
            style={{
               transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
               transformOrigin: 'center center',
            }}
         >
            {ALGERIA_MAP_WILAYAS.map((w) => {
               const fill = getFillColor(w.name);
               const isHighlighted = hoveredWilaya?.name === w.name;
               
               const commonProps = {
                  fill,
                  stroke: isHighlighted ? COLORS.primary : '#FFFFFF',
                  strokeWidth: isHighlighted ? '2' : '0.8',
                  className: "transition-all duration-200 cursor-pointer hover:opacity-95 hover:brightness-95",
                  onMouseEnter: (e: React.MouseEvent) => showTooltip(e, w.name),
                  onMouseMove: (e: React.MouseEvent) => showTooltip(e, w.name),
                  onMouseLeave: () => setHoveredWilaya(null),
                  style: {
                     filter: isHighlighted ? 'drop-shadow(0px 2px 6px rgba(108, 92, 231, 0.25))' : 'none'
                  }
               };

               if (w.type === "polygon") {
                  return <polygon key={w.name} points={w.data} {...commonProps} />;
               } else {
                  return <path key={w.name} d={w.data} {...commonProps} />;
               }
            })}
         </svg>

         {/* Floating Zoom Controls */}
         <div className="absolute top-3 right-3 flex flex-col gap-1.5 z-10">
            <button 
               onClick={handleZoomIn}
               type="button"
               className="size-8 bg-white/90 backdrop-blur border border-slate-200/80 rounded-lg flex items-center justify-center text-slate-600 hover:text-[#6C5CE7] hover:bg-white shadow-sm transition-all text-sm font-black"
            >
               +
            </button>
            <button 
               onClick={handleZoomOut}
               type="button"
               className="size-8 bg-white/90 backdrop-blur border border-slate-200/80 rounded-lg flex items-center justify-center text-slate-600 hover:text-[#6C5CE7] hover:bg-white shadow-sm transition-all text-sm font-black"
            >
               −
            </button>
            <button 
               onClick={handleReset}
               type="button"
               className="size-8 bg-white/90 backdrop-blur border border-slate-200/80 rounded-lg flex items-center justify-center text-slate-600 hover:text-[#6C5CE7] hover:bg-white shadow-sm transition-all"
            >
               <Globe className="size-3.5" />
            </button>
         </div>

         {/* Custom Floating Interactive Tooltip */}
         {hoveredWilaya && (
            <div 
               className="absolute z-20 pointer-events-none bg-slate-900 text-white rounded-xl px-3 py-2 text-xs shadow-xl animate-in fade-in zoom-in-95 duration-150 border border-slate-800"
               style={{
                  left: hoveredWilaya.x,
                  top: hoveredWilaya.y,
                  transform: 'translate(-50%, -100%)',
               }}
            >
               <div className="font-extrabold tracking-tight text-[11px] uppercase text-slate-300">{hoveredWilaya.name}</div>
               <div className="font-black text-white text-sm mt-0.5 flex items-baseline gap-1">
                  <span>{hoveredWilaya.count}</span>
                  <span className="text-[9px] font-bold text-slate-400 normal-case">commande{hoveredWilaya.count > 1 ? 's' : ''}</span>
               </div>
            </div>
         )}

         {/* Map Legend */}
         <div className="absolute bottom-3 right-3 bg-white/95 backdrop-blur border border-slate-200/80 p-2.5 rounded-xl flex flex-col items-center gap-1 z-10 shadow-sm">
            <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest leading-none">Max ({maxCount})</span>
            <div className="w-16 h-2 rounded-full overflow-hidden border border-slate-100 my-1 bg-[#EEF0F5]">
               <div className="h-full bg-gradient-to-r from-[#DFE6E9] via-[#A29BFE] to-[#6C5CE7]" />
            </div>
            <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest leading-none">Min (0)</span>
         </div>
      </div>
   );
}

function ConfirmateurPerformance({ user, kpi, storeId }: { user: any; kpi: any; storeId: string }) {
   const rate = user?.payment_amount || 0;
   const paymentType = user?.payment_type || 'PER_DELIVERED_ORDER';

   let estimatedSalary = 0;
   if (paymentType === 'PER_DELIVERED_ORDER') estimatedSalary = (kpi?.deliveredOrders || 0) * rate;
   else if (paymentType === 'MONTHLY_SALARY') estimatedSalary = rate;
   else estimatedSalary = (kpi?.deliveredOrders || 0) * 400;

   const dailyTarget = user?.dailyTarget || user?.daily_target || 10;

   const recentOrdersQuery = useQuery<any>({
      queryKey: ['agent-recent-orders', user?.id, storeId],
      queryFn: () =>
         apiFetch(`/api/v1/orders?store_id=${storeId}&pageSize=5`),
      refetchInterval: 60000,
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
   const [startDate, setStartDate] = React.useState('');
   const [endDate, setEndDate] = React.useState('');
   const [displayMode, setDisplayMode] = React.useState<'numbers' | 'percentage'>('percentage');

   const buildQueryStr = (type: string) => {
      const params = new URLSearchParams({ store_id: storeId, type, period: selectedPeriod });
      if (startDate) params.set('start_date', startDate + 'T00:00:00.000Z');
      if (endDate) params.set('end_date', endDate + 'T23:59:59.999Z');
      return params.toString();
   };

   const kpiQuery = useQuery<ApiResponse<KpiData>>({
      queryKey: ['analytics', 'kpi', storeId, selectedPeriod, startDate, endDate],
      queryFn: () => apiFetch(`/api/v1/analytics?${buildQueryStr('kpi')}`),
   });

   const revenueQuery = useQuery<ApiResponse<RevenueDataPoint[]>>({
      queryKey: ['analytics', 'revenue', storeId, selectedPeriod, startDate, endDate],
      queryFn: () => apiFetch(`/api/v1/analytics?${buildQueryStr('revenue')}`),
   });

   const topProductsQuery = useQuery<ApiResponse<TopItem[]>>({
      queryKey: ['analytics', 'products', storeId, selectedPeriod, startDate, endDate],
      queryFn: () => apiFetch(`/api/v1/analytics?${buildQueryStr('products')}`),
   });

   const topWilayasQuery = useQuery<ApiResponse<TopItem[]>>({
      queryKey: ['analytics', 'wilayas', storeId, selectedPeriod, startDate, endDate],
      queryFn: () => apiFetch(`/api/v1/analytics?${buildQueryStr('wilayas')}`),
   });

   const topAgentsQuery = useQuery<ApiResponse<TopItem[]>>({
      queryKey: ['analytics', 'agents', storeId, selectedPeriod, startDate, endDate],
      queryFn: () => apiFetch(`/api/v1/analytics?${buildQueryStr('agents')}`),
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
            </div>

            <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-4">
               <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <div className="flex items-center gap-2 bg-[#F8F9FC] border border-[#E9ECF0] rounded-lg px-3 py-1.5 shrink-0">
                     <Calendar className="size-3.5 text-[#B2BEC3]" />
                     <input type="date" value={startDate} onChange={e => {setStartDate(e.target.value); setSelectedPeriod('');}} className="bg-transparent text-xs font-bold text-[#636E72] outline-none w-[105px]" />
                     <span className="text-[#B2BEC3]">-</span>
                     <input type="date" value={endDate} onChange={e => {setEndDate(e.target.value); setSelectedPeriod('');}} className="bg-transparent text-xs font-bold text-[#636E72] outline-none w-[105px]" />
                  </div>
                  {filterOptions.map(f => (
                     <button
                        key={f.value}
                        onClick={() => { setSelectedPeriod(f.value); setStartDate(''); setEndDate(''); }}
                        className={cn(
                           "px-4 py-2 text-xs font-bold rounded-full transition-all border",
                           selectedPeriod === f.value && !startDate && !endDate
                              ? "text-white border-transparent"
                              : "bg-[#F8F9FC] text-[#636E72] border-[#E9ECF0] hover:border-[#B2BEC3]"
                        )}
                        style={selectedPeriod === f.value && !startDate && !endDate ? { backgroundColor: COLORS.primary } : undefined}
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
         {kpiQuery.isLoading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-4">
               <RefreshCw className="size-8 text-[#B2BEC3] animate-spin" />
               <p className="text-sm font-bold text-[#B2BEC3]">Chargement des données...</p>
            </div>
         ) : currentUser?.role === 'CONFIRMATEUR' ? (
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
                        <AlgeriaMap data={topWilayas} />
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
                        <MetricRow label="Ventes" value={kpi?.totalRevenue ? formatPrice(kpi.totalRevenue) : '0'} description="Total des ventes brutes générées" />
                        <MetricRow label="Ventes (Upsells)" value={kpi?.upsellRevenue ? formatPrice(kpi.upsellRevenue) : '0'} color={COLORS.success} description="Revenus générés par les offres additionnelles" />
                        <MetricRow label="Ventes (Récupérés)" value={kpi?.abandonedCartRevenue ? formatPrice(kpi.abandonedCartRevenue) : '0'} color={COLORS.info} description="Paniers abandonnés convertis en ventes" />
                        <MetricRow label="Revenus nets" value={kpi?.netRevenue ? formatPrice(kpi.netRevenue) : '0'} description="Chiffre d'affaires après annulations" />
                        <MetricRow label="Bénéfices (bruts)" value={kpi?.totalProfit ? formatPrice(kpi.totalProfit) : '0'} description="Profit estimé avant déduction des retours" />
                        <MetricRow label="ROI" value={`${kpi?.roi || 0}%`} suffix="" description="Retour sur investissement estimé" />
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
                        <MetricRow label="Frais de livraison" value={kpi?.shippingFeeGap ? formatPrice(kpi.shippingFeeGap) : '0'} description="Coûts totaux de transport" />
                        <MetricRow label="Remises accordées" value={(kpi as any)?.totalDiscounts ? formatPrice((kpi as any).totalDiscounts) : '0'} description="Total des réductions offertes" />
                        <MetricRow label="Frais de retour" value={kpi?.returnedOrders ? formatPrice(kpi.returnedOrders * (kpi.avgOrderValue || 0)) : '0'} description="Pertes liées aux colis non livrés" />
                        <MetricRow label="Coût des produits (COGS)" value={kpi?.totalProfit !== undefined && kpi?.netRevenue !== undefined ? formatPrice(Math.max(0, (kpi.netRevenue || 0) - (kpi.totalProfit || 0) - (kpi.shippingFeeGap || 0))) : '—'} description="Valeur d'achat de la marchandise" />
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
                        <PerformanceGauge label="Confirmation" value={kpi?.confirmationPerformance || 0} rawValue={kpi?.confirmedOrders || 0} displayMode={displayMode} color={COLORS.primary} description="Taux de validation" />
                        <PerformanceGauge label="Livraison" value={kpi?.deliveryPerformance || 0} rawValue={kpi?.deliveredOrders || 0} displayMode={displayMode} color={COLORS.success} description="Taux de colis livrés" />
                        <PerformanceGauge label="Retour" value={kpi?.returnRate || 0} rawValue={kpi?.returnedOrders || 0} displayMode={displayMode} color={COLORS.danger} description="Proportion d'échecs" />
                        <PerformanceGauge label="Conversion" value={kpi?.conversionRate || 0} rawValue={kpi?.deliveredOrders || 0} displayMode={displayMode} color={COLORS.orange} description="Visites devenues achats" />
                     </div>
                  </div>
               </div>
            </>
         )}

      </div>
   );
}
