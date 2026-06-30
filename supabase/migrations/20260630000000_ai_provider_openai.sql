-- Add OpenAI as a third AI provider, in two modes:
--   API_KEY      → a platform.openai.com key, used against api.openai.com.
--   SUBSCRIPTION → a ChatGPT/Codex subscription, connected via the same PKCE
--                  "login with code" flow Codex CLI uses (src/lib/codex-oauth.ts).
--                  Subscription tokens do NOT work on api.openai.com — generation
--                  goes through chatgpt.com/backend-api/codex (Responses API) and
--                  requires the ChatGPT account id as a header on every request.
--
-- Column conventions match the existing providers:
--   openaiApiKey             AES-256-GCM ciphertext, like `apiKey` and `deepseekApiKey`.
--   codexOauthAccessToken    Encrypted OAuth access token, like `oauthAccessToken`.
--   codexOauthRefreshToken   Encrypted refresh token.
--   codexOauthExpiresAt      Token expiry for the refresh-skew logic in the edge resolver.
--   codexAccountId           ChatGPT account id (the `chatgpt_account_id` JWT claim),
--                            sent as the `ChatGPT-Account-Id` header. Not a secret on
--                            its own, so stored plaintext (like the Codex CLI auth.json).

ALTER TYPE "AiProvider" ADD VALUE IF NOT EXISTS 'OPENAI';

ALTER TABLE "AiCredential"
  ADD COLUMN IF NOT EXISTS "openaiApiKey"          TEXT,
  ADD COLUMN IF NOT EXISTS "codexOauthAccessToken"  TEXT,
  ADD COLUMN IF NOT EXISTS "codexOauthRefreshToken" TEXT,
  ADD COLUMN IF NOT EXISTS "codexOauthExpiresAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "codexAccountId"         TEXT;
