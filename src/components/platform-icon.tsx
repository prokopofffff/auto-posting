import { Send, Share2 } from "lucide-react";

/** lucide-react 1.8.0 has no brand icons; Share2 stands in for LinkedIn, Send for Telegram. */
export function PlatformIcon({
  platform,
  size = 14,
}: {
  platform: "LINKEDIN" | "TELEGRAM";
  size?: number;
}) {
  return platform === "LINKEDIN" ? <Share2 size={size} /> : <Send size={size} />;
}
