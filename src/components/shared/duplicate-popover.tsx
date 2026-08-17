'use client';

import React, { useState, useEffect } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Layers,
  Phone,
  Clock,
  Package,
  Split,
  Loader2,
  AlertTriangle,
  ChevronDown,
  History,
  User,
  Copy,
  Check,
  Maximize2
} from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { toast } from 'sonner';

interface OrderItem {
  id?: string;
  product_name?: string;
  product_title?: string;
  name?: string;
  variant_title?: string;
  variant_details?: any;
  quantity?: number;
  qty?: number;
  unit_price?: number;
  price?: number;
}

interface DuplicateOrder {
  id: string;
  order_number: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_wilaya?: string | null;
  customer_commune?: string | null;
  status: string;
  status_before_merge?: string | null;
  total?: number | null;
  created_at?: string;
  merged_at?: string;
  merged_by?: string;
  items?: OrderItem[];
  notes?: string;
  tracking_number?: string;
}

interface DuplicatePopoverProps {
  order: {
    id: string;
    order_number: string;
    customer_name?: string | null;
    customer_phone: string;
    customer_wilaya?: string | null;
    customer_commune?: string | null;
    status?: string | null;
    total?: number | null;
    duplicate_count?: number | null;
    parent_order_id?: string | null;
    is_duplicate?: boolean;
  };
  triggerLabel?: React.ReactNode;
  onOpenFullModal?: () => void;
  onUnmergeSuccess?: () => void;
}

