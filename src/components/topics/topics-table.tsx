import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "@tanstack/react-router";
import {
  Clock,
  Download,
  Globe,
  Hash,
  Search,
  Shield,
  Sparkles,
  TextCursor,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  addTopicAction,
  bulkImportTopicsAction,
  generateForTopicsAction,
  removeTopicsAction,
} from "@/server/topics-actions";
import { relAgo } from "@/lib/format";

export type TopicRow = {
  name: string;
  posts: number;
  lastDraftAt: string | null; // ISO
  status: "ok" | "warn" | "idle";
};

const STATUS_CLASS: Record<TopicRow["status"], string> = {
  ok: "badge-pill ok",
  warn: "badge-pill warn",
  idle: "badge-pill",
};

function StatusBadge({ s }: { s: TopicRow["status"] }) {
  return (
    <span className={STATUS_CLASS[s]}>
      <span className="dot" />
      {s === "idle" ? "idle" : s}
    </span>
  );
}

function BulkImportModal({
  open,
  onClose,
  onImport,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (raw: string) => void;
  pending: boolean;
}) {
  const [text, setText] = useState("");
  if (!open) return null;
  const lineCount = text.split("\n").filter((l) => l.trim()).length;
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Bulk import topics</h3>
          <button type="button" className="btn icon sm ghost" onClick={onClose} aria-label="Close">
            <X size={13} />
          </button>
        </div>
        <div className="modal-body">
          <div className="field" style={{ marginBottom: 0 }}>
            <div className="field-label">paste — one topic per line</div>
            <textarea
              className="textarea mono"
              placeholder={"local-first databases\nedge AI inference\nbuilding agent loops"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
            />
          </div>
        </div>
        <div className="modal-foot">
          <span className="mono muted-2" style={{ marginRight: "auto", fontSize: 11 }}>
            {lineCount} {lineCount === 1 ? "row" : "rows"} detected
          </span>
          <button type="button" className="btn ghost sm" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary sm"
            disabled={pending || lineCount === 0}
            onClick={() => onImport(text)}
          >
            {pending ? "Importing…" : "Import topics"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TopicsTable({
  projectId,
  projectLanguages,
  initialRows,
  nextRunRel,
  autoOpenImport = false,
}: {
  projectId: string;
  projectLanguages: string[];
  initialRows: TopicRow[];
  nextRunRel: string | null;
  autoOpenImport?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [genPending, startGen] = useTransition();
  const [genName, setGenName] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const [importOpen, setImportOpen] = useState(autoOpenImport);

  // Strip `?import=1` from the URL once consumed so a refresh doesn't re-trigger.
  if (typeof window !== "undefined" && autoOpenImport) {
    const url = new URL(window.location.href);
    if (url.searchParams.get("import") === "1") {
      url.searchParams.delete("import");
      window.history.replaceState({}, "", url.toString());
    }
  }

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return initialRows;
    return initialRows.filter((r) => r.name.toLowerCase().includes(ql));
  }, [initialRows, q]);

  const allSelected = sel.size > 0 && sel.size === filtered.length;
  const totalPosts = initialRows.reduce((s, r) => s + r.posts, 0);
  const activeCount = initialRows.filter((r) => r.status === "ok").length;
  const langDisplay = projectLanguages.map((l) => l.toUpperCase()).join("/") || "EN";

  function toggle(name: string) {
    const n = new Set(sel);
    if (n.has(name)) n.delete(name);
    else n.add(name);
    setSel(n);
  }
  function toggleAll() {
    if (allSelected) setSel(new Set());
    else setSel(new Set(filtered.map((r) => r.name)));
  }

  function addRow() {
    const v = newName.trim();
    if (!v) return;
    startTransition(async () => {
      const res = await addTopicAction({ data: { projectId, name: v } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setNewName("");
      await router.invalidate();
    });
  }

  function deleteSelected() {
    const names = Array.from(sel);
    if (names.length === 0) return;
    startTransition(async () => {
      const res = await removeTopicsAction({ data: { projectId, names } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Removed ${res.removed} topic${res.removed === 1 ? "" : "s"}.`);
      setSel(new Set());
      await router.invalidate();
    });
  }

  function generate(names: string[], label: string) {
    if (names.length === 0 || genPending) return;
    setGenName(label);
    startGen(async () => {
      const res = await generateForTopicsAction({ data: { projectId, topics: names } });
      setGenName(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if ("skipped" in res && res.skipped) {
        toast.info(res.reason);
        return;
      }
      toast.success(
        res.published ? "Generated and published a post." : "Draft generated — review it in Drafts.",
      );
      setSel(new Set());
      await router.invalidate();
    });
  }

  function runImport(raw: string) {
    startTransition(async () => {
      const res = await bulkImportTopicsAction({ data: { projectId, raw } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Imported ${res.added} topic${res.added === 1 ? "" : "s"}.`);
      setImportOpen(false);
      await router.invalidate();
    });
  }

  function exportCsv() {
    const csv =
      "topic,posts,last_run,status\n" +
      initialRows
        .map((r) => [r.name, r.posts, r.lastDraftAt ?? "", r.status].join(","))
        .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "topics.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Topics</h1>
          <div className="page-sub">
            What the agent researches. Each row is one subject — the pipeline
            picks from this list when generating drafts.
          </div>
        </div>
        <div className="hdr-right">
          <div className="page-meta">
            <span>
              <b>{initialRows.length}</b> topics
            </span>
            <span>
              <b>{activeCount}</b> active
            </span>
            {nextRunRel && (
              <span>
                next run in <b>{nextRunRel}</b>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="sheet">
        <div className="sheet-toolbar">
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => setImportOpen(true)}
            disabled={pending}
          >
            <Upload size={12} />
            <span>Import</span>
          </button>
          <button type="button" className="btn sm ghost" onClick={exportCsv}>
            <Download size={12} />
            <span>Export CSV</span>
          </button>

          <div className="sep" />

          <div
            style={{ position: "relative", display: "flex", alignItems: "center" }}
          >
            <Search
              size={12}
              style={{ position: "absolute", left: 8, color: "var(--fg-4)" }}
            />
            <input
              className="input"
              style={{ height: 24, paddingLeft: 26, width: 220, fontSize: 12 }}
              placeholder="Search topics…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <span className="count">
            {sel.size > 0
              ? `${sel.size} selected`
              : `${filtered.length} of ${initialRows.length}`}
          </span>

          {sel.size > 0 && (
            <>
              <button
                type="button"
                className="btn xs ghost"
                onClick={() => generate(Array.from(sel), `${sel.size} topics`)}
                disabled={genPending}
                title="Generate a draft now from the selected topics"
              >
                <Sparkles size={11} />
                <span>{genPending ? "Generating…" : "Generate"}</span>
              </button>
              <button
                type="button"
                className="btn xs ghost danger"
                onClick={deleteSelected}
                disabled={pending}
              >
                <Trash2 size={11} />
                <span>Delete</span>
              </button>
            </>
          )}
        </div>

        <div className="sheet-wrap scroll-area">
          <table>
            <thead>
              <tr>
                <th className="row-num">
                  <input
                    type="checkbox"
                    className="check"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                  />
                </th>
                <th style={{ width: 360 }}>
                  <TextCursor size={11} style={{ marginRight: 4, verticalAlign: -2 }} />
                  name
                </th>
                <th style={{ width: 100 }}>
                  <Hash size={11} style={{ marginRight: 4, verticalAlign: -2 }} />
                  posts
                </th>
                <th style={{ width: 140 }}>
                  <Clock size={11} style={{ marginRight: 4, verticalAlign: -2 }} />
                  last draft
                </th>
                <th style={{ width: 100 }}>
                  <Globe size={11} style={{ marginRight: 4, verticalAlign: -2 }} />
                  lang
                </th>
                <th style={{ width: 100 }}>
                  <Shield size={11} style={{ marginRight: 4, verticalAlign: -2 }} />
                  status
                </th>
                <th style={{ width: 76 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.name} className={sel.has(r.name) ? "checked" : ""}>
                  <td className="row-num">
                    <input
                      type="checkbox"
                      className="check"
                      checked={sel.has(r.name)}
                      onChange={() => toggle(r.name)}
                      aria-label={`Select ${r.name}`}
                    />
                  </td>
                  <td>
                    <span style={{ fontWeight: 500 }}>{r.name}</span>
                  </td>
                  <td>
                    <span className="cell-mono">{r.posts}</span>
                  </td>
                  <td>
                    <span className="cell-mono">{relAgo(r.lastDraftAt)}</span>
                  </td>
                  <td>
                    <span className="cell-mono">{langDisplay}</span>
                  </td>
                  <td>
                    <StatusBadge s={r.status} />
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 2 }}>
                      <button
                        type="button"
                        className="btn icon xs ghost"
                        onClick={() => generate([r.name], r.name)}
                        disabled={genPending}
                        aria-label={`Generate a post for ${r.name}`}
                        title="Generate a post now for this topic"
                      >
                        <Sparkles
                          size={12}
                          style={genPending && genName === r.name ? { animation: "spin 1s linear infinite" } : undefined}
                        />
                      </button>
                      <button
                        type="button"
                        className="btn icon xs ghost danger"
                        onClick={() => {
                          startTransition(async () => {
                            const res = await removeTopicsAction({ data: { projectId, names: [r.name] } });
                            if (!res.ok) toast.error(res.error);
                            else await router.invalidate();
                          });
                        }}
                        aria-label={`Remove ${r.name}`}
                        title="Remove"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="new-row">
                <td className="row-num">
                  <span className="mono">+</span>
                </td>
                <td colSpan={6}>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addRow();
                      }
                    }}
                    placeholder="Add a topic — press ⏎ to save"
                    disabled={pending}
                  />
                </td>
              </tr>
              {filtered.length === 0 && q && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--fg-3)", padding: "16px 0" }}>
                    No topics match “{q}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="sheet-foot">
          <span>
            {filtered.length} of {initialRows.length} topics · {totalPosts} posts
            generated
          </span>
          <span>auto-sync on</span>
        </div>
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
        <span className="mono muted-2" style={{ fontSize: 11 }}>
          shortcuts:
        </span>
        <span className="mono muted" style={{ fontSize: 11 }}>
          <span className="kbd-key">⏎</span> add row
        </span>
        <span className="mono muted" style={{ fontSize: 11 }}>
          <span className="kbd-key">/</span> search
        </span>
      </div>

      <BulkImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={runImport}
        pending={pending}
      />
    </>
  );
}
