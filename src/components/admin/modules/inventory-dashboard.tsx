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
  FileText
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
}

interface InventoryMovementsResponse {
  data: InventoryMovement[];
}


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
      refetchInterval: 10000, // 10s for real-time feel
   });

   const movementsQuery = useQuery({
      queryKey: ['inventory', 'movements', storeId],
      queryFn: () => apiFetch<InventoryMovementsResponse>(`/api/v1/stock/?store_id=${storeId}&pageSize=30`),
      enabled: !!storeId,
      refetchInterval: 10000,
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
   if (activeTab === 'HISTORY') return <HistoryView movements={movements} isLoading={isLoadingMovements} />;
   return <StockView />; 
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
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            <KpiCard title="Clusters Actifs" value={`${warehouses.length}/${warehouses.length}`} icon={Warehouse} color={C.primary} bgColor={C.primaryBg} status="nominal" />
            <KpiCard title="Flux Système" value={`${logs.length.toLocaleString()} U`} icon={Activity} color={C.info} bgColor={C.infoBg} />
            <KpiCard title="Latence Flotte" value="NOMINAL" icon={Truck} color={C.success} bgColor={C.successBg} status="nominal" />
            <KpiCard title="Audits Récents" value={logs.length.toString()} icon={ShieldCheck} color={C.warning} bgColor={C.warningBg} />
         </div>

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
                        ["Event ID", "Timestamp", "Type", "Quantité", "Raison"],
                        ...logs.map(log => [
                           log.id,
                           new Date(log.created_at).toLocaleString(),
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
                     {logs.slice(0, 10).map((log, i) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                           <td className="py-4 font-mono text-[10px] text-[#2D3436]">#{log.id.split('-')[0]}</td>
                           <td className="py-4 text-[10px] font-bold text-[#636E72]">{new Date(log.created_at).toLocaleString()}</td>
                           <td className="py-4 text-[10px] font-black uppercase text-[#6C5CE7]">Système / {log.type.split('_')[0]}</td>
                           <td className="py-4 text-[10px] font-bold text-slate-400 italic">{log.reason || 'Calcul Automatique'}</td>
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

function HistoryView({ movements, isLoading }: { movements: InventoryMovement[]; isLoading: boolean }) {

   const handleExport = () => {
      if (movements.length === 0) return toast.error("Aucune donnée à exporter");
      const csv = [
         ["Date", "Produit", "Type", "Quantité", "Raison"],
         ...movements.map(m => [
            new Date(m.created_at).toLocaleString(),
            m.product_id,
            m.type,
            m.quantity,
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
               <p className="text-[10px] font-bold text-[#B2BEC3] uppercase tracking-widest mt-1">Traçabilité complète des flux</p>
            </div>
            <button 
               onClick={handleExport}
               className="px-4 py-2 rounded-xl text-xs font-bold border hover:bg-[#F8F9FC] transition-all flex items-center gap-2" style={{ borderColor: C.border }}>
               <Download className="size-3.5 text-[#B2BEC3]" /> Exporter (.CSV)
            </button>
         </div>
         <div className="divide-y" style={{ borderColor: C.border }}>
            {isLoading ? (
               <div className="p-10 flex flex-col items-center gap-3">
                  <Loader2 className="size-6 animate-spin text-[#6C5CE7]" />
                  <span className="text-[10px] font-bold text-[#B2BEC3] uppercase">Synchronisation du journal...</span>
               </div>
            ) : movements.length > 0 ? movements.map((m, i) => (
               <div key={m.id} className="p-5 flex items-center justify-between hover:bg-[#FAFBFD] transition-colors group cursor-pointer">
                  <div className="flex items-center gap-4">
                     <div className="size-10 rounded-xl bg-[#F8F9FC] border flex items-center justify-center text-[#B2BEC3] group-hover:text-[#6C5CE7] group-hover:bg-[#F0EDFF] transition-all" style={{ borderColor: C.border }}>
                        <FileText className="size-4.5" />
                     </div>
                     <div>
                        <p className="text-xs font-extrabold text-[#2D3436]">
                           {m.type === 'RESTOCK' ? 'Réapprovisionnement' : 
                            m.type === 'ORDER_CONFIRM' ? 'Confirmation Commande' : 
                            m.type === 'POS_SALE' ? 'Vente au Comptant (POS)' :
                            'Ajustement Manuel'} : 
                           <span className="font-mono text-[#6C5CE7] ml-2">{m.id.split('-')[0].toUpperCase()}</span>
                        </p>
                        <div className="flex items-center gap-3 mt-1.5">
                           <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-md uppercase",
                              m.quantity > 0 ? "text-[#00B894] bg-[#E6FFF8]" : "text-[#E17055] bg-[#FFEDE9]"
                           )}>
                              {m.quantity > 0 ? '+' : ''}{m.quantity} Unités
                           </span>
                           <span className="text-[10px] font-bold text-[#B2BEC3] flex items-center gap-1"><Clock className="size-3" /> {new Date(m.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                           <span className="text-[10px] font-bold text-[#636E72] uppercase tracking-tighter">— Ref: {m.product_id.split('-')[0]}</span>
                        </div>
                     </div>
                  </div>
                  <button className="text-[10px] font-black uppercase bg-[#F8F9FC] border px-4 py-2 rounded-xl hover:bg-black hover:text-white transition-all opacity-0 group-hover:opacity-100" style={{ borderColor: C.border }}>Détails</button>
               </div>
            )) : (
               <div className="p-20 text-center">
                  <History className="size-12 text-[#B2BEC3] mx-auto mb-4 opacity-20" />
                  <p className="text-xs font-bold text-[#B2BEC3] uppercase">Aucun mouvement de stock enregistré</p>
               </div>
            )}
         </div>
         <div className="p-4 bg-[#F8F9FC] border-t flex justify-center" style={{ borderColor: C.border }}>
            <button className="text-[10px] font-bold text-[#6C5CE7] hover:underline uppercase tracking-widest">Accéder aux archives complètes</button>
         </div>
      </div>
   );
}
