import { useEffect, useState, useTransition } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, Trash2 } from "lucide-react";
import { saveSettingsAction } from "@/server/settings-actions";
import { deleteProjectAction } from "@/server/project-actions";
import { LANGUAGES, INTERVAL_OPTIONS } from "@/lib/topic-templates";
import { PLATFORM_LIMITS } from "@/lib/platforms";
import {
  ConnectionsPanel,
  type ConnectedRow,
} from "@/components/forms/connections-panel";
import { AiPanel, type AiCredentialView } from "@/components/settings/ai-panel";

type WritingStyle =
  | "professional"
  | "casual"
  | "technical"
  | "provocative"
  | "custom";
type Mode = "MANUAL" | "AUTOPILOT" | "HYBRID";
type Platform = "LINKEDIN" | "TELEGRAM";
type VoiceMode = "UNIFIED" | "PER_PLATFORM";

type VoiceCfg = {
  writingStyle: WritingStyle;
  customStyle: string;
  includeHashtags: boolean;
  includeSource: boolean;
  maxPostChars: number;
};

type TabId =
  | "appearance"
  | "general"
  | "channels"
  | "ai"
  | "voice"
  | "schedule"
  | "mode"
  | "safety"
  | "danger";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "appearance", label: "Appearance" },
  { id: "general", label: "General" },
  { id: "channels", label: "Channels" },
  { id: "ai", label: "AI / Model" },
  { id: "voice", label: "Voice" },
  { id: "schedule", label: "Schedule" },
  { id: "mode", label: "Mode" },
  { id: "safety", label: "Safety" },
  { id: "danger", label: "Danger zone" },
];

const ACCENT_PALETTE: Array<{ v: string; n: string }> = [
  { v: "#d97757", n: "clay" },
  { v: "#7c3aed", n: "violet" },
  { v: "#3b82f6", n: "blue" },
  { v: "#22c55e", n: "green" },
  { v: "#eab308", n: "yellow" },
  { v: "#ec4899", n: "pink" },
  { v: "#f97316", n: "orange" },
  { v: "#06b6d4", n: "cyan" },
  { v: "#e8e8ec", n: "mono" },
];

const WRITING_STYLES: Array<{ id: WritingStyle; label: string }> = [
  { id: "professional", label: "Professional" },
  { id: "casual", label: "Casual" },
  { id: "technical", label: "Technical" },
  { id: "provocative", label: "Provocative" },
  { id: "custom", label: "Custom" },
];

function applyAccent(hex: string) {
  const root = document.documentElement;
  root.style.setProperty("--accent", hex);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  root.style.setProperty("--accent-bg", `rgba(${r},${g},${b},0.13)`);
  const lift = (v: number) => Math.min(255, Math.round(v + (255 - v) * 0.15));
  root.style.setProperty("--accent-2", `rgb(${lift(r)},${lift(g)},${lift(b)})`);
}

function applyTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
}

export type SettingsInitial = {
  projectId: string;
  projectName: string;
  topics: string[];
  audience: string;
  angle: string;
  languages: string[];
  writingStyle: WritingStyle;
  customStyle: string;
  intervalDays: number;
  postsPerDay: number;
  preferredHour: number;
  timezone: string;
  mode: Mode;
  includeHashtags: boolean;
  includeSource: boolean;
  maxPostChars: number;
  bannedWords: string[];
  moderationEnabled: boolean;
  confidenceThreshold: number;
  skipDays: number[];
  voiceMode: VoiceMode;
  voiceOverrides: Partial<Record<Platform, VoiceCfg>>;
  connections: ConnectedRow[];
  ai: AiCredentialView | null;
};

