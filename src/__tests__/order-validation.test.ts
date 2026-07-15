/**
 * Tests unitaires pour la validation de création de commandes (orders/route.ts)
 * On teste la logique pure de validation sans accéder à la base de données.
 */
import { describe, test, expect } from 'bun:test';

// ─── Types ────────────────────────────────────────────────────
interface OrderItemInput {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
}

interface OrderCreateInput {
  storeId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerAddress?: string;
  customerWilaya?: string;
  items: OrderItemInput[];
  total?: number;
  source?: string;
}

// ─── Fonctions de validation (reproduites depuis orders/route.ts) ──

/**
 * Vérifie les champs requis de base
 */
function validateRequiredFields(input: OrderCreateInput): string | null {
  const { storeId, customerName, customerPhone, items } = input;
  if (!storeId || !customerName || !customerPhone || !items) {
    return 'Missing required fields (storeId, customerName, customerPhone, items)';
  }
  return null;
}

/**
 * Vérifie la longueur du nom du client (2-200 caractères)
 */
function validateCustomerName(customerName: unknown): string | null {
  if (typeof customerName !== 'string') {
    return 'customerName must be 2-200 characters';
  }
  const trimmed = customerName.trim();
  if (trimmed.length > 200 || trimmed.length < 2) {
    return 'customerName must be 2-200 characters';
  }
  return null;
}

/**
 * Vérifie le format du téléphone algérien
 * Utilise la même regex que validatePhone dans validators.ts
 */
const ALGERIAN_PHONE_REGEX = /^0[5-7]\d{8}$/;

function validateCustomerPhone(phone: unknown): string | null {
  if (typeof phone !== 'string') {
    return 'customerPhone must match Algerian phone format (05XXXXXXXX or 06XXXXXXXX or 07XXXXXXXX)';
  }
  const trimmed = phone.trim();
  if (!ALGERIAN_PHONE_REGEX.test(trimmed)) {
    return 'customerPhone must match Algerian phone format (05XXXXXXXX or 06XXXXXXXX or 07XXXXXXXX)';
  }
  return null;
}

/**
 * Vérifie que les items sont un tableau non vide
 */
function validateItemsArray(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) {
    return 'items must be a non-empty array';
  }
  return null;
}

/**
 * Vérifie chaque item individuel
 */
function validateItemFields(item: Record<string, unknown>): string | null {
  if (!item.productId || !item.productName || !item.quantity || !item.price) {
    return 'Each item must have productId, productName, quantity, and price';
  }
  if (typeof item.quantity !== 'number' || item.quantity < 1) {
    return 'Item quantity must be >= 1';
  }
  if (typeof item.price !== 'number' || item.price < 0) {
    return 'Item price must be >= 0';
  }
  return null;
}

/**
 * Vérifie tous les items dun ordre
 */
function validateAllItems(items: unknown[]): string | null {
  const arrayError = validateItemsArray(items);
  if (arrayError) return arrayError;

  for (const item of items) {
    const itemError = validateItemFields(item as Record<string, unknown>);
    if (itemError) return itemError;
  }
  return null;
}

/**
 * Recalcule le total côté serveur
 * Reproduction exacte : items.reduce((sum, item) => sum + item.price * item.quantity, 0)
 */
function recalculateServerTotal(items: OrderItemInput[]): number {
  return items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
}

/**
 * Vérifie si des produits sont manquants
 */
function findMissingProductIds(items: OrderItemInput[], existingIds: Set<string>): string[] {
  return items
    .map((item) => item.productId)
    .filter((id) => !existingIds.has(id));
}

/**
 * Vérifie la disponibilité du stock
 */
interface ProductStock {
  id: string;
  name: string;
  stock: number;
  price: number;
}

function checkStockAvailability(items: OrderItemInput[], products: ProductStock[]): string[] {
  const productMap = new Map(products.map((p) => [p.id, p]));
  const outOfStock: string[] = [];

  for (const item of items) {
    const product = productMap.get(item.productId);
    if (product && product.stock < item.quantity) {
      outOfStock.push(`${product.name}: demandé ${item.quantity}, disponible ${product.stock}`);
    }
  }
  return outOfStock;
}

