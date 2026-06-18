"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  Clock,
  Copy,
  Edit,
  ExternalLink,
  Image as ImageIcon,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Trash2,
  X,
} from "lucide-react";
import {
  approveDraftAction,
  retryDraftAction,
  skipDraftAction,
  updateDraftContentAction,
} from "@/server/draft-actions";
import { fmtDateTime, fmtTimeOnly } from "@/lib/format";
import { PlatformIcon } from "@/components/platform-icon";

type Platform = "LINKEDIN" | "TELEGRAM";
type Status =
  | "PENDING"
  | "APPROVED"
  | "SCHEDULED"
  | "PUBLISHED"
  | "FAILED"
  | "SKIPPED";

type FactVerdict = "TRUSTED" | "CORROBORATED" | "UNVERIFIED";

export type DraftItem = {
  id: string;
  topic: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  targets: Platform[];
  status: Status;
  contentByLang: Record<string, string>;
  factVerdict: FactVerdict | null;
  sourceTrust: number | null;
  corroboratingSources: string[];
  createdAt: string;
  updatedAt: string;
  scheduledAt: string | null;
  posts: Array<{
    platform: Platform;
    externalUrl: string | null;
    error: string | null;
    publishedAt: string;
  }>;
};

export type DraftsCounts = {
  pending: number;
  queued: number;
  shipped: number;
  failed: number;
  all: number;
};

const FILTERS: Array<{ id: keyof DraftsCounts; label: string }> = [
  { id: "pending", label: "Pending" },
  { id: "queued", label: "Queued" },
  { id: "shipped", label: "Shipped" },
  { id: "failed", label: "Failed" },
  { id: "all", label: "All" },
];

// Shared style for the metadata/source/publish-log cards in the detail pane.
const DETAIL_BOX_STYLE: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  border: "1px solid var(--border)",
  borderRadius: 5,
  background: "var(--bg-2)",
  maxWidth: 720,
};

function StatusBadge({ s }: { s: Status }) {
  if (s === "PUBLISHED") return <span className="badge-pill ok">published</span>;
  if (s === "FAILED") return <span className="badge-pill err">failed</span>;
  if (s === "SCHEDULED") return <span className="badge-pill info">scheduled</span>;
  if (s === "APPROVED") return <span className="badge-pill accent">queued</span>;
  if (s === "PENDING") return <span className="badge-pill warn">pending</span>;
  return <span className="badge-pill">skipped</span>;
}

const VERDICT_META: Record<
  FactVerdict,
  { cls: string; Icon: typeof ShieldCheck; label: string; title: string }
> = {
  TRUSTED: {
    cls: "ok",
    Icon: ShieldCheck,
    label: "trusted",
    title: "Source is editorially trusted",
  },
  CORROBORATED: {
    cls: "info",
    Icon: ShieldQuestion,
    label: "corroborated",
    title: "Low-trust source, but independently corroborated by other outlets",
  },
  UNVERIFIED: {
    cls: "warn",
    Icon: ShieldAlert,
    label: "unverified",
    title:
      "Low-trust source with no independent corroboration — review before publishing",
  },
};

function VerdictBadge({ v }: { v: FactVerdict }) {
  const { cls, Icon, label, title } = VERDICT_META[v];
  return (
    <span className={`badge-pill ${cls}`} title={title}>
      <Icon size={11} style={{ verticalAlign: -2 }} /> {label}
    </span>
  );
}

