'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { Menu, Bell, LogIn, LogOut, Moon, Sun, Maximize2, Search, ChevronDown, Globe, AlertTriangle, ShoppingCart, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
   Popover,
   PopoverContent,
   PopoverTrigger,
} from '@/components/ui/popover';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { useAppStore } from '@/store/app-store';
import { LoginDialog } from '@/components/auth/login-dialog';
import { apiFetch } from '@/lib/api-client';
import { formatPrice, formatOrderRef } from '@/lib/format';
import type { AdminView, Order, PaginatedResponse, Product } from '@/lib/types';
import { ORDER_STATUS_LABELS, ROLE_LABELS } from '@/lib/types';
import { cn } from '@/lib/utils';

const PAGE_TITLES: Record<AdminView, string> = {
   overview: "Tableau de Bord",
   stores: 'Magasins',
   stores_menu: 'Magasins',
   orders: 'Commandes',
   employees: 'Employés',
   analytics: 'Performance (KPI)',
   audit: 'Journal d\'Audit',
   products: 'Produits',
   settings: 'Paramètres',
   promotions: 'Promotions',
   customers: 'Clients',
   pos: 'Point de Vente',
   scanner: 'Scanner',
   inventory: 'Inventaire',
   expenses: 'Dépenses',
   finances: 'Finances',
   users_management: 'Gestion Personnel',
   clients_management: 'Gestion Clients',
   partners: 'Partenaires',
   sendpilot: 'SendPilot',
   delivery: 'Livraison',
   delivery_partners: 'Transporteurs',
   landing_pages: 'Landing Pages',
   visitors: 'Visiteurs',
   cost_calculator: 'Calculateur de Coût',
   meta_ads: 'Meta Ads & ROAS',
   upsell: 'Upsell & Commissions',
   purchase_vouchers: 'Achats & Entrées',
};


function StoreSwitcher() {
   const { activeStore, allStores, switchToStore, user: currentUser } = useAppStore();
   
   if (!activeStore || currentUser?.role !== 'SUPER_ADMIN' || allStores.length <= 1) {
      return null;
   }

   return (
      <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#F8F9FC] border border-[#E9ECF0]">
         <Globe className="size-3.5 text-[#B2BEC3]" />
         <Select value={activeStore.id} onValueChange={switchToStore}>
            <SelectTrigger className="h-7 border-0 bg-transparent p-0 shadow-none focus:ring-0 text-xs font-bold text-[#2D3436] w-[140px]">
               <SelectValue placeholder="Changer de magasin" />
            </SelectTrigger>
            <SelectContent>
               {allStores.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs font-bold">
                     {s.name}
                  </SelectItem>
               ))}
            </SelectContent>
         </Select>
      </div>
   );
}

