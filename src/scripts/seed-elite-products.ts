import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- STARTING ELITE PRODUCT SEEDING ---');

  const store = await prisma.store.findFirst({ where: { isActive: true } });
  if (!store) {
    console.error('No active store found.');
    return;
  }

  const eliteProducts = [
    {
      name: 'Titanium X-10 Tactical Watch',
      slug: 'titanium-x10-tactical',
      description: 'Built for extreme durability with grade-5 titanium housing and sapphire crystal glass. Features hybrid smart-analog movement with 30-day battery life and precision GPS tracking.',
      price: 24500,
      comparePrice: 29900,
      costPrice: 12000,
      category: 'Electronics',
      stock: 42,
      images: JSON.stringify(['https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?q=80&w=800']),
      featured: true,
    },
    {
      name: 'Carbon-Core Nomad Backpack',
      slug: 'carbon-core-nomad',
      description: 'A 32L weather-sealed backpack utilizing aerodynamic carbon fiber reinforcement. Includes modular organizational inserts and a rapid-access 16-inch armored laptop compartment.',
      price: 18900,
      comparePrice: 22500,
      costPrice: 8500,
      category: 'Accessories',
      stock: 124,
      images: JSON.stringify(['https://images.unsplash.com/photo-1553062407-98eeb94c6a62?q=80&w=800']),
      featured: true,
    },
    {
      name: 'Onyx-V Black Leather Chelsea',
      slug: 'onyx-v-leather-chelsea',
      description: 'Hand-crafted from premium full-grain Italian leather with a custom memory foam insole and Goodyear welt construction. The pinnacle of urban industrial aesthetics.',
      price: 32000,
      comparePrice: 38000,
      costPrice: 15500,
      category: 'Footwear',
      stock: 15,
      images: JSON.stringify(['https://images.unsplash.com/photo-1638247025967-b4e38f68917a?q=80&w=800']),
      featured: true,
    },
    {
      name: 'Azzoug Legacy Scent (50ml)',
      slug: 'azzoug-legacy-scent',
      description: 'A deep, complex fragrance profile featuring top notes of sandalwood and smoke, moving into a heart of oud and dark leather with a persistent amber finish.',
      price: 14500,
      comparePrice: 16500,
      costPrice: 4200,
      category: 'Fragrance',
      stock: 210,
      images: JSON.stringify(['https://images.unsplash.com/photo-1541643600914-78b084683601?q=80&w=800']),
    }
  ];

  for (const p of eliteProducts) {
    await prisma.product.upsert({
      where: { storeId_slug: { storeId: store.id, slug: p.slug } },
      update: { ...p },
      create: { ...p, storeId: store.id },
    });
    console.log(`+ ELITE CORE INITIALIZED: ${p.name}`);
  }

  console.log('--- PRODUCT INVENTORY HARDENED ---');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
