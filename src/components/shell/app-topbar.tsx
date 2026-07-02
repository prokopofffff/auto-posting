import { useLocation } from "@tanstack/react-router";
import { ChevronRight, Search } from "lucide-react";
import { dispatchOpenCmdK } from "@/components/shell/command-palette";

export function AppTopbar({
  projectName,
  projectStatus,
  pendingDraftsCount,
  nextRunRel,
}: {
  projectName: string;
  projectStatus: "ACTIVE" | "PAUSED";
  pendingDraftsCount: number;
  nextRunRel: string | null;
}) {
  const pathname = useLocation().pathname;
  const segment = "/" + (pathname.split("/")[1] ?? "");

  const labelBySegment: Record<string, string> = {
    "/dashboard": "dashboard",
    "/compose":   "compose",
    "/topics":    "topics",
    "/drafts":    "drafts",
    "/analytics": "analytics",
    "/settings":  "settings",
  };
  const label = labelBySegment[segment] ?? pathname.replace(/^\//, "");

  let runState: string | null = null;
  if (segment === "/dashboard") {
    if (projectStatus === "ACTIVE") {
      runState = nextRunRel ? `agent · live · next ${nextRunRel}` : "agent · live";
    } else {
      runState = "agent · paused";
    }
  } else if (segment === "/drafts" && pendingDraftsCount > 0) {
    runState = `${pendingDraftsCount} pending review`;
  }

  const crumb = [projectName, label];

  return (
    <div className="topbar">
      <div className="crumb">
        {crumb.map((c, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {i > 0 && (
              <span className="sep">
                <ChevronRight size={12} />
              </span>
            )}
            <span className={i === crumb.length - 1 ? "cur" : undefined}>{c}</span>
          </span>
        ))}
      </div>

      <div className="spacer" />

      {runState ? (
        <div
          className="run-state"
          style={projectStatus === "PAUSED" ? { color: "var(--warn)" } : undefined}
        >
          <span
            className="pulse"
            style={
              projectStatus === "PAUSED"
                ? { background: "var(--warn)", animation: "none", boxShadow: "none" }
                : undefined
            }
          />
          <span>{runState}</span>
        </div>
      ) : null}

      <button
        type="button"
        className="cmd-trigger"
        aria-label="Open command palette"
        onClick={() => dispatchOpenCmdK()}
      >
        <Search size={12} />
        <span>Search or jump to…</span>
        <span className="kbd">⌘K</span>
      </button>
    </div>
  );
}
