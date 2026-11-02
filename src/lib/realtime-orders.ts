/**
 * Real-time order event bus for instant synchronization between
 * confirmation agents (agent-dashboard) and administrators (orders-page / live-orders-bar).
 * 
 * Uses the Web BroadcastChannel API for zero-latency cross-tab communication
 * plus window-level custom events for same-page components.
 */

export interface RealtimeOrderEvent {
  type: 'ORDER_UPDATED' | 'ORDER_CONFIRMED' | 'ORDER_DISPATCHED' | 'ORDER_STATUS_CHANGED';
  orderId?: string;
  orderNumber?: string | number;
  status?: string;
  trackingNumber?: string;
  storeId?: string;
  customerName?: string;
  total?: number;
  timestamp: number;
}

const BROADCAST_CHANNEL_NAME = 'azzougshop_orders_realtime_sync';
const LOCAL_EVENT_NAME = 'azzougshop_orders_realtime_event';

export function broadcastOrderChange(
  event: Omit<RealtimeOrderEvent, 'timestamp'>
): void {
  if (typeof window === 'undefined') return;

  const payload: RealtimeOrderEvent = {
    ...event,
    timestamp: Date.now(),
  };

  // 1. Cross-tab sync via BroadcastChannel
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channel.postMessage(payload);
      channel.close();
    }
  } catch (err) {
    // Graceful fallback if BroadcastChannel is blocked
    console.debug('[RealtimeOrders] BroadcastChannel postMessage error:', err);
  }

  // 2. Same-tab sync via CustomEvent
  try {
    window.dispatchEvent(
      new CustomEvent<RealtimeOrderEvent>(LOCAL_EVENT_NAME, { detail: payload })
    );
  } catch (err) {
    console.debug('[RealtimeOrders] window event dispatch error:', err);
  }
}

export function subscribeToOrderChanges(
  callback: (event: RealtimeOrderEvent) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  let channel: BroadcastChannel | null = null;

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent<RealtimeOrderEvent>) => {
        if (event.data && typeof event.data === 'object') {
          callback(event.data);
        }
      };
    }
  } catch (err) {
    console.debug('[RealtimeOrders] BroadcastChannel listener error:', err);
  }

  const handleCustomEvent = (e: Event) => {
    const custom = e as CustomEvent<RealtimeOrderEvent>;
    if (custom.detail) {
      callback(custom.detail);
    }
  };

  window.addEventListener(LOCAL_EVENT_NAME, handleCustomEvent);

  return () => {
    if (channel) {
      try {
        channel.close();
      } catch {}
    }
    window.removeEventListener(LOCAL_EVENT_NAME, handleCustomEvent);
  };
}
