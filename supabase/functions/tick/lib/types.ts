// Domain type barrel for the Edge Function. Mirrors src/lib/types.ts but with a
// relative import for the generated Database type (no `@/` alias under Deno).
import type { Database, Tables } from "./database.types.ts";

type Enums = Database["public"]["Enums"];

export type Platform = Enums["Platform"];
export type DraftStatus = Enums["DraftStatus"];
export type FactVerdict = Enums["FactVerdict"];
export type PostMode = Enums["PostMode"];
export type VoiceMode = Enums["VoiceMode"];
export type ProjectStatus = Enums["ProjectStatus"];

export type ConnectedAccount = Tables<"ConnectedAccount">;
export type Draft = Tables<"Draft">;
export type Post = Tables<"Post">;
export type Project = Tables<"Project">;
export type ProjectSettings = Tables<"ProjectSettings">;