export function SettingsTabs({ initial }: { initial: SettingsInitial }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Tab selection from hash so it survives reload + can be deep-linked.
  const [tab, setTab] = useState<TabId>("appearance");
  useEffect(() => {
    const fromHash = window.location.hash.replace("#", "") as TabId;
    // Deep-link the tab from the URL hash once, after hydration — reading
    // `window` during render would mismatch the server HTML. This is a
    // deliberate mount-time sync, not a render-cascading update.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (TABS.some((t) => t.id === fromHash)) setTab(fromHash);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    history.replaceState(null, "", `#${tab}`);
  }, [tab]);

  // Form state
  const [name, setName] = useState(initial.projectName);
  const [audience, setAudience] = useState(initial.audience);
  const [angle, setAngle] = useState(initial.angle);
  const [languages, setLanguages] = useState<string[]>(initial.languages);
  const [writingStyle, setWritingStyle] = useState<WritingStyle>(initial.writingStyle);
  const [customStyle, setCustomStyle] = useState(initial.customStyle);
  const [intervalDays, setIntervalDays] = useState(initial.intervalDays);
  const [postsPerDay, setPostsPerDay] = useState(initial.postsPerDay);
  const [preferredHour, setPreferredHour] = useState(initial.preferredHour);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [includeHashtags, setIncludeHashtags] = useState(initial.includeHashtags);
  const [includeSource, setIncludeSource] = useState(initial.includeSource);
  const [maxPostChars, setMaxPostChars] = useState(initial.maxPostChars);
  const [bannedWordsText, setBannedWordsText] = useState(
    initial.bannedWords.join(", "),
  );
  const [moderationEnabled, setModerationEnabled] = useState(
    initial.moderationEnabled,
  );
  const [confidenceThreshold, setConfidenceThreshold] = useState(
    initial.confidenceThreshold,
  );
  const [skipDays, setSkipDays] = useState<number[]>(initial.skipDays);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(initial.voiceMode);
  const [voiceOverrides, setVoiceOverrides] = useState<
    Partial<Record<Platform, VoiceCfg>>
  >(initial.voiceOverrides);
  const [voicePlatform, setVoicePlatform] = useState<Platform>("LINKEDIN");

  // Appearance (client-only, localStorage)
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [accent, setAccent] = useState<string>("#d97757");
  useEffect(() => {
    const t = (localStorage.getItem("ap_theme") as "dark" | "light" | null) ?? "dark";
    const a = localStorage.getItem("ap_accent") ?? "#d97757";
    applyTheme(t);
    applyAccent(a);
    // Read the persisted appearance once on the client after hydration —
    // localStorage isn't available on the server, so this can't run during
    // render. Deliberate mount-time sync, not a render-cascading update.
    /* eslint-disable react-hooks/set-state-in-effect */
    setTheme(t);
    setAccent(a);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  function pickTheme(t: "dark" | "light") {
    setTheme(t);
    applyTheme(t);
    localStorage.setItem("ap_theme", t);
  }
  function pickAccent(hex: string) {
    setAccent(hex);
    applyAccent(hex);
    localStorage.setItem("ap_accent", hex);
  }

  function toggleLang(id: string) {
    setLanguages((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id],
    );
  }

  function parseBannedWords(): string[] {
    return bannedWordsText
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean)
      .slice(0, 200);
  }

  function save() {
    if (languages.length === 0) {
      toast.error("Pick at least one language.");
      return;
    }
    if (initial.topics.length === 0) {
      toast.error("Add at least one topic on the Topics page first.");
      return;
    }
    startTransition(async () => {
      const res = await saveSettingsAction({
        data: {
        projectId: initial.projectId,
        projectName: name,
        topics: initial.topics,
        audience,
        angle,
        languages: languages as ("en" | "ru")[],
        writingStyle,
        customStyle,
        intervalDays,
        postsPerDay,
        preferredHour,
        timezone,
        mode,
        includeHashtags,
        includeSource,
        maxPostChars,
        bannedWords: parseBannedWords(),
        moderationEnabled,
        confidenceThreshold,
        skipDays,
        voiceMode,
        voiceOverrides:
          voiceMode === "PER_PLATFORM"
            ? Object.fromEntries(
                Object.entries(voiceOverrides).map(([k, v]) => [
                  k,
                  v ? { ...v, customStyle: v.customStyle || null } : v,
                ]),
              )
            : null,
        },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Settings saved.");
      await router.invalidate();
    });
  }

  function discard() {
    setName(initial.projectName);
    setAudience(initial.audience);
    setAngle(initial.angle);
    setLanguages(initial.languages);
    setWritingStyle(initial.writingStyle);
    setCustomStyle(initial.customStyle);
    setIntervalDays(initial.intervalDays);
    setPostsPerDay(initial.postsPerDay);
    setPreferredHour(initial.preferredHour);
    setTimezone(initial.timezone);
    setMode(initial.mode);
    setIncludeHashtags(initial.includeHashtags);
    setIncludeSource(initial.includeSource);
    setMaxPostChars(initial.maxPostChars);
    setBannedWordsText(initial.bannedWords.join(", "));
    setModerationEnabled(initial.moderationEnabled);
    setConfidenceThreshold(initial.confidenceThreshold);
    setSkipDays(initial.skipDays);
    setVoiceMode(initial.voiceMode);
    setVoiceOverrides(initial.voiceOverrides);
    toast.info("Reverted unsaved changes.");
  }

  function toggleSkipDay(d: number) {
    setSkipDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );
  }

  function defaultVoiceCfg(): VoiceCfg {
    return {
      writingStyle,
      customStyle,
      includeHashtags,
      includeSource,
      maxPostChars,
    };
  }

  function platformVoice(p: Platform): VoiceCfg {
    return voiceOverrides[p] ?? defaultVoiceCfg();
  }

  function patchPlatformVoice(p: Platform, patch: Partial<VoiceCfg>) {
    setVoiceOverrides((prev) => ({
      ...prev,
      [p]: { ...platformVoice(p), ...patch },
    }));
  }

  function deleteProject() {
    if (
      !window.confirm(
        `Delete "${initial.projectName}"? This removes all drafts, history, connections, and settings.`,
      )
    )
      return;
    startTransition(async () => {
      const res = await deleteProjectAction({ data: initial.projectId });
      if (res && !res.ok) {
        toast.error(res.error);
        return;
      }
      // Server action redirects on success
      await router.invalidate();
    });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-sub">
            Configure how the agent writes, when it posts, and what it can&apos;t
            say.
          </div>
        </div>
        <div className="hdr-right">
          <button
            type="button"
            className="btn ghost"
            onClick={discard}
            disabled={pending}
          >
            Discard
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={save}
            disabled={pending}
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={"tab" + (tab === t.id ? " active" : "")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* APPEARANCE */}
      {tab === "appearance" && (
        <div style={{ maxWidth: 760 }}>
          <div className="field">
            <div className="field-label">theme</div>
            <div
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
            >
              {(
                [
                  { v: "dark", l: "Dark", sub: "near-black surfaces · default" },
                  { v: "light", l: "Light", sub: "warm off-white · paper-like" },
                ] as const
              ).map((opt) => (
                <div
                  key={opt.v}
                  className={"radio-card" + (theme === opt.v ? " on" : "")}
                  onClick={() => pickTheme(opt.v)}
                  style={{ padding: 12 }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="dot" />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div
                        style={{
                          width: 36,
                          height: 24,
                          borderRadius: 4,
                          background: opt.v === "dark" ? "#0a0a0b" : "#fbfbf9",
                          border:
                            "1px solid " +
                            (opt.v === "dark" ? "#2a2a32" : "#dcdcd6"),
                          position: "relative",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            top: 4,
                            left: 4,
                            right: 4,
                            height: 3,
                            background:
                              opt.v === "dark" ? "#1f1f25" : "#e7e7e2",
                            borderRadius: 1,
                          }}
                        />
                        <div
                          style={{
                            position: "absolute",
                            bottom: 4,
                            left: 4,
                            width: 14,
                            height: 6,
                            background: accent,
                            borderRadius: 1,
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>
                        {opt.l}
                      </span>
                    </div>
                    <div
                      className="mono muted-2"
                      style={{ fontSize: 11.5, marginTop: 4 }}
                    >
                      {opt.sub}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="field">
            <div className="field-label">accent color</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(9, 1fr)",
                gap: 6,
                maxWidth: 460,
              }}
            >
              {ACCENT_PALETTE.map((c) => (
                <button
                  key={c.v}
                  type="button"
                  onClick={() => pickAccent(c.v)}
                  title={c.n}
                  style={{
                    aspectRatio: "1",
                    background: c.v,
                    border:
                      "2px solid " +
                      (accent === c.v ? "var(--fg)" : "transparent"),
                    borderRadius: 6,
                    cursor: "pointer",
                    padding: 0,
                    position: "relative",
                    boxShadow: accent === c.v ? "0 0 0 2px var(--bg)" : "none",
                  }}
                  aria-label={c.n}
                >
                  {accent === c.v && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "grid",
                        placeItems: "center",
                        color:
                          c.v === "#e8e8ec" ||
                          c.v === "#eab308" ||
                          c.v === "#22c55e"
                            ? "#0a0a0b"
                            : "white",
                      }}
                    >
                      <Check size={12} strokeWidth={3} />
                    </div>
                  )}
                </button>
              ))}
            </div>
            <div className="field-help mono" style={{ fontSize: 11 }}>
              current: <span style={{ color: accent }}>{accent}</span> ·{" "}
              <span className="muted-2">
                {ACCENT_PALETTE.find((c) => c.v === accent)?.n ?? "custom"}
              </span>
            </div>
          </div>

          <hr className="div" />

          <div className="mono muted-2" style={{ fontSize: 11 }}>
            theme + accent are stored in your browser · changes apply immediately
          </div>
        </div>
      )}

      {/* GENERAL */}
      {tab === "general" && (
        <div style={{ maxWidth: 720 }}>
          <div className="field">
            <div className="field-label">project name</div>
            <input
              className="input mono"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="field-help">
              used in the sidebar, breadcrumbs, and topbar.
            </div>
          </div>

          <div className="field">
            <div className="field-label">project_id</div>
            <input
              className="input mono"
              value={initial.projectId}
              readOnly
              style={{ color: "var(--fg-3)" }}
            />
          </div>

          <div className="field">
            <div className="field-label">output languages</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {LANGUAGES.map((l) => {
                const on = languages.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    style={{
                      background: on ? "var(--accent-bg)" : "var(--surface-2)",
                      color: on ? "var(--accent)" : "var(--fg-2)",
                      border:
                        "1px solid " +
                        (on ? "var(--accent)" : "var(--border-2)"),
                      padding: "4px 10px",
                      borderRadius: 9,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 11.5,
                      display: "inline-flex",
                      gap: 6,
                      alignItems: "center",
                    }}
                    onClick={() => toggleLang(l.id)}
                  >
                    {l.label}{" "}
                    <span className="muted-2 mono">{l.id}</span>
                  </button>
                );
              })}
            </div>
            <div className="field-help">
              if multiple, the agent generates parallel versions per post.
            </div>
          </div>

          <div className="field">
            <div className="field-label">topics</div>
            <div className="field-help">
              {initial.topics.length} topic
              {initial.topics.length === 1 ? "" : "s"} configured · manage on the{" "}
              <Link
                to="/topics"
                style={{ color: "var(--accent)", borderBottom: "1px dashed currentColor" }}
              >
                Topics page
              </Link>
              .
            </div>
          </div>

          <div className="field">
            <div className="field-label">audience</div>
            <textarea
              className="textarea"
              rows={2}
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="e.g. software developers building fintech products"
            />
            <div className="field-help">
              Who you write for. The agent uses this to decide which stories are
              relevant (off-topic ones are skipped, not posted) and whose
              perspective to write from.
            </div>
          </div>

          <div className="field">
            <div className="field-label">angle</div>
            <textarea
              className="textarea"
              rows={2}
              value={angle}
              onChange={(e) => setAngle(e.target.value)}
              placeholder="e.g. engineering & infrastructure implications — APIs, security, developer experience"
            />
            <div className="field-help">
              The lens to frame every story through. Lets the same topic be
              covered for different readers (a developer vs. an investor vs. an
              economist). Leave blank for a neutral take.
            </div>
          </div>
        </div>
      )}

      {/* CHANNELS */}
      {tab === "channels" && (
        <div style={{ maxWidth: 760 }}>
          <ConnectionsPanel
            projectId={initial.projectId}
            connections={initial.connections}
          />
        </div>
      )}

      {/* AI / MODEL */}
      {tab === "ai" && <AiPanel projectId={initial.projectId} initial={initial.ai} />}

      {/* VOICE */}
      {tab === "voice" && (
        <div style={{ maxWidth: 760 }}>
          <div className="field">
            <div className="field-label">voice setup</div>
            <div
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
            >
              <div
                className={"radio-card" + (voiceMode === "UNIFIED" ? " on" : "")}
                onClick={() => setVoiceMode("UNIFIED")}
                role="button"
                tabIndex={0}
              >
                <div className="dot" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    Unified voice
                  </div>
                  <div
                    className="mono muted-2"
                    style={{ fontSize: 11.5, marginTop: 2 }}
                  >
                    one voice across all platforms. simplest, most consistent.
                  </div>
                </div>
              </div>
              <div
                className={
                  "radio-card" + (voiceMode === "PER_PLATFORM" ? " on" : "")
                }
                onClick={() => setVoiceMode("PER_PLATFORM")}
                role="button"
                tabIndex={0}
              >
                <div className="dot" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    Per-platform voice
                  </div>
                  <div
                    className="mono muted-2"
                    style={{ fontSize: 11.5, marginTop: 2 }}
                  >
                    tune voice, length, and hashtags for each channel.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <hr className="div" />

          {voiceMode === "UNIFIED" ? (
            <>
              <div className="field">
                <div className="field-label">preset</div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(5, 1fr)",
                    gap: 6,
                  }}
                >
                  {WRITING_STYLES.map((p) => (
                    <div
                      key={p.id}
                      className={"radio-card" + (writingStyle === p.id ? " on" : "")}
                      onClick={() => setWritingStyle(p.id)}
                      style={{ padding: 10 }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="dot" />
                      <div>
                        <div
                          style={{
                            fontSize: 12.5,
                            fontWeight: 500,
                            textTransform: "capitalize",
                          }}
                        >
                          {p.label}
                        </div>
                        <div className="mono muted-2" style={{ fontSize: 10 }}>
                          preset_{p.id}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {writingStyle === "custom" && (
                <div className="field">
                  <div className="field-label">custom system prompt</div>
                  <textarea
                    className="textarea mono"
                    rows={5}
                    value={customStyle}
                    onChange={(e) => setCustomStyle(e.target.value)}
                    placeholder="Describe the voice, tone, and rules."
                  />
                  <div className="field-help mono" style={{ fontSize: 11 }}>
                    replaces the preset&apos;s voice block in the system prompt.
                  </div>
                </div>
              )}

              <div className="dash-row">
                <div>
                  <div className="title">Include hashtags</div>
                  <div className="sub">auto-generate 3–5 relevant hashtags at the end.</div>
                </div>
                <div
                  className={"toggle right" + (includeHashtags ? " on" : "")}
                  onClick={() => setIncludeHashtags(!includeHashtags)}
                  role="switch"
                  aria-checked={includeHashtags}
                />
              </div>
              <div className="dash-row">
                <div>
                  <div className="title">Include source link</div>
                  <div className="sub">append the article URL (first comment on LinkedIn).</div>
                </div>
                <div
                  className={"toggle right" + (includeSource ? " on" : "")}
                  onClick={() => setIncludeSource(!includeSource)}
                  role="switch"
                  aria-checked={includeSource}
                />
              </div>

              <div className="field" style={{ marginTop: 14, maxWidth: 240 }}>
                <div className="field-label">max post length · chars</div>
                <input
                  className="input mono"
                  type="number"
                  min={200}
                  max={3000}
                  value={maxPostChars}
                  onChange={(e) => setMaxPostChars(Number(e.target.value))}
                />
                <div className="field-help mono" style={{ fontSize: 11 }}>
                  LinkedIn hard limit {PLATFORM_LIMITS.LINKEDIN} · Telegram hard
                  limit {PLATFORM_LIMITS.TELEGRAM}
                </div>
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  padding: 4,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  marginBottom: 16,
                  width: "fit-content",
                }}
              >
                {(["LINKEDIN", "TELEGRAM"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setVoicePlatform(p)}
                    style={{
                      padding: "6px 10px",
                      background:
                        voicePlatform === p ? "var(--surface)" : "transparent",
                      border:
                        "1px solid " +
                        (voicePlatform === p
                          ? "var(--border-2)"
                          : "transparent"),
                      borderRadius: 4,
                      color: voicePlatform === p ? "var(--fg)" : "var(--fg-3)",
                      fontFamily: "inherit",
                      fontSize: 12.5,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    {p === "LINKEDIN" ? "LinkedIn" : "Telegram"}
                  </button>
                ))}
              </div>

              {(() => {
                const cfg = platformVoice(voicePlatform);
                const update = (patch: Partial<VoiceCfg>) =>
                  patchPlatformVoice(voicePlatform, patch);
                const hardLimit = PLATFORM_LIMITS[voicePlatform];
                return (
                  <>
                    <div className="field">
                      <div className="field-label">preset</div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(5, 1fr)",
                          gap: 6,
                        }}
                      >
                        {WRITING_STYLES.map((p) => (
                          <div
                            key={p.id}
                            className={
                              "radio-card" + (cfg.writingStyle === p.id ? " on" : "")
                            }
                            onClick={() => update({ writingStyle: p.id })}
                            style={{ padding: 10 }}
                            role="button"
                            tabIndex={0}
                          >
                            <div className="dot" />
                            <div>
                              <div
                                style={{
                                  fontSize: 12.5,
                                  fontWeight: 500,
                                  textTransform: "capitalize",
                                }}
                              >
                                {p.label}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="field">
                      <div className="field-label">
                        {voicePlatform.toLowerCase()} · system prompt
                      </div>
                      <textarea
                        className="textarea mono"
                        rows={5}
                        value={cfg.customStyle}
                        onChange={(e) => update({ customStyle: e.target.value })}
                        placeholder="Optional. Appended after the preset."
                      />
                    </div>

                    <div className="dash-row">
                      <div>
                        <div className="title">Include hashtags</div>
                        <div className="sub">
                          {voicePlatform === "TELEGRAM"
                            ? "on Telegram, hashtags usually feel spammy."
                            : "on LinkedIn, hashtags help discovery."}
                        </div>
                      </div>
                      <div
                        className={"toggle right" + (cfg.includeHashtags ? " on" : "")}
                        onClick={() =>
                          update({ includeHashtags: !cfg.includeHashtags })
                        }
                        role="switch"
                        aria-checked={cfg.includeHashtags}
                      />
                    </div>
                    <div className="dash-row">
                      <div>
                        <div className="title">Include source link</div>
                        <div className="sub">
                          {voicePlatform === "LINKEDIN"
                            ? "appended in the body (first comment is not supported by API)."
                            : "appended inline at the bottom."}
                        </div>
                      </div>
                      <div
                        className={"toggle right" + (cfg.includeSource ? " on" : "")}
                        onClick={() =>
                          update({ includeSource: !cfg.includeSource })
                        }
                        role="switch"
                        aria-checked={cfg.includeSource}
                      />
                    </div>

                    <div
                      className="field"
                      style={{ marginTop: 14, maxWidth: 240 }}
                    >
                      <div className="field-label">max length · chars</div>
                      <input
                        className="input mono"
                        type="number"
                        min={200}
                        max={hardLimit}
                        value={cfg.maxPostChars}
                        onChange={(e) =>
                          update({ maxPostChars: Number(e.target.value) })
                        }
                      />
                      <div className="field-help mono" style={{ fontSize: 11 }}>
                        {voicePlatform.toLowerCase()} hard limit: {hardLimit}
                      </div>
                    </div>
                  </>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* SCHEDULE */}
      {tab === "schedule" && (
        <div style={{ maxWidth: 760 }}>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}
          >
            <div className="field">
              <div className="field-label">frequency</div>
              <select
                className="select"
                value={String(intervalDays)}
                onChange={(e) => setIntervalDays(Number(e.target.value))}
              >
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <div className="field-label">posts per day</div>
              <input
                className="input mono"
                type="number"
                min={1}
                max={24}
                value={postsPerDay}
                onChange={(e) =>
                  setPostsPerDay(
                    Math.min(24, Math.max(1, Number(e.target.value) || 1)),
                  )
                }
              />
              <div className="field-help mono" style={{ fontSize: 11 }}>
                evenly spaced across the day
              </div>
            </div>
            <div className="field">
              <div className="field-label">hour (0–23)</div>
              <input
                className="input mono"
                type="number"
                min={0}
                max={23}
                value={preferredHour}
                onChange={(e) => setPreferredHour(Number(e.target.value))}
              />
            </div>
            <div className="field">
              <div className="field-label">timezone</div>
              <input
                className="input mono"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="UTC"
              />
              <div className="field-help mono" style={{ fontSize: 11 }}>
                IANA name, e.g. Europe/Moscow
              </div>
            </div>
          </div>

          <div className="field">
            <div className="field-label">skip days</div>
            <div style={{ display: "flex", gap: 4 }}>
              {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d, i) => {
                const off = skipDays.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleSkipDay(i)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 9,
                      cursor: "pointer",
                      background: off ? "var(--surface-3)" : "transparent",
                      border: "1px solid var(--border-2)",
                      color: off ? "var(--fg-4)" : "var(--fg)",
                      textDecoration: off ? "line-through" : "none",
                      fontFamily: "var(--font-plex-mono), monospace",
                      fontSize: 11,
                    }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <div className="field-help">
              crossed out = the pipeline skips that weekday (Mon–Sun).
            </div>
          </div>
        </div>
      )}

      {/* MODE */}
      {tab === "mode" && (
        <div style={{ maxWidth: 760 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <div
              className={"radio-card" + (mode === "MANUAL" ? " on" : "")}
              onClick={() => setMode("MANUAL")}
              role="button"
              tabIndex={0}
            >
              <div className="dot" />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  Manual approval{" "}
                  <span className="badge-pill accent">recommended</span>
                </div>
                <div
                  className="mono muted-2"
                  style={{ fontSize: 11.5, marginTop: 2 }}
                >
                  agent drafts · you approve each post · zero surprises
                </div>
              </div>
            </div>
            <div
              className={"radio-card" + (mode === "AUTOPILOT" ? " on" : "")}
              onClick={() => setMode("AUTOPILOT")}
              role="button"
              tabIndex={0}
            >
              <div className="dot" />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Autopilot</div>
                <div
                  className="mono muted-2"
                  style={{ fontSize: 11.5, marginTop: 2 }}
                >
                  agent writes and publishes on schedule · safety rules still apply
                </div>
              </div>
            </div>
            <div
              className={"radio-card" + (mode === "HYBRID" ? " on" : "")}
              onClick={() => setMode("HYBRID")}
              role="button"
              tabIndex={0}
            >
              <div className="dot" />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Hybrid</div>
                <div
                  className="mono muted-2"
                  style={{ fontSize: 11.5, marginTop: 2 }}
                >
                  auto-publish if model confidence ≥ threshold, otherwise queue
                  for review
                </div>
              </div>
            </div>
          </div>

          {mode === "HYBRID" && (
            <div className="field" style={{ marginTop: 14, maxWidth: 420 }}>
              <div className="field-label">
                auto-publish threshold ·{" "}
                <span className="mono" style={{ color: "var(--accent)" }}>
                  {confidenceThreshold}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={confidenceThreshold}
                onChange={(e) =>
                  setConfidenceThreshold(Number(e.target.value))
                }
                style={{ width: "100%", accentColor: "var(--accent)" }}
              />
              <div className="field-help mono" style={{ fontSize: 11 }}>
                drafts where model-reported confidence ≥ {confidenceThreshold}{" "}
                auto-publish; the rest land in Pending.
              </div>
            </div>
          )}
        </div>
      )}

      {/* SAFETY */}
      {tab === "safety" && (
        <div style={{ maxWidth: 760 }}>
          <div className="field">
            <div className="field-label">banned words / phrases</div>
            <textarea
              className="textarea mono"
              rows={3}
              placeholder="competitor-name, unreleased-product, internal-codename"
              value={bannedWordsText}
              onChange={(e) => setBannedWordsText(e.target.value)}
            />
            <div className="field-help">
              comma-separated. matches whole-word (case-insensitive). multi-word
              phrases match as substrings. any match blocks the post.
            </div>
          </div>

          <div className="dash-row">
            <div>
              <div className="title">AI moderation</div>
              <div className="sub">
                run each draft through Claude for a safety check. catches hate
                speech, illegal content, direct incitement.
              </div>
            </div>
            <div
              className={"toggle right" + (moderationEnabled ? " on" : "")}
              onClick={() => setModerationEnabled(!moderationEnabled)}
              role="switch"
              aria-checked={moderationEnabled}
            />
          </div>
        </div>
      )}

      {/* DANGER */}
      {tab === "danger" && (
        <div style={{ maxWidth: 760 }}>
          <div
            className="dash-card"
            style={{ borderColor: "rgba(248,113,113,0.3)" }}
          >
            <div className="dash-card-head">
              <h3 className="dash-card-title" style={{ color: "var(--err)" }}>
                Delete project
              </h3>
            </div>
            <div className="dash-card-sub">
              irreversible. disconnects all accounts, removes all drafts, posts,
              and settings.
            </div>
            <div className="dash-card-body">
              <button
                type="button"
                className="btn danger"
                onClick={deleteProject}
                disabled={pending}
              >
                <Trash2 size={12} />
                <span>Delete {initial.projectName}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
