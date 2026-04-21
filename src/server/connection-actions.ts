"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getMe, sendMessage } from "@/lib/telegram";
import { getCurrentUser } from "@/server/project";

const connectSchema = z.object({
  projectId: z.string().min(1),
  botToken: z.string().min(20).regex(/^\d+:[A-Za-z0-9_-]+$/, "Invalid bot token format"),
  chatId: z.string().min(1),
  sendTestMessage: z.boolean().optional().default(true),
});

export async function connectTelegramAction(input: z.input<typeof connectSchema>) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const parsed = connectSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { projectId, botToken, chatId, sendTestMessage } = parsed.data;

  const project = await db.project.findFirst({
    where: { id: projectId, org: { members: { some: { userId: user.id } } } },
  });
  if (!project) return { ok: false as const, error: "Project not found." };

  let bot;
  try {
    bot = await getMe(botToken);
  } catch (e) {
    return { ok: false as const, error: `Token invalid: ${(e as Error).message}` };
  }

  if (sendTestMessage) {
    try {
      await sendMessage(
        botToken,
        chatId,
        `✅ Connected to Account Manager. You'll start receiving posts here once your project is active.`,
      );
    } catch (e) {
      return { ok: false as const, error: `Couldn't post to chat: ${(e as Error).message}. Make sure the bot is an admin in the channel and can send messages.` };
    }
  }

  await db.connectedAccount.upsert({
    where: {
      projectId_platform_externalId: {
        projectId,
        platform: "TELEGRAM",
        externalId: chatId,
      },
    },
    create: {
      projectId,
      platform: "TELEGRAM",
      externalId: chatId,
      displayName: bot.username ?? bot.first_name,
      accessToken: encrypt(botToken),
      meta: { botUsername: bot.username, botId: bot.id },
    },
    update: {
      displayName: bot.username ?? bot.first_name,
      accessToken: encrypt(botToken),
      meta: { botUsername: bot.username, botId: bot.id },
    },
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true as const, botUsername: bot.username };
}

export async function disconnectAccountAction(connectionId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const conn = await db.connectedAccount.findFirst({
    where: { id: connectionId, project: { org: { members: { some: { userId: user.id } } } } },
  });
  if (!conn) return { ok: false as const, error: "Connection not found." };

  await db.connectedAccount.delete({ where: { id: conn.id } });
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true as const };
}
