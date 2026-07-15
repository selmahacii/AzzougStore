/**
 * Tests unitaires pour le store applicatif (app-store.ts)
 * On reproduit la logique du Zustand store sans le middleware persist
 * pour tester navigation, gestion des boutiques, thème, et sidebar.
 */
import { describe, test, expect } from 'bun:test';

// ─── Types locaux ─────────────────────────────────────────────
type AppView = 'storefront' | 'admin';
type StorefrontView = 'home' | 'shop' | 'product' | 'cart' | 'checkout' | 'order-tracking';
type AdminView = 'overview' | 'orders' | 'employees' | 'analytics' | 'audit' | 'products' | 'stores' | 'settings';

interface ThemeConfig {
  primaryColor: string;
  primaryForeground: string;
  accentColor: string;
  fontFamily: string;
  borderRadius: string;
}

interface Store {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  description: string | null;
  logo: string | null;
  isActive: boolean;
  themeConfig: ThemeConfig;
  ownerId: string;
}

// ─── Store de test — reproduction de la logique ──────────────
function createTestStore() {
  let appView: AppView = 'storefront';
  let storefrontView: StorefrontView = 'home';
  let adminView: AdminView = 'overview';
  let activeStore: Store | null = null;
  let allStores: Store[] = [];
  let selectedProductSlug: string | null = null;
  let selectedOrderId: string | null = null;
  let currentTheme: ThemeConfig | null = null;
  let sidebarCollapsed = false;

  return {
    // Getters
    get state() {
      return {
        appView,
        storefrontView,
        adminView,
        activeStore,
        allStores,
        selectedProductSlug,
        selectedOrderId,
        currentTheme,
        sidebarCollapsed,
      };
    },

    // Navigation
    setAppView(view: AppView) { appView = view; },
    setStorefrontView(view: StorefrontView) { storefrontView = view; },
    setAdminView(view: AdminView) { adminView = view; },

    // Gestion des boutiques
    setActiveStore(store: Store | null) {
      activeStore = store;
      currentTheme = store?.themeConfig ?? null;
    },
    setAllStores(stores: Store[]) { allStores = stores; },
    switchToStore(storeId: string) {
      const store = allStores.find((s) => s.id === storeId);
      if (store) {
        activeStore = store;
        currentTheme = store.themeConfig;
      }
    },

    // Sélection produit / commande
    setSelectedProductSlug(slug: string | null) {
      selectedProductSlug = slug;
      storefrontView = slug ? 'product' : 'shop';
    },
    setSelectedOrderId(id: string | null) { selectedOrderId = id; },

    // Thème
    setCurrentTheme(theme: ThemeConfig | null) { currentTheme = theme; },

    // Sidebar
    toggleSidebar() { sidebarCollapsed = !sidebarCollapsed; },
  };
}

// ─── Helpers ──────────────────────────────────────────────────
function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    id: 'store-1',
    name: 'Boutique Test',
    slug: 'boutique-test',
    domain: null,
    description: 'Description test',
    logo: null,
    isActive: true,
    themeConfig: {
      primaryColor: '#B45309',
      primaryForeground: '#FFFFFF',
      accentColor: '#D97706',
      fontFamily: 'sans-serif',
      borderRadius: '0.75rem',
    },
    ownerId: 'user-1',
    ...overrides,
  };
}

