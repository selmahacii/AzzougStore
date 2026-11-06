'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X, Package, ChevronRight, Clock, CheckCircle2, Truck,
  XCircle, RotateCcw, ShoppingBag, MapPin, Phone, User,
  ArrowLeft, AlertCircle, Loader2, ShieldCheck, LayoutGrid,
  ExternalLink, LogOut, Settings
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useAppStore } from '@/store/app-store';
import { apiFetch } from '@/lib/api-client';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Order } from '@/lib/types';

interface AccountPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  NEW:        { label: 'Nouveau',      color: '#0f172a', bg: '#f1f5f9' },
  CONFIRMED:  { label: 'Confirmé',     color: '#059669', bg: '#ecfdf5' },
  SHIPPED:    { label: 'Expédié',      color: '#2563eb', bg: '#eff6ff' },
  DELIVERED:  { label: 'Livré',        color: '#059669', bg: '#ecfdf5' },
  CANCELLED:  { label: 'Annulé',       color: '#dc2626', bg: '#fef2f2' },
  RETURNED:   { label: 'Retourné',     color: '#dc2626', bg: '#fef2f2' },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_MAP[status] || { label: status, color: '#64748b', bg: '#f8fafc' };
  return (
    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border" 
          style={{ color: meta.color, backgroundColor: meta.bg, borderColor: `${meta.color}20` }}>
      {meta.label}
    </span>
  );
}

