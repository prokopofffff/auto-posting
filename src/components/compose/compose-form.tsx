import { useState, useTransition } from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Check,
  Clock,
  FileText as DraftIcon,
  Hash,
  ImagePlus,
  Link as LinkIcon,
  Plus,
  RefreshCw,
  Send,
  X,
  Zap,
} from "lucide-react";
import {
  aiComposeDraftAction,
  composeSubmitAction,
  uploadComposeImageAction,
} from "@/server/compose-actions";
import { PLATFORM_LIMITS } from "@/lib/platforms";
import { PlatformIcon } from "@/components/platform-icon";

export type ComposeChannel = {
  platform: "LINKEDIN" | "TELEGRAM";
  name: string;
  sub: string;
};

type ScheduleMode = "now" | "schedule" | "draft";

function defaultScheduleAt(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function AiDraftModal({
  open,
  onClose,
  onApply,
  projectId,
  language,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (text: string, topic: string, sourceUrl: string) => void;
  projectId: string;
  language: string;
}) {
  const [topic, setTopic] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [tone, setTone] = useState<"professional" | "casual" | "technical" | "provocative">(
    "professional",
  );
  const [generating, setGenerating] = useState(false);

  if (!open) return null;

  async function run() {
    if (!topic.trim()) return;
    setGenerating(true);
    const res = await aiComposeDraftAction({
      data: {
        projectId,
        topic: topic.trim(),
        sourceUrl: sourceUrl.trim() || undefined,
        tone,
        language,
      },
    });
    setGenerating(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    onApply(res.content, topic.trim(), sourceUrl.trim());
  }

  return (
    <div className="modal-scrim" onClick={() => !generating && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Zap size={14} /> AI draft
          </h3>
          <button
            type="button"
            className="btn icon sm ghost"
            onClick={onClose}
            disabled={generating}
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <div className="field-label">topic or angle</div>
            <input
              className="input"
              placeholder="e.g. local LLM benchmarks, MCP tooling"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              autoFocus
              disabled={generating}
            />
          </div>
          <div className="field">
            <div className="field-label">source article (optional)</div>
            <input
              className="input mono"
              placeholder="https://…"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              disabled={generating}
            />
            <div className="field-help">
              If provided, Claude will reference it as the primary source.
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <div className="field-label">tone</div>
            <div
              style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}
            >
              {(["professional", "casual", "technical", "provocative"] as const).map(
                (p) => (
                  <div
                    key={p}
                    className={"radio-card" + (tone === p ? " on" : "")}
                    onClick={() => !generating && setTone(p)}
                    style={{ padding: 8 }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="dot" />
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{p}</span>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span className="mono muted-2" style={{ marginRight: "auto", fontSize: 11 }}>
            {generating ? "drafting…" : "uses your Claude API key"}
          </span>
          <button
            type="button"
            className="btn ghost sm"
            onClick={onClose}
            disabled={generating}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary sm"
            onClick={run}
            disabled={generating || !topic.trim()}
          >
            {generating ? (
              <>
                <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} />
                <span>Drafting</span>
              </>
            ) : (
              <>
                <Zap size={12} />
                <span>Generate draft</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChannelPill({
  channel,
  active,
  onClick,
}: {
  channel: ComposeChannel;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        background: active ? "var(--accent-bg)" : "var(--surface)",
        border: "1px solid " + (active ? "var(--accent)" : "var(--border-2)"),
        borderRadius: 5,
        color: "var(--fg)",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        width: "100%",
      }}
    >
      <span style={{ color: active ? "var(--accent)" : "var(--fg-3)", display: "inline-flex" }}>
        <PlatformIcon platform={channel.platform} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {channel.name}
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)" }}>
          {channel.sub}
        </div>
      </div>
      {active && (
        <div
          style={{
            width: 14,
            height: 14,
            background: "var(--accent)",
            borderRadius: 3,
            display: "grid",
            placeItems: "center",
            color: "white",
            flexShrink: 0,
          }}
        >
          <Check size={10} strokeWidth={2.5} />
        </div>
      )}
    </button>
  );
}

export function ComposeForm({
  projectId,
  channels,
  languages,
}: {
  projectId: string;
  channels: ComposeChannel[];
  languages: string[];
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [topic, setTopic] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [language, setLanguage] = useState(languages[0] ?? "en");
  const [selected, setSelected] = useState<Set<ComposeChannel["platform"]>>(
    () => new Set(channels.length > 0 ? [channels[0].platform] : []),
  );
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("now");
  const [scheduleAt, setScheduleAt] = useState<string>(defaultScheduleAt());
  const [aiOpen, setAiOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const selectedChannels = channels.filter((c) => selected.has(c.platform));
  const selectedPlatforms = Array.from(selected);
  const minLimit = selectedPlatforms.length
    ? Math.min(...selectedPlatforms.map((p) => PLATFORM_LIMITS[p]))
    : 3000;
  const overLimit = body.length > minLimit;

  const stats = {
    chars: body.length,
    words: body.trim() ? body.trim().split(/\s+/).length : 0,
  };

  function togglePlatform(p: ComposeChannel["platform"]) {
    const n = new Set(selected);
    if (n.has(p)) n.delete(p);
    else n.add(p);
    setSelected(n);
  }

  const canSubmit =
    body.trim().length > 0 && selectedPlatforms.length > 0 && !overLimit && !pending;

  function submit() {
    if (!canSubmit) return;
    const base = {
      projectId,
      topic: topic.trim() || "manual",
      sourceUrl: sourceUrl.trim() || undefined,
      content: body,
      language,
      targets: selectedPlatforms,
      imageUrl: imageUrl || undefined,
    };
    startTransition(async () => {
      const res = await composeSubmitAction({
        data:
          scheduleMode === "now"
            ? { ...base, mode: "now" }
            : scheduleMode === "schedule"
            ? {
                ...base,
                mode: "schedule",
                scheduledAt: new Date(scheduleAt).toISOString(),
              }
            : { ...base, mode: "draft" },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.mode === "now") {
        toast.success(`Posted to ${selectedPlatforms.length} channel${selectedPlatforms.length === 1 ? "" : "s"}.`);
      } else if (res.mode === "schedule") {
        toast.success("Scheduled.");
      } else {
        toast.success("Saved to drafts.");
      }
      await router.invalidate();
      await navigate({ to: "/drafts" });
    });
  }

  function onPickImage(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("file", file);
    uploadComposeImageAction({ data: fd })
      .then((res) => {
        if (!res.ok) toast.error(res.error);
        else setImageUrl(res.url);
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setUploading(false));
  }

  function applyAi(text: string, t: string, src: string) {
    setBody(text);
    if (t && !topic) setTopic(t);
    if (src && !sourceUrl) setSourceUrl(src);
    setAiOpen(false);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Compose</h1>
          <div className="page-sub">
            Write a post yourself, pick the channels, ship now or schedule.
          </div>
        </div>
        <div className="hdr-right">
          <div className="page-meta">
            <span className="mono">
              {stats.chars} <span className="muted-2">chars</span>
            </span>
            <span className="mono">
              {stats.words} <span className="muted-2">words</span>
            </span>
            <span className="mono">
              {selectedPlatforms.length} <span className="muted-2">platforms</span>
            </span>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
        {/* === LEFT: editor === */}
        <div className="dash-card" style={{ overflow: "hidden" }}>
          {/* toolbar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 8px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-2)",
            }}
          >
            <button
              type="button"
              className="btn xs ghost"
              onClick={() => setAiOpen(true)}
            >
              <Zap size={11} />
              <span>AI draft</span>
              <span className="kbd">⌘ J</span>
            </button>

            <span style={{ flex: 1 }} />

            {languages.length > 1 && (
              <select
                className="input"
                style={{ width: 90, height: 24, fontSize: 11.5, padding: "0 6px" }}
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                {languages.map((l) => (
                  <option key={l} value={l}>
                    {l.toUpperCase()}
                  </option>
                ))}
              </select>
            )}

            <span className="mono muted-2" style={{ fontSize: 10.5 }}>
              {overLimit ? (
                <span style={{ color: "var(--err)" }}>
                  {body.length} / {minLimit} · over by {body.length - minLimit}
                </span>
              ) : (
                <span>
                  {body.length} / {minLimit}
                </span>
              )}
            </span>
          </div>

          {/* topic + source row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "240px 1fr",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 10px",
                borderRight: "1px solid var(--border)",
                background: "var(--bg-2)",
              }}
            >
              <Hash size={11} style={{ color: "var(--fg-4)" }} />
              <span
                className="mono muted-2"
                style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}
              >
                topic
              </span>
              <input
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  flex: 1,
                  fontSize: 12.5,
                  color: "var(--fg)",
                  height: 30,
                  fontFamily: "inherit",
                }}
                placeholder="—"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 10px",
              }}
            >
              <LinkIcon size={11} style={{ color: "var(--fg-4)" }} />
              <span
                className="mono muted-2"
                style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}
              >
                source url
              </span>
              <input
                className="mono"
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  flex: 1,
                  fontSize: 11.5,
                  color: "var(--fg-2)",
                  height: 30,
                  fontFamily: "var(--font-plex-mono), monospace",
                }}
                placeholder="(optional) https://…"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
              />
            </div>
          </div>

          {/* textarea */}
          <textarea
            style={{
              width: "100%",
              minHeight: 380,
              padding: "16px 20px",
              border: "none",
              outline: "none",
              resize: "vertical",
              background: "transparent",
              color: "var(--fg)",
              fontFamily: "var(--font-plex-sans), sans-serif",
              fontSize: 13.5,
              lineHeight: 1.6,
              display: "block",
            }}
            placeholder={"Write your post here…\n\nLead with what changed.\nWhy it matters in 2 lines.\nOne honest caveat at the end."}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (canSubmit) submit();
              }
            }}
          />

          {/* image attachment */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderTop: "1px solid var(--border)",
            }}
          >
            {imageUrl ? (
              <>
                <img
                  src={imageUrl}
                  alt="attachment preview"
                  style={{ height: 44, width: 44, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }}
                />
                <span className="mono muted-2" style={{ fontSize: 11 }}>photo attached</span>
                <button
                  type="button"
                  className="btn xs ghost danger"
                  onClick={() => setImageUrl(null)}
                  style={{ marginLeft: "auto" }}
                >
                  <X size={11} />
                  <span>Remove</span>
                </button>
              </>
            ) : (
              <label className="btn sm ghost" style={{ cursor: uploading ? "wait" : "pointer" }}>
                <ImagePlus size={12} />
                <span>{uploading ? "Uploading…" : "Add photo"}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  style={{ display: "none" }}
                  disabled={uploading}
                  onChange={(e) => {
                    onPickImage(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>

          {/* footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderTop: "1px solid var(--border)",
              background: "var(--bg-2)",
              fontFamily: "var(--font-plex-mono), monospace",
              fontSize: 10.5,
              color: "var(--fg-4)",
            }}
          >
            <span>language: {language}</span>
            <span style={{ marginLeft: "auto" }}>
              read time ≈{" "}
              <b style={{ color: "var(--fg-2)", fontWeight: 500 }}>
                {Math.max(1, Math.round(stats.words / 220))}m
              </b>
            </span>
          </div>
        </div>

        {/* === RIGHT: channels + schedule + send === */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="dash-card">
            <div className="dash-card-head">
              <h3 className="dash-card-title">Channels</h3>
              <span className="mono muted-2" style={{ fontSize: 10.5 }}>
                {selected.size} selected
              </span>
            </div>
            <div
              className="dash-card-body"
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              {channels.length === 0 ? (
                <div className="muted" style={{ fontSize: 12, padding: "4px 0" }}>
                  No channels connected yet.{" "}
                  <Link to="/settings" style={{ color: "var(--accent)" }}>
                    Connect one →
                  </Link>
                </div>
              ) : (
                channels.map((c) => (
                  <ChannelPill
                    key={c.platform}
                    channel={c}
                    active={selected.has(c.platform)}
                    onClick={() => togglePlatform(c.platform)}
                  />
                ))
              )}
              <Link
                to="/settings"
                className="btn ghost xs"
                style={{ marginTop: 4, justifyContent: "flex-start" }}
              >
                <Plus size={11} />
                <span>Connect another channel</span>
              </Link>
            </div>
          </div>

          <div className="dash-card">
            <div className="dash-card-head">
              <h3 className="dash-card-title">When</h3>
            </div>
            <div
              className="dash-card-body"
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              {(
                [
                  { id: "now", l: "Send now", icon: <Send size={12} /> },
                  { id: "schedule", l: "Schedule", icon: <Clock size={12} /> },
                  { id: "draft", l: "Save as draft", icon: <DraftIcon size={12} /> },
                ] as const
              ).map((opt) => (
                <div
                  key={opt.id}
                  className={"radio-card" + (scheduleMode === opt.id ? " on" : "")}
                  onClick={() => setScheduleMode(opt.id)}
                  style={{ padding: 8 }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="dot" />
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}
                  >
                    {opt.icon}
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>{opt.l}</span>
                  </div>
                </div>
              ))}
              {scheduleMode === "schedule" && (
                <input
                  type="datetime-local"
                  className="input mono"
                  style={{ marginTop: 4 }}
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                />
              )}
            </div>
          </div>

          <button
            type="button"
            className="btn primary"
            style={{ height: 36, justifyContent: "center", fontSize: 13 }}
            disabled={!canSubmit}
            onClick={submit}
          >
            {pending ? (
              <>
                <RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} />
                <span>Working…</span>
              </>
            ) : scheduleMode === "now" ? (
              <>
                <Send size={13} />
                <span>
                  Send to {selectedPlatforms.length} platform
                  {selectedPlatforms.length === 1 ? "" : "s"}
                </span>
                <span className="kbd">⌘ ↵</span>
              </>
            ) : scheduleMode === "schedule" ? (
              <>
                <Clock size={13} />
                <span>Schedule post</span>
              </>
            ) : (
              <>
                <DraftIcon size={13} />
                <span>Save to drafts</span>
              </>
            )}
          </button>

          {/* Per-channel previews */}
          {selectedChannels.length > 0 && body.trim() && (
            <div className="dash-card">
              <div className="dash-card-head">
                <h3 className="dash-card-title">Preview · per channel</h3>
              </div>
              <div
                className="dash-card-body"
                style={{ display: "flex", flexDirection: "column", gap: 0, padding: 0 }}
              >
                {selectedChannels.map((c, i) => {
                  const limit = PLATFORM_LIMITS[c.platform];
                  const truncated = body.length > limit;
                  return (
                    <div
                      key={c.platform}
                      style={{
                        padding: "10px 14px",
                        borderTop: i ? "1px solid var(--border)" : "none",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginBottom: 4,
                        }}
                      >
                        <PlatformIcon platform={c.platform} size={11} />
                        <span className="mono" style={{ fontSize: 11 }}>
                          {c.name}
                        </span>
                        <span
                          className="mono muted-2"
                          style={{ fontSize: 10.5, marginLeft: "auto" }}
                        >
                          {body.length} / {limit}
                          {truncated && (
                            <span style={{ color: "var(--err)" }}> · truncated</span>
                          )}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "var(--fg-3)",
                          lineHeight: 1.5,
                          maxHeight: 60,
                          overflow: "hidden",
                          whiteSpace: "pre-wrap",
                          maskImage:
                            "linear-gradient(to bottom, black 60%, transparent)",
                          WebkitMaskImage:
                            "linear-gradient(to bottom, black 60%, transparent)",
                        }}
                      >
                        {body.slice(0, limit)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <AiDraftModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onApply={applyAi}
        projectId={projectId}
        language={language}
      />
    </>
  );
}
