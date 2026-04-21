"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { retryDraftAction, skipDraftAction } from "@/server/draft-actions";

type FailedDraft = {
  id: string;
  sourceTitle: string | null;
  updatedAt: string;
  errors: Array<{ platform: string; error: string }>;
};

export function FailedDrafts({ drafts }: { drafts: FailedDraft[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function retry(id: string) {
    startTransition(async () => {
      const res = await retryDraftAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Published.");
      router.refresh();
    });
  }

  function dismiss(id: string) {
    startTransition(async () => {
      const res = await skipDraftAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Dismissed.");
      router.refresh();
    });
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-destructive" />
          Failed posts ({drafts.length})
        </CardTitle>
        <CardDescription>
          These drafts didn't publish. Fix the underlying issue (reconnect an
          expired account, check your bot permissions, etc.) and retry.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {drafts.map((d) => (
          <div
            key={d.id}
            className="rounded-md border bg-background p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {d.sourceTitle ?? "Untitled draft"}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{new Date(d.updatedAt).toLocaleString()}</span>
                  {d.errors.map((e, i) => (
                    <Badge key={i} variant="destructive" className="font-normal">
                      {e.platform}: {e.error.slice(0, 100)}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex flex-none items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => retry(d.id)}
                >
                  <RefreshCw className="mr-1 size-3.5" />
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => dismiss(d.id)}
                  title="Dismiss"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
