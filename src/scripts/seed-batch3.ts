import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DIVERSE_BATCH_3 = [
  {
    name: "Pure Egyptian Cotton Throw",
    slug: "egyptian-cotton-throw",
    category: "Home & Living",
    price: 9500,
    costPrice: 2800,
    stock: 20,
    featured: false,
    description: "Wrap yourself in pure luxury. Hand-loomed in Egypt, this throw features a delicate waffle weave that is both breathable and incredibly warm. Minimalist cream tone fits any modern interior.",
    images: [
      "https://images.unsplash.com/photo-1580301762395-21ce84d00bc6?q=80&w=1200",
      "https://images.unsplash.com/photo-1616627544454-994628cc7467?q=80&w=1200"
    ],
    variants: [
      { name: "Color", value: "Ivory", priceModifier: 0 },
      { name: "Color", value: "Slate", priceModifier: 0 }
    ]
  },
  {
    name: "Brushed Gold Desk Organizer",
    slug: "gold-desk-organizer",
    category: "Office",
    price: 6400,
    costPrice: 1800,
    stock: 35,
    featured: true,
    description: "Elevate your workspace. This single-piece aluminum organizer features a brushed gold finish with non-slip silicone feet. Perfect for holding luxury pens and your minimalist smartphone.",
    images: [
      "https://images.unsplash.com/photo-1586075010620-333066373801?q=80&w=1200",
      "https://images.unsplash.com/photo-1593062310115-4ba972e09880?q=80&w=1200"
    ],
    variants: [
      { name: "Finish", value: "Brushed Gold", priceModifier: 0 },
      { name: "Finish", value: "Matte Black", priceModifier: 0 }
    ]
  },
  {
    name: "Ebony & Cedar Diffuser",
    slug: "ebony-cedar-diffuser",
    category: "Home & Fragrance",
    price: 8200,
    comparePrice: 10500,
    costPrice: 2500,
    stock: 15,
    featured: true,
    description: "Atmospheric and grounding. Notes of dark ebony wood, fresh cedarwood, and a hint of smoked vanilla. Includes 8 black rattan reeds and a hand-blown glass vessel.",
    images: [
      "https://images.unsplash.com/photo-1602928321679-560bb453f190?q=80&w=1200",
      "https://images.unsplash.com/photo-1608528577891-eb055944f2e7?q=80&w=1200"
    ],
    variants: [
      { name: "Size", value: "100ml", priceModifier: 0 },
      { name: "Size", value: "250ml", priceModifier: 3500 }
    ]
  },
  {
    name: "Monochrome Canvas Tote",
    slug: "monochrome-canvas-tote",
    category: "Accessories",
    price: 4900,
    costPrice: 1200,
    stock: 60,
    featured: false,
    description: "The everyday essential. Heavyweight 16oz canvas with reinforced leather handles. Minimalist branding and a concealed interior pocket for safety.",
    images: [
      "https://images.unsplash.com/photo-1544816155-12df9643f363?q=80&w=1200",
      "https://images.unsplash.com/photo-1591337676887-a217a6970c8a?q=80&w=1200"
    ],
    variants: [
      { name: "Color", value: "Onyx", priceModifier: 0 },
      { name: "Color", value: "Eggshell", priceModifier: 0 }
    ]
  }
];

async function main() {
  console.log('🚀 Starting Batch 3 product seed...');

  const store = await prisma.store.findFirst({
    where: { isDeleted: false }
  });

  if (!store) return;

  for (const productData of DIVERSE_BATCH_3) {
    const { images, variants, ...baseData } = productData;
    await prisma.product.upsert({
      where: { storeId_slug: { storeId: store.id, slug: baseData.slug } },
      update: { ...baseData, images: JSON.stringify(images), variants: JSON.stringify(variants) },
      create: { ...baseData, storeId: store.id, images: JSON.stringify(images), variants: JSON.stringify(variants) }
    });
    console.log(`✅ ${baseData.name} synced.`);
  }

  console.log('✨ Batch 3 seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
