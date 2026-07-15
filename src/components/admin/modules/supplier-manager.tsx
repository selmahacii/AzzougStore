'use client';

import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  Edit, 
  Trash2, 
  Phone, 
  Wallet,
  Activity,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  Mail,
  MapPin,
  Building2,
  TrendingUp,
  ExternalLink,
  ShieldCheck,
  CreditCard,
  Briefcase,
  Loader2,
  UserCircle2,
  X,
  PlusCircle,
  Banknote,
  Receipt,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { formatPrice } from '@/lib/format';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';

const C = {
   primary: '#6C5CE7',
   primaryBg: '#F0EDFF',
   success: '#00B894',
   successBg: '#E6FFF8',
   danger: '#E17055',
   dangerBg: '#FFEDE9',
   warning: '#FDCB6E',
   warningBg: '#FFF8E6',
   info: '#0984E3',
   infoBg: '#E8F4FE',
   text: '#2D3436',
   textLight: '#636E72',
   textDim: '#B2BEC3',
   border: '#E9ECF0',
   bg: '#F8F9FC',
};

// ─── Purchase history modal ────────────────────────────────────
function SupplierHistoryModal({ supplier, storeId, open, onClose }: {
  supplier: any; storeId: string; open: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [newEntry, setNewEntry] = useState({
    product_name: '', quantity: '', unit_cost: '', total_cost: '', purchase_date: new Date().toISOString().slice(0, 10), notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEntry, setEditEntry] = useState<any>({});

  const historyQuery = useQuery({
    queryKey: ['supplier-purchases', supplier?.id],
    queryFn: () => apiFetch<any>(`/api/v1/suppliers/${supplier.id}/purchases`),
    enabled: !!supplier?.id && open,
  });

  const entries: any[] = historyQuery.data?.data ?? historyQuery.data ?? [];

  const handleAdd = async () => {
    if (!newEntry.product_name.trim() || !newEntry.unit_cost) { toast.error('Produit et coût unitaire requis'); return; }
    setSaving(true);
    try {
      const qty = parseFloat(newEntry.quantity || '1');
      const unit = parseFloat(newEntry.unit_cost || '0');
      const total = newEntry.total_cost ? parseFloat(newEntry.total_cost) : qty * unit;
      await apiFetch(`/api/v1/suppliers/${supplier.id}/purchases`, {
        method: 'POST',
        body: JSON.stringify({
          product_name: newEntry.product_name.trim(),
          quantity: qty,
          unit_cost: unit,
          total_cost: total,
          purchase_date: newEntry.purchase_date,
          notes: newEntry.notes.trim(),
          store_id: storeId,
        }),
      });
      toast.success('Achat enregistré');
      setNewEntry({ product_name: '', quantity: '', unit_cost: '', total_cost: '', purchase_date: new Date().toISOString().slice(0, 10), notes: '' });
      qc.invalidateQueries({ queryKey: ['supplier-purchases', supplier.id] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
    } catch (e: any) { toast.error(e?.message || 'Erreur'); }
    finally { setSaving(false); }
  };

  const handleUpdate = async (id: string) => {
    try {
      await apiFetch(`/api/v1/suppliers/${supplier.id}/purchases/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(editEntry),
      });
      toast.success('Achat mis à jour');
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['supplier-purchases', supplier.id] });
    } catch (e: any) { toast.error(e?.message || 'Erreur'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cet achat ?')) return;
    try {
      await apiFetch(`/api/v1/suppliers/${supplier.id}/purchases/${id}`, { method: 'DELETE' });
      toast.success('Supprimé');
      qc.invalidateQueries({ queryKey: ['supplier-purchases', supplier.id] });
    } catch (e: any) { toast.error(e?.message || 'Erreur'); }
  };

  const totalSpent = entries.reduce((s: number, e: any) => s + (Number(e.total_cost) || 0), 0);
  const totalUnits = entries.reduce((s: number, e: any) => s + (Number(e.quantity) || 0), 0);

  if (!supplier) return null;

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl p-0 rounded-[32px] overflow-hidden border-0 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="bg-[#2D3436] px-8 py-6 text-white shrink-0">
          <div className="flex items-center gap-4 justify-between">
            <div className="flex items-center gap-4">
              <div className="size-12 rounded-2xl bg-[#6C5CE7] flex items-center justify-center"><Receipt className="size-6 text-white" /></div>
              <div>
                <DialogTitle className="text-lg font-black uppercase tracking-tight">{supplier.name}</DialogTitle>
                <DialogDescription className="text-white/40 text-[10px] font-bold uppercase tracking-widest mt-0.5">Historique des achats & transactions</DialogDescription>
              </div>
            </div>
            <div className="flex items-center gap-4 text-right">
              <div>
                <p className="text-[9px] font-black text-white/40 uppercase tracking-widest">Total dépensé</p>
                <p className="text-lg font-black text-white">{formatPrice(totalSpent)} DA</p>
              </div>
              <div>
                <p className="text-[9px] font-black text-white/40 uppercase tracking-widest">Unités achetées</p>
                <p className="text-lg font-black text-white">{totalUnits}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-7 space-y-6 bg-[#F8FAFC]">
          {/* New entry form */}
          <div className="bg-white rounded-3xl border border-slate-100 p-6 space-y-4">
            <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest flex items-center gap-2"><PlusCircle className="size-3.5 text-[#6C5CE7]" /> Nouvel achat</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Produit / Article *</label>
                <Input value={newEntry.product_name} onChange={e => setNewEntry(p => ({ ...p, product_name: e.target.value }))}
                  placeholder="Ex: Tissu coton premium, Fil noir..." className="h-11 rounded-xl border-slate-100 bg-slate-50 font-bold text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Date</label>
                <Input type="date" value={newEntry.purchase_date} onChange={e => setNewEntry(p => ({ ...p, purchase_date: e.target.value }))}
                  className="h-11 rounded-xl border-slate-100 bg-slate-50 font-bold" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Qté / Unités</label>
                <Input type="number" value={newEntry.quantity} onChange={e => {
                  const q = e.target.value; const u = parseFloat(newEntry.unit_cost || '0');
                  setNewEntry(p => ({ ...p, quantity: q, total_cost: q && u ? String(parseFloat(q) * u) : p.total_cost }));
                }} placeholder="1" className="h-11 rounded-xl border-slate-100 bg-slate-50 font-black" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Coût unitaire (DA) *</label>
                <Input type="number" value={newEntry.unit_cost} onChange={e => {
                  const u = e.target.value; const q = parseFloat(newEntry.quantity || '1');
                  setNewEntry(p => ({ ...p, unit_cost: u, total_cost: u && q ? String(q * parseFloat(u)) : p.total_cost }));
                }} placeholder="0" className="h-11 rounded-xl border-slate-100 bg-slate-50 font-black text-[#6C5CE7]" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Total (DA)</label>
                <Input type="number" value={newEntry.total_cost} onChange={e => setNewEntry(p => ({ ...p, total_cost: e.target.value }))}
                  placeholder="Auto-calculé" className="h-11 rounded-xl border-slate-100 bg-emerald-50 font-black text-emerald-700" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Notes (optionnel)</label>
              <Input value={newEntry.notes} onChange={e => setNewEntry(p => ({ ...p, notes: e.target.value }))}
                placeholder="Ex: lot janvier 2026, qualité A, facture N°..." className="h-11 rounded-xl border-slate-100 bg-slate-50 font-medium" />
            </div>
            <button onClick={handleAdd} disabled={saving}
              className="w-full h-12 rounded-2xl bg-[#6C5CE7] hover:bg-[#5849D1] text-white font-black text-[11px] uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <><PlusCircle className="size-4" /> Enregistrer l'achat</>}
            </button>
          </div>

          {/* History list */}
          <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest">Historique ({entries.length} entrées)</h4>
              {historyQuery.isFetching && <Loader2 className="size-3.5 animate-spin text-slate-300" />}
            </div>
            {entries.length === 0 ? (
              <div className="py-12 text-center text-slate-300">
                <Receipt className="size-8 mx-auto mb-2" />
                <p className="text-xs font-bold uppercase">Aucun achat enregistré</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {entries.map((entry: any) => (
                  <div key={entry.id} className="px-6 py-4 hover:bg-slate-50/50 transition-colors">
                    {editingId === entry.id ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <Input value={editEntry.product_name ?? ''} onChange={e => setEditEntry((p: any) => ({ ...p, product_name: e.target.value }))} placeholder="Produit" className="h-9 rounded-xl border-slate-100 text-xs font-bold col-span-2" />
                          <Input type="number" value={editEntry.quantity ?? ''} onChange={e => setEditEntry((p: any) => ({ ...p, quantity: e.target.value }))} placeholder="Qté" className="h-9 rounded-xl border-slate-100 text-xs font-black" />
                          <Input type="number" value={editEntry.unit_cost ?? ''} onChange={e => setEditEntry((p: any) => ({ ...p, unit_cost: e.target.value }))} placeholder="PU DA" className="h-9 rounded-xl border-slate-100 text-xs font-black text-[#6C5CE7]" />
                        </div>
                        <Input value={editEntry.notes ?? ''} onChange={e => setEditEntry((p: any) => ({ ...p, notes: e.target.value }))} placeholder="Notes" className="h-9 rounded-xl border-slate-100 text-xs" />
                        <div className="flex gap-2">
                          <button onClick={() => handleUpdate(entry.id)} className="h-8 px-4 rounded-xl bg-[#6C5CE7] text-white font-black text-[10px] uppercase">Sauvegarder</button>
                          <button onClick={() => setEditingId(null)} className="h-8 px-4 rounded-xl bg-slate-100 text-slate-500 font-black text-[10px] uppercase">Annuler</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 flex-wrap">
                            <p className="text-sm font-black text-slate-800 truncate">{entry.product_name}</p>
                            <span className="text-[9px] font-bold text-slate-400 font-mono">{entry.purchase_date?.slice(0, 10)}</span>
                          </div>
                          {entry.notes && <p className="text-[10px] text-slate-400 mt-0.5 italic">{entry.notes}</p>}
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <div className="text-right">
                            <p className="text-xs font-black text-[#6C5CE7]">{Number(entry.unit_cost).toLocaleString()} DA/u</p>
                            <p className="text-[10px] text-slate-400">{entry.quantity} unités</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black text-slate-900">{Number(entry.total_cost).toLocaleString()} DA</p>
                            <p className="text-[9px] text-slate-400 uppercase tracking-wider">total</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => { setEditingId(entry.id); setEditEntry({ ...entry }); }}
                              className="size-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 hover:text-[#6C5CE7] hover:bg-indigo-50 transition-all">
                              <Edit className="size-3.5" />
                            </button>
                            <button onClick={() => handleDelete(entry.id)}
                              className="size-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all">
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SupplierManager() {
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<any | null>(null);
  const [historySupplier, setHistorySupplier] = useState<any | null>(null);
  const [fees, setFees] = useState([{ id: Date.now(), label: '', amount: '', fee_type: 'fixed', is_recurring: false }]);
  const [customFields, setCustomFields] = useState<Array<{ id: number; key: string; value: string }>>([]);
  const [extraCharges, setExtraCharges] = useState<Array<{ id: number; label: string; amount: string }>>([]);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    tax_id: '',
    bank_account: '',
    supply_category: '',
    note: '',
    payment_terms_days: '30',
    min_order_qty: '',
    min_order_amount: '',
    lead_time_days: '7',
    currency: 'DZD',
    credit_limit: '',
    discount_rate: '',
    return_policy: '',
    delivery_method: 'standard',
    // Phase 2 Details
    reliability_score: '100',
    purchase_price: '',
    margin_percent: '',
  });

  const activeStore = useAppStore((s) => s.activeStore);
  const queryClient = useQueryClient();

  // --- Data Fetching ---
  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', activeStore?.id, search],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(
      `/api/v1/suppliers?store_id=${activeStore?.id}&search=${search}`
    ),
    enabled: !!activeStore?.id,
  });

  const suppliers = data?.data || [];

  // --- Mutations ---
  const mutation = useMutation({
    mutationFn: (payload: any) => {
        const url = editingSupplier ? `/api/v1/suppliers/${editingSupplier.id}` : '/api/v1/suppliers';
        const method = editingSupplier ? 'PATCH' : 'POST';
        return apiFetch(url, {
           method,
           body: JSON.stringify({ ...payload, store_id: activeStore?.id })
        });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(editingSupplier ? 'Partenaire mis à jour' : 'Partenaire enregistré avec succès');
      closeModal();
    },
    onError: (err: any) => {
      toast.error('Erreur lors de l\'enregistrement', { description: err.message });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/suppliers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Partenaire supprimé');
    }
  });

  // --- Functions ---
  const openEdit = (supplier: any) => {
    setEditingSupplier(supplier);
    setFormData({
       name: supplier.name,
       phone: supplier.phone || '',
       email: supplier.email || '',
       address: supplier.address || '',
       city: supplier.city || '',
       tax_id: supplier.tax_id || '',
       bank_account: supplier.bank_account || '',
       supply_category: supplier.supply_category || '',
       note: supplier.note || '',
       payment_terms_days: String(supplier.payment_terms_days ?? '30'),
       min_order_qty: supplier.min_order_qty !== null && supplier.min_order_qty !== undefined ? String(supplier.min_order_qty) : '',
       min_order_amount: supplier.min_order_amount !== null && supplier.min_order_amount !== undefined ? String(supplier.min_order_amount) : '',
       lead_time_days: String(supplier.lead_time_days ?? '7'),
       currency: supplier.currency || 'DZD',
       credit_limit: supplier.credit_limit !== null && supplier.credit_limit !== undefined ? String(supplier.credit_limit) : '',
       discount_rate: supplier.discount_rate !== null && supplier.discount_rate !== undefined ? String(supplier.discount_rate) : '',
       return_policy: supplier.return_policy || '',
       delivery_method: supplier.delivery_method || 'standard',
       // Phase 2
       reliability_score: String(supplier.reliability_score ?? '100'),
       purchase_price: supplier.purchase_price !== null && supplier.purchase_price !== undefined ? String(supplier.purchase_price) : '',
       margin_percent: supplier.margin_percent !== null && supplier.margin_percent !== undefined ? String(supplier.margin_percent) : '',
    });

    const loadedFees = supplier.fees && supplier.fees.length > 0
       ? supplier.fees.map((f: any, idx: number) => ({ id: idx, label: f.label || '', amount: String(f.amount || ''), fee_type: f.fee_type || 'fixed', is_recurring: !!f.is_recurring }))
       : [{ id: Date.now(), label: '', amount: '', fee_type: 'fixed', is_recurring: false }];
    setFees(loadedFees);

    const cf = supplier.custom_fields || {};
    const parsedCf = Object.entries(cf).map(([k, v], idx) => ({ id: idx, key: k, value: String(v) }));
    setCustomFields(parsedCf.length > 0 ? parsedCf : []);

    const ec = supplier.extra_charges || [];
    const parsedEc = ec.map((x: any, idx: number) => ({ id: idx, label: x.label || '', amount: String(x.amount || '') }));
    setExtraCharges(parsedEc.length > 0 ? parsedEc : []);

    setIsCreating(true);
  };

  const closeModal = () => {
    setIsCreating(false);
    setEditingSupplier(null);
    setFormData({ 
      name: '', phone: '', email: '', address: '', city: '', tax_id: '', bank_account: '', supply_category: '', note: '', 
      payment_terms_days: '30', min_order_qty: '', min_order_amount: '', lead_time_days: '7', currency: 'DZD', 
      credit_limit: '', discount_rate: '', return_policy: '', delivery_method: 'standard',
      reliability_score: '100', purchase_price: '', margin_percent: ''
    });
    setFees([{ id: Date.now(), label: '', amount: '', fee_type: 'fixed', is_recurring: false }]);
    setCustomFields([]);
    setExtraCharges([]);
  };

  const addFee = () => setFees([...fees, { id: Date.now(), label: '', amount: '', fee_type: 'fixed', is_recurring: false }]);
  const removeFee = (id: number) => setFees(fees.filter(f => f.id !== id));
  const updateFee = (id: number, field: string, value: any) => {
    setFees(fees.map(f => f.id === id ? { ...f, [field]: value } : f));
  };

  const addCustomField = () => setCustomFields([...customFields, { id: Date.now(), key: '', value: '' }]);
  const removeCustomField = (id: number) => setCustomFields(customFields.filter(f => f.id !== id));
  const updateCustomField = (id: number, field: 'key' | 'value', value: string) => {
     setCustomFields(customFields.map(f => f.id === id ? { ...f, [field]: value } : f));
  };

  const addExtraCharge = () => setExtraCharges([...extraCharges, { id: Date.now(), label: '', amount: '' }]);
  const removeExtraCharge = (id: number) => setExtraCharges(extraCharges.filter(x => x.id !== id));
  const updateExtraCharge = (id: number, field: 'label' | 'amount', value: string) => {
     setExtraCharges(extraCharges.map(x => x.id === id ? { ...x, [field]: value } : x));
  };

  const totalFees = fees.filter(f => f.amount && f.fee_type === 'fixed').reduce((s, f) => s + parseFloat(f.amount || '0'), 0);

  const handleSubmit = () => {
    if (!formData.name) return toast.error('Le nom est requis');
    
    // Structure fees info for the note if backend doesn't have specific fields
    const feesFormatted = fees.filter(f => f.label && f.amount)
      .map(f => `[Frais] ${f.label}: ${f.amount} DA`)
      .join('\n');

    const parsedFees = fees.filter(f => f.label && f.amount).map(f => ({
      label: f.label,
      amount: parseFloat(f.amount) || 0,
      fee_type: f.fee_type,
      is_recurring: f.is_recurring
    }));

    const customFieldsObj: Record<string, string> = {};
    customFields.forEach(cf => {
       if (cf.key.trim()) {
          customFieldsObj[cf.key.trim()] = cf.value.trim();
       }
    });

    const parsedExtraCharges = extraCharges.filter(x => x.label.trim() && x.amount).map(x => ({
       label: x.label.trim(),
       amount: parseFloat(x.amount) || 0
    }));
    
    const payload = { 
        ...formData, 
        payment_terms_days: formData.payment_terms_days ? parseInt(formData.payment_terms_days, 10) : 30,
        lead_time_days: formData.lead_time_days ? parseInt(formData.lead_time_days, 10) : 7,
        min_order_qty: formData.min_order_qty ? parseInt(formData.min_order_qty, 10) : null,
        min_order_amount: formData.min_order_amount ? parseInt(formData.min_order_amount, 10) : null,
        credit_limit: formData.credit_limit ? parseInt(formData.credit_limit, 10) : null,
        discount_rate: formData.discount_rate ? parseFloat(formData.discount_rate) : 0.0,
        note: formData.note ? `${formData.note}\n\nStatut Frais:\n${feesFormatted}` : feesFormatted,
        fees: parsedFees,
        reliability_score: formData.reliability_score ? parseFloat(formData.reliability_score) : 100.0,
        purchase_price: formData.purchase_price ? parseInt(formData.purchase_price, 10) : null,
        margin_percent: formData.margin_percent ? parseFloat(formData.margin_percent) : null,
        custom_fields: customFieldsObj,
        extra_charges: parsedExtraCharges,
    };
    
    mutation.mutate(payload);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      
      {/* ─── Search & Global Stats ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
         <div className="lg:col-span-3 bg-white rounded-[24px] sm:rounded-[32px] border p-3 sm:p-4 flex items-center shadow-sm" style={{ borderColor: C.border }}>
            <div className="relative flex-1 group">
               <Search className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 size-4 sm:size-5 text-slate-300 group-focus-within:text-[#6C5CE7] transition-colors" />
               <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher..."
                  className="h-12 sm:h-14 bg-slate-50 border-none rounded-[20px] sm:rounded-[24px] pl-10 sm:pl-14 text-sm font-black placeholder:text-slate-300 focus-visible:ring-2 focus-visible:ring-[#6C5CE7]/20"
               />
            </div>
            <Button onClick={() => setIsCreating(true)} className="ml-3 sm:ml-4 h-10 sm:h-14 px-4 sm:px-8 rounded-xl sm:rounded-2xl bg-[#6C5CE7] hover:bg-[#5849D1] text-white text-[10px] sm:text-[11px] font-black uppercase tracking-widest shadow-2xl shadow-indigo-100 transition-all border-none">
               <UserPlus className="size-4 sm:mr-3 sm:size-5" /> <span className="hidden sm:inline">Nouveau Partenaire</span>
            </Button>
         </div>
         <div className="bg-[#2D3436] rounded-[32px] px-8 py-6 flex items-center justify-between shadow-xl">
            <div>
               <p className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1">Actifs Sourcing</p>
               <p className="text-3xl font-black text-white leading-none">{suppliers.length}</p>
            </div>
            <div className="size-14 rounded-2xl bg-white/10 flex items-center justify-center text-[#6C5CE7]">
               <Building2 className="size-8" />
            </div>
         </div>
      </div>

      {/* ─── Supplier Cards Grid ─── */}
      {isLoading ? (
         <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-72 rounded-[40px]" />)}
         </div>
      ) : suppliers.length === 0 ? (
         <div className="bg-white rounded-[40px] border p-32 text-center" style={{ borderColor: C.border }}>
            <Building2 className="size-20 mx-auto mb-6 text-slate-100" />
            <p className="text-sm font-black text-slate-400 uppercase tracking-[0.2em]">Aucun partenaire référencé</p>
         </div>
      ) : (
         <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
            {suppliers.map((s) => (
               <div key={s.id} className="bg-white rounded-[40px] border p-8 shadow-sm hover:shadow-xl hover:shadow-indigo-50/50 transition-all group relative overflow-hidden" style={{ borderColor: C.border }}>
                  <div className="absolute top-0 right-0 p-8 opacity-0 group-hover:opacity-100 transition-opacity">
                     <div className="flex gap-2">
                        <button onClick={() => openEdit(s)} className="size-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 hover:text-[#6C5CE7] hover:bg-white border hover:border-slate-100 transition-all shadow-sm">
                           <Edit className="size-5" />
                        </button>
                        <button onClick={() => { if(confirm('Supprimer ce partenaire ?')) deleteMutation.mutate(s.id); }} className="size-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-white border hover:border-slate-100 transition-all shadow-sm">
                           <Trash2 className="size-5" />
                        </button>
                     </div>
                  </div>

                  <div className="flex items-start gap-6">
                     <div className="size-16 bg-[#F0EDFF] rounded-[24px] flex items-center justify-center text-[#6C5CE7] shrink-0 shadow-inner">
                        <Building2 className="size-8" />
                     </div>
                     <div className="min-w-0 pr-12">
                        <h3 className="text-lg font-black text-[#2D3436] truncate leading-tight">{s.name}</h3>
                        <p className="text-[10px] font-black text-[#6C5CE7] uppercase tracking-widest mt-1.5">{s.supply_category || 'Sourcing Général'}</p>
                        <div className="flex items-center gap-3 mt-4">
                           <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5"><Phone className="size-3" /> {s.phone || 'N/A'}</span>
                           <span className="h-1 w-1 rounded-full bg-slate-200" />
                           <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5"><MapPin className="size-3" /> {s.city || 'Alger'}</span>
                        </div>
                     </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-8 pt-8 border-t border-slate-50">
                     <div className="bg-slate-50/50 rounded-2xl p-4">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Dû Total</p>
                        <p className="text-base font-black text-slate-900">{formatPrice(s.total_due || 0)}</p>
                     </div>
                     <div className="bg-emerald-50/30 rounded-2xl p-4">
                        <p className="text-[9px] font-black text-[#00B894] uppercase tracking-widest mb-1.5">Réglé</p>
                        <p className="text-base font-black text-[#00B894]">{formatPrice(s.total_paid || 0)}</p>
                     </div>
                  </div>

                  <div className="mt-6 flex items-center justify-between">
                     <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                           <ShieldCheck className="size-3.5 text-[#00B894]" />
                           <span className="text-[10px] font-black text-slate-800 uppercase tracking-tighter">Indice Fiabilité {s.reliability_score || 100}%</span>
                        </div>
                        <div className="w-28 h-1.5 bg-slate-50 rounded-full mt-2 overflow-hidden border border-slate-100">
                           <div className="h-full bg-gradient-to-r from-[#00B894] to-[#00cec9]" style={{ width: `${s.reliability_score || 100}%` }} />
                        </div>
                     </div>
                     <button onClick={() => setHistorySupplier(s)} className="flex items-center gap-2 text-[10px] font-black text-[#6C5CE7] uppercase tracking-widest hover:translate-x-1 transition-transform">
                        Historique Achats <ChevronRight className="size-3" />
                     </button>
                  </div>
               </div>
            ))}
         </div>
      )}

      {/* ─── Purchase History Modal ─── */}
      <SupplierHistoryModal
        supplier={historySupplier}
        storeId={activeStore?.id ?? ''}
        open={!!historySupplier}
        onClose={() => setHistorySupplier(null)}
      />

      {/* ─── Advanced Supplier Modal ─── */}
      <Dialog open={isCreating} onOpenChange={(o) => { if(!o) closeModal(); }}>
         <DialogContent className="max-w-3xl p-0 border-none bg-white rounded-[24px] sm:rounded-[40px] overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">

            <div className="bg-[#2D3436] p-4 sm:p-10 text-white shrink-0">
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 sm:gap-6">
                     <div className="size-11 sm:size-16 bg-[#6C5CE7] rounded-2xl sm:rounded-3xl flex items-center justify-center shadow-2xl shadow-indigo-500/20 shrink-0">
                        {editingSupplier ? <Edit className="size-5 sm:size-8 text-white" /> : <Plus className="size-5 sm:size-8 text-white" />}
                     </div>
                     <div>
                        <DialogTitle className="text-lg sm:text-2xl font-black uppercase tracking-tight leading-none">
                           {editingSupplier ? 'Édition Dossier' : 'Référencement Partenaire'}
                        </DialogTitle>
                        <DialogDescription className="text-white/40 text-[10px] font-black uppercase tracking-widest mt-1 sm:mt-2 hidden sm:block">
                           Gestion des flux d'approvisionnement et paiements
                        </DialogDescription>
                     </div>
                  </div>
                  <button onClick={closeModal} className="p-2 sm:p-3 rounded-xl sm:rounded-2xl hover:bg-white/10 transition-all shrink-0">
                     <X className="size-5 sm:size-6 text-white/50" />
                  </button>
               </div>
            </div>
            
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="flex-1 overflow-hidden flex flex-col min-h-0">
               <Tabs defaultValue="identity" className="flex-1 flex flex-col min-h-0">
                  <div className="px-3 sm:px-10 border-b bg-slate-50/50 overflow-x-auto">
                     <TabsList className="h-14 sm:h-16 bg-transparent gap-3 sm:gap-8 border-0 flex-nowrap w-max min-w-full">
                        <TabsTrigger value="identity" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#6C5CE7] rounded-none px-0 text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436] whitespace-nowrap">
                           <UserCircle2 className="size-3.5 sm:size-4 mr-1.5 sm:mr-2" /> Identification
                        </TabsTrigger>
                        <TabsTrigger value="banking" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#6C5CE7] rounded-none px-0 text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436] whitespace-nowrap">
                           <Banknote className="size-3.5 sm:size-4 mr-1.5 sm:mr-2" /> Banque & Fiscalité
                        </TabsTrigger>
                        <TabsTrigger value="conditions" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#6C5CE7] rounded-none px-0 text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436] whitespace-nowrap">
                           <Briefcase className="size-3.5 sm:size-4 mr-1.5 sm:mr-2" /> Conditions
                        </TabsTrigger>
                        <TabsTrigger value="fees" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#6C5CE7] rounded-none px-0 text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436] whitespace-nowrap">
                           <Receipt className="size-3.5 sm:size-4 mr-1.5 sm:mr-2" /> Structure Frais
                        </TabsTrigger>
                        <TabsTrigger value="performance" className="h-full data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-4 data-[state=active]:border-[#6C5CE7] rounded-none px-0 text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-slate-400 data-[state=active]:text-[#2D3436] whitespace-nowrap">
                           <Activity className="size-3.5 sm:size-4 mr-1.5 sm:mr-2" /> Performance & Champs
                        </TabsTrigger>
                     </TabsList>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 sm:p-10 custom-scrollbar pb-32">
                     <TabsContent value="identity" className="mt-0 space-y-6 sm:space-y-8">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-8">
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Nom / Enseigne Commerciale *</label>
                              <Input 
                                 value={formData.name}
                                 onChange={(e) => setFormData({...formData, name: e.target.value})}
                                 placeholder="Nom du fournisseur" 
                                 className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black transition-all" 
                              />
                           </div>
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Catégorie de fourniture</label>
                              <Input 
                                 value={formData.supply_category}
                                 onChange={(e) => setFormData({...formData, supply_category: e.target.value})}
                                 placeholder="Ex: Tissus, Accessoires, Machines" 
                                 className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black transition-all" 
                              />
                           </div>
                        </div>

                        {/* Responsable de compte / interlocuteur */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-8 p-6 bg-slate-50/50 border border-slate-100 rounded-3xl">
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1 flex items-center gap-1.5">👤 Nom du contact principal</label>
                              <Input 
                                 value={customFields.find(cf => cf.key === 'Nom du Responsable')?.value || ''}
                                 onChange={(e) => {
                                    const val = e.target.value;
                                    setCustomFields(prev => {
                                       const filtered = prev.filter(cf => cf.key !== 'Nom du Responsable');
                                       return [...filtered, { id: Date.now() + 1, key: 'Nom du Responsable', value: val }];
                                    });
                                 }}
                                 placeholder="Ex: M. Karim Azzoug" 
                                 className="h-12 border-slate-200 bg-white rounded-xl px-5 text-sm font-bold" 
                              />
                           </div>
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1 flex items-center gap-1.5">💼 Poste / Fonction</label>
                              <Input 
                                 value={customFields.find(cf => cf.key === 'Fonction du Responsable')?.value || ''}
                                 onChange={(e) => {
                                    const val = e.target.value;
                                    setCustomFields(prev => {
                                       const filtered = prev.filter(cf => cf.key !== 'Fonction du Responsable');
                                       return [...filtered, { id: Date.now() + 2, key: 'Fonction du Responsable', value: val }];
                                    });
                                 }}
                                 placeholder="Ex: Directeur Commercial" 
                                 className="h-12 border-slate-200 bg-white rounded-xl px-5 text-sm font-bold" 
                              />
                           </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-8">
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Téléphone Direct</label>
                              <Input 
                                 value={formData.phone}
                                 onChange={(e) => setFormData({...formData, phone: e.target.value})}
                                 placeholder="0550..." 
                                 className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-black font-mono transition-all" 
                              />
                           </div>
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Email Professionnel</label>
                              <Input 
                                 value={formData.email}
                                 onChange={(e) => setFormData({...formData, email: e.target.value})}
                                 placeholder="contact@fournisseur.dz" 
                                 className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-bold" 
                              />
                           </div>
                        </div>

                        <div className="space-y-3">
                           <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Adresse Siège / Entrepôt</label>
                           <Input 
                              value={formData.address}
                              onChange={(e) => setFormData({...formData, address: e.target.value})}
                              placeholder="Adresse complète..." 
                              className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl px-6 text-sm font-bold" 
                           />
                        </div>
                     </TabsContent>

                     <TabsContent value="banking" className="mt-0 space-y-6 sm:space-y-8">
                        {/* Banque */}
                        <div className="bg-[#F8F9FC] rounded-[32px] p-6 sm:p-8 border border-slate-100 space-y-6">
                           <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                              <CreditCard className="size-4 text-slate-500" /> Coordonnées Bancaires (RIB/RIP)
                           </h4>
                           
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                 <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1">Nom de la Banque</label>
                                 <Input 
                                    value={customFields.find(cf => cf.key === 'Nom de la Banque')?.value || ''}
                                    onChange={(e) => {
                                       const val = e.target.value;
                                       setCustomFields(prev => {
                                          const filtered = prev.filter(cf => cf.key !== 'Nom de la Banque');
                                          return [...filtered, { id: Date.now() + 3, key: 'Nom de la Banque', value: val }];
                                       });
                                    }}
                                    placeholder="Ex: BEA, BNA, CPA..." 
                                    className="h-12 border-slate-200 bg-white rounded-xl px-4 text-xs font-black" 
                                 />
                              </div>
                              <div className="space-y-2">
                                 <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1">Code SWIFT / BIC</label>
                                 <Input 
                                    value={customFields.find(cf => cf.key === 'Swift/BIC')?.value || ''}
                                    onChange={(e) => {
                                       const val = e.target.value;
                                       setCustomFields(prev => {
                                          const filtered = prev.filter(cf => cf.key !== 'Swift/BIC');
                                          return [...filtered, { id: Date.now() + 4, key: 'Swift/BIC', value: val }];
                                       });
                                    }}
                                    placeholder="Ex: BEXADAALXXX" 
                                    className="h-12 border-slate-200 bg-white rounded-xl px-4 text-xs font-mono font-black" 
                                 />
                              </div>
                           </div>

                           <div className="space-y-2">
                              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1">Numéro de Compte (RIB/RIP)</label>
                              <Input 
                                 value={formData.bank_account}
                                 onChange={(e) => setFormData({...formData, bank_account: e.target.value})}
                                 placeholder="RIB : 007..." 
                                 className="h-14 border-slate-200 bg-white rounded-2xl px-6 text-sm font-mono tracking-widest font-black" 
                              />
                           </div>

                           <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter italic px-2 flex items-center gap-1.5">
                              <ShieldCheck className="size-3" /> Données chiffrées & sécurisées
                           </p>
                        </div>

                        {/* Identifiants Fiscaux */}
                        <div className="bg-slate-50/50 border border-slate-100 rounded-[32px] p-6 sm:p-8 space-y-6">
                           <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                              <FileText className="size-4 text-slate-500" /> Identifiants Fiscaux & Administratifs
                           </h4>

                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                 <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1">Numéro d'Identification Fiscale (NIF)</label>
                                 <Input 
                                    value={formData.tax_id}
                                    onChange={(e) => setFormData({...formData, tax_id: e.target.value})}
                                    placeholder="NIF : 0001..." 
                                    className="h-12 border-slate-200 bg-white rounded-xl px-4 text-xs font-mono font-black" 
                                 />
                              </div>
                              <div className="space-y-2">
                                 <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1">Numéro d'Identification Statistique (NIS)</label>
                                 <Input 
                                    value={customFields.find(cf => cf.key === 'NIS')?.value || ''}
                                    onChange={(e) => {
                                       const val = e.target.value;
                                       setCustomFields(prev => {
                                          const filtered = prev.filter(cf => cf.key !== 'NIS');
                                          return [...filtered, { id: Date.now() + 5, key: 'NIS', value: val }];
                                       });
                                    }}
                                    placeholder="NIS : 1980..." 
                                    className="h-12 border-slate-200 bg-white rounded-xl px-4 text-xs font-mono font-black" 
                                 />
                              </div>
                           </div>

                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                 <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1">N° Registre du Commerce (RC)</label>
                                 <Input 
                                    value={customFields.find(cf => cf.key === 'RC')?.value || ''}
                                    onChange={(e) => {
                                       const val = e.target.value;
                                       setCustomFields(prev => {
                                          const filtered = prev.filter(cf => cf.key !== 'RC');
                                          return [...filtered, { id: Date.now() + 6, key: 'RC', value: val }];
                                       });
                                    }}
                                    placeholder="RC : 16/00..." 
                                    className="h-12 border-slate-200 bg-white rounded-xl px-4 text-xs font-mono font-black" 
                                 />
                              </div>
                              <div className="space-y-2">
                                 <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1">Article d'Imposition</label>
                                 <Input 
                                    value={customFields.find(cf => cf.key === 'Article d\'Imposition')?.value || ''}
                                    onChange={(e) => {
                                       const val = e.target.value;
                                       setCustomFields(prev => {
                                          const filtered = prev.filter(cf => cf.key !== 'Article d\'Imposition');
                                          return [...filtered, { id: Date.now() + 7, key: 'Article d\'Imposition', value: val }];
                                       });
                                    }}
                                    placeholder="Art : 1603..." 
                                    className="h-12 border-slate-200 bg-white rounded-xl px-4 text-xs font-mono font-black" 
                                 />
                              </div>
                           </div>
                        </div>
                     </TabsContent>

                     <TabsContent value="conditions" className="mt-0 space-y-6">
                        <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                           <Briefcase className="size-4 text-slate-500" /> Conditions commerciales
                        </h3>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                           <div className="space-y-2 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Délai paiement</label>
                              <div className="flex items-baseline gap-1">
                                 <Input type="number" value={formData.payment_terms_days} onChange={e => setFormData({...formData, payment_terms_days: e.target.value})} className="h-10 border-0 bg-transparent p-0 text-2xl font-black text-slate-700 w-20 focus-visible:ring-0" />
                                 <span className="text-[10px] font-black text-slate-400">jours</span>
                              </div>
                              <p className="text-[9px] text-slate-400">Net 30 / 60 / 90</p>
                           </div>
                           <div className="space-y-2 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Délai livraison</label>
                              <div className="flex items-baseline gap-1">
                                 <Input type="number" value={formData.lead_time_days} onChange={e => setFormData({...formData, lead_time_days: e.target.value})} className="h-10 border-0 bg-transparent p-0 text-2xl font-black text-slate-700 w-20 focus-visible:ring-0" />
                                 <span className="text-[10px] font-black text-slate-400">jours</span>
                              </div>
                              <p className="text-[9px] text-slate-400">Lead time moyen</p>
                           </div>
                           <div className="space-y-2 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                              <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Remise négociée</label>
                              <div className="flex items-baseline gap-1">
                                 <Input type="number" value={formData.discount_rate} onChange={e => setFormData({...formData, discount_rate: e.target.value})} placeholder="0" className="h-10 border-0 bg-transparent p-0 text-2xl font-black text-slate-700 w-20 focus-visible:ring-0" />
                                 <span className="text-[10px] font-black text-slate-400">%</span>
                              </div>
                              <p className="text-[9px] text-slate-400">Sur le catalogue</p>
                           </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                           <div className="space-y-2">
                              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Qté minimum commande (MOQ)</label>
                              <Input type="number" value={formData.min_order_qty} onChange={e => setFormData({...formData, min_order_qty: e.target.value})} placeholder="Ex: 10 unités" className="h-12 border-slate-100 bg-slate-50/50 rounded-2xl px-5 text-sm font-black" />
                           </div>
                           <div className="space-y-2">
                              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Montant minimum (DA)</label>
                              <Input type="number" value={formData.min_order_amount} onChange={e => setFormData({...formData, min_order_amount: e.target.value})} placeholder="Ex: 50 000 DA" className="h-12 border-slate-100 bg-slate-50/50 rounded-2xl px-5 text-sm font-black" />
                           </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                           <div className="space-y-2">
                              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Plafond crédit (DA)</label>
                              <Input type="number" value={formData.credit_limit} onChange={e => setFormData({...formData, credit_limit: e.target.value})} placeholder="Ligne de crédit max" className="h-12 border-slate-100 bg-slate-50/50 rounded-2xl px-5 text-sm font-black" />
                           </div>
                           <div className="space-y-2">
                              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Mode de livraison</label>
                              <select value={formData.delivery_method} onChange={e => setFormData({...formData, delivery_method: e.target.value})} className="w-full h-12 rounded-2xl border border-slate-100 bg-slate-50/50 text-sm font-bold text-slate-700 px-5">
                                 <option value="standard">Standard (camion)</option>
                                 <option value="express">Express (coursier)</option>
                                 <option value="port">Port (import)</option>
                                 <option value="air">Aérien</option>
                                 <option value="pickup">Récupération entrepôt</option>
                              </select>
                           </div>
                        </div>

                        <div className="space-y-2">
                           <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Politique de retour</label>
                           <textarea
                              value={formData.return_policy}
                              onChange={e => setFormData({...formData, return_policy: e.target.value})}
                              placeholder="Conditions de retour marchandise, délais, procédure..."
                              className="w-full min-h-[80px] p-4 rounded-2xl border border-slate-100 bg-slate-50/50 text-sm font-medium focus:bg-white outline-none resize-none"
                           />
                        </div>

                        <div className="space-y-2">
                           <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Devise</label>
                           <div className="flex gap-2">
                             {['DZD', 'EUR', 'USD', 'CNY', 'AED'].map(c => (
                               <button key={c} type="button" onClick={() => setFormData({...formData, currency: c})}
                                 className={cn("px-4 py-2 rounded-xl text-[11px] font-black transition-all border-2", formData.currency === c ? "border-slate-800 bg-slate-100 text-slate-800" : "border-slate-100 text-slate-400 hover:border-slate-200")}
                               >{c}</button>
                             ))}
                           </div>
                        </div>
                     </TabsContent>

                     <TabsContent value="fees" className="mt-0 space-y-6">
                        {/* Total banner */}
                        <div className="flex items-center justify-between p-5 bg-slate-100 rounded-2xl border border-slate-200">
                           <div>
                              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-0.5">Total frais fixes</p>
                              <p className="text-2xl font-black text-[#2D3436]">{formatPrice(totalFees)}</p>
                           </div>
                           <Button type="button" onClick={addFee} className="h-10 px-5 rounded-xl bg-slate-800 text-white text-[10px] font-black uppercase tracking-widest">
                              <PlusCircle className="mr-2 size-3.5" /> Ajouter
                           </Button>
                        </div>

                        {/* Column headers — desktop only */}
                        <div className="hidden sm:grid grid-cols-[1fr,120px,110px,auto,40px] gap-3 items-center px-2">
                           {['Nature du frais', 'Montant', 'Type', 'Récurrent', ''].map(h => (
                              <span key={h} className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{h}</span>
                           ))}
                        </div>

                        <div className="space-y-3">
                           {fees.map((fee) => (
                              <div
                                 key={fee.id}
                                 className="flex flex-col sm:grid sm:grid-cols-[1fr,120px,110px,auto,40px] gap-2 sm:gap-3 sm:items-center p-3 sm:p-0 bg-slate-50/50 sm:bg-transparent rounded-2xl sm:rounded-none"
                              >
                                 <Input
                                    value={fee.label}
                                    onChange={(e) => updateFee(fee.id, 'label', e.target.value)}
                                    placeholder="Ex: Douane, Transport..."
                                    className="h-11 sm:h-12 border-slate-100 bg-white sm:bg-slate-50/50 rounded-xl px-4 text-sm font-black"
                                 />
                                 <div className="relative flex gap-2">
                                    <div className="relative flex-1 sm:flex-none">
                                       <Input
                                          type="number"
                                          value={fee.amount}
                                          onChange={(e) => updateFee(fee.id, 'amount', e.target.value)}
                                          placeholder="0"
                                          className="h-11 sm:h-12 border-slate-100 bg-white sm:bg-slate-50 rounded-xl pl-4 pr-12 text-sm font-black text-slate-700"
                                       />
                                       <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300">
                                          {fee.fee_type === 'percentage' ? '%' : 'DA'}
                                       </span>
                                    </div>
                                    <button type="button" onClick={() => removeFee(fee.id)} disabled={fees.length === 1} className="size-11 sm:hidden flex items-center justify-center rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all border border-slate-100 bg-white shrink-0">
                                       <Trash2 className="size-4" />
                                    </button>
                                 </div>
                                 <select
                                    value={fee.fee_type}
                                    onChange={(e) => updateFee(fee.id, 'fee_type', e.target.value)}
                                    className="h-11 sm:h-12 rounded-xl border border-slate-100 bg-white text-[11px] font-black text-slate-600 px-3"
                                 >
                                    <option value="fixed">Fixe</option>
                                    <option value="percentage">% Prix</option>
                                    <option value="per_unit">Par unité</option>
                                    <option value="per_kg">Par kg</option>
                                 </select>
                                 <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                       type="checkbox"
                                       checked={fee.is_recurring}
                                       onChange={(e) => updateFee(fee.id, 'is_recurring', e.target.checked)}
                                       className="size-4 rounded text-slate-800"
                                    />
                                    <span className="text-[10px] font-bold text-slate-500">Mensuel</span>
                                 </label>
                                 <button type="button" onClick={() => removeFee(fee.id)} disabled={fees.length === 1} className="size-10 hidden sm:flex items-center justify-center rounded-xl text-slate-200 hover:text-rose-500 hover:bg-rose-50 transition-all">
                                    <Trash2 className="size-4" />
                                 </button>
                              </div>
                           ))}
                        </div>

                        {/* Fee presets */}
                        <div className="pt-4 border-t border-slate-100">
                           <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-3">Frais standards courants</p>
                           <div className="flex flex-wrap gap-2">
                             {[
                               { label: 'Transport national', amount: '3500', fee_type: 'fixed' },
                               { label: 'Douane import', amount: '5', fee_type: 'percentage' },
                               { label: 'Assurance marchandise', amount: '2', fee_type: 'percentage' },
                               { label: 'Manutention', amount: '1500', fee_type: 'fixed' },
                               { label: 'Stockage/mois', amount: '8000', fee_type: 'fixed', is_recurring: true },
                             ].map(preset => (
                               <button
                                 key={preset.label}
                                 type="button"
                                 onClick={() => setFees(f => [...f.filter(x => x.label !== ''), { id: Date.now(), ...preset, is_recurring: preset.is_recurring ?? false }])}
                                 className="px-3 py-1.5 text-[10px] font-bold rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors border border-transparent"
                               >
                                 {preset.label}
                               </button>
                             ))}
                           </div>
                        </div>

                        <div className="space-y-3 pt-4 border-t border-slate-100">
                           <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Note Interne</label>
                           <textarea
                              value={formData.note}
                              onChange={(e) => setFormData({...formData, note: e.target.value})}
                              placeholder="Horaires, préférences, historique des litiges..."
                              className="w-full min-h-[100px] p-5 rounded-2xl border border-slate-100 bg-slate-50/50 text-sm font-medium focus:bg-white outline-none resize-none"
                           />
                        </div>
                     </TabsContent>

                     <TabsContent value="performance" className="mt-0 space-y-6 sm:space-y-8">
                        {/* reliability score */}
                        <div className="bg-slate-50/50 rounded-[32px] p-6 sm:p-8 border border-slate-100 space-y-4">
                           <div className="flex justify-between items-center">
                              <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                 <Activity className="size-4 text-slate-500" /> Score de Fiabilité Partner
                              </h4>
                              <span className="text-sm font-black text-slate-700">{formData.reliability_score}%</span>
                           </div>
                           <div className="flex items-center gap-4">
                              <input 
                                 type="range" 
                                 min="0" 
                                 max="100" 
                                 value={formData.reliability_score}
                                 onChange={e => setFormData({...formData, reliability_score: e.target.value})}
                                 className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-800"
                              />
                           </div>
                           <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Utilisé pour l'aide à la décision lors des bons de commande</p>
                        </div>

                        {/* commercial reference pricing */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-8">
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Prix d'achat de référence (DZD)</label>
                              <div className="relative">
                                 <Input 
                                    type="number"
                                    value={formData.purchase_price}
                                    onChange={(e) => setFormData({...formData, purchase_price: e.target.value})}
                                    placeholder="Ex: 1200" 
                                    className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl pl-10 pr-6 text-sm font-black" 
                                 />
                                 <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 text-xs font-black">DA</span>
                              </div>
                           </div>
                           <div className="space-y-3">
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest ml-1">Objectif Marge Nette (%)</label>
                              <div className="relative">
                                 <Input 
                                    type="number"
                                    value={formData.margin_percent}
                                    onChange={(e) => setFormData({...formData, margin_percent: e.target.value})}
                                    placeholder="Ex: 25" 
                                    className="h-14 border-slate-100 bg-slate-50/50 focus:bg-white rounded-2xl pl-10 pr-6 text-sm font-black" 
                                 />
                                 <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 text-xs font-black">%</span>
                              </div>
                           </div>
                        </div>

                        {/* Dynamic Extra Charges */}
                        <div className="bg-slate-50/50 rounded-[32px] p-6 sm:p-8 border border-slate-100 space-y-6">
                           <div className="flex items-center justify-between">
                              <h4 className="text-[11px] font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                                 <Receipt className="size-4 text-slate-500" /> Charges annexes récurrentes
                              </h4>
                              <Button type="button" onClick={addExtraCharge} className="h-8 px-3 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest">
                                 + Ajouter charge
                              </Button>
                           </div>

                           {extraCharges.length === 0 ? (
                              <p className="text-[10px] text-slate-400 italic text-center py-2">Aucune charge annexe configurée pour ce fournisseur</p>
                           ) : (
                              <div className="space-y-3">
                                 {extraCharges.map((ec, idx) => (
                                    <div key={ec.id} className="grid grid-cols-[1fr,120px,40px] gap-2 items-center">
                                       <Input 
                                          value={ec.label}
                                          onChange={e => updateExtraCharge(ec.id, 'label', e.target.value)}
                                          placeholder="Ex: Frais de port, Manutention..."
                                          className="h-10 border-slate-200 bg-white rounded-xl px-4 text-xs font-bold"
                                       />
                                       <div className="relative">
                                          <Input 
                                             type="number"
                                             value={ec.amount}
                                             onChange={e => updateExtraCharge(ec.id, 'amount', e.target.value)}
                                             placeholder="0"
                                             className="h-10 border-slate-200 bg-white rounded-xl pl-4 pr-8 text-xs font-black text-slate-700"
                                          />
                                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300">DA</span>
                                       </div>
                                       <button type="button" onClick={() => removeExtraCharge(ec.id)} className="size-10 flex items-center justify-center rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all">
                                          <Trash2 className="size-4" />
                                       </button>
                                    </div>
                                 ))}
                              </div>
                           )}
                        </div>

                        {/* Champs Personnalisés Dynamiques */}
                        <div className="bg-slate-50/50 rounded-[32px] p-6 sm:p-8 border border-slate-100 space-y-6">
                           <div className="flex items-center justify-between">
                              <h4 className="text-[11px] font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                                 <PlusCircle className="size-4 text-slate-500" /> Champs personnalisés supplémentaires
                              </h4>
                              <Button type="button" onClick={addCustomField} className="h-8 px-3 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest">
                                 + Ajouter champ
                              </Button>
                           </div>

                           {customFields.filter(cf => cf.key !== 'Nom du Responsable' && cf.key !== 'Fonction du Responsable' && cf.key !== 'Nom de la Banque' && cf.key !== 'Swift/BIC' && cf.key !== 'NIS' && cf.key !== 'RC' && cf.key !== 'Article d\'Imposition').length === 0 ? (
                              <p className="text-[10px] text-slate-400 italic text-center py-2">Aucun champ personnalisé configuré. Ajoutez par exemple: "Matériau favori: Coton"</p>
                           ) : (
                              <div className="space-y-3">
                                 {customFields.filter(cf => cf.key !== 'Nom du Responsable' && cf.key !== 'Fonction du Responsable' && cf.key !== 'Nom de la Banque' && cf.key !== 'Swift/BIC' && cf.key !== 'NIS' && cf.key !== 'RC' && cf.key !== 'Article d\'Imposition').map((cf, idx) => (
                                    <div key={cf.id} className="grid grid-cols-[1fr,1.2fr,40px] gap-2 items-center">
                                       <Input 
                                          value={cf.key}
                                          onChange={e => updateCustomField(cf.id, 'key', e.target.value)}
                                          placeholder="Nom du champ (Ex: Qualité textile)"
                                          className="h-10 border-slate-200 bg-white rounded-xl px-4 text-xs font-bold"
                                       />
                                       <Input 
                                          value={cf.value}
                                          onChange={e => updateCustomField(cf.id, 'value', e.target.value)}
                                          placeholder="Valeur (Ex: Haut de gamme / Peigné)"
                                          className="h-10 border-slate-200 bg-white rounded-xl px-4 text-xs font-bold"
                                       />
                                       <button type="button" onClick={() => removeCustomField(cf.id)} className="size-10 flex items-center justify-center rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all">
                                          <Trash2 className="size-4" />
                                       </button>
                                    </div>
                                 ))}
                              </div>
                           )}
                        </div>
                     </TabsContent>
                  </div>
               </Tabs>

               <div className="absolute bottom-0 inset-x-0 p-4 sm:p-10 bg-white/80 backdrop-blur-md border-t border-slate-100 flex items-center justify-end gap-3 sm:gap-4 shrink-0 z-20">
                  <button
                     type="button"
                     onClick={closeModal}
                     className="h-12 sm:h-14 px-6 sm:px-10 rounded-2xl text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
                  >
                     Annuler
                  </button>
                  <Button
                     onClick={handleSubmit}
                     disabled={mutation.isPending}
                     className="h-12 sm:h-14 px-8 sm:px-14 rounded-2xl bg-[#6C5CE7] hover:bg-[#5849D1] text-white text-[10px] sm:text-[11px] font-black uppercase tracking-widest shadow-2xl shadow-indigo-100 transition-all active:scale-[0.98]"
                  >
                     {mutation.isPending ? <Loader2 className="size-5 animate-spin" /> : editingSupplier ? "METTRE À JOUR ✓" : "DÉPLOYER 🚀"}
                  </Button>
               </div>
            </form>
         </DialogContent>
      </Dialog>
    </div>
  );
}
