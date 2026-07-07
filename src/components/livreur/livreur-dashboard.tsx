'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package, Phone, MapPin, Banknote, LogOut, CheckCircle,
  RotateCcw, Truck, Loader2, Copy, Search, User as UserIcon,
  Calendar, StickyNote, Boxes, X, Navigation,
  Hash, MessageSquare, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';
import { formatPrice, formatOrderRef } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Order } from '@/lib/types';
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '@/lib/types';
import { OrderTypeBadge } from '@/components/shared/order-type-badge';
import LivreurInventory from '@/components/livreur/livreur-inventory';

/**
 * Delivery-agent (LIVREUR) dashboard.
 * Backend scopes /orders to livreur_id = me — driver only ever sees
 * the parcels explicitly assigned to them. Two sections: deliveries and a
 * read-only stock view (the full admin products/inventory tooling —
 * pricing, suppliers, purchases, warehouses — isn't relevant to a driver).
 */
export default function LivreurDashboard() {
  const { user, setAppView, clearUser, activeStore, allStores, setActiveStore } = useAppStore();
  const [section, setSection] = useState<'deliveries' | 'stock'>('deliveries');
  const queryClient = useQueryClient();

  const handleLogout = async () => {
    try { await apiFetch('/api/v1/auth', { method: 'DELETE' }); } catch { /* ignore */ }
    clearUser();
    queryClient.clear();
    setAppView('storefront');
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-24">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-slate-900 text-white px-4 sm:px-6 h-16 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <div className="size-9 bg-cyan-500 rounded-xl flex items-center justify-center font-black shrink-0">
            <Truck className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-black tracking-tight leading-none">ESPACE LIVREUR</p>
            <p className="text-[10px] font-bold text-slate-400 mt-0.5 truncate">{user?.name}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {allStores.length > 1 && (
            <select
              value={activeStore?.id || ''}
              onChange={e => { const s = allStores.find(s => s.id === e.target.value); if (s) setActiveStore(s); }}
              className="hidden sm:block text-xs font-bold bg-white/10 border border-white/10 rounded-lg px-2.5 py-1.5 text-white outline-none cursor-pointer max-w-[160px] truncate"
              title="Changer de boutique"
            >
              {allStores.map(s => (
                <option key={s.id} value={s.id} className="text-slate-900">{s.name}</option>
              ))}
            </select>
          )}
          <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-400 transition-colors" title="Déconnexion">
            <LogOut className="size-5" />
          </button>
        </div>
      </header>

      {/* Mobile boutique selector */}
      {allStores.length > 1 && (
        <div className="sm:hidden bg-slate-800 px-4 py-2 flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 shrink-0">Boutique :</span>
          <select
            value={activeStore?.id || ''}
            onChange={e => { const s = allStores.find(s => s.id === e.target.value); if (s) setActiveStore(s); }}
            className="flex-1 text-xs font-bold bg-white/10 border border-white/10 rounded-lg px-2 py-1 text-white outline-none"
          >
            {allStores.map(s => (
              <option key={s.id} value={s.id} className="text-slate-900">{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── Section nav ────────────────────────────────────────────────── */}
      <nav className="bg-white border-b sticky top-16 z-30">
        <div className="max-w-3xl mx-auto px-4 flex items-center gap-1 py-2 overflow-x-auto">
          {([
            ['deliveries', 'Mes Livraisons', Truck],
            ['stock',      'Stock',          Boxes],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={cn(
                'flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all whitespace-nowrap shrink-0',
                section === id ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:bg-slate-50'
              )}
            >
              <Icon className="size-4" />
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{label === 'Mes Livraisons' ? 'Livraisons' : label}</span>
            </button>
          ))}
        </div>
      </nav>

      {section === 'deliveries' && <LivreurDeliveries />}
      {section === 'stock'      && <LivreurInventory />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Deliveries section
   ═══════════════════════════════════════════════════════════════════════════ */

function LivreurDeliveries() {
  const { user } = useAppStore();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'todo' | 'done'>('todo');
  const [search, setSearch] = useState('');
  const [wilayaFilter, setWilayaFilter] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Poll every 5 s — confirmatrice dashboard also polls; any status change
  // made by one side becomes visible to the other within ~5 s.
  const ordersQuery = useQuery<{ data: Order[] }>({
    queryKey: ['livreur-orders', user?.id],
    queryFn: () => apiFetch('/api/v1/orders?pageSize=200'),
    enabled: !!user?.id,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
  });

  const statusMutation = useMutation({
    mutationFn: ({ orderId, status, note }: { orderId: string; status: string; note?: string }) =>
      apiFetch(`/api/v1/orders/${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          ...(note?.trim() ? { notes: note.trim() } : {}),
        }),
      }),
    onSuccess: (_res, { status }) => {
      toast.success(
        status === 'DELIVERED' ? 'Livraison confirmée ✅'
          : status === 'SHIPPED' ? 'Colis pris en charge — en route 🚚'
          : 'Retour enregistré',
      );
      setSelectedOrder(null);
      queryClient.invalidateQueries({ queryKey: ['livreur-orders'] });
    },
    onError: (err: any) => toast.error(err.message || 'Erreur lors de la mise à jour'),
  });

  const all = ordersQuery.data?.data ?? [];

  // An order is "todo" as long as it hasn't reached a terminal state.
  // We deliberately show NRP/Abandoned/etc. so the driver sees everything
  // assigned to them, even orders that still need confirmatrice action.
  const todoAll = all.filter(o => !['DELIVERED', 'RETURNED'].includes(o.status));
  const doneAll = all.filter(o => ['DELIVERED', 'RETURNED'].includes(o.status));
  const inTransit = todoAll.filter(o => o.status === 'SHIPPED');

  const wilayas = useMemo(
    () => Array.from(new Set(all.map(o => o.customer_wilaya).filter((w): w is string => !!w))).sort(),
    [all],
  );

  const applyFilters = (list: Order[]) => list.filter(o => {
    if (wilayaFilter && o.customer_wilaya !== wilayaFilter) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      o.customer_name?.toLowerCase().includes(q) ||
      o.customer_phone?.includes(q) ||
      o.order_number?.toLowerCase().includes(q) ||
      o.tracking_number?.toLowerCase().includes(q)
    );
  });

  const todo = applyFilters(todoAll);
  const done = applyFilters(doneAll);
  const shown = tab === 'todo' ? todo : done;
  const collectedTotal = doneAll.filter(o => o.status === 'DELIVERED').reduce((a, o) => a + (o.total || 0), 0);

  return (
    <>
      <main className="max-w-3xl mx-auto p-4 space-y-4">
        {/* ── KPI strip ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-white border rounded-2xl p-3 text-center">
            <p className="text-[8px] font-black uppercase tracking-wider text-slate-400 leading-tight">À livrer</p>
            <p className="text-2xl font-black text-cyan-600 tabular-nums mt-1">
              {todoAll.filter(o => o.status !== 'SHIPPED').length}
            </p>
          </div>
          <div className="bg-white border rounded-2xl p-3 text-center">
            <p className="text-[8px] font-black uppercase tracking-wider text-slate-400 leading-tight">En route</p>
            <p className="text-2xl font-black text-blue-600 tabular-nums mt-1">{inTransit.length}</p>
          </div>
          <div className="bg-white border rounded-2xl p-3 text-center">
            <p className="text-[8px] font-black uppercase tracking-wider text-slate-400 leading-tight">Livrées</p>
            <p className="text-2xl font-black text-green-600 tabular-nums mt-1">
              {doneAll.filter(o => o.status === 'DELIVERED').length}
            </p>
          </div>
          <div className="bg-white border rounded-2xl p-3 text-center">
            <p className="text-[8px] font-black uppercase tracking-wider text-slate-400 leading-tight">Encaissé</p>
            <p className="text-xs font-black text-slate-800 tabular-nums mt-1.5">{formatPrice(collectedTotal)}</p>
          </div>
        </div>

        {/* ── Filters ────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {/* Tab switcher */}
            <div className="flex items-center gap-0.5 bg-white border p-1 rounded-2xl shrink-0">
              {([['todo', `À faire (${todoAll.length})`], ['done', `Historique (${doneAll.length})`]] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={cn(
                    'px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap',
                    tab === id ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:bg-slate-50',
                  )}
                >{label}</button>
              ))}
            </div>
            {/* Wilaya filter */}
            {wilayas.length > 1 && (
              <select
                value={wilayaFilter}
                onChange={e => setWilayaFilter(e.target.value)}
                className="h-10 px-3 rounded-xl border bg-white text-xs font-bold flex-1 min-w-0 outline-none focus:border-cyan-400"
              >
                <option value="">Toutes les wilayas</option>
                {wilayas.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            )}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-300 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Client, téléphone, n° commande..."
              className="w-full h-11 pl-9 pr-3 rounded-xl border bg-white text-sm font-medium outline-none focus:border-cyan-400"
            />
          </div>
        </div>

        {/* ── Orders list ────────────────────────────────────────────── */}
        {ordersQuery.isLoading ? (
          <div className="flex flex-col items-center py-20 gap-3">
            <Loader2 className="size-8 animate-spin text-slate-200" />
          </div>
        ) : shown.length === 0 ? (
          <div className="bg-white border border-dashed rounded-3xl py-20 text-center">
            <Package className="size-10 text-slate-200 mx-auto" />
            <p className="mt-3 text-xs font-bold text-slate-300 uppercase tracking-widest">
              {all.length === 0 ? 'Aucune livraison assignée' : 'Aucun résultat pour ce filtre'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {shown.map(order => (
              <OrderCard
                key={order.id}
                order={order}
                tab={tab}
                isPending={statusMutation.isPending}
                onQuickStatus={(orderId, status) => statusMutation.mutate({ orderId, status })}
                onOpen={() => setSelectedOrder(order)}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── Order detail drawer ────────────────────────────────────── */}
      {selectedOrder && (
        <OrderDetailDrawer
          order={selectedOrder}
          isPending={statusMutation.isPending}
          onClose={() => setSelectedOrder(null)}
          onStatusChange={(orderId, status, note) => statusMutation.mutate({ orderId, status, note })}
        />
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   OrderCard — compact summary card, tap to open drawer
   ═══════════════════════════════════════════════════════════════════════════ */

interface OrderCardProps {
  order: Order;
  tab: 'todo' | 'done';
  isPending: boolean;
  onQuickStatus: (orderId: string, status: string) => void;
  onOpen: () => void;
}

function OrderCard({ order, tab, isPending, onQuickStatus, onOpen }: OrderCardProps) {
  const canShip    = order.status === 'CONFIRMED';
  const canDeliver = order.status === 'SHIPPED';
  const canReturn  = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED'].includes(order.status);
  const hasActions = canShip || canDeliver || canReturn;

  return (
    <div
      className="bg-white border rounded-2xl overflow-hidden shadow-sm active:scale-[0.99] transition-transform cursor-pointer"
      onClick={onOpen}
    >
      {/* Top row — badges + ref */}
      <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <OrderTypeBadge order={order} />
          <span className={cn('px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider', ORDER_STATUS_COLORS[order.status])}>
            {ORDER_STATUS_LABELS[order.status]}
          </span>
        </div>
        <span className="text-xs font-black text-slate-600 shrink-0 mt-0.5 whitespace-nowrap">{formatOrderRef(order, 'admin')}</span>
      </div>

      {/* Customer row */}
      <div className="px-4 pb-3 flex items-start gap-3">
        <div className="size-10 rounded-xl bg-cyan-50 border border-cyan-100 flex items-center justify-center shrink-0">
          <UserIcon className="size-4 text-cyan-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-slate-800 leading-tight truncate">{order.customer_name}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs font-bold text-cyan-700">{order.customer_phone}</span>
            {order.customer_phone2 && (
              <span className="text-xs text-slate-400">· {order.customer_phone2}</span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <MapPin className="size-3 text-slate-300 shrink-0" />
            <span className="text-[11px] text-slate-500 truncate">
              {[order.customer_commune, order.customer_wilaya].filter(Boolean).join(', ')}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-black text-slate-900 tabular-nums">{formatPrice(order.total)}</p>
          <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">à encaisser</p>
        </div>
      </div>

      {/* Items preview */}
      <div className="mx-4 mb-3 p-2.5 bg-slate-50 rounded-xl">
        {order.items?.slice(0, 2).map((item, i) => (
          <p key={i} className="text-[11px] font-bold text-slate-600 truncate">
            · {item.product_name}
            {item.variant_details && typeof item.variant_details === 'object' && (item.variant_details as any).variant
              ? ` [${(item.variant_details as any).variant}]` : ''} × {item.quantity}
          </p>
        ))}
        {(order.items?.length ?? 0) > 2 && (
          <p className="text-[10px] text-slate-400 font-bold mt-0.5">+{order.items!.length - 2} autre(s)…</p>
        )}
      </div>

      {/* Confirmatrice note preview */}
      {order.notes && (
        <div className="mx-4 mb-3 p-2.5 bg-amber-50 border border-amber-100 rounded-xl flex items-start gap-1.5">
          <StickyNote className="size-3 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-[11px] font-bold text-amber-700 line-clamp-1">{order.notes}</p>
        </div>
      )}

      {/* Action bar */}
      {tab === 'todo' && (
        <div
          className="border-t border-slate-100 px-4 py-3 flex items-center justify-between gap-2"
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={onOpen}
            className="flex items-center gap-1 text-[11px] font-black text-slate-400 hover:text-cyan-600 transition-colors"
          >
            Voir détails <ChevronRight className="size-3.5" />
          </button>

          {!hasActions ? (
            <p className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">
              ⏳ En attente confirmatrice
            </p>
          ) : (
            <div className={cn('flex items-center gap-2', isPending && 'opacity-50 pointer-events-none')}>
              {canShip && (
                <button
                  onClick={() => onQuickStatus(order.id, 'SHIPPED')}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl bg-cyan-600 text-white text-[10px] font-black uppercase shadow-sm hover:bg-cyan-700 transition-colors"
                >
                  <Truck className="size-3.5" /> En route
                </button>
              )}
              {canDeliver && (
                <button
                  onClick={() => onQuickStatus(order.id, 'DELIVERED')}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-500 text-white text-[10px] font-black uppercase shadow-sm hover:bg-emerald-600 transition-colors"
                >
                  <CheckCircle className="size-3.5" /> Livrée ✓
                </button>
              )}
              {canReturn && (
                <button
                  onClick={() => onQuickStatus(order.id, 'RETURNED')}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 text-[10px] font-black uppercase hover:bg-rose-100 transition-colors"
                >
                  <RotateCcw className="size-3.5" /> Retour
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   OrderDetailDrawer — full bottom sheet with complete order info + actions
   ═══════════════════════════════════════════════════════════════════════════ */

interface DrawerProps {
  order: Order;
  isPending: boolean;
  onClose: () => void;
  onStatusChange: (orderId: string, status: string, note?: string) => void;
}

function OrderDetailDrawer({ order, isPending, onClose, onStatusChange }: DrawerProps) {
  const [note, setNote] = useState('');

  const canShip    = order.status === 'CONFIRMED';
  const canDeliver = order.status === 'SHIPPED';
  const canReturn  = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED'].includes(order.status);
  const hasActions = canShip || canDeliver || canReturn;
  const isTerminal = ['DELIVERED', 'RETURNED'].includes(order.status);

  // Build a Google Maps search URL from the customer address
  const mapsQuery = [order.customer_address, order.customer_commune, order.customer_wilaya, 'Algérie']
    .filter(Boolean).join(', ');

  const handleStatus = (status: string) => onStatusChange(order.id, status, note);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet — slides up from bottom */}
      <div className="relative w-full bg-white rounded-t-3xl max-h-[92dvh] flex flex-col shadow-2xl sm:max-w-lg sm:mx-auto sm:mb-4 sm:rounded-3xl">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>

        {/* Sheet header */}
        <div className="px-5 pt-2 pb-4 border-b border-slate-100 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <OrderTypeBadge order={order} />
                <span className={cn('px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider', ORDER_STATUS_COLORS[order.status])}>
                  {ORDER_STATUS_LABELS[order.status]}
                </span>
                <span className="text-sm font-black text-slate-700">{formatOrderRef(order, 'admin')}</span>
              </div>
              <div className="flex items-center gap-1 mt-1.5 text-[10px] font-bold text-slate-400">
                <Calendar className="size-3" />
                {new Date(order.updated_at || order.created_at).toLocaleDateString('fr-FR', {
                  day: 'numeric', month: 'long', year: 'numeric',
                })}
                {' · '}
                {new Date(order.updated_at || order.created_at).toLocaleTimeString('fr-FR', {
                  hour: '2-digit', minute: '2-digit',
                })}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 shrink-0 -mr-1 transition-colors"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* ── Client ─────────────────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-400">Client</h3>

            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl">
              <div className="size-11 rounded-xl bg-cyan-100 flex items-center justify-center shrink-0">
                <UserIcon className="size-5 text-cyan-600" />
              </div>
              <div>
                <p className="text-base font-black text-slate-800">{order.customer_name}</p>
                {order.assignee?.name && (
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5">Assigné par {order.assignee.name}</p>
                )}
              </div>
            </div>

            {/* Phone 1 — large tap target for mobile */}
            <a
              href={`tel:${order.customer_phone}`}
              className="flex items-center gap-3 p-4 bg-white border border-slate-100 rounded-2xl active:bg-slate-50 transition-colors"
              onClick={e => e.stopPropagation()}
            >
              <div className="size-10 bg-green-100 rounded-xl flex items-center justify-center shrink-0">
                <Phone className="size-5 text-green-600" />
              </div>
              <div>
                <p className="text-lg font-black text-slate-800 tracking-wider">{order.customer_phone}</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Appuyer pour appeler</p>
              </div>
            </a>

            {/* Phone 2 */}
            {order.customer_phone2 && (
              <a
                href={`tel:${order.customer_phone2}`}
                className="flex items-center gap-3 p-4 bg-white border border-slate-100 rounded-2xl active:bg-slate-50 transition-colors"
                onClick={e => e.stopPropagation()}
              >
                <div className="size-10 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
                  <Phone className="size-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-lg font-black text-slate-800 tracking-wider">{order.customer_phone2}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Téléphone secondaire</p>
                </div>
              </a>
            )}

            {/* Address + Google Maps */}
            <a
              href={`https://maps.google.com/maps?q=${encodeURIComponent(mapsQuery)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 p-4 bg-white border border-slate-100 rounded-2xl active:bg-slate-50 transition-colors"
              onClick={e => e.stopPropagation()}
            >
              <div className="size-10 bg-rose-100 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                <Navigation className="size-5 text-rose-500" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800 leading-snug">
                  {order.customer_address || '—'}
                </p>
                <p className="text-sm font-black text-rose-600 mt-0.5">
                  {[order.customer_commune, order.customer_wilaya].filter(Boolean).join(', ')}
                </p>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">
                  Naviguer avec Google Maps →
                </p>
              </div>
            </a>
          </section>

          {/* ── Articles ───────────────────────────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-400">Articles</h3>
            {order.items?.map((item, i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-white border border-slate-100 rounded-xl">
                <div className="size-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                  <Package className="size-4 text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{item.product_name}</p>
                  {item.variant_details && typeof item.variant_details === 'object' && (item.variant_details as any).variant && (
                    <p className="text-[10px] font-bold text-slate-500">[{(item.variant_details as any).variant}]</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-slate-700">× {item.quantity}</p>
                  <p className="text-[10px] text-slate-400 tabular-nums">{formatPrice(item.unit_price)}</p>
                </div>
              </div>
            ))}
          </section>

          {/* ── Montant à encaisser ─────────────────────────────────── */}
          <div className="flex items-center justify-between p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
            <div className="flex items-center gap-2">
              <Banknote className="size-5 text-emerald-500 shrink-0" />
              <span className="text-sm font-black text-slate-700 uppercase tracking-wide">À encaisser</span>
            </div>
            <span className="text-xl font-black text-emerald-700 tabular-nums">{formatPrice(order.total)}</span>
          </div>

          {/* ── Note confirmatrice ──────────────────────────────────── */}
          {order.notes && (
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-3">
              <StickyNote className="size-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-black uppercase text-amber-600 tracking-wider mb-1">
                  Note confirmatrice
                </p>
                <p className="text-sm font-bold text-amber-800 leading-relaxed">{order.notes}</p>
              </div>
            </div>
          )}

          {/* ── Tracking number ─────────────────────────────────────── */}
          {order.tracking_number && (
            <div className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl">
              <div className="flex items-center gap-2 min-w-0">
                <Hash className="size-4 text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">N° de suivi</p>
                  <p className="text-sm font-black text-slate-700 font-mono truncate">{order.tracking_number}</p>
                </div>
              </div>
              <button
                onClick={() => { navigator.clipboard?.writeText(order.tracking_number!); toast.success('N° copié'); }}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 shrink-0 transition-colors"
              >
                <Copy className="size-4" />
              </button>
            </div>
          )}

          {/* ── Status action zone ──────────────────────────────────── */}
          {isTerminal ? (
            <div className={cn(
              'p-4 rounded-2xl text-center',
              order.status === 'DELIVERED' ? 'bg-green-50 border border-green-100' : 'bg-rose-50 border border-rose-100',
            )}>
              <p className={cn('text-sm font-black', order.status === 'DELIVERED' ? 'text-green-700' : 'text-rose-700')}>
                {order.status === 'DELIVERED' ? '✅ Livraison terminée' : '↩️ Retour enregistré'}
              </p>
            </div>
          ) : !hasActions ? (
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl text-center">
              <p className="text-sm font-black text-amber-700">⏳ En attente de confirmation par la confirmatrice</p>
              <p className="text-[11px] text-amber-600 font-medium mt-1">
                Cette commande apparaîtra en action dès qu'elle sera confirmée.
              </p>
            </div>
          ) : (
            <section className="space-y-3 pb-2">
              <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-400">Mettre à jour le statut</h3>

              {/* Note de livraison (optionnel) */}
              <div className="relative">
                <MessageSquare className="absolute left-3 top-3.5 size-4 text-slate-300 pointer-events-none" />
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Note de livraison (optionnel) — ex: Client absent, livré au gardien…"
                  rows={2}
                  className="w-full pl-10 pr-3 py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium outline-none focus:border-cyan-400 resize-none"
                />
              </div>

              {/* Action buttons — large, full-width, easy to tap */}
              <div className={cn('grid gap-3', isPending && 'opacity-50 pointer-events-none')}>
                {canShip && (
                  <button
                    onClick={() => handleStatus('SHIPPED')}
                    className="flex items-center justify-center gap-2 w-full h-14 rounded-2xl bg-cyan-600 text-white font-black text-sm uppercase tracking-wide shadow-md hover:bg-cyan-700 active:scale-[0.98] transition-all"
                  >
                    {isPending ? <Loader2 className="size-5 animate-spin" /> : <Truck className="size-5" />}
                    Prise en charge — En route
                  </button>
                )}
                {canDeliver && (
                  <button
                    onClick={() => handleStatus('DELIVERED')}
                    className="flex items-center justify-center gap-2 w-full h-14 rounded-2xl bg-emerald-500 text-white font-black text-sm uppercase tracking-wide shadow-md hover:bg-emerald-600 active:scale-[0.98] transition-all"
                  >
                    {isPending ? <Loader2 className="size-5 animate-spin" /> : <CheckCircle className="size-5" />}
                    Confirmer la livraison ✓
                  </button>
                )}
                {canReturn && (
                  <button
                    onClick={() => handleStatus('RETURNED')}
                    className="flex items-center justify-center gap-2 w-full h-14 rounded-2xl border-2 border-rose-200 bg-rose-50 text-rose-600 font-black text-sm uppercase tracking-wide hover:bg-rose-100 active:scale-[0.98] transition-all"
                  >
                    {isPending ? <Loader2 className="size-5 animate-spin" /> : <RotateCcw className="size-5" />}
                    Échec — Marquer en retour
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
