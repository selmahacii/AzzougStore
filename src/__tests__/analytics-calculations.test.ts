/**
 * Tests unitaires pour les calculs danalytics (analytics/route.ts)
 * On teste la logique pure de calcul sans accéder à la base de données.
 */
import { describe, test, expect } from 'bun:test';

// ─── Logique de calcul extraite du route handler ─────────────

/**
 * Calcule le pourcentage de changement de revenu
 * Reproduction exacte de la formule dans analytics/route.ts :
 * prevRevenue > 0
 *   ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100)
 *   : totalRevenue > 0 ? 100 : 0
 */
function calculateRevenueChange(totalRevenue: number, prevRevenue: number): number {
  return prevRevenue > 0
    ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100)
    : totalRevenue > 0 ? 100 : 0;
}

/**
 * Calcule le changement du nombre de commandes du jour
 * Même logique que revenueChange mais pour les commandes
 */
function calculateOrdersChange(todayOrders: number, prevTodayOrders: number): number {
  return prevTodayOrders > 0
    ? Math.round(((todayOrders - prevTodayOrders) / prevTodayOrders) * 100)
    : todayOrders > 0 ? 100 : 0;
}

/**
 * Convertit une période en nombre de jours
 * Logique : period === '7d' ? 7 : period === '90d' ? 90 : 30
 */
function periodToDays(period: string): number {
  return period === '7d' ? 7 : period === '90d' ? 90 : 30;
}

/**
 * Calcule la date de début pour une période donnée
 */
