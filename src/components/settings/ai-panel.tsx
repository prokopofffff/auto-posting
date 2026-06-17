"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Sparkles, Trash2, ExternalLink, Brain } from "lucide-react";
import {
  startClaudeLoginAction,
  connectClaudeSubscriptionAction,
  connectClaudeApiKeyAction,
  connectDeepSeekApiKeyAction,
  setAiCredentialAction,
  setAiModelAction,
  listAiModelsAction,
  disconnectAiCredentialAction,
  type AiCredentialKind,
} from "@/server/ai-credential-actions";

type Provider = "ANTHROPIC" | "DEEPSEEK";

export type AiCredentialView = {
  provider: Provider;
  mode: "API_KEY" | "SUBSCRIPTION";
  hasApiKey: boolean;
  hasSubscription: boolean;
  hasDeepSeek: boolean;
  model: string | null;
  connectedByEmail: string | null;
  subscriptionExpiresAt: string | null;
};

// The three things a project can generate with. (provider, mode) lives on the
// server; the UI works in these flatter "kinds".
type Kind = AiCredentialKind;

function providerOf(kind: Kind): Provider {
  return kind === "DEEPSEEK" ? "DEEPSEEK" : "ANTHROPIC";
}

// Which kind is actually persisted as active, given the credential view.
function deriveActiveKind(v: AiCredentialView | null): Kind | null {
  if (!v) return null;
  if (v.provider === "DEEPSEEK") return v.hasDeepSeek ? "DEEPSEEK" : null;
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
    !!initial && (initial.hasApiKey || initial.hasSubscription || initial.hasDeepSeek);
  // The active (persisted) kind is whatever the server says — single source of
  // truth, derived from props. `view` is purely which form the user is looking
  // at; it starts on the active kind but can wander (e.g. to connect another).
  const activeKind = deriveActiveKind(initial);
  const [view, setView] = useState<Kind>(activeKind ?? "CLAUDE_API_KEY");

  // Secrets
  const [apiKey, setApiKey] = useState("");
  const [deepseekKey, setDeepseekKey] = useState("");

  // Subscription PKCE round-trip (verifier/state held client-side per PKCE)
  const [pkce, setPkce] = useState<{ verifier: string; state: string } | null>(null);
  const [code, setCode] = useState("");
  // Fallback authorize URL, surfaced as a manual link if the popup is blocked.
  const [loginUrl, setLoginUrl] = useState<string | null>(null);

  // Models (loaded live from the connected credential)
  const [models, setModels] = useState<{ id: string; displayName: string }[]>([]);
  // Empty string = no explicit choice → the edge resolver applies the provider
  // default. The default model id lives only in the resolver, not here.
  const [model, setModel] = useState<string>(initial?.model ?? "");
  const [loadingModels, setLoadingModels] = useState(false);

  // After a connect/switch that changes provider, the stored model no longer
  // applies — drop the local selection so the picker shows the new default.
  // Always clear the cached list so it reloads for the (possibly new) provider.
  function resetModelForProvider(target: Provider) {
    if (initial?.provider !== target) setModel("");
    setModels([]);
  }

  function loadModels() {
    if (!connected) return;
    setLoadingModels(true);
    startTransition(async () => {
      const res = await listAiModelsAction(projectId);
      setLoadingModels(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setModels(res.models);
      if (!res.live) toast.info("Showing a fallback list — couldn't query models for this credential.");
    });
  }

  // Load the live model menu the first time the user opens the dropdown.
  function ensureModelsLoaded() {
    if (connected && models.length === 0 && !loadingModels) loadModels();
  }

  function selectView(next: Kind) {
    setView(next);
    // Does that credential already exist? If so and it isn't active, make it the
    // active one. Otherwise this is just navigating to its connect form.
    const can =
      next === "CLAUDE_API_KEY"
        ? initial?.hasApiKey
        : next === "CLAUDE_SUBSCRIPTION"
        ? initial?.hasSubscription
        : initial?.hasDeepSeek;
    if (!can || next === activeKind) return;
    startTransition(async () => {
      const res = await setAiCredentialAction(projectId, next);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const label =
        next === "DEEPSEEK"
          ? "DeepSeek"
          : next === "CLAUDE_API_KEY"
          ? "Claude API key"
          : "Claude subscription";
      toast.success(`Using ${label}.`);
      resetModelForProvider(providerOf(next));
      router.refresh();
    });
  }

  function saveApiKey() {
    if (!apiKey.trim()) {
      toast.error("Paste an API key first.");
      return;
    }
    startTransition(async () => {
      const res = await connectClaudeApiKeyAction({ projectId, apiKey });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("API key saved.");
      setApiKey("");
      resetModelForProvider("ANTHROPIC");
      router.refresh();
    });
  }

  function saveDeepseekKey() {
    if (!deepseekKey.trim()) {
      toast.error("Paste an API key first.");
      return;
    }
    startTransition(async () => {
      const res = await connectDeepSeekApiKeyAction({ projectId, apiKey: deepseekKey });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("DeepSeek API key saved.");
      setDeepseekKey("");
      resetModelForProvider("DEEPSEEK");
      router.refresh();
    });
  }

  function beginSubscriptionLogin() {
    // Open the tab synchronously, while we still hold the click's user
    // activation. If we waited for the server round-trip below to finish before
    // calling window.open(), the browser would treat it as a programmatic popup
    // and silently block it — which looked like "nothing happens, no redirect".
    // (No "noopener" here so we keep the handle to point it at the real URL;
    // we null the opener ourselves once the trusted destination is set.)
    const popup = window.open("about:blank", "_blank");
    startTransition(async () => {
      const res = await startClaudeLoginAction(projectId);
      if (!res.ok) {
        popup?.close();
        toast.error(res.error);
        return;
      }
      setPkce({ verifier: res.verifier, state: res.state });
      if (popup && !popup.closed) {
        try {
          popup.opener = null;
        } catch {
          // cross-origin once navigated; best-effort only
        }
        popup.location.replace(res.url);
        setLoginUrl(null);
        toast.info("Approve in the new tab, then paste the code below.");
      } else {
        // Popup blocked despite the synchronous open — keep the verifier/state
        // alive and offer a manual link instead of dropping the flow.
        setLoginUrl(res.url);
        toast.info("Popup blocked — use the “Open Claude login” link below.");
      }
    });
  }

  function completeSubscriptionLogin() {
    if (!pkce) {
      toast.error("Start the connect flow first.");
      return;
    }
    if (!code.trim()) {
      toast.error("Paste the code Claude showed you.");
      return;
    }
    startTransition(async () => {
      const res = await connectClaudeSubscriptionAction({
        projectId,
        code,
        verifier: pkce.verifier,
        state: pkce.state,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Claude Max subscription connected.");
      setCode("");
      setPkce(null);
      setLoginUrl(null);
      resetModelForProvider("ANTHROPIC");
      router.refresh();
    });
  }

  function chooseModel(next: string) {
    setModel(next);
    if (!next) return; // "Project default" sentinel — nothing to persist
    startTransition(async () => {
      const res = await setAiModelAction({ projectId, model: next });
      if (!res.ok) toast.error(res.error);
      else toast.success("Model updated.");
    });
  }

  function disconnect() {
    if (!window.confirm("Disconnect AI for this project? Auto-posting will stop until you reconnect.")) {
      return;
    }
    startTransition(async () => {
      const res = await disconnectAiCredentialAction(projectId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Disconnected.");
      router.refresh();
    });
  }

  const expiryNote = initial?.subscriptionExpiresAt
    ? new Date(initial.subscriptionExpiresAt).toLocaleString()
    : null;

  // Per-kind status pill: the active credential reads "in use", a connected but
  // inactive one reads "connected", an unconnected one shows nothing.
  function statusPill(kind: Kind, hasIt: boolean | undefined) {
    if (!hasIt) return null;
    return kind === activeKind ? (
      <span className="badge-pill accent">in use</span>
    ) : (
      <span className="badge-pill">connected</span>
    );
  }

  const onDeepSeek = activeKind === "DEEPSEEK";

  return (
    <div style={{ maxWidth: 760 }}>
      <div
        className="dash-card"
        style={{ borderColor: "var(--accent-bg)", marginBottom: 16 }}
      >
        <div className="dash-card-sub" style={{ padding: 12 }}>
          <strong>For testing.</strong> Connect this project&apos;s own model credential — an
          Anthropic (Claude) API key, your Claude Max subscription via login-with-code, or a
          DeepSeek API key. It is stored encrypted and used only for this project; it is never
          shared with other users or projects.
        </div>
      </div>

      {/* Credential type */}
      <div className="field">
        <div className="field-label">credential type</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
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
            className={"radio-card" + (view === "CLAUDE_SUBSCRIPTION" ? " on" : "")}
            onClick={() => selectView("CLAUDE_SUBSCRIPTION")}
            role="button"
            tabIndex={0}
          >
            <div className="dot" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, display: "flex", gap: 6, alignItems: "center" }}>
                <Sparkles size={13} /> Claude Max
                {statusPill("CLAUDE_SUBSCRIPTION", initial?.hasSubscription)}
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

      {/* Claude Max subscription */}
      {view === "CLAUDE_SUBSCRIPTION" && (
        <div className="field">
          <div className="field-label">claude max — login with code</div>
          {initial?.hasSubscription && !pkce && (
            <div className="field-help" style={{ marginBottom: 8 }}>
              Connected{expiryNote ? ` · token refreshes automatically (expires ${expiryNote})` : ""}.
            </div>
          )}
          <ol className="field-help" style={{ paddingLeft: 18, marginBottom: 8, lineHeight: 1.7 }}>
            <li>Click <strong>Open Claude login</strong> — approve in the new tab.</li>
            <li>Copy the code Claude shows (looks like <span className="mono">code#state</span>).</li>
            <li>Paste it below and click <strong>Complete</strong>.</li>
          </ol>
          <button
            type="button"
            className="btn"
            onClick={beginSubscriptionLogin}
            disabled={pending}
            style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
          >
            <ExternalLink size={13} /> Open Claude login
          </button>
          {loginUrl && (
            <div className="field-help" style={{ marginTop: 8 }}>
              Popup blocked.{" "}
              <a
                href={loginUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)", textDecoration: "underline" }}
              >
                Open Claude login manually
              </a>
              .
            </div>
          )}
          {pkce && (
            <div style={{ marginTop: 10 }}>
              <input
                className="input mono"
                placeholder="paste code#state here"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
              />
              <button
                type="button"
                className="btn primary"
                onClick={completeSubscriptionLogin}
                disabled={pending}
                style={{ marginTop: 8 }}
              >
                {pending ? "Connecting…" : "Complete"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Model selection (dynamic, provider-aware) */}
      {connected && (
        <>
          <hr className="div" />
          <div className="field" style={{ maxWidth: 420 }}>
            <div className="field-label">{onDeepSeek ? "deepseek model" : "claude model"}</div>
            <select
              className="select"
              value={model}
              onChange={(e) => chooseModel(e.target.value)}
              onFocus={ensureModelsLoaded}
              disabled={pending || loadingModels}
            >
              <option value="">
                {onDeepSeek ? "Project default (deepseek-chat)" : "Project default (Haiku)"}
              </option>
              {/* Keep a saved custom model selectable even before the list loads. */}
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
                : `list is fetched live — new models appear automatically · default: ${onDeepSeek ? "deepseek-chat" : "Haiku"}`}
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
