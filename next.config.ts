import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deployed on Netlify via its Next.js runtime, which builds the app into
  // Netlify Functions/Edge Functions — no self-contained `output: "standalone"`
  // bundle is needed (that was for the now-removed Docker deploy).
};

export default nextConfig;
