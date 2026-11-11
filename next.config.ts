import type { NextConfig } from "next";

// Kennung dieser Version (bei Vercel der Git-Commit) – die App erkennt damit Updates und lädt sich neu.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || process.env.BUILD_ID || String(Date.now());

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  async redirects() {
    return [{ source: "/backtest", destination: "/echochart", permanent: true }];
  },
};

export default nextConfig;
