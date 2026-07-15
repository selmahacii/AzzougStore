import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DIVERSE_PRODUCTS = [
  {
    name: "Architectural Billfold",
    slug: "architectural-billfold",
    category: "Wallets",
    price: 8500,
    comparePrice: 12000,
    costPrice: 3500,
    stock: 25,
    featured: true,
    description: "A geometric study in form and function. This billfold features a sharp, structural silhouette with hand-painted edges. Crafted from full-grain vegetable-tanned leather that develops a unique patina over time.",
    images: [
      "https://images.unsplash.com/photo-1627123424574-724758594e93?q=80&w=1200",
      "https://images.unsplash.com/photo-1559563458-527698bf5295?q=80&w=800",
      "https://images.unsplash.com/photo-1606503825008-909a6866bf0e?q=80&w=1200"
    ],
    variants: [
      { name: "Color", value: "Midnight Black", priceModifier: 0 },
      { name: "Color", value: "Graphite Grey", priceModifier: 0 },
      { name: "Leather", value: "Pebbled", priceModifier: 500 }
    ]
  },
  {
    name: "Saffiano Travel Clutch",
    slug: "saffiano-travel-clutch",
    category: "Handbags",
    price: 18500,
    comparePrice: 24000,
    costPrice: 7500,
    stock: 12,
    featured: true,
    description: "Designed for the modern nomad. This clutch features cross-hatched Saffiano leather, known for its scratch and water resistance. Includes a dedicated slot for your passport and high-density foam padding for electronics.",
    images: [
      "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?q=80&w=1200",
      "https://images.unsplash.com/photo-1566150905458-1bf1fd113f0d?q=80&w=1200",
      "https://images.unsplash.com/photo-1594223274512-ad4803739b7c?q=80&w=1200"
    ],
    variants: [
      { name: "Color", value: "Noir", priceModifier: 0 },
      { name: "Color", value: "Taupe", priceModifier: 0 },
      { name: "Hardware", value: "Gold", priceModifier: 1000 }
    ]
  },
  {
    name: "Minimalist Card Sleeve",
    slug: "minimalist-card-sleeve",
    category: "Accessories",
    price: 4500,
    comparePrice: 6500,
    costPrice: 1200,
    stock: 50,
    featured: false,
    description: "For those who carry only the essentials. This ultra-slim sleeve holds up to 6 cards and folded cash. Precision-cut and hand-stitched for ultimate durability without the bulk.",
    images: [
      "https://images.unsplash.com/photo-1590247813693-5541d1c609fd?q=80&w=1200",
      "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?q=80&w=1200"
    ],
    variants: [
      { name: "Color", value: "Tan", priceModifier: 0 },
      { name: "Color", value: "Cognac", priceModifier: 0 },
      { name: "Stitch", value: "Contrast White", priceModifier: 200 }
    ]
  },
  {
    name: "Obsidian Zip Around",
    slug: "obsidian-zip-around",
    category: "Wallets",
    price: 12500,
    comparePrice: 15500,
    costPrice: 4800,
    stock: 18,
    featured: true,
    description: "Security meets style. A heavy-duty brass zipper protects 12 card slots and two large cash compartments. The interior is lined with premium suede for a tactile luxury experience.",
    images: [
      "https://images.unsplash.com/photo-1614179677232-25992f81f97c?q=80&w=1200",
      "https://images.unsplash.com/photo-1584917865442-de89df76afd3?q=80&w=1200"
    ],
    variants: [
      { name: "Texture", value: "Smooth", priceModifier: 0 },
      { name: "Texture", value: "Crocodile Emboss", priceModifier: 2500 }
    ]
  },
  {
    name: "Artisanal Coin Pouch",
    slug: "artisanal-coin-pouch",
    category: "Accessories",
    price: 3200,
    costPrice: 900,
    stock: 30,
    featured: false,
    description: "A small piece of craftsmanship. Perfect for loose change or small jewelry. Features a vintage-style brass snap closure.",
    images: [
      "https://images.unsplash.com/photo-1511211029107-ee21d4734328?q=80&w=1200"
    ],
    variants: [
      { name: "Material", value: "Cowhide", priceModifier: 0 },
      { name: "Material", value: "Suede", priceModifier: 0 }
    ]
  },
  {
    name: "Limited Edition 'Sahara' Brief",
    slug: "sahara-briefcase",
    category: "Limited Edition",
    price: 45000,
    comparePrice: 65000,
    costPrice: 18000,
    stock: 5,
    featured: true,
    description: "Our most exclusive piece. Inspired by the golden dunes, this briefcase features rare sand-toned leather and hand-engraved metal accents. Only 50 units produced worldwide.",
    images: [
      "https://images.unsplash.com/photo-1473188588955-739fa49b802a?q=80&w=1200",
      "https://images.unsplash.com/photo-1490234149594-54c7a522cb85?q=80&w=1200"
    ],
    variants: [
      { name: "Size", value: "Medium", priceModifier: 0 },
      { name: "Size", value: "Large", priceModifier: 8000 }
    ]
  }
];

async function main() {
  console.log('🚀 Starting advanced product seed...');

  // Get first available store
  const store = await prisma.store.findFirst({
    where: { isDeleted: false }
  });

  if (!store) {
    console.error('❌ No active store found. Please create a store first.');
    return;
  }

  console.log(`📍 Adding products to store: ${store.name} (${store.id})`);

  for (const productData of DIVERSE_PRODUCTS) {
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

  console.log('✨ Advanced seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
