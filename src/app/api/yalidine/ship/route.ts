import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { WILAYAS } from '@/lib/wilaya-data';

const YALIDINE_BASE = 'https://api.yalidine.app/v1';

function makeYalidineHeaders(apiId: string, apiToken: string) {
  return {
    'X-API-ID': apiId,
    'X-API-TOKEN': apiToken,
    'Content-Type': 'application/json',
  };
}

export async function POST(req: Request) {
  try {
    const { orderId } = await req.json();
    if (!orderId) return NextResponse.json({ success: false, message: 'orderId requis' }, { status: 400 });

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { items: true, store: true },
    });
    if (!order) return NextResponse.json({ success: false, message: 'Commande introuvable' }, { status: 404 });
    if (order.trackingNumber) {
      return NextResponse.json({ success: true, tracking: order.trackingNumber, message: 'Déjà expédiée' });
    }

    // Load Yalidine config for this store
    const partner = await db.deliveryPartner.findFirst({
      where: { storeId: order.storeId, code: 'yalidine', isActive: true },
    });
    if (!partner || !partner.isApiEnabled) {
      return NextResponse.json({ success: false, message: 'Yalidine non configuré pour cette boutique' }, { status: 400 });
    }

    const cfg = partner.apiConfig as Record<string, string>;
    const apiId = cfg.api_id;
    const apiToken = cfg.api_token;
    if (!apiId || !apiToken) {
      return NextResponse.json({ success: false, message: 'Identifiants Yalidine manquants' }, { status: 400 });
    }

    // Map wilaya name → number
    const wilayaIndex = WILAYAS.findIndex(
      (w) => w.toLowerCase() === (order.customerWilaya ?? '').toLowerCase()
    );
    const wilayaId = wilayaIndex !== -1 ? wilayaIndex + 1 : 16;

    // Get delivery fee for this wilaya
    const feeGrid = await db.deliveryFeeGrid.findUnique({
      where: { partnerId_wilayaId: { partnerId: partner.id, wilayaId } },
    });
    const price = feeGrid?.homeFee ?? 0;

    const parcelPayload = [
      {
        order_id: `ORD-${order.orderNumber}`,
        firstname: order.customerName.split(' ')[0] ?? order.customerName,
        familyname: order.customerName.split(' ').slice(1).join(' ') || '-',
        contact_phone: order.customerPhone,
        address: order.customerAddress || 'Adresse non spécifiée',
        to_wilaya_id: wilayaId,
        to_commune_id: null, // Yalidine accepts null if unknown
        product_list: order.items.map((i) => i.productName).join(', '),
        price: order.total,
        do_insurance: 0,
        declared_value: order.total,
        height: 5,
        width: 20,
        length: 30,
        weight: 0.5,
        freeshipping: price === 0 ? 1 : 0,
        is_stopdesk: order.deliveryType === 'OFFICE' ? 1 : 0,
        stopdesk_id: null,
        has_exchange: 0,
        exchange_product_list: '',
      },
    ];

    const res = await fetch(`${YALIDINE_BASE}/parcels/`, {
      method: 'POST',
      headers: makeYalidineHeaders(apiId, apiToken),
      body: JSON.stringify(parcelPayload),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('[yalidine/ship] API error:', res.status, errBody);
      return NextResponse.json({ success: false, message: `Yalidine API: ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    // Response: { "ORD-xxx": { success, tracking, label } }
    const key = `ORD-${order.orderNumber}`;
    const result = (data as any)?.[key] ?? Object.values(data as any)[0];

    if (!result?.success || !result?.tracking) {
      return NextResponse.json(
        { success: false, message: result?.message ?? 'Échec création colis Yalidine' },
        { status: 502 }
      );
    }

    const tracking = result.tracking as string;
    const labelUrl = result.label as string | undefined;

    await db.order.update({
      where: { id: orderId },
      data: {
        trackingNumber: tracking,
        carrierId: partner.id,
        status: 'SHIPPED',
      },
    });

    return NextResponse.json({ success: true, tracking, label_url: labelUrl });
  } catch (err: any) {
    console.error('[POST /api/yalidine/ship]', err);
    return NextResponse.json({ success: false, message: err.message ?? 'Erreur serveur' }, { status: 500 });
  }
}
