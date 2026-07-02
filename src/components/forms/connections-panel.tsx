import { useEffect, useState, useTransition } from "react";
import { useRouter, useNavigate, getRouteApi } from "@tanstack/react-router";
import { toast } from "sonner";
import { Share2, Send, Trash2 } from "lucide-react";
import {
  connectTelegramAction,
  disconnectAccountAction,
} from "@/server/connection-actions";
import { daysUntil } from "@/lib/format";

const CARD_TITLE_STYLE = { display: "flex", alignItems: "center", gap: 6 } as const;

// ConnectionsPanel renders only inside the /settings route, which validates the
// `?li_ok` / `?li_error` params set by the LinkedIn OAuth callback. Reading them
// through the route api keeps them typed (replacing next's useSearchParams()).
const settingsRoute = getRouteApi("/(app)/settings");

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
  const navigate = useNavigate();
  const search = settingsRoute.useSearch();
  const [pending, startTransition] = useTransition();
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  // Snapshot "now" once at mount — the expiry badges show day-granularity, so a
  // fixed reference is fine and keeps render pure (no Date.now() during render).
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!search.li_ok && !search.li_error) return;
    if (search.li_ok) toast.success("LinkedIn connected.");
    if (search.li_error) toast.error(`LinkedIn: ${search.li_error}`);
    // Strip the one-shot params so a reload/back doesn't re-toast, mirroring the
    // old history.replaceState(). `replace: true` keeps it out of the history.
    void navigate({
      to: "/settings",
      search: { li_ok: undefined, li_error: undefined },
      replace: true,
    });
  }, [search.li_ok, search.li_error, navigate]);

  function connectTelegram() {
    if (!botToken || !chatId) {
      toast.error("Bot token and chat ID are both required.");
      return;
    }
    startTransition(async () => {
      const res = await connectTelegramAction({ data: { projectId, botToken, chatId } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Connected ${res.botUsername ? `@${res.botUsername}` : "bot"}`);
      setBotToken("");
      setChatId("");
      await router.invalidate();
    });
  }

  function disconnect(id: string) {
    startTransition(async () => {
      const res = await disconnectAccountAction({ data: id });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Disconnected");
      await router.invalidate();
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
                const exp = c.expiresAt ? new Date(c.expiresAt) : null;
                const days = exp ? daysUntil(exp, now) : null;
                const expired = exp ? exp.getTime() < now : false;
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
