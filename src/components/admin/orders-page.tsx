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
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_DOT,
  VALID_TRANSITIONS,
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
import { formatPrice } from '@/lib/format';
import { downloadCSV } from '@/lib/export-helper';
import { exportToCSV, formatCSVDate, formatCSVPrice } from '@/lib/export';
import { cn } from '@/lib/utils';
import { WILAYAS } from '@/lib/wilaya-data';
import { apiFetch } from '@/lib/api-client';
import { NoestTrackingPanel } from '@/components/admin/noest-tracking-panel';
import { YalidineTrackingPanel } from '@/components/admin/yalidine-tracking-panel';
import { OrderTraceabilityPanel } from '@/components/admin/order-traceability-panel';

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

const REGISTRY_COLUMNS = [
  { key: 'source', label: 'Source' },
  { key: 'order_number', label: 'ID commande' },
  { key: 'customer_name', label: 'Client' },
  { key: 'customer_phone', label: 'Téléphone' },
  { key: 'customer_wilaya', label: 'Wilaya' },
  { key: 'total', label: 'Montant' },
  { key: 'status', label: 'Statut' },
  { key: 'created_at', label: 'Date de création' },
];

export default function OrdersPage() {
  const { activeStore, adminSubView, setAdminSubView } = useAppStore();
  const storeId = activeStore?.id ?? '';
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce logic
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 400);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const [viewMode, setViewMode] = useState<'NEW' | 'EN ATTENTE' | 'CONFIRMED' | 'FOLLOWUP' | 'COMPLETED' | 'CANCELLED' | 'ALL'>((adminSubView as any) || 'NEW');
  // Edit order modal
  const [editOrderOpen, setEditOrderOpen] = useState(false);
  const [editOrderData, setEditOrderData] = useState<any>(null);
  // Advanced filters
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [filterWilaya, setFilterWilaya] = useState('');
  const [filterSource, setFilterSource] = useState('');
  // Bulk status modal
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkTargetStatus, setBulkTargetStatus] = useState<string>('');
  // Print label modal
  const [printLabelOpen, setPrintLabelOpen] = useState(false);
  const [printOrderIds, setPrintOrderIds] = useState<string[]>([]);

  useEffect(() => {
    if (adminSubView && adminSubView !== viewMode) {
      setViewMode(adminSubView as any);
    }
  }, [adminSubView, viewMode]);

  const MODE_TO_STATUS: Record<string, string> = {
    NEW: 'NEW',
    'EN ATTENTE': 'ASSIGNED',
    CONFIRMED: 'CONFIRMED',
    FOLLOWUP: 'SHIPPED',
    COMPLETED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
    ALL: 'all',
  };

  const handleModeChange = (mode: string) => {
    setViewMode(mode as any);
    setAdminSubView(mode);
    setStatusFilter(MODE_TO_STATUS[mode] ?? 'all');
    setPage(1);
  };

  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const buildQueryParams = useCallback(() => {
    const params = new URLSearchParams({ store_id: storeId, page: page.toString(), pageSize: pageSize.toString() });
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (filterWilaya) params.set('wilaya', filterWilaya);
    if (filterSource) params.set('source', filterSource);
    return params.toString();
  }, [storeId, page, statusFilter, debouncedSearch, pageSize, filterWilaya, filterSource]);

   const [newOrderItems, setNewOrderItems] = useState<{ productId: string; quantity: number }[]>([]);
   const [customerData, setCustomerData] = useState({ name: '', phone: '', wilaya: '', address: '' });

   const ordersQuery = useQuery<PaginatedResponse<Order>>({
     queryKey: ['orders', storeId, page, statusFilter, debouncedSearch, pageSize, filterWilaya, filterSource],
     queryFn: () => apiFetch(`/api/v1/orders?${buildQueryParams()}`),
     placeholderData: (prev) => prev,
     refetchInterval: 30000,
   });

   const productsQuery = useQuery<ApiResponse<any[]>>({
    queryKey: ['admin-products-lite', storeId],
    enabled: isCreatingOrder && !!storeId,
    queryFn: () => apiFetch(`/api/v1/products?store_id=${storeId}&minimal=true`),
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
     },
     onError: (err: any) => toast.error(err.message || 'Échec de création'),
   });

   const statusMutation = useMutation({
     mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatus }) => {
       if (status === 'CANCELLED' && !window.confirm('Confirmer l\'annulation de cette commande ?')) {
         throw new Error('Annulé par l\'utilisateur');
       }
       return apiFetch(`/api/v1/orders/${orderId}`, {
         method: 'PATCH',
         body: JSON.stringify({ status }),
       });
     },
     onSuccess: (_, { orderId, status }) => {
       queryClient.invalidateQueries({ queryKey: ['orders'] });
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
       toast.success('Commande archivée avec succès');
       setDetailDialogOpen(false);
     },
     onError: () => { toast.error("Erreur lors de l'archivage"); },
   });

   const assignMutation = useMutation({
     mutationFn: async ({ orderId, assignedTo }: { orderId: string; assignedTo: string }) => {
       return apiFetch(`/api/v1/orders/${orderId}`, {
         method: 'PATCH',
         body: JSON.stringify({ assigned_to: assignedTo, status: 'PENDING' }),
       });
     },
     onSuccess: () => { 
       queryClient.invalidateQueries({ queryKey: ['orders'] }); 
       setAssignDialogOpen(false); 
       setAssignOrderId(null); 
       setSelectedEmployeeId(''); 
       toast.success('Agent affecté au protocole de traitement'); 
     },
     onError: () => { toast.error("Échec de l'affectation opérationnelle"); },
   });

  // Edit order mutation
  const editOrderMutation = useMutation({
    mutationFn: (data: any) => apiFetch(`/api/v1/orders/${data.id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
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
  const employees = employeesQuery.data?.data ?? [];

  // Detect duplicate phone numbers within current page (same phone = potential duplicate)
  const phoneCounts = orders.reduce((acc: Record<string, number>, o) => {
    if (o.customer_phone) acc[o.customer_phone] = (acc[o.customer_phone] || 0) + 1;
    return acc;
  }, {});
  const isDuplicatePhone = (phone: string) => (phoneCounts[phone] ?? 0) > 1;

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

  const handleStatusChange = (orderId: string, newStatus: OrderStatus) => { 
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
        toast.success(`Commande #${order.order_number} expédiée — N° suivi : ${data.tracking}`);
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
    ALL: 'Archive Complète',
  };

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

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

        {/* Tactical Filter Rack */}
        <div className="bg-white rounded-2xl sm:rounded-[32px] border px-4 sm:px-8 py-4 sm:py-6 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-4 sm:gap-6 shadow-sm sticky top-4 z-20 backdrop-blur-md bg-white/90" style={{ borderColor: C.border }}>
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4 sm:gap-6 flex-1">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-300" />
              <Input 
                placeholder="Rechercher client, téléphone ou ID..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-11 h-10 sm:h-12 bg-slate-50/50 border-slate-100 rounded-xl sm:rounded-2xl text-xs sm:text-sm font-medium focus-visible:ring-[#4b7bec]" 
              />
            </div>
            
            <div className="hidden md:block h-8 w-px bg-slate-100" />
            
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
              <Tabs value={viewMode} onValueChange={handleModeChange} className="w-full sm:w-auto">
                <TabsList className="bg-slate-50/50 p-1 rounded-xl sm:rounded-2xl border border-slate-100/50 h-auto flex flex-wrap sm:flex-nowrap">
                  {[
                    { id: 'NEW', label: 'Nouveau', count: total },
                    { id: 'EN ATTENTE', label: 'En cours' },
                    { id: 'CONFIRMED', label: 'Confirmé' },
                    { id: 'FOLLOWUP', label: 'Expédié' },
                    { id: 'COMPLETED', label: 'Livré' },
                    { id: 'CANCELLED', label: 'Annulé' },
                    { id: 'ALL', label: 'Toutes' }
                  ].map(tab => (
                    <TabsTrigger key={tab.id} value={tab.id} className="rounded-lg sm:rounded-xl px-3 sm:px-5 py-2 text-[10px] sm:text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-[#4b7bec] data-[state=active]:shadow-sm transition-all focus-visible:ring-0 whitespace-nowrap">
                      {tab.label}
                      {tab.count !== undefined && <span className="ml-1.5 opacity-50">{tab.count}</span>}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3 justify-end">
            <button onClick={() => setAdvancedFiltersOpen(true)}
               className={cn("p-2.5 sm:p-3 rounded-xl sm:rounded-2xl border transition-all text-slate-400 bg-white shadow-sm", advancedFiltersOpen ? "border-[#4b7bec] text-[#4b7bec] bg-indigo-50/50" : "border-slate-100 hover:bg-slate-50")}
            >
               <Filter className="size-4 sm:size-5" />
            </button>
            <button onClick={() => ordersQuery.refetch()} className="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl border border-slate-100 bg-white hover:bg-slate-50 shadow-sm transition-all text-slate-400">
               <RefreshCw className={cn("size-4 sm:size-5", ordersQuery.isFetching && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* Performance Ledger Table */}
        <div className="bg-white rounded-[32px] border shadow-sm overflow-hidden" style={{ borderColor: C.border }}>
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[1200px]">
              <thead>
                <tr className="border-b" style={{ borderColor: C.border, backgroundColor: '#FAFBFD' }}>
                  <th className="px-8 py-5 w-12"><Checkbox checked={selectedIds.size === orders.length && orders.length > 0} onCheckedChange={toggleSelectAll} /></th>
                  {REGISTRY_COLUMNS.map(col => (
                    <th key={col.key} className="px-8 py-5 text-xs font-bold text-slate-500">{col.label}</th>
                  ))}
                  <th className="px-8 py-5 text-right text-xs font-bold text-slate-500 w-32">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: C.border }}>
                {ordersQuery.isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i}><td colSpan={10} className="px-10 py-5"><Skeleton className="h-14 w-full rounded-2xl" /></td></tr>
                  ))
                ) : orders.length === 0 ? (
                  <tr><td colSpan={10} className="px-8 py-20 text-center text-slate-400 font-medium">Aucune commande trouvée</td></tr>
                ) : orders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-8 py-6"><Checkbox checked={selectedIds.has(order.id)} onCheckedChange={() => toggleSelect(order.id)} /></td>
                    <td className="px-8 py-6">
                      <Badge className="bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold shadow-none border-none">
                        {order.source === 'FACEBOOK' ? 'Meta Ads' : order.source}
                      </Badge>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-slate-900 group-hover:text-[#4b7bec] transition-colors">#{order.order_number}</span>
                        <span className="text-[10px] font-medium text-slate-400 mt-1 uppercase tracking-tight">Ref: {order.id.split('-')[0]}</span>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-800">{order.customer_name}</span>
                          {(order.is_duplicate || isDuplicatePhone(order.customer_phone)) && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-amber-100 text-amber-700 uppercase tracking-wide border border-amber-200">Doublon</span>
                          )}
                        </div>
                        <span className="text-[10px] font-medium text-slate-400 mt-0.5">{order.customer_phone}</span>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-sm font-bold text-slate-700">{order.customer_wilaya}</td>
                    <td className="px-8 py-6">
                      <span className="text-sm font-bold text-slate-900 tabular-nums">{formatPrice(order.total)}</span>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-2">
                        <div className="size-2 rounded-full" style={{ backgroundColor: ORDER_STATUS_COLORS[order.status] || '#A0AEC0' }} />
                        <span className="text-xs font-bold text-slate-700">{ORDER_STATUS_LABELS[order.status] || order.status}</span>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-xs font-medium text-slate-400">
                      {(() => {
                        const createdAt = order.created_at ? new Date(order.created_at) : null;
                        const isReturn = order.status === 'RETURNED' || order.status === 'CANCELLED';
                        const returnRaw = (order as any).returned_at ?? (isReturn ? order.updated_at : null);
                        const returnAt = returnRaw ? new Date(returnRaw) : null;
                        const validReturn = returnAt && createdAt && returnAt >= createdAt ? returnAt : null;
                        if (validReturn) {
                          return (
                            <div className="flex flex-col">
                              <span>{createdAt!.toLocaleDateString('fr-FR')}</span>
                              <span className="text-rose-400 text-[10px] font-bold">Retour: {validReturn.toLocaleDateString('fr-FR')}</span>
                            </div>
                          );
                        }
                        return <span>{createdAt ? createdAt.toLocaleDateString('fr-FR') : '---'}</span>;
                      })()}
                    </td>
                    <td className="px-8 py-6 text-right">
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
                            <DropdownMenuItem onClick={() => { setEditOrderData(order); setEditOrderOpen(true); }} className="rounded-xl px-3 py-2 text-xs font-bold gap-3 focus:bg-indigo-50 focus:text-indigo-600">
                              <Settings2 className="size-4" /> Modifier la commande
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleAssignClick(order.id)} className="rounded-xl px-3 py-2 text-xs font-bold gap-3 focus:bg-[#F0F5FF] focus:text-[#4b7bec]">
                              <ArrowRightLeft className="size-4" /> Affecter agent
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleShipViaNoest(order)} className="rounded-xl px-3 py-2 text-xs font-bold gap-3 focus:bg-emerald-50 focus:text-emerald-600">
                              <Truck className="size-4" /> Expédier Noest
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleStatusChange(order.id, 'CANCELLED')} className="rounded-xl px-3 py-2 text-xs font-bold gap-3 text-rose-500 focus:bg-rose-50 focus:text-rose-600">
                              <XCircle className="size-4" /> Annuler
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Data Table Footer - Smart Pagination */}
          <div className="px-4 sm:px-10 py-4 sm:py-6 border-t bg-[#FAFBFD]/50 flex flex-col sm:flex-row items-center justify-between gap-4" style={{ borderColor: C.border }}>
            <div className="text-[10px] sm:text-xs font-bold text-slate-400 text-center sm:text-left">
              Affichage {orders.length} sur {total} unités
            </div>
            <div className="flex gap-2">
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
            </div>
          </div>
        </div>
      </div>

      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        {selectedOrder && (
          <DialogContent className="max-w-[1300px] w-[96vw] bg-white border-none text-black p-0 rounded-[40px] overflow-hidden shadow-2xl max-h-[94vh] flex flex-col">
             {/* Header */}
             <div className="bg-[#2D3436] px-10 py-8 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-5">
                   <div className="size-14 rounded-2xl bg-white/10 flex items-center justify-center">
                      <Package className="size-7 text-white" />
                   </div>
                   <div>
                      <DialogTitle className="text-2xl font-black uppercase tracking-tight text-white leading-none">Commande #{selectedOrder.order_number}</DialogTitle>
                      <div className="flex items-center gap-3 mt-2">
                         <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Source:</span>
                         <span className="text-[10px] font-bold text-white/60 uppercase">{selectedOrder.source || 'MANUAL'}</span>
                         <span className="h-3 w-px bg-white/20" />
                         <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">ID:</span>
                         <span className="text-[10px] font-mono text-white/60">{selectedOrder.id.split('-')[0]}</span>
                      </div>
                   </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setEditOrderData(selectedOrder); setEditOrderOpen(true); }}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 border border-white/20"
                  >
                    <Settings2 className="size-3.5" /> Modifier
                  </button>
                  <Badge className={cn("text-[11px] font-black px-5 py-2 uppercase tracking-widest border-none rounded-xl", ORDER_STATUS_COLORS[selectedOrder.status])}>
                    {ORDER_STATUS_LABELS[selectedOrder.status]}
                  </Badge>
                </div>
             </div>

             {/* Status Pipeline */}
             <div className="bg-slate-50 px-10 py-5 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-2 mb-3">
                   <TrendingUp className="size-3.5 text-slate-400" />
                   <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Progression du dossier</span>
                </div>
                <div className="flex items-center gap-1">
                   {(['NEW','ASSIGNED','CALLED','CONFIRMED','SHIPPED','DELIVERED'] as OrderStatus[]).map((s, i, arr) => {
                      const isActive = s === selectedOrder.status;
                      const isPast = arr.indexOf(selectedOrder.status) > i;
                      const isNext = VALID_TRANSITIONS[selectedOrder.status]?.includes(s);
                      return (
                         <React.Fragment key={s}>
                            <button
                               disabled={!isNext}
                               onClick={() => { handleStatusChange(selectedOrder.id, s); setSelectedOrder(prev => prev ? { ...prev, status: s } : prev); }}
                               className={cn(
                                  "flex-1 px-2 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all text-center",
                                  isActive ? "bg-[#4b7bec] text-white shadow-lg shadow-indigo-200" :
                                  isPast ? "bg-emerald-100 text-emerald-700" :
                                  isNext ? "bg-white border-2 border-dashed border-[#4b7bec] text-[#4b7bec] hover:bg-[#F0F5FF] cursor-pointer" :
                                  "bg-slate-100 text-slate-300 cursor-default"
                               )}
                            >
                               {ORDER_STATUS_LABELS[s]}
                            </button>
                            {i < arr.length - 1 && <div className={cn("w-4 h-px shrink-0", isPast ? "bg-emerald-300" : "bg-slate-200")} />}
                         </React.Fragment>
                      );
                   })}
                   <div className="w-4 h-px shrink-0 bg-slate-200" />
                   <button
                      disabled={!VALID_TRANSITIONS[selectedOrder.status]?.includes('RETURNED') && !VALID_TRANSITIONS[selectedOrder.status]?.includes('CANCELLED')}
                      onClick={() => { handleStatusChange(selectedOrder.id, 'CANCELLED'); setSelectedOrder(prev => prev ? { ...prev, status: 'CANCELLED' } : prev); }}
                      className={cn("px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all", selectedOrder.status === 'CANCELLED' ? "bg-rose-500 text-white" : "bg-rose-50 text-rose-400 hover:bg-rose-100 disabled:opacity-30")}
                   >
                      Annulé
                   </button>
                </div>
             </div>

             {/* Body */}
             <div className="flex-1 overflow-y-auto">
                <div className="p-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
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
                                           <p className="text-sm font-bold text-slate-800">{item.product_name}</p>
                                           {item.sku && <p className="text-[10px] font-mono text-slate-400 mt-0.5">SKU: {item.sku}</p>}
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
                      {/* Logistics */}
                      <div className="space-y-3">
                         <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2"><Truck className="size-3.5" /> Logistique</h3>
                         <div className="bg-slate-50 rounded-2xl p-5 space-y-4">
                            <div>
                               <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">N° de suivi</p>
                               <p className={cn("text-sm font-black font-mono", selectedOrder.tracking_number ? "text-slate-800" : "text-slate-300 italic")}>
                                  {selectedOrder.tracking_number || 'Non assigné'}
                               </p>
                            </div>
                            <div>
                               <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Transporteur</p>
                               {selectedOrder.carrier ? (
                                 <div className="flex items-center gap-2">
                                   {selectedOrder.carrier.logo_url && <img src={selectedOrder.carrier.logo_url} alt={selectedOrder.carrier.name} className="h-5 w-auto object-contain" />}
                                   <p className="text-sm font-black text-slate-800">{selectedOrder.carrier.name}</p>
                                 </div>
                               ) : (
                                 <p className="text-sm font-bold text-slate-300 italic">Non spécifié</p>
                               )}
                            </div>
                            <div>
                               <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Frais de livraison</p>
                               <p className="text-sm font-black text-slate-800 tabular-nums">{formatPrice(selectedOrder.delivery_fee || 0)}</p>
                            </div>
                            {selectedOrder.promo_code && (
                               <div>
                                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Code promo</p>
                                  <p className="text-sm font-black text-[#6C5CE7] font-mono">{selectedOrder.promo_code} (−{formatPrice(selectedOrder.discount || 0)})</p>
                               </div>
                            )}
                            <div>
                               <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Créé le</p>
                               <p className="text-sm font-bold text-slate-600">{new Date(selectedOrder.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                            </div>
                         </div>
                      </div>

                      {/* Assigned agent */}
                      <div className="space-y-3">
                         <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2"><Users className="size-3.5" /> Agent assigné</h3>
                         {selectedOrder.assignee ? (
                            <div className="bg-indigo-50 rounded-2xl p-5 flex items-center gap-3">
                               <div className="size-10 rounded-xl bg-[#4b7bec] flex items-center justify-center text-white font-black text-sm">{selectedOrder.assignee.name.charAt(0)}</div>
                               <div>
                                  <p className="text-sm font-black text-slate-800">{selectedOrder.assignee.name}</p>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">Agent confirmateur</p>
                               </div>
                            </div>
                         ) : (
                            <button onClick={() => { setDetailDialogOpen(false); handleAssignClick(selectedOrder.id); }} className="w-full h-12 rounded-2xl border-2 border-dashed border-slate-200 text-[11px] font-black text-slate-400 hover:border-[#4b7bec] hover:text-[#4b7bec] hover:bg-indigo-50 transition-all uppercase tracking-wider flex items-center justify-center gap-2">
                               <Users className="size-4" /> Assigner un agent
                            </button>
                         )}
                      </div>

                      {/* Carrier Tracking — detect by carrier.code slug, fall back to tracking number prefix */}
                      {selectedOrder.carrier?.code === 'yalidine' || (!selectedOrder.carrier && selectedOrder.tracking_number?.startsWith('YLD')) ? (
                        <YalidineTrackingPanel
                          orderId={selectedOrder.id}
                          trackingNumber={selectedOrder.tracking_number ?? null}
                          onShipped={(tracking) => setSelectedOrder(prev => prev ? { ...prev, tracking_number: tracking, status: 'SHIPPED' } : prev)}
                        />
                      ) : selectedOrder.carrier?.code === 'noest' || (!selectedOrder.carrier && selectedOrder.tracking_number) ? (
                        <NoestTrackingPanel
                          orderId={selectedOrder.id}
                          trackingNumber={selectedOrder.tracking_number ?? null}
                          onShipped={(tracking) => setSelectedOrder(prev => prev ? { ...prev, tracking_number: tracking, status: 'SHIPPED' } : prev)}
                        />
                      ) : null}

                      {/* Archive */}
                      <div className="space-y-2 pt-2">
                         <button onClick={() => selectedOrder && softDeleteMutation.mutate({ orderId: selectedOrder.id })} disabled={softDeleteMutation.isPending} className="w-full h-11 rounded-xl bg-rose-50 border border-rose-100 text-rose-600 text-[11px] font-black uppercase tracking-wider hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                            {softDeleteMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <><XCircle className="size-4" /> Archiver ce dossier</>}
                         </button>
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
               const commune = (formData.get('commune') as string) || '';
               const address = (formData.get('address') as string) || '';
               const lineTotal = orderPrice * orderQty;
               const discount = Math.round(parseFloat((formData.get('discount') as string) || '0'));
               const deliveryFee = Math.round(parseFloat((formData.get('delivery_fee') as string) || '0'));
               const total = Math.max(0, lineTotal + deliveryFee - discount);
               const payload = {
                 store_id: storeId,
                 customer_name: formData.get('customer_name') as string,
                 customer_phone: formData.get('customer_phone') as string,
                 customer_wilaya: orderWilaya,
                 customer_commune: commune || undefined,
                 customer_address: [commune, address].filter(Boolean).join(', '),
                 notes: formData.get('notes') as string || undefined,
                 delivery_type: formData.get('shippingType') as string || 'home',
                 delivery_fee: deliveryFee,
                 subtotal: lineTotal,
                 discount,
                 total,
                 source: orderSource,
                 promo_code: (formData.get('promo_code') as string) || undefined,
                 items: [{
                   product_id: selectedOrderProduct.id,
                   product_name: selectedOrderProduct.name,
                   quantity: orderQty,
                   unit_price: orderPrice,
                 }],
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
                            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Téléphone</label>
                            <Input name="customer_phone" required placeholder="0550 00 00 00" className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4 placeholder:text-neutral-400" />
                         </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Wilaya</label>
                            <Select value={orderWilaya} onValueChange={setOrderWilaya}>
                               <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4 placeholder:text-neutral-400">
                                  <SelectValue placeholder="Sélectionnez" />
                               </SelectTrigger>
                               <SelectContent className="bg-white border-neutral-100 text-black max-h-[300px]">
                                  {WILAYAS.map((w, idx) => <SelectItem key={w} value={w} className="text-sm font-medium py-2">{idx + 1}. {w}</SelectItem>)}
                               </SelectContent>
                            </Select>
                         </div>
                         <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Commune</label>
                            <Input name="commune" placeholder="Entrez la commune" className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4 placeholder:text-neutral-400" />
                         </div>
                      </div>
                      <div className="space-y-3">
                         <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Adresse</label>
                         <Input name="address" placeholder="RUE, QUARTIER, BÂTIMENT..." className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4 placeholder:text-neutral-400" />
                      </div>
                      <div className="space-y-3">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Note Globale / Remarques</label>
                          <Textarea name="notes" placeholder="Instructions spécifiques pour le livreur ou l'agent de confirmation..." className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium min-h-[100px] rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all p-4 resize-none placeholder:text-neutral-400" />
                       </div>
                   </div>
                </div>

                <div className="space-y-10">
                   <div className="flex items-center justify-between border-l-2 border-[#6C5CE7] pl-4">
                      <span className="text-sm font-bold uppercase tracking-widest text-[#2D3436]">02. Détails de l'Expédition</span>
                      <div className="flex items-center gap-2 bg-neutral-50 px-3 py-1.5 border border-neutral-100 rounded-xl">
                         <Checkbox id="isUpsell" name="upsell" className="size-4 border-neutral-200 data-[state=checked]:bg-[#6C5CE7] rounded-md" />
                         <label htmlFor="isUpsell" className="text-[11px] font-black uppercase tracking-widest text-neutral-400 cursor-pointer">Vente Additionnelle</label>
                      </div>
                   </div>
                   
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
                            <Input name="delivery_fee" type="number" step="1" defaultValue={0} className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 transition-all px-4" />
                         </div>
                         <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Remise (DA)</label>
                            <Input name="discount" type="number" step="1" defaultValue={0} className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 transition-all px-4" />
                         </div>
                      </div>

                      <div className="grid grid-cols-2 gap-6">
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
                               </SelectContent>
                            </Select>
                         </div>
                         <div className="space-y-3">
                            <label className="text-[11px] font-bold uppercase tracking-wider text-[#636E72]">Mode de Réception</label>
                            <Select name="shippingType" defaultValue="home">
                               <SelectTrigger className="bg-[#F8F9FC] border-[#E9ECF0] text-[#2D3436] text-sm font-medium h-12 rounded-xl focus:bg-white focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20 transition-all px-4">
                                  <SelectValue />
                               </SelectTrigger>
                               <SelectContent className="bg-white border-neutral-100 text-black rounded-xl">
                                  <SelectItem value="home">Livraison à Domicile</SelectItem>
                                  <SelectItem value="stop_desk">Stop Desk (Bureau)</SelectItem>
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
                   <div className="text-3xl font-black text-[#2D3436] font-mono tabular-nums">{formatPrice(orderPrice * orderQty)}</div>
                   <p className="text-[10px] text-neutral-400 font-bold">
                     {orderQty > 1 && <>{orderQty} × {formatPrice(orderPrice)} · </>}
                     + frais livraison · - remise
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
                {['MANUAL','FACEBOOK','INSTAGRAM','TIKTOK','WEBSITE','PHONE'].map(s => <option key={s} value={s}>{s}</option>)}
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
            <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mt-1">#{editOrderData?.order_number}</p>
          </div>
          {editOrderData && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                editOrderMutation.mutate({
                  id: editOrderData.id,
                  customer_name: fd.get('customer_name') as string,
                  customer_phone: fd.get('customer_phone') as string,
                  customer_phone2: fd.get('customer_phone2') as string || undefined,
                  customer_address: fd.get('customer_address') as string,
                  customer_wilaya: fd.get('customer_wilaya') as string,
                  customer_commune: fd.get('customer_commune') as string || undefined,
                  delivery_fee: parseInt(fd.get('delivery_fee') as string) || 0,
                  notes: fd.get('notes') as string || undefined,
                  tracking_number: fd.get('tracking_number') as string || undefined,
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
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Wilaya</label>
                  <select name="customer_wilaya" defaultValue={editOrderData.customer_wilaya} className="w-full h-11 rounded-xl bg-slate-50 border border-slate-100 text-sm font-bold px-3">
                    {WILAYAS.map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Commune</label>
                  <Input name="customer_commune" defaultValue={editOrderData.customer_commune ?? ''} className="h-11 rounded-xl bg-slate-50 border-slate-100 text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Frais livraison (DA)</label>
                  <Input name="delivery_fee" type="number" defaultValue={editOrderData.delivery_fee ?? 0} className="h-11 rounded-xl bg-slate-50 border-slate-100 text-sm font-bold" />
                </div>
                <div className="col-span-2 space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Adresse</label>
                  <Input name="customer_address" defaultValue={editOrderData.customer_address ?? ''} className="h-11 rounded-xl bg-slate-50 border-slate-100 text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">N° de suivi</label>
                  <Input name="tracking_number" defaultValue={editOrderData.tracking_number ?? ''} placeholder="Optionnel" className="h-11 rounded-xl bg-slate-50 border-slate-100 font-mono text-sm" />
                </div>
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
                      <p className="text-base font-black text-slate-900 font-mono">#{o.order_number}</p>
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

    </div>
  );
}
