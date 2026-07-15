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
    const { orderId } = await req.json();
    if (!orderId) return NextResponse.json({ success: false, message: 'orderId requis' }, { status: 400 });

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

    // NOEST response: { success, data: [{ tracking, status, causer, events: [...] }] }
    const shipment = trackData?.data?.[0];
    if (!shipment) {
      return NextResponse.json({ success: false, message: 'Aucune donnée NOEST' }, { status: 502 });
    }

    const rawEvents: Array<{ event_key: string; event_label: string; causer?: string; date?: string }> =
      shipment.events ?? [];

    // Upsert each event (idempotent by orderId+eventKey)
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

    // Also sync high-level status back to order if NOEST says delivered/returned
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
  } catch (err: any) {
    console.error('[POST /api/noest/sync]', err);
    return NextResponse.json({ success: false, message: err.message ?? 'Erreur serveur' }, { status: 500 });
  }
}
