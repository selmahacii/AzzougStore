import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DIVERSE_BATCH_2 = [
  {
    name: "Tuscan Leather Chelsea Boots",
    slug: "tuscan-chelsea-boots",
    category: "Footwear",
    price: 32000,
    comparePrice: 38500,
    costPrice: 14000,
    stock: 0, // Out of stock
    featured: true,
    description: "Classic silhouette meets extraordinary comfort. These Chelsea boots are made from hand-selected Tuscan calfskin with a weather-resistant finish. Pull tabs and elastic gussets for effortless wear.",
    images: [
      "https://images.unsplash.com/photo-1605733513597-a8f8d410fe3c?q=80&w=1200",
      "https://images.unsplash.com/photo-1549298916-b41d501d3772?q=80&w=1200"
    ],
    variants: [
      { name: "Size", value: "41", priceModifier: 0 },
      { name: "Size", value: "42", priceModifier: 0 },
      { name: "Size", value: "43", priceModifier: 0 },
      { name: "Color", value: "Chestnut", priceModifier: 0 },
      { name: "Color", value: "Ebony", priceModifier: 0 }
    ]
  },
  {
    name: "Geometric Silk Scarf",
    slug: "geometric-silk-scarf",
    category: "Accessories",
    price: 7800,
    costPrice: 2100,
    stock: 45,
    featured: false,
    description: "100% Mulberry silk. This scarf features an exclusive hand-drawn geometric print inspired by modernist architecture. Lightweight and versatile for any season.",
    images: [
      "https://images.unsplash.com/photo-1584917865442-de89df76afd3?q=80&w=1200",
      "https://images.unsplash.com/photo-1601924582970-334284faf6ca?q=80&w=1200"
    ],
    variants: [
      { name: "Pattern", value: "Eclipse", priceModifier: 0 },
      { name: "Pattern", value: "Horizon", priceModifier: 0 }
    ]
  },
  {
    name: "Carbon Fiber Wallet",
    slug: "carbon-fiber-wallet",
    category: "Wallets",
    price: 11200,
    comparePrice: 14000,
    costPrice: 3800,
    stock: 22,
    featured: true,
    description: "High-tech meets high-fashion. Aerospace-grade carbon fiber woven into a sleek, minimalist billfold. RFID-blocking technology included for modern security.",
    images: [
      "https://images.unsplash.com/photo-1627123424574-724758594e93?q=80&w=1200",
      "https://images.unsplash.com/photo-1584030373081-f37b7bb4fa8e?q=80&w=1200"
    ],
    variants: [
      { name: "Finish", value: "Matte", priceModifier: 0 },
      { name: "Finish", value: "Glossy", priceModifier: 0 }
    ]
  },
  {
    name: "The Nomad Duffel Bag",
    slug: "nomad-duffel-bag",
    category: "Travel",
    price: 48000,
    comparePrice: 55000,
    costPrice: 22000,
    stock: 8,
    featured: true,
    description: "Your ultimate travel companion. A spacious 45L duffel made from waxed canvas and full-grain leather. Multiple compartments for organized global exploration.",
    images: [
      "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?q=80&w=1200",
      "https://images.unsplash.com/photo-1547949003-9792a18a2601?q=80&w=1200"
    ],
    variants: [
      { name: "Material", value: "Waxed Canvas", priceModifier: 0 },
      { name: "Material", value: "Full Grain Leather", priceModifier: 15000 }
    ]
  }
];

async function main() {
  console.log('🚀 Starting Batch 2 product seed...');

  const store = await prisma.store.findFirst({
    where: { isDeleted: false }
  });

  if (!store) {
    console.error('❌ No active store found.');
    return;
  }

  for (const productData of DIVERSE_BATCH_2) {
    try {
      const { images, variants, ...baseData } = productData;
      
      const product = await prisma.product.upsert({
        where: {
          storeId_slug: {
            storeId: store.id,
            slug: baseData.slug
          }
        },
        update: {
          ...baseData,
          images: JSON.stringify(images),
          variants: JSON.stringify(variants)
        },
        create: {
          ...baseData,
          storeId: store.id,
          images: JSON.stringify(images),
          variants: JSON.stringify(variants)
        }
      });
      console.log(`✅ ${product.name} synced.`);
    } catch (err) {
      console.error(`❌ Failed to sync ${productData.name}:`, err);
    }
  }

  console.log('✨ Batch 2 seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
