import { supabaseAdmin } from "@/lib/supabase/service";

// Shared image-upload helper for the public `post-images` bucket, used by both
// the compose form and the draft editor. Objects are namespaced by project.
const UPLOAD_BUCKET = "post-images";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type UploadImageResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Validate and upload an image to the `post-images` bucket, namespaced under
 * `projectId`, and return its public URL. Goes through the service-role client
 * (bypasses RLS) — the caller MUST verify the user owns `projectId` first.
 */
export async function uploadProjectImage(
  projectId: string,
  file: unknown,
): Promise<UploadImageResult> {
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file provided." };
  }
  const ext = ALLOWED_IMAGE_TYPES[file.type];
  if (!ext) return { ok: false, error: "Use a PNG, JPEG, WebP, or GIF image." };
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "Image must be 8MB or smaller." };
  }

  const path = `${projectId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseAdmin.storage
    .from(UPLOAD_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: `Upload failed: ${error.message}` };

  const { data } = supabaseAdmin.storage.from(UPLOAD_BUCKET).getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
