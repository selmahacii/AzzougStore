import { NextResponse } from 'next/server';

const NOEST_TOKEN = process.env.NOEST_API_TOKEN ?? 'gBMifKgtZwVEW4QYZqkxb6VZDjhzTnsDSfn';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tracking = searchParams.get('tracking');
  if (!tracking) return NextResponse.json({ success: false, message: 'tracking requis' }, { status: 400 });

  const url = `https://app.noest-dz.com/api/public/get/order/label?tracking=${tracking}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${NOEST_TOKEN}`, 'X-Requested-With': 'XMLHttpRequest' },
  });

  if (!res.ok) return NextResponse.json({ success: false, message: 'Erreur NOEST' }, { status: 502 });

  const pdf = await res.arrayBuffer();
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="bordereau-${tracking}.pdf"`,
    },
  });
}
