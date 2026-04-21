"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Share2, Send, Trash2 } from "lucide-react";
import {
  connectTelegramAction,
  disconnectAccountAction,
} from "@/server/connection-actions";

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
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Share2 className="size-4" />
            LinkedIn
          </CardTitle>
          <CardDescription>
            Sign in with LinkedIn to allow posting to your personal feed. Tokens
            last 60 days; you'll get an in-app warning before they expire.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {linkedinConns.length > 0 && (
            <div className="space-y-2">
              {linkedinConns.map((c) => {
                const expMs = c.expiresAt ? new Date(c.expiresAt).getTime() : 0;
                const days = expMs
                  ? Math.max(0, Math.round((expMs - Date.now()) / 86_400_000))
                  : null;
                const expired = expMs > 0 && expMs < Date.now();
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-md border bg-background p-3"
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant={expired ? "destructive" : "secondary"}>
                        LinkedIn
                      </Badge>
                      <span className="text-sm">
                        {c.displayName ?? "Member"}
                      </span>
                      {expired ? (
                        <Badge variant="destructive">Expired — reconnect</Badge>
                      ) : days !== null && days < 14 ? (
                        <Badge variant="outline">Expires in {days}d</Badge>
                      ) : null}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => disconnect(c.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
          <Button asChild variant={linkedinConns.length > 0 ? "outline" : "default"}>
            <a href={`/api/linkedin/authorize?projectId=${projectId}`}>
              {linkedinConns.length > 0 ? "Reconnect LinkedIn" : "Connect LinkedIn"}
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="size-4" />
            Telegram
          </CardTitle>
          <CardDescription>
            Create a bot with{" "}
            <a
              className="underline"
              href="https://t.me/BotFather"
              target="_blank"
              rel="noreferrer"
            >
              @BotFather
            </a>
            , add it to your channel as admin, then paste the token and channel
            ID below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {telegramConns.length > 0 && (
            <div className="space-y-2">
              {telegramConns.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-md border bg-background p-3"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary">Telegram</Badge>
                    <span className="text-sm">
                      {c.displayName ? `@${c.displayName}` : "Bot"} →{" "}
                      <span className="font-mono">{c.externalId}</span>
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => disconnect(c.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bot-token">Bot token</Label>
              <Input
                id="bot-token"
                placeholder="123456:ABC-..."
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="chat-id">Channel / chat ID</Label>
              <Input
                id="chat-id"
                placeholder="@my_channel or -1001234567890"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <Button onClick={connectTelegram} disabled={pending}>
            {pending ? "Connecting..." : "Connect & send test"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
