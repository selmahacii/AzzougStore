import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- STARTING DETAILED ORDER SEEDING ---');

  // 1. Get Prerequisites
  const store = await prisma.store.findFirst({ where: { isActive: true } });
  if (!store) {
    console.error('No active store found. Please create a store first.');
    return;
  }

  const product = await prisma.product.findFirst({ where: { storeId: store.id } });
  if (!product) {
    console.error('No product found. Please create at least one product.');
    return;
  }

  const user = await prisma.user.findFirst();
  if (!user) {
    console.error('No user found.');
    return;
  }

  const ordersToCreate = [
    {
      orderNumber: `ORD-9821-NEW`,
      customerName: 'Arezki Benali',
      customerPhone: '0550123456',
      customerAddress: 'Cité 1000 logements, Batiment C',
      customerWilaya: 'Alger',
      customerCommune: 'Sidi M\'Hamed',
      status: 'NEW',
      total: product.price + 400,
      deliveryFee: 400,
      source: 'facebook_ads',
    },
    {
      orderNumber: `ORD-9822-PROC`,
      customerName: 'Sami Kaced',
      customerPhone: '0661987654',
      customerAddress: 'Rue des Frères Khechiba',
      customerWilaya: 'Blida',
      customerCommune: 'Ouled Yaich',
      status: 'ASSIGNED',
      assignedTo: user.id,
      total: (product.price * 2) + 500,
      deliveryFee: 500,
      source: 'tiktok',
    },
    {
      orderNumber: `ORD-9823-CALL`,
      customerName: 'Lyna Mansour',
      customerPhone: '0770554433',
      customerAddress: 'Cité Jardins, Villa 12',
      customerWilaya: 'Oran',
      customerCommune: 'Bir El Djir',
      status: 'CALLED',
      assignedTo: user.id,
      total: product.price + 600,
      deliveryFee: 600,
    },
    {
      orderNumber: `ORD-9824-CONF`,
      customerName: 'Yacine Brahimi',
      customerPhone: '0540112233',
      customerAddress: 'Résidence El Mordjane, Appt 5',
      customerWilaya: 'Sétif',
      customerCommune: 'El Eulma',
      status: 'CONFIRMED',
      assignedTo: user.id,
      total: product.price + 600,
      deliveryFee: 600,
      notes: 'Client VIP, emballage cadeau souhaité.'
    },
    {
      orderNumber: `ORD-9825-SHIP`,
      customerName: 'Karim Ziani',
      customerPhone: '0655889900',
      customerAddress: 'Boulevard de la Soummam',
      customerWilaya: 'Béjaïa',
      customerCommune: 'Béjaïa Centre',
      status: 'SHIPPED',
      trackingNumber: 'NOEST-82910283',
      assignedTo: user.id,
      total: product.price + 600,
      deliveryFee: 600,
    },
    {
      orderNumber: `ORD-9826-DELI`,
      customerName: 'Meriem Berrabah',
      customerPhone: '0799112244',
      customerAddress: 'Avenue de la République',
      customerWilaya: 'Constantine',
      customerCommune: 'Khroub',
      status: 'DELIVERED',
      trackingNumber: 'NOEST-77281920',
      assignedTo: user.id,
      total: product.price + 600,
      deliveryFee: 600,
    },
    {
      orderNumber: `ORD-9827-RET`,
      customerName: 'Hamid Oulmi',
      customerPhone: '0555223311',
      customerAddress: 'Rue Colonel Amirouche',
      customerWilaya: 'Tizi Ouzou',
      customerCommune: 'Draâ Ben Khedda',
      status: 'RETURNED',
      trackingNumber: 'NOEST-66152433',
      assignedTo: user.id,
      total: product.price + 600,
      deliveryFee: 600,
      notes: 'Retourné pour Client Absent après 3 tentatives.'
    }
  ];

  for (const o of ordersToCreate) {
    try {
      const createdOrder = await prisma.order.upsert({
        where: { orderNumber: o.orderNumber },
        update: {},
        create: {
          storeId: store.id,
          orderNumber: o.orderNumber,
          customerName: o.customerName,
          customerPhone: o.customerPhone,
          customerAddress: o.customerAddress,
          customerWilaya: o.customerWilaya,
          customerCommune: o.customerCommune,
          status: o.status,
          total: o.total,
          subtotal: o.total - o.deliveryFee,
          deliveryFee: o.deliveryFee,
          assignedTo: o.assignedTo,
          trackingNumber: o.trackingNumber,
          source: o.source,
          notes: o.notes,
          items: {
            create: {
              productId: product.id,
              productName: product.name,
              quantity: o.orderNumber.includes('PROC') ? 2 : 1,
              unitPrice: product.price,
              image: JSON.parse(product.images)?.[0] || '',
            }
          },
          events: {
             create: {
                actorId: user.id,
                fromStatus: null,
                toStatus: o.status,
                note: 'Protocol Initialized via Matrix Pulse'
             }
          }
        }
      });
      console.log(`+ CREATED [${o.status}] ${createdOrder.orderNumber}`);
    } catch (e) {
      console.warn(`! FAILED to create ${o.orderNumber}:`, e);
    }
  }

  console.log('--- SEEDING COMPLETE ---');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
