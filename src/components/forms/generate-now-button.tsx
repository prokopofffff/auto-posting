"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runNowAction } from "@/server/draft-actions";
import { Sparkles } from "lucide-react";

export function GenerateNowButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await runNowAction(projectId);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          if ("skipped" in res && res.skipped) {
            toast.info(res.reason ?? "Nothing to do.");
            return;
          }
          toast.success(res.published ? "Posted!" : "Draft created — review in Drafts.");
          router.push("/drafts");
          router.refresh();
        })
      }
    >
      <Sparkles className="mr-1.5 size-4" />
      {pending ? "Generating..." : "Generate now"}
    </Button>
  );
}
