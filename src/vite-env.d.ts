/// <reference types="vite/client" />

// Typed client-side env vars. Only VITE_-prefixed vars are exposed to the
// browser bundle (server-only secrets stay on process.env).
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
