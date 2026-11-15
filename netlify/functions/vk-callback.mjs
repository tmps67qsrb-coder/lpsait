import { getStore } from "@netlify/blobs";

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const expectedSecret = process.env.VK_CALLBACK_SECRET;
  const confirmation = process.env.VK_CONFIRMATION_TOKEN;
  if (!expectedSecret || !confirmation) return json({ ok: false }, 503);

  let event;
  try { event = await req.json(); } catch { return json({ ok: false }, 400); }
  if (event.secret !== expectedSecret) return json({ ok: false }, 403);
  if (event.type === "confirmation") return new Response(confirmation, { headers: { "Content-Type": "text/plain" } });
  if (event.type === "message_new") {
    const message = event.object?.message || event.object;
    const challenge = String(message?.ref || "");
    const vkUserId = Number(message?.from_id || message?.user_id || 0);
    if (/^[A-Za-z0-9_-]{32}$/.test(challenge) && Number.isSafeInteger(vkUserId) && vkUserId > 0) {
      const store = getStore("proforg-votes-2026-v2");
      const pendingKey = `vk_registration:${challenge}`;
      const pending = await store.get(pendingKey, { type: "json", consistency: "strong" });
      if (pending && !pending.verifiedAt && !pending.completed && Date.now() - pending.createdAt <= 10 * 60 * 1000) {
        await store.setJSON(pendingKey, { ...pending, verifiedAt: Date.now(), vkUserId });
      }
    }
  }
  return new Response("ok", { headers: { "Content-Type": "text/plain" } });
};