function OrderDetail({ order, onBack }: { order: Order; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="h-14 border-b flex items-center px-4 gap-4 bg-slate-50">
        <button onClick={onBack} className="p-1 hover:bg-slate-200 rounded transition-colors">
          <ArrowLeft className="size-4" />
        </button>
        <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Commande #{order.id.slice(-8).toUpperCase()}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8">
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Statut</p>
            <StatusBadge status={order.status} />
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date</p>
            <p className="text-xs font-medium">{new Date(order.created_at).toLocaleDateString()}</p>
          </div>
        </div>

        <div className="space-y-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-2">Articles</p>
          <div className="divide-y border rounded-lg overflow-hidden">
            {order.items?.map((item, i) => (
              <div key={i} className="flex items-center gap-4 p-3 bg-white">
                <div className="size-12 bg-slate-100 rounded flex items-center justify-center shrink-0">
                  <Package className="size-5 text-slate-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{item.product_name}</p>
                  <p className="text-[10px] text-slate-400">Qté: {item.quantity} × {formatPrice(item.unit_price)}</p>
                </div>
                <p className="text-xs font-bold">{formatPrice(item.unit_price * item.quantity)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 bg-slate-50 p-4 rounded-lg border">
          <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <span>Sous-total</span>
            <span>{formatPrice(order.total)}</span>
          </div>
          <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <span>Livraison</span>
            <span>{order.delivery_fee ? formatPrice(order.delivery_fee) : '0 DA'}</span>
          </div>
          <div className="pt-3 border-t flex justify-between items-center">
            <span className="text-xs font-bold uppercase tracking-widest">Total</span>
            <span className="text-lg font-bold">{formatPrice((order.total || 0) + (order.delivery_fee || 0))}</span>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Adresse de livraison</p>
          <div className="p-3 border rounded-lg text-xs leading-relaxed bg-white">
            {order.customer_address}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountPanelContent({ user, activeStore, onClose, clearUser, setStorefrontView }: any) {
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const isStaff = ['ADMIN', 'SUPER_ADMIN', 'CONFIRMATEUR', 'MANAGER', 'LIVREUR', 'AGENT', 'MARKETER'].includes(user.role);

  const ordersQuery = useQuery<{ data: Order[] }>({
    queryKey: ['customer-orders', user.id],
    queryFn: () => apiFetch(`/api/v1/orders/?search=${encodeURIComponent(user.phone ?? user.email ?? '')}&store_id=${activeStore.id}`),
    enabled: !!user.id,
  });

  if (selectedOrder) return <OrderDetail order={selectedOrder} onBack={() => setSelectedOrder(null)} />;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="p-6 border-b flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-10 bg-slate-900 rounded flex items-center justify-center text-white font-bold">
            {user.name?.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold">{user.name}</h3>
              {isStaff && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-[9px] font-bold uppercase tracking-widest rounded border border-purple-200">{user.role}</span>}
            </div>
            <p className="text-[10px] text-slate-400 truncate max-w-[180px]">{user.email}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded transition-colors">
          <X className="size-4 text-slate-400" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Staff Access */}
        {isStaff && (
          <div className="p-4 border border-purple-600 bg-purple-50/50 rounded-xl flex items-center justify-between group cursor-pointer hover:bg-purple-100/50 transition-colors shadow-sm"
               onClick={() => { useAppStore.getState().setAppView('admin'); onClose(); }}>
            <div className="flex items-center gap-3">
               <ShieldCheck className="size-5 text-purple-600" />
               <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-purple-600">Accès Professionnel</p>
                  <p className="text-xs font-bold text-slate-900">
                    {user.role === 'LIVREUR' ? '📱 Accéder à mon Espace Livreur' : 'Dashboard Admin'}
                  </p>
               </div>
            </div>
            <ExternalLink className="size-4 text-purple-500" />
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-0 border rounded-lg overflow-hidden">
          <div className="p-3 text-center border-r bg-white">
            <p className="text-lg font-bold">{(ordersQuery.data?.data ?? []).length}</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Commandes</p>
          </div>
          <div className="p-3 text-center border-r bg-white">
            <p className="text-lg font-bold">{(ordersQuery.data?.data ?? []).filter(o => o.status === 'DELIVERED').length}</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Livré</p>
          </div>
          <div className="p-3 text-center bg-white">
            <p className="text-lg font-bold">{(ordersQuery.data?.data ?? []).filter(o => !['DELIVERED', 'CANCELLED'].includes(o.status)).length}</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">En cours</p>
          </div>
        </div>

        {/* Orders List */}
        <div className="space-y-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b pb-2">Dernières commandes</p>
          <div className="space-y-2">
            {(ordersQuery.data?.data ?? []).map(order => (
              <button key={order.id} onClick={() => setSelectedOrder(order)} 
                      className="w-full flex items-center justify-between p-3 border rounded-lg hover:bg-slate-50 transition-colors group">
                <div className="flex flex-col items-start gap-1">
                  <span className="text-xs font-bold font-mono">#{order.id.slice(-8).toUpperCase()}</span>
                  <span className="text-[10px] text-slate-400">{new Date(order.created_at).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs font-bold">{formatPrice(order.total)}</p>
                    <StatusBadge status={order.status} />
                  </div>
                  <ChevronRight className="size-3 text-slate-300" />
                </div>
              </button>
            ))}
            {!(ordersQuery.data?.data ?? []).length && !ordersQuery.isLoading && (
              <p className="text-xs text-center py-8 text-slate-300">Aucune commande trouvée.</p>
            )}
          </div>
        </div>

        <button onClick={() => { clearUser(); onClose(); }}
                className="w-full py-3 border rounded-lg text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-red-500 hover:border-red-100 hover:bg-red-50 transition-all flex items-center justify-center gap-2">
          <LogOut className="size-3" /> Déconnexion
        </button>
      </div>
    </div>
  );
}

export function AccountPanel({ open, onOpenChange }: AccountPanelProps) {
  const user = useAppStore((s) => s.user);
  const activeStore = useAppStore((s) => s.activeStore);
  const clearUser = useAppStore((s) => s.clearUser);
  const setStorefrontView = useAppStore((s) => s.setStorefrontView);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[440px] p-0 border-l shadow-none">
        <SheetHeader className="sr-only"><SheetTitle>Compte</SheetTitle></SheetHeader>
        {user && activeStore ? (
          <AccountPanelContent user={user} activeStore={activeStore} onClose={() => onOpenChange(false)} clearUser={clearUser} setStorefrontView={setStorefrontView} />
        ) : (
          <div className="h-full flex items-center justify-center p-8">
            <button onClick={() => onOpenChange(false)} className="text-xs font-bold uppercase tracking-widest border-b-2 border-black pb-1">Retour boutique</button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
