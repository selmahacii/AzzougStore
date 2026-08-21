'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Phone,
  Calendar,
  Package,
  Layers,
  Split,
  AlertTriangle,
  ArrowUpRight,
  User,
  MapPin,
  Clock,
  Loader2,
  History,
  Info
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
  total_amount?: number | null;
  delivery_fee?: number | null;
  created_at?: string;
  merged_at?: string;
  merged_by?: string;
  items?: OrderItem[];
  product_title?: string;
  quantity?: number;
  raw_payload?: any;
  notes?: string;
  tracking_number?: string;
}

interface DuplicateHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
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
  } | null;
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

export const DuplicateHistoryModal: React.FC<DuplicateHistoryModalProps> = ({
  isOpen,
  onClose,
  order,
  onUnmergeSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<'merged' | 'history'>('merged');
  const [loading, setLoading] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [childOrders, setChildOrders] = useState<DuplicateOrder[]>([]);
  const [parentOrder, setParentOrder] = useState<DuplicateOrder | null>(null);
  const [customerOrders, setCustomerOrders] = useState<DuplicateOrder[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [unmergingId, setUnmergingId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && order?.id) {
      loadDuplicateDetails();
      loadCustomerHistory();
    } else {
      setChildOrders([]);
      setParentOrder(null);
      setCustomerOrders([]);
    }
  }, [isOpen, order?.id]);

  const loadDuplicateDetails = async () => {
    if (!order?.id) return;
    setLoading(true);
    try {
      const full: any = await apiFetch(`/api/v1/orders/${order.id}`);
      if (full) {
        setChildOrders(full.child_orders || []);
        setParentOrder(full.parent_order || null);
      }
    } catch (err) {
      console.error('[DuplicateHistoryModal] Failed to load order details:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadCustomerHistory = async () => {
    if (!order?.customer_phone) return;
    setLoadingHistory(true);
    try {
      const phone = order.customer_phone.trim();
      const res: any = await apiFetch(`/api/v1/orders?search=${encodeURIComponent(phone)}&pageSize=50`);
      const items = res?.data || res?.items || res || [];
      if (Array.isArray(items)) {
        setCustomerOrders(items.filter((o: any) => o.id !== order.id));
      }
    } catch (err) {
      console.error('[DuplicateHistoryModal] Failed to load customer history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleUnmerge = async (childId: string, orderNumber: string) => {
    if (!window.confirm(`Voulez-vous vraiment séparer la commande doublon ${orderNumber} ? Elle redeviendra une commande distincte dans la liste.`)) {
      return;
    }
    setUnmergingId(childId);
    try {
      const res: any = await apiFetch(`/api/v1/orders/${childId}/unmerge`, {
        method: 'POST',
      });
      if (res && (res.success || res.status === 200)) {
        toast.success(`Commande ${orderNumber} séparée avec succès !`);
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPhone(true);
    toast.success("Numéro de téléphone copié !");
    setTimeout(() => setCopiedPhone(false), 2000);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return dateStr;
    }
  };

  if (!isOpen || !order) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/65 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
      <div 
        className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col my-auto max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="bg-slate-900 p-5 text-white relative shrink-0">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-all"
            aria-label="Fermer"
          >
            <X className="size-5" />
          </button>

          <div className="flex items-center gap-2 mb-2">
            <span className="bg-slate-800 text-slate-200 border border-slate-700 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
              <Layers className="size-3 text-slate-300" />
              Historique des Doublons
            </span>
            {order.duplicate_count ? (
              <span className="bg-slate-800 text-amber-300 border border-slate-700 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full">
                +{order.duplicate_count} fusionné(s)
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              Commande #{order.order_number}
            </h2>
            <div className="flex items-center gap-2 text-slate-300 text-xs font-semibold">
              <User className="size-3.5 text-slate-400" />
              <span>{order.customer_name || 'Client sans nom'}</span>
            </div>
          </div>

          {/* Phone bar */}
          <div className="mt-3 flex flex-wrap items-center gap-3 bg-white/10 px-3.5 py-2 rounded-xl border border-white/10 w-fit text-xs text-white">
            <div className="flex items-center gap-1.5 font-mono font-bold">
              <Phone className="size-3.5 text-slate-300" />
              <span>{order.customer_phone}</span>
            </div>
            <button
              onClick={() => copyToClipboard(order.customer_phone)}
              className="text-[10px] bg-white/20 hover:bg-white/30 text-white font-bold px-2 py-0.5 rounded transition-all flex items-center gap-1"
            >
              {copiedPhone ? <Check className="size-3 text-emerald-300" /> : <Copy className="size-3" />}
              {copiedPhone ? 'Copié' : 'Copier'}
            </button>
            <a
              href={`tel:${order.customer_phone}`}
              className="text-[10px] bg-emerald-500/30 hover:bg-emerald-500/40 text-emerald-200 font-bold px-2 py-0.5 rounded transition-all flex items-center gap-1 border border-emerald-400/30"
            >
              <Phone className="size-3 text-emerald-300" />
              Appeler
            </a>
            {order.customer_wilaya && (
              <span className="text-[11px] text-slate-300 flex items-center gap-1 font-medium pl-2 border-l border-white/20">
                <MapPin className="size-3 text-slate-400" />
                {order.customer_wilaya} {order.customer_commune ? `(${order.customer_commune})` : ''}
              </span>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-slate-200 bg-slate-50 px-4 pt-2 shrink-0 gap-2">
          <button
            onClick={() => setActiveTab('merged')}
            className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all flex items-center gap-2 border-b-2 ${
              activeTab === 'merged'
                ? 'border-slate-900 text-slate-900 bg-white shadow-sm font-extrabold'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            <Layers className="size-3.5 text-slate-700" />
            Doublons Fusionnés ({childOrders.length})
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all flex items-center gap-2 border-b-2 ${
              activeTab === 'history'
                ? 'border-slate-900 text-slate-900 bg-white shadow-sm font-extrabold'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            <History className="size-3.5 text-slate-700" />
            Historique Client ({customerOrders.length + 1} commandes)
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-3">
              <Loader2 className="size-8 animate-spin text-slate-600" />
              <p className="text-xs font-semibold">Chargement des doublons...</p>
            </div>
          ) : activeTab === 'merged' ? (
            <div className="space-y-4">
              {/* Parent Order section if THIS order is a child */}
              {parentOrder && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase text-amber-800 flex items-center gap-1.5">
                      <AlertTriangle className="size-4 text-amber-600" />
                      Cette commande a été fusionnée dans la commande principale :
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-black bg-amber-200 text-amber-900 rounded-full">
                      Commande Principale
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div>
                      <p className="text-sm font-black text-slate-800">#{parentOrder.order_number}</p>
                      <p className="text-[11px] text-slate-500">Date: {formatDate(parentOrder.created_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-emerald-700">{(parentOrder.total || 0).toLocaleString()} DA</p>
                      <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                        {parentOrder.status}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Child Merged Orders */}
              {childOrders.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-xs font-extrabold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="size-4 text-slate-700" />
                    Commandes Doublons Récupérées / Absorbées ({childOrders.length})
                  </p>

                  {childOrders.map((child, idx) => (
                    <div
                      key={child.id || idx}
                      className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm transition-all space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-black text-slate-900">
                              #{child.order_number}
                            </span>
                            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                              Doublon Fusionné
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                            <Clock className="size-3 text-slate-400" />
                            Soumise le : {formatDate(child.created_at)}
                          </p>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-sm font-black text-slate-900">
                              {(child.total || 0).toLocaleString()} DA
                            </p>
                            {child.status_before_merge && (
                              <p className="text-[10px] text-slate-400 font-medium">
                                Statut initial : <span className="font-bold text-slate-600">{child.status_before_merge}</span>
                              </p>
                            )}
                          </div>

                          <button
                            onClick={() => handleUnmerge(child.id, child.order_number)}
                            disabled={unmergingId === child.id}
                            className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                            title="Séparer ce doublon pour le remettre en commande indépendante"
                          >
                            {unmergingId === child.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Split className="size-3.5" />
                            )}
                            Démarier
                          </button>
                        </div>
                      </div>

                      {/* Merged Metadata */}
                      {child.merged_at && (
                        <div className="text-[11px] bg-slate-50 px-3 py-1.5 rounded-lg text-slate-600 flex flex-wrap items-center justify-between gap-2 border border-slate-100">
                          <span>
                            <strong>Fusionné le :</strong> {formatDate(child.merged_at)}
                          </span>
                          {child.merged_by && (
                            <span>
                              <strong>Par :</strong> {child.merged_by}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Items in this duplicate */}
                      {(() => {
                        const displayItems = (child.items && child.items.length > 0)
                          ? child.items
                          : (child.raw_payload?.items && child.raw_payload.items.length > 0)
                            ? child.raw_payload.items
                            : (child.raw_payload?.product_title || child.product_title || child.total_amount)
                              ? [{
                                  product_name: child.raw_payload?.product_title || child.product_title || 'Article commande',
                                  quantity: child.raw_payload?.quantity || child.quantity || 1,
                                  unit_price: child.raw_payload?.price || child.total_amount || 0
                                }]
                              : [];

                        return displayItems.length > 0 ? (
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-extrabold uppercase text-slate-400">
                              Produits de cette soumission :
                            </p>
                            <div className="grid gap-1.5">
                              {displayItems.map((item: any, i: number) => (
                                <div
                                  key={i}
                                  className="text-xs bg-slate-50 p-2 rounded-lg border border-slate-200 flex items-center justify-between"
                                >
                                  <div className="font-semibold text-slate-800">
                                    {item.product_name || item.name || 'Produit'}
                                    {(item.variant_title || item.variant_details) && (
                                      <span className="text-[11px] text-slate-600 ml-1 font-bold">
                                        ({typeof item.variant_details === 'object' ? Object.values(item.variant_details).join(' / ') : (item.variant_title || item.variant_details)})
                                      </span>
                                    )}
                                  </div>
                                  <div className="font-bold text-slate-600">
                                    x{item.quantity || item.qty || 1} · {((item.unit_price || item.price || 0) * (item.quantity || item.qty || 1)).toLocaleString()} DA
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs italic text-slate-400">Aucun détail d'article spécifique.</p>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center space-y-3">
                  <Info className="size-8 text-slate-400 mx-auto" />
                  <p className="text-sm font-bold text-slate-700">
                    Aucun doublon automatique fusionné directement sous ce numéro de commande.
                  </p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Consultez l'onglet <strong>« Historique Client »</strong> ci-dessus pour voir l'ensemble des commandes passées avec le même numéro de téléphone ({order.customer_phone}).
                  </p>
                </div>
              )}
            </div>
          ) : (
            /* History Tab */
            <div className="space-y-3">
              <p className="text-xs font-extrabold text-slate-600 uppercase tracking-wider flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <History className="size-4 text-slate-700" />
                  Toutes les commandes associées au {order.customer_phone}
                </span>
                <span className="text-[11px] font-bold text-slate-400">
                  {customerOrders.length + 1} commande(s) au total
                </span>
              </p>

              {/* Current order card highlight */}
              <div className="bg-slate-50 border-2 border-slate-800 rounded-xl p-4 space-y-2 relative shadow-sm">
                <span className="absolute top-3 right-3 text-[9px] font-black uppercase px-2 py-0.5 rounded bg-slate-900 text-white">
                  Commande Actuelle
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black text-slate-900">#{order.order_number}</span>
                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${STATUS_LABELS[order.status || 'PENDING']?.bg || 'bg-slate-100'} ${STATUS_LABELS[order.status || 'PENDING']?.text || 'text-slate-700'}`}>
                    {STATUS_LABELS[order.status || 'PENDING']?.label || order.status}
                  </span>
                </div>
                <p className="text-xs text-slate-600">
                  Total : <strong>{(order.total || 0).toLocaleString()} DA</strong> · Wilaya : <strong>{order.customer_wilaya || 'N/A'}</strong>
                </p>
              </div>

              {/* Customer history list */}
              {loadingHistory ? (
                <div className="py-8 flex justify-center">
                  <Loader2 className="size-6 animate-spin text-purple-600" />
                </div>
              ) : customerOrders.length > 0 ? (
                <div className="space-y-2.5">
                  {customerOrders.map((co) => {
                    const st = STATUS_LABELS[co.status] || { label: co.status, bg: 'bg-slate-100', text: 'text-slate-700' };
                    return (
                      <div
                        key={co.id}
                        className="bg-white border border-slate-200 hover:border-indigo-300 rounded-xl p-3.5 shadow-sm transition-all flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-black text-slate-800">#{co.order_number}</span>
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${st.bg} ${st.text}`}>
                              {st.label}
                            </span>
                            {co.tracking_number && (
                              <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                Suivi: {co.tracking_number}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 flex items-center gap-2">
                            <span>📅 {formatDate(co.created_at)}</span>
                            {co.customer_wilaya && <span>📍 {co.customer_wilaya}</span>}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className="text-sm font-black text-slate-900">{(co.total || 0).toLocaleString()} DA</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs italic text-slate-400 py-4 text-center">
                  Aucune autre commande enregistrée sous ce numéro de téléphone.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 p-4 border-t border-slate-100 flex items-center justify-between shrink-0">
          <p className="text-[11px] text-slate-500 font-medium">
            Historique complet des doublons et de la fiche client.
          </p>
          <button
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs px-5 py-2 rounded-xl transition-all"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