function calculateStartDate(period: string, now: Date = new Date()): Date {
  const days = periodToDays(period);
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Calcule la date de début de la période précédente
 */
function calculatePrevPeriodStart(startDate: Date, period: string): Date {
  const days = periodToDays(period);
  return new Date(startDate.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Calcule les KPIs d'une boutique à partir de données brutes
 */
function calculateKpis(params: {
  totalRevenue: number;
  orderCount: number;
  completedOrders: number;
  todayOrders: number;
  prevRevenue: number;
  prevTodayOrders: number;
}) {
  const { totalRevenue, orderCount, completedOrders, todayOrders, prevRevenue, prevTodayOrders } = params;
  const avgOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;
  const conversionRate = orderCount > 0
    ? Math.round((completedOrders / orderCount) * 100)
    : 0;
  const revenueChange = calculateRevenueChange(totalRevenue, prevRevenue);
  const ordersChange = calculateOrdersChange(todayOrders, prevTodayOrders);

  return {
    totalRevenue: Math.round(totalRevenue),
    revenueChange,
    ordersToday: todayOrders,
    ordersChange,
    conversionRate,
    avgOrderValue: Math.round(avgOrderValue),
    totalOrders: orderCount,
  };
}

/**
 * Calcule le changement de revenu par boutique (store comparison)
 */
function calculateStoreChange(currentRevenue: number, prevRevenue: number): number {
  return prevRevenue > 0
    ? Math.round(((currentRevenue - prevRevenue) / prevRevenue) * 100)
    : currentRevenue > 0 ? 100 : 0;
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════
describe('Calculs Analytics', () => {
  // ─── calculateRevenueChange ────────────────────────────────
  describe('calculateRevenueChange', () => {
    test('augmentation de 50% avec revenu précédent', () => {
      // (150000 - 100000) / 100000 * 100 = 50
      expect(calculateRevenueChange(150000, 100000)).toBe(50);
    });

    test('diminution de 50% avec revenu précédent', () => {
      // (50000 - 100000) / 100000 * 100 = -50
      expect(calculateRevenueChange(50000, 100000)).toBe(-50);
    });

    test('stagnation (même revenu) retourne 0', () => {
      expect(calculateRevenueChange(100000, 100000)).toBe(0);
    });

    test('augmentation de 100%', () => {
      expect(calculateRevenueChange(200000, 100000)).toBe(100);
    });

    test('diminution de 100% (revenu actuel = 0)', () => {
      expect(calculateRevenueChange(0, 100000)).toBe(-100);
    });

    test('pas de revenu précédent, mais revenu actuel positif → +100%', () => {
      expect(calculateRevenueChange(50000, 0)).toBe(100);
    });

    test('pas de revenu du tout (0 et 0) → 0%', () => {
      expect(calculateRevenueChange(0, 0)).toBe(0);
    });

    test('revenu actuel très petit par rapport au précédent', () => {
      // (1 - 100000) / 100000 * 100 ≈ -100
      expect(calculateRevenueChange(1, 100000)).toBe(-100);
    });

    test('arrondi mathématique correct', () => {
      // (133333 - 100000) / 100000 * 100 = 33.333 → 33
      expect(calculateRevenueChange(133333, 100000)).toBe(33);
    });

    test('arrondi supérieur correct', () => {
      // (166667 - 100000) / 100000 * 100 = 66.667 → 67
      expect(calculateRevenueChange(166667, 100000)).toBe(67);
    });

    test('valeurs décimales', () => {
      expect(calculateRevenueChange(1500.5, 1000)).toBe(50);
    });

    test('revenu négatif ne devrait pas arriver mais on teste le calcul', () => {
      // Si prevRevenue est négatif, le calcul se fait normalement
      const result = calculateRevenueChange(0, -1000);
      // prevRevenue > 0 est false, totalRevenue > 0 est false → 0
      expect(result).toBe(0);
    });
  });

  // ─── calculateOrdersChange ─────────────────────────────────
  describe('calculateOrdersChange', () => {
    test('doublement des commandes du jour', () => {
      expect(calculateOrdersChange(20, 10)).toBe(100);
    });

    test('moitié moins de commandes', () => {
      expect(calculateOrdersChange(5, 10)).toBe(-50);
    });

    test('même nombre de commandes', () => {
      expect(calculateOrdersChange(10, 10)).toBe(0);
    });

    test('aucune commande hier, commandes aujourdhui', () => {
      expect(calculateOrdersChange(5, 0)).toBe(100);
    });

    test('aucune commande aujourdhui ni hier', () => {
      expect(calculateOrdersChange(0, 0)).toBe(0);
    });

    test('toutes les commandes perdues', () => {
      expect(calculateOrdersChange(0, 15)).toBe(-100);
    });
  });

  // ─── periodToDays ──────────────────────────────────────────
  describe('periodToDays', () => {
    test('7d retourne 7', () => {
      expect(periodToDays('7d')).toBe(7);
    });

    test('30d retourne 30 (valeur par défaut)', () => {
      expect(periodToDays('30d')).toBe(30);
    });

    test('90d retourne 90', () => {
      expect(periodToDays('90d')).toBe(90);
    });

    test('valeur inconnue retourne 30 (défaut)', () => {
      expect(periodToDays('unknown')).toBe(30);
    });

    test('chaîne vide retourne 30 (défaut)', () => {
      expect(periodToDays('')).toBe(30);
    });

    test('60d retourne 30 (non supporté, défaut)', () => {
      expect(periodToDays('60d')).toBe(30);
    });
  });

  // ─── calculateStartDate ────────────────────────────────────
  describe('calculateStartDate', () => {
    test('7d recule de 7 jours', () => {
      const now = new Date('2025-06-15T12:00:00Z');
      const start = calculateStartDate('7d', now);
      const expected = new Date('2025-06-08T12:00:00Z');
      expect(start.getTime()).toBe(expected.getTime());
    });

    test('30d recule de 30 jours', () => {
      const now = new Date('2025-06-15T00:00:00Z');
      const start = calculateStartDate('30d', now);
      const expected = new Date('2025-05-16T00:00:00Z');
      expect(start.getTime()).toBe(expected.getTime());
    });

    test('90d recule de 90 jours', () => {
      const now = new Date('2025-06-15T00:00:00Z');
      const start = calculateStartDate('90d', now);
      const expected = new Date('2025-03-17T00:00:00Z');
      expect(start.getTime()).toBe(expected.getTime());
    });

    test('la date retournée est antérieure à now', () => {
      const now = new Date();
      const start = calculateStartDate('30d', now);
      expect(start.getTime()).toBeLessThan(now.getTime());
    });
  });

  // ─── calculatePrevPeriodStart ──────────────────────────────
  describe('calculatePrevPeriodStart', () => {
    test('pour 7d, la période précédente commence 14 jours avant now', () => {
      const now = new Date('2025-06-15T00:00:00Z');
      const startDate = calculateStartDate('7d', now); // 8 juin
      const prevStart = calculatePrevPeriodStart(startDate, '7d'); // 1 juin
      const expected = new Date('2025-06-01T00:00:00Z');
      expect(prevStart.getTime()).toBe(expected.getTime());
    });

    test('pour 30d, la période précédente commence 60 jours avant now', () => {
      const now = new Date('2025-06-15T00:00:00Z');
      const startDate = calculateStartDate('30d', now); // 16 mai
      const prevStart = calculatePrevPeriodStart(startDate, '30d'); // 16 avril
      const expected = new Date('2025-04-16T00:00:00Z');
      expect(prevStart.getTime()).toBe(expected.getTime());
    });
  });

  // ─── calculateKpis ─────────────────────────────────────────
  describe('calculateKpis', () => {
    test('KPIs avec données normales', () => {
      const kpis = calculateKpis({
        totalRevenue: 500000,
        orderCount: 50,
        completedOrders: 35,
        todayOrders: 5,
        prevRevenue: 400000,
        prevTodayOrders: 4,
      });
      expect(kpis.totalRevenue).toBe(500000);
      expect(kpis.totalOrders).toBe(50);
      expect(kpis.revenueChange).toBe(25); // +25%
      expect(kpis.ordersChange).toBe(25); // +25%
      expect(kpis.conversionRate).toBe(70); // 35/50 * 100
      expect(kpis.avgOrderValue).toBe(10000); // 500000/50
      expect(kpis.ordersToday).toBe(5);
    });

    test('KPIs avec zero commandes (division par zéro protégée)', () => {
      const kpis = calculateKpis({
        totalRevenue: 0,
        orderCount: 0,
        completedOrders: 0,
        todayOrders: 0,
        prevRevenue: 0,
        prevTodayOrders: 0,
      });
      expect(kpis.totalRevenue).toBe(0);
      expect(kpis.totalOrders).toBe(0);
      expect(kpis.revenueChange).toBe(0);
      expect(kpis.ordersChange).toBe(0);
      expect(kpis.conversionRate).toBe(0);
      expect(kpis.avgOrderValue).toBe(0);
      expect(kpis.ordersToday).toBe(0);
    });

    test('KPIs : toutes les commandes complétées = 100% conversion', () => {
      const kpis = calculateKpis({
        totalRevenue: 10000,
        orderCount: 10,
        completedOrders: 10,
        todayOrders: 2,
        prevRevenue: 5000,
        prevTodayOrders: 1,
      });
      expect(kpis.conversionRate).toBe(100);
      expect(kpis.revenueChange).toBe(100);
    });

    test('KPIs : aucune commande complétée = 0% conversion', () => {
      const kpis = calculateKpis({
        totalRevenue: 100000,
        orderCount: 50,
        completedOrders: 0,
        todayOrders: 10,
        prevRevenue: 80000,
        prevTodayOrders: 5,
      });
      expect(kpis.conversionRate).toBe(0);
      expect(kpis.avgOrderValue).toBe(2000);
    });

    test('KPIs : premier jour avec revenus (pas de période précédente)', () => {
      const kpis = calculateKpis({
        totalRevenue: 25000,
        orderCount: 5,
        completedOrders: 3,
        todayOrders: 5,
        prevRevenue: 0,
        prevTodayOrders: 0,
      });
      expect(kpis.revenueChange).toBe(100); // premier revenu → +100%
      expect(kpis.ordersChange).toBe(100);
      expect(kpis.avgOrderValue).toBe(5000);
    });

    test('KPIs : arrondi correct de la valeur moyenne', () => {
      const kpis = calculateKpis({
        totalRevenue: 33333,
        orderCount: 3,
        completedOrders: 2,
        todayOrders: 0,
        prevRevenue: 0,
        prevTodayOrders: 0,
      });
      // 33333 / 3 = 11111
      expect(kpis.avgOrderValue).toBe(11111);
    });

    test('KPIs : conversion rate arrondi', () => {
      const kpis = calculateKpis({
        totalRevenue: 0,
        orderCount: 3,
        completedOrders: 1,
        todayOrders: 0,
        prevRevenue: 0,
        prevTodayOrders: 0,
      });
      // 1/3 * 100 = 33.333 → 33
      expect(kpis.conversionRate).toBe(33);
    });
  });

  // ─── calculateStoreChange ──────────────────────────────────
  describe('calculateStoreChange (comparaison entre boutiques)', () => {
    test('boutique en croissance de 25%', () => {
      expect(calculateStoreChange(125000, 100000)).toBe(25);
    });

    test('boutique en déclin de 40%', () => {
      expect(calculateStoreChange(60000, 100000)).toBe(-40);
    });

    test('nouvelle boutique sans revenu précédent → +100%', () => {
      expect(calculateStoreChange(50000, 0)).toBe(100);
    });

    test('boutique sans revenu dans les deux périodes → 0%', () => {
      expect(calculateStoreChange(0, 0)).toBe(0);
    });

    test('boutique qui a perdu tout son revenu → -100%', () => {
      expect(calculateStoreChange(0, 50000)).toBe(-100);
    });
  });
});
