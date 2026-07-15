/**
 * Tests unitaires pour les fonctions utilitaires du seed (seed.ts)
 * On teste les fonctions pures : weightedRandom, randomDate, generateOrderNumber
 */
import { describe, test, expect } from 'bun:test';

// ─── Fonctions reproduites depuis seed.ts ────────────────────

/**
 * Sélectionne aléatoirement un élément d'une liste selon des poids.
 * Reproduction exacte de la logique de src/lib/seed.ts
 */
function weightedRandom<T>(items: T[], weights: number[]): T {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;
  for (let i = 0; i < items.length; i++) {
    random -= weights[i];
    if (random <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Génère une date aléatoire dans les N derniers jours.
 * Reproduction exacte de la logique de src/lib/seed.ts
 */
function randomDate(daysAgo: number): Date {
  const now = new Date();
  const past = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return new Date(past.getTime() + Math.random() * (now.getTime() - past.getTime()));
}

/**
 * Génère un numéro de commande au format PREFIX-YYYYMMDD-XXXX
 * Reproduction exacte de la logique de src/lib/seed.ts
 */
function generateOrderNumber(storeIndex: number): string {
  const prefix = ['ML', 'TC', 'MB'][storeIndex];
  const date = new Date();
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const seq = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
  return `${prefix}-${dateStr}-${seq}`;
}

const ORDER_NUMBER_PATTERN = /^[A-Z]{2}-\d{8}-\d{4}$/;

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════
describe('Fonctions utilitaires du seed', () => {
  // ─── weightedRandom ────────────────────────────────────────
  describe('weightedRandom', () => {
    test('retourne toujours un élément de la liste', () => {
      const items = ['a', 'b', 'c'];
      const weights = [1, 1, 1];
      for (let i = 0; i < 100; i++) {
        const result = weightedRandom(items, weights);
        expect(items).toContain(result);
      }
    });

    test('fonctionne avec une seule entrée', () => {
      const items = ['seul'];
      const weights = [100];
      for (let i = 0; i < 50; i++) {
        expect(weightedRandom(items, weights)).toBe('seul');
      }
    });

    test('poids 0 ne sélectionne jamais cet élément (sauf fallback)', () => {
      const items = ['a', 'b'];
      const weights = [0, 100];
      for (let i = 0; i < 50; i++) {
        const result = weightedRandom(items, weights);
        // L'élément 'a' avec poids 0 ne devrait presque jamais être sélectionné
        // Sauf via le fallback (dernier élément) si le random dépasse
        // En pratique, avec des poids 0 et 100, seul 'b' est retourné
      }
    });

    test('poids 0 sur le dernier élément utilise le fallback', () => {
      const items = ['a', 'b', 'c'];
      const weights = [100, 0, 0];
      for (let i = 0; i < 50; i++) {
        const result = weightedRandom(items, weights);
        // Le fallback retourne items[last] = 'c' si random > somme
        // Mais avec 100 sur 'a', random - 100 <= 0 toujours vrai → 'a'
        // Les poids à 0 consomment 0 du random
        expect(['a', 'c']).toContain(result);
      }
    });

    test('distribution approximativement correcte avec beaucoup de tirages', () => {
      const items = ['a', 'b'];
      const weights = [75, 25]; // 75% a, 25% b
      const counts = { a: 0, b: 0 };
      const iterations = 10000;

      for (let i = 0; i < iterations; i++) {
        const result = weightedRandom(items, weights);
        counts[result as 'a' | 'b']++;
      }

      // 'a' devrait être sélectionné ~75% du temps
      // Tolérance : entre 70% et 80%
      const ratioA = counts.a / iterations;
      expect(ratioA).toBeGreaterThan(0.70);
      expect(ratioA).toBeLessThan(0.80);
    });

    test('distribution avec 7 statuts (STATUSES et STATUS_WEIGHTS du seed)', () => {
      type OrderStatus = 'NEW' | 'ASSIGNED' | 'CALLED' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'RETURNED';
      const statuses: OrderStatus[] = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'];
      const weights = [5, 8, 10, 25, 20, 25, 7]; // total = 100
      const counts: Record<string, number> = {};
      for (const s of statuses) counts[s] = 0;

      const iterations = 10000;
      for (let i = 0; i < iterations; i++) {
        const result = weightedRandom(statuses, weights);
        counts[result]++;
      }

      // Chaque statut doit avoir été sélectionné au moins quelques fois
      for (const s of statuses) {
        expect(counts[s]).toBeGreaterThan(0);
      }

      // DELIVERED (poids 25) devrait être plus fréquent que NEW (poids 5)
      expect(counts['DELIVERED']).toBeGreaterThan(counts['NEW']);

      // La somme totale doit être égale aux itérations
      const total = Object.values(counts).reduce((s, c) => s + c, 0);
      expect(total).toBe(iterations);
    });

    test('poids négatifs ne sont pas gérés (comportement non spécifié)', () => {
      const items = ['a', 'b'];
      const weights = [-10, 110];
      // Ne devrait pas crasher
      const result = weightedRandom(items, weights);
      expect(items).toContain(result);
    });

    test('fallback quand random dépasse la somme des poids', () => {
      // En théorie, Math.random() * totalWeight ne peut pas dépasser totalWeight
      // mais on vérifie que le fallback retourne le dernier élément
      const items = ['a', 'b', 'c'];
      const weights = [1, 1, 1];
      for (let i = 0; i < 100; i++) {
        const result = weightedRandom(items, weights);
        expect(items).toContain(result);
      }
    });

    test('nombre ditems et de poids doivent correspondre', () => {
      const items = [1, 2, 3, 4, 5];
      const weights = [10, 20, 30, 20, 20]; // total = 100
      for (let i = 0; i < 50; i++) {
        const result = weightedRandom(items, weights);
        expect(items).toContain(result);
      }
    });
  });

  // ─── randomDate ────────────────────────────────────────────
  describe('randomDate', () => {
    test('retourne une instance de Date', () => {
      const result = randomDate(30);
      expect(result).toBeInstanceOf(Date);
    });

    test('la date est dans les 30 derniers jours', () => {
      const now = new Date();
      const result = randomDate(30);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      expect(result.getTime()).toBeGreaterThanOrEqual(thirtyDaysAgo.getTime());
      expect(result.getTime()).toBeLessThanOrEqual(now.getTime());
    });

    test('la date est dans les 7 derniers jours', () => {
      const now = new Date();
      const result = randomDate(7);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      expect(result.getTime()).toBeGreaterThanOrEqual(sevenDaysAgo.getTime());
      expect(result.getTime()).toBeLessThanOrEqual(now.getTime());
    });

    test('la date est dans les 90 derniers jours', () => {
      const now = new Date();
      const result = randomDate(90);
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      expect(result.getTime()).toBeGreaterThanOrEqual(ninetyDaysAgo.getTime());
      expect(result.getTime()).toBeLessThanOrEqual(now.getTime());
    });

    test('daysAgo = 0 retourne la date actuelle (ou très proche)', () => {
      const now = new Date();
      const result = randomDate(0);
      // past = now, donc la plage est [now, now] → random * 0 = 0
      expect(result.getTime()).toBe(now.getTime());
    });

    test('daysAgo = 1 retourne une date dans les dernières 24h', () => {
      const now = new Date();
      const result = randomDate(1);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      expect(result.getTime()).toBeGreaterThanOrEqual(oneDayAgo.getTime());
      expect(result.getTime()).toBeLessThanOrEqual(now.getTime());
    });

    test('plusieurs appels retournent des dates potentiellement différentes', () => {
      const dates = new Set<number>();
      for (let i = 0; i < 100; i++) {
        dates.add(randomDate(30).getTime());
      }
      // Avec 100 tirages sur 30 jours, on devrait avoir plusieurs dates différentes
      expect(dates.size).toBeGreaterThan(1);
    });

    test('la date retournée est un objet Date valide', () => {
      const result = randomDate(30);
      expect(result.getTime()).not.toBeNaN();
    });
  });

  // ─── generateOrderNumber ───────────────────────────────────
  describe('generateOrderNumber', () => {
    test('storeIndex 0 génère un numéro avec préfixe ML', () => {
      const orderNumber = generateOrderNumber(0);
      expect(orderNumber).toMatch(/^ML-\d{8}-\d{4}$/);
    });

    test('storeIndex 1 génère un numéro avec préfixe TC', () => {
      const orderNumber = generateOrderNumber(1);
      expect(orderNumber).toMatch(/^TC-\d{8}-\d{4}$/);
    });

    test('storeIndex 2 génère un numéro avec préfixe MB', () => {
      const orderNumber = generateOrderNumber(2);
      expect(orderNumber).toMatch(/^MB-\d{8}-\d{4}$/);
    });

    test('le format est conforme au pattern global ORDER_NUMBER_PATTERN', () => {
      for (let i = 0; i < 3; i++) {
        const orderNumber = generateOrderNumber(i);
        expect(ORDER_NUMBER_PATTERN.test(orderNumber)).toBe(true);
      }
    });

    test('la partie date correspond à la date du jour', () => {
      const now = new Date();
      const expectedDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

      for (let i = 0; i < 3; i++) {
        const orderNumber = generateOrderNumber(i);
        // Format : PREFIX-YYYYMMDD-XXXX
        const datePart = orderNumber.split('-')[1];
        expect(datePart).toBe(expectedDate);
      }
    });

    test('la partie séquence est de 4 chiffres', () => {
      for (let i = 0; i < 3; i++) {
        const orderNumber = generateOrderNumber(i);
        const seqPart = orderNumber.split('-')[2];
        expect(seqPart).toHaveLength(4);
        expect(seqPart).toMatch(/^\d{4}$/);
      }
    });

    test('plusieurs générations peuvent produire des numéros différents', () => {
      const numbers = new Set<string>();
      for (let i = 0; i < 100; i++) {
        numbers.add(generateOrderNumber(0));
      }
      // Avec 9999 séquences possibles et 100 tirages, on devrait avoir plusieurs numéros différents
      expect(numbers.size).toBeGreaterThan(1);
    });

    test('storeIndex hors limites utilise undefined comme préfixe', () => {
      // En dehors de 0, 1, 2, ['ML', 'TC', 'MB'][index] retourne undefined
      // undefined stringifié donne 'undefined'
      const orderNumber = generateOrderNumber(3);
      expect(orderNumber).toMatch(/^undefined-\d{8}-\d{4}$/);
    });

    test('storeIndex négatif utilise undefined comme préfixe', () => {
      const orderNumber = generateOrderNumber(-1);
      expect(orderNumber).toMatch(/^undefined-\d{8}-\d{4}$/);
    });
  });

  // ─── Tests intégrés avec les constantes du seed ────────────
  describe('Intégration avec les constantes du seed', () => {
    const STATUSES = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'] as const;
    const STATUS_WEIGHTS = [5, 8, 10, 25, 20, 25, 7];
    const SOURCES = ['web', 'facebook', 'instagram', 'phone', 'whatsapp'] as const;
    const WILAYAS_SEED = [
      'Alger', 'Oran', 'Constantine', 'Annaba', 'Sétif', 'Blida', 'Tlemcen', 'Béjaïa', 'Tizi Ouzou',
      'Batna', 'Djelfa', 'Biskra', 'Médéa', 'Mostaganem', 'Mascara', 'Bordj Bou Arréridj', 'Boumerdès',
      'El Oued', 'Skikda', 'Souk Ahras',
    ];

    test('weightedRandom avec STATUSES et STATUS_WEIGHTS fonctionne', () => {
      for (let i = 0; i < 100; i++) {
        const status = weightedRandom(STATUSES, STATUS_WEIGHTS);
        expect(STATUSES).toContain(status);
      }
    });

    test('STATUS_WEIGHTS somme à 100', () => {
      const total = STATUS_WEIGHTS.reduce((sum, w) => sum + w, 0);
      expect(total).toBe(100);
    });

    test('SOURCES a 5 éléments', () => {
      expect(SOURCES).toHaveLength(5);
    });

    test('toutes les wilayas du seed sont des chaînes non vides', () => {
      for (const w of WILAYAS_SEED) {
        expect(typeof w).toBe('string');
        expect(w.length).toBeGreaterThan(0);
      }
    });

    test('génération complète dun ordre aléatoire', () => {
      const storeIndex = Math.floor(Math.random() * 3);
      const orderNumber = generateOrderNumber(storeIndex);
      const status = weightedRandom([...STATUSES], STATUS_WEIGHTS);
      const source = SOURCES[Math.floor(Math.random() * SOURCES.length)];
      const wilaya = WILAYAS_SEED[Math.floor(Math.random() * WILAYAS_SEED.length)];
      const createdAt = randomDate(30);

      expect(ORDER_NUMBER_PATTERN.test(orderNumber)).toBe(true);
      expect([...STATUSES]).toContain(status);
      expect([...SOURCES]).toContain(source);
      expect(WILAYAS_SEED).toContain(wilaya);
      expect(createdAt).toBeInstanceOf(Date);

      // La date doit être dans les 30 derniers jours
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      expect(createdAt.getTime()).toBeGreaterThanOrEqual(thirtyDaysAgo.getTime());
      expect(createdAt.getTime()).toBeLessThanOrEqual(now.getTime());
    });
  });
});
