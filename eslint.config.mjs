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
]);

export default eslintConfig;
