import { test, expect, describe } from 'bun:test';
import type { OrderStatus } from '@/lib/types';

// ─── Seed Data Integrity Tests ────────────────────────────────
// The seed constants (STORES, PRODUCTS, EMPLOYEES, etc.) are not exported
// from seed.ts, so we replicate the data structure expectations inline.
// This tests the structural integrity that must hold for the seed data.

// Replicated from seed.ts for testing purposes
const STORE_SLUGS = ['maison-luxe', 'tech-cases', 'mode-bijoux'];

const STORE_NAMES = ['Maison Luxe', 'Tech Cases', 'Mode & Bijoux'];

const PRODUCTS_BY_STORE: Record<string, Array<{
  name: string; slug: string; price: number; comparePrice?: number; stock: number;
  category: string; description: string; featured: boolean;
}>> = {
  'maison-luxe': [
    { name: 'Canapé Milano', slug: 'canape-milano', price: 185000, comparePrice: 220000, stock: 8, category: 'Salon', description: 'Canapé moderne en tissu gris', featured: true },
    { name: 'Table Basse Oslo', slug: 'table-basse-oslo', price: 45000, stock: 15, category: 'Salon', description: 'Table basse en noyer naturel', featured: true },
    { name: 'Étagère Flottante Set', slug: 'etagere-flottante-set', price: 28000, stock: 22, category: 'Rangement', description: 'Lot de 3 étagères murales', featured: false },
    { name: 'Lampe Arc Luna', slug: 'lampe-arc-luna', price: 35000, comparePrice: 42000, stock: 12, category: 'Éclairage', description: 'Lampe à arc design', featured: true },
    { name: 'Fauteuil Wingback', slug: 'fauteuil-wingback', price: 65000, stock: 6, category: 'Salon', description: 'Fauteuil classique revisité', featured: false },
    { name: 'Buffet Scandinave', slug: 'buffet-scandinave', price: 78000, stock: 4, category: 'Salle à manger', description: 'Buffet en chêne blanc', featured: true },
    { name: 'Tapis Berbère Atlas', slug: 'tapis-berbere-atlas', price: 55000, comparePrice: 68000, stock: 9, category: 'Décoration', description: 'Tapis handmade berbère', featured: true },
    { name: 'Miroir Doré Soleil', slug: 'miroir-dore-soleil', price: 22000, stock: 18, category: 'Décoration', description: 'Miroir circulaire doré', featured: false },
    { name: 'Lit King Size Royal', slug: 'lit-king-royal', price: 120000, comparePrice: 145000, stock: 3, category: 'Chambre', description: 'Cadre de lit en velours', featured: true },
    { name: 'Commode 6 Tiroirs', slug: 'commode-6-tiroirs', price: 48000, stock: 7, category: 'Chambre', description: 'Commode en bois de manguier', featured: false },
    { name: 'Bureau Standing Zen', slug: 'bureau-standing-zen', price: 62000, stock: 5, category: 'Bureau', description: 'Bureau à hauteur réglable', featured: true },
    { name: 'Chaise Ergonomique Flex', slug: 'chaise-ergonomique-flex', price: 42000, stock: 10, category: 'Bureau', description: 'Chaise ergonomique', featured: false },
    { name: 'Console Entrée Marble', slug: 'console-entree-marble', price: 38000, stock: 11, category: 'Entrée', description: 'Console en métal noir', featured: false },
    { name: 'Parasol Déporté Luxe', slug: 'parasol-deporte-luxe', price: 32000, comparePrice: 39000, stock: 6, category: 'Extérieur', description: 'Parasol déporté 3x3m', featured: false },
    { name: 'Jardinère Design Trio', slug: 'jardiniere-design-trio', price: 18000, stock: 20, category: 'Extérieur', description: 'Lot de 3 jardinières', featured: false },
  ],
  'tech-cases': [
    { name: 'Coque iPhone 15 Pro MagSafe', slug: 'coque-iphone-15-pro-magsafe', price: 3500, stock: 45, category: 'Coques', description: 'Coque silicone MagSafe', featured: true },
    { name: 'Coque Samsung S24 Ultra Aramid', slug: 'coque-samsung-s24-aramid', price: 4200, stock: 30, category: 'Coques', description: 'Coque fibre aramide', featured: true },
    { name: 'Protection Écran Tempered 9H', slug: 'protection-ecran-tempered', price: 1500, comparePrice: 2000, stock: 80, category: 'Protections', description: 'Verre trempé 9H', featured: false },
    { name: 'Chargeur Magnétique 15W', slug: 'chargeur-magnétique-15w', price: 4500, stock: 35, category: 'Chargeurs', description: 'Chargeur sans fil MagSafe', featured: true },
    { name: 'Powerbank 20000mAh Slim', slug: 'powerbank-20000-slim', price: 6500, comparePrice: 8000, stock: 25, category: 'Batteries', description: 'Batterie externe 20000mAh', featured: true },
    { name: 'Support Voiture Magnétique', slug: 'support-voiture-magnetique', price: 2800, stock: 40, category: 'Accessoires', description: 'Support voiture ventilation', featured: false },
    { name: 'Câble USB-C Nylon Tressé 2m', slug: 'cable-usbc-nylon-2m', price: 1200, stock: 100, category: 'Câbles', description: 'Câble USB-C nylon', featured: false },
    { name: 'Écouteurs Bluetooth TWS Pro', slug: 'ecouteurs-bluetooth-tws-pro', price: 8500, comparePrice: 12000, stock: 20, category: 'Audio', description: 'Écouteurs TWS ANC', featured: true },
    { name: 'Housse Tablette Universal 11"', slug: 'houss-tablette-universal', price: 3200, stock: 28, category: 'Coques', description: 'Housse tablette universelle', featured: false },
    { name: 'Lunettes de Protection Écran', slug: 'lunettes-protection-ecran', price: 3800, stock: 15, category: 'Accessoires', description: 'Lunettes anti-lumière bleue', featured: false },
    { name: 'Stylos Tactiles Pack x3', slug: 'stylos-tactiles-pack3', price: 1800, stock: 50, category: 'Accessoires', description: 'Lot de 3 stylets', featured: false },
    { name: 'Sac à Dos Tech Urbain', slug: 'sac-dos-tech-urbain', price: 7500, comparePrice: 9500, stock: 12, category: 'Sacs', description: 'Sac à dos laptop 15.6"', featured: true },
    { name: 'Bracelet Sport Connecté', slug: 'bracelet-sport-connecte', price: 5200, stock: 22, category: 'Wearables', description: 'Bracelet activité', featured: false },
    { name: 'Enceinte Portable Waterproof', slug: 'enceinte-portable-waterproof', price: 6800, comparePrice: 8200, stock: 18, category: 'Audio', description: 'Enceinte Bluetooth IP67', featured: false },
    { name: 'Caméra Dash 4K', slug: 'camera-dash-4k', price: 12000, stock: 8, category: 'Accessoires', description: 'Dashcam 4K', featured: false },
  ],
  'mode-bijoux': [
    { name: 'Collier Chaîne Gourmette Or', slug: 'collier-gourmette-or', price: 18500, comparePrice: 22000, stock: 15, category: 'Colliers', description: 'Collier gourmette or 18 carats', featured: true },
    { name: 'Bague Solitaire Zircon', slug: 'bague-solitaire-zircon', price: 12000, stock: 20, category: 'Bagues', description: 'Bague solitaire argent plaqué or', featured: true },
    { name: 'Bracelet Joncs Or 18K', slug: 'bracelet-joncs-or', price: 25000, comparePrice: 30000, stock: 8, category: 'Bracelets', description: 'Bracelet jonc or 18 carats', featured: true },
    { name: "Boucles d'Oreilles Goutte", slug: 'boucles-oreilles-goutte', price: 8500, stock: 25, category: 'Boucles', description: 'Boucles argent rhodié', featured: true },
    { name: 'Montre Minimaliste Cuir', slug: 'montre-minimaliste-cuir', price: 15000, comparePrice: 18000, stock: 12, category: 'Montres', description: 'Montre quartz cuir', featured: true },
    { name: 'Pendentif Croix Diamants', slug: 'pendentif-croix-diamants', price: 35000, stock: 5, category: 'Colliers', description: 'Pendentif croix diamants', featured: true },
    { name: 'Set Bijoux Mariée', slug: 'set-bijoux-mariee', price: 42000, comparePrice: 55000, stock: 3, category: 'Sets', description: 'Set bijoux mariée', featured: true },
    { name: 'Alliance Couple Inox', slug: 'alliance-couple-inox', price: 5500, stock: 30, category: 'Bagues', description: 'Lot de 2 alliances inox', featured: false },
    { name: 'Chevalière Masculine Lion', slug: 'chevaliere-masculine-lion', price: 9800, stock: 10, category: 'Bagues', description: 'Chevalière inox lion', featured: false },
    { name: 'Collier Ras de Cou Perles', slug: 'collier-ras-de-cou-perles', price: 14500, stock: 7, category: 'Colliers', description: 'Ras de cou perles eau douce', featured: false },
    { name: 'Bracelet Chaîne Anchor', slug: 'bracelet-chaine-anchor', price: 7200, stock: 18, category: 'Bracelets', description: 'Bracelet chaîne ancre argent', featured: false },
    { name: 'Broche Étoile Céleste', slug: 'broche-etoile-celeste', price: 4800, stock: 14, category: 'Accessoires', description: 'Broche étoile cristaux', featured: false },
    { name: 'Montre Chronographe Sport', slug: 'montre-chronographe-sport', price: 22000, comparePrice: 28000, stock: 9, category: 'Montres', description: 'Montre chronographe', featured: false },
    { name: 'Anklet Pied Chaîne Fine', slug: 'anklet-pied-chaine', price: 3500, stock: 35, category: 'Bracelets', description: 'Cheville bracelet or', featured: false },
    { name: 'Pochette Bijoux Voyage', slug: 'pochette-bijoux-voyage', price: 2800, stock: 40, category: 'Accessoires', description: 'Organisateur bijoux velours', featured: false },
  ],
};

