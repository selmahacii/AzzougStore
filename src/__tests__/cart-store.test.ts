/**
 * Tests unitaires pour le store panier (cart-store.ts)
 * On reproduit la logique du Zustand store sans le middleware persist
 * afin de tester les opérations addItem, removeItem, updateQuantity, etc.
 */
import { describe, test, expect } from 'bun:test';

// ─── Types locaux (répliques de src/lib/types) ────────────────
interface ProductVariant {
  name: string;
  value: string;
  priceModifier?: number;
}

interface Product {
  id: string;
  storeId: string;
  name: string;
  slug: string;
  price: number;
  comparePrice: number | null;
  stock: number;
  images: string[];
  variants: ProductVariant[] | null;
  category: string | null;
  isActive: boolean;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CartItem {
  product: Product;
  quantity: number;
  selectedVariant?: string;
}

// ─── Store de test — reproduction exacte de la logique métier ─
function createTestStore() {
  let items: CartItem[] = [];
  let isOpen = false;

  return {
    get state() {
      return { items, isOpen };
    },

    addItem(product: Product, quantity = 1, variant?: string) {
      const current = [...items];
      const key = variant ? `${product.id}-${variant}` : product.id;
      const existingIdx = current.findIndex((item) =>
        variant
          ? `${item.product.id}-${item.selectedVariant}` === key
          : item.product.id === product.id && !item.selectedVariant
      );

      if (existingIdx >= 0) {
        current[existingIdx] = {
          ...current[existingIdx],
          quantity: current[existingIdx].quantity + quantity,
        };
      } else {
        current.push({ product, quantity, selectedVariant: variant });
      }
      items = current;
    },

    removeItem(productId: string, variant?: string) {
      items = items.filter((item) =>
        variant
          ? !(item.product.id === productId && item.selectedVariant === variant)
          : item.product.id !== productId
      );
    },

    updateQuantity(productId: string, quantity: number, variant?: string) {
      if (quantity <= 0) {
        this.removeItem(productId, variant);
        return;
      }
      items = items.map((item) =>
        variant
          ? item.product.id === productId && item.selectedVariant === variant
            ? { ...item, quantity }
            : item
          : item.product.id === productId
            ? { ...item, quantity }
            : item
      );
    },

    clearCart() {
      items = [];
    },

    toggleCart() {
      isOpen = !isOpen;
    },

    openCart() {
      isOpen = true;
    },

    closeCart() {
      isOpen = false;
    },

    totalItems(): number {
      return items.reduce((sum, item) => sum + item.quantity, 0);
    },

    totalPrice(): number {
      return items.reduce(
        (sum, item) => {
          const modifier = item.selectedVariant
            ? item.product.variants?.find(
                (v) => v.value === item.selectedVariant
              )?.priceModifier ?? 0
            : 0;
          return sum + (item.product.price + modifier) * item.quantity;
        },
        0
      );
    },

    getItemQuantity(productId: string, variant?: string): number {
      const item = items.find((i) =>
        variant
          ? i.product.id === productId && i.selectedVariant === variant
          : i.product.id === productId && !i.selectedVariant
      );
      return item?.quantity ?? 0;
    },
  };
}

// ─── Helpers pour créer des produits de test ──────────────────
function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    storeId: 'store-1',
    name: 'Produit Test',
    slug: 'produit-test',
    price: 1000,
    comparePrice: null,
    stock: 10,
    images: [],
    variants: null,
    category: 'Test',
    isActive: true,
    featured: false,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════
describe('Cart Store', () => {
  // ─── addItem ────────────────────────────────────────────────
  describe('addItem', () => {
    test('ajoute un produit au panier vide', () => {
      const store = createTestStore();
      const product = makeProduct();
      store.addItem(product);
      expect(store.state.items).toHaveLength(1);
      expect(store.state.items[0].product.id).toBe('prod-1');
      expect(store.state.items[0].quantity).toBe(1);
      expect(store.state.items[0].selectedVariant).toBeUndefined();
    });

    test('ajoute un produit avec une quantité personnalisée', () => {
      const store = createTestStore();
      const product = makeProduct();
      store.addItem(product, 5);
      expect(store.state.items).toHaveLength(1);
      expect(store.state.items[0].quantity).toBe(5);
    });

    test('incrément la quantité si le même produit est ajouté deux fois', () => {
      const store = createTestStore();
      const product = makeProduct();
      store.addItem(product, 2);
      store.addItem(product, 3);
      expect(store.state.items).toHaveLength(1);
      expect(store.state.items[0].quantity).toBe(5);
    });

    test('crée une entrée séparée pour chaque variante', () => {
      const store = createTestStore();
      const product = makeProduct({
        variants: [
          { name: 'Taille', value: 'S' },
          { name: 'Taille', value: 'M' },
        ],
      });
      store.addItem(product, 1, 'S');
      store.addItem(product, 1, 'M');
      expect(store.state.items).toHaveLength(2);
      expect(store.state.items[0].selectedVariant).toBe('S');
      expect(store.state.items[1].selectedVariant).toBe('M');
    });

    test('incrément la quantité pour la même variante', () => {
      const store = createTestStore();
      const product = makeProduct({
        variants: [{ name: 'Couleur', value: 'rouge' }],
      });
      store.addItem(product, 2, 'rouge');
      store.addItem(product, 3, 'rouge');
      expect(store.state.items).toHaveLength(1);
      expect(store.state.items[0].quantity).toBe(5);
    });

    test('un produit sans variante et un produit avec variante sont des entrées séparées', () => {
      const store = createTestStore();
      const product = makeProduct({
        variants: [{ name: 'Taille', value: 'L' }],
      });
      store.addItem(product, 1);
      store.addItem(product, 1, 'L');
      expect(store.state.items).toHaveLength(2);
    });

    test('ajoute plusieurs produits différents', () => {
      const store = createTestStore();
      const p1 = makeProduct({ id: 'prod-1' });
      const p2 = makeProduct({ id: 'prod-2' });
      const p3 = makeProduct({ id: 'prod-3' });
      store.addItem(p1);
      store.addItem(p2);
      store.addItem(p3);
      expect(store.state.items).toHaveLength(3);
    });
  });

  // ─── removeItem ─────────────────────────────────────────────
  describe('removeItem', () => {
    test('supprime un produit par productId', () => {
      const store = createTestStore();
      const p1 = makeProduct({ id: 'prod-1' });
      const p2 = makeProduct({ id: 'prod-2' });
      store.addItem(p1);
      store.addItem(p2);
      store.removeItem('prod-1');
      expect(store.state.items).toHaveLength(1);
      expect(store.state.items[0].product.id).toBe('prod-2');
    });

    test('supprime un produit spécifique par variante', () => {
      const store = createTestStore();
      const product = makeProduct({
        variants: [
          { name: 'Taille', value: 'S' },
          { name: 'Taille', value: 'M' },
        ],
      });
      store.addItem(product, 1, 'S');
      store.addItem(product, 1, 'M');
      store.removeItem('prod-1', 'S');
      expect(store.state.items).toHaveLength(1);
      expect(store.state.items[0].selectedVariant).toBe('M');
    });

    test('ne supprime pas un produit sans variante quand on filtre par variante', () => {
      const store = createTestStore();
      const product = makeProduct({ id: 'prod-1' });
      store.addItem(product);
      store.removeItem('prod-1', 'S');
      // La variante 'S' n'existe pas, donc l'entrée sans variante est conservée
      expect(store.state.items).toHaveLength(1);
    });

    test('retire un produit sans toucher aux autres', () => {
      const store = createTestStore();
      const p1 = makeProduct({ id: 'a' });
      const p2 = makeProduct({ id: 'b' });
      const p3 = makeProduct({ id: 'c' });
      store.addItem(p1, 3);
      store.addItem(p2, 5);
      store.addItem(p3, 2);
      store.removeItem('b');
      expect(store.state.items).toHaveLength(2);
      expect(store.getItemQuantity('a')).toBe(3);
      expect(store.getItemQuantity('c')).toBe(2);
    });

    test('removeItem sur un id inexistant ne fait rien', () => {
      const store = createTestStore();
      store.addItem(makeProduct({ id: 'p1' }));
      store.removeItem('inexistant');
      expect(store.state.items).toHaveLength(1);
    });
  });

  // ─── updateQuantity ─────────────────────────────────────────
  describe('updateQuantity', () => {
    test('modifie la quantité dun produit existant', () => {
      const store = createTestStore();
      const product = makeProduct({ id: 'p1' });
      store.addItem(product, 3);
      store.updateQuantity('p1', 7);
      expect(store.getItemQuantity('p1')).toBe(7);
    });

    test('quantité 0 supprime larticle du panier', () => {
      const store = createTestStore();
      const product = makeProduct({ id: 'p1' });
      store.addItem(product, 5);
      store.updateQuantity('p1', 0);
      expect(store.state.items).toHaveLength(0);
    });

    test('quantité négative supprime larticle du panier', () => {
      const store = createTestStore();
      const product = makeProduct({ id: 'p1' });
      store.addItem(product, 2);
      store.updateQuantity('p1', -3);
      expect(store.state.items).toHaveLength(0);
    });

    test('met à jour la quantité dun produit avec variante', () => {
      const store = createTestStore();
      const product = makeProduct({
        id: 'p1',
        variants: [{ name: 'C', value: 'bleu' }],
      });
      store.addItem(product, 1, 'bleu');
      store.updateQuantity('p1', 10, 'bleu');
      expect(store.getItemQuantity('p1', 'bleu')).toBe(10);
    });

    test('ne modifie pas un produit avec variante si variante ne correspond pas', () => {
      const store = createTestStore();
      const product = makeProduct({
        id: 'p1',
        variants: [
          { name: 'C', value: 'bleu' },
          { name: 'C', value: 'rouge' },
        ],
      });
      store.addItem(product, 2, 'bleu');
      store.addItem(product, 3, 'rouge');
      store.updateQuantity('p1', 99, 'bleu');
      expect(store.getItemQuantity('p1', 'bleu')).toBe(99);
      expect(store.getItemQuantity('p1', 'rouge')).toBe(3);
    });

    test('updateQuantity sur un produit inexistant ne fait rien', () => {
      const store = createTestStore();
      store.updateQuantity('inexistant', 5);
      expect(store.state.items).toHaveLength(0);
    });
  });

  // ─── totalItems ─────────────────────────────────────────────
  describe('totalItems', () => {
    test('retourne 0 pour un panier vide', () => {
      const store = createTestStore();
      expect(store.totalItems()).toBe(0);
    });

    test('calcule la somme totale des quantités', () => {
      const store = createTestStore();
      store.addItem(makeProduct({ id: 'a' }), 3);
      store.addItem(makeProduct({ id: 'b' }), 5);
      store.addItem(makeProduct({ id: 'c' }), 2);
      expect(store.totalItems()).toBe(10);
    });

    test('recalcule après removeItem', () => {
      const store = createTestStore();
      store.addItem(makeProduct({ id: 'a' }), 5);
      store.addItem(makeProduct({ id: 'b' }), 3);
      store.removeItem('a');
      expect(store.totalItems()).toBe(3);
    });

    test('recalcule après updateQuantity', () => {
      const store = createTestStore();
      store.addItem(makeProduct({ id: 'a' }), 2);
      store.updateQuantity('a', 7);
      expect(store.totalItems()).toBe(7);
    });
  });

  // ─── totalPrice ─────────────────────────────────────────────
  describe('totalPrice', () => {
    test('retourne 0 pour un panier vide', () => {
      const store = createTestStore();
      expect(store.totalPrice()).toBe(0);
    });

    test('calcule le prix total sans variantes', () => {
      const store = createTestStore();
      store.addItem(makeProduct({ id: 'a', price: 1000 }), 2);
      store.addItem(makeProduct({ id: 'b', price: 500 }), 3);
      // 1000*2 + 500*3 = 2000 + 1500 = 3500
      expect(store.totalPrice()).toBe(3500);
    });

    test('applique le modificateur de prix de la variante', () => {
      const store = createTestStore();
      const product = makeProduct({
        id: 'a',
        price: 1000,
        variants: [{ name: 'Taille', value: 'XL', priceModifier: 200 }],
      });
      store.addItem(product, 3, 'XL');
      // (1000 + 200) * 3 = 3600
      expect(store.totalPrice()).toBe(3600);
    });

    test('modificateur de variante négatif réduit le prix', () => {
      const store = createTestStore();
      const product = makeProduct({
        id: 'a',
        price: 1000,
        variants: [{ name: 'Taille', value: 'S', priceModifier: -100 }],
      });
      store.addItem(product, 2, 'S');
      // (1000 - 100) * 2 = 1800
      expect(store.totalPrice()).toBe(1800);
    });

    test('variante sans priceModifier utilise 0 comme valeur par défaut', () => {
      const store = createTestStore();
      const product = makeProduct({
        id: 'a',
        price: 1000,
        variants: [{ name: 'C', value: 'rouge' }], // pas de priceModifier
      });
      store.addItem(product, 4, 'rouge');
      // (1000 + 0) * 4 = 4000
      expect(store.totalPrice()).toBe(4000);
    });

    test('produit sans variantes ne cherche pas de modificateur', () => {
      const store = createTestStore();
      const product = makeProduct({ id: 'a', price: 500, variants: null });
      store.addItem(product, 10);
      expect(store.totalPrice()).toBe(5000);
    });

    test('mélange de produits avec et sans variantes', () => {
      const store = createTestStore();
      const p1 = makeProduct({ id: 'a', price: 1000, variants: null });
      const p2 = makeProduct({
        id: 'b',
        price: 500,
        variants: [{ name: 'T', value: 'L', priceModifier: 100 }],
      });
      store.addItem(p1, 2); // 1000*2 = 2000
      store.addItem(p2, 3, 'L'); // (500+100)*3 = 1800
      expect(store.totalPrice()).toBe(3800);
    });
  });

  // ─── clearCart ──────────────────────────────────────────────
  describe('clearCart', () => {
    test('vide le panier complètement', () => {
      const store = createTestStore();
      store.addItem(makeProduct({ id: 'a' }), 5);
      store.addItem(makeProduct({ id: 'b' }), 3);
      store.clearCart();
      expect(store.state.items).toHaveLength(0);
      expect(store.totalItems()).toBe(0);
      expect(store.totalPrice()).toBe(0);
    });

    test('clearCart sur un panier déjà vide ne lève pas derreur', () => {
      const store = createTestStore();
      store.clearCart();
      expect(store.state.items).toHaveLength(0);
    });
  });

  // ─── getItemQuantity ────────────────────────────────────────
  describe('getItemQuantity', () => {
    test('retourne 0 pour un produit inexistant', () => {
      const store = createTestStore();
      expect(store.getItemQuantity('inexistant')).toBe(0);
    });

    test('retourne 0 pour une variante inexistante', () => {
      const store = createTestStore();
      store.addItem(makeProduct({ id: 'p1' }));
      expect(store.getItemQuantity('p1', 'S')).toBe(0);
    });

    test('retourne la quantité correcte pour un produit sans variante', () => {
      const store = createTestStore();
      store.addItem(makeProduct({ id: 'p1' }), 7);
      expect(store.getItemQuantity('p1')).toBe(7);
    });

    test('retourne la quantité correcte pour un produit avec variante', () => {
      const store = createTestStore();
      const product = makeProduct({
        variants: [{ name: 'T', value: 'M' }],
      });
      store.addItem(product, 4, 'M');
      expect(store.getItemQuantity('prod-1', 'M')).toBe(4);
    });

    test('ne confond pas un produit sans variante et un produit avec variante', () => {
      const store = createTestStore();
      const product = makeProduct({
        variants: [{ name: 'T', value: 'L' }],
      });
      store.addItem(product, 2); // sans variante
      store.addItem(product, 3, 'L'); // avec variante
      expect(store.getItemQuantity('prod-1')).toBe(2);
      expect(store.getItemQuantity('prod-1', 'L')).toBe(3);
    });
  });

  // ─── toggleCart / openCart / closeCart ─────────────────────
  describe('toggleCart / openCart / closeCart', () => {
    test('le panier est fermé par défaut', () => {
      const store = createTestStore();
      expect(store.state.isOpen).toBe(false);
    });

    test('toggleCart ouvre le panier', () => {
      const store = createTestStore();
      store.toggleCart();
      expect(store.state.isOpen).toBe(true);
    });

    test('toggleCart referme le panier si déjà ouvert', () => {
      const store = createTestStore();
      store.toggleCart();
      store.toggleCart();
      expect(store.state.isOpen).toBe(false);
    });

    test('openCart ouvre le panier', () => {
      const store = createTestStore();
      store.openCart();
      expect(store.state.isOpen).toBe(true);
    });

    test('closeCart ferme le panier', () => {
      const store = createTestStore();
      store.openCart();
      store.closeCart();
      expect(store.state.isOpen).toBe(false);
    });

    test('closeCart sur un panier déjà fermé ne pose pas de problème', () => {
      const store = createTestStore();
      store.closeCart();
      expect(store.state.isOpen).toBe(false);
    });
  });

  // ─── Format de clé variant (edge cases) ────────────────────
  describe('Variant key format', () => {
    test('la clé est productId seul quand pas de variante', () => {
      const store = createTestStore();
      const product = makeProduct({ id: 'test-123' });
      store.addItem(product);
      // Larticle stocké na pas de selectedVariant
      expect(store.state.items[0].selectedVariant).toBeUndefined();
    });

    test('la clé est productId-variantValue quand variante fournie', () => {
      const store = createTestStore();
      const product = makeProduct({
        id: 'test-123',
        variants: [{ name: 'Couleur', value: 'noir' }],
      });
      store.addItem(product, 1, 'noir');
      expect(store.state.items[0].selectedVariant).toBe('noir');
    });

    test('deux variantes différentes du même produit sont bien séparées', () => {
      const store = createTestStore();
      const product = makeProduct({
        id: 'unique',
        variants: [
          { name: 'Couleur', value: 'blanc' },
          { name: 'Couleur', value: 'noir' },
        ],
      });
      store.addItem(product, 1, 'blanc');
      store.addItem(product, 1, 'noir');
      store.updateQuantity('unique', 5, 'noir');
      // Blanc doit rester à 1
      expect(store.getItemQuantity('unique', 'blanc')).toBe(1);
      // Noir doit être passé à 5
      expect(store.getItemQuantity('unique', 'noir')).toBe(5);
    });
  });
});
