import { NextResponse } from "next/server";

const BOT_TOKEN = "8279567692:AAEAauM0Jw1c2F-DyUisiFyncHSFBiCNIe0";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const baseUrl = searchParams.get("url");

    if (!baseUrl) {
      return NextResponse.json({
        error: "Missing ?url= parameter",
        usage: "GET /api/telegram/setup?url=https://your-domain.com/api/telegram/webhook",
      });
    }

    const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`;

    // Remove old webhook
    await fetch(`${API}/deleteWebhook`);

    // Set new webhook
    const res = await fetch(`${API}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ["message"],
      }),
    });

    const data = await res.json();

    return NextResponse.json({
      ok: data.ok,
      webhook_url: webhookUrl,
      description: data.description,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