const STATUS_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  PENDING: { label: 'En attente', bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700' },
  CONFIRMED: { label: 'Confirmée', bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
  IN_PROGRESS: { label: 'En cours', bg: 'bg-cyan-50 border-cyan-200', text: 'text-cyan-700' },
  SHIPPED: { label: 'Expédiée', bg: 'bg-indigo-50 border-indigo-200', text: 'text-indigo-700' },
  DELIVERED: { label: 'Livrée', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
  RETURNED: { label: 'Retournée', bg: 'bg-rose-50 border-rose-200', text: 'text-rose-700' },
  CANCELLED: { label: 'Annulée', bg: 'bg-slate-100 border-slate-200', text: 'text-slate-700' },
  MERGED: { label: 'Fusionnée (Doublon)', bg: 'bg-purple-50 border-purple-200', text: 'text-purple-700' },
};

export const DuplicatePopover: React.FC<DuplicatePopoverProps> = ({
  order,
  triggerLabel,
  onOpenFullModal,
  onUnmergeSuccess,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [childOrders, setChildOrders] = useState<DuplicateOrder[]>([]);
  const [parentOrder, setParentOrder] = useState<DuplicateOrder | null>(null);
  const [phoneOrders, setPhoneOrders] = useState<DuplicateOrder[]>([]);
  const [unmergingId, setUnmergingId] = useState<string | null>(null);

  const fetchDetails = async () => {
    setLoading(true);
    try {
      // 1. Fetch full order details (child_orders & parent_order)
      const full: any = await apiFetch(`/api/v1/orders/${order.id}`);
      if (full) {
        setChildOrders(full.child_orders || []);
        setParentOrder(full.parent_order || null);
      }

      // 2. Fetch all orders with same phone number (excluding MERGED and rapid duplicates)
      if (order.customer_phone) {
        const phone = order.customer_phone.trim();
        const res: any = await apiFetch(`/api/v1/orders?search=${encodeURIComponent(phone)}&pageSize=50`);
        const items = res?.data || res?.items || res || [];
        if (Array.isArray(items)) {
          setPhoneOrders(items.filter((o: any) => o.id !== order.id && o.status !== 'MERGED'));
        }
      }
    } catch (err) {
      console.error('[DuplicatePopover] Failed to load details:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      fetchDetails();
    }
  };

  const handleUnmerge = async (childId: string, orderNumber: string) => {
    if (!window.confirm(`Démarier la commande doublon ${orderNumber} ? Elle redeviendra une commande indépendante.`)) {
      return;
    }
    setUnmergingId(childId);
    try {
      const res: any = await apiFetch(`/api/v1/orders/${childId}/unmerge`, {
        method: 'POST',
      });
      if (res && (res.success || res.status === 200)) {
        toast.success(`La commande ${orderNumber} a été démariée !`);
        setChildOrders(prev => prev.filter(c => c.id !== childId));
        if (onUnmergeSuccess) onUnmergeSuccess();
      } else {
        toast.error(res?.message || "Erreur lors de la séparation du doublon.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Erreur réseau lors de la séparation du doublon.");
    } finally {
      setUnmergingId(null);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return dateStr;
    }
  };

  const dupCount = order.duplicate_count || childOrders.length;

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 bg-purple-100 hover:bg-purple-200 text-purple-800 border border-purple-200 rounded-md text-[9px] font-black uppercase px-2 py-0.5 shadow-2xs transition-all cursor-pointer select-none"
          title="Cliquer pour dérouler les détails des doublons"
        >
          {triggerLabel || (
            <>
              🟣 {dupCount > 0 ? `+${dupCount} doublon${dupCount > 1 ? 's' : ''}` : 'Doublon'}
              <ChevronDown className={`size-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="bottom"
        className="w-[380px] sm:w-[440px] p-0 bg-white border border-purple-200 rounded-2xl shadow-2xl z-[999] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Dropdown Header */}
        <div className="bg-gradient-to-r from-purple-900 to-indigo-900 text-white p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-purple-300" />
            <div>
              <h4 className="text-xs font-black tracking-wide text-white uppercase">
                Détails des Doublons #{order.order_number}
              </h4>
              <p className="text-[10px] text-purple-200 font-semibold">
                {order.customer_name || 'Client'} · 📞 {order.customer_phone}
              </p>
            </div>
          </div>

          {onOpenFullModal && (
            <button
              onClick={() => {
                setIsOpen(false);
                onOpenFullModal();
              }}
              className="text-[10px] bg-white/20 hover:bg-white/30 text-white font-bold px-2 py-1 rounded-lg transition-all flex items-center gap-1 shrink-0"
              title="Ouvrir la modal complète"
            >
              <Maximize2 className="size-3" />
              Plein écran
            </button>
          )}
        </div>

        {/* Dropdown Content */}
        <div className="p-3.5 max-h-[380px] overflow-y-auto space-y-3">
          {loading ? (
            <div className="py-8 flex flex-col items-center justify-center text-slate-400 gap-2">
              <Loader2 className="size-6 animate-spin text-purple-600" />
              <p className="text-[11px] font-semibold">Chargement des doublons...</p>
            </div>
          ) : (
            <>
              {/* Parent Order Notice */}
              {parentOrder && (
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 space-y-1">
                  <span className="text-[10px] font-black uppercase text-purple-800 flex items-center gap-1">
                    <AlertTriangle className="size-3 text-purple-600" />
                    Commande fusionnée dans : #{parentOrder.order_number}
                  </span>
                  <p className="text-xs text-slate-700 font-bold">
                    Statut : {parentOrder.status} · Total : {(parentOrder.total || 0).toLocaleString()} DA
                  </p>
                </div>
              )}

              {/* Merged Child Orders */}
              {childOrders.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                    Soumissions doublons fusionnées ({childOrders.length})
                  </p>
                  {childOrders.map((child, idx) => (
                    <div
                      key={child.id || idx}
                      className="bg-purple-50/50 border border-purple-100 rounded-xl p-3 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-bold text-slate-900">
                          <span>#{child.order_number}</span>
                          <span className="text-[9px] font-black bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                            Doublon
                          </span>
                        </div>
                        <button
                          onClick={() => handleUnmerge(child.id, child.order_number)}
                          disabled={unmergingId === child.id}
                          className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold px-2 py-0.5 rounded-md transition-all flex items-center gap-1 disabled:opacity-50"
                        >
                          {unmergingId === child.id ? <Loader2 className="size-3 animate-spin" /> : <Split className="size-3" />}
                          Démarier
                        </button>
                      </div>

                      <div className="text-[11px] text-slate-500 flex items-center justify-between">
                        <span>Soumis le : {formatDate(child.created_at)}</span>
                        <span className="font-bold text-emerald-700">{(child.total || 0).toLocaleString()} DA</span>
                      </div>

                      {/* Child items */}
                      {child.items && child.items.length > 0 && (
                        <div className="bg-white/80 p-2 rounded-lg border border-purple-100/60 space-y-1">
                          {child.items.map((item: any, i: number) => (
                            <div key={i} className="text-[11px] font-semibold text-slate-800 flex justify-between">
                              <span>
                                {item.product_name || item.name || 'Produit'}
                                {(item.variant_title || item.variant_details) && (
                                  <span className="text-purple-700 font-bold ml-1">
                                    ({typeof item.variant_details === 'object' ? Object.values(item.variant_details).join('/') : (item.variant_title || item.variant_details)})
                                  </span>
                                )}
                              </span>
                              <span className="font-bold">x{item.quantity || item.qty || 1}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : !parentOrder ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-center space-y-1">
                  <p className="text-xs font-bold text-slate-700">Aucun sous-doublon direct fusionné.</p>
                  <p className="text-[10px] text-slate-500">
                    Voir les autres commandes du client ci-dessous :
                  </p>
                </div>
              ) : null}

              {/* Phone History */}
              {phoneOrders.length > 0 && (
                <div className="space-y-2 pt-1 border-t border-slate-100">
                  <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <History className="size-3 text-indigo-600" />
                      Historique Téléphone ({phoneOrders.length})
                    </span>
                  </p>
                  <div className="space-y-1.5">
                    {phoneOrders.slice(0, 5).map((po) => {
                      const st = STATUS_LABELS[po.status] || { label: po.status, bg: 'bg-slate-100', text: 'text-slate-700' };
                      return (
                        <div key={po.id} className="bg-slate-50 p-2 rounded-lg border border-slate-200 flex items-center justify-between text-xs">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5 font-bold text-slate-800">
                              <span>#{po.order_number}</span>
                              <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border ${st.bg} ${st.text}`}>
                                {st.label}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-500">📅 {formatDate(po.created_at)}</p>
                          </div>
                          <span className="font-bold text-slate-900 text-xs">{(po.total || 0).toLocaleString()} DA</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 p-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
          <span>Client: <strong>{order.customer_phone}</strong></span>
          <button
            onClick={() => setIsOpen(false)}
            className="text-slate-700 hover:text-slate-900 font-bold px-2 py-0.5 rounded bg-slate-200 hover:bg-slate-300 transition-all"
          >
            Fermer
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
