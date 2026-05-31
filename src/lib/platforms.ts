// Single source of truth for platform posting limits (chars).
export const PLATFORM_LIMITS: Record<"LINKEDIN" | "TELEGRAM", number> = {
  LINKEDIN: 3000,
  TELEGRAM: 4096,
};
