import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/service";
import { unwrap } from "@/lib/supabase/queries";
import { encrypt } from "@/lib/crypto";
import { getMe, sendMessage } from "@/lib/telegram";
import { getCurrentUser, userOwnsProject } from "@/server/project";

const connectSchema = z.object({
  projectId: z.string().min(1),
  botToken: z.string().min(20).regex(/^\d+:[A-Za-z0-9_-]+$/, "Invalid bot token format"),
  chatId: z.string().min(1),
  sendTestMessage: z.boolean().optional().default(true),
});

// The validator runs on both client and server, so it stays isomorphic and only
// passes the raw input through. We keep the safeParse inside the handler to
// preserve the friendly `{ ok, error }` return contract instead of throwing.
function connectValidator(data: unknown): z.input<typeof connectSchema> {
  return data as z.input<typeof connectSchema>;
}

// Calling convention from a client component:
//   const res = await connectTelegramAction({ data: { projectId, botToken, chatId } })
// After a successful call the client must `await router.invalidate()` — the old
// revalidatePath("/settings")/("/dashboard") calls moved to the call site.
export const connectTelegramAction = createServerFn({ method: "POST" })
  .validator(connectValidator)
  .handler(async ({ data: input }) => {
    const user = await getCurrentUser();
    if (!user) return { ok: false as const, error: "Not signed in." };

    const parsed = connectSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    const { projectId, botToken, chatId, sendTestMessage } = parsed.data;

    if (!(await userOwnsProject(user.id, projectId))) {
      return { ok: false as const, error: "Project not found." };
    }

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

    // Composite unique key (projectId, platform, externalId) drives the upsert.
    await unwrap(
      supabaseAdmin.from("ConnectedAccount").upsert(
        {
          projectId,
          platform: "TELEGRAM",
          externalId: chatId,
          displayName: bot.username ?? bot.first_name,
          accessToken: await encrypt(botToken),
          meta: { botUsername: bot.username, botId: bot.id },
        },
        { onConflict: "projectId,platform,externalId" },
      ),
    );

    return { ok: true as const, botUsername: bot.username };
  });

// Calling convention from a client component:
//   const res = await disconnectAccountAction({ data: connectionId })
// After a successful call the client must `await router.invalidate()`.
function connectionIdValidator(data: unknown): string {
  return z.string().parse(data);
}

export const disconnectAccountAction = createServerFn({ method: "POST" })
  .validator(connectionIdValidator)
  .handler(async ({ data: connectionId }) => {
    const user = await getCurrentUser();
    if (!user) return { ok: false as const, error: "Not signed in." };

    // Resolve the connection's owning project, then verify the user owns it.
    const { data: conn } = await supabaseAdmin
      .from("ConnectedAccount")
      .select("id, projectId")
      .eq("id", connectionId)
      .maybeSingle();
    if (!conn || !(await userOwnsProject(user.id, conn.projectId))) {
      return { ok: false as const, error: "Connection not found." };
    }

    await unwrap(
      supabaseAdmin.from("ConnectedAccount").delete().eq("id", conn.id),
    );
    return { ok: true as const };
  });
