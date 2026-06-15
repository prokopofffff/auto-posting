// Service-role supabase-js client + shared "include graph" selects for the Edge
// Function. Ports src/lib/supabase/service.ts and src/lib/supabase/queries.ts to
// the Deno runtime: env comes from Deno.env, and there is no dev-mode global
// singleton (each isolate is short-lived). The select strings and derived result
// types are kept identical to the app so the two can't drift.
import {
  createClient,
  type PostgrestSingleResponse,
  type QueryData,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.108.1";
import type { Database } from "./database.types.ts";

export type DB = SupabaseClient<Database>;

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically into every
// Supabase Edge Function — no need to set them as function secrets.
export const supabaseAdmin: DB = createClient<Database>(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** Await a supabase builder and return its `data`, throwing on `{ error }`. */
export async function unwrap<T>(
  query: PromiseLike<PostgrestSingleResponse<T>>,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

const PROJECT_GRAPH =
  "*, settings:ProjectSettings(*), connectedAccounts:ConnectedAccount(*)";

const DRAFT_WITH_PROJECT_GRAPH =
  "*, project:Project(*, settings:ProjectSettings(*), connectedAccounts:ConnectedAccount(*))";

export function selectProjectWithRelations(supabase: DB, projectId: string) {
  return supabase
    .from("Project")
    .select(PROJECT_GRAPH)
    .eq("id", projectId)
    .maybeSingle();
}

export function selectDraftWithProject(supabase: DB, draftId: string) {
  return supabase
    .from("Draft")
    .select(DRAFT_WITH_PROJECT_GRAPH)
    .eq("id", draftId)
    .maybeSingle();
}

export type ProjectWithRelations = NonNullable<
  QueryData<ReturnType<typeof selectProjectWithRelations>>
>;
export type DraftWithProject = NonNullable<
  QueryData<ReturnType<typeof selectDraftWithProject>>
>;