export default function AdminHeader() {
   const {
      adminView,
      setAdminView,
      setAppView,
      toggleSidebar,
      activeStore,
      allStores,
      switchToStore,
      user: currentUser,
      isAuthenticated,
      clearUser,
      setSelectedOrderId,
   } = useAppStore();

   const { theme, setTheme } = useTheme();
   const [showNotifications, setShowNotifications] = useState(false);
   const [showLoginDialog, setShowLoginDialog] = useState(false);
   const storeId = activeStore?.id ?? '';

   const newOrdersQuery = useQuery<PaginatedResponse<Order>>({
      queryKey: ['orders', 'new-notifications', storeId],
      queryFn: () =>
         fetch(`/api/v1/orders?store_id=${storeId}&status=NEW&pageSize=5`).then((r) => r.json()),
      refetchInterval: 30000,
   });

   const stockAlertsQuery = useQuery<{ data: Product[] }>({
      queryKey: ['stock', 'alerts', storeId],
      queryFn: () =>
         fetch(`/api/v1/stock/alerts?store_id=${storeId}`).then((r) => r.json()),
      refetchInterval: 60000,
   });

   const title = PAGE_TITLES[adminView] || 'AzzougStore';

   const newOrders = newOrdersQuery.data?.data ?? [];
   const newOrdersTotal = newOrdersQuery.data?.total ?? 0;
   const stockAlerts = stockAlertsQuery.data?.data ?? [];
   
   // Payroll alert (last 5 days of the month)
   const today = new Date();
   const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
   const showPayrollAlert = today.getDate() >= lastDayOfMonth - 5;

   const totalNotifications = newOrdersTotal + stockAlerts.length + (showPayrollAlert ? 1 : 0);

   const handleLogout = async () => {
      try {
         await apiFetch('/api/v1/auth', { method: 'DELETE' });
      } catch {
         // ignore
      }
      clearUser();
      toast.success('Déconnexion réussie', {
         description: 'Votre session a été terminée.',
      });
   };

   const getUserInitials = () => {
      if (!currentUser?.name) return '??';
      return currentUser.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
   };

   return (
      <>
         <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-white/90 backdrop-blur-xl px-4 sm:px-6 w-full" style={{ borderColor: '#E9ECF0' }}>
            {/* Left side */}
            <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
               <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleSidebar}
                  className="size-9 text-[#636E72] hover:text-[#2D3436] hover:bg-[#F8F9FC] rounded-lg shrink-0"
               >
                  <Menu className="size-5" />
               </Button>

               <div className="flex items-center gap-2 min-w-0">
                  <h1 className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-[#2D3436] truncate">{title}</h1>
               </div>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-3">
               <StoreSwitcher />

               {/* Theme Toggle */}
               <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="size-9 text-[#636E72] hover:text-[#2D3436] hover:bg-[#F8F9FC] rounded-lg"
               >
                  <Sun className="size-[18px] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                  <Moon className="absolute size-[18px] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                  <span className="sr-only">Toggle theme</span>
               </Button>

               {/* Voir le site */}
               {allStores.length <= 1 ? (
                  <Button
                     variant="ghost"
                     size="icon"
                     onClick={() => setAppView('storefront')}
                     className="size-9 text-[#636E72] hover:text-[#2D3436] hover:bg-[#F8F9FC] rounded-lg"
                     title="Voir la boutique"
                  >
                     <Globe className="size-[18px]" />
                  </Button>
               ) : (
                  <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                        <Button
                           variant="ghost"
                           size="icon"
                           className="size-9 text-[#636E72] hover:text-[#2D3436] hover:bg-[#F8F9FC] rounded-lg"
                        >
                           <Globe className="size-[18px]" />
                        </Button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent align="end" className="w-[200px] bg-white border border-[#E9ECF0] rounded-xl p-1.5 mt-2 shadow-2xl">
                        <DropdownMenuLabel className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#B2BEC3]">
                           Voir le site
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-[#F0F3F6]" />
                        {allStores.map((store) => (
                           <DropdownMenuItem
                              key={store.id}
                              onClick={() => {
                                 switchToStore(store.id);
                                 setAppView('storefront');
                              }}
                              className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#2D3436] hover:bg-[#F8F9FC] cursor-pointer rounded-lg"
                           >
                              <Globe className="size-3.5 text-[#B2BEC3]" />
                              {store.name}
                           </DropdownMenuItem>
                        ))}
                     </DropdownMenuContent>
                  </DropdownMenu>
               )}

               {/* Notifications */}
               <Popover open={showNotifications} onOpenChange={setShowNotifications}>
                  <PopoverTrigger asChild>
                     <Button variant="ghost" size="icon" className="relative size-9 text-[#636E72] hover:text-[#2D3436] hover:bg-[#F8F9FC] rounded-lg">
                        <Bell className="size-[18px]" />
                        {totalNotifications > 0 && (
                           <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: '#6C5CE7' }}>
                              {totalNotifications > 99 ? '99+' : totalNotifications}
                           </span>
                        )}
                     </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[360px] p-0 bg-white border border-[#E9ECF0] rounded-xl shadow-2xl">
                     <div className="px-5 py-4 border-b border-[#E9ECF0] flex items-center justify-between">
                        <div>
                           <h3 className="text-sm font-bold text-[#2D3436]">Notifications</h3>
                           <p className="text-xs font-medium text-[#B2BEC3]">
                              {newOrdersTotal > 0 && `${newOrdersTotal} nouvelle${newOrdersTotal > 1 ? 's' : ''} commande${newOrdersTotal > 1 ? 's' : ''}`}
                              {newOrdersTotal > 0 && stockAlerts.length > 0 && ' · '}
                              {stockAlerts.length > 0 && `${stockAlerts.length} alerte${stockAlerts.length > 1 ? 's' : ''} stock`}
                              {(newOrdersTotal > 0 || stockAlerts.length > 0) && showPayrollAlert && ' · '}
                              {showPayrollAlert && '1 alerte de paie'}
                              {totalNotifications === 0 && 'Aucune notification'}
                           </p>
                        </div>
                        <Bell className="size-4 text-[#6C5CE7]" />
                     </div>
                     <div className="max-h-[400px] overflow-y-auto">
                        {(newOrdersQuery.isLoading || stockAlertsQuery.isLoading) ? (
                           <div className="p-5 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full bg-[#F8F9FC] rounded-lg" />)}</div>
                        ) : totalNotifications === 0 ? (
                           <div className="py-16 text-center">
                              <Bell className="size-8 text-[#DFE6E9] mx-auto mb-3" />
                              <p className="text-sm font-semibold text-[#B2BEC3]">Aucune notification</p>
                           </div>
                        ) : (
                           <div className="divide-y divide-[#F0F3F6]">
                              {/* New orders */}
                              {newOrders.map((order) => (
                                 <button
                                    key={order.id}
                                    onClick={() => {
                                       setSelectedOrderId(order.id);
                                       setAdminView('orders');
                                       setShowNotifications(false);
                                    }}
                                    className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[#FAFBFD] transition-colors"
                                 >
                                    <div className="size-9 rounded-lg flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ backgroundColor: '#6C5CE7' }}>
                                       <ShoppingCart className="size-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                       <div className="flex items-center justify-between gap-2">
                                          <span className="text-xs font-bold text-[#2D3436] truncate">{order.customer_name}</span>
                                          <span className="text-xs font-bold text-[#6C5CE7] shrink-0">{formatPrice(order.total)}</span>
                                       </div>
                                       <p className="text-[10px] font-medium text-[#B2BEC3]">{formatOrderRef(order, 'admin')} · {order.created_at ? new Date(order.created_at).toLocaleTimeString('fr-FR') : '---'}</p>
                                    </div>
                                 </button>
                              ))}
                              {/* Payroll alert */}
                              {showPayrollAlert && (
                                 <button
                                    onClick={() => {
                                       setAdminView('employees');
                                       setShowNotifications(false);
                                    }}
                                    className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[#F2F6FF] transition-colors"
                                 >
                                    <div className="size-9 rounded-lg flex items-center justify-center text-white text-[10px] font-bold shrink-0 bg-blue-500">
                                       <Wallet className="size-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                       <div className="flex items-center justify-between gap-2">
                                          <span className="text-xs font-bold text-[#2D3436] truncate">Rappel de paie</span>
                                       </div>
                                       <p className="text-[10px] font-medium text-[#B2BEC3]">C'est la fin du mois. N'oubliez pas de payer vos employés.</p>
                                    </div>
                                 </button>
                              )}
                              {/* Stock alerts */}
                              {stockAlerts.map((product: any) => (
                                 <button
                                    key={product.id}
                                    onClick={() => {
                                       setAdminView('inventory');
                                       setShowNotifications(false);
                                    }}
                                    className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[#FFF8E6] transition-colors"
                                 >
                                    <div className="size-9 rounded-lg flex items-center justify-center text-white text-[10px] font-bold shrink-0 bg-amber-500">
                                       <AlertTriangle className="size-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                       <div className="flex items-center justify-between gap-2">
                                          <span className="text-xs font-bold text-[#2D3436] truncate">{product.name}</span>
                                          <span className="text-xs font-bold text-amber-600 shrink-0">{product.stock} restant{product.stock > 1 ? 's' : ''}</span>
                                       </div>
                                       <p className="text-[10px] font-medium text-[#B2BEC3]">Alerte stock · Seuil : {product.low_stock_threshold ?? 5}</p>
                                    </div>
                                 </button>
                              ))}
                           </div>
                        )}
                     </div>
                     {totalNotifications > 0 && (
                        <div className="grid grid-cols-2 border-t border-[#E9ECF0]">
                           <button
                              onClick={() => { setAdminView('orders'); setShowNotifications(false); }}
                              className="py-3 text-xs font-bold text-[#6C5CE7] hover:bg-[#F8F9FC] transition-colors rounded-bl-xl border-r border-[#E9ECF0]"
                           >
                              Toutes les commandes
                           </button>
                           <button
                              onClick={() => { setAdminView('inventory'); setShowNotifications(false); }}
                              className="py-3 text-xs font-bold text-amber-600 hover:bg-[#FFF8E6] transition-colors rounded-br-xl"
                           >
                              Alertes stock
                           </button>
                        </div>
                     )}
                  </PopoverContent>
               </Popover>

               {/* User Menu */}
               {isAuthenticated && currentUser ? (
                  <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                        <button className="flex items-center gap-3 group cursor-pointer outline-none pl-3 border-l border-[#E9ECF0]">
                           <div className="flex flex-col items-end hidden sm:flex">
                              <span className="text-xs font-bold text-[#2D3436]">{currentUser.name}</span>
                              <span className="text-[10px] font-semibold text-[#B2BEC3]">{ROLE_LABELS[currentUser.role]}</span>
                           </div>
                           <div className="relative">
                              <div className="size-9 rounded-full flex items-center justify-center text-xs font-bold text-[#6C5CE7] bg-[#F0EDFF] overflow-hidden">
                                 {currentUser.avatar
                                    ? <img src={currentUser.avatar} className="h-full w-full object-cover" alt="" />
                                    : getUserInitials()
                                 }
                              </div>
                              <div className="absolute -bottom-0.5 -right-0.5 size-2.5 bg-emerald-500 border-2 border-white rounded-full" />
                           </div>
                        </button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent align="end" className="w-[260px] bg-white border border-[#E9ECF0] rounded-xl p-1.5 mt-2 shadow-2xl">
                        <div className="px-3 py-3 border-b border-[#F0F3F6] mb-1.5">
                           <h4 className="text-sm font-bold text-[#2D3436]">{currentUser.name}</h4>
                           <p className="text-[11px] font-medium text-[#B2BEC3] mt-0.5">{currentUser.email}</p>
                        </div>
                        <DropdownMenuLabel className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#B2BEC3]">
                           Rôle: {ROLE_LABELS[currentUser.role]}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-[#F0F3F6]" />
                        <DropdownMenuItem
                           onClick={handleLogout}
                           className="flex items-center gap-2.5 px-3 py-2.5 text-xs font-semibold text-red-500 hover:bg-red-50 cursor-pointer rounded-lg mt-1"
                        >
                           <LogOut className="size-4" /> Se déconnecter
                        </DropdownMenuItem>
                     </DropdownMenuContent>
                  </DropdownMenu>
               ) : (
                  <Button
                     onClick={() => setShowLoginDialog(true)}
                     className="text-xs font-bold text-white px-5 h-9 rounded-lg"
                     style={{ backgroundColor: '#6C5CE7' }}
                  >
                     <LogIn className="mr-2 size-4" /> Se connecter
                  </Button>
               )}
            </div>
         </header>
         <LoginDialog open={showLoginDialog} onOpenChange={setShowLoginDialog} />
      </>
   );
}
