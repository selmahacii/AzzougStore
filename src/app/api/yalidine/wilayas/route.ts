import { NextResponse } from 'next/server';
import { getBackendUrl } from '@/lib/utils';

const BACKEND_URL = getBackendUrl();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get('store_id');
  if (!storeId) return NextResponse.json({ error: 'store_id requis' }, { status: 400 });
  try {
    const res = await fetch(`${BACKEND_URL}/api/yalidine/wilayas?store_id=${storeId}`, {
      headers: { 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get('store_id');
  if (!storeId) return NextResponse.json({ error: 'store_id requis' }, { status: 400 });
  try {
    const res = await fetch(`${BACKEND_URL}/api/yalidine/wilayas?store_id=${storeId}`, {
      method: 'POST',
      headers: { 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
