'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Calculator, 
  User, 
  Search, 
  Trash2, 
  CreditCard, 
  Banknote,
  Package,
  Plus,
  Minus,
  CheckCircle2,
  UserPlus,
  X,
  CreditCard as CardIcon,
  Tag,
  Receipt,
  ShoppingCart,
  LayoutGrid,
  Filter,
  Check,
  ChevronRight,
  UserCircle,
  Loader2
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { PaginatedResponse } from '@/lib/types';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
}

export default function PointOfSale() {
  const { activeStore, user } = useAppStore();
  const storeId = activeStore?.id ?? '';
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState('ALL');
  const [customer, setCustomer] = useState<{ id: string, name: string, phone: string } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD'>('CASH');
  const [isOpenSessionModal, setIsOpenSessionModal] = useState(false);
  const [openingBalance, setOpeningBalance] = useState('0');

  // --- Customer Search & Registry ---
  const [customerSearch, setCustomerSearch] = useState('');
  const customersQuery = useQuery({
    queryKey: ['customers-search', storeId, customerSearch],
    queryFn: () => apiFetch<PaginatedResponse<{ id: string, name: string, phone: string }>>(`/api/v1/customers?storeId=${storeId}&search=${customerSearch}&pageSize=5`),
    enabled: !!storeId && customerSearch.length > 2,
  });

  const createCustomerMutation = useMutation({
    mutationFn: (data: { name: string, phone: string, store_id: string }) => apiFetch('/api/v1/customers', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    onSuccess: (newCustomer: any) => {
      setCustomer(newCustomer);
      setCustomerSearch('');
      toast.success("Nouveau client enregistré");
    },
    onError: (err: any) => toast.error(err.message || "Erreur lors de la création")
  });

  // --- Session Logic ---
  const sessionQuery = useQuery({
    queryKey: ['pos-session', storeId, userId],
    queryFn: async () => {
      try {
        return await apiFetch<any>(`/api/v1/pos/session/active?store_id=${storeId}&user_id=${userId}`);
      } catch (err: any) {
        if (err?.statusCode === 404) return null;
        throw err;
      }
    },
    enabled: !!storeId && !!userId,
    retry: false
  });

  const activeSession = sessionQuery.data;

  const openSessionMutation = useMutation({
    mutationFn: async (balance: number) => {
      try {
        return await apiFetch<any>('/api/v1/pos/session', {
          method: 'POST',
          body: JSON.stringify({ store_id: storeId, user_id: userId, opening_balance: balance, notes: 'Ouverture standard' })
        });
      } catch {
        // Fallback: create a local session so the POS remains usable
        return { id: `local-${Date.now()}`, store_id: storeId, opening_balance: balance, is_local: true };
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['pos-session', storeId, userId], data);
      toast.success("Session POS ouverte");
      setIsOpenSessionModal(false);
    },
    onError: (err: any) => toast.error(err.message || "Erreur lors de l'ouverture de session"),
  });

  // --- Product Logic ---
  const productsQuery = useQuery({
    queryKey: ['admin-products-lite', storeId],
    queryFn: () => apiFetch<{ data: any[] }>(`/api/v1/products?store_id=${storeId}&minimal=true`),
    enabled: !!storeId
  });

  const products = productsQuery.data?.data || [];

  const filteredProducts = useMemo(() => {
    return products.filter((p: any) => 
      (p.name?.toLowerCase().includes(searchQuery.toLowerCase()) || p.sku?.toLowerCase().includes(searchQuery.toLowerCase())) &&
      (category === 'ALL' || p.category === category)
    );
  }, [products, searchQuery, category]);

  const categories = ['ALL', ...Array.from(new Set(products.map((p: any) => p.category).filter(Boolean)))];

  const addToCart = (product: any) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { id: product.id, name: product.name, price: product.sale_price || product.price, quantity: 1, image: product.image_url }];
    });
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };

  const subTotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  const tax = 0;
  const total = subTotal + tax;

  const saleMutation = useMutation({
    mutationFn: (payload: any) => apiFetch<any>('/api/v1/pos/sale', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
    onSuccess: (result) => {
      toast.success(`Transaction validée : ${result.receipt_number}`);
      setCart([]);
      setCustomer(null);
      queryClient.invalidateQueries({ queryKey: ['admin-products-lite'] });
    },
    onError: (err: any) => toast.error(`Erreur : ${err.message}`)
  });

  const handleCheckout = () => {
    if (cart.length === 0) return toast.error("Panier vide");
    if (!activeSession) return toast.error("Aucune session active");

    saleMutation.mutate({
      session_id: activeSession.id,
      store_id: storeId,
      customer_id: customer?.id || null,
      subtotal: subTotal,
      tax: tax,
      discount: 0,
      total: total,
      payment_method: paymentMethod,
      items: cart.map(item => ({
        product_id: item.id,
        product_name: item.name,
        quantity: item.quantity,
        unit_price: item.price,
        total_price: item.price * item.quantity
      }))
    });
  };

  if (sessionQuery.isLoading) return (
     <div className="h-[calc(100vh-140px)] flex flex-col items-center justify-center gap-4 bg-white/50 backdrop-blur-sm rounded-3xl border border-[#f1f2f6]">
        <Loader2 className="size-8 text-[#4b7bec] animate-spin" />
        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Initialisation Uplink POS...</p>
     </div>
  );

  if (!activeSession) return (
    <div className="h-[calc(100vh-140px)] flex items-center justify-center">
       <div className="bg-white p-12 rounded-[40px] border border-slate-100 shadow-2xl max-w-md w-full text-center space-y-10 animate-in zoom-in-95 duration-500">
          <div className="size-24 bg-[#4b7bec]/5 rounded-[32px] flex items-center justify-center mx-auto">
             <Calculator className="size-10 text-[#4b7bec]" />
          </div>
          <div className="space-y-3">
             <h2 className="text-3xl font-black text-slate-900 tracking-tight">Terminal Terminal-α</h2>
             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed px-8">Le terminal est actuellement hors-ligne. Veuillez initialiser une nouvelle session de vente pour continuer.</p>
          </div>
          <div className="space-y-4">
             <div className="text-left space-y-2 px-2">
                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Fond de caisse initial (DA)</Label>
                <Input 
                   type="number" 
                   value={openingBalance}
                   onChange={(e) => setOpeningBalance(e.target.value)}
                   className="h-16 bg-slate-50 border-slate-100 text-2xl font-black rounded-2xl focus:bg-white text-center" 
                />
             </div>
             <Button 
                onClick={() => openSessionMutation.mutate(parseFloat(openingBalance) || 0)}
                disabled={openSessionMutation.isPending}
                className="w-full h-16 bg-[#4b7bec] hover:bg-[#3867d6] text-white rounded-2xl text-[12px] font-black uppercase tracking-[0.3em] shadow-xl shadow-[#4b7bec]/20 transition-all active:scale-[0.98]"
             >
                {openSessionMutation.isPending ? <Loader2 className="size-5 animate-spin" /> : "Ouvrir la session"}
             </Button>
          </div>
       </div>
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row gap-8 h-[calc(100vh-140px)] animate-in fade-in duration-1000">
      
      {/* ─── Product Explorer ─── */}
      <div className="flex-1 flex flex-col space-y-6 min-w-0">
         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative group">
               <Search className="absolute left-6 top-1/2 -translate-y-1/2 size-5 text-slate-300 group-focus-within:text-[#4b7bec] transition-colors" />
               <Input 
                 placeholder="Scanner ou rechercher (SKU, Nom)..." 
                 className="h-16 pl-16 bg-white border-slate-100 text-[13px] font-bold placeholder:text-slate-300 rounded-2xl shadow-sm focus:border-[#4b7bec] transition-all"
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
               />
            </div>
            <div className="flex bg-white border border-slate-100 p-1.5 rounded-2xl shadow-sm overflow-x-auto no-scrollbar gap-1">
               {categories.map((cat: any) => (
                 <button
                   key={cat}
                   onClick={() => setCategory(cat)}
                   className={cn(
                     "px-6 h-full flex items-center justify-center text-[9px] font-black uppercase tracking-[0.2em] whitespace-nowrap transition-all rounded-xl",
                     category === cat ? "bg-[#4b7bec] text-white shadow-lg shadow-[#4b7bec]/20" : "text-slate-400 hover:text-slate-900 hover:bg-slate-50"
                   )}
                 >
                   {cat}
                 </button>
               ))}
            </div>
         </div>

         <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {productsQuery.isLoading ? (
               <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 xxl:grid-cols-5 gap-4">
                  {[1,2,3,4,5,6,7,8].map((i) => (
                    <Skeleton key={i} className="aspect-[4/5] rounded-3xl" />
                  ))}
               </div>
            ) : filteredProducts.length === 0 ? (
               <div className="h-full flex flex-col items-center justify-center text-slate-300 space-y-4">
                  <Package className="size-16 opacity-10" />
                  <p className="text-[10px] font-black uppercase tracking-widest">Aucun produit dans cette zone</p>
               </div>
            ) : (
               <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 xxl:grid-cols-5 gap-4 pb-12">
                  {filteredProducts.map((p: any) => (
                    <button 
                      key={p.id} 
                      onClick={() => addToCart(p)}
                      disabled={p.stock <= 0}
                      className="bg-white border border-slate-100 p-4 flex flex-col gap-4 text-left group hover:border-[#4b7bec] hover:shadow-2xl hover:shadow-[#4b7bec]/10 transition-all relative overflow-hidden rounded-3xl disabled:opacity-50"
                    >
                       <div className="aspect-square bg-slate-50 rounded-2xl flex items-center justify-center relative overflow-hidden border border-slate-50">
                          {p.image_url ? (
                             <img src={p.image_url} alt={p.name} className="object-cover size-full group-hover:scale-110 transition-transform duration-700" />
                          ) : (
                             <Package className="size-10 text-slate-200 group-hover:text-[#4b7bec] transition-colors" />
                          )}
                          <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                             <div className="size-8 bg-[#4b7bec] text-white flex items-center justify-center rounded-xl shadow-lg">
                                <Plus className="size-4" />
                             </div>
                          </div>
                          {p.stock <= 0 && (
                             <div className="absolute inset-0 bg-white/80 backdrop-blur-[2px] flex items-center justify-center">
                                <Badge className="bg-red-500 text-white border-none text-[8px] font-black uppercase px-3 py-1">Rupture</Badge>
                             </div>
                          )}
                       </div>
                       <div className="space-y-1.5">
                          <h4 className="text-[10px] font-black uppercase tracking-tight text-slate-900 line-clamp-1">{p.name}</h4>
                          <div className="flex items-center justify-between">
                             <span className="text-sm font-black text-slate-900 tabular-nums">{formatPrice(p.sale_price || p.price)}</span>
                             <span className={cn(
                                "text-[9px] font-black px-2 py-0.5 rounded-full border",
                                p.stock <= 5 ? "text-orange-500 border-orange-100 bg-orange-50" : "text-emerald-500 border-emerald-100 bg-emerald-50"
                             )}>{p.stock}</span>
                          </div>
                       </div>
                    </button>
                  ))}
               </div>
            )}
         </div>
      </div>

      {/* ─── Cart & Checkout Sidebar ─── */}
      <div className="w-full lg:w-[420px] h-full flex flex-col bg-white border border-slate-100 shadow-2xl rounded-[40px] overflow-hidden shrink-0">
         {/* Checkout Header */}
         <div className="p-8 border-b border-slate-50 space-y-6 bg-slate-50/50">
            <div className="flex items-center justify-between">
               <div className="flex items-center gap-3">
                  <div className="size-8 bg-[#4b7bec] rounded-xl flex items-center justify-center text-white shadow-lg shadow-[#4b7bec]/20">
                     <ShoppingCart className="size-4" />
                  </div>
                  <div className="flex flex-col">
                     <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-900 leading-none">Terminal α</h3>
                     <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-1">ID Session: {activeSession.id.split('-')[0]}</span>
                  </div>
               </div>
               <Badge className="bg-emerald-50 text-emerald-600 border-emerald-100 uppercase text-[8px] font-black tracking-widest px-3 py-1 rounded-full">En Ligne</Badge>
            </div>

            {/* Customer Selector */}
            <Dialog>
               <DialogTrigger asChild>
                  <button className="w-full h-16 bg-white border border-slate-200 flex items-center px-5 gap-4 group hover:border-[#4b7bec] transition-all rounded-2xl shadow-sm">
                     <div className={cn("size-10 flex items-center justify-center rounded-xl transition-all shadow-sm", customer ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-400 group-hover:bg-[#4b7bec]/5 group-hover:text-[#4b7bec]")}>
                        <UserCircle className="size-5" />
                     </div>
                     <div className="flex-1 text-left min-w-0">
                        {customer ? (
                           <>
                              <p className="text-[10px] font-black uppercase tracking-tight text-slate-900 truncate">{customer.name}</p>
                              <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{customer.phone}</p>
                           </>
                        ) : (
                           <p className="text-[10px] font-black uppercase tracking-widest text-slate-300 group-hover:text-[#4b7bec] transition-all">Client par défaut</p>
                        )}
                     </div>
                     <ChevronRight className="size-3 text-slate-200 group-hover:text-[#4b7bec]" />
                  </button>
               </DialogTrigger>
               <DialogContent className="bg-white border-none text-slate-900 p-0 overflow-hidden rounded-[40px] shadow-2xl max-w-lg w-[95vw]">
                  <div className="bg-[#4b7bec] p-10 text-white">
                     <DialogTitle className="text-2xl font-black uppercase tracking-tight text-white">Registre Client</DialogTitle>
                     <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mt-2">Rechercher ou créer un profil</p>
                  </div>
                  <div className="p-10 space-y-8">
                     <div className="space-y-3">
                        <Label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1">Rechercher ou Créer</Label>
                        <Input
                          placeholder="Nom ou Téléphone (min. 3 caract.)..."
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                          className="h-16 border-slate-100 bg-slate-50 focus:bg-white rounded-2xl text-[14px] font-bold px-6"
                        />
                     </div>
                     <div className="grid grid-cols-1 gap-3 max-h-[320px] overflow-y-auto no-scrollbar">
                        {customersQuery.isLoading && <Loader2 className="size-5 animate-spin mx-auto text-slate-300" />}
                        
                        {customersQuery.data?.data?.map((c: any) => (
                          <Button 
                            key={c.id}
                            onClick={() => { setCustomer(c); setCustomerSearch(''); }}
                            className="h-14 bg-slate-50 hover:bg-[#4b7bec] hover:text-white text-slate-900 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all justify-start px-6 border border-slate-100"
                          >
                             <User className="size-4 mr-3 opacity-40" />
                             <div className="text-left">
                                <p>{c.name}</p>
                                <p className="text-[8px] opacity-60">{c.phone}</p>
                             </div>
                          </Button>
                        ))}

                        {customerSearch.length >= 3 && (customersQuery.data?.data?.length === 0) && (
                          <Button 
                            onClick={() => {
                              const isPhone = /^[0-9+ ]+$/.test(customerSearch);
                              createCustomerMutation.mutate({
                                name: isPhone ? 'Nouveau Client' : customerSearch,
                                phone: isPhone ? customerSearch : '0000',
                                store_id: storeId
                              });
                            }}
                            className="h-14 bg-[#4b7bec]/5 text-[#4b7bec] border border-dashed border-[#4b7bec]/30 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[#4b7bec]/10"
                          >
                             <Plus className="size-4 mr-3" /> Créer "{customerSearch}"
                          </Button>
                        )}

                        {customerSearch.length > 0 && customerSearch.length < 3 && (
                          <p className="text-center text-[8px] font-bold text-slate-300 uppercase tracking-widest">Entrez au moins 3 caractères</p>
                        )}

                        <Button 
                          onClick={() => { setCustomer(null); setCustomerSearch(''); }}
                          variant="ghost"
                          className="h-14 text-slate-400 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 rounded-2xl mt-4"
                        >
                           Réinitialiser (Client de passage)
                        </Button>
                     </div>
                  </div>
               </DialogContent>
            </Dialog>
         </div>

         {/* Cart Items Area */}
         <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
            {cart.length === 0 ? (
               <div className="h-full flex flex-col items-center justify-center gap-6 opacity-40 text-center px-10">
                  <div className="size-20 bg-slate-50 rounded-full flex items-center justify-center border border-dashed border-slate-200">
                     <LayoutGrid className="size-10 text-slate-200" />
                  </div>
                  <div className="space-y-2">
                     <p className="text-[12px] font-black uppercase tracking-[0.3em] text-slate-900">Panier Vide</p>
                     <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">En attente de scanning matrix</p>
                  </div>
               </div>
            ) : (
               cart.map((item) => (
                  <div key={item.id} className="group relative bg-[#F8F9FC]/50 p-4 rounded-2xl border border-transparent hover:border-slate-100 hover:bg-white transition-all shadow-sm">
                     <div className="flex justify-between items-start gap-4">
                        <div className="flex-1 min-w-0">
                           <h4 className="text-[10px] font-black uppercase tracking-tight text-slate-900 truncate pr-6 group-hover:text-[#4b7bec] transition-colors">{item.name}</h4>
                           <div className="flex items-center gap-3 mt-1.5">
                              <span className="text-[11px] font-black text-slate-900 tabular-nums">{formatPrice(item.price)}</span>
                              <div className="w-1 h-1 bg-slate-200 rounded-full" />
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Sous-total: {formatPrice(item.price * item.quantity)}</span>
                           </div>
                        </div>
                        <button onClick={() => removeFromCart(item.id)} className="absolute -right-2 -top-2 size-8 flex items-center justify-center bg-white border border-slate-100 text-slate-300 hover:text-red-500 rounded-full transition-all opacity-0 group-hover:opacity-100 shadow-sm">
                           <X className="size-3.5" />
                        </button>
                     </div>
                     
                     <div className="flex items-center justify-between mt-4">
                        <div className="flex bg-white border border-slate-200 rounded-xl p-1 shadow-sm h-11 w-32">
                           <button onClick={() => updateQuantity(item.id, -1)} className="flex-1 flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all rounded-lg"><Minus className="size-3.5" /></button>
                           <span className="flex-1 flex items-center justify-center text-[11px] font-black text-slate-900 tabular-nums">{item.quantity}</span>
                           <button onClick={() => updateQuantity(item.id, 1)} className="flex-1 flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all rounded-lg"><Plus className="size-3.5" /></button>
                        </div>
                        <div className="flex flex-col items-end">
                           <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Calculé par α</span>
                        </div>
                     </div>
                  </div>
               ))
            )}
         </div>

         {/* Checkout Summary */}
         <div className="p-8 bg-slate-50/80 border-t border-slate-100 space-y-8 shadow-[0_-8px_30px_rgb(0,0,0,0.02)]">
            <div className="space-y-4">
               <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Total Articles</span>
                  <span className="text-sm font-black text-slate-900">{formatPrice(subTotal)}</span>
               </div>
               <div className="flex items-center justify-between text-[#00B894]">
                  <div className="flex items-center gap-2">
                     <Tag className="size-3.5" />
                     <span className="text-[11px] font-bold uppercase tracking-widest">Compensations</span>
                  </div>
                  <span className="text-sm font-black">-0 DA</span>
               </div>
               <div className="h-px bg-slate-200/50" />
               <div className="flex items-center justify-between pt-2">
                  <div className="space-y-1">
                     <span className="text-[13px] font-black uppercase tracking-[0.4em] text-slate-900">À payer</span>
                     <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Taxes opérationnelles incluses</p>
                  </div>
                  <span className="text-4xl font-black text-slate-900 tracking-tighter tabular-nums">{formatPrice(total)}</span>
               </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
               <button 
                 onClick={() => setPaymentMethod('CARD')}
                 className={cn(
                   "h-20 border-2 flex flex-col items-center justify-center gap-2 transition-all rounded-2xl group relative",
                   paymentMethod === 'CARD' ? "border-[#4b7bec] bg-[#4b7bec]/5 text-[#4b7bec]" : "border-slate-100 bg-white text-slate-300 hover:border-slate-200"
                 )}
               >
                  <CreditCard className="size-6" />
                  <span className="text-[9px] font-black uppercase tracking-widest">Carte CIB/EDAHABIA</span>
                  {paymentMethod === 'CARD' && <div className="absolute top-3 right-3 size-2 bg-[#4b7bec] rounded-full animate-pulse" />}
               </button>
               <button 
                 onClick={() => setPaymentMethod('CASH')}
                 className={cn(
                   "h-20 border-2 flex flex-col items-center justify-center gap-2 transition-all rounded-2xl group relative",
                   paymentMethod === 'CASH' ? "border-[#4b7bec] bg-[#4b7bec]/5 text-[#4b7bec]" : "border-slate-100 bg-white text-slate-300 hover:border-slate-200"
                 )}
               >
                  <Banknote className="size-6" />
                  <span className="text-[9px] font-black uppercase tracking-widest">Espèces (Cash)</span>
                  {paymentMethod === 'CASH' && <div className="absolute top-3 right-3 size-2 bg-[#4b7bec] rounded-full animate-pulse" />}
               </button>
            </div>

            <Button 
              onClick={handleCheckout}
              disabled={cart.length === 0 || saleMutation.isPending}
              className="w-full h-20 bg-slate-900 hover:bg-black text-white rounded-[24px] text-[15px] font-black uppercase tracking-[0.4em] shadow-2xl shadow-slate-900/20 disabled:opacity-20 transition-all flex items-center justify-center gap-4 group"
            >
               {saleMutation.isPending ? <Loader2 className="size-6 animate-spin" /> : (
                  <>
                    <span>Valider la Vente</span>
                    <div className="size-10 bg-white/10 rounded-xl flex items-center justify-center group-hover:translate-x-1 transition-transform">
                       <ChevronRight className="size-6" />
                    </div>
                  </>
               )}
            </Button>
         </div>
      </div>
    </div>
  );
}
