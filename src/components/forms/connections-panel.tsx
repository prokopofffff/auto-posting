"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Share2, Send, Trash2 } from "lucide-react";
import {
  connectTelegramAction,
  disconnectAccountAction,
} from "@/server/connection-actions";

const CARD_TITLE_STYLE = { display: "flex", alignItems: "center", gap: 6 } as const;

export type ConnectedRow = {
  id: string;
  platform: "TELEGRAM" | "LINKEDIN";
  externalId: string;
  displayName: string | null;
  expiresAt: string | null;
};

export function ConnectionsPanel({
  projectId,
  connections,
}: {
  projectId: string;
  connections: ConnectedRow[];
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");

  useEffect(() => {
    if (search.get("li_ok")) {
      toast.success("LinkedIn connected.");
      const url = new URL(window.location.href);
      url.searchParams.delete("li_ok");
      window.history.replaceState({}, "", url.toString());
    }
    const err = search.get("li_error");
    if (err) {
      toast.error(`LinkedIn: ${err}`);
      const url = new URL(window.location.href);
      url.searchParams.delete("li_error");
      window.history.replaceState({}, "", url.toString());
    }
  }, [search]);

  function connectTelegram() {
    if (!botToken || !chatId) {
      toast.error("Bot token and chat ID are both required.");
      return;
    }
    startTransition(async () => {
      const res = await connectTelegramAction({ projectId, botToken, chatId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Connected ${res.botUsername ? `@${res.botUsername}` : "bot"}`);
      setBotToken("");
      setChatId("");
      router.refresh();
    });
  }

  function disconnect(id: string) {
    startTransition(async () => {
      const res = await disconnectAccountAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Disconnected");
      router.refresh();
    });
  }

  const telegramConns = connections.filter((c) => c.platform === "TELEGRAM");
  const linkedinConns = connections.filter((c) => c.platform === "LINKEDIN");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      {/* LinkedIn */}
      <div className="dash-card">
        <div className="dash-card-head">
          <h3 className="dash-card-title" style={CARD_TITLE_STYLE}>
            <Share2 size={14} /> LinkedIn
          </h3>
        </div>
        <div className="dash-card-body">
          <p className="field-help" style={{ marginBottom: 12 }}>
            Sign in with LinkedIn to allow posting to your personal feed. Tokens
            last 60 days; you&apos;ll get an in-app warning before they expire.
          </p>

          {linkedinConns.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {linkedinConns.map((c) => {
                const expMs = c.expiresAt ? new Date(c.expiresAt).getTime() : 0;
                const days = expMs
                  ? Math.max(0, Math.round((expMs - Date.now()) / 86_400_000))
                  : null;
                const expired = expMs > 0 && expMs < Date.now();
                return (
                  <div key={c.id} className="dash-row">
                    <span className="badge-pill">linkedin</span>
                    <span style={{ fontSize: 12.5 }}>{c.displayName ?? "Member"}</span>
                    {expired ? (
                      <span className="badge-pill err">expired — reconnect</span>
                    ) : days !== null && days < 14 ? (
                      <span className="badge-pill warn">expires in {days}d</span>
                    ) : null}
                    <button
                      type="button"
                      className="btn icon sm ghost danger right"
                      disabled={pending}
                      onClick={() => disconnect(c.id)}
                      title="Disconnect"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <a
            className={"btn" + (linkedinConns.length > 0 ? "" : " accent")}
            href={`/api/linkedin/authorize?projectId=${projectId}`}
          >
            {linkedinConns.length > 0 ? "Reconnect LinkedIn" : "Connect LinkedIn"}
          </a>
        </div>
      </div>

      {/* Telegram */}
      <div className="dash-card">
        <div className="dash-card-head">
          <h3 className="dash-card-title" style={CARD_TITLE_STYLE}>
            <Send size={14} /> Telegram
          </h3>
        </div>
        <div className="dash-card-body">
          <p className="field-help" style={{ marginBottom: 12 }}>
            Create a bot with{" "}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)", textDecoration: "underline" }}
            >
              @BotFather
            </a>
            , add it to your channel as admin, then paste the token and channel ID
            below.
          </p>

          {telegramConns.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {telegramConns.map((c) => (
                <div key={c.id} className="dash-row">
                  <span className="badge-pill">telegram</span>
                  <span style={{ fontSize: 12.5 }}>
                    {c.displayName ? `@${c.displayName}` : "Bot"} →{" "}
                    <span className="mono">{c.externalId}</span>
                  </span>
                  <button
                    type="button"
                    className="btn icon sm ghost danger right"
                    disabled={pending}
                    onClick={() => disconnect(c.id)}
                    title="Disconnect"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label" htmlFor="bot-token">
                bot token
              </label>
              <input
                className="input mono"
                id="bot-token"
                placeholder="123456:ABC-..."
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label" htmlFor="chat-id">
                channel / chat id
              </label>
              <input
                className="input mono"
                id="chat-id"
                placeholder="@my_channel or -1001234567890"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <button
            type="button"
            className="btn accent"
            onClick={connectTelegram}
            disabled={pending}
          >
            {pending ? "Connecting…" : "Connect & send test"}
          </button>
        </div>
      </div>
    </div>
  );
}
