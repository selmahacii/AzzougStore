'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Phone, CheckCircle, XCircle, Clock, Package, Banknote,
  TrendingUp, LogOut, RefreshCw, Truck, Eye, ChevronDown,
  BarChart3, Activity, FileText, AlertCircle, MapPin, User,
  Calendar, Timer, Target, Award, ArrowRight, Loader2,
  LayoutGrid, Search, Filter, ChevronRight, Menu,
  List, Inbox, ShoppingCart, Home, Plus, Save,
  Warehouse, History, Bell, Wallet, UserCheck, Boxes, UserPlus, Lock, Store, CheckCircle2
} from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { formatPrice, formatOrderRef } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { WILAYAS } from '@/lib/wilaya-data';
import { ALGERIAN_COMMUNES } from '@/lib/algerian-communes';
import { toast } from 'sonner';
import type { Order } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ManualOrderModal } from '@/components/agent/manual-order-modal';
import { NOEST_BUREAUX } from '@/lib/noest-bureaux-data';
import { OrderTraceabilityPanel } from '@/components/admin/order-traceability-panel';
import { OrderTrackingReport } from '@/components/admin/order-tracking-report';
import { OrderTypeBadge, RelatedOrdersBadge } from '@/components/shared/order-type-badge';
import InventoryDashboard from '@/components/admin/modules/inventory-dashboard';
import ProductsPage from '@/components/admin/products-page';
import { DuplicateHistoryModal } from '@/components/shared/duplicate-history-modal';
import { DuplicatePopover } from '@/components/shared/duplicate-popover';

// ─── Constants ──────────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; color: string; bg: string; next: string[] }> = {
  NEW:          { label: 'Nouvelle',         color: '#0f172a', bg: '#f1f5f9', next: ['ASSIGNED', 'IN_PROGRESS', 'CONFIRMED', 'CANCELLED'] },
  ASSIGNED:     { label: 'Assignée',         color: '#2563eb', bg: '#eff6ff', next: ['CALLED', 'IN_PROGRESS', 'CONFIRMED', 'CANCELLED', 'RESCHEDULED'] },
  CALLED:       { label: 'Appelée',          color: '#eab308', bg: '#fef08a', next: ['CONFIRMED', 'CANCELLED', 'RESCHEDULED'] },
  IN_PROGRESS:  { label: 'En attente',       color: '#ea580c', bg: '#fff7ed', next: ['CONFIRMED', 'CANCELLED', 'RESCHEDULED'] },
  RESCHEDULED:  { label: 'Reportée',         color: '#d97706', bg: '#fef3c7', next: ['CONFIRMED', 'CANCELLED'] },
  CONFIRMED:    { label: 'Confirmée',        color: '#059669', bg: '#ecfdf5', next: ['SHIPPED', 'CANCELLED'] },
  SHIPPED:      { label: 'En livraison',     color: '#0891b2', bg: '#ecfeff', next: ['DELIVERED', 'RETURNED', 'CANCELLED'] },
  DELIVERED:    { label: 'Livrée',           color: '#059669', bg: '#ecfdf5', next: ['RETURNED'] },
  CANCELLED:    { label: 'Annulée',          color: '#475569', bg: '#f1f5f9', next: ['CONFIRMED', 'IN_PROGRESS'] },
  RETURNED:     { label: 'Retournée',        color: '#e11d48', bg: '#fff1f2', next: [] },
  ABANDONED:    { label: 'Panier Abandonné', color: '#ea580c', bg: '#fff7ed', next: ['CONFIRMED', 'CANCELLED'] },
};

// ─── Types ──────────────────────────────────────────────────
type SubModule = { id: string; label: string; icon?: any; filter?: string };
type Module = { id: string; label: string; icon: any; subModules: SubModule[] };

// isLivreur: a livreur only ever sees orders scoped to him server-side
// (Order.livreur_id == his id — see orders.py's list endpoint), and never
// creates orders manually or over the phone the way a confirmatrice does
// — "Commandes Manuelles" is dropped for him. He otherwise gets the exact
// same Commandes/Logistique workflow, plus his pre-existing full Produits/
// Inventaire access (kept below), matching a confirmatrice's rights except
// for what genuinely doesn't apply to his role.
function getModules(isLivreur: boolean, user?: any): Module[] {
  const vis = user?.module_visibility || {};
  const modules: (Module | null)[] = [
    vis.orders === false ? null : {
      id: 'orders',
      label: 'Commandes',
      icon: Package,
      subModules: [
        { id: 'orders-new', label: 'Nouvelles Commandes', filter: 'NEW', icon: Inbox },
        { id: 'orders-pending', label: 'En attente', filter: 'PENDING_CONFIRMATION', icon: Clock },
        { id: 'orders-nrp-normal', label: 'NRP Commandes', filter: 'NRP_NORMAL', icon: Phone },
        { id: 'orders-nrp-abandoned', label: 'NRP Paniers Aband.', filter: 'NRP_ABANDONED', icon: Phone },
        { id: 'orders-abandoned', label: 'Paniers Abandonnés', filter: 'ABANDONED_IN_PROGRESS', icon: ShoppingCart },
        { id: 'orders-recovered', label: 'Paniers Récupérés', filter: 'RECOVERED', icon: TrendingUp },
        { id: 'orders-confirmed', label: 'Confirmées', filter: 'CONFIRMED', icon: CheckCircle },
        { id: 'orders-cancelled', label: 'Annulées', filter: 'CANCELLED', icon: XCircle },
        ...(isLivreur ? [] : [{ id: 'orders-manual', label: 'Commandes Manuelles', filter: 'MANUAL', icon: UserCheck }]),
        ...(isLivreur ? [
          { id: 'orders-upsell', label: 'Upsell', filter: 'UPSELL', icon: TrendingUp },
          { id: 'orders-returned', label: 'Retours', filter: 'RETURNED', icon: XCircle },
        ] : []),
      ]
    },
    (vis.deliveries === false && vis.orders === false) ? null : {
      id: 'logistics',
      label: 'Logistique',
      icon: Truck,
      subModules: [
        { id: 'tracking-search', label: 'Suivi par N°', icon: Search },
        { id: 'delivery-internal', label: 'Assignées Livreur', filter: 'INTERNAL_DELIVERY', icon: Truck },
        { id: 'delivery-in-progress', label: 'En livraison (tout)', filter: 'SHIPPED', icon: Truck },
        ...(isLivreur ? [] : [
          { id: 'carrier-ready', label: 'Prêt à expédier', filter: 'CARRIER_READY_TO_SHIP', icon: Package },
          { id: 'carrier-processing', label: 'En traitement', filter: 'CARRIER_PROCESSING', icon: Clock },
          { id: 'carrier-transit', label: 'En expédition', filter: 'CARRIER_IN_TRANSIT', icon: Truck },
          { id: 'carrier-out', label: 'En livraison', filter: 'CARRIER_OUT_FOR_DELIVERY', icon: Truck },
          { id: 'carrier-suspended', label: 'Suspendus', filter: 'CARRIER_SUSPENDED', icon: AlertCircle },
        ]),
        { id: 'delivery-completed', label: 'Livrées', filter: 'DELIVERED', icon: Home },
        { id: 'delivery-returned', label: 'Retournées', filter: 'RETURNED', icon: XCircle },
      ]
    },
    vis.inventory === false ? null : {
      id: 'inventory',
      label: 'Inventaire',
      icon: Warehouse,
      subModules: [
        { id: 'inventory-stock', label: 'Stock Produits', icon: Package },
        { id: 'inventory-history', label: 'Mouvements', icon: History },
        { id: 'inventory-alerts', label: 'Alertes Rupture', icon: AlertCircle },
      ]
    },
    vis.analytics === false ? null : {
      id: 'performance',
      label: 'Mon Espace',
      icon: LayoutGrid,
      subModules: [
        { id: 'salary-details', label: 'Mon Salaire', icon: Banknote },
        { id: 'activity-report', label: 'Rapport d\'activité', icon: BarChart3 },
      ]
    },
    (isLivreur && vis.products !== false) ? {
      id: 'products',
      label: 'Produits',
      icon: Boxes,
      subModules: [{ id: 'products-catalog', label: 'Catalogue', icon: Boxes }],
    } : null,
  ];

  return modules.filter(Boolean) as Module[];
}

// ─── Vue inventaire (réutilise le module admin) ─────────────
// InventoryDashboard/StockManager already have built-in CONFIRMATEUR
// support (hides purchase price/margin columns via isConfirmateur) and
// let her actually adjust stock quantities — not just look at them.
// InventoryDashboard chooses its internal tab via adminSubView (store
// global) ; on le synchronise avec le sous-module choisi dans la sidebar.
const INVENTORY_TAB: Record<string, string> = {
  'inventory-stock': 'STOCK',
  'inventory-history': 'HISTORY',
  'inventory-alerts': 'ALERTS',
};

function AgentInventoryView({ subModuleId }: { subModuleId: string }) {
  const setAdminSubView = useAppStore(s => s.setAdminSubView);
  useEffect(() => {
    setAdminSubView(INVENTORY_TAB[subModuleId] || 'STOCK');
  }, [subModuleId, setAdminSubView]);
  return <InventoryDashboard />;
}

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

function NrpBadge({ count }: { count: number }) {
  if (!count || count <= 0) return null;
  
  let styles = "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (count === 2) {
    styles = "bg-amber-50 text-amber-700 border-amber-200";
  } else if (count === 3) {
    styles = "bg-orange-50 text-orange-700 border-orange-200";
  } else if (count >= 4) {
    styles = "bg-rose-50 text-rose-700 border-rose-200 animate-pulse ring-2 ring-rose-500/20";
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border shrink-0 ${styles}`}>
      NRP {count}
    </span>
  );
}

// Distinct from NrpBadge on purpose: an order moved directly to a pending
// status (IN_PROGRESS/RESCHEDULED) without ever going through "Signaler
// NRP" is a different situation for the confirmatrice (customer DID answer,
// just asked for a callback / is still being worked) — different color
// family (sky, not the NRP amber/orange/rose escalation) so it can't be
// mistaken for an unanswered-call order at a glance.
function PendingBadge({ order }: { order: Order }) {
  const isPendingStatus = order.status === 'IN_PROGRESS' || order.status === 'RESCHEDULED';
  if (!isPendingStatus || (order.nrp_count ?? 0) > 0) return null;

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border shrink-0 bg-sky-50 text-sky-700 border-sky-200">
      <Clock className="size-2.5" /> En attente
    </span>
  );
}

function OrderTimer({ startTime }: { startTime?: string }) {
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    if (!startTime) return;
    const start = new Date(startTime).getTime();
    const tick = () => {
      const diff = Math.floor((Date.now() - start) / 1000);
      if (diff < 0) return;
      const h = Math.floor(diff / 3600).toString().padStart(2, '0');
      const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
      const s = (diff % 60).toString().padStart(2, '0');
      setElapsed(`${h}:${m}:${s}`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startTime]);
  if (!startTime) return null;
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 uppercase tracking-widest">
      <Timer className="size-3" />
      {elapsed || '00:00:00'}
    </div>
  );
}

// ─── Components ─────────────────────────────────────────────

function UnprocessedCartReassign({ order, onStatusChange, isPending }: { order: Order; onStatusChange: (id: string, s?: string, assignTo?: string) => void; isPending?: boolean }) {
  const agentsQuery = useQuery<any>({
    queryKey: ['agents-for-reassign', order.store_id],
    queryFn: () => apiFetch(`/api/v1/users/?store_id=${order.store_id}`, { headers: { 'X-Store-Id': order.store_id } }),
    staleTime: 60_000,
    enabled: !!order.store_id,
  });

  const raw = agentsQuery.data?.data ?? agentsQuery.data ?? [];
  const agents = (Array.isArray(raw) ? raw : [])
    .filter((u: any) => u.is_active !== false && ['CONFIRMATEUR', 'AGENT', 'AGENT_MANAGER', 'SUPER_ADMIN', 'ADMIN'].includes(u.role));

  const isUnprocessed = (!order.nrp_count || order.nrp_count === 0) &&
    !(order as any).called_at &&
    !order.confirmation_start_time &&
    ['ABANDONED', 'NEW', 'ASSIGNED'].includes(order.status);

  if (!isUnprocessed) {
    return (
      <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500 font-semibold">
        <div className="flex items-center gap-2">
          <Lock className="size-4 text-slate-400 shrink-0" />
          <span>Traitement démarré ({order.nrp_count || 0} tentative(s) NRP / statut {order.status})</span>
        </div>
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Verrouillé</span>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-xl border border-indigo-200 bg-indigo-50/40 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-wider text-indigo-700 flex items-center gap-1.5">
          <UserPlus className="size-3.5 text-indigo-600" />
          Réassignation Manuelle (Panier non traité)
        </span>
        <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-indigo-100 text-indigo-800">
          Aucune action appliquée
        </span>
      </div>
      <p className="text-[10px] font-bold text-slate-500">
        Ce panier n'a encore reçu aucun appel ni traitement. Vous pouvez le réassigner manuellement à un autre agent.
      </p>
      {agentsQuery.isLoading ? (
        <p className="text-[10px] font-bold text-slate-400">Chargement des agents...</p>
      ) : (
        <select
          value={order.assigned_to || ''}
          onChange={(e) => {
            if (e.target.value) {
              onStatusChange(order.id, undefined, e.target.value);
            }
          }}
          disabled={isPending}
          className="w-full text-xs p-2.5 border border-indigo-200 rounded-lg bg-white font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">— Choisir une confirmatrice à assigner —</option>
          {agents.map((a: any) => (
            <option key={a.id} value={a.id}>
              {a.name} {order.assigned_to === a.id ? '(Assigné(e) actuellement)' : ''}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function LivreurAssign({ order, onOrderUpdate, onDispatch, onStatusChange, isPending, currentUser }: { order: Order; onOrderUpdate?: (updated: Order) => void; onDispatch?: (id: string) => void; onStatusChange?: (id: string, s?: string, assignTo?: string, callResult?: string, deliveryType?: string) => void; isPending?: boolean; currentUser?: any }) {
  const queryClient = useQueryClient();
  const livreursQuery = useQuery<any>({
    queryKey: ['livreurs', order.store_id],
    queryFn: () => apiFetch(`/api/v1/users/?store_id=${order.store_id}`, { headers: { 'X-Store-Id': order.store_id } }),
    staleTime: 60_000,
  });
  const livreurs = ((Array.isArray(livreursQuery.data) ? livreursQuery.data : livreursQuery.data?.data) ?? [])
    .filter((u: any) => u.role === 'LIVREUR' && u.is_active !== false);

  const assignMutation = useMutation({
    mutationFn: (livreurId: string) =>
      apiFetch(`/api/v1/orders/${order.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ livreur_id: livreurId }),
        headers: { 'X-Store-Id': order.store_id },
      }),
    onSuccess: (updated: any) => {
      toast.success('Livreur assigné — il reçoit tous les détails de la commande');
      queryClient.invalidateQueries({ queryKey: ['agent-orders'] });
      if (onOrderUpdate && updated?.id) onOrderUpdate(updated);
    },
    onError: (err: any) => toast.error(err.message || "Erreur lors de l'assignation du livreur"),
  });

  const current = livreurs.find((l: any) => l.id === order.livreur_id);
  const hasCarrierParcel = !!order.tracking_number;

  return (
    <div className="space-y-3 pt-3 border-t border-slate-200/80">
      <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">🚚 Méthode de livraison</p>

      {/* Option 1 — Transporteur (Yalidine, Noest, etc.) */}
      <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 space-y-2">
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Option 1 — Transporteur</p>
        {hasCarrierParcel ? (
          <p className="text-[10px] font-bold text-cyan-700">📦 Colis créé chez le transporteur — suivi : {order.tracking_number}</p>
        ) : (order.status as string) !== 'CONFIRMED' ? (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold text-slate-400">Disponible une fois la commande Confirmée pour expédition.</p>
            {['NEW', 'ASSIGNED', 'CALLED', 'IN_PROGRESS', 'RESCHEDULED', 'ABANDONED', 'CONFIRMED'].includes(order.status as any) && onStatusChange && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => onStatusChange(order.id, 'CONFIRMED')}
                className="w-full py-2 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider hover:bg-emerald-700 transition-colors disabled:opacity-50 cursor-pointer"
              >
                ✓ Confirmer la commande maintenant
              </button>
            )}
          </div>
        ) : order.carrier_id ? (
          <button
            type="button"
            onClick={() => onDispatch && onDispatch(order.id)}
            className="w-full py-2 rounded-lg bg-cyan-600 text-white text-[10px] font-black uppercase tracking-wider hover:bg-cyan-700 transition-colors cursor-pointer"
          >
            Créer le colis chez le transporteur
          </button>
        ) : (
          <p className="text-[10px] font-bold text-slate-400">Aucun transporteur configuré sur cette commande.</p>
        )}
      </div>

      {/* Option 2 — Livreur interne */}
      <div className={cn(
        'p-3 rounded-xl border space-y-1.5',
        order.livreur_id ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-100 bg-slate-50/50'
      )}>
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Option 2 — Livreur interne</p>
        {livreursQuery.isLoading ? (
          <p className="text-[10px] font-bold text-slate-400">Chargement des livreurs...</p>
        ) : livreurs.length === 0 ? (
          <p className="text-[10px] font-bold text-slate-400">Aucun livreur actif configuré pour cette boutique.</p>
        ) : (
          <>
            <select
              value={order.livreur_id || ''}
              onChange={(e) => e.target.value && assignMutation.mutate(e.target.value)}
              disabled={assignMutation.isPending}
              className="w-full text-xs p-2.5 border rounded-lg bg-white font-bold"
            >
              <option value="">— Choisir un livreur —</option>
              {livreurs.map((l: any) => (
                <option key={l.id} value={l.id}>{l.name}{l.phone ? ` (${l.phone})` : ''}</option>
              ))}
            </select>
            {current && (
              <p className="text-[10px] font-bold text-emerald-600">
                ✓ Assignée à {current.name} — il/elle voit le client, le téléphone, l'adresse, les articles et le montant à encaisser. Suivez sa progression dans la timeline ci-dessous.
              </p>
            )}
          </>
        )}
      </div>

      {/* Option 3 — Vente Directe / Point de Vente (Retrait Magasin) */}
      {(order.status as string) !== 'DELIVERED' && onStatusChange && (
        <div className="p-3 rounded-xl border-2 border-emerald-500 bg-emerald-50/90 space-y-2 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-950 flex items-center gap-1.5">
              <Store className="size-3.5 text-emerald-600" />
              Option 3 — Point de Vente (Retrait Magasin)
            </p>
            <span className="text-[8px] bg-emerald-600 text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Vente Directe</span>
          </div>
          <p className="text-[10px] text-emerald-800 font-semibold leading-tight">
            Client au magasin ou retrait direct. Confirme la commande et attribue la commission Point de Vente.
          </p>
          <button
            type="button"
            disabled={isPending}
            onClick={() => onStatusChange(order.id, 'DELIVERED', currentUser?.role === 'LIVREUR' ? undefined : currentUser?.id, undefined, 'STORE_PICKUP')}
            className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-700 active:scale-[0.99] transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-md cursor-pointer mt-1"
          >
            <CheckCircle2 className="size-4" />
            Confirmer Point de Vente
          </button>
        </div>
      )}
    </div>
  );
}

