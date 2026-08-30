import React from 'react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

function mask(str: string | undefined, head = 4, tail = 4): string {
  if (!str) return 'Non définie (Manquante)';
  if (str.length <= head + tail) return '***';
  return `${str.slice(0, head)}...${str.slice(-tail)} (${str.length} caractères)`;
}

export default async function EnvPage() {
  const backendUrl = process.env.BACKEND_URL;
  const databaseUrl = process.env.DATABASE_URL;
  const directUrl = process.env.DIRECT_URL;
  const internalApiKey = process.env.INTERNAL_API_KEY;
  const nextPublicApiUrl = process.env.NEXT_PUBLIC_API_URL;
  const upstashRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const upstashRedisUrl = process.env.UPSTASH_REDIS_REST_URL;

  const coreVars = [
    {
      name: 'BACKEND_URL',
      value: backendUrl,
      masked: mask(backendUrl, 12, 6),
      isSet: !!backendUrl,
      len: backendUrl?.length || 0,
      role: 'Communication Serveur -> Backend FastAPI',
      type: 'Production & Preview',
    },
    {
      name: 'DATABASE_URL',
      value: databaseUrl,
      masked: mask(databaseUrl, 14, 6),
      isSet: !!databaseUrl,
      len: databaseUrl?.length || 0,
      role: 'Connexion PostgreSQL Pooled (Prisma / API)',
      type: 'Production & Preview (Secret)',
    },
    {
      name: 'DIRECT_URL',
      value: directUrl,
      masked: mask(directUrl, 14, 6),
      isSet: !!directUrl,
      len: directUrl?.length || 0,
      role: 'Connexion PostgreSQL Directe (Migrations DDL)',
      type: 'Production & Preview (Secret)',
    },
    {
      name: 'INTERNAL_API_KEY',
      value: internalApiKey,
      masked: mask(internalApiKey, 4, 4),
      isSet: !!internalApiKey,
      len: internalApiKey?.length || 0,
      role: 'Clé secrète de communication Next.js <-> FastAPI',
      type: 'Production & Preview (Secret)',
    },
    {
      name: 'NEXT_PUBLIC_API_URL',
      value: nextPublicApiUrl,
      masked: mask(nextPublicApiUrl, 12, 6),
      isSet: !!nextPublicApiUrl,
      len: nextPublicApiUrl?.length || 0,
      role: 'URL Publique du Backend FastAPI (Navigateur client)',
      type: 'Production & Preview',
    },
    {
      name: 'UPSTASH_REDIS_REST_TOKEN',
      value: upstashRedisToken,
      masked: mask(upstashRedisToken, 4, 4),
      isSet: !!upstashRedisToken,
      len: upstashRedisToken?.length || 0,
      role: 'Jeton REST Upstash Redis (Cache haute performance)',
      type: 'Production & Preview (Secret)',
    },
    {
      name: 'UPSTASH_REDIS_REST_URL',
      value: upstashRedisUrl,
      masked: mask(upstashRedisUrl, 10, 6),
      isSet: !!upstashRedisUrl,
      len: upstashRedisUrl?.length || 0,
      role: 'Point de terminaison REST Upstash Redis',
      type: 'Production & Preview',
    },
  ];

  const totalDetected = coreVars.filter((v) => v.isSet).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Header card */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  VERCEL LIVE DIAGNOSTIC
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {process.env.NODE_ENV}
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white mt-2">
                Variables d&apos;Environnement Vercel
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Détection en temps réel des 7 variables clés pour AzzougStore
              </p>
            </div>

            <div className="text-right flex sm:flex-col items-center sm:items-end justify-between border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-800">
              <span className="text-3xl font-black font-mono text-emerald-400">
                {totalDetected} / 7
              </span>
              <span className="text-xs font-medium text-slate-400">
                Variables Configurée{totalDetected > 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* Quick links */}
          <div className="flex items-center gap-3 mt-6 pt-6 border-t border-slate-800/80 flex-wrap">
            <Link
              href="/api/env"
              target="_blank"
              className="text-xs font-mono font-bold px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors inline-flex items-center gap-1.5"
            >
              Voir le JSON brut (/api/env)
            </Link>
            <Link
              href="/admin"
              className="text-xs font-mono font-bold px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-colors inline-flex items-center gap-1.5"
            >
              Ouvrir le Tableau de bord Admin
            </Link>
          </div>
        </div>

        {/* Variables List */}
        <div className="space-y-3">
          {coreVars.map((v) => (
            <div
              key={v.name}
              className={`p-5 rounded-2xl border transition-all ${
                v.isSet
                  ? 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                  : 'bg-rose-950/20 border-rose-900/50'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div
                    className={`size-3 rounded-full shrink-0 ${
                      v.isSet ? 'bg-emerald-500 ring-4 ring-emerald-500/20' : 'bg-rose-500 ring-4 ring-rose-500/20'
                    }`}
                  />
                  <div>
                    <span className="font-mono text-sm sm:text-base font-bold text-white tracking-wide">
                      {v.name}
                    </span>
                    <p className="text-xs text-slate-400 mt-0.5">{v.role}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto pl-6 sm:pl-0">
                  <span
                    className={`text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded-lg border ${
                      v.isSet
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                    }`}
                  >
                    {v.isSet ? 'DÉTECTÉ & ACTIF' : 'NON DÉFINI'}
                  </span>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-800/60 pl-6 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs font-mono">
                <span className="text-slate-300 select-all truncate max-w-xl">
                  {v.masked}
                </span>
                <span className="text-slate-500 text-[11px]">
                  {v.type}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* System Meta */}
        <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-5 text-xs font-mono text-slate-400 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span>Vercel URL: {process.env.VERCEL_URL || 'Non défini'}</span>
          <span>Date probe: {new Date().toISOString()}</span>
        </div>

      </div>
    </div>
  );
}
