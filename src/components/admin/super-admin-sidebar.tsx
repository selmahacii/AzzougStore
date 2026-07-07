'use client';

import React, { useState } from 'react';
import {
  LayoutDashboard,
  Zap,
  Share2,
  Package,
  ShoppingBag,
  CreditCard,
  Scan,
  Boxes,
  ChevronDown,
  ChevronUp,
  Settings,
  LogOut,
  Store,
  Warehouse,
  Bell,
  Monitor,
  Building2,
  Wallet2,
  Users,
  UserCircle,
  Truck,
  BarChart3,
  RadioTower,
  Crown,
  Ban
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { ROLE_LABELS } from '@/lib/types';
import type { AdminView } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';

interface NavItem {
  label: string;
  icon: any;
  view?: AdminView;
  badge?: string;
  badgeColor?: string;
  subItems?: { label: string; view: AdminView; subView?: string; badge?: string }[];
}

const SUPER_ADMIN_NAV: NavItem[] = [
  { label: "Tableau de bord", icon: LayoutDashboard, view: 'overview' },
  { label: "Performance (KPI)", icon: Zap, view: 'analytics' },
  { label: "Canaux de vente", icon: Share2, view: 'stores' },
  { label: "Produits", icon: Package, view: 'products' },
  {
    label: "Commandes",
    icon: ShoppingBag,
    view: 'orders',
    subItems: [
      { label: 'Nouvelles', view: 'orders' },
      { label: 'En Cours', view: 'orders' },
      { label: 'Confirmées', view: 'orders' },
      { label: 'Suivi', view: 'orders' },
      { label: 'Terminées', view: 'orders' },
      { label: 'Annulée', view: 'orders' },
      { label: 'Tous', view: 'orders' },
    ]
  },
  { label: "Point de vente", icon: CreditCard, view: 'pos', badge: 'New', badgeColor: 'bg-indigo-500' },
  {
    label: "Inventaire",
    icon: Warehouse,
    view: 'inventory',
    subItems: [
      { label: 'Surveillance', view: 'inventory' },
      { label: 'Entrepôts', view: 'inventory' },
      { label: 'Gestion Stock', view: 'inventory' },
      { label: 'Suivi de Stock', view: 'inventory' },
      { label: 'Alerte de Stock', view: 'inventory', badge: '0' },
      { label: 'Achats', view: 'inventory' },
      { label: 'Retours', view: 'inventory' },
      { label: 'Fournisseurs', view: 'inventory' },
      { label: 'Historique', view: 'inventory' },
    ]
  },
  {
    label: "Finances & Trésorerie",
    icon: Wallet2,
    view: 'finances',
    subItems: [
      { label: 'Portefeuilles', view: 'finances', subView: 'wallets' },
      { label: 'Versements', view: 'finances', subView: 'disbursements' },
      { label: 'Charges Divers', view: 'finances', subView: 'charges' },
      { label: 'Paiements', view: 'finances', subView: 'payments' },
    ]
  },
  {
    label: "Personnel",
    icon: Users,
    view: 'employees',
    subItems: [
      { label: 'Infrastructure Core', view: 'employees', subView: 'infra' },
      { label: 'Rôles', view: 'employees', subView: 'roles' },
      { label: 'Administrateurs', view: 'employees', subView: 'admins' },
      { label: 'Agents', view: 'employees', subView: 'agents' },
      { label: 'Marketers', view: 'employees', subView: 'marketers' },
    ]
  },
  {
    label: "Clients",
    icon: UserCircle,
    view: 'clients_management',
    subItems: [
      { label: 'Clients', view: 'clients_management' },
      { label: 'Liste Noire', view: 'clients_management', badge: '!' },
    ]
  },
  {
    label: "Partenaire",
    icon: Truck,
    view: 'partners',
    subItems: [
      { label: 'Intégration API', view: 'partners' },
      { label: 'Société', view: 'partners' },
      { label: 'Livreur', view: 'partners' },
    ]
  },
  {
    label: "Livraison",
    icon: Truck,
    view: 'delivery',
    subItems: [
      { label: 'Carriers & API', view: 'delivery', subView: 'carriers' },
      { label: 'Suivi de colis', view: 'delivery', subView: 'tracking' },
      { label: 'Statistiques', view: 'delivery', subView: 'stats' },
    ]
  },
  {
    label: "Analyses",
    icon: BarChart3,
    view: 'analytics',
    subItems: [
      { label: 'Commandes', view: 'analytics' },
      { label: 'Canaux de vente', view: 'analytics' },
      { label: 'Produits', view: 'analytics' },
      { label: 'Livraison', view: 'analytics' },
      { label: 'Wilayas', view: 'analytics' },
      { label: 'Agents de Confirmation', view: 'analytics' },
      { label: 'Agents de Suivi', view: 'analytics', badge: 'New' },
      { label: 'Marketer', view: 'analytics' },
    ]
  },
  {
    label: "Sendpilot",
    icon: RadioTower,
    view: 'sendpilot',
    subItems: [
      { label: 'Features', view: 'sendpilot' },
      { label: 'Canaux de messagerie', view: 'sendpilot' },
      { label: 'Campagnes', view: 'sendpilot' },
      { label: 'Modèles', view: 'sendpilot' },
    ]
  },
];

export default function SuperAdminSidebar() {
  const {
    adminView,
    adminSubView,
    setAdminView,
    setAppView,
    sidebarCollapsed,
    setSidebarCollapsed,
    toggleSidebar,
    user: currentUser,
  } = useAppStore();

  const [expandedItems, setExpandedItems] = useState<string[]>(['Commandes', 'Inventaire', 'Finances & Trésorerie']);

  const toggleExpand = (label: string) => {
    setExpandedItems(prev =>
      prev.includes(label) ? prev.filter(i => i !== label) : [...prev, label]
    );
  };

  const handleNavClick = (view?: AdminView, subView?: string) => {
    if (view) setAdminView(view, subView);
    if (window.innerWidth < 1024) {
      setSidebarCollapsed(true);
    }
  };

  return (
    <aside className={cn(
      'fixed top-0 left-0 z-50 flex h-full flex-col bg-white text-slate-600 transition-all duration-300 border-r border-neutral-200 shadow-2xl lg:shadow-none',
      sidebarCollapsed 
        ? '-translate-x-full lg:translate-x-0 lg:w-20' 
        : 'translate-x-0 w-[280px] sm:w-72'
    )}>
      {/* Brand Header */}
      <div className="flex h-24 items-center gap-3 px-6 shrink-0 border-b border-neutral-100">
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
          <div className="flex flex-col">
            <h1 className="text-lg font-bold tracking-tight text-black flex items-center gap-1">
              AzzougSystem
            </h1>
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">Enterprise Core</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-4 py-6 custom-scrollbar space-y-8">
        <div>
          {!sidebarCollapsed && (
            <p className="px-3 mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Menu</p>
          )}
          <div className="space-y-1">
            {SUPER_ADMIN_NAV.map((item) => {
              const Icon = item.icon;
              const isExpanded = expandedItems.includes(item.label);
              const isActive = adminView === item.view || (item.subItems?.some(si => si.view === adminView));

              return (
                <div key={item.label}>
                  <button
                    onClick={() => {
                      if (item.subItems) {
                        toggleExpand(item.label);
                      } else {
                        handleNavClick(item.view);
                      }
                    }}
                    className={cn(
                      'group flex w-full items-center gap-3 rounded-[2px] px-3 py-3 text-sm font-medium transition-all duration-200 uppercase tracking-widest text-[11px]',
                      isActive && !item.subItems ? 'bg-neutral-50 text-black border-l-2 border-black' : 'hover:bg-neutral-50 hover:text-black',
                      sidebarCollapsed && 'justify-center px-0'
                    )}
                  >
                    <Icon className={cn('size-4 shrink-0 transition-transform group-hover:scale-110', isActive ? 'text-black' : 'text-slate-400')} />
                    {!sidebarCollapsed && (
                      <>
                        <span className="flex-1 text-left">{item.label}</span>
                        {item.badge && (
                          <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold text-white uppercase tracking-tighter', item.badgeColor || 'bg-black')}>
                            {item.badge}
                          </span>
                        )}
                        {item.subItems && (
                          isExpanded ? <ChevronUp className="size-4 opacity-50" /> : <ChevronDown className="size-4 opacity-50" />
                        )}
                      </>
                    )}
                  </button>

                  {/* Sub-items */}
                  <AnimatePresence>
                    {!sidebarCollapsed && item.subItems && isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="ml-8 mt-1 space-y-1 overflow-hidden"
                      >
                        {item.subItems.map((sub) => (
                          <button
                            key={sub.label}
                            onClick={() => handleNavClick(sub.view, sub.subView || sub.label)}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-[2px] px-3 py-2 text-[10px] uppercase tracking-widest font-bold transition-colors',
                              (adminSubView === sub.subView || adminSubView === sub.label) ? 'text-black bg-neutral-50' : 'hover:text-black text-neutral-400'
                            )}
                          >
                            <span className="flex-1 text-left">{sub.label}</span>
                            {sub.badge && (
                              <span className="size-5 flex items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white">
                                {sub.badge}
                              </span>
                            )}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      </nav>

      {/* User Footer */}
      <div className="p-4 border-t border-neutral-100 bg-white">
        <div className={cn("flex items-center gap-3 p-2 rounded-[2px] bg-neutral-50 border border-neutral-100", sidebarCollapsed && "justify-center px-0")}>
          <div className="relative shrink-0">
            <div className="flex size-10 items-center justify-center rounded-[2px] bg-white border border-neutral-200 text-black text-sm font-black shadow-sm">
              {currentUser?.name?.[0]?.toUpperCase() || 'A'}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 size-2.5 bg-emerald-500 border-2 border-white rounded-full" />
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-widest text-black truncate">{currentUser?.name || 'Admin'}</p>
              <p className="text-[9px] font-black text-neutral-400 uppercase tracking-widest">{ROLE_LABELS[currentUser?.role || 'CONFIRMATEUR']}</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
