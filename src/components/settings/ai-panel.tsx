import { useState, useTransition } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { KeyRound, Sparkles, Trash2, ExternalLink, Brain } from "lucide-react";
import {
  connectClaudeApiKeyAction,
  connectDeepSeekApiKeyAction,
  connectOpenAiApiKeyAction,
  startCodexLoginAction,
  connectCodexSubscriptionAction,
  setAiCredentialAction,
  setAiModelAction,
  listAiModelsAction,
  disconnectAiCredentialAction,
  type AiCredentialKind,
} from "@/server/ai-credential-actions";

type Provider = "ANTHROPIC" | "DEEPSEEK" | "OPENAI";

export type AiCredentialView = {
  provider: Provider;
  mode: "API_KEY" | "SUBSCRIPTION";
  hasApiKey: boolean;
  hasSubscription: boolean;
  hasDeepSeek: boolean;
  hasOpenAiKey: boolean;
  hasCodexSubscription: boolean;
  model: string | null;
  connectedByEmail: string | null;
  subscriptionExpiresAt: string | null;
};

type Kind = AiCredentialKind;

function providerOf(kind: Kind): Provider {
  if (kind === "DEEPSEEK") return "DEEPSEEK";
  if (kind === "OPENAI_API_KEY" || kind === "CODEX_SUBSCRIPTION") return "OPENAI";
  return "ANTHROPIC";
}

function deriveActiveKind(v: AiCredentialView | null): Kind | null {
  if (!v) return null;
  if (v.provider === "DEEPSEEK") return v.hasDeepSeek ? "DEEPSEEK" : null;
  if (v.provider === "OPENAI") {
    if (v.mode === "SUBSCRIPTION") return v.hasCodexSubscription ? "CODEX_SUBSCRIPTION" : null;
    return v.hasOpenAiKey ? "OPENAI_API_KEY" : null;
  }
  // ANTHROPIC
  if (v.mode === "SUBSCRIPTION") return v.hasSubscription ? "CLAUDE_SUBSCRIPTION" : null;
  return v.hasApiKey ? "CLAUDE_API_KEY" : null;
}

