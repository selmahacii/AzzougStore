/**
 * ═══════════════════════════════════════════════════════════════
 * /api/env — Vercel Environment Variables Detector & Health Probe
 * ─────────────────────────────────────────────────────────────
 * Detects, validates and logs all 7 core Vercel environment variables:
 * - BACKEND_URL
 * - DATABASE_URL
 * - DIRECT_URL
 * - INTERNAL_API_KEY
 * - NEXT_PUBLIC_API_URL
 * - UPSTASH_REDIS_REST_TOKEN
 * - UPSTASH_REDIS_REST_URL
 * ═══════════════════════════════════════════════════════════════
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const backendUrl = process.env.BACKEND_URL || 'https://azconfort.azghub.com';
  const publicApiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://azconfort.azghub.com';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://azzougshop.vercel.app';
  const databaseUrl = process.env.DATABASE_URL || null;
  const directUrl = process.env.DIRECT_URL || null;
  const internalKey = process.env.INTERNAL_API_KEY || null;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || null;
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || null;
  const secretKey = process.env.SECRET_KEY || process.env.JWT_SECRET || null;

  // Safe masking for secrets
  const maskSecret = (val: string | null, head = 4, tail = 4) => {
    if (!val) return 'non_définie';
    if (val.length <= head + tail) return '***';
    return `${val.substring(0, head)}...${val.substring(val.length - tail)} (taille: ${val.length})`;
  };

  const detectedVars = [
    {
      key: 'BACKEND_URL',
      value: process.env.BACKEND_URL ? maskSecret(process.env.BACKEND_URL, 12, 6) : 'fallback: https://azconfort.azghub.com',
      isSet: !!process.env.BACKEND_URL,
      length: process.env.BACKEND_URL?.length || 0,
      status: !!process.env.BACKEND_URL ? 'CONFIGURÉ' : 'MANQUANT_AVEC_FALLBACK',
      description: 'URL principale du backend FastAPI en production'
    },
    {
      key: 'DATABASE_URL',
      value: databaseUrl ? maskSecret(databaseUrl, 12, 6) : 'non_définie',
      isSet: !!databaseUrl,
      length: databaseUrl?.length || 0,
      status: !!databaseUrl ? 'CONFIGURÉ' : 'NON_DÉTECTÉ',
      description: 'Chaîne de connexion PostgreSQL (Prisma / Pooled DB)'
    },
    {
      key: 'DIRECT_URL',
      value: directUrl ? maskSecret(directUrl, 12, 6) : 'non_définie',
      isSet: !!directUrl,
      length: directUrl?.length || 0,
      status: !!directUrl ? 'CONFIGURÉ' : 'NON_DÉTECTÉ',
      description: 'Connexion directe PostgreSQL (Migrations Prisma & DDL)'
    },
    {
      key: 'INTERNAL_API_KEY',
      value: internalKey ? maskSecret(internalKey, 4, 4) : 'non_définie',
      isSet: !!internalKey,
      length: internalKey?.length || 0,
      status: !!internalKey ? 'CONFIGURÉ' : 'NON_DÉTECTÉ',
      description: 'Clé secrète de communication sécurisée entre Next.js et FastAPI'
    },
    {
      key: 'NEXT_PUBLIC_API_URL',
      value: process.env.NEXT_PUBLIC_API_URL ? maskSecret(process.env.NEXT_PUBLIC_API_URL, 12, 6) : 'fallback: https://azconfort.azghub.com',
      isSet: !!process.env.NEXT_PUBLIC_API_URL,
      length: process.env.NEXT_PUBLIC_API_URL?.length || 0,
      status: !!process.env.NEXT_PUBLIC_API_URL ? 'CONFIGURÉ' : 'MANQUANT_AVEC_FALLBACK',
      description: 'URL publique du backend FastAPI (côté navigateur)'
    },
    {
      key: 'UPSTASH_REDIS_REST_TOKEN',
      value: upstashToken ? maskSecret(upstashToken, 4, 4) : 'non_définie',
      isSet: !!upstashToken,
      length: upstashToken?.length || 0,
      status: !!upstashToken ? 'CONFIGURÉ' : 'NON_DÉTECTÉ',
      description: 'Jeton REST Upstash Redis pour le cache haute vitesse'
    },
    {
      key: 'UPSTASH_REDIS_REST_URL',
      value: upstashUrl ? maskSecret(upstashUrl, 10, 6) : 'non_définie',
      isSet: !!upstashUrl,
      length: upstashUrl?.length || 0,
      status: !!upstashUrl ? 'CONFIGURÉ' : 'NON_DÉTECTÉ',
      description: 'URL de point de terminaison REST Upstash Redis'
    },
    {
      key: 'NEXT_PUBLIC_APP_URL',
      value: appUrl,
      isSet: !!process.env.NEXT_PUBLIC_APP_URL || !!process.env.APP_URL,
      length: appUrl.length,
      status: (!!process.env.NEXT_PUBLIC_APP_URL || !!process.env.APP_URL) ? 'CONFIGURÉ' : 'PAR_DÉFAUT',
      description: 'URL canonique de votre application Vercel Frontend'
    },
    {
      key: 'SECRET_KEY',
      value: secretKey ? maskSecret(secretKey, 4, 4) : 'non_définie',
      isSet: !!secretKey,
      length: secretKey?.length || 0,
      status: !!secretKey ? 'CONFIGURÉ' : 'NON_DÉTECTÉ',
      description: 'Clé secrète JWT pour la vérification des sessions'
    }
  ];

  // Output structured logs in Vercel Function logs
  console.log(`[API /api/env] Diagnostic Vercel Env:`, {
    timestamp: new Date().toISOString(),
    node_env: process.env.NODE_ENV,
    vercel_env: process.env.VERCEL_ENV,
    vercel_url: process.env.VERCEL_URL,
    total_detected: detectedVars.filter(v => v.isSet).length,
    variables_status: detectedVars.map(v => `${v.key}: ${v.status} (len: ${v.length})`)
  });

  return NextResponse.json(
    {
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'production',
      vercel: {
        env: process.env.VERCEL_ENV || 'custom',
        url: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
        region: process.env.VERCEL_REGION || null,
        commit_sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      },
      summary: {
        total_requested: 7,
        total_detected: detectedVars.filter(v => v.isSet).length,
        core_7_detected: detectedVars.slice(0, 7).filter(v => v.isSet).length,
        missing_vars: detectedVars.slice(0, 7).filter(v => !v.isSet).map(v => v.key),
      },
      variables: detectedVars,
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0'
      }
    }
  );
}
