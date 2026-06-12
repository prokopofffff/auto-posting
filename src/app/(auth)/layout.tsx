import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth-shell">
      <header className="auth-topbar">
        <Link href="/">
          <div className="brand-mark">AM</div>
          <span className="brand-name">Account Manager</span>
        </Link>
      </header>
      <main className="auth-main">{children}</main>
    </div>
  );
}
