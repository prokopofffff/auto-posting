-- Add a second AI provider (DeepSeek) alongside Claude/Anthropic.
--
-- The AiCredential row stays 1:1 with a Project (one active credential at a
-- time), so we add a `provider` discriminator rather than a second table. A
-- project can keep BOTH an Anthropic credential (apiKey / OAuth pair) and a
-- DeepSeek key stored; `provider` selects which one the resolver actually uses.
--
-- DeepSeek is OpenAI-compatible (api.deepseek.com), API-key only — there is no
-- subscription/OAuth mode for it, so it reuses none of the oauth* columns.
-- `deepseekApiKey` holds AES-256-GCM ciphertext exactly like the other secrets.

-- ANTHROPIC: the existing Claude path (API_KEY or SUBSCRIPTION `mode`).
-- DEEPSEEK:  a DeepSeek platform API key, sent as Authorization: Bearer.
CREATE TYPE "AiProvider" AS ENUM ('ANTHROPIC', 'DEEPSEEK');

-- Default ANTHROPIC so every existing credential keeps its current behavior.
ALTER TABLE "AiCredential" ADD COLUMN "provider" "AiProvider" NOT NULL DEFAULT 'ANTHROPIC';

-- AES-256-GCM ciphertext (never plaintext), same as `apiKey`.
ALTER TABLE "AiCredential" ADD COLUMN "deepseekApiKey" TEXT;
