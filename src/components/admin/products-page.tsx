'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
   Search,
   LayoutGrid,
   List,
   Package,
   ChevronLeft,
   ChevronRight,
   Download,
   Plus,
   Filter,
   RefreshCw,
   Edit3,
   Trash2,
   Eye,
   MoreHorizontal,
   ImageOff,
   X,
   Loader2,
   DollarSign,
   Boxes,
   Tag,
   Info,
   FileText,
   CheckCircle2,
   ExternalLink,
   Image as ImageIcon,
   Settings2,
   Zap,
   Upload,
   BarChart2,
   TrendingUp,
   TrendingDown,
   ShoppingCart,
   CheckCheck,
   Truck,
   RotateCcw,
   Check,
   ChevronsUpDown,
   Factory,
   PlusCircle,
   Calendar,
   AlertCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import {
   Dialog,
   DialogContent,
   DialogHeader,
   DialogTitle,
   DialogFooter,
   DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppStore } from '@/store/app-store';
import { formatPrice } from '@/lib/format';
import { toast } from 'sonner';
import type { Product, PaginatedResponse } from '@/lib/types';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api-client';
import { WILAYAS } from '@/lib/wilaya-data';

const C = {
   primary: '#4b7bec', primaryBg: '#F0F5FF',
   success: '#20bf6b', successBg: '#E6FFF8',
   danger: '#eb4d4b', dangerBg: '#FFEDE9',
   warning: '#f7b731', warningBg: '#FFF8E6',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

function getStockStatus(stock: number): { color: string; bg: string; label: string } {
   if (stock === 0) return { color: C.danger, bg: C.dangerBg, label: 'Rupture' };
   if (stock <= 5) return { color: '#F39C12', bg: '#FFF8E6', label: 'Faible' };
   return { color: C.success, bg: C.successBg, label: 'En stock' };
}

interface ProductsApiResponse extends PaginatedResponse<Product> {
   categories?: string[];
}

interface ProductAnalytics {
   product_id: string;
   product_name: string;
   period: string;
   orders: number;
   pending: number;
   confirmed: number;
   delivered: number;
   returned: number;
   revenue: number;
   cost: number;
   profit: number;
   profit_pct: number;
}

function generateSku(category?: string): string {
   const prefix = category ? category.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X') : 'PRD';
   const random = Math.random().toString(36).substring(2, 8).toUpperCase();
   return `${prefix}-${random}`;
}

const EMPTY_FORM = {
   name: '', category: '', sku: '', barcode: '', brand: '', slug: '',
   description: '', price: '', compare_price: '', cost_price: '',
   stock: '', low_stock_threshold: '5', tags: '', images: [] as string[],
   is_active: true, main_image: '', store_id: '',
   variants: [] as any[],
   // Production source
   production_source: 'imported' as 'imported' | 'local',
   supplier_id: '',
   // Local production breakdown
   prod_supplier_name: '',
   prod_batch_qty: '1',
   prod_fabric_cost: '',
   prod_fabric_supplier: '',
   prod_accessories_cost: '',
   prod_accessories_supplier: '',
   prod_labor_cut_cost: '',
   prod_labor_cut_supplier: '',
   prod_labor_sew_cost: '',
   prod_labor_sew_supplier: '',
   prod_labor_finish_cost: '',
   prod_labor_finish_supplier: '',
   prod_packaging_cost: '',
   prod_packaging_supplier: '',
   prod_transport_cost: '',
   prod_transport_supplier: '',
   prod_other_cost: '',
   prod_other_supplier: '',
   prod_notes: '',
   allowed_carriers: [] as string[],
   prod_custom_charges: [] as any[],
   delivery_fees: { is_free: false, fees: {} } as any,
   // Pack options
   is_pack: false,
   pack_items: [] as any[],
   pack_charges: [] as any[],
   pack_margin: '0.0',
   pack_options: [] as any[],
};

// ─── Inline supplier quick-select for production cost rows ────
function SupplierInlineSelect({
  value, onChange, suppliers, placeholder = 'Fournisseur...',
}: {
  value: string; onChange: (v: string) => void; suppliers: any[]; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const filtered = suppliers.filter(s => s.name?.toLowerCase().includes(input.toLowerCase()));
  const match = suppliers.find(s => s.name === value);

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full h-9 px-3 rounded-xl border border-slate-100 bg-slate-50/50 text-left text-[10px] font-bold text-slate-500 hover:border-[#4b7bec] transition-all flex items-center justify-between gap-1 overflow-hidden">
        <span className={cn("truncate", value ? "text-slate-700" : "text-slate-300")}>{value || placeholder}</span>
        <Factory className="size-3 shrink-0 text-slate-300" />
      </button>
      {open && (
        <div className="absolute top-10 left-0 right-0 z-50 bg-white border border-slate-100 rounded-2xl shadow-xl overflow-hidden">
          <input
            autoFocus
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Rechercher ou créer..."
            className="w-full px-3 py-2.5 text-xs font-medium border-b border-slate-100 outline-none"
          />
          <div className="max-h-40 overflow-y-auto">
            {filtered.slice(0, 8).map((s: any) => (
              <button key={s.id} type="button"
                onClick={() => { onChange(s.name); setOpen(false); setInput(''); }}
                className="w-full px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                <span className="size-5 rounded-lg bg-indigo-50 text-indigo-600 text-[9px] font-black flex items-center justify-center shrink-0">{s.name?.charAt(0)}</span>
                {s.name}
                {s.contact_phone && <span className="text-slate-300 text-[9px] font-mono ml-auto">{s.contact_phone}</span>}
              </button>
            ))}
            {input && !filtered.some(s => s.name?.toLowerCase() === input.toLowerCase()) && (
              <button type="button"
                onClick={() => { onChange(input); setOpen(false); setInput(''); }}
                className="w-full px-3 py-2 text-left text-xs font-bold text-[#4b7bec] hover:bg-indigo-50 flex items-center gap-2">
                <Plus className="size-3" /> Ajouter "{input}"
              </button>
            )}
            {filtered.length === 0 && !input && (
              <p className="px-3 py-2 text-[10px] text-slate-300 font-medium italic">Aucun fournisseur enregistré</p>
            )}
          </div>
          {value && (
            <button type="button" onClick={() => { onChange(''); setOpen(false); }}
              className="w-full px-3 py-2 border-t border-slate-100 text-[10px] text-slate-400 hover:text-rose-500 transition-all text-left">
              ✕ Effacer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProductsPage() {
   const { activeStore, user, allStores } = useAppStore();
   const storeId = activeStore?.id ?? '';
   const isSuperAdmin = user?.role === 'SUPER_ADMIN';
   // A delivery driver manages the catalog (create/edit/stock) but must never
   // see cost price, margin or supplier purchase price — sensitive financial
   // data unrelated to his job.
   const canSeeFinancials = user?.role !== 'LIVREUR';

   const [editingProduct, setEditingProduct] = useState<Product | null>(null);
   const [isCreating, setIsCreating] = useState(false);
   const [categoryOpen, setCategoryOpen] = useState(false);
   const [categorySearch, setCategorySearch] = useState('');
   const [searchQuery, setSearchQuery] = useState('');
   const [startDate, setStartDate] = useState('');
   const [endDate, setEndDate] = useState('');
   const [categoryFilter, setCategoryFilter] = useState('all');
   const [page, setPage] = useState(1);
   const [pageSizeOption, setPageSizeOption] = useState('15');
   const [isUploading, setIsUploading] = useState(false);
   const [isUploadingGallery, setIsUploadingGallery] = useState(false);
   const [form, setForm] = useState({ ...EMPTY_FORM });
   const [analyticsProduct, setAnalyticsProduct] = useState<Product | null>(null);
   const [analyticsPeriod, setAnalyticsPeriod] = useState('30d');
   const [originalMainImage, setOriginalMainImage] = useState<string>('');
   const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
   const [selectedProductCarrier, setSelectedProductCarrier] = useState<string | null>(null);
   const [selectedCarrierId, setSelectedCarrierId] = useState('');
   const [selectedWilayaId, setSelectedWilayaId] = useState('1');
   const [customHomeFee, setCustomHomeFee] = useState('');
   const [customDeskFee, setCustomDeskFee] = useState('');

   const [subProductSearch, setSubProductSearch] = useState('');
   const [isNewSubProductOpen, setIsNewSubProductOpen] = useState(false);
   const [isUploadingSubProduct, setIsUploadingSubProduct] = useState(false);
   const [newSubProduct, setNewSubProduct] = useState({
      name: '', price: '', cost_price: '', sku: '', stock: '100', main_image: ''
   });

   const [sizeRangeModal, setSizeRangeModal] = useState<{
      isOpen: boolean;
      variantIndex: number;
      rangeStr: string;
      qtyStr: string;
      onSuccess: (range: string, qty: string) => void;
    } | null>(null);

   const [fetchingProductId, setFetchingProductId] = useState<string | null>(null);

   const setF = (patch: Partial<typeof EMPTY_FORM>) => setForm(prev => ({ ...prev, ...patch }));

    const handleAddCustomFee = () => {
       if (!selectedCarrierId || !customHomeFee) return;
       const currentFees = form.delivery_fees?.fees || {};
       const nextFees = { ...currentFees };
       if (!nextFees[selectedCarrierId]) {
          nextFees[selectedCarrierId] = {};
       }
       nextFees[selectedCarrierId][selectedWilayaId] = {
          home: parseInt(customHomeFee) || 0,
          desk: parseInt(customDeskFee) || 0
       };
       setF({
          delivery_fees: {
             is_free: form.delivery_fees?.is_free || false,
             fees: nextFees
          }
       });
       setCustomHomeFee('');
       setCustomDeskFee('');
    };

    const handleRemoveCustomFee = (carrier: string, wilayaId: string) => {
       const currentFees = form.delivery_fees?.fees || {};
       const nextFees = { ...currentFees };
       if (nextFees[carrier]) {
          delete nextFees[carrier][wilayaId];
          if (Object.keys(nextFees[carrier]).length === 0) {
             delete nextFees[carrier];
          }
       }
       setF({
          delivery_fees: {
             is_free: form.delivery_fees?.is_free || false,
             fees: nextFees
          }
       });
    };

    const addCustomCharge = () => {
       const newCharge = { name: '', unit: 'pièces', qty: '1', unit_cost: '0', supplier: '' };
       setForm(prev => ({ ...prev, prod_custom_charges: [...(prev.prod_custom_charges || []), newCharge] }));
    };

    const updateCustomCharge = (idx: number, field: string, val: any) => {
       setForm(prev => {
          const updated = [...(prev.prod_custom_charges || [])];
          updated[idx] = { ...updated[idx], [field]: val };
          return { ...prev, prod_custom_charges: updated };
       });
    };

    const removeCustomCharge = (idx: number) => {
       setForm(prev => ({
          ...prev,
          prod_custom_charges: (prev.prod_custom_charges || []).filter((_, i) => i !== idx)
       }));
    };
  
    // Auto-calculate total stock from variants
   useEffect(() => {
      if (form.variants && form.variants.length > 0) {
         const totalStock = form.variants.reduce((acc, v) => acc + (parseInt(String(v.stock)) || 0), 0);
         if (String(totalStock) !== form.stock) {
            setF({ stock: String(totalStock) });
         }
      }
   }, [form.variants]);

   const pageSize = parseInt(pageSizeOption);

   const buildQueryParams = useCallback(() => {
      const params = new URLSearchParams({ store_id: storeId, page: page.toString(), pageSize: pageSize.toString() });
      if (searchQuery) params.set('search', searchQuery);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      if (startDate) params.set('start_date', startDate + 'T00:00:00.000Z');
      if (endDate) params.set('end_date', endDate + 'T23:59:59.999Z');
      return params.toString();
   }, [storeId, page, pageSize, searchQuery, categoryFilter, startDate, endDate]);
    const [uploadingVariantIdx, setUploadingVariantIdx] = useState<number | null>(null);

   const productsQuery = useQuery<ProductsApiResponse>({
      queryKey: ['admin-products', storeId, page, pageSize, searchQuery, categoryFilter, startDate, endDate],
      queryFn: () => apiFetch(`/api/v1/products/?${buildQueryParams()}`),
      enabled: !!storeId,
   });

   useEffect(() => {
      setPage(1);
   }, [startDate, endDate]);

   const qc = useQueryClient();

   const createMutation = useMutation({
      mutationFn: (data: any) => apiFetch('/api/v1/products/', {
         method: 'POST',
         body: JSON.stringify(data)
      }),
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['admin-products'] });
         toast.success('Produit créé avec succès');
         setIsCreating(false);
         setForm({ ...EMPTY_FORM });
      },
      onError: (error: any) => toast.error(error.message || 'Erreur de création'),
   });

   const updateMutation = useMutation({
      mutationFn: ({ id, data }: { id: string, data: any }) => apiFetch(`/api/v1/products/${id}`, {
         method: 'PUT',
         body: JSON.stringify({ ...data, store_id: storeId })
      }),
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['admin-products'] });
         toast.success('Produit mis à jour');
         setEditingProduct(null);
         setForm({ ...EMPTY_FORM });
      },
      onError: (error: any) => toast.error(error.message || 'Erreur de mise a jour'),
   });

   const deleteMutation = useMutation({
      mutationFn: (id: string) => apiFetch(`/api/v1/products/${id}`, { method: 'DELETE' }),
      onSuccess: (res: any) => {
         qc.invalidateQueries({ queryKey: ['admin-products'] });
         if (res?.soft) {
            toast.info('Produit désactivé — historique de commandes conservé');
         } else {
            toast.success('Produit supprimé définitivement');
         }
      },
      onError: () => toast.error('Erreur lors de la suppression'),
   });

   const analyticsQuery = useQuery({
      queryKey: ['product-analytics', analyticsProduct?.id, analyticsPeriod, storeId],
      queryFn: () => apiFetch<ProductAnalytics>(
         `/api/v1/products/${analyticsProduct!.id}/analytics?store_id=${storeId}&period=${analyticsPeriod}`
      ),
      enabled: !!analyticsProduct && !!storeId,
      staleTime: 2 * 60 * 1000,
   });

   const suppliersQuery = useQuery({
      queryKey: ['suppliers-select', storeId],
      queryFn: () => apiFetch<any>(`/api/v1/suppliers/?store_id=${storeId}&page_size=200`),
      enabled: !!storeId,
      staleTime: 5 * 60 * 1000,
   });

   const carriersQuery = useQuery({
      queryKey: ['delivery-partners-select', storeId],
      queryFn: () => apiFetch<any>(`/api/v1/delivery-partners?store_id=${storeId}`),
      enabled: !!storeId,
      staleTime: 5 * 60 * 1000,
   });

   const suppliers: any[] = suppliersQuery.data?.data ?? suppliersQuery.data?.suppliers ?? [];
   const carriers: any[] = carriersQuery.data?.data ?? carriersQuery.data?.partners ?? [];

   // ── Quick supplier creation, inline, without leaving the product modal ──
   // Uses the exact same POST /api/v1/suppliers/ the Fournisseurs module
   // itself uses, so the new supplier is immediately real and shows up there
   // too — not a product-local stand-in. Invalidating both the ['suppliers']
   // family (Fournisseurs module + Finance sub-modules that list suppliers)
   // and this modal's own ['suppliers-select'] keeps every screen in sync.
   const [isAddingSupplier, setIsAddingSupplier] = useState(false);
   const [quickSupplierName, setQuickSupplierName] = useState('');
   const [quickSupplierPhone, setQuickSupplierPhone] = useState('');
   const [isCreatingSupplier, setIsCreatingSupplier] = useState(false);

   const handleQuickCreateSupplier = async () => {
      if (!quickSupplierName.trim()) {
         toast.error('Le nom du fournisseur est obligatoire');
         return;
      }
      setIsCreatingSupplier(true);
      try {
         const res = await apiFetch<any>('/api/v1/suppliers/', {
            method: 'POST',
            body: JSON.stringify({
               store_id: storeId,
               name: quickSupplierName.trim(),
               phone: quickSupplierPhone.trim() || undefined,
            }),
         });
         const created = res?.data;
         if (!created?.id) throw new Error('Réponse inattendue du serveur');
         qc.invalidateQueries({ queryKey: ['suppliers-select'] });
         qc.invalidateQueries({ queryKey: ['suppliers'] });
         setF({ supplier_id: created.id, prod_supplier_name: created.name });
         toast.success(`Fournisseur "${created.name}" créé et sélectionné`);
         setIsAddingSupplier(false);
         setQuickSupplierName('');
         setQuickSupplierPhone('');
      } catch (err: any) {
         toast.error(err?.message || 'Échec de la création du fournisseur');
      } finally {
         setIsCreatingSupplier(false);
      }
   };

   const handleDelete = (product: Product) => setDeleteTarget(product);

   // Shared by the desktop table's edit button AND the mobile card grid
   // (tapping a card opens the edit dialog directly) — fetches the fresh
   // product first so the form never opens on stale list data.
   const openEditProduct = async (product: Product) => {
      setFetchingProductId(product.id);
      let freshProduct = product;
      try {
         const res = await apiFetch<any>(`/api/v1/products/${product.id}`);
         if (res && (res.data || res.id)) {
            freshProduct = res.data || res;
         }
      } catch (err) {
         console.error("Failed to fetch fresh product details", err);
      } finally {
         setFetchingProductId(null);
      }

      setEditingProduct(freshProduct);
      setOriginalMainImage(freshProduct.main_image || '');
      setForm({
         name: freshProduct.name || '',
         category: freshProduct.category || '',
         sku: freshProduct.sku || '',
         barcode: freshProduct.barcode || '',
         brand: freshProduct.brand || '',
         slug: freshProduct.slug || '',
         description: freshProduct.description || '',
         price: String(freshProduct.price ?? ''),
         compare_price: String(freshProduct.compare_price ?? ''),
         cost_price: String(freshProduct.cost_price ?? ''),
         stock: String(freshProduct.stock ?? ''),
         low_stock_threshold: String(freshProduct.low_stock_threshold ?? '5'),
         tags: freshProduct.tags?.join(', ') || '',
         images: freshProduct.images || [],
         is_active: freshProduct.is_active !== false,
         main_image: freshProduct.main_image || '',
         store_id: (freshProduct as any).store_id || storeId,
         variants: freshProduct.variants || [],
         // Production fields
         supplier_id: (freshProduct as any).supplier_id || '',
         production_source: (freshProduct as any).production_source || EMPTY_FORM.production_source,
         prod_supplier_name: (freshProduct as any).prod_supplier_name || EMPTY_FORM.prod_supplier_name,
         prod_batch_qty: String((freshProduct as any).prod_batch_qty || EMPTY_FORM.prod_batch_qty),
         prod_fabric_cost: String((freshProduct as any).prod_fabric_cost || EMPTY_FORM.prod_fabric_cost),
         prod_fabric_supplier: (freshProduct as any).prod_fabric_supplier || EMPTY_FORM.prod_fabric_supplier,
         prod_accessories_cost: String((freshProduct as any).prod_accessories_cost || EMPTY_FORM.prod_accessories_cost),
         prod_accessories_supplier: (freshProduct as any).prod_accessories_supplier || EMPTY_FORM.prod_accessories_supplier,
         prod_labor_cut_cost: String((freshProduct as any).prod_labor_cut_cost || EMPTY_FORM.prod_labor_cut_cost),
         prod_labor_cut_supplier: (freshProduct as any).prod_labor_cut_supplier || EMPTY_FORM.prod_labor_cut_supplier,
         prod_labor_sew_cost: String((freshProduct as any).prod_labor_sew_cost || EMPTY_FORM.prod_labor_sew_cost),
         prod_labor_sew_supplier: (freshProduct as any).prod_labor_sew_supplier || EMPTY_FORM.prod_labor_sew_supplier,
         prod_labor_finish_cost: String((freshProduct as any).prod_labor_finish_cost || EMPTY_FORM.prod_labor_finish_cost),
         prod_labor_finish_supplier: (freshProduct as any).prod_labor_finish_supplier || EMPTY_FORM.prod_labor_finish_supplier,
         prod_packaging_cost: String((freshProduct as any).prod_packaging_cost || EMPTY_FORM.prod_packaging_cost),
         prod_packaging_supplier: (freshProduct as any).prod_packaging_supplier || EMPTY_FORM.prod_packaging_supplier,
         prod_transport_cost: String((freshProduct as any).prod_transport_cost || EMPTY_FORM.prod_transport_cost),
         prod_transport_supplier: (freshProduct as any).prod_transport_supplier || EMPTY_FORM.prod_transport_supplier,
         prod_other_cost: String((freshProduct as any).prod_other_cost || EMPTY_FORM.prod_other_cost),
         prod_other_supplier: (freshProduct as any).prod_other_supplier || EMPTY_FORM.prod_other_supplier,
         prod_notes: (freshProduct as any).prod_notes || EMPTY_FORM.prod_notes,
         allowed_carriers: Array.isArray((freshProduct as any).allowed_carriers)
            ? (freshProduct as any).allowed_carriers
            : (typeof (freshProduct as any).allowed_carriers === 'string'
               ? (function() { try { return JSON.parse((freshProduct as any).allowed_carriers); } catch { return []; } })()
               : []),
         prod_custom_charges: Array.isArray((freshProduct as any).prod_custom_charges)
            ? (freshProduct as any).prod_custom_charges
            : (typeof (freshProduct as any).prod_custom_charges === 'string'
               ? (function() { try { return JSON.parse((freshProduct as any).prod_custom_charges); } catch { return []; } })()
               : []),
         delivery_fees: (function() {
            const raw = (freshProduct as any).delivery_fees || (freshProduct as any).deliveryFees;
            if (!raw) return { is_free: false, fees: {} };
            if (typeof raw === 'string') {
               try { return JSON.parse(raw); } catch { return { is_free: false, fees: {} }; }
            }
            return raw;
         })(),
         // Pack options
         is_pack: (freshProduct as any).is_pack || false,
         pack_items: (freshProduct as any).pack_items || [],
         pack_charges: (freshProduct as any).pack_charges || [],
         pack_margin: String((freshProduct as any).pack_margin || '0.0'),
         pack_options: (freshProduct as any).pack_options || [],
      });
   };

   const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Client-side validation
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
      if (!allowedTypes.includes(file.type)) {
         toast.error('Type non supporté. Utilisez JPEG, PNG, WebP, GIF ou AVIF.');
         return;
      }
      if (file.size > 20 * 1024 * 1024) {
         toast.error('Image trop volumineuse. Limite: 20 MB.');
         return;
      }

      setIsUploading(true);
      try {
         const fd = new FormData();
         fd.append('file', file);
         if (form.main_image) fd.append('old_url', form.main_image);
         const res = await fetch('/api/v1/upload/image', {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            body: fd,
         });
         if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error((err as any)?.detail || 'Échec du téléversement');
         }
         const text = await res.text();
         const data = text ? JSON.parse(text) : {};
         if (!data.url) throw new Error('Le serveur n\'a pas renvoyé d\'URL d\'image');
         setF({ main_image: data.url });
         toast.success('Image téléversée avec succès');
      } catch (err: any) {
         toast.error(err.message || 'Erreur lors du téléversement');
      } finally {
         setIsUploading(false);
         // Reset input so same file can be re-uploaded
         e.target.value = '';
      }
   };

   const handleSubProductImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
      if (!allowedTypes.includes(file.type)) {
         toast.error('Type non supporté. Utilisez JPEG, PNG, WebP, GIF ou AVIF.');
         return;
      }
      if (file.size > 20 * 1024 * 1024) {
         toast.error('Image trop volumineuse. Limite: 20 MB.');
         return;
      }

      setIsUploadingSubProduct(true);
      try {
         const form = new FormData();
         form.append('file', file);
         if (newSubProduct.main_image) form.append('old_url', newSubProduct.main_image);
         const res = await fetch('/api/v1/upload/image', {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            body: form,
         });
         if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error((err as any)?.detail || 'Échec du téléversement');
         }
         const text = await res.text();
         const data = text ? JSON.parse(text) : {};
         if (!data.url) throw new Error('Le serveur n\'a pas renvoyé d\'URL d\'image');
         setNewSubProduct(prev => ({ ...prev, main_image: data.url }));
         toast.success('Image téléversée avec succès');
      } catch (err: any) {
         toast.error(err.message || 'Erreur lors du téléversement');
      } finally {
         setIsUploadingSubProduct(false);
         e.target.value = '';
      }
   };

   const handleVariantImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
      if (!allowedTypes.includes(file.type)) {
         toast.error('Type non supporté');
         return;
      }

      setUploadingVariantIdx(index);
      try {
         const formData = new FormData();
         formData.append('file', file);
         const oldVariantImg = form.variants[index]?.image;
         if (oldVariantImg) formData.append('old_url', oldVariantImg);
         const res = await fetch('/api/v1/upload/image', {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            body: formData,
         });
         
         if (!res.ok) throw new Error('Échec du téléversement');
         
         const text = await res.text();
         const data = text ? JSON.parse(text) : {};
         if (!data.url) throw new Error('URL manquante');
         
         const nextVariants = [...form.variants];
         nextVariants[index] = { ...nextVariants[index], image: data.url };
         setF({ variants: nextVariants });
         toast.success('Image variante téléversée');
      } catch (err: any) {
         toast.error(err.message || 'Erreur');
      } finally {
         setUploadingVariantIdx(null);
         e.target.value = '';
      }
   };

   const handleGalleryUpload = async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
      const valid = Array.from(files).filter(f => allowed.includes(f.type) && f.size <= 20 * 1024 * 1024);
      if (valid.length < files.length) toast.warning(`${files.length - valid.length} fichier(s) ignoré(s) (format ou taille invalide)`);
      if (!valid.length) return;

      setIsUploadingGallery(true);
      let uploaded = 0;
      const urls: string[] = [];
      try {
         await Promise.all(valid.map(async (file) => {
            const fd = new FormData();
            fd.append('file', file);
            const res = await fetch('/api/v1/upload/image', { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' }, body: fd });
            if (res.ok) { 
               const text = await res.text();
               const d = text ? JSON.parse(text) : {};
               if (d.url) {
                  urls.push(d.url); 
                  uploaded++; 
               }
            }
         }));
         setF({ images: [...form.images, ...urls] });
         toast.success(`${uploaded} photo(s) ajoutée(s)`);
      } catch { toast.error('Erreur lors du téléversement'); }
      finally { setIsUploadingGallery(false); }
   };

   const handleSave = async (e: React.FormEvent) => {
      e.preventDefault();

      const name = form.name.trim();
      const priceRaw = parseInt(form.price || '0');

      if (!name) {
         toast.error('Le nom du produit est obligatoire (onglet "Informations Base")');
         return;
      }
      if (!priceRaw || priceRaw <= 0) {
         toast.error('Le prix de vente est obligatoire (onglet "Prix & Stock")');
         return;
      }

      const sku = form.sku.trim() || generateSku(form.category);
      const slug = form.slug.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      let finalPackItems = [...(form.pack_items || [])];

      if (form.is_pack && finalPackItems.length > 0) {
         const loadingToast = toast.loading("Création des sous-produits sur place...");
         try {
            for (let i = 0; i < finalPackItems.length; i++) {
               const item = finalPackItems[i];
               if (item.isNew) {
                  const subProductData = {
                     name: item.name,
                     slug: item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.random().toString(36).slice(2, 6),
                     sku: item.sku || `SUB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
                     price: item.price || 0,
                     cost_price: item.cost_price || 0,
                     stock: item.stock || 0,
                     main_image: item.main_image || '',
                     images: item.images || [],
                     category: item.category || 'Sous-produits',
                     store_id: form.store_id || storeId,
                     is_active: true,
                  };

                  const res = await apiFetch<any>('/api/v1/products/', {
                     method: 'POST',
                     body: JSON.stringify(subProductData),
                  });

                  if (res && res.data) {
                     finalPackItems[i] = {
                        product_id: res.data.id,
                        name: item.name,
                        sku: item.sku,
                        price: item.price,
                        cost_price: item.cost_price,
                        main_image: item.main_image,
                        quantity: item.quantity || 1,
                        unit_cost: item.cost_price || 0,
                     };
                  } else {
                     throw new Error(`Échec de création du sous-produit ${item.name}`);
                  }
               }
            }
            toast.dismiss(loadingToast);
            toast.success("Sous-produits du pack prêts !");
         } catch (err: any) {
            toast.dismiss(loadingToast);
            toast.error(err.message || "Erreur de création des sous-produits");
            return;
         }
      }

      // Compute cost_price
      let finalCostPrice = parseInt(form.cost_price || '0');
      let prodTotalCost = 0;
      if (form.production_source === 'local') {
         const batchQty = Math.max(1, parseInt(form.prod_batch_qty || '1'));
         const customChargesSum = (form.prod_custom_charges || []).reduce((acc: number, c: any) => 
            acc + Math.round(parseFloat(String(c.qty || '0')) * parseFloat(String(c.unit_cost || '0'))), 0
         );
         prodTotalCost =
            parseInt(form.prod_fabric_cost       || '0') +
            parseInt(form.prod_accessories_cost  || '0') +
            parseInt(form.prod_labor_cut_cost    || '0') +
            parseInt(form.prod_labor_sew_cost    || '0') +
            parseInt(form.prod_labor_finish_cost || '0') +
            parseInt(form.prod_packaging_cost    || '0') +
            parseInt(form.prod_transport_cost    || '0') +
            parseInt(form.prod_other_cost        || '0') +
            customChargesSum;
         finalCostPrice = batchQty > 0 ? Math.round(prodTotalCost / batchQty) : prodTotalCost;
      }

      const data = {
         name,
         slug,
         sku,
         barcode: form.barcode.trim(),
         brand: form.brand.trim(),
         category: form.category.trim(),
         price: priceRaw,
         cost_price: finalCostPrice,
         compare_price: parseInt(form.compare_price || '0'),
         stock: parseInt(form.stock || '0'),
         low_stock_threshold: parseInt(form.low_stock_threshold || '5'),
         description: form.description.trim(),
         is_active: form.is_active,
         store_id: form.store_id || storeId,
         main_image: form.main_image.trim(),
         images: form.images,
         tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
         variants: form.variants,
         shipping_model: form.production_source === 'local' ? 'local_production' : 'imported',
         // Production & Logistics
         production_source: form.production_source,
         prod_supplier_name: form.prod_supplier_name.trim(),
         prod_batch_qty: parseInt(form.prod_batch_qty || '1'),
         prod_fabric_cost: parseInt(form.prod_fabric_cost || '0'),
         prod_fabric_supplier: form.prod_fabric_supplier?.trim() || null,
         prod_accessories_cost: parseInt(form.prod_accessories_cost || '0'),
         prod_accessories_supplier: form.prod_accessories_supplier?.trim() || null,
         prod_labor_cut_cost: parseInt(form.prod_labor_cut_cost || '0'),
         prod_labor_cut_supplier: form.prod_labor_cut_supplier?.trim() || null,
         prod_labor_sew_cost: parseInt(form.prod_labor_sew_cost || '0'),
         prod_labor_sew_supplier: form.prod_labor_sew_supplier?.trim() || null,
         prod_labor_finish_cost: parseInt(form.prod_labor_finish_cost || '0'),
         prod_labor_finish_supplier: form.prod_labor_finish_supplier?.trim() || null,
         prod_packaging_cost: parseInt(form.prod_packaging_cost || '0'),
         prod_packaging_supplier: form.prod_packaging_supplier?.trim() || null,
         prod_transport_cost: parseInt(form.prod_transport_cost || '0'),
         prod_transport_supplier: form.prod_transport_supplier?.trim() || null,
         prod_other_cost: parseInt(form.prod_other_cost || '0'),
         prod_other_supplier: form.prod_other_supplier?.trim() || null,
         prod_notes: form.prod_notes.trim(),
         allowed_carriers: form.allowed_carriers,
         prod_custom_charges: form.prod_custom_charges,
         delivery_fees: form.delivery_fees,
         // Pack options
         is_pack: form.is_pack,
         pack_items: finalPackItems,
         pack_charges: form.pack_charges,
         pack_margin: parseFloat(String(form.pack_margin || '0.0')),
         pack_options: form.pack_options,
      };

      if (editingProduct) {
         updateMutation.mutate({ id: editingProduct.id, data });
      } else {
         // Create product first, then post production charge if local
         createMutation.mutate(data, {
            onSuccess: async () => {
               if (form.production_source === 'local' && prodTotalCost > 0) {
                  try {
                     await apiFetch('/api/v1/finance/transactions', {
                        method: 'POST',
                        body: JSON.stringify({
                           store_id: form.store_id || storeId,
                           type: 'charge',
                           amount: prodTotalCost,
                           description: `Production locale — ${name}${form.prod_supplier_name ? ` (${form.prod_supplier_name})` : ''}: matières ${parseInt(form.prod_fabric_cost||'0')+parseInt(form.prod_accessories_cost||'0')} DA, M.O. ${parseInt(form.prod_labor_cut_cost||'0')+parseInt(form.prod_labor_sew_cost||'0')+parseInt(form.prod_labor_finish_cost||'0')} DA, logistique & divers ${parseInt(form.prod_packaging_cost||'0')+parseInt(form.prod_transport_cost||'0')+parseInt(form.prod_other_cost||'0')} DA`,
                           reference: sku,
                           notes: form.prod_notes.trim() || null,
                        }),
                     });
                     toast.success(`Charge de production enregistrée : ${prodTotalCost.toLocaleString()} DA`);
                  } catch {
                     toast.warning('Produit créé, mais la charge de production n\'a pas pu être enregistrée.');
                  }
               }
            },
         });
      }
   };

   const products = productsQuery.data?.data ?? [];
   const totalPages = productsQuery.data?.totalPages ?? 1;
   const total = productsQuery.data?.total ?? 0;
   const categories = productsQuery.data?.categories ?? [];

   return (
      <div className="space-y-6 pb-28 animate-in fade-in duration-500">
         {/* ─── Premium Header ─── */}
         <div className="bg-white rounded-[32px] lg:rounded-[40px] border p-4 sm:p-6 lg:p-10 shadow-sm relative overflow-hidden" style={{ borderColor: C.border }}>
            <div className="absolute -top-10 -right-10 opacity-[0.03] text-[#4b7bec] rotate-12"><Package className="size-48" /></div>
            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4 sm:gap-8">
               <div className="flex items-center gap-4">
                  <div className="size-12 sm:size-16 rounded-2xl sm:rounded-3xl flex items-center justify-center bg-[#F0F5FF] shadow-inner text-[#4b7bec] shrink-0">
                     <Package className="size-6 sm:size-8" />
                  </div>
                  <div>
                     <h1 className="text-lg sm:text-2xl font-black text-slate-900 tracking-tight uppercase">Stock & Inventaire</h1>
                     <p className="text-xs sm:text-sm font-bold text-slate-400 mt-1">Gérez vos références produits, niveaux de stock et marges</p>
                  </div>
               </div>
               <div className="flex items-center gap-2 sm:gap-3">
                  {isSuperAdmin && (
                     <button
                        onClick={async () => {
                           try {
                              const res = await apiFetch<any>('/api/v1/upload/migrate-to-cloudinary', { method: 'POST' });
                              toast.success(res?.message || 'Images déjà à jour — rien à sécuriser.');
                           } catch (err: any) {
                              toast.error(err?.message || 'Échec de la sécurisation des images.');
                           }
                        }}
                        // This now runs automatically every few minutes in the background
                        // (see app/services/noest_sync.py sync_cloudinary_migration) — this
                        // button just forces an immediate pass instead of waiting.
                        title="Sécurise immédiatement les photos encore temporaires (normalement déjà fait automatiquement en arrière-plan)"
                        className="h-10 sm:h-12 px-4 sm:px-6 rounded-xl sm:rounded-2xl text-[10px] sm:text-[11px] font-black uppercase tracking-widest border hover:bg-slate-50 transition-all text-slate-600 bg-white"
                        style={{ borderColor: C.border }}
                     >
                        <Upload className="size-4 mr-1.5 mb-0.5 inline-block" /> Sécuriser les images
                     </button>
                  )}
                  <button onClick={() => toast.success('Export en cours...')} className="h-10 sm:h-12 px-4 sm:px-6 rounded-xl sm:rounded-2xl text-[10px] sm:text-[11px] font-black uppercase tracking-widest border hover:bg-slate-50 transition-all text-slate-600 bg-white" style={{ borderColor: C.border }}>
                     <Download className="size-4 mr-1.5 mb-0.5 inline-block" /> Exporter
                  </button>
                  <Button onClick={() => { setForm({ ...EMPTY_FORM, store_id: storeId }); setIsCreating(true); }} className="h-10 sm:h-14 px-5 sm:px-10 rounded-xl sm:rounded-2xl text-[11px] sm:text-[12px] font-black uppercase tracking-widest bg-[#4b7bec] hover:bg-[#3867d6] text-white shadow-lg shadow-indigo-200 transition-all border-none">
                     <Plus className="mr-2 size-4 sm:size-6" /> <span className="hidden sm:inline">Ajouter un </span>Produit
                  </Button>
               </div>
            </div>
         </div>
 
         {/* ─── Meta Ads Tip Banner ─── */}
         <div className="bg-[#F0F5FF] border border-[#d9e2ec] rounded-[24px] p-5 flex items-start gap-4 shadow-sm animate-in fade-in duration-600">
            <div className="size-10 rounded-xl bg-white flex items-center justify-center text-[#4b7bec] shrink-0 shadow-sm border border-[#e8edf5]">
               <Zap className="size-5 animate-pulse" />
            </div>
            <div className="space-y-1">
               <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  💡 Optimisation Meta Ads (Pixel & API Conversions)
               </h4>
               <p className="text-xs text-slate-500 leading-relaxed font-medium">
                  Pour suivre la rentabilité de vos publicités (ROAS) en temps réel, assurez-vous d'inclure le <strong>Nom exact du produit</strong> ou son <strong>SKU</strong> (ex: <code className="bg-white/80 px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold text-slate-700">{'{SKU}'}</code>) dans le titre de vos campagnes publicitaires sur Facebook. Le système associera automatiquement les dépenses pub à chaque produit.
               </p>
            </div>
         </div>
 
         {/* ─── Tactical Search Bar ─── */}
         <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-3 bg-white rounded-[32px] border px-4 sm:px-8 py-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-4 shadow-sm" style={{ borderColor: C.border }}>
               <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-[20px] px-4 py-3 shrink-0 h-14">
                  <Calendar className="size-5 text-slate-300" />
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent text-sm font-bold text-slate-600 outline-none w-[120px]" />
                  <span className="text-slate-300">-</span>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent text-sm font-bold text-slate-600 outline-none w-[120px]" />
               </div>
               <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-300" />
                  <Input
                     placeholder="ID, Nom, SKU ou Code barre..."
                     value={searchQuery}
                     onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                     className="pl-14 h-14 bg-slate-50/50 border-slate-100 rounded-[20px] text-sm font-bold focus-visible:ring-[#4b7bec] placeholder:text-slate-300"
                  />
               </div>
               <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(1); }}>
                  <SelectTrigger className="w-48 h-14 bg-slate-50/50 border-slate-100 rounded-2xl text-sm font-bold focus:ring-[#4b7bec]">
                     <div className="flex items-center gap-2">
                        <Tag className="size-4 text-slate-400" />
                        <SelectValue placeholder="Catégorie" />
                     </div>
                  </SelectTrigger>
                  <SelectContent className="rounded-2xl">
                     <SelectItem value="all">Toutes Catégories</SelectItem>
                     {categories.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                     ))}
                  </SelectContent>
               </Select>
               <button onClick={() => productsQuery.refetch()} className="ml-4 p-4 rounded-2xl border border-slate-100 bg-white hover:bg-slate-50 transition-all text-slate-400 shrink-0 shadow-sm">
                  <RefreshCw className={cn("size-6", productsQuery.isFetching && "animate-spin")} />
               </button>
            </div>
            <div className="bg-[#2D3436] rounded-[32px] px-8 py-6 flex items-center justify-between shadow-xl">
               <div>
                  <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1">Total Références</p>
                  <p className="text-3xl font-black text-white leading-none">{total}</p>
               </div>
               <div className="size-14 rounded-2xl bg-white/10 flex items-center justify-center text-[#4b7bec]">
                  <Boxes className="size-8" />
               </div>
            </div>
         </div>

         {/* ─── Data Table ─── */}
         <div className="bg-white rounded-[40px] border shadow-sm overflow-hidden" style={{ borderColor: C.border }}>
            {/* Desktop table — on phones the card grid below replaces it
                (a 1100px-wide table behind horizontal scroll was unusable). */}
            <div className="hidden sm:block overflow-x-auto">
               <table className="w-full text-left min-w-[1100px]">
                  <thead>
                     <tr className="border-b bg-[#FAFBFD]" style={{ borderColor: C.border }}>
                        <th className="px-4 sm:px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest">Produit</th>
                        <th className="px-4 sm:px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest">Catégorie / SKU</th>
                        <th className="px-4 sm:px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest text-center">Prix Vente</th>
                        <th className="px-4 sm:px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest text-center">Niveau Stock</th>
                        <th className="px-4 sm:px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest text-center">Statut</th>
                        <th className="px-4 sm:px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: C.border }}>
                     {productsQuery.isLoading ? (
                        Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={6} className="px-8 py-5"><Skeleton className="h-16 w-full rounded-2xl" /></td></tr>)
                     ) : products.length === 0 ? (
                        <tr><td colSpan={6} className="px-8 py-40 text-center text-slate-400 font-bold uppercase tracking-widest opacity-25"><Package className="size-20 mx-auto mb-4" /> Aucun produit enregistré</td></tr>
                     ) : products.map((product) => (
                        <tr key={product.id} className="hover:bg-slate-50/50 transition-all group">
                           <td className="px-4 sm:px-8 py-6">
                              <div className="flex items-center gap-4">
                                 <div className="size-14 rounded-2xl overflow-hidden border bg-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform" style={{ borderColor: C.border }}>
                                    {product.main_image ? <img key={product.main_image} src={product.main_image} alt={product.name} className="size-full object-cover" /> : <Package className="size-6 text-slate-200" />}
                                 </div>
                                 <div className="max-w-[200px]">
                                    <p className="text-sm font-black text-slate-800 leading-tight mb-1">{product.name}</p>
                                    <p className="text-[10px] font-bold text-slate-400 font-mono tracking-tighter truncate">{product.id}</p>
                                 </div>
                              </div>
                           </td>
                           <td className="px-4 sm:px-8 py-6">
                              <div className="flex flex-col">
                                 <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">{product.category || 'Sans catégorie'}</span>
                                 <span className="text-[10px] font-black text-[#4b7bec] font-mono mt-1">{product.sku}</span>
                              </div>
                           </td>
                           <td className="px-4 sm:px-8 py-6 text-center">
                              <p className="text-sm font-black text-slate-900">{formatPrice(product.price)}</p>
                              {(product.compare_price ?? 0) > 0 && (
                                 <p className="text-[9px] font-bold text-slate-300 uppercase line-through mt-0.5">{formatPrice(product.compare_price!)}</p>
                              )}
                           </td>
                           <td className="px-4 sm:px-8 py-6 text-center">
                              <div className="inline-flex flex-col items-center">
                                 <Badge style={{ backgroundColor: getStockStatus(product.stock).bg, color: getStockStatus(product.stock).color }} className="rounded-xl px-4 py-1.5 border-0 uppercase text-[10px] font-black shadow-sm mb-1.5">
                                    {product.stock} PCS
                                 </Badge>
                                 <span className="text-[9px] font-bold text-slate-300 uppercase tracking-tighter">{getStockStatus(product.stock).label}</span>
                              </div>
                           </td>
                           <td className="px-4 sm:px-8 py-6 text-center">
                              <div className={cn("inline-flex h-2 w-2 rounded-full", product.is_active ? "bg-emerald-500 shadow-[0_0_8px_#20bf6b]" : "bg-slate-300")} />
                           </td>
                           <td className="px-4 sm:px-8 py-6 text-right">
                              <div className="flex items-center justify-end gap-1.5 sm:gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all">
                                 {canSeeFinancials && (
                                 <button
                                    onClick={() => { setAnalyticsProduct(product); setAnalyticsPeriod('30d'); }}
                                    className="size-10 rounded-2xl flex items-center justify-center bg-white border border-slate-100 text-slate-400 hover:text-[#4b7bec] hover:border-[#4b7bec]/20 hover:shadow-lg transition-all"
                                    title="Analytics"
                                 >
                                    <BarChart2 className="size-5" />
                                 </button>
                                 )}
                                 <button
                                     disabled={fetchingProductId === product.id}
                                     onClick={() => openEditProduct(product)}
                                     className="size-10 rounded-2xl flex items-center justify-center bg-white border border-slate-100 text-slate-400 hover:text-[#4b7bec] hover:border-[#4b7bec]/20 hover:shadow-lg transition-all"
                                  >
                                     {fetchingProductId === product.id ? (
                                        <Loader2 className="size-4 animate-spin text-[#4b7bec]" />
                                     ) : (
                                        <Edit3 className="size-5" />
                                     )}
                                  </button>
                                 <button onClick={() => handleDelete(product)} className="size-10 rounded-2xl flex items-center justify-center bg-white border border-slate-100 text-slate-400 hover:text-rose-600 hover:border-rose-100 hover:shadow-lg transition-all">
                                    <Trash2 className="size-5" />
                                 </button>
                              </div>
                           </td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
            {/* ── Mobile card grid — 2 per row, tap a card to edit ── */}
            <div className="sm:hidden p-3">
               {productsQuery.isLoading ? (
                  <div className="grid grid-cols-2 gap-3">
                     {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
                  </div>
               ) : products.length === 0 ? (
                  <div className="py-20 text-center text-slate-300 font-bold uppercase tracking-widest">
                     <Package className="size-14 mx-auto mb-3 opacity-40" /> Aucun produit
                  </div>
               ) : (
                  <div className="grid grid-cols-2 gap-3">
                     {products.map((product) => (
                        <button
                           key={product.id}
                           type="button"
                           onClick={() => openEditProduct(product)}
                           className="text-left bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm active:scale-[0.98] transition-transform"
                        >
                           <div className="h-24 bg-slate-50 flex items-center justify-center overflow-hidden relative">
                              {product.main_image
                                 ? <img src={product.main_image} alt={product.name} className="w-full h-full object-cover" />
                                 : <Package className="size-8 text-slate-200" />}
                              {fetchingProductId === product.id && (
                                 <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                                    <Loader2 className="size-5 animate-spin text-[#4b7bec]" />
                                 </div>
                              )}
                              <span className={cn(
                                 "absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase",
                                 product.is_active !== false ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
                              )}>
                                 {product.is_active !== false ? 'Actif' : 'Inactif'}
                              </span>
                           </div>
                           <div className="p-2.5 space-y-1">
                              <p className="text-[11px] font-black text-slate-800 leading-tight line-clamp-2">{product.name}</p>
                              <div className="flex items-center justify-between gap-1">
                                 <span className="text-[11px] font-black text-[#4b7bec] tabular-nums">{formatPrice(product.price)}</span>
                                 <span className={cn(
                                    "text-[9px] font-black px-1.5 py-0.5 rounded-md",
                                    (product.stock ?? 0) > 0 ? "bg-slate-50 text-slate-500" : "bg-rose-50 text-rose-600"
                                 )}>
                                    Stock {product.stock ?? 0}
                                 </span>
                              </div>
                           </div>
                        </button>
                     ))}
                  </div>
               )}
            </div>

            <div className="px-4 sm:px-10 py-4 sm:py-6 border-t bg-[#FAFBFD]/50 flex items-center justify-between" style={{ borderColor: C.border }}>
               <div className="flex items-center gap-6">
                  <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest hidden sm:block">Affichage <span className="text-slate-700">{products.length}</span> sur {total}</span>
                  <span className="text-[11px] font-black text-slate-700 sm:hidden">{products.length}/{total}</span>
               </div>
               <div className="flex items-center gap-3">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-3 rounded-2xl border border-slate-100 bg-white hover:bg-slate-50 disabled:opacity-30 transition-all font-black text-slate-600">
                     <ChevronLeft className="size-5" />
                  </button>
                  <div className="h-11 px-6 rounded-2xl bg-white border border-slate-100 flex items-center font-black text-xs text-[#2D3436] tracking-widest shadow-sm">
                     PAGE {page} / {totalPages}
                  </div>
                  <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages} className="p-3 rounded-2xl border border-slate-100 bg-white hover:bg-slate-50 disabled:opacity-30 transition-all font-black text-slate-600">
                     <ChevronRight className="size-5" />
                  </button>
               </div>
            </div>
         </div>

         {/* ─── Detail Oriented Product Modal ─── */}
         <Dialog open={!!editingProduct || isCreating} onOpenChange={(open) => { if (!open) { setEditingProduct(null); setIsCreating(false); setForm({ ...EMPTY_FORM }); } }}>
            {/* Centered card on every breakpoint — deliberately NOT fullscreen
                (was w-[100vw] h-[100dvh] on phones): a fixed, capped height
                keeps the dialog stable when switching tabs, and the body
                below scrolls internally. */}
            <DialogContent className="
               w-[94vw] max-w-[1100px] h-[88dvh] max-h-[900px]
               p-0 flex flex-col bg-slate-50 border-none shadow-2xl
               rounded-[20px] sm:rounded-[2rem] overflow-hidden !outline-none
            ">
               {/* ── Header ── */}
               <div className="shrink-0 h-[64px] sm:h-20 px-4 sm:px-8 bg-white border-b border-slate-100 flex items-center justify-between z-20 shadow-sm relative">
                  <div className="flex items-center gap-3 sm:gap-4">
                     <div className="size-10 sm:size-12 rounded-[14px] bg-indigo-50 flex items-center justify-center text-[#4b7bec]">
                        {editingProduct ? <Edit3 className="size-5 sm:size-6" /> : <Plus className="size-5 sm:size-6" />}
                     </div>
                     <div>
                        <DialogTitle className="text-lg sm:text-2xl font-black text-slate-800 tracking-tight leading-none">
                           {editingProduct ? 'Modifier le Produit' : 'Nouvelle Référence'}
                        </DialogTitle>
                        <DialogDescription className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">
                           {activeStore?.name || 'Boutique'}
                        </DialogDescription>
                     </div>
                  </div>
                  <div className="flex items-center gap-4">
                     {editingProduct && canSeeFinancials && (
                        <div className="hidden sm:block px-4 py-1.5 bg-slate-50 rounded-xl border border-slate-100 shrink-0">
                           <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Marge Nette</p>
                           <p className="text-sm font-black text-[#20bf6b] mt-0.5">+{editingProduct.price > 0 ? ((editingProduct.price - (editingProduct.cost_price || 0)) / editingProduct.price * 100).toFixed(1) : '0.0'}%</p>
                        </div>
                     )}
                     <button type="button" onClick={() => { setEditingProduct(null); setIsCreating(false); setForm({ ...EMPTY_FORM }); }} className="size-10 sm:size-12 flex items-center justify-center rounded-[14px] bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors shrink-0">
                        <X className="size-5 sm:size-6" />
                     </button>
                  </div>
               </div>

               <form onSubmit={handleSave} className="flex-1 flex flex-col min-h-0 relative bg-slate-50 w-full h-full">
                  <Tabs defaultValue="base" className="flex-1 flex flex-col md:flex-row w-full h-full min-h-0 relative">
                     {/* ── Sidebar (TabsList) ── */}
                     <div className="shrink-0 md:w-[240px] lg:w-[280px] bg-white md:border-r border-slate-100 flex flex-col z-10 shadow-[4px_0_24px_rgba(0,0,0,0.02)] relative">
                        <TabsList className="h-auto p-4 md:p-6 flex flex-row md:flex-col gap-2 overflow-x-auto md:overflow-y-auto custom-scrollbar justify-start items-stretch bg-transparent border-none w-max md:w-full min-w-full md:min-w-0">
                           {([
                              { value: 'base',      icon: Info,      label: 'Infos',     labelFull: 'Informations' },
                              ...(form.is_pack ? [{ value: 'pack', icon: Boxes, label: 'Pack', labelFull: 'Composition Pack' }] : []),
                              { value: 'pricing',   icon: DollarSign,label: 'Prix',      labelFull: 'Prix & Stock' },
                              { value: 'advanced',  icon: Settings2, label: 'Options',   labelFull: 'Avancé' },
                              { value: 'logistics', icon: Truck,     label: 'Livraison', labelFull: 'Logistique' },
                           ] as any[]).map(({ value, icon: Icon, label, labelFull }) => (
                              <TabsTrigger key={value} value={value}
                                 className="h-12 md:h-14 px-4 md:px-5 justify-start gap-3 rounded-[14px] data-[state=active]:bg-[#4b7bec] data-[state=active]:text-white text-slate-500 hover:bg-slate-50 data-[state=active]:hover:bg-[#4b7bec] transition-all font-black uppercase tracking-[0.15em] text-[10px] sm:text-[11px] shadow-none border-none group"
                              >
                                 <Icon className="size-4 shrink-0 transition-colors group-data-[state=active]:text-white" />
                                 <span className="md:hidden">{label}</span>
                                 <span className="hidden md:inline">{labelFull}</span>
                              </TabsTrigger>
                           ))}
                        </TabsList>
                     </div>

                     {/* ── Main Scrollable Content ── */}
                     <div className="flex-1 flex flex-col min-h-0 bg-[#F8FAFC] relative">
                        <div className="flex-1 overflow-y-auto p-4 sm:p-8 lg:p-10 custom-scrollbar relative">
                        <TabsContent value="base" forceMount className="mt-0 space-y-8 data-[state=inactive]:hidden">
                           {/* CARD 1: CLASSIFICATION */}
                           <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-sm space-y-6">
                           <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                              <Package className="size-4 text-[#4b7bec]" /> Classification & Boutique
                           </h4>
                           {/* ── Type de Produit selector ── */}
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Type de Produit *</label>
                              {/* Stacked on phones: two side-by-side cards in the narrow
                                  centered dialog wrapped their uppercase-tracked text
                                  almost character-by-character. */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                 <button
                                    type="button"
                                    onClick={() => setF({ is_pack: false })}
                                    className={cn(
                                       "p-4 sm:p-5 rounded-[20px] border-2 text-left transition-all flex items-center sm:items-start gap-3 sm:gap-4",
                                       !form.is_pack
                                          ? "border-[#4b7bec] bg-[#4b7bec]/5 text-[#4b7bec]"
                                          : "border-slate-100 bg-white text-slate-500 hover:border-slate-200"
                                    )}
                                 >
                                    <div className={cn(
                                       "size-10 rounded-xl flex items-center justify-center shrink-0",
                                       !form.is_pack ? "bg-[#4b7bec]/10" : "bg-slate-50"
                                    )}>
                                       <Package className="size-5" />
                                    </div>
                                    <div className="min-w-0">
                                       <p className="text-sm font-black uppercase tracking-tight">Produit Simple</p>
                                       <p className="text-[10px] font-bold text-slate-400 mt-1 normal-case sm:uppercase sm:tracking-wider">Un article unique avec son propre stock & options</p>
                                    </div>
                                 </button>
                                 <button
                                    type="button"
                                    onClick={() => setF({ is_pack: true })}
                                    className={cn(
                                       "p-4 sm:p-5 rounded-[20px] border-2 text-left transition-all flex items-center sm:items-start gap-3 sm:gap-4",
                                       form.is_pack
                                          ? "border-[#4b7bec] bg-[#4b7bec]/5 text-[#4b7bec]"
                                          : "border-slate-100 bg-white text-slate-500 hover:border-slate-200"
                                    )}
                                 >
                                    <div className={cn(
                                       "size-10 rounded-xl flex items-center justify-center shrink-0",
                                       form.is_pack ? "bg-[#4b7bec]/10" : "bg-slate-50"
                                    )}>
                                       <Boxes className="size-5" />
                                    </div>
                                    <div className="min-w-0">
                                       <p className="text-sm font-black uppercase tracking-tight">Pack / Upsell</p>
                                       <p className="text-[10px] font-bold text-slate-400 mt-1 normal-case sm:uppercase sm:tracking-wider">Un bundle regroupant plusieurs produits</p>
                                    </div>
                                 </button>
                              </div>
                           </div>
                           {/* ── Boutique selector (visible only to SUPER_ADMIN or when multiple stores) ── */}
                           {(isSuperAdmin || allStores.length > 1) && (
                              <div className="space-y-3">
                                 <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">
                                    Boutique assignée *
                                    <span className="ml-2 text-[10px] font-normal normal-case text-slate-400">
                                       — Ce produit sera visible uniquement dans cette boutique
                                    </span>
                                 </label>
                                 <Select
                                    value={form.store_id || storeId}
                                    onValueChange={v => setF({ store_id: v })}
                                    disabled={!!editingProduct}
                                 >
                                    <SelectTrigger className="h-14 rounded-2xl border-slate-100 bg-slate-50/50 focus:bg-white text-sm font-black px-6 transition-all">
                                       <SelectValue placeholder="Sélectionner une boutique..." />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl">
                                       {(allStores.length > 0 ? allStores : [activeStore]).filter(Boolean).map(s => (
                                          <SelectItem key={s!.id} value={s!.id} className="py-3">
                                             <div className="flex items-center gap-2">
                                                {s!.logo_url ? (
                                                   <img src={s!.logo_url} alt={s!.name} className="size-5 rounded object-contain" />
                                                ) : (
                                                   <div className="size-5 rounded bg-indigo-100 flex items-center justify-center text-[9px] font-black text-indigo-600">{s!.name.charAt(0)}</div>
                                                )}
                                                <span className="font-bold text-sm">{s!.name}</span>
                                                <span className="text-xs text-slate-400 font-mono">{s!.slug}</span>
                                             </div>
                                          </SelectItem>
                                       ))}
                                    </SelectContent>
                                 </Select>
                                 {editingProduct && (
                                    <p className="text-[10px] text-amber-500 font-medium ml-1">⚠ La boutique ne peut pas être modifiée après création.</p>
                                 )}
                              </div>
                           )}
                           </div>

                           {/* CARD 2: INFORMATIONS PRODUIT */}
                           <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-sm space-y-6">
                           <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                              <FileText className="size-4 text-[#4b7bec]" /> Identité Produit
                           </h4>
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8">
                              <div className="space-y-3">
                                 <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Nom commercial de l'article *</label>
                                 <Input value={form.name} onChange={e => setF({ name: e.target.value })} placeholder="Ex: Basket Ultra Pro v2" className="h-14 rounded-2xl border-slate-100 bg-slate-50/50 focus:bg-white text-base font-black px-6 transition-all" />
                              </div>
                              <div className="space-y-3">
                                 <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Catégorie Principale</label>
                                 <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
                                    <PopoverTrigger asChild>
                                       <Button
                                          variant="outline"
                                          role="combobox"
                                          aria-expanded={categoryOpen}
                                          className="w-full h-14 rounded-2xl border-slate-100 bg-slate-50/50 hover:bg-white text-base font-black px-6 justify-between transition-all"
                                       >
                                          {form.category || "Sélectionner ou créer..."}
                                          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                                       </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-2xl" align="start">
                                       <Command>
                                          <CommandInput 
                                             placeholder="Rechercher une catégorie..." 
                                             value={categorySearch}
                                             onValueChange={setCategorySearch}
                                             className="h-11" 
                                          />
                                          <CommandList>
                                             <CommandEmpty>
                                                {categorySearch ? (
                                                   <div 
                                                      className="px-4 py-3 text-sm flex items-center gap-2 cursor-pointer hover:bg-slate-50"
                                                      onClick={() => {
                                                         setF({ category: categorySearch });
                                                         setCategoryOpen(false);
                                                         setCategorySearch('');
                                                      }}
                                                   >
                                                      <Plus className="size-4" />
                                                      Créer "{categorySearch}"
                                                   </div>
                                                ) : "Aucune catégorie trouvée."}
                                             </CommandEmpty>
                                             <CommandGroup>
                                                {categories.map((cat) => (
                                                   <CommandItem
                                                      key={cat}
                                                      value={cat}
                                                      onSelect={() => {
                                                         setF({ category: cat });
                                                         setCategoryOpen(false);
                                                         setCategorySearch('');
                                                      }}
                                                   >
                                                      <Check
                                                         className={cn(
                                                            "mr-2 size-4",
                                                            form.category === cat ? "opacity-100" : "opacity-0"
                                                         )}
                                                      />
                                                      {cat}
                                                   </CommandItem>
                                                ))}
                                                {categorySearch && !categories.some(c => c.toLowerCase() === categorySearch.toLowerCase()) && (
                                                   <CommandItem
                                                      value={categorySearch}
                                                      onSelect={() => {
                                                         setF({ category: categorySearch });
                                                         setCategoryOpen(false);
                                                         setCategorySearch('');
                                                      }}
                                                   >
                                                      <Plus className="mr-2 size-4" />
                                                      Créer "{categorySearch}"
                                                   </CommandItem>
                                                )}
                                             </CommandGroup>
                                          </CommandList>
                                       </Command>
                                    </PopoverContent>
                                 </Popover>
                              </div>
                           </div>

                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8">
                              <div className="space-y-3">
                                 <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Référence Unique (SKU) *</label>
                                 <div className="flex gap-2">
                                    <Input
                                       value={form.sku}
                                       onChange={e => setF({ sku: e.target.value })}
                                       placeholder="E-COMM-001"
                                       className="h-14 rounded-2xl border-slate-100 bg-slate-50/50 focus:bg-white text-base font-black px-6 font-mono transition-all flex-1"
                                    />
                                    <Button
                                       type="button"
                                       onClick={() => setF({ sku: generateSku(form.category) })}
                                       className="h-14 px-4 rounded-2xl bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest whitespace-nowrap"
                                    >
                                       <Zap className="size-4 mr-1" /> Auto
                                    </Button>
                                 </div>
                              </div>
                              <div className="space-y-3">
                                 <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Code Barre (EAN/UPC)</label>
                                 <Input value={form.barcode} onChange={e => setF({ barcode: e.target.value })} placeholder="613..." className="h-14 rounded-2xl border-slate-100 bg-slate-50/50 focus:bg-white text-base font-black px-6 font-mono transition-all" />
                              </div>
                           </div>

                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Description Technique & Marketing</label>
                              <textarea value={form.description} onChange={e => setF({ description: e.target.value })} placeholder="Décrivez les fonctionnalités clés, matières et avantages..." className="w-full min-h-[160px] p-6 rounded-[24px] border border-slate-100 bg-slate-50/50 focus:bg-white focus:ring-4 focus:ring-indigo-50 text-sm font-medium transition-all outline-none resize-none" />
                           </div>
                           </div>

                           {/* CARD 3: MÉDIA */}
                           <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-sm space-y-6">
                           <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                              <ImageIcon className="size-4 text-[#4b7bec]" /> Médias
                           </h4>
                           {/* ── Image principale ── */}
                           <div className="space-y-4">
                              <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Image Principale (HD) (Photo de couverture) *</label>

                              {/* Preview */}
                              <div className="flex flex-col sm:flex-row gap-6 items-start">
                                 <div className={cn(
                                    "size-36 rounded-2xl border-2 border-dashed bg-slate-50 flex items-center justify-center overflow-hidden shrink-0 relative group transition-all",
                                    editingProduct && form.main_image && form.main_image !== originalMainImage
                                       ? "border-emerald-400 ring-2 ring-emerald-200"
                                       : "border-slate-200"
                                 )}>
                                    {form.main_image ? (
                                       <>
                                          <img
                                             key={form.main_image}
                                             src={form.main_image}
                                             alt="preview"
                                             className="size-full object-cover"
                                             onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                          />
                                          {editingProduct && form.main_image !== originalMainImage && (
                                             <span className="absolute bottom-1 left-1 right-1 text-center text-[9px] font-black uppercase tracking-widest bg-emerald-500 text-white rounded-lg py-0.5">
                                                Modifiée
                                             </span>
                                          )}
                                          <button
                                             type="button"
                                             onClick={() => setF({ main_image: '' })}
                                             className="absolute top-1 right-1 size-6 rounded-full bg-rose-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow"
                                          >
                                             <X className="size-3" />
                                          </button>
                                       </>
                                    ) : (
                                       <ImageIcon className="size-10 text-slate-200" />
                                    )}
                                 </div>

                                 <div className="flex-1 w-full space-y-3">
                                    {/* Upload from disk */}
                                    <label className={cn("flex items-center gap-3 h-14 px-6 rounded-2xl border-2 border-dashed cursor-pointer transition-all font-black text-[11px] uppercase tracking-widest",
                                       isUploading ? "border-indigo-300 bg-indigo-50 text-indigo-400" : "border-slate-200 hover:border-[#4b7bec] hover:bg-indigo-50/50 text-slate-500"
                                    )}>
                                       {isUploading ? (
                                          <><Loader2 className="size-4 animate-spin text-indigo-400" /> Téléversement...</>
                                       ) : (
                                          <><Upload className="size-4 shrink-0" /> Téléverser depuis mon ordinateur</>
                                       )}
                                       <input
                                          type="file"
                                          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                                          className="sr-only"
                                          onChange={handleImageUpload}
                                          disabled={isUploading}
                                       />
                                    </label>

                                    <p className="text-[10px] text-slate-400 ml-1">JPEG, PNG, WebP, GIF, AVIF — max 20 MB</p>
                                 </div>
                              </div>
                           </div>
                           </div>

                           {/* ── Variantes & Précision ── */}
                           <div className="space-y-6">
                              <div className="p-6 bg-[#F0F5FF] rounded-[32px] border border-[#4b7bec]/10 flex items-start gap-4">
                                 <div className="size-12 rounded-2xl bg-[#4b7bec] flex items-center justify-center shrink-0 shadow-lg shadow-indigo-200">
                                    <Zap className="size-6 text-white" />
                                 </div>
                                 <div>
                                    <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">Gestion des Variantes (Précision)</h4>
                                    <p className="text-xs text-slate-500 mt-1">Ajoutez des options comme la dimension, la couleur ou la qualité du tissu. Chaque variante peut avoir son propre SKU et niveau de stock.</p>
                                 </div>
                              </div>

                              <div className="space-y-4">
                                 {form.variants.map((v, i) => (
                                    <div key={i} className="p-6 bg-white rounded-[24px] border border-slate-100 shadow-sm space-y-4 animate-in slide-in-from-top-2 duration-300">
                                       <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                             <Badge className="bg-slate-900 text-white font-black text-[9px] uppercase tracking-widest px-3 py-1">Variante #{i + 1}</Badge>
                                             <span className="text-xs font-black text-slate-400 uppercase tracking-widest">{v.name}: {v.value}</span>
                                          </div>
                                          <div className="flex items-center gap-1.5">
                                             {/* Order shown here drives display order everywhere this
                                                 product renders (storefront, landing page, admin). */}
                                             <button
                                               type="button"
                                               disabled={i === 0}
                                               title="Déplacer avant"
                                               onClick={() => {
                                                  const next = [...form.variants];
                                                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                                                  setF({ variants: next });
                                               }}
                                               className="size-8 rounded-xl bg-slate-50 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                                             >
                                                <ChevronLeft className="size-4" />
                                             </button>
                                             <button
                                               type="button"
                                               disabled={i === form.variants.length - 1}
                                               title="Déplacer après"
                                               onClick={() => {
                                                  const next = [...form.variants];
                                                  [next[i], next[i + 1]] = [next[i + 1], next[i]];
                                                  setF({ variants: next });
                                               }}
                                               className="size-8 rounded-xl bg-slate-50 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                                             >
                                                <ChevronRight className="size-4" />
                                             </button>
                                             <button
                                               type="button"
                                               onClick={() => setF({ variants: form.variants.filter((_, idx) => idx !== i) })}
                                               className="size-8 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all"
                                             >
                                                <Trash2 className="size-4" />
                                             </button>
                                          </div>
                                       </div>
                                       <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                          <div className="space-y-1.5">
                                             <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Type</label>
                                             <Input
                                                value={v.name}
                                                onChange={e => {
                                                   const next = [...form.variants];
                                                   next[i].name = e.target.value;
                                                   setF({ variants: next });
                                                }}
                                                placeholder="Ex: Couleur"
                                                className="h-11 rounded-xl border-slate-100 bg-slate-50/30 font-bold"
                                             />
                                          </div>
                                          <div className="space-y-1.5">
                                             <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Valeur</label>
                                             <div className="flex gap-2">
                                                <Input
                                                   value={v.value}
                                                   onChange={e => {
                                                      const next = [...form.variants];
                                                      next[i].value = e.target.value;
                                                      setF({ variants: next });
                                                   }}
                                                   placeholder="Ex: Rouge"
                                                   className="h-11 rounded-xl border-slate-100 bg-slate-50/30 font-bold flex-1 min-w-0"
                                                />
                                                {v.name.toLowerCase().includes('couleur') && (
                                                   <div className="relative group shrink-0">
                                                      <input
                                                         type="color"
                                                         value={v.color || '#000000'}
                                                         onChange={e => {
                                                            const next = [...form.variants];
                                                            next[i].color = e.target.value;
                                                            setF({ variants: next });
                                                         }}
                                                         className="size-11 rounded-xl cursor-pointer border border-slate-100 p-1 bg-white"
                                                      />
                                                   </div>
                                                )}
                                             </div>
                                          </div>
                                          <div className="space-y-1.5">
                                             <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">SKU</label>
                                             <Input
                                                value={v.sku}
                                                onChange={e => {
                                                   const next = [...form.variants];
                                                   next[i].sku = e.target.value;
                                                   setF({ variants: next });
                                                }}
                                                placeholder="REF-V1"
                                                className="h-11 rounded-xl border-slate-100 bg-slate-50/30 font-mono text-xs"
                                             />
                                          </div>
                                          <div className="space-y-1.5">
                                             <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Stock</label>
                                             <Input
                                                type="number"
                                                value={v.stock}
                                                readOnly={v.sub_variants && v.sub_variants.length > 0}
                                                onChange={e => {
                                                   const next = [...form.variants];
                                                   next[i].stock = parseInt(e.target.value) || 0;
                                                   setF({ variants: next });
                                                }}
                                                placeholder="0"
                                                className={cn(
                                                   "h-11 rounded-xl border-slate-100 bg-slate-50/30 font-black text-[#20bf6b]",
                                                   v.sub_variants && v.sub_variants.length > 0 && "bg-slate-100/50 cursor-not-allowed opacity-70"
                                                )}
                                             />
                                          </div>
                                       </div>

                                       {/* ── Sub-variants (Pointures/Tailles) ── */}
                                       <div className="p-4 bg-slate-50/50 rounded-2xl border border-slate-100 space-y-3">
                                          <div className="flex items-center justify-between">
                                             <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Sous-variantes (ex: Pointures)</span>
                                             {!v.sub_variants || v.sub_variants.length === 0 ? (
                                                <button
                                                   type="button"
                                                   onClick={() => {
                                                      const next = [...form.variants];
                                                      next[i].sub_variants = [{ name: 'Taille', value: '', sku: v.sku ? `${v.sku}-1` : '', stock: 10 }];
                                                      next[i].stock = 10;
                                                      setF({ variants: next });
                                                   }}
                                                   className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 uppercase tracking-wider"
                                                >
                                                   + Activer les sous-variantes
                                                </button>
                                             ) : (
                                                <button
                                                   type="button"
                                                   onClick={() => {
                                                      const next = [...form.variants];
                                                      delete next[i].sub_variants;
                                                      setF({ variants: next });
                                                   }}
                                                   className="text-[10px] font-black text-rose-600 hover:text-rose-800 uppercase tracking-wider"
                                                >
                                                   Désactiver
                                                </button>
                                             )}
                                          </div>

                                          {v.sub_variants && v.sub_variants.length > 0 && (
                                             <div className="space-y-3">
                                                {v.sub_variants.map((sv: any, svIdx: number) => (
                                                   <div key={svIdx} className="grid grid-cols-12 gap-2 items-center">
                                                      <div className="col-span-4">
                                                         <Input
                                                            value={sv.value}
                                                            onChange={e => {
                                                               const next = [...form.variants];
                                                               next[i].sub_variants[svIdx].value = e.target.value;
                                                               setF({ variants: next });
                                                            }}
                                                            placeholder="Ex: 41"
                                                            className="h-9 rounded-lg border-slate-100 bg-white font-bold text-xs"
                                                         />
                                                      </div>
                                                      <div className="col-span-4">
                                                         <Input
                                                            value={sv.sku}
                                                            onChange={e => {
                                                               const next = [...form.variants];
                                                               next[i].sub_variants[svIdx].sku = e.target.value;
                                                               setF({ variants: next });
                                                            }}
                                                            placeholder="SKU"
                                                            className="h-9 rounded-lg border-slate-100 bg-white font-mono text-[10px]"
                                                         />
                                                      </div>
                                                      <div className="col-span-3">
                                                         <Input
                                                            type="number"
                                                            value={sv.stock}
                                                            onChange={e => {
                                                               const next = [...form.variants];
                                                               next[i].sub_variants[svIdx].stock = parseInt(e.target.value) || 0;
                                                               next[i].stock = next[i].sub_variants.reduce((sum: number, item: any) => sum + (item.stock || 0), 0);
                                                               setF({ variants: next });
                                                            }}
                                                            placeholder="Stock"
                                                            className="h-9 rounded-lg border-slate-100 bg-white font-black text-xs text-[#20bf6b]"
                                                         />
                                                      </div>
                                                      <div className="col-span-1 flex justify-end">
                                                         <button
                                                            type="button"
                                                            onClick={() => {
                                                               const next = [...form.variants];
                                                               next[i].sub_variants = next[i].sub_variants.filter((_: any, idx: number) => idx !== svIdx);
                                                               next[i].stock = next[i].sub_variants.reduce((sum: number, item: any) => sum + (item.stock || 0), 0);
                                                               setF({ variants: next });
                                                            }}
                                                            className="text-rose-500 hover:text-rose-700 p-1"
                                                         >
                                                            <X className="size-3.5" />
                                                         </button>
                                                      </div>
                                                   </div>
                                                ))}
                                                <div className="flex gap-2 w-full mt-2">
                                                  <button
                                                     type="button"
                                                     onClick={() => {
                                                        const next = [...form.variants];
                                                        next[i].sub_variants.push({ name: 'Taille', value: '', sku: v.sku ? `${v.sku}-${v.sub_variants.length + 1}` : '', stock: 10 });
                                                        next[i].stock = next[i].sub_variants.reduce((sum: number, item: any) => sum + (item.stock || 0), 0);
                                                        setF({ variants: next });
                                                     }}
                                                     className="flex-1 py-1.5 border border-dashed rounded-xl text-[9px] font-black text-slate-500 hover:text-indigo-600 hover:bg-white hover:border-indigo-300 transition-all uppercase tracking-wider"
                                                  >
                                                     + Unitaire
                                                  </button>
                                                  <button
                                                     type="button"
                                                     onClick={() => {
                                                        setSizeRangeModal({
                                                           isOpen: true,
                                                           variantIndex: i,
                                                           rangeStr: '',
                                                           qtyStr: '10',
                                                           onSuccess: (range, qty) => {
                                                              const parts = range.split('-');
                                                              const min = parseInt(parts[0]);
                                                              const max = parseInt(parts[1]);
                                                              if (isNaN(min) || isNaN(max) || min > max) {
                                                                 toast.error("Intervalle invalide. Format attendu : Min-Max (ex: 40-45)");
                                                                 return;
                                                              }
                                                              const stockQty = parseInt(qty || '10') || 0;
                                                              
                                                              const next = [...form.variants];
                                                              if (!next[i].sub_variants) next[i].sub_variants = [];
                                                              
                                                              for (let val = min; val <= max; val++) {
                                                                 next[i].sub_variants.push({
                                                                    name: 'Taille',
                                                                    value: String(val),
                                                                    sku: v.sku ? `${v.sku}-${val}` : `SKU-${val}`,
                                                                    stock: stockQty
                                                                 });
                                                              }
                                                              next[i].stock = next[i].sub_variants.reduce((sum: number, item: any) => sum + (item.stock || 0), 0);
                                                              setF({ variants: next });
                                                              toast.success("Pointures générées avec succès !");
                                                           }
                                                        });
                                                     }}
                                                     className="flex-1 py-1.5 border border-dashed rounded-xl text-[9px] font-black text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50/50 hover:border-indigo-400 transition-all uppercase tracking-wider bg-indigo-50/20"
                                                  >
                                                     ⚡ Par Intervalle (ex: 40-45)
                                                  </button>
                                                </div>
                                             </div>
                                          )}
                                       </div>

                                       <div className="space-y-1.5">
                                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Image spécifique</label>
                                          <div className="flex gap-2">
                                             <div className="size-11 rounded-xl border-2 border-dashed border-slate-100 bg-slate-50 overflow-hidden shrink-0 flex items-center justify-center relative group">
                                                {v.image ? (
                                                   <>
                                                      <img src={v.image} className="size-full object-cover" />
                                                      <button
                                                        type="button"
                                                        onClick={() => {
                                                           const next = [...form.variants];
                                                           next[i].image = '';
                                                           setF({ variants: next });
                                                        }}
                                                        className="absolute inset-0 bg-rose-500/80 text-white opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
                                                      >
                                                         <Trash2 className="size-4" />
                                                      </button>
                                                   </>
                                                ) : (
                                                   uploadingVariantIdx === i ? <Loader2 className="size-4 animate-spin text-indigo-400" /> : <ImageIcon className="size-4 text-slate-200" />
                                                )}
                                             </div>
                                             <label className={cn(
                                               "h-11 px-3 rounded-xl border-2 border-dashed w-28 shrink-0 flex items-center justify-center cursor-pointer transition-all",
                                               uploadingVariantIdx === i ? "border-indigo-300 bg-indigo-50" : "border-slate-100 hover:border-[#4b7bec] hover:bg-indigo-50/50"
                                             )}>
                                                {uploadingVariantIdx === i ? (
                                                   <span className="text-[9px] font-black uppercase text-indigo-400">...</span>
                                                ) : (
                                                   <div className="flex items-center gap-2">
                                                      <Upload className="size-3 text-slate-400" />
                                                      <span className="text-[9px] font-black uppercase text-slate-500">Upload</span>
                                                   </div>
                                                )}
                                                <input
                                                  type="file"
                                                  className="sr-only"
                                                  accept="image/*"
                                                  onChange={(e) => handleVariantImageUpload(e, i)}
                                                  disabled={uploadingVariantIdx !== null}
                                                />
                                             </label>
                                          </div>
                                       </div>
                                    </div>
                                 ))}

                                 <Button 
                                   type="button" 
                                   variant="outline"
                                   onClick={() => setF({ variants: [...form.variants, { name: '', value: '', sku: '', stock: 0 }] })}
                                   className="w-full h-16 rounded-[24px] border-2 border-dashed border-slate-200 hover:border-[#4b7bec] hover:bg-indigo-50/30 hover:text-[#4b7bec] transition-all group"
                                 >
                                    <Plus className="size-5 mr-2 group-hover:scale-125 transition-transform" />
                                    <span className="text-xs font-black uppercase tracking-[0.2em]">Ajouter une option de précision</span>
                                 </Button>
                              </div>
                           </div>

                           {/* ── Galerie (only if no variants) ── */}
                           {form.variants.length === 0 && (
                              <div className="space-y-4 pt-8 border-t border-slate-100">
                                 <div className="flex items-center justify-between">
                                    <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Galerie de photos (Multiples)</label>
                                    {form.images.length > 0 && (
                                       <span className="text-[10px] font-bold text-slate-400">{form.images.length} photo(s)</span>
                                    )}
                                 </div>

                                 {/* Thumbnails grid — first photo is the main/cover image shown
                                     everywhere (storefront, landing page, listings). Reorder with
                                     the arrows to control display order without re-uploading. */}
                                 {form.images.length > 0 && (
                                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
                                       {form.images.map((url, i) => {
                                          const moveImage = (from: number, to: number) => {
                                             if (to < 0 || to >= form.images.length) return;
                                             const next = [...form.images];
                                             const [moved] = next.splice(from, 1);
                                             next.splice(to, 0, moved);
                                             setF({ images: next });
                                          };
                                          return (
                                             <div key={i} className="relative group aspect-square rounded-xl overflow-hidden border border-slate-100 bg-slate-50">
                                                <img src={url} alt={`photo ${i + 1}`} className="size-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).src = ''; }} />
                                                {i === 0 && (
                                                   <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-md bg-slate-900/70 text-white text-[8px] font-black uppercase tracking-wider">Principale</span>
                                                )}
                                                <div className="absolute top-1 left-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                                                   <button
                                                      type="button"
                                                      disabled={i === 0}
                                                      onClick={() => moveImage(i, i - 1)}
                                                      title="Déplacer avant"
                                                      className="size-5 rounded-full bg-slate-900/70 text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                                                   >
                                                      <ChevronLeft className="size-3" />
                                                   </button>
                                                   <button
                                                      type="button"
                                                      disabled={i === form.images.length - 1}
                                                      onClick={() => moveImage(i, i + 1)}
                                                      title="Déplacer après"
                                                      className="size-5 rounded-full bg-slate-900/70 text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                                                   >
                                                      <ChevronRight className="size-3" />
                                                   </button>
                                                </div>
                                                <button
                                                   type="button"
                                                   onClick={() => setF({ images: form.images.filter((_, idx) => idx !== i) })}
                                                   className="absolute top-1 right-1 size-5 rounded-full bg-rose-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow"
                                                >
                                                   <X className="size-3" />
                                                </button>
                                             </div>
                                          );
                                       })}
                                    </div>
                                 )}

                                 {/* Upload zone */}
                                 <label className={cn(
                                    'flex flex-col items-center justify-center w-full h-28 rounded-[20px] border-2 border-dashed cursor-pointer transition-all',
                                    isUploadingGallery ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-[#4b7bec] hover:bg-indigo-50/40'
                                 )}>
                                    {isUploadingGallery ? (
                                       <><Loader2 className="size-6 animate-spin text-indigo-400 mb-2" /><span className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider">Téléversement en cours...</span></>
                                    ) : (
                                       <><Upload className="size-6 text-slate-300 mb-2" /><span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Ajouter des photos supplémentaires</span><span className="text-[10px] text-slate-300 mt-1">Plusieurs fichiers acceptés · JPEG, PNG, WebP, AVIF</span></>
                                    )}
                                    <input
                                       type="file"
                                       accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                                       multiple
                                       className="sr-only"
                                       disabled={isUploadingGallery}
                                       onChange={e => { handleGalleryUpload(e.target.files); e.target.value = ''; }}
                                    />
                                 </label>
                              </div>
                           )}
                        </TabsContent>

                        <TabsContent value="pricing" forceMount className="mt-0 space-y-8 data-[state=inactive]:hidden">
                           <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-sm">
                              <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight mb-4 sm:mb-6 flex items-center gap-2">
                                 <DollarSign className="size-4 text-[#4b7bec]" /> Ingénierie Financière
                              </h4>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                                 <div className="space-y-3">
                                    <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Prix de Vente (DZD) *</label>
                                    <div className="relative">
                                       <Input type="number" value={form.price} onChange={e => setF({ price: e.target.value })} className="h-14 rounded-2xl border-slate-100 bg-white pl-14 text-lg font-black" />
                                       <span className="absolute left-6 top-1/2 -translate-y-1/2 font-black text-slate-400">DA</span>
                                    </div>
                                 </div>
                                 <div className="space-y-3">
                                    <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">
                                       Prix avant promotion
                                    </label>
                                    <p className="text-[11px] text-[#636E72] ml-1 mt-1">
                                       À renseigner uniquement si une réduction est appliquée.
                                    </p>  <div className="relative">
                                       <Input type="number" value={form.compare_price} onChange={e => setF({ compare_price: e.target.value })} className="h-14 rounded-2xl border-slate-100 bg-white pl-14 text-lg font-bold text-slate-300" />
                                       <span className="absolute left-6 top-1/2 -translate-y-1/2 font-black text-slate-200">DA</span>
                                    </div>
                                 </div>
                              </div>
                           </div>

                           {/* ── Source de fabrication (coûts, marges, fournisseurs) ──
                               Entièrement masqué pour le livreur : ce sont des données
                               financières internes sans rapport avec la livraison. ── */}
                           {canSeeFinancials && (
                           <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-sm space-y-6">
                              <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                                 <Factory className="size-4 text-[#e17055]" /> Source de fabrication
                              </h4>

                              {/* Toggle importé / production locale */}
                              <div className="flex gap-3">
                                 {([
                                    { id: 'imported', label: '📦 Importé', desc: 'Prix d\'achat fournisseur (PAF)' },
                                    { id: 'local',    label: '🏭 Production locale', desc: 'Coût de fabrication détaillé' },
                                 ] as const).map(opt => (
                                    <button key={opt.id} type="button"
                                       onClick={() => setF({ production_source: opt.id })}
                                       className={cn(
                                          'flex-1 p-4 rounded-2xl border-2 text-left transition-all',
                                          form.production_source === opt.id
                                             ? 'border-[#e17055] bg-[#e17055]/5'
                                             : 'border-slate-200 bg-white hover:border-slate-300'
                                       )}
                                    >
                                       <p className="text-sm font-black text-slate-800">{opt.label}</p>
                                       <p className="text-[10px] text-slate-400 font-medium mt-0.5">{opt.desc}</p>
                                    </button>
                                 ))}
                              </div>

                              {/* IMPORTÉ : Supplier selector + PAF */}
                              {form.production_source === 'imported' && (
                                 <div className="space-y-5">
                                    {/* Supplier picker */}
                                    <div className="space-y-2">
                                       <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em]">Fournisseur (optionnel)</label>
                                       <Select
                                          value={form.supplier_id || '__none__'}
                                          onValueChange={v => {
                                             if (v === '__none__') { setF({ supplier_id: '' }); return; }
                                             const sup = suppliers.find((s: any) => s.id === v);
                                             setF({
                                                supplier_id: v,
                                                prod_supplier_name: sup?.name ?? '',
                                                // Pre-fill cost_price from supplier's last purchase price if available
                                                ...(sup?.last_purchase_price ? { cost_price: String(sup.last_purchase_price) } : {}),
                                             });
                                          }}
                                       >
                                          <SelectTrigger className="h-14 rounded-2xl border-slate-100 bg-white text-sm font-bold px-5">
                                             <SelectValue placeholder="Sélectionner un fournisseur enregistré..." />
                                          </SelectTrigger>
                                          <SelectContent className="rounded-2xl">
                                             <SelectItem value="__none__">— Aucun fournisseur —</SelectItem>
                                             {suppliers.map((s: any) => (
                                                <SelectItem key={s.id} value={s.id}>
                                                   <div className="flex items-center gap-2">
                                                      <span className="font-bold">{s.name}</span>
                                                      {s.contact_phone && <span className="text-slate-400 text-xs">{s.contact_phone}</span>}
                                                      {s.last_purchase_price && <span className="text-rose-500 text-xs font-black ml-1">{Number(s.last_purchase_price).toLocaleString()} DA</span>}
                                                   </div>
                                                </SelectItem>
                                             ))}
                                          </SelectContent>
                                       </Select>

                                       {!isAddingSupplier ? (
                                          <button
                                             type="button"
                                             onClick={() => setIsAddingSupplier(true)}
                                             className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-[#4b7bec] hover:text-[#3867d6] transition-colors"
                                          >
                                             <Plus className="size-3.5" /> Nouveau fournisseur
                                          </button>
                                       ) : (
                                          <div className="p-4 bg-indigo-50/40 rounded-2xl border border-indigo-100 space-y-3">
                                             <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                <Input
                                                   value={quickSupplierName}
                                                   onChange={e => setQuickSupplierName(e.target.value)}
                                                   placeholder="Nom du fournisseur *"
                                                   className="h-11 rounded-xl border-slate-100 bg-white font-bold text-sm"
                                                   autoFocus
                                                />
                                                <Input
                                                   value={quickSupplierPhone}
                                                   onChange={e => setQuickSupplierPhone(e.target.value)}
                                                   placeholder="Téléphone (optionnel)"
                                                   className="h-11 rounded-xl border-slate-100 bg-white font-bold text-sm"
                                                />
                                             </div>
                                             <div className="flex items-center gap-2">
                                                <Button
                                                   type="button"
                                                   onClick={handleQuickCreateSupplier}
                                                   disabled={isCreatingSupplier}
                                                   className="h-10 px-5 rounded-xl bg-[#4b7bec] hover:bg-[#3867d6] text-white text-[11px] font-black uppercase tracking-widest"
                                                >
                                                   {isCreatingSupplier ? <Loader2 className="size-4 animate-spin" /> : 'Créer et sélectionner'}
                                                </Button>
                                                <button
                                                   type="button"
                                                   onClick={() => { setIsAddingSupplier(false); setQuickSupplierName(''); setQuickSupplierPhone(''); }}
                                                   className="h-10 px-4 rounded-xl text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
                                                >
                                                   Annuler
                                                </button>
                                             </div>
                                             <p className="text-[10px] text-slate-400 font-medium">
                                                Créé instantanément et synchronisé avec le module Fournisseurs — pour les détails complets (adresse, conditions de paiement...), modifiez-le ensuite depuis ce module.
                                             </p>
                                          </div>
                                       )}

                                       {form.supplier_id && suppliers.find((s: any) => s.id === form.supplier_id) && (() => {
                                          const sup = suppliers.find((s: any) => s.id === form.supplier_id);
                                          return (
                                             <div className="flex gap-4 p-3 bg-slate-50 rounded-2xl border border-slate-100 text-[10px] font-bold text-slate-500">
                                                {sup.contact_name && <span>👤 {sup.contact_name}</span>}
                                                {sup.contact_phone && <span>📞 {sup.contact_phone}</span>}
                                                {sup.wilaya && <span>📍 {sup.wilaya}</span>}
                                                {sup.payment_terms && <span>💳 {sup.payment_terms}</span>}
                                             </div>
                                          );
                                       })()}
                                    </div>

                                    {/* PAF input + marge — masqués pour le livreur (données financières
                                        sans rapport avec son rôle) */}
                                    {canSeeFinancials && (
                                    <div className="space-y-2">
                                       <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em]">Prix d'Achat Fournisseur (PAF)</label>
                                       <div className="relative">
                                          <Input type="number" value={form.cost_price}
                                             onChange={e => setF({ cost_price: e.target.value })}
                                             className="h-14 rounded-2xl border-slate-100 bg-white pl-14 text-lg font-black text-rose-500" />
                                          <span className="absolute left-6 top-1/2 -translate-y-1/2 font-black text-rose-200">DA</span>
                                       </div>
                                    </div>
                                    )}

                                    {/* Live margin card for imported mode */}
                                    {canSeeFinancials && (() => {
                                       const sellPrice = parseInt(form.price || '0');
                                       const costPrice = parseInt(form.cost_price || '0');
                                       const margin = sellPrice - costPrice;
                                       const marginPct = sellPrice > 0 ? ((margin / sellPrice) * 100).toFixed(1) : '—';
                                       if (!sellPrice && !costPrice) return null;
                                       return (
                                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 sm:p-5 bg-white rounded-3xl border-2 border-slate-100 shadow-sm">
                                             <div className="text-center">
                                                <p className="text-xl font-black text-rose-500">{costPrice.toLocaleString()} DA</p>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-1">Coût d'achat (PAF)</p>
                                             </div>
                                             <div className="text-center border-x border-slate-100">
                                                <p className={cn("text-xl font-black", margin >= 0 ? 'text-green-600' : 'text-red-500')}>{margin.toLocaleString()} DA</p>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-1">Bénéfice unitaire</p>
                                             </div>
                                             <div className="text-center">
                                                <p className={cn("text-xl font-black", margin >= 0 ? 'text-green-600' : 'text-red-500')}>{marginPct}%</p>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-1">Marge nette</p>
                                             </div>
                                          </div>
                                       );
                                    })()}
                                 </div>
                              )}

                              {/* PRODUCTION LOCALE : formulaire détaillé */}
                              {form.production_source === 'local' && (
                                 <div className="space-y-6">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                       <div className="space-y-1.5">
                                          <label className="text-[10px] font-black uppercase text-[#636E72] tracking-widest">Fournisseur / Atelier / Marque</label>
                                          <Input value={form.prod_supplier_name}
                                             onChange={e => setF({ prod_supplier_name: e.target.value })}
                                             placeholder="Ex: Atelier Karim, SARL Textile..." className="h-11 rounded-2xl border-slate-200 bg-white" />
                                       </div>
                                       <div className="space-y-1.5">
                                          <label className="text-[10px] font-black uppercase text-[#636E72] tracking-widest">Quantité estimée du lot (unités)</label>
                                          <Input type="number" value={form.prod_batch_qty}
                                             onChange={e => setF({ prod_batch_qty: e.target.value })}
                                             placeholder="Ex: 100" className="h-11 rounded-2xl border-slate-200 bg-white font-black" />
                                       </div>
                                    </div>

                                    {/* MICRO DÉTAILS - Groupés par type */}
                                    <div className="space-y-5">
                                       {/* Matières */}
                                       <div className="p-5 rounded-3xl border border-blue-100 bg-blue-50/30 space-y-4">
                                          <h5 className="text-[11px] font-black uppercase text-blue-600 tracking-widest flex items-center gap-2">
                                             <span className="text-base">🧵</span> 1. Matières & Fournitures
                                          </h5>
                                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                             {/* Tissu */}
                                             <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Tissu / Matière Principale</label>
                                                <div className="relative">
                                                   <Input type="number" value={form.prod_fabric_cost} onChange={e => setF({ prod_fabric_cost: e.target.value })} className="h-11 rounded-xl border-blue-100 bg-white font-black pl-10" />
                                                   <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs font-black">DA</span>
                                                </div>
                                                <SupplierInlineSelect value={form.prod_fabric_supplier} onChange={v => setF({ prod_fabric_supplier: v })} suppliers={suppliers} placeholder="Fournisseur tissu..." />
                                             </div>
                                             {/* Accessoires */}
                                             <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Accessoires (Zips, Boutons...)</label>
                                                <div className="relative">
                                                   <Input type="number" value={form.prod_accessories_cost} onChange={e => setF({ prod_accessories_cost: e.target.value })} className="h-11 rounded-xl border-blue-100 bg-white font-black pl-10" />
                                                   <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs font-black">DA</span>
                                                </div>
                                                <SupplierInlineSelect value={form.prod_accessories_supplier} onChange={v => setF({ prod_accessories_supplier: v })} suppliers={suppliers} placeholder="Fournisseur accessoires..." />
                                             </div>
                                          </div>
                                       </div>

                                       {/* Main d'œuvre */}
                                       <div className="p-5 rounded-3xl border border-purple-100 bg-purple-50/30 space-y-4">
                                          <h5 className="text-[11px] font-black uppercase text-purple-600 tracking-widest flex items-center gap-2">
                                             <span className="text-base">👷</span> 2. Main d'œuvre (Façonnier)
                                          </h5>
                                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                             <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Coupe</label>
                                                <div className="relative">
                                                   <Input type="number" value={form.prod_labor_cut_cost} onChange={e => setF({ prod_labor_cut_cost: e.target.value })} className="h-11 rounded-xl border-purple-100 bg-white font-black pl-10" />
                                                   <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs font-black">DA</span>
                                                </div>
                                                <SupplierInlineSelect value={form.prod_labor_cut_supplier} onChange={v => setF({ prod_labor_cut_supplier: v })} suppliers={suppliers} placeholder="Façonnier coupe..." />
                                             </div>
                                             <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Couture / Assemblage</label>
                                                <div className="relative">
                                                   <Input type="number" value={form.prod_labor_sew_cost} onChange={e => setF({ prod_labor_sew_cost: e.target.value })} className="h-11 rounded-xl border-purple-100 bg-white font-black pl-10" />
                                                   <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs font-black">DA</span>
                                                </div>
                                                <SupplierInlineSelect value={form.prod_labor_sew_supplier} onChange={v => setF({ prod_labor_sew_supplier: v })} suppliers={suppliers} placeholder="Façonnier couture..." />
                                             </div>
                                             <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Finition & Repassage</label>
                                                <div className="relative">
                                                   <Input type="number" value={form.prod_labor_finish_cost} onChange={e => setF({ prod_labor_finish_cost: e.target.value })} className="h-11 rounded-xl border-purple-100 bg-white font-black pl-10" />
                                                   <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs font-black">DA</span>
                                                </div>
                                                <SupplierInlineSelect value={form.prod_labor_finish_supplier} onChange={v => setF({ prod_labor_finish_supplier: v })} suppliers={suppliers} placeholder="Façonnier finition..." />
                                             </div>
                                          </div>
                                       </div>

                                       {/* Logistique & Divers */}
                                       <div className="p-5 rounded-3xl border border-orange-100 bg-orange-50/30 space-y-4">
                                          <h5 className="text-[11px] font-black uppercase text-orange-600 tracking-widest flex items-center gap-2">
                                             <span className="text-base">📦</span> 3. Logistique & Divers
                                          </h5>
                                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                             <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Emballage & Étiquettes</label>
                                                <div className="relative">
                                                   <Input type="number" value={form.prod_packaging_cost} onChange={e => setF({ prod_packaging_cost: e.target.value })} className="h-11 rounded-xl border-orange-100 bg-white font-black pl-10" />
                                                   <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs font-black">DA</span>
                                                </div>
                                                <SupplierInlineSelect value={form.prod_packaging_supplier} onChange={v => setF({ prod_packaging_supplier: v })} suppliers={suppliers} placeholder="Fournisseur emballage..." />
                                             </div>
                                             <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Transport Atelier ➔ Dépôt</label>
                                                <div className="relative">
                                                   <Input type="number" value={form.prod_transport_cost} onChange={e => setF({ prod_transport_cost: e.target.value })} className="h-11 rounded-xl border-orange-100 bg-white font-black pl-10" />
                                                   <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs font-black">DA</span>
                                                </div>
                                                <SupplierInlineSelect value={form.prod_transport_supplier} onChange={v => setF({ prod_transport_supplier: v })} suppliers={suppliers} placeholder="Transporteur atelier..." />
                                             </div>
                                             <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Frais annexes (Imprévus)</label>
                                                <div className="relative">
                                                   <Input type="number" value={form.prod_other_cost} onChange={e => setF({ prod_other_cost: e.target.value })} className="h-11 rounded-xl border-orange-100 bg-white font-black pl-10" />
                                                   <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs font-black">DA</span>
                                                </div>
                                                <SupplierInlineSelect value={form.prod_other_supplier} onChange={v => setF({ prod_other_supplier: v })} suppliers={suppliers} placeholder="Prestataire divers..." />
                                             </div>
                                          </div>
                                       </div>

                                       {/* Frais supplémentaires personnalisés */}
                                       <div className="p-5 rounded-3xl border border-[#6C5CE7]/20 bg-[#6C5CE7]/5 space-y-4">
                                          <div className="flex items-center justify-between">
                                             <h5 className="text-[11px] font-black uppercase text-[#6C5CE7] tracking-widest flex items-center gap-2">
                                                <span className="text-base">💎</span> 4. Frais supplémentaires personnalisés
                                             </h5>
                                             <Button type="button" onClick={addCustomCharge} className="h-9 px-4 rounded-xl bg-[#6C5CE7] hover:bg-[#5849D1] text-white text-[10px] font-black uppercase tracking-widest transition-all">
                                                <PlusCircle className="mr-1.5 size-3.5" /> Ajouter un frais
                                             </Button>
                                          </div>

                                          {(form.prod_custom_charges || []).length === 0 ? (
                                             <div className="text-center py-6 border border-dashed border-[#6C5CE7]/30 rounded-2xl bg-white/50">
                                                <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wide">Aucun frais supplémentaire configuré</p>
                                                <p className="text-[9px] text-slate-300 font-medium mt-1">Ajoutez des frais de coupe spéciale, broderie, boutons personnalisés, etc.</p>
                                             </div>
                                          ) : (
                                             <div className="space-y-3">
                                                {/* Header desktop */}
                                                <div className="hidden sm:grid grid-cols-[1.5fr,1fr,0.8fr,1fr,1.5fr,40px] gap-2 px-2 text-[9px] font-black uppercase text-slate-400 tracking-widest">
                                                   <span>Nature du frais</span>
                                                   <span>Unité de mesure</span>
                                                   <span>Quantité</span>
                                                   <span>Coût Unitaire</span>
                                                   <span>Fournisseur associé</span>
                                                   <span></span>
                                                </div>

                                                {(form.prod_custom_charges || []).map((charge: any, idx: number) => {
                                                   return (
                                                      <div key={idx} className="flex flex-col sm:grid sm:grid-cols-[1.5fr,1fr,0.8fr,1fr,1.5fr,40px] gap-2 items-center p-3 bg-white/60 rounded-2xl border border-slate-100/80 shadow-sm hover:shadow-md transition-all">
                                                         {/* Nature */}
                                                         <div className="w-full">
                                                            <Input
                                                               value={charge.name || ''}
                                                               onChange={e => updateCustomCharge(idx, 'name', e.target.value)}
                                                               placeholder="Ex: Broderie logo, Boutonnage..."
                                                               className="h-10 border-slate-200 bg-white rounded-xl px-3 text-xs font-black"
                                                            />
                                                         </div>
                                                         {/* Unité */}
                                                         <div className="w-full">
                                                            <select
                                                               value={charge.unit || 'pièces'}
                                                               onChange={e => updateCustomCharge(idx, 'unit', e.target.value)}
                                                               className="w-full h-10 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 px-3"
                                                            >
                                                               <option value="pièces">pièces</option>
                                                               <option value="mètres">mètres</option>
                                                               <option value="kg">kg</option>
                                                               <option value="heures">heures</option>
                                                               <option value="lots">lots</option>
                                                               <option value="forfait">forfait</option>
                                                            </select>
                                                         </div>
                                                         {/* Qté */}
                                                         <div className="w-full">
                                                            <Input
                                                               type="number"
                                                               value={charge.qty || ''}
                                                               onChange={e => updateCustomCharge(idx, 'qty', e.target.value)}
                                                               placeholder="1"
                                                               className="h-10 border-slate-200 bg-white rounded-xl px-3 text-xs font-black text-center"
                                                            />
                                                         </div>
                                                         {/* Coût unitaire */}
                                                         <div className="w-full relative">
                                                            <Input
                                                               type="number"
                                                               value={charge.unit_cost || ''}
                                                               onChange={e => updateCustomCharge(idx, 'unit_cost', e.target.value)}
                                                               placeholder="0"
                                                               className="h-10 border-slate-200 bg-white rounded-xl pl-7 pr-2 text-xs font-black text-[#00B894]"
                                                            />
                                                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300">DA</span>
                                                         </div>
                                                         {/* Fournisseur */}
                                                         <div className="w-full">
                                                            <SupplierInlineSelect
                                                               value={charge.supplier}
                                                               onChange={v => updateCustomCharge(idx, 'supplier', v)}
                                                               suppliers={suppliers}
                                                               placeholder="Sélectionner..."
                                                            />
                                                         </div>
                                                         {/* Supprimer */}
                                                         <div className="flex justify-end">
                                                            <button
                                                               type="button"
                                                               onClick={() => removeCustomCharge(idx)}
                                                               className="size-10 flex items-center justify-center rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all"
                                                            >
                                                               <Trash2 className="size-4" />
                                                            </button>
                                                         </div>
                                                      </div>
                                                   );
                                                })}
                                             </div>
                                          )}
                                       </div>
                                    </div>

                                    {/* Live summary */}
                                    {(() => {
                                       const batchQty = Math.max(1, parseInt(form.prod_batch_qty || '1'));
                                       const customChargesSum = (form.prod_custom_charges || []).reduce((acc: number, c: any) => 
                                          acc + Math.round(parseFloat(String(c.qty || '0')) * parseFloat(String(c.unit_cost || '0'))), 0
                                       );
                                       const total =
                                          parseInt(form.prod_fabric_cost       || '0') +
                                          parseInt(form.prod_accessories_cost  || '0') +
                                          parseInt(form.prod_labor_cut_cost    || '0') +
                                          parseInt(form.prod_labor_sew_cost    || '0') +
                                          parseInt(form.prod_labor_finish_cost || '0') +
                                          parseInt(form.prod_packaging_cost    || '0') +
                                          parseInt(form.prod_transport_cost    || '0') +
                                          parseInt(form.prod_other_cost        || '0') +
                                          customChargesSum;
                                       const unitCost = Math.round(total / batchQty);
                                       const margin = parseInt(form.price || '0') - unitCost;
                                       const marginPct = parseInt(form.price || '0') > 0
                                          ? ((margin / parseInt(form.price)) * 100).toFixed(1) : '—';
                                       return (
                                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 sm:p-5 bg-white rounded-3xl border-2 border-slate-100 shadow-sm mt-4">
                                             <div className="text-center">
                                                <p className="text-xl font-black text-rose-500">{total.toLocaleString()} DA</p>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-1">Coût total du lot</p>
                                             </div>
                                             <div className="text-center border-x border-slate-100">
                                                <p className="text-xl font-black text-orange-500">{unitCost.toLocaleString()} DA</p>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-1">Coût de revient unitaire</p>
                                             </div>
                                             <div className="text-center">
                                                <p className={cn("text-xl font-black", margin >= 0 ? 'text-green-600' : 'text-red-500')}>{marginPct}%</p>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-1">Marge nette estimée</p>
                                             </div>
                                          </div>
                                       );
                                    })()}

                                    <div className="space-y-1.5">
                                       <label className="text-[10px] font-black uppercase text-[#636E72] tracking-widest">Notes internes (visibles uniquement par vous)</label>
                                       <Input value={form.prod_notes}
                                          onChange={e => setF({ prod_notes: e.target.value })}
                                          placeholder="Ex: lot de janvier 2025, coupe ajustée, tissu commandé chez fournisseur X..." className="h-12 rounded-2xl border-slate-200 bg-white" />
                                    </div>

                                    <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-start gap-3">
                                       <span className="text-amber-500 text-lg mt-0.5">⚡</span>
                                       <p className="text-[11px] text-amber-800 font-bold leading-relaxed">
                                          À la création du produit, le coût total du lot sera enregistré automatiquement comme <strong>charge de production détaillée</strong> dans le module Finance & Trésorerie pour suivre votre rentabilité globale.
                                       </p>
                                    </div>
                                 </div>
                              )}
                           </div>
                           )}

                           <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-sm">
                              <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight mb-4 sm:mb-6 flex items-center gap-2">
                                 <Boxes className="size-4 text-[#20bf6b]" /> Logistique & Stock
                              </h4>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8">
                                 <div className="space-y-3">
                                    <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1 flex items-center justify-between">
                                       <span>Unités en Stock Physiques</span>
                                       {form.variants.length > 0 && (
                                          <Badge className="bg-[#E6FFF8] text-[#20bf6b] border-none font-black text-[9px] uppercase tracking-widest px-2 py-0.5">Calculé auto</Badge>
                                       )}
                                    </label>
                                    <Input 
                                       type="number" 
                                       value={form.stock} 
                                       onChange={e => setF({ stock: e.target.value })} 
                                       readOnly={form.variants.length > 0}
                                       className={cn(
                                          "h-14 rounded-2xl border-slate-100 bg-slate-50/50 text-xl font-black px-6",
                                          form.variants.length > 0 && "opacity-60 cursor-not-allowed bg-slate-100/50"
                                       )} 
                                    />
                                 </div>
                                 <div className="space-y-3">
                                    <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Seuil Alerte Faible Stock</label>
                                    <Input type="number" value={form.low_stock_threshold} onChange={e => setF({ low_stock_threshold: e.target.value })} className="h-14 rounded-2xl border-slate-100 bg-slate-50/50 text-xl font-black px-6 text-orange-500" />
                                 </div>
                              </div>
                           </div>
                        </TabsContent>



                        <TabsContent value="advanced" forceMount className="mt-0 space-y-8 data-[state=inactive]:hidden">
                           <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-sm space-y-6">
                              <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                                 <Zap className="size-4 text-[#4b7bec]" /> Référencement & Options
                              </h4>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                                 <div className="space-y-3">
                                    <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Slug URL Personnalisé</label>
                                    <Input value={form.slug} onChange={e => setF({ slug: e.target.value })} placeholder="chemise-riviera" className="h-14 rounded-2xl border-slate-100 bg-slate-50/50 font-mono text-sm" />
                                    <p className="text-[10px] text-slate-400 font-medium ml-1">
                                       Sois précis(e) — le module Meta Ads s'en sert pour deviner à quel produit rattacher une campagne quand son nom ne le dit pas explicitement. Un slug trop générique (ex: "chemise") peut absorber par erreur le budget d'un autre produit similaire (ex: "chemise-riviera").
                                    </p>
                                 </div>
                                 <div className="space-y-3">
                                    <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Marque / Brand</label>
                                    <Input value={form.brand} onChange={e => setF({ brand: e.target.value })} placeholder="Ex: Nike, Heritage..." className="h-14 rounded-2xl border-slate-100 bg-slate-50/50 font-black px-6" />
                                 </div>
                              </div>

                              <div className="space-y-3">
                                 <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Tags & Mots-clés (Recherche)</label>
                                 <Input value={form.tags} onChange={e => setF({ tags: e.target.value })} placeholder="Promo, Nouvelle Collection, Waterproof..." className="h-14 rounded-2xl border-slate-100 bg-slate-50/50 px-6 font-bold" />
                              </div>

                              <div className="flex items-center justify-between p-5 bg-slate-50 rounded-2xl border border-slate-100">
                                 <div className="flex items-center gap-4">
                                    <div className="size-10 rounded-xl bg-white border flex items-center justify-center text-[#4b7bec]">
                                       <Zap className="size-5" />
                                    </div>
                                    <div>
                                       <p className="text-sm font-black text-slate-800 uppercase tracking-tight">Visibilité Publique</p>
                                       <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Activer pour afficher sur la vitrine</p>
                                    </div>
                                 </div>
                                 <div className="flex items-center gap-3">
                                    <span className={cn("text-[10px] font-black uppercase tracking-widest transition-all", form.is_active ? "text-[#20bf6b]" : "text-slate-300")}>
                                       {form.is_active ? 'En Ligne' : 'Hors Ligne'}
                                    </span>
                                    <input type="checkbox" checked={form.is_active} onChange={e => setF({ is_active: e.target.checked })} className="size-7 rounded-lg border-slate-300 text-[#4b7bec] focus:ring-[#4b7bec]" />
                                 </div>
                              </div>
                           </div>
                        </TabsContent>

                        <TabsContent value="logistics" className="mt-0 space-y-8 data-[state=inactive]:hidden">
                           <div className="space-y-6">
                              {/* Part 1: Allowed Carriers */}
                              <div className="p-6 bg-white rounded-3xl border border-slate-100 space-y-4 shadow-sm">
                                 <div className="flex items-start gap-4 border-b border-slate-100 pb-4">
                                    <div className="size-12 rounded-2xl bg-indigo-100 flex items-center justify-center shrink-0">
                                       <Truck className="size-6 text-indigo-600" />
                                    </div>
                                    <div>
                                       <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">Transporteurs autorisés</h4>
                                       <p className="text-xs text-slate-400 mt-1">Sélectionnez les transporteurs qui peuvent livrer cet article. Si aucun n'est sélectionné, tous les transporteurs de la boutique seront disponibles.</p>
                                    </div>
                                 </div>
                                 
                                 {carriersQuery.isLoading && (
                                    <div className="flex justify-center py-6"><Loader2 className="size-6 animate-spin text-slate-300" /></div>
                                 )}
                                 {!carriersQuery.isLoading && carriers.length === 0 && (
                                    <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 text-[11px] text-amber-700 font-bold">
                                       Aucun transporteur configuré. Ajoutez-en dans le module Partenaires Livraison.
                                    </div>
                                 )}
                                 {!carriersQuery.isLoading && carriers.length > 0 && (
                                    <div className="flex items-start gap-3 p-3.5 bg-emerald-50 border border-emerald-100 rounded-2xl">
                                       <Truck className="size-4 text-emerald-600 mt-0.5 shrink-0" />
                                       <div>
                                          <p className="text-[11px] font-black text-emerald-700">Frais de livraison actifs — appliqués automatiquement</p>
                                          <p className="text-[10px] text-emerald-600 mt-0.5 leading-relaxed">
                                            Les tarifs configurés dans vos <strong>{carriers.length} transporteur(s)</strong> ci-dessous s'appliquent automatiquement à ce produit et s'affichent sur votre landing page. Vous pouvez les personnaliser par wilaya dans la section "Exceptions" ci-dessous.
                                          </p>
                                       </div>
                                    </div>
                                 )}
                                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {carriers.map((p: any) => {
                                       const carrierId = p.id ?? p.carrier_id ?? p.name;
                                       const carrierName = p.name ?? p.carrier_name ?? carrierId;
                                       const checked = form.allowed_carriers.includes(carrierId);
                                       return (
                                          <label key={carrierId} className={cn(
                                             "flex items-start gap-4 p-4 rounded-2xl border transition-all cursor-pointer",
                                             checked ? "border-[#4b7bec] bg-indigo-50/30" : "border-slate-100 bg-white hover:border-[#4b7bec]"
                                          )}>
                                             <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={e => {
                                                   const next = e.target.checked
                                                      ? [...form.allowed_carriers, carrierId]
                                                      : form.allowed_carriers.filter(c => c !== carrierId);
                                                   setF({ allowed_carriers: next });
                                                }}
                                                className="size-5 rounded-lg border-slate-200 text-[#4b7bec] focus:ring-[#4b7bec] mt-0.5"
                                             />
                                             <div className="flex flex-col gap-1 flex-1">
                                                <div className="flex items-center gap-3">
                                                   {p.logo_url ? (
                                                      <img src={p.logo_url} alt={carrierName} className="size-8 object-contain rounded-lg border border-slate-100" />
                                                   ) : (
                                                      <div className="size-8 rounded-lg bg-slate-100 flex items-center justify-center text-[9px] font-black text-slate-400 uppercase">{carrierName.slice(0, 2)}</div>
                                                   )}
                                                   <div>
                                                      <p className="text-sm font-bold text-slate-700">{carrierName}</p>
                                                      {p.fee_home !== undefined && <p className="text-[10px] text-slate-400 font-medium">Tarif forfaitaire: Dom {Number(p.fee_home).toLocaleString()} DA | Bur {Number(p.fee_relay).toLocaleString()} DA</p>}
                                                   </div>
                                                </div>

                                                {/* Default pricing grid collapsible */}
                                                {p.pricing_grid && p.pricing_grid.length > 0 ? (
                                                   <details className="group mt-2">
                                                      <summary className="text-[10px] font-black text-[#4b7bec] hover:underline cursor-pointer list-none flex items-center gap-1 select-none">
                                                         <span>Grille tarifaire par Wilaya par défaut ({p.pricing_grid.length})</span>
                                                         <span className="transition-transform group-open:rotate-180 text-[8px]">▼</span>
                                                      </summary>
                                                      <div className="grid grid-cols-2 gap-2 mt-2 p-3 bg-slate-50 rounded-xl max-h-[160px] overflow-y-auto custom-scrollbar border border-slate-100">
                                                         {p.pricing_grid.map((g: any) => {
                                                            const wName = WILAYAS[g.wilaya_id - 1] || `Wilaya ${g.wilaya_id}`;
                                                            return (
                                                               <div key={g.wilaya_id} className="text-[10px] p-1.5 bg-white rounded-lg border border-slate-200/60">
                                                                  <p className="font-bold text-slate-700">{wName}</p>
                                                                  <p className="text-slate-400 mt-0.5 font-medium">Dom: {g.home_fee} DA | Bur: {g.office_fee} DA</p>
                                                               </div>
                                                            );
                                                         })}
                                                      </div>
                                                   </details>
                                                ) : (
                                                   <p className="text-[10px] text-slate-400 mt-1 italic">Tarif forfaitaire appliqué par défaut.</p>
                                                )}
                                             </div>
                                          </label>
                                       );
                                    })}
                                 </div>
                              </div>

                              {/* Part 2: Custom Shipping Fees / Exceptions */}
                              <div className="p-6 bg-white rounded-3xl border border-slate-100 space-y-6 shadow-sm">
                                 <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                                    <div className="flex items-start gap-4">
                                       <div className="size-12 rounded-2xl bg-emerald-100 flex items-center justify-center shrink-0">
                                          <Truck className="size-6 text-emerald-600" />
                                       </div>
                                       <div>
                                          <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">Frais de livraison de ce produit</h4>
                                          <p className="text-xs text-slate-400 mt-1">Configurez des frais spécifiques pour ce produit. S'ils ne sont pas configurés, les tarifs par défaut des transporteurs ci-dessus s'appliqueront.</p>
                                       </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                       <span className="text-xs text-slate-500 font-bold">Livraison gratuite</span>
                                       <input 
                                          type="checkbox" 
                                          checked={form.delivery_fees?.is_free || false} 
                                          onChange={e => setF({
                                             delivery_fees: {
                                                is_free: e.target.checked,
                                                fees: form.delivery_fees?.fees || {}
                                             }
                                          })} 
                                          className="size-6 rounded-lg border-slate-300 text-[#4b7bec] focus:ring-[#4b7bec]" 
                                       />
                                    </div>
                                 </div>

                                 {!(form.delivery_fees?.is_free || false) && (
                                    <div className="space-y-6">
                                       {/* Form to add custom fee exception */}
                                       <div className="space-y-4">
                                          <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider">Ajouter une exception de tarif par Wilaya</h5>
                                          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                                             <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Transporteur</label>
                                                <select 
                                                   value={selectedCarrierId} 
                                                   onChange={e => setSelectedCarrierId(e.target.value)}
                                                   className="w-full h-10 rounded-lg border border-slate-200 text-xs bg-white px-2 focus:border-[#4b7bec] focus:ring-1 focus:ring-[#4b7bec] outline-none"
                                                >
                                                   <option value="">Choisir...</option>
                                                   {carriers.map((c: any) => {
                                                      const carrierId = c.id ?? c.carrier_id ?? c.name;
                                                      const carrierName = c.name ?? c.carrier_name ?? carrierId;
                                                      return <option key={carrierId} value={carrierId}>{carrierName}</option>;
                                                   })}
                                                </select>
                                             </div>
                                             
                                             <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Wilaya</label>
                                                <select 
                                                   value={selectedWilayaId} 
                                                   onChange={e => setSelectedWilayaId(e.target.value)}
                                                   className="w-full h-10 rounded-lg border border-slate-200 text-xs bg-white px-2 focus:border-[#4b7bec] focus:ring-1 focus:ring-[#4b7bec] outline-none"
                                                >
                                                   {WILAYAS.map((w, index) => (
                                                      <option key={index + 1} value={String(index + 1)}>{index + 1} - {w}</option>
                                                   ))}
                                                </select>
                                             </div>

                                             <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Domicile (DA)</label>
                                                <Input 
                                                   type="number" 
                                                   value={customHomeFee} 
                                                   onChange={e => setCustomHomeFee(e.target.value)} 
                                                   placeholder="Ex: 500" 
                                                   className="h-10 text-xs bg-white border-slate-200 focus-visible:ring-[#4b7bec]"
                                                />
                                             </div>

                                             <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Bureau (DA)</label>
                                                <div className="flex gap-2">
                                                   <Input 
                                                      type="number" 
                                                      value={customDeskFee} 
                                                      onChange={e => setCustomDeskFee(e.target.value)} 
                                                      placeholder="Ex: 300" 
                                                      className="h-10 text-xs bg-white border-slate-200 focus-visible:ring-[#4b7bec] flex-1"
                                                   />
                                                   <Button 
                                                      type="button" 
                                                      onClick={handleAddCustomFee} 
                                                      disabled={!selectedCarrierId || !customHomeFee}
                                                      className="h-10 bg-[#4b7bec] hover:bg-[#3867d6] text-white font-bold rounded-lg text-xs shrink-0 px-4 transition-all"
                                                   >
                                                      Ajouter
                                                   </Button>
                                                </div>
                                             </div>
                                          </div>
                                       </div>

                                       {/* List of configured exceptions */}
                                       <div className="space-y-3">
                                          <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Exceptions de livraison configurées</h5>
                                          {!form.delivery_fees?.fees || Object.keys(form.delivery_fees.fees).length === 0 ? (
                                             <div className="p-5 bg-slate-50 border border-slate-100 rounded-2xl text-center space-y-1">
                                                <p className="text-xs font-bold text-slate-600">✅ Tarifs de vos transporteurs appliqués automatiquement</p>
                                                <p className="text-[10px] text-slate-400">Aucune exception n'est nécessaire. Utilisez le formulaire ci-dessus pour forcer un tarif spécifique sur une wilaya particulière.</p>
                                             </div>
                                          ) : (
                                             <div className="border border-slate-150 rounded-[20px] overflow-hidden divide-y divide-slate-100 bg-white shadow-sm">
                                                {Object.entries(form.delivery_fees.fees).map(([carrier, wilayasObj]: any) => {
                                                   const matchedCarrier = carriers.find(c => (c.id === carrier || c.carrier_id === carrier || c.name === carrier));
                                                   const carrierName = matchedCarrier?.name || carrier;
                                                   return (
                                                      <div key={carrier} className="p-4 space-y-2">
                                                         <h6 className="text-xs font-bold text-slate-800 uppercase flex items-center gap-1.5">
                                                            <Truck className="size-3.5 text-[#4b7bec]" /> Transporteur: {carrierName}
                                                         </h6>
                                                         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pl-5">
                                                            {Object.entries(wilayasObj || {}).map(([wilayaId, rates]: any) => {
                                                               const wName = WILAYAS[parseInt(wilayaId) - 1] || `Wilaya ${wilayaId}`;
                                                               return (
                                                                  <div key={wilayaId} className="flex items-center justify-between p-2.5 bg-slate-50/50 rounded-xl border border-slate-100 text-xs hover:bg-slate-50 transition-all">
                                                                     <div className="min-w-0">
                                                                        <p className="font-bold text-slate-700 truncate">{wName}</p>
                                                                        <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
                                                                           Domicile: {rates.home} DA | Bureau: {rates.desk || rates.office || 0} DA
                                                                        </p>
                                                                     </div>
                                                                     <button 
                                                                        type="button" 
                                                                        onClick={() => handleRemoveCustomFee(carrier, wilayaId)}
                                                                        className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-all ml-2"
                                                                     >
                                                                        <Trash2 className="size-3.5" />
                                                                     </button>
                                                                  </div>
                                                               );
                                                            })}
                                                         </div>
                                                      </div>
                                                   );
                                                })}
                                             </div>
                                          )}
                                       </div>
                                    </div>
                                 )}
                              </div>
                           </div>
                        </TabsContent>

                        {form.is_pack && (
                           <TabsContent value="pack" forceMount className="mt-0 space-y-6 sm:space-y-8 data-[state=inactive]:hidden">
                              <div className="bg-white rounded-[24px] sm:rounded-[32px] border p-6 sm:p-8 space-y-6" style={{ borderColor: C.border }}>
                                 <div className="flex items-center justify-between flex-wrap gap-4 border-b pb-6">
                                    <div>
                                       <h3 className="text-lg font-black text-slate-900 uppercase">Composition du Pack</h3>
                                       <p className="text-xs font-bold text-slate-400 mt-1">Sélectionnez les articles existants ou créez des sous-produits pour composer ce pack</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                       <button
                                          type="button"
                                          onClick={() => setIsNewSubProductOpen(true)}
                                          className="h-11 px-6 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all border-none"
                                       >
                                          <PlusCircle className="size-4" /> Nouveau Sous-Produit
                                        </button>
                                     </div>
                                  </div>

                                  {/* Search to add existing product */}
                                  <div className="relative">
                                     <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-300 pointer-events-none" />
                                     <Input
                                        placeholder="Rechercher un produit à ajouter au pack..."
                                        value={subProductSearch}
                                        onChange={e => setSubProductSearch(e.target.value)}
                                        className="h-12 pl-11 pr-4 bg-slate-50 border-none rounded-xl text-sm font-medium"
                                     />
                                     {subProductSearch && (
                                        <div className="absolute top-13 left-0 right-0 z-50 bg-white border border-slate-100 rounded-2xl shadow-xl overflow-hidden max-h-60 overflow-y-auto">
                                           {products
                                              .filter((p: any) => p.id !== editingProduct?.id && !p.is_pack && p.name.toLowerCase().includes(subProductSearch.toLowerCase()))
                                              .slice(0, 5)
                                              .map((p: any) => {
                                                 const alreadyIn = form.pack_items?.some((item: any) => item.product_id === p.id);
                                                 return (
                                                    <button
                                                       key={p.id}
                                                       type="button"
                                                       disabled={alreadyIn}
                                                       onClick={() => {
                                                          const newItem = {
                                                             product_id: p.id,
                                                             name: p.name,
                                                             sku: p.sku,
                                                             price: p.price,
                                                             cost_price: p.cost_price || 0,
                                                             main_image: p.main_image,
                                                             quantity: 1,
                                                          };
                                                          setF({ pack_items: [...(form.pack_items || []), newItem] });
                                                          setSubProductSearch('');
                                                       }}
                                                       className="w-full px-4 py-3 text-left text-xs font-bold hover:bg-slate-50 flex items-center gap-3 border-b border-slate-50 last:border-0 disabled:opacity-50"
                                                    >
                                                       <div className="size-8 rounded bg-slate-100 overflow-hidden flex items-center justify-center shrink-0 border">
                                                          {p.main_image ? <img src={p.main_image} alt={p.name} className="size-full object-cover" /> : <Package className="size-4 text-slate-300" />}
                                                       </div>
                                                       <div className="flex-1 min-w-0">
                                                          <p className="font-black text-slate-800 truncate">{p.name}</p>
                                                          <p className="text-[10px] text-slate-400 font-mono tracking-tighter">{p.sku || p.id}</p>
                                                       </div>
                                                       <span className="text-[11px] font-black text-[#4b7bec] shrink-0 font-mono">{p.price.toLocaleString()} DA</span>
                                                       {alreadyIn && <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest shrink-0">Ajouté</span>}
                                                    </button>
                                                 );
                                              })}
                                           {products.filter((p: any) => p.id !== editingProduct?.id && !p.is_pack && p.name.toLowerCase().includes(subProductSearch.toLowerCase())).length === 0 && (
                                              <div className="p-4 text-center text-slate-300 text-xs font-bold uppercase">Aucun produit correspondant</div>
                                           )}
                                        </div>
                                     )}
                                  </div>

                                  {/* List of current pack items */}
                                  {(!form.pack_items || form.pack_items.length === 0) ? (
                                     <div className="py-16 text-center border-2 border-dashed border-slate-100 rounded-3xl">
                                        <Boxes className="size-12 text-slate-200 mx-auto mb-3" />
                                        <p className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Ce pack est vide pour le moment</p>
                                        <p className="text-[11px] font-medium text-slate-300 mt-1 max-w-sm mx-auto">Ajoutez des produits ci-dessus ou créez-en de nouveaux sur place pour composer votre pack.</p>
                                     </div>
                                  ) : (
                                     <div className="space-y-3">
                                        <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Produits inclus ({form.pack_items.length})</p>
                                        <div className="divide-y border rounded-3xl overflow-hidden bg-slate-50/50">
                                           {form.pack_items.map((item: any, idx: number) => (
                                              <div key={item.product_id || idx} className="p-4 sm:p-5 flex items-center gap-4 bg-white first:rounded-t-3xl last:rounded-b-3xl">
                                                 <div className="size-12 rounded-xl border bg-slate-100 overflow-hidden flex items-center justify-center shrink-0 shadow-sm">
                                                    {item.main_image ? <img src={item.main_image} alt={item.name} className="size-full object-cover" /> : <Package className="size-6 text-slate-200" />}
                                                 </div>
                                                 <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                       <span className="text-sm font-black text-slate-800 truncate leading-tight">{item.name}</span>
                                                       {item.isNew && (
                                                          <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-amber-100 text-amber-800 shrink-0">Nouveau sur place</span>
                                                       )}
                                                    </div>
                                                    <p className="text-[10px] font-black text-[#4b7bec] font-mono mt-1">{item.sku || 'A générer'}</p>
                                                 </div>
                                                 
                                                 {/* Quantity Selector */}
                                                 <div className="flex items-center gap-2 border rounded-xl bg-slate-50 p-1">
                                                    <button
                                                       type="button"
                                                       onClick={() => {
                                                          const items = [...form.pack_items];
                                                          if (items[idx].quantity > 1) {
                                                             items[idx].quantity--;
                                                             setF({ pack_items: items });
                                                          }
                                                       }}
                                                       className="size-7 rounded-lg bg-white shadow-sm flex items-center justify-center font-black text-sm text-slate-500 hover:text-black hover:bg-slate-50"
                                                    >
                                                       -
                                                    </button>
                                                    <span className="w-8 text-center text-xs font-black font-mono">{item.quantity || 1}</span>
                                                    <button
                                                       type="button"
                                                       onClick={() => {
                                                          const items = [...form.pack_items];
                                                          items[idx].quantity = (items[idx].quantity || 1) + 1;
                                                          setF({ pack_items: items });
                                                       }}
                                                       className="size-7 rounded-lg bg-white shadow-sm flex items-center justify-center font-black text-sm text-slate-500 hover:text-black hover:bg-slate-50"
                                                    >
                                                       +
                                                    </button>
                                                 </div>

                                                 <div className="text-right shrink-0 min-w-24">
                                                    <p className="text-sm font-black text-slate-900 font-mono">{((item.price || 0) * (item.quantity || 1)).toLocaleString()} DA</p>
                                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">{(item.price || 0).toLocaleString()} DA / u</p>
                                                 </div>

                                                 <button
                                                    type="button"
                                                    onClick={() => {
                                                       const items = form.pack_items.filter((_: any, i: number) => i !== idx);
                                                       setF({ pack_items: items });
                                                    }}
                                                    className="size-9 rounded-xl hover:bg-rose-50 text-slate-300 hover:text-rose-600 flex items-center justify-center transition-all shrink-0 border hover:border-rose-100"
                                                 >
                                                    <Trash2 className="size-4.5" />
                                                 </button>
                                              </div>
                                           ))}
                                        </div>
                                     </div>
                                  )}

                                  {/* Summary block */}
                                  {form.pack_items && form.pack_items.length > 0 && (
                                     <div className="p-6 bg-slate-50 rounded-3xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                        <div>
                                           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Somme des prix unitaires</p>
                                           <p className="text-xl font-black text-slate-800 font-mono">
                                              {form.pack_items.reduce((sum: number, item: any) => sum + (item.price || 0) * (item.quantity || 1), 0).toLocaleString()} DA
                                           </p>
                                        </div>
                                        <div className="flex gap-3">
                                           <button
                                              type="button"
                                              onClick={() => {
                                                 const totalPrice = form.pack_items.reduce((sum: number, item: any) => sum + (item.price || 0) * (item.quantity || 1), 0);
                                                 setF({ price: String(Math.round(totalPrice * 0.85)) });
                                                 toast.success("Prix de vente ajusté à 85% de la somme totale.");
                                              }}
                                              className="h-11 px-5 rounded-xl border border-slate-200 hover:border-slate-300 font-black text-[10px] uppercase tracking-widest text-slate-700 bg-white"
                                           >
                                              Ajuster le Prix Vente (-15%)
                                           </button>
                                        </div>
                                     </div>
                                  )}
                               </div>
                            </TabsContent>
                         )}

                        </div>
                        
                        {/* ── Footer ── */}
                        <div className="shrink-0 h-[80px] sm:h-[90px] px-4 sm:px-10 bg-white border-t border-slate-100 flex items-center justify-between gap-4 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.03)] z-20">
                           <div className="hidden sm:flex items-center gap-2 text-slate-300">
                              <CheckCircle2 className="size-4" />
                              <span className="text-[10px] font-black uppercase tracking-[0.2em]">Autosave in cloud</span>
                           </div>
                           <div className="flex items-center justify-end gap-3 w-full sm:w-auto">
                              <Button type="button" variant="ghost"
                                 onClick={() => { setEditingProduct(null); setIsCreating(false); setForm({ ...EMPTY_FORM }); }}
                                 className="h-12 sm:h-14 px-6 rounded-2xl font-black uppercase tracking-[0.15em] text-[11px] text-slate-400 hover:bg-slate-50"
                              >
                                 Annuler
                              </Button>
                              <Button type="submit"
                                 disabled={createMutation.isPending || updateMutation.isPending}
                                 className="flex-1 sm:flex-none h-12 sm:h-14 px-8 rounded-2xl bg-[#4b7bec] hover:bg-[#3867d6] text-white font-black uppercase tracking-[0.15em] text-[11px] shadow-xl shadow-indigo-500/20 transition-all active:scale-[0.98]"
                              >
                                 {createMutation.isPending || updateMutation.isPending
                                    ? <Loader2 className="size-5 animate-spin" />
                                    : editingProduct ? 'Valider modifications ✓' : 'Créer le produit 🚀'
                                 }
                              </Button>
                           </div>
                        </div>
                     </div>
                  </Tabs>
                </form>
                <Dialog open={!!(sizeRangeModal && sizeRangeModal.isOpen)} onOpenChange={(open) => { if (!open) setSizeRangeModal(null); }}>
                  <DialogContent className="max-w-sm bg-white rounded-3xl border border-slate-100 shadow-2xl p-6 gap-0">
                    <div className="space-y-5">
                      <div className="space-y-1.5 text-center">
                        <DialogTitle className="text-sm font-black uppercase tracking-widest text-slate-700">
                          ⚡ Générer des pointures
                        </DialogTitle>
                        <p className="text-xs text-slate-500 font-medium">Créez rapidement une série de pointures avec leur stock.</p>
                      </div>
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Intervalle de pointures</label>
                          <Input
                            type="text"
                            placeholder="ex: 40-45"
                            value={sizeRangeModal?.rangeStr ?? ''}
                            onChange={(e) => sizeRangeModal && setSizeRangeModal({ ...sizeRangeModal, rangeStr: e.target.value })}
                            className="h-11 rounded-xl border-slate-200 bg-slate-50 font-bold text-sm"
                            autoFocus
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Stock par pointure</label>
                          <Input
                            type="number"
                            placeholder="ex: 10"
                            value={sizeRangeModal?.qtyStr ?? ''}
                            onChange={(e) => sizeRangeModal && setSizeRangeModal({ ...sizeRangeModal, qtyStr: e.target.value })}
                            className="h-11 rounded-xl border-slate-200 bg-slate-50 font-black text-sm text-emerald-600"
                          />
                        </div>
                      </div>
                      <div className="flex gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => setSizeRangeModal(null)}
                          className="flex-1 h-11 rounded-xl text-xs font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-all uppercase tracking-wider active:scale-95"
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!sizeRangeModal) return;
                            const { rangeStr, qtyStr, onSuccess } = sizeRangeModal;
                            onSuccess(rangeStr, qtyStr);
                            setSizeRangeModal(null);
                          }}
                          className="flex-1 h-11 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-all uppercase tracking-wider active:scale-95 shadow-md shadow-indigo-500/30"
                        >
                          Générer
                        </button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
             </DialogContent>
          </Dialog>

         {/* ─── Analytics Panel ─── */}
         <Dialog open={!!analyticsProduct} onOpenChange={(open) => { if (!open) setAnalyticsProduct(null); }}>
            <DialogContent className="max-w-2xl p-0 overflow-hidden rounded-[32px] border-0 shadow-2xl gap-0">
               {/* Header */}
               <div className="bg-[#1a1f2e] px-8 py-6 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                     <div className="size-12 rounded-2xl bg-white/10 flex items-center justify-center">
                        {analyticsProduct?.main_image
                           ? <img src={analyticsProduct.main_image} alt="" className="size-full object-cover rounded-2xl" />
                           : <BarChart2 className="size-6 text-white/60" />}
                     </div>
                     <div>
                        <DialogTitle className="text-base font-black text-white leading-tight">
                           {analyticsProduct?.name}
                        </DialogTitle>
                        <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mt-0.5">
                           Performance Produit
                        </p>
                     </div>
                  </div>
                  <div className="flex items-center gap-3">
                     {/* Period selector */}
                     <Select value={analyticsPeriod} onValueChange={setAnalyticsPeriod}>
                        <SelectTrigger className="h-9 w-28 rounded-xl bg-white/10 border-white/10 text-white text-[11px] font-black uppercase tracking-widest">
                           <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                           <SelectItem value="today">Aujourd'hui</SelectItem>
                           <SelectItem value="7d">7 Jours</SelectItem>
                           <SelectItem value="30d">30 Jours</SelectItem>
                           <SelectItem value="90d">90 Jours</SelectItem>
                           <SelectItem value="all_time">Tout</SelectItem>
                        </SelectContent>
                     </Select>
                     <button onClick={() => setAnalyticsProduct(null)} className="p-2 rounded-xl hover:bg-white/10 transition-all">
                        <X className="size-5 text-white/60" />
                     </button>
                  </div>
               </div>

               {/* Body */}
               <div className="bg-white p-8 space-y-6">
                  {analyticsQuery.isLoading ? (
                     <div className="flex items-center justify-center h-48">
                        <Loader2 className="size-8 animate-spin text-slate-300" />
                     </div>
                  ) : analyticsQuery.error ? (
                     <div className="flex items-center justify-center h-48 text-rose-400 font-bold text-sm">
                        Erreur de chargement des données
                     </div>
                  ) : analyticsQuery.data ? (() => {
                     const d = analyticsQuery.data;
                     const profitPositive = d.profit >= 0;

                     const funnelCards = [
                        { label: 'TOTAL', value: d.orders, icon: ShoppingCart, color: '#4b7bec', bg: '#F0F5FF' },
                        { label: 'NOUVELLES', value: d.pending || 0, icon: AlertCircle, color: '#f39c12', bg: '#fef3e5' },
                        { label: 'CONFIRMÉES', value: d.confirmed, icon: CheckCheck, color: '#20bf6b', bg: '#E6FFF8' },
                        { label: 'LIVRÉES', value: d.delivered, icon: Truck, color: '#6c5ce7', bg: '#F0EEFF' },
                        { label: 'RETOURNÉES', value: d.returned, icon: RotateCcw, color: '#eb4d4b', bg: '#FFEDE9' },
                     ];

                     const financialCards = [
                        { label: 'Chiffre d\'Affaires', value: formatPrice(d.revenue), sub: 'Livré', color: '#4b7bec' },
                        { label: 'Coût Total', value: formatPrice(d.cost), sub: 'PAF × QTÉ', color: '#eb4d4b' },
                        { label: 'Bénéfice Net', value: formatPrice(d.profit), sub: profitPositive ? '▲ Positif' : '▼ Négatif', color: profitPositive ? '#20bf6b' : '#eb4d4b' },
                     ];

                     return (
                        <>
                           {/* Funnel row */}
                           <div>
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Statistiques des Commandes</p>
                              <div className="grid grid-cols-5 gap-3">
                                 {funnelCards.map(({ label, value, icon: Icon, color, bg }) => (
                                    <div key={label} className="rounded-2xl border border-slate-100 p-4 flex flex-col items-center gap-2 text-center">
                                       <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: bg }}>
                                          <Icon className="size-5" style={{ color }} />
                                       </div>
                                       <p className="text-2xl font-black" style={{ color }}>{value}</p>
                                       <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-tight">{label}</p>
                                    </div>
                                 ))}
                              </div>
                           </div>

                           {/* Financials row */}
                           <div>
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Analyse Financière · Livraisons</p>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                 {financialCards.map(({ label, value, sub, color }) => (
                                    <div key={label} className="rounded-2xl bg-slate-50 border border-slate-100 p-5">
                                       <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{label}</p>
                                       <p className="text-xl font-black" style={{ color }}>{value}</p>
                                       <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest mt-1">{sub}</p>
                                    </div>
                                 ))}
                              </div>
                           </div>

                           {/* Profit % bar */}
                           <div className="rounded-2xl bg-slate-50 border border-slate-100 p-5">
                              <div className="flex items-center justify-between mb-3">
                                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Marge Nette</p>
                                 <div className="flex items-center gap-2">
                                    {profitPositive
                                       ? <TrendingUp className="size-4 text-[#20bf6b]" />
                                       : <TrendingDown className="size-4 text-[#eb4d4b]" />}
                                    <span className="text-lg font-black" style={{ color: profitPositive ? '#20bf6b' : '#eb4d4b' }}>
                                       {d.profit_pct.toFixed(1)}%
                                    </span>
                                 </div>
                              </div>
                              <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                                 <div
                                    className="h-full rounded-full transition-all duration-700"
                                    style={{
                                       width: `${Math.min(Math.abs(d.profit_pct), 100)}%`,
                                       background: profitPositive ? '#20bf6b' : '#eb4d4b',
                                    }}
                                 />
                              </div>
                           </div>
                        </>
                     );
                  })() : null}
               </div>
            </DialogContent>
         </Dialog>

         {/* ── Delete Confirmation Dialog ── */}
         <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
            <DialogContent title="Supprimer le produit" className="max-w-md bg-white rounded-[32px] border-none p-0 overflow-hidden shadow-2xl">
               <div className="p-8 text-center">
                  <div className="size-20 rounded-[32px] bg-rose-50 text-rose-500 flex items-center justify-center mx-auto mb-6 shadow-inner">
                     <Trash2 className="size-10" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900 mb-2">Supprimer ce produit ?</h3>
                  <p className="text-sm text-slate-500 font-medium leading-relaxed">
                     <span className="font-bold text-slate-800">"{deleteTarget?.name}"</span> sera supprimé ou désactivé.
                     <br />Si des commandes y sont liées, il sera simplement désactivé et masqué de la boutique.
                  </p>
               </div>
               <DialogFooter className="bg-slate-50/80 p-6 flex flex-col sm:flex-row gap-3 border-t border-slate-100">
                  <Button variant="ghost" onClick={() => setDeleteTarget(null)} className="flex-1 h-12 rounded-2xl font-bold text-slate-400 hover:text-slate-600">
                     Annuler
                  </Button>
                  <Button
                     onClick={() => { if (deleteTarget) { deleteMutation.mutate(deleteTarget.id); setDeleteTarget(null); } }}
                     disabled={deleteMutation.isPending}
                     className="flex-1 h-12 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-bold shadow-lg shadow-rose-100"
                  >
                     {deleteMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : 'Confirmer'}
                  </Button>
               </DialogFooter>
            </DialogContent>
         </Dialog>

         {/* ── Sub-Product Creation dialog ── */}
         <Dialog open={isNewSubProductOpen} onOpenChange={setIsNewSubProductOpen}>
            <DialogContent showCloseButton={false} className="max-w-md w-[92vw] sm:w-full bg-white rounded-[24px] sm:rounded-[32px] border-none p-0 overflow-hidden shadow-2xl z-[9999] fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-h-[90vh] flex flex-col">
               <div className="bg-slate-900 px-6 py-5 text-white flex items-center justify-between shrink-0">
                  <div>
                     <DialogTitle className="text-base font-black uppercase tracking-tight">Nouveau Produit sur place</DialogTitle>
                     <DialogDescription className="text-white/40 text-[9px] font-bold uppercase tracking-widest mt-1">Créez un produit directement pour l'ajouter à votre pack</DialogDescription>
                  </div>
                  <button type="button" onClick={() => setIsNewSubProductOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 transition-all shrink-0">
                     <X className="size-4 text-white/60" />
                  </button>
               </div>
               <div className="p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
                  <div className="space-y-1.5">
                     <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Nom de l'article *</label>
                     <Input
                        value={newSubProduct.name}
                        onChange={e => setNewSubProduct(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Ex: T-Shirt blanc Premium"
                        className="h-11 rounded-xl border-slate-100 font-bold"
                     />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                     <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Prix Vente (DA) *</label>
                        <Input
                           type="number"
                           value={newSubProduct.price}
                           onChange={e => setNewSubProduct(prev => ({ ...prev, price: e.target.value }))}
                           placeholder="0"
                           className="h-11 rounded-xl border-slate-100 font-black"
                        />
                     </div>
                     {canSeeFinancials && (
                     <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Coût production/achat (DA)</label>
                        <Input
                           type="number"
                           value={newSubProduct.cost_price}
                           onChange={e => setNewSubProduct(prev => ({ ...prev, cost_price: e.target.value }))}
                           placeholder="0"
                           className="h-11 rounded-xl border-slate-100 font-black text-rose-500 bg-rose-50/20"
                        />
                     </div>
                     )}
                     {!canSeeFinancials && <div />}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                     <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">SKU (Optionnel)</label>
                        <Input
                           value={newSubProduct.sku}
                           onChange={e => setNewSubProduct(prev => ({ ...prev, sku: e.target.value }))}
                           placeholder="TSHIRT-W-01"
                           className="h-11 rounded-xl border-slate-100 font-bold font-mono uppercase"
                        />
                     </div>
                     <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Stock Initial</label>
                        <Input
                           type="number"
                           value={newSubProduct.stock}
                           onChange={e => setNewSubProduct(prev => ({ ...prev, stock: e.target.value }))}
                           placeholder="100"
                           className="h-11 rounded-xl border-slate-100 font-black"
                        />
                     </div>
                  </div>
                  <div className="space-y-1.5">
                     <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Photo (Optionnel)</label>
                     <div className="flex items-center gap-2">
                        {newSubProduct.main_image && (
                           <div className="relative size-11 shrink-0 rounded-xl overflow-hidden border border-slate-200 bg-white">
                              <img src={newSubProduct.main_image} alt="" className="size-full object-cover" />
                              <button
                                 type="button"
                                 onClick={() => setNewSubProduct(prev => ({ ...prev, main_image: '' }))}
                                 className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 flex items-center justify-center transition-all"
                              >
                                 <X className="size-4 text-white" />
                              </button>
                           </div>
                        )}
                        <label className={cn("flex-1 flex items-center justify-center gap-2 h-11 rounded-xl border-2 border-dashed cursor-pointer transition-all text-xs font-bold uppercase tracking-wider",
                           isUploadingSubProduct ? "border-indigo-300 bg-indigo-50 text-indigo-400" : "border-slate-200 hover:border-[#4b7bec] hover:bg-indigo-50/50 text-slate-500"
                        )}>
                           {isUploadingSubProduct ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                           {isUploadingSubProduct ? 'Téléversement...' : (newSubProduct.main_image ? 'Changer' : 'Téléverser')}
                           <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                              className="sr-only"
                              onChange={handleSubProductImageUpload}
                              disabled={isUploadingSubProduct}
                           />
                        </label>
                     </div>
                  </div>
               </div>
               <DialogFooter className="bg-slate-50 p-4 border-t flex gap-2 shrink-0">
                  <button
                     type="button"
                     onClick={() => setIsNewSubProductOpen(false)}
                     className="h-10 px-4 rounded-xl font-black text-[10px] uppercase tracking-widest bg-white border border-slate-200 text-slate-700"
                  >
                     Annuler
                  </button>
                  <button
                     type="button"
                     onClick={() => {
                        if (!newSubProduct.name.trim()) {
                           toast.error("Le nom est obligatoire");
                           return;
                        }
                        const price = parseInt(newSubProduct.price || '0');
                        if (price <= 0) {
                           toast.error("Le prix de vente doit être supérieur à 0");
                           return;
                        }
                        const newItem = {
                           isNew: true,
                           product_id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                           name: newSubProduct.name.trim(),
                           sku: newSubProduct.sku.trim() || `SUB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
                           price: price,
                           cost_price: parseInt(newSubProduct.cost_price || '0'),
                           stock: parseInt(newSubProduct.stock || '0'),
                           main_image: newSubProduct.main_image.trim(),
                           quantity: 1,
                        };
                        setF({ pack_items: [...(form.pack_items || []), newItem] });
                        setNewSubProduct({ name: '', price: '', cost_price: '', sku: '', stock: '100', main_image: '' });
                        setIsNewSubProductOpen(false);
                        toast.success(`Ajouté au pack: ${newItem.name}`);
                     }}
                     className="h-10 px-5 rounded-xl font-black text-[10px] uppercase tracking-widest bg-slate-900 text-white hover:bg-slate-800"
                  >
                     Ajouter au Pack
                  </button>
               </DialogFooter>
            </DialogContent>
         </Dialog>

      </div>
   );

}