export function DraftsPane({
  drafts,
  counts,
  activeFilter,
}: {
  drafts: DraftItem[];
  counts: DraftsCounts;
  activeFilter: keyof DraftsCounts;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(drafts[0]?.id ?? null);
  const [editing, setEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState<Record<string, string>>({});
  const [editLang, setEditLang] = useState<string | null>(null);

  const active = useMemo(
    () => drafts.find((d) => d.id === activeId) ?? drafts[0] ?? null,
    [drafts, activeId],
  );
  const activeContent = useMemo<Record<string, string>>(() => {
    if (!active) return {};
    return editing ? editBuffer : active.contentByLang;
  }, [active, editing, editBuffer]);

  const langs = active ? Object.keys(active.contentByLang) : [];
  const currentLang = (editLang ?? langs[0] ?? "en") as string;
  const currentText = activeContent[currentLang] ?? "";

  function pick(id: string) {
    setActiveId(id);
    setEditing(false);
    // Reset language so we don't point at a language the newly-picked draft lacks
    // (which would render a blank preview and copy an empty string).
    setEditLang(null);
  }

  function startEdit() {
    if (!active) return;
    setEditBuffer({ ...active.contentByLang });
    setEditLang(Object.keys(active.contentByLang)[0] ?? null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditBuffer({});
  }

  function saveEdit() {
    if (!active) return;
    startTransition(async () => {
      const res = await updateDraftContentAction(active.id, editBuffer);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Draft updated.");
      setEditing(false);
      router.refresh();
    });
  }

  function approve() {
    if (!active) return;
    startTransition(async () => {
      if (editing) {
        const upd = await updateDraftContentAction(active.id, editBuffer);
        if (!upd.ok) {
          toast.error(upd.error);
          return;
        }
      }
      const res = await approveDraftAction(active.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Published.");
      setEditing(false);
      router.refresh();
    });
  }

  function skip() {
    if (!active) return;
    startTransition(async () => {
      const res = await skipDraftAction(active.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Skipped.");
      router.refresh();
    });
  }

  function retry() {
    if (!active) return;
    startTransition(async () => {
      const res = await retryDraftAction(active.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Republished.");
      router.refresh();
    });
  }

  function copyText() {
    if (!active) return;
    const t = activeContent[currentLang] ?? "";
    navigator.clipboard.writeText(t).then(() => toast.success("Copied."));
  }

  const filterHrefFor = (id: keyof DraftsCounts) =>
    id === "pending" ? "/drafts" : `/drafts?status=${id}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Drafts</h1>
          <div className="page-sub">
            Review, edit, and approve generated posts before they ship.
          </div>
        </div>
        <div className="hdr-right">
          <div className="page-meta">
            <span>
              <b>{counts.pending}</b> pending
            </span>
            <span>
              <b>{counts.failed}</b> failed
            </span>
            <span>
              <b>{counts.shipped}</b> shipped
            </span>
          </div>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 12 }}>
        {FILTERS.map((t) => (
          <Link
            key={t.id}
            href={filterHrefFor(t.id)}
            className={"tab" + (activeFilter === t.id ? " active" : "")}
            scroll={false}
          >
            {t.label}
            <span className="count">{counts[t.id]}</span>
          </Link>
        ))}
      </div>

      <div className="drafts">
        {/* LIST */}
        <div className="draft-list scroll-area">
          <div className="draft-list-head">
            <span>
              {activeFilter} · {drafts.length} item{drafts.length === 1 ? "" : "s"}
            </span>
            <span>↕ newest</span>
          </div>
          {drafts.length === 0 ? (
            <div
              style={{
                padding: "24px 16px",
                color: "var(--fg-3)",
                fontSize: 12.5,
              }}
            >
              No drafts in this list.
            </div>
          ) : (
            drafts.map((d) => {
              const firstLang = Object.keys(d.contentByLang)[0] ?? "en";
              const text = d.contentByLang[firstLang] ?? "";
              const firstLine = text.split("\n").find((l) => l.trim()) ?? "";
              const title = d.sourceTitle ?? d.topic;
              return (
                <div
                  key={d.id}
                  className={"draft-row" + (d.id === active?.id ? " active" : "")}
                  onClick={() => pick(d.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") pick(d.id);
                  }}
                >
                  <div className="meta">
                    {d.targets.map((t) => (
                      <span
                        key={t}
                        style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
                      >
                        <PlatformIcon platform={t} size={11} />
                        <span>{t.toLowerCase()}</span>
                      </span>
                    ))}
                    {d.targets.length > 0 && <span>·</span>}
                    <span>{firstLang}</span>
                    <span>·</span>
                    <span>{text.length}c</span>
                    {d.imageUrl && (
                      <ImageIcon size={11} style={{ marginLeft: 4 }} aria-label="has photo" />
                    )}
                    <span style={{ marginLeft: "auto" }}>{fmtTimeOnly(d.createdAt)}</span>
                  </div>
                  <div className="title">{title}</div>
                  <div className="snippet">{firstLine}</div>
                  <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                    <span className="tag dot">{d.topic}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* DETAIL */}
        <div className="draft-detail">
          {!active ? (
            <div
              style={{
                padding: 24,
                color: "var(--fg-3)",
                fontSize: 12.5,
              }}
            >
              Select a draft to preview.
            </div>
          ) : (
            <>
              <div className="draft-detail-head">
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span className="badge-pill accent mono">
                    draft · {active.id.slice(0, 8)}
                  </span>
                  <StatusBadge s={active.status} />
                  {active.factVerdict && <VerdictBadge v={active.factVerdict} />}
                  {active.targets.map((t) => (
                    <span key={t} className="badge-pill mono">
                      {t.toLowerCase()}
                    </span>
                  ))}
                  {langs.map((l) => (
                    <span key={l} className="badge-pill mono">
                      {l}
                    </span>
                  ))}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    {(active.status === "FAILED" ||
                      active.posts.some((p) => p.error)) && (
                      <button
                        type="button"
                        className="btn xs ghost"
                        onClick={retry}
                        disabled={pending}
                      >
                        <RefreshCw size={11} />
                        <span>Retry</span>
                      </button>
                    )}
                    {!editing && active.status !== "PUBLISHED" && (
                      <button type="button" className="btn xs ghost" onClick={startEdit}>
                        <Edit size={11} />
                        <span>Edit</span>
                      </button>
                    )}
                    <button type="button" className="btn xs ghost" onClick={copyText}>
                      <Copy size={11} />
                      <span>Copy</span>
                    </button>
                  </div>
                </div>
                <h2 className="draft-detail-title">
                  {active.sourceTitle ?? active.topic}
                </h2>
                <div className="draft-detail-meta">
                  <span>{fmtDateTime(active.createdAt)}</span>
                  {active.sourceUrl ? (
                    <>
                      <span>·</span>
                      <a
                        href={active.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ borderBottom: "1px dashed var(--border-3)" }}
                      >
                        <ExternalLink size={10} style={{ verticalAlign: -1 }} /> source
                      </a>
                    </>
                  ) : null}
                  <span>·</span>
                  <span>{currentText.length} chars</span>
                  <span>·</span>
                  <span>
                    {currentText.trim() ? currentText.trim().split(/\s+/).length : 0} words
                  </span>
                  {langs.length > 1 && (
                    <>
                      <span>·</span>
                      <select
                        className="input mono"
                        value={currentLang}
                        onChange={(e) => setEditLang(e.target.value)}
                        style={{
                          height: 22,
                          width: 60,
                          padding: "0 6px",
                          fontSize: 10.5,
                        }}
                      >
                        {langs.map((l) => (
                          <option key={l} value={l}>
                            {l.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  {active.scheduledAt && (
                    <>
                      <span>·</span>
                      <span style={{ color: "var(--info)" }}>
                        scheduled {fmtDateTime(active.scheduledAt)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="draft-detail-body scroll-area">
                {active.imageUrl && (
                  <div style={{ marginBottom: 14, maxWidth: 720 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={active.imageUrl}
                      alt="post attachment"
                      style={{
                        width: "100%",
                        maxHeight: 360,
                        objectFit: "cover",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        display: "block",
                      }}
                    />
                  </div>
                )}
                {editing ? (
                  <textarea
                    className="textarea mono"
                    style={{ minHeight: 280, maxWidth: 720 }}
                    value={editBuffer[currentLang] ?? ""}
                    onChange={(e) =>
                      setEditBuffer({ ...editBuffer, [currentLang]: e.target.value })
                    }
                  />
                ) : (
                  <div className="draft-preview">{currentText}</div>
                )}

                {active.sourceUrl && (
                  <div style={{ ...DETAIL_BOX_STYLE, marginTop: 16 }}>
                    <div
                      className="mono"
                      style={{
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--fg-4)",
                        marginBottom: 6,
                      }}
                    >
                      source article
                    </div>
                    <div style={{ fontSize: 12.5 }}>
                      <a
                        href={active.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={active.sourceUrl}
                        style={{
                          borderBottom: "1px dashed var(--border-3)",
                          // Crop long source URLs (e.g. Google News redirects)
                          // to one line; full URL is on hover and on click.
                          display: "block",
                          maxWidth: "100%",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {active.sourceUrl}
                      </a>
                    </div>
                    {active.sourceTitle && (
                      <div
                        className="mono muted-2"
                        style={{ fontSize: 11, marginTop: 4 }}
                      >
                        {active.sourceTitle}
                      </div>
                    )}
                  </div>
                )}

                {/* Source verification */}
                {active.factVerdict && (
                  <div style={DETAIL_BOX_STYLE}>
                    <div
                      className="mono"
                      style={{
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--fg-4)",
                        marginBottom: 6,
                      }}
                    >
                      source verification
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--fg-2)", lineHeight: 1.7 }}
                    >
                      <div style={{ marginBottom: 4 }}>
                        <VerdictBadge v={active.factVerdict} />
                        {typeof active.sourceTrust === "number" && (
                          <span className="muted-2" style={{ marginLeft: 8 }}>
                            source trust {Math.round(active.sourceTrust * 100)}%
                          </span>
                        )}
                      </div>
                      {active.factVerdict === "UNVERIFIED" ? (
                        <div className="muted">
                          Low-trust source, no independent reports found. Written
                          cautiously and held for manual review — it will not
                          auto-publish.
                        </div>
                      ) : active.factVerdict === "CORROBORATED" ? (
                        <div>
                          <span className="muted">corroborated by</span> &nbsp;
                          {active.corroboratingSources.length > 0
                            ? active.corroboratingSources.join(", ")
                            : "other outlets"}
                        </div>
                      ) : (
                        <div className="muted">
                          Source is editorially trusted — published as reported.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Generation details */}
                <div style={DETAIL_BOX_STYLE}>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--fg-4)",
                      marginBottom: 6,
                    }}
                  >
                    metadata
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 11, color: "var(--fg-2)", lineHeight: 1.7 }}
                  >
                    <div>
                      <span className="muted">topic</span> &nbsp; {active.topic}
                    </div>
                    <div>
                      <span className="muted">created</span> &nbsp;{" "}
                      {fmtDateTime(active.createdAt)}
                    </div>
                    <div>
                      <span className="muted">updated</span> &nbsp;{" "}
                      {fmtDateTime(active.updatedAt)}
                    </div>
                    <div>
                      <span className="muted">targets</span> &nbsp;{" "}
                      {active.targets.map((t) => t.toLowerCase()).join(", ") || "—"}
                    </div>
                    <div>
                      <span className="muted">languages</span> &nbsp;{" "}
                      {langs.join(", ") || "—"}
                    </div>
                  </div>
                </div>

                {/* Posts (for shipped/failed) */}
                {active.posts.length > 0 && (
                  <div style={DETAIL_BOX_STYLE}>
                    <div
                      className="mono"
                      style={{
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "var(--fg-4)",
                        marginBottom: 6,
                      }}
                    >
                      publish log
                    </div>
                    {active.posts.map((p, i) => (
                      <div
                        key={i}
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: p.error ? "var(--err)" : "var(--fg-2)",
                          lineHeight: 1.7,
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        <PlatformIcon platform={p.platform} size={11} />
                        <span>{p.platform.toLowerCase()}</span>
                        <span className="muted-2">·</span>
                        <span className="muted-2">{fmtDateTime(p.publishedAt)}</span>
                        {p.externalUrl && (
                          <>
                            <span className="muted-2">·</span>
                            <a
                              href={p.externalUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{ borderBottom: "1px dashed var(--border-3)" }}
                            >
                              view
                            </a>
                          </>
                        )}
                        {p.error && (
                          <>
                            <span className="muted-2">·</span>
                            <span>{p.error}</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="draft-detail-foot">
                {editing ? (
                  <>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={cancelEdit}
                      disabled={pending}
                    >
                      <X size={12} />
                      <span>Cancel</span>
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={saveEdit}
                      disabled={pending}
                    >
                      <Check size={12} />
                      <span>Save</span>
                    </button>
                  </>
                ) : (
                  <>
                    {active.status !== "PUBLISHED" && active.status !== "SKIPPED" && (
                      <button
                        type="button"
                        className="btn ghost sm danger"
                        onClick={skip}
                        disabled={pending}
                      >
                        <Trash2 size={12} />
                        <span>Skip</span>
                      </button>
                    )}
                    {active.status === "SCHEDULED" && active.scheduledAt && (
                      <span className="stat">
                        <Clock size={11} style={{ verticalAlign: -2 }} /> publishes{" "}
                        {fmtDateTime(active.scheduledAt)}
                      </span>
                    )}
                  </>
                )}
                <div className="spacer" />
                {!editing && active.status === "PENDING" && (
                  <>
                    <span className="stat">⌘↵ approve · ⌫ skip</span>
                    <button
                      type="button"
                      className="btn primary sm"
                      onClick={approve}
                      disabled={pending}
                    >
                      <Send size={12} />
                      <span>Approve & publish</span>
                      <span className="kbd">⌘ ↵</span>
                    </button>
                  </>
                )}
                {!editing && active.status === "APPROVED" && (
                  <button
                    type="button"
                    className="btn primary sm"
                    onClick={approve}
                    disabled={pending}
                  >
                    <Send size={12} />
                    <span>Publish now</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
