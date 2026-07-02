import { useTransition } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Pause, Play, Zap } from "lucide-react";
import { toggleProjectStatusAction } from "@/server/settings-actions";
import { runNowAction } from "@/server/draft-actions";

export function PauseToggleBtn({
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
    <button
      type="button"
      className="btn ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await toggleProjectStatusAction({ data: projectId });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success(res.status === "ACTIVE" ? "Agent started" : "Agent paused");
          await router.invalidate();
        })
      }
    >
      {isActive ? <Pause size={12} /> : <Play size={12} />}
      <span>{pending ? "…" : isActive ? "Pause" : "Start"}</span>
    </button>
  );
}

export function GenerateNowBtn({ projectId }: { projectId: string }) {
  const router = useRouter();
  const navigate = useNavigate();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn primary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await runNowAction({ data: projectId });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          if ("skipped" in res && res.skipped) {
            toast.info(res.reason ?? "Nothing to do.");
            return;
          }
          toast.success(res.published ? "Posted!" : "Draft created — review in Drafts.");
          await router.invalidate();
          await navigate({ to: "/drafts" });
        })
      }
    >
      <Zap size={12} />
      <span>{pending ? "Generating…" : "Generate now"}</span>
      <span className="kbd">⌘ ⇧ G</span>
    </button>
  );
}
