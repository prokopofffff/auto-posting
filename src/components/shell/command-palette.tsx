"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BarChart3,
  FileText,
  Home,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Sheet,
  Upload,
  Zap,
} from "lucide-react";
import { runNowAction } from "@/server/draft-actions";
import { toggleProjectStatusAction } from "@/server/settings-actions";

type CmdItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
  kbd?: string;
  run: () => void | Promise<void>;
};

type CmdGroup = { label: string; items: CmdItem[] };

const OPEN_EVENT = "ap:open-cmdk";

export function dispatchOpenCmdK() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (t.isContentEditable) return true;
  return false;
}

export function CommandPalette({
  projectId,
  projectStatus,
}: {
  projectId: string;
  projectStatus: "ACTIVE" | "PAUSED";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const groups: CmdGroup[] = useMemo(() => {
    const go = (href: string) => () => {
      router.push(href);
      close();
    };

    const runNow = () => {
      startTransition(async () => {
        const res = await runNowAction(projectId);
        if (!res.ok) toast.error(res.error);
        else if ("skipped" in res && res.skipped) toast.info(res.reason ?? "Nothing to do.");
        else toast.success(res.published ? "Posted!" : "Draft created.");
        router.refresh();
      });
      close();
    };

    const toggleStatus = () => {
      startTransition(async () => {
        const res = await toggleProjectStatusAction(projectId);
        if (!res.ok) toast.error(res.error);
        else toast.success(res.status === "ACTIVE" ? "Agent started" : "Agent paused");
        router.refresh();
      });
      close();
    };

    return [
      {
        label: "navigation",
        items: [
          { id: "nav-dashboard", label: "Go to Dashboard", icon: <Home className="ico" size={14} />, kbd: "g d", run: go("/dashboard") },
          { id: "nav-compose",   label: "Go to Compose",   icon: <Pencil className="ico" size={14} />, kbd: "g c", run: go("/compose") },
          { id: "nav-topics",    label: "Go to Topics",    icon: <Sheet className="ico" size={14} />, kbd: "g t", run: go("/topics") },
          { id: "nav-drafts",    label: "Go to Drafts",    icon: <FileText className="ico" size={14} />, kbd: "g f", run: go("/drafts") },
          { id: "nav-analytics", label: "Go to Analytics", icon: <BarChart3 className="ico" size={14} />, kbd: "g a", run: go("/analytics") },
          { id: "nav-settings",  label: "Go to Settings",  icon: <SettingsIcon className="ico" size={14} />, kbd: "g s", run: go("/settings") },
        ],
      },
      {
        label: "actions",
        items: [
          { id: "act-write",  label: "Write a post manually",       icon: <Pencil className="ico" size={14} />, kbd: "⌘ N",   run: go("/compose") },
          { id: "act-gen",    label: "Generate post now",           icon: <Zap className="ico" size={14} />,    kbd: "⌘ ⇧ G", run: runNow },
          { id: "act-status", label:
              projectStatus === "ACTIVE" ? "Pause agent" : "Start agent",
            icon: projectStatus === "ACTIVE"
              ? <Pause className="ico" size={14} />
              : <Play className="ico" size={14} />,
            kbd: "⌘ .",
            run: toggleStatus,
          },
          { id: "act-new-topic", label: "Add a new topic",          icon: <Plus className="ico" size={14} />,   kbd: "n t", run: go("/topics") },
          { id: "act-import",    label: "Bulk import topics (CSV)", icon: <Upload className="ico" size={14} />, kbd: "i",   run: go("/topics?import=1") },
          { id: "act-refresh",   label: "Refresh current view",     icon: <RefreshCw className="ico" size={14} />, kbd: "r", run: () => { router.refresh(); close(); } },
        ],
      },
    ];
  }, [router, projectId, projectStatus, close]);

  // Open via ⌘K / Ctrl-K or window event
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  // Reset state and focus input on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setIdx(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Flat filtered list for arrow nav
  const flat = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items: Array<CmdItem & { group: string }> = [];
    for (const g of groups) {
      for (const it of g.items) {
        if (!q || it.label.toLowerCase().includes(q) || (it.kbd ?? "").toLowerCase().includes(q)) {
          items.push({ ...it, group: g.label });
        }
      }
    }
    return items;
  }, [groups, query]);

  // Arrow / Enter / Escape while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, Math.max(0, flat.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const it = flat[idx];
        if (it) void it.run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, flat, idx, close]);

  if (!open) return null;

  let cursor = 0;
  return (
    <div className="cmdk-scrim" onClick={close}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Search commands, projects, topics…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIdx(0);
          }}
        />
        <div className="cmdk-list scroll-area">
          {groups.map((g) => {
            const its = g.items.filter(
              (it) =>
                !query.trim() ||
                it.label.toLowerCase().includes(query.trim().toLowerCase()),
            );
            if (its.length === 0) return null;
            return (
              <div key={g.label}>
                <div className="cmdk-group-label">{g.label}</div>
                {its.map((it) => {
                  const my = cursor++;
                  const active = my === idx;
                  return (
                    <div
                      key={it.id}
                      className={"cmdk-item" + (active ? " active" : "")}
                      onMouseEnter={() => setIdx(my)}
                      onClick={() => void it.run()}
                    >
                      {it.icon}
                      <span>{it.label}</span>
                      {it.kbd && <span className="right">{it.kbd}</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {flat.length === 0 && (
            <div
              style={{ padding: "12px 14px", color: "var(--fg-3)", fontSize: 12.5 }}
            >
              No matches for &ldquo;{query}&rdquo;.
            </div>
          )}
        </div>
        <div className="cmdk-foot">
          <span className="grp">
            <span className="kbd-key">↑</span>
            <span className="kbd-key">↓</span> navigate
          </span>
          <span className="grp">
            <span className="kbd-key">↵</span> select
          </span>
          <span className="grp">
            <span className="kbd-key">esc</span> close
          </span>
          <span style={{ marginLeft: "auto" }}>autopost · ⌘K</span>
        </div>
      </div>
    </div>
  );
}

/** Global `g d`/`g c`/… navigation. Activates a 1.2s window after pressing `g` (unless typing). */
export function GlobalShortcuts() {
  const router = useRouter();
  useEffect(() => {
    const map: Record<string, string> = {
      d: "/dashboard",
      c: "/compose",
      t: "/topics",
      f: "/drafts",
      a: "/analytics",
      s: "/settings",
    };
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (!pending) {
        if (e.key === "g") {
          pending = true;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            pending = false;
          }, 1200);
        }
        return;
      }
      const href = map[e.key.toLowerCase()];
      if (href) {
        e.preventDefault();
        router.push(href);
      }
      pending = false;
      if (timer) clearTimeout(timer);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearTimeout(timer);
    };
  }, [router]);
  return null;
}
