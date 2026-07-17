'use client';

import { useState, useEffect } from 'react';
import type { ElementType } from 'react';
import {
   LayoutDashboard,
   ShoppingCart,
   DollarSign,
   Users,
   BarChart3,
   FileText,
   Package,
   Percent,
   Settings,
   Store,
   ChevronLeft,
   ChevronRight,
   Home,
   SquareStack,
   ChevronDown,
   ShieldCheck,
   UserCheck,
   CreditCard,
   Wallet,
   Receipt,
   Truck,
   Send,
   Handshake,
   UserCog,
   Shield,
   Megaphone,
   CircleDot,
   Building2,
   Zap,
   UserCircle,
   Eye,
   Calculator,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { ROLE_LABELS } from '@/lib/types';
import type { AdminView } from '@/lib/types';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
   Tooltip,
   TooltipContent,
   TooltipProvider,
   TooltipTrigger,
} from '@/components/ui/tooltip';
import {
   Popover,
   PopoverContent,
   PopoverTrigger,
} from '@/components/ui/popover';

// ═══════════════════════════════════════════════════════════════
// CODpilot-Style Color System
// ═══════════════════════════════════════════════════════════════
const S = {
   active: '#6C5CE7',
   activeBg: '#F0EDFF',
   hover: '#F8F9FC',
   text: '#636E72',
   textDim: '#B2BEC3',
   border: '#E9ECF0',
};

interface MenuItem {
   label: string;
   icon: ElementType;
   view: AdminView;
   subView?: string;
   badge?: number;
   items?: { label: string; view: AdminView; subView?: string }[];
}

interface NavSection {
   title: string;
   items: MenuItem[];
}

const NAV_SECTIONS: NavSection[] = [
   {
      title: 'Général',
      items: [
         { label: 'Tableau de bord', icon: LayoutDashboard, view: 'overview' },
      ],
   },
   {
      title: 'Analytiques & Rapports',
      items: [
         { label: 'Performance (KPI)', icon: BarChart3, view: 'analytics', subView: 'kpi' },
         { label: 'Intelligence Commandes', icon: ShoppingCart, view: 'analytics', subView: 'orders' },
         { label: 'Canaux de Vente', icon: Send, view: 'analytics', subView: 'channels' },
         { label: 'Top Produits', icon: Package, view: 'analytics', subView: 'products' },
         { label: 'Logistique & Livraison', icon: Truck, view: 'analytics', subView: 'shipping' },
         { label: 'Matrice Wilayas', icon: Store, view: 'analytics', subView: 'wilayas' },
         { label: 'Télémétrie Agents', icon: UserCheck, view: 'analytics', subView: 'agents' },
         { label: 'Ventes Marketers', icon: Megaphone, view: 'analytics', subView: 'marketers' },
         { label: 'Meta Ads & ROAS', icon: Megaphone, view: 'meta_ads' },
         { label: 'Meta Queue', icon: Megaphone, view: 'meta_queue' },
         { label: 'TikTok Ads & ROAS', icon: Megaphone, view: 'tiktok_ads' },
      ],
   },
   {
      title: 'Commercial',
      items: [
         { 
            label: 'Commandes', 
            icon: ShoppingCart, 
            view: 'orders',
            items: [
               { label: 'Nouvelles', view: 'orders', subView: 'NEW' },
               { label: 'Affectées (Attente)', view: 'orders', subView: 'EN ATTENTE' },
               { label: 'Confirmées (Attente Expédition)', view: 'orders', subView: 'CONFIRMED' },
               { label: 'En Cours de Livraison', view: 'orders', subView: 'FOLLOWUP' },
               { label: 'Livrées & Terminées', view: 'orders', subView: 'COMPLETED' },
               { label: 'Annulées & Retours', view: 'orders', subView: 'CANCELLED' },
               { label: 'Toutes les Commandes', view: 'orders', subView: 'ALL' },
            ]
         },
         { label: 'Produits', icon: Package, view: 'products' },
         { label: 'Upsell', icon: Zap, view: 'upsell' },
         { 
            label: 'Suivi de Stock', 
            icon: Package, 
            view: 'inventory',
            items: [
               { label: 'Surveillance', view: 'inventory', subView: 'MONITOR' },
               { label: 'Entrepôts', view: 'inventory', subView: 'WAREHOUSES' },
               { label: 'Gestion Stock', view: 'inventory', subView: 'STOCK' },
               { label: 'Suivi de stock (lots/mouvements)', view: 'inventory', subView: 'TRACKER' },
               { label: 'Achats', view: 'inventory', subView: 'PURCHASES' },
               { label: 'Bons d\'Achat & d\'Entrée', view: 'purchase_vouchers' },
               { label: 'Fournisseurs', view: 'inventory', subView: 'PARTNERS_RETURNS' },
               { label: 'Historique', view: 'inventory', subView: 'HISTORY' },
               { label: 'Timeline', view: 'inventory', subView: 'TIMELINE' },
               { label: 'Inventaire Livreurs', view: 'inventory', subView: 'LIVREURS' },
               { label: 'Traçabilité', view: 'inventory', subView: 'TRACABILITE' },
               { label: 'Analyse des écarts', view: 'inventory', subView: 'ECARTS' },
               { label: 'Suivi des lots', view: 'inventory', subView: 'LOTS' },
               { label: 'Transferts entrepôts', view: 'inventory', subView: 'TRANSFERS' },
               { label: 'Retours Commandes', view: 'returns' },
               { label: 'Commissions', view: 'commissions' }
            ]
         },
         {
            label: 'Boutiques',
            icon: Store,
            view: 'stores_menu' as any, // Dummy view for parent
            items: [
               { label: 'Création du Site (Boutique)', view: 'stores' },
               { label: 'Landing Pages', view: 'landing_pages' }
            ]
         },
         { label: 'Promotions', icon: Percent, view: 'promotions' },
         { label: 'Simulateur de Coût', icon: Calculator, view: 'cost_calculator' },
      ],
   },
   {
      title: 'Opérations',
      items: [
         { label: 'Personnel', icon: UserCheck, view: 'employees' },
         {
            label: 'Clients & CRM', icon: Users, view: 'customers',
            items: [
               { label: 'Tous les clients', view: 'customers', subView: 'list' },
               { label: 'Liste noire', view: 'customers', subView: 'blacklist' },
            ]
         },
         { label: 'Visiteurs Boutique', icon: Eye, view: 'visitors' },
         { 
            label: 'Finances & Trésorerie', 
            icon: Wallet, 
            view: 'finances',
            items: [
               { label: 'Portefeuilles', view: 'finances', subView: 'wallets' },
               { label: 'Versements', view: 'finances', subView: 'disbursements' },
               { label: 'Charges Divers', view: 'finances', subView: 'charges' },
               { label: 'Registre des Dépenses', view: 'expenses', subView: 'all' },
               { label: 'Ventes (Flux)', view: 'finances', subView: 'payments' },
            ]
         },
         { label: 'Intégrations', icon: Zap, view: 'partners', subView: 'api' },
         { label: 'Livraison & Carriers', icon: Zap, view: 'delivery', subView: 'carriers' },
      ],
   },
   {
      title: 'Système',
      items: [
         { label: 'Journal d\'audit', icon: FileText, view: 'audit' },
         { label: 'Paramètres', icon: Settings, view: 'settings' },
      ],
   },
];

