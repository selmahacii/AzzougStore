'use client';

import {
  LayoutDashboard, Zap, Share2, Package, ShoppingBag,
  CreditCard, Boxes, Settings, Store, Warehouse,
  Users, UserCircle, Truck, BarChart3, RadioTower,
  ChevronDown, ChevronRight, ChevronLeft, Home, Building2,
  Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { ROLE_LABELS } from '@/lib/types';
import type { AdminView } from '@/lib/types';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useState, useEffect } from 'react';
import type { ElementType } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SubItem { label: string; view: AdminView; subView?: string; badge?: string }
interface NavItem {
  label: string;
  icon: ElementType;
  view?: AdminView;
  subView?: string;
  badge?: string;
  sub?: SubItem[];
}

interface NavSection { title: string; items: NavItem[] }

// ─── Nav config ───────────────────────────────────────────────────────────────

const NAV: NavSection[] = [
  {
    title: 'Général',
    items: [
      { label: 'Tableau de bord', icon: LayoutDashboard, view: 'overview' },
    ],
  },
  {
    title: 'Analytics',
    items: [
      {
        label: 'Analyses',
        icon: BarChart3,
        view: 'analytics',
        sub: [
          { label: 'Performance (KPI)',  view: 'analytics', subView: 'kpi' },
          { label: 'Commandes',          view: 'analytics', subView: 'orders' },
          { label: 'Canaux de vente',    view: 'analytics', subView: 'channels' },
          { label: 'Produits',           view: 'analytics', subView: 'products' },
          { label: 'Livraison',          view: 'analytics', subView: 'shipping' },
          { label: 'Wilayas',            view: 'analytics', subView: 'wilayas' },
          { label: 'Agents',             view: 'analytics', subView: 'agents' },
          { label: 'Marketers',          view: 'analytics', subView: 'marketers' },
        ],
      },
    ],
  },
  {
    title: 'Commercial',
    items: [
      { label: 'Produits',  icon: Package,    view: 'products' },
      {
        label: 'Boutiques',
        icon: Store,
        view: 'stores_menu' as any,
        sub: [
          { label: 'Création du site (Boutique)', view: 'stores' },
          { label: 'Landing Pages', view: 'landing_pages' },
        ],
      },
      { label: 'Promotions',icon: Zap,        view: 'promotions' },
      { label: 'Point de vente', icon: CreditCard, view: 'pos', badge: 'New' },
      {
        label: 'Commandes',
        icon: ShoppingBag,
        view: 'orders',
        sub: [
          { label: 'Nouvelles',           view: 'orders', subView: 'NEW' },
          { label: 'Affectées',           view: 'orders', subView: 'EN ATTENTE' },
          { label: 'Confirmées',          view: 'orders', subView: 'CONFIRMED' },
          { label: 'En livraison',        view: 'orders', subView: 'FOLLOWUP' },
          { label: 'Livrées',             view: 'orders', subView: 'COMPLETED' },
          { label: 'Annulées & Retours',  view: 'orders', subView: 'CANCELLED' },
          { label: 'Toutes',              view: 'orders', subView: 'ALL' },
        ],
      },
      {
        label: 'Inventaire',
        icon: Warehouse,
        view: 'inventory',
        sub: [
          { label: 'Surveillance',   view: 'inventory', subView: 'MONITOR' },
          { label: 'Entrepôts',      view: 'inventory', subView: 'WAREHOUSES' },
          { label: 'Gestion Stock',  view: 'inventory', subView: 'STOCK' },
          { label: 'Suivi des lots', view: 'inventory', subView: 'TRACKER' },
          { label: 'Achats',         view: 'inventory', subView: 'PURCHASES' },
          { label: 'Fournisseurs',   view: 'inventory', subView: 'PARTNERS' },
          { label: 'Retours Commandes', view: 'inventory', subView: 'ORDER_RETURNS' },
        ],
      },
    ],
  },
  {
    title: 'Publicité',
    items: [
      { label: 'Meta Ads & ROAS',   icon: BarChart3, view: 'meta_ads' },
      { label: 'Conversion Optimization', icon: Target, view: 'conversion_optimization' },
      { label: 'TikTok Ads & ROAS', icon: BarChart3, view: 'tiktok_ads' },
    ],
  },
  {
    title: 'Opérations',
    items: [
      { label: 'Personnel',  icon: Users,      view: 'employees' },
      { label: 'Clients',    icon: UserCircle, view: 'customers' },
      {
        label: 'Finances',
        icon: Boxes,
        view: 'finances',
        sub: [
          { label: 'Portefeuilles', view: 'finances', subView: 'wallets' },
          { label: 'Versements',    view: 'finances', subView: 'disbursements' },
          { label: 'Charges',       view: 'finances', subView: 'charges' },
          { label: 'Paiements',     view: 'finances', subView: 'payments' },
        ],
      },
      {
        label: 'Livraison',
        icon: Truck,
        view: 'delivery',
        sub: [
          { label: 'Carriers & API',  view: 'delivery', subView: 'carriers' },
          { label: 'Suivi de colis',  view: 'delivery', subView: 'tracking' },
          { label: 'Statistiques',    view: 'delivery', subView: 'stats' },
        ],
      },
      { label: 'Intégrations', icon: Share2, view: 'partners', subView: 'api' },
    ],
  },
  {
    title: 'Système',
    items: [
      { label: 'Paramètres', icon: Settings, view: 'settings' },
    ],
  },
];

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export default function SuperAdminSidebar() {
  const {
    adminView, adminSubView, setAdminView,
    setAppView, activeStore, allStores, switchToStore,
    sidebarCollapsed, setSidebarCollapsed, toggleSidebar,
    user: currentUser,
  } = useAppStore();

  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (adminView) {
      NAV.forEach(section => {
        section.items.forEach(item => {
           if (item.view === adminView || (item.sub && item.sub.some(s => s.view === adminView))) {
              if (item.view) setExpandedItems(prev => ({ ...prev, [item.view!]: true }));
           }
        })
      });
    }
  }, [adminView]);

  const toggleExpand = (view: string) => {
    setExpandedItems((prev) => ({ ...prev, [view]: !prev[view] }));
  };

  const go = (view?: AdminView, subView?: string) => {
    if (view) setAdminView(view, subView ?? null);
    if (window.innerWidth < 1024) setSidebarCollapsed(true);
  };

  const visitStore = (storeId: string) => {
    if (storeId) switchToStore(storeId);
    setAppView('storefront');
    if (window.innerWidth < 1024) setSidebarCollapsed(true);
  };

  const initials = currentUser?.name
    ?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) ?? '??';

  return (
    <TooltipProvider delayDuration={0}>
      <aside className={cn(
        'fixed top-0 left-0 z-50 flex h-full flex-col bg-white border-r border-slate-100 transition-all duration-300 shadow-sm',
        sidebarCollapsed
          ? '-translate-x-full lg:translate-x-0 lg:w-[60px]'
          : 'translate-x-0 w-[260px]',
      )}>

        {/* ── Brand ─────────────────────────────────────── */}
        <div className={cn(
          'flex items-center shrink-0 border-b border-slate-100 h-14',
          sidebarCollapsed ? 'justify-center px-0' : 'gap-3 px-4',
        )}>
          <img src="/azzougshop_logo.png" alt="AzzougShop" className="size-7 object-contain shrink-0" />
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 leading-none truncate">AzzougSystem</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Super Admin</p>
            </div>
          )}
        </div>

        {/* ── Store Selector (Mobile Only) ──────────────── */}
        {!sidebarCollapsed && activeStore && (
           <div className="px-3 py-3 border-b lg:hidden border-slate-100">
              {currentUser?.role === 'SUPER_ADMIN' && allStores.length > 1 ? (
                 <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                       <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 hover:border-slate-350 transition-colors">
                          <div className="size-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold bg-[#6C5CE7]">
                             {activeStore.name.charAt(0)}
                          </div>
                          <span className="flex-1 text-left text-xs font-semibold text-slate-700 truncate">{activeStore.name}</span>
                          <ChevronDown className="size-3.5 text-slate-400" />
                       </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[200px] bg-white border border-slate-100 rounded-xl p-1.5 shadow-2xl z-[100]">
                       <DropdownMenuLabel className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Changer de boutique
                       </DropdownMenuLabel>
                       <DropdownMenuSeparator className="my-1 border-slate-50" />
                       {allStores.map((s) => (
                          <DropdownMenuItem
                             key={s.id}
                             onClick={() => switchToStore(s.id)}
                             className={cn(
                                "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer",
                                s.id === activeStore.id
                                   ? "bg-[#F0EDFF] text-[#6C5CE7]"
                                   : "text-slate-700 hover:bg-slate-50"
                             )}
                          >
                             <div className="size-2 rounded-full" style={{ backgroundColor: s.id === activeStore.id ? '#6C5CE7' : 'transparent' }} />
                             {s.name}
                          </DropdownMenuItem>
                       ))}
                    </DropdownMenuContent>
                 </DropdownMenu>
              ) : (
                 <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 cursor-default">
                    <div className="size-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold bg-[#6C5CE7]">
                       {activeStore.name.charAt(0)}
                    </div>
                    <span className="flex-1 text-left text-xs font-semibold text-slate-700 truncate">{activeStore.name}</span>
                 </button>
              )}
           </div>
        )}

        {/* ── Nav ───────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 custom-scrollbar space-y-4">
          {NAV.map((section) => (
            <div key={section.title}>
              {!sidebarCollapsed && (
                <p className="px-2 mb-1 text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">
                  {section.title}
                </p>
              )}
              {sidebarCollapsed && <div className="h-px bg-slate-100 mx-1 mb-2" />}
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) => (
                  <NavRow
                    key={item.label}
                    item={item}
                    collapsed={sidebarCollapsed}
                    adminView={adminView}
                    adminSubView={adminSubView}
                    onNavigate={go}
                    expandedItems={expandedItems}
                    onToggleExpand={toggleExpand}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* ── Bottom ────────────────────────────────────── */}
        <div className="shrink-0 border-t border-slate-100 p-2 space-y-0.5">
          {/* Visit store */}
          {allStores.length <= 1 ? (
            <NavButton
              icon={<Home className="size-4 shrink-0" />}
              label="Voir la boutique"
              collapsed={sidebarCollapsed}
              onClick={() => visitStore(activeStore?.id ?? '')}
            />
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={cn(
                  'flex w-full items-center gap-2.5 rounded-md h-9 text-[12px] font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors',
                  sidebarCollapsed ? 'justify-center px-0' : 'px-3',
                )}>
                  <Home className="size-4 shrink-0" />
                  {!sidebarCollapsed && <><span className="flex-1 text-left">Voir la boutique</span><ChevronDown className="size-3 text-slate-300" /></>}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side={sidebarCollapsed ? 'right' : 'top'} align="start" className="w-48 p-1.5">
                <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-2 py-1.5">Boutiques</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {allStores.map((s) => (
                  <DropdownMenuItem key={s.id} onClick={() => visitStore(s.id)} className="text-xs font-medium gap-2 cursor-pointer">
                    <Building2 className="size-3.5 text-slate-400" />{s.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Collapse toggle */}
          <button
            onClick={toggleSidebar}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md h-9 text-[12px] font-medium text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors',
              sidebarCollapsed ? 'justify-center px-0' : 'px-3',
            )}
          >
            {sidebarCollapsed
              ? <ChevronRight className="size-4" />
              : <><ChevronLeft className="size-4" /><span>Réduire</span></>
            }
          </button>
        </div>

        {/* ── User ──────────────────────────────────────── */}
        <div className={cn(
          'shrink-0 border-t border-slate-100 p-2',
        )}>
          <div className={cn(
            'flex items-center gap-2.5 rounded-md p-2 bg-slate-50',
            sidebarCollapsed && 'justify-center',
          )}>
            <div className="relative shrink-0">
              <div className="size-7 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600">
                {currentUser?.avatar
                  ? <img src={currentUser.avatar} className="size-full rounded-full object-cover" alt="" />
                  : initials}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 size-2 bg-emerald-500 border border-white rounded-full" />
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-900 truncate leading-none">{currentUser?.name}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{ROLE_LABELS[currentUser?.role ?? 'SUPER_ADMIN']}</p>
              </div>
            )}
          </div>
        </div>

      </aside>
    </TooltipProvider>
  );
}

