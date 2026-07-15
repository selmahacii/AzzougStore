import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Seeding reviews for new products...');

  const store = await prisma.store.findFirst({ where: { isDeleted: false } });
  if (!store) return;

  const products = await prisma.product.findMany({
    where: { storeId: store.id },
    take: 10
  });

  const REVIEW_TEMPLATES = [
    { rating: 5, customer: "Sofiane M.", comment: "Excellent quality, exactly what I expected from a premium brand." },
    { rating: 5, customer: "Amine K.", comment: "The leather is incredibly soft. Fast delivery too!" },
    { rating: 4, customer: "Sarah B.", comment: "Beautiful design. The color is slightly darker than the photo, but I love it." },
    { rating: 5, customer: "Karim Z.", comment: "Top tier craftsmanship. Worth every dinar." },
    { rating: 4, customer: "Lina D.", comment: "Very elegant. The packaging was also very nice." }
  ];

  for (const product of products) {
    // Add 2-3 reviews per product
    const numReviews = Math.floor(Math.random() * 3) + 2;
    for (let i = 0; i < numReviews; i++) {
      const template = REVIEW_TEMPLATES[Math.floor(Math.random() * REVIEW_TEMPLATES.length)];
      await prisma.review.create({
        data: {
          productId: product.id,
          storeId: store.id,
          customerName: template.customer,
          rating: template.rating,
          comment: template.comment,
          isApproved: true,
          isVerified: true
        }
      });
    }
    console.log(`✅ Added reviews for ${product.name}`);
  }

  console.log('✨ Reviews seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
