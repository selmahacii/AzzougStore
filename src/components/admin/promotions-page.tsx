'use client';

import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
   Tag,
   Plus,
   Pencil,
   Power,
   PowerOff,
   Percent,
   DollarSign,
   Truck,
   CalendarDays,
   Search,
   Filter,
   RefreshCw,
   Loader2,
   Eye,
   CheckCircle2,
   AlertTriangle,
   Trash2,
   ChevronLeft,
   ChevronRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogFooter,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { apiFetch } from '@/lib/api-client';
import type { Promotion, PromotionType, ApiResponse, PaginatedResponse } from '@/lib/types';
import { PROMOTION_TYPE_LABELS } from '@/lib/types';

const C = {
   primary: '#6C5CE7', primaryBg: '#F0EDFF',
   success: '#00B894', successBg: '#E6FFF8',
   danger: '#E17055', dangerBg: '#FFEDE9',
   warning: '#FDCB6E', warningBg: '#FFF8E6',
   info: '#0984E3', infoBg: '#E8F4FE',
   text: '#2D3436', textLight: '#636E72', textDim: '#B2BEC3', border: '#E9ECF0', bg: '#F8F9FC',
};

function formatPromotionValue(type: PromotionType, value: number): string {
   if (type === 'PERCENTAGE') return `${value}%`;
   if (type === 'FIXED_AMOUNT') return formatPrice(value);
   return 'Gratuite';
}

