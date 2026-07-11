/**
 * ═══════════════════════════════════════════════════════════════
 * /api/build-info — Which deployment is currently live?
 * ─────────────────────────────────────────────────────────────
 * Exposes VERCEL_GIT_COMMIT_SHA (stable per deployment, injected
 * automatically by Vercel — no config needed). Polled client-side by
 * BuildVersionWatcher to detect "this browser tab is running an old
 * deployment" and prompt a refresh — the recurring root cause behind
 * staff seeing stale data (orders/stores) after we ship a fix but their
 * tab, left open for hours, never re-fetched the new JS bundle.
 * ═══════════════════════════════════════════════════════════════
 */
import { NextResponse } from 'next/server';

// Fallback for local dev (not deployed via git) — stable for the life of
// this server process, so it won't cause false-positive refresh prompts.
const FALLBACK_BUILD_ID = String(Date.now());

export async function GET() {
  const buildId = process.env.VERCEL_GIT_COMMIT_SHA || FALLBACK_BUILD_ID;
  return NextResponse.json({ buildId }, { headers: { 'Cache-Control': 'no-store' } });
}
