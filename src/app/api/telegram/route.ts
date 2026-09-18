import { NextRequest, NextResponse } from "next/server";

const BOT_TOKEN = "8279567692:AAEAauM0Jw1c2F-DyUisiFyncHSFBiCNIe0";
const OWNER_CHAT_ID = "1593769028";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, message } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const text = `📢 *Copyright Contact Request*\n\n*From:* ${name || "Anonymous"}\n*Message:* ${message}`;

    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: OWNER_CHAT_ID,
        text,
        parse_mode: "Markdown",
      }),
    });

    const data = await res.json();

    if (!data.ok) {
      return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
