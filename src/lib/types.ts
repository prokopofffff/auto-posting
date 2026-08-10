// Domain type barrel. Replaces the `@prisma/client` import that used to be the
// single source for enum names and row shapes. Everything here is derived from
// the generated `Database` type so it stays in lockstep with the SQL schema.
//
// Enums: supabase-js models Postgres enums as string-literal unions, so e.g.
// `Platform` is `"LINKEDIN" | "TELEGRAM"` rather than a TS enum object. Compare
// and assign with the raw string literals just as before.
import type { Database, Tables } from "@/lib/database.types";

type Enums = Database["public"]["Enums"];

export type Platform = Enums["Platform"];
export type DraftStatus = Enums["DraftStatus"];
export type FactVerdict = Enums["FactVerdict"];
export type PostMode = Enums["PostMode"];
export type VoiceMode = Enums["VoiceMode"];
export type ProjectStatus = Enums["ProjectStatus"];
export type OrgRole = Enums["OrgRole"];
export type Plan = Enums["Plan"];

// Plain row aliases for the cases that previously imported a Prisma model type
// (e.g. `ConnectedAccount`, `ProjectSettings`). These are the column shapes as
// returned by a `select('*')`; note timestamp columns are ISO strings, not Date.
export type ConnectedAccount = Tables<"ConnectedAccount">;
export type Draft = Tables<"Draft">;
export type Organization = Tables<"Organization">;
export type OrganizationMember = Tables<"OrganizationMember">;
export type Post = Tables<"Post">;
export type Project = Tables<"Project">;
export type ProjectSettings = Tables<"ProjectSettings">;
export type User = Tables<"User">;

/**
 * One Google Images result returned by the image search (Bright Data) — the
 * full-resolution image, Google's own hotlink-safe thumbnail (for preview and
 * as a re-host fallback), plus where it came from. Kept in sync with the edge
 * function's `ImageCandidate` (supabase/functions/tick/lib/image-search.ts).
 */
export type ImageCandidate = {
  url: string;
  thumbnail?: string;
  sourcePage: string;
  source: string;
};
