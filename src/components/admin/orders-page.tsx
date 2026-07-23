'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Filter,
  MoreHorizontal,
  Eye,
  ArrowRightLeft,
  UserPlus,
  ChevronLeft,
  ChevronRight,
  Package,
  Activity,
  ShieldCheck,
  Truck,
  Printer,
  MessageSquare,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Zap,
  Plus,
  Terminal,
  Download,
  Phone,
  MapPin,
  Clock,
  Settings2,
  Calendar,
  Layers,
  ShoppingBag,
  Globe,
  Briefcase,
  Users,
  Loader2,
  TrendingUp,
  User as UserIcon,
  Hash,
  BarChart3,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_DOT,
} from '@/lib/types';
import type {
  Order,
  OrderEvent,
  OrderStatus,
  User,
  PaginatedResponse,
  ApiResponse,
} from '@/lib/types';
import { useAppStore } from '@/store/app-store';
import { formatPrice, formatOrderRef } from '@/lib/format';
import { downloadCSV } from '@/lib/export-helper';
import { exportToCSV, formatCSVDate, formatCSVPrice } from '@/lib/export';
import { cn } from '@/lib/utils';
import { WILAYAS } from '@/lib/wilaya-data';
import { ALGERIAN_COMMUNES } from '@/lib/algerian-communes';
import { NOEST_BUREAUX } from '@/lib/noest-bureaux-data';
import { apiFetch } from '@/lib/api-client';
import { NoestTrackingPanel } from '@/components/admin/noest-tracking-panel';
import { YalidineTrackingPanel } from '@/components/admin/yalidine-tracking-panel';
import { ZRExpressTrackingPanel } from '@/components/admin/zr-express-tracking-panel';
import { OrderTraceabilityPanel } from '@/components/admin/order-traceability-panel';
import { OrderTrackingReport } from '@/components/admin/order-tracking-report';
import { OrderErpDetailPanel } from '@/components/admin/order-erp-detail-panel';
import { InvoiceButton, OrdersKanbanView, OrdersMapView } from '@/components/admin/order-erp-features';
import { OrderTypeBadge } from '@/components/shared/order-type-badge';

