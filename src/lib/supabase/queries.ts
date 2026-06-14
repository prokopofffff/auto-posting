// Shared data-access helpers for the recurring "include graphs" the old Prisma
// code leaned on, expressed as supabase-js nested selects. Keeping the select
// strings and their derived result types in one place means call sites in the
// pipeline, publish flow and project loader can't drift apart.
//
// `unwrap` is the throw-on-error wrapper: it awaits any supabase builder and
// returns `data`, throwing on `{ error }`. That lets call sites read like the
// old `await db.x.findUnique(...)` without `if (error) ...` boilerplate.
//
// JSON columns (contentByLang / contentByPlatform / voiceOverrides / meta) are
// plain `Json` here — pass objects or `null` straight through. There is no
// supabase-js analogue to `Prisma.JsonNull` / `Prisma.InputJsonValue`: a SQL
// `null` JSON value is just `null`.
import type {
  PostgrestSingleResponse,
  QueryData,
  SupabaseClient,
} from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type DB = SupabaseClient<Database>;

// --- error handling --------------------------------------------------------

/**
 * Await a supabase builder and return its `data`, throwing on `{ error }`.
 * Single-row reads done with `.maybeSingle()` resolve `data` to `T | null`;
 * `.single()` resolves to `T`. The non-null assertion is correct because we
 * only reach the return after confirming `error` is falsy.
 */
export async function unwrap<T>(
  query: PromiseLike<PostgrestSingleResponse<T>>,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Await a head/count request (`.select("*", { count: "exact", head: true })`)
 * and return the tally, throwing on `{ error }`. The count counterpart to
 * `unwrap()`: such requests carry the result on `count`, not `data`.
 */
export async function count(
  query: PromiseLike<PostgrestSingleResponse<unknown>>,
): Promise<number> {
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

// --- row normalization -----------------------------------------------------

/**
 * supabase-js returns Postgres `timestamp` columns as ISO strings. Components
 * and date math downstream want `Date` objects. `withDates` coerces the named
 * keys on every row in one place, so the conversion isn't re-spelled at each
 * call site (`rows.map((r) => ({ ...r, publishedAt: new Date(r.publishedAt) }))`).
 */
export function withDates<T, K extends keyof T>(
  rows: T[],
  ...keys: K[]
): Array<Omit<T, K> & Record<K, Date>> {
  return rows.map((row) => {
    const next = { ...row } as Record<string, unknown>;
    for (const key of keys) next[key as string] = new Date(row[key] as string);
    return next as Omit<T, K> & Record<K, Date>;
  });
}

// --- include graphs --------------------------------------------------------

// Project + its (1:1) settings + connected accounts. Used by the pipeline,
// the publish flow (indirectly, via Draft) and the project loader.
const PROJECT_GRAPH = "*, settings:ProjectSettings(*), connectedAccounts:ConnectedAccount(*)";

// Draft + its parent project, that project's settings and connected accounts.
// This is the graph publishDraft() walks.
const DRAFT_WITH_PROJECT_GRAPH =
  "*, project:Project(*, settings:ProjectSettings(*), connectedAccounts:ConnectedAccount(*))";

/**
 * Fetch one Project with settings + connectedAccounts by id, or `null`.
 * Mirrors the old `db.project.findUnique({ include: { settings, connectedAccounts } })`.
 */
export function selectProjectWithRelations(supabase: DB, projectId: string) {
  return supabase
    .from("Project")
    .select(PROJECT_GRAPH)
    .eq("id", projectId)
    .maybeSingle();
}

/**
 * Fetch one Draft with its project graph by id, or `null`.
 * Mirrors the old `db.draft.findUnique({ include: { project: { include: ... } } })`.
 */
export function selectDraftWithProject(supabase: DB, draftId: string) {
  return supabase
    .from("Draft")
    .select(DRAFT_WITH_PROJECT_GRAPH)
    .eq("id", draftId)
    .maybeSingle();
}

// Result types derived straight from the builders above so they can never drift
// from the select strings. `NonNullable` strips the `| null` that `.maybeSingle()`
// adds, giving the shape of a present row.
export type ProjectWithRelations = NonNullable<
  QueryData<ReturnType<typeof selectProjectWithRelations>>
>;
export type DraftWithProject = NonNullable<
  QueryData<ReturnType<typeof selectDraftWithProject>>
>;
