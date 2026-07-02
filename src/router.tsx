import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// TanStack Start discovers this file (default: src/router.tsx) and calls
// `getRouter()` to build the router for both SSR and client hydration. The name
// `getRouter` is REQUIRED — the generated routeTree.gen.ts registers the router
// type via `Awaited<ReturnType<typeof getRouter>>`.
export function getRouter() {
  const router = createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
