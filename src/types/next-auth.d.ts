// NextAuth's module augmentation is obsolete: auth now runs on Supabase Auth and
// the session shape lives in `Session` exported from `@/auth`. This file is kept
// (empty) only so nothing references a stale augmentation during the migration;
// it can be deleted once next-auth is removed from package.json (after
// madrid-9i8.7 ports the last `signIn`/`signOut` callers).
export {};
