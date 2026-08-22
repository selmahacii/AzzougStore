/**
 * ═══════════════════════════════════════════════════════════════
 * /api/env — Migration & Environment Variables Detector
 * ─────────────────────────────────────────────────────────────
 * Detects and exports all environment variables required by the
 * AzzougShop Next.js frontend for Vercel deployment.
 * ═══════════════════════════════════════════════════════════════
 */
import { NextResponse } from 'next/server';

export async function GET() {
  const backendUrl = process.env.BACKEND_URL || 'https://azconfort.azghub.com';
  const publicApiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://azconfort.azghub.com';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://azzougshop.vercel.app';
  const internalKey = process.env.INTERNAL_API_KEY || null;
  const secretKey = process.env.SECRET_KEY || process.env.JWT_SECRET || null;
  const redisUrl = process.env.REDIS_URL || null;
  const noestToken = process.env.NOEST_API_TOKEN || null;

  // Mask secret keys for safe display while showing status
  const maskSecret = (val: string | null) => {
    if (!val) return null;
    if (val.length <= 8) return '********';
    return val.substring(0, 4) + '...' + val.substring(val.length - 4);
  };

  const requiredVars = [
    {
      key: 'BACKEND_URL',
      value: backendUrl,
      isSet: !!process.env.BACKEND_URL,
      required: true,
      description: 'URL principale du backend FastAPI en production'
    },
    {
      key: 'NEXT_PUBLIC_API_URL',
      value: publicApiUrl,
      isSet: !!process.env.NEXT_PUBLIC_API_URL,
      required: true,
      description: 'URL publique du backend FastAPI (accessible côté navigateur)'
    },
    {
      key: 'NEXT_PUBLIC_APP_URL',
      value: appUrl,
      isSet: !!process.env.NEXT_PUBLIC_APP_URL || !!process.env.APP_URL,
      required: true,
      description: 'URL canonique de votre application Vercel Frontend'
    },
    {
      key: 'INTERNAL_API_KEY',
      value: internalKey ? maskSecret(internalKey) : 'non_definie (utilise fallback dev)',
      raw_value: internalKey,
      isSet: !!process.env.INTERNAL_API_KEY,
      required: true,
      description: 'Clé secrète de communication sécurisée entre Next.js et FastAPI'
    },
    {
      key: 'SECRET_KEY',
      value: secretKey ? maskSecret(secretKey) : 'non_definie',
      raw_value: secretKey,
      isSet: !!process.env.SECRET_KEY || !!process.env.JWT_SECRET,
      required: false,
      description: 'Clé secrète JWT pour la vérification des sessions de la boutique'
    },
    {
      key: 'NOEST_API_TOKEN',
      value: noestToken ? maskSecret(noestToken) : 'utilise_valeur_par_defaut',
      isSet: !!process.env.NOEST_API_TOKEN,
      required: false,
      description: 'Jeton d\'accès optionnel pour l\'intégration directe Noest'
    }
  ];

  // Format as copy-pasteable .env text block for Vercel Import
  const envFileContent = [
    `# ═══════════════════════════════════════════════════════════════`,
    `# AZZOUGSHOP — VERCEL FRONTEND ENVIRONMENT VARIABLES`,
    `# Copiez-collez ces variables dans votre nouveau projet Vercel`,
    `# ═══════════════════════════════════════════════════════════════`,
    `BACKEND_URL="${backendUrl}"`,
    `NEXT_PUBLIC_API_URL="${publicApiUrl}"`,
    `NEXT_PUBLIC_APP_URL="${appUrl}"`,
    `INTERNAL_API_KEY="${internalKey || 'azzougshop_internal_secure_key_2026'}"`,
    `SECRET_KEY="${secretKey || ''}"`,
    `NODE_ENV="production"`
  ].join('\n');

  return NextResponse.json(
    {
      success: true,
      message: 'Détection des variables d\'environnement pour migration Vercel',
      environment: process.env.NODE_ENV || 'production',
      vercel_url: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
      summary: {
        total_detected: requiredVars.filter(v => v.isSet).length,
        total_recommended: requiredVars.length
      },
      variables: requiredVars,
      vercel_copy_paste: envFileContent
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0'
      }
    }
  );
}
