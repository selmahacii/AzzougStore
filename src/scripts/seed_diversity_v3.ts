import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const STORE_CONFIGS = {
  MODE_BIJOUX: "cmnswud7i001svfngjofss8uh",
  TECH_CASES: "cmnswud77001qvfngtd549fh7",
  VELOCE_SPORT: "cmnswud6v001ovfngbxlozcw0"
};

const PRODUCTS_MAP = {
  [STORE_CONFIGS.MODE_BIJOUX]: [
    {
      name: "Handcrafted Silver Lotus Necklace",
      slug: "silver-lotus-necklace",
      category: "Jewelry",
      price: 12500,
      costPrice: 4200,
      stock: 12,
      featured: true,
      description: "Meticulously crafted from sterling silver, this lotus-inspired necklace represents purity and timeless elegance. Each piece is hand-finished by local artisans.",
      images: ["https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?q=80&w=1200", "https://images.unsplash.com/photo-1535633302704-c02fbcaf8c2a?q=80&w=1200"]
    },
    {
      name: "Geometric Gold-Plated Bracelet",
      slug: "geometric-gold-bracelet",
      category: "Jewelry",
      price: 8900,
      costPrice: 2800,
      stock: 25,
      featured: true,
      description: "Modern minimalism at its finest. This 18k gold-plated cuff features an adjustable open design with distinct geometric facets.",
      images: ["https://images.unsplash.com/photo-1611591437281-460bfbe1520e?q=80&w=1200"]
    },
    {
      name: "Silk Blend Patterned Scarf",
      slug: "silk-patterned-scarf",
      category: "Accessories",
      price: 5400,
      costPrice: 1500,
      stock: 40,
      featured: false,
      description: "Soft silk blend featuring intricate artisanal patterns. Perfect for a versatile seasonal deployment.",
      images: ["https://images.unsplash.com/photo-1520903920243-00d872a2d1c9?q=80&w=1200"]
    }
  ],
  [STORE_CONFIGS.TECH_CASES]: [
    {
      name: "Aero-Grade Carbon Fiber Case",
      slug: "carbon-fiber-case-ultra",
      category: "Protection",
      price: 6800,
      costPrice: 1900,
      stock: 100,
      featured: true,
      description: "Ultra-slim aerospace-grade 3K carbon fiber. Lightweight, durable, and signal-neutral. The ultimate tactical protection node.",
      images: ["https://images.unsplash.com/photo-1603302576837-37561b2e2302?q=80&w=1200", "https://images.unsplash.com/photo-1586953101559-4ad3364f899e?q=80&w=1200"]
    },
    {
      name: "15W Magnetic Fast Charger",
      slug: "magnetic-fast-charger",
      category: "Energy",
      price: 4500,
      costPrice: 1200,
      stock: 75,
      featured: true,
      description: "Precision-aligned magnetic charging node. Aluminum chassis for optimal thermal dissipation and high-speed energy flow.",
      images: ["https://images.unsplash.com/photo-1615526675159-e248c3021d3f?q=80&w=1200"]
    },
    {
      name: "ANC Stealth Headphones",
      slug: "anc-stealth-headphones",
      category: "Audio",
      price: 32000,
      costPrice: 14000,
      stock: 15,
      featured: true,
      description: "Active Noise Cancellation terminal with hybrid drive nodes. 40-hour deployment window on a single charge.",
      images: ["https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=1200"]
    }
  ],
  [STORE_CONFIGS.VELOCE_SPORT]: [
    {
      name: "Performance Hex Dumbbells",
      slug: "hex-dumbbells-set",
      category: "Equipment",
      price: 18500,
      costPrice: 7500,
      stock: 20,
      featured: true,
      description: "Anti-roll hexagonal design with premium rubber coating and ergonomic knurled steel grip nodes.",
      images: ["https://images.unsplash.com/photo-1517836357463-d25dfeac3438?q=80&w=1200", "https://images.unsplash.com/photo-1583454110551-21f2fa2ec617?q=80&w=1200"]
    },
    {
      name: "Alignment Smart Yoga Mat",
      slug: "smart-yoga-mat",
      category: "Precision",
      price: 9800,
      costPrice: 3200,
      stock: 30,
      featured: true,
      description: "High-density alignment mat featuring laser-etched navigational vectors for perfect posture throughput.",
      images: ["https://images.unsplash.com/photo-1592419044706-39796d40f98c?q=80&w=1200"]
    },
    {
      name: "Tactical Pro Massage Gun",
      slug: "pro-massage-gun",
      category: "Recovery",
      price: 24000,
      costPrice: 8500,
      stock: 10,
      featured: true,
      description: "High-torque brushless motor for rapid muscular recovery. Multiple node attachments for targeted tissue logistics.",
      images: ["https://images.unsplash.com/photo-1596395817112-9856cc651817?q=80&w=1200"]
    }
  ]
};

async function main() {
  console.log('🚀 DIVERSIFICATION START');

  for (const storeId of Object.values(STORE_CONFIGS)) {
    console.log(`\n--- Store: ${storeId} ---`);
    
    try {
      // 1. Identify all products for this store
      const products = await prisma.product.findMany({ where: { storeId } });
      const productIds = products.map(p => p.id);
      
      // 2. Identify all orders for this store
      const orders = await prisma.order.findMany({ where: { storeId } });
      const orderIds = orders.map(o => o.id);

      console.log(`Found ${productIds.length} products and ${orderIds.length} orders. Cleaning...`);

      // 3. Delete in reverse dependency order
      if (orderIds.length > 0) {
        await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      }
      
      if (productIds.length > 0) {
        await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.review.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.orderItem.deleteMany({ where: { productId: { in: productIds } } });
      }

      await prisma.order.deleteMany({ where: { storeId } });
      await prisma.product.deleteMany({ where: { storeId } });
      
      // 4. Repopulate
      const newProducts = PRODUCTS_MAP[storeId] || [];
      for (const p of newProducts) {
        const { images, ...base } = p;
        await prisma.product.create({
          data: {
            ...base,
            storeId,
            images: JSON.stringify(images),
            variants: JSON.stringify([]),
            isActive: true
          }
        });
        console.log(`+ Product: ${p.name}`);
      }
    } catch (e) {
      console.error(`!!! ERROR in store ${storeId}:`, e);
    }
  }

  console.log('\n✨ DIVERSIFICATION COMPLETE');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
