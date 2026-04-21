import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle for Docker deployments.
  // Vercel ignores this; Docker uses `node server.js` from `.next/standalone`.
  output: "standalone",
};

export default nextConfig;
