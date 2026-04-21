import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ExpiringConnection = {
  id: string;
  platform: "LINKEDIN" | "TELEGRAM";
  displayName: string | null;
  expiresAt: Date | null;
};

const WARN_DAYS = 14;

export function ExpiryBanner({
  projectId,
  connections,
}: {
  projectId: string;
  connections: ExpiringConnection[];
}) {
  const now = Date.now();
  const relevant = connections.filter((c) => {
    if (c.platform !== "LINKEDIN") return false;
    if (!c.expiresAt) return false;
    const days = (c.expiresAt.getTime() - now) / 86_400_000;
    return days < WARN_DAYS;
  });

  if (relevant.length === 0) return null;

  const mostUrgent = relevant.reduce((a, b) => {
    const ae = a.expiresAt!.getTime();
    const be = b.expiresAt!.getTime();
    return ae < be ? a : b;
  });
  const expMs = mostUrgent.expiresAt!.getTime();
  const expired = expMs < now;
  const daysLeft = Math.max(0, Math.round((expMs - now) / 86_400_000));

  return (
    <div
      className={`flex items-start gap-3 rounded-md border p-4 ${
        expired
          ? "border-destructive/40 bg-destructive/5"
          : "border-amber-400/40 bg-amber-500/5"
      }`}
    >
      <AlertTriangle
        className={`size-5 flex-none ${
          expired ? "text-destructive" : "text-amber-600 dark:text-amber-500"
        }`}
      />
      <div className="flex-1 text-sm">
        <div className="font-medium">
          {expired
            ? "Your LinkedIn connection has expired."
            : `LinkedIn connection expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`}
        </div>
        <p className="text-muted-foreground">
          {expired
            ? "Reconnect now — posts to LinkedIn will fail until you do."
            : "LinkedIn tokens last 60 days. Reconnect now to avoid an interruption."}
          {relevant.length > 1 ? ` (${relevant.length} connections affected)` : ""}
        </p>
      </div>
      <Button asChild size="sm" variant={expired ? "default" : "outline"}>
        <Link href={`/api/linkedin/authorize?projectId=${projectId}`}>
          {expired ? "Reconnect LinkedIn" : "Reconnect now"}
        </Link>
      </Button>
    </div>
  );
}
