import type { NextConfig } from "next";

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
