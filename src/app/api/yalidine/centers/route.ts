import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const YALIDINE_BASE = 'https://api.yalidine.app/v1';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('store_id');
    if (!storeId) {
      return NextResponse.json({ error: 'store_id requis' }, { status: 400 });
    }

    const partner = await db.deliveryPartner.findFirst({
      where: { storeId, code: 'yalidine', isActive: true },
    });
    if (!partner) {
      return NextResponse.json({ error: 'Yalidine non configuré ou inactif' }, { status: 404 });
    }

    const cfg = partner.apiConfig as Record<string, string>;
    const apiId = cfg.api_id;
    const apiToken = cfg.api_token;
    if (!apiId || !apiToken) {
      return NextResponse.json({ error: 'Identifiants Yalidine manquants' }, { status: 400 });
    }

    const res = await fetch(`${YALIDINE_BASE}/centers/`, {
      headers: {
        'X-API-ID': apiId,
        'X-API-TOKEN': apiToken,
      },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Yalidine API: HTTP ${res.status}` }, { status: 502 });
    }

    const body = await res.json();
    const centers = body?.data ?? body ?? [];

    return NextResponse.json({ data: centers });
  } catch (err: any) {
    console.error('[GET /api/yalidine/centers]', err);
    return NextResponse.json({ error: err.message ?? 'Erreur serveur' }, { status: 500 });
  }
}
