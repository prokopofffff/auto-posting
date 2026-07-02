import { useTransition } from "react";
import { Link, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  BarChart3,
  Command,
  FileText,
  Home,
  LogOut,
  Pencil,
  Plus,
  Settings,
  Sheet,
} from "lucide-react";
import { switchProjectAction } from "@/server/project-actions";
import { signOutAction } from "@/server/oauth-actions";
import { dispatchOpenCmdK } from "@/components/shell/command-palette";

type NavItem = {
  href: "/dashboard" | "/compose" | "/topics" | "/drafts" | "/analytics" | "/settings";
  id: "dashboard" | "compose" | "topics" | "drafts" | "analytics" | "settings";
  label: string;
  kbd: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
};

const NAV: NavItem[] = [
  { id: "dashboard", href: "/dashboard", label: "Dashboard", kbd: "g d", icon: Home },
  { id: "compose",   href: "/compose",   label: "Compose",   kbd: "g c", icon: Pencil },
  { id: "topics",    href: "/topics",    label: "Topics",    kbd: "g t", icon: Sheet },
  { id: "drafts",    href: "/drafts",    label: "Drafts",    kbd: "g f", icon: FileText },
  { id: "analytics", href: "/analytics", label: "Analytics", kbd: "g a", icon: BarChart3 },
  { id: "settings",  href: "/settings",  label: "Settings",  kbd: "g s", icon: Settings },
];

export type SidebarProject = {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED";
};

export type SidebarBadges = Partial<Record<NavItem["id"], number>>;

export function AppSidebar({
  projects,
  currentProjectId,
  userEmail,
  userInitials,
  badges = {},
}: {
  projects: SidebarProject[];
  currentProjectId: string;
  userEmail: string;
  userInitials: string;
  badges?: SidebarBadges;
}) {
  const pathname = useLocation({ select: (l) => l.pathname });
  const router = useRouter();
  const navigate = useNavigate();
  const [pending, startTransition] = useTransition();

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  function switchTo(id: string) {
    if (id === currentProjectId || pending) return;
    startTransition(async () => {
      const res = await switchProjectAction({ data: id });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      await router.invalidate();
    });
  }

  function signOut() {
    if (pending) return;
    startTransition(async () => {
      await signOutAction();
      await navigate({ to: "/" });
    });
  }

  return (
    <aside className="sidebar scroll-area">
      <div className="sidebar-head">
        <div className="brand-mark">a</div>
        <div className="brand-name">autopost</div>
        <div className="brand-ver">v0.4</div>
      </div>

      <div className="sb-section">
        <div className="sb-section-label">workspace</div>
        {NAV.map((it) => {
          const Icon = it.icon;
          const count = badges[it.id];
          return (
            <Link
              key={it.id}
              to={it.href}
              className={"sb-item" + (isActive(it.href) ? " active" : "")}
            >
              <Icon className="ico" size={14} />
              <span>{it.label}</span>
              {count && count > 0 ? (
                <span className="badge">{count}</span>
              ) : (
                <span className="kbd">{it.kbd}</span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="sb-section">
        <div className="sb-section-label">
          <span>projects</span>
          <button type="button" title="New project" aria-label="New project">
            <Plus size={12} />
          </button>
        </div>
        <div className="sb-tree">
          {projects.map((p) => (
            <div
              key={p.id}
              className={"sb-project" + (p.id === currentProjectId ? " active" : "")}
              onClick={() => switchTo(p.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  switchTo(p.id);
                }
              }}
            >
              <span className="dot" />
              <span>{p.name}</span>
              <span className="status">
                {p.status === "ACTIVE" ? "live" : "paused"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="sb-section">
        <div className="sb-section-label">resources</div>
        <div
          className="sb-item"
          role="button"
          tabIndex={0}
          onClick={() => dispatchOpenCmdK()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              dispatchOpenCmdK();
            }
          }}
        >
          <Command className="ico" size={13} />
          <span>Command</span>
          <span className="kbd">⌘K</span>
        </div>
      </div>

      <div className="sb-bottom">
        <div className="sb-user">
          <div className="avatar">{userInitials}</div>
          <div className="email">{userEmail}</div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              signOut();
            }}
            style={{ marginLeft: "auto", lineHeight: 0 }}
          >
            <button
              type="submit"
              title="Sign out"
              aria-label="Sign out"
              style={{
                background: "none",
                border: "none",
                color: "var(--fg-4)",
                padding: 2,
                borderRadius: "var(--r-1)",
                cursor: "pointer",
              }}
            >
              <LogOut size={13} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
