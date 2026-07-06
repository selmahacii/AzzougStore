import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { WILAYAS } from '@/lib/wilaya-data';

const NOEST_BASE = 'https://app.noest-dz.com';

export async function POST(req: Request) {
  try {
    const { orderId } = await req.json();
    if (!orderId) return NextResponse.json({ success: false, message: 'orderId requis' }, { status: 400 });

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) return NextResponse.json({ success: false, message: 'Commande introuvable' }, { status: 404 });
    if (order.trackingNumber) {
      return NextResponse.json({ success: true, tracking: order.trackingNumber, message: 'Déjà expédiée' });
    }

    // Load Noest config for this store (api_token + guid from DeliveryPartner)
    const partner = await db.deliveryPartner.findFirst({
      where: { storeId: order.storeId, code: 'noest', isActive: true },
    });
    const cfg = (partner?.apiConfig ?? {}) as Record<string, string>;
    const NOEST_TOKEN = cfg.api_token ?? process.env.NOEST_API_TOKEN ?? '';
    const NOEST_GUID = cfg.guid ?? process.env.NOEST_USER_GUID ?? '';

    if (!NOEST_TOKEN || !NOEST_GUID) {
      return NextResponse.json({ success: false, message: 'Noest non configuré — renseignez API Token et GUID dans Partenaires Livraison' }, { status: 400 });
    }

    const noestHeaders = {
      Authorization: `Bearer ${NOEST_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    };

    const wilayaIndex = WILAYAS.findIndex(w => w.toLowerCase() === order.customerWilaya?.toLowerCase());
    const wilayaId = wilayaIndex !== -1 ? wilayaIndex + 1 : 16;

    // 1. Create order in NOEST
    const createRes = await fetch(`${NOEST_BASE}/api/public/create/order`, {
      method: 'POST',
      headers: noestHeaders,
      body: JSON.stringify({
        user_guid: NOEST_GUID,
        type_id: 1,
        poids: 0.5,
        can_open: 1,
        stop_desk: order.deliveryType === 'OFFICE' ? 1 : 0,
        reference: `ORD-${order.orderNumber}`,
        client: order.customerName,
        phone: order.customerPhone,
        adresse: order.customerAddress || 'Adresse non spécifiée',
        wilaya_id: wilayaId,
        commune: order.customerCommune || order.customerWilaya || 'Alger',
        montant: order.total,
        produit: order.items.map(i => i.productName).join(', '),
        remarque: order.notes || 'Appeler avant livraison',
      }),
    });
    const createData = await createRes.json();
    if (!createData.success || !createData.tracking) {
      return NextResponse.json({ success: false, message: createData.message || 'Échec création NOEST' }, { status: 502 });
    }

    const tracking = createData.tracking as string;

    // 2. Validate (mandatory)
    const validRes = await fetch(`${NOEST_BASE}/api/public/valid/order`, {
      method: 'POST',
      headers: noestHeaders,
      body: JSON.stringify({ user_guid: NOEST_GUID, tracking }),
    });
    await validRes.json();

    // 3. Persist tracking number on order
    await db.order.update({
      where: { id: orderId },
      data: { trackingNumber: tracking, carrierId: 'noest', status: 'SHIPPED' },
    });

    return NextResponse.json({ success: true, tracking });
  } catch (err: any) {
    console.error('[POST /api/noest/ship]', err);
    return NextResponse.json({ success: false, message: err.message ?? 'Erreur serveur' }, { status: 500 });
  }
}
