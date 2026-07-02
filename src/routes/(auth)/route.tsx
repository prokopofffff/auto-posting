import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

// Pathless layout for the auth group (ported from src/app/(auth)/layout.tsx).
// The "(auth)" folder is a route group: it wraps its children in this layout
// without adding a URL segment, so /sign-in and /sign-up render inside it.
export const Route = createFileRoute("/(auth)")({
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <div className="auth-shell">
      <header className="auth-topbar">
        <Link to="/">
          <div className="brand-mark">AM</div>
          <span className="brand-name">Account Manager</span>
        </Link>
      </header>
      <main className="auth-main">
        <Outlet />
      </main>
    </div>
  );
}
