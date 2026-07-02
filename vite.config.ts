import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// TanStack Start (Vite) — replaces next.config.ts.
//
// Plugin order matters: tailwind and the Start plugin run first; @vitejs/plugin-react
// LAST so it transforms the JSX that the Start plugin's route/server-fn codegen emits.
// The Start plugin discovers `src/router.tsx` (must export `getRouter`), the file
// routes under `src/routes`, and writes `src/routeTree.gen.ts`.
export default defineConfig({
  resolve: {
    alias: {
      // Mirror the tsconfig "@/*" -> "./src/*" path so runtime + typecheck agree.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    react(),
  ],
});
