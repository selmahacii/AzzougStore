import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AppView,
  StorefrontView,
  AdminView,
  Store,
  ThemeConfig,
  UserRole,
} from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// User Profile — NO token, NO password stored in Zustand
// Token lives exclusively in an httpOnly cookie named "__session"
// ═══════════════════════════════════════════════════════════════

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatar: string | null;
  phone: string | null;
  employee_store_id: string | null;
  daily_target: number;
  created_at: string;
  employeeStore?: { id: string; name: string; slug: string } | null;
  ownedStores?: { id: string; name: string; slug: string }[];
}

// ═══════════════════════════════════════════════════════════════
// App State — full UI and navigation state, store context
// ═══════════════════════════════════════════════════════════════

interface AppState {
  // Navigation
  appView: AppView;
  storefrontView: StorefrontView;
  adminView: AdminView;
  adminSubView: string | null;
  setAppView: (view: AppView) => void;
  setStorefrontView: (view: StorefrontView) => void;
  setAdminView: (view: AdminView, subView?: string | null) => void;
  setAdminSubView: (subView: string | null) => void;

  // User profile — populated from /api/auth/me, NEVER contains token
  user: User | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  clearUser: () => void;
  login: (user: User, store: Store) => void;
  logout: () => void;

  // Store context
  activeStore: Store | null;
  allStores: Store[];
  setActiveStore: (store: Store | null) => void;
  setAllStores: (stores: Store[]) => void;
  switchToStore: (storeId: string) => void;

  // Selected product for detail view
  selectedProductSlug: string | null;
  setSelectedProductSlug: (slug: string | null) => void;

  // Selected order for detail view
  selectedOrderId: string | null;
  setSelectedOrderId: (id: string | null) => void;

  // Selected category for shop view
  selectedCategory: string | null;
  setSelectedCategory: (category: string | null) => void;

  // Theme (derived from active store)
  currentTheme: ThemeConfig | null;
  setCurrentTheme: (theme: ThemeConfig | null) => void;

  // Admin search term
  adminSearchTerm: string;
  setAdminSearchTerm: (term: string) => void;

  // Sidebar
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;

  // Language Locale (FR, EN, AR)
  locale: string | null;
  setLocale: (locale: string) => void;

  // Quick stock adjustment
  quickAdjustProduct: any | null;
  setQuickAdjustProduct: (product: any | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // ─── Navigation ───────────────────────────────────────────
      appView: 'storefront',
      storefrontView: 'home',
      adminView: 'overview',
      adminSubView: null,
      setAppView: (view) => set({ appView: view }),
      setStorefrontView: (view) => set({ storefrontView: view }),
      setAdminView: (view, subView = null) => set({ adminView: view, adminSubView: subView }),
      setAdminSubView: (subView) => set({ adminSubView: subView }),

      // ─── User Profile ─────────────────────────────────────────
      user: null,
      isAuthenticated: false,
      setUser: (user) => set({ user, isAuthenticated: user !== null }),
      clearUser: () => set({ user: null, isAuthenticated: false }),
      login: (user, store) => set({ user, isAuthenticated: true, activeStore: store, appView: 'admin' }),
      logout: () => set({
        user: null,
        activeStore: null,
        isAuthenticated: false,
        appView: 'storefront',
        storefrontView: 'home',
        adminView: 'overview',
        adminSubView: null,
        sidebarCollapsed: false,
      }),

      // ─── Store Context ────────────────────────────────────────
      activeStore: null,
      allStores: [],
      setActiveStore: (store) => set({ activeStore: store, currentTheme: store?.theme_config ?? null }),
      setAllStores: (stores) => set({ allStores: stores }),
      switchToStore: (storeId) => {
        const store = get().allStores.find((s) => s.id === storeId);
        if (store) {
          set({ activeStore: store, currentTheme: store.theme_config });
        }
      },

      // ─── Selection States ─────────────────────────────────────
      selectedProductSlug: null,
      setSelectedProductSlug: (slug) => set({ selectedProductSlug: slug, storefrontView: slug ? 'product' : 'shop' }),
      selectedOrderId: null,
      setSelectedOrderId: (id) => set({ selectedOrderId: id }),
      selectedCategory: null,
      setSelectedCategory: (cat) => set({ selectedCategory: cat }),

      // ─── System / UI States ───────────────────────────────────
      currentTheme: null,
      setCurrentTheme: (theme) => set({ currentTheme: theme }),
      adminSearchTerm: '',
      setAdminSearchTerm: (term) => set({ adminSearchTerm: term }),
      sidebarCollapsed: false,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      // ─── Language Locale ──────────────────────────────────────
      locale: null,
      setLocale: (locale) => set({ locale }),

      // ─── Quick stock adjustment ──────────────────────────────
      quickAdjustProduct: null,
      setQuickAdjustProduct: (quickAdjustProduct) => set({ quickAdjustProduct }),
    }),
    {
      name: 'ecommerce-app-state',
      partialize: (state) => ({
        appView: state.appView,
        storefrontView: state.storefrontView,
        adminView: state.adminView,
        adminSubView: state.adminSubView,
        selectedCategory: state.selectedCategory,
        selectedProductSlug: state.selectedProductSlug,
        adminSearchTerm: state.adminSearchTerm,
        sidebarCollapsed: state.sidebarCollapsed,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        activeStore: state.activeStore,
        locale: state.locale,
      }),
    }
  )
);