function OrderDrawer({ order, onClose, onStatusChange, isPending, currentUser, onDispatch, initialEdit, onOrderUpdate, isDuplicatePhone }: { order: Order; onClose: () => void; onStatusChange: (id: string, s?: string, assignTo?: string, callResult?: string, deliveryType?: string) => void; isPending?: boolean; currentUser: any; onDispatch?: (id: string) => void; initialEdit?: boolean; onOrderUpdate?: (updated: Order) => void; isDuplicatePhone?: (phone: string) => boolean }) {
  const cfg = STATUS_CFG[order.status] ?? { next: [] };
  const queryClient = useQueryClient();
  const storeId = order.store_id;

  // Per-store NRP ceilings (operations_config), with platform defaults
  const { allStores: drawerStores } = useAppStore();
  const opsCfg: any = drawerStores.find(s => s.id === order.store_id)?.operations_config || {};
  const maxNrp = order.is_abandoned_cart
    ? (opsCfg.max_nrp_abandoned ?? 12)
    : (opsCfg.max_nrp_normal ?? 9);

  const [isEditing, setIsEditing] = useState(initialEdit || false);
  const [selectedBureauCode, setSelectedBureauCode] = useState('');
  const [yalidineCenters, setYalidineCenters] = useState<any[]>([]);
  const [loadingCenters, setLoadingCenters] = useState(false);

  // GET /orders (list) attaches duplicate_count but never the full merged
  // orders (only GET /orders/{id} does) — fetched here so the confirmatrice
  // sees exactly which resubmits were merged, same as the admin view, and
  // can see why a Meta Ads count doesn't match her queue even for a single
  // duplicate.
  const [duplicateDetails, setDuplicateDetails] = useState<any[] | null>(null);
  const [loadingDuplicateDetails, setLoadingDuplicateDetails] = useState(false);
  // parent_order — this order is itself a MERGED child, so we need the
  // order it was absorbed INTO (a MERGED order carries no duplicate_count
  // of its own, so the fetch above never triggered for it — without this,
  // opening a merged order gave no way to find the real, active order to
  // confirm/dispatch instead. Confirmed in production: order #595).
  const [parentOrder, setParentOrder] = useState<any | null>(null);
  const [loadingParentOrder, setLoadingParentOrder] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  useEffect(() => {
    const needsDuplicates = !!order.duplicate_count && order.duplicate_count > 0;
    const needsParent = order.status === 'MERGED';
    if (!needsDuplicates && !needsParent) {
      setDuplicateDetails(null);
      setParentOrder(null);
      return;
    }
    if (needsDuplicates) setLoadingDuplicateDetails(true);
    if (needsParent) setLoadingParentOrder(true);
    apiFetch<any>(`/api/v1/orders/${order.id}`)
      .then((full) => {
        setDuplicateDetails(full?.child_orders ?? []);
        setParentOrder(full?.parent_order ?? null);
      })
      .catch((err) => console.error('Failed to load order detail for order', order.id, err))
      .finally(() => { setLoadingDuplicateDetails(false); setLoadingParentOrder(false); });
  }, [order.id, order.duplicate_count, order.status]);

  useEffect(() => {
    if (!storeId) return;
    setLoadingCenters(true);
    // /api/yalidine/centers was a dead, pre-FastAPI-migration Next.js route
    // (queried a Prisma `db` client that no longer backs anything — always
    // 404'd). The real, working, cached backend endpoint is /stations.
    fetch(`/api/yalidine/stations?store_id=${storeId}`)
      .then(res => res.json())
      .then(body => {
        if (body.data) {
          setYalidineCenters(body.data);
        }
      })
      .catch(err => console.error('Error fetching Yalidine centers:', err))
      .finally(() => setLoadingCenters(false));
  }, [storeId]);
  
  const [editData, setEditData] = useState({
    customer_name: order.customer_name || '',
    customer_phone: order.customer_phone || '',
    customer_wilaya: order.customer_wilaya || '',
    customer_commune: order.customer_commune || '',
    customer_address: order.customer_address || '',
    delivery_type: order.delivery_type || 'home',
    carrier_id: order.carrier_id || '',
    delivery_fee: order.delivery_fee || 0,
    notes: order.notes || '',
    internal_notes: order.internal_notes || '',
    items: order.items ? order.items.map(item => ({
      id: item.id,
      product_id: item.product_id,
      product_name: item.product_name,
      sku: item.sku,
      quantity: item.quantity,
      unit_price: item.unit_price,
      variant_details: item.variant_details,
      image_url: item.image_url
    })) : [] as any[]
  });

  const wilayaIndex = WILAYAS.indexOf(editData.customer_wilaya as any);
  const wilayaId = wilayaIndex !== -1 ? wilayaIndex + 1 : null;
  const filteredBureaux = wilayaId 
    ? NOEST_BUREAUX.filter(b => b.wilayaId === wilayaId)
    : [];

  const deliveryPartnersQuery = useQuery<any>({
    queryKey: ['delivery-partners-lite', storeId],
    enabled: isEditing && !!storeId,
    queryFn: () => apiFetch(`/api/v1/delivery-partners?store_id=${storeId}`, { headers: { 'X-Store-Id': storeId } }),
  });

  // One live product query PER DISTINCT product in the order, not just the
  // first item — a shared single query keyed to items[0] meant editing the
  // variant/stock of the 2nd, 3rd, etc. product silently checked the WRONG
  // product's stock (or none at all), so the on-screen badge could show
  // nothing wrong while the backend still rejected the save with "Stock
  // insuffisant" for that other item.
  const editProductIds = Array.from(new Set((editData.items || []).map((it: any) => it.product_id).filter(Boolean)));
  const productQueriesResult = useQueries({
    queries: editProductIds.map((pid: string) => ({
      queryKey: ['product-details-agent', pid],
      enabled: isEditing,
      queryFn: () => apiFetch(`/api/v1/products/${pid}`, { headers: { 'X-Store-Id': order.store_id } }),
      // Stock moves in real time (other confirmatrices/orders reserve or
      // confirm concurrently) but the global QueryClient default (staleTime
      // 2min, refetchOnWindowFocus off) would otherwise let this go stale
      // for minutes while the drawer sits open — the exact gap that let a
      // confirmatrice see "3 en stock" and then get rejected with "Stock
      // insuffisant" on save.
      staleTime: 10_000,
      refetchInterval: isEditing ? 10_000 : false,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    })),
  });
  const productById: Record<string, any> = Object.fromEntries(
    editProductIds.map((pid: string, idx: number) => [pid, productQueriesResult[idx]?.data])
  );
  // Kept for the "Ajouter une variante" button below, which intentionally
  // duplicates the FIRST item's product as a new line.
  const productQuery = { data: productById[order.items?.[0]?.product_id ?? ''] };

  // Upsell: let the confirmatrice add a DIFFERENT existing product to this
  // order during the call. originalProductIds is frozen to what the order
  // actually had when the drawer opened — used to detect a genuinely new
  // addition (vs. just editing quantity/variant of what was already there)
  // so the order gets flagged is_upsell only when that really happened.
  const originalProductIds = useState(() => new Set((order.items || []).map((i: any) => i.product_id)))[0];
  const [upsellProductId, setUpsellProductId] = useState('');
  const [selectedUpsellColor, setSelectedUpsellColor] = useState('');
  const [selectedUpsellSize, setSelectedUpsellSize] = useState('');
  const [isCheckingStock, setIsCheckingStock] = useState(false);
  const storeProductsQuery = useQuery<any>({
    queryKey: ['agent-store-products-upsell', order.store_id],
    enabled: isEditing && !!order.store_id,
    queryFn: () => apiFetch(`/api/v1/products?store_id=${order.store_id}&limit=200&include_upsell_only=true`, { headers: { 'X-Store-Id': order.store_id } }),
  });
  const upsellCandidates: any[] = (storeProductsQuery.data?.data ?? []).filter(
    (p: any) => p.is_active && !editData.items.some((it: any) => it.product_id === p.id)
  );

  const selectedUpsellProduct = upsellCandidates.find((c: any) => c.id === upsellProductId);
  const upsellColorVariants = selectedUpsellProduct?.variants || [];
  const selectedUpsellColorVar = upsellColorVariants.find((v: any) => v.value === selectedUpsellColor);
  const upsellSizeVariants = selectedUpsellColorVar?.sub_variants || [];

  const matchedUpsellSubVar = selectedUpsellSize ? upsellSizeVariants.find((sv: any) => sv.value === selectedUpsellSize) : null;
  const effectiveUpsellVariant = matchedUpsellSubVar || (selectedUpsellColorVar && upsellSizeVariants.length === 0 ? selectedUpsellColorVar : null);
  const upsellVariantAvailable = effectiveUpsellVariant
    ? Number(effectiveUpsellVariant.stock || 0) - Number(effectiveUpsellVariant.reserved || 0)
    : (!upsellColorVariants.length ? Number(selectedUpsellProduct?.stock || 0) - Number(selectedUpsellProduct?.reserved_stock || 0) : null);

  // Only reset editData when the ORDER ID changes (i.e. drawer opened for a different order)
  // NOT when the order object is updated after a successful save (would erase local edits)
  useEffect(() => {
    setEditData({
      customer_name: order.customer_name || '',
      customer_phone: order.customer_phone || '',
      customer_wilaya: order.customer_wilaya || '',
      customer_commune: order.customer_commune || '',
      customer_address: order.customer_address || '',
      delivery_type: order.delivery_type || 'home',
      carrier_id: order.carrier_id || '',
      delivery_fee: order.delivery_fee || 0,
      notes: order.notes || '',
    internal_notes: order.internal_notes || '',
      items: order.items ? order.items.map(item => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        sku: item.sku,
        quantity: item.quantity,
        unit_price: item.unit_price,
        variant_details: item.variant_details,
        image_url: item.image_url
      })) : [] as any[]
    });
    
    let initialBureau = '';
    if (order.delivery_type === 'stop_desk' || order.delivery_type === 'OFFICE') {
      const yalMatch = order.customer_address?.match(/Bureau Yalidine \(ID:\s*(\d+)\)/i);
      if (yalMatch) {
        initialBureau = yalMatch[1];
      } else {
        initialBureau = NOEST_BUREAUX.find(b => order.customer_address?.includes(b.code))?.code || '';
      }
    }
    setSelectedBureauCode(initialBureau);
    
    setIsEditing(initialEdit || false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, initialEdit]);

  // Auto-fetch delivery fee ONLY when carrier or wilaya changes (not on every render)
  // Uses refs to track previous values so we don't overwrite manual fee entries
  const prevCarrierId = useRef(editData.carrier_id);
  const prevWilaya = useRef(editData.customer_wilaya);
  const prevDeliveryType = useRef(editData.delivery_type);
  useEffect(() => {
    const carrierChanged = prevCarrierId.current !== editData.carrier_id;
    const wilayaChanged = prevWilaya.current !== editData.customer_wilaya;
    const typeChanged = prevDeliveryType.current !== editData.delivery_type;
    prevCarrierId.current = editData.carrier_id;
    prevWilaya.current = editData.customer_wilaya;
    prevDeliveryType.current = editData.delivery_type;

    if (!isEditing || !editData.carrier_id || !editData.customer_wilaya) return;
    if (!carrierChanged && !wilayaChanged && !typeChanged) return; // skip if nothing changed
    const fetchFee = async () => {
      try {
        const pId = order.items?.[0]?.product_id || '';
        const res = await apiFetch<any>(
          `/api/v1/delivery-partners/calculate?partnerId=${editData.carrier_id}&wilayaId=${editData.customer_wilaya}&type=${editData.delivery_type}&productIds=${pId}`,
          { headers: { 'X-Store-Id': order.store_id } }
        );
        if (res?.success && typeof res?.data?.fee === 'number') {
          setEditData(prev => ({ ...prev, delivery_fee: res.data.fee }));
        }
      } catch (error) {
        console.error('Error fetching shipping fee:', error);
      }
    };
    fetchFee();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, editData.carrier_id, editData.customer_wilaya, editData.delivery_type]);

  const [confirmingReactivate, setConfirmingReactivate] = useState(false);

  const unmergeMutation = useMutation({
    mutationFn: async () => apiFetch(`/api/v1/orders/${order.id}/unmerge`, { method: 'POST', headers: { 'X-Store-Id': order.store_id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-orders'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order-events', order.id] });
      toast.success('Commande réactivée — c\'est maintenant la tentative active du client.');
      setConfirmingReactivate(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || "Échec de la réactivation de la commande.");
      setConfirmingReactivate(false);
    },
  });

  // Retroactive upsell correction (2026-07-22, Selma-requested): a
  // confirmatrice sometimes forgets to flag an on-call upsell at the
  // time, and the commission bonus is computed from the CURRENT
  // is_upsell flag on DELIVERED orders — she needs to fix it after the
  // fact so it counts. Deliberately separate from updateMutation/the
  // full edit form: this is the ONLY field a DELIVERED order still
  // accepts (backend enforces this too — see PATCH /orders/{id}/info),
  // no stock/carrier/customer side-effect, purely local metadata.
  const toggleUpsellMutation = useMutation({
    mutationFn: async (nextValue: boolean) =>
      apiFetch(`/api/v1/orders/${order.id}/info`, {
        method: 'PATCH',
        body: JSON.stringify({ is_upsell: nextValue }),
        headers: { 'X-Store-Id': order.store_id },
      }),
    onSuccess: (_res, nextValue) => {
      queryClient.invalidateQueries({ queryKey: ['agent-orders'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['agent-perf'] });
      toast.success(nextValue ? 'Commande marquée Upsell' : 'Marquage Upsell retiré');
      if (onOrderUpdate) onOrderUpdate({ ...order, is_upsell: nextValue });
    },
    onError: (err: any) => toast.error(err.message || "Erreur lors de la mise à jour de l'upsell"),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof editData) => {
      console.log("[DEBUG FRONTEND] updateMutation mutationFn triggered with editData:", JSON.parse(JSON.stringify(data)));
      return await apiFetch(`/api/v1/orders/${order.id}/info`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'X-Store-Id': order.store_id },
      });
    },
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: ['agent-orders'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['agent-perf'] });
      queryClient.invalidateQueries({ queryKey: ['order-events', order.id] });
      setIsEditing(false);
      toast.success("Informations mises à jour");
      
      console.log("[DEBUG FRONTEND] updateMutation onSuccess triggered. Raw response:", response);
      // Use the server response data to update the order — only if it contains the full fields
      const serverData = response?.data;
      const isFullServerData = serverData && ('customer_name' in serverData || 'items' in serverData);

      if (isFullServerData && onOrderUpdate) {
        console.log("[DEBUG FRONTEND] Calling onOrderUpdate with serverData:", serverData);
        onOrderUpdate({
          ...order,
          customer_name: serverData.customer_name ?? order.customer_name,
          customer_phone: serverData.customer_phone ?? order.customer_phone,
          customer_wilaya: serverData.customer_wilaya ?? order.customer_wilaya,
          customer_commune: serverData.customer_commune ?? order.customer_commune,
          customer_address: serverData.customer_address ?? order.customer_address,
          delivery_type: serverData.delivery_type ?? order.delivery_type,
          carrier_id: serverData.carrier_id ?? order.carrier_id,
          delivery_fee: serverData.delivery_fee ?? order.delivery_fee,
          notes: serverData.notes ?? order.notes,
          internal_notes: serverData.internal_notes ?? order.internal_notes,
          items: serverData.items ?? order.items,
          total: serverData.total ?? order.total,
        });
      } else if (onOrderUpdate) {
        console.log("[DEBUG FRONTEND] Falling back to local editData to update order state");
        onOrderUpdate({
          ...order,
          customer_name: editData.customer_name,
          customer_phone: editData.customer_phone,
          customer_wilaya: editData.customer_wilaya,
          customer_commune: editData.customer_commune,
          customer_address: editData.customer_address,
          delivery_type: editData.delivery_type,
          carrier_id: editData.carrier_id || null,
          delivery_fee: editData.delivery_fee,
          notes: editData.notes,
          internal_notes: editData.internal_notes,
          items: editData.items.map((it: any) => ({ ...it })),
          total: editData.items.reduce((acc: number, item: any) => acc + item.quantity * item.unit_price, 0) + editData.delivery_fee
        });
      }
    },
    onError: (err: any) => toast.error(err.message || "Erreur lors de la modification")
  });

  return (
    <div className="fixed inset-0 z-[100] flex">
      <div className="flex-1 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="p-6 border-b flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Détails Commande</p>
            <h2 className="text-sm font-bold">{formatOrderRef(order, 'admin')}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-50 rounded-lg"><XCircle className="size-5 text-slate-300" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
               <OrderTypeBadge order={order} />
               <StatusBadge status={order.status} />
               <NrpBadge count={order.nrp_count || 0} />
               <PendingBadge order={order} />
               <OrderTimer startTime={order.confirmation_start_time} />
               {order.tracking_number && (
                 <div className="flex items-center gap-1.5 text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100 uppercase tracking-widest">
                   📦 SUIVI: {order.tracking_number}
                 </div>
               )}
               {order.nrp_count !== undefined && order.nrp_count > 0 && (
                 <div className="flex items-center gap-1.5 text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100 uppercase tracking-widest">
                   <Phone className="size-3" />
                   NRP {order.nrp_count}/{maxNrp}
                 </div>
               )}
            </div>
            {(order.status as string) !== 'DELIVERED' && (
              <div className="p-4 bg-emerald-50 border-2 border-emerald-500 rounded-2xl space-y-2 shadow-sm animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-950 font-black text-xs">
                    <Store className="size-4 text-emerald-600" />
                    <span>Vente Directe / Point de Vente (Magasin)</span>
                  </div>
                  <span className="text-[9px] bg-emerald-600 text-white px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">Retrait Magasin</span>
                </div>
                <p className="text-[11px] text-emerald-800 font-medium leading-tight">
                  Le client est au magasin ou a retiré sa commande ? Confirmez et marquez-la comme récupérée direct.
                </p>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => onStatusChange(order.id, 'DELIVERED', currentUser?.role === 'LIVREUR' ? undefined : currentUser?.id, undefined, 'STORE_PICKUP')}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer mt-1"
                >
                  <CheckCircle2 className="size-4" />
                  Confirmer Point de Vente
                </button>
              </div>
            )}
            {order.status === 'ABANDONED' && (
              <div className="p-3 bg-violet-50 border border-violet-100 rounded-xl text-[11px] text-violet-700 font-semibold leading-relaxed flex gap-2">
                <AlertCircle className="size-4 shrink-0 text-violet-500 mt-0.5" />
                <span>
                  Ce panier a été abandonné. Appelez le client immédiatement au numéro ci-dessous pour tenter de récupérer la commande !
                </span>
              </div>
            )}
            {order.status === 'MERGED' && (
              <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-[11px] text-purple-800 font-semibold leading-relaxed flex gap-2 items-start">
                <AlertCircle className="size-4 shrink-0 text-purple-500 mt-0.5" />
                <div className="flex-1">
                  <p>
                    Cette commande a été fusionnée dans une autre — elle n'est plus active et ne peut plus être
                    confirmée ni expédiée ici. Toute modification doit se faire sur la commande active ci-dessous.
                  </p>
                  {loadingParentOrder ? (
                    <p className="mt-2 text-purple-500">Recherche de la commande active…</p>
                  ) : parentOrder ? (
                    <div className="mt-2 flex flex-wrap gap-2 items-center">
                      <button
                        type="button"
                        onClick={() => onOrderUpdate && onOrderUpdate(parentOrder)}
                        className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-[10px] font-black uppercase tracking-wider hover:bg-purple-700 transition-colors"
                      >
                        → Ouvrir la commande active {parentOrder.order_number ? `(N°${parentOrder.order_number})` : ''}
                      </button>
                      {/* Cette commande fusionnée est en réalité la tentative la
                          plus RÉCENTE du client (créée après son parent actuel) —
                          la confirmatrice doit pouvoir la réactiver pour confirmer
                          la dernière tentative, pas la première. */}
                      {order.created_at && parentOrder.created_at && new Date(order.created_at) > new Date(parentOrder.created_at) && (
                        confirmingReactivate ? (
                          <div className="w-full mt-1 p-3 rounded-xl bg-white border border-purple-200 shadow-sm animate-in fade-in slide-in-from-top-1 duration-150">
                            <p className="text-[11px] text-purple-800 font-semibold leading-relaxed mb-2.5">
                              Cette commande est la tentative la plus récente du client. La rendre active à la place de son parent ?
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={unmergeMutation.isPending}
                                onClick={() => unmergeMutation.mutate()}
                                className="flex-1 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-[10px] font-black uppercase tracking-wider hover:bg-purple-700 transition-colors disabled:opacity-50"
                              >
                                {unmergeMutation.isPending ? 'Réactivation…' : 'Oui, réactiver'}
                              </button>
                              <button
                                type="button"
                                disabled={unmergeMutation.isPending}
                                onClick={() => setConfirmingReactivate(false)}
                                className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-wider hover:bg-slate-100 transition-colors disabled:opacity-50"
                              >
                                Annuler
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingReactivate(true)}
                            className="px-3 py-1.5 rounded-lg bg-white border border-purple-300 text-purple-700 text-[10px] font-black uppercase tracking-wider hover:bg-purple-100 transition-colors"
                          >
                            ↺ Rendre CETTE commande active (plus récente)
                          </button>
                        )
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 text-purple-500">Commande active introuvable (peut-être supprimée) — contactez un administrateur.</p>
                  )}
                </div>
              </div>
            )}
            {isEditing ? (
              <div className="p-4 bg-slate-50 rounded-lg border space-y-3">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500">Nom du client</label>
                  <input type="text" value={editData.customer_name} onChange={e => setEditData({...editData, customer_name: e.target.value})} className="w-full text-xs p-2 border rounded bg-white" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500">Téléphone</label>
                  <input type="text" value={editData.customer_phone} onChange={e => setEditData({...editData, customer_phone: e.target.value})} className="w-full text-xs p-2 border rounded bg-white" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500">Wilaya</label>
                    <select
                      value={editData.customer_wilaya}
                      onChange={e => setEditData({...editData, customer_wilaya: e.target.value})}
                      className="w-full text-xs p-2 border rounded bg-white font-bold"
                    >
                      <option value="">Sélectionnez une wilaya</option>
                      {WILAYAS.map(w => <option key={w} value={w}>{w}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500">Commune *</label>
                    {editData.delivery_type === 'stop_desk' ? (
                       <input type="text" readOnly value={editData.customer_commune} className="w-full text-xs p-2 border rounded bg-slate-50 text-slate-500 cursor-not-allowed" placeholder="Sélectionnez un bureau..." />
                    ) : (
                       <select 
                         value={editData.customer_commune} 
                         onChange={e => setEditData({...editData, customer_commune: e.target.value})} 
                         className="w-full text-xs p-2 border rounded bg-white"
                         disabled={!editData.customer_wilaya}
                         required
                       >
                         <option value="">Sélectionnez une commune</option>
                         {editData.customer_wilaya && ALGERIAN_COMMUNES[editData.customer_wilaya]?.map(c => (
                            <option key={c.id} value={c.nameAscii}>{c.nameAscii}</option>
                         ))}
                       </select>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500">Adresse détaillée</label>
                  <input type="text" value={editData.customer_address} onChange={e => setEditData({...editData, customer_address: e.target.value})} className="w-full text-xs p-2 border rounded bg-white" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500">Mode de Réception</label>
                  <select 
                    value={editData.delivery_type} 
                    onChange={e => {
                      const val = e.target.value;
                      setEditData(prev => ({ 
                        ...prev, 
                        delivery_type: val,
                        // Clear bureau if switching to home
                        ...(val === 'home' ? { customer_commune: '', customer_address: '' } : {})
                      }));
                      if (val === 'home') setSelectedBureauCode('');
                    }} 
                    className="w-full text-xs p-2 border rounded bg-white font-bold"
                  >
                    <option value="home">Livraison à Domicile</option>
                    <option value="stop_desk">Stop Desk (Bureau)</option>
                    <option value="STORE_PICKUP">🏪 Retrait Point de Vente / Magasin (Vente Directe)</option>
                  </select>
                  {editData.delivery_type === 'STORE_PICKUP' && order.status !== 'DELIVERED' && (
                    <div className="mt-2 p-3 bg-emerald-50 border border-emerald-300 rounded-xl space-y-1.5">
                      <p className="text-[10px] font-black text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
                        <Store className="size-3.5 text-emerald-600" />
                        Vente Directe en Magasin
                      </p>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => onStatusChange(order.id, 'DELIVERED', currentUser?.role === 'LIVREUR' ? undefined : currentUser?.id)}
                        className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <CheckCircle2 className="size-4" />
                        Confirmer & Récupéré (Point de Vente)
                      </button>
                    </div>
                  )}
                </div>
                {editData.delivery_type === 'stop_desk' && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500">Bureau (Stop Desk) *</label>
                    <select 
                      value={selectedBureauCode} 
                      onChange={e => {
                        const code = e.target.value;
                        setSelectedBureauCode(code);
                        
                        const selectedPartner = deliveryPartnersQuery.data?.data?.find((p: any) => p.id === editData.carrier_id);
                        const partnerCode = selectedPartner?.code || (/^\d+$/.test(code) ? 'yalidine' : 'noest');
                        
                        if (partnerCode === 'yalidine') {
                          const bureau = yalidineCenters.find(c => String(c.center_id || c.id) === code);
                          if (bureau) {
                            setEditData(prev => ({
                              ...prev,
                              customer_address: `Bureau Yalidine (ID: ${bureau.center_id || bureau.id}) - ${bureau.name} (${bureau.address})`,
                              customer_commune: bureau.name,
                            }));
                          }
                        } else {
                          const bureau = NOEST_BUREAUX.find(b => b.code === code);
                          if (bureau) {
                            const match = bureau.name.match(/«\s*([^»]+?)\s*»/);
                            setEditData(prev => ({
                              ...prev,
                              customer_address: `Bureau Noest ${bureau.code} - ${bureau.name} (${bureau.address})`,
                              customer_commune: match ? match[1].trim() : bureau.name.trim(),
                            }));
                          }
                        }
                      }} 
                      className="w-full text-xs p-2 border rounded bg-white font-semibold"
                      required
                    >
                      <option value="">Sélectionnez un bureau de la wilaya</option>
                      {(() => {
                        const selectedPartner = deliveryPartnersQuery.data?.data?.find((p: any) => p.id === editData.carrier_id);
                        const partnerCode = selectedPartner?.code || (/^\d+$/.test(selectedBureauCode) ? 'yalidine' : 'noest');
                        
                        if (partnerCode === 'yalidine') {
                          const centers = yalidineCenters.filter(c => (c.wilaya_name || '').toLowerCase().trim() === (editData.customer_wilaya || '').toLowerCase().trim());
                          return centers.map(c => (
                            <option key={c.center_id || c.id} value={String(c.center_id || c.id)}>
                              {c.name} ({c.address})
                            </option>
                          ));
                        } else {
                          return filteredBureaux.map(b => (
                            <option key={b.code} value={b.code}>
                              {b.code} - {b.name} ({b.address})
                            </option>
                          ));
                        }
                      })()}
                    </select>
                  </div>
                )}
                {/* Transporteur/frais de livraison : un livreur ne les modifie
                    jamais (backend renvoie 403 sur ces 2 champs pour son
                    rôle) — les masquer plutôt que de laisser un save échouer. */}
                {currentUser?.role !== 'LIVREUR' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500">Entreprise de Livraison</label>
                  <select
                    value={editData.carrier_id}
                    onChange={e => setEditData({...editData, carrier_id: e.target.value})}
                    className="w-full text-xs p-2 border rounded bg-white font-bold"
                  >
                    <option value="">Sélectionnez un transporteur</option>
                    {deliveryPartnersQuery.data?.data?.map((partner: any) => (
                      <option key={partner.id} value={partner.id}>
                        {partner.name} ({partner.carrier_id.toUpperCase()})
                      </option>
                    ))}
                  </select>
                </div>
                )}
                {currentUser?.role !== 'LIVREUR' && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500">Frais de livraison (DA)</label>
                  <input
                    type="number"
                    value={editData.delivery_fee}
                    onChange={e => setEditData({...editData, delivery_fee: parseInt(e.target.value) || 0})}
                    className="w-full text-xs p-2 border rounded bg-white font-bold font-mono"
                  />
                </div>
                )}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500">Remarque (transmise à Noest lors de l'expédition)</label>
                  <textarea
                    value={editData.notes}
                    onChange={e => setEditData({...editData, notes: e.target.value})}
                    className="w-full text-xs p-2 border rounded bg-white min-h-[60px]"
                    placeholder="Saisir une remarque pour cette commande..."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-amber-700">🔒 Notes internes (jamais envoyées au transporteur)</label>
                  <textarea
                    value={editData.internal_notes}
                    onChange={e => setEditData({...editData, internal_notes: e.target.value})}
                    className="w-full text-xs p-2 border border-amber-200 bg-amber-50/40 rounded min-h-[60px]"
                    placeholder="Ex: client difficile, rappeler après 18h — usage équipe uniquement"
                  />
                </div>

                {/* Items & Quantities & Varieties Editor */}
                <div className="space-y-3 pt-3 border-t">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-black uppercase text-slate-400 tracking-wider">Articles & Quantités</label>
                    <button
                      type="button"
                      onClick={() => {
                        const firstItem = order.items?.[0];
                        const newItem = {
                          id: 'new-' + Date.now(),
                          product_id: productQuery.data?.id || firstItem?.product_id,
                          product_name: productQuery.data?.name || firstItem?.product_name,
                          sku: productQuery.data?.sku || firstItem?.sku || '',
                          quantity: 1,
                          unit_price: (firstItem?.unit_price && firstItem.unit_price > 0) ? firstItem.unit_price : (productQuery.data?.price || 0),
                          variant_details: {},
                          image_url: productQuery.data?.main_image || firstItem?.image_url || ''
                        };
                        setEditData({ ...editData, items: [...editData.items, newItem] });
                      }}
                      className="text-xs text-indigo-600 font-bold hover:underline flex items-center gap-1"
                    >
                      <Plus className="size-3" /> Ajouter une variante
                    </button>
                  </div>

                  {/* Upsell: add a different existing product to this order */}
                  <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-2.5 shadow-sm">
                    <div className="flex items-center gap-2">
                      <select
                        value={upsellProductId}
                        onChange={(e) => {
                          setUpsellProductId(e.target.value);
                          setSelectedUpsellColor('');
                          setSelectedUpsellSize('');
                        }}
                        className="flex-1 text-xs p-1.5 h-9 border rounded-lg bg-white font-bold text-slate-700 shadow-sm"
                      >
                        <option value="">🎁 Ajouter un produit existant (Upsell)...</option>
                        {upsellCandidates.map((p: any) => (
                          <option key={p.id} value={p.id}>{p.name} — {formatPrice(p.price)}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={
                          Boolean(!upsellProductId ||
                          (upsellColorVariants.length > 0 && !selectedUpsellColor) ||
                          (selectedUpsellColor && upsellSizeVariants.length > 0 && !selectedUpsellSize))
                        }
                        onClick={() => {
                          if (!selectedUpsellProduct) return;
                          const variantDetails: Record<string, string> = {};
                          if (selectedUpsellColor) {
                            variantDetails['Couleur'] = selectedUpsellColor;
                            variantDetails['Color'] = selectedUpsellColor;
                          }
                          if (selectedUpsellSize) {
                            variantDetails['Taille'] = selectedUpsellSize;
                            variantDetails['Size'] = selectedUpsellSize;
                          }
                          if (selectedUpsellColor || selectedUpsellSize) {
                            variantDetails['variant'] = [selectedUpsellColor, selectedUpsellSize].filter(Boolean).join(' / ');
                          }

                          const priceMod = selectedUpsellSize
                            ? (upsellSizeVariants.find((sv: any) => sv.value === selectedUpsellSize)?.priceModifier ?? 0)
                            : (selectedUpsellColorVar?.priceModifier ?? 0);

                          const itemSku = selectedUpsellSize
                            ? (upsellSizeVariants.find((sv: any) => sv.value === selectedUpsellSize)?.sku || selectedUpsellColorVar?.sku || selectedUpsellProduct.sku)
                            : (selectedUpsellColorVar?.sku || selectedUpsellProduct.sku);

                          const newItem = {
                            id: 'new-' + Date.now(),
                            product_id: selectedUpsellProduct.id,
                            product_name: selectedUpsellProduct.name,
                            sku: itemSku || '',
                            quantity: 1,
                            unit_price: (selectedUpsellProduct.price ?? 0) + priceMod,
                            variant_details: variantDetails,
                            image_url: selectedUpsellColorVar?.image || selectedUpsellProduct.main_image || ''
                          };

                          setEditData({ ...editData, items: [...editData.items, newItem] });
                          setUpsellProductId('');
                          setSelectedUpsellColor('');
                          setSelectedUpsellSize('');
                        }}
                        className="h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-40 shrink-0 shadow-sm cursor-pointer"
                      >
                        + Ajouter Upsell
                      </button>
                    </div>

                    {/* Variant selectors for selected upsell product */}
                    {selectedUpsellProduct && upsellColorVariants.length > 0 && (
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-emerald-200/60">
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] font-black text-emerald-800 uppercase tracking-wider">Couleur / Modèle *</span>
                          <select
                            value={selectedUpsellColor}
                            onChange={(e) => {
                              setSelectedUpsellColor(e.target.value);
                              setSelectedUpsellSize('');
                            }}
                            className="w-full text-xs p-1.5 h-8 border rounded-lg bg-white font-bold text-slate-800"
                          >
                            <option value="">-- Choisir Couleur --</option>
                            {upsellColorVariants.map((v: any, i: number) => (
                              <option key={i} value={v.value}>{v.value}</option>
                            ))}
                          </select>
                        </div>

                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] font-black text-emerald-800 uppercase tracking-wider">Taille / Option</span>
                          <select
                            value={selectedUpsellSize}
                            disabled={!selectedUpsellColor || upsellSizeVariants.length === 0}
                            onChange={(e) => setSelectedUpsellSize(e.target.value)}
                            className="w-full text-xs p-1.5 h-8 border rounded-lg bg-white font-bold text-slate-800 disabled:opacity-50"
                          >
                            <option value="">{upsellSizeVariants.length > 0 ? "-- Choisir Taille --" : "-- Aucune sub-variante --"}</option>
                            {upsellSizeVariants.map((sv: any, i: number) => (
                              <option key={i} value={sv.value}>{sv.value}</option>
                            ))}
                          </select>
                        </div>

                        {upsellVariantAvailable !== null && (
                          <div className="col-span-2 flex items-center justify-between text-[10px] font-bold px-1 pt-1">
                            <span className={upsellVariantAvailable > 0 ? "text-emerald-700" : "text-rose-600 font-black"}>
                              {upsellVariantAvailable > 0 ? `✓ Stock disponible : ${upsellVariantAvailable}` : `⚠️ Variante épuisée (0 en stock)`}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2.5">
                    {editData.items.map((item: any, idx: number) => {
                      // Each item's OWN product — a shared single query keyed to
                      // items[0] used to make every row (2nd, 3rd, ...) show the
                      // first item's colors/sizes/stock instead of its own.
                      const itemProduct = productById[item.product_id];
                      const hasVariants = itemProduct?.variants && itemProduct.variants.length > 0;

                      // Resolve current selections
                      const selectedColorVal = item.variant_details?.Couleur || item.variant_details?.Color || '';
                      const selectedSizeVal = item.variant_details?.Taille || item.variant_details?.Size || '';

                      // Filter options
                      const colorVariants = itemProduct?.variants || [];
                      const selectedColorVar = colorVariants.find((v: any) => v.value === selectedColorVal);
                      const sizeVariants = selectedColorVar?.sub_variants || [];

                      // Live per-variant availability, mirroring the backend's own
                      // reserve/confirm check (v_stock - v_reserved on the matched
                      // sub_variant/variant) — the dropdowns above previously gave
                      // no stock feedback at all, so a confirmatrice could pick a
                      // combo that's actually out of stock and only find out after
                      // the save was rejected with "Stock insuffisant".
                      const matchedSubVariant = selectedSizeVal ? sizeVariants.find((sv: any) => sv.value === selectedSizeVal) : null;
                      const effectiveVariant = matchedSubVariant || (selectedColorVar && sizeVariants.length === 0 ? selectedColorVar : null);
                      const variantAvailable = effectiveVariant
                        ? Number(effectiveVariant.stock || 0) - Number(effectiveVariant.reserved || 0)
                        : (!hasVariants ? Number(itemProduct?.stock || 0) - Number(itemProduct?.reserved_stock || 0) : null);

                      return (
                        <div key={idx} className="p-3 bg-white border rounded-xl space-y-2.5 shadow-sm">
                          <div className="flex justify-between items-start">
                            <span className="text-xs font-bold text-slate-800 line-clamp-1">{item.product_name}</span>
                            {editData.items.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const newItems = editData.items.filter((_: any, i: number) => i !== idx);
                                  setEditData({ ...editData, items: newItems });
                                }}
                                className="text-[10px] font-bold text-rose-600 hover:underline shrink-0"
                              >
                                Retirer
                              </button>
                            )}
                          </div>
                          
                          <div className="grid grid-cols-1 gap-2">
                            {hasVariants ? (
                              <div className="grid grid-cols-2 gap-2">
                                {/* Color Dropdown */}
                                <div className="flex flex-col gap-1">
                                  <span className="text-[9px] font-bold text-slate-400 uppercase">Couleur / Modèle</span>
                                  <select
                                    value={selectedColorVal}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      const matchedVar = colorVariants.find((v: any) => v.value === val);
                                      const newItems = [...editData.items];
                                      
                                      const updatedDetails = {
                                        ...newItems[idx].variant_details,
                                        Couleur: val,
                                        variant: val
                                      };
                                      
                                      if (matchedVar?.sub_variants && matchedVar.sub_variants.length > 0) {
                                        const firstSize = matchedVar.sub_variants[0].value;
                                        updatedDetails.Taille = firstSize;
                                        updatedDetails.variant = `${val} / ${firstSize}`;
                                        newItems[idx].sku = matchedVar.sub_variants[0].sku || matchedVar.sku || itemProduct?.sku;
                                      } else {
                                        delete updatedDetails.Taille;
                                        newItems[idx].sku = matchedVar?.sku || itemProduct?.sku;
                                      }
                                      
                                      newItems[idx].variant_details = updatedDetails;
                                      if (matchedVar?.image) {
                                        newItems[idx].image_url = matchedVar.image;
                                      }
                                      
                                      setEditData({ ...editData, items: newItems });
                                    }}
                                    className="w-full text-xs p-1.5 h-8 border rounded bg-slate-50 font-bold"
                                  >
                                    <option value="">Choisir</option>
                                    {colorVariants.map((v: any, i: number) => (
                                      <option key={i} value={v.value}>{v.value}</option>
                                    ))}
                                  </select>
                                </div>

                                {/* Size Dropdown */}
                                <div className="flex flex-col gap-1">
                                  <span className="text-[9px] font-bold text-slate-400 uppercase">Taille / Option</span>
                                  <select
                                    value={selectedSizeVal}
                                    disabled={!selectedColorVal || sizeVariants.length === 0}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      const matchedSubVar = sizeVariants.find((sv: any) => sv.value === val);
                                      const newItems = [...editData.items];
                                      
                                      const updatedDetails = {
                                        ...newItems[idx].variant_details,
                                        Taille: val,
                                        variant: `${selectedColorVal} / ${val}`
                                      };
                                      
                                      newItems[idx].variant_details = updatedDetails;
                                      if (matchedSubVar?.sku) {
                                        newItems[idx].sku = matchedSubVar.sku;
                                      }
                                      
                                      setEditData({ ...editData, items: newItems });
                                    }}
                                    className="w-full text-xs p-1.5 h-8 border rounded bg-slate-50 font-bold disabled:opacity-50"
                                  >
                                    <option value="">Choisir</option>
                                    {sizeVariants.map((sv: any, i: number) => (
                                      <option key={i} value={sv.value}>{sv.value}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            ) : (
                              <div className="text-[10px] text-slate-400 font-medium italic">Ce produit n'a pas de variantes configurées.</div>
                            )}

                            {variantAvailable !== null && (
                              <div className={cn(
                                "text-[10px] font-black uppercase tracking-wide px-2 py-1 rounded-lg inline-flex items-center gap-1 w-fit",
                                variantAvailable >= item.quantity ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                              )}>
                                {variantAvailable <= 0
                                  ? "Rupture de stock — indisponible"
                                  : variantAvailable < item.quantity
                                    ? `Seulement ${variantAvailable} en stock (quantité demandée: ${item.quantity})`
                                    : `${variantAvailable} en stock`}
                              </div>
                            )}
                            {hasVariants && variantAvailable === null && (
                              <div className="text-[10px] font-bold text-amber-600 italic">Choisissez la variante pour voir le stock disponible</div>
                            )}

                            <div className="grid grid-cols-2 gap-2">
                              {/* Quantity Modifier */}
                              <div className="flex flex-col gap-1">
                                <span className="text-[9px] font-bold text-slate-400 uppercase">Quantité</span>
                                <div className="flex items-center border rounded-lg overflow-hidden h-8 bg-slate-50">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newItems = [...editData.items];
                                      if (newItems[idx].quantity > 1) {
                                        newItems[idx].quantity -= 1;
                                        setEditData({ ...editData, items: newItems });
                                      }
                                    }}
                                    className="w-7 h-full flex items-center justify-center font-bold text-slate-500 hover:bg-slate-100 active:bg-slate-200"
                                  >
                                    -
                                  </button>
                                  <span className="flex-1 text-center text-xs font-bold font-mono">{item.quantity}</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newItems = [...editData.items];
                                      newItems[idx].quantity += 1;
                                      setEditData({ ...editData, items: newItems });
                                    }}
                                    className="w-7 h-full flex items-center justify-center font-bold text-slate-500 hover:bg-slate-100 active:bg-slate-200"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>

                              {/* Price Input */}
                              <div className="flex flex-col gap-1">
                                <span className="text-[9px] font-bold text-slate-400 uppercase">Prix unitaire (DA)</span>
                                <input
                                  type="number"
                                  value={item.unit_price}
                                  onChange={(e) => {
                                    const newItems = [...editData.items];
                                    newItems[idx].unit_price = parseInt(e.target.value) || 0;
                                    setEditData({ ...editData, items: newItems });
                                  }}
                                  className="w-full text-xs p-1.5 h-8 border rounded bg-slate-50 font-bold font-mono text-right"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between items-center bg-slate-100 p-2.5 rounded-lg text-xs font-bold">
                    <span>Nouveau Total :</span>
                    <span className="font-mono text-slate-900">
                      {formatPrice(editData.items.reduce((acc: number, item: any) => acc + (item.quantity * item.unit_price), 0))} DA
                    </span>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={async () => {
                      // Re-check against the freshest possible stock right before
                      // saving, instead of trusting the badge above (which can still
                      // be a few seconds stale). This is what used to let a
                      // confirmatrice see "3 en stock", save, and only then get
                      // rejected with "Stock insuffisant" — the badge showed a
                      // snapshot from when the drawer opened while another order
                      // consumed the same units in the meantime.
                      setIsCheckingStock(true);
                      try {
                        // Refetch EVERY distinct product in the order, not just
                        // the first item — checking only items[0]'s product used
                        // to silently skip validation for any 2nd/3rd item,
                        // letting a bad save through the pre-check only to be
                        // rejected by the backend with no clear on-screen reason.
                        const freshResults = await Promise.all(productQueriesResult.map(q => q.refetch()));
                        const freshById: Record<string, any> = Object.fromEntries(
                          editProductIds.map((pid: string, idx: number) => [pid, freshResults[idx]?.data])
                        );
                        for (const it of editData.items) {
                          const freshProduct = freshById[it.product_id];
                          if (!freshProduct) continue;
                          const variantStr = it.variant_details?.variant;
                          let available: number | null = null;
                          if (variantStr && freshProduct.variants?.length) {
                            const colorVal = it.variant_details?.Couleur || it.variant_details?.Color || '';
                            const sizeVal = it.variant_details?.Taille || it.variant_details?.Size || '';
                            const colorVar = freshProduct.variants.find((v: any) => v.value === colorVal);
                            const subVar = sizeVal ? colorVar?.sub_variants?.find((sv: any) => sv.value === sizeVal) : null;
                            const effective = subVar || (colorVar && (!colorVar.sub_variants || colorVar.sub_variants.length === 0) ? colorVar : null);
                            if (effective) {
                              available = Number(effective.stock || 0) - Number(effective.reserved || 0);
                            }
                          } else if (!freshProduct.variants?.length) {
                            available = Number(freshProduct.stock || 0) - Number(freshProduct.reserved_stock || 0);
                          }
                          if (available !== null && available < it.quantity) {
                            toast.error(
                              `Stock insuffisant pour ${it.product_name}${variantStr ? ` (${variantStr})` : ''} : ${available} disponible(s), ${it.quantity} demandé(s). Le stock vient d'être mis à jour, ajustez la quantité ou choisissez une autre variante.`
                            );
                            return;
                          }
                        }
                      } finally {
                        setIsCheckingStock(false);
                      }

                      // A genuinely new product (not present when the drawer
                      // opened) means this save is an upsell — flag it so it
                      // shows the "Upsell" badge and counts in performance.
                      const addedNewProduct = editData.items.some((it: any) => !originalProductIds.has(it.product_id));
                      updateMutation.mutate(addedNewProduct ? { ...editData, is_upsell: true } as any : editData);
                    }}
                    disabled={updateMutation.isPending || isCheckingStock}
                    className="flex-1 bg-blue-600 text-white text-xs font-bold py-2 rounded disabled:opacity-60"
                  >
                    {isCheckingStock ? 'Vérification du stock...' : updateMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                  <button onClick={() => setIsEditing(false)} className="px-4 bg-slate-200 text-slate-700 text-xs font-bold rounded">
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-slate-50 rounded-lg border space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <User className="size-4 text-slate-400" />
                    <span className="text-xs font-bold">{order.customer_name}</span>
                    {(order.is_duplicate || isDuplicatePhone?.(order.customer_phone) || (order.duplicate_count ?? 0) > 0) && (
                      <>
                        <DuplicatePopover
                          order={order}
                          onOpenFullModal={() => setShowDuplicateModal(true)}
                        />
                        <DuplicateHistoryModal
                          isOpen={showDuplicateModal}
                          onClose={() => setShowDuplicateModal(false)}
                          order={order}
                        />
                      </>
                    )}
                  </div>
                  {order.status !== 'MERGED' && (
                    <button onClick={() => setIsEditing(true)} className="text-xs text-blue-600 hover:underline">Modifier</button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="size-4 text-slate-400" />
                  <a href={`tel:${order.customer_phone}`} className="text-xs font-bold text-blue-600 underline">{order.customer_phone}</a>
                  {order.customer_phone2 && (
                    <a href={`tel:${order.customer_phone2}`} className="text-xs font-bold text-blue-500 underline">
                      / {order.customer_phone2}
                    </a>
                  )}
                  {order.customer_tier && (
                    <span className="px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider rounded border border-violet-200 bg-violet-50 text-violet-700">
                      {order.customer_tier}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <MapPin className="size-4 text-slate-400" />
                  <span className="text-xs text-slate-500">{order.customer_address} · {order.customer_commune} · {order.customer_wilaya}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Truck className="size-4 text-slate-400" />
                  <span className="text-xs text-slate-500 font-bold">
                    {order.delivery_type === 'STORE_PICKUP' ? 'Retrait Point de Vente (Magasin)' : order.delivery_type === 'stop_desk' ? 'Stop Desk' : 'À domicile'}
                    {order.carrier?.name ? ` · ${order.carrier.name}` : (order.carrier_id ? ` · Transporteur (ID: ${order.carrier_id})` : ' · Pas de transporteur')}
                    {order.delivery_fee !== undefined ? ` · ${formatPrice(order.delivery_fee)} DA` : ''}
                  </span>
                </div>
                {order.notes && (
                  <div className="flex items-start gap-3 bg-amber-50 p-2.5 rounded-lg border border-amber-100/50 mt-1">
                    <FileText className="size-4 text-amber-500 mt-0.5 shrink-0" />
                    <div className="text-xs text-amber-900 leading-relaxed font-semibold">
                      <span className="text-[10px] text-amber-500 uppercase tracking-wider font-bold block mb-0.5">Note de la commande</span>
                      {order.notes}
                    </div>
                  </div>
                )}
                {!!order.duplicate_count && order.duplicate_count > 0 && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-2.5 mt-1 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-wider text-purple-700">
                      🟣 {order.duplicate_count} resoumission{order.duplicate_count > 1 ? 's' : ''} du même client fusionnée{order.duplicate_count > 1 ? 's' : ''} ici
                      {order.last_duplicate_at && ` · dernière le ${new Date(order.last_duplicate_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${new Date(order.last_duplicate_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`}
                    </p>
                    {loadingDuplicateDetails ? (
                      <p className="text-[10px] text-purple-500 font-bold">Chargement…</p>
                    ) : (
                      (duplicateDetails ?? []).map((child: any) => (
                        <div key={child.id} className="text-[10px] text-purple-800 font-semibold flex items-center justify-between gap-2">
                          <span>{child.order_number}</span>
                          <span className="text-purple-500">{child.created_at ? new Date(child.created_at).toLocaleString('fr-DZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {/* Micro-détails commande */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Reçue le</p>
                    <p className="text-[11px] font-bold text-slate-600">
                      {order.created_at ? new Date(order.created_at).toLocaleString('fr-DZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </p>
                    {order.created_at && (() => {
                      const mins = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000);
                      const label = mins < 60 ? `il y a ${mins} min` : mins < 1440 ? `il y a ${Math.floor(mins / 60)}h` : `il y a ${Math.floor(mins / 1440)}j`;
                      return <p className={cn("text-[9px] font-bold", mins > 1440 ? "text-rose-500" : mins > 240 ? "text-amber-500" : "text-emerald-500")}>{label}</p>;
                    })()}
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Source</p>
                    <p className="text-[11px] font-bold text-slate-600">{order.source || 'Direct'}</p>
                    <div className="flex gap-1 mt-0.5 items-center flex-wrap">
                      {order.status === 'DELIVERED' ? (
                        <button
                          type="button"
                          disabled={toggleUpsellMutation.isPending}
                          onClick={() => toggleUpsellMutation.mutate(!order.is_upsell)}
                          title="Corrige le marquage Upsell de cette commande livrée — la commission upsell (voir Mon Salaire) est calculée sur ce flag, aucune autre donnée n'est modifiée."
                          className={cn(
                            "text-[8px] font-black px-1.5 py-0.5 rounded border uppercase transition-colors disabled:opacity-50",
                            order.is_upsell
                              ? "bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100"
                              : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"
                          )}
                        >
                          {order.is_upsell ? '✓ Upsell' : '+ Marquer Upsell'}
                        </button>
                      ) : (
                        order.is_upsell && <span className="text-[8px] font-black px-1 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100 uppercase">Upsell</span>
                      )}
                      {(order as any).is_marketplace_upsell && <span className="text-[8px] font-black px-1 py-0.5 rounded bg-pink-50 text-pink-600 border border-pink-100 uppercase">Marketplace</span>}
                      {order.is_pack && <span className="text-[8px] font-black px-1 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100 uppercase">Pack</span>}
                      {order.is_abandoned_cart && (
                        ['CONFIRMED', 'SHIPPED', 'DELIVERED'].includes(order.status)
                          ? <span className="text-[8px] font-black px-1 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100 uppercase">🟩 Panier récupéré</span>
                          : <span className="text-[8px] font-black px-1 py-0.5 rounded bg-violet-50 text-violet-600 border border-violet-100 uppercase">🟪 Panier abandonné</span>
                      )}
                    </div>
                  </div>
                  {order.promo_code && (
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Code Promo</p>
                      <p className="text-[11px] font-bold text-emerald-600">{order.promo_code} (−{formatPrice(order.discount || 0)})</p>
                    </div>
                  )}
                  {order.next_callback_time && (
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Rappel programmé</p>
                      <p className="text-[11px] font-bold text-blue-600">
                        {new Date(order.next_callback_time).toLocaleString('fr-DZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-2">Contenu</p>
             <div className="divide-y border rounded-lg overflow-hidden">
               {order.items?.map((item, i) => (
                 <div key={i} className="flex items-center justify-between p-3 text-xs">
                   <div>
                     <p className="font-bold">{item.product_name}</p>
                     {item.variant_details && (
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Option : {
                            typeof item.variant_details === 'string'
                              ? item.variant_details
                              : Object.entries(item.variant_details)
                                  .filter(([key]) => key !== 'variant')
                                  .map(([key, val]) => `${key}: ${val}`)
                                  .join(', ') || item.variant_details.variant || 'Aucune'
                          }
                        </p>
                      )}
                     <p className="text-slate-400">Qté: {item.quantity}</p>
                   </div>
                   <span className="font-bold">{formatPrice(item.quantity * item.unit_price)}</span>
                 </div>
               ))}
               <div className="p-3 bg-slate-50 space-y-1.5 text-xs">
                 <div className="flex justify-between text-slate-500">
                   <span>Sous-total produits</span>
                   <span className="tabular-nums">{formatPrice(order.items?.reduce((acc, it) => acc + it.quantity * it.unit_price, 0) ?? (order.subtotal || 0))}</span>
                 </div>
                 {(order.discount || 0) > 0 && (
                   <div className="flex justify-between text-emerald-600">
                     <span>Remise{order.promo_code ? ` (${order.promo_code})` : ''}</span>
                     <span className="tabular-nums">−{formatPrice(order.discount)}</span>
                   </div>
                 )}
                 <div className="flex justify-between text-slate-500">
                   <span>Livraison ({order.delivery_type === 'stop_desk' ? 'Bureau' : 'Domicile'})</span>
                   <span className="tabular-nums">{formatPrice(order.delivery_fee || 0)}</span>
                 </div>
                 <div className="flex justify-between font-bold border-t border-slate-200 pt-1.5 text-sm">
                   <span>Total à encaisser</span>
                   <span className="tabular-nums">{formatPrice(order.total)} DA</span>
                 </div>
               </div>
             </div>
          </div>

          {/* ── Choix de la méthode de livraison (transporteur / livreur interne) ──
              Toujours visible (même Annulée/NRP/Abandonnée) : la confirmatrice doit
              pouvoir préparer ou corriger l'assignation à tout moment. Seules les
              commandes fusionnées (MERGED, gérées via leur parent) n'ont pas de
              livraison propre. Un livreur ne réassigne jamais une commande à un
              autre livreur ni ne crée de colis transporteur (backend le bloque
              déjà, 403) — cette section n'a pas de sens depuis sa propre vue. */}
          {order.status !== 'MERGED' && currentUser?.role !== 'LIVREUR' && (
            <>
              <UnprocessedCartReassign order={order} onStatusChange={onStatusChange} isPending={isPending} />
              <LivreurAssign order={order} onOrderUpdate={onOrderUpdate} onDispatch={onDispatch} onStatusChange={onStatusChange} isPending={isPending} currentUser={currentUser} />
            </>
          )}

          <div className="space-y-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-2">Actions</p>
            <div className={cn("grid grid-cols-1 gap-2", isPending && "opacity-50 pointer-events-none")}>
              {(order.status as string) !== 'DELIVERED' && (
                <button onClick={() => { onStatusChange(order.id, 'DELIVERED', currentUser?.role === 'LIVREUR' ? undefined : currentUser?.id, undefined, 'STORE_PICKUP'); }}
                        className="flex items-center justify-between p-3.5 border-2 border-emerald-500 bg-emerald-50 text-emerald-950 rounded-xl hover:bg-emerald-100 transition-all text-xs font-black shadow-sm mb-1 cursor-pointer">
                  <span className="flex items-center gap-2">
                    <Store className="size-4 text-emerald-600" />
                    Confirmer Point de Vente
                  </span>
                  <span className="text-[10px] bg-emerald-600 text-white px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">Vente Directe</span>
                </button>
              )}
              {order.status !== 'CONFIRMED' && order.status !== 'CANCELLED' && order.status !== 'RETURNED' && order.status !== 'DELIVERED' && order.status !== 'SHIPPED' && (
                <button onClick={() => { onStatusChange(order.id, undefined, currentUser?.role === 'LIVREUR' ? undefined : currentUser?.id, 'NRP'); }}
                        className="flex items-center justify-between p-3 border border-rose-200 bg-rose-50 text-rose-700 rounded-lg hover:bg-rose-100 transition-colors text-xs font-bold">
                  <span>Signaler Ne Répond Pas (NRP)</span>
                  <Phone className="size-4" />
                </button>
              )}
              {cfg.next?.map(ns => {
                const isShippedWithoutTracking = ns === 'SHIPPED' && !order.tracking_number && order.carrier_id;
                return (
                  <button key={ns} onClick={() => { 
                    if (isShippedWithoutTracking && onDispatch) {
                      onDispatch(order.id);
                    } else {
                      onStatusChange(order.id, ns, currentUser?.role === 'LIVREUR' ? undefined : currentUser?.id); 
                    }
                  }}
                          className="flex items-center justify-between p-3 border rounded-lg hover:bg-slate-50 transition-colors text-xs font-bold">
                    <span>Passer à : {STATUS_CFG[ns]?.label || ns}</span>
                    <ChevronRight className="size-4 text-slate-300" />
                  </button>
                );
              })}
            </div>
          </div>
          {/* Traçabilité / Historique des actions */}
          <div className="space-y-3 pt-4 border-t">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <Activity className="size-3.5" />
              Traçabilité / Historique
            </p>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
              <OrderTraceabilityPanel orderId={order.id} />
            </div>
          </div>
          {/* Rapport d'attribution marketing */}
          <div className="space-y-3 pt-4 border-t">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <Activity className="size-3.5" />
              Rapport d'Attribution Marketing
            </p>
            <OrderTrackingReport orderId={order.id} />
          </div>
        </div>

        {/* Sticky bottom action bar for saves on laptop / desktop views */}
        {isEditing && (
          <div className="sticky bottom-0 bg-white border-t border-slate-200 p-4 shadow-[0_-10px_30px_rgba(0,0,0,0.15)] z-40 flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={async () => {
                setIsCheckingStock(true);
                try {
                  const freshResults = await Promise.all(productQueriesResult.map(q => q.refetch()));
                  const freshById: Record<string, any> = Object.fromEntries(
                    editProductIds.map((pid: string, idx: number) => [pid, freshResults[idx]?.data])
                  );
                  for (const it of editData.items) {
                    const freshProduct = freshById[it.product_id];
                    if (!freshProduct) continue;
                    const variantStr = it.variant_details?.variant;
                    let available: number | null = null;
                    if (variantStr && freshProduct.variants?.length) {
                      const colorVal = it.variant_details?.Couleur || it.variant_details?.Color || '';
                      const sizeVal = it.variant_details?.Taille || it.variant_details?.Size || '';
                      const colorVar = freshProduct.variants.find((v: any) => v.value === colorVal);
                      const subVar = sizeVal ? colorVar?.sub_variants?.find((sv: any) => sv.value === sizeVal) : null;
                      const effective = subVar || (colorVar && (!colorVar.sub_variants || colorVar.sub_variants.length === 0) ? colorVar : null);
                      if (effective) {
                        available = Number(effective.stock || 0) - Number(effective.reserved || 0);
                      }
                    } else if (!freshProduct.variants?.length) {
                      available = Number(freshProduct.stock || 0) - Number(freshProduct.reserved_stock || 0);
                    }
                    if (available !== null && available < it.quantity) {
                      toast.error(
                        `Stock insuffisant pour ${it.product_name}${variantStr ? ` (${variantStr})` : ''} : ${available} disponible(s), ${it.quantity} demandé(s). Le stock vient d'être mis à jour, ajustez la quantité ou choisissez une autre variante.`
                      );
                      return;
                    }
                  }
                } finally {
                  setIsCheckingStock(false);
                }

                const addedNewProduct = editData.items.some((it: any) => !originalProductIds.has(it.product_id));
                updateMutation.mutate(addedNewProduct ? { ...editData, is_upsell: true } as any : editData);
              }}
              disabled={updateMutation.isPending || isCheckingStock}
              className="flex-1 h-12 bg-[#6C5CE7] hover:bg-[#5B4BC4] text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-lg shadow-purple-200 flex items-center justify-center gap-2 disabled:opacity-60 transition-all cursor-pointer"
            >
              {isCheckingStock ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Vérification stock...
                </>
              ) : updateMutation.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Enregistrement...
                </>
              ) : (
                <>
                  <Save className="size-4" />
                  Enregistrer les modifications
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="h-12 px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all"
            >
              Annuler
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SalaryView({ perf, user }: any) {
  const stats = perf?.stats ?? {};
  const paymentType = stats.payment_type ?? user?.payment_type ?? 'PER_DELIVERED_ORDER';
  const paymentAmount = stats.payment_amount ?? user?.payment_amount ?? 0;
  
  const confirmedCount = stats.confirmed_count ?? 0;
  const deliveredCount = stats.delivered_count ?? 0;
  const totalAssigned = stats.total_assigned ?? 0;
  const cancelledCount = stats.cancelled_count ?? 0;
  const upsellCount = stats.upsell_count ?? 0;
  const normalDeliveredCount = stats.normal_delivered_count ?? 0;
  const recoveredDeliveredCount = stats.recovered_delivered_count ?? 0;

  const recoveredCount = stats.recovered_count ?? 0;
  const lostCount = stats.lost_count ?? 0;
  const paymentRecovered = stats.payment_recovered_cart ?? user?.payment_recovered_cart ?? 0;
  const paymentLost = stats.payment_lost_cart ?? user?.payment_lost_cart ?? 0;
  const abandonedBonus = stats.abandoned_bonus ?? 0;
  const upsellDeliveredCount = stats.upsell_delivered_count ?? 0;
  const paymentUpsell = stats.payment_upsell ?? user?.payment_upsell ?? 0;
  const upsellBonus = stats.upsell_bonus ?? 0;
  
  const marketplaceDeliveredCount = stats.marketplace_delivered_count ?? 0;
  const marketplaceBonus = stats.marketplace_bonus ?? 0;
  const paymentMarketplace = 50; // Typically fixed, though we could read it if we send it in stats

  const storePickupCount = stats.store_pickup_delivered_count ?? 0;
  const recoveredStorePickupCount = stats.recovered_store_pickup_delivered_count ?? 0;
  const paymentStorePickup = stats.payment_store_pickup ?? user?.payment_store_pickup ?? 100;
  const paymentRecoveredStorePickup = stats.payment_recovered_store_pickup ?? user?.payment_recovered_store_pickup ?? 150;
  
  const totalSalary = stats.salary ?? 0;

  // Calculate base salary amount for display (using stats.base_salary or normalDeliveredCount)
  const baseSalaryVal = stats.base_salary !== undefined 
    ? stats.base_salary 
    : (paymentType === 'MONTHLY_SALARY' ? paymentAmount : normalDeliveredCount * paymentAmount);

  let baseSalaryExplain = '';
  if (paymentType === 'MONTHLY_SALARY') {
    baseSalaryExplain = `Salaire mensuel fixe`;
  } else {
    baseSalaryExplain = `${normalDeliveredCount} livraisons normales × ${formatPrice(paymentAmount)}`;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
       {/* High Level Stats Grid */}
       <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Confirmations', val: confirmedCount, color: 'text-emerald-600', bg: 'bg-emerald-50/50' },
            { label: 'Livraisons', val: deliveredCount, color: 'text-blue-600', bg: 'bg-blue-50/50' },
            { label: 'Retrait Magasin', val: storePickupCount + recoveredStorePickupCount, color: 'text-indigo-600', bg: 'bg-indigo-50/50' },
            { label: 'Paniers Récupérés', val: recoveredCount, color: 'text-violet-600', bg: 'bg-violet-50/50' },
            { label: 'Total Assigné', val: totalAssigned, color: 'text-slate-900', bg: 'bg-slate-100/50' },
            { label: 'Annulées', val: cancelledCount, color: 'text-slate-500', bg: 'bg-slate-100/50' },
            { label: 'Retours', val: lostCount, color: 'text-rose-600', bg: 'bg-rose-50/50' },
            { label: 'Upsell', val: upsellCount, color: 'text-amber-600', bg: 'bg-amber-50/50' },
            { label: 'Livrées (Normales)', val: normalDeliveredCount, color: 'text-cyan-600', bg: 'bg-cyan-50/50' },
          ].map(s => (
            <div key={s.label} className={cn("p-4 border rounded-xl bg-white", s.bg)}>
               <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{s.label}</p>
               <p className={cn("text-2xl font-black mt-1", s.color)}>{s.val}</p>
            </div>
          ))}
       </div>

       {/* Detailed Salary Card */}
       <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
             <div className="bg-white rounded-2xl border p-6 space-y-6">
                <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider pb-2 border-b">
                   Détails de Rémunération
                </h3>
                
                {/* Base Salary Breakdown */}
                <div className="flex items-center justify-between py-2">
                   <div>
                      <p className="text-xs font-bold text-slate-800">Rémunération de base</p>
                      <p className="text-[10px] text-slate-400 font-medium">{baseSalaryExplain}</p>
                   </div>
                   <span className="text-sm font-bold text-slate-800">{formatPrice(baseSalaryVal)}</span>
                </div>

                {/* Retrait Point de Vente breakdown */}
                {(storePickupCount > 0 || recoveredStorePickupCount > 0) && (
                   <div className="border-t pt-4 space-y-3">
                      <p className="text-[10px] font-black uppercase text-indigo-600 tracking-wider">
                         🏪 Retrait Point de Vente / Magasin
                      </p>
                      {storePickupCount > 0 && (
                         <div className="flex items-center justify-between text-xs">
                            <div className="space-y-0.5">
                               <p className="font-bold text-slate-700">Retrait Magasin Normal</p>
                               <p className="text-[10px] text-slate-400">{storePickupCount} retrait{storePickupCount > 1 ? 's' : ''} × {formatPrice(paymentStorePickup)}</p>
                            </div>
                            <span className="font-bold text-indigo-600">+{formatPrice(storePickupCount * paymentStorePickup)}</span>
                         </div>
                      )}
                      {recoveredStorePickupCount > 0 && (
                         <div className="flex items-center justify-between text-xs">
                            <div className="space-y-0.5">
                               <p className="font-bold text-slate-700">Retrait Magasin Panier Récupéré</p>
                               <p className="text-[10px] text-slate-400">{recoveredStorePickupCount} retrait{recoveredStorePickupCount > 1 ? 's' : ''} × {formatPrice(paymentRecoveredStorePickup)}</p>
                            </div>
                            <span className="font-bold text-indigo-600">+{formatPrice(recoveredStorePickupCount * paymentRecoveredStorePickup)}</span>
                         </div>
                      )}
                   </div>
                )}

                {/* Abandoned Cart Recovery breakdown */}
                {paymentRecovered > 0 && (
                   <div className="border-t pt-4 space-y-3">
                      <p className="text-[10px] font-black uppercase text-violet-600 tracking-wider">
                         Paniers Abandonnés (Bonus Récupération)
                      </p>
                      <div className="flex items-center justify-between text-xs">
                         <div className="space-y-0.5">
                            <p className="font-bold text-slate-700">Commission Paniers Récupérés</p>
                            <p className="text-[10px] text-slate-400">{recoveredCount} paniers récupérés × {formatPrice(paymentRecovered)}</p>
                         </div>
                         <span className="font-bold text-emerald-600">+{formatPrice(recoveredCount * paymentRecovered)}</span>
                      </div>
                   </div>
                )}

                {/* Returns penalty breakdown */}
                {lostCount > 0 && (
                   <div className="border-t pt-4 space-y-3">
                      <p className="text-[10px] font-black uppercase text-rose-600 tracking-wider">
                         Retours (Pénalité)
                      </p>
                      <div className="flex items-center justify-between text-xs">
                         <div className="space-y-0.5">
                            <p className="font-bold text-slate-700">Commandes retournées</p>
                            <p className="text-[10px] text-slate-400">{lostCount} retour{lostCount > 1 ? 's' : ''} × {formatPrice(paymentLost)}</p>
                         </div>
                         <span className="font-bold text-rose-600">-{formatPrice(stats.returned_penalty ?? (lostCount * paymentLost))}</span>
                      </div>
                   </div>
                )}

                {/* Upsell bonus breakdown */}
                {upsellDeliveredCount > 0 && (
                   <div className="border-t pt-4 space-y-3">
                      <p className="text-[10px] font-black uppercase text-amber-600 tracking-wider">
                         Upsell (Bonus)
                      </p>
                      <div className="flex items-center justify-between text-xs">
                         <div className="space-y-0.5">
                            <p className="font-bold text-slate-700">Commandes upsell livrées</p>
                            <p className="text-[10px] text-slate-400">{upsellDeliveredCount} commande{upsellDeliveredCount > 1 ? 's' : ''} × {formatPrice(paymentUpsell)}</p>
                         </div>
                         <span className="font-bold text-amber-600">+{formatPrice(upsellBonus)}</span>
                      </div>
                   </div>
                )}

                {/* Marketplace bonus breakdown */}
                {marketplaceDeliveredCount > 0 && (
                   <div className="border-t pt-4 space-y-3">
                      <p className="text-[10px] font-black uppercase text-pink-600 tracking-wider">
                         Marketplace Upsell (Bonus)
                      </p>
                      <div className="flex items-center justify-between text-xs">
                         <div className="space-y-0.5">
                            <p className="font-bold text-slate-700">Commandes marketplace livrées</p>
                            <p className="text-[10px] text-slate-400">{marketplaceDeliveredCount} commande{marketplaceDeliveredCount > 1 ? 's' : ''}</p>
                         </div>
                         <span className="font-bold text-pink-600">+{formatPrice(marketplaceBonus)}</span>
                      </div>
                   </div>
                )}
             </div>
          </div>

          {/* Salary estimation Hero widget */}
          <div className="bg-slate-900 text-white rounded-2xl border border-slate-800 p-8 flex flex-col justify-between">
             <div>
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Revenu Total Estimé</p>
                <p className="text-4xl font-black mt-2 text-white">{formatPrice(totalSalary)}</p>
             </div>
             
             <div className="mt-8 space-y-4">
                <div className="flex items-center justify-between border-t border-slate-800 pt-4 text-xs">
                   <span className="text-slate-400 font-medium">Base :</span>
                   <span className="font-bold">{formatPrice(baseSalaryVal)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-violet-300">
                   <span className="font-medium">Bonus Paniers :</span>
                   <span className="font-bold">+{formatPrice(abandonedBonus)}</span>
                </div>
                {upsellBonus > 0 && (
                   <div className="flex items-center justify-between text-xs text-amber-300">
                      <span className="font-medium">Bonus Upsell :</span>
                      <span className="font-bold">+{formatPrice(upsellBonus)}</span>
                   </div>
                )}
                {marketplaceBonus > 0 && (
                   <div className="flex items-center justify-between text-xs text-pink-300">
                      <span className="font-medium">Bonus Marketplace :</span>
                      <span className="font-bold">+{formatPrice(marketplaceBonus)}</span>
                   </div>
                )}
                <div className="p-3 bg-slate-800/50 rounded-xl flex items-start gap-2.5 text-[10px] text-slate-400 leading-normal font-medium">
                   <AlertCircle className="size-4 text-slate-500 shrink-0 mt-0.5" />
                   <span>Ce montant est calculé dynamiquement par le service de trésorerie en fonction des critères et de la grille de commissions.</span>
                </div>
             </div>
          </div>
       </div>
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────

export default function AgentDashboard() {
  const { user, activeStore, allStores, setActiveStore, setAppView, sidebarCollapsed, setSidebarCollapsed, toggleSidebar, clearUser } = useAppStore();
  const isLivreur = user?.role === 'LIVREUR';
  const MODULES = useMemo(() => getModules(isLivreur, user), [isLivreur, user]);
  const queryClient = useQueryClient();
  const workTimer = useWorkTimer();
  const [showAllStores, setShowAllStores] = useState(true);

  // Personal notifications (salary date, assignments…) — the confirmatrice
  // previously had no way to see these at all; admin-header.tsx has the
  // same feed for admins, this is the employee-facing equivalent.
  const [showNotifications, setShowNotifications] = useState(false);
  const notifQuery = useQuery<{ data: any[]; unread: number }>({
    queryKey: ['notifications', user?.id],
    queryFn: () => apiFetch('/api/v1/notifications?limit=15'),
    // Alert channel — must stay reasonably fresh (see notifications-bell).
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
    enabled: !!user?.id,
  });
  const notifItems = (notifQuery.data?.data ?? []).filter((n: any) => !n.is_read).slice(0, 10);
  const notifUnread = notifQuery.data?.unread ?? 0;
  const markAllNotifRead = useMutation({
    mutationFn: () => apiFetch('/api/v1/notifications/read-all', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  });
  const NOTIF_ICONS: Record<string, any> = {
    SALARY_DUE: Wallet,
    REMINDER_DUE: Clock,
    ORDER_ASSIGNED: Package,
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/v1/auth', { method: 'DELETE' });
    } catch {
      // ignore — clear local state regardless
    }
    clearUser();
    // Defense in depth: never let the next account on this device inherit
    // this confirmatrice's cached orders/notifications before its own data loads.
    queryClient.clear();
    setAppView('storefront');
  };
  
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setSidebarCollapsed(true);
    }
  }, [isMobile, setSidebarCollapsed]);
  
  const [activeModule, setActiveModule] = useState('orders');
  // Sidebar module sections are collapsible — a livreur's/confirmatrice's
  // full nav (Commandes/Logistique/Inventaire/Produits/Mon Espace) is long
  // once every module is spelled out; letting a section fold away keeps the
  // sidebar scannable without losing any of it. Nothing collapsed by
  // default so existing behavior/visibility doesn't change unless the user
  // explicitly folds a section.
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());
  const toggleModuleCollapsed = (moduleId: string) => {
    setCollapsedModules(prev => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId); else next.add(moduleId);
      return next;
    });
  };
  const [activeSubModule, setActiveSubModule] = useState('orders-all');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dateByMode, setDateByMode] = useState<'created_at' | 'delivered_at'>('created_at');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isAutoRotate, setIsAutoRotate] = useState(false);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [drawerInitialEdit, setDrawerInitialEdit] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedDuplicateOrder, setSelectedDuplicateOrder] = useState<any>(null);

  const currentFilter = useMemo(() => {
    const sub = MODULES.flatMap(m => m.subModules).find(s => s.id === activeSubModule);
    return sub?.filter || 'ALL';
  }, [activeSubModule]);

  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);
  // Any change of store / filter / period restarts from the first page
  useEffect(() => {
    setPage(1);
  }, [activeStore?.id, showAllStores, currentFilter, startDate, endDate]);

  const ordersQuery = useQuery({
    queryKey: ['agent-orders', user?.id, activeStore?.id, showAllStores, currentFilter, startDate, endDate, page],
    queryFn: () => {
      let url = `/api/v1/orders?page=${page}&pageSize=${PAGE_SIZE}`;

      // If we are not showing all stores, filter by activeStore
      if (!showAllStores && activeStore?.id) {
        url += `&store_id=${activeStore.id}`;
      }

      if (currentFilter !== 'ALL') {
        url += `&status=${encodeURIComponent(currentFilter)}`;
      }
      if (startDate) {
        url += `&start_date=${encodeURIComponent(new Date(startDate).toISOString())}`;
      }
      if (endDate) {
        const d = new Date(endDate);
        d.setHours(23, 59, 59, 999);
        url += `&end_date=${encodeURIComponent(d.toISOString())}`;
      }
      // allStores: ALWAYS bypass the X-Store-Id tenant header on agent list
      // queries. The header follows the Zustand "active store", which can
      // desync from the store the agent is browsing (default store ≠ selected
      // store) — the server then intersects everything with the wrong store
      // and her real orders vanish (observed live: store_id=trustshop with
      // X-Store-Id=azconfort → total=0). The explicit store_id param + the
      // CONFIRMATEUR RBAC in list_orders do all the real scoping server-side.
      console.log('[AgentDebug] requête commandes →', url, {
        modeToutesBoutiques: showAllStores,
        boutiqueActive: activeStore?.name,
      });
      return apiFetch<{ data: Order[]; total: number; totalPages: number }>(url, { allStores: true });
    },
    enabled: !!user?.id && (showAllStores || !!activeStore?.id),
    placeholderData: (prev) => prev,
    staleTime: 30 * 1000,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  // Garde-fou pagination : après une action (confirmation, annulation,
  // assignation…) qui retire des commandes du filtre courant, le nombre de
  // pages peut chuter sous la page affichée — sans ce clamp, la
  // confirmatrice se retrouvait bloquée sur une page VIDE, sans résultat et
  // sans moyen évident de revenir (bug de pagination récurrent signalé). On
  // ramène automatiquement à la dernière page réellement peuplée.
  useEffect(() => {
    const tp = (ordersQuery.data as any)?.totalPages;
    if (typeof tp === 'number' && tp >= 1 && page > tp) {
      setPage(tp);
    }
  }, [ordersQuery.data, page]);

  const perfQuery = useQuery({
    queryKey: ['agent-perf', user?.id, activeStore?.id, showAllStores, startDate, endDate, dateByMode],
    queryFn: () => {
      const params = new URLSearchParams();
      if (!showAllStores && activeStore?.id) params.set('store_id', activeStore.id);
      if (startDate) params.set('start_date', new Date(startDate).toISOString());
      if (endDate) {
        const d = new Date(endDate);
        d.setHours(23, 59, 59, 999);
        params.set('end_date', d.toISOString());
      }
      params.set('date_by', dateByMode);
      const qs = params.toString();
      const url = `/api/v1/users/${user?.id}/performance${qs ? `?${qs}` : ''}`;
      return apiFetch<any>(url, { allStores: true });
    },
    enabled: !!user?.id && (showAllStores || !!activeStore?.id)
  });

  const agentCountsQuery = useQuery({
    queryKey: ['agent-orders-counts', user?.id, activeStore?.id, showAllStores, startDate, endDate],
    queryFn: () => {
      let url = `/api/v1/orders/agent-counts?`;
      if (!showAllStores && activeStore?.id) {
        url += `store_id=${activeStore.id}&`;
      }
      if (startDate) {
        url += `start_date=${encodeURIComponent(new Date(startDate).toISOString())}&`;
      }
      if (endDate) {
        const d = new Date(endDate);
        d.setHours(23, 59, 59, 999);
        url += `end_date=${encodeURIComponent(d.toISOString())}&`;
      }
      // Same rationale as ordersQuery: never let the active-store tenant
      // header intersect the results — explicit params + RBAC do the scoping.
      return apiFetch<any>(url, { allStores: true });
    },
    enabled: !!user?.id && (showAllStores || !!activeStore?.id),
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  let filteredOrders = (ordersQuery.data?.data ?? []).filter(o => 
    o.order_number.toLowerCase().includes(search.toLowerCase()) ||
    o.customer_name.toLowerCase().includes(search.toLowerCase()) ||
    o.customer_phone.includes(search)
  );

  const phoneCounts = (ordersQuery.data?.data ?? []).reduce((acc: any, o: any) => {
    acc[o.customer_phone] = (acc[o.customer_phone] || 0) + 1;
    return acc;
  }, {});
  const isDuplicatePhone = (phone: string) => (phoneCounts[phone] ?? 0) > 1;

  // Stores this agent is actually responsible for — nothing else is shown to her.
  // Scope SPECIFIC: her fully-assigned stores + stores discovered in her visible
  // orders (covers products assigned in OTHER stores). Scope ALL with assigned
  // products = product-specialist: only the stores her orders actually come from.
  // Scope ALL without products (or non-confirmateur roles): every store.
  const myStores = useMemo(() => {
    // Independent of the legacy assigned_store_scope flag (same rationale as
    // the backend fix): assigned_store_ids counts whenever it's non-empty.
    const myStoreIds = user?.assigned_store_ids ?? [];
    const nbProducts = (user?.assigned_product_ids ?? []).length;
    const isScoped = user?.role === 'CONFIRMATEUR' && (myStoreIds.length > 0 || nbProducts > 0);
    if (!isScoped) return allStores;
    const ids = new Set<string>(myStoreIds);
    for (const o of (ordersQuery.data?.data ?? []) as any[]) {
      if (o.store_id) ids.add(o.store_id);
    }
    const filtered = allStores.filter(s => ids.has(s.id));
    return filtered.length > 0 ? filtered : allStores;
  }, [user, allStores, ordersQuery.data]);

  // Diagnostic console (F12 → Console) : config réelle de l'agent + ce que le
  // serveur renvoie, ventilé par boutique — miroir du [ConfirmatriceDebug] backend.
  useEffect(() => {
    const d: any = ordersQuery.data;
    if (!d?.data) return;
    const parBoutique: Record<string, number> = {};
    for (const o of d.data as any[]) {
      const k = o.store?.name || o.store_id || 'sans-boutique';
      parBoutique[k] = (parBoutique[k] || 0) + 1;
    }
    console.log('[AgentDebug] réponse commandes ←', {
      utilisateur: user?.email,
      config: {
        scope: user?.assigned_store_scope,
        boutiquesAssignees: user?.assigned_store_ids,
        nbProduitsAssignes: (user?.assigned_product_ids ?? []).length,
      },
      vue: { modeToutesBoutiques: showAllStores, boutiqueActive: activeStore?.name, filtre: currentFilter, page },
      resultat: { total: d.total, totalPages: d.totalPages, surCettePage: d.data.length, parBoutique },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordersQuery.data]);


  if (currentFilter === 'ALL') {
     filteredOrders = filteredOrders.filter(o => o.status !== 'CANCELLED' && o.status !== 'RETURNED');
  }

  // ─── Fusion visuelle des doublons : un client (même téléphone) = une seule ligne ───
  // La commande "principale" est celle que la confirmatrice doit traiter :
  // commande normale avant panier abandonné, puis statut le plus avancé, puis la plus ancienne.
  const STATUS_WEIGHT: Record<string, number> = {
    DELIVERED: 7, SHIPPED: 6, CONFIRMED: 5, RESCHEDULED: 4, IN_PROGRESS: 4,
    CALLED: 4, ASSIGNED: 3, NEW: 2, ABANDONED: 1, CANCELLED: 0, RETURNED: 0,
  };
  const groupedOrders: { primary: Order; related: Order[] }[] = (() => {
    const phoneKey = (o: Order) => (o.customer_phone || '').replace(/\D/g, '') || o.id;
    const byPhone = new Map<string, Order[]>();
    for (const o of filteredOrders) {
      const key = phoneKey(o);
      if (!byPhone.has(key)) byPhone.set(key, []);
      byPhone.get(key)!.push(o);
    }
    const seen = new Set<string>();
    const groups: { primary: Order; related: Order[] }[] = [];
    for (const o of filteredOrders) {
      const key = phoneKey(o);
      if (seen.has(key)) continue;
      seen.add(key);
      const members = byPhone.get(key)!;
      const primary = [...members].sort((a, b) =>
        (Number(!!a.is_abandoned_cart) - Number(!!b.is_abandoned_cart)) ||
        ((STATUS_WEIGHT[b.status] ?? 0) - (STATUS_WEIGHT[a.status] ?? 0)) ||
        (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      )[0];
      groups.push({ primary, related: members.filter(m => m.id !== primary.id) });
    }
    return groups;
  })();

  // "Toutes les boutiques" mixed every store's orders into one interleaved
  // list — hard to work with for a confirmatrice covering several stores,
  // since a store's own volume of commandes was never visible as its own
  // section. Group by store (each with its own header + count) whenever more
  // than one store's orders are actually present in this result set; a
  // single-store view (dropdown set to one store) stays a plain flat list.
  const storeSections: { storeId: string; storeName: string; groups: typeof groupedOrders }[] = (() => {
    const byStore = new Map<string, { storeName: string; groups: typeof groupedOrders }>();
    for (const g of groupedOrders) {
      const sid = g.primary.store_id || 'unknown';
      const sname = (g.primary as any).store?.name || 'Boutique';
      if (!byStore.has(sid)) byStore.set(sid, { storeName: sname, groups: [] });
      byStore.get(sid)!.groups.push(g);
    }
    return Array.from(byStore.entries())
      .map(([storeId, v]) => ({ storeId, storeName: v.storeName, groups: v.groups }))
      .sort((a, b) => a.storeName.localeCompare(b.storeName));
  })();
  const showStoreSections = showAllStores && storeSections.length > 1;

  useEffect(() => {
    if (selectedOrder) {
      const updated = filteredOrders.find(o => o.id === selectedOrder.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(selectedOrder)) {
        setSelectedOrder(updated);
      }
    }
  }, [filteredOrders, selectedOrder]);

  const handleNextOrder = (currentOrderId: string) => {
    if (!isAutoRotate) {
      setSelectedOrder(null);
      return;
    }
    const idx = filteredOrders.findIndex(o => o.id === currentOrderId);
    if (idx >= 0 && idx < filteredOrders.length - 1) {
      setSelectedOrder(filteredOrders[idx + 1]);
    } else {
      setSelectedOrder(null);
    }
  };

  const statusMutation = useMutation({
    mutationFn: async ({ orderId, status, assigned_to, call_result, delivery_type }: { orderId: string; status?: string; assigned_to?: string; call_result?: string; delivery_type?: string }) => {
      const payload: any = {};
      if (status) payload.status = status;
      if (assigned_to) payload.assigned_to = assigned_to;
      if (call_result) payload.call_result = call_result;
      if (delivery_type) payload.delivery_type = delivery_type;
      
      // allStores: the order may belong to another of the agent's assigned stores
      // than the currently active one — the endpoint's own access check still applies.
      const res: any = await apiFetch(`/api/v1/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify(payload), allStores: true });

      // Un livreur ne crée jamais le colis chez le transporteur lui-même
      // (backend le refuse déjà, 403) — sauter l'appel plutôt que de
      // déclencher un toast d'erreur transporteur à chaque confirmation.
      if (status === 'CONFIRMED' && user?.role !== 'LIVREUR') {
        try {
          const dispatchRes: any = await apiFetch(`/api/v1/orders/${orderId}/dispatch`, { method: 'POST', allStores: true });
          return { ...res, dispatch: dispatchRes };
        } catch (dispatchErr: any) {
          return { ...res, dispatch_error: dispatchErr.message || 'Erreur transporteur' };
        }
      }
      return res;
    },
    onSuccess: (data: any, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent-orders'] });
      queryClient.invalidateQueries({ queryKey: ['agent-perf'] });
      queryClient.invalidateQueries({ queryKey: ['order-events', variables.orderId] });
      
      if (variables.status === 'CONFIRMED') {
        if (data?.dispatch?.tracking_number) {
          toast.success(`Confirmée & Expédiée ! Suivi : ${data.dispatch.tracking_number}`);
        } else if (data?.dispatch_error) {
          toast.warning(`Confirmée, mais l'expédition automatique a échoué : ${data.dispatch_error}`);
        } else {
          toast.success('Commande confirmée avec succès');
        }
      } else {
        toast.success('Action enregistrée');
      }

      if (!isAutoRotate) {
        setSelectedOrder((prev: any) => {
          if (!prev || prev.id !== variables.orderId) return prev;
          return {
            ...prev,
            status: data?.dispatch?.tracking_number ? 'SHIPPED' : (variables.status || prev.status),
            tracking_number: data?.dispatch?.tracking_number || prev.tracking_number
          };
        });
      }
      
      handleNextOrder(variables.orderId);
    },
    onError: (err: any) => {
      toast.error(err.message || "Une erreur s'est produite", { duration: 6000 });
    }
  });

  const dispatchMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return await apiFetch(`/api/v1/orders/${orderId}/dispatch`, { method: 'POST', allStores: true });
    },
    onSuccess: (data: any, orderId) => {
      queryClient.invalidateQueries({ queryKey: ['agent-orders'] });
      queryClient.invalidateQueries({ queryKey: ['order-events', orderId] });
      if (data?.tracking_number) {
        toast.success(`Colis créé avec succès ! Suivi : ${data.tracking_number}`);
        setSelectedOrder((prev: any) => {
          if (!prev || prev.id !== orderId) return prev;
          return {
            ...prev,
            status: 'SHIPPED',
            tracking_number: data.tracking_number
          };
        });
      } else {
         toast.success("Expédié !");
      }
    },
    onError: (err: any) => {
      toast.error(err.message || "Erreur transporteur");
    }
  });

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {selectedOrder && <OrderDrawer order={selectedOrder} onClose={() => setSelectedOrder(null)} onOrderUpdate={(updated) => {
            console.log("[DEBUG FRONTEND] Parent onOrderUpdate called. Old selectedOrder:", selectedOrder, "New updated:", updated);
            setSelectedOrder(updated);
          }} currentUser={user} initialEdit={drawerInitialEdit} isPending={statusMutation.isPending || dispatchMutation.isPending} onStatusChange={(id, s, assignTo, callResult, delType) => statusMutation.mutate({ orderId: id, status: s, assigned_to: assignTo, call_result: callResult, delivery_type: delType })} onDispatch={(id) => dispatchMutation.mutate(id)} />}

      {/* Sidebar Overlay for Mobile */}
      {isMobile && !sidebarCollapsed && (
        <div 
           className="fixed inset-0 z-[45] bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300"
           onClick={() => setSidebarCollapsed(true)}
        />
      )}

      {/* ─── Sidebar ─── */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 bg-white flex flex-col shrink-0 border-r shadow-2xl lg:shadow-none transition-all duration-300",
        sidebarCollapsed ? "-translate-x-full lg:translate-x-0 lg:w-[70px]" : "translate-x-0 w-[280px] sm:w-[260px]"
      )}>
        <div className="h-16 px-4 border-b flex items-center justify-center bg-white shrink-0 relative">
          <div className={cn("flex shrink-0 items-center justify-center", sidebarCollapsed ? "size-9" : "size-12")}>
             <img src="/azzougshop_logo.png" alt="AzzougShop" className="w-full h-full object-contain" />
          </div>
          {isMobile && (
            <button onClick={() => setSidebarCollapsed(true)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 lg:hidden hover:bg-slate-100 rounded">
               <XCircle className="size-5 text-slate-400" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
          {MODULES.map(module => {
            const isFolded = collapsedModules.has(module.id);
            return (
            <div key={module.id} className="space-y-1">
              <button
                type="button"
                onClick={() => toggleModuleCollapsed(module.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-slate-600 transition-colors",
                  sidebarCollapsed && "justify-center px-0"
                )}
              >
                <module.icon className="size-4 shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="text-[10px] font-bold uppercase tracking-widest flex-1 text-left">{module.label}</span>
                    <ChevronRight className={cn("size-3 shrink-0 transition-transform", !isFolded && "rotate-90")} />
                  </>
                )}
              </button>
              {(!isFolded || sidebarCollapsed) && (
              <div className="space-y-0.5">
                {module.subModules.map(sub => {
                   const count = sub.filter ? (agentCountsQuery.data?.counts?.[sub.filter.toLowerCase() === 'pending_confirmation' ? 'pending' : sub.filter.toLowerCase() === 'abandoned_in_progress' ? 'abandoned_in_progress' : sub.filter.toLowerCase()] ?? 0) : 0;
                   return (
                     <button key={sub.id} onClick={() => { 
                             setActiveModule(module.id); setActiveSubModule(sub.id); 
                             if (isMobile) setSidebarCollapsed(true);
                           }}
                             className={cn(
                               "w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-between group",
                               activeSubModule === sub.id ? "bg-[#4b7bec] text-white shadow-lg" : "text-slate-500 hover:bg-slate-50",
                               sidebarCollapsed && "justify-center px-0"
                             )}>
                       <span className={cn("flex items-center gap-3", sidebarCollapsed && "justify-center w-full")}>
                          {sub.icon && <sub.icon className={cn("size-5 shrink-0", activeSubModule === sub.id ? "text-white" : "text-slate-400")} />}
                          {!sidebarCollapsed && sub.label}
                       </span>
                       {!sidebarCollapsed && (
                         <span className="flex items-center gap-1.5 shrink-0">
                           {count > 0 && (
                             <span className={cn(
                               "px-1.5 py-0.5 rounded-full text-[9px] font-black tracking-wide leading-none",
                               activeSubModule === sub.id 
                                 ? "bg-white/20 text-white" 
                                 : "bg-slate-100 text-slate-500"
                             )}>
                               {count}
                             </span>
                           )}
                           {activeSubModule === sub.id && <ChevronRight className="size-3" />}
                         </span>
                       )}
                     </button>
                   );
                 })}
              </div>
              )}
            </div>
            );
          })}
        </div>

        <div className="p-4 border-t bg-slate-50 shrink-0">
          <div className={cn("flex items-center gap-3", sidebarCollapsed && "justify-center")}>
             <div className="size-9 bg-slate-200 rounded-full flex shrink-0 items-center justify-center text-xs font-bold text-slate-600">
               {user?.name?.charAt(0)}
             </div>
             {!sidebarCollapsed && (
               <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold truncate">{user?.name}</p>
                  <p className="text-[9px] text-slate-400 font-bold uppercase">{workTimer}</p>
               </div>
             )}
             {!sidebarCollapsed && (
               <button onClick={handleLogout} className="p-2 shrink-0 text-slate-400 hover:text-red-500">
                 <LogOut className="size-4" />
               </button>
             )}
          </div>
        </div>
      </aside>

      {/* ─── Main Content ─── */}
      <div 
        className="flex-1 flex flex-col min-w-0 overflow-hidden transition-all duration-300"
        style={{ marginLeft: isMobile ? '0' : (sidebarCollapsed ? '70px' : '260px') }}
      >
        <header className="border-b bg-white flex flex-col shrink-0 gap-2 p-4 sm:px-6">
           {/* Row 1: Top Bar */}
           <div className="flex items-center justify-between gap-4 w-full">
             <div className="flex items-center gap-3 flex-1 min-w-0">
                <button
                   onClick={toggleSidebar}
                   className="p-2 -ml-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 rounded-lg shrink-0"
                >
                   <Menu className="size-5" />
                </button>
                <div className="relative w-full max-w-md hidden sm:block">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                  <Input placeholder="Rechercher..." className="pl-10 h-9 bg-slate-50 border-none shadow-none text-xs rounded-lg" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                
                {/* On Desktop, show the toggle here */}
                {myStores.length > 1 && (
                  <div className="hidden md:flex items-center gap-1 bg-slate-100 p-1 rounded-xl border shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowAllStores(true)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                        showAllStores ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                      )}
                    >
                      Toutes
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAllStores(false)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                        !showAllStores ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                      )}
                    >
                      Active seule
                    </button>
                  </div>
                )}
             </div>
             <div className="flex items-center gap-3 sm:gap-6 shrink-0">
                {/* Un livreur ne saisit jamais de commande manuellement. */}
                {!isLivreur && (
                <div className="hidden sm:flex items-center gap-4 border-r pr-6 mr-2">
                     <button
                       onClick={() => setIsCreatingOrder(true)}
                       className="flex items-center gap-2 bg-slate-900 text-white px-3 py-2 sm:px-4 sm:py-2 rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors shadow-sm"
                     >
                       <Plus className="size-4 shrink-0" />
                       <span>Nouvelle Commande</span>
                     </button>
                </div>
                )}

                <Popover
                  open={showNotifications}
                  onOpenChange={(open) => {
                    setShowNotifications(open);
                    if (open && notifUnread > 0) markAllNotifRead.mutate();
                  }}
                >
                  <PopoverTrigger asChild>
                    <button className="relative p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors shrink-0">
                      <Bell className="size-5" />
                      {notifUnread > 0 && (
                        <span className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full text-[9px] font-bold text-white bg-[#6C5CE7]">
                          {notifUnread > 9 ? '9+' : notifUnread}
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[340px] p-0 rounded-xl shadow-2xl">
                    <div className="px-4 py-3 border-b">
                      <h3 className="text-sm font-bold text-slate-800">Notifications</h3>
                    </div>
                    <div className="max-h-[380px] overflow-y-auto divide-y">
                      {notifItems.length === 0 ? (
                        <div className="py-12 text-center">
                          <Bell className="size-7 text-slate-200 mx-auto mb-2" />
                          <p className="text-xs font-semibold text-slate-400">Aucune notification</p>
                        </div>
                      ) : notifItems.map((n: any) => {
                        const Icon = NOTIF_ICONS[n.type] || Bell;
                        return (
                          <div key={n.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
                            <div className="size-8 rounded-lg bg-[#6C5CE7]/10 text-[#6C5CE7] flex items-center justify-center shrink-0">
                              <Icon className="size-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-800">{n.title}</p>
                              <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{n.message}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>

                <div className="flex flex-col items-end">
                   <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden sm:inline">Boutique active</span>
                   {myStores.length > 1 ? (
                     <select
                       value={showAllStores ? '__ALL__' : (activeStore?.id || '')}
                       onChange={(e) => {
                         if (e.target.value === '__ALL__') {
                           // Picking a store here used to silently force
                           // showAllStores=false with no way back from this
                           // same menu — a confirmatrice switching stores via
                           // this dropdown (the only switcher she used) got
                           // permanently narrowed to one store and its orders
                           // in every OTHER assigned store appeared to vanish,
                           // even though they were still correctly assigned to
                           // her server-side. This option is the way back.
                           setShowAllStores(true);
                           return;
                         }
                         const selected = myStores.find(s => s.id === e.target.value);
                         if (selected) {
                           setActiveStore(selected);
                           setShowAllStores(false);
                         }
                       }}
                       className="text-xs font-bold bg-transparent border-none outline-none text-right cursor-pointer text-indigo-600 hover:underline font-sans max-w-[120px] truncate"
                     >
                       <option value="__ALL__">Toutes mes boutiques</option>
                       {myStores.map(store => (
                         <option key={store.id} value={store.id}>
                           {store.name}
                         </option>
                       ))}
                     </select>
                   ) : (
                     <span className="text-xs font-bold">{activeStore?.name}</span>
                   )}
                </div>
                
                <div className="flex items-center gap-2">
                  <button onClick={() => queryClient.invalidateQueries({ queryKey: ['agent-orders'] })}
                          className="p-2 border rounded-xl hover:bg-slate-50 transition-colors shrink-0">
                    <RefreshCw className={cn("size-4 text-slate-500", ordersQuery.isFetching && "animate-spin")} />
                  </button>
                </div>
             </div>
           </div>
           
           {/* Row 1.5: Mobile-only search bar */}
           <div className="relative w-full sm:hidden">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
             <Input placeholder="Rechercher (nom, n° commande, téléphone)..." className="pl-10 h-9 bg-slate-50 border-none shadow-none text-xs rounded-lg" value={search} onChange={e => setSearch(e.target.value)} />
           </div>

           {/* Row 2: Mobile-only controls (Toggles & Plus button) */}
           <div className="flex items-center justify-between gap-2 w-full md:hidden border-t pt-2 mt-1">
              {myStores.length > 1 ? (
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowAllStores(true)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                      showAllStores ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                    )}
                  >
                    Toutes les boutiques
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAllStores(false)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                      !showAllStores ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                    )}
                  >
                    Active seule
                  </button>
                </div>
              ) : (
                <div className="text-xs font-bold text-slate-400">Boutique: {activeStore?.name}</div>
              )}
              
              {!isLivreur && (
              <button
                onClick={() => setIsCreatingOrder(true)}
                className="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors shadow-sm shrink-0"
              >
                <Plus className="size-3.5 shrink-0" />
                <span>Nouvelle</span>
              </button>
              )}
           </div>
         </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-8 pb-24 sm:pb-8 custom-scrollbar bg-slate-50/50">
          {activeSubModule === 'salary-details' ? (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <h2 className="text-xl font-bold tracking-tight">Mon Salaire</h2>
                <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-2xl border shadow-sm w-full md:w-auto justify-between md:justify-start">
                  <div className="flex items-center p-0.5 bg-slate-100 rounded-xl border text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setDateByMode('created_at')}
                      className={cn(
                        "px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer",
                        dateByMode === 'created_at' 
                          ? "bg-white text-slate-900 shadow-xs font-black" 
                          : "text-slate-500 hover:text-slate-700"
                      )}
                    >
                      <Calendar className="size-3.5" />
                      Création
                    </button>
                    <button
                      type="button"
                      onClick={() => setDateByMode('delivered_at')}
                      className={cn(
                        "px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer",
                        dateByMode === 'delivered_at' 
                          ? "bg-white text-indigo-600 shadow-xs font-black" 
                          : "text-slate-500 hover:text-slate-700"
                      )}
                    >
                      <Truck className="size-3.5" />
                      Livraison
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-black uppercase text-slate-400">Du</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="text-xs font-bold px-2 py-1 bg-slate-50 border rounded-lg outline-none text-slate-700 font-sans"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-black uppercase text-slate-400">Au</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="text-xs font-bold px-2 py-1 bg-slate-50 border rounded-lg outline-none text-slate-700 font-sans"
                    />
                  </div>
                  {(startDate || endDate) && (
                    <button
                      onClick={() => { setStartDate(''); setEndDate(''); }}
                      className="text-[10px] font-black uppercase tracking-wider text-red-500 hover:text-red-600 px-2 py-1 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                    >
                      Effacer
                    </button>
                  )}
                </div>
              </div>
              <SalaryView perf={perfQuery.data} user={user} />
            </div>
          ) : activeSubModule === 'products-catalog' ? (
            // Avantage préexistant du livreur : gestion produit complète
            // (pas la vue Inventaire allégée de la confirmatrice ci-dessous).
            <ProductsPage />
          ) : activeSubModule.startsWith('inventory-') ? (
            // Un livreur garde l'accès Inventaire ADMIN complet (prix
            // d'achat, marge, ajustement de stock) — seule la confirmatrice
            // est bridée à la vue allégée AgentInventoryView.
            isLivreur ? <InventoryDashboard /> : <AgentInventoryView subModuleId={activeSubModule} />
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
               <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h2 className="text-xl font-bold tracking-tight">
                    {MODULES.flatMap(m => m.subModules).find(s => s.id === activeSubModule)?.label}
                  </h2>
                  
                  <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-2xl border shadow-sm w-full md:w-auto justify-between md:justify-start">
                     <div className="flex items-center gap-1.5">
                       <span className="text-[10px] font-black uppercase text-slate-400">Du</span>
                       <input
                         type="date"
                         value={startDate}
                         onChange={(e) => setStartDate(e.target.value)}
                         className="text-xs font-bold px-2 py-1 bg-slate-50 border rounded-lg outline-none text-slate-700 font-sans"
                       />
                     </div>
                     <div className="flex items-center gap-1.5">
                       <span className="text-[10px] font-black uppercase text-slate-400">Au</span>
                       <input
                         type="date"
                         value={endDate}
                         onChange={(e) => setEndDate(e.target.value)}
                         className="text-xs font-bold px-2 py-1 bg-slate-50 border rounded-lg outline-none text-slate-700 font-sans"
                       />
                     </div>
                     {(startDate || endDate) && (
                       <button
                         onClick={() => {
                           setStartDate('');
                           setEndDate('');
                         }}
                         className="text-[10px] font-black uppercase tracking-wider text-red-500 hover:text-red-600 px-2 py-1 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                       >
                         Effacer
                       </button>
                     )}
                     <span className="text-xs font-bold text-slate-400 border-l pl-3 ml-1 shrink-0">
                       {groupedOrders.length !== filteredOrders.length
                         ? `${groupedOrders.length} clients · ${filteredOrders.length} commandes`
                         : `${filteredOrders.length} résultats`}
                     </span>
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
                    {(showStoreSections ? storeSections.flatMap(s => s.groups) : groupedOrders).map(({ primary: order, related }, idx, arr) => {
                      const statusBg = STATUS_CFG[order.status]?.bg || '#ffffff';
                      const isExpanded = expandedGroups.has(order.id);
                      const isFirstOfStore = showStoreSections && (idx === 0 || arr[idx - 1].primary.store_id !== order.store_id);
                      const storeSection = isFirstOfStore ? storeSections.find(s => s.storeId === (order.store_id || 'unknown')) : null;
                      return (
                       <>
                       {storeSection && (
                         <div key={`section-${storeSection.storeId}`} className="flex items-center gap-2 pt-2 first:pt-0">
                           <span className="text-xs font-black uppercase tracking-wider text-slate-500">🏪 {storeSection.storeName}</span>
                           <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{storeSection.groups.length} client{storeSection.groups.length > 1 ? 's' : ''}</span>
                           <div className="h-px flex-1 bg-slate-200" />
                         </div>
                       )}
                       <div key={order.id} className="space-y-0">
                       <button onClick={() => { setSelectedOrder(order); setDrawerInitialEdit(false); }}
                               className={cn(
                                 "w-full border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-300 hover:shadow-md transition-all group text-left",
                                 related.length > 0 && isExpanded && "rounded-b-none border-b-0"
                               )}
                               style={{ backgroundColor: statusBg }}>
                          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                             <div className="flex items-center gap-2 flex-wrap">
                               {/* Origin (never changes) + status (evolves) — always both */}
                               <OrderTypeBadge order={order} />
                               <StatusBadge status={order.status} />
                               <NrpBadge count={order.nrp_count || 0} />
                               <PendingBadge order={order} />
                               {related.length > 0 ? (
                                  <RelatedOrdersBadge
                                    count={related.length}
                                    expanded={isExpanded}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedGroups(prev => {
                                        const next = new Set(prev);
                                        if (next.has(order.id)) next.delete(order.id);
                                        else next.add(order.id);
                                        return next;
                                      });
                                    }}
                                  />
                                ) : (order.is_duplicate || (order.duplicate_count ?? 0) > 0) ? (
                                  <DuplicatePopover
                                    order={order}
                                    onOpenFullModal={() => setSelectedDuplicateOrder(order)}
                                    onUnmergeSuccess={() => ordersQuery.refetch()}
                                  />
                                ) : null}
                               {order.store?.name && (
                                  <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded border border-blue-200 bg-blue-50 text-blue-700 shrink-0">
                                    🏪 {order.store.name}
                                  </span>
                                )}
                               {order.livreur_id && (
                                  <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded border border-sky-200 bg-sky-50 text-sky-700 shrink-0" title="Livraison interne assignée">
                                    🚴 {order.livreur?.name || 'Livreur assigné'}
                                  </span>
                                )}
                               {order.tracking_number && (
                                  <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded border border-cyan-200 bg-cyan-50 text-cyan-700 shrink-0" title={`Suivi : ${order.tracking_number}`}>
                                    📦 {order.tracking_number}
                                  </span>
                                )}
                               {!!order.events_count && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); setDrawerInitialEdit(false); }}
                                    className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded border border-slate-200 bg-slate-50 text-slate-500 shrink-0 hover:bg-slate-100 hover:border-slate-300 transition-colors"
                                    title="Voir l'historique complet de cette commande"
                                  >
                                    🕘 {order.events_count} évènement{order.events_count > 1 ? 's' : ''}
                                  </button>
                                )}
                             </div>
                             <div>
                                <p className="text-xs font-bold group-hover:text-blue-600 transition-colors">{formatOrderRef(order, 'admin')}</p>
                                <p className="text-[10px] text-slate-500 font-bold uppercase mt-1">{order.customer_name} · {order.customer_wilaya}</p>
                                {order.notes && (
                                  <p className="text-[9px] text-amber-700 bg-amber-50/70 border border-amber-100/70 rounded px-1.5 py-0.5 mt-1 w-fit font-bold uppercase tracking-wide">
                                    Note: {order.notes}
                                  </p>
                                )}
                                {order.internal_notes && (
                                  <p className="text-[9px] text-purple-700 bg-purple-50/70 border border-purple-100/70 rounded px-1.5 py-0.5 mt-1 w-fit font-bold uppercase tracking-wide">
                                    🔒 Interne: {order.internal_notes}
                                  </p>
                                )}
                                {/* Items and variants summary */}
                                <div className="mt-1.5 space-y-0.5">
                                  {order.items?.map((item, i) => (
                                    <p key={i} className="text-[10px] text-slate-400 font-medium">
                                      📦 {item.product_name}
                                      {item.variant_details && ` (${
                                        typeof item.variant_details === 'string'
                                          ? item.variant_details
                                          : Object.entries(item.variant_details)
                                              .filter(([k]) => k !== 'variant')
                                              .map(([k, v]) => `${v}`)
                                              .join(' / ') || item.variant_details.variant || ''
                                      })`} x{item.quantity}
                                    </p>
                                  ))}
                                </div>
                             </div>
                          </div>
                          <div className="flex items-center justify-between sm:justify-end gap-4 sm:gap-8 border-t sm:border-t-0 pt-2 sm:pt-0">
                             <div className="text-left sm:text-right">
<p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest sm:hidden">Téléphone</p>
                                <p className="text-xs font-bold">{order.customer_phone}</p>
                             </div>
                             <div className="text-right shrink-0">
                                <p className="text-xs font-bold">{formatPrice(order.total)}</p>
                                 <p className="text-[9px] text-slate-400 font-bold uppercase" title={new Date(order.created_at).toLocaleString('fr-FR')}>
                                   📅 {new Date(order.created_at).toLocaleDateString('fr-FR')} 
                                   <span className="text-slate-300 mx-1">·</span> 
                                   🕒 {new Date(order.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                 </p>
                             </div>
                             <div className="flex items-center gap-2">
                               <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedOrder(order);
                                    setDrawerInitialEdit(true);
                                  }}
                                  className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all shadow-sm shrink-0"
                                >
                                  Modifier
                                </button>
                               <ChevronRight className="size-4 text-slate-200 group-hover:text-slate-400 transition-colors hidden sm:block" />
                             </div>
                          </div>
                       </button>
                       {/* Commandes liées du même client, repliées sous la ligne principale */}
                       {related.length > 0 && isExpanded && (
                         <div className="border border-t-0 border-purple-200 rounded-b-xl bg-purple-50/40 divide-y divide-purple-100">
                           {related.map(rel => (
                             <div key={rel.id} className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                               <div className="flex items-center gap-2 flex-wrap min-w-0">
                                 <span className="text-[9px] font-black uppercase tracking-wider text-purple-600 shrink-0">↳ 🟣 Liée</span>
                                 <OrderTypeBadge order={rel} size="xs" short />
                                 <StatusBadge status={rel.status} />
                                 <span className="text-[10px] font-bold text-slate-500 truncate">{formatOrderRef(rel, 'admin')}</span>
                               </div>
                               <div className="flex items-center gap-3 shrink-0">
                                 <span className="text-[10px] font-bold text-slate-600">{formatPrice(rel.total)}</span>
                                 <span className="text-[9px] font-bold text-slate-400 uppercase">
                                   {new Date(rel.created_at).toLocaleDateString('fr-FR')} · {new Date(rel.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                 </span>
                                 <button
                                   type="button"
                                   onClick={() => { setSelectedOrder(rel); setDrawerInitialEdit(false); }}
                                   className="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider text-amber-800 bg-amber-100 border border-amber-200 hover:bg-amber-200 transition-colors"
                                 >
                                   Ouvrir
                                 </button>
                               </div>
                             </div>
                           ))}
                         </div>
                       )}
                       </div>
                       </>
                     );})}
                 </div>
               )}
               {/* Pagination — server-side, keeps older orders reachable */}
               {((ordersQuery.data as any)?.totalPages ?? 1) > 1 && (
                 <div className="flex flex-wrap items-center justify-center gap-3 mt-5 pb-2">
                    <button
                      type="button"
                      disabled={page <= 1 || ordersQuery.isFetching}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border bg-white text-slate-600 hover:border-slate-300 hover:shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      ← Précédent
                    </button>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 px-3 py-2 bg-slate-100 rounded-xl">
                      Page {page} / {(ordersQuery.data as any)?.totalPages} · {(ordersQuery.data as any)?.total} commandes
                    </span>
                    <button
                      type="button"
                      disabled={page >= ((ordersQuery.data as any)?.totalPages ?? 1) || ordersQuery.isFetching}
                      onClick={() => setPage(p => p + 1)}
                      className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border bg-white text-slate-600 hover:border-slate-300 hover:shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Suivant →
                    </button>
                 </div>
               )}
            </div>
          )}
        </main>
      </div>
      {/* Mobile Bottom Navigation Bar */}
      {isMobile && (
        <div className="fixed bottom-0 inset-x-0 h-16 bg-white/95 backdrop-blur-md border-t flex items-center justify-around px-4 z-[40] shadow-lg">
          {[
            { id: 'orders-all', label: 'Toutes', icon: List },
            { id: 'orders-new', label: 'Nouvelles', icon: Inbox },
            { id: 'inventory-stock', label: 'Stock', icon: Warehouse },
            { id: 'salary-details', label: 'Salaire', icon: Banknote },
          ].map((tab) => {
            const isActive = activeSubModule === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveSubModule(tab.id);
                  if (tab.id === 'salary-details') {
                    setActiveModule('performance');
                  } else if (tab.id === 'inventory-stock') {
                    setActiveModule('inventory');
                  } else {
                    setActiveModule('orders');
                  }
                }}
                className="flex flex-col items-center justify-center flex-1 py-1 gap-1"
              >
                <tab.icon className={cn("size-5 transition-all", isActive ? "text-indigo-600 scale-110 font-bold" : "text-slate-400")} />
                <span className={cn("text-[9px] font-bold tracking-tight", isActive ? "text-indigo-600 font-black" : "text-slate-400")}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <ManualOrderModal isOpen={isCreatingOrder} setIsOpen={setIsCreatingOrder} />
      <DuplicateHistoryModal
        isOpen={!!selectedDuplicateOrder}
        onClose={() => setSelectedDuplicateOrder(null)}
        order={selectedDuplicateOrder}
        onUnmergeSuccess={() => ordersQuery.refetch()}
      />
    </div>
  );
}