const ALL_STATUSES: { value: string; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  ...Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

const C = {
   primary: '#4b7bec', primaryBg: '#F0F5FF',
   success: '#20bf6b', successBg: '#E6FFF8',
   danger: '#eb4d4b', dangerBg: '#FFEDE9',
   warning: '#f7b731', warningBg: '#FFF8E6',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

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

const PERIODS = [
  { value: 'today', label: 'Aujourd\'hui' },
  { value: 'yesterday', label: 'Hier' },
  { value: '7d', label: '7J' },
  { value: '30d', label: '30J' },
  { value: 'this_month', label: 'Ce Mois' },
  { value: 'prev_month', label: 'Mois Dernier' },
];

// hideBelow: columns that fold away below that breakpoint instead of
// forcing the whole table into a fixed min-width (which always produced a
// horizontal scrollbar on anything narrower than ~1200px, even on a normal
// laptop screen). Source/Agent/Date are the least essential for an
// at-a-glance registry — they're still one click away in the order drawer.
const REGISTRY_COLUMNS = [
  { key: 'source', label: 'Source', hideBelow: '2xl' as const },
  { key: 'order_number', label: 'N° Commande' },
  { key: 'customer', label: 'Client & Contact' },
  { key: 'customer_wilaya', label: 'Wilaya', hideBelow: 'lg' as const },
  { key: 'items', label: 'Articles', hideBelow: 'xl' as const },
  { key: 'total', label: 'Finances' },
  { key: 'status', label: 'Statut' },
];

const HIDE_BELOW_CLASS: Record<string, string> = {
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
  '2xl': 'hidden 2xl:table-cell',
};

function CallbackCountdown({ nextCallbackTime }: { nextCallbackTime: string }) {
  const [timeLeft, setTimeLeft] = useState('...');

  useEffect(() => {
    const target = new Date(nextCallbackTime).getTime();
    
    function update() {
      const diff = target - Date.now();
      if (diff <= 0) {
        setTimeLeft('Rappel immédiat');
        return;
      }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      const parts: string[] = [];
      if (hours > 0) parts.push(`${hours}h`);
      if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
      parts.push(`${seconds}s`);
      
      setTimeLeft(parts.join(' '));
    }

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [nextCallbackTime]);

  const isUrgent = new Date(nextCallbackTime).getTime() - Date.now() <= 0;

  return (
    <span className={cn(
      "text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 mt-1 shrink-0 w-fit border transition-all",
      isUrgent 
        ? "bg-red-50 text-red-700 border-red-200 animate-pulse" 
        : "bg-amber-50 text-amber-800 border-amber-200"
    )}>
      <Clock className="size-3" />
      <span>Rappel dans : {timeLeft}</span>
    </span>
  );
}

export default function OrdersPage() {
  const { activeStore, allStores, switchToStore, adminSubView, setAdminSubView, selectedOrderId, setSelectedOrderId, user } = useAppStore();
  const storeId = activeStore?.id ?? '';
  const queryClient = useQueryClient();

  const [createCommunes, setCreateCommunes] = useState<any[]>([]);
  const [editCommunes, setEditCommunes] = useState<any[]>([]);
  const [loadingCreateCommunes, setLoadingCreateCommunes] = useState(false);
  const [loadingEditCommunes, setLoadingEditCommunes] = useState(false);
  const [createCommune, setCreateCommune] = useState('');
  const [editCommuneState, setEditCommuneState] = useState('');
const [timeLeft, setTimeLeft] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    const m: Record<string, string> = {
      NEW: 'NEW', 'EN ATTENTE': 'ASSIGNED', CONFIRMED: 'CONFIRMED',
      FOLLOWUP: 'SHIPPED', COMPLETED: 'DELIVERED',
      // 'CANCELLED' tab is labeled "Annulations & Retours" — it must include
      // RETURNED orders too, not just CANCELLED, or returned orders are
      // invisible everywhere in the ERP despite the tab claiming to show them.
      CANCELLED: 'ARCHIVED',
      ABANDONED: 'ABANDONED', ALL: 'all',
    };
    return m[(adminSubView as string) || 'NEW'] ?? 'NEW';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Debounce logic
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 400);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [startDate, endDate]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [cancelConfirmOrder, setCancelConfirmOrder] = useState<{ orderId: string; orderNumber?: string | number } | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignOrderId, setAssignOrderId] = useState<string | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [selectedOrderProduct, setSelectedOrderProduct] = useState<any | null>(null);
  const [orderPrice, setOrderPrice] = useState(0);
  const [orderQty, setOrderQty] = useState(1);
  const [orderSource, setOrderSource] = useState('MANUAL');
  const [orderWilaya, setOrderWilaya] = useState('');
  const [selectedPartnerId, setSelectedPartnerId] = useState('');
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [deliveryType, setDeliveryType] = useState('home');
  const [orderDiscount, setOrderDiscount] = useState(0);
  const [isPack, setIsPack] = useState(false);
  const [isUpsell, setIsUpsell] = useState(false);
  const [isAbandonedCart, setIsAbandonedCart] = useState(false);
  const [recoveryFee, setRecoveryFee] = useState(0);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  // Store-wide duplicate count for the "🟣 Doublons" quick-filter badge —
  // was computed only from the currently-loaded page's `orders` array, so
  // it silently vanished (count===0 hides every non-ALL badge, see below)
  // whenever the current page/status-tab happened to have zero duplicates
  // on it, even with real merged duplicates elsewhere in the store (visible
  // in the backend logs as "Auto-merged N duplicate(s)..." constantly).
  const duplicateStatsQuery = useQuery({
    // Scoped to the SAME start/end date as the rest of the dashboard — this
    // used to be a lifetime, store-wide count with no date param at all, so
    // "Doublons" could show more than "Toutes" (e.g. 22 vs 20) whenever the
    // selected period was narrower than the store's full history. That
    // mismatch wasn't a bug in the count itself, just two different time
    // windows compared side by side without saying so.
    queryKey: ['duplicate-stats-badge', storeId, startDate, endDate],
    queryFn: () => {
      const params = new URLSearchParams({ store_id: storeId });
      if (startDate) params.set('start_date', startDate + 'T00:00:00.000Z');
      if (endDate) params.set('end_date', endDate + 'T23:59:59.999Z');
      return apiFetch<{ success: boolean; data: { child_orders: number; duplicate_groups: number } }>(`/api/v1/orders/duplicate-stats?${params.toString()}`);
    },
    enabled: !!storeId,
    staleTime: 60_000,
  });
  // duplicate_groups = number of ORDERS that absorbed at least one
  // duplicate (what the badge count means to the admin: "how many of my
  // orders had a duplicate") — NOT child_orders, which counts every
  // individual resubmit and would overstate it (one order can absorb
  // several duplicates and still be "1 order with a duplicate problem").
  const storeWideDuplicateCount = duplicateStatsQuery.data?.data?.duplicate_groups ?? 0;
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const [viewMode, setViewMode] = useState<'NEW' | 'EN ATTENTE' | 'CONFIRMED' | 'FOLLOWUP' | 'COMPLETED' | 'CANCELLED' | 'ABANDONED' | 'ALL'>((adminSubView as any) || 'NEW');
  // Edit order modal
  const [editOrderOpen, setEditOrderOpen] = useState(false);
  const [editOrderData, setEditOrderData] = useState<any>(null);
  const [editIsPack, setEditIsPack] = useState(false);
  const [editIsUpsell, setEditIsUpsell] = useState(false);
  const [editIsAbandonedCart, setEditIsAbandonedCart] = useState(false);
  const [editRecoveryFee, setEditRecoveryFee] = useState(0);
  const [expandedMergedOrders, setExpandedMergedOrders] = useState<Set<string>>(new Set());
  // GET /orders (list) never populates child_orders — only GET /orders/{id}
  // does — so the "duplicate details" expand panel had nothing to render
  // even when duplicate_count showed real duplicates existed. Fetched
  // lazily per order the first time it's expanded, keyed by order id.
  const [childOrdersById, setChildOrdersById] = useState<Record<string, any[]>>({});
  const [loadingChildOrdersId, setLoadingChildOrdersId] = useState<string | null>(null);

  // Noest/Yalidine Bureau states
  const [createBureauCode, setCreateBureauCode] = useState('');
  const [editBureauCode, setEditBureauCode] = useState('');
  const [editDeliveryType, setEditDeliveryType] = useState('home');
  const [editWilaya, setEditWilaya] = useState('');

  // Noest's own commune list per wilaya is what actually matters for
  // shipment creation (exact name match required), but it can lag behind
  // real administrative changes/additions — merging in our own static
  // ALGERIAN_COMMUNES list (deduped by name) guarantees the dropdown is
  // never MISSING a real commune just because Noest's copy hasn't caught
  // up, without ever dropping a Noest-provided name.
  const mergeWithLocalCommunes = (wilayaName: string, fromApi: any[]): any[] => {
    const local = ALGERIAN_COMMUNES[wilayaName] || [];
    const seen = new Set((fromApi || []).map((c: any) => (c?.name || '').trim().toLowerCase()));
    const extra = local
      .filter(c => !seen.has(c.nameAscii.trim().toLowerCase()))
      .map(c => ({ name: c.nameAscii }));
    return [...(fromApi || []), ...extra];
  };

  useEffect(() => {
    if (!orderWilaya) { setCreateCommunes([]); return; }
    const wid = WILAYAS.indexOf(orderWilaya as any) + 1;
    if (wid > 0) {
      setLoadingCreateCommunes(true);
      fetch(`/api/v1/locations/communes?wilaya_id=${wid}&store_id=${activeStore?.id || ''}`)
        .then(r => r.json())
        .then(d => { setCreateCommunes(mergeWithLocalCommunes(orderWilaya, d)); setLoadingCreateCommunes(false); })
        .catch(() => { setCreateCommunes(mergeWithLocalCommunes(orderWilaya, [])); setLoadingCreateCommunes(false); });
    }
  }, [orderWilaya, activeStore?.id]);

  useEffect(() => {
    if (!editWilaya) { setEditCommunes([]); return; }
    const wid = WILAYAS.indexOf(editWilaya as any) + 1;
    if (wid > 0) {
      setLoadingEditCommunes(true);
      fetch(`/api/v1/locations/communes?wilaya_id=${wid}&store_id=${activeStore?.id || ''}`)
        .then(r => r.json())
        .then(d => { setEditCommunes(mergeWithLocalCommunes(editWilaya, d)); setLoadingEditCommunes(false); })
        .catch(() => { setEditCommunes(mergeWithLocalCommunes(editWilaya, [])); setLoadingEditCommunes(false); });
    }
  }, [editWilaya, activeStore?.id]);


  const [yalidineCenters, setYalidineCenters] = useState<any[]>([]);
  const [loadingCenters, setLoadingCenters] = useState(false);

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

  useEffect(() => {
    if (editOrderData) {
      setEditIsPack(!!editOrderData.is_pack);
      setEditIsUpsell(!!editOrderData.is_upsell);
      setEditIsAbandonedCart(!!editOrderData.is_abandoned_cart);
      setEditRecoveryFee(editOrderData.abandoned_cart_recovery_fee || 0);
      setEditDeliveryType(editOrderData.delivery_type || 'home');
      setEditWilaya(editOrderData.customer_wilaya || '');
      
      let initialBureau = '';
      if (editOrderData.delivery_type === 'stop_desk' || editOrderData.delivery_type === 'OFFICE') {
        const yalMatch = editOrderData.customer_address?.match(/Bureau Yalidine \(ID:\s*(\d+)\)/i);
        if (yalMatch) {
          initialBureau = yalMatch[1];
        } else {
          initialBureau = NOEST_BUREAUX.find(b => editOrderData.customer_address?.includes(b.code))?.code || '';
        }
      }
      setEditBureauCode(initialBureau);
    } else {
      setEditBureauCode('');
      setEditDeliveryType('home');
      setEditWilaya('');
    }
  }, [editOrderData]);
  // Advanced filters
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [filterWilaya, setFilterWilaya] = useState('');
  const [filterSource, setFilterSource] = useState('');

  // Load initial filter states from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedSearch = localStorage.getItem('orders_filter_search') || '';
      const savedWilaya = localStorage.getItem('orders_filter_wilaya') || '';
      const savedSource = localStorage.getItem('orders_filter_source') || '';
      const savedStart = localStorage.getItem('orders_filter_start') || '';
      const savedEnd = localStorage.getItem('orders_filter_end') || '';
      const savedMode = localStorage.getItem('orders_filter_mode') || 'NEW';

      if (savedSearch) setSearchQuery(savedSearch);
      if (savedWilaya) setFilterWilaya(savedWilaya);
      if (savedSource) setFilterSource(savedSource);
      if (savedStart) setStartDate(savedStart);
      if (savedEnd) setEndDate(savedEnd);
      // Only restore the saved mode when no explicit sub-view was requested
      // (sidebar deep-links set adminSubView and must win over localStorage)
      if (savedMode && !adminSubView) {
        setViewMode(savedMode as any);
        setAdminSubView(savedMode);
        setStatusFilter(MODE_TO_STATUS[savedMode] ?? 'all');
      }
    }
  }, []);

  // Save states when they change
  useEffect(() => {
    localStorage.setItem('orders_filter_search', searchQuery);
  }, [searchQuery]);
  useEffect(() => {
    localStorage.setItem('orders_filter_wilaya', filterWilaya);
  }, [filterWilaya]);
  useEffect(() => {
    localStorage.setItem('orders_filter_source', filterSource);
  }, [filterSource]);
  useEffect(() => {
    localStorage.setItem('orders_filter_start', startDate);
  }, [startDate]);
  useEffect(() => {
    localStorage.setItem('orders_filter_end', endDate);
  }, [endDate]);
  useEffect(() => {
    localStorage.setItem('orders_filter_mode', viewMode);
  }, [viewMode]);

  const [analyticsPeriod, setAnalyticsPeriod] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('orders_analytics_period') || '30d';
    }
    return '30d';
  });

  useEffect(() => {
    localStorage.setItem('orders_analytics_period', analyticsPeriod);
  }, [analyticsPeriod]);

  // If dates are entered and it's not custom, set it to custom
  useEffect(() => {
    if ((startDate || endDate) && analyticsPeriod !== 'custom') {
      setAnalyticsPeriod('custom');
    }
  }, [startDate, endDate]);

  const applyPeriodPreset = (preset: string) => {
    setAnalyticsPeriod(preset);
    if (preset === 'custom') return;

    const now = new Date();
    let start = '';
    let end = '';

    const toLocalISOString = (d: Date) => {
      const offset = d.getTimezoneOffset();
      const localDate = new Date(d.getTime() - (offset * 60 * 1000));
      return localDate.toISOString().split('T')[0];
    };

    if (preset === 'today') {
      start = toLocalISOString(now);
      end = toLocalISOString(now);
    } else if (preset === 'yesterday') {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      start = toLocalISOString(yesterday);
      end = toLocalISOString(yesterday);
    } else if (preset === '7d') {
      const past = new Date();
      past.setDate(past.getDate() - 7);
      start = toLocalISOString(past);
      end = toLocalISOString(now);
    } else if (preset === '30d') {
      const past = new Date();
      past.setDate(past.getDate() - 30);
      start = toLocalISOString(past);
      end = toLocalISOString(now);
    } else if (preset === 'this_month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      start = toLocalISOString(firstDay);
      end = toLocalISOString(now);
    } else if (preset === 'prev_month') {
      const firstDayPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDayPrev = new Date(now.getFullYear(), now.getMonth(), 0);
      start = toLocalISOString(firstDayPrev);
      end = toLocalISOString(lastDayPrev);
    }

    setStartDate(start);
    setEndDate(end);
  };

  const storesAnalyticsQuery = useQuery({
    queryKey: ['stores-analytics-dashboard', analyticsPeriod, startDate, endDate],
    queryFn: async () => {
      let url = `/api/v1/analytics?type=stores-dashboard&period=${analyticsPeriod}`;
      if (analyticsPeriod === 'custom') {
        if (startDate) url += `&start_date=${encodeURIComponent(startDate + 'T00:00:00.000Z')}`;
        if (endDate) url += `&end_date=${encodeURIComponent(endDate + 'T23:59:59.999Z')}`;
      }
      return apiFetch<any>(url);
    },
    refetchInterval: 2 * 60 * 60 * 1000
  });

  const clearAllFilters = () => {
    setSearchQuery('');
    setFilterWilaya('');
    setFilterSource('');
    setStartDate('');
    setEndDate('');
    setAnalyticsPeriod('30d');
    // "Effacer" doit tout réafficher — laisser un filtre-type (Doublons,
    // Manuelle...) actif après un clic "Effacer" contredit son intention
    // affichée, et la page devait aussi revenir à 1 (sinon on reste bloqué
    // sur une page qui peut ne plus exister une fois les filtres retirés).
    setTypeFilter('ALL');
    setPage(1);

    localStorage.removeItem('orders_filter_search');
    localStorage.removeItem('orders_filter_wilaya');
    localStorage.removeItem('orders_filter_source');
    localStorage.removeItem('orders_filter_start');
    localStorage.removeItem('orders_filter_end');
    localStorage.removeItem('orders_filter_period');
    
    toast.success('Filtres réinitialisés');
  };
  // Bulk status modal
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkTargetStatus, setBulkTargetStatus] = useState<string>('');
  // Print label modal
  const [printLabelOpen, setPrintLabelOpen] = useState(false);
  const [printOrderIds, setPrintOrderIds] = useState<string[]>([]);

  useEffect(() => {
    if (adminSubView && adminSubView !== viewMode) {
      setViewMode(adminSubView as any);
      // A KPI click already set a precise status (e.g. CALLED) that belongs
      // to this same mode (EN ATTENTE) — only fall back to the mode's
      // generic status when the current one doesn't already match, so a
      // specific KPI selection survives this reconciliation instead of
      // being silently replaced by the mode's default status.
      setStatusFilter(prev => (STATUS_TO_MODE[prev] === adminSubView ? prev : (MODE_TO_STATUS[adminSubView] ?? 'all')));
      setPage(1);
    }
  }, [adminSubView, viewMode]);

  const MODE_TO_STATUS: Record<string, string> = {
    NEW: 'NEW',
    // Same reasoning as CANCELLED→ARCHIVED below: this tab's badge sums
    // ASSIGNED/CALLED/IN_PROGRESS/RESCHEDULED (see the count computation
    // further down), so clicking it must request the backend's matching
    // WORKING bucket — requesting ASSIGNED alone showed "2" while the
    // badge (and the KPI grid's own "En cours" card) showed the combined
    // count, e.g. "38".
    'EN ATTENTE': 'WORKING',
    CONFIRMED: 'CONFIRMED',
    FOLLOWUP: 'SHIPPED',
    COMPLETED: 'DELIVERED',
    // Same reasoning as the statusFilter initializer above: this tab shows
    // both cancelled AND returned orders, so it must request the backend's
    // ARCHIVED bucket (CANCELLED + RETURNED), not CANCELLED alone.
    CANCELLED: 'ARCHIVED',
    ABANDONED: 'ABANDONED',
    ALL: 'all',
  };

  const handleModeChange = (mode: string) => {
    setViewMode(mode as any);
    setAdminSubView(mode);
    setStatusFilter(MODE_TO_STATUS[mode] ?? 'all');
    setPage(1);
    // A type-filter pill (Doublons, Manuelle...) silently carrying over to a
    // DIFFERENT status tab reads as "filtration incorrecte" — each tab
    // should start unfiltered by type.
    setTypeFilter('ALL');
  };

  // Status → view tab. Every status the KPI grid can filter by must appear
  // here — a status missing from this map fell back to mode 'ALL', which
  // then made the reconciling useEffect below (adminSubView !== viewMode)
  // reset statusFilter back to a generic 'all' the moment anything else
  // touched adminSubView, silently undoing the click. CALLED/IN_PROGRESS/
  // RESCHEDULED were missing — exactly the tab where filtering looked broken.
  const STATUS_TO_MODE: Record<string, string> = {
    NEW: 'NEW',
    ASSIGNED: 'EN ATTENTE',
    CALLED: 'EN ATTENTE',
    IN_PROGRESS: 'EN ATTENTE',
    RESCHEDULED: 'EN ATTENTE',
    CONFIRMED: 'CONFIRMED',
    SHIPPED: 'FOLLOWUP',
    DELIVERED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    RETURNED: 'CANCELLED',
    ABANDONED: 'ABANDONED',
    MERGED: 'ALL',
  };

  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [listViewMode, setListViewMode] = useState<'LIST' | 'KANBAN' | 'MAP'>('LIST');

  // ── Filtres rapides « type » (Normales / Doublons / Manuelle / Packs…) ──
  // Ces filtres sont appliqués côté client sur les lignes chargées. Pour
  // qu'ils ne montrent PAS seulement les résultats de la page courante (la
  // source de confusion « perdu de ouf » : filtrer Doublons n'affichait que
  // les doublons des 20 lignes visibles), quand UN filtre-type est actif on
  // charge tout le jeu statut+période en une fois (jusqu'à FILTER_MODE_CAP) et
  // on masque la pagination classique au profit d'un compteur exact.
  const FILTER_MODE_CAP = 500;
  const isTypeFiltered = typeFilter !== 'ALL';
  const effectivePageSize = isTypeFiltered ? FILTER_MODE_CAP : pageSize;
  const effectivePage = isTypeFiltered ? 1 : page;

  const buildQueryParams = useCallback(() => {
    const params = new URLSearchParams({ store_id: storeId, page: effectivePage.toString(), pageSize: effectivePageSize.toString() });
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (filterWilaya) params.set('wilaya', filterWilaya);
    if (filterSource) params.set('source', filterSource);
    if (startDate) params.set('start_date', startDate + 'T00:00:00.000Z');
    if (endDate) params.set('end_date', endDate + 'T23:59:59.999Z');
    return params.toString();
  }, [storeId, effectivePage, statusFilter, debouncedSearch, effectivePageSize, filterWilaya, filterSource, startDate, endDate]);

   const [newOrderItems, setNewOrderItems] = useState<{ productId: string; quantity: number }[]>([]);
   const [customerData, setCustomerData] = useState({ name: '', phone: '', wilaya: '', address: '' });

   // Fetch shipping fees dynamically when wilaya, partner or type changes
   useEffect(() => {
      if (!selectedPartnerId || !orderWilaya) {
         return;
      }
      
      const fetchFee = async () => {
         try {
            const productIds = newOrderItems.map(item => item.productId).filter(Boolean).join(',');
            const res = await apiFetch<any>(
               `/api/v1/delivery-partners/calculate?partnerId=${selectedPartnerId}&wilayaId=${orderWilaya}&type=${deliveryType}&productIds=${productIds}`
            );
            if (res?.success && typeof res?.data?.fee === 'number') {
               setDeliveryFee(res.data.fee);
               toast.success(`Tarif de livraison mis à jour : ${res.data.fee} DA`);
            }
         } catch (error) {
            console.error('Error fetching shipping fee:', error);
         }
      };
      
      fetchFee();
   }, [selectedPartnerId, orderWilaya, deliveryType, newOrderItems]);

   const ordersQuery = useQuery<PaginatedResponse<Order>>({
     queryKey: ['orders', storeId, effectivePage, statusFilter, debouncedSearch, effectivePageSize, filterWilaya, filterSource, startDate, endDate],
     queryFn: () => apiFetch(`/api/v1/orders?${buildQueryParams()}`),
     placeholderData: (prev) => prev,
     refetchInterval: 5 * 60 * 1000,
     refetchIntervalInBackground: false,
   });

   // Counts per status tab (unfiltered by search, but DOIT suivre le même
   // filtre de date que la liste — sinon "Aujourd'hui" filtre la liste mais
   // les badges d'onglets continuent d'afficher les totaux toutes-dates,
   // ce qui donne l'impression que les commandes d'hier sont "mélangées"
   // dans la vue d'aujourd'hui alors que c'est juste le badge qui ment).
   const countsQuery = useQuery<Record<string, number | { normal: number; abandoned: number }>>({
     queryKey: ['orders-counts', storeId, startDate, endDate],
     queryFn: () => {
       const params = new URLSearchParams({ store_id: storeId });
       if (startDate) params.set('start_date', startDate + 'T00:00:00.000Z');
       if (endDate) params.set('end_date', endDate + 'T23:59:59.999Z');
       return apiFetch(`/api/v1/orders/counts?${params.toString()}`);
     },
     enabled: !!storeId,
     staleTime: 30_000,
     refetchInterval: 5 * 60 * 1000,
     refetchIntervalInBackground: false,
   });
   const tabCounts: Record<string, number> = (countsQuery.data as any) ?? {};
   // Reçues = commandes jamais touchées par un agent (ni assignées, ni
   // démarrées), séparées uniquement Normal/Panier abandonné — pas éclatées
   // par les 8 statuts d'onglets — pour un calcul rapide par l'administrateur.
   const receivedCounts = (countsQuery.data as any)?._received as { normal: number; abandoned: number; duplicate?: number; manual?: number; upsell?: number; recovered?: number; cancelled?: number } | undefined;

   const productsQuery = useQuery<ApiResponse<any[]>>({
    queryKey: ['admin-products-lite', storeId],
    enabled: isCreatingOrder && !!storeId,
    queryFn: () => apiFetch(`/api/v1/products?store_id=${storeId}&minimal=true`),
   });

   const deliveryPartnersQuery = useQuery<any>({
    queryKey: ['delivery-partners-lite', storeId],
    enabled: isCreatingOrder && !!storeId,
    queryFn: () => apiFetch(`/api/v1/delivery-partners?store_id=${storeId}`),
   });

   const employeesQuery = useQuery<ApiResponse<User[]>>({
    queryKey: ['employees', storeId],
    enabled: assignDialogOpen && !!storeId,
    queryFn: () => apiFetch(`/api/v1/users/?store_id=${storeId}`),
   });

   const createOrderMutation = useMutation({
     mutationFn: (data: any) => apiFetch('/api/v1/orders/', {
       method: 'POST',
       body: JSON.stringify(data),
     }),
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ['orders'] });
       toast.success('Dossier commande déployé avec succès');
       setIsCreatingOrder(false);
       setNewOrderItems([]);
       setCustomerData({ name: '', phone: '', wilaya: '', address: '' });
       setSelectedOrderProduct(null);
       setOrderPrice(0);
       setOrderQty(1);
       setOrderSource('MANUAL');
       setOrderWilaya('');
       setSelectedPartnerId('');
       setDeliveryFee(0);
       setDeliveryType('home');
       setOrderDiscount(0);
       setIsPack(false);
       setIsUpsell(false);
       setIsAbandonedCart(false);
       setRecoveryFee(0);
       setDuplicateWarning(null);
     },
     onError: (err: any) => toast.error(err.message || 'Échec de création'),
   });

   const statusMutation = useMutation({
     mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatus }) => {
       return apiFetch(`/api/v1/orders/${orderId}`, {
         method: 'PATCH',
         body: JSON.stringify({ status }),
       });
     },
     onSuccess: (_, { orderId, status }) => {
       queryClient.invalidateQueries({ queryKey: ['orders'] });
       queryClient.invalidateQueries({ queryKey: ['admin-products'] });
       queryClient.invalidateQueries({ queryKey: ['admin-products-stock'] });
       queryClient.invalidateQueries({ queryKey: ['inventory'] });
       setSelectedOrder(prev => prev && prev.id === orderId ? { ...prev, status } : prev);
     },
     onError: (error: any) => {
       if (!error?.message?.includes('utilisateur')) toast.error('Échec de mise à jour du statut');
     },
   });

   const softDeleteMutation = useMutation({
     mutationFn: async ({ orderId }: { orderId: string }) => {
       return apiFetch(`/api/v1/orders/${orderId}`, { method: 'DELETE' });
     },
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ['orders'] });
       queryClient.invalidateQueries({ queryKey: ['admin-products'] });
       queryClient.invalidateQueries({ queryKey: ['admin-products-stock'] });
       queryClient.invalidateQueries({ queryKey: ['inventory'] });
       toast.success('Commande archivée avec succès');
       setDetailDialogOpen(false);
     },
     onError: () => { toast.error("Erreur lors de l'archivage"); },
   });

   const assignMutation = useMutation({
     mutationFn: async ({ orderId, assignedTo }: { orderId: string; assignedTo: string }) => {
       // assigned_to alone — no forced status. Reassignment must work on an
       // order at ANY stage (CONFIRMED, CANCELLED, etc.), and forcing
       // status:'ASSIGNED' here made every reassignment attempt on an
       // order past the initial NEW/ASSIGNED stage fail the backend state
       // machine (ASSIGNED isn't a valid target from most later statuses),
       // which is exactly what made "réassigner" silently do nothing once
       // a status had progressed.
       return apiFetch(`/api/v1/orders/${orderId}`, {
         method: 'PATCH',
         body: JSON.stringify({ assigned_to: assignedTo }),
       });
     },
     onSuccess: () => { 
       queryClient.invalidateQueries({ queryKey: ['orders'] }); 
       queryClient.invalidateQueries({ queryKey: ['admin-products'] });
       queryClient.invalidateQueries({ queryKey: ['admin-products-stock'] });
       queryClient.invalidateQueries({ queryKey: ['inventory'] });
       setAssignDialogOpen(false); 
       setAssignOrderId(null); 
       setSelectedEmployeeId(''); 
       toast.success('Agent affecté au protocole de traitement'); 
     },
     onError: () => { toast.error("Échec de l'affectation opérationnelle"); },
   });

   // Internal delivery driver assignment — available from the order detail
   // modal regardless of status (essential info/action in every modal).
   const livreursForOrderQuery = useQuery<any>({
     queryKey: ['livreurs-for-order', selectedOrder?.store_id],
     queryFn: () => apiFetch(`/api/v1/users/?store_id=${selectedOrder?.store_id}`),
     enabled: !!selectedOrder?.store_id && detailDialogOpen,
     staleTime: 60_000,
   });
   const assignLivreurMutation = useMutation({
     mutationFn: ({ orderId, livreurId }: { orderId: string; livreurId: string }) =>
       apiFetch(`/api/v1/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ livreur_id: livreurId }) }),
     onSuccess: (updated: any) => {
       toast.success('Livreur assigné à la commande');
       queryClient.invalidateQueries({ queryKey: ['orders'] });
       if (updated?.id) setSelectedOrder(updated);
     },
     onError: (err: any) => toast.error(err.message || "Impossible d'assigner le livreur"),
   });

  // Edit order mutation
  const editOrderMutation = useMutation({
    mutationFn: (data: any) => apiFetch(`/api/v1/orders/${data.id}/info`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      queryClient.invalidateQueries({ queryKey: ['admin-products-stock'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      if (selectedOrder) setSelectedOrder(result.data ?? result);
      setEditOrderOpen(false);
      toast.success('Commande mise à jour');
    },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  });

  // Bulk status mutation
  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      const results = await Promise.allSettled(
        ids.map(id => apiFetch(`/api/v1/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }))
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      return { total: ids.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      queryClient.invalidateQueries({ queryKey: ['admin-products-stock'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setSelectedIds(new Set());
      setBulkStatusOpen(false);
      if (failed === 0) toast.success(`${total} commandes mises à jour`);
      else toast.warning(`${total - failed} mises à jour, ${failed} échecs`);
    },
    onError: () => toast.error('Erreur lors de la mise à jour en lot'),
  });

  const orders = ordersQuery.data?.data ?? [];
  const totalPages = ordersQuery.data?.totalPages ?? 1;
  const total = ordersQuery.data?.total ?? 0;
  // Garde-fou pagination : si le nombre de pages chute sous la page courante
  // (suppression, changement de filtre serveur, action de masse…), on évite
  // de rester bloqué sur une page vide en revenant à la dernière page peuplée.
  useEffect(() => {
    if (totalPages >= 1 && page > totalPages) setPage(totalPages);
  }, [totalPages, page]);
  const employees = (Array.isArray(employeesQuery.data) ? employeesQuery.data : employeesQuery.data?.data) ?? [];

  // Auto-open order from notification click
  useEffect(() => {
    if (!selectedOrderId || orders.length === 0) return;
    const found = orders.find((o) => o.id === selectedOrderId);
    if (found) {
      setSelectedOrder(found);
      setDetailDialogOpen(true);
      setSelectedOrderId(null);
    } else {
      // Order might not be on current page — fetch it directly
      fetch(`/api/v1/orders/${selectedOrderId}`)
        .then((r) => r.json())
        .then((res) => {
          const order = res.data ?? res;
          if (order?.id) {
            setSelectedOrder(order);
            setDetailDialogOpen(true);
          }
        })
        .catch(() => {})
        .finally(() => setSelectedOrderId(null));
    }
  }, [selectedOrderId, orders, setSelectedOrderId]);

  // Detect duplicate phone numbers within current page (same phone = potential duplicate)
  const phoneCounts = orders.reduce((acc: Record<string, number>, o) => {
    if (o.customer_phone) acc[o.customer_phone] = (acc[o.customer_phone] || 0) + 1;
    return acc;
  }, {});
  const isDuplicatePhone = (phone: string) => (phoneCounts[phone] ?? 0) > 1;

  // ─── Micro-detail order type filters (client-side, over the loaded page) ───
  const ORDER_TYPE_FILTERS: { id: string; label: string; color: string; match: (o: Order) => boolean }[] = [
    { id: 'ALL',       label: 'Toutes',            color: 'bg-slate-100 text-slate-700 border-slate-200',      match: () => true },
    // "Normales" = reçues via un canal réel (landing page, Meta Ads, storefront...),
    // JAMAIS les commandes saisies manuellement par un agent — ce sont deux
    // catégories distinctes (voir le filtre "Manuelle" ci-dessous), une
    // commande manuelle ne doit jamais compter dans les deux à la fois.
    { id: 'NORMAL',    label: '🟦 Normales',        color: 'bg-blue-50 text-blue-700 border-blue-200',          match: (o) => o.source !== 'MANUAL' && !o.is_abandoned_cart && !o.is_upsell && !o.is_pack && !(o.is_duplicate || isDuplicatePhone(o.customer_phone)) },
    { id: 'MANUAL',    label: '✍️ Manuelle',        color: 'bg-indigo-50 text-indigo-700 border-indigo-200',    match: (o) => o.source === 'MANUAL' },
    { id: 'ABANDONED', label: '🟧 Paniers Aband.',  color: 'bg-orange-50 text-orange-700 border-orange-200',    match: (o) => !!o.is_abandoned_cart && !o.recovered_at && !['CONFIRMED', 'SHIPPED', 'DELIVERED'].includes(o.status) },
    { id: 'RECOVERED', label: '🟩 Récupérés',       color: 'bg-emerald-50 text-emerald-700 border-emerald-200', match: (o) => !!o.is_abandoned_cart && (!!o.recovered_at || ['CONFIRMED', 'SHIPPED', 'DELIVERED'].includes(o.status)) },
    // Deux catégories d'annulation, jamais confondues : une commande NORMALE
    // annulée (vraie commande passée puis annulée) n'a rien à voir, côté
    // diagnostic, avec un simple PANIER ABANDONNÉ jamais confirmé — les
    // mélanger masquait le vrai taux d'annulation des ventes réelles.
    { id: 'CANCELLED_NORMAL',   label: '❌ Annulée (Normale)',           color: 'bg-red-50 text-red-700 border-red-200',     match: (o) => o.status === 'CANCELLED' && !o.is_abandoned_cart },
    { id: 'CANCELLED_ABANDONED', label: '❌🟧 Annulée (Panier Aband.)',  color: 'bg-orange-50 text-red-700 border-orange-200', match: (o) => o.status === 'CANCELLED' && !!o.is_abandoned_cart },
    // Matches orders that ABSORBED at least one duplicate (duplicate_count
    // attached by GET /orders, see orders.py) — was previously matching
    // is_duplicate/isDuplicatePhone, which flags the MERGED CHILD, not the
    // parent — and MERGED children are excluded from the default listing
    // entirely, so this filter almost always showed zero results even with
    // real duplicates in the store. This is what actually answers "why does
    // Meta Ads show more orders than the ERP" — click it to see exactly
    // which orders absorbed a resubmit, and how many.
    { id: 'DUPLICATE', label: '🟣 Doublons',        color: 'bg-purple-50 text-purple-700 border-purple-200',    match: (o) => (o.duplicate_count ?? 0) > 0 },
    { id: 'NRP',       label: '🟥 NRP',             color: 'bg-rose-50 text-rose-700 border-rose-200',          match: (o) => (o.nrp_count || 0) > 0 },
    { id: 'UPSELL',    label: '💸 Upsell',          color: 'bg-green-50 text-green-700 border-green-200',       match: (o) => !!o.is_upsell },
    { id: 'PACK',      label: '📦 Packs',           color: 'bg-cyan-50 text-cyan-700 border-cyan-200',          match: (o) => !!o.is_pack },
    { id: 'TRACKED',   label: '🔵 NOEST/Transporteur', color: 'bg-cyan-50 text-cyan-700 border-cyan-200',       match: (o) => !!o.tracking_number },
    { id: 'INTERNAL',  label: '🚴 Livraison interne',  color: 'bg-sky-50 text-sky-700 border-sky-200',          match: (o) => !!o.livreur_id },
    { id: 'PROMO',     label: '🏷️ Avec promo',      color: 'bg-pink-50 text-pink-700 border-pink-200',          match: (o) => !!o.promo_code },
  ];
  const displayOrders = typeFilter === 'ALL'
    ? orders
    : orders.filter(ORDER_TYPE_FILTERS.find((f) => f.id === typeFilter)?.match ?? (() => true));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { 
      const next = new Set(prev); 
      if (next.has(id)) next.delete(id); 
      else next.add(id); 
      return next; 
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === orders.length && orders.length > 0) setSelectedIds(new Set());
    else setSelectedIds(new Set(orders.map((o) => o.id)));
  };

  const handleStatusChange = (orderId: string, newStatus: OrderStatus, orderNumber?: string | number) => {
    if (newStatus === 'CANCELLED') {
      setCancelConfirmOrder({ orderId, orderNumber });
      return;
    }
    statusMutation.mutate({ orderId, status: newStatus });
  };
  
  const handleAssignClick = (orderId: string) => { 
    setAssignOrderId(orderId); 
    setSelectedEmployeeId(''); 
    setAssignDialogOpen(true); 
  };
  
  const handleDetailClick = (order: Order) => { 
    setSelectedOrder(order); 
    setDetailDialogOpen(true); 
  };
  
  const handleAssignConfirm = () => { 
    if (!assignOrderId || !selectedEmployeeId) return; 
    assignMutation.mutate({ orderId: assignOrderId, assignedTo: selectedEmployeeId }); 
  };

  const toggleExpandMerged = async (orderId: string) => {
    const next = new Set(expandedMergedOrders);
    const wasExpanded = next.has(orderId);
    if (wasExpanded) {
      next.delete(orderId);
    } else {
      next.add(orderId);
    }
    setExpandedMergedOrders(next);

    // Fetch the actual duplicate details (order numbers, items, dates) the
    // first time this order is expanded — GET /orders (list) only gives us
    // duplicate_count, not the merged orders themselves.
    if (!wasExpanded && !childOrdersById[orderId]) {
      setLoadingChildOrdersId(orderId);
      try {
        const full = await apiFetch<any>(`/api/v1/orders/${orderId}`);
        setChildOrdersById(prev => ({ ...prev, [orderId]: full?.child_orders ?? [] }));
      } catch (err) {
        console.error('Failed to load duplicate details for order', orderId, err);
      } finally {
        setLoadingChildOrdersId(null);
      }
    }
  };

  const handleUnmerge = async (childId: string, orderNumber: string) => {
    if (!window.confirm(`Êtes-vous sûr de vouloir séparer la commande doublon ${orderNumber} de sa commande principale ? Elle redeviendra une commande indépendante.`)) {
      return;
    }
    
    try {
      const res = await apiFetch<any>(`/api/v1/orders/${childId}/unmerge`, {
        method: 'POST'
      });
      if (res && (res.success || res.status === 200)) {
        toast.success(`La commande ${orderNumber} a été séparée avec succès.`);
        ordersQuery.refetch();
      } else {
        toast.error(res?.message || "Erreur lors de la séparation de la commande.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Erreur réseau lors de la séparation de la commande.");
    }
  };

  const handleMergeDuplicates = async (order: Order) => {
    if (!window.confirm(`Fusionner tous les doublons (même téléphone, en cours de confirmation) dans la commande ${order.order_number} ? Les doublons seront conservés avec un historique complet mais une seule commande sera expédiée.`)) {
      return;
    }
    try {
      const res = await apiFetch<any>(`/api/v1/orders/${order.id}/merge-duplicates`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (res?.success) {
        toast.success(res.message || `${res.merged} doublon(s) fusionné(s).`);
        ordersQuery.refetch();
      } else {
        toast.error(res?.message || 'Erreur lors de la fusion.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Erreur réseau lors de la fusion.');
    }
  };

  const handleShipViaNoest = async (order: Order) => {
    try {
      const res = await fetch('/api/noest/ship', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
      });
      const data = await res.json();
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        queryClient.invalidateQueries({ queryKey: ['admin-products'] });
        queryClient.invalidateQueries({ queryKey: ['admin-products-stock'] });
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
        toast.success(`${formatOrderRef(order, 'admin')} expédiée — N° suivi : ${data.tracking}`);
      } else {
        toast.error(data.message ?? 'Erreur NOEST');
      }
    } catch {
      toast.error('Erreur de connexion au serveur');
    }
  };

  const handleBulkNoestShip = async () => {
    setIsProcessingBulk(true);
    const targetOrders = orders.filter(o => selectedIds.has(o.id) && o.status === 'CONFIRMED');
    for (const order of targetOrders) { await handleShipViaNoest(order); }
    setSelectedIds(new Set());
    setIsProcessingBulk(false);
  };

  const VIEW_LABELS: Record<string, string> = {
    NEW: 'Nouvelles Commandes',
    'EN ATTENTE': 'Commandes Assignées',
    CONFIRMED: 'Commandes Confirmées',
    FOLLOWUP: 'Suivi de Livraison',
    COMPLETED: 'Commandes Terminées',
    CANCELLED: 'Annulations & Retours',
    ABANDONED: 'Paniers Abandonnés',
    ALL: 'Archive Complète',
  };

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const formatDupTime = (dateStr: string) => `${new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <div className="flex flex-col min-h-screen bg-[#F8F9FC] animate-in fade-in duration-500">
      <div className="p-8 space-y-8 max-w-[1600px] mx-auto w-full">
        {/* Main Header */}
        <div className="bg-white rounded-3xl sm:rounded-[40px] border px-6 sm:px-10 py-6 sm:py-8 shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative overflow-hidden" style={{ borderColor: C.border }}>
          <div className="absolute top-0 right-0 p-10 opacity-[0.03] text-[#4b7bec] pointer-events-none"><ShoppingBag className="size-48" /></div>
          <div className="flex items-center gap-4 sm:gap-6 relative z-10">
            <div className="size-12 sm:size-16 rounded-2xl sm:rounded-3xl flex items-center justify-center bg-[#F0F5FF] text-[#4b7bec] shadow-inner shrink-0">
              <Package className="size-6 sm:size-8" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">{VIEW_LABELS[viewMode] || 'Gestion des ventes'}</h1>
              <p className="text-[11px] sm:text-sm font-medium text-slate-400 mt-1">Gérez vos flux de commandes et expéditions</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto relative z-10">
            <Button variant="outline" onClick={() => exportToCSV(orders as any, 'commandes', REGISTRY_COLUMNS)} className="h-10 sm:h-12 px-4 sm:px-6 rounded-xl sm:rounded-2xl text-xs font-bold border hover:bg-slate-50 transition-all text-slate-600 bg-white" style={{ borderColor: C.border }}>
              <Download className="mr-2 size-4" /> Exporter CSV
            </Button>
            <Button onClick={() => setIsCreatingOrder(true)} className="h-10 sm:h-12 px-6 sm:px-8 rounded-xl sm:rounded-2xl text-[12px] sm:text-sm font-bold bg-[#4b7bec] hover:bg-[#3867d6] text-white shadow-lg shadow-indigo-100 transition-all flex items-center border-none">
              <Plus className="mr-2 size-4 sm:size-5" /> Nouvelle commande
            </Button>
          </div>
        </div>

        {/* Store Analytics Overview Section */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <BarChart3 className="size-5 text-[#4b7bec]" />
                Performances par Boutique
              </h2>
              <p className="text-xs font-bold text-slate-400">Analyse de conversion et de rentabilité en temps réel</p>
            </div>
            
            <div className="flex items-center gap-1.5 bg-white border rounded-2xl p-1 shadow-sm w-fit overflow-x-auto no-scrollbar" style={{ borderColor: C.border }}>
              {PERIODS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => applyPeriodPreset(p.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap",
                    analyticsPeriod === p.value 
                      ? "bg-[#4b7bec] text-white shadow-md shadow-indigo-100" 
                      : "text-slate-500 hover:bg-slate-50"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {storesAnalyticsQuery.isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-white rounded-3xl p-6 border space-y-4 h-[220px]" style={{ borderColor: C.border }}>
                  <Skeleton className="h-6 w-1/3 rounded-lg" />
                  <div className="grid grid-cols-2 gap-4">
                    <Skeleton className="h-12 rounded-xl" />
                    <Skeleton className="h-12 rounded-xl" />
                    <Skeleton className="h-12 rounded-xl" />
                    <Skeleton className="h-12 rounded-xl" />
                  </div>
                </div>
              ))
            ) : storesAnalyticsQuery.data?.data?.map((store: any) => {
              const totalOrders = store.total_orders;
              const revenue = store.revenue;
              const averageBasket = store.average_basket;
              const conversionRate = store.conversion_rate;

              return (
                <div 
                  key={store.store_id} 
                  className={cn(
                    "bg-white rounded-[32px] p-6 border shadow-sm transition-all hover:shadow-md hover:scale-[1.01] duration-300 relative overflow-hidden flex flex-col justify-between",
                    activeStore?.id === store.store_id ? "border-[#4b7bec] ring-1 ring-[#4b7bec]/20" : ""
                  )}
                  style={{ borderColor: activeStore?.id === store.store_id ? '#4b7bec' : C.border }}
                >
                  {activeStore?.id === store.store_id && (
                    <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-indigo-500/10 to-transparent rounded-bl-full pointer-events-none" />
                  )}

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="size-9 rounded-xl flex items-center justify-center bg-indigo-50 text-[#4b7bec] font-black shadow-inner shrink-0">
                          {store.store_name?.substring(0,2).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="text-sm font-black text-slate-800 tracking-tight">{store.store_name}</h3>
                          <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">ID: {store.store_id?.split('-')[0]}</span>
                        </div>
                      </div>
                      
                      {activeStore?.id === store.store_id ? (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-indigo-50 text-[#4b7bec] border border-indigo-100">Boutique Active</span>
                      ) : (
                        <button 
                          type="button"
                          onClick={() => {
                            const found = allStores.find(st => st.id === store.store_id);
                            if (found) switchToStore(found.id);
                          }}
                          className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider text-slate-400 hover:text-[#4b7bec] hover:bg-indigo-50/50 transition-colors"
                        >
                          Sélectionner
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-x-6 gap-y-4 pt-2">
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Chiffre d'Affaires</span>
                        <span className="text-base font-black text-slate-900 font-mono">{revenue.toLocaleString('fr-FR')} DA</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Cde. Livrées</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-black text-[#4b7bec]">{conversionRate}%</span>
                          <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-[#4b7bec] rounded-full" style={{ width: `${Math.min(100, conversionRate)}%` }} />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Commandes Totales</span>
                        <span className="text-sm font-black text-slate-800">{totalOrders} commandes</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Panier Moyen</span>
                        <span className="text-sm font-black text-slate-800 font-mono">{averageBasket.toLocaleString('fr-FR')} DA</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 mt-4 border-t border-slate-50 flex items-center justify-between gap-1.5 text-[9px] font-black uppercase tracking-wider text-slate-500">
                    <span className="flex items-center gap-1 text-slate-400">
                      <span className="size-1.5 rounded-full bg-slate-300" />
                      Attente: <strong className="text-slate-700">{store.pending_orders}</strong>
                    </span>
                    <span className="flex items-center gap-1 text-[#4b7bec]">
                      <span className="size-1.5 rounded-full bg-[#4b7bec]" />
                      Conf: <strong className="text-slate-700">{store.confirmed_orders}</strong>
                    </span>
                    <span className="flex items-center gap-1 text-green-500">
                      <span className="size-1.5 rounded-full bg-green-500" />
                      Livr: <strong className="text-slate-700">{store.delivered_orders}</strong>
                    </span>
                    <span className="flex items-center gap-1 text-rose-500">
                      <span className="size-1.5 rounded-full bg-rose-500" />
                      Ann: <strong className="text-slate-700">{store.cancelled_orders}</strong>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ─── Badges de synthèse (période = filtre date uniquement) ───
            Remplace l'ancienne grille de statuts cliquables (NEW/ASSIGNED/
            CONFIRMED/.../TOTAL/DOUBLONS) + la ligne "Reçues" séparée en
            dessous : les deux affichaient des comptages qui se recoupaient
            (ex. panier abandonné et doublons apparaissaient dans les deux
            blocs, avec des libellés différents pour le même chiffre). Le
            filtrage par statut détaillé reste disponible via les onglets
            Nouvelles/En Cours/Confirmées/... plus bas — cette ligne est
            uniquement informative, pas cliquable, et suit le même filtre
            date que le reste de la page. */}
        {!!receivedCounts && (receivedCounts.normal + receivedCounts.abandoned) > 0 && (
          <div className="flex items-center gap-2 flex-wrap text-[10px] font-bold text-slate-500">
            {/* Reçues — badges colorés uniquement, sans emoji. "Commande
                normale" exclut manuelle/upsell/panier (abandonné ou
                récupéré) — chaque catégorie est distincte, jamais un
                sous-ensemble d'une autre (voir get_order_counts). Chaque
                badge bascule le pill "Filtre type" existant (typeFilter/
                ORDER_TYPE_FILTERS) ou change d'onglet. */}
            <span className="uppercase tracking-wider">Reçues :</span>
            <button
              type="button"
              onClick={() => setTypeFilter(prev => prev === 'NORMAL' ? 'ALL' : 'NORMAL')}
              className={cn(
                "px-2 py-1 rounded-lg border transition-colors",
                typeFilter === 'NORMAL' ? "bg-blue-600 text-white border-blue-600" : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
              )}
            >
              {receivedCounts.normal} commande{receivedCounts.normal > 1 ? 's' : ''} normale{receivedCounts.normal > 1 ? 's' : ''}
            </button>
            {(receivedCounts.manual ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => setTypeFilter(prev => prev === 'MANUAL' ? 'ALL' : 'MANUAL')}
                className={cn(
                  "px-2 py-1 rounded-lg border transition-colors",
                  typeFilter === 'MANUAL' ? "bg-indigo-600 text-white border-indigo-600" : "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                )}
              >
                {receivedCounts.manual} manuelle{(receivedCounts.manual ?? 0) > 1 ? 's' : ''}
              </button>
            )}
            {(tabCounts['RETURNED'] ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => handleModeChange('CANCELLED')}
                title="Ouvre l'onglet Annulées/Retours (regroupe CANCELLED + RETURNED)."
                className={cn(
                  "px-2 py-1 rounded-lg border transition-colors",
                  viewMode === 'CANCELLED' ? "bg-rose-600 text-white border-rose-600" : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
                )}
              >
                {tabCounts['RETURNED']} retournée{(tabCounts['RETURNED'] ?? 0) > 1 ? 's' : ''}
              </button>
            )}
            {(receivedCounts.cancelled ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => setTypeFilter(prev => prev === 'CANCELLED_NORMAL' ? 'ALL' : 'CANCELLED_NORMAL')}
                className={cn(
                  "px-2 py-1 rounded-lg border transition-colors",
                  typeFilter === 'CANCELLED_NORMAL' ? "bg-red-600 text-white border-red-600" : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                )}
              >
                {receivedCounts.cancelled} annulée{(receivedCounts.cancelled ?? 0) > 1 ? 's' : ''}
              </button>
            )}
            {(tabCounts['DELIVERED'] ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => handleModeChange('COMPLETED')}
                className={cn(
                  "px-2 py-1 rounded-lg border transition-colors",
                  viewMode === 'COMPLETED' ? "bg-green-600 text-white border-green-600" : "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                )}
              >
                {tabCounts['DELIVERED']} livrée{(tabCounts['DELIVERED'] ?? 0) > 1 ? 's' : ''}
              </button>
            )}
            {(receivedCounts.upsell ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => setTypeFilter(prev => prev === 'UPSELL' ? 'ALL' : 'UPSELL')}
                className={cn(
                  "px-2 py-1 rounded-lg border transition-colors",
                  typeFilter === 'UPSELL' ? "bg-emerald-600 text-white border-emerald-600" : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                )}
              >
                {receivedCounts.upsell} upsell{(receivedCounts.upsell ?? 0) > 1 ? 's' : ''}
              </button>
            )}
            {(receivedCounts.recovered ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => setTypeFilter(prev => prev === 'RECOVERED' ? 'ALL' : 'RECOVERED')}
                className={cn(
                  "px-2 py-1 rounded-lg border transition-colors",
                  typeFilter === 'RECOVERED' ? "bg-violet-600 text-white border-violet-600" : "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100"
                )}
              >
                {receivedCounts.recovered} panier{(receivedCounts.recovered ?? 0) > 1 ? 's' : ''} récupéré{(receivedCounts.recovered ?? 0) > 1 ? 's' : ''}
              </button>
            )}
            {receivedCounts.abandoned > 0 && (
              <button
                type="button"
                onClick={() => setTypeFilter(prev => prev === 'ABANDONED' ? 'ALL' : 'ABANDONED')}
                className={cn(
                  "px-2 py-1 rounded-lg border transition-colors",
                  typeFilter === 'ABANDONED' ? "bg-orange-600 text-white border-orange-600" : "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
                )}
              >
                {receivedCounts.abandoned} panier{receivedCounts.abandoned > 1 ? 's' : ''} abandonné{receivedCounts.abandoned > 1 ? 's' : ''}
              </button>
            )}
          </div>
        )}

        {/* Tactical Filter Rack */}
        <div className="bg-white rounded-2xl sm:rounded-[32px] border px-4 sm:px-8 py-4 sm:py-6 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-4 sm:gap-6 shadow-sm sticky top-4 z-20 backdrop-blur-md bg-white/90" style={{ borderColor: C.border }}>
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4 sm:gap-6 flex-1 min-w-0">
            {/* min-w on the input itself (not just its wrapper) so it can never
                get squeezed to near-zero width by the tab list next to it — that
                was the actual "search bar isn't visible" bug on medium/laptop
                viewports where both siblings shared flex-1 with no floor. */}
            <div className="relative w-full md:w-auto md:flex-1 md:min-w-[220px] shrink-0">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-300" />
              <Input
                placeholder="Rechercher client, téléphone ou ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-11 h-10 sm:h-12 bg-slate-50/50 border-slate-100 rounded-xl sm:rounded-2xl text-xs sm:text-sm font-medium focus-visible:ring-[#4b7bec] w-full"
              />
            </div>
            
            <div className="hidden md:block h-8 w-px bg-slate-100" />
            
            <div className="flex items-center gap-2 w-full sm:w-auto">
              {/* Onglets de statut convertis en dropdown — la rangée horizontale
                  scrollable (Nouvelles/En Cours/.../Tous) prenait trop de place
                  et nécessitait un défilement latéral même sur un écran normal. */}
              <Select
                value={viewMode}
                onValueChange={(v) => handleModeChange(v)}
              >
                <SelectTrigger className="h-10 sm:h-12 bg-slate-50/50 border-slate-100 rounded-xl sm:rounded-2xl text-xs sm:text-sm font-bold w-full sm:w-[220px]">
                  <SelectValue placeholder="Filtrer par statut" />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { id: 'NEW',        label: 'Nouvelles',  statusKey: 'NEW' },
                    { id: 'EN ATTENTE', label: 'En Cours',   statusKey: 'ASSIGNED' },
                    { id: 'CONFIRMED',  label: 'Confirmées', statusKey: 'CONFIRMED' },
                    { id: 'FOLLOWUP',   label: 'Suivi',      statusKey: 'SHIPPED' },
                    { id: 'COMPLETED',  label: 'Terminées',  statusKey: 'DELIVERED' },
                    { id: 'CANCELLED',  label: 'Annulées & Retours', statusKey: 'CANCELLED' },
                    { id: 'ABANDONED',  label: 'Abandonnés', statusKey: 'ABANDONED' },
                    { id: 'ALL',        label: 'Tous',       statusKey: 'ALL' },
                  ].map(tab => {
                    const count = tab.statusKey === 'ALL'
                      ? Object.entries(tabCounts).reduce((a, [k, v]) => k === 'MERGED' ? a : a + v, 0)
                      // CANCELLED tab is also RETURNED's home (see MODE_TO_STATUS →
                      // 'ARCHIVED') — its badge count must include both or it
                      // undercounts vs. what the tab actually displays when clicked.
                      : tab.statusKey === 'CANCELLED'
                      ? (tabCounts['CANCELLED'] ?? 0) + (tabCounts['RETURNED'] ?? 0)
                      // "En Cours" (EN ATTENTE) is the shared home for
                      // ASSIGNED/CALLED/IN_PROGRESS/RESCHEDULED (see
                      // STATUS_TO_MODE above) — the badge was hardcoded to
                      // ASSIGNED alone, showing e.g. "2" while the KPI grid's
                      // own "En cours" card (IN_PROGRESS) showed "38" for the
                      // SAME French label, and clicking any of the 4 statuses
                      // lands on this exact tab. Sum all 4 so the badge
                      // matches what the tab actually displays.
                      : tab.statusKey === 'ASSIGNED'
                      ? (tabCounts['ASSIGNED'] ?? 0) + (tabCounts['CALLED'] ?? 0) + (tabCounts['IN_PROGRESS'] ?? 0) + (tabCounts['RESCHEDULED'] ?? 0)
                      : (tabCounts[tab.statusKey] ?? (tab.id === viewMode ? total : undefined));
                    return (
                      <SelectItem key={tab.id} value={tab.id} className="text-xs font-bold">
                        <span className="flex items-center gap-2">
                          {tab.label}
                          {count !== undefined && count > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-slate-100 text-slate-500">{count}</span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3 justify-end flex-wrap sm:flex-nowrap w-full md:w-auto mt-4 md:mt-0">
            <div className="flex items-center gap-2 bg-white border border-slate-100 rounded-xl px-3 py-1.5 shadow-sm">
               <Calendar className="size-4 text-slate-400" />
               <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent text-xs font-bold text-slate-600 outline-none w-[110px]" />
               <span className="text-slate-300">-</span>
               <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent text-xs font-bold text-slate-600 outline-none w-[110px]" />
            </div>
            <button onClick={() => setAdvancedFiltersOpen(true)}
               className={cn("p-2.5 sm:p-3 rounded-xl sm:rounded-2xl border transition-all text-slate-400 bg-white shadow-sm", advancedFiltersOpen ? "border-[#4b7bec] text-[#4b7bec] bg-indigo-50/50" : "border-slate-100 hover:bg-slate-50")}
            >
               <Filter className="size-4 sm:size-5" />
            </button>
            {(filterWilaya || filterSource || startDate || endDate || searchQuery || analyticsPeriod !== '30d') && (
              <button 
                onClick={clearAllFilters} 
                className="flex items-center gap-1.5 px-3 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl border border-rose-100 bg-rose-50 hover:bg-rose-100 transition-all text-rose-600 font-bold text-xs shadow-sm shrink-0"
              >
                <X className="size-4" />
                Effacer ({[filterWilaya, filterSource, startDate, endDate, searchQuery].filter(Boolean).length})
              </button>
            )}
            <button onClick={() => ordersQuery.refetch()} className="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl border border-slate-100 bg-white hover:bg-slate-50 shadow-sm transition-all text-slate-400">
               <RefreshCw className={cn("size-4 sm:size-5", ordersQuery.isFetching && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* ─── Filtres par type de commande (micro-détails) ─── */}
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">Filtrer par type</span>
          <span className="h-px flex-1 bg-slate-100 min-w-[16px]" />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {ORDER_TYPE_FILTERS.map((f) => {
            const pageCount = f.id === 'ALL' ? orders.length : orders.filter(f.match).length;
            // "Doublons" uses a dedicated store-wide-but-DATE-SCOPED count
            // (see duplicateStatsQuery above, now filtered by the same
            // startDate/endDate as the rest of the dashboard) instead of
            // just whatever duplicates happen to be on the currently-loaded
            // page — every other badge stays page-scoped, which is correct
            // for a quick filter over what's visible.
            const count = f.id === 'DUPLICATE' ? Math.max(pageCount, storeWideDuplicateCount) : pageCount;
            if (f.id !== 'ALL' && count === 0) return null;
            const active = typeFilter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setTypeFilter(active ? 'ALL' : f.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-black transition-all',
                  f.color,
                  active ? 'ring-2 ring-offset-1 ring-slate-400 shadow-sm' : 'opacity-75 hover:opacity-100',
                )}
                title={active ? 'Cliquer pour retirer le filtre' : `Filtrer : ${f.label}`}
              >
                {f.label}
                <span className="px-1.5 py-0.5 rounded-full bg-white/70 text-[9px] font-black tabular-nums">{count}</span>
              </button>
            );
          })}
          {typeFilter !== 'ALL' && (
            <span className="text-[10px] font-bold text-slate-500 ml-1 px-2 py-0.5 rounded-lg bg-amber-50 border border-amber-100">
              {displayOrders.length} commande{displayOrders.length > 1 ? 's' : ''} — filtre appliqué sur tout ce statut/période
            </span>
          )}
        </div>

        {/* Sélecteur de vue — Liste / Kanban / Carte des livraisons */}
        <div className="flex items-center gap-1.5 bg-white rounded-2xl border p-1.5 w-fit" style={{ borderColor: C.border }}>
          {([['LIST', 'Liste'], ['KANBAN', 'Kanban'], ['MAP', 'Carte livraisons']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setListViewMode(id)}
              className={cn('px-3.5 py-2 rounded-xl text-xs font-bold transition-all',
                listViewMode === id ? 'bg-[#4b7bec] text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50')}>
              {label}
            </button>
          ))}
        </div>

        {listViewMode === 'KANBAN' ? (
          <OrdersKanbanView orders={displayOrders} onOpenOrder={handleDetailClick} />
        ) : listViewMode === 'MAP' ? (
          <OrdersMapView orders={displayOrders} onOpenOrder={handleDetailClick} />
        ) : (
        <>
        {/* Performance Ledger Table */}
        <div className="bg-white rounded-[32px] border shadow-sm overflow-hidden" style={{ borderColor: C.border }}>
          <div className="hidden md:block">
            <table className="w-full text-left table-fixed">
              <thead>
                <tr className="border-b" style={{ borderColor: C.border, backgroundColor: '#FAFBFD' }}>
                  <th className="px-3 xl:px-4 py-5 w-12"><Checkbox checked={selectedIds.size === orders.length && orders.length > 0} onCheckedChange={toggleSelectAll} /></th>
                  {REGISTRY_COLUMNS.map(col => (
                    <th key={col.key} className={cn("px-3 xl:px-4 py-5 text-xs font-bold text-slate-500 truncate", col.hideBelow && HIDE_BELOW_CLASS[col.hideBelow])}>{col.label}</th>
                  ))}
                  <th className="px-3 xl:px-4 py-5 text-right text-xs font-bold text-slate-500 w-32">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: C.border }}>
                {ordersQuery.isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i}><td colSpan={10} className="px-10 py-5"><Skeleton className="h-14 w-full rounded-2xl" /></td></tr>
                  ))
                ) : displayOrders.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 xl:px-4 py-20 text-center text-slate-400 font-medium">Aucune commande trouvée</td></tr>
                ) : displayOrders.map((order) => (
                  <React.Fragment key={order.id}>
                    <tr
                      className="hover:bg-slate-50/60 transition-colors group relative"
                      style={{ boxShadow: `inset 3px 0 0 0 ${ORDER_STATUS_COLORS[order.status] || '#E2E8F0'}` }}
                    >
                      <td className="px-3 xl:px-4 py-6"><Checkbox checked={selectedIds.has(order.id)} onCheckedChange={() => toggleSelect(order.id)} /></td>
                    <td className="px-3 xl:px-4 py-6 hidden 2xl:table-cell">
                      {order.source === 'MANUAL' ? (
                        <Badge className="bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-[10px] font-black shadow-none px-2 py-1 uppercase tracking-wider">
                          Manuel
                        </Badge>
                      ) : order.source === 'FACEBOOK' ? (
                        <Badge className="bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-[10px] font-black shadow-none px-2 py-1 uppercase tracking-wider">
                          Meta Ads
                        </Badge>
                      ) : (
                        <Badge className="bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[10px] font-black shadow-none px-2 py-1 uppercase tracking-wider">
                          {order.source === 'landing_page' ? 'Landing Page' : order.source}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 xl:px-4 py-6">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-900 group-hover:bg-[#4b7bec] transition-colors text-white text-[11px] font-black tracking-tight tabular-nums">
                            {formatOrderRef(order, 'admin')}
                          </span>
                          {order.status === 'NEW' && (
                            <span className="size-2 bg-rose-500 rounded-full animate-pulse" title="Nouveau" />
                          )}
                        </div>
                        <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest pl-0.5">ID: {order.id.split('-')[0]}</span>
                      </div>
                    </td>
                    <td className="px-3 xl:px-4 py-6">
                      <div className="flex items-start gap-2.5">
                        <div
                          className="size-8 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black text-white uppercase select-none"
                          style={{ backgroundColor: ORDER_STATUS_COLORS[order.status] || '#94A3B8' }}
                          title={order.customer_name}
                        >
                          {(order.customer_name || '?').trim().slice(0, 2)}
                        </div>
                        <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-800 truncate">{order.customer_name}</span>
                          {(order.is_duplicate || isDuplicatePhone(order.customer_phone)) && (
                            <Badge className="bg-purple-100 text-purple-700 border-none rounded-md text-[8px] font-black shadow-none uppercase px-1.5 py-0.5">🟣 Doublon</Badge>
                          )}
                          {/* Distinct from "🟣 Doublon" above (which flags THIS
                              order as itself being a resubmit): this shows how
                              many OTHER submissions were absorbed INTO this
                              order — the concrete "why Meta Ads counts more
                              than the ERP" answer, visible per-order instead
                              of only as a store-wide total. */}
                          {!!order.duplicate_count && order.duplicate_count > 0 && (
                            <Badge
                              className="bg-purple-100 text-purple-700 border-none rounded-md text-[8px] font-black shadow-none uppercase px-1.5 py-0.5"
                              title={`${order.duplicate_count} resoumission${order.duplicate_count > 1 ? 's' : ''} du même client fusionnée${order.duplicate_count > 1 ? 's' : ''} dans cette commande${order.last_duplicate_at ? ` — dernière le ${formatDupTime(order.last_duplicate_at)}` : ''}`}
                            >
                              🟣 +{order.duplicate_count} doublon{order.duplicate_count > 1 ? 's' : ''} fusionné{order.duplicate_count > 1 ? 's' : ''}
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] font-bold text-[#4b7bec] mt-0.5">{order.customer_phone}</span>
                        {/* Origine métier (ne change jamais) + micro-badges — le
                            badge "source" (Manuel/Meta Ads/Landing Page) vivait
                            SEUL dans une colonne cachée sous 2xl (hidden 2xl:table-cell,
                            voir plus haut) ; ajouté ici aussi pour qu'il reste
                            visible sur la même ligne que les autres badges, à
                            toutes les largeurs d'écran. */}
                        <div className="flex items-center gap-1 flex-wrap mt-1">
                          {/* Date/heure de réception — vivait UNIQUEMENT dans la
                              colonne "Date & Heure" cachée sous xl (hidden
                              xl:table-cell, colonne dédiée plus loin dans la
                              ligne) : sur un écran/fenêtre plus étroit que 1280px,
                              cette info disparaissait entièrement. Dupliqué ici en
                              badge compact pour rester visible à toute largeur.
                              S'affiche sur TOUTES les commandes sans exception —
                              même celles déjà traitées/actionnées : la date de
                              réception ne bouge jamais, contrairement au statut. */}
                          {order.created_at && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-slate-100 text-slate-500 border border-slate-200 uppercase" title="Commande reçue dans l'ERP, pas encore traitée">
                              📥 Reçue le {new Date(order.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} {new Date(order.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          {order.source === 'MANUAL' ? (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-purple-100 text-purple-700 border border-purple-200 uppercase">Manuel</span>
                          ) : order.source === 'FACEBOOK' ? (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-blue-100 text-blue-700 border border-blue-200 uppercase">Meta Ads</span>
                          ) : order.source ? (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-indigo-100 text-indigo-700 border border-indigo-200 uppercase">{order.source === 'landing_page' ? 'Landing Page' : order.source}</span>
                          ) : null}
                          <OrderTypeBadge order={order} size="xs" short />
                          {(order.nrp_count || 0) > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-rose-100 text-rose-700 border border-rose-200 uppercase">🟥 NRP {order.nrp_count}</span>
                          )}
                          {order.next_callback_time && new Date(order.next_callback_time).getTime() <= Date.now() && !['CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED', 'MERGED'].includes(order.status) && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-red-100 text-red-700 border border-red-200 uppercase animate-pulse">⏰ Rappel échu</span>
                          )}
                          {order.is_upsell && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-green-100 text-green-700 border border-green-200 uppercase">💸 Upsell</span>
                          )}
                          {order.is_pack && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-cyan-100 text-cyan-700 border border-cyan-200 uppercase">📦 Pack</span>
                          )}
                          {order.tracking_number && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-cyan-100 text-cyan-700 border border-cyan-200 uppercase" title={`NOEST — ${order.tracking_number}`}>🚚 {order.tracking_number.slice(0, 12)}</span>
                          )}
                          {order.livreur_id && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-sky-100 text-sky-700 border border-sky-200 uppercase" title="Livreur assigné">🚴 {order.livreur?.name || 'Livreur'}</span>
                          )}
                          {order.utm_campaign && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-blue-100 text-blue-700 border border-blue-200 uppercase" title={`Campagne : ${order.utm_campaign}`}>📣 {String(order.utm_campaign).slice(0, 18)}</span>
                          )}
                          {!!order.events_count && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleDetailClick(order); }}
                              className="px-1.5 py-0.5 rounded text-[8px] font-black bg-slate-100 text-slate-500 border border-slate-200 uppercase hover:bg-slate-200 transition-colors"
                              title="Voir l'historique complet de cette commande"
                            >
                              🕘 {order.events_count} évènement{order.events_count > 1 ? 's' : ''}
                            </button>
                          )}
                        </div>
                        {!!order.duplicate_count && order.duplicate_count > 0 && (
                          <button
                            onClick={() => toggleExpandMerged(order.id)}
                            className="inline-flex items-center gap-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-full px-2 py-0.5 text-[10px] font-black shadow-sm transition-all mt-1.5 w-fit focus:outline-none"
                            title="Voir le détail des commandes fusionnées"
                          >
                            <span className="size-1.5 rounded-full bg-purple-500 animate-pulse" />
                            🟣 {order.duplicate_count} {order.duplicate_count > 1 ? 'doublons' : 'doublon'}{order.last_duplicate_at ? ` · dernier le ${formatDupTime(order.last_duplicate_at)}` : ''} — voir détails
                          </button>
                        )}
                        {order.notes && (
                          <span className="text-[9px] font-bold text-amber-800 bg-amber-50 border-none rounded px-1.5 py-0.5 mt-1.5 w-fit uppercase tracking-widest truncate max-w-[150px]" title={order.notes}>
                            Note: {order.notes}
                          </span>
                        )}
                        </div>
                        </div>
                    </td>
                    <td className="px-3 xl:px-4 py-6 hidden lg:table-cell">
                      <Badge className="bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[10px] font-bold shadow-none px-2.5 py-1 truncate max-w-[120px]">
                        {order.customer_wilaya}
                      </Badge>
                    </td>
                    <td className="px-3 xl:px-4 py-6 hidden xl:table-cell">
                      <div className="flex flex-col gap-1.5 max-w-[200px]">
                        {order.items && order.items.length > 0 ? (
                          order.items.slice(0, 3).map((item: any, i: number) => (
                            <div key={i} className="flex flex-col">
                              <span className="text-[11px] font-bold text-slate-800 truncate" title={item.product_name || 'Produit'}>
                                {item.quantity}x {item.product_name || 'Produit'}
                              </span>
                              {item.variant_name && (
                                <span className="text-[9px] font-bold text-slate-500 truncate" title={item.variant_name}>
                                  {item.variant_name}
                                </span>
                              )}
                            </div>
                          ))
                        ) : (
                           <span className="text-xs italic text-slate-400">Aucun article</span>
                        )}
                        {order.items && order.items.length > 3 && (
                          <span className="text-[10px] font-bold text-[#4b7bec]">+ {order.items.length - 3} autres...</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 xl:px-4 py-6">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-black text-slate-900 tabular-nums">{formatPrice(order.total)}</span>
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest tabular-nums">
                          Livraison: {order.delivery_fee > 0 ? formatPrice(order.delivery_fee) : 'Gratuite'}
                        </span>
                        {order.promo_code && order.discount > 0 && (
                          <span className="text-[9px] font-black text-[#6C5CE7] bg-[#F0EDFF] px-1.5 py-0.5 rounded-full w-fit tabular-nums mt-1 border border-[#6C5CE7]/20">
                            {order.promo_code} (-{formatPrice(order.discount)})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 xl:px-4 py-6">
                      <div className="flex flex-col gap-1.5 items-start">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className={cn(
                                "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all focus:outline-none",
                                order.status === 'NEW' ? "bg-rose-50 border-rose-200" :
                                order.status === 'CONFIRMED' ? "bg-emerald-50 border-emerald-200" :
                                order.status === 'SHIPPED' ? "bg-blue-50 border-blue-200" :
                                order.status === 'DELIVERED' ? "bg-green-50 border-green-200" :
                                order.status === 'CANCELLED' ? "bg-red-50 border-red-200" :
                                order.status === 'RETURNED' ? "bg-orange-50 border-orange-200" :
                                "bg-slate-50 border-slate-200"
                              )}>
                                <div className="size-2 rounded-full" style={{ backgroundColor: ORDER_STATUS_COLORS[order.status] || '#A0AEC0' }} />
                                <span className={cn(
                                  "text-[11px] font-black tracking-wide",
                                  order.status === 'NEW' ? "text-rose-700" :
                                  order.status === 'CONFIRMED' ? "text-emerald-700" :
                                  order.status === 'SHIPPED' ? "text-blue-700" :
                                  order.status === 'DELIVERED' ? "text-green-700" :
                                  order.status === 'CANCELLED' ? "text-red-700" :
                                  order.status === 'RETURNED' ? "text-orange-700" :
                                  "text-slate-700"
                                )}>{ORDER_STATUS_LABELS[order.status] || order.status}</span>
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-48 rounded-2xl shadow-xl border-slate-100 p-2">
                            {Object.entries(ORDER_STATUS_LABELS).map(([statusKey, label]) => (
                              <DropdownMenuItem
                                key={statusKey}
                                disabled={order.status === statusKey || statusKey === 'NEW'}
                                onClick={() => handleStatusChange(order.id, statusKey as OrderStatus, order.order_number)}
                                className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold cursor-pointer"
                              >
                                <div className="size-2 rounded-full" style={{ backgroundColor: ORDER_STATUS_COLORS[statusKey] || '#A0AEC0' }} />
                                {label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <NrpBadge count={order.nrp_count || 0} />
                        {order.next_callback_time && (
                          <CallbackCountdown nextCallbackTime={order.next_callback_time} />
                        )}
                      </div>
                    </td>
                    <td className="px-3 xl:px-4 py-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => handleDetailClick(order)} className="size-10 rounded-xl flex items-center justify-center bg-slate-50 border border-slate-100 text-slate-400 hover:text-[#4b7bec] hover:border-[#4b7bec] transition-all">
                          <Eye className="size-5" />
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="size-10 rounded-xl flex items-center justify-center bg-white border border-slate-100 text-slate-400 hover:text-slate-900 transition-all">
                              <MoreHorizontal className="size-5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="rounded-2xl border-slate-100 shadow-xl p-2 w-48">
                            <DropdownMenuLabel className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 py-2">Actions rapides</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => { setEditOrderData(order); setEditCommuneState(order.customer_commune || '');
      setEditOrderOpen(true); }} disabled={['DELIVERED','RETURNED','CANCELLED'].includes(order.status)} className="rounded-xl px-3 py-2 text-xs font-bold gap-3 focus:bg-indigo-50 focus:text-indigo-600">
                              <Settings2 className="size-4" /> Modifier la commande
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleAssignClick(order.id)} className="rounded-xl px-3 py-2 text-xs font-bold gap-3 focus:bg-[#F0F5FF] focus:text-[#4b7bec]">
                              <ArrowRightLeft className="size-4" /> Affecter agent
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleShipViaNoest(order)} className="rounded-xl px-3 py-2 text-xs font-bold gap-3 focus:bg-emerald-50 focus:text-emerald-600">
                              <Truck className="size-4" /> Expédier Noest
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleStatusChange(order.id, 'CANCELLED', order.order_number)} className="rounded-xl px-3 py-2 text-xs font-bold gap-3 text-rose-500 focus:bg-rose-50 focus:text-rose-600">
                              <XCircle className="size-4" /> Annuler
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                  {!!order.duplicate_count && order.duplicate_count > 0 && expandedMergedOrders.has(order.id) && (
                    <tr className="bg-purple-50/10 border-l-4 border-purple-400">
                      <td colSpan={10} className="px-3 xl:px-4 py-5">
                        <div className="flex flex-col gap-4">
                          <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-purple-600">Historique des commandes doublons fusionnées</h4>
                          {loadingChildOrdersId === order.id ? (
                            <div className="text-xs text-slate-400 font-bold py-4">Chargement des détails…</div>
                          ) : (
                          <div className="divide-y divide-purple-100/50 bg-white/70 backdrop-blur-md rounded-2xl border border-purple-100 shadow-sm overflow-hidden">
                            {(childOrdersById[order.id] ?? []).map((child: any) => (
                              <div key={child.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-slate-800">{child.order_number}</span>
                                    <Badge className="bg-slate-100 text-slate-600 text-[9px] font-bold rounded px-1.5 py-0.5 shadow-none border-none">
                                      Source: {child.source}
                                    </Badge>
                                    <Badge className="bg-purple-100 text-purple-700 text-[9px] font-bold rounded px-1.5 py-0.5 shadow-none border-none">
                                      Fusionné
                                    </Badge>
                                  </div>
                                  <span className="text-[10px] font-bold text-slate-400">
                                    Créé le: {new Date(child.created_at).toLocaleString('fr-FR')} | Fusionné le: {child.merged_at ? new Date(child.merged_at).toLocaleString('fr-FR') : '---'}
                                  </span>
                                  {child.notes && (
                                    <span className="text-[10px] font-medium text-amber-800 bg-amber-50 rounded px-2 py-0.5 w-fit mt-1">
                                      Note: {child.notes}
                                    </span>
                                  )}
                                </div>
                                
                                {/* Products list for child */}
                                <div className="flex flex-col gap-1 max-w-[250px]">
                                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Produits</span>
                                  {child.items && child.items.length > 0 ? (
                                    child.items.map((item: any, idx: number) => (
                                      <span key={idx} className="text-xs font-bold text-slate-700">
                                        {item.quantity}x {item.product_name}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-xs text-slate-400 italic">Aucun produit</span>
                                  )}
                                </div>

                                {/* Status & Unmerge button for admins */}
                                <div className="flex items-center gap-4">
                                  <div className="flex flex-col items-end gap-1">
                                    <span className="text-[10px] text-slate-400 font-bold">Statut initial</span>
                                    <span className="text-xs font-black text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                      {child.status_before_merge || 'NEW'}
                                    </span>
                                  </div>
                                  
                                  {user?.role === 'ADMIN' && (
                                    <button
                                      onClick={() => handleUnmerge(child.id, child.order_number)}
                                      className="flex items-center gap-1 bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 border border-rose-200 hover:border-rose-300 rounded-xl px-3 py-1.5 text-xs font-black shadow-sm transition-all focus:outline-none"
                                    >
                                      <ArrowRightLeft className="size-3.5" />
                                      Séparer
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="block md:hidden divide-y divide-slate-100">
            {ordersQuery.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="p-5 space-y-4 animate-pulse">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-6 w-1/4 rounded-lg" />
                    <Skeleton className="h-5 w-1/5 rounded-lg" />
                  </div>
                  <Skeleton className="h-10 w-full rounded-lg" />
                  <div className="flex justify-between items-center">
                    <Skeleton className="h-5 w-1/3 rounded-lg" />
                    <Skeleton className="h-6 w-8 rounded-lg" />
                  </div>
                </div>
              ))
            ) : displayOrders.length === 0 ? (
              <div className="p-8 text-center text-slate-400 font-medium">Aucune commande trouvée</div>
            ) : (
              displayOrders.map((order) => (
                <div key={order.id} className="p-5 space-y-4 hover:bg-slate-50/50 transition-colors group">
                  {/* Top Bar: Checkbox + Order Number + Source */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <Checkbox checked={selectedIds.has(order.id)} onCheckedChange={() => toggleSelect(order.id)} className="rounded-md" />
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-black text-slate-900">{formatOrderRef(order, 'admin')}</span>
                          {order.status === 'NEW' && (
                            <span className="px-2 py-0.5 text-[9px] font-black text-white bg-rose-500 rounded-full animate-pulse">
                              Nouveau
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] font-medium text-slate-400">Ref: {order.id.split('-')[0]}</span>
                      </div>
                    </div>
                    <div>
                      {order.source === 'MANUAL' ? (
                        <Badge className="bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-[9px] font-bold shadow-none">
                          Manuel
                        </Badge>
                      ) : (
                        <Badge className="bg-slate-100 text-slate-600 rounded-lg text-[9px] font-bold shadow-none border-none">
                          {order.source === 'FACEBOOK' ? 'Meta Ads' : order.source === 'landing_page' ? 'Landing Page' : order.source}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Customer Information & Amount */}
                  <div className="flex justify-between items-start gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-800">{order.customer_name}</span>
                        {(order.is_duplicate || isDuplicatePhone(order.customer_phone)) && (
                          <>
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-amber-100 text-amber-700 uppercase tracking-wide border border-amber-200">Doublon</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleMergeDuplicates(order); }}
                              className="px-1.5 py-0.5 rounded text-[8px] font-black bg-purple-100 hover:bg-purple-200 text-purple-700 uppercase tracking-wide border border-purple-200 transition-colors"
                              title="Fusionner tous les doublons de ce client dans cette commande"
                            >
                              Fusionner
                            </button>
                          </>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 flex items-center gap-2">
                        <Phone className="size-3.5 text-slate-400 shrink-0" />
                        <span className="font-semibold">{order.customer_phone}</span>
                      </p>
                      <p className="text-xs text-slate-500 flex items-center gap-2">
                        <MapPin className="size-3.5 text-slate-400 shrink-0" />
                        <span>{order.customer_wilaya}</span>
                      </p>
                      {order.notes && (
                        <div className="text-[9px] font-bold text-amber-800 bg-amber-50/70 border border-amber-100/70 rounded px-1.5 py-0.5 mt-1.5 w-fit uppercase tracking-wide">
                          Note: {order.notes}
                        </div>
                      )}
                      {!!order.duplicate_count && order.duplicate_count > 0 && (
                        <button
                          onClick={() => toggleExpandMerged(order.id)}
                          className="inline-flex items-center gap-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-full px-2 py-0.5 text-[10px] font-black shadow-sm transition-all mt-1.5 w-fit focus:outline-none"
                          title="Voir le détail des commandes fusionnées"
                        >
                          <span className="size-1.5 rounded-full bg-purple-500 animate-pulse" />
                          🟣 {order.duplicate_count} {order.duplicate_count > 1 ? 'doublons' : 'doublon'}{order.last_duplicate_at ? ` · dernier le ${formatDupTime(order.last_duplicate_at)}` : ''} — voir détails
                        </button>
                      )}
                    </div>
                    <div className="text-right space-y-1">
                      <span className="text-base font-black text-slate-900 tabular-nums">{formatPrice(order.total)}</span>
                      {order.promo_code && order.discount > 0 && (
                        <div className="text-[9px] font-black text-[#6C5CE7] bg-[#F0EDFF] px-1.5 py-0.5 rounded-full w-fit ml-auto tabular-nums">
                          {order.promo_code} (-{formatPrice(order.discount)})
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status, Assignee, Date & Actions */}
                  <div className="flex items-center justify-between pt-3 border-t border-slate-100/70 gap-2">
                    <div className="space-y-1.5">
                      {/* Status Dropdown */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="flex items-center gap-1.5 hover:bg-slate-100 px-2 py-1 -ml-2 rounded-lg transition-colors focus:outline-none">
                            <div className="size-2 rounded-full" style={{ backgroundColor: ORDER_STATUS_COLORS[order.status] || '#A0AEC0' }} />
                            <span className="text-xs font-bold text-slate-700">{ORDER_STATUS_LABELS[order.status] || order.status}</span>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-48 rounded-2xl shadow-xl border-slate-100 p-2">
                          {Object.entries(ORDER_STATUS_LABELS).map(([statusKey, label]) => (
                            <DropdownMenuItem
                              key={statusKey}
                              disabled={order.status === statusKey || statusKey === 'NEW'}
                              onClick={() => handleStatusChange(order.id, statusKey as OrderStatus, order.order_number)}
                              className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold cursor-pointer"
                            >
                              <div className="size-2 rounded-full" style={{ backgroundColor: ORDER_STATUS_COLORS[statusKey] || '#A0AEC0' }} />
                              {label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>

                      {/* NRP Count & Callback */}
                      <NrpBadge count={order.nrp_count || 0} />

                      {order.next_callback_time && (
                        <CallbackCountdown nextCallbackTime={order.next_callback_time} />
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {/* Assignee & Date */}
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-medium">
                        {order.assignee ? (
                          <span className="text-slate-600 font-semibold">{order.assignee.name}</span>
                        ) : (
                          <span className="text-slate-300 italic">Non assigné</span>
                        )}
                        <span>•</span>
                        <span>{order.created_at ? new Date(order.created_at).toLocaleDateString('fr-FR') : '---'}</span>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleDetailClick(order)} className="size-9 rounded-xl flex items-center justify-center bg-slate-50 border border-slate-100 text-slate-400 hover:text-[#4b7bec] hover:border-[#4b7bec] transition-all">
                          <Eye className="size-4" />
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="size-9 rounded-xl flex items-center justify-center bg-white border border-slate-100 text-slate-400 hover:text-slate-900 transition-all">
                              <MoreHorizontal className="size-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="rounded-2xl border-slate-100 shadow-xl p-2 w-48">
                            <DropdownMenuLabel className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 py-2">Actions rapides</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => { setEditOrderData(order); setEditCommuneState(order.customer_commune || '');
      setEditOrderOpen(true); }} disabled={['DELIVERED','RETURNED','CANCELLED'].includes(order.status)} className="rounded-xl px-3 py-2 text-xs font-bold gap-3 focus:bg-indigo-50 focus:text-indigo-600">
                              <Settings2 className="size-4" /> Modifier la commande
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleAssignClick(order.id)} className="rounded-xl px-3 py-2 text-xs font-bold gap-3 focus:bg-[#F0F5FF] focus:text-[#4b7bec]">
                              <ArrowRightLeft className="size-4" /> Affecter agent
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleShipViaNoest(order)} className="rounded-xl px-3 py-2 text-xs font-bold gap-3 focus:bg-emerald-50 focus:text-emerald-600">
                              <Truck className="size-4" /> Expédier Noest
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleStatusChange(order.id, 'CANCELLED', order.order_number)} className="rounded-xl px-3 py-2 text-xs font-bold gap-3 text-rose-500 focus:bg-rose-50 focus:text-rose-600">
                              <XCircle className="size-4" /> Annuler
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                  {!!order.duplicate_count && order.duplicate_count > 0 && expandedMergedOrders.has(order.id) && (
                    <div className="bg-purple-50/20 border-l-4 border-purple-400 p-4 rounded-xl space-y-4 mt-2">
                      <h4 className="text-[10px] font-black uppercase tracking-wider text-purple-600">Doublons fusionnés</h4>
                      {loadingChildOrdersId === order.id ? (
                        <div className="text-xs text-slate-400 font-bold py-2">Chargement des détails…</div>
                      ) : (
                      <div className="space-y-3">
                        {(childOrdersById[order.id] ?? []).map((child: any) => (
                          <div key={child.id} className="bg-white p-3 rounded-lg border border-purple-100 shadow-sm space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-bold text-slate-800">{child.order_number}</span>
                              <Badge className="bg-slate-100 text-slate-600 text-[9px] font-bold shadow-none border-none">
                                {child.source}
                              </Badge>
                            </div>
                            <div className="text-[9px] text-slate-400 font-bold">
                              Créé le: {new Date(child.created_at).toLocaleDateString('fr-FR')}
                            </div>
                            {child.items && child.items.length > 0 && (
                              <div className="space-y-0.5 text-xs text-slate-700">
                                {child.items.map((item: any, idx: number) => (
                                  <div key={idx}>{item.quantity}x {item.product_name}</div>
                                ))}
                              </div>
                            )}
                            {user?.role === 'ADMIN' && (
                              <button
                                onClick={() => handleUnmerge(child.id, child.order_number)}
                                className="flex items-center gap-1 bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 border border-rose-200 hover:border-rose-300 rounded-xl px-2.5 py-1 text-[10px] font-bold shadow-sm transition-all focus:outline-none w-fit"
                              >
                                <ArrowRightLeft className="size-3" /> Séparer
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Data Table Footer — pagination (mode normal) OU compteur exact
              (mode filtre-type actif : plus de pagination trompeuse). */}
          <div className="px-4 sm:px-10 py-4 sm:py-6 border-t bg-[#FAFBFD]/50 flex flex-col sm:flex-row items-center justify-between gap-4" style={{ borderColor: C.border }}>
            {isTypeFiltered ? (
              <>
                <div className="flex items-center gap-2 text-[10px] sm:text-xs font-bold text-slate-500 text-center sm:text-left">
                  <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700">
                    Filtre actif : <b>{ORDER_TYPE_FILTERS.find(f => f.id === typeFilter)?.label || typeFilter}</b>
                  </span>
                  <span>
                    {displayOrders.length} commande{displayOrders.length > 1 ? 's' : ''} correspondante{displayOrders.length > 1 ? 's' : ''}
                    {' '}(sur {orders.length} chargée{orders.length > 1 ? 's' : ''} pour ce statut/période{orders.length >= FILTER_MODE_CAP ? `, plafonné à ${FILTER_MODE_CAP}` : ''})
                  </span>
                </div>
                <button
                  onClick={() => setTypeFilter('ALL')}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-black text-slate-600 transition-all"
                >
                  ✕ Retirer le filtre & repaginer
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 text-[10px] sm:text-xs font-bold text-slate-400 text-center sm:text-left">
                  <span>Affichage {orders.length} sur {total} commande{total > 1 ? 's' : ''}</span>
                  <select
                    value={pageSize}
                    onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                    className="h-7 rounded-lg border border-slate-200 bg-white px-2 text-[10px] sm:text-xs font-bold text-slate-600"
                    title="Commandes par page"
                  >
                    {[20, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage(1)}
                    className="hidden sm:inline-flex px-2.5 py-2 rounded-xl border border-slate-100 bg-white hover:bg-slate-50 disabled:opacity-30 disabled:pointer-events-none text-[10px] font-bold text-slate-500 transition-all"
                  >
                    Début
                  </button>
                  <button
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                    className="p-2 sm:p-3 rounded-lg sm:rounded-xl border border-slate-100 bg-white hover:bg-slate-50 disabled:opacity-30 disabled:pointer-events-none transition-all"
                  >
                    <ChevronLeft className="size-4 sm:size-5 text-slate-600" />
                  </button>
                  <div className="flex items-center gap-1 px-3 sm:px-4 text-[13px] sm:text-sm font-bold text-slate-700">
                    {page} <span className="opacity-30">/</span> {totalPages}
                  </div>
                  <button
                    disabled={page === totalPages}
                    onClick={() => setPage(page + 1)}
                    className="p-2 sm:p-3 rounded-lg sm:rounded-xl border border-slate-100 bg-white hover:bg-slate-50 disabled:opacity-30 disabled:pointer-events-none transition-all"
                  >
                    <ChevronRight className="size-4 sm:size-5 text-slate-600" />
                  </button>
                  <button
                    disabled={page === totalPages}
                    onClick={() => setPage(totalPages)}
                    className="hidden sm:inline-flex px-2.5 py-2 rounded-xl border border-slate-100 bg-white hover:bg-slate-50 disabled:opacity-30 disabled:pointer-events-none text-[10px] font-bold text-slate-500 transition-all"
                  >
                    Fin
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        </>
        )}
      </div>

      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        {selectedOrder && (
          <DialogContent className="max-w-[1300px] w-[96vw] bg-white border-none text-black p-0 rounded-[40px] overflow-hidden shadow-2xl max-h-[94vh] flex flex-col">
             {/* Header */}
             <div className="bg-[#2D3436] px-5 sm:px-10 py-5 sm:py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0">
                <div className="flex items-center gap-4">
                   <div className="size-11 sm:size-14 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
                      <Package className="size-5 sm:size-7 text-white" />
                   </div>
                   <div>
                      <DialogTitle className="text-lg sm:text-2xl font-black uppercase tracking-tight text-white leading-none">{formatOrderRef(selectedOrder, 'admin')}</DialogTitle>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                         <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Source:</span>
                         <span className="text-[10px] font-bold text-white/60 uppercase">{selectedOrder.source === 'landing_page' ? 'Landing Page' : selectedOrder.source === 'MANUAL' ? 'Manuel' : (selectedOrder.source || 'MANUAL')}</span>
                         <span className="h-3 w-px bg-white/20" />
                         <span className="text-[10px] font-mono text-white/60">{selectedOrder.id.split('-')[0]}</span>
                         <span className="h-3 w-px bg-white/20 mx-1" />
                         {/* Origine métier — ne change jamais avec le statut */}
                         <OrderTypeBadge order={selectedOrder} size="xs" short />
                         {selectedOrder.is_pack && <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-[#6C5CE7]/20 text-indigo-200 border border-[#6C5CE7]/30 uppercase tracking-wide">Pack</span>}
                         {selectedOrder.is_upsell && <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-emerald-500/20 text-emerald-200 border border-emerald-500/30 uppercase tracking-wide">Upsell</span>}
                         {selectedOrder.livreur_id && (
                           <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-sky-500/20 text-sky-200 border border-sky-500/30 uppercase tracking-wide">
                             🚴 {selectedOrder.livreur?.name || 'Livreur assigné'}
                           </span>
                         )}
                      </div>
                      {/* Campaign attribution — which ad generated this order.
                          Always rendered now (was conditional on having a value)
                          — hidden entirely, there was no way to know WHERE this
                          info would even show up to check whether a fresh order
                          actually captured its UTM or not. Empty state says so
                          explicitly instead of just not appearing. */}
                      {(() => {
                        const hasUtm = (selectedOrder as any).utm_campaign || (selectedOrder as any).campaign_id || (selectedOrder as any).utm_source;
                        return (
                          <div className="flex flex-wrap items-center gap-2 mt-1.5"
                               title={[
                                 (selectedOrder as any).campaign_id && `Campagne ID: ${(selectedOrder as any).campaign_id}`,
                                 (selectedOrder as any).adset_id && `Adset: ${(selectedOrder as any).adset_id}`,
                                 (selectedOrder as any).ad_id && `Annonce: ${(selectedOrder as any).ad_id}`,
                                 (selectedOrder as any).referrer && `Referrer: ${(selectedOrder as any).referrer}`,
                               ].filter(Boolean).join('\n') || 'Aucun paramètre UTM/campagne enregistré pour cette commande'}>
                             <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">📣 Campagne:</span>
                             {hasUtm ? (
                               <span className="text-[10px] font-bold text-blue-300">
                                 {(selectedOrder as any).utm_campaign || (selectedOrder as any).campaign_id}
                                 {(selectedOrder as any).utm_source && ` · ${(selectedOrder as any).utm_source}`}
                                 {(selectedOrder as any).utm_medium && `/${(selectedOrder as any).utm_medium}`}
                                 {(selectedOrder as any).utm_content && ` · ${(selectedOrder as any).utm_content}`}
                               </span>
                             ) : (
                               <span className="text-[10px] font-bold text-white/30 italic">Aucune donnée UTM</span>
                             )}
                          </div>
                        );
                      })()}
                   </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {selectedOrder.parent_order_id && (
                    <button
                      onClick={async () => {
                        try {
                          const res: any = await apiFetch(`/api/v1/orders/${selectedOrder.parent_order_id}`);
                          const parent = res?.data ?? res;
                          if (parent?.id) setSelectedOrder(parent);
                        } catch { toast.error('Commande parente introuvable'); }
                      }}
                      className="px-3 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 border border-purple-400/30"
                    >
                      🟣 Ouvrir la commande parente
                    </button>
                  )}
                  {!['DELIVERED','RETURNED','CANCELLED'].includes(selectedOrder.status) && (
                    <button
                      onClick={() => { 
                        setEditOrderData(selectedOrder); 
                        setEditIsPack(!!selectedOrder.is_pack);
                        setEditIsUpsell(!!selectedOrder.is_upsell);
                        setEditIsAbandonedCart(!!selectedOrder.is_abandoned_cart);
                        setEditRecoveryFee(selectedOrder.abandoned_cart_recovery_fee || 0);
                        setEditCommuneState(selectedOrder.customer_commune || '');
      setEditOrderOpen(true); 
                      }}
                      className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 border border-white/20"
                    >
                      <Settings2 className="size-3.5" /> Modifier
                    </button>
                  )}
                  <Badge className={cn("text-[11px] font-black px-4 py-2 uppercase tracking-widest border-none rounded-xl", ORDER_STATUS_COLORS[selectedOrder.status])}>
                    {ORDER_STATUS_LABELS[selectedOrder.status]}
                  </Badge>
                  {(() => {
                    const opsCfg: any = allStores.find(s => s.id === selectedOrder.store_id)?.operations_config || {};
                    const maxNrp = selectedOrder.is_abandoned_cart ? (opsCfg.max_nrp_abandoned ?? 12) : (opsCfg.max_nrp_normal ?? 9);
                    if (selectedOrder.status === 'CANCELLED' && selectedOrder.nrp_count && selectedOrder.nrp_count >= maxNrp) {
                      return <Badge className="bg-red-500 hover:bg-red-600 text-white text-[11px] font-black px-4 py-2 uppercase tracking-widest border-none shadow-lg shadow-red-200 rounded-xl">NRP (Annulée)</Badge>;
                    }
                    if (selectedOrder.nrp_count && selectedOrder.nrp_count > 0) {
                      return <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-black px-4 py-2 uppercase tracking-widest border-none shadow-lg shadow-amber-200 rounded-xl">NRP {selectedOrder.nrp_count}/{maxNrp}</Badge>;
                    }
                    return null;
                  })()}
                </div>
             </div>

             {/* Progression du dossier — mode badge, dérivé directement de
                 selectedOrder.status donc se met à jour automatiquement dès
                 qu'un changement de statut est appliqué ailleurs (le badge
                 React re-render suit l'état, pas besoin de logique dédiée).
                 Le changement de statut reste possible via "Modifier" et le
                 menu d'actions de la ligne dans le tableau. */}
             <div className="bg-slate-50 px-5 sm:px-10 py-4 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-2 mb-3">
                   <TrendingUp className="size-3.5 text-slate-400" />
                   <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Progression du dossier</span>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                   <Badge className={cn("text-[11px] font-black px-4 py-2 uppercase tracking-widest border-none rounded-xl", ORDER_STATUS_COLORS[selectedOrder.status])}>
                      {ORDER_STATUS_LABELS[selectedOrder.status]}
                   </Badge>
                   {(() => {
                      const pipeline: OrderStatus[] = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED'];
                      const idx = pipeline.indexOf(selectedOrder.status);
                      if (idx === -1) return null; // CANCELLED/RETURNED/RESCHEDULED — hors du parcours linéaire
                      return (
                         <>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Étape {idx + 1}/{pipeline.length}</span>
                            <div className="flex items-center gap-1">
                               {pipeline.map((s, i) => (
                                  <span key={s} className={cn("size-1.5 rounded-full", i <= idx ? "bg-emerald-400" : "bg-slate-200")} title={ORDER_STATUS_LABELS[s]} />
                               ))}
                            </div>
                         </>
                      );
                   })()}
                </div>
             </div>

             {/* Body */}
             <div className="flex-1 overflow-y-auto">
                <div className="p-5 sm:p-10 grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
                   {/* Left col: Customer + Items */}
                   <div className="lg:col-span-2 space-y-8">
                      {/* Customer */}
                      <div className="space-y-3">
                         <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2"><UserIcon className="size-3.5" /> Client</h3>
                         <div className="bg-slate-50 rounded-2xl p-6 grid grid-cols-2 gap-4">
                            {[
                               { label: 'Nom', value: selectedOrder.customer_name },
                               { label: 'Téléphone', value: selectedOrder.customer_phone, mono: true },
                               { label: 'Wilaya', value: selectedOrder.customer_wilaya },
                               { label: 'Email', value: selectedOrder.customer_email || '—' },
                            ].map(f => (
                               <div key={f.label}>
                                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{f.label}</p>
                                  <p className={cn("text-sm font-bold text-slate-800", f.mono && "font-mono")}>{f.value}</p>
                               </div>
                            ))}
                            <div className="col-span-2">
                               <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Adresse complète</p>
                               <p className="text-sm font-bold text-slate-800">{selectedOrder.customer_address || '—'}</p>
                            </div>
                         </div>
                      </div>

                      {/* Items */}
                      <div className="space-y-3">
                         <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2"><Package className="size-3.5" /> Articles commandés</h3>
                         <div className="rounded-2xl border border-slate-100 overflow-hidden">
                            <table className="w-full text-left">
                               <thead>
                                  <tr className="bg-slate-50 border-b border-slate-100">
                                     <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">Produit</th>
                                     <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">Qté</th>
                                     <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">P.U.</th>
                                     <th className="px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Sous-total</th>
                                  </tr>
                               </thead>
                               <tbody className="divide-y divide-slate-50">
                                  {(selectedOrder.items ?? []).map((item: any, idx: number) => (
                                     <tr key={idx} className="hover:bg-slate-50/50">
                                        <td className="px-5 py-4">
                                           <div className="flex items-center gap-3">
                                              {item.image_url ? (
                                                 <img src={item.image_url} alt="" className="size-10 rounded-lg object-cover border border-slate-100 shrink-0" />
                                              ) : (
                                                 <div className="size-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 border border-slate-100">
                                                    <Package className="size-5 text-slate-400" />
                                                 </div>
                                              )}
                                              <div className="min-w-0">
                                                 <p className="text-sm font-bold text-slate-800 truncate">{item.product_name}</p>
                                                 {item.variant_details?.variant && (
                                                    <p className="text-xs text-slate-500 font-semibold mt-0.5">{item.variant_details.variant}</p>
                                                 )}
                                                 {item.sku && <p className="text-[10px] font-mono text-slate-400 mt-0.5">SKU: {item.sku}</p>}
                                              </div>
                                           </div>
                                        </td>
                                        <td className="px-5 py-4 text-center">
                                           <span className="text-sm font-black text-slate-700 tabular-nums">×{item.quantity}</span>
                                        </td>
                                        <td className="px-5 py-4 text-right">
                                           <span className="text-sm font-bold text-slate-600 tabular-nums">{formatPrice(item.unit_price ?? item.price ?? 0)}</span>
                                        </td>
                                        <td className="px-5 py-4 text-right">
                                           <span className="text-sm font-black text-slate-900 tabular-nums">{formatPrice((item.unit_price ?? item.price ?? 0) * item.quantity)}</span>
                                        </td>
                                     </tr>
                                  ))}
                               </tbody>
                            </table>
                            <div className="bg-slate-50 px-5 py-4 flex justify-between border-t border-slate-100">
                               <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Total dossier</span>
                               <span className="text-lg font-black text-slate-900 tabular-nums">{formatPrice(selectedOrder.total)}</span>
                            </div>
                         </div>
                      </div>

                      {/* ── Marketing Attribution Report — sous les produits commandés ── */}
                      <div className="space-y-3">
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                          <Activity className="size-3.5" /> Rapport d'Attribution Marketing
                        </h3>
                        <div className="max-h-[500px] overflow-y-auto pr-1">
                          <OrderTrackingReport orderId={selectedOrder.id} />
                        </div>
                      </div>

                      {/* Notes */}
                      {selectedOrder.notes && (
                         <div className="space-y-3">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Notes</h3>
                            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 text-sm text-amber-800 font-medium">{selectedOrder.notes}</div>
                         </div>
                      )}
                   </div>

                   {/* Right col: Logistics + Actions */}
                   <div className="space-y-6">
                      {/* Logistics — grille compacte 2 colonnes au lieu de blocs
                          empilés pleine largeur avec beaucoup d'air entre chaque
                          label/valeur ; promo/commission restent des lignes à
                          part car elles ont besoin de plus de place (montant +
                          contexte). */}
                      <div className="space-y-3">
                         <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2"><Truck className="size-3.5" /> Logistique</h3>
                         <div className="bg-slate-50 rounded-2xl p-4 grid grid-cols-2 gap-x-4 gap-y-3">
                            <div>
                               <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">N° de suivi</p>
                               <p className={cn("text-sm font-black font-mono", selectedOrder.tracking_number ? "text-slate-800" : "text-slate-300 italic")}>
                                  {selectedOrder.tracking_number || 'Non assigné'}
                               </p>
                            </div>
                            <div>
                               <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Transporteur</p>
                               {selectedOrder.carrier ? (
                                 <div className="flex items-center gap-1.5">
                                   {selectedOrder.carrier.logo_url && <img src={selectedOrder.carrier.logo_url} alt={selectedOrder.carrier.name} className="h-4 w-auto object-contain" />}
                                   <p className="text-sm font-black text-slate-800">{selectedOrder.carrier.name}</p>
                                 </div>
                               ) : (
                                 <p className="text-sm font-bold text-slate-300 italic">Non spécifié</p>
                               )}
                            </div>
                            <div>
                               <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Frais de livraison</p>
                               <p className="text-sm font-black text-slate-800 tabular-nums">{formatPrice(selectedOrder.delivery_fee || 0)}</p>
                            </div>
                            <div>
                               <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Créé le</p>
                               <p className="text-sm font-bold text-slate-600">{new Date(selectedOrder.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                            </div>
                            {selectedOrder.promo_code && (
                               <div className="col-span-2">
                                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Code promo</p>
                                  <p className="text-sm font-black text-[#6C5CE7] font-mono">{selectedOrder.promo_code} (−{formatPrice(selectedOrder.discount || 0)})</p>
                               </div>
                            )}
                            {selectedOrder.is_abandoned_cart && (
                                <div className="col-span-2 bg-amber-50 p-3 rounded-xl border border-amber-100">
                                   <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-1">Commission Agent</p>
                                   <p className="text-sm font-black text-amber-800 tabular-nums">+{formatPrice(selectedOrder.abandoned_cart_recovery_fee || 0)}</p>
                                </div>
                             )}
                         </div>
                      </div>

                      {/* Livreur interne — assignation disponible dans toute modale,
                          quel que soit le statut (y compris Annulée) */}
                      {selectedOrder.status !== 'MERGED' && (
                        <div className="space-y-3">
                           <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2"><Truck className="size-3.5" /> Livreur Interne</h3>
                           <div className="bg-sky-50/60 border border-sky-100 rounded-2xl p-5 space-y-3">
                              {(() => {
                                const livreurs = ((Array.isArray(livreursForOrderQuery.data) ? livreursForOrderQuery.data : livreursForOrderQuery.data?.data) ?? [])
                                  .filter((u: any) => u.role === 'LIVREUR' && u.is_active !== false);
                                if (livreursForOrderQuery.isLoading) return <p className="text-xs font-bold text-slate-400">Chargement…</p>;
                                if (livreurs.length === 0) return <p className="text-xs font-bold text-slate-400 italic">Aucun livreur configuré pour cette boutique.</p>;
                                return (
                                  <>
                                    <select
                                      value={selectedOrder.livreur_id || ''}
                                      onChange={(e) => e.target.value && assignLivreurMutation.mutate({ orderId: selectedOrder.id, livreurId: e.target.value })}
                                      disabled={assignLivreurMutation.isPending}
                                      className="w-full h-11 px-3 rounded-xl border border-sky-200 bg-white text-sm font-bold"
                                    >
                                      <option value="">— Choisir un livreur —</option>
                                      {livreurs.map((l: any) => (
                                        <option key={l.id} value={l.id}>{l.name}{l.phone ? ` (${l.phone})` : ''}</option>
                                      ))}
                                    </select>
                                    {selectedOrder.livreur_id && (
                                      <p className="text-[10px] font-bold text-sky-700">
                                        ✓ Assignée à {selectedOrder.livreur?.name || 'ce livreur'} — visible immédiatement dans son espace.
                                      </p>
                                    )}
                                  </>
                                );
                              })()}
                           </div>
                        </div>
                      )}

                      {/* Assigned agent — always reassignable, at any order status/stage.
                          Previously this card went read-only the moment an assignee
                          existed (no button rendered at all once assigned), which is
                          exactly what made "je n'arrive pas à la modifier" happen —
                          there was no way to open the reassign dialog once someone
                          was already attached to the order. */}
                      <div className="space-y-3">
                         <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2"><Users className="size-3.5" /> Agent assigné</h3>
                         {selectedOrder.assignee ? (
                            <button
                               onClick={() => { setDetailDialogOpen(false); handleAssignClick(selectedOrder.id); }}
                               className="w-full bg-indigo-50 hover:bg-indigo-100 rounded-2xl p-5 flex items-center gap-3 transition-all group"
                               title="Réassigner à un autre agent"
                            >
                               <div className="size-10 rounded-xl bg-[#4b7bec] flex items-center justify-center text-white font-black text-sm shrink-0">{selectedOrder.assignee.name.charAt(0)}</div>
                               <div className="flex-1 text-left">
                                  <p className="text-sm font-black text-slate-800">{selectedOrder.assignee.name}</p>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">Agent confirmateur</p>
                               </div>
                               <span className="text-[10px] font-black text-[#4b7bec] uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0">
                                  <Settings2 className="size-3.5" /> Réassigner
                               </span>
                            </button>
                         ) : (
                            <button onClick={() => { setDetailDialogOpen(false); handleAssignClick(selectedOrder.id); }} className="w-full h-12 rounded-2xl border-2 border-dashed border-slate-200 text-[11px] font-black text-slate-400 hover:border-[#4b7bec] hover:text-[#4b7bec] hover:bg-indigo-50 transition-all uppercase tracking-wider flex items-center justify-center gap-2">
                               <Users className="size-4" /> Assigner un agent
                            </button>
                         )}
                      </div>

                      {/* Carrier Tracking — detect by carrier.code slug */}
                      {selectedOrder.carrier?.code === 'yalidine' || (!selectedOrder.carrier && selectedOrder.tracking_number?.startsWith('YLD')) ? (
                        <YalidineTrackingPanel
                          orderId={selectedOrder.id}
                          trackingNumber={selectedOrder.tracking_number ?? null}
                          onShipped={(tracking) => setSelectedOrder(prev => prev ? { ...prev, tracking_number: tracking, status: 'SHIPPED' } : prev)}
                        />
                      ) : selectedOrder.carrier?.code === 'zr_express' ? (
                        <ZRExpressTrackingPanel
                          orderId={selectedOrder.id}
                          trackingNumber={selectedOrder.tracking_number ?? null}
                          partnerId={(selectedOrder.carrier as any)?.id ?? ''}
                          onShipped={(tracking) => setSelectedOrder(prev => prev ? { ...prev, tracking_number: tracking, status: 'SHIPPED' } : prev)}
                        />
                      ) : selectedOrder.carrier?.code === 'noest' || (!selectedOrder.carrier && selectedOrder.tracking_number) ? (
                        <NoestTrackingPanel
                          orderId={selectedOrder.id}
                          trackingNumber={selectedOrder.tracking_number ?? null}
                          onShipped={(tracking) => setSelectedOrder(prev => prev ? { ...prev, tracking_number: tracking, status: 'SHIPPED' } : prev)}
                        />
                      ) : null}



                      {/* ── Cycle de vie complet : KPI, statuts, appels, stock, Meta ── */}
                      <div className="space-y-3 pt-4 border-t border-slate-100">
                        <div className="flex items-center justify-between">
                          <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                            <Activity className="size-3.5" /> Cycle de vie de la commande
                          </h3>
                          <InvoiceButton order={selectedOrder} />
                        </div>
                        <div className="max-h-[600px] overflow-y-auto pr-1 space-y-4">
                          <OrderErpDetailPanel orderId={selectedOrder.id} />
                        </div>
                      </div>

                      {/* ── Traceability Panel ── */}
                      <div className="space-y-3 pt-4 border-t border-slate-100">
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                          <Activity className="size-3.5" /> Traçabilité Agent
                        </h3>
                        <div className="max-h-[400px] overflow-y-auto pr-1">
                          <OrderTraceabilityPanel orderId={selectedOrder.id} />
                        </div>
                      </div>
                   </div>
                </div>
             </div>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
         <DialogContent className="max-w-xl w-[95vw] bg-white border-none p-0 rounded-[40px] shadow-2xl overflow-hidden">
            <div className="bg-[#4b7bec] px-10 py-9">
               <DialogTitle className="text-2xl font-black uppercase tracking-tight text-white">Assignation d'Agent</DialogTitle>
               <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mt-2">Attribuer un confirmateur à ce dossier</p>
            </div>
            <div className="p-10 space-y-8">
               <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sélectionner un agent</label>
                  <Select onValueChange={setSelectedEmployeeId} value={selectedEmployeeId}>
                     <SelectTrigger className="h-13 bg-slate-50 border-slate-100 rounded-2xl font-bold text-sm focus:border-[#4b7bec] transition-all">
                        <SelectValue placeholder="Choisir un agent..." />
                     </SelectTrigger>
                     <SelectContent className="bg-white border-slate-100 rounded-2xl shadow-xl">
                        {employees.filter(e => ['CONFIRMATEUR','MANAGER','ADMIN'].includes(e.role)).map(e => (
                           <SelectItem key={e.id} value={e.id} className="rounded-xl py-3">
                              <div className="flex items-center gap-3">
                                 <div className="size-7 rounded-lg bg-indigo-50 flex items-center justify-center text-xs font-black text-[#4b7bec]">{e.name.charAt(0)}</div>
                                 <div>
                                    <span className="text-sm font-bold text-slate-800">{e.name}</span>
                                    <span className="ml-2 text-[10px] font-bold text-slate-400 uppercase">{e.role}</span>
                                 </div>
                              </div>
                           </SelectItem>
                        ))}
                     </SelectContent>
                  </Select>
               </div>
               {selectedEmployeeId && (() => {
                  const agent = employees.find(e => e.id === selectedEmployeeId);
                  return agent ? (
                     <div className="bg-indigo-50 rounded-2xl p-4 flex items-center gap-4 border border-indigo-100">
                        <div className="size-12 rounded-xl bg-[#4b7bec] flex items-center justify-center text-white font-black text-lg">{agent.name.charAt(0)}</div>
                        <div>
                           <p className="text-sm font-black text-slate-800">{agent.name}</p>
                           <p className="text-[10px] font-bold text-slate-500 uppercase mt-0.5">{agent.role} • {agent.email}</p>
                        </div>
                     </div>
                  ) : null;
               })()}
               <Button onClick={handleAssignConfirm} disabled={!selectedEmployeeId || assignMutation.isPending} className="w-full h-13 bg-[#4b7bec] hover:bg-[#3867d6] text-[11px] font-black uppercase tracking-widest rounded-2xl text-white shadow-lg shadow-indigo-100 transition-all">
                  {assignMutation.isPending ? <Loader2 className="size-5 animate-spin" /> : 'Confirmer l\'assignation'}
               </Button>
            </div>
         </DialogContent>
      </Dialog>

      <Dialog open={isCreatingOrder} onOpenChange={setIsCreatingOrder}>
         <DialogContent className="w-[98vw] max-w-[1400px] bg-white border border-neutral-200 text-black p-0 rounded-[32px] overflow-hidden max-h-[95vh] overflow-y-auto custom-scrollbar shadow-2xl">
           <div className="sticky top-0 bg-[#6C5CE7] px-12 py-10 z-20 flex items-center justify-between text-white">
             <div className="space-y-1">
                <DialogTitle className="text-2xl font-black uppercase tracking-widest text-white shadow-sm">Saisie de Commande</DialogTitle>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/80">Création d'un nouveau dossier client</p>
             </div>
             <div className="flex items-center gap-4">
                <Badge variant="outline" className="border-white/30 text-white bg-white/10 uppercase text-[10px] font-black tracking-widest px-4 py-1.5 rounded-full backdrop-blur-sm">Saisie Manuelle</Badge>
             </div>
           </div>

           <form 
             onSubmit={async (e) => {
               e.preventDefault();
               const formData = new FormData(e.currentTarget);
               if (!selectedOrderProduct) {
                 toast.error('Veuillez selectionner un produit');
                 return;
               }
               let finalCommune = (formData.get('commune') as string) || createCommune || '';
               let finalAddress = (formData.get('address') as string) || '';
               
               if (deliveryType === 'stop_desk' && createBureauCode) {
                 const selectedPartner = deliveryPartnersQuery.data?.find((p: any) => p.id === selectedPartnerId);
                 const partnerCode = selectedPartner?.code || 'noest';
                 
                 if (partnerCode === 'yalidine') {
                   const bureau = yalidineCenters.find(c => String(c.center_id || c.id) === createBureauCode);
                   if (bureau) {
                     finalCommune = bureau.name;
                     finalAddress = `Bureau Yalidine (ID: ${bureau.center_id || bureau.id}) - ${bureau.name} (${bureau.address})`;
                   }
                 } else {
                   const bureau = NOEST_BUREAUX.find(b => b.code === createBureauCode);
                   if (bureau) {
                     const match = bureau.name.match(/«\s*([^»]+?)\s*»/);
                     finalCommune = match ? match[1].trim() : bureau.name.trim();
                     finalAddress = `Bureau Noest ${bureau.code} - ${bureau.name} (${bureau.address})`;
                   }
                 }
               }
               
               const lineTotal = orderPrice * orderQty;
               const total = Math.max(0, lineTotal + deliveryFee - orderDiscount);
               const payload = {
                 store_id: storeId,
                 customer_name: formData.get('customer_name') as string,
                 customer_phone: formData.get('customer_phone') as string,
                 customer_wilaya: orderWilaya,
                 customer_commune: finalCommune || undefined,
                 customer_address: deliveryType === 'stop_desk' ? finalAddress : [finalCommune, finalAddress].filter(Boolean).join(', '),
                 notes: formData.get('notes') as string || undefined,
                 delivery_type: deliveryType,
                 delivery_fee: deliveryFee,
                 subtotal: lineTotal,
                 discount: orderDiscount,
                 total,
                 source: orderSource,
                 carrier_id: selectedPartnerId || undefined,
                 promo_code: (formData.get('promo_code') as string) || undefined,
                 items: [{
                   product_id: selectedOrderProduct.id,
                   product_name: selectedOrderProduct.name,
                   quantity: orderQty,
                   unit_price: orderPrice,
                 }],
                 is_pack: isPack,
                 is_upsell: isUpsell,
                 is_abandoned_cart: orderSource === 'ABANDONED_CART',
                 abandoned_cart_recovery_fee: orderSource === 'ABANDONED_CART' ? recoveryFee : 0,
               };
               createOrderMutation.mutate(payload);
             }}
             className="p-12 space-y-12 bg-white"
           >
             <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 lg:gap-12">
                <div className="space-y-10">
                   <div className="flex items-center gap-4 border-l-2 border-[#6C5CE7] pl-4">
                      <span className="text-sm font-bold uppercase tracking-widest text-[#2D3436]">01. Coordonnées du Client</span>
                   </div>
                   <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Nom du client</label>
                            <Input name="customer_name" required placeholder="Ex: Mohamed Amine" className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4 placeholder:text-neutral-400" />
                         </div>
                         <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Téléphone *</label>
                            <Input 
                               name="customer_phone" 
                               required 
                               placeholder="0550 00 00 00" 
                               onBlur={async (e) => {
                                 const phone = e.target.value.trim();
                                 if (!phone || phone.length < 9) { setDuplicateWarning(null); return; }
                                 try {
                                   const res = await apiFetch(`/orders/check-duplicate?phone=${encodeURIComponent(phone)}&store_id=${storeId}`) as any;
                                   if (res.is_duplicate) setDuplicateWarning(`Attention : Ce client a déjà commandé récemment (${res.order_number}) !`);
                                   else setDuplicateWarning(null);
                                 } catch(e) {}
                               }}
                               className={cn("bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4 placeholder:text-neutral-400", duplicateWarning && "border-rose-400 ring-rose-100 bg-rose-50")} 
                            />
                            {duplicateWarning && <p className="text-[10px] font-bold text-rose-600 mt-1">{duplicateWarning}</p>}
                         </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Wilaya *</label>
                            <Select value={orderWilaya} onValueChange={setOrderWilaya} required>
                               <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4">
                                  <SelectValue placeholder="Sélectionnez une wilaya" />
                               </SelectTrigger>
                               <SelectContent className="bg-white border-neutral-100 text-black max-h-[300px]">
                                  {WILAYAS.map((w, idx) => <SelectItem key={w} value={w} className="text-sm font-medium py-2">{idx + 1}. {w}</SelectItem>)}
                               </SelectContent>
                            </Select>
                         </div>
                         {deliveryType !== 'stop_desk' && (
                           <div className="space-y-3">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Commune</label>
                              <select name="commune" value={createCommune} onChange={e => setCreateCommune(e.target.value)} className="w-full bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4" disabled={!orderWilaya || loadingCreateCommunes}>
     <option value="">{loadingCreateCommunes ? "Chargement..." : "Sélectionnez une commune"}</option>
     {createCommunes.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
   </select>
                           </div>
                         )}
                      </div>
                      {deliveryType === 'stop_desk' ? (
                        <div className="space-y-3">
                           <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Bureau (Stop Desk) *</label>
                           <Select value={createBureauCode} onValueChange={setCreateBureauCode} required>
                              <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4">
                                 <SelectValue placeholder="Sélectionnez un bureau/office" />
                              </SelectTrigger>
                              <SelectContent className="bg-white border-neutral-100 text-black max-h-[250px]">
                                 {(() => {
                                   const selectedPartner = deliveryPartnersQuery.data?.find((p: any) => p.id === selectedPartnerId);
                                   const partnerCode = selectedPartner?.code || 'noest';
                                   
                                   if (partnerCode === 'yalidine') {
                                     const centers = yalidineCenters.filter(c => (c.wilaya_name || '').toLowerCase().trim() === (orderWilaya || '').toLowerCase().trim());
                                     if (centers.length === 0) return <SelectItem value="none" disabled>Aucun bureau disponible dans cette wilaya</SelectItem>;
                                     return centers.map(c => (
                                       <SelectItem key={c.center_id || c.id} value={String(c.center_id || c.id)} className="text-xs font-medium py-2">
                                         {c.name} ({c.address})
                                       </SelectItem>
                                     ));
                                   } else {
                                     const wIdx = WILAYAS.indexOf(orderWilaya as any);
                                     const wId = wIdx !== -1 ? wIdx + 1 : null;
                                     const bureaux = wId ? NOEST_BUREAUX.filter(b => b.wilayaId === wId) : [];
                                     if (bureaux.length === 0) return <SelectItem value="none" disabled>Aucun bureau disponible dans cette wilaya</SelectItem>;
                                     return bureaux.map(b => (
                                        <SelectItem key={b.code} value={b.code} className="text-xs font-medium py-2">
                                           {b.code} - {b.name} ({b.address})
                                        </SelectItem>
                                     ));
                                   }
                                 })()}
                              </SelectContent>
                           </Select>
                        </div>
                      ) : (
                        <div className="space-y-3">
                           <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Adresse</label>
                           <Input name="address" placeholder="RUE, QUARTIER, BÂTIMENT..." className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4 placeholder:text-neutral-400" />
                        </div>
                      )}
                      <div className="space-y-3">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Note Globale / Remarques</label>
                          <Textarea name="notes" placeholder="Instructions spécifiques pour le livreur ou l'agent de confirmation..." className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium min-h-[100px] rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all p-4 resize-none placeholder:text-neutral-400" />
                       </div>
                   </div>
                </div>

                <div className="space-y-10">
                   <div className="flex items-center justify-between border-l-2 border-[#6C5CE7] pl-4">
                      <span className="text-sm font-bold uppercase tracking-widest text-[#2D3436]">02. Détails de l'Expédition</span>
                      <div className="flex flex-wrap items-center gap-3">
                         <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 border border-indigo-100 rounded-xl">
                            <Checkbox id="isPack" checked={isPack} onCheckedChange={(c) => setIsPack(!!c)} className="size-4 border-indigo-200 data-[state=checked]:bg-[#6C5CE7] rounded-md" />
                            <label htmlFor="isPack" className="text-[11px] font-black uppercase tracking-widest text-[#6C5CE7] cursor-pointer">Pack Spécial</label>
                         </div>
                         <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 border border-emerald-100 rounded-xl">
                            <Checkbox id="isUpsell" checked={isUpsell} onCheckedChange={(c) => setIsUpsell(!!c)} className="size-4 border-emerald-200 data-[state=checked]:bg-emerald-500 rounded-md" />
                            <label htmlFor="isUpsell" className="text-[11px] font-black uppercase tracking-widest text-emerald-600 cursor-pointer">Vente Additionnelle</label>
                         </div>
                      </div>
                   </div>
                   
                   {orderSource === 'ABANDONED_CART' && (
                      <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-6 space-y-4">
                         <div className="flex items-center gap-2">
                           <AlertTriangle className="size-5 text-amber-500" />
                           <h4 className="text-sm font-black uppercase tracking-widest text-amber-800">Récupération de Panier</h4>
                         </div>
                         <p className="text-xs font-medium text-amber-700/80">Si l'adresse est déjà connue et validée, vous pouvez ignorer les détails logistiques superflus ci-dessous.</p>
                         <div className="space-y-3 pt-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Frais de Récupération (Commission Agent) en DA</label>
                            <Input type="number" step="1" value={recoveryFee} onChange={e => setRecoveryFee(Math.round(parseFloat(e.target.value) || 0))} className="bg-white border-amber-200 text-amber-900 text-sm font-bold h-12 rounded-xl focus:ring-amber-500" />
                         </div>
                      </div>
                   )}
                   
                   <div className="space-y-6">
                      <div className="space-y-3">
                         <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Produit Principal *</label>
                         <Select onValueChange={(v) => {
                            const p = productsQuery.data?.data?.find((x: any) => x.id === v);
                            setSelectedOrderProduct(p);
                            if (p) setOrderPrice(p.price ?? 0);
                         }}>
                            <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-14 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4">
                               <SelectValue placeholder="Rechercher Produit..." />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-neutral-100 text-black rounded-xl">
                               {productsQuery.data?.data?.map((p: any) => (
                                  <SelectItem key={p.id} value={p.id} className="text-sm font-medium py-2">{p.name} — SKU: {p.sku}</SelectItem>
                               ))}
                            </SelectContent>
                         </Select>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                         <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">SKU</label>
                            <Input disabled value={selectedOrderProduct?.sku || '---'} className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] italic text-xs h-12 rounded-xl" />
                         </div>
                         <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Stock</label>
                            <div className={cn("h-12 border flex items-center px-4 font-black rounded-xl font-mono text-[10px] uppercase", (selectedOrderProduct?.stock ?? 0) > 0 ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-rose-50 text-rose-600 border-rose-100")}>
                               {selectedOrderProduct?.stock ?? '—'} {selectedOrderProduct ? 'EN STOCK' : ''}
                            </div>
                         </div>
                         <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Quantité</label>
                            <Input type="number" min={1} value={orderQty} onChange={e => setOrderQty(Math.max(1, parseInt(e.target.value) || 1))} className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-bold h-12 rounded-xl text-center" />
                         </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                         <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Prix Unitaire (DA) *</label>
                            <Input type="number" step="1" value={orderPrice} onChange={e => setOrderPrice(Math.round(parseFloat(e.target.value) || 0))} className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-bold h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4" />
                         </div>
                         <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Frais Livraison (DA)</label>
                            <Input readOnly name="delivery_fee" type="number" step="1" value={deliveryFee} className="bg-[#F8F9FC] border-[#E9ECF0] text-sm font-bold h-12 rounded-xl px-4 text-[#2D3436] opacity-70 cursor-not-allowed" />
                         </div>
                         <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Remise (DA)</label>
                            <Input name="discount" type="number" step="1" value={orderDiscount} onChange={e => setOrderDiscount(Math.round(parseFloat(e.target.value) || 0))} className="bg-[#F8F9FC] border-[#E9ECF0] text-sm font-bold h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 transition-all px-4 text-[#2D3436]" />
                         </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                         <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Source de Commande</label>
                            <Select value={orderSource} onValueChange={setOrderSource}>
                               <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4">
                                  <SelectValue />
                               </SelectTrigger>
                               <SelectContent className="bg-white border-neutral-100 text-black rounded-xl">
                                  <SelectItem value="MANUAL">Saisie Manuelle</SelectItem>
                                  <SelectItem value="FACEBOOK">Facebook / Meta Ads</SelectItem>
                                  <SelectItem value="INSTAGRAM">Instagram</SelectItem>
                                  <SelectItem value="TIKTOK">TikTok Ads</SelectItem>
                                  <SelectItem value="WEBSITE">Site Web</SelectItem>
                                  <SelectItem value="PHONE">Appel Direct</SelectItem>
                                  <SelectItem value="ABANDONED_CART">Panier Abandonné</SelectItem>
                                  <SelectItem value="landing_page">Landing Page</SelectItem>
                               </SelectContent>
                            </Select>
                         </div>
                         <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Mode de Réception</label>
                            <Select value={deliveryType} onValueChange={setDeliveryType}>
                               <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4">
                                  <SelectValue />
                               </SelectTrigger>
                               <SelectContent className="bg-white border-neutral-100 text-black rounded-xl">
                                  <SelectItem value="home">Livraison à Domicile</SelectItem>
                                  <SelectItem value="stop_desk">Stop Desk (Bureau)</SelectItem>
                               </SelectContent>
                            </Select>
                         </div>
                         <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Entreprise de Livraison *</label>
                            <Select value={selectedPartnerId} onValueChange={setSelectedPartnerId}>
                               <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4">
                                  <SelectValue placeholder={deliveryPartnersQuery.isLoading ? "Chargement..." : "Choisir Transporteur"} />
                               </SelectTrigger>
                               <SelectContent className="bg-white border-neutral-100 text-black rounded-xl max-h-[250px]">
                                  {deliveryPartnersQuery.data?.data?.map((partner: any) => (
                                     <SelectItem key={partner.id} value={partner.id} className="text-sm font-medium py-2">
                                        {partner.name} ({partner.carrier_id.toUpperCase()})
                                     </SelectItem>
                                  ))}
                                  {(!deliveryPartnersQuery.data?.data || deliveryPartnersQuery.data.data.length === 0) && (
                                     <SelectItem value="none" disabled>Aucun livreur configuré</SelectItem>
                                  )}
                               </SelectContent>
                            </Select>
                         </div>
                      </div>
                   </div>
                </div>
             </div>

             <div className="pt-8 border-t flex items-center justify-between bg-white">
                <div className="space-y-1">
                   <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Total à encaisser</p>
                   <div className="text-3xl font-black text-[#2D3436] font-mono tabular-nums">
                      {formatPrice(Math.max(0, (orderPrice * orderQty) + deliveryFee - orderDiscount))}
                   </div>
                   <p className="text-[10px] text-neutral-400 font-bold">
                     {orderQty > 1 && <>{orderQty} × {formatPrice(orderPrice)} · </>}
                     + {formatPrice(deliveryFee)} (livraison) · - {formatPrice(orderDiscount)} (remise)
                   </p>
                </div>
                <Button type="submit" disabled={createOrderMutation.isPending} className="h-14 px-10 bg-[#6C5CE7] hover:bg-[#5B4BC4] text-[12px] font-bold uppercase tracking-widest text-white shadow-xl shadow-[#6C5CE7]/20 group rounded-xl">
                   {createOrderMutation.isPending ? <Loader2 className="size-5 animate-spin" /> : <>Enregistrer la Commande <ArrowRightLeft className="ml-3 size-4 group-hover:translate-x-1 transition-transform" /></>}
                </Button>
             </div>
           </form>
         </DialogContent>
      </Dialog>

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 sm:bottom-12 left-0 right-0 px-4 sm:left-1/2 sm:-translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-8 duration-500">
           <div className="bg-white border border-[#E9ECF0] shadow-2xl p-4 sm:p-6 rounded-2xl flex flex-col sm:flex-row items-center gap-4 sm:gap-6 w-full sm:min-w-[900px] sm:max-w-[95vw] overflow-hidden text-black">
             <div className="flex items-center gap-4 px-4 sm:px-6 border-b sm:border-b-0 sm:border-r border-neutral-100 shrink-0 w-full sm:w-auto pb-3 sm:pb-0">
                <div className="size-9 sm:size-10 bg-black text-white flex items-center justify-center font-black text-sm rounded-lg">{selectedIds.size}</div>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">Sélectionnées</span>
             </div>
             <div className="flex items-center gap-2 flex-1 w-full overflow-x-auto no-scrollbar py-1">
               <Button variant="ghost" size="sm" onClick={() => { setPrintOrderIds([...selectedIds]); setPrintLabelOpen(true); }} className="h-10 text-[10px] font-bold uppercase tracking-wider text-neutral-500 hover:text-black shrink-0"><Printer className="mr-2 size-4" /> Imprimer étiquettes</Button>
               <Button variant="ghost" size="sm" onClick={handleBulkNoestShip} disabled={isProcessingBulk} className="h-10 text-[10px] font-bold uppercase tracking-wider text-black hover:bg-neutral-50 shrink-0">{isProcessingBulk ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Truck className="mr-2 size-4" />} Expédier (Noest)</Button>
               <Button variant="ghost" size="sm" onClick={() => { setBulkTargetStatus('CONFIRMED'); setBulkStatusOpen(true); }} className="h-10 text-[10px] font-bold uppercase tracking-wider text-emerald-600 hover:text-emerald-700 shrink-0"><ShieldCheck className="mr-2 size-4" /> Confirmer en lot</Button>
               <Button variant="ghost" size="sm" onClick={() => { setBulkTargetStatus('CANCELLED'); setBulkStatusOpen(true); }} className="h-10 text-[10px] font-bold uppercase tracking-wider text-rose-500 hover:text-rose-700 shrink-0"><XCircle className="mr-2 size-4" /> Annuler en lot</Button>
               <Button variant="ghost" size="sm" onClick={() => setAssignDialogOpen(true)} className="h-10 text-[10px] font-bold uppercase tracking-wider text-neutral-500 hover:text-black shrink-0"><UserPlus className="mr-2 size-4" /> Attribuer agent</Button>
               <Button variant="ghost" size="sm" onClick={() => {
                 const csv = orders.filter(o => selectedIds.has(o.id)).map(o =>
                   `${o.order_number},${o.customer_name},${o.customer_phone},${o.customer_wilaya},${o.total},${o.status}`
                 ).join('\n');
                 const blob = new Blob([`N° Commande,Client,Téléphone,Wilaya,Total,Statut\n${csv}`], { type: 'text/csv' });
                 const url = URL.createObjectURL(blob);
                 const a = document.createElement('a'); a.href = url; a.download = `commandes-${Date.now()}.csv`; a.click();
               }} className="h-10 text-[10px] font-bold uppercase tracking-wider text-neutral-500 hover:text-black shrink-0"><Download className="mr-2 size-4" /> Exporter sélection</Button>
             </div>
             <div className="px-4 border-t sm:border-t-0 sm:border-l border-neutral-100 shrink-0 w-full sm:w-auto pt-2 sm:pt-0 text-center sm:text-right">
                <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 hover:text-red-500 transition-colors w-full sm:w-auto">Annuler</Button>
             </div>
          </div>
        </div>
      )}

      {/* ── Advanced Filters Modal ── */}
      <Dialog open={advancedFiltersOpen} onOpenChange={setAdvancedFiltersOpen}>
        <DialogContent className="max-w-lg w-[95vw] bg-white border-none p-0 rounded-[32px] shadow-2xl overflow-hidden">
          <div className="bg-[#4b7bec] px-10 py-8">
            <DialogTitle className="text-xl font-black uppercase tracking-tight text-white">Filtres Avancés</DialogTitle>
            <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mt-1">Affiner la liste des commandes</p>
          </div>
          <div className="p-10 space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Wilaya</label>
              <select value={filterWilaya} onChange={e => setFilterWilaya(e.target.value)} className="w-full h-11 rounded-xl bg-slate-50 border border-slate-100 text-sm font-bold px-3">
                <option value="">Toutes les wilayas</option>
                {WILAYAS.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Source de commande</label>
              <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="w-full h-11 rounded-xl bg-slate-50 border border-slate-100 text-sm font-bold px-3">
                <option value="">Toutes les sources</option>
                {['MANUAL','FACEBOOK','INSTAGRAM','TIKTOK','WEBSITE','PHONE','landing_page','storefront'].map(s => (
                  <option key={s} value={s}>
                    {s === 'landing_page' ? 'Landing Page' : s === 'storefront' ? 'Storefront' : s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => { setFilterWilaya(''); setFilterSource(''); setAdvancedFiltersOpen(false); }} className="flex-1 h-12 rounded-2xl font-bold text-sm">
                Réinitialiser
              </Button>
              <Button onClick={() => { setPage(1); setAdvancedFiltersOpen(false); }} className="flex-1 h-12 rounded-2xl bg-[#4b7bec] hover:bg-[#3867d6] text-white font-bold text-sm">
                Appliquer les filtres
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Order Modal ── */}
      <Dialog open={editOrderOpen} onOpenChange={setEditOrderOpen}>
        <DialogContent className="max-w-2xl w-[95vw] bg-white border-none p-0 rounded-[40px] shadow-2xl overflow-hidden">
          <div className="bg-[#6C5CE7] px-10 py-8">
            <DialogTitle className="text-xl font-black uppercase tracking-tight text-white">Modifier la Commande</DialogTitle>
            <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mt-1">{editOrderData ? formatOrderRef(editOrderData, 'admin') : ''}</p>
          </div>
          {editOrderData && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);

                let finalCommune = (fd.get('customer_commune') as string) || editCommuneState || '';
                let finalAddress = (fd.get('customer_address') as string) || '';
                
                if (editDeliveryType === 'stop_desk' && editBureauCode) {
                  const selectedPartner = deliveryPartnersQuery.data?.find((p: any) => p.id === editOrderData.carrier_id);
                  const partnerCode = selectedPartner?.code || editOrderData.carrier?.code || (/^\d+$/.test(editBureauCode) ? 'yalidine' : 'noest');
                  
                  if (partnerCode === 'yalidine') {
                    const bureau = yalidineCenters.find(c => String(c.center_id || c.id) === editBureauCode);
                    if (bureau) {
                      finalCommune = bureau.name;
                      finalAddress = `Bureau Yalidine (ID: ${bureau.center_id || bureau.id}) - ${bureau.name} (${bureau.address})`;
                    }
                  } else {
                    const bureau = NOEST_BUREAUX.find(b => b.code === editBureauCode);
                    if (bureau) {
                      const match = bureau.name.match(/«\s*([^»]+?)\s*»/);
                      finalCommune = match ? match[1].trim() : bureau.name.trim();
                      finalAddress = `Bureau Noest ${bureau.code} - ${bureau.name} (${bureau.address})`;
                    }
                  }
                }

                editOrderMutation.mutate({
                  id: editOrderData.id,
                  customer_name: fd.get('customer_name') as string,
                  customer_phone: fd.get('customer_phone') as string,
                  customer_phone2: fd.get('customer_phone2') as string || undefined,
                  customer_address: finalAddress,
                  customer_wilaya: editWilaya,
                  customer_commune: finalCommune || undefined,
                  delivery_type: editDeliveryType,
                  delivery_fee: parseInt(fd.get('delivery_fee') as string) || 0,
                  notes: fd.get('notes') as string || undefined,
                  tracking_number: fd.get('tracking_number') as string || undefined,
                  is_pack: editIsPack,
                  is_upsell: editIsUpsell,
                  is_abandoned_cart: editIsAbandonedCart,
                  abandoned_cart_recovery_fee: editIsAbandonedCart ? editRecoveryFee : 0,
                });
              }}
              className="p-10 space-y-6"
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nom client</label>
                  <Input name="customer_name" defaultValue={editOrderData.customer_name} required className="h-11 rounded-xl bg-slate-50 border-slate-100 text-sm font-bold" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Téléphone 1</label>
                  <Input name="customer_phone" defaultValue={editOrderData.customer_phone} required className="h-11 rounded-xl bg-slate-50 border-slate-100 font-mono text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Téléphone 2</label>
                  <Input name="customer_phone2" defaultValue={editOrderData.customer_phone2 ?? ''} placeholder="Optionnel" className="h-11 rounded-xl bg-slate-50 border-slate-100 font-mono text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Mode de Réception</label>
                  <select
                    name="delivery_type"
                    value={editDeliveryType}
                    onChange={e => {
                      const val = e.target.value;
                      setEditDeliveryType(val);
                      if (val === 'home') setEditBureauCode('');
                    }}
                    className="w-full h-11 rounded-xl bg-slate-50 border border-slate-100 text-sm font-bold px-3"
                  >
                    <option value="home">Livraison à Domicile</option>
                    <option value="stop_desk">Stop Desk (Bureau)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Wilaya</label>
                  <select 
                    name="customer_wilaya" 
                    value={editWilaya} 
                    onChange={e => {
                      setEditWilaya(e.target.value);
                      setEditBureauCode('');
                    }} 
                    className="w-full h-11 rounded-xl bg-slate-50 border border-slate-100 text-sm font-bold px-3"
                  >
                    {WILAYAS.map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>
                {editDeliveryType !== 'stop_desk' && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Commune</label>
                    <select name="customer_commune" value={editCommuneState} onChange={e => setEditCommuneState(e.target.value)} className="w-full h-11 rounded-xl bg-slate-50 border border-slate-100 text-sm px-3" disabled={!editWilaya || loadingEditCommunes}>
     <option value="">{loadingEditCommunes ? "Chargement..." : "Sélectionnez une commune"}</option>
     {editCommunes.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
   </select>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Frais livraison (DA)</label>
                  <Input name="delivery_fee" type="number" defaultValue={editOrderData.delivery_fee ?? 0} className="h-11 rounded-xl bg-slate-50 border-slate-100 text-sm font-bold" />
                </div>
                {editDeliveryType === 'stop_desk' ? (
                  <div className="col-span-2 space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bureau (Stop Desk) *</label>
                    <select
                      value={editBureauCode}
                      onChange={e => setEditBureauCode(e.target.value)}
                      className="w-full h-11 rounded-xl bg-slate-50 border border-slate-100 text-sm font-bold px-3"
                      required
                    >
                      <option value="">Sélectionnez un bureau/office</option>
                      {(() => {
                        const selectedPartner = deliveryPartnersQuery.data?.find((p: any) => p.id === editOrderData.carrier_id);
                        const partnerCode = selectedPartner?.code || editOrderData.carrier?.code || (/^\d+$/.test(editBureauCode) ? 'yalidine' : 'noest');
                        
                        if (partnerCode === 'yalidine') {
                          const centers = yalidineCenters.filter(c => (c.wilaya_name || '').toLowerCase().trim() === (editWilaya || '').toLowerCase().trim());
                          return centers.map(c => (
                            <option key={c.center_id || c.id} value={String(c.center_id || c.id)}>
                              {c.name} ({c.address})
                            </option>
                          ));
                        } else {
                          const wIdx = WILAYAS.indexOf(editWilaya as any);
                          const wId = wIdx !== -1 ? wIdx + 1 : null;
                          const bureaux = wId ? NOEST_BUREAUX.filter(b => b.wilayaId === wId) : [];
                          return bureaux.map(b => (
                            <option key={b.code} value={b.code}>
                              {b.code} - {b.name} ({b.address})
                            </option>
                          ));
                        }
                      })()}
                    </select>
                  </div>
                ) : (
                  <div className="col-span-2 space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Adresse</label>
                    <Input name="customer_address" defaultValue={editOrderData.customer_address ?? ''} className="h-11 rounded-xl bg-slate-50 border-slate-100 text-sm" />
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">N° de suivi</label>
                  <Input name="tracking_number" defaultValue={editOrderData.tracking_number ?? ''} placeholder="Optionnel" className="h-11 rounded-xl bg-slate-50 border-slate-100 font-mono text-sm" />
                </div>
                
                <div className="col-span-2 pt-2 border-t border-slate-100">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 block">Propriétés Spéciales</label>
                  <div className="flex flex-wrap gap-4">
                    <div className="flex items-center gap-2">
                       <Checkbox id="editIsPack" checked={editIsPack} onCheckedChange={(c) => setEditIsPack(!!c)} className="size-4" />
                       <label htmlFor="editIsPack" className="text-xs font-bold text-slate-600">Pack Spécial</label>
                    </div>
                    <div className="flex items-center gap-2">
                       <Checkbox id="editIsUpsell" checked={editIsUpsell} onCheckedChange={(c) => setEditIsUpsell(!!c)} className="size-4" />
                       <label htmlFor="editIsUpsell" className="text-xs font-bold text-slate-600">Vente Additionnelle</label>
                    </div>
                    <div className="flex items-center gap-2">
                       <Checkbox id="editIsAbandonedCart" checked={editIsAbandonedCart} onCheckedChange={(c) => setEditIsAbandonedCart(!!c)} className="size-4" />
                       <label htmlFor="editIsAbandonedCart" className="text-xs font-bold text-slate-600">Panier Abandonné</label>
                    </div>
                  </div>
                </div>

                {editIsAbandonedCart && (
                  <div className="col-span-2 space-y-2 bg-amber-50 p-4 rounded-xl border border-amber-100">
                    <label className="text-[10px] font-black uppercase tracking-widest text-amber-700">Commission Agent (DA)</label>
                    <Input type="number" step="1" value={editRecoveryFee} onChange={e => setEditRecoveryFee(Math.round(parseFloat(e.target.value) || 0))} className="h-11 rounded-xl bg-white border-amber-200 text-sm font-bold text-amber-900" />
                  </div>
                )}
                <div className="col-span-2 space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Notes</label>
                  <Textarea name="notes" defaultValue={editOrderData.notes ?? ''} rows={3} className="rounded-xl bg-slate-50 border-slate-100 text-sm resize-none" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditOrderOpen(false)} className="flex-1 h-12 rounded-2xl font-bold text-sm">Annuler</Button>
                <Button type="submit" disabled={editOrderMutation.isPending} className="flex-1 h-12 rounded-2xl bg-[#6C5CE7] hover:bg-[#5B4BC4] text-white font-bold text-sm shadow-lg shadow-purple-100">
                  {editOrderMutation.isPending ? <Loader2 className="size-5 animate-spin" /> : 'Enregistrer les modifications'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Bulk Status Confirm Modal ── */}
      <Dialog open={bulkStatusOpen} onOpenChange={setBulkStatusOpen}>
        <DialogContent className="max-w-md w-[95vw] bg-white border-none p-0 rounded-[32px] shadow-2xl overflow-hidden">
          <div className={cn("px-10 py-8", bulkTargetStatus === 'CANCELLED' ? "bg-rose-500" : "bg-emerald-500")}>
            <DialogTitle className="text-xl font-black uppercase tracking-tight text-white">
              {bulkTargetStatus === 'CANCELLED' ? 'Annulation en lot' : 'Confirmation en lot'}
            </DialogTitle>
            <p className="text-[10px] font-bold text-white/70 uppercase tracking-widest mt-1">{selectedIds.size} commandes sélectionnées</p>
          </div>
          <div className="p-10 space-y-6">
            <p className="text-sm font-bold text-slate-600 text-center">
              Vous allez passer <span className="text-slate-900">{selectedIds.size} commandes</span> au statut{' '}
              <span className={bulkTargetStatus === 'CANCELLED' ? 'text-rose-600' : 'text-emerald-600'}>
                {ORDER_STATUS_LABELS[bulkTargetStatus as OrderStatus] ?? bulkTargetStatus}
              </span>.<br />Cette action est irréversible.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setBulkStatusOpen(false)} className="flex-1 h-12 rounded-2xl font-bold">Annuler</Button>
              <Button
                disabled={bulkStatusMutation.isPending}
                onClick={() => bulkStatusMutation.mutate({ ids: [...selectedIds], status: bulkTargetStatus })}
                className={cn("flex-1 h-12 rounded-2xl text-white font-bold shadow-lg", bulkTargetStatus === 'CANCELLED' ? "bg-rose-500 hover:bg-rose-600" : "bg-emerald-500 hover:bg-emerald-600")}
              >
                {bulkStatusMutation.isPending ? <Loader2 className="size-5 animate-spin" /> : 'Confirmer'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Print Labels Modal ── */}
      <Dialog open={printLabelOpen} onOpenChange={setPrintLabelOpen}>
        <DialogContent className="max-w-3xl w-[95vw] bg-white border-none p-0 rounded-[32px] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
          <div className="bg-[#2D3436] px-10 py-8 flex items-center justify-between shrink-0">
            <div>
              <DialogTitle className="text-xl font-black uppercase tracking-tight text-white">Étiquettes d'expédition</DialogTitle>
              <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mt-1">{printOrderIds.length} commandes</p>
            </div>
            <Button onClick={() => window.print()} className="bg-white text-slate-900 hover:bg-slate-100 font-bold text-xs px-5 h-10 rounded-xl">
              <Printer className="mr-2 size-4" /> Imprimer
            </Button>
          </div>
          <div className="overflow-y-auto flex-1 p-8 print:p-0">
            <div className="grid grid-cols-2 gap-4 print:gap-2">
              {orders.filter(o => printOrderIds.includes(o.id)).map(o => (
                <div key={o.id} className="border-2 border-slate-200 rounded-2xl p-5 print:rounded-none print:border print:page-break-inside-avoid">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Commande</p>
                      <p className="text-base font-black text-slate-900 font-mono">{formatOrderRef(o, 'admin')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">COD</p>
                      <p className="text-base font-black text-[#6C5CE7]">{o.total.toLocaleString('fr-DZ')} DA</p>
                    </div>
                  </div>
                  <div className="border-t border-slate-100 pt-3 space-y-1.5">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Destinataire</p>
                      <p className="text-sm font-black text-slate-900">{o.customer_name}</p>
                      <p className="text-xs font-bold text-slate-600 font-mono">{o.customer_phone}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Adresse livraison</p>
                      <p className="text-xs font-bold text-slate-700">{o.customer_address}</p>
                      <p className="text-xs font-black text-slate-900 uppercase">{o.customer_wilaya} {o.customer_commune ? `/ ${o.customer_commune}` : ''}</p>
                    </div>
                    {o.tracking_number && (
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">N° Suivi</p>
                        <p className="text-xs font-mono font-black text-slate-700">{o.tracking_number}</p>
                      </div>
                    )}
                    <div className="pt-2 border-t border-slate-100">
                      <p className="text-[9px] font-bold text-slate-400">{o.items?.length ?? 0} article(s) · Frais: {o.delivery_fee ?? 0} DA{o.carrier ? ` · ${o.carrier.name}` : ''}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Cancel Confirmation Dialog ── */}
      <Dialog open={!!cancelConfirmOrder} onOpenChange={(o) => !o && setCancelConfirmOrder(null)}>
        <DialogContent title="Annuler la commande" className="max-w-md bg-white rounded-[32px] border-none p-0 overflow-hidden shadow-2xl">
          <div className="p-8 text-center">
            <div className="size-20 rounded-[32px] bg-rose-50 text-rose-500 flex items-center justify-center mx-auto mb-6 shadow-inner">
              <AlertTriangle className="size-10" />
            </div>
            <h3 className="text-xl font-black text-slate-900 mb-2">Annuler cette commande ?</h3>
            <p className="text-sm text-slate-500 font-medium leading-relaxed">
              {cancelConfirmOrder?.orderNumber && (
                <>Commande <span className="font-bold text-slate-800">#{cancelConfirmOrder.orderNumber}</span> — </>
              )}
              Cette action libèrera le stock réservé et ne peut pas être annulée.
            </p>
          </div>
          <DialogFooter className="bg-slate-50/80 p-6 flex flex-col sm:flex-row gap-3 border-t border-slate-100">
            <Button variant="ghost" onClick={() => setCancelConfirmOrder(null)} className="flex-1 h-12 rounded-2xl font-bold text-slate-400 hover:text-slate-600">
              Retour
            </Button>
            <Button
              onClick={() => {
                if (cancelConfirmOrder) {
                  statusMutation.mutate({ orderId: cancelConfirmOrder.orderId, status: 'CANCELLED' });
                  setSelectedOrder(prev => prev && prev.id === cancelConfirmOrder.orderId ? { ...prev, status: 'CANCELLED' } : prev);
                  setCancelConfirmOrder(null);
                }
              }}
              disabled={statusMutation.isPending}
              className="flex-1 h-12 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-bold shadow-lg shadow-rose-100"
            >
              {statusMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : 'Confirmer l\'annulation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
