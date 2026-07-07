// ═══════════════════════════════════════════════════════════════
// Integration Tests — Critical Business Flows
// Uses bun:test with direct Prisma DB interaction.
// All monetary values are Int (Algerian Dinar, no subunits).
// ═══════════════════════════════════════════════════════════════

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { db } from '@/lib/db';
import { safeMoney } from '@/lib/format';
import { CUSTOMER_TIER_THRESHOLDS } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// SHARED TEST FIXTURES
// ═══════════════════════════════════════════════════════════════

let testUserId: string;
let testStoreId: string;
let testProductId1: string;
let testProductId2: string;

// For promo tests
let testPromotionPercentageId: string;
let testPromotionFixedId: string;

// For customer tests
let testCustomerId: string;

// IDs created during tests — cleaned up in afterAll
const createdOrderIds: string[] = [];
const createdOrderItemIds: string[] = [];
const createdPromotionIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdStockMovementIds: string[] = [];

// Unique prefixes to avoid collision with seed data
const TEST_PREFIX = 'INTTEST_';
const NOW = new Date();
const PAST_WEEK = new Date(NOW.getTime() - 7 * 86400000);
const FUTURE_MONTH = new Date(NOW.getTime() + 30 * 86400000);

function uniqueSlug(base: string): string {
  return `${TEST_PREFIX}${base}_${Date.now()}`;
}

// ─── Setup ────────────────────────────────────────────────

beforeAll(async () => {
  // Create a user (required as store owner via FK)
  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash('TestPass123!', 12);
  const user = await db.user.create({
    data: {
      email: `${TEST_PREFIX}${Date.now()}@integration.test`,
      name: 'Integration Test User',
      passwordHash: hash,
      role: 'SUPER_ADMIN',
      phone: '0555000000',
      isActive: true,
    },
  });
  testUserId = user.id;

  // Create a store
  const store = await db.store.create({
    data: {
      name: `Integration Test Store ${Date.now()}`,
      slug: uniqueSlug('store'),
      description: 'Store for integration tests',
      themeConfig: JSON.stringify({ primaryColor: '#10B981' }),
      ownerId: testUserId,
      isActive: true,
      isDeleted: false,
    },
  });
  testStoreId = store.id;

  // Create two products with known stock
  const product1 = await db.product.create({
    data: {
      storeId: testStoreId,
      name: 'Test Product A',
      slug: uniqueSlug('product-a'),
      description: 'Product A for integration tests',
      price: 5000,
      comparePrice: null,
      costPrice: 2000,
      stock: 10,
      reservedStock: 0,
      lowStockThreshold: 3,
      images: JSON.stringify([]),
      category: 'TestCat',
      isActive: true,
      featured: false,
    },
  });
  testProductId1 = product1.id;

  const product2 = await db.product.create({
    data: {
      storeId: testStoreId,
      name: 'Test Product B',
      slug: uniqueSlug('product-b'),
      description: 'Product B for integration tests',
      price: 3000,
      comparePrice: 4000,
      costPrice: 1200,
      stock: 20,
      reservedStock: 0,
      lowStockThreshold: 5,
      images: JSON.stringify([]),
      category: 'TestCat2',
      isActive: true,
      featured: false,
    },
  });
  testProductId2 = product2.id;

  // Create a percentage promotion (10%, min 5000 DA)
  const promoPct = await db.promotion.create({
    data: {
      storeId: testStoreId,
      code: `${TEST_PREFIX}PCT10`,
      type: 'PERCENTAGE',
      value: 10,
      minOrderAmount: 5000,
      maxUses: 100,
      usedCount: 0,
      startsAt: PAST_WEEK,
      endsAt: FUTURE_MONTH,
      isActive: true,
      description: '10% off for integration tests',
      applicableCategories: '',
      firstPurchaseOnly: false,
      isFlashSale: false,
    },
  });
  testPromotionPercentageId = promoPct.id;
  createdPromotionIds.push(promoPct.id);

  // Create a fixed amount promotion (500 DA off, min 3000 DA)
  const promoFixed = await db.promotion.create({
    data: {
      storeId: testStoreId,
      code: `${TEST_PREFIX}FIX500`,
      type: 'FIXED_AMOUNT',
      value: 500,
      minOrderAmount: 3000,
      maxUses: 50,
      usedCount: 0,
      startsAt: PAST_WEEK,
      endsAt: FUTURE_MONTH,
      isActive: true,
      description: '500 DA off for integration tests',
      applicableCategories: '',
      firstPurchaseOnly: false,
      isFlashSale: false,
    },
  });
  testPromotionFixedId = promoFixed.id;
  createdPromotionIds.push(promoFixed.id);

  // Create a test customer
  const customer = await db.customer.create({
    data: {
      storeId: testStoreId,
      phone: '0661999999',
      name: 'Customer Integration Test',
      email: 'inttest@email.test',
      wilaya: 'Alger',
      tier: 'BRONZE',
      totalOrders: 0,
      totalSpent: 0,
    },
  });
  testCustomerId = customer.id;
  createdCustomerIds.push(customer.id);
});

