import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const orders = await db.order.findMany({
      where: {
        trackingNumber: { not: null, notIn: [''] },
        status: { in: ['NEW', 'ASSIGNED', 'CALLED', 'RESCHEDULED', 'IN_PROGRESS', 'CONFIRMED'] },
        isDeleted: false,
      }
    });

    let count = 0;
    for (const order of orders) {
      if (order.trackingNumber && order.trackingNumber.trim() !== '') {
        await db.order.update({
          where: { id: order.id },
          data: { status: 'SHIPPED' }
        });
        
        await db.orderEvent.create({
          data: {
            id: crypto.randomUUID(),
            orderId: order.id,
            actorId: 'system',
            fromStatus: order.status,
            toStatus: 'SHIPPED',
            note: 'Auto-fixed status to SHIPPED because tracking_number exists.',
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        });
        count++;
      }
    }

    return NextResponse.json({ success: true, fixed: count });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