function makeTheme(overrides: Partial<ThemeConfig> = {}): ThemeConfig {
  return {
    primaryColor: '#0F766E',
    primaryForeground: '#FFFFFF',
    accentColor: '#14B8A6',
    fontFamily: 'monospace',
    borderRadius: '1rem',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════
describe('App Store', () => {
  // ─── Valeurs par défaut ────────────────────────────────────
  describe('Valeurs par défaut', () => {
    test('appView est "storefront" par défaut', () => {
      const store = createTestStore();
      expect(store.state.appView).toBe('storefront');
    });

    test('storefrontView est "home" par défaut', () => {
      const store = createTestStore();
      expect(store.state.storefrontView).toBe('home');
    });

    test('adminView est "overview" par défaut', () => {
      const store = createTestStore();
      expect(store.state.adminView).toBe('overview');
    });

    test('activeStore est null par défaut', () => {
      const store = createTestStore();
      expect(store.state.activeStore).toBeNull();
    });

    test('allStores est un tableau vide par défaut', () => {
      const store = createTestStore();
      expect(store.state.allStores).toEqual([]);
    });

    test('selectedProductSlug est null par défaut', () => {
      const store = createTestStore();
      expect(store.state.selectedProductSlug).toBeNull();
    });

    test('selectedOrderId est null par défaut', () => {
      const store = createTestStore();
      expect(store.state.selectedOrderId).toBeNull();
    });

    test('currentTheme est null par défaut', () => {
      const store = createTestStore();
      expect(store.state.currentTheme).toBeNull();
    });

    test('sidebarCollapsed est false par défaut', () => {
      const store = createTestStore();
      expect(store.state.sidebarCollapsed).toBe(false);
    });
  });

  // ─── Navigation ────────────────────────────────────────────
  describe('Navigation', () => {
    test('setAppView change la vue principale', () => {
      const store = createTestStore();
      store.setAppView('admin');
      expect(store.state.appView).toBe('admin');
      store.setAppView('storefront');
      expect(store.state.appView).toBe('storefront');
    });

    test('setStorefrontView change la vue de la vitrine', () => {
      const store = createTestStore();
      store.setStorefrontView('shop');
      expect(store.state.storefrontView).toBe('shop');
      store.setStorefrontView('cart');
      expect(store.state.storefrontView).toBe('cart');
      store.setStorefrontView('checkout');
      expect(store.state.storefrontView).toBe('checkout');
      store.setStorefrontView('order-tracking');
      expect(store.state.storefrontView).toBe('order-tracking');
    });

    test('setAdminView change la vue admin', () => {
      const store = createTestStore();
      store.setAdminView('orders');
      expect(store.state.adminView).toBe('orders');
      store.setAdminView('employees');
      expect(store.state.adminView).toBe('employees');
      store.setAdminView('analytics');
      expect(store.state.adminView).toBe('analytics');
      store.setAdminView('stores');
      expect(store.state.adminView).toBe('stores');
    });

    test('la navigation ne modifie pas les autres états', () => {
      const store = createTestStore();
      store.setStorefrontView('shop');
      expect(store.state.appView).toBe('storefront');
      expect(store.state.adminView).toBe('overview');
    });
  });

  // ─── Gestion des boutiques ─────────────────────────────────
  describe('Gestion des boutiques', () => {
    test('setActiveStore définit la boutique active', () => {
      const store = createTestStore();
      const boutique = makeStore({ id: 's1', name: 'Ma Boutique' });
      store.setActiveStore(boutique);
      expect(store.state.activeStore).toEqual(boutique);
    });

    test('setActiveStore(null) réinitialise la boutique active', () => {
      const store = createTestStore();
      store.setActiveStore(makeStore());
      store.setActiveStore(null);
      expect(store.state.activeStore).toBeNull();
    });

    test('setActiveStore applique le thème de la boutique', () => {
      const store = createTestStore();
      const boutique = makeStore({
        themeConfig: makeTheme({ primaryColor: '#FF0000' }),
      });
      store.setActiveStore(boutique);
      expect(store.state.currentTheme).toEqual(boutique.themeConfig);
      expect(store.state.currentTheme?.primaryColor).toBe('#FF0000');
    });

    test('setActiveStore(null) réinitialise le thème à null', () => {
      const store = createTestStore();
      store.setActiveStore(makeStore());
      store.setActiveStore(null);
      expect(store.state.currentTheme).toBeNull();
    });

    test('setAllStores stocke la liste complète', () => {
      const store = createTestStore();
      const stores = [
        makeStore({ id: 's1' }),
        makeStore({ id: 's2' }),
        makeStore({ id: 's3' }),
      ];
      store.setAllStores(stores);
      expect(store.state.allStores).toHaveLength(3);
      expect(store.state.allStores[0].id).toBe('s1');
    });

    test('setAllStores accepte un tableau vide', () => {
      const store = createTestStore();
      store.setAllStores([]);
      expect(store.state.allStores).toEqual([]);
    });

    test('switchToStore trouve et définit la boutique active', () => {
      const store = createTestStore();
      const s1 = makeStore({ id: 's1', name: 'Première' });
      const s2 = makeStore({ id: 's2', name: 'Deuxième' });
      store.setAllStores([s1, s2]);
      store.switchToStore('s2');
      expect(store.state.activeStore?.id).toBe('s2');
      expect(store.state.activeStore?.name).toBe('Deuxième');
    });

    test('switchToStore applique le thème de la boutique ciblée', () => {
      const store = createTestStore();
      const s1 = makeStore({ id: 's1' });
      const s2 = makeStore({
        id: 's2',
        themeConfig: makeTheme({ primaryColor: '#00FF00' }),
      });
      store.setAllStores([s1, s2]);
      store.switchToStore('s2');
      expect(store.state.currentTheme?.primaryColor).toBe('#00FF00');
    });

    test('switchToStore ne fait rien si le storeId nexiste pas', () => {
      const store = createTestStore();
      store.setAllStores([makeStore({ id: 's1' })]);
      store.switchToStore('inexistant');
      expect(store.state.activeStore).toBeNull();
    });

    test('switchToStore ne fait rien si allStores est vide', () => {
      const store = createTestStore();
      store.switchToStore('s1');
      expect(store.state.activeStore).toBeNull();
    });
  });

  // ─── Thème ─────────────────────────────────────────────────
  describe('Thème', () => {
    test('setCurrentTheme définit le thème manuellement', () => {
      const store = createTestStore();
      const theme = makeTheme({ primaryColor: '#ABCDEF' });
      store.setCurrentTheme(theme);
      expect(store.state.currentTheme).toEqual(theme);
    });

    test('setCurrentTheme(null) efface le thème', () => {
      const store = createTestStore();
      store.setCurrentTheme(makeTheme());
      store.setCurrentTheme(null);
      expect(store.state.currentTheme).toBeNull();
    });

    test('le thème est mis à jour automatiquement par setActiveStore', () => {
      const store = createTestStore();
      store.setCurrentTheme(makeTheme({ primaryColor: '#OLD' }));
      const boutique = makeStore({
        themeConfig: makeTheme({ primaryColor: '#NEW' }),
      });
      store.setActiveStore(boutique);
      expect(store.state.currentTheme?.primaryColor).toBe('#NEW');
    });

    test('le thème est mis à jour automatiquement par switchToStore', () => {
      const store = createTestStore();
      const themeOriginal = makeTheme({ primaryColor: '#ORIGINAL' });
      store.setCurrentTheme(themeOriginal);

      const s1 = makeStore({
        id: 's1',
        themeConfig: makeTheme({ primaryColor: '#S1THEME' }),
      });
      store.setAllStores([s1]);
      store.switchToStore('s1');
      expect(store.state.currentTheme?.primaryColor).toBe('#S1THEME');
    });
  });

  // ─── Sélection produit ─────────────────────────────────────
  describe('Sélection produit', () => {
    test('setSelectedProductSlug définit le slug et passe à la vue produit', () => {
      const store = createTestStore();
      store.setSelectedProductSlug('mon-produit');
      expect(store.state.selectedProductSlug).toBe('mon-produit');
      expect(store.state.storefrontView).toBe('product');
    });

    test('setSelectedProductSlug(null) efface le slug et passe à shop', () => {
      const store = createTestStore();
      store.setSelectedProductSlug('prod-1');
      store.setSelectedProductSlug(null);
      expect(store.state.selectedProductSlug).toBeNull();
      expect(store.state.storefrontView).toBe('shop');
    });

    test('changement de slug met à jour correctement la vue', () => {
      const store = createTestStore();
      store.setSelectedProductSlug('premier');
      expect(store.state.storefrontView).toBe('product');
      store.setSelectedProductSlug('deuxieme');
      expect(store.state.selectedProductSlug).toBe('deuxieme');
      expect(store.state.storefrontView).toBe('product');
    });
  });

  // ─── Sélection commande ────────────────────────────────────
  describe('Sélection commande', () => {
    test('setSelectedOrderId définit lID', () => {
      const store = createTestStore();
      store.setSelectedOrderId('order-123');
      expect(store.state.selectedOrderId).toBe('order-123');
    });

    test('setSelectedOrderId(null) efface lID', () => {
      const store = createTestStore();
      store.setSelectedOrderId('order-123');
      store.setSelectedOrderId(null);
      expect(store.state.selectedOrderId).toBeNull();
    });

    test('setSelectedOrderId ne modifie pas les autres états', () => {
      const store = createTestStore();
      store.setStorefrontView('shop');
      store.setSelectedOrderId('order-456');
      expect(store.state.storefrontView).toBe('shop');
      expect(store.state.adminView).toBe('overview');
    });
  });

  // ─── Sidebar ───────────────────────────────────────────────
  describe('Sidebar', () => {
    test('toggleSidebar inverse létat', () => {
      const store = createTestStore();
      store.toggleSidebar();
      expect(store.state.sidebarCollapsed).toBe(true);
      store.toggleSidebar();
      expect(store.state.sidebarCollapsed).toBe(false);
    });

    test('plusieurs toggles fonctionnent correctement', () => {
      const store = createTestStore();
      store.toggleSidebar(); // true
      store.toggleSidebar(); // false
      store.toggleSidebar(); // true
      store.toggleSidebar(); // false
      expect(store.state.sidebarCollapsed).toBe(false);
    });

    test('sidebarCollapsed est indépendant des autres états', () => {
      const store = createTestStore();
      store.toggleSidebar();
      store.setAppView('admin');
      store.setAdminView('orders');
      expect(store.state.sidebarCollapsed).toBe(true);
      expect(store.state.adminView).toBe('orders');
    });
  });

  // ─── Scénarios dintégration ────────────────────────────────
  describe('Scénarios dintégration', () => {
    test('flux complet : initialisation → navigation admin → retour vitrine', () => {
      const store = createTestStore();
      // Début : storefront home
      expect(store.state.appView).toBe('storefront');
      expect(store.state.storefrontView).toBe('home');

      // Passage admin
      store.setAppView('admin');
      store.setAdminView('orders');
      expect(store.state.appView).toBe('admin');
      expect(store.state.adminView).toBe('orders');

      // Retour vitrine
      store.setAppView('storefront');
      expect(store.state.appView).toBe('storefront');
      // adminView ne change pas
      expect(store.state.adminView).toBe('orders');
    });

    test('flux complet : chargement boutiques → sélection → changement', () => {
      const store = createTestStore();
      const s1 = makeStore({ id: 's1', name: 'B1', themeConfig: makeTheme({ primaryColor: '#111' }) });
      const s2 = makeStore({ id: 's2', name: 'B2', themeConfig: makeTheme({ primaryColor: '#222' }) });

      store.setAllStores([s1, s2]);
      store.switchToStore('s1');
      expect(store.state.activeStore?.id).toBe('s1');
      expect(store.state.currentTheme?.primaryColor).toBe('#111');

      store.switchToStore('s2');
      expect(store.state.activeStore?.id).toBe('s2');
      expect(store.state.currentTheme?.primaryColor).toBe('#222');
    });

    test('définition produit annule la navigation storefront en cours', () => {
      const store = createTestStore();
      store.setStorefrontView('checkout');
      store.setSelectedProductSlug('nouveau-slug');
      expect(store.state.storefrontView).toBe('product');
      expect(store.state.selectedProductSlug).toBe('nouveau-slug');
    });

    test('annulation sélection produit revient à shop', () => {
      const store = createTestStore();
      store.setStorefrontView('checkout');
      store.setSelectedProductSlug(null);
      expect(store.state.storefrontView).toBe('shop');
    });
  });
});