/**
 * Vérification complète de la commande (toutes les étapes)
 */
function validateOrderInput(input: OrderCreateInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Champs requis
  const requiredError = validateRequiredFields(input);
  if (requiredError) errors.push(requiredError);

  // Nom du client
  const nameError = validateCustomerName(input.customerName);
  if (nameError) errors.push(nameError);

  // Téléphone
  const phoneError = validateCustomerPhone(input.customerPhone);
  if (phoneError) errors.push(phoneError);

  // Items
  const itemsError = validateAllItems(input.items);
  if (itemsError) errors.push(itemsError);

  return { valid: errors.length === 0, errors };
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════
describe('Validation de création de commande', () => {
  // ─── Champs requis ─────────────────────────────────────────
  describe('validateRequiredFields', () => {
    test('retourne null quand tous les champs sont présents', () => {
      const input = makeValidInput();
      expect(validateRequiredFields(input)).toBeNull();
    });

    test('détecte storeId manquant', () => {
      const input = makeValidInput({ storeId: '' });
      expect(validateRequiredFields(input)).not.toBeNull();
    });

    test('détecte customerName manquant', () => {
      const input = makeValidInput({ customerName: '' });
      expect(validateRequiredFields(input)).not.toBeNull();
    });

    test('détecte customerPhone manquant', () => {
      const input = makeValidInput({ customerPhone: '' });
      expect(validateRequiredFields(input)).not.toBeNull();
    });

    test('détecte items manquant', () => {
      const input = makeValidInput();
      (input as Record<string, unknown>).items = null;
      expect(validateRequiredFields(input)).not.toBeNull();
    });
  });

  // ─── Validation du nom du client ───────────────────────────
  describe('validateCustomerName', () => {
    test('nom valide (2 caractères minimum)', () => {
      expect(validateCustomerName('AB')).toBeNull();
    });

    test('nom valide (200 caractères)', () => {
      const longName = 'A'.repeat(200);
      expect(validateCustomerName(longName)).toBeNull();
    });

    test('nom trop court (1 caractère)', () => {
      expect(validateCustomerName('A')).not.toBeNull();
    });

    test('nom trop long (201 caractères)', () => {
      const tooLong = 'A'.repeat(201);
      expect(validateCustomerName(tooLong)).not.toBeNull();
    });

    test('nom vide est rejeté', () => {
      expect(validateCustomerName('')).not.toBeNull();
    });

    test('nom avec uniquement des espaces est rejeté', () => {
      expect(validateCustomerName('   ')).not.toBeNull();
    });

    test('nom avec espaces au début/fin est accepté (après trim)', () => {
      expect(validateCustomerName('  Mohamed Benali  ')).toBeNull();
    });

    test('nom court avec espaces = rejeté si < 2 chars trim', () => {
      expect(validateCustomerName(' A ')).not.toBeNull(); // trim → 'A' → 1 char
    });

    test('nom qui fait exactement 2 chars trim est accepté', () => {
      expect(validateCustomerName(' AB ')).toBeNull(); // trim → 'AB' → 2 chars
    });

    test('nom qui fait exactement 3 chars trim est accepté', () => {
      expect(validateCustomerName(' A B ')).toBeNull(); // trim → 'A B' → 3 chars
    });

    test('nom null/non-string est rejeté', () => {
      expect(validateCustomerName(null)).not.toBeNull();
      expect(validateCustomerName(123)).not.toBeNull();
      expect(validateCustomerName(undefined)).not.toBeNull();
    });

    test('noms français avec accents acceptés', () => {
      expect(validateCustomerName('Nour El Houda')).toBeNull();
      expect(validateCustomerName('Jean-Pierre')).toBeNull();
      expect(validateCustomerName("M'barek")).toBeNull();
    });
  });

  // ─── Validation du téléphone ───────────────────────────────
  describe('validateCustomerPhone', () => {
    test('numéro 05 valide', () => {
      expect(validateCustomerPhone('0555123456')).toBeNull();
    });

    test('numéro 06 valide', () => {
      expect(validateCustomerPhone('0661234567')).toBeNull();
    });

    test('numéro 07 valide', () => {
      expect(validateCustomerPhone('0770345678')).toBeNull();
    });

    test('numéro avec espaces est accepté après trim', () => {
      expect(validateCustomerPhone(' 0555123456 ')).toBeNull();
    });

    test('numéro trop court est rejeté', () => {
      expect(validateCustomerPhone('055512345')).not.toBeNull();
    });

    test('numéro trop long est rejeté', () => {
      expect(validateCustomerPhone('05551234567')).not.toBeNull();
    });

    test('numéro avec mauvais préfixe est rejeté', () => {
      expect(validateCustomerPhone('0123456789')).not.toBeNull();
    });

    test('numéro null est rejeté', () => {
      expect(validateCustomerPhone(null)).not.toBeNull();
    });

    test('numéro number est rejeté (pas un string)', () => {
      expect(validateCustomerPhone(555123456 as unknown as string)).not.toBeNull();
    });
  });

  // ─── Validation des items ──────────────────────────────────
  describe('validateItemsArray', () => {
    test('tableau non vide est accepté', () => {
      expect(validateItemsArray([{ productId: 'p1', productName: 'Test', quantity: 1, price: 1000 }])).toBeNull();
    });

    test('tableau vide est rejeté', () => {
      expect(validateItemsArray([])).not.toBeNull();
    });

    test('null est rejeté', () => {
      expect(validateItemsArray(null)).not.toBeNull();
    });

    test('string est rejeté', () => {
      expect(validateItemsArray('not an array')).not.toBeNull();
    });

    test('undefined est rejeté', () => {
      expect(validateItemsArray(undefined)).not.toBeNull();
    });
  });

  describe('validateItemFields', () => {
    test('item complet est accepté', () => {
      const item = { productId: 'p1', productName: 'Produit', quantity: 2, price: 5000 };
      expect(validateItemFields(item)).toBeNull();
    });

    test('item sans productId est rejeté', () => {
      const item = { productName: 'Produit', quantity: 2, price: 5000 };
      expect(validateItemFields(item)).not.toBeNull();
    });

    test('item sans productName est rejeté', () => {
      const item = { productId: 'p1', quantity: 2, price: 5000 };
      expect(validateItemFields(item)).not.toBeNull();
    });

    test('item sans quantity est rejeté', () => {
      const item = { productId: 'p1', productName: 'Produit', price: 5000 };
      expect(validateItemFields(item)).not.toBeNull();
    });

    test('item sans price est rejeté', () => {
      const item = { productId: 'p1', productName: 'Produit', quantity: 2 };
      expect(validateItemFields(item)).not.toBeNull();
    });

    test('item avec quantity 0 est rejeté', () => {
      const item = { productId: 'p1', productName: 'Produit', quantity: 0, price: 5000 };
      expect(validateItemFields(item)).not.toBeNull();
    });

    test('item avec quantity négative est rejeté', () => {
      const item = { productId: 'p1', productName: 'Produit', quantity: -1, price: 5000 };
      expect(validateItemFields(item)).not.toBeNull();
    });

    test('item avec price négative est rejeté', () => {
      const item = { productId: 'p1', productName: 'Produit', quantity: 1, price: -100 };
      expect(validateItemFields(item)).not.toBeNull();
    });

    test('item avec price 0 est rejeté (0 est falsy dans la vérification !item.price)', () => {
      // Note : le code source utilise `!item.price` qui rejette 0 car 0 est falsy en JS
      const item = { productId: 'p1', productName: 'Produit', quantity: 1, price: 0 };
      expect(validateItemFields(item)).not.toBeNull();
    });

    test('item avec quantity non-numérique est rejeté', () => {
      const item = { productId: 'p1', productName: 'Produit', quantity: 'deux', price: 5000 };
      expect(validateItemFields(item)).not.toBeNull();
    });

    test('item avec price non-numérique est rejeté', () => {
      const item = { productId: 'p1', productName: 'Produit', quantity: 1, price: 'gratuit' };
      expect(validateItemFields(item)).not.toBeNull();
    });

    test('item avec quantity 1 (minimum valide) est accepté', () => {
      const item = { productId: 'p1', productName: 'Produit', quantity: 1, price: 5000 };
      expect(validateItemFields(item)).toBeNull();
    });

    test('item avec grande quantity est accepté', () => {
      const item = { productId: 'p1', productName: 'Produit', quantity: 99999, price: 5000 };
      expect(validateItemFields(item)).toBeNull();
    });
  });

  // ─── validateAllItems ──────────────────────────────────────
  describe('validateAllItems', () => {
    test('tous les items valides passent', () => {
      const items = [
        { productId: 'p1', productName: 'A', quantity: 1, price: 1000 },
        { productId: 'p2', productName: 'B', quantity: 2, price: 2000 },
      ];
      expect(validateAllItems(items)).toBeNull();
    });

    test('détecte un item invalide parmi plusieurs', () => {
      const items = [
        { productId: 'p1', productName: 'A', quantity: 1, price: 1000 },
        { productId: 'p2', productName: 'B', quantity: 0, price: 2000 }, // quantité 0
      ];
      expect(validateAllItems(items)).not.toBeNull();
    });
  });

  // ─── Recalcul du total côté serveur ────────────────────────
  describe('recalculateServerTotal', () => {
    test('calcule le total correct pour un seul item', () => {
      const items = [{ productId: 'p1', productName: 'A', quantity: 2, price: 5000 }];
      expect(recalculateServerTotal(items)).toBe(10000);
    });

    test('calcule le total pour plusieurs items', () => {
      const items = [
        { productId: 'p1', productName: 'A', quantity: 2, price: 5000 },
        { productId: 'p2', productName: 'B', quantity: 3, price: 3000 },
      ];
      // 5000*2 + 3000*3 = 10000 + 9000 = 19000
      expect(recalculateServerTotal(items)).toBe(19000);
    });

    test('total avec prix zéro', () => {
      const items = [{ productId: 'p1', productName: 'A', quantity: 5, price: 0 }];
      expect(recalculateServerTotal(items)).toBe(0);
    });

    test('total avec quantité 1', () => {
      const items = [{ productId: 'p1', productName: 'A', quantity: 1, price: 9999 }];
      expect(recalculateServerTotal(items)).toBe(9999);
    });

    test('total vide retourne 0', () => {
      expect(recalculateServerTotal([])).toBe(0);
    });

    test('total avec prix décimaux (arrondi implicite)', () => {
      const items = [
        { productId: 'p1', productName: 'A', quantity: 3, price: 33.33 },
      ];
      // 33.33 * 3 = 99.99
      expect(recalculateServerTotal(items)).toBeCloseTo(99.99, 5);
    });

    test('le total côté serveur ne dépend pas du total envoyé par le client', () => {
      const items = [{ productId: 'p1', productName: 'A', quantity: 2, price: 5000 }];
      const serverTotal = recalculateServerTotal(items);
      // Le client pourrait envoyer un total falsifié de 1 DA
      const clientTotal = 1;
      expect(serverTotal).toBe(10000);
      expect(clientTotal).toBe(1);
    });
  });

  // ─── Détection de produits manquants ───────────────────────
  describe('findMissingProductIds', () => {
    test('tous les produits existent', () => {
      const items = [
        { productId: 'p1', productName: 'A', quantity: 1, price: 1000 },
        { productId: 'p2', productName: 'B', quantity: 1, price: 2000 },
      ];
      const existing = new Set(['p1', 'p2']);
      expect(findMissingProductIds(items, existing)).toHaveLength(0);
    });

    test('un produit est manquant', () => {
      const items = [
        { productId: 'p1', productName: 'A', quantity: 1, price: 1000 },
        { productId: 'p999', productName: 'Inexistant', quantity: 1, price: 2000 },
      ];
      const existing = new Set(['p1', 'p2']);
      const missing = findMissingProductIds(items, existing);
      expect(missing).toEqual(['p999']);
    });

    test('tous les produits sont manquants', () => {
      const items = [
        { productId: 'x1', productName: 'A', quantity: 1, price: 1000 },
      ];
      const existing = new Set<string>();
      const missing = findMissingProductIds(items, existing);
      expect(missing).toEqual(['x1']);
    });

    test('ensemble existant vide', () => {
      const items = [
        { productId: 'p1', productName: 'A', quantity: 1, price: 1000 },
      ];
      expect(findMissingProductIds(items, new Set())).toEqual(['p1']);
    });
  });

  // ─── Vérification du stock ─────────────────────────────────
  describe('checkStockAvailability', () => {
    test('stock suffisant pour tous les items', () => {
      const items = [
        { productId: 'p1', productName: 'A', quantity: 3, price: 1000 },
      ];
      const products = [{ id: 'p1', name: 'Produit A', stock: 10, price: 1000 }];
      expect(checkStockAvailability(items, products)).toHaveLength(0);
    });

    test('stock exactement suffisant (quantité == stock)', () => {
      const items = [
        { productId: 'p1', productName: 'A', quantity: 5, price: 1000 },
      ];
      const products = [{ id: 'p1', name: 'Produit A', stock: 5, price: 1000 }];
      expect(checkStockAvailability(items, products)).toHaveLength(0);
    });

    test('stock insuffisant', () => {
      const items = [
        { productId: 'p1', productName: 'A', quantity: 10, price: 1000 },
      ];
      const products = [{ id: 'p1', name: 'Produit A', stock: 3, price: 1000 }];
      const issues = checkStockAvailability(items, products);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('Produit A');
      expect(issues[0]).toContain('10');
      expect(issues[0]).toContain('3');
    });

    test('stock à zéro', () => {
      const items = [
        { productId: 'p1', productName: 'A', quantity: 1, price: 1000 },
      ];
      const products = [{ id: 'p1', name: 'Produit A', stock: 0, price: 1000 }];
      expect(checkStockAvailability(items, products)).toHaveLength(1);
    });

    test('mix de items en stock et hors stock', () => {
      const items = [
        { productId: 'p1', productName: 'A', quantity: 2, price: 1000 },
        { productId: 'p2', productName: 'B', quantity: 5, price: 2000 },
      ];
      const products = [
        { id: 'p1', name: 'Produit A', stock: 10, price: 1000 },
        { id: 'p2', name: 'Produit B', stock: 2, price: 2000 },
      ];
      const issues = checkStockAvailability(items, products);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('Produit B');
    });
  });

  // ─── Validation complète ───────────────────────────────────
  describe('validateOrderInput (validation complète)', () => {
    test('commande entièrement valide', () => {
      const input = makeValidInput();
      const result = validateOrderInput(input);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('commande avec nom trop court', () => {
      const input = makeValidInput({ customerName: 'A' });
      const result = validateOrderInput(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('customerName'))).toBe(true);
    });

    test('commande avec téléphone invalide', () => {
      const input = makeValidInput({ customerPhone: '0123456789' });
      const result = validateOrderInput(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('phone'))).toBe(true);
    });

    test('commande avec items vides', () => {
      const input = makeValidInput();
      input.items = [];
      const result = validateOrderInput(input);
      expect(result.valid).toBe(false);
    });

    test('commande avec item quantité 0', () => {
      const input = makeValidInput();
      input.items[0].quantity = 0;
      const result = validateOrderInput(input);
      expect(result.valid).toBe(false);
    });

    test('commande avec item prix négatif', () => {
      const input = makeValidInput();
      input.items[0].price = -500;
      const result = validateOrderInput(input);
      expect(result.valid).toBe(false);
    });

    test('commande avec plusieurs erreurs', () => {
      const input = {
        storeId: '',
        customerName: '',
        customerPhone: 'invalid',
        items: [],
      } as OrderCreateInput;
      const result = validateOrderInput(input);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});

// ─── Helper ───────────────────────────────────────────────────
function makeValidInput(overrides: Partial<OrderCreateInput> = {}): OrderCreateInput {
  return {
    storeId: 'store-1',
    customerName: 'Mohamed Benali',
    customerPhone: '0555123456',
    customerEmail: 'mohamed@email.dz',
    customerAddress: 'Cité 10, Alger',
    customerWilaya: 'Alger',
    items: [
      { productId: 'p1', productName: 'Produit Test', quantity: 2, price: 5000 },
    ],
    total: 10000,
    source: 'web',
    ...overrides,
  };
}
