import type { NextConfig } from "next";

// ═══════════════════════════════════════════════════════════════════════
// Vercel Environment Variables Detector & Diagnostic Logger
// ═══════════════════════════════════════════════════════════════════════
const mask = (str: string | undefined, head = 4, tail = 4) => {
  if (!str) return '❌ MISSING (undefined)';
  if (str.length <= head + tail) return '✅ SET (***)';
  return `✅ SET (${str.slice(0, head)}...${str.slice(-tail)}) [len: ${str.length}]`;
};

console.log(`
═══════════════════════════════════════════════════════════════════════
[VERCEL ENV DETECTION] AzzougStore Build & Runtime Environment
───────────────────────────────────────────────────────────────────────
• BACKEND_URL:              ${mask(process.env.BACKEND_URL, 12, 6)}
• DATABASE_URL:             ${mask(process.env.DATABASE_URL, 12, 6)}
• DIRECT_URL:               ${mask(process.env.DIRECT_URL, 12, 6)}
• INTERNAL_API_KEY:         ${mask(process.env.INTERNAL_API_KEY, 4, 4)}
• NEXT_PUBLIC_API_URL:      ${mask(process.env.NEXT_PUBLIC_API_URL, 12, 6)}
• UPSTASH_REDIS_REST_TOKEN: ${mask(process.env.UPSTASH_REDIS_REST_TOKEN, 4, 4)}
• UPSTASH_REDIS_REST_URL:   ${mask(process.env.UPSTASH_REDIS_REST_URL, 10, 6)}
• NODE_ENV:                 ${process.env.NODE_ENV}
• VERCEL_ENV:               ${process.env.VERCEL_ENV || 'local/custom'}
• VERCEL_URL:               ${process.env.VERCEL_URL || 'undefined'}
═══════════════════════════════════════════════════════════════════════
`);

const nextConfig: NextConfig = {
  output: process.env.NODE_ENV === "production" ? "standalone" : undefined,
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,

  // Increase upload body size limit to 25MB for product images
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