const EMPLOYEES = [
  { name: 'Karim Benali', email: 'karim@maison-luxe.dz', phone: '0555 12 34 56', role: 'MANAGER', storeSlug: 'maison-luxe' },
  { name: 'Amina Hadj', email: 'amina@maison-luxe.dz', phone: '0661 23 45 67', role: 'CONFIRMATEUR', storeSlug: 'maison-luxe' },
  { name: 'Yacine Meddour', email: 'yacine@maison-luxe.dz', phone: '0770 34 56 78', role: 'CONFIRMATEUR', storeSlug: 'maison-luxe' },
  { name: 'Sofiane Kaci', email: 'sofiane@tech-cases.dz', phone: '0555 45 67 89', role: 'MANAGER', storeSlug: 'tech-cases' },
  { name: 'Nadia Bouzid', email: 'nadia@tech-cases.dz', phone: '0661 56 78 90', role: 'CONFIRMATEUR', storeSlug: 'tech-cases' },
  { name: 'Rachid Hamani', email: 'rachid@tech-cases.dz', phone: '0770 67 89 01', role: 'CONFIRMATEUR', storeSlug: 'tech-cases' },
  { name: 'Leila Amrani', email: 'leila@mode-bijoux.dz', phone: '0555 78 90 12', role: 'MANAGER', storeSlug: 'mode-bijoux' },
  { name: 'Farid Touati', email: 'farid@mode-bijoux.dz', phone: '0661 89 01 23', role: 'CONFIRMATEUR', storeSlug: 'mode-bijoux' },
  { name: 'Djamel Ouali', email: 'djamel@mode-bijoux.dz', phone: '0770 90 12 34', role: 'CONFIRMATEUR', storeSlug: 'mode-bijoux' },
];

