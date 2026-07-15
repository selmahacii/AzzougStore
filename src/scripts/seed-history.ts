import pkg from '@prisma/client';
const { PrismaClient } = pkg;
type OrderStatus = 'NEW' | 'ASSIGNED' | 'CALLED' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'RETURNED';

const prisma = new PrismaClient();

async function main() {
  console.log('--- GENERATING HISTORICAL INTEL DATA ---');

  const store = await prisma.store.findFirst({ where: { isActive: true } });
  const user = await prisma.user.findFirst();
  const products = await prisma.product.findMany({ where: { storeId: store?.id } });

  if (!store || !user || products.length === 0) {
    console.error('Incomplete data for history generation.');
    return;
  }

  const statuses: OrderStatus[] = ['NEW', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'];
  const wilayas = ['Alger', 'Blida', 'Oran', 'Constantine', 'Sétif', 'Annaba', 'Béjaïa', 'Tlemcen'];
  
  // Clear old test clusters to avoid clutter if needed, or just add new ones
  // For this exercise, we add 150 historical orders over 90 days.
  
  for (let i = 0; i < 150; i++) {
    const daysAgo = Math.floor(Math.random() * 90);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);

    const product = products[Math.floor(Math.random() * products.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const wilaya = wilayas[Math.floor(Math.random() * wilayas.length)];
    const qty = Math.floor(Math.random() * 2) + 1;
    const deliveryFee = 600;
    const total = (product.price * qty) + deliveryFee;

    await prisma.order.create({
      data: {
        storeId: store.id,
        orderNumber: `HIST-${10000 + i}`,
        customerName: `Entity-${i}`,
        customerPhone: `0555${Math.floor(100000 + Math.random() * 899999)}`,
        customerWilaya: wilaya,
        customerAddress: 'Zone Industrielle Node-X',
        status: status,
        total: total,
        subtotal: product.price * qty,
        deliveryFee: deliveryFee,
        createdAt: date,
        items: {
          create: {
            productId: product.id,
            productName: product.name,
            quantity: qty,
            unitPrice: product.price,
            image: JSON.parse(product.images || '[]')[0] || '',
          }
        }
      }
    });

    if (i % 30 === 0) console.log(`Buffered ${i} entries...`);
  }

  console.log('--- INTEL DATAFEED COMPLETED: 150 NODES DEPLOYED ---');
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