// ─── NavRow: handles collapsed/expanded, simple/grouped items ─────────────────

function NavRow({
  item, collapsed, adminView, adminSubView, onNavigate, expandedItems, onToggleExpand,
}: {
  item: NavItem;
  collapsed: boolean;
  adminView: string;
  adminSubView: string | null;
  onNavigate: (view?: AdminView, subView?: string) => void;
  expandedItems: Record<string, boolean>;
  onToggleExpand: (view: string) => void;
}) {
  const Icon = item.icon;
  const hasSub = !!item.sub?.length;
  const isAnyChildActive = hasSub ? item.sub!.some(s => adminView === s.view && (!s.subView || adminSubView === s.subView)) : false;
  const isGroupActive = adminView === item.view || (hasSub && item.sub!.some(s => s.view === adminView));
  const isActive = (adminView === item.view && (!item.subView || adminSubView === item.subView)) || isAnyChildActive;

  // ── Collapsed ─────────────────────────────────────────────────────────────

  if (collapsed) {
    if (hasSub) {
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn(
              'flex w-full items-center justify-center h-9 rounded-md transition-colors',
              isGroupActive ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900',
            )}>
              <Icon className="size-4 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" sideOffset={8} className="w-52 p-1.5 border border-slate-100 shadow-lg rounded-xl">
            <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{item.label}</p>
            <div className="flex flex-col gap-0.5 mt-1">
              {item.sub?.map((sub) => {
                const subActive = adminView === sub.view && adminSubView === sub.subView;
                return (
                  <button
                    key={sub.label}
                    onClick={() => onNavigate(sub.view, sub.subView)}
                    className={cn(
                      'flex items-center h-8 px-3 rounded-md text-[12px] font-medium transition-colors text-left',
                      subActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                    )}
                  >
                    {sub.label}
                    {sub.badge && <span className="ml-auto text-[10px] font-bold text-rose-500">{sub.badge}</span>}
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
        <TooltipTrigger asChild>
          <button
            onClick={() => onNavigate(item.view, item.subView)}
            className={cn(
              'flex w-full items-center justify-center h-9 rounded-md transition-colors',
              isActive ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900',
            )}
          >
            <Icon className="size-4 shrink-0" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs font-semibold">
          {item.label}
          {item.badge && <span className="ml-1.5 text-[10px] font-bold text-indigo-400">{item.badge}</span>}
        </TooltipContent>
      </Tooltip>
    );
  }

  // ── Expanded ──────────────────────────────────────────────────────────────

  if (hasSub) {
    const isExpanded = !!expandedItems[item.view || ''];
    return (
      <div>
        <button
          onClick={() => {
            if (item.view) {
              onToggleExpand(item.view);
            }
            onNavigate(item.view, item.sub?.[0]?.subView);
          }}
          className={cn(
            'flex w-full items-center gap-2.5 h-9 px-3 rounded-md text-[12px] font-medium transition-colors',
            isGroupActive ? 'text-slate-900 bg-slate-50' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50',
          )}
        >
          <Icon className="size-4 shrink-0" />
          <span className="flex-1 text-left truncate">{item.label}</span>
          {item.badge && <span className="text-[10px] font-bold text-indigo-500">{item.badge}</span>}
          <ChevronDown className={cn('size-3 text-slate-300 transition-transform', isExpanded && 'rotate-180')} />
        </button>
        {isExpanded && (
          <div className="ml-[26px] mt-0.5 pl-3 border-l border-slate-100 flex flex-col gap-0.5">
            {item.sub?.map((sub) => {
              const subActive = adminSubView === sub.subView;
              return (
                <button
                  key={sub.label}
                  onClick={() => onNavigate(sub.view, sub.subView)}
                  className={cn(
                    'flex items-center h-7 px-2 rounded-md text-[11px] font-medium transition-colors text-left',
                    subActive ? 'text-slate-900 font-semibold' : 'text-slate-400 hover:text-slate-700',
                  )}
                >
                  <span className="flex-1 truncate">{sub.label}</span>
                  {sub.badge && <span className="ml-auto text-[10px] font-bold text-rose-400">{sub.badge}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onNavigate(item.view, item.subView)}
      className={cn(
        'relative flex w-full items-center gap-2.5 h-9 px-3 rounded-md text-[12px] font-medium transition-colors',
        isActive ? 'text-slate-900 bg-slate-100 font-semibold' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50',
      )}
    >
      {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-slate-900" />}
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 text-left truncate">{item.label}</span>
      {item.badge && <span className="text-[10px] font-bold text-indigo-500">{item.badge}</span>}
    </button>
  );
}

// ─── Simple nav button (used for "Voir la boutique") ─────────────────────────

function NavButton({ icon, label, collapsed, onClick }: {
  icon: React.ReactNode; label: string; collapsed: boolean; onClick: () => void;
}) {
  const btn = (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md h-9 text-[12px] font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors',
        collapsed ? 'justify-center px-0' : 'px-3',
      )}
    >
      {icon}
      {!collapsed && <span className="flex-1 text-left">{label}</span>}
    </button>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{btn}</TooltipTrigger>
        <TooltipContent side="right" className="text-xs font-semibold">{label}</TooltipContent>
      </Tooltip>
    );
  }
  return btn;
}
