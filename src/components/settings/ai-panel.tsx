"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Sparkles, Trash2, ExternalLink } from "lucide-react";
import {
  startClaudeLoginAction,
  connectClaudeSubscriptionAction,
  connectClaudeApiKeyAction,
  setAiModeAction,
  setAiModelAction,
  listClaudeModelsAction,
  disconnectAiCredentialAction,
} from "@/server/ai-credential-actions";

type Mode = "API_KEY" | "SUBSCRIPTION";

export type AiCredentialView = {
  mode: Mode;
  hasApiKey: boolean;
  hasSubscription: boolean;
  model: string | null;
  connectedByEmail: string | null;
  subscriptionExpiresAt: string | null;
};

export function AiPanel({
  projectId,
  initial,
}: {
  projectId: string;
  initial: AiCredentialView | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const connected = !!initial && (initial.hasApiKey || initial.hasSubscription);
  // The active (persisted) mode is whatever the server says — single source of
  // truth, derived from props. `view` is purely which form the user is looking
  // at; it starts on the active mode but can wander (e.g. to connect the other).
  const activeMode: Mode | null = connected ? initial!.mode : null;
  const [view, setView] = useState<Mode>(initial?.mode ?? "API_KEY");

  // API key
  const [apiKey, setApiKey] = useState("");

  // Subscription PKCE round-trip (verifier/state held client-side per PKCE)
  const [pkce, setPkce] = useState<{ verifier: string; state: string } | null>(null);
  const [code, setCode] = useState("");

  // Models (loaded live from the connected credential)
  const [models, setModels] = useState<{ id: string; displayName: string }[]>([]);
  // Empty string = no explicit choice → the edge resolver applies the project
  // default (Haiku). The default model id lives only in the resolver, not here.
  const [model, setModel] = useState<string>(initial?.model ?? "");
  const [loadingModels, setLoadingModels] = useState(false);

  function loadModels() {
    if (!connected) return;
    setLoadingModels(true);
    startTransition(async () => {
      const res = await listClaudeModelsAction(projectId);
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

  function selectView(next: Mode) {
    setView(next);
    // If that credential exists and isn't already active, make it the active
    // one. Otherwise this is just navigating to its connect form.
    const can = next === "API_KEY" ? initial?.hasApiKey : initial?.hasSubscription;
    if (!can || next === activeMode) return;
    startTransition(async () => {
      const res = await setAiModeAction(projectId, next);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Using ${next === "API_KEY" ? "API key" : "subscription"}.`);
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
      router.refresh();
    });
  }

  function beginSubscriptionLogin() {
    startTransition(async () => {
      const res = await startClaudeLoginAction(projectId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setPkce({ verifier: res.verifier, state: res.state });
      window.open(res.url, "_blank", "noopener,noreferrer");
      toast.info("Approve in the new tab, then paste the code below.");
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
    if (!window.confirm("Disconnect Claude for this project? Auto-posting will stop until you reconnect.")) {
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

  // Per-mode status pill: the active credential reads "in use", a connected but
  // inactive one reads "connected", an unconnected one shows nothing.
  function statusPill(m: Mode, hasIt: boolean | undefined) {
    if (!hasIt) return null;
    return m === activeMode ? (
      <span className="badge-pill accent">in use</span>
    ) : (
      <span className="badge-pill">connected</span>
    );
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div
        className="dash-card"
        style={{ borderColor: "rgba(217,119,87,0.3)", marginBottom: 16 }}
      >
        <div className="dash-card-sub" style={{ padding: 12 }}>
          <strong>For testing.</strong> Connect this project&apos;s own Claude credential — an
          Anthropic API key, or your Claude Max subscription via login-with-code. It is stored
          encrypted and used only for this project; it is never shared with other users or
          projects.
        </div>
      </div>

      {/* Mode */}
      <div className="field">
        <div className="field-label">credential type</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div
            className={"radio-card" + (view === "API_KEY" ? " on" : "")}
            onClick={() => selectView("API_KEY")}
            role="button"
            tabIndex={0}
          >
            <div className="dot" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, display: "flex", gap: 6, alignItems: "center" }}>
                <KeyRound size={13} /> API key
                {statusPill("API_KEY", initial?.hasApiKey)}
              </div>
              <div className="mono muted-2" style={{ fontSize: 11.5, marginTop: 2 }}>
                a console.anthropic.com key · billed to your Anthropic account
              </div>
            </div>
          </div>
          <div
            className={"radio-card" + (view === "SUBSCRIPTION" ? " on" : "")}
            onClick={() => selectView("SUBSCRIPTION")}
            role="button"
            tabIndex={0}
          >
            <div className="dot" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, display: "flex", gap: 6, alignItems: "center" }}>
                <Sparkles size={13} /> Claude Max subscription
                {statusPill("SUBSCRIPTION", initial?.hasSubscription)}
              </div>
              <div className="mono muted-2" style={{ fontSize: 11.5, marginTop: 2 }}>
                login with code · for tests
              </div>
            </div>
          </div>
        </div>
      </div>

      <hr className="div" />

      {/* API key mode */}
      {view === "API_KEY" && (
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

      {/* Subscription mode */}
      {view === "SUBSCRIPTION" && (
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

      {/* Model selection (dynamic) */}
      {connected && (
        <>
          <hr className="div" />
          <div className="field" style={{ maxWidth: 420 }}>
            <div className="field-label">claude model</div>
            <select
              className="select"
              value={model}
              onChange={(e) => chooseModel(e.target.value)}
              onFocus={ensureModelsLoaded}
              disabled={pending || loadingModels}
            >
              <option value="">Project default (Haiku)</option>
              {/* Keep a saved custom model selectable even before the list loads. */}
              {model && models.length === 0 && <option value={model}>{model}</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.id})
                </option>
              ))}
            </select>
            <div className="field-help mono" style={{ fontSize: 11 }}>
              {loadingModels ? "loading models…" : "list is fetched live — new models appear automatically · default: Haiku"}
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
