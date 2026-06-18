-- Post images: an optional photo attached to a draft and carried through to the
-- published post. Two sources feed "imageUrl":
--   1. Manual upload in Compose (stored in the public `post-images` bucket).
--   2. The generation pipeline auto-picking a stock photo (Pexels) by topic.
-- The publisher attaches it to LinkedIn (uploaded as a media URN) and Telegram
-- (sendPhoto). The column is nullable so text-only posts are unaffected.

ALTER TABLE "Draft" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;

-- Public bucket for compose uploads. Uploads go through the service-role client
-- (which bypasses RLS), and the URL must be publicly fetchable so LinkedIn's
-- image-upload step and Telegram's sendPhoto can read it. No per-user RLS is
-- needed because clients never touch this bucket directly.
INSERT INTO storage.buckets (id, name, public)
VALUES ('post-images', 'post-images', true)
ON CONFLICT (id) DO NOTHING;