export function AiPanel({
  projectId,
  initial,
}: {
  projectId: string;
  initial: AiCredentialView | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const connected =
    !!initial &&
    (initial.hasApiKey ||
      initial.hasSubscription ||
      initial.hasDeepSeek ||
      initial.hasOpenAiKey ||
      initial.hasCodexSubscription);

  const activeKind = deriveActiveKind(initial);
  const [view, setView] = useState<Kind>(activeKind ?? "CLAUDE_API_KEY");

  // API key secrets
  const [apiKey, setApiKey] = useState("");
  const [deepseekKey, setDeepseekKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");

  // Codex subscription PKCE round-trip
  const [codexPkce, setCodexPkce] = useState<{ verifier: string; state: string } | null>(null);
  const [codexCode, setCodexCode] = useState("");
  const [codexLoginUrl, setCodexLoginUrl] = useState<string | null>(null);

  // Models
  const [models, setModels] = useState<{ id: string; displayName: string }[]>([]);
  const [model, setModel] = useState<string>(initial?.model ?? "");
  const [loadingModels, setLoadingModels] = useState(false);

  function resetModelForProvider(target: Provider) {
    if (initial?.provider !== target) setModel("");
    setModels([]);
  }

  function loadModels() {
    if (!connected) return;
    setLoadingModels(true);
    startTransition(async () => {
      const res = await listAiModelsAction({ data: projectId });
      setLoadingModels(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setModels(res.models);
      if (!res.live) toast.info("Showing a fallback list — couldn't query models for this credential.");
    });
  }

  function ensureModelsLoaded() {
    if (connected && models.length === 0 && !loadingModels) loadModels();
  }

  function selectView(next: Kind) {
    setView(next);
    const can =
      next === "CLAUDE_API_KEY" ? initial?.hasApiKey
      : next === "CLAUDE_SUBSCRIPTION" ? initial?.hasSubscription
      : next === "OPENAI_API_KEY" ? initial?.hasOpenAiKey
      : next === "CODEX_SUBSCRIPTION" ? initial?.hasCodexSubscription
      : initial?.hasDeepSeek;
    if (!can || next === activeKind) return;
    startTransition(async () => {
      const res = await setAiCredentialAction({ data: { projectId, kind: next } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const label =
        next === "DEEPSEEK" ? "DeepSeek"
        : next === "OPENAI_API_KEY" ? "OpenAI API key"
        : next === "CODEX_SUBSCRIPTION" ? "Codex subscription"
        : "Claude API key";
      toast.success(`Using ${label}.`);
      resetModelForProvider(providerOf(next));
      await router.invalidate();
    });
  }

  function saveApiKey() {
    if (!apiKey.trim()) { toast.error("Paste an API key first."); return; }
    startTransition(async () => {
      const res = await connectClaudeApiKeyAction({ data: { projectId, apiKey } });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("API key saved.");
      setApiKey("");
      resetModelForProvider("ANTHROPIC");
      await router.invalidate();
    });
  }

  function saveDeepseekKey() {
    if (!deepseekKey.trim()) { toast.error("Paste an API key first."); return; }
    startTransition(async () => {
      const res = await connectDeepSeekApiKeyAction({ data: { projectId, apiKey: deepseekKey } });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("DeepSeek API key saved.");
      setDeepseekKey("");
      resetModelForProvider("DEEPSEEK");
      await router.invalidate();
    });
  }

  function saveOpenAiKey() {
    if (!openaiKey.trim()) { toast.error("Paste an API key first."); return; }
    startTransition(async () => {
      const res = await connectOpenAiApiKeyAction({ data: { projectId, apiKey: openaiKey } });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("OpenAI API key saved.");
      setOpenaiKey("");
      resetModelForProvider("OPENAI");
      await router.invalidate();
    });
  }

  function beginCodexLogin() {
    const popup = window.open("about:blank", "_blank");
    startTransition(async () => {
      const res = await startCodexLoginAction({ data: projectId });
      if (!res.ok) {
        popup?.close();
        toast.error(res.error);
        return;
      }
      setCodexPkce({ verifier: res.verifier, state: res.state });
      if (popup && !popup.closed) {
        try { popup.opener = null; } catch { /* cross-origin */ }
        popup.location.replace(res.url);
        setCodexLoginUrl(null);
        toast.info("Approve in the new tab, then paste the code below.");
      } else {
        setCodexLoginUrl(res.url);
        toast.info("Popup blocked — use the “Open Codex login” link below.");
      }
    });
  }

  function completeCodexLogin() {
    if (!codexPkce) { toast.error("Start the connect flow first."); return; }
    if (!codexCode.trim()) { toast.error("Paste the code shown after login."); return; }
    startTransition(async () => {
      const res = await connectCodexSubscriptionAction({
        data: {
          projectId,
          code: codexCode,
          verifier: codexPkce.verifier,
          state: codexPkce.state,
        },
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Codex subscription connected.");
      setCodexCode("");
      setCodexPkce(null);
      setCodexLoginUrl(null);
      resetModelForProvider("OPENAI");
      await router.invalidate();
    });
  }

  function chooseModel(next: string) {
    setModel(next);
    if (!next) return;
    startTransition(async () => {
      const res = await setAiModelAction({ data: { projectId, model: next } });
      if (!res.ok) toast.error(res.error);
      else toast.success("Model updated.");
    });
  }

  function disconnect() {
    if (!window.confirm("Disconnect AI for this project? Auto-posting will stop until you reconnect.")) {
      return;
    }
    startTransition(async () => {
      const res = await disconnectAiCredentialAction({ data: projectId });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Disconnected.");
      await router.invalidate();
    });
  }

  // Per-kind status pill
  function statusPill(kind: Kind, hasIt: boolean | undefined) {
    if (!hasIt) return null;
    return kind === activeKind ? (
      <span className="badge-pill accent">in use</span>
    ) : (
      <span className="badge-pill">connected</span>
    );
  }

  const onDeepSeek = activeKind === "DEEPSEEK";
  const onCodex = activeKind === "CODEX_SUBSCRIPTION";
  const onOpenAi = activeKind === "OPENAI_API_KEY" || onCodex;

  const modelLabel = onDeepSeek ? "deepseek model" : onOpenAi ? "openai model" : "claude model";
  // Codex subscriptions resolve through the ChatGPT backend (default gpt-5.5);
  // plain API keys default to gpt-4o-mini.
  const modelDefault = onDeepSeek
    ? "deepseek-chat"
    : onCodex
    ? "gpt-5.5"
    : onOpenAi
    ? "gpt-4o-mini"
    : "Haiku";

  return (
    <div style={{ maxWidth: 760 }}>
      <div
        className="dash-card"
        style={{ borderColor: "var(--accent-bg)", marginBottom: 16 }}
      >
        <div className="dash-card-sub" style={{ padding: 12 }}>
          <strong>For testing.</strong> Connect this project&apos;s own model credential — a
          Claude API key, an OpenAI API key, a Codex subscription, or a DeepSeek API key.
          It is stored encrypted and used only for this project; it is never shared with other
          users or projects.
        </div>
      </div>

      {/* Credential type — 2×2 grid */}
      <div className="field">
        <div className="field-label">credential type</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div
            className={"radio-card" + (view === "CLAUDE_API_KEY" ? " on" : "")}
            onClick={() => selectView("CLAUDE_API_KEY")}
            role="button"
            tabIndex={0}
          >
            <div className="dot" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, display: "flex", gap: 6, alignItems: "center" }}>
                <KeyRound size={13} /> Claude API key
                {statusPill("CLAUDE_API_KEY", initial?.hasApiKey)}
              </div>
              <div className="mono muted-2" style={{ fontSize: 11.5, marginTop: 2 }}>
                a console.anthropic.com key
              </div>
            </div>
          </div>

          <div
            className={"radio-card" + (view === "OPENAI_API_KEY" ? " on" : "")}
            onClick={() => selectView("OPENAI_API_KEY")}
            role="button"
            tabIndex={0}
          >
            <div className="dot" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, display: "flex", gap: 6, alignItems: "center" }}>
                <KeyRound size={13} /> OpenAI API key
                {statusPill("OPENAI_API_KEY", initial?.hasOpenAiKey)}
              </div>
              <div className="mono muted-2" style={{ fontSize: 11.5, marginTop: 2 }}>
                a platform.openai.com key
              </div>
            </div>
          </div>

          <div
            className={"radio-card" + (view === "CODEX_SUBSCRIPTION" ? " on" : "")}
            onClick={() => selectView("CODEX_SUBSCRIPTION")}
            role="button"
            tabIndex={0}
          >
            <div className="dot" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, display: "flex", gap: 6, alignItems: "center" }}>
                <Sparkles size={13} /> Codex subscription
                {statusPill("CODEX_SUBSCRIPTION", initial?.hasCodexSubscription)}
              </div>
              <div className="mono muted-2" style={{ fontSize: 11.5, marginTop: 2 }}>
                login with code
              </div>
            </div>
          </div>

          <div
            className={"radio-card" + (view === "DEEPSEEK" ? " on" : "")}
            onClick={() => selectView("DEEPSEEK")}
            role="button"
            tabIndex={0}
          >
            <div className="dot" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, display: "flex", gap: 6, alignItems: "center" }}>
                <Brain size={13} /> DeepSeek
                {statusPill("DEEPSEEK", initial?.hasDeepSeek)}
              </div>
              <div className="mono muted-2" style={{ fontSize: 11.5, marginTop: 2 }}>
                an api.deepseek.com key
              </div>
            </div>
          </div>
        </div>
      </div>

      <hr className="div" />

      {/* Claude API key */}
      {view === "CLAUDE_API_KEY" && (
        <div className="field">
          <div className="field-label">anthropic api key</div>
          <input
            className="input mono"
            type="password"
            placeholder={initial?.hasApiKey ? "•••••••••• (saved) — paste to replace" : "sk-ant-..."}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
          <div className="field-help">stored encrypted · only used for this project.</div>
          <button type="button" className="btn primary" onClick={saveApiKey} disabled={pending} style={{ marginTop: 8 }}>
            {pending ? "Saving…" : initial?.hasApiKey ? "Replace key" : "Save key"}
          </button>
        </div>
      )}

      {/* OpenAI API key */}
      {view === "OPENAI_API_KEY" && (
        <div className="field">
          <div className="field-label">openai api key</div>
          <input
            className="input mono"
            type="password"
            placeholder={initial?.hasOpenAiKey ? "•••••••••• (saved) — paste to replace" : "sk-..."}
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            autoComplete="off"
          />
          <div className="field-help">
            stored encrypted · only used for this project ·{" "}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent)", textDecoration: "underline" }}
            >
              get a key
            </a>
          </div>
          <button type="button" className="btn primary" onClick={saveOpenAiKey} disabled={pending} style={{ marginTop: 8 }}>
            {pending ? "Saving…" : initial?.hasOpenAiKey ? "Replace key" : "Save key"}
          </button>
        </div>
      )}

      {/* Codex subscription */}
      {view === "CODEX_SUBSCRIPTION" && (
        <div className="field">
          <div className="field-label">codex — login with code</div>
          {initial?.hasCodexSubscription && !codexPkce && (
            <div className="field-help" style={{ marginBottom: 8 }}>
              Connected.
            </div>
          )}
          <ol className="field-help" style={{ paddingLeft: 18, marginBottom: 8, lineHeight: 1.7 }}>
            <li>Click <strong>Open Codex login</strong> — sign in with your ChatGPT account and approve.</li>
            <li>
              Your browser lands on a <span className="mono">localhost:1455</span> page that
              won&apos;t load — that&apos;s expected. Copy its full URL from the address bar.
            </li>
            <li>Paste the URL below and click <strong>Complete</strong>.</li>
          </ol>
          <button
            type="button"
            className="btn"
            onClick={beginCodexLogin}
            disabled={pending}
            style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
          >
            <ExternalLink size={13} /> Open Codex login
          </button>
          {codexLoginUrl && (
            <div className="field-help" style={{ marginTop: 8 }}>
              Popup blocked.{" "}
              <a
                href={codexLoginUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)", textDecoration: "underline" }}
              >
                Open Codex login manually
              </a>
              .
            </div>
          )}
          {codexPkce && (
            <div style={{ marginTop: 10 }}>
              <input
                className="input mono"
                placeholder="paste the localhost:1455 URL (or code) here"
                value={codexCode}
                onChange={(e) => setCodexCode(e.target.value)}
                autoComplete="off"
              />
              <button
                type="button"
                className="btn primary"
                onClick={completeCodexLogin}
                disabled={pending}
                style={{ marginTop: 8 }}
              >
                {pending ? "Connecting…" : "Complete"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* DeepSeek API key */}
      {view === "DEEPSEEK" && (
        <div className="field">
          <div className="field-label">deepseek api key</div>
          <input
            className="input mono"
            type="password"
            placeholder={initial?.hasDeepSeek ? "•••••••••• (saved) — paste to replace" : "sk-..."}
            value={deepseekKey}
            onChange={(e) => setDeepseekKey(e.target.value)}
            autoComplete="off"
          />
          <div className="field-help">
            stored encrypted · only used for this project ·{" "}
            <a
              href="https://platform.deepseek.com/api_keys"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent)", textDecoration: "underline" }}
            >
              get a key
            </a>
          </div>
          <button type="button" className="btn primary" onClick={saveDeepseekKey} disabled={pending} style={{ marginTop: 8 }}>
            {pending ? "Saving…" : initial?.hasDeepSeek ? "Replace key" : "Save key"}
          </button>
        </div>
      )}

      {/* Model selection (dynamic, provider-aware) */}
      {connected && (
        <>
          <hr className="div" />
          <div className="field" style={{ maxWidth: 420 }}>
            <div className="field-label">{modelLabel}</div>
            <select
              className="select"
              value={model}
              onChange={(e) => chooseModel(e.target.value)}
              onFocus={ensureModelsLoaded}
              disabled={pending || loadingModels}
            >
              <option value="">Project default ({modelDefault})</option>
              {model && models.length === 0 && <option value={model}>{model}</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.id})
                </option>
              ))}
            </select>
            <div className="field-help mono" style={{ fontSize: 11 }}>
              {loadingModels
                ? "loading models…"
                : `list is fetched live — new models appear automatically · default: ${modelDefault}`}
              {" · "}
              <button
                type="button"
                onClick={loadModels}
                style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, font: "inherit" }}
              >
                refresh
              </button>
            </div>
          </div>

          <hr className="div" />
          <div className="dash-card-sub" style={{ fontSize: 11.5 }}>
            {initial?.connectedByEmail ? `connected by ${initial.connectedByEmail} · ` : ""}
            <button
              type="button"
              onClick={disconnect}
              disabled={pending}
              style={{ background: "none", border: "none", color: "var(--err)", cursor: "pointer", padding: 0, font: "inherit", display: "inline-flex", gap: 4, alignItems: "center" }}
            >
              <Trash2 size={11} /> disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}
