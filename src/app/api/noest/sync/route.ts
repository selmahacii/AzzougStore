import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const NOEST_BASE = 'https://app.noest-dz.com';
const NOEST_TOKEN = process.env.NOEST_API_TOKEN ?? 'gBMifKgtZwVEW4QYZqkxb6VZDjhzTnsDSfn';

const noestHeaders = {
  Authorization: `Bearer ${NOEST_TOKEN}`,
  'Content-Type': 'application/json',
  'X-Requested-With': 'XMLHttpRequest',
};

// GET /api/noest/sync?orderId=xxx  — fetch stored events for one order
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get('orderId');
  if (!orderId) return NextResponse.json({ success: false, message: 'orderId requis' }, { status: 400 });

  const events = await db.noestTrackingEvent.findMany({
    where: { orderId },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json({ success: true, events });
}

// POST /api/noest/sync  { orderId } — sync latest tracking from NOEST and store
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orderId = body.orderId;
    const storeId = body.store_id || body.storeId;

    if (!orderId && !storeId) {
      return NextResponse.json({ success: false, message: 'orderId ou store_id requis' }, { status: 400 });
    }

    // Single order sync
    if (orderId) {
      const order = await db.order.findUnique({ where: { id: orderId } });
      if (!order?.trackingNumber) {
        return NextResponse.json({ success: false, message: 'Aucun numéro de suivi pour cette commande' }, { status: 400 });
      }

      const trackRes = await fetch(`${NOEST_BASE}/api/public/get/trackings/info`, {
        method: 'POST',
        headers: noestHeaders,
        body: JSON.stringify({ trackings: [order.trackingNumber] }),
      });
      const trackData = await trackRes.json();

      const shipment = trackData?.data?.[0];
      if (!shipment) {
        return NextResponse.json({ success: false, message: 'Aucune donnée NOEST' }, { status: 502 });
      }

      const rawEvents: Array<{ event_key: string; event_label: string; causer?: string; date?: string }> =
        shipment.events ?? [];

      for (const ev of rawEvents) {
        await db.noestTrackingEvent.upsert({
          where: { orderId_eventKey: { orderId, eventKey: ev.event_key } },
          create: {
            orderId,
            trackingNumber: order.trackingNumber,
            eventKey: ev.event_key,
            eventLabel: ev.event_label,
            causer: ev.causer ?? null,
            eventDate: ev.date ?? null,
            rawData: ev as any,
          },
          update: {
            eventLabel: ev.event_label,
            causer: ev.causer ?? null,
            eventDate: ev.date ?? null,
            rawData: ev as any,
          },
        });
      }

      const statusMap: Record<string, string> = {
        livre: 'DELIVERED',
        livred: 'DELIVERED',
        return_dispatched_to_partenaire: 'RETURNED',
        retour_dispatched_to_partenaires: 'RETURNED',
        livraison_echoue_recu: 'RETURNED',
        return_validated_by_partener: 'RETURNED',
        fdr_activated: 'SHIPPED',
      };
      const mappedStatus = statusMap[shipment.status];
      if (mappedStatus && order.status !== mappedStatus) {
        await db.order.update({ where: { id: orderId }, data: { status: mappedStatus } });
      }

      const events = await db.noestTrackingEvent.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });

      return NextResponse.json({
        success: true,
        tracking: order.trackingNumber,
        noestStatus: shipment.status,
        events,
      });
    }

    // Store-wide sync for all orders of storeId that have tracking
    const storeOrders = await db.order.findMany({
      where: {
        storeId,
        trackingNumber: { not: null, notIn: [''] },
        status: { notIn: ['DELIVERED', 'RETURNED', 'CANCELLED', 'MERGED'] },
        isDeleted: false,
      },
    });

    if (storeOrders.length === 0) {
      return NextResponse.json({ success: true, message: 'Aucune commande à synchroniser', syncedCount: 0 });
    }

    const trackings = storeOrders.map(o => o.trackingNumber!).filter(Boolean);
    const trackRes = await fetch(`${NOEST_BASE}/api/public/get/trackings/info`, {
      method: 'POST',
      headers: noestHeaders,
      body: JSON.stringify({ trackings }),
    });
    const trackData = await trackRes.json();
    const shipments: any[] = Array.isArray(trackData?.data) ? trackData.data : [];

    let updatedCount = 0;
    const statusMap: Record<string, string> = {
      livre: 'DELIVERED',
      livred: 'DELIVERED',
      delivered: 'DELIVERED',
      return_dispatched_to_partenaire: 'RETURNED',
      retour_dispatched_to_partenaires: 'RETURNED',
      livraison_echoue_recu: 'RETURNED',
      return_validated_by_partener: 'RETURNED',
      retourne: 'RETURNED',
      returned: 'RETURNED',
    };

    for (const shipment of shipments) {
      const order = storeOrders.find(o => o.trackingNumber === shipment.tracking);
      if (!order) continue;

      const rawEvents: Array<{ event_key: string; event_label: string; causer?: string; date?: string }> =
        shipment.events ?? [];

      for (const ev of rawEvents) {
        await db.noestTrackingEvent.upsert({
          where: { orderId_eventKey: { orderId: order.id, eventKey: ev.event_key } },
          create: {
            orderId: order.id,
            trackingNumber: order.trackingNumber!,
            eventKey: ev.event_key,
            eventLabel: ev.event_label,
            causer: ev.causer ?? null,
            eventDate: ev.date ?? null,
            rawData: ev as any,
          },
          update: {
            eventLabel: ev.event_label,
            causer: ev.causer ?? null,
            eventDate: ev.date ?? null,
            rawData: ev as any,
          },
        });
      }

      const mappedStatus = statusMap[shipment.status];
      if (mappedStatus && order.status !== mappedStatus) {
        await db.order.update({ where: { id: order.id }, data: { status: mappedStatus } });
        updatedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      syncedCount: updatedCount,
      totalTracked: storeOrders.length,
    });
  } catch (err: any) {
    console.error('[POST /api/noest/sync]', err);
    return NextResponse.json({ success: false, message: err.message ?? 'Erreur serveur' }, { status: 500 });
  }
}
