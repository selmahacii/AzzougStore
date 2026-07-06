import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const YALIDINE_BASE = 'https://api.yalidine.app/v1';

// GET  /api/yalidine/wilayas?store_id=xxx          → returns current fee grid
// POST /api/yalidine/wilayas?store_id=xxx          → syncs fees from Yalidine API then returns

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get('store_id');
  if (!storeId) return NextResponse.json({ error: 'store_id requis' }, { status: 400 });

  const partner = await db.deliveryPartner.findFirst({
    where: { storeId, code: 'yalidine' },
    include: { pricingGrid: true },
  });
  if (!partner) return NextResponse.json({ error: 'Yalidine non configuré' }, { status: 404 });

  return NextResponse.json({ data: partner.pricingGrid });
}

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('store_id');
    if (!storeId) return NextResponse.json({ error: 'store_id requis' }, { status: 400 });

    const partner = await db.deliveryPartner.findFirst({
      where: { storeId, code: 'yalidine', isActive: true },
    });
    if (!partner) return NextResponse.json({ error: 'Yalidine non configuré' }, { status: 404 });

    const cfg = partner.apiConfig as Record<string, string>;
    const apiId = cfg.api_id;
    const apiToken = cfg.api_token;
    if (!apiId || !apiToken) {
      return NextResponse.json({ error: 'Identifiants Yalidine manquants' }, { status: 400 });
    }

    // Fetch wilaya list from Yalidine (includes home_price, desk_price per wilaya)
    const res = await fetch(`${YALIDINE_BASE}/wilayas/`, {
      headers: { 'X-API-ID': apiId, 'X-API-TOKEN': apiToken },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Yalidine API: ${res.status}` }, { status: 502 });
    }

    const body = await res.json();
    const wilayas: any[] = body?.data ?? body ?? [];

    // Upsert fee grid for each wilaya
    let synced = 0;
    for (const w of wilayas) {
      const wilayaId = Number(w.id ?? w.wilaya_id);
      const homeFee = Number(w.home_price ?? w.prix_domicile ?? 0);
      const officeFee = Number(w.desk_price ?? w.prix_bureau ?? 0);
      if (!wilayaId) continue;

      await db.deliveryFeeGrid.upsert({
        where: { partnerId_wilayaId: { partnerId: partner.id, wilayaId } },
        update: { homeFee, officeFee },
        create: { partnerId: partner.id, wilayaId, homeFee, officeFee },
      });
      synced++;
    }

    return NextResponse.json({ success: true, synced, message: `${synced} wilayas synchronisées` });
  } catch (err: any) {
    console.error('[POST /api/yalidine/wilayas]', err);
    return NextResponse.json({ error: err.message ?? 'Erreur serveur' }, { status: 500 });
  }
}
