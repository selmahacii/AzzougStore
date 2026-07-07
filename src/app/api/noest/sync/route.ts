import { NextResponse } from 'next/server';
import { getBackendUrl } from '@/lib/utils';

const BACKEND_URL = getBackendUrl();

// GET /api/noest/sync?orderId=xxx — proxy to FastAPI noest tracking
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get('orderId');
  if (!orderId) return NextResponse.json({ success: false, message: 'orderId requis' }, { status: 400 });

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/delivery-partners/tracking?order_id=${orderId}`, {
      headers: { 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// POST /api/noest/sync { orderId } — proxy to FastAPI noest sync
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const orderId = body.orderId;
    if (!orderId) return NextResponse.json({ success: false, message: 'orderId requis' }, { status: 400 });

    const res = await fetch(`${BACKEND_URL}/api/noest/track/${orderId}`, {
      method: 'GET',
      headers: { 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
