import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const textResponse = (text, status = 200) => new Response(text, {
  status,
  headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
});

const secretsMatch = (expected, received) => {
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");
  const receivedBuffer = Buffer.from(String(received || ""), "utf8");
  return expectedBuffer.length > 0 && expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};

async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
  } catch {
    // Confirmation has already been recorded; a Telegram API hiccup must not trigger webhook retries.
  }
}

export default async (req) => {
  if (req.method !== "POST") return textResponse("Method not allowed", 405);

  const webhookSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "");
  const receivedSecret = req.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(webhookSecret) || !secretsMatch(webhookSecret, receivedSecret)) {
    return textResponse("Forbidden", 403);
  }

  let update;
  try { update = await req.json(); } catch { return textResponse("Bad request", 400); }

  const message = update?.message;
  const text = String(message?.text || "");
  const startMatch = text.match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]{1,64}))?$/);
  if (!startMatch || message?.chat?.type !== "private") return textResponse("ok");

  const telegramUserId = Number(message?.from?.id || 0);
  const chatId = Number(message?.chat?.id || 0);
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0 || chatId !== telegramUserId || message?.from?.is_bot) {
    return textResponse("ok");
  }

  const challenge = String(startMatch[1] || "");
  if (!/^[A-Za-z0-9_-]{32}$/.test(challenge)) {
    await sendTelegramMessage(chatId, "Чтобы подтвердить регистрацию, вернитесь на сайт, заполните форму и откройте персональную ссылку на этого бота.");
    return textResponse("ok");
  }

  const store = getStore("proforg-votes-2026-v2");
  const pendingKey = `telegram_registration:${challenge}`;
  const lockKey = `telegram_confirmation_lock:${challenge}`;
  const lock = await store.set(lockKey, String(Date.now()), { onlyIfNew: true });
  if (!lock.modified) return textResponse("ok");

  let reply = "Ссылка регистрации недействительна или срок её действия истёк. Вернитесь на сайт и начните регистрацию заново.";
  try {
    const pending = await store.get(pendingKey, { type: "json", consistency: "strong" });
    const now = Date.now();
    if (pending && Number.isFinite(pending.createdAt) && pending.createdAt <= now && now - pending.createdAt <= 10 * 60 * 1000 && !pending.completed) {
      if (pending.verifiedAt && Number(pending.telegramUserId) !== telegramUserId) {
        reply = "Эта ссылка уже подтверждена в другом Telegram-аккаунте.";
      } else {
        if (!pending.verifiedAt) {
          await store.setJSON(pendingKey, { ...pending, verifiedAt: now, telegramUserId });
        }
        reply = "Telegram-аккаунт подтверждён. Вернитесь на сайт — регистрация завершится автоматически.";
      }
    }
  } finally {
    await store.delete(lockKey);
  }

  await sendTelegramMessage(chatId, reply);
  return textResponse("ok");
};