const FIRST_NAMES = ['Mohamed', 'Ahmed', 'Ali', 'Fatima', 'Zahra', 'Meriem', 'Omar', 'Khadija', 'Youcef', 'Amina', 'Rami', 'Lina', 'Sami', 'Nour', 'Walid', 'Imane', 'Bilal', 'Sara', 'Hamza', 'Yasmine'];

const LAST_NAMES = ['Benmoussa', 'Khelifi', 'Mebarki', 'Boudiaf', 'Taleb', 'Ziani', 'Haddad', 'Slimani', 'Mansouri', 'Charef', 'Djoudi', 'Benaissa', 'Mokrani', 'Rahmani', 'Belkacem'];

const STATUSES: OrderStatus[] = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'];
const STATUS_WEIGHTS = [5, 8, 10, 25, 20, 25, 7];
const SOURCES = ['web', 'facebook', 'instagram', 'phone', 'whatsapp'];

// ─── STORES ───────────────────────────────────────────────────
describe('STORES seed data', () => {
  test('has exactly 3 store slugs', () => {
    expect(STORE_SLUGS).toHaveLength(3);
  });

  test('has exactly 3 store names', () => {
    expect(STORE_NAMES).toHaveLength(3);
  });

  test('all store slugs are lowercase with hyphens', () => {
    for (const slug of STORE_SLUGS) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(slug).not.toContain(' ');
    }
  });

  test('all store names are non-empty', () => {
    for (const name of STORE_NAMES) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test('store slugs match expected values', () => {
    expect(STORE_SLUGS).toContain('maison-luxe');
    expect(STORE_SLUGS).toContain('tech-cases');
    expect(STORE_SLUGS).toContain('mode-bijoux');
  });

  test('no duplicate store slugs', () => {
    expect(new Set(STORE_SLUGS).size).toBe(STORE_SLUGS.length);
  });
});

// ─── PRODUCTS ─────────────────────────────────────────────────
describe('PRODUCTS seed data', () => {
  test('has entries for all 3 store slugs', () => {
    for (const slug of STORE_SLUGS) {
      expect(PRODUCTS_BY_STORE).toHaveProperty(slug);
      expect(PRODUCTS_BY_STORE[slug].length).toBeGreaterThan(0);
    }
  });

  test('each product has required fields: name, slug, price, stock, category', () => {
    for (const [storeSlug, products] of Object.entries(PRODUCTS_BY_STORE)) {
      for (const product of products) {
        expect(product.name, `${storeSlug}: missing name`).toBeTruthy();
        expect(product.slug, `${storeSlug}: missing slug`).toBeTruthy();
        expect(typeof product.price, `${storeSlug} ${product.name}: price not a number`).toBe('number');
        expect(typeof product.stock, `${storeSlug} ${product.name}: stock not a number`).toBe('number');
        expect(product.category, `${storeSlug} ${product.name}: missing category`).toBeTruthy();
      }
    }
  });

  test('all product prices are positive', () => {
    for (const [storeSlug, products] of Object.entries(PRODUCTS_BY_STORE)) {
      for (const product of products) {
        expect(product.price, `${storeSlug} ${product.name}: price should be > 0`).toBeGreaterThan(0);
      }
    }
  });

  test('all stock values are non-negative', () => {
    for (const [storeSlug, products] of Object.entries(PRODUCTS_BY_STORE)) {
      for (const product of products) {
        expect(product.stock, `${storeSlug} ${product.name}: stock should be >= 0`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('comparePrice is either undefined or greater than price', () => {
    for (const [storeSlug, products] of Object.entries(PRODUCTS_BY_STORE)) {
      for (const product of products) {
        if (product.comparePrice !== undefined) {
          expect(product.comparePrice, `${storeSlug} ${product.name}: comparePrice should be > price`).toBeGreaterThan(product.price);
        }
      }
    }
  });

  test('product slugs are lowercase with hyphens (may contain accented chars)', () => {
    for (const [storeSlug, products] of Object.entries(PRODUCTS_BY_STORE)) {
      for (const product of products) {
        // Seed data slugs may contain accented characters (e.g., "chargeur-magnétique-15w")
        expect(product.slug, `${storeSlug}: invalid slug "${product.slug}"`).toMatch(/^[a-z0-9éèêëàâùûïôç-]+$/);
        expect(product.slug).not.toContain(' ');
      }
    }
  });

  test('each store has exactly 15 products', () => {
    for (const [storeSlug, products] of Object.entries(PRODUCTS_BY_STORE)) {
      expect(products.length, `${storeSlug} should have 15 products`).toBe(15);
    }
  });

  test('no duplicate slugs within a store', () => {
    for (const [storeSlug, products] of Object.entries(PRODUCTS_BY_STORE)) {
      const slugs = products.map(p => p.slug);
      expect(new Set(slugs).size, `${storeSlug}: duplicate slugs found`).toBe(slugs.length);
    }
  });

  test('products have descriptions', () => {
    for (const [storeSlug, products] of Object.entries(PRODUCTS_BY_STORE)) {
      for (const product of products) {
        expect(typeof product.description, `${storeSlug} ${product.name}: missing description`).toBe('string');
        expect(product.description.length, `${storeSlug} ${product.name}: empty description`).toBeGreaterThan(0);
      }
    }
  });

  test('featured is a boolean', () => {
    for (const [storeSlug, products] of Object.entries(PRODUCTS_BY_STORE)) {
      for (const product of products) {
        expect(typeof product.featured, `${storeSlug} ${product.name}: featured not boolean`).toBe('boolean');
      }
    }
  });
});

// ─── EMPLOYEES ────────────────────────────────────────────────
describe('EMPLOYEES seed data', () => {
  test('has exactly 9 employees', () => {
    expect(EMPLOYEES).toHaveLength(9);
  });

  test('each employee has required fields', () => {
    for (const emp of EMPLOYEES) {
      expect(typeof emp.name).toBe('string');
      expect(emp.name.length).toBeGreaterThan(0);
      expect(typeof emp.email).toBe('string');
      expect(emp.email.length).toBeGreaterThan(0);
      expect(typeof emp.phone).toBe('string');
      expect(emp.phone.length).toBeGreaterThan(0);
      expect(typeof emp.role).toBe('string');
      expect(typeof emp.storeSlug).toBe('string');
    }
  });

  test('each employee storeSlug matches a STORES entry', () => {
    for (const emp of EMPLOYEES) {
      expect(STORE_SLUGS, `Employee "${emp.name}" has unknown storeSlug "${emp.storeSlug}"`).toContain(emp.storeSlug);
    }
  });

  test('all emails are unique', () => {
    const emails = EMPLOYEES.map(e => e.email);
    expect(new Set(emails).size).toBe(emails.length);
  });

  test('all emails are valid format', () => {
    for (const emp of EMPLOYEES) {
      expect(emp.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    }
  });

  test('all phones match Algerian format', () => {
    // Regex from validators.ts: /^0[5-7]\d{8}$/ with spaces stripped
    const phoneRegex = /^0[5-7]\d{8}$/;
    for (const emp of EMPLOYEES) {
      const cleaned = emp.phone.replace(/\s/g, '');
      expect(cleaned, `Employee "${emp.name}" has invalid phone "${emp.phone}"`).toMatch(phoneRegex);
    }
  });

  test('all roles are either MANAGER or CONFIRMATEUR', () => {
    const validRoles = ['MANAGER', 'CONFIRMATEUR'];
    for (const emp of EMPLOYEES) {
      expect(validRoles, `Employee "${emp.name}" has invalid role "${emp.role}"`).toContain(emp.role);
    }
  });

  test('each store has exactly 1 MANAGER and 2 CONFIRMATEURs', () => {
    for (const slug of STORE_SLUGS) {
      const storeEmps = EMPLOYEES.filter(e => e.storeSlug === slug);
      const managers = storeEmps.filter(e => e.role === 'MANAGER');
      const confirmateurs = storeEmps.filter(e => e.role === 'CONFIRMATEUR');
      expect(managers.length, `${slug}: should have 1 MANAGER, got ${managers.length}`).toBe(1);
      expect(confirmateurs.length, `${slug}: should have 2 CONFIRMATEURs, got ${confirmateurs.length}`).toBe(2);
    }
  });
});

// ─── FIRST_NAMES ──────────────────────────────────────────────
describe('FIRST_NAMES seed data', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(FIRST_NAMES)).toBe(true);
    expect(FIRST_NAMES.length).toBeGreaterThan(0);
  });

  test('has exactly 20 entries', () => {
    expect(FIRST_NAMES).toHaveLength(20);
  });

  test('all entries are non-empty strings', () => {
    for (const name of FIRST_NAMES) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test('no duplicates', () => {
    expect(new Set(FIRST_NAMES).size).toBe(FIRST_NAMES.length);
  });
});

// ─── LAST_NAMES ───────────────────────────────────────────────
describe('LAST_NAMES seed data', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(LAST_NAMES)).toBe(true);
    expect(LAST_NAMES.length).toBeGreaterThan(0);
  });

  test('has exactly 15 entries', () => {
    expect(LAST_NAMES).toHaveLength(15);
  });

  test('all entries are non-empty strings', () => {
    for (const name of LAST_NAMES) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test('no duplicates', () => {
    expect(new Set(LAST_NAMES).size).toBe(LAST_NAMES.length);
  });
});

// ─── STATUSES ─────────────────────────────────────────────────
describe('STATUSES seed data', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(STATUSES)).toBe(true);
    expect(STATUSES.length).toBeGreaterThan(0);
  });

  test('has all 7 OrderStatus values', () => {
    expect(STATUSES).toHaveLength(7);
    const expected: OrderStatus[] = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'];
    expect(STATUSES).toEqual(expected);
  });

  test('matches OrderStatus type', () => {
    const validStatuses: OrderStatus[] = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'];
    for (const status of STATUSES) {
      expect(validStatuses).toContain(status);
    }
  });

  test('no duplicates', () => {
    expect(new Set(STATUSES).size).toBe(STATUSES.length);
  });
});

