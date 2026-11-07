import crypto from "node:crypto";
import fs from "node:fs";
import { getStore } from "@netlify/blobs";

let defaultUsers = [];
try {
  const usersUrl = new URL("./users.json", import.meta.url);
  defaultUsers = JSON.parse(fs.readFileSync(usersUrl, "utf-8"));
} catch {
  defaultUsers = [];
}

const VALID_IDS = new Set(["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9"]);
const SECRET_KEY = process.env.VOTE_SECRET || "lp2026_bmstu_proforg_session_secret_983";

const VALID_SUPPORTERS = new Set([
  "Гузько Никита Андреевич",
  "Аксенова Алевтина Александровна",
  "Загирова Алина Тимуровна",
  "Щетанова Полина Денисовна",
  "Амиров Руслан Рустемович",
  "Кузьмичев Максим Олегович",
  "Шумилина Екатерина Владимировна",
  "Портузенков Ильяс Рафаэлевич",
  "Данилина Дарья Алексеевна",
  "Просто зритель",
]);

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

function normalizePhone(raw) {
  const str = String(raw || "").trim();
  const digits = str.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("8") || digits.startsWith("7"))) {
    return "+7" + digits.slice(1);
  }
  if (digits.length === 10 && digits.startsWith("9")) {
    return "+7" + digits;
  }
  if (digits.length >= 10 && digits.length <= 15) {
    return "+" + digits;
  }
  return "";
}

function validatePasswordFormat(password) {
  const pwd = String(password || "");
  if (pwd.length < 8) {
    return "Пароль должен содержать минимум 8 символов";
  }
  if (/[а-яА-ЯёЁ]/.test(pwd)) {
    return "Пароль должен содержать только английские буквы (без русских символов)";
  }
  if (!/[a-zA-Z]/.test(pwd)) {
    return "Пароль должен содержать английские буквы";
  }
  if (!/[^a-zA-Z0-9\s]/.test(pwd)) {
    return "Пароль должен содержать хотя бы один специальный знак (например: ! @ # $ % ^ & * _ - + =)";
  }
  return null;
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password).trim()).digest("hex");
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

async function findUserAccount(store, rawLogin) {
  const normPhone = normalizePhone(rawLogin);
  const lookupKey = normPhone || String(rawLogin || "").trim().toLowerCase();
  if (!lookupKey) return null;

  // 1. Ищем в индивидуальном ключе Blobs
  const blobUser = await store.get(`user:${lookupKey}`, { type: "json" });
  if (blobUser) return blobUser;

  // 2. Ищем в общем списке или дефолтном users.json
  const dbUsers = (await store.get("users", { type: "json" })) || defaultUsers;
  if (Array.isArray(dbUsers)) {
    const found = dbUsers.find(
      (u) => String(u.login || "").toLowerCase() === lookupKey.toLowerCase()
    );
    if (found) {
      return {
        login: found.login,
        phone: found.phone || found.login,
        fullName: found.fullName || found.login,
        group: found.group || "МГТУ им. Н.Э. Баумана",
        notBmstu: Boolean(found.notBmstu),
        supporterOf: found.supporterOf || "Просто зритель",
        password_sha256: found.password_sha256,
      };
    }
  }
  return null;
}

function formatPublicProfile(userObj) {
  if (!userObj) return null;
  return {
    phone: userObj.phone || userObj.login,
    fullName: userObj.fullName || "",
    group: userObj.notBmstu ? "Не из МГТУ им. Н.Э. Баумана" : userObj.group || "",
    notBmstu: Boolean(userObj.notBmstu),
    supporterOf: userObj.supporterOf || "",
  };
}

