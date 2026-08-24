// One-off cleanup for drafts and posts that were given a placeholder card
// instead of a photo.
//
// Background: Bright Data's Google-Images search intermittently returns an
// SEO-spam result set whose images are Cloudinary "This site does not have
// permission to access or serve this content" cards. The pipeline re-hosted the
// first hit unconditionally, so that card became the post picture. Generation
// now resamples past those result sets and refuses the card by content hash
// (supabase/functions/tick/lib/image-quality.ts) — but rows written before the
// fix still point at a re-hosted copy. This clears those references.
//
// Safety:
//   - Dry run by default: prints what WOULD be cleared, changes nothing.
//   - Only clears rows whose stored image hashes to a known placeholder, so a
//     real photo can never be affected.
//   - Leaves the re-hosted objects in the `post-images` bucket (a few dozen KB
//     each) rather than issuing storage deletes.
//   - Published posts stay published; only the stored image reference is
//     cleared, which affects the record, not anything already on LinkedIn.
//
// Usage (needs the same env the app server uses):
//   VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/clear-placeholder-images.mjs           # preview
//   ... node scripts/clear-placeholder-images.mjs --apply # clear them
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

// Keep in sync with KNOWN_PLACEHOLDERS in src/lib/image-quality.ts.
const KNOWN_PLACEHOLDERS = new Set([
  "d79977a1dc131f2335102ac01af9bf255005de4e379a3dfeeb00ee898856eae5",
]);

const APPLY = process.argv.includes("--apply");
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

/** null when the image can't be read — we leave rows we can't judge alone. */
async function hashOf(imageUrl) {
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

async function sweep(table) {
  const { data, error } = await db.from(table).select("id, imageUrl").not("imageUrl", "is", null);
  if (error) throw error;
  console.log(`\n${table}: ${data.length} row(s) with an image`);

  // Many rows share one URL only if a photo was reused; hash each distinct URL
  // once so a big backlog doesn't re-download the same bytes dozens of times.
  const verdict = new Map();
  for (const url of new Set(data.map((r) => r.imageUrl))) {
    const hash = await hashOf(url);
    verdict.set(url, hash !== null && KNOWN_PLACEHOLDERS.has(hash));
  }

  const bad = data.filter((r) => verdict.get(r.imageUrl));
  for (const row of bad) console.log(`  placeholder: ${table} ${row.id} -> ${row.imageUrl}`);
  if (bad.length === 0) {
    console.log("  nothing to clear");
    return 0;
  }
  if (!APPLY) {
    console.log(`  ${bad.length} row(s) would be cleared (re-run with --apply)`);
    return bad.length;
  }
  const { error: updateError } = await db
    .from(table)
    .update({ imageUrl: null })
    .in("id", bad.map((r) => r.id));
  if (updateError) throw updateError;
  console.log(`  cleared ${bad.length} row(s)`);
  return bad.length;
}

const total = (await sweep("Draft")) + (await sweep("Post"));
console.log(
  APPLY
    ? `\nDone — cleared ${total} row(s). Re-run "Find images" on the affected drafts.`
    : `\nDry run — ${total} row(s) affected. Re-run with --apply to clear them.`,
);