function formatDate(dateStr: string | null): string {
   if (!dateStr) return '—';
   return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isPromotionExpired(promo: Promotion): boolean {
   if (!promo.ends_at) return false;
   return new Date(promo.ends_at) < new Date();
}

function TablePagination({ total, page, totalPages, onPageChange }: { 
   total: number; 
   page: number; 
   totalPages: number; 
   onPageChange: (p: number) => void; 
}) {
   return (
      <div className="px-5 py-3.5 border-t flex items-center justify-between" style={{ borderColor: C.border, backgroundColor: C.bg }}>
         <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-[#636E72]">Total {total}</span>
            <div className="flex items-center border rounded-lg overflow-hidden bg-white" style={{ borderColor: C.border }}>
               <button 
                  onClick={() => onPageChange(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="size-8 flex items-center justify-center hover:bg-[#F8F9FC] text-[#636E72] disabled:opacity-30"
               >
                  <ChevronLeft className="size-4" />
               </button>
               <div className="px-4 flex items-center justify-center border-l bg-white text-[11px] font-black text-[#2D3436] tracking-widest" style={{ borderColor: C.border }}>
                  {page} / {totalPages || 1}
               </div>
               <button 
                  onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="size-8 flex items-center justify-center hover:bg-[#F8F9FC] text-[#636E72] disabled:opacity-30 border-l" 
                  style={{ borderColor: C.border }}
               >
                  <ChevronRight className="size-4" />
               </button>
            </div>
         </div>
         <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-[#B2BEC3]">Paginated Mode</span>
         </div>
      </div>
   );
}

// ─── Form Dialog ─────────────────────────────────────────
interface PromoFormData {
   code: string; type: PromotionType; value: string; minOrderAmount: string;
   maxUses: string; startsAt: string; endsAt: string; description: string;
}

const defaultFormData: PromoFormData = {
   code: '', type: 'PERCENTAGE', value: '', minOrderAmount: '',
   maxUses: '', startsAt: '', endsAt: '', description: '',
};

function PromotionFormDialog({ open, onOpenChange, promotion }: { open: boolean; onOpenChange: (open: boolean) => void; promotion: Promotion | null; }) {
   const isEdit = promotion !== null;
   const [form, setForm] = useState<PromoFormData>(defaultFormData);
   const [errors, setErrors] = useState<Partial<Record<keyof PromoFormData, string>>>({});
   const queryClient = useQueryClient();
   const { activeStore } = useAppStore();

   const initialForm = useCallback((): PromoFormData => {
      if (isEdit && promotion) {
         return {
            code: promotion.code, type: promotion.type, value: String(promotion.value),
            minOrderAmount: promotion.min_order_amount ? String(promotion.min_order_amount) : '',
            maxUses: promotion.max_uses ? String(promotion.max_uses) : '',
            startsAt: promotion.starts_at ? promotion.starts_at.split('T')[0] : '',
            endsAt: promotion.ends_at ? promotion.ends_at.split('T')[0] : '',
            description: promotion.description ?? '',
         };
      }
      return defaultFormData;
   }, [isEdit, promotion]);

   React.useEffect(() => {
      if (open) {
         setForm(initialForm());
         setErrors({});
      }
   }, [open, initialForm]);

   const updateField = (field: keyof PromoFormData, value: string) => {
      setForm((prev) => {
         const updated = { ...prev, [field]: value };
         if (field === 'code') updated.code = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
         return updated;
      });
      setErrors((prev) => ({ ...prev, [field]: undefined }));
   };

   const validate = (): boolean => {
      const newErrors: Partial<Record<keyof PromoFormData, string>> = {};
      if (!form.code.trim() || form.code.trim().length < 3) newErrors.code = 'Min. 3 caractères';
      if (!form.value || Number(form.value) <= 0) newErrors.value = 'Requis et positive';
      if (form.type === 'PERCENTAGE' && Number(form.value) > 100) newErrors.value = 'Max 100%';
      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
   };

   const savePromo = useMutation({
      mutationFn: async (data: PromoFormData) => {
         const payload = {
            ...data,
            store_id: activeStore?.id,
            value: Number(data.value),
            min_order_amount: data.minOrderAmount ? Number(data.minOrderAmount) : 0,
            max_uses: data.maxUses ? Number(data.maxUses) : null,
            starts_at: data.startsAt ? new Date(data.startsAt).toISOString() : null,
            ends_at: data.endsAt ? new Date(data.endsAt).toISOString() : null,
         };

         if (isEdit && promotion) {
            return apiFetch(`/api/v1/promotions/${promotion.id}`, {
               method: 'PATCH',
               body: JSON.stringify(payload)
            });
         }
         return apiFetch('/api/v1/promotions', {
            method: 'POST',
            body: JSON.stringify(payload)
         });
      },
      onSuccess: () => {
         queryClient.invalidateQueries({ queryKey: ['promotions'] });
         toast.success(isEdit ? 'Promotion mise à jour' : 'Promotion créée');
         onOpenChange(false);
      },
      onError: (err: any) => {
         toast.error(err.message || 'Une erreur est survenue');
      }
   });

   const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (validate()) savePromo.mutate(form);
   };

   const isSubmitting = savePromo.isPending;

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent className="max-w-2xl w-[96vw] p-0 overflow-hidden border-none bg-white rounded-[40px] shadow-2xl">
            <div className="bg-[#6C5CE7] px-5 sm:px-8 py-7 sm:py-10 text-white relative overflow-hidden">
               <div className="absolute top-0 right-0 p-8 opacity-10">
                  <Tag className="size-32 rotate-12" />
               </div>
               <DialogTitle className="text-2xl font-black uppercase tracking-tighter relative z-10">
                  {isEdit ? 'Modifier Promotion' : 'Nouvelle Promotion'}
               </DialogTitle>
               <DialogDescription className="text-white/60 font-bold text-xs uppercase tracking-widest relative z-10">
                  Configurez vos règles de réduction
               </DialogDescription>
            </div>
            <form onSubmit={handleSubmit} className="p-4 sm:p-8 space-y-6">
               <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-[#636E72] uppercase tracking-widest">Code Coupon</label>
                  <Input 
                     placeholder="EX: WELCOME20" 
                     value={form.code} 
                     onChange={(e) => updateField('code', e.target.value)} 
                     className="h-12 border-[#E9ECF0] rounded-xl font-black text-lg placeholder:text-neutral-200 uppercase" 
                  />
                  {errors.code && <p className="text-[10px] font-bold text-red-500 uppercase">{errors.code}</p>}
               </div>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                     <label className="text-[11px] font-black text-[#636E72] uppercase tracking-widest">Type</label>
                     <Select value={form.type} onValueChange={(v: PromotionType) => updateField('type', v)}>
                        <SelectTrigger className="h-12 border-[#E9ECF0] rounded-xl font-bold">
                           <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                           {Object.entries(PROMOTION_TYPE_LABELS).map(([val, label]) => (
                              <SelectItem key={val} value={val} className="text-xs font-bold uppercase">{label}</SelectItem>
                           ))}
                        </SelectContent>
                     </Select>
                  </div>
                  <div className="space-y-1.5">
                     <label className="text-[11px] font-black text-[#636E72] uppercase tracking-widest">Valeur</label>
                     <div className="relative">
                        <Input 
                           type="number" 
                           placeholder="0" 
                           value={form.value} 
                           onChange={(e) => updateField('value', e.target.value)} 
                           className="h-12 border-[#E9ECF0] rounded-xl font-black text-lg pl-10" 
                        />
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400">
                           {form.type === 'PERCENTAGE' ? <Percent className="size-4" /> : <DollarSign className="size-4" />}
                        </div>
                     </div>
                  </div>
               </div>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                     <label className="text-[11px] font-black text-[#636E72] uppercase tracking-widest">Com. min (DZD)</label>
                     <Input type="number" value={form.minOrderAmount} onChange={(e) => updateField('minOrderAmount', e.target.value)} className="h-12 border-[#E9ECF0] rounded-xl font-bold" />
                  </div>
                  <div className="space-y-1.5">
                     <label className="text-[11px] font-black text-[#636E72] uppercase tracking-widest">Max Utilisations</label>
                     <Input type="number" placeholder="∞" value={form.maxUses} onChange={(e) => updateField('maxUses', e.target.value)} className="h-12 border-[#E9ECF0] rounded-xl font-bold" />
                  </div>
               </div>
               <DialogFooter className="pt-6 border-t border-neutral-50">
                  <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="text-[11px] font-black uppercase tracking-widest text-[#636E72]">Annuler</Button>
                  <Button type="submit" disabled={isSubmitting} className="h-12 px-8 text-[11px] font-black uppercase tracking-widest text-white rounded-xl shadow-xl shadow-[#6C5CE7]/20" style={{ backgroundColor: C.primary }}>
                     {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : 'Enregistrer la promo'}
                  </Button>
               </DialogFooter>
            </form>
         </DialogContent>
      </Dialog>
   );
}

// ─── Main Page ───────────────────────────────────────────
export default function PromotionsPage() {
   const { activeStore } = useAppStore();
   const storeId = activeStore?.id ?? '';
   const queryClient = useQueryClient();

   const [dialogOpen, setDialogOpen] = useState(false);
   const [editingPromo, setEditingPromo] = useState<Promotion | null>(null);
   const [page, setPage] = useState(1);

   const promotionsQuery = useQuery<PaginatedResponse<Promotion>>({
      queryKey: ['promotions', storeId, page],
      queryFn: () => apiFetch(`/api/v1/promotions?store_id=${storeId}&page=${page}&pageSize=15`),
      enabled: !!storeId,
   });

   const promotions = promotionsQuery.data?.data ?? [];
   const total = promotionsQuery.data?.total ?? 0;
   const totalPages = promotionsQuery.data?.totalPages ?? 1;

   const toggleActiveMutation = useMutation({
      mutationFn: async ({ id }: { id: string; is_active: boolean }) => {
         return apiFetch(`/api/v1/promotions/${id}/toggle`, { method: 'PATCH' });
      },
      onSuccess: () => { 
         queryClient.invalidateQueries({ queryKey: ['promotions'] });
         toast.success('Statut mis à jour');
      },
   });

   const handleCreate = () => { setEditingPromo(null); setDialogOpen(true); };
   const handleEdit = (promo: Promotion) => { setEditingPromo(promo); setDialogOpen(true); };

   const getTypeIcon = (type: PromotionType) => {
      if (type === 'PERCENTAGE') return <Percent className="size-3.5" />;
      if (type === 'FIXED_AMOUNT') return <DollarSign className="size-3.5" />;
      return <Truck className="size-3.5" />;
   };

   return (
      <div className="space-y-5 pb-28 animate-in fade-in duration-500">
         {/* ─── Header ─── */}
         <div className="bg-white rounded-xl border px-4 sm:px-6 py-4 sm:py-5 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:justify-between" style={{ borderColor: C.border }}>
            <div className="flex items-center gap-3">
               <div className="size-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: C.primaryBg }}>
                  <Tag className="size-4" style={{ color: C.primary }} />
               </div>
               <h1 className="text-sm font-extrabold uppercase tracking-wider text-[#2D3436]">Promotions</h1>
            </div>
            <button onClick={handleCreate} className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-white shadow-sm hover:opacity-90 transition-opacity w-full sm:w-auto justify-center" style={{ backgroundColor: C.primary }}>
               <Plus className="size-3.5" /> Nouvelle promotion
            </button>
         </div>

         {/* ─── Search & Actions ─── */}
         <div className="bg-white rounded-xl border px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:justify-between" style={{ borderColor: C.border }}>
            <div className="relative flex-1">
               <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#B2BEC3]" />
               <Input placeholder="Rechercher un code..." className="pl-10 h-10 bg-[#F8F9FC] border-[#E9ECF0] rounded-lg text-sm w-full" />
            </div>
            <button className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border" style={{ borderColor: C.border, color: C.textLight }}>
               <RefreshCw className="size-3.5" /> Rafraîchir
            </button>
         </div>

         {/* ─── Data Table ─── */}
         <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: C.border }}>
            <div className="overflow-x-auto">
               <table className="w-full text-left">
                  <thead>
                     <tr className="border-b" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                        <th className="px-6 py-3.5 text-xs font-bold text-[#636E72] whitespace-nowrap">Code Promo</th>
                        <th className="px-6 py-3.5 text-xs font-bold text-[#636E72] whitespace-nowrap">Type / Valeur</th>
                        <th className="px-6 py-3.5 text-xs font-bold text-[#636E72] whitespace-nowrap">Période</th>
                        <th className="px-6 py-3.5 text-xs font-bold text-[#636E72] whitespace-nowrap">Conditions</th>
                        <th className="px-6 py-3.5 text-xs font-bold text-[#636E72] whitespace-nowrap">Utilisations</th>
                        <th className="px-6 py-3.5 text-xs font-bold text-[#636E72] text-center whitespace-nowrap">Statut</th>
                        <th className="px-6 py-3.5 text-xs font-bold text-[#636E72] text-right whitespace-nowrap">Action</th>
                     </tr>
                  </thead>
                  <tbody>
                     {promotionsQuery.isLoading ? (
                        <tr><td colSpan={7} className="px-6 py-16 text-center text-sm font-semibold text-[#B2BEC3]"><Loader2 className="mx-auto size-6 animate-spin text-[#B2BEC3] mb-2" />Chargement...</td></tr>
                     ) : promotions.length === 0 ? (
                        <tr><td colSpan={7} className="px-6 py-16 text-center"><Tag className="mx-auto size-8 text-[#E9ECF0] mb-3" /><p className="text-sm font-semibold text-[#B2BEC3]">Aucune promotion active</p></td></tr>
                     ) : (
                        promotions.map((promo) => {
                           const expired = isPromotionExpired(promo);
                           const fullyUsed = promo.max_uses !== null && promo.used_count >= promo.max_uses;
                           return (
                              <tr key={promo.id} className="border-b last:border-0 hover:bg-[#FAFBFD] transition-colors" style={{ borderColor: C.border }}>
                                 <td className="px-6 py-4">
                                    <div className="px-3 py-1.5 rounded-md inline-flex items-center border font-mono text-sm font-bold tracking-widest text-[#2D3436]" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                                       {promo.code}
                                    </div>
                                 </td>
                                 <td className="px-6 py-4">
                                    <div className="flex flex-col gap-1">
                                       <span className="text-sm font-extrabold" style={{ color: C.primary }}>{formatPromotionValue(promo.type, promo.value)}</span>
                                       <span className="text-[10px] font-bold text-[#B2BEC3] flex items-center gap-1 uppercase tracking-widest">
                                          {getTypeIcon(promo.type)} {PROMOTION_TYPE_LABELS[promo.type]}
                                       </span>
                                    </div>
                                 </td>
                                 <td className="px-6 py-4">
                                    <div className="flex flex-col gap-1">
                                       <span className="text-xs font-semibold text-[#636E72]">{formatDate(promo.starts_at)}</span>
                                       <span className="text-xs font-semibold text-[#636E72]">{formatDate(promo.ends_at)}</span>
                                    </div>
                                 </td>
                                 <td className="px-6 py-4">
                                    <span className="text-xs font-semibold text-[#B2BEC3]">
                                       {promo.min_order_amount > 0 ? `Min: ${formatPrice(promo.min_order_amount)}` : 'Aucune min.'}
                                    </span>
                                 </td>
                                 <td className="px-6 py-4">
                                    <div className="flex flex-col gap-1.5 w-24">
                                       <span className="text-xs font-bold text-[#2D3436]">{promo.used_count} <span className="text-[#B2BEC3]">/ {promo.max_uses || '∞'}</span></span>
                                       {promo.max_uses && (
                                          <div className="h-1.5 w-full rounded-full bg-[#E9ECF0] overflow-hidden">
                                             <div className="h-full rounded-full transition-all" style={{ width: `${Math.min((promo.used_count / promo.max_uses) * 100, 100)}%`, backgroundColor: fullyUsed ? C.danger : C.success }} />
                                          </div>
                                       )}
                                    </div>
                                 </td>
                                 <td className="px-6 py-4 text-center">
                                    <div className="flex items-center justify-center">
                                       <div className={cn("px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                                          !promo.is_active ? "bg-neutral-100 text-neutral-500" :
                                             expired ? "bg-amber-100 text-amber-700" :
                                                fullyUsed ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"
                                       )}>
                                          {!promo.is_active ? 'Désactivé' : expired ? 'Expiré' : fullyUsed ? 'Épuisé' : 'Actif'}
                                       </div>
                                    </div>
                                 </td>
                                 <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                       <button onClick={() => toggleActiveMutation.mutate({ id: promo.id, is_active: !promo.is_active })} className="size-8 rounded-lg inline-flex items-center justify-center hover:bg-[#F8F9FC] text-[#B2BEC3] transition-colors">
                                          {promo.is_active ? <PowerOff className="size-4" /> : <Power className="size-4 text-[#00B894]" />}
                                       </button>
                                       <button onClick={() => handleEdit(promo)} className="size-8 rounded-lg inline-flex items-center justify-center hover:bg-[#F0EDFF] text-[#B2BEC3] hover:text-[#6C5CE7] transition-colors">
                                          <Pencil className="size-4" />
                                       </button>
                                    </div>
                                 </td>
                              </tr>
                           );
                        })
                     )}
                  </tbody>
               </table>
            </div>
            <TablePagination 
               total={total} 
               page={page} 
               totalPages={totalPages} 
               onPageChange={setPage} 
            />
         </div>

         <PromotionFormDialog open={dialogOpen} onOpenChange={setDialogOpen} promotion={editingPromo} />
      </div>
   );
}
