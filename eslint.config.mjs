import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";

// eslint-config-next was removed with Next.js. This is a minimal flat config on
// top of @eslint/js recommended. Expand (e.g. typescript-eslint, react hooks)
// in a later phase if desired.
const eslintConfig = defineConfig([
  globalIgnores([
    "dist/**",
    ".output/**",
    ".nitro/**",
    ".tanstack/**",
    "src/routeTree.gen.ts",
    "src/app/**",
  ]),
  js.configs.recommended,
  // Plain-Node entry points and one-off scripts. Without this every use of a
  // Node/web global here reads as `no-undef`, which is what made `pnpm lint`
  // fail on server.mjs and scripts/ long before anyone looked at the output.
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: Object.fromEntries(
        [
          "AbortSignal",
          "Buffer",
          "Headers",
          "ReadableStream",
          "Request",
          "Response",
          "TextDecoder",
          "TextEncoder",
          "URL",
          "URLSearchParams",
          "clearInterval",
          "clearTimeout",
          "console",
          "crypto",
          "fetch",
          "process",
          "setInterval",
          "setTimeout",
        ].map((name) => [name, "readonly"]),
      ),
    },
  },
]);

export default eslintConfig;
