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
const ENC_KEY = crypto.createHash("sha256").update(SECRET_KEY).digest();
const PBKDF2_ITERATIONS = 100000;
const MAX_BODY_BYTES = 4096;
const MAX_TRACKED_KEYS = 5000;

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

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
};

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

// ============================================================
// ЗАЩИТА ОТ DDOS / FLOOD, АВТО-БЛОКИРОВКА IP И ФИЛЬТР SQL-ИНЪЕКЦИЙ
// ============================================================
const FAILED_ATTEMPTS = new Map();
const BANNED_IPS = new Map();

// Короткоживущий кэш состояния голосования (защита хранилища от DDoS чтением)
let STATE_CACHE = { ts: 0, state: null };
const STATE_CACHE_TTL_MS = 1500;

// Регулярное выражение WAF для обнаружения попыток SQL-инъекций и NoSQL/Key-инъекций
const SQLI_PATTERN =
  /(\b(union\s+all\s+select|union\s+select|select\s+.+\s+from|insert\s+into|update\s+.+\s+set|delete\s+from|drop\s+table|alter\s+table|truncate\s+table|sqlite_master|sqlite_temp_master|information_schema|sleep\s*\(|benchmark\s*\(|waitfor\s+delay|load_file\s*\(|into\s+outfile|attach\s+database|pragma\s+)\b|('|")\s*(or|and)\s*('|"|\d)|\b(or|and)\s+1\s*=\s*1\b|--\s|--$|\/\*|\*\/|;\s*(select|drop|insert|update|delete))/i;

const SAFE_LOGIN_RE = /^(\+[0-9]{10,15}|[a-z0-9_.+-]{3,64})$/;
const SAFE_NAME_RE = /^[а-яА-ЯёЁa-zA-Z\s-]{3,140}$/;
const SAFE_GROUP_RE = /^[а-яА-ЯёЁa-zA-Z0-9\s-]{1,60}$/;

function detectSqlInjection(...values) {
  for (const val of values) {
    if (val === undefined || val === null) continue;
    const str = String(val);
    if (str.includes("\0") || SQLI_PATTERN.test(str)) {
      return true;
    }
  }
  return false;
}

function pruneMap(map) {
  if (map.size <= MAX_TRACKED_KEYS) return;
  const excess = map.size - Math.floor(MAX_TRACKED_KEYS / 2);
  let i = 0;
  for (const k of map.keys()) {
    map.delete(k);
    if (++i >= excess) break;
  }
}

function getClientIp(req) {
  return (
    req.headers.get("x-nf-client-connection-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "ip_unknown"
  ).slice(0, 64);
}

function isIpBanned(ip) {
  const now = Date.now();
  const until = BANNED_IPS.get(ip) || 0;
  if (until > now) {
    return Math.ceil((until - now) / 1000);
  }
  if (until) BANNED_IPS.delete(ip);
  return 0;
}

function banIp(ip, durationMs = 300000) {
  pruneMap(BANNED_IPS);
  BANNED_IPS.set(ip, Date.now() + durationMs);
}

function checkAndRecordRate(key, maxAttempts, windowMs) {
  const now = Date.now();
  pruneMap(FAILED_ATTEMPTS);
  const times = (FAILED_ATTEMPTS.get(key) || []).filter((t) => now - t < windowMs);
  if (times.length >= maxAttempts) {
    FAILED_ATTEMPTS.set(key, times);
    return true;
  }
  times.push(now);
  FAILED_ATTEMPTS.set(key, times);
  return false;
}

function getRateLimitKey(req, login) {
  return `${getClientIp(req)}:${login || "general"}`;
}

function isRateLimited(key, maxAttempts = 5, windowMs = 300000) {
  const now = Date.now();
  const times = (FAILED_ATTEMPTS.get(key) || []).filter((t) => now - t < windowMs);
  FAILED_ATTEMPTS.set(key, times);
  return times.length >= maxAttempts;
}

function recordAttempt(key, windowMs = 300000) {
  const now = Date.now();
  pruneMap(FAILED_ATTEMPTS);
  const times = (FAILED_ATTEMPTS.get(key) || []).filter((t) => now - t < windowMs);
  times.push(now);
  FAILED_ATTEMPTS.set(key, times);
}

function resetRateLimit(key) {
  FAILED_ATTEMPTS.delete(key);
}

function sanitizeText(str, maxLen = 140) {
  return String(str || "")
    .replace(/[\u0000-\u001F\u007F<>'";`\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
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
  if (pwd.length > 128) {
    return "Пароль не должен превышать 128 символов";
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

// Надёжное хэширование пароля: PBKDF2-HMAC-SHA256 с индивидуальной солью
function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto
    .pbkdf2Sync(String(password).trim().slice(0, 128), salt, PBKDF2_ITERATIONS, 32, "sha256")
    .toString("hex");
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${derived}`;
}

function verifyPasswordHash(password, storedHash) {
  if (!password || !storedHash || String(password).length > 128) return false;
  const pwd = String(password).trim();
  const stored = String(storedHash).trim();

  if (stored.startsWith("pbkdf2$")) {
    const parts = stored.split("$");
    if (parts.length !== 4) return false;
    const rawIter = parseInt(parts[1], 10);
    const iterations = Math.min(Math.max(rawIter || 0, 1000), 300000);
    const salt = parts[2];
    const expectedHex = parts[3];
    if (!iterations || !salt || !expectedHex) return false;
    try {
      const derived = crypto
        .pbkdf2Sync(pwd, salt, iterations, 32, "sha256")
        .toString("hex");
      return crypto.timingSafeEqual(
        Buffer.from(derived, "hex"),
        Buffer.from(expectedHex, "hex")
      );
    } catch {
      return false;
    }
  }

  // Обратная совместимость со старыми SHA-256 хэшами
  const legacySha = crypto.createHash("sha256").update(pwd).digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(legacySha.toLowerCase(), "hex"),
      Buffer.from(stored.toLowerCase(), "hex")
    );
  } catch {
    return false;
  }
}

// Шифрование персональных данных (AES-256-GCM) при хранении
function encryptField(plainText) {
  const text = String(plainText || "");
  if (!text) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptField(value) {
  const str = String(value || "");
  if (!str.startsWith("enc1:")) return str;
  const parts = str.split(":");
  if (parts.length !== 4) return "";
  try {
    const iv = Buffer.from(parts[1], "hex");
    const tag = Buffer.from(parts[2], "hex");
    const data = Buffer.from(parts[3], "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

function createToken(login) {
  const expiry = Math.floor(Date.now() / 1000) + 86400 * 7; // 7 дней
  const data = `${login}:${expiry}`;
  const sig = crypto.createHmac("sha256", SECRET_KEY).update(data).digest("hex");
  return `${login}.${expiry}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || token.length > 256) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [login, expiryStr, sig] = parts;
  if (!SAFE_LOGIN_RE.test(login.toLowerCase())) return null;
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

async function getCachedState(store, forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && STATE_CACHE.state && now - STATE_CACHE.ts < STATE_CACHE_TTL_MS) {
    return STATE_CACHE.state;
  }
  const state = (await store.get("state", { type: "json" })) || {
    counts: { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, f8: 0, f9: 0 },
  };
  STATE_CACHE = { ts: now, state };
  return state;
}

async function findUserAccount(store, rawLogin) {
  const normPhone = normalizePhone(rawLogin);
  const lookupKey = (normPhone || String(rawLogin || "").trim()).toLowerCase();
  if (!lookupKey || !SAFE_LOGIN_RE.test(lookupKey)) return null;

  // 1. Ищем в индивидуальном ключе Blobs
  const blobUser = await store.get(`user:${lookupKey}`, { type: "json" });
  if (blobUser) {
    return {
      ...blobUser,
      fullName: decryptField(blobUser.fullName),
      group: decryptField(blobUser.group),
      supporterOf: decryptField(blobUser.supporterOf),
    };
  }

  // 2. Ищем в дефолтном users.json
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
  const clientIp = getClientIp(req);

  // 0. ПРОВЕРКА АВТО-БАНА IP И ГЛОБАЛЬНОГО АНТИ-DDOS ЛИМИТА
  const bannedLeft = isIpBanned(clientIp);
  if (bannedLeft > 0) {
    return jsonResponse(
      {
        ok: false,
        error: `IP временно заблокирован за подозрительную активность. Подождите ${bannedLeft} сек.`,
      },
      429,
      { "Retry-After": String(bannedLeft) }
    );
  }

  if (checkAndRecordRate(`burst:${clientIp}`, 50, 10000)) {
    banIp(clientIp, 120000);
    return jsonResponse(
      { ok: false, error: "Слишком много запросов (защита от DDoS). Подождите 2 минуты." },
      429,
      { "Retry-After": "120" }
    );
  }

  if (checkAndRecordRate(`api:${clientIp}`, 40, 60000)) {
    return jsonResponse(
      { ok: false, error: "Превышен лимит обращений к серверу. Подождите минуту." },
      429,
      { "Retry-After": "60" }
    );
  }

  const store = getStore("proforg-votes-2026-v2");
  const url = new URL(req.url);

  if (detectSqlInjection(url.pathname, url.search)) {
    banIp(clientIp, 300000);
    return jsonResponse(
      { ok: false, error: "Обнаружен недопустимый запрос (WAF SQLi Protection)" },
      400
    );
  }

  if (req.method === "POST") {
    const rawText = await req.text().catch(() => "");
    if (!rawText || rawText.length > MAX_BODY_BYTES) {
      return jsonResponse({ ok: false, error: "Payload Too Large or Empty" }, 413);
    }

    let body = {};
    try {
      body = JSON.parse(rawText);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return jsonResponse({ ok: false, error: "Invalid JSON object" }, 400);
      }
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
    }

    if (
      detectSqlInjection(
        body.action,
        body.phone,
        body.login,
        body.fullName,
        body.group,
        body.supporterOf,
        body.id,
        body.token
      )
    ) {
      banIp(clientIp, 300000);
      return jsonResponse(
        { ok: false, error: "Запрос заблокирован системой защиты от SQL-инъекций" },
        400
      );
    }

    const action = String(body.action || "vote").trim();

    // 1. РЕГИСТРАЦИЯ В ЛИЧНОМ КАБИНЕТЕ
    if (action === "register") {
      const regRlKey = `reg:${clientIp}`;
      if (isRateLimited(regRlKey, 8, 300000)) {
        return jsonResponse(
          { ok: false, error: "Слишком много запросов на регистрацию. Подождите 5 минут." },
          429
        );
      }

      const rawPhone = String(body.phone || body.login || "").trim().slice(0, 64);
      const phone = normalizePhone(rawPhone);
      const fullName = sanitizeText(body.fullName, 140);
      const notBmstu = Boolean(body.notBmstu);
      const rawGroup = sanitizeText(body.group, 60);
      const group = notBmstu ? "Не из МГТУ им. Н.Э. Баумана" : rawGroup;
      const supporterOf = sanitizeText(body.supporterOf, 80);
      const password = String(body.password || "").trim();

      if (!phone || !SAFE_LOGIN_RE.test(phone.toLowerCase())) {
        return jsonResponse(
          { ok: false, error: "Введите корректный номер телефона (например, +7 999 123-45-67)" },
          400
        );
      }
      if (!fullName || fullName.length < 3 || !fullName.includes(" ") || !SAFE_NAME_RE.test(fullName)) {
        return jsonResponse(
          { ok: false, error: "Введите ваше полное ФИО (только буквы, пробелы и дефис)" },
          400
        );
      }
      if (!notBmstu && (!rawGroup || !SAFE_GROUP_RE.test(rawGroup))) {
        return jsonResponse(
          { ok: false, error: "Укажите корректную учебную группу или выберите «Не из МГТУ им. Н.Э. Баумана»" },
          400
        );
      }
      if (!supporterOf || !VALID_SUPPORTERS.has(supporterOf)) {
        return jsonResponse(
          { ok: false, error: "Выберите участника, за которого болеете, или «Просто зритель»" },
          400
        );
      }
      const pwdError = validatePasswordFormat(password);
      if (pwdError) {
        return jsonResponse({ ok: false, error: pwdError }, 400);
      }

      const existing = await store.get(`user:${phone}`, { type: "json" });
      if (existing) {
        return jsonResponse(
          {
            ok: false,
            error: "Этот номер телефона уже зарегистрирован. Перейдите во вкладку «Вход».",
          },
          409
        );
      }

      recordAttempt(regRlKey);

      // Персональные данные шифруются AES-256-GCM, пароль хэшируется PBKDF2 с солью
      const storedRecord = {
        login: phone,
        phone,
        fullName: encryptField(fullName),
        group: encryptField(group),
        notBmstu,
        supporterOf: encryptField(supporterOf),
        password_sha256: createPasswordHash(password),
        createdAt: Date.now(),
      };

      await store.setJSON(`user:${phone}`, storedRecord);

      const token = createToken(phone);
      const state = await getCachedState(store);
      const total = Object.values(state.counts).reduce((a, b) => a + b, 0);

      return jsonResponse({
        ok: true,
        login: phone,
        token,
        profile: {
          phone,
          fullName,
          group,
          notBmstu,
          supporterOf,
        },
        my_vote: null,
        counts: null,
        total,
        cabinet_notice: "В личном кабинете скоро появятся лист рассадки и данные о входе в БЗДК",
      });
    }

    // 2. ВХОД В ЛИЧНЫЙ КАБИНЕТ
    if (action === "login") {
      const rawLogin = String(body.login || body.phone || "").trim().slice(0, 64);
      const normPhone = normalizePhone(rawLogin);
      const loginKey = (normPhone || rawLogin).toLowerCase();
      const password = String(body.password || "").trim().slice(0, 128);
      const rlKey = getRateLimitKey(req, loginKey);

      if (isRateLimited(rlKey, 5, 300000)) {
        return jsonResponse(
          { ok: false, error: "Слишком много неудачных попыток входа. Попробуйте через 5 минут." },
          429
        );
      }

      if (!SAFE_LOGIN_RE.test(loginKey)) {
        recordAttempt(rlKey);
        return jsonResponse({ ok: false, error: "Неверный номер телефона или пароль" }, 401);
      }

      const userAccount = await findUserAccount(store, rawLogin);
      const valid =
        userAccount &&
        userAccount.password_sha256 &&
        verifyPasswordHash(password, userAccount.password_sha256);

      if (!valid) {
        recordAttempt(rlKey);
        return jsonResponse(
          { ok: false, error: "Неверный номер телефона или пароль" },
          401
        );
      }

      resetRateLimit(rlKey);
      const canonicalLogin = userAccount.login;
      const token = createToken(canonicalLogin);

      const voterData = await store.get(`voter:${canonicalLogin}`, { type: "json" });
      const myVote = voterData ? voterData.candidateId : null;

      const state = await getCachedState(store);
      const total = Object.values(state.counts).reduce((a, b) => a + b, 0);

      return jsonResponse({
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
      if (checkAndRecordRate(`vote:${clientIp}`, 12, 60000)) {
        return jsonResponse(
          { ok: false, error: "Слишком много запросов на голосование. Подождите минуту." },
          429
        );
      }

      const rawLogin = String(body.login || "").trim().slice(0, 64);
      const normPhone = normalizePhone(rawLogin);
      const expectedLogin = normPhone || rawLogin;
      const token = String(body.token || "").trim().slice(0, 256);
      const authenticatedLogin = verifyToken(token);

      if (!authenticatedLogin || authenticatedLogin.toLowerCase() !== expectedLogin.toLowerCase()) {
        return jsonResponse(
          { ok: false, error: "Сессия истекла или недействительна. Войдите в личный кабинет." },
          401
        );
      }

      const candidateId = String(body.id || "").trim();
      if (!VALID_IDS.has(candidateId)) {
        return jsonResponse(
          { ok: false, error: "Некорректный кандидат" },
          400
        );
      }

      const voterKey = `voter:${authenticatedLogin}`;
      const existingVote = await store.get(voterKey, { type: "json" });
      const state = await getCachedState(store, true);

      if (existingVote) {
        return jsonResponse(
          {
            ok: false,
            error: "Вы уже голосовали в этом конкурсе",
            my_vote: existingVote.candidateId,
            counts: state.counts,
          },
          409
        );
      }

      await store.setJSON(voterKey, {
        candidateId,
        ts: Date.now(),
      });

      state.counts[candidateId] = (state.counts[candidateId] || 0) + 1;
      await store.setJSON("state", state);
      STATE_CACHE = { ts: Date.now(), state };

      const total = Object.values(state.counts).reduce((a, b) => a + b, 0);

      return jsonResponse({
        ok: true,
        login: authenticatedLogin,
        token,
        my_vote: candidateId,
        counts: state.counts,
        total,
      });
    }

    return jsonResponse({ ok: false, error: "Неизвестное действие" }, 400);
  }

  // 4. ПОЛУЧЕНИЕ СОСТОЯНИЯ И ПРОФИЛЯ (GET)
  const token = (url.searchParams.get("token") || "").trim().slice(0, 256);
  const rawLogin = (url.searchParams.get("login") || "").trim().slice(0, 64);
  if (detectSqlInjection(token, rawLogin)) {
    banIp(clientIp, 300000);
    return jsonResponse({ ok: false, error: "Недопустимые параметры запроса" }, 400);
  }

  const normPhone = normalizePhone(rawLogin);
  const expectedLogin = normPhone || rawLogin;
  const authenticatedLogin = token ? verifyToken(token) : null;

  const state = await getCachedState(store);

  let myVote = null;
  let profile = null;
  if (authenticatedLogin && authenticatedLogin.toLowerCase() === expectedLogin.toLowerCase()) {
    const voterData = await store.get(`voter:${authenticatedLogin}`, { type: "json" });
    myVote = voterData ? voterData.candidateId : null;
    const userAccount = await findUserAccount(store, authenticatedLogin);
    profile = formatPublicProfile(userAccount);
  }

  const total = Object.values(state.counts).reduce((a, b) => a + b, 0);

  return jsonResponse({
    counts: myVote ? state.counts : null,
    my_vote: myVote,
    total,
    login: authenticatedLogin || null,
    profile,
  });
};
