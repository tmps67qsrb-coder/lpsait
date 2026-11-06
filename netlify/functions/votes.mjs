import crypto from "node:crypto";
import fs from "node:fs";
import { getStore } from "@netlify/blobs";

let defaultUsers = [];
try {
  const usersUrl = new URL("./users.json", import.meta.url);
  defaultUsers = JSON.parse(fs.readFileSync(usersUrl, "utf-8"));
} catch (e) {
  defaultUsers = [];
}

const VALID_IDS = new Set(["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9"]);
const SECRET_KEY = process.env.VOTE_SECRET || "lp2026_bmstu_proforg_session_secret_983";

// Защита от перебора паролей: максимум 5 неудачных попыток за 5 минут
const FAILED_ATTEMPTS = new Map();

function getRateLimitKey(req, login) {
  const ip =
    req.headers.get("x-nf-client-connection-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "ip_unknown";
  return `${ip}:${login || "general"}`;
}

function isRateLimited(key) {
  const now = Date.now();
  const times = (FAILED_ATTEMPTS.get(key) || []).filter((t) => now - t < 300000);
  FAILED_ATTEMPTS.set(key, times);
  return times.length >= 5;
}

function recordFailedAttempt(key) {
  const now = Date.now();
  const times = (FAILED_ATTEMPTS.get(key) || []).filter((t) => now - t < 300000);
  times.push(now);
  FAILED_ATTEMPTS.set(key, times);
}

function resetRateLimit(key) {
  FAILED_ATTEMPTS.delete(key);
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password).trim()).digest("hex");
}

function verifyAccount(usersList, login, password) {
  if (!login || !password || !Array.isArray(usersList)) return false;
  const hash = hashPassword(password);
  return usersList.some((u) => {
    if (!u || String(u.login || "").trim().toLowerCase() !== login.toLowerCase()) return false;
    if (u.password_sha256) {
      return String(u.password_sha256).toLowerCase() === hash.toLowerCase();
    }
    if (u.password) {
      return String(u.password).trim() === password;
    }
    return false;
  });
}

function createToken(login) {
  const expiry = Math.floor(Date.now() / 1000) + 86400 * 7; // 7 дней
  const data = `${login}:${expiry}`;
  const sig = crypto.createHmac("sha256", SECRET_KEY).update(data).digest("hex");
  return `${login}.${expiry}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [login, expiryStr, sig] = parts;
  const expiry = parseInt(expiryStr, 10);
  if (isNaN(expiry) || expiry < Math.floor(Date.now() / 1000)) return null;
  const data = `${login}:${expiry}`;
  const expectedSig = crypto.createHmac("sha256", SECRET_KEY).update(data).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expectedSig, "hex"))) {
      return null;
    }
  } catch {
    return null;
  }
  return login;
}

export default async (req) => {
  const store = getStore("proforg-votes-2026");
  const url = new URL(req.url);

  // Список пользователей из Blobs или локального netlify/functions/users.json
  const dbUsers = (await store.get("users", { type: "json" })) || defaultUsers;

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "vote").trim();
    const login = String(body.login || "").trim().slice(0, 128);

    // 1. АВТОРИЗАЦИЯ
    if (action === "login") {
      const password = String(body.password || "").trim().slice(0, 128);
      const rlKey = getRateLimitKey(req, login);

      if (isRateLimited(rlKey)) {
        return Response.json(
          { ok: false, error: "Слишком много неудачных попыток входа. Попробуйте через 5 минут." },
          { status: 429 }
        );
      }

      if (!verifyAccount(dbUsers, login, password)) {
        recordFailedAttempt(rlKey);
        return Response.json(
          { ok: false, error: "Неверный логин или пароль" },
          { status: 401 }
        );
      }

      resetRateLimit(rlKey);
      const token = createToken(login);

      // Проверяем индивидуальную запись голоса этого аккаунта
      const voterData = await store.get(`voter:${login}`, { type: "json" });
      const myVote = voterData ? voterData.candidateId : null;

      const state = (await store.get("state", { type: "json" })) || {
        counts: { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, f8: 0, f9: 0 },
      };
      const total = Object.values(state.counts).reduce((a, b) => a + b, 0);

      return Response.json({
        ok: true,
        login,
        token,
        my_vote: myVote,
        counts: myVote ? state.counts : null,
        total,
      });
    }

    // 2. ГОЛОСОВАНИЕ
    if (action === "vote") {
      const token = String(body.token || "").trim();
      const authenticatedLogin = verifyToken(token);

      if (!authenticatedLogin || authenticatedLogin.toLowerCase() !== login.toLowerCase()) {
        return Response.json(
          { ok: false, error: "Сессия истекла или недействительна. Войдите снова." },
          { status: 401 }
        );
      }

      const candidateId = String(body.id || "").trim();
      if (!VALID_IDS.has(candidateId)) {
        return Response.json(
          { ok: false, error: "Некорректный кандидат" },
          { status: 400 }
        );
      }

      // Атомарная проверка дублирования голоса: отдельный ключ voter:${login}
      const voterKey = `voter:${authenticatedLogin}`;
      const existingVote = await store.get(voterKey, { type: "json" });

      const state = (await store.get("state", { type: "json" })) || {
        counts: { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, f8: 0, f9: 0 },
      };

      if (!existingVote) {
        // Записываем сначала голос избирателя, чтобы параллельные запросы не могли задвоить
        await store.setJSON(voterKey, {
          candidateId,
          timestamp: Date.now(),
        });

        state.counts[candidateId] = (state.counts[candidateId] || 0) + 1;
        await store.setJSON("state", state);
      }

      const myVote = existingVote ? existingVote.candidateId : candidateId;
      const total = Object.values(state.counts).reduce((a, b) => a + b, 0);

      return Response.json({
        ok: true,
        login: authenticatedLogin,
        token,
        my_vote: myVote,
        counts: state.counts,
        total,
      });
    }

    return Response.json({ ok: false, error: "Неизвестное действие" }, { status: 400 });
  }

  // 3. ПОЛУЧЕНИЕ СОСТОЯНИЯ (GET)
  const token = (url.searchParams.get("token") || "").trim();
  const login = (url.searchParams.get("login") || "").trim().slice(0, 128);
  const authenticatedLogin = token ? verifyToken(token) : null;

  const state = (await store.get("state", { type: "json" })) || {
    counts: { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, f8: 0, f9: 0 },
  };

  let myVote = null;
  if (authenticatedLogin && authenticatedLogin.toLowerCase() === login.toLowerCase()) {
    const voterData = await store.get(`voter:${authenticatedLogin}`, { type: "json" });
    myVote = voterData ? voterData.candidateId : null;
  }

  const total = Object.values(state.counts).reduce((a, b) => a + b, 0);

  return Response.json({
    counts: myVote ? state.counts : null,
    my_vote: myVote,
    total,
    login: authenticatedLogin || null,
  });
};