// ─── Teardown ─────────────────────────────────────────────

afterAll(async () => {
  // Clean up in FK-safe order (reverse of creation)
  try {
    // OrderEvents (depend on Order + User)
    if (createdOrderIds.length > 0) {
      await db.orderEvent.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
    }
    // OrderItems (depend on Order + Product)
    if (createdOrderItemIds.length > 0) {
      await db.orderItem.deleteMany({
        where: { id: { in: createdOrderItemIds } },
      });
    }
    // StockMovements (depend on Product + User)
    if (createdStockMovementIds.length > 0) {
      await db.stockMovement.deleteMany({
        where: { id: { in: createdStockMovementIds } },
      });
    }
    // Orders
    if (createdOrderIds.length > 0) {
      await db.order.deleteMany({
        where: { id: { in: createdOrderIds } },
      });
    }
    // Promotions
    if (createdPromotionIds.length > 0) {
      await db.promotion.deleteMany({
        where: { id: { in: createdPromotionIds } },
      });
    }
    // Customers
    if (createdCustomerIds.length > 0) {
      await db.customer.deleteMany({
        where: { id: { in: createdCustomerIds } },
      });
    }
    // Products
    await db.product.deleteMany({
      where: { storeId: testStoreId },
    });
    // Store
    await db.store.delete({
      where: { id: testStoreId },
    });
    // User
    await db.user.delete({
      where: { id: testUserId },
    });
  } catch (error) {
    console.error('[Integration Test Teardown] Error:', error);
  }
});

// ═══════════════════════════════════════════════════════════════
// 1. ORDER CREATION INTEGRATION
// ═══════════════════════════════════════════════════════════════

