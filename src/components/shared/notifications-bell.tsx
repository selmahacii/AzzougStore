'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, PackageCheck, PhoneMissed, AlarmClock, ShoppingCart, UserPlus, AlertTriangle, Copy } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string | null;
  order_id: string | null;
  is_read: boolean;
  created_at: string | null;
}

const TYPE_ICONS: Record<string, { icon: any; color: string }> = {
  ORDER_ASSIGNED:   { icon: UserPlus,      color: 'text-blue-500 bg-blue-50' },
  REMINDER_DUE:     { icon: AlarmClock,    color: 'text-amber-500 bg-amber-50' },
  NRP_FOLLOWUP:     { icon: PhoneMissed,   color: 'text-rose-500 bg-rose-50' },
  CART_RECOVERED:   { icon: ShoppingCart,  color: 'text-emerald-500 bg-emerald-50' },
  ORDER_DELIVERED:  { icon: PackageCheck,  color: 'text-green-600 bg-green-50' },
  NOEST_SYNC_ERROR: { icon: AlertTriangle, color: 'text-red-500 bg-red-50' },
  DUPLICATE_MERGED: { icon: Copy,          color: 'text-amber-600 bg-amber-50' },
};

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

export function NotificationsBell({ onOpenOrder }: { onOpenOrder?: (orderId: string) => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  // Scoped by user id: without this, switching accounts in the same tab
  // (logout/login without a full reload) could briefly render the previous
  // user's cached notifications — each profile must only ever see its own.
  const userId = useAppStore(s => s.user?.id);

  const query = useQuery<{ success: boolean; data: NotificationItem[]; unread: number }>({
    queryKey: ['notifications', userId],
    queryFn: () => apiFetch('/api/v1/notifications?limit=30'),
    enabled: !!userId,
    refetchInterval: 60_000,
  });

  const markAllMutation = useMutation({
    mutationFn: () => apiFetch('/api/v1/notifications/read-all', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', userId] }),
  });

  const markOneMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', userId] }),
  });

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const items = query.data?.data ?? [];
  const unread = query.data?.unread ?? 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        title="Notifications"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center leading-none">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[360px] max-w-[92vw] bg-white border border-slate-200 rounded-2xl shadow-2xl z-[80] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/60">
            <span className="text-xs font-black uppercase tracking-widest text-slate-600">
              Notifications {unread > 0 && <span className="text-rose-500">({unread})</span>}
            </span>
            {unread > 0 && (
              <button
                onClick={() => markAllMutation.mutate()}
                className="flex items-center gap-1 text-[10px] font-bold text-indigo-500 hover:text-indigo-700"
              >
                <CheckCheck className="size-3.5" /> Tout marquer lu
              </button>
            )}
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-50">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs font-bold text-slate-300">
                Aucune notification
              </div>
            ) : items.map(n => {
              const meta = TYPE_ICONS[n.type] ?? { icon: Bell, color: 'text-slate-400 bg-slate-50' };
              const Icon = meta.icon;
              return (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.is_read) markOneMutation.mutate(n.id);
                    if (n.order_id && onOpenOrder) { onOpenOrder(n.order_id); setOpen(false); }
                  }}
                  className={cn(
                    'w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50/80 transition-colors',
                    !n.is_read && 'bg-indigo-50/40'
                  )}
                >
                  <span className={cn('size-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5', meta.color)}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-xs truncate', n.is_read ? 'font-bold text-slate-600' : 'font-black text-slate-900')}>
                      {n.title}
                    </span>
                    {n.message && (
                      <span className="block text-[10px] text-slate-400 font-medium mt-0.5 line-clamp-2">{n.message}</span>
                    )}
                    <span className="block text-[9px] font-bold text-slate-300 uppercase mt-1">{timeAgo(n.created_at)}</span>
                  </span>
                  {!n.is_read && <span className="size-2 rounded-full bg-indigo-500 shrink-0 mt-1.5" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