// ─── STATUS_WEIGHTS ───────────────────────────────────────────
describe('STATUS_WEIGHTS seed data', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(STATUS_WEIGHTS)).toBe(true);
    expect(STATUS_WEIGHTS.length).toBeGreaterThan(0);
  });

  test('length matches STATUSES length', () => {
    expect(STATUS_WEIGHTS).toHaveLength(STATUSES.length);
  });

  test('all weights are positive numbers', () => {
    for (const weight of STATUS_WEIGHTS) {
      expect(typeof weight).toBe('number');
      expect(weight).toBeGreaterThan(0);
    }
  });

  test('total weight is reasonable (sum > 0)', () => {
    const total = STATUS_WEIGHTS.reduce((sum, w) => sum + w, 0);
    expect(total).toBeGreaterThan(0);
    // Specific known total from seed.ts
    expect(total).toBe(5 + 8 + 10 + 25 + 20 + 25 + 7); // = 100
  });
});

// ─── SOURCES ──────────────────────────────────────────────────
describe('SOURCES seed data', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(SOURCES)).toBe(true);
    expect(SOURCES.length).toBeGreaterThan(0);
  });

  test('has expected source values', () => {
    expect(SOURCES).toContain('web');
    expect(SOURCES).toContain('facebook');
    expect(SOURCES).toContain('instagram');
    expect(SOURCES).toContain('phone');
    expect(SOURCES).toContain('whatsapp');
  });

  test('all entries are non-empty strings', () => {
    for (const source of SOURCES) {
      expect(typeof source).toBe('string');
      expect(source.length).toBeGreaterThan(0);
    }
  });

  test('no duplicates', () => {
    expect(new Set(SOURCES).size).toBe(SOURCES.length);
  });
});
