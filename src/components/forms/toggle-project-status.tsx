"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toggleProjectStatusAction } from "@/server/settings-actions";

export function ToggleProjectStatus({
  projectId,
  status,
}: {
  projectId: string;
  status: "ACTIVE" | "PAUSED";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isActive = status === "ACTIVE";

  return (
    <Button
      variant={isActive ? "outline" : "default"}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await toggleProjectStatusAction(projectId);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success(res.status === "ACTIVE" ? "Agent started" : "Agent paused");
          router.refresh();
        })
      }
    >
      {pending ? "..." : isActive ? "Pause" : "Start agent"}
    </Button>
  );
}