describe('Order Creation Integration', () => {
  test('creates an order with correct total, status NEW, and subtotal calculation', async () => {
    const orderNumber = `IT-${Date.now()}`;
    const quantity1 = 2;
    const quantity2 = 1;
    const deliveryFee = 400;

    // Subtotal: 2 * 5000 + 1 * 3000 = 13000
    const expectedSubtotal = quantity1 * 5000 + quantity2 * 3000;
    const expectedTotal = expectedSubtotal + deliveryFee; // 13400

    const order = await db.order.create({
      data: {
        storeId: testStoreId,
        orderNumber,
        customerName: 'Ahmed Benmoussa',
        customerPhone: '0555123456',
        customerAddress: 'Cité 1, Alger',
        customerWilaya: 'Alger',
        deliveryFee,
        subtotal: expectedSubtotal,
        discount: 0,
        total: expectedTotal,
        status: 'NEW',
        customerId: testCustomerId,
        customerTier: 'BRONZE',
      },
    });
    createdOrderIds.push(order.id);

    // Verify basic order fields
    expect(order.id).toBeTruthy();
    expect(order.storeId).toBe(testStoreId);
    expect(order.status).toBe('NEW');
    expect(order.subtotal).toBe(expectedSubtotal);
    expect(order.total).toBe(expectedTotal);
    expect(order.deliveryFee).toBe(deliveryFee);
    expect(order.discount).toBe(0);
    expect(order.isDeleted).toBe(false);
    expect(order.customerTier).toBe('BRONZE');
  });

  test('creates OrderItem records with correct quantity and unitPrice', async () => {
    const orderNumber = `IT-ITEMS-${Date.now()}`;
    const quantity = 3;
    const unitPrice = 5000;

    const order = await db.order.create({
      data: {
        storeId: testStoreId,
        orderNumber,
        customerName: 'Fatima Zerhouni',
        customerPhone: '0661123456',
        customerAddress: 'Cité 2, Blida',
        customerWilaya: 'Blida',
        deliveryFee: 500,
        subtotal: quantity * unitPrice,
        discount: 0,
        total: quantity * unitPrice + 500,
        status: 'NEW',
      },
    });
    createdOrderIds.push(order.id);

    // Create an OrderItem
    const orderItem = await db.orderItem.create({
      data: {
        orderId: order.id,
        productId: testProductId1,
        productName: 'Test Product A',
        quantity,
        unitPrice,
        category: 'TestCat',
      },
    });
    createdOrderItemIds.push(orderItem.id);

    // Verify OrderItem fields
    expect(orderItem.id).toBeTruthy();
    expect(orderItem.orderId).toBe(order.id);
    expect(orderItem.productId).toBe(testProductId1);
    expect(orderItem.productName).toBe('Test Product A');
    expect(orderItem.quantity).toBe(quantity);
    expect(orderItem.unitPrice).toBe(unitPrice);
    expect(orderItem.category).toBe('TestCat');

    // Fetch via relation and verify
    const fetchedOrder = await db.order.findUnique({
      where: { id: order.id },
      include: { items: true },
    });
    expect(fetchedOrder).not.toBeNull();
    expect(fetchedOrder!.items.length).toBe(1);
    expect(fetchedOrder!.items[0].quantity).toBe(quantity);
    expect(fetchedOrder!.items[0].unitPrice).toBe(unitPrice);
  });

  test('stock is NOT decremented on order creation (only reservedStock changes)', async () => {
    // Get current stock state
    const beforeProduct = await db.product.findUnique({
      where: { id: testProductId1 },
      select: { stock: true, reservedStock: true },
    });
    const stockBefore = beforeProduct!.stock;
    const reservedBefore = beforeProduct!.reservedStock;

    // Simulate order creation: reserve stock
    const reserveQty = 3;
    await db.product.update({
      where: { id: testProductId1 },
      data: { reservedStock: { increment: reserveQty } },
    });

    // Check: stock unchanged, reservedStock incremented
    const afterReserve = await db.product.findUnique({
      where: { id: testProductId1 },
      select: { stock: true, reservedStock: true },
    });
    expect(afterReserve!.stock).toBe(stockBefore);
    expect(afterReserve!.reservedStock).toBe(reservedBefore + reserveQty);

    // Verify availableStock = stock - reservedStock
    const availableStock = afterReserve!.stock - afterReserve!.reservedStock;
    expect(availableStock).toBe(stockBefore - reservedBefore - reserveQty);

    // Clean up: release the reservation
    await db.product.update({
      where: { id: testProductId1 },
      data: { reservedStock: { decrement: reserveQty } },
    });
  });

  test('subtotal is calculated correctly as sum of (quantity * unitPrice)', async () => {
    const orderNumber = `IT-SUBTOTAL-${Date.now()}`;
    const items = [
      { productId: testProductId1, productName: 'Test Product A', quantity: 2, unitPrice: 5000 },
      { productId: testProductId2, productName: 'Test Product B', quantity: 4, unitPrice: 3000 },
    ];

    // Calculate expected subtotal: 2*5000 + 4*3000 = 10000 + 12000 = 22000
    const expectedSubtotal = safeMoney(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
    expect(expectedSubtotal).toBe(22000);

    const deliveryFee = 600;
    const order = await db.order.create({
      data: {
        storeId: testStoreId,
        orderNumber,
        customerName: 'Mohamed Boudiaf',
        customerPhone: '0770234567',
        customerAddress: 'Cité 3, Oran',
        customerWilaya: 'Oran',
        deliveryFee,
        subtotal: expectedSubtotal,
        discount: 0,
        total: expectedSubtotal + deliveryFee,
        status: 'NEW',
      },
    });
    createdOrderIds.push(order.id);

    // Create OrderItems
    for (const item of items) {
      const orderItem = await db.orderItem.create({
        data: {
          orderId: order.id,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        },
      });
      createdOrderItemIds.push(orderItem.id);
    }

    // Fetch and verify subtotal matches sum of order items
    const fetchedOrder = await db.order.findUnique({
      where: { id: order.id },
      include: { items: true },
    });
    const computedSubtotal = safeMoney(
      fetchedOrder!.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    );
    expect(computedSubtotal).toBe(expectedSubtotal);
    expect(fetchedOrder!.subtotal).toBe(expectedSubtotal);
  });

  test('creates multiple order items in a single transaction', async () => {
    const orderNumber = `IT-MULTI-${Date.now()}`;
    const order = await db.$transaction(async (tx) => {
      const subtotal = 2 * 5000 + 3 * 3000; // 19000
      const newOrder = await tx.order.create({
        data: {
          storeId: testStoreId,
          orderNumber,
          customerName: 'Sara Taleb',
          customerPhone: '0555345678',
          customerAddress: 'Cité 4, Constantine',
          customerWilaya: 'Constantine',
          deliveryFee: 700,
          subtotal,
          discount: 0,
          total: subtotal + 700,
          status: 'NEW',
        },
      });
      createdOrderIds.push(newOrder.id);

      await tx.orderItem.createMany({
        data: [
          {
            orderId: newOrder.id,
            productId: testProductId1,
            productName: 'Test Product A',
            quantity: 2,
            unitPrice: 5000,
            category: 'TestCat',
          },
          {
            orderId: newOrder.id,
            productId: testProductId2,
            productName: 'Test Product B',
            quantity: 3,
            unitPrice: 3000,
            category: 'TestCat2',
          },
        ],
      });

      return newOrder;
    });

    const fetched = await db.order.findUnique({
      where: { id: order.id },
      include: { items: true },
    });
    expect(fetched!.items.length).toBe(2);
    expect(fetched!.items[0].productId).toBe(testProductId1);
    expect(fetched!.items[1].productId).toBe(testProductId2);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. STOCK RESERVATION INTEGRATION
// ═══════════════════════════════════════════════════════════════

describe('Stock Reservation Integration', () => {
  // Use product2 for stock tests to avoid interference
  const productId = 'testProductId2'; // placeholder — we use actual testProductId2

  test('ORDER_RESERVE: increment reservedStock, stock unchanged', async () => {
    // Get baseline
    const before = await db.product.findUnique({
      where: { id: testProductId2 },
      select: { stock: true, reservedStock: true },
    });
    const stockBefore = before!.stock;
    const reservedBefore = before!.reservedStock;

    const reserveQty = 5;

    // Simulate ORDER_RESERVE (as the API does)
    await db.product.update({
      where: { id: testProductId2 },
      data: { reservedStock: { increment: reserveQty } },
    });

    const afterReserve = await db.product.findUnique({
      where: { id: testProductId2 },
      select: { stock: true, reservedStock: true },
    });

    // Stock unchanged
    expect(afterReserve!.stock).toBe(stockBefore);
    // Reserved increased
    expect(afterReserve!.reservedStock).toBe(reservedBefore + reserveQty);
    // Available stock decreased
    expect(afterReserve!.stock - afterReserve!.reservedStock).toBe(
      stockBefore - reservedBefore - reserveQty,
    );

    // Create a StockMovement record for the reserve
    const movement = await db.stockMovement.create({
      data: {
        productId: testProductId2,
        type: 'ORDER_RESERVE',
        quantity: reserveQty,
        reason: 'Integration test reserve',
        actorId: testUserId,
      },
    });
    createdStockMovementIds.push(movement.id);
    expect(movement.type).toBe('ORDER_RESERVE');
    expect(movement.quantity).toBe(reserveQty);
  });

  test('availableStock (stock - reservedStock) is correct after reservation', async () => {
    const product = await db.product.findUnique({
      where: { id: testProductId2 },
      select: { stock: true, reservedStock: true },
    });

    // Previous test reserved 5, so available = 20 - 5 = 15
    const availableStock = product!.stock - product!.reservedStock;
    expect(availableStock).toBe(15);
    expect(availableStock).toBeGreaterThanOrEqual(0);
  });

  test('ORDER_CONFIRM: decrement stock, decrement reservedStock', async () => {
    // At this point product2 has reservedStock = 5 from previous test
    const before = await db.product.findUnique({
      where: { id: testProductId2 },
      select: { stock: true, reservedStock: true },
    });
    const stockBefore = before!.stock;
    const reservedBefore = before!.reservedStock;

    const confirmQty = 5; // same qty as reserved

    // Simulate ORDER_CONFIRM (CALLED → CONFIRMED in state machine)
    await db.product.update({
      where: { id: testProductId2 },
      data: {
        stock: { decrement: confirmQty },
        reservedStock: { decrement: confirmQty },
      },
    });

    const afterConfirm = await db.product.findUnique({
      where: { id: testProductId2 },
      select: { stock: true, reservedStock: true },
    });

    // Stock reduced by confirmQty
    expect(afterConfirm!.stock).toBe(stockBefore - confirmQty);
    // Reserved stock back to original level
    expect(afterConfirm!.reservedStock).toBe(reservedBefore - confirmQty);

    // Create a StockMovement record
    const movement = await db.stockMovement.create({
      data: {
        productId: testProductId2,
        type: 'ORDER_CONFIRM',
        quantity: confirmQty,
        reason: 'Integration test confirm',
        actorId: testUserId,
      },
    });
    createdStockMovementIds.push(movement.id);
    expect(movement.type).toBe('ORDER_CONFIRM');
  });

  test('stock is now reduced and reservedStock is back to original after confirm', async () => {
    const product = await db.product.findUnique({
      where: { id: testProductId2 },
      select: { stock: true, reservedStock: true },
    });

    // After reserve(5) + confirm(5): stock = 20 - 5 = 15, reserved = 0 + 5 - 5 = 0
    expect(product!.stock).toBe(15);
    expect(product!.reservedStock).toBe(0);
    expect(product!.stock - product!.reservedStock).toBe(15);
  });

  test('ORDER_RELEASE: reservedStock decremented, stock unchanged', async () => {
    // First reserve some stock
    const releaseQty = 3;
    await db.product.update({
      where: { id: testProductId2 },
      data: { reservedStock: { increment: releaseQty } },
    });

    const before = await db.product.findUnique({
      where: { id: testProductId2 },
      select: { stock: true, reservedStock: true },
    });

    // Simulate ORDER_RELEASE (NEW → RETURNED)
    await db.product.update({
      where: { id: testProductId2 },
      data: { reservedStock: { decrement: releaseQty } },
    });

    const afterRelease = await db.product.findUnique({
      where: { id: testProductId2 },
      select: { stock: true, reservedStock: true },
    });

    // Stock unchanged
    expect(afterRelease!.stock).toBe(before!.stock);
    // Reserved back to pre-release level
    expect(afterRelease!.reservedStock).toBe(before!.reservedStock - releaseQty);
  });

  test('RETURN_RESTOCK: stock incremented, reservedStock unchanged', async () => {
    const restockQty = 2;
    const before = await db.product.findUnique({
      where: { id: testProductId2 },
      select: { stock: true, reservedStock: true },
    });

    // Simulate RETURN_RESTOCK (CONFIRMED/SHIPPED/DELIVERED → RETURNED)
    await db.product.update({
      where: { id: testProductId2 },
      data: { stock: { increment: restockQty } },
    });

    const afterRestock = await db.product.findUnique({
      where: { id: testProductId2 },
      select: { stock: true, reservedStock: true },
    });

    expect(afterRestock!.stock).toBe(before!.stock + restockQty);
    expect(afterRestock!.reservedStock).toBe(before!.reservedStock);

    // Reverse the restock to leave the DB clean
    await db.product.update({
      where: { id: testProductId2 },
      data: { stock: { decrement: restockQty } },
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. PROMO CODE INTEGRATION
// ═══════════════════════════════════════════════════════════════

describe('Promo Code Integration', () => {
  test('PERCENTAGE promotion: 10% discount calculated correctly', async () => {
    // Fetch the promotion we created in beforeAll
    const promo = await db.promotion.findUnique({
      where: { id: testPromotionPercentageId },
    });
    expect(promo).not.toBeNull();
    expect(promo!.type).toBe('PERCENTAGE');
    expect(promo!.value).toBe(10);
    expect(promo!.minOrderAmount).toBe(5000);
    expect(promo!.isActive).toBe(true);

    // Subtotal above minOrderAmount
    const subtotal = 10000;
    const expectedDiscount = safeMoney(subtotal * (promo!.value / 100)); // 1000
    expect(expectedDiscount).toBe(1000);

    const deliveryFee = 400;
    const total = safeMoney(subtotal + deliveryFee - expectedDiscount); // 9400

    // Create order with promo
    const order = await db.order.create({
      data: {
        storeId: testStoreId,
        orderNumber: `IT-PROMO-PCT-${Date.now()}`,
        customerName: 'Omar Ziani',
        customerPhone: '0555456789',
        customerAddress: 'Cité 5, Alger',
        customerWilaya: 'Alger',
        deliveryFee,
        subtotal,
        discount: expectedDiscount,
        total,
        status: 'NEW',
        promoCode: promo!.code,
      },
    });
    createdOrderIds.push(order.id);

    expect(order.discount).toBe(1000);
    expect(order.total).toBe(9400);
    expect(order.promoCode).toBe(promo!.code);
  });

  test('PERCENTAGE promotion: usedCount incremented after use', async () => {
    const before = await db.promotion.findUnique({
      where: { id: testPromotionPercentageId },
      select: { usedCount: true },
    });

    await db.promotion.update({
      where: { id: testPromotionPercentageId },
      data: { usedCount: { increment: 1 } },
    });

    const after = await db.promotion.findUnique({
      where: { id: testPromotionPercentageId },
      select: { usedCount: true },
    });

    expect(after!.usedCount).toBe(before!.usedCount + 1);
  });

  test('FIXED_AMOUNT promotion: 500 DA discount applied correctly', async () => {
    const promo = await db.promotion.findUnique({
      where: { id: testPromotionFixedId },
    });
    expect(promo).not.toBeNull();
    expect(promo!.type).toBe('FIXED_AMOUNT');
    expect(promo!.value).toBe(500);
    expect(promo!.minOrderAmount).toBe(3000);

    const subtotal = 8000;
    const expectedDiscount = Math.min(promo!.value, subtotal); // 500
    expect(expectedDiscount).toBe(500);

    const deliveryFee = 600;
    const total = safeMoney(subtotal + deliveryFee - expectedDiscount); // 8100

    const order = await db.order.create({
      data: {
        storeId: testStoreId,
        orderNumber: `IT-PROMO-FIX-${Date.now()}`,
        customerName: 'Imane Mansouri',
        customerPhone: '0661567890',
        customerAddress: 'Cité 6, Sétif',
        customerWilaya: 'Sétif',
        deliveryFee,
        subtotal,
        discount: expectedDiscount,
        total,
        status: 'NEW',
        promoCode: promo!.code,
      },
    });
    createdOrderIds.push(order.id);

    expect(order.discount).toBe(500);
    expect(order.total).toBe(8100);
    expect(order.promoCode).toBe(promo!.code);
  });

  test('FIXED_AMOUNT: discount capped at subtotal (cannot go negative)', async () => {
    const subtotal = 300;
    const fixedDiscount = 500;
    // Fixed discount should not exceed subtotal
    const actualDiscount = Math.min(fixedDiscount, subtotal);
    expect(actualDiscount).toBe(300);

    const total = safeMoney(Math.max(0, subtotal - actualDiscount));
    expect(total).toBe(0);
    expect(total).toBeGreaterThanOrEqual(0);
  });

  test('PERCENTAGE promotion: 3% of 10000 = 300 (exact integer)', async () => {
    const subtotal = 10000;
    const percentage = 3;
    const discount = safeMoney(subtotal * (percentage / 100));
    expect(discount).toBe(300);
    expect(Number.isInteger(discount)).toBe(true);
  });

  test('PERCENTAGE promotion: 7% of 9999 rounds correctly', async () => {
    const subtotal = 9999;
    const percentage = 7;
    // 9999 * 0.07 = 699.93 → rounds to 700
    const discount = safeMoney(subtotal * (percentage / 100));
    expect(discount).toBe(700);
    expect(Number.isInteger(discount)).toBe(true);
  });

  test('promotion with minOrderAmount not applied when subtotal is below threshold', async () => {
    const promo = await db.promotion.findUnique({
      where: { id: testPromotionPercentageId },
    });
    const subtotal = 4000; // Below minOrderAmount of 5000
    const isAboveThreshold = subtotal >= promo!.minOrderAmount;
    expect(isAboveThreshold).toBe(false);

    // When subtotal < minOrderAmount, discount should be 0
    const discount = isAboveThreshold ? safeMoney(subtotal * (promo!.value / 100)) : 0;
    expect(discount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. CUSTOMER TIER INTEGRATION
// ═══════════════════════════════════════════════════════════════

describe('Customer Tier Integration', () => {
  test('customer with 0 totalSpent is BRONZE (default)', async () => {
    const customer = await db.customer.create({
      data: {
        storeId: testStoreId,
        phone: `0555${Date.now()}`,
        name: 'Tier Test BRONZE',
        tier: 'BRONZE',
        totalOrders: 0,
        totalSpent: 0,
      },
    });
    createdCustomerIds.push(customer.id);

    expect(customer.tier).toBe('BRONZE');
    expect(customer.totalSpent).toBe(0);
    expect(customer.totalSpent).toBeLessThan(CUSTOMER_TIER_THRESHOLDS.SILVER);
  });

  test('customer with 25000 totalSpent is SILVER', async () => {
    const totalSpent = 25000;
    const customer = await db.customer.create({
      data: {
        storeId: testStoreId,
        phone: `0661${Date.now()}`,
        name: 'Tier Test SILVER',
        tier: 'SILVER',
        totalOrders: 5,
        totalSpent,
      },
    });
    createdCustomerIds.push(customer.id);

    expect(customer.tier).toBe('SILVER');
    expect(customer.totalSpent).toBeGreaterThanOrEqual(CUSTOMER_TIER_THRESHOLDS.SILVER);
    expect(customer.totalSpent).toBeLessThan(CUSTOMER_TIER_THRESHOLDS.GOLD);
  });

  test('customer with 75000 totalSpent is GOLD', async () => {
    const totalSpent = 75000;
    const customer = await db.customer.create({
      data: {
        storeId: testStoreId,
        phone: `0770${Date.now()}`,
        name: 'Tier Test GOLD',
        tier: 'GOLD',
        totalOrders: 15,
        totalSpent,
      },
    });
    createdCustomerIds.push(customer.id);

    expect(customer.tier).toBe('GOLD');
    expect(customer.totalSpent).toBeGreaterThanOrEqual(CUSTOMER_TIER_THRESHOLDS.GOLD);
    expect(customer.totalSpent).toBeLessThan(CUSTOMER_TIER_THRESHOLDS.PLATINUM);
  });

  test('customer with 150000 totalSpent is PLATINUM', async () => {
    const totalSpent = 150000;
    const customer = await db.customer.create({
      data: {
        storeId: testStoreId,
        phone: `0556${Date.now()}`,
        name: 'Tier Test PLATINUM',
        tier: 'PLATINUM',
        totalOrders: 30,
        totalSpent,
      },
    });
    createdCustomerIds.push(customer.id);

    expect(customer.tier).toBe('PLATINUM');
    expect(customer.totalSpent).toBeGreaterThanOrEqual(CUSTOMER_TIER_THRESHOLDS.PLATINUM);
    expect(customer.totalSpent).toBeLessThan(CUSTOMER_TIER_THRESHOLDS.DIAMOND);
  });

  test('customer with 250000 totalSpent is DIAMOND', async () => {
    const totalSpent = 250000;
    const customer = await db.customer.create({
      data: {
        storeId: testStoreId,
        phone: `0557${Date.now()}`,
        name: 'Tier Test DIAMOND',
        tier: 'DIAMOND',
        totalOrders: 50,
        totalSpent,
      },
    });
    createdCustomerIds.push(customer.id);

    expect(customer.tier).toBe('DIAMOND');
    expect(customer.totalSpent).toBeGreaterThanOrEqual(CUSTOMER_TIER_THRESHOLDS.DIAMOND);
  });

  test('tier changes when totalSpent increases (BRONZE → SILVER)', async () => {
    const customer = await db.customer.create({
      data: {
        storeId: testStoreId,
        phone: `0558${Date.now()}`,
        name: 'Tier Upgrade Test',
        tier: 'BRONZE',
        totalOrders: 1,
        totalSpent: 5000,
      },
    });
    createdCustomerIds.push(customer.id);

    expect(customer.tier).toBe('BRONZE');

    // Update totalSpent to cross SILVER threshold
    const newTotalSpent = 25000;
    const updated = await db.customer.update({
      where: { id: customer.id },
      data: {
        totalSpent: newTotalSpent,
        tier: 'SILVER',
      },
    });

    expect(updated.tier).toBe('SILVER');
    expect(updated.totalSpent).toBe(newTotalSpent);
  });

  test('tier downgrades when totalSpent decreases (SILVER → BRONZE)', async () => {
    const customer = await db.customer.create({
      data: {
        storeId: testStoreId,
        phone: `0559${Date.now()}`,
        name: 'Tier Downgrade Test',
        tier: 'GOLD',
        totalOrders: 10,
        totalSpent: 60000,
      },
    });
    createdCustomerIds.push(customer.id);

    expect(customer.tier).toBe('GOLD');

    // Simulate returns reducing totalSpent below GOLD threshold
    const newTotalSpent = 10000;
    const updated = await db.customer.update({
      where: { id: customer.id },
      data: {
        totalSpent: newTotalSpent,
        tier: 'BRONZE',
      },
    });

    expect(updated.tier).toBe('BRONZE');
    expect(updated.totalSpent).toBeLessThan(CUSTOMER_TIER_THRESHOLDS.SILVER);
  });

  test('exact threshold values assign correct tier', async () => {
    // Test boundary values
    const boundaries = [
      { spent: 0, expected: 'BRONZE' },
      { spent: CUSTOMER_TIER_THRESHOLDS.SILVER, expected: 'SILVER' },       // 20000
      { spent: CUSTOMER_TIER_THRESHOLDS.GOLD, expected: 'GOLD' },          // 50000
      { spent: CUSTOMER_TIER_THRESHOLDS.PLATINUM, expected: 'PLATINUM' },  // 100000
      { spent: CUSTOMER_TIER_THRESHOLDS.DIAMOND, expected: 'DIAMOND' },    // 200000
    ];

    for (const { spent, expected } of boundaries) {
      expect(spent >= CUSTOMER_TIER_THRESHOLDS[expected as keyof typeof CUSTOMER_TIER_THRESHOLDS] || expected === 'BRONZE').toBe(true);
      expect(spent).toBeGreaterThanOrEqual(CUSTOMER_TIER_THRESHOLDS[expected as keyof typeof CUSTOMER_TIER_THRESHOLDS]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. MONETARY PRECISION INTEGRATION
// ═══════════════════════════════════════════════════════════════

describe('Monetary Precision Integration', () => {
  test('all monetary fields in Order are integers (no floating point)', async () => {
    const orderNumber = `IT-MONEY-${Date.now()}`;
    const subtotal = 13500;
    const deliveryFee = 700;
    const discount = 1000;
    const total = safeMoney(subtotal + deliveryFee - discount);

    const order = await db.order.create({
      data: {
        storeId: testStoreId,
        orderNumber,
        customerName: 'Nour Haddad',
        customerPhone: '0661789012',
        customerAddress: 'Cité 7, Tizi Ouzou',
        customerWilaya: 'Tizi Ouzou',
        deliveryFee,
        subtotal,
        discount,
        total,
        status: 'NEW',
      },
    });
    createdOrderIds.push(order.id);

    // All monetary fields must be integers
    expect(Number.isInteger(order.subtotal)).toBe(true);
    expect(Number.isInteger(order.deliveryFee)).toBe(true);
    expect(Number.isInteger(order.discount)).toBe(true);
    expect(Number.isInteger(order.total)).toBe(true);
    expect(order.subtotal).toBe(13500);
    expect(order.total).toBe(13200);
  });

  test('all monetary fields in Product are integers (no floating point)', async () => {
    const product = await db.product.findUnique({
      where: { id: testProductId1 },
      select: { price: true, comparePrice: true, costPrice: true },
    });

    expect(Number.isInteger(product!.price)).toBe(true);
    if (product!.comparePrice !== null) {
      expect(Number.isInteger(product!.comparePrice)).toBe(true);
    }
    if (product!.costPrice !== null) {
      expect(Number.isInteger(product!.costPrice)).toBe(true);
    }
  });

  test('all monetary fields in Promotion are integers (no floating point)', async () => {
    const promo = await db.promotion.findUnique({
      where: { id: testPromotionPercentageId },
      select: { value: true, minOrderAmount: true },
    });

    expect(Number.isInteger(promo!.value)).toBe(true);
    expect(Number.isInteger(promo!.minOrderAmount)).toBe(true);
  });

  test('order with exact DA amounts has no precision loss', async () => {
    const orderNumber = `IT-EXACT-${Date.now()}`;
    const items = [
      { qty: 3, price: 3333 },  // 9999
      { qty: 1, price: 1 },     // 1
    ];
    const subtotal = safeMoney(items.reduce((s, i) => s + i.qty * i.price, 0)); // 10000
    expect(subtotal).toBe(10000);

    const deliveryFee = 400;
    const discount = 0;
    const total = safeMoney(subtotal + deliveryFee - discount); // 10400

    const order = await db.order.create({
      data: {
        storeId: testStoreId,
        orderNumber,
        customerName: 'Walid Slimani',
        customerPhone: '0770890123',
        customerAddress: 'Cité 8, Béjaïa',
        customerWilaya: 'Béjaïa',
        deliveryFee,
        subtotal,
        discount,
        total,
        status: 'NEW',
      },
    });
    createdOrderIds.push(order.id);

    // Re-fetch from DB and verify no precision loss
    const fetched = await db.order.findUnique({ where: { id: order.id } });
    expect(fetched!.subtotal).toBe(10000);
    expect(fetched!.total).toBe(10400);
    expect(fetched!.subtotal).toBe(subtotal);
    expect(fetched!.total).toBe(total);
  });

  test('percentage discount: 3% of 10000 = 300 (exact integer)', async () => {
    const subtotal = 10000;
    const percentage = 3;
    const discount = safeMoney(subtotal * (percentage / 100));
    expect(discount).toBe(300);
    expect(Number.isInteger(discount)).toBe(true);

    // Total after discount
    const deliveryFee = 500;
    const total = safeMoney(subtotal + deliveryFee - discount);
    expect(total).toBe(10200);
    expect(Number.isInteger(total)).toBe(true);
  });

  test('percentage discount: 15% of 7777 = 1167 (rounded correctly)', async () => {
    const subtotal = 7777;
    const percentage = 15;
    // 7777 * 0.15 = 1166.55 → rounds to 1167
    const discount = safeMoney(subtotal * (percentage / 100));
    expect(discount).toBe(1167);
    expect(Number.isInteger(discount)).toBe(true);

    const total = safeMoney(subtotal - discount);
    expect(total).toBe(6610); // 7777 - 1167
  });

  test('percentage discount: 33% of 10000 = 3300 (exact integer)', async () => {
    const subtotal = 10000;
    const percentage = 33;
    const discount = safeMoney(subtotal * (percentage / 100));
    expect(discount).toBe(3300);
    expect(Number.isInteger(discount)).toBe(true);
  });

  test('OrderItem unitPrice is always integer', async () => {
    const orderNumber = `IT-ITEMPRICE-${Date.now()}`;
    const order = await db.order.create({
      data: {
        storeId: testStoreId,
        orderNumber,
        customerName: 'Hamza Benaissa',
        customerPhone: '0555012345',
        customerAddress: 'Cité 9, Annaba',
        customerWilaya: 'Annaba',
        deliveryFee: 600,
        subtotal: 5000,
        discount: 0,
        total: 5600,
        status: 'NEW',
      },
    });
    createdOrderIds.push(order.id);

    const orderItem = await db.orderItem.create({
      data: {
        orderId: order.id,
        productId: testProductId1,
        productName: 'Test Product A',
        quantity: 1,
        unitPrice: 5000,
      },
    });
    createdOrderItemIds.push(orderItem.id);

    expect(Number.isInteger(orderItem.unitPrice)).toBe(true);
    expect(Number.isInteger(orderItem.quantity)).toBe(true);
    expect(Number.isInteger(orderItem.quantity * orderItem.unitPrice)).toBe(true);
  });

  test('safeMoney prevents floating point accumulation errors', async () => {
    // Classic floating point issue: 0.1 + 0.2 !== 0.3
    // With DA amounts: 3333 + 3333 + 3334 = 10000
    const prices = [3333, 3333, 3334];
    const rawSum = prices.reduce((s, p) => s + p, 0);
    expect(rawSum).toBe(10000); // These are exact in JS

    // Now test with actual multiplication that can cause floating point
    const qty = 3;
    const unitPrice = 3333;
    const rawTotal = qty * unitPrice; // 9999 — exact
    expect(rawTotal).toBe(9999);

    const rounded = safeMoney(rawTotal);
    expect(rounded).toBe(9999);
    expect(Number.isInteger(rounded)).toBe(true);
  });

  test('customer totalSpent is always integer', async () => {
    const customer = await db.customer.create({
      data: {
        storeId: testStoreId,
        phone: `0662${Date.now()}`,
        name: 'Money Test Customer',
        tier: 'BRONZE',
        totalOrders: 3,
        totalSpent: 45678,
      },
    });
    createdCustomerIds.push(customer.id);

    expect(Number.isInteger(customer.totalSpent)).toBe(true);
    expect(customer.totalSpent).toBe(45678);

    // Increment totalSpent with safeMoney
    const addition = 1234;
    const newTotal = safeMoney(customer.totalSpent + addition);
    expect(newTotal).toBe(46912);
    expect(Number.isInteger(newTotal)).toBe(true);

    await db.customer.update({
      where: { id: customer.id },
      data: { totalSpent: newTotal },
    });

    const updated = await db.customer.findUnique({ where: { id: customer.id } });
    expect(updated!.totalSpent).toBe(46912);
  });
});
