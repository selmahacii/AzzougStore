import { NextRequest, NextResponse } from 'next/server';

// ─── Meta Conversions API relay ────────────────────────────────────────────
// The FastAPI backend on HuggingFace cannot open a TLS connection to
// graph.facebook.com (Meta's IP ranges are blocked at the network layer on
// that host). Vercel's network reaches Meta fine, so the backend forwards its
// CAPI events here and this route relays them to Meta: HF → Vercel → Meta.
//
// Auth: the backend sends the shared INTERNAL_API_KEY in the x-internal-key
// header. Without a matching key the request is rejected — this endpoint must
// never be an open proxy for arbitrary Pixel writes.
//
// This is a specific route, so it takes precedence over the /api/[...path]
// catch-all proxy (static segments win over dynamic in the App Router).

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_GRAPH_VERSION = 'v21.0';

export async function POST(request: NextRequest) {
  const provided = request.headers.get('x-internal-key') || '';
  const expected = process.env.INTERNAL_API_KEY || '';
  if (!expected || provided !== expected) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized relay call' },
      { status: 401 },
    );
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const pixelId = payload?.pixel_id;
  const accessToken = payload?.access_token;
  const graphVersion = payload?.graph_version || DEFAULT_GRAPH_VERSION;
  const data = payload?.data;

  if (!pixelId || !accessToken || !Array.isArray(data)) {
    return NextResponse.json(
      { success: false, error: 'Missing pixel_id, access_token or data[]' },
      { status: 400 },
    );
  }

  const metaBody: Record<string, any> = { data, access_token: accessToken };
  if (payload?.test_event_code) metaBody.test_event_code = payload.test_event_code;

  const url = `https://graph.facebook.com/${graphVersion}/${pixelId}/events`;

  try {
    const metaRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaBody),
    });
    // Pass Meta's response through verbatim (status + JSON) so the backend can
    // parse events_received / error / fbtrace_id exactly as if it called Meta.
    const text = await metaRes.text();
    return new NextResponse(text, {
      status: metaRes.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    // Network error reaching Meta from Vercel — report as a 502 so the backend
    // treats it as retryable and re-queues the event.
    return NextResponse.json(
      { error: { message: `Relay could not reach Meta: ${error?.message || String(error)}` } },
      { status: 502 },
    );
  }
}
