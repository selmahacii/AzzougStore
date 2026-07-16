'use client';

import React, { useState, useEffect } from 'react';
import {
  Warehouse,
  Truck,
  AlertCircle,
  Activity,
  History,
  ShieldCheck,
  Database,
  MapPin,
  Package,
  TrendingUp,
  TrendingDown,
  Download,
  Clock,
  Loader2,
  FileText,
  ShoppingCart,
  RotateCcw,
  Sliders,
  ChevronLeft,
  ChevronRight,
  GitBranch
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { formatPrice } from '@/lib/format';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import StockManager from './stock-manager';
import WarehouseManager from './warehouse-manager';
import StockTracker from './stock-tracker';
import SupplierManager from './supplier-manager';
import PurchaseManager from './purchase-manager';
import ReturnManager from './return-manager';
import { LivreursInventoryView, TracabilityView, DiscrepanciesView } from './inventory-tracability';

interface InventorySummary {
  data: {
    totalProducts: number;
    totalStockValue: number;
    lowStockCount: number;
    outOfStockCount: number;
    totalAvailableStock: number;
  }
}

interface InventoryMovement {
  id: string;
  product_id: string;
  type: string;
  quantity: number;
  reason: string | null;
  created_at: string;
  order_id?: string | null;
  order_number?: string | null;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  product_name?: string | null;
  actor?: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}

interface InventoryMovementsResponse {
  data: InventoryMovement[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  RESTOCK: 'Réapprovisionnement fournisseur',
  ORDER_CONFIRM: 'Confirmation commande',
  ORDER_RESERVE: 'Réservation commande',
  ORDER_RELEASE: 'Libération réservation',
  RETURN_RESTOCK: 'Retour client réintégré',
  POS_SALE: 'Vente au comptoir (POS)',
  MANUAL_ADJUSTMENT: 'Ajustement manuel',
};

const MOVEMENT_TYPE_ICON: Record<string, any> = {
  RESTOCK: Package,
  ORDER_CONFIRM: ShoppingCart,
  ORDER_RESERVE: ShoppingCart,
  ORDER_RELEASE: RotateCcw,
  RETURN_RESTOCK: RotateCcw,
  POS_SALE: ShoppingCart,
  MANUAL_ADJUSTMENT: Sliders,
};

const MOVEMENT_TYPE_COLOR: Record<string, string> = {
  RESTOCK: '#00B894',
  ORDER_CONFIRM: '#E17055',
  ORDER_RESERVE: '#FDCB6E',
  ORDER_RELEASE: '#0984E3',
  RETURN_RESTOCK: '#6C5CE7',
  POS_SALE: '#E17055',
  MANUAL_ADJUSTMENT: '#636E72',
};


// ─── CODpilot Styling ─────────────────────────────────────
const C = {
   primary: '#6C5CE7', primaryBg: '#F0EDFF',
   success: '#00B894', successBg: '#E6FFF8',
   danger: '#E17055', dangerBg: '#FFEDE9',
   warning: '#FDCB6E', warningBg: '#FFF8E6',
   info: '#0984E3', infoBg: '#E8F4FE',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

function KpiCard({ title, value, icon: Icon, color, bgColor, change, status }: any) {
   return (
      <div className="bg-white rounded-xl border p-5 group hover:border-[#B2BEC3] transition-colors" style={{ borderColor: C.border }}>
         <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] font-semibold text-[#636E72]">{title}</p>
            <div className="size-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: bgColor }}>
               <Icon className="size-4" style={{ color }} />
            </div>
         </div>
         <p className="text-2xl font-extrabold text-[#2D3436] tabular-nums mb-1">{value}</p>
         {change && (
            <div className="flex items-center gap-1.5 mt-2">
               {change >= 0 ? <TrendingUp className="size-3 text-[#00B894]" /> : <TrendingDown className="size-3 text-[#E17055]" />}
               <span className="text-[10px] font-bold" style={{ color: change >= 0 ? C.success : C.danger }}>{change >= 0 ? '+' : ''}{change}%</span>
               <span className="text-[10px] font-semibold text-[#B2BEC3] ml-1">vs mois dernier</span>
            </div>
         )}
         {status === 'nominal' && (
            <div className="flex items-center gap-1.5 mt-2">
               <div className="size-1.5 rounded-full" style={{ backgroundColor: C.success }} />
               <span className="text-[10px] font-bold" style={{ color: C.success }}>Opérationnel</span>
            </div>
         )}
      </div>
   );
}

export default function InventoryDashboard() {
   const { activeStore, adminSubView } = useAppStore();
   const storeId = activeStore?.id ?? '';
   
   const summaryQuery = useQuery({
      queryKey: ['inventory', 'summary', storeId],
      queryFn: () => apiFetch<InventorySummary>(`/api/v1/stock/summary?store_id=${storeId}`),
      enabled: !!storeId,
      refetchInterval: 60000,
   });

   const movementsQuery = useQuery({
      queryKey: ['inventory', 'movements', storeId],
      queryFn: () => apiFetch<InventoryMovementsResponse>(`/api/v1/stock/?store_id=${storeId}&pageSize=30`),
      enabled: !!storeId,
      refetchInterval: 60000,
   });


   const summary = summaryQuery.data?.data || {
      totalProducts: 0,
      totalStockValue: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
      totalAvailableStock: 0
   };

   const normalizeSubView = (sv: string | null) => {
      if (!sv) return 'STOCK';
      if (['Stock', 'Gestion Stock', 'STOCK'].includes(sv)) return 'STOCK';
      if (['Suivi de Stock', 'Suivi de stock', 'Suivi des lots', 'TRACKER'].includes(sv)) return 'TRACKER';
      if (['Alerte de Stock', 'Alerte de stock', 'Alertes rupture', 'ALERTS'].includes(sv)) return 'ALERTS';
      if (["Entrées d'achat", 'Achats', 'PURCHASES'].includes(sv)) return 'PURCHASES';
      if (["Entrées de retour", 'Retours', 'RETURNS'].includes(sv)) return 'RETURNS';
      if (['Entrepôts', 'WAREHOUSES'].includes(sv)) return 'WAREHOUSES';
      if (['Fournisseurs', 'PARTNERS'].includes(sv)) return 'PARTNERS';
      if (['Surveillance', 'MONITOR'].includes(sv)) return 'MONITOR';
      if (['Historique', 'HISTORY'].includes(sv)) return 'HISTORY';
      if (['Timeline', 'Chronologie', 'TIMELINE'].includes(sv)) return 'TIMELINE';
      if (['Livreurs', 'Inventaire Livreurs', 'LIVREURS'].includes(sv)) return 'LIVREURS';
      if (['Traçabilité', 'Tracabilite', 'TRACABILITE'].includes(sv)) return 'TRACABILITE';
      if (['Écarts', 'Ecarts', 'ECARTS'].includes(sv)) return 'ECARTS';
      return 'STOCK';
   };

   const [activeTab, setActiveTab] = useState(() => normalizeSubView(adminSubView));

   useEffect(() => {
     setActiveTab(normalizeSubView(adminSubView));
   }, [adminSubView]);

   return (
     <div className="space-y-6 pb-32 animate-in fade-in duration-500">
         {/* KPI Cluster */}
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <KpiCard 
               title="PRODUITS RÉFÉRENCÉS" 
               value={(summary?.totalProducts ?? 0).toString()} 
               icon={Database} 
               color={C.primary} 
               bgColor={C.primaryBg}
               status="nominal"
            />
            <KpiCard 
               title="STOCK TOTAL DISPONIBLE" 
               value={(summary?.totalAvailableStock ?? 0).toLocaleString()} 
               icon={Package} 
               color={C.success} 
               bgColor={C.successBg}
            />
            <KpiCard 
               title="RÉSERVES CRITIQUES" 
               value={(summary?.lowStockCount ?? 0).toString()} 
               icon={AlertCircle} 
               color={C.danger} 
               bgColor={C.dangerBg}
            />
            <KpiCard 
               title="VALEUR INVENTAIRE (COUT)" 
               value={formatPrice(summary?.totalStockValue ?? 0)} 
               icon={TrendingUp} 
               color={C.warning} 
               bgColor={C.warningBg}
            />
         </div>

         <ActiveView 
            key={activeTab} 
            activeTab={activeTab} 
            movements={movementsQuery.data?.data || []}
            isLoadingMovements={movementsQuery.isLoading}
         />
     </div>
   );
}

// ─── SUB-VIEWS ───────────────────────────────────────────

function ActiveView({ activeTab, movements, isLoadingMovements }: { activeTab: string; movements: InventoryMovement[]; isLoadingMovements: boolean }) {

   if (activeTab === 'MONITOR') return <MonitorView logs={movements} isLoading={isLoadingMovements} />;
   if (activeTab === 'WAREHOUSES') return <WarehouseManager />;
   if (activeTab === 'TRACKER') return <StockTracker />;
   if (activeTab === 'RETURNS') return <ReturnManager />;
   if (activeTab === 'STOCK') return <StockView />;
   if (activeTab === 'ALERTS') return <AlertsView />;
   if (activeTab === 'PURCHASES') return <PurchaseManager />;
   if (activeTab === 'PARTNERS') return <SupplierManager />;
   if (activeTab === 'HISTORY') return <HistoryView />;
   if (activeTab === 'TIMELINE') return <TimelineView />;
   if (activeTab === 'LIVREURS') return <LivreursInventoryView />;
   if (activeTab === 'TRACABILITE') return <TracabilityView />;
   if (activeTab === 'ECARTS') return <DiscrepanciesView />;
   return <StockView />;
}

// ─── Section 1 "Surveillance" — tableau de bord ERP temps réel ────────────
function ErpDashboardBlock() {
   const activeStore = useAppStore(s => s.activeStore);
   const { data, isLoading } = useQuery({
      queryKey: ['stock-dashboard', activeStore?.id],
      queryFn: () => apiFetch<{ success: boolean; data: any }>(`/api/v1/stock/dashboard?store_id=${activeStore?.id}`),
      enabled: !!activeStore?.id,
      refetchInterval: 60000,
   });
   const d = data?.data;

   if (isLoading || !d) {
      return <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
         {Array.from({ length: 12 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse" />)}
      </div>;
   }

   const kpis = [
      { label: 'Stock total', value: d.kpis.stock_total, color: C.primary },
      { label: 'Valeur totale', value: formatPrice(d.kpis.valeur_totale), color: C.primary },
      { label: 'Produits actifs', value: d.kpis.produits_actifs, color: C.text },
      { label: 'Sans stock', value: d.kpis.sans_stock, color: C.danger },
      { label: 'Sous seuil', value: d.kpis.sous_seuil, color: C.warning },
      { label: 'Surstock', value: d.kpis.surstock, color: C.warning },
      { label: 'Réservés', value: d.kpis.reserves, color: C.info },
      { label: 'Disponibles', value: d.kpis.disponible, color: C.success },
      { label: 'Retournés (jour)', value: d.kpis.retournes_aujourd_hui, color: C.danger },
      { label: 'Réintégrés (jour)', value: d.kpis.reintegres_aujourd_hui, color: C.success },
      { label: 'Bloqués', value: d.kpis.bloques.tracked === false ? '—' : d.kpis.bloques.value, color: C.textDim, untracked: !d.kpis.bloques.tracked },
      { label: 'Endommagés', value: d.kpis.endommages.tracked === false ? '—' : d.kpis.endommages.value, color: C.textDim, untracked: !d.kpis.endommages.tracked },
      { label: 'Expirés', value: d.kpis.expires.tracked === false ? '—' : d.kpis.expires.value, color: C.textDim, untracked: !d.kpis.expires.tracked },
      { label: 'En attente réception', value: d.kpis.en_attente_reception.tracked === false ? '—' : d.kpis.en_attente_reception.value, color: C.textDim, untracked: !d.kpis.en_attente_reception.tracked },
   ];

   const widgetGroups: Array<[string, any[]]> = [
      ['Top vendus', d.widgets.top_vendus],
      ['Top retournés', d.widgets.top_retournes],
      ['Top annulés', d.widgets.top_annules],
      ['Top récupérés', d.widgets.top_recuperes],
      ['Sans mouvement (30j)', d.widgets.top_sans_mouvement],
      ['À réapprovisionner', d.widgets.top_a_reapprovisionner],
   ];

   const chartMax = Math.max(1, ...d.chart_30j.map((c: any) => Math.max(c.entrees, c.sorties, c.retours)));

   return (
      <div className="space-y-6">
         <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5">
            {kpis.map(k => (
               <div key={k.label} title={(k as any).untracked ? "Non tracké — aucun type de mouvement dédié n'existe encore pour distinguer ce cas d'un retour normal." : undefined}
                  className={cn("p-3 rounded-xl border bg-white", (k as any).untracked && "opacity-50 border-dashed")} style={{ borderColor: k.color + '33' }}>
                  <p className="text-sm font-black tabular-nums" style={{ color: k.color }}>{k.value}</p>
                  <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">{k.label}</p>
               </div>
            ))}
         </div>

         <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            {[
               { label: "Aujourd'hui", v: d.evolution.aujourd_hui },
               { label: '7 jours', v: d.evolution.sept_jours },
               { label: '30 jours', v: d.evolution.trente_jours },
            ].map(e => (
               <div key={e.label} className="p-4 rounded-xl border bg-white" style={{ borderColor: C.border }}>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">{e.label}</p>
                  <div className="flex items-center gap-4">
                     <div><p className="text-sm font-black text-slate-800">{e.v.mouvements}</p><p className="text-[8px] text-slate-400 uppercase">Mouvements</p></div>
                     <div><p className="text-sm font-black text-emerald-500">+{e.v.qty_entrees}</p><p className="text-[8px] text-slate-400 uppercase">Entrées</p></div>
                     <div><p className="text-sm font-black text-rose-500">-{e.v.qty_sorties}</p><p className="text-[8px] text-slate-400 uppercase">Sorties</p></div>
                  </div>
               </div>
            ))}
            <div className="p-4 rounded-xl border bg-white" style={{ borderColor: C.border }}>
               <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Rotation moyenne (30j)</p>
               <p className="text-lg font-black text-slate-800">{d.rotation_moyenne}×</p>
               <p className="text-[8px] text-slate-400 uppercase mt-1">Qté vendue / stock actuel</p>
            </div>
         </div>

         <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl border bg-white" style={{ borderColor: C.border }}>
               <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Valeur des entrées (30j)</p>
               <p className="text-base font-black text-emerald-500 mt-1">{formatPrice(d.valeur_entrees_30j)}</p>
            </div>
            <div className="p-4 rounded-xl border bg-white" style={{ borderColor: C.border }}>
               <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Valeur des sorties (30j)</p>
               <p className="text-base font-black text-rose-500 mt-1">{formatPrice(d.valeur_sorties_30j)}</p>
            </div>
            <div className="p-4 rounded-xl border bg-white" style={{ borderColor: C.border }}>
               <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Valeur des retours (30j)</p>
               <p className="text-base font-black text-amber-500 mt-1">{formatPrice(d.valeur_retours_30j)}</p>
            </div>
         </div>

         {/* Graphique entrées/sorties/retours */}
         <div className="p-6 rounded-xl border bg-white" style={{ borderColor: C.border }}>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Entrées / Sorties / Retours — 30 derniers jours</p>
            {d.chart_30j.length === 0 ? (
               <p className="text-[10px] font-bold text-slate-400 text-center py-10 uppercase">Aucun mouvement sur la période</p>
            ) : (
               <div className="flex items-end gap-1 h-[160px] overflow-x-auto">
                  {d.chart_30j.map((c: any) => (
                     <div key={c.day} className="flex-1 min-w-[8px] flex flex-col items-center justify-end gap-0.5 h-full" title={`${c.day} — entrées ${c.entrees}, sorties ${c.sorties}, retours ${c.retours}`}>
                        <div className="w-full flex flex-col-reverse gap-px" style={{ height: '140px' }}>
                           <div className="w-full bg-emerald-400 rounded-sm" style={{ height: `${(c.entrees / chartMax) * 140}px` }} />
                           <div className="w-full bg-rose-400 rounded-sm" style={{ height: `${(c.sorties / chartMax) * 140}px` }} />
                           <div className="w-full bg-amber-400 rounded-sm" style={{ height: `${(c.retours / chartMax) * 140}px` }} />
                        </div>
                     </div>
                  ))}
               </div>
            )}
            <div className="flex items-center gap-4 mt-3">
               <span className="flex items-center gap-1.5 text-[9px] font-bold text-slate-500"><span className="size-2 rounded-sm bg-emerald-400" /> Entrées</span>
               <span className="flex items-center gap-1.5 text-[9px] font-bold text-slate-500"><span className="size-2 rounded-sm bg-rose-400" /> Sorties</span>
               <span className="flex items-center gap-1.5 text-[9px] font-bold text-slate-500"><span className="size-2 rounded-sm bg-amber-400" /> Retours</span>
            </div>
         </div>

         {/* Widgets top produits */}
         <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {widgetGroups.map(([title, items]) => (
               <div key={title} className="p-4 rounded-xl border bg-white" style={{ borderColor: C.border }}>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">{title}</p>
                  {items.length === 0 ? (
                     <p className="text-[10px] text-slate-400 text-center py-4">Aucune donnée</p>
                  ) : (
                     <div className="space-y-1.5">
                        {items.map((it: any) => (
                           <div key={it.product_id} className="flex items-center justify-between text-xs">
                              <span className="text-slate-600 font-semibold truncate max-w-[180px]">{it.product_name}</span>
                              <span className="font-black text-slate-800 tabular-nums">{it.quantity}</span>
                           </div>
                        ))}
                     </div>
                  )}
               </div>
            ))}
         </div>
      </div>
   );
}

function MonitorView({ logs, isLoading }: { logs: InventoryMovement[]; isLoading: boolean }) {
   const activeStore = useAppStore(s => s.activeStore);
   const { data: whResponse } = useQuery({
      queryKey: ['warehouses', activeStore?.id],
      queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/warehouses?store_id=${activeStore?.id}`),
      enabled: !!activeStore?.id,
   });

   const warehouses = whResponse?.data || [];

   return (
      <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-400">
         <ErpDashboardBlock />

         <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-xl border p-6" style={{ borderColor: C.border }}>
               <h3 className="text-sm font-bold text-[#2D3436] mb-6 flex items-center gap-2">
                  <MapPin className="size-4 text-[#6C5CE7]" />
                  Saturation des Hubs Opérationnels
               </h3>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                     {warehouses.length > 0 ? warehouses.map((c: any, i: number) => {
                        const load = c.capacity ? Math.round((c.current_load / c.capacity) * 100) : 0;
                        return (
                           <div key={i} className="flex items-center justify-between p-4 bg-[#F8F9FC] border rounded-lg hover:border-[#B2BEC3] transition-colors" style={{ borderColor: C.border }}>
                              <div className="flex items-center gap-4">
                                 <div className="size-10 rounded-lg bg-white border flex items-center justify-center shrink-0" style={{ borderColor: C.border }}>
                                     <Warehouse className="size-5 text-[#B2BEC3]" />
                                 </div>
                                 <div>
                                    <p className="text-xs font-black text-[#2D3436] uppercase tracking-wide">{c.name}</p>
                                    <p className="text-[10px] font-semibold text-[#B2BEC3] font-mono mt-0.5">REF: {c.code}</p>
                                 </div>
                              </div>
                              <div className="text-right">
                                 <span className={cn("text-[10px] font-black", load > 90 ? "text-rose-500" : "text-emerald-500")}>{load}%</span>
                                 <div className="h-1 w-12 bg-slate-100 rounded-full mt-1 overflow-hidden">
                                    <div className="h-full bg-indigo-500" style={{ width: `${load}%` }} />
                                 </div>
                              </div>
                           </div>
                        );
                     }) : (
                        <div className="p-10 text-center text-[#B2BEC3] text-[10px] font-black uppercase">Aucun hub configuré - Initialisation requise</div>
                     )}
                  </div>
                  {/* Real stock movement chart — last 7 days grouped by day */}
                  {(() => {
                     const grouped: Record<string, number> = {};
                     logs.forEach(l => {
                        const day = new Date(l.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
                        grouped[day] = (grouped[day] || 0) + Math.abs(l.quantity);
                     });
                     const days = Object.entries(grouped).slice(-7);
                     const max = Math.max(...days.map(([, v]) => v), 1);
                     return days.length > 0 ? (
                        <div className="h-[250px] p-4 bg-white rounded-2xl border border-slate-100 flex flex-col">
                           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Flux Stock (7j)</p>
                           <div className="flex-1 flex items-end gap-1.5">
                              {days.map(([day, val]) => (
                                 <div key={day} className="flex-1 flex flex-col items-center gap-1">
                                    <span className="text-[8px] font-bold text-slate-400">{val}</span>
                                    <div className="w-full rounded-t-md bg-indigo-500/80" style={{ height: `${Math.round((val / max) * 140)}px` }} />
                                    <span className="text-[8px] text-slate-400">{day}</span>
                                 </div>
                              ))}
                           </div>
                        </div>
                     ) : (
                        <div className="h-[250px] flex items-center justify-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Flux Logistiques<br/>En attente de données</p>
                        </div>
                     );
                  })()}
               </div>
            </div>

            <div className="bg-white rounded-xl border p-6" style={{ borderColor: C.border }}>
               <h3 className="text-sm font-bold text-[#2D3436] mb-6">Flux d'activité</h3>
               <div className="space-y-6">
                  {isLoading ? (
                     Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 bg-slate-50 rounded-lg animate-pulse" />)
                  ) : logs.length > 0 ? (
                     logs.slice(0, 6).map((log, i) => (
                        <div key={i} className="flex gap-4 items-start relative before:absolute before:left-1.5 before:top-4 before:-bottom-6 before:w-[2px] before:bg-[#E9ECF0] last:before:hidden">
                           <div className="size-3.5 rounded-full border-2 border-white relative z-10 shrink-0 mt-0.5" style={{ backgroundColor: C.primary }} />
                           <div>
                              <p className="text-[11px] font-bold text-[#2D3436] uppercase tracking-wider">{log.type.replace(/_/g, ' ')}</p>
                              <div className="flex items-center gap-2 mt-1">
                                 <span className="text-[10px] font-semibold text-[#636E72]">Cant: {log.quantity} • {log.reason || 'Flux auto'}</span>
                                 <span className="text-[10px] font-semibold text-[#B2BEC3]">• {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                           </div>
                        </div>
                     ))
                  ) : (
                     <div className="text-center py-10 text-[10px] font-bold text-[#B2BEC3]">Aucun flux récent</div>
                  )}
               </div>
               <button 
                  onClick={() => {
                     if (logs.length === 0) return toast.error("Aucune donnée d'activité à exporter");
                     const csvContent = [
                        ["Event ID", "Timestamp", "Acteur", "Rôle Acteur", "Type", "Quantité", "Raison"],
                        ...logs.map(log => [
                           log.id,
                           new Date(log.created_at).toLocaleString(),
                           (log as any).actor?.name || 'Système',
                           (log as any).actor?.role || 'N/A',
                           log.type,
                           log.quantity,
                           log.reason || "Flux auto"
                        ])
                     ].map(e => e.join(",")).join("\n");
                     
                     const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                     const link = document.createElement("a");
                     const url = URL.createObjectURL(blob);
                     link.setAttribute("href", url);
                     link.setAttribute("download", `rapport_activite_stock_${new Date().toISOString().split('T')[0]}.csv`);
                     link.style.visibility = 'hidden';
                     document.body.appendChild(link);
                     link.click();
                     document.body.removeChild(link);
                     
                     toast.success("Rapport d'activité micro-détaillé généré avec succès");
                  }}
                  className="w-full mt-8 py-3 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-90 shadow-lg shadow-indigo-100" style={{ backgroundColor: C.primary }}
               >
                  Génération Rapport Complet
               </button>
            </div>
         </div>

         {/* Micro-Details Section */}
         <div className="bg-white rounded-xl border p-6" style={{ borderColor: C.border }}>
            <h3 className="text-sm font-bold text-[#2D3436] mb-6 flex items-center gap-2">
               <ShieldCheck className="size-4 text-[#00B894]" />
               Traçabilité Micro-Détaillée des Flux (Temps Réel)
            </h3>
            <div className="overflow-x-auto">
               <table className="w-full text-left">
                  <thead>
                     <tr className="border-b border-[#F0F3F6] pb-3">
                        <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Event ID</th>
                        <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Timestamp</th>
                        <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Actionneur</th>
                        <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Vecteur</th>
                        <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Delta</th>
                        <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Impact KPI</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                     {logs.slice(0, 20).map((log, i) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                           <td className="py-4 font-mono text-[10px] text-[#2D3436]">#{log.id.split('-')[0]}</td>
                           <td className="py-4 text-[10px] font-bold text-[#636E72]">{new Date(log.created_at).toLocaleString()}</td>
                           <td className="py-4">
                              <div className="flex flex-col">
                                 <span className="text-[10px] font-black uppercase text-[#6C5CE7]">{log.actor?.name || 'Système'}</span>
                                 {log.actor?.role && <span className="text-[9px] font-bold text-slate-400">{log.actor.role}</span>}
                              </div>
                           </td>
                           <td className="py-4 text-[10px] font-bold text-[#2D3436]">{log.type.split('_').join(' ')}</td>
                           <td className={cn("py-4 text-[10px] font-black", log.quantity >= 0 ? "text-emerald-500" : "text-rose-500")}>
                              {log.quantity >= 0 ? '+' : ''}{log.quantity}
                           </td>
                           <td className="py-4">
                              <div className="flex items-center gap-1.5">
                                 <div className="size-1.5 rounded-full bg-emerald-400" />
                                 <span className="text-[9px] font-bold text-emerald-600 uppercase">Cohérent</span>
                              </div>
                           </td>
                        </tr>
                     ))}
                     {logs.length === 0 && (
                        <tr>
                           <td colSpan={6} className="py-10 text-center text-[10px] font-bold text-slate-400 uppercase">En attente de flux système...</td>
                        </tr>
                     )}
                  </tbody>
               </table>
            </div>
         </div>
      </div>
   );
}

function StockView() {
   return (
      <div className="bg-white border rounded-xl overflow-hidden p-6 animate-in slide-in-from-bottom-2 duration-400" style={{ borderColor: C.border }}>
         <div className="flex items-center justify-between mb-6">
            <div>
               <h3 className="text-lg font-extrabold text-[#2D3436]">Contrôle des Stocks</h3>
               <p className="text-xs font-semibold text-[#636E72] mt-1">Ajustement des réserves opérationnelles</p>
            </div>
            <button className="px-4 py-2 rounded-lg text-xs font-bold bg-black text-white hover:opacity-90">Audit Inventaire</button>
         </div>
         <StockManager variant="all" />
      </div>
   );
}

function AlertsView() {
   return (
      <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-400">
         <div className="bg-[#FFEDE9] border border-[#FAD9D1] p-5 rounded-xl flex items-center gap-4">
            <div className="size-10 bg-white rounded-lg flex items-center justify-center shrink-0">
               <AlertCircle className="size-5 text-[#E17055]" />
            </div>
            <div>
               <h3 className="text-sm font-extrabold text-[#E17055]">Suite de Détection d'Anomalies</h3>
               <p className="text-xs font-semibold text-[#E17055]/80 mt-0.5">Les réserves sous le seuil critique nécessitent un approvisionnement</p>
            </div>
         </div>
         <div className="bg-white border rounded-xl overflow-hidden p-6" style={{ borderColor: C.border }}>
            <StockManager variant="alerts" />
         </div>
      </div>
   );
}

function useFilteredMovements(pageSize: number) {
   const activeStore = useAppStore(s => s.activeStore);
   const [page, setPage] = useState(1);
   const [movementType, setMovementType] = useState('');
   const [dateFrom, setDateFrom] = useState('');
   const [dateTo, setDateTo] = useState('');

   const query = useQuery({
      queryKey: ['inventory', 'movements-full', activeStore?.id, page, movementType, dateFrom, dateTo],
      queryFn: () => {
         const params = new URLSearchParams({ store_id: activeStore?.id || '', page: String(page), pageSize: String(pageSize) });
         if (movementType) params.set('movement_type', movementType);
         if (dateFrom) params.set('date_from', `${dateFrom}T00:00:00.000Z`);
         if (dateTo) params.set('date_to', `${dateTo}T23:59:59.999Z`);
         return apiFetch<InventoryMovementsResponse>(`/api/v1/stock/?${params.toString()}`);
      },
      enabled: !!activeStore?.id,
   });

   return {
      movements: query.data?.data || [],
      total: query.data?.total || 0,
      totalPages: query.data?.totalPages || 1,
      isLoading: query.isLoading,
      page, setPage,
      movementType, setMovementType,
      dateFrom, setDateFrom,
      dateTo, setDateTo,
   };
}

function MovementFilterBar({ f }: { f: ReturnType<typeof useFilteredMovements> }) {
   return (
      <div className="flex flex-wrap items-center gap-2 px-6 py-3 bg-[#F8F9FC] border-b" style={{ borderColor: C.border }}>
         <select
            value={f.movementType}
            onChange={e => { f.setMovementType(e.target.value); f.setPage(1); }}
            className="h-8 rounded-lg border bg-white px-2 text-[11px] font-bold text-[#2D3436]" style={{ borderColor: C.border }}>
            <option value="">Tous les types</option>
            {Object.entries(MOVEMENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
         </select>
         <input type="date" value={f.dateFrom} onChange={e => { f.setDateFrom(e.target.value); f.setPage(1); }}
            className="h-8 rounded-lg border bg-white px-2 text-[11px] font-bold text-[#2D3436]" style={{ borderColor: C.border }} />
         <span className="text-[11px] text-[#B2BEC3]">→</span>
         <input type="date" value={f.dateTo} onChange={e => { f.setDateTo(e.target.value); f.setPage(1); }}
            className="h-8 rounded-lg border bg-white px-2 text-[11px] font-bold text-[#2D3436]" style={{ borderColor: C.border }} />
         {(f.movementType || f.dateFrom || f.dateTo) && (
            <button
               onClick={() => { f.setMovementType(''); f.setDateFrom(''); f.setDateTo(''); f.setPage(1); }}
               className="text-[10px] font-bold text-rose-500 hover:underline ml-1">Réinitialiser</button>
         )}
         <span className="ml-auto text-[10px] font-bold text-[#B2BEC3]">{f.total} mouvement{f.total > 1 ? 's' : ''}</span>
      </div>
   );
}

function MovementPager({ f }: { f: ReturnType<typeof useFilteredMovements> }) {
   if (f.totalPages <= 1) return null;
   return (
      <div className="p-4 bg-[#F8F9FC] border-t flex items-center justify-between" style={{ borderColor: C.border }}>
         <span className="text-[10px] font-bold text-[#B2BEC3]">Page {f.page} / {f.totalPages}</span>
         <div className="flex items-center gap-2">
            <button onClick={() => f.setPage(p => Math.max(1, p - 1))} disabled={f.page <= 1}
               className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-[10px] font-bold disabled:opacity-40 hover:bg-white" style={{ borderColor: C.border }}>
               <ChevronLeft className="size-3" /> Précédent
            </button>
            <button onClick={() => f.setPage(p => Math.min(f.totalPages, p + 1))} disabled={f.page >= f.totalPages}
               className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-[10px] font-bold disabled:opacity-40 hover:bg-white" style={{ borderColor: C.border }}>
               Suivant <ChevronRight className="size-3" />
            </button>
         </div>
      </div>
   );
}

function HistoryView() {
   const f = useFilteredMovements(30);

   const handleExport = () => {
      if (f.movements.length === 0) return toast.error("Aucune donnée à exporter sur cette page");
      const csv = [
         ["Date", "ID", "Produit", "Type", "Quantité", "Acteur", "Rôle", "Commande", "Entrepôt", "Raison"],
         ...f.movements.map(m => [
            new Date(m.created_at).toLocaleString(),
            m.id,
            m.product_name || m.product_id,
            m.type,
            m.quantity,
            m.actor?.name || 'Système',
            m.actor?.role || 'N/A',
            m.order_number || '',
            m.warehouse_name || '',
            m.reason || ""
         ])
      ].map(e => e.join(",")).join("\n");

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.setAttribute('hidden', '');
      a.setAttribute('href', url);
      a.setAttribute('download', `audit_stock_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Audit exporté avec succès");
   };

   return (
      <div className="bg-white border rounded-2xl overflow-hidden shadow-sm animate-in slide-in-from-bottom-2 duration-400" style={{ borderColor: C.border }}>
         <div className="flex items-center justify-between p-6 border-b" style={{ borderColor: C.border }}>
            <div>
               <h3 className="text-sm font-extrabold text-[#2D3436] uppercase tracking-wider">Journal d'Audit Opérationnel</h3>
               <p className="text-[10px] font-bold text-[#B2BEC3] uppercase tracking-widest mt-1">Traçabilité complète des flux — qui, quand, depuis quelle commande</p>
            </div>
            <button
               onClick={handleExport}
               className="px-4 py-2 rounded-xl text-xs font-bold border hover:bg-[#F8F9FC] transition-all flex items-center gap-2" style={{ borderColor: C.border }}>
               <Download className="size-3.5 text-[#B2BEC3]" /> Exporter (.CSV)
            </button>
         </div>
         <MovementFilterBar f={f} />
         <div className="divide-y" style={{ borderColor: C.border }}>
            {f.isLoading ? (
               <div className="p-10 flex flex-col items-center gap-3">
                  <Loader2 className="size-6 animate-spin text-[#6C5CE7]" />
                  <span className="text-[10px] font-bold text-[#B2BEC3] uppercase">Synchronisation du journal...</span>
               </div>
            ) : f.movements.length > 0 ? f.movements.map((m) => (
               <div key={m.id} className="p-5 flex items-center justify-between hover:bg-[#FAFBFD] transition-colors group">
                  <div className="flex items-center gap-4">
                     <div className="size-10 rounded-xl bg-[#F8F9FC] border flex items-center justify-center shrink-0" style={{ borderColor: C.border, color: MOVEMENT_TYPE_COLOR[m.type] || C.textDim }}>
                        <FileText className="size-4.5" />
                     </div>
                     <div>
                        <p className="text-xs font-extrabold text-[#2D3436]">
                           {MOVEMENT_TYPE_LABELS[m.type] || 'Ajustement Manuel'}
                           <span className="font-mono text-[#6C5CE7] ml-2">{m.id.split('-')[0].toUpperCase()}</span>
                        </p>
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                           <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-md uppercase",
                              m.quantity > 0 ? "text-[#00B894] bg-[#E6FFF8]" : "text-[#E17055] bg-[#FFEDE9]"
                           )}>
                              {m.quantity > 0 ? '+' : ''}{m.quantity} Unités
                           </span>
                           <span className="text-[10px] font-bold text-[#B2BEC3] flex items-center gap-1"><Clock className="size-3" /> {new Date(m.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                           <span className="text-[10px] font-bold text-[#636E72]">— {m.product_name || `Ref: ${m.product_id.split('-')[0]}`}</span>
                           {m.actor?.name && <span className="text-[10px] font-bold text-[#636E72]">— {m.actor.name}</span>}
                           {m.order_number && <span className="text-[10px] font-bold text-[#0984E3]">— Cmd #{m.order_number}</span>}
                           {m.warehouse_name && <span className="text-[10px] font-bold text-[#6C5CE7]">— {m.warehouse_name}</span>}
                        </div>
                        {m.reason && (
                           <p className="text-[10px] text-[#B2BEC3] mt-1 max-w-md truncate" title={m.reason}>{m.reason}</p>
                        )}
                     </div>
                  </div>
               </div>
            )) : (
               <div className="p-20 text-center">
                  <History className="size-12 text-[#B2BEC3] mx-auto mb-4 opacity-20" />
                  <p className="text-xs font-bold text-[#B2BEC3] uppercase">Aucun mouvement de stock enregistré</p>
               </div>
            )}
         </div>
         <MovementPager f={f} />
      </div>
   );
}

function TimelineView() {
   const f = useFilteredMovements(50);

   const groups = (() => {
      const byDay: Record<string, InventoryMovement[]> = {};
      f.movements.forEach(m => {
         const day = new Date(m.created_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
         (byDay[day] ||= []).push(m);
      });
      return Object.entries(byDay);
   })();

   return (
      <div className="bg-white border rounded-2xl overflow-hidden shadow-sm animate-in slide-in-from-bottom-2 duration-400" style={{ borderColor: C.border }}>
         <div className="flex items-center justify-between p-6 border-b" style={{ borderColor: C.border }}>
            <div>
               <h3 className="text-sm font-extrabold text-[#2D3436] uppercase tracking-wider flex items-center gap-2">
                  <GitBranch className="size-4 text-[#6C5CE7]" /> Timeline Chronologique
               </h3>
               <p className="text-[10px] font-bold text-[#B2BEC3] uppercase tracking-widest mt-1">Chaque événement, identifiable immédiatement par type</p>
            </div>
         </div>
         <MovementFilterBar f={f} />
         <div className="p-6">
            {f.isLoading ? (
               <div className="p-10 flex flex-col items-center gap-3">
                  <Loader2 className="size-6 animate-spin text-[#6C5CE7]" />
               </div>
            ) : groups.length === 0 ? (
               <div className="p-20 text-center">
                  <GitBranch className="size-12 text-[#B2BEC3] mx-auto mb-4 opacity-20" />
                  <p className="text-xs font-bold text-[#B2BEC3] uppercase">Aucun événement sur cette période</p>
               </div>
            ) : groups.map(([day, evts]) => (
               <div key={day} className="mb-8 last:mb-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3] mb-4">{day}</p>
                  <div className="space-y-0">
                     {evts.map((m, i) => {
                        const Icon = MOVEMENT_TYPE_ICON[m.type] || Sliders;
                        const color = MOVEMENT_TYPE_COLOR[m.type] || C.textDim;
                        return (
                           <div key={m.id} className={cn(
                              "flex gap-4 relative pb-6",
                              i !== evts.length - 1 && "before:absolute before:left-[15px] before:top-8 before:bottom-0 before:w-[2px] before:bg-[#E9ECF0]"
                           )}>
                              <div className="size-8 rounded-full border-2 border-white shrink-0 flex items-center justify-center z-10" style={{ backgroundColor: color + '22' }}>
                                 <Icon className="size-4" style={{ color }} />
                              </div>
                              <div className="flex-1 pt-0.5">
                                 <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] font-black text-[#2D3436] font-mono">{new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                                    <span className={cn("text-[10px] font-black", m.quantity >= 0 ? "text-[#00B894]" : "text-[#E17055]")}>{m.quantity >= 0 ? '+' : ''}{m.quantity}</span>
                                    <span className="text-xs font-bold text-[#2D3436]">{MOVEMENT_TYPE_LABELS[m.type] || 'Ajustement Manuel'}</span>
                                 </div>
                                 <p className="text-[11px] text-[#636E72] mt-0.5">
                                    {m.product_name || m.product_id}
                                    {m.order_number && <> · Commande #{m.order_number}</>}
                                    {m.warehouse_name && <> · {m.warehouse_name}</>}
                                    {m.actor?.name && <> · {m.actor.name}</>}
                                 </p>
                              </div>
                           </div>
                        );
                     })}
                  </div>
               </div>
            ))}
         </div>
         <MovementPager f={f} />
      </div>
   );
}
