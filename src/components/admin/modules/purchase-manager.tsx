'use client';

import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  ShoppingBag, 
  Warehouse, 
  Calendar,
  DollarSign,
  AlertCircle,
  Activity,
  ChevronLeft,
  ChevronRight,
  Package,
  FileText,
  Filter,
  Download,
  Eye,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Trash2,
  Camera,
  Image as ImageIcon,
  Check,
  ArrowRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
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

export default function PurchaseManager() {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'ALL' | 'PURCHASE_ORDER' | 'RECEPTION_VOUCHER'>('ALL');
  const [isCreating, setIsCreating] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<any | null>(null);
  const [isReceiving, setIsReceiving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const activeStore = useAppStore((s) => s.activeStore);
  const currentUser = useAppStore((s) => s.user);
  const queryClient = useQueryClient();

  // --- Form State for New PO ---
  const [formData, setFormData] = useState({
    supplier_id: '',
    warehouse_id: '',
    reference: `PO-${Math.floor(Math.random() * 900000) + 100000}`,
    note: '',
    items: [{ product_id: '', quantity: 1, unit_cost: 0 }]
  });

  // --- Reception Entry Form State ---
  const [receptionItems, setReceptionItems] = useState<Array<{ item_id: string; product_name: string; quantity: number; received_qty: number }>>([]);
  const [receptionNote, setReceptionNote] = useState('');
  const [uploadedPhotos, setUploadedPhotos] = useState<string[]>([]);

  // --- Data Fetching ---
  const { data: vouchersData, isLoading: isLoadingVouchers } = useQuery({
    queryKey: ['purchase_vouchers', activeStore?.id, activeTab],
    queryFn: () => {
      let url = `/api/v1/purchase-vouchers?store_id=${activeStore?.id}`;
      if (activeTab !== 'ALL') {
        url += `&bon_type=${activeTab}`;
      }
      return apiFetch<{ success: boolean; data: any[] }>(url);
    },
    enabled: !!activeStore?.id,
  });

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/suppliers?store_id=${activeStore?.id}`),
    enabled: isCreating && !!activeStore?.id,
  });

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/warehouses?store_id=${activeStore?.id}`),
    enabled: isCreating && !!activeStore?.id,
  });

  const { data: productsData } = useQuery({
    queryKey: ['products', activeStore?.id],
    queryFn: () => apiFetch<{ success: boolean; data: any[] }>(`/api/v1/products?store_id=${activeStore?.id}`),
    enabled: isCreating && !!activeStore?.id,
  });

  const vouchers = vouchersData?.data || [];
  const suppliers = suppliersData?.data || [];
  const warehouses = warehousesData?.data || [];
  const products = productsData?.data || [];

  // --- Mutations ---
  const createMutation = useMutation({
    mutationFn: (payload: any) => apiFetch('/api/v1/purchase-vouchers/', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        store_id: activeStore?.id,
        created_by: currentUser?.id,
        subtotal: payload.items.reduce((acc: number, i: any) => acc + (i.quantity * i.unit_cost), 0),
        total: payload.items.reduce((acc: number, i: any) => acc + (i.quantity * i.unit_cost), 0)
      })
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase_vouchers'] });
      toast.success('Bon de commande (Achat) créé avec succès');
      setIsCreating(false);
      setFormData({
        supplier_id: '',
        warehouse_id: '',
        reference: `PO-${Math.floor(Math.random() * 900000) + 100000}`,
        note: '',
        items: [{ product_id: '', quantity: 1, unit_cost: 0 }]
      });
    },
    onError: (err: any) => {
      toast.error('Erreur', { description: err.message });
    }
  });

  const receiveMutation = useMutation({
    mutationFn: (payload: any) => apiFetch(`/api/v1/purchase-vouchers/${selectedVoucher?.id}/receive`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase_vouchers'] });
      toast.success('Réception enregistrée avec succès (Bon d\'entrée généré)');
      setIsReceiving(false);
      setSelectedVoucher(null);
      setUploadedPhotos([]);
    },
    onError: (err: any) => {
      toast.error('Erreur', { description: err.message });
    }
  });

  const validateMutation = useMutation({
    mutationFn: (voucherId: string) => apiFetch(`/api/v1/purchase-vouchers/${voucherId}/validate?validator_id=${currentUser?.id}`, {
      method: 'POST'
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase_vouchers'] });
      toast.success('Réception validée ! Stock mis à jour et grand livre fournisseur synchronisé.');
      setSelectedVoucher(null);
    },
    onError: (err: any) => {
      toast.error('Erreur de validation', { description: err.message });
    }
  });

  // --- Photo Upload Handling ---
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedVoucher) return;

    setIsUploading(true);
    const formDataUpload = new FormData();
    formDataUpload.append('file', file);

    try {
      const response = await fetch(`/api/v1/purchase-vouchers/${selectedVoucher.id}/upload-photo`, {
        method: 'POST',
        body: formDataUpload,
      });
      const data = await response.json();
      if (data.success) {
        setUploadedPhotos([...uploadedPhotos, data.url]);
        toast.success('Photo ajoutée avec succès !');
      } else {
        toast.error('Échec de l\'upload');
      }
    } catch (err) {
      toast.error('Erreur lors de l\'upload');
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { product_id: '', quantity: 1, unit_cost: 0 }]
    });
  };

  const handleRemoveItem = (index: number) => {
    const newItems = formData.items.filter((_, i) => i !== index);
    setFormData({ ...formData, items: newItems });
  };

  const handleItemChange = (index: number, field: string, value: any) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setFormData({ ...formData, items: newItems });
  };

  const handleSubmitPO = () => {
    if (!formData.supplier_id || !formData.warehouse_id) return toast.error('Veuillez remplir les informations obligatoires');
    if (formData.items.some(i => !i.product_id || i.quantity <= 0)) return toast.error('Veuillez vérifier les articles');
    createMutation.mutate(formData);
  };

  const startReception = (voucher: any) => {
    setSelectedVoucher(voucher);
    setReceptionItems(voucher.items.map((i: any) => ({
      item_id: i.id,
      product_name: i.product_name,
      quantity: i.quantity,
      received_qty: i.quantity // default to ordered qty
    })));
    setReceptionNote('');
    setUploadedPhotos(voucher.photos || []);
    setIsReceiving(true);
  };

  const handleReceptionItemChange = (idx: number, val: number) => {
    const newItems = [...receptionItems];
    newItems[idx].received_qty = val;
    setReceptionItems(newItems);
  };

  const submitReception = () => {
    receiveMutation.mutate({
      items_received: receptionItems.map(i => ({ item_id: i.item_id, received_qty: i.received_qty })),
      note: receptionNote,
      photos: uploadedPhotos
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* ─── TABS & METRICS ─── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex bg-white p-1.5 rounded-2xl border border-[#E9ECF0] shadow-sm">
          <button 
            onClick={() => setActiveTab('ALL')}
            className={cn("px-5 py-2.5 rounded-xl text-xs font-black tracking-wide transition-all", activeTab === 'ALL' ? "bg-black text-white" : "text-[#636E72] hover:bg-[#F8F9FC]")}
          >
            Tous les flux
          </button>
          <button 
            onClick={() => setActiveTab('PURCHASE_ORDER')}
            className={cn("px-5 py-2.5 rounded-xl text-xs font-black tracking-wide transition-all", activeTab === 'PURCHASE_ORDER' ? "bg-black text-white" : "text-[#636E72] hover:bg-[#F8F9FC]")}
          >
            Bons d'Achat (PO)
          </button>
          <button 
            onClick={() => setActiveTab('RECEPTION_VOUCHER')}
            className={cn("px-5 py-2.5 rounded-xl text-xs font-black tracking-wide transition-all", activeTab === 'RECEPTION_VOUCHER' ? "bg-black text-white" : "text-[#636E72] hover:bg-[#F8F9FC]")}
          >
            Bons d'Entrée (Stock)
          </button>
        </div>

        <Button onClick={() => setIsCreating(true)} className="h-12 px-6 rounded-xl bg-[#6C5CE7] text-white text-xs font-black hover:opacity-90 transition-all shadow-md">
          <Plus className="mr-2 size-4" /> Nouveau Bon d'Achat
        </Button>
      </div>

      {/* ─── DATA TABLE MATRIX ─── */}
      <div className="bg-white rounded-2xl border border-[#E9ECF0] overflow-hidden shadow-sm">
         <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse min-w-[1100px]">
               <thead>
                  <tr className="bg-[#F8F9FC] border-b border-[#E9ECF0]">
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Type</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Référence</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Date & Heure</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Destination</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest">Fournisseur</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-right">Total (DA)</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-center">Réception</th>
                     <th className="px-6 py-4 text-[10px] font-extrabold text-[#B2BEC3] uppercase tracking-widest text-center">Statut</th>
                     <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-[#E9ECF0]">
                  {isLoadingVouchers ? (
                     [1,2,3].map(i => (
                        <tr key={i} className="animate-pulse">
                           <td colSpan={9} className="px-6 py-8 bg-[#FAFBFD]/50" />
                        </tr>
                     ))
                  ) : vouchers.length === 0 ? (
                     <tr>
                        <td colSpan={9} className="px-6 py-20 text-center text-[#B2BEC3] font-bold">Aucun document d'achat trouvé</td>
                     </tr>
                  ) : vouchers.map((v) => (
                     <tr key={v.id} className="hover:bg-[#FAFBFD] transition-colors group">
                        <td className="px-6 py-5 whitespace-nowrap">
                           <Badge className={cn(
                              "border-none rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-wider",
                              v.bon_type === 'RECEPTION_VOUCHER' ? "bg-[#E6FFF8] text-[#00B894]" : "bg-[#F0EDFF] text-[#6C5CE7]"
                           )}>
                              {v.bon_type === 'RECEPTION_VOUCHER' ? 'BON ENTRÉE' : 'BON ACHAT'}
                           </Badge>
                        </td>
                        <td className="px-6 py-5 whitespace-nowrap">
                           <span className="text-sm font-black text-[#2D3436] tracking-wider">{v.reference}</span>
                        </td>
                        <td className="px-6 py-5 whitespace-nowrap">
                           <div className="flex flex-col">
                              <span className="text-xs font-bold text-[#2D3436] font-mono">{v.received_at ? new Date(v.received_at).toLocaleDateString() : 'En attente'}</span>
                              <span className="text-[10px] font-bold text-[#B2BEC3] mt-0.5 uppercase flex items-center gap-1"><Clock className="size-3" /> {v.received_at ? new Date(v.received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</span>
                           </div>
                        </td>
                        <td className="px-6 py-5 whitespace-nowrap">
                           <div className="flex items-center gap-2.5">
                              <div className="size-8 bg-[#F8F9FC] border border-[#E9ECF0] flex items-center justify-center rounded-lg text-[#B2BEC3]">
                                  <Warehouse className="size-3.5" />
                              </div>
                              <div className="flex flex-col">
                                 <span className="text-xs font-bold text-[#2D3436]">{v.warehouse_name}</span>
                              </div>
                           </div>
                        </td>
                        <td className="px-6 py-5 whitespace-nowrap">
                           <span className="text-xs font-bold text-[#636E72] uppercase tracking-tight">{v.supplier_name}</span>
                        </td>
                        <td className="px-6 py-5 text-right whitespace-nowrap">
                           <div className="flex flex-col items-end">
                              <span className="text-sm font-black text-[#2D3436] tabular-nums">{formatPrice(v.total)}</span>
                              <span className="text-[9px] font-bold text-[#00B894] mt-0.5">{v.items?.length || 0} Articles</span>
                           </div>
                        </td>
                        <td className="px-6 py-5 text-center">
                           <Badge className={cn(
                              "border-none rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-widest",
                              v.reception_status === 'RECEIVED' ? "bg-[#E6FFF8] text-[#00B894]" : v.reception_status === 'PARTIAL' ? "bg-[#FFF8E6] text-[#FDCB6E]" : "bg-[#FFEDE9] text-[#E17055]"
                           )}>
                              {v.reception_status === 'RECEIVED' ? 'REÇU' : v.reception_status === 'PARTIAL' ? 'PARTIEL' : 'ATTENTE'}
                           </Badge>
                        </td>
                        <td className="px-6 py-5 text-center">
                           <Badge className={cn(
                              "border-none rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-widest",
                              v.validated_at ? "bg-[#E8F4FE] text-[#0984E3]" : "bg-[#F8F9FC] text-[#B2BEC3] border"
                           )}>
                              {v.validated_at ? 'VALIDÉ' : 'BROUILLON'}
                           </Badge>
                        </td>
                        <td className="px-6 py-5 text-right">
                           <div className="flex items-center justify-end gap-2">
                              {v.bon_type === 'PURCHASE_ORDER' && (
                                <Button 
                                  onClick={() => startReception(v)} 
                                  size="sm" 
                                  className="h-8 rounded-lg bg-black text-white hover:opacity-90 font-bold text-[10px] uppercase flex items-center gap-1.5"
                                >
                                  <Camera className="size-3" /> Réceptionner
                                </Button>
                              )}
                              {v.bon_type === 'RECEPTION_VOUCHER' && !v.validated_at && (
                                <Button 
                                  onClick={() => validateMutation.mutate(v.id)} 
                                  size="sm" 
                                  className="h-8 rounded-lg bg-[#00B894] text-white hover:opacity-90 font-bold text-[10px] uppercase flex items-center gap-1.5"
                                >
                                  <Check className="size-3" /> Valider Stock
                                </Button>
                              )}
                              <Button variant="ghost" onClick={() => setSelectedVoucher(v)} className="size-8 p-0 text-[#B2BEC3] hover:text-[#6C5CE7] hover:bg-[#F0EDFF] transition-all"><Eye className="size-4" /></Button>
                           </div>
                        </td>
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>
      </div>

      {/* ─── MODAL: CREATE NEW PURCHASE ORDER (BON D'ACHAT) ─── */}
      <Dialog open={isCreating} onOpenChange={setIsCreating}>
         <DialogContent className="bg-white border-none shadow-2xl max-w-3xl w-[96vw] p-0 rounded-[40px] overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-[#6C5CE7] p-8 text-white relative overflow-hidden">
               <div className="relative z-10">
                  <DialogTitle className="text-xl font-bold uppercase tracking-widest">Nouveau Bon d'Achat (PO)</DialogTitle>
                  <p className="text-xs font-medium text-white/70 mt-2 uppercase tracking-tight">Générer un ordre d'achat officiel pour un fournisseur</p>
               </div>
               <div className="absolute top-0 right-0 p-8 opacity-20">
                  <ShoppingBag size={80} />
               </div>
            </div>
            
            <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto no-scrollbar">
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Entrepôt Cible</label>
                     <Select value={formData.warehouse_id} onValueChange={(v) => setFormData({...formData, warehouse_id: v})}>
                        <SelectTrigger className="h-12 bg-[#F8F9FC] border-[#E9ECF0] rounded-xl text-xs font-bold"><SelectValue placeholder="Choisir l'entrepôt" /></SelectTrigger>
                        <SelectContent className="bg-white border-[#E9ECF0] rounded-xl">
                           {warehouses.map(w => (
                              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                           ))}
                        </SelectContent>
                     </Select>
                  </div>
                  <div className="space-y-2">
                     <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Fournisseur</label>
                     <Select value={formData.supplier_id} onValueChange={(v) => setFormData({...formData, supplier_id: v})}>
                        <SelectTrigger className="h-12 bg-[#F8F9FC] border-[#E9ECF0] rounded-xl text-xs font-bold"><SelectValue placeholder="Sélectionner le partenaire" /></SelectTrigger>
                        <SelectContent className="bg-white border-[#E9ECF0] rounded-xl">
                           {suppliers.map(s => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                           ))}
                        </SelectContent>
                     </Select>
                  </div>
               </div>

               <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Référence Manuelle (Optionnelle)</label>
                  <Input 
                     value={formData.reference}
                     onChange={(e) => setFormData({...formData, reference: e.target.value})}
                     className="h-12 bg-[#F8F9FC] border-[#E9ECF0] rounded-xl text-xs font-bold" 
                     placeholder="PO-XXXXXX"
                  />
               </div>

               <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Commentaires / Instructions</label>
                  <Textarea 
                     value={formData.note}
                     onChange={(e) => setFormData({...formData, note: e.target.value})}
                     className="bg-[#F8F9FC] border-[#E9ECF0] rounded-xl min-h-[80px] text-xs font-bold p-4 focus:ring-2 focus:ring-[#6C5CE7]/10" 
                     placeholder="Notes pour le service d'expédition..." 
                  />
               </div>

               <div className="pt-6 border-t border-[#E9ECF0] space-y-6">
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-2">
                        <Package className="size-4 text-[#6C5CE7]" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2D3436]">Articles Commandés</span>
                     </div>
                     <Button onClick={handleAddItem} variant="ghost" size="sm" className="text-[10px] font-black text-[#6C5CE7] hover:bg-[#F0EDFF] uppercase">+ Ajouter une ligne</Button>
                  </div>
                  
                  <div className="space-y-4">
                     {formData.items.map((item, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-3 items-end bg-[#F8F9FC] p-4 rounded-2xl border border-[#E9ECF0]">
                           <div className="col-span-12 lg:col-span-6 space-y-1.5">
                              <label className="text-[9px] font-bold uppercase text-[#B2BEC3]">Produit</label>
                              <Select value={item.product_id} onValueChange={(v) => handleItemChange(idx, 'product_id', v)}>
                                 <SelectTrigger className="h-10 bg-white border-[#E9ECF0] rounded-lg text-xs font-bold"><SelectValue placeholder="Choisir un produit" /></SelectTrigger>
                                 <SelectContent className="bg-white border-[#E9ECF0] rounded-xl">
                                    {products.map(p => (
                                       <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                    ))}
                                 </SelectContent>
                              </Select>
                           </div>
                           <div className="col-span-4 lg:col-span-2 space-y-1.5">
                              <label className="text-[9px] font-bold uppercase text-[#B2BEC3]">Quantité</label>
                              <Input 
                                 type="number" 
                                 value={item.quantity}
                                 onChange={(e) => handleItemChange(idx, 'quantity', parseInt(e.target.value))}
                                 placeholder="1" 
                                 className="h-10 bg-white border-[#E9ECF0] rounded-lg text-xs font-bold" 
                              />
                           </div>
                           <div className="col-span-6 lg:col-span-3 space-y-1.5">
                              <label className="text-[9px] font-bold uppercase text-[#B2BEC3]">Coût d'Achat Unitaire (DA)</label>
                              <div className="relative">
                                 <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 size-3 text-[#B2BEC3]" />
                                 <Input 
                                    type="number" 
                                    value={item.unit_cost}
                                    onChange={(e) => handleItemChange(idx, 'unit_cost', parseInt(e.target.value))}
                                    placeholder="0" 
                                    className="h-10 pl-8 bg-white border-[#E9ECF0] rounded-lg text-xs font-bold" 
                                 />
                              </div>
                           </div>
                           <div className="col-span-2 lg:col-span-1 flex justify-center pb-0.5">
                              <Button 
                                 variant="ghost" 
                                 size="icon" 
                                 onClick={() => handleRemoveItem(idx)}
                                 className="size-9 rounded-lg text-[#E17055] hover:bg-[#FFEDE9]"
                                 disabled={formData.items.length === 1}
                              >
                                 <Trash2 className="size-4" />
                              </Button>
                           </div>
                        </div>
                     ))}
                  </div>
               </div>
            </div>

            <DialogFooter className="p-8 bg-[#F8F9FC] border-t border-[#E9ECF0] flex justify-end gap-3">
               <button 
                  disabled={createMutation.isPending}
                  onClick={() => setIsCreating(false)} 
                  className="px-6 py-2.5 rounded-xl text-xs font-bold text-[#636E72] hover:bg-[#E9ECF0] transition-colors disabled:opacity-50"
               >
                  Annuler
               </button>
               <button 
                  disabled={createMutation.isPending}
                  onClick={handleSubmitPO} 
                  className="bg-black text-white text-xs font-black uppercase px-8 h-12 rounded-xl shadow-lg hover:opacity-90 transition-all disabled:opacity-50"
               >
                  {createMutation.isPending ? 'Enregistrement...' : "Créer le Bon d'Achat"}
               </button>
            </DialogFooter>
         </DialogContent>
      </Dialog>

      {/* ─── MODAL: RECEPTION (CONVERT PO TO BON D'ENTRÉE) ─── */}
      <Dialog open={isReceiving} onOpenChange={setIsReceiving}>
         <DialogContent className="bg-white border-none shadow-2xl max-w-3xl w-[96vw] p-0 rounded-[40px] overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-[#00B894] p-8 text-white relative overflow-hidden">
               <div className="relative z-10">
                  <DialogTitle className="text-xl font-bold uppercase tracking-widest">Enregistrer la Réception</DialogTitle>
                  <p className="text-xs font-medium text-white/70 mt-2 uppercase tracking-tight">Transformer {selectedVoucher?.reference} en Bon d'Entrée de Stock</p>
               </div>
               <div className="absolute top-0 right-0 p-8 opacity-20">
                  <Camera size={80} />
               </div>
            </div>
            
            <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto no-scrollbar">
               
               {/* Upload Photo zone */}
               <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Photos des Produits / Réception</label>
                  <div className="grid grid-cols-4 gap-4">
                     {uploadedPhotos.map((url, idx) => (
                        <div key={idx} className="relative aspect-square border border-[#E9ECF0] rounded-2xl overflow-hidden group">
                           <img src={url} alt={`Reception ${idx}`} className="object-cover w-full h-full" />
                        </div>
                     ))}
                     
                     <label className="flex flex-col items-center justify-center aspect-square border-2 border-dashed border-[#E9ECF0] hover:border-[#00B894] rounded-2xl cursor-pointer bg-[#F8F9FC] transition-colors relative">
                        <Camera className="size-6 text-[#B2BEC3] hover:text-[#00B894]" />
                        <span className="text-[9px] font-bold text-[#B2BEC3] mt-2 uppercase">Prendre / Envoyer</span>
                        <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                     </label>
                  </div>
               </div>

               {/* Items Received quantity table */}
               <div className="space-y-3 pt-4 border-t">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Contrôle des Quantités Réceptionnées</label>
                  <div className="space-y-3">
                     {receptionItems.map((item, idx) => (
                        <div key={item.item_id} className="flex justify-between items-center bg-[#F8F9FC] p-4 rounded-xl border border-[#E9ECF0]">
                           <div className="flex flex-col">
                              <span className="text-xs font-black text-[#2D3436]">{item.product_name}</span>
                              <span className="text-[10px] font-bold text-[#B2BEC3]">Quantité Commandée : {item.quantity}</span>
                           </div>
                           <div className="flex items-center gap-3">
                              <span className="text-xs font-bold text-[#636E72]">Reçu :</span>
                              <Input 
                                 type="number"
                                 value={item.received_qty}
                                 onChange={(e) => handleReceptionItemChange(idx, parseInt(e.target.value) || 0)}
                                 className="h-10 w-24 bg-white border-[#E9ECF0] rounded-lg text-center font-black"
                              />
                           </div>
                        </div>
                     ))}
                  </div>
               </div>

               <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[#B2BEC3]">Notes de Réception</label>
                  <Textarea 
                     value={receptionNote}
                     onChange={(e) => setReceptionNote(e.target.value)}
                     className="bg-[#F8F9FC] border-[#E9ECF0] rounded-xl min-h-[80px] text-xs font-bold p-4" 
                     placeholder="Notes sur la conformité, emballages endommagés..." 
                  />
               </div>
            </div>

            <DialogFooter className="p-8 bg-[#F8F9FC] border-t border-[#E9ECF0] flex justify-end gap-3">
               <button 
                  disabled={receiveMutation.isPending}
                  onClick={() => setIsReceiving(false)} 
                  className="px-6 py-2.5 rounded-xl text-xs font-bold text-[#636E72] hover:bg-[#E9ECF0] transition-colors"
               >
                  Annuler
               </button>
               <button 
                  disabled={receiveMutation.isPending || isUploading}
                  onClick={submitReception} 
                  className="bg-[#00B894] text-white text-xs font-black uppercase px-8 h-12 rounded-xl shadow-lg hover:opacity-90 transition-all"
               >
                  {receiveMutation.isPending ? 'Génération...' : "Créer le Bon d'Entrée"}
               </button>
            </DialogFooter>
         </DialogContent>
      </Dialog>

      {/* ─── MODAL: DETAILED VIEW (FICHE D'ACHAT) ─── */}
      <Dialog open={selectedVoucher !== null && !isReceiving} onOpenChange={() => setSelectedVoucher(null)}>
         <DialogContent className="bg-white border-none shadow-2xl max-w-2xl w-[96vw] p-0 rounded-[40px] overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-neutral-900 p-8 text-white relative overflow-hidden">
               <div className="relative z-10 flex justify-between items-center">
                  <div>
                     <DialogTitle className="text-xl font-bold uppercase tracking-widest">{selectedVoucher?.bon_type === 'RECEPTION_VOUCHER' ? 'Bon d\'Entrée' : 'Bon d\'Achat'}</DialogTitle>
                     <p className="text-xs font-medium text-white/50 mt-2 uppercase tracking-tight">{selectedVoucher?.reference}</p>
                  </div>
                  <Badge className="bg-white/10 text-white border-none text-[10px] px-3 py-1 font-black tracking-widest uppercase">
                     {selectedVoucher?.reception_status}
                  </Badge>
               </div>
            </div>
            
            <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto no-scrollbar">
               <div className="grid grid-cols-2 gap-6 text-xs">
                  <div>
                     <span className="text-[#B2BEC3] font-bold block uppercase text-[9px] tracking-wider">Fournisseur</span>
                     <span className="text-sm font-black text-[#2D3436] mt-1 block uppercase">{selectedVoucher?.supplier_name}</span>
                  </div>
                  <div>
                     <span className="text-[#B2BEC3] font-bold block uppercase text-[9px] tracking-wider">Entrepôt Cible</span>
                     <span className="text-sm font-black text-[#2D3436] mt-1 block uppercase">{selectedVoucher?.warehouse_name}</span>
                  </div>
                  <div>
                     <span className="text-[#B2BEC3] font-bold block uppercase text-[9px] tracking-wider">Date d'enregistrement</span>
                     <span className="text-sm font-black text-[#2D3436] mt-1 block font-mono">{selectedVoucher?.received_at ? new Date(selectedVoucher.received_at).toLocaleDateString() : '--/--/----'}</span>
                  </div>
                  <div>
                     <span className="text-[#B2BEC3] font-bold block uppercase text-[9px] tracking-wider">Coût Total</span>
                     <span className="text-sm font-black text-[#6C5CE7] mt-1 block">{formatPrice(selectedVoucher?.total || 0)}</span>
                  </div>
               </div>

               {selectedVoucher?.photos?.length > 0 && (
                  <div className="space-y-2 border-t pt-4">
                     <span className="text-[#B2BEC3] font-bold block uppercase text-[9px] tracking-wider">Photos Jointes</span>
                     <div className="grid grid-cols-4 gap-4 mt-2">
                        {selectedVoucher.photos.map((url: string, idx: number) => (
                           <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="aspect-square rounded-xl overflow-hidden border bg-neutral-100 hover:opacity-85 transition-opacity">
                              <img src={url} alt={`Voucher ${idx}`} className="w-full h-full object-cover" />
                           </a>
                        ))}
                     </div>
                  </div>
               )}

               <div className="space-y-3 border-t pt-4">
                  <span className="text-[#B2BEC3] font-bold block uppercase text-[9px] tracking-wider">Détails des Articles</span>
                  <div className="space-y-2">
                     {selectedVoucher?.items?.map((item: any) => (
                        <div key={item.id} className="flex justify-between items-center bg-[#F8F9FC] p-4 rounded-xl border border-[#E9ECF0]">
                           <div className="flex flex-col">
                              <span className="text-xs font-black text-[#2D3436]">{item.product_name}</span>
                              <span className="text-[10px] font-bold text-[#B2BEC3]">Commandé : {item.quantity} units @ {formatPrice(item.unit_cost)}</span>
                           </div>
                           <div className="text-right">
                              <span className="text-xs font-black text-[#2D3436] block">{formatPrice(item.total_cost)}</span>
                              <span className="text-[10px] font-bold text-[#00B894]">Reçu : {item.received_quantity} units</span>
                           </div>
                        </div>
                     ))}
                  </div>
               </div>

               {selectedVoucher?.note && (
                  <div className="bg-[#FFF8E6] p-4 rounded-xl text-xs font-bold text-[#FDCB6E] border-none">
                     <span className="block uppercase text-[9px] font-black tracking-wider text-[#FDCB6E]/70 mb-1">Notes du Document</span>
                     {selectedVoucher.note}
                  </div>
               )}
            </div>

            <DialogFooter className="p-8 bg-[#F8F9FC] border-t border-[#E9ECF0] flex justify-between gap-3 items-center">
               <div className="text-xs text-[#B2BEC3] font-bold">
                  {selectedVoucher?.validated_at ? (
                     <span className="flex items-center gap-1 text-[#00B894]"><CheckCircle2 className="size-4" /> Validé</span>
                  ) : (
                     <span className="flex items-center gap-1"><Clock className="size-4" /> En attente de validation</span>
                  )}
               </div>
               <div className="flex gap-2">
                  <button 
                     onClick={() => setSelectedVoucher(null)} 
                     className="px-6 py-2.5 rounded-xl text-xs font-bold text-[#636E72] hover:bg-[#E9ECF0] transition-colors"
                  >
                     Fermer
                  </button>
                  {selectedVoucher?.bon_type === 'RECEPTION_VOUCHER' && !selectedVoucher?.validated_at && (
                     <Button 
                        disabled={validateMutation.isPending}
                        onClick={() => validateMutation.mutate(selectedVoucher.id)}
                        className="bg-[#00B894] text-white hover:opacity-90 font-black text-xs px-6 h-10 rounded-xl flex items-center gap-1.5"
                     >
                        <Check className="size-4" /> Valider Stock
                     </Button>
                  )}
               </div>
            </DialogFooter>
         </DialogContent>
      </Dialog>
    </div>
  );
}
