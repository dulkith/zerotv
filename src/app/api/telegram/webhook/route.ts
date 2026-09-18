import { NextRequest, NextResponse } from "next/server";

const BOT_TOKEN = "8279567692:AAEAauM0Jw1c2F-DyUisiFyncHSFBiCNIe0";
const OWNER_CHAT_ID = "1593769028";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendMessage(chatId: number | string, text: string, replyTo?: number) {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (replyTo) body.reply_to_message_id = replyTo;
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();
    const msg = update.message;
    if (!msg) return NextResponse.json({ ok: true });

    const chatId = msg.chat.id;
    const text = msg.text || "";
    const firstName = msg.from?.first_name || "User";
    const lastName = msg.from?.last_name || "";
    const username = msg.from?.username ? `@${msg.from.username}` : "";
    const fromId = msg.from?.id;

    // Owner replies to a forwarded message -> send back to original user
    if (String(chatId) === OWNER_CHAT_ID && msg.reply_to_message) {
      const replied = msg.reply_to_message;
      // Check if the replied message was a forwarded user message (contains user info in caption or text)
      const match = replied.text?.match(/👤 User: (.+)\n🆔 ID: (\d+)/);
      if (match) {
        const userId = match[2];
        await sendMessage(userId, `💬 *Owner:* ${text}`, undefined);
      }
      return NextResponse.json({ ok: true });
    }

    // User messages the bot -> forward to owner
    if (String(chatId) !== OWNER_CHAT_ID) {
      const ownerText = `📩 *New Message*\n\n👤 User: ${firstName} ${lastName} ${username}\n🆔 ID: ${chatId}\n\n💬 ${text}`;
      await sendMessage(OWNER_CHAT_ID, ownerText, undefined);
      await sendMessage(chatId, "✅ Your message has been sent. We'll get back to you soon.", undefined);
      return NextResponse.json({ ok: true });
    }

    // Owner sends without reply -> just ignore or show usage
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
