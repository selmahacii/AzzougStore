'use client';

import { useState, useCallback } from 'react';
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
   CheckCircle2,
   ExternalLink,
   Image as ImageIcon,
   Settings2,
   Zap,
   Upload,
   Link as LinkIcon,
   BarChart2,
   TrendingUp,
   TrendingDown,
   ShoppingCart,
   CheckCheck,
   Truck,
   RotateCcw,
   Check,
   ChevronsUpDown,
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
};

export default function ProductsPage() {
   const { activeStore, user, allStores } = useAppStore();
   const storeId = activeStore?.id ?? '';
   const isSuperAdmin = user?.role === 'SUPER_ADMIN';

   const [editingProduct, setEditingProduct] = useState<Product | null>(null);
   const [isCreating, setIsCreating] = useState(false);
   const [categoryOpen, setCategoryOpen] = useState(false);
   const [categorySearch, setCategorySearch] = useState('');
   const [searchQuery, setSearchQuery] = useState('');
   const [categoryFilter, setCategoryFilter] = useState('all');
   const [page, setPage] = useState(1);
   const [pageSizeOption, setPageSizeOption] = useState('15');
   const [isUploading, setIsUploading] = useState(false);
   const [isUploadingGallery, setIsUploadingGallery] = useState(false);
   const [form, setForm] = useState({ ...EMPTY_FORM });
   const [analyticsProduct, setAnalyticsProduct] = useState<Product | null>(null);
   const [analyticsPeriod, setAnalyticsPeriod] = useState('30d');

   const setF = (patch: Partial<typeof EMPTY_FORM>) => setForm(prev => ({ ...prev, ...patch }));

   const pageSize = parseInt(pageSizeOption);

   const buildQueryParams = useCallback(() => {
      const params = new URLSearchParams({ store_id: storeId, page: page.toString(), pageSize: pageSize.toString() });
      if (searchQuery) params.set('search', searchQuery);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      return params.toString();
   }, [storeId, page, pageSize, searchQuery, categoryFilter]);

   const productsQuery = useQuery<ProductsApiResponse>({
      queryKey: ['admin-products', storeId, page, pageSize, searchQuery, categoryFilter],
      queryFn: () => apiFetch(`/api/v1/products/?${buildQueryParams()}`),
      enabled: !!storeId,
   });

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
      onSuccess: () => {
         qc.invalidateQueries({ queryKey: ['admin-products'] });
         toast.success('Produit supprimé');
      }
   });

   const analyticsQuery = useQuery({
      queryKey: ['product-analytics', analyticsProduct?.id, analyticsPeriod, storeId],
      queryFn: () => apiFetch<ProductAnalytics>(
         `/api/v1/products/${analyticsProduct!.id}/analytics?store_id=${storeId}&period=${analyticsPeriod}`
      ),
      enabled: !!analyticsProduct && !!storeId,
      staleTime: 2 * 60 * 1000,
   });

   const handleDelete = (id: string) => {
      if (!window.confirm('Désactiver ce produit ? (les données sont conservées)')) return;
      deleteMutation.mutate(id);
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
         const form = new FormData();
         form.append('file', file);
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
         const data = await res.json() as { url: string };
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
            if (res.ok) { const d = await res.json() as { url: string }; urls.push(d.url); uploaded++; }
         }));
         setF({ images: [...form.images, ...urls] });
         toast.success(`${uploaded} photo(s) ajoutée(s)`);
      } catch { toast.error('Erreur lors du téléversement'); }
      finally { setIsUploadingGallery(false); }
   };

   const handleSave = (e: React.FormEvent) => {
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

      const data = {
         name,
         slug,
         sku,
         barcode: form.barcode.trim(),
         brand: form.brand.trim(),
         category: form.category.trim(),
         price: priceRaw,
         cost_price: parseInt(form.cost_price || '0'),
         compare_price: parseInt(form.compare_price || '0'),
         stock: parseInt(form.stock || '0'),
         low_stock_threshold: parseInt(form.low_stock_threshold || '5'),
         description: form.description.trim(),
         is_active: form.is_active,
         store_id: form.store_id || storeId,
         main_image: form.main_image.trim(),
         images: form.images,
         tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      };

      if (editingProduct) {
         updateMutation.mutate({ id: editingProduct.id, data });
      } else {
         createMutation.mutate(data);
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
                  <button onClick={() => toast.success('Export en cours...')} className="h-10 sm:h-12 px-4 sm:px-6 rounded-xl sm:rounded-2xl text-[10px] sm:text-[11px] font-black uppercase tracking-widest border hover:bg-slate-50 transition-all text-slate-600 bg-white" style={{ borderColor: C.border }}>
                     <Download className="size-4 mr-1.5 mb-0.5 inline-block" /> Exporter
                  </button>
                  <Button onClick={() => { setForm({ ...EMPTY_FORM, store_id: storeId }); setIsCreating(true); }} className="h-10 sm:h-14 px-5 sm:px-10 rounded-xl sm:rounded-2xl text-[11px] sm:text-[12px] font-black uppercase tracking-widest bg-[#4b7bec] hover:bg-[#3867d6] text-white shadow-lg shadow-indigo-200 transition-all border-none">
                     <Plus className="mr-2 size-4 sm:size-6" /> <span className="hidden sm:inline">Ajouter un </span>Produit
                  </Button>
               </div>
            </div>
         </div>

         {/* ─── Tactical Search Bar ─── */}
         <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-3 bg-white rounded-[32px] border px-8 py-6 flex items-center gap-4 shadow-sm" style={{ borderColor: C.border }}>
               <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-300" />
                  <Input
                     placeholder="ID, Nom, SKU ou Code barre..."
                     value={searchQuery}
                     onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                     className="pl-14 h-14 bg-slate-50/50 border-slate-100 rounded-2xl text-sm font-bold focus-visible:ring-[#4b7bec] placeholder:text-slate-300"
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
            <div className="overflow-x-auto">
               <table className="w-full text-left min-w-[1100px]">
                  <thead>
                     <tr className="border-b bg-[#FAFBFD]" style={{ borderColor: C.border }}>
                        <th className="px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest">Produit</th>
                        <th className="px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest">Catégorie / SKU</th>
                        <th className="px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest text-center">Prix Vente</th>
                        <th className="px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest text-center">Niveau Stock</th>
                        <th className="px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest text-center">Statut</th>
                        <th className="px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: C.border }}>
                     {productsQuery.isLoading ? (
                        Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={6} className="px-8 py-5"><Skeleton className="h-16 w-full rounded-2xl" /></td></tr>)
                     ) : products.length === 0 ? (
                        <tr><td colSpan={6} className="px-8 py-40 text-center text-slate-400 font-bold uppercase tracking-widest opacity-25"><Package className="size-20 mx-auto mb-4" /> Aucun produit enregistré</td></tr>
                     ) : products.map((product) => (
                        <tr key={product.id} className="hover:bg-slate-50/50 transition-all group">
                           <td className="px-8 py-6">
                              <div className="flex items-center gap-4">
                                 <div className="size-14 rounded-2xl overflow-hidden border bg-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform" style={{ borderColor: C.border }}>
                                    {product.main_image ? <img src={product.main_image} alt={product.name} className="size-full object-cover" /> : <Package className="size-6 text-slate-200" />}
                                 </div>
                                 <div className="max-w-[200px]">
                                    <p className="text-sm font-black text-slate-800 leading-tight mb-1">{product.name}</p>
                                    <p className="text-[10px] font-bold text-slate-400 font-mono tracking-tighter truncate">{product.id}</p>
                                 </div>
                              </div>
                           </td>
                           <td className="px-8 py-6">
                              <div className="flex flex-col">
                                 <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">{product.category || 'Sans catégorie'}</span>
                                 <span className="text-[10px] font-black text-[#4b7bec] font-mono mt-1">{product.sku}</span>
                              </div>
                           </td>
                           <td className="px-8 py-6 text-center">
                              <p className="text-sm font-black text-slate-900">{formatPrice(product.price)}</p>
                              <p className="text-[9px] font-bold text-slate-300 uppercase line-through mt-0.5">{formatPrice(product.compare_price || 0)}</p>
                           </td>
                           <td className="px-8 py-6 text-center">
                              <div className="inline-flex flex-col items-center">
                                 <Badge style={{ backgroundColor: getStockStatus(product.stock).bg, color: getStockStatus(product.stock).color }} className="rounded-xl px-4 py-1.5 border-0 uppercase text-[10px] font-black shadow-sm mb-1.5">
                                    {product.stock} PCS
                                 </Badge>
                                 <span className="text-[9px] font-bold text-slate-300 uppercase tracking-tighter">{getStockStatus(product.stock).label}</span>
                              </div>
                           </td>
                           <td className="px-8 py-6 text-center">
                              <div className={cn("inline-flex h-2 w-2 rounded-full", product.is_active ? "bg-emerald-500 shadow-[0_0_8px_#20bf6b]" : "bg-slate-300")} />
                           </td>
                           <td className="px-8 py-6 text-right">
                              <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                 <button
                                    onClick={() => { setAnalyticsProduct(product); setAnalyticsPeriod('30d'); }}
                                    className="size-10 rounded-2xl flex items-center justify-center bg-white border border-slate-100 text-slate-400 hover:text-[#4b7bec] hover:border-[#4b7bec]/20 hover:shadow-lg transition-all"
                                    title="Analytics"
                                 >
                                    <BarChart2 className="size-5" />
                                 </button>
                                 <button onClick={() => {
                                    setEditingProduct(product);
                                    setForm({
                                       name: product.name || '',
                                       category: product.category || '',
                                       sku: product.sku || '',
                                       barcode: product.barcode || '',
                                       brand: product.brand || '',
                                       slug: product.slug || '',
                                       description: product.description || '',
                                       price: String(product.price ?? ''),
                                       compare_price: String(product.compare_price ?? ''),
                                       cost_price: String(product.cost_price ?? ''),
                                       stock: String(product.stock ?? ''),
                                       low_stock_threshold: String(product.low_stock_threshold ?? '5'),
                                       tags: product.tags?.join(', ') || '',
                                       images: product.images || [],
                                       is_active: product.is_active !== false,
                                       main_image: product.main_image || '',
                                       store_id: (product as any).store_id || storeId,
                                    });
                                 }} className="size-10 rounded-2xl flex items-center justify-center bg-white border border-slate-100 text-slate-400 hover:text-[#4b7bec] hover:border-[#4b7bec]/20 hover:shadow-lg transition-all">
                                    <Edit3 className="size-5" />
                                 </button>
                                 <button onClick={() => handleDelete(product.id)} className="size-10 rounded-2xl flex items-center justify-center bg-white border border-slate-100 text-slate-400 hover:text-rose-600 hover:border-rose-100 hover:shadow-lg transition-all">
                                    <Trash2 className="size-5" />
                                 </button>
                              </div>
                           </td>
                        </tr>
                     ))}
                  </tbody>
               </table>
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
            <DialogContent className="max-w-[1400px] w-[98vw] p-0 overflow-hidden rounded-2xl sm:rounded-[40px] border-none shadow-2xl max-h-[96vh] flex flex-col">
               <div className="px-4 sm:px-10 py-4 sm:py-8 bg-[#2D3436] text-white flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-5">
                     <div className="size-14 rounded-2xl bg-[#4b7bec] flex items-center justify-center text-white shadow-xl shadow-indigo-500/20">
                        {editingProduct ? <Edit3 className="size-7" /> : <Plus className="size-7" />}
                     </div>
                     <div>
                        <DialogTitle className="text-2xl font-black uppercase tracking-tight">
                           {editingProduct ? 'Édition Expert' : 'Nouvelle Référence'}
                        </DialogTitle>
                        <DialogDescription className="text-white/40 text-[10px] font-black uppercase tracking-widest mt-1 flex items-center gap-2">
                           Configuration détaillée · <span className="text-[#4b7bec]">{activeStore?.name || 'Boutique'}</span>
                        </DialogDescription>
                     </div>
                  </div>
                  <div className="flex items-center gap-4">
                     {editingProduct && (
                        <div className="px-4 py-2 bg-white/5 rounded-xl border border-white/10">
                           <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-0.5">Marge Brute</p>
                           <p className="text-sm font-black text-[#20bf6b]">+{editingProduct.price > 0 ? ((editingProduct.price - (editingProduct.cost_price || 0)) / editingProduct.price * 100).toFixed(1) : '0.0'}%</p>
                        </div>
                     )}
                     <button type="button" onClick={() => { setEditingProduct(null); setIsCreating(false); setForm({ ...EMPTY_FORM }); }} className="p-2 rounded-xl hover:bg-white/10 transition-all">
                        <X className="size-6 text-white/60" />
                     </button>
                  </div>
               </div>

               <form onSubmit={handleSave} className="flex-1 overflow-y-auto bg-white flex flex-col min-h-0">
                  <Tabs defaultValue="base" className="flex-1 flex flex-col min-h-0">
                     <div className="px-2 sm:px-10 border-b bg-slate-50/30 overflow-x-auto">
                        <TabsList className="h-14 sm:h-16 bg-transparent gap-4 sm:gap-8 border-0 flex-nowrap w-max min-w-full">
                           <TabsTrigger value="base" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#4b7bec] rounded-none px-0 text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436]">
                              <Info className="size-4 mr-2" /> Informations Base
                           </TabsTrigger>
                           <TabsTrigger value="pricing" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#4b7bec] rounded-none px-0 text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436]">
                              <DollarSign className="size-4 mr-2" /> Prix & Stock
                           </TabsTrigger>
                           <TabsTrigger value="media" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#4b7bec] rounded-none px-0 text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436]">
                              <ImageIcon className="size-4 mr-2" /> Médias & Visuels
                           </TabsTrigger>
                           <TabsTrigger value="advanced" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#4b7bec] rounded-none px-0 text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436]">
                              <Settings2 className="size-4 mr-2" /> Paramètres Avancés
                           </TabsTrigger>
                           <TabsTrigger value="logistics" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#4b7bec] rounded-none px-0 text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436]">
                              <Truck className="size-4 mr-2" /> Logistique
                           </TabsTrigger>
                        </TabsList>
                     </div>

                     <div className="flex-1 overflow-y-auto p-4 sm:p-10 custom-scrollbar pb-28">
                        <TabsContent value="base" forceMount className="mt-0 space-y-6 sm:space-y-8 data-[state=inactive]:hidden">
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
                        </TabsContent>

                        <TabsContent value="pricing" forceMount className="mt-0 space-y-6 sm:space-y-8 data-[state=inactive]:hidden">
                           <div className="bg-[#F8F9FC] rounded-2xl sm:rounded-[32px] p-4 sm:p-8 border border-slate-100">
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
                                 <div className="space-y-3">
                                    <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Coût Unitaire (PAF)</label>
                                    <div className="relative">
                                       <Input type="number" value={form.cost_price} onChange={e => setF({ cost_price: e.target.value })} className="h-14 rounded-2xl border-slate-100 bg-white pl-14 text-lg font-black text-rose-500" />
                                       <span className="absolute left-6 top-1/2 -translate-y-1/2 font-black text-rose-200">DA</span>
                                    </div>
                                 </div>
                              </div>
                           </div>

                           <div className="bg-white rounded-2xl sm:rounded-[32px] p-4 sm:p-8 border border-slate-100 shadow-sm">
                              <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight mb-4 sm:mb-6 flex items-center gap-2">
                                 <Boxes className="size-4 text-[#20bf6b]" /> Logistique & Stock
                              </h4>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8">
                                 <div className="space-y-3">
                                    <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Unités en Stock Physiques</label>
                                    <Input type="number" value={form.stock} onChange={e => setF({ stock: e.target.value })} className="h-14 rounded-2xl border-slate-100 bg-slate-50/50 text-xl font-black px-6" />
                                 </div>
                                 <div className="space-y-3">
                                    <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Seuil Alerte Faible Stock</label>
                                    <Input type="number" value={form.low_stock_threshold} onChange={e => setF({ low_stock_threshold: e.target.value })} className="h-14 rounded-2xl border-slate-100 bg-slate-50/50 text-xl font-black px-6 text-orange-500" />
                                 </div>
                              </div>
                           </div>
                        </TabsContent>

                        <TabsContent value="media" forceMount className="mt-0 space-y-8 data-[state=inactive]:hidden">
                           {/* ── Image principale ── */}
                           <div className="space-y-4">
                              <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Image Principale (HD)</label>

                              {/* Preview */}
                              <div className="flex gap-6 items-start">
                                 <div className="size-36 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0 relative group">
                                    {form.main_image ? (
                                       <>
                                          <img
                                             src={form.main_image}
                                             alt="preview"
                                             className="size-full object-cover"
                                             onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                          />
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

                                 <div className="flex-1 space-y-3">
                                    {/* Upload from disk */}
                                    <label className={cn("flex items-center gap-3 h-14 px-6 rounded-2xl border-2 border-dashed cursor-pointer transition-all font-black text-[11px] uppercase tracking-widest",
                                       isUploading ? "border-indigo-300 bg-indigo-50 text-indigo-400" : "border-slate-200 hover:border-[#4b7bec] hover:bg-indigo-50/50 text-slate-500"
                                    )}>
                                       {isUploading ? (
                                          <><Loader2 className="size-4 animate-spin text-indigo-400" /> Téléversement...</>
                                       ) : (
                                          <><Upload className="size-4" /> Téléverser depuis mon ordinateur</>
                                       )}
                                       <input
                                          type="file"
                                          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                                          className="sr-only"
                                          onChange={handleImageUpload}
                                          disabled={isUploading}
                                       />
                                    </label>

                                    {/* OR: URL input */}
                                    <div className="flex items-center gap-2">
                                       <div className="h-px flex-1 bg-slate-100" />
                                       <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ou</span>
                                       <div className="h-px flex-1 bg-slate-100" />
                                    </div>
                                    <div className="relative">
                                       <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-300" />
                                       <Input
                                          value={form.main_image}
                                          placeholder="https://example.com/image.jpg"
                                          className="h-12 rounded-2xl border-slate-100 bg-slate-50/50 pl-12 font-mono text-xs"
                                          onChange={(e) => setF({ main_image: e.target.value })}
                                       />
                                    </div>
                                    <p className="text-[10px] text-slate-400 ml-1">JPEG, PNG, WebP, GIF, AVIF — max 20 MB</p>
                                 </div>
                              </div>
                           </div>

                           {/* ── Galerie ── */}
                           <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                 <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Galerie de photos</label>
                                 {form.images.length > 0 && (
                                    <span className="text-[10px] font-bold text-slate-400">{form.images.length} photo(s)</span>
                                 )}
                              </div>

                              {/* Thumbnails grid */}
                              {form.images.length > 0 && (
                                 <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
                                    {form.images.map((url, i) => (
                                       <div key={i} className="relative group aspect-square rounded-xl overflow-hidden border border-slate-100 bg-slate-50">
                                          <img src={url} alt={`photo ${i + 1}`} className="size-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).src = ''; }} />
                                          <button
                                             type="button"
                                             onClick={() => setF({ images: form.images.filter((_, idx) => idx !== i) })}
                                             className="absolute top-1 right-1 size-5 rounded-full bg-rose-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow"
                                          >
                                             <X className="size-3" />
                                          </button>
                                       </div>
                                    ))}
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
                                    <><Upload className="size-6 text-slate-300 mb-2" /><span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Ajouter des photos</span><span className="text-[10px] text-slate-300 mt-1">Plusieurs fichiers acceptés · JPEG, PNG, WebP, AVIF</span></>
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
                        </TabsContent>

                        <TabsContent value="advanced" forceMount className="mt-0 space-y-6 sm:space-y-8 data-[state=inactive]:hidden">
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8">
                              <div className="space-y-3">
                                 <label className="text-[11px] font-black uppercase text-[#636E72] tracking-[0.1em] ml-1">Slug URL Personnalisé</label>
                                 <Input value={form.slug} onChange={e => setF({ slug: e.target.value })} placeholder="basket-pro-v2" className="h-14 rounded-2xl border-slate-100 bg-slate-50/50 font-mono text-sm" />
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

                           <div className="flex items-center justify-between p-6 bg-slate-50 rounded-[24px] border border-slate-100">
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
                        </TabsContent>

                        <TabsContent value="logistics" className="mt-0 space-y-8 data-[state=inactive]:hidden">
                           <div className="space-y-4">
                              <div className="p-6 bg-slate-50 rounded-[32px] border border-slate-100 flex items-start gap-4">
                                 <div className="size-12 rounded-2xl bg-indigo-100 flex items-center justify-center shrink-0">
                                    <Truck className="size-6 text-indigo-600" />
                                 </div>
                                 <div>
                                    <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">Transporteurs autorisés</h4>
                                    <p className="text-xs text-slate-400 mt-1">Sélectionnez les transporteurs qui peuvent livrer cet article. Si aucun n'est sélectionné, tous les transporteurs de la boutique seront disponibles.</p>
                                 </div>
                              </div>
                              
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                 {/* Dynamic Partners fetch would go here */}
                                 {['Yalidine', 'Noest', 'Zaki Express'].map(p => (
                                    <label key={p} className="flex items-center gap-4 p-4 rounded-2xl border border-slate-100 bg-white hover:border-[#4b7bec] transition-all cursor-pointer">
                                       <input type="checkbox" className="size-5 rounded-lg border-slate-200 text-[#4b7bec] focus:ring-[#4b7bec]" />
                                       <span className="text-sm font-bold text-slate-700">{p}</span>
                                    </label>
                                 ))}
                              </div>
                           </div>
                        </TabsContent>
                     </div>
                  </Tabs>

                  <div className="sticky bottom-0 inset-x-0 p-4 sm:p-10 bg-white/95 backdrop-blur-md border-t border-slate-100 flex items-center justify-between shrink-0 z-20">
                     <div className="hidden md:flex items-center gap-6">
                        <div className="flex items-center gap-2 text-slate-300">
                           <CheckCircle2 className="size-4" />
                           <span className="text-[10px] font-black uppercase tracking-widest">Autosave in cloud</span>
                        </div>
                     </div>
                     <div className="flex items-center gap-4 w-full md:w-auto">
                        <Button type="button" variant="ghost" onClick={() => { setEditingProduct(null); setIsCreating(false); setForm({ ...EMPTY_FORM }); }} className="flex-1 md:flex-none h-14 rounded-2xl font-black uppercase tracking-[0.2em] text-[11px] text-slate-400 px-10 hover:bg-slate-50">Annuler</Button>
                        <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="flex-1 md:flex-none h-14 rounded-2xl px-14 bg-[#4b7bec] hover:bg-[#3867d6] text-white font-black uppercase tracking-[0.2em] text-[11px] shadow-2xl shadow-indigo-200 transition-all active:scale-[0.98]">
                           {createMutation.isPending || updateMutation.isPending ? <Loader2 className="size-5 animate-spin" /> : editingProduct ? 'VALIDER MODIFICATIONS ✓' : 'LANCER LA RÉFÉRENCE 🚀'}
                        </Button>
                     </div>
                  </div>
               </form>
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
                        { label: 'Commandes', value: d.orders, icon: ShoppingCart, color: '#4b7bec', bg: '#F0F5FF' },
                        { label: 'Confirmées', value: d.confirmed, icon: CheckCheck, color: '#20bf6b', bg: '#E6FFF8' },
                        { label: 'Livrées', value: d.delivered, icon: Truck, color: '#6c5ce7', bg: '#F0EEFF' },
                        { label: 'Retournées', value: d.returned, icon: RotateCcw, color: '#eb4d4b', bg: '#FFEDE9' },
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
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Entonnoir Commandes</p>
                              <div className="grid grid-cols-4 gap-3">
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
                              <div className="grid grid-cols-3 gap-3">
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
      </div>
   );

}
