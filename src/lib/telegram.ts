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

async function call<T>(token: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? "unknown error"}`);
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
