'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Phone, CheckCircle, XCircle, Clock, Package, Banknote,
  TrendingUp, LogOut, RefreshCw, Truck, Eye, ChevronDown,
  BarChart3, Activity, FileText, AlertCircle, MapPin, User,
  Calendar, Timer, Target, Award, ArrowRight, Loader2,
  LayoutGrid, Search, Filter, ChevronRight, Menu, Bell
} from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { Order } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

// ─── Constants ──────────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; color: string; bg: string; next: string[] }> = {
  NEW:       { label: 'Nouvelle',      color: '#0f172a', bg: '#f1f5f9', next: ['EN ATTENTE', 'CONFIRMED', 'CANCELLED'] },
  'EN ATTENTE': { label: 'En attente', color: '#ea580c', bg: '#fff7ed', next: ['CONFIRMED', 'CANCELLED'] },
  ASSIGNED:  { label: 'Assignée',      color: '#2563eb', bg: '#eff6ff', next: ['EN ATTENTE', 'CONFIRMED', 'CANCELLED'] },
  CONFIRMED: { label: 'Confirmée',     color: '#059669', bg: '#ecfdf5', next: ['FOLLOWUP', 'CANCELLED'] },
  FOLLOWUP:  { label: 'En livraison', color: '#2563eb', bg: '#eff6ff', next: ['COMPLETED', 'CANCELLED'] },
  COMPLETED: { label: 'Livrée',        color: '#059669', bg: '#ecfdf5', next: [] },
  CANCELLED: { label: 'Annulée',       color: '#dc2626', bg: '#fef2f2', next: [] },
  RETURNED:  { label: 'Retournée',     color: '#64748b', bg: '#f8fafc', next: [] },
};

// ─── Types ──────────────────────────────────────────────────
type SubModule = { id: string; label: string; icon?: any; filter?: string };
type Module = { id: string; label: string; icon: any; subModules: SubModule[] };

const MODULES: Module[] = [
  {
    id: 'orders',
    label: 'Commandes',
    icon: Package,
    subModules: [
      { id: 'orders-all', label: 'Toutes les commandes', filter: 'ALL' },
      { id: 'orders-new', label: 'Nouvelles / Assignées', filter: 'NEW' },
      { id: 'orders-pending', label: 'À confirmer', filter: 'EN ATTENTE' },
      { id: 'orders-confirmed', label: 'Confirmées', filter: 'CONFIRMED' },
    ]
  },
  {
    id: 'logistics',
    label: 'Logistique',
    icon: Truck,
    subModules: [
      { id: 'tracking-search', label: 'Suivi par N°', icon: Search },
      { id: 'delivery-in-progress', label: 'En livraison', filter: 'FOLLOWUP' },
      { id: 'delivery-completed', label: 'Livrées', filter: 'COMPLETED' },
    ]
  },
  {
    id: 'performance',
    label: 'Mon Espace',
    icon: LayoutGrid,
    subModules: [
      { id: 'salary-details', label: 'Mon Salaire', icon: Banknote },
      { id: 'activity-report', label: 'Rapport d\'activité', icon: BarChart3 },
    ]
  }
];

// ─── Helpers ────────────────────────────────────────────────
function useWorkTimer() {
  const KEY = 'agent_session_start';
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!sessionStorage.getItem(KEY)) sessionStorage.setItem(KEY, Date.now().toString());
    const tick = () => setElapsed(Math.floor((Date.now() - parseInt(sessionStorage.getItem(KEY) || '0', 10)) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);
  const h = Math.floor(elapsed / 3600).toString().padStart(2, '0');
  const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
  const s = (elapsed % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, color: '#64748b', bg: '#f8fafc' };
  return (
    <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded border" 
          style={{ color: cfg.color, backgroundColor: cfg.bg, borderColor: `${cfg.color}20` }}>
      {cfg.label}
    </span>
  );
}

// ─── Components ─────────────────────────────────────────────

