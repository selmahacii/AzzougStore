import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const YALIDINE_BASE = 'https://api.yalidine.app/v1';

// Maps Yalidine status strings → our internal status keys
const STATUS_MAP: Record<string, string> = {
  'Créé':                  'PENDING',
  'En attente':            'PENDING',
  'Collecté':              'PICKED_UP',
  'En transit':            'IN_TRANSIT',
  'En distribution':       'OUT_FOR_DELIVERY',
  'Livré':                 'DELIVERED',
  'Retourné':              'RETURNED',
  'Retour en cours':       'RETURNED',
  'Tentative de livraison': 'FAILED',
  'Refusé':               'RETURNED',
};

function normalizeStatus(raw: string): string {
  return STATUS_MAP[raw] ?? 'IN_TRANSIT';
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ tracking: string }> }
) {
  try {
    const { tracking } = await params;
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('store_id');

    if (!storeId) {
      return NextResponse.json({ error: 'store_id requis' }, { status: 400 });
    }

    const partner = await db.deliveryPartner.findFirst({
      where: { storeId, code: 'yalidine', isActive: true },
    });
    if (!partner) {
      return NextResponse.json({ error: 'Yalidine non configuré pour cette boutique' }, { status: 400 });
    }

    const cfg = partner.apiConfig as Record<string, string>;
    const apiId = cfg.api_id;
    const apiToken = cfg.api_token;
    if (!apiId || !apiToken) {
      return NextResponse.json({ error: 'Identifiants Yalidine manquants' }, { status: 400 });
    }

    const res = await fetch(`${YALIDINE_BASE}/histories/${tracking}/`, {
      headers: {
        'X-API-ID': apiId,
        'X-API-TOKEN': apiToken,
      },
      next: { revalidate: 0 },
    });

    if (res.status === 404) {
      return NextResponse.json({ error: 'Colis introuvable' }, { status: 404 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `Yalidine API: ${res.status}` }, { status: 502 });
    }

    const data = await res.json();

    // Yalidine returns { count, data: [...histories] }
    const histories: any[] = data?.data ?? [];

    const events = histories.map((h: any) => ({
      label: h.status,
      location: h.wilaya ?? h.center ?? '',
      date: h.date ? new Date(h.date).toLocaleDateString('fr-DZ') : '',
      time: h.date ? new Date(h.date).toLocaleTimeString('fr-DZ', { hour: '2-digit', minute: '2-digit' }) : '',
      raw_status: h.status,
    }));

    const latestStatus = histories[0]?.status ?? '';
    const latestLocation = histories[0]?.wilaya ?? histories[0]?.center ?? '';

    return NextResponse.json({
      tracking,
      status: normalizeStatus(latestStatus),
      last_event: latestStatus,
      last_location: latestLocation,
      events,
      carrier: 'yalidine',
      updated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[GET /api/yalidine/track]', err);
    return NextResponse.json({ error: err.message ?? 'Erreur serveur' }, { status: 500 });
  }
}
