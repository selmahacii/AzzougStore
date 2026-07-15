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

/** Build a clear product description: "Coussin (x2) [Noir] + T-Shirt (x1) [L]" */
function buildProductList(items: Array<{ productName: string; quantity: number; variantDetails?: any }>) {
  return items
    .map((i) => {
      let desc = `${i.productName} (x${i.quantity})`;
      if (i.variantDetails) {
        const vd = typeof i.variantDetails === 'string' ? (() => { try { return JSON.parse(i.variantDetails); } catch { return null; } })() : i.variantDetails;
        const variant = vd?.variant || vd?.color || vd?.size || vd?.name;
        if (variant) desc += ` [${variant}]`;
      }
      return desc;
    })
    .join(' + ');
}

/** Lookup commune ID from Yalidine API */
async function lookupCommuneId(apiId: string, apiToken: string, wilayaId: number, communeName: string): Promise<number | null> {
  try {
    const res = await fetch(`${YALIDINE_BASE}/communes/?wilaya_id=${wilayaId}`, {
      headers: makeYalidineHeaders(apiId, apiToken),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const communes: any[] = body?.data ?? body ?? [];
    const communeNameLower = (communeName || '').toLowerCase().trim();
    const match = communes.find(
      (c: any) =>
        (c.name || '').toLowerCase().trim() === communeNameLower ||
        (c.name_ascii || '').toLowerCase().trim() === communeNameLower
    );
    return match ? Number(match.id ?? match.commune_id) : null;
  } catch {
    return null;
  }
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

    // Map wilaya name → Yalidine wilaya ID (1-indexed)
    const wilayaName = (order.customerWilaya ?? '').toLowerCase().trim();
    const wilayaIndex = WILAYAS.findIndex((w) => w.toLowerCase().trim() === wilayaName);
    const wilayaId = wilayaIndex !== -1 ? wilayaIndex + 1 : 16;

    // Lookup commune ID from Yalidine live API
    const rawCommune = order.customerCommune ?? '';
    const cleanedCommune = rawCommune.includes('·') ? rawCommune.split('·').pop()?.trim() || rawCommune : rawCommune;
    const communeId = await lookupCommuneId(apiId, apiToken, wilayaId, cleanedCommune);

    // Get delivery fee — prefer the saved fee on the order, fallback to fee grid
    let deliveryFee = typeof (order as any).deliveryFee === 'number' ? (order as any).deliveryFee : 0;
    if (!deliveryFee) {
      const feeGrid = await db.deliveryFeeGrid.findUnique({
        where: { partnerId_wilayaId: { partnerId: partner.id, wilayaId } },
      });
      deliveryFee = order.deliveryType === 'stop_desk'
        ? (feeGrid?.officeFee ?? 0)
        : (feeGrid?.homeFee ?? 0);
    }

    // Build full product description with quantities and variants
    const productList = buildProductList(
      order.items.map((i) => ({
        productName: i.productName,
        quantity: i.quantity,
        variantDetails: (i as any).variantDetails,
      }))
    );

    // Total COD = order total (products) + delivery fee
    const codAmount = Number(order.total ?? 0) + Number(deliveryFee ?? 0);

    const isStopDesk = order.deliveryType === 'stop_desk' || order.deliveryType === 'OFFICE';
    const stopdeskMatch = (order.customerAddress || '').match(/Bureau Yalidine \(ID:\s*(\d+)\)/i);
    const stopdeskId = stopdeskMatch ? Number(stopdeskMatch[1]) : null;

    const parcelPayload = [
      {
        order_id: `ORD-${order.orderNumber}`,
        firstname: order.customerName.split(' ')[0] ?? order.customerName,
        familyname: order.customerName.split(' ').slice(1).join(' ') || '-',
        contact_phone: order.customerPhone,
        address: order.customerAddress || order.customerCommune || order.customerWilaya || 'Adresse non spécifiée',
        to_wilaya_id: wilayaId,
        to_commune_id: communeId,
        product_list: productList,
        price: codAmount,
        do_insurance: 0,
        declared_value: Number(order.total ?? 0),
        height: 5,
        width: 20,
        length: 30,
        weight: 0.5,
        freeshipping: deliveryFee === 0 ? 1 : 0,
        is_stopdesk: isStopDesk ? 1 : 0,
        stopdesk_id: stopdeskId,
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
      return NextResponse.json({ success: false, message: `Yalidine API: ${res.status} — ${errBody}` }, { status: 502 });
    }

    const data = await res.json();
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
