"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  approveDraftAction,
  runNowAction,
  skipDraftAction,
  updateDraftContentAction,
} from "@/server/draft-actions";

type Draft = {
  id: string;
  topic: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  targets: string[];
  createdAt: string;
  contentByLang: Record<string, string>;
  status: string;
};

export function DraftList({
  projectId,
  drafts,
  hasConnection,
}: {
  projectId: string;
  drafts: Draft[];
  hasConnection: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});

  function getContent(d: Draft): Record<string, string> {
    return edits[d.id] ?? d.contentByLang;
  }

  function setLang(id: string, lang: string, text: string) {
    setEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? drafts.find((d) => d.id === id)?.contentByLang ?? {}), [lang]: text },
    }));
  }

  function runNow() {
    startTransition(async () => {
      const res = await runNowAction(projectId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if ("skipped" in res && res.skipped) {
        toast.info(res.reason ?? "Nothing to do.");
      } else {
        toast.success(res.published ? "Posted!" : "Draft created.");
      }
      router.refresh();
    });
  }

  function approve(id: string) {
    const content = getContent(drafts.find((d) => d.id === id)!);
    startTransition(async () => {
      const upd = await updateDraftContentAction(id, content);
      if (!upd.ok) {
        toast.error(upd.error);
        return;
      }
      const res = await approveDraftAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Published.");
      router.refresh();
    });
  }

  function skip(id: string) {
    startTransition(async () => {
      const res = await skipDraftAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Skipped.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {hasConnection
            ? drafts.length > 0
              ? `${drafts.length} draft${drafts.length === 1 ? "" : "s"} waiting for approval.`
              : "No pending drafts — hit Generate now for a fresh one."
            : "Connect an account first (Settings), then generate."}
        </p>
        <Button onClick={runNow} disabled={pending || !hasConnection}>
          {pending ? "Running..." : "Generate now"}
        </Button>
      </div>

      {drafts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {hasConnection ? "No pending drafts" : "Nothing to do yet"}
            </CardTitle>
            <CardDescription>
              {hasConnection ? (
                'Click "Generate now" to fetch fresh news and draft a post.'
              ) : (
                <>
                  Head to{" "}
                  <Link href="/settings" className="underline">
                    Settings
                  </Link>{" "}
                  and connect Telegram or LinkedIn, then come back here.
                </>
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        drafts.map((d) => {
          const langs = Object.keys(getContent(d));
          return (
            <Card key={d.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle className="text-base">
                      {d.sourceTitle ?? "Draft"}
                    </CardTitle>
                    <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{d.topic}</Badge>
                      {d.targets.map((t) => (
                        <Badge key={t} variant="outline">
                          {t}
                        </Badge>
                      ))}
                      <span className="text-xs">
                        {new Date(d.createdAt).toLocaleString()}
                      </span>
                      {d.sourceUrl ? (
                        <a
                          className="text-xs underline"
                          href={d.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          source ↗
                        </a>
                      ) : null}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue={langs[0] ?? "en"}>
                  <TabsList>
                    {langs.map((l) => (
                      <TabsTrigger key={l} value={l}>
                        {l.toUpperCase()}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {langs.map((l) => (
                    <TabsContent key={l} value={l}>
                      <Textarea
                        rows={8}
                        value={getContent(d)[l] ?? ""}
                        onChange={(e) => setLang(d.id, l, e.target.value)}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        {getContent(d)[l]?.length ?? 0} chars
                      </p>
                    </TabsContent>
                  ))}
                </Tabs>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <Button variant="ghost" disabled={pending} onClick={() => skip(d.id)}>
                    Skip
                  </Button>
                  <Button disabled={pending} onClick={() => approve(d.id)}>
                    Approve &amp; publish
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
