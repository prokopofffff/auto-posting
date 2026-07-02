import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { getCurrentUser, getCurrentProject } from "@/server/project";

// Resolves the signed-in user's current project (with its settings + connected
// accounts) for a route loader. This is a server fn so the server-only imports
// it pulls in (`@/server/project` → the request cookie/session helpers and the
// service-role client) never reach the client bundle: route loaders call it via
// the RPC bridge instead of importing `@/server/project` directly.
//
// method: "POST" because it reads the session cookie. The global auth guard
// (src/start.ts) already redirects signed-out users; the null-check here is a
// defensive backstop that also narrows the type for callers, matching the old
// per-page `if (!user) redirect(...)`.
export const requireCurrentProject = createServerFn({ method: "POST" }).handler(
  async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/sign-in" });
    return getCurrentProject(user.id);
  },
);
