import { NextResponse } from 'next/server';
import { getBackendUrl } from '@/lib/utils';

const BACKEND_URL = getBackendUrl();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ tracking: string }> }
) {
  try {
    const { tracking } = await params;
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('store_id');
    const url = `${BACKEND_URL}/api/yalidine/track/${tracking}${storeId ? `?store_id=${storeId}` : ''}`;
    const res = await fetch(url, {
      headers: { 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
