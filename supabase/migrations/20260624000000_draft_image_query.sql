-- Persist the AI-built stock-photo search query on the Draft.
--
-- After writing a post, the model also returns a short, concrete "imageQuery"
-- describing a photographable subject for the post (far more on-subject than the
-- bare topic label). Storing it lets the editor's "re-pick photo" action search
-- with the same smart query the auto-pick used, instead of falling back to the
-- topic. Nullable: older drafts and ones generated before this column have none.
ALTER TABLE "Draft"
  ADD COLUMN IF NOT EXISTS "imageQuery" TEXT;
