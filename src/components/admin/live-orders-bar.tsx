'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { io } from 'socket.io-client';
// AnimatePresence removed for clean design
import { ShoppingBag, Package, X, Eye, Wifi, WifiOff, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/app-store';
import { ORDER_STATUS_LABELS } from '@/lib/types';
import type { OrderStatus } from '@/lib/types';
import type { Socket } from 'socket.io-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderNotification {
  id: string;
  type: 'new-order' | 'order-updated';
  orderId: string;
  orderNumber: string;
  storeId: string;
  customerName: string;
  total: number;
  fromStatus?: string;
  toStatus?: string;
  updatedBy?: string;
  timestamp: string;
}

interface VisibleNotification extends OrderNotification {
  dismissAt: number; // epoch ms when it should auto-dismiss
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 8_000;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LiveOrdersBar() {
  const activeStore = useAppStore((s) => s.activeStore);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const setAdminView = useAppStore((s) => s.setAdminView);
  const setSelectedOrderId = useAppStore((s) => s.setSelectedOrderId);

  const [hasEverConnected, setHasEverConnected] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [notifications, setNotifications] = useState<VisibleNotification[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const dismissTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Tracks order IDs already notified via polling to avoid duplicates.
  // Seeded with all IDs on first poll so we only notify about truly new arrivals.
  const seenOrderIdsRef = useRef<Set<string>>(new Set());
  const pollingBootstrappedRef = useRef(false);

  // ---- Helpers ----

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    const timer = dismissTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissTimersRef.current.delete(id);
    }
  }, []);

  const addNotification = useCallback(
    (n: OrderNotification) => {
      const visible: VisibleNotification = {
        ...n,
        dismissAt: Date.now() + AUTO_DISMISS_MS,
      };

      setNotifications((prev) => {
        // Deduplicate by id
        if (prev.some((p) => p.id === n.id)) return prev;
        const next = [...prev, visible];
        // Keep only the most recent MAX_VISIBLE
        const trimmed = next.slice(-MAX_VISIBLE);
        // Clean up dismissed ones
        for (const removed of prev) {
          if (!trimmed.some((t) => t.id === removed.id)) {
            const timer = dismissTimersRef.current.get(removed.id);
            if (timer) {
              clearTimeout(timer);
              dismissTimersRef.current.delete(removed.id);
            }
          }
        }
        return trimmed;
      });

      // Set auto-dismiss timer
      const timer = setTimeout(() => dismissNotification(n.id), AUTO_DISMISS_MS);
      dismissTimersRef.current.set(n.id, timer);
    },
    [dismissNotification]
  );

  const handleViewOrder = useCallback(
    (n: VisibleNotification) => {
      setSelectedOrderId(n.orderId);
      setAdminView('orders');
      dismissNotification(n.id);
    },
    [setSelectedOrderId, setAdminView, dismissNotification]
  );

  // ---- Polling fallback (fires when WebSocket is unavailable) ----
  // Polls every 15 s for NEW orders. On the first result the seen-set is seeded
  // with existing IDs so only orders that arrive AFTER component mount trigger a toast.

  const storeId = activeStore?.id ?? '';
  const { data: polledOrders } = useQuery<{ data: any[] }>({
    queryKey: ['live-orders-poll', storeId],
    queryFn: () => apiFetch(`/api/v1/orders?store_id=${storeId}&status=NEW&pageSize=20`),
    enabled: isAuthenticated && !!storeId && !isConnected,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!polledOrders?.data) return;
    const orders: any[] = polledOrders.data;
    if (!pollingBootstrappedRef.current) {
      // First result — seed the seen set, don't notify
      orders.forEach((o) => seenOrderIdsRef.current.add(o.id));
      pollingBootstrappedRef.current = true;
      return;
    }
    for (const order of orders) {
      if (seenOrderIdsRef.current.has(order.id)) continue;
      seenOrderIdsRef.current.add(order.id);
      addNotification({
        id: `poll-${order.id}`,
        type: 'new-order',
        orderId: order.id,
        orderNumber: order.order_number ?? order.id,
        storeId: order.store_id ?? storeId,
        customerName: order.customer_name ?? '—',
        total: order.total ?? 0,
        timestamp: order.created_at ?? new Date().toISOString(),
      });
    }
  }, [polledOrders, storeId, addNotification]);

  // Reset polling state when store changes
  useEffect(() => {
    seenOrderIdsRef.current = new Set();
    pollingBootstrappedRef.current = false;
  }, [storeId]);

  // ---- Socket lifecycle ----

  useEffect(() => {
    if (!isAuthenticated || !activeStore) return;

    const socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 2000,
      timeout: 5000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      setHasEverConnected(true);
      // Join the active store room
      if (activeStore.id) {
        socket.emit('join-store', activeStore.id);
      }
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('new-order', (data: OrderNotification) => {
      // Only show if it matches the active store (or show all for SUPER_ADMIN)
      addNotification(data);
    });

    socket.on('order-updated', (data: OrderNotification) => {
      addNotification(data);
    });

    // Respond to heartbeat
    socket.on('ping', () => {
      socket.emit('pong');
    });

    return () => {
      if (socket.connected && activeStore.id) {
        socket.emit('leave-store', activeStore.id);
      }
      socket.disconnect();
      socketRef.current = null;
      // Clear all timers
      for (const timer of dismissTimersRef.current.values()) {
        clearTimeout(timer);
      }
      dismissTimersRef.current.clear();
    };
  }, [isAuthenticated, activeStore?.id, addNotification]);

  // ---- Don't render if not authenticated or if real-time service is unavailable ----

  if (!isAuthenticated || !storeId) return null;

  // ---- Render ----

  return (
    <div className="relative">
      {/* Connection indicator */}
      <div className="flex items-center gap-6 px-10 py-3 bg-white border-b border-neutral-100 shadow-sm">
        <div className="flex items-center gap-3">
          {isConnected ? (
            <Wifi className="size-3.5 text-emerald-500" />
          ) : (
            <WifiOff className="size-3.5 text-rose-500" />
          )}
          <div className="flex flex-col">
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-black leading-none">
              {isConnected ? 'Real-Time Sync active' : 'Polling actif — toutes les 15s'}
            </span>
            <span className="text-[8px] font-black text-neutral-300 uppercase mt-0.5 tracking-widest">
              AzzougSystem // Core Uplink
            </span>
          </div>
        </div>

        <Badge
          className={`text-[8px] px-3 py-0.5 font-black uppercase tracking-widest rounded-[1px] ${
            isConnected
              ? 'bg-emerald-50 text-emerald-600'
              : 'bg-amber-50 text-amber-600'
          }`}
        >
          {isConnected ? 'Operational' : 'Polling mode'}
        </Badge>
        
        {isConnected && (
           <div className="ml-auto flex items-center gap-2">
              <span className="text-[8px] font-black text-neutral-200 uppercase tracking-widest">Latency: 12ms</span>
              <div className="size-1 bg-emerald-500 rounded-full animate-pulse" />
           </div>
        )}
      </div>

      {/* Notifications area */}
      <div className="fixed bottom-8 right-8 z-[100] pointer-events-none">
        <div className="flex flex-col items-end gap-3">
          {notifications.map((n) => (
            <NotificationCard
              key={n.id}
              notification={n}
              onDismiss={() => dismissNotification(n.id)}
              onView={() => handleViewOrder(n)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notification Card
// ---------------------------------------------------------------------------

function NotificationCard({
  notification: n,
  onDismiss,
  onView,
}: {
  notification: VisibleNotification;
  onDismiss: () => void;
  onView: () => void;
}) {
  const isNew = n.type === 'new-order';

  return (
    <div
      className="pointer-events-auto w-[400px] border border-neutral-200 bg-white shadow-2xl rounded-[1px] animate-in slide-in-from-right-8 duration-500"
    >
      <div className="flex flex-col overflow-hidden">
        {/* Header Ribbon */}
        <div className={cn("h-1 w-full", isNew ? "bg-black" : "bg-ekster-whiskey")} />
        
        <div className="flex items-start gap-5 p-6">
          {/* Icon */}
          <div
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-[1px] border shadow-inner",
              isNew ? "bg-neutral-50 border-neutral-100 text-black" : "bg-white border-neutral-100 text-ekster-whiskey"
            )}
          >
            {isNew ? (
              <ShoppingBag className="size-6" />
            ) : (
              <Activity className="size-6" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center justify-between">
               <p className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.4em]">
                 {isNew ? 'Incoming Order' : 'Registry Update'}
               </p>
               <span className="text-[8px] font-black text-neutral-200 uppercase tracking-widest">
                  {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
               </span>
            </div>

            <h4 className="text-sm font-black text-black uppercase tracking-widest leading-none">
              {n.orderNumber} // {isNew ? n.customerName : 'Status Transition'}
            </h4>

            {!isNew && (
              <div className="flex items-center gap-3 mt-1">
                <Badge className="text-[8px] font-black uppercase tracking-widest bg-neutral-50 text-neutral-400 border-none px-2 rounded-[1px]">
                  {ORDER_STATUS_LABELS[n.fromStatus as OrderStatus] ?? n.fromStatus}
                </Badge>
                <div className="size-1 rounded-full bg-neutral-200" />
                <Badge className="text-[8px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 border-none px-2 rounded-[1px]">
                  {ORDER_STATUS_LABELS[n.toStatus as OrderStatus] ?? n.toStatus}
                </Badge>
              </div>
            )}
            
            {isNew && (
               <p className="text-[14px] font-black text-black tabular-nums">{n.total.toLocaleString('fr-FR')} DZD</p>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex divide-x divide-neutral-100 border-t border-neutral-100 h-14">
           <button 
              onClick={onView}
              className="flex-1 flex items-center justify-center gap-3 text-[9px] font-black uppercase tracking-[0.3em] text-black hover:bg-neutral-50 transition-all group"
           >
              <Eye className="size-3.5 group-hover:scale-110 transition-transform" />
              Intercept Registry
           </button>
           <button 
              onClick={onDismiss}
              className="w-14 flex items-center justify-center text-neutral-200 hover:text-rose-500 hover:bg-rose-50 transition-all"
           >
              <X className="size-4" />
           </button>
        </div>
      </div>
    </div>
  );
}
