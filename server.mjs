// Production Node server for the built TanStack Start app (zero dependencies).
//
// Serves the static client assets from dist/client and delegates everything
// else — pages, /api/* routes, and server-function calls — to the SSR handler
// in dist/server/server.js (a web-standard `{ fetch }` entry). This mirrors how
// Netlify serves the build (publish dir first, then the SSR function) so local
// `pnpm start` and the Netlify deploy behave the same.
//
// Doubles as the container entrypoint for the planned k3s deploy: build the
// image, `node server.mjs`, set PORT + the env vars from .env.example.
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { stat, readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_DIR = fileURLToPath(new URL("./dist/client", import.meta.url));
const SERVER_ENTRY = new URL("./dist/server/server.js", import.meta.url).href;

// The SSR fetch handler: `export default { fetch }`. Imported once at boot.
const { default: ssr } = await import(SERVER_ENTRY);

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const MIME = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

// Convert a Node IncomingMessage into a web Request for the fetch handler.
function toRequest(req) {
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else if (v != null) headers.set(k, v);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    // Required by Node/undici when streaming a request body.
    duplex: hasBody ? "half" : undefined,
  });
}

// Look up a real file under dist/client, guarding against path traversal.
async function findStatic(pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(CLIENT_DIR, rel);
  if (filePath !== CLIENT_DIR && !filePath.startsWith(CLIENT_DIR)) return null;
  try {
    const s = await stat(filePath);
    if (!s.isFile()) return null;
    return filePath;
  } catch {
    return null;
  }
}

// Write a web Response back onto the Node ServerResponse, preserving multiple
// Set-Cookie headers (Supabase session refresh relies on these).
function sendResponse(res, response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") headers[key] = value;
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (setCookie.length) headers["set-cookie"] = setCookie;

  res.writeHead(response.status, headers);
  if (response.body) {
    Readable.fromWeb(response.body).pipe(res);
  } else {
    res.end();
  }
}

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

    // Static assets first (only for safe GET/HEAD, never the "/" document).
    if ((req.method === "GET" || req.method === "HEAD") && pathname !== "/") {
      const filePath = await findStatic(pathname);
      if (filePath) {
        const ext = extname(filePath).toLowerCase();
        const immutable = pathname.startsWith("/assets/");
        res.writeHead(200, {
          "content-type": MIME[ext] ?? "application/octet-stream",
          "cache-control": immutable
            ? "public, max-age=31536000, immutable"
            : "public, max-age=3600",
        });
        if (req.method === "HEAD") res.end();
        else res.end(await readFile(filePath));
        return;
      }
    }

    sendResponse(res, await ssr.fetch(toRequest(req)));
  } catch (err) {
    console.error("[server] request failed:", err);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("Internal Server Error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`▶ SSR server listening on http://${HOST}:${PORT}`);
});