function OrderDrawer({ order, onClose, onStatusChange }: { order: Order; onClose: () => void; onStatusChange: (id: string, s: string) => void }) {
  const cfg = STATUS_CFG[order.status] ?? { next: [] };
  return (
    <div className="fixed inset-0 z-[100] flex">
      <div className="flex-1 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="p-6 border-b flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Détails Commande</p>
            <h2 className="text-sm font-bold font-mono">#{order.order_number}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-50 rounded-lg"><XCircle className="size-5 text-slate-300" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          <div className="space-y-4">
            <StatusBadge status={order.status} />
            <div className="p-4 bg-slate-50 rounded-lg border space-y-3">
              <div className="flex items-center gap-3">
                <User className="size-4 text-slate-400" />
                <span className="text-xs font-bold">{order.customer_name}</span>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="size-4 text-slate-400" />
                <a href={`tel:${order.customer_phone}`} className="text-xs font-bold text-blue-600 underline">{order.customer_phone}</a>
              </div>
              <div className="flex items-center gap-3">
                <MapPin className="size-4 text-slate-400" />
                <span className="text-xs text-slate-500">{order.customer_address} · {order.customer_wilaya}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-2">Contenu</p>
             <div className="divide-y border rounded-lg overflow-hidden">
               {order.items?.map((item, i) => (
                 <div key={i} className="flex items-center justify-between p-3 text-xs">
                   <div>
                     <p className="font-bold">{item.product_name}</p>
                     <p className="text-slate-400">Qté: {item.quantity}</p>
                   </div>
                   <span className="font-bold">{formatPrice(item.quantity * item.unit_price)} DA</span>
                 </div>
               ))}
               <div className="p-3 bg-slate-50 flex justify-between font-bold">
                 <span>Total</span>
                 <span>{formatPrice(order.total)} DA</span>
               </div>
             </div>
          </div>

          {cfg.next.length > 0 && (
            <div className="space-y-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-2">Actions</p>
              <div className="grid grid-cols-1 gap-2">
                {cfg.next.map(ns => (
                  <button key={ns} onClick={() => { onStatusChange(order.id, ns); onClose(); }}
                          className="flex items-center justify-between p-3 border rounded-lg hover:bg-slate-50 transition-colors text-xs font-bold">
                    <span>Passer à : {STATUS_CFG[ns]?.label || ns}</span>
                    <ChevronRight className="size-4 text-slate-300" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SalaryView({ perf, user }: any) {
  const paymentAmount = user?.payment_amount ?? 0;
  const confirmedCount = perf?.stats?.confirmed_count ?? 0;
  const deliveredCount = perf?.stats?.delivered_count ?? 0;
  
  return (
    <div className="space-y-6">
       <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Confirmées', val: confirmedCount, color: '#059669' },
            { label: 'Livrées', val: deliveredCount, color: '#2563eb' },
            { label: 'Total Assigné', val: perf?.stats?.total_assigned ?? 0, color: '#0f172a' },
          ].map(s => (
            <div key={s.label} className="p-4 bg-white border rounded-lg">
               <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{s.label}</p>
               <p className="text-xl font-bold mt-1" style={{ color: s.color }}>{s.val}</p>
            </div>
          ))}
       </div>
       <div className="p-8 bg-slate-900 text-white rounded-xl border border-slate-800">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Estimation Salaire</p>
          <p className="text-4xl font-bold mt-2">{formatPrice(confirmedCount * paymentAmount)} DA</p>
          <div className="mt-6 flex items-center gap-2 text-xs text-slate-400">
             <AlertCircle className="size-4" />
             Basé sur {confirmedCount} confirmations à {formatPrice(paymentAmount)} DA l'unité.
          </div>
       </div>
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────

export default function AgentDashboard() {
  const { user, activeStore, setAppView } = useAppStore();
  const queryClient = useQueryClient();
  const workTimer = useWorkTimer();
  
  const [activeModule, setActiveModule] = useState('orders');
  const [activeSubModule, setActiveSubModule] = useState('orders-all');
  const [search, setSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const currentFilter = useMemo(() => {
    const sub = MODULES.flatMap(m => m.subModules).find(s => s.id === activeSubModule);
    return sub?.filter || 'ALL';
  }, [activeSubModule]);

  const ordersQuery = useQuery({
    queryKey: ['agent-orders', user?.id, activeStore?.id, currentFilter],
    queryFn: () => {
      let url = `/api/v1/orders?assigned_to=${user?.id}&store_id=${activeStore?.id}&pageSize=100`;
      if (currentFilter !== 'ALL') url += `&status=${encodeURIComponent(currentFilter)}`;
      return apiFetch<{ data: Order[] }>(url);
    },
    enabled: !!user?.id,
    refetchInterval: 30000
  });

  const perfQuery = useQuery({
    queryKey: ['agent-perf', user?.id],
    queryFn: () => apiFetch<any>(`/api/v1/users/${user?.id}/performance?store_id=${activeStore?.id}`),
    enabled: !!user?.id
  });

  const statusMutation = useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: string }) =>
      apiFetch(`/api/v1/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-orders'] });
      queryClient.invalidateQueries({ queryKey: ['agent-perf'] });
      toast.success('Statut mis à jour');
    }
  });

  const filteredOrders = (ordersQuery.data?.data ?? []).filter(o => 
    o.order_number.toLowerCase().includes(search.toLowerCase()) ||
    o.customer_name.toLowerCase().includes(search.toLowerCase()) ||
    o.customer_phone.includes(search)
  );

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {selectedOrder && <OrderDrawer order={selectedOrder} onClose={() => setSelectedOrder(null)} onStatusChange={(id, s) => statusMutation.mutate({ orderId: id, status: s })} />}

      {/* ─── Sidebar ─── */}
      <aside className="w-64 border-r bg-white flex flex-col shrink-0">
        <div className="h-16 px-6 border-b flex items-center gap-3 bg-slate-900 text-white">
          <div className="size-8 bg-blue-600 rounded flex items-center justify-center font-bold">A</div>
          <span className="text-sm font-bold tracking-tight">AGENT HUB</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
          {MODULES.map(module => (
            <div key={module.id} className="space-y-1">
              <div className="flex items-center gap-2 px-3 py-2 text-slate-400">
                <module.icon className="size-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest">{module.label}</span>
              </div>
              <div className="space-y-0.5">
                {module.subModules.map(sub => (
                  <button key={sub.id} onClick={() => { setActiveModule(module.id); setActiveSubModule(sub.id); }}
                          className={cn(
                            "w-full text-left px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-between group",
                            activeSubModule === sub.id ? "bg-slate-900 text-white shadow-lg" : "text-slate-500 hover:bg-slate-50"
                          )}>
                    <span className="flex items-center gap-2">
                       {sub.icon && <sub.icon className="size-3.5" />}
                       {sub.label}
                    </span>
                    {activeSubModule === sub.id && <ChevronRight className="size-3" />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t bg-slate-50">
          <div className="flex items-center gap-3 p-2">
             <div className="size-8 bg-slate-200 rounded-full flex items-center justify-center text-[10px] font-bold">
               {user?.name?.charAt(0)}
             </div>
             <div className="min-w-0">
                <p className="text-xs font-bold truncate">{user?.name}</p>
                <p className="text-[9px] text-slate-400 font-bold uppercase">{workTimer}</p>
             </div>
             <button onClick={() => setAppView('storefront')} className="ml-auto p-2 text-slate-400 hover:text-red-500">
               <LogOut className="size-4" />
             </button>
          </div>
        </div>
      </aside>

      {/* ─── Main Content ─── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 border-b bg-white flex items-center justify-between px-8 shrink-0">
          <div className="flex items-center gap-4 flex-1 max-w-md">
             <div className="relative w-full">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
               <Input placeholder="Rechercher une commande, un nom, un téléphone..." className="pl-10 h-10 bg-slate-50 border-none shadow-none text-xs rounded-xl" value={search} onChange={e => setSearch(e.target.value)} />
             </div>
          </div>
          <div className="flex items-center gap-6">
             <div className="flex flex-col items-end">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Boutique active</span>
                <span className="text-xs font-bold">{activeStore?.name}</span>
             </div>
             <div className="size-10 border rounded-xl flex items-center justify-center relative">
               <Bell className="size-5 text-slate-400" />
               <div className="absolute top-0 right-0 size-2 bg-red-500 rounded-full border-2 border-white" />
             </div>
             <button onClick={() => queryClient.invalidateQueries({ queryKey: ['agent-orders'] })} 
                     className="p-2 border rounded-xl hover:bg-slate-50 transition-colors">
               <RefreshCw className={cn("size-4 text-slate-500", ordersQuery.isFetching && "animate-spin")} />
             </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-50/50">
          {activeSubModule === 'salary-details' ? (
            <SalaryView perf={perfQuery.data} user={user} />
          ) : activeSubModule === 'tracking-search' ? (
            <div className="max-w-2xl mx-auto space-y-6">
               <div className="p-8 bg-white border rounded-2xl shadow-sm space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400">Recherche de Tracking</h3>
                  <div className="flex gap-2">
                     <Input placeholder="Entrez un numéro de suivi..." className="h-12 bg-slate-50 border-none text-sm font-mono rounded-xl" />
                     <button className="px-8 bg-slate-900 text-white font-bold rounded-xl text-xs hover:bg-slate-800 transition-colors">RECHERCHER</button>
                  </div>
               </div>
            </div>
          ) : (
            <div className="space-y-6">
               <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold tracking-tight">
                    {MODULES.flatMap(m => m.subModules).find(s => s.id === activeSubModule)?.label}
                  </h2>
                  <div className="flex items-center gap-2">
                     <span className="text-xs font-bold text-slate-400">{filteredOrders.length} résultats</span>
                  </div>
               </div>

               {ordersQuery.isLoading ? (
                 <div className="flex flex-col items-center justify-center py-32 gap-4">
                    <Loader2 className="size-8 animate-spin text-slate-200" />
                    <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Synchronisation...</p>
                 </div>
               ) : filteredOrders.length === 0 ? (
                 <div className="flex flex-col items-center justify-center py-40 bg-white border rounded-[32px] border-dashed">
                    <Package className="size-12 text-slate-100" />
                    <p className="mt-4 text-xs font-bold text-slate-300 uppercase tracking-widest">Aucune donnée trouvée</p>
                 </div>
               ) : (
                 <div className="grid grid-cols-1 gap-3">
                    {filteredOrders.map(order => (
                      <button key={order.id} onClick={() => setSelectedOrder(order)}
                              className="w-full bg-white border rounded-xl p-4 flex items-center justify-between hover:border-slate-300 hover:shadow-md transition-all group">
                         <div className="flex items-center gap-4">
                            <StatusBadge status={order.status} />
                            <div className="text-left">
                               <p className="text-xs font-bold font-mono group-hover:text-blue-600 transition-colors">#{order.order_number}</p>
                               <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">{order.customer_name} · {order.customer_wilaya}</p>
                            </div>
                         </div>
                         <div className="flex items-center gap-8">
                            <div className="text-right hidden sm:block">
                               <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Téléphone</p>
                               <p className="text-xs font-bold">{order.customer_phone}</p>
                            </div>
                            <div className="text-right shrink-0">
                               <p className="text-xs font-bold">{formatPrice(order.total)} DA</p>
                               <p className="text-[9px] text-slate-400 font-bold uppercase">{new Date(order.created_at).toLocaleDateString()}</p>
                            </div>
                            <ChevronRight className="size-4 text-slate-200 group-hover:text-slate-400 transition-colors" />
                         </div>
                      </button>
                    ))}
                 </div>
               )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
