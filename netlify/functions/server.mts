// Netlify Function wrapper around the TanStack Start SSR entry.
//
// `pnpm build` (run as the Netlify build command) emits dist/server/server.js,
// a web-standard `{ fetch }` handler. Netlify Functions v2 receive a web
// `Request` and return a web `Response`, so the wrapper is a thin pass-through.
//
// Routing: the catch-all redirect in netlify.toml sends every request that is
// NOT a static file in the publish dir (dist/client) here. Static assets under
// /assets/* and public files are served by Netlify's CDN first.
//
// This build artifact only exists after the build step, so it is imported
// dynamically to keep the function module load-safe if bundled early.
export default async function handler(request: Request): Promise<Response> {
  const { default: ssr } = await import("../../dist/server/server.js");
  return ssr.fetch(request);
}