export default function AdminSidebar() {
   const {
      activeStore,
      allStores,
      switchToStore,
      adminView,
      adminSubView,
      setAdminView,
      setAppView,
      sidebarCollapsed,
      setSidebarCollapsed,
      toggleSidebar,
      user: currentUser,
      isAuthenticated,
   } = useAppStore();

   const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

   useEffect(() => {
      if (adminView) {
         NAV_SECTIONS.forEach(section => {
            section.items.forEach(item => {
               if (item.view === adminView || (item.items && item.items.some(sub => sub.view === adminView))) {
                  setExpandedItems(prev => ({ ...prev, [item.view]: true }));
               }
            });
         });
      }
   }, [adminView]);

   const toggleExpand = (view: string) => {
      setExpandedItems((prev) => ({ ...prev, [view]: !prev[view] }));
   };

   const isConfirmateur = currentUser?.role === 'CONFIRMATEUR';

   // Filter sections based on role
   const filteredSections = NAV_SECTIONS.map(section => {
      if (!isConfirmateur) return section;

      // For Confirmateur, only keep General (limited), Commercial (Orders only), and maybe Opérations (limited)
      if (section.title === 'Général') {
         return {
            ...section,
            items: [
               { label: 'Ma Performance', icon: BarChart3, view: 'overview' as AdminView },
            ]
         };
      }
      if (section.title === 'Commercial') {
         const CONFIRMATEUR_INVENTORY_VIEWS = new Set(['STOCK', 'ALERTS', 'MONITOR']);
         return {
            ...section,
            items: section.items
               .filter(item => item.view === 'orders' || item.view === 'inventory')
               .map(item => {
                  if (item.view === 'inventory' && item.items) {
                     return {
                        ...item,
                        items: item.items.filter((sub: any) =>
                           CONFIRMATEUR_INVENTORY_VIEWS.has(sub.subView ?? '')
                        ),
                     };
                  }
                  return item;
               })
         };
      }
      if (section.title === 'Opérations') {
         return {
            ...section,
            items: section.items.filter(item => item.view === 'customers')
         };
      }
      if (section.title === 'Système') return null;
      if (section.title === 'Analytiques & Rapports') return null;
      return null;
   }).filter(Boolean) as NavSection[];

   const handleNavClick = (view: AdminView, subView?: string) => { 
      setAdminView(view, subView || null); 
      // Auto-collapse on mobile after clicking
      if (window.innerWidth < 1024) {
         setSidebarCollapsed(true);
      }
   };
   const handleVisitStore = (storeId: string) => { 
      if (storeId) switchToStore(storeId);
      setAppView('storefront'); 
      if (window.innerWidth < 1024) {
         setSidebarCollapsed(true);
      }
   };

   const getUserInitials = () => {
      if (!currentUser?.name) return '??';
      return currentUser.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
   };

   const renderNavItem = (item: MenuItem) => {
      const hasSubItems = item.items && item.items.length > 0;
      const isAnyChildActive = hasSubItems ? item.items!.some(sub => adminView === sub.view && (!sub.subView || adminSubView === sub.subView)) : false;
      const isActive = (adminView === item.view && (!item.subView || adminSubView === item.subView)) || isAnyChildActive;
      const Icon = item.icon;

      const iconButton = (
         <button
            onClick={() => !hasSubItems && handleNavClick(item.view, item.subView)}
            className={cn(
               'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition-all duration-200 relative',
               isActive
                  ? 'text-[#6C5CE7] bg-[#F0EDFF]'
                  : 'text-[#636E72] hover:text-[#2D3436] hover:bg-[#F8F9FC]',
               sidebarCollapsed && 'justify-center px-0'
            )}
         >
            {isActive && !sidebarCollapsed && (
               <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full" style={{ backgroundColor: S.active }} />
            )}
            <Icon className={cn('size-[18px] shrink-0', isActive && 'text-[#6C5CE7]')} />
            {!sidebarCollapsed && (
               <>
                  <span className="truncate">{item.label}</span>
                  {item.badge && item.badge > 0 && (
                     <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white" style={{ backgroundColor: S.active }}>
                        {item.badge}
                     </span>
                  )}
                  {hasSubItems && (
                     <ChevronDown className={cn("ml-auto size-3.5 text-[#B2BEC3] transition-transform", adminView === item.view ? "rotate-0" : "-rotate-90")} />
                  )}
               </>
            )}
         </button>
      );

      if (sidebarCollapsed) {
         if (hasSubItems) {
            return (
               <Popover>
                  <PopoverTrigger asChild>
                     <button
                        className={cn(
                           'group flex w-full items-center justify-center rounded-lg py-2.5 px-0 text-[13px] font-semibold transition-all duration-200',
                           adminView === item.view
                              ? 'text-[#6C5CE7] bg-[#F0EDFF]'
                              : 'text-[#636E72] hover:text-[#2D3436] hover:bg-[#F8F9FC]',
                        )}
                     >
                        <Icon className={cn('size-[18px] shrink-0', adminView === item.view && 'text-[#6C5CE7]')} />
                     </button>
                  </PopoverTrigger>
                  <PopoverContent side="right" align="start" className="w-52 p-1.5 bg-white border border-[#E9ECF0] rounded-xl shadow-2xl">
                     <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#B2BEC3]">{item.label}</p>
                     <div className="flex flex-col gap-0.5">
                        {item.items?.map((sub) => {
                           const isSubActive = adminView === sub.view && adminSubView === sub.subView;
                           return (
                              <button
                                 key={sub.label}
                                 onClick={() => handleNavClick(sub.view, sub.subView)}
                                 className={cn(
                                    "flex items-center h-9 px-3 text-[12px] font-medium transition-colors rounded-md",
                                    isSubActive
                                       ? "text-[#6C5CE7] bg-[#F0EDFF]"
                                       : "text-[#636E72] hover:text-[#2D3436] hover:bg-[#F8F9FC]"
                                 )}
                              >
                                 {sub.label}
                              </button>
                           );
                        })}
                     </div>
                  </PopoverContent>
               </Popover>
            );
         }
         return (
            <Tooltip>
               <TooltipTrigger asChild>{iconButton}</TooltipTrigger>
               <TooltipContent side="right" className="text-xs font-semibold bg-[#2D3436] text-white border-0">
                  {item.label}
               </TooltipContent>
            </Tooltip>
         );
      }

      return (
         <div className="w-full">
            <button
               onClick={() => {
                  if (hasSubItems) {
                     toggleExpand(item.view);
                  }
                  handleNavClick(item.view, item.subView);
               }}
               className={cn(
                  'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition-all duration-200 relative',
                  isActive
                     ? 'text-[#6C5CE7] bg-[#F0EDFF]'
                     : 'text-[#636E72] hover:text-[#2D3436] hover:bg-[#F8F9FC]',
               )}
            >
               {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full" style={{ backgroundColor: S.active }} />
               )}
               <Icon className={cn('size-[18px] shrink-0', isActive && 'text-[#6C5CE7]')} />
               <span className="truncate">{item.label}</span>
               {item.badge && item.badge > 0 && (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white" style={{ backgroundColor: S.active }}>
                     {item.badge}
                  </span>
               )}
               {hasSubItems && (
                  <ChevronDown className={cn("ml-auto size-3.5 text-[#B2BEC3] transition-transform", expandedItems[item.view] ? "rotate-0" : "-rotate-90")} />
               )}
            </button>
            {hasSubItems && expandedItems[item.view] && (
               <div className="ml-9 mt-1 flex flex-col gap-0.5 border-l border-[#E9ECF0] pl-3 animate-in slide-in-from-top-2 duration-200">
                  {item.items?.map((sub) => {
                     const isSubActive = adminSubView === sub.subView;
                     return (
                        <button
                           key={sub.label}
                           onClick={() => handleNavClick(sub.view, sub.subView)}
                           className={cn(
                              "flex items-center h-9 px-3 text-[12px] font-medium transition-colors rounded-md",
                              isSubActive
                                 ? "text-[#6C5CE7] bg-[#F0EDFF]/50"
                                 : "text-[#636E72] hover:text-[#2D3436] hover:bg-[#F8F9FC]"
                           )}
                        >
                           {sub.label}
                        </button>
                     );
                  })}
               </div>
            )}
         </div>
      );
   };

   return (
      <aside className={cn(
         'fixed top-0 left-0 z-50 flex h-full flex-col bg-white transition-all duration-300 border-r shadow-2xl lg:shadow-none',
         sidebarCollapsed 
            ? '-translate-x-full lg:translate-x-0 lg:w-[70px]' 
            : 'translate-x-0 w-[280px] sm:w-[260px]'
      )} style={{ borderColor: S.border }}>

         {/* ─── Logo / Brand ───────────────────────────── */}
         <div className="flex items-center gap-3 px-4 h-20 shrink-0 border-b" style={{ borderColor: S.border }}>
            <div className={cn(
               "flex shrink-0 items-center justify-center transition-all duration-300",
               sidebarCollapsed ? "size-10" : "size-12"
            )}>
               <img 
                  src="/azzougshop_logo.png" 
                  alt="AzzougShop" 
                  className="w-full h-full object-contain"
               />
            </div>
            {!sidebarCollapsed && (
               <div className="flex flex-col min-w-0">
                  <h1 className="text-sm font-extrabold text-[#2D3436] truncate tracking-tight">
                     AzzougStore
                  </h1>
                  <span className="text-[10px] font-semibold text-[#B2BEC3]">E-Commerce ERP</span>
               </div>
            )}
         </div>

         {/* ─── Store Selector ──────────────────────────── */}
         {!sidebarCollapsed && activeStore && (
            <div className="px-3 py-3 border-b lg:hidden" style={{ borderColor: S.border }}>
               {currentUser?.role === 'SUPER_ADMIN' && allStores.length > 1 ? (
                  <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                        <button className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[#F8F9FC] border border-[#E9ECF0] hover:border-[#B2BEC3] transition-colors">
                           <div className="size-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: S.active }}>
                              {activeStore.name.charAt(0)}
                           </div>
                           <span className="flex-1 text-left text-xs font-semibold text-[#2D3436] truncate">{activeStore.name}</span>
                           <ChevronDown className="size-3.5 text-[#B2BEC3]" />
                        </button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent align="start" className="w-[200px] bg-white border border-[#E9ECF0] rounded-xl p-1.5 shadow-2xl z-[100]">
                        <DropdownMenuLabel className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#B2BEC3]">
                           Changer de boutique
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator className="my-1" />
                        {allStores.map((s) => (
                           <DropdownMenuItem
                              key={s.id}
                              onClick={() => switchToStore(s.id)}
                              className={cn(
                                 "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer",
                                 s.id === activeStore.id
                                    ? "bg-[#F0EDFF] text-[#6C5CE7]"
                                    : "text-[#2D3436] hover:bg-[#F8F9FC]"
                              )}
                           >
                              <div className="size-2 rounded-full" style={{ backgroundColor: s.id === activeStore.id ? '#6C5CE7' : 'transparent' }} />
                              {s.name}
                           </DropdownMenuItem>
                        ))}
                     </DropdownMenuContent>
                  </DropdownMenu>
               ) : (
                  <button className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[#F8F9FC] border border-[#E9ECF0] cursor-default">
                     <div className="size-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: S.active }}>
                        {activeStore.name.charAt(0)}
                     </div>
                     <span className="flex-1 text-left text-xs font-semibold text-[#2D3436] truncate">{activeStore.name}</span>
                  </button>
               )}
            </div>
         )}

         {/* ─── Navigation Sections ─────────────────────── */}
         <TooltipProvider delayDuration={0}>
            <nav className="flex-1 overflow-y-auto px-3 py-3 custom-scrollbar">
               {filteredSections.map((section) => (
                  <div key={section.title} className="mb-4">
                     {!sidebarCollapsed && (
                        <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-[#B2BEC3]">{section.title}</p>
                     )}
                     <div className="flex flex-col gap-0.5">
                        {section.items.map((item) => (
                           <div key={item.label} className="w-full">
                              {renderNavItem(item)}
                           </div>
                        ))}
                     </div>
                  </div>
               ))}
            </nav>
         </TooltipProvider>

         {/* ─── Bottom Actions ─────────────────────────── */}
         <div className="shrink-0 p-3 border-t" style={{ borderColor: S.border }}>
            {allStores.length <= 1 ? (
               <button
                  onClick={() => handleVisitStore(activeStore?.id || '')}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold text-[#636E72] hover:text-[#2D3436] hover:bg-[#F8F9FC] transition-all"
               >
                  <Home className="size-[18px] shrink-0" />
                  {!sidebarCollapsed && <span>Voir la boutique</span>}
               </button>
            ) : (
               <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                     <button
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold text-[#636E72] hover:text-[#2D3436] hover:bg-[#F8F9FC] transition-all"
                     >
                        <Home className="size-[18px] shrink-0" />
                        {!sidebarCollapsed && <span>Voir la boutique</span>}
                        {!sidebarCollapsed && <ChevronDown className="ml-auto size-3.5 text-[#B2BEC3]" />}
                     </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side={sidebarCollapsed ? "right" : "bottom"} className="w-[200px] bg-white border border-[#E9ECF0] rounded-xl p-1.5 shadow-2xl">
                     <DropdownMenuLabel className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#B2BEC3]">
                        Choisir une boutique
                     </DropdownMenuLabel>
                     <DropdownMenuSeparator className="bg-[#F0F3F6]" />
                     {allStores.map((store) => (
                        <DropdownMenuItem
                           key={store.id}
                           onClick={() => handleVisitStore(store.id)}
                           className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#2D3436] hover:bg-[#F8F9FC] cursor-pointer rounded-lg"
                        >
                           <Building2 className="size-3.5 text-[#B2BEC3]" />
                           {store.name}
                        </DropdownMenuItem>
                     ))}
                  </DropdownMenuContent>
               </DropdownMenu>
            )}
            <button
               onClick={toggleSidebar}
               className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition-all"
               style={{ color: S.active, backgroundColor: S.activeBg }}
            >
               {sidebarCollapsed
                  ? <ChevronRight className="size-[18px]" />
                  : <><ChevronLeft className="size-[18px]" /><span>Réduire</span></>
               }
            </button>
         </div>

         {/* ─── User Info ──────────────────────────────── */}
         <div className="shrink-0 p-3 border-t" style={{ borderColor: S.border }}>
            <div className={cn("flex items-center gap-3", sidebarCollapsed && "justify-center")}>
               <div className="relative">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#F0EDFF] text-[#6C5CE7] text-xs font-bold">
                     {currentUser?.avatar
                        ? <img src={currentUser.avatar} className="h-full w-full object-cover rounded-full" alt="" />
                        : getUserInitials()
                     }
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 size-2.5 bg-emerald-500 border-2 border-white rounded-full" />
               </div>
               {!sidebarCollapsed && isAuthenticated && currentUser && (
                  <div className="min-w-0 flex-1">
                     <p className="text-xs font-bold text-[#2D3436] truncate">{currentUser.name}</p>
                     <p className="text-[10px] font-semibold text-[#B2BEC3] truncate">{ROLE_LABELS[currentUser.role]}</p>
                  </div>
               )}
            </div>
         </div>
      </aside>
   );
}