export default async (req) => {
  const store = getStore("proforg-votes-2026");
  const url = new URL(req.url);

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "vote").trim();

    // 1. РЕГИСТРАЦИЯ В ЛИЧНОМ КАБИНЕТЕ
    if (action === "register") {
      const rawPhone = String(body.phone || body.login || "").trim();
      const phone = normalizePhone(rawPhone);
      const fullName = String(body.fullName || "").trim().slice(0, 140);
      const notBmstu = Boolean(body.notBmstu);
      const rawGroup = String(body.group || "").trim().slice(0, 60);
      const group = notBmstu ? "Не из МГТУ им. Н.Э. Баумана" : rawGroup;
      const supporterOf = String(body.supporterOf || "").trim();
      const password = String(body.password || "").trim();

      if (!phone) {
        return Response.json(
          { ok: false, error: "Введите корректный номер телефона (например, +7 999 123-45-67)" },
          { status: 400 }
        );
      }
      if (!fullName || fullName.length < 3 || !fullName.includes(" ")) {
        return Response.json(
          { ok: false, error: "Введите ваше полное ФИО" },
          { status: 400 }
        );
      }
      if (!notBmstu && !rawGroup) {
        return Response.json(
          { ok: false, error: "Укажите учебную группу или выберите «Не из МГТУ им. Н.Э. Баумана»" },
          { status: 400 }
        );
      }
      if (!supporterOf || !VALID_SUPPORTERS.has(supporterOf)) {
        return Response.json(
          { ok: false, error: "Выберите участника, за которого болеете, или «Просто зритель»" },
          { status: 400 }
        );
      }
      const pwdError = validatePasswordFormat(password);
      if (pwdError) {
        return Response.json({ ok: false, error: pwdError }, { status: 400 });
      }

      const existing = await store.get(`user:${phone}`, { type: "json" });
      if (existing) {
        return Response.json(
          {
            ok: false,
            error: "Этот номер телефона уже зарегистрирован. Перейдите во вкладку «Вход».",
          },
          { status: 409 }
        );
      }

      const userRecord = {
        login: phone,
        phone,
        fullName,
        group,
        notBmstu,
        supporterOf,
        password_sha256: hashPassword(password),
        createdAt: Date.now(),
      };

      await store.setJSON(`user:${phone}`, userRecord);

      const token = createToken(phone);
      const state = (await store.get("state", { type: "json" })) || {
        counts: { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, f8: 0, f9: 0 },
      };
      const total = Object.values(state.counts).reduce((a, b) => a + b, 0);

      return Response.json({
        ok: true,
        login: phone,
        token,
        profile: formatPublicProfile(userRecord),
        my_vote: null,
        counts: null,
        total,
        cabinet_notice: "В личном кабинете скоро появятся лист рассадки и данные о входе в БЗДК",
      });
    }

    // 2. ВХОД В ЛИЧНЫЙ КАБИНЕТ
    if (action === "login") {
      const rawLogin = String(body.login || body.phone || "").trim().slice(0, 128);
      const normPhone = normalizePhone(rawLogin);
      const loginKey = normPhone || rawLogin.toLowerCase();
      const password = String(body.password || "").trim().slice(0, 128);
      const rlKey = getRateLimitKey(req, loginKey);

      if (isRateLimited(rlKey)) {
        return Response.json(
          { ok: false, error: "Слишком много неудачных попыток входа. Попробуйте через 5 минут." },
          { status: 429 }
        );
      }

      const userAccount = await findUserAccount(store, rawLogin);
      const pwdHash = hashPassword(password);
      const valid =
        userAccount &&
        userAccount.password_sha256 &&
        String(userAccount.password_sha256).toLowerCase() === pwdHash.toLowerCase();

      if (!valid) {
        recordFailedAttempt(rlKey);
        return Response.json(
          { ok: false, error: "Неверный номер телефона или пароль" },
          { status: 401 }
        );
      }

      resetRateLimit(rlKey);
      const canonicalLogin = userAccount.login;
      const token = createToken(canonicalLogin);

      const voterData = await store.get(`voter:${canonicalLogin}`, { type: "json" });
      const myVote = voterData ? voterData.candidateId : null;

      const state = (await store.get("state", { type: "json" })) || {
        counts: { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, f8: 0, f9: 0 },
      };
      const total = Object.values(state.counts).reduce((a, b) => a + b, 0);

      return Response.json({
        ok: true,
        login: canonicalLogin,
        token,
        profile: formatPublicProfile(userAccount),
        my_vote: myVote,
        counts: myVote ? state.counts : null,
        total,
        cabinet_notice: "В личном кабинете скоро появятся лист рассадки и данные о входе в БЗДК",
      });
    }

    // 3. ГОЛОСОВАНИЕ
    if (action === "vote") {
      const rawLogin = String(body.login || "").trim().slice(0, 128);
      const normPhone = normalizePhone(rawLogin);
      const expectedLogin = normPhone || rawLogin;
      const token = String(body.token || "").trim();
      const authenticatedLogin = verifyToken(token);

      if (!authenticatedLogin || authenticatedLogin.toLowerCase() !== expectedLogin.toLowerCase()) {
        return Response.json(
          { ok: false, error: "Сессия истекла или недействительна. Войдите в личный кабинет." },
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

      const voterKey = `voter:${authenticatedLogin}`;
      const existingVote = await store.get(voterKey, { type: "json" });

      const state = (await store.get("state", { type: "json" })) || {
        counts: { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, f8: 0, f9: 0 },
      };

      if (existingVote) {
        return Response.json(
          {
            ok: false,
            error: "Вы уже голосовали в этом конкурсе",
            my_vote: existingVote.candidateId,
            counts: state.counts,
          },
          { status: 409 }
        );
      }

      await store.setJSON(voterKey, {
        candidateId,
        ts: Date.now(),
      });

      state.counts[candidateId] = (state.counts[candidateId] || 0) + 1;
      await store.setJSON("state", state);

      const total = Object.values(state.counts).reduce((a, b) => a + b, 0);

      return Response.json({
        ok: true,
        login: authenticatedLogin,
        token,
        my_vote: candidateId,
        counts: state.counts,
        total,
      });
    }

    return Response.json({ ok: false, error: "Неизвестное действие" }, { status: 400 });
  }

  // 4. ПОЛУЧЕНИЕ СОСТОЯНИЯ И ПРОФИЛЯ (GET)
  const token = (url.searchParams.get("token") || "").trim();
  const rawLogin = (url.searchParams.get("login") || "").trim().slice(0, 128);
  const normPhone = normalizePhone(rawLogin);
  const expectedLogin = normPhone || rawLogin;
  const authenticatedLogin = token ? verifyToken(token) : null;

  const state = (await store.get("state", { type: "json" })) || {
    counts: { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, f8: 0, f9: 0 },
  };

  let myVote = null;
  let profile = null;
  if (authenticatedLogin && authenticatedLogin.toLowerCase() === expectedLogin.toLowerCase()) {
    const voterData = await store.get(`voter:${authenticatedLogin}`, { type: "json" });
    myVote = voterData ? voterData.candidateId : null;
    const userAccount = await findUserAccount(store, authenticatedLogin);
    profile = formatPublicProfile(userAccount);
  }

  const total = Object.values(state.counts).reduce((a, b) => a + b, 0);

  return Response.json({
    counts: myVote ? state.counts : null,
    my_vote: myVote,
    total,
    login: authenticatedLogin || null,
    profile,
  });
};
