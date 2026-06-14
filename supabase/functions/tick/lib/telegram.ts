import { TransientPublishError } from "./retry.ts";

const API = "https://api.telegram.org";

export type TelegramGetMe = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

export type SendMessageResult = {
  message_id: number;
  chat: { id: number | string; title?: string; username?: string };
};

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
};

async function call<T>(token: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch (e) {
    throw new TransientPublishError(`Telegram ${method} network error: ${(e as Error).message}`);
  }
  if (res.status >= 500) {
    throw new TransientPublishError(`Telegram ${method}: HTTP ${res.status}`, {
      status: res.status,
    });
  }
  const json = (await res.json()) as TelegramResponse<T>;
  if (!json.ok) {
    const message = `Telegram ${method}: ${json.description ?? "unknown error"}`;
    if (json.error_code === 429) {
      const retryAfterMs = json.parameters?.retry_after
        ? json.parameters.retry_after * 1000
        : undefined;
      throw new TransientPublishError(message, { status: 429, retryAfterMs });
    }
    throw new Error(message);
  }
  return json.result as T;
}

export function getMe(token: string) {
  return call<TelegramGetMe>(token, "getMe");
}

export function sendMessage(token: string, chatId: string | number, text: string, opts?: {
  parseMode?: "HTML" | "MarkdownV2";
  disableWebPagePreview?: boolean;
}) {
  return call<SendMessageResult>(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: opts?.parseMode,
    disable_web_page_preview: opts?.disableWebPagePreview,
  });
}

export function buildPostUrl(chat: SendMessageResult["chat"], messageId: number): string | null {
  if (chat.username) return `https://t.me/${chat.username}/${messageId}`;
  return null;
}
