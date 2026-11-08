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

// 6 фиксированных аккаунтов администраторов (без возможности регистрации новых админов)
const ADMIN_ACCOUNTS = {
  admin1:
    "pbkdf2$100000$4db9e2f225847f883c894a966ac4a0c5$7e209fb9a8f177efeb51db9a6522f2152f432fc2a5569a00ebbc10ef7feb8ac8",
  admin2:
    "pbkdf2$100000$d814c41b90647a6f84b7c69e67f7f2d0$0f36939d2d296036c0649076e052c71eea79913a563dc8bdf8d5f69388ddca9e",
  admin3:
    "pbkdf2$100000$d57aa932d631aadebe2a95eff487ed57$4a535914707c641cbb2209d7590a7857f539d852cb7e183706781ec175c99ee0",
  admin4:
    "pbkdf2$100000$353d65a24ce027f8726388017dfbac7a$17860788cc28d6ebae58e4294d508bc50310982a0b974ce16652dd759322d7a1",
  admin5:
    "pbkdf2$100000$ac4b4d3def91f2890392f3c25094198a$c32225d0190618a7184809a05d1bd09450e634df5ae85f93bf65741b0b19593a",
  admin6:
    "pbkdf2$100000$900e239b6b7778e8a3f741dac75f547a$05c9ee2e34cfc1bd1699ddbcefba9e6031161d20952c2d0873607ff5149fb8f2",
};

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

const SUPPORTER_TO_CANDIDATE = {
  "Гузько Никита Андреевич": "f1",
  "Аксенова Алевтина Александровна": "f2",
  "Загирова Алина Тимуровна": "f3",
  "Щетанова Полина Денисовна": "f4",
  "Амиров Руслан Рустемович": "f5",
  "Кузьмичев Максим Олегович": "f6",
  "Шумилина Екатерина Владимировна": "f7",
  "Портузенков Ильяс Рафаэлевич": "f8",
  "Данилина Дарья Алексеевна": "f9",
};

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

let STATE_CACHE = { ts: 0, state: null };
const STATE_CACHE_TTL_MS = 1500;
let ADMIN_USERS_CACHE = { ts: 0, users: null };
const ADMIN_USERS_CACHE_TTL_MS = 2500;

const SQLI_PATTERN =
  /(\b(union\s+all\s+select|union\s+select|select\s+.+\s+from|insert\s+into|update\s+.+\s+set|delete\s+from|drop\s+table|alter\s+table|truncate\s+table|sqlite_master|sqlite_temp_master|information_schema|sleep\s*\(|benchmark\s*\(|waitfor\s+delay|load_file\s*\(|into\s+outfile|attach\s+database|pragma\s+)\b|('|")\s*(or|and)\s*('|"|\d)|\b(or|and)\s+1\s*=\s*1\b|--\s|--$|\/\*|\*\/|;\s*(select|drop|insert|update|delete))/i;

const SAFE_LOGIN_RE = /^(\+[0-9]{10,15}|[a-z0-9_.+-]{3,64})$/;
const SAFE_NAME_RE = /^[а-яА-ЯёЁa-zA-Z\s-]{3,140}$/;
const SAFE_GROUP_RE = /^[а-яА-ЯёЁa-zA-Z0-9\s\-/]{1,60}$/;

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

function validateRussianPhone(raw) {
  const s = String(raw || "").trim();
  if (Object.prototype.hasOwnProperty.call(ADMIN_ACCOUNTS, s.toLowerCase())) {
    return { valid: false, error: "Логин администратора нельзя использовать для регистрации зрителя" };
  }
  if (s.startsWith("+") && !s.startsWith("+7")) {
    return { valid: false, error: "Регистрация доступна только для российских номеров телефонов (+7)" };
  }
  const digits = s.replace(/\D/g, "");
  let national = "";
  if (digits.length === 11) {
    if (digits[0] !== "7" && digits[0] !== "8") {
      return { valid: false, error: "Российский номер телефона должен начинаться с +7 или 8" };
    }
    national = digits.slice(1);
  } else if (digits.length === 10) {
    national = digits;
  } else {
    return { valid: false, error: "Номер должен содержать ровно 10 цифр после кода страны (+7 (9XX) XXX-XX-XX)" };
  }

  if (!/^[3489]/.test(national)) {
    return { valid: false, error: "Неверный код оператора РФ (ожидается мобильный номер +7 9XX)" };
  }

  return { valid: true, normalized: "+7" + national };
}

function normalizePhone(raw) {
  const str = String(raw || "").trim();
  if (Object.prototype.hasOwnProperty.call(ADMIN_ACCOUNTS, str.toLowerCase())) {
    return "";
  }
  const digits = str.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("8") || digits.startsWith("7"))) {
    return "+7" + digits.slice(1);
  }
  if (digits.length === 10 && /^[3489]/.test(digits)) {
    return "+7" + digits;
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
  const expiry = Math.floor(Date.now() / 1000) + 86400 * 7;
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
  return login.toLowerCase();
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

function deriveDeterministicUserId(login) {
  const norm = String(login || "").trim().toLowerCase();
  const digest = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(`uid4:${norm}`)
    .digest();
  const num = (digest.readUInt32BE(0) % 9000) + 1000;
  return String(num);
}

async function allocateUniqueUserId(store, login) {
  const norm = String(login || "").trim().toLowerCase();
  const baseNum = parseInt(deriveDeterministicUserId(norm), 10);
  let idMap = null;
  try {
    idMap = await store.get("user_id_map", { type: "json" });
  } catch {
    idMap = null;
  }
  if (!idMap || typeof idMap !== "object" || Array.isArray(idMap)) {
    idMap = {};
  }
  for (const [uid, owner] of Object.entries(idMap)) {
    if (String(owner).toLowerCase() === norm && /^\d{4}$/.test(uid)) {
      return uid;
    }
  }
  for (let offset = 0; offset < 9000; offset++) {
    const candidate = String(((baseNum - 1000 + offset) % 9000) + 1000);
    const existingOwner = idMap[candidate];
    if (!existingOwner || String(existingOwner).toLowerCase() === norm) {
      idMap[candidate] = norm;
      try {
        await store.setJSON("user_id_map", idMap);
      } catch {}
      return candidate;
    }
  }
  return String(baseNum);
}

async function findUserAccount(store, rawLogin) {
  const normPhone = normalizePhone(rawLogin);
  const lookupKey = (normPhone || String(rawLogin || "").trim()).toLowerCase();
  if (!lookupKey || !SAFE_LOGIN_RE.test(lookupKey)) return null;

  const blobUser = await store.get(`user:${lookupKey}`, { type: "json" });
  if (blobUser) {
    let userId =
      blobUser.userId && /^\d{4}$/.test(String(blobUser.userId))
        ? String(blobUser.userId)
        : "";
    if (!userId) {
      userId = await allocateUniqueUserId(store, lookupKey);
      blobUser.userId = userId;
      try {
        await store.setJSON(`user:${lookupKey}`, blobUser);
      } catch {}
    }
    return {
      ...blobUser,
      userId,
      fullName: decryptField(blobUser.fullName),
      group: decryptField(blobUser.group),
      supporterOf: decryptField(blobUser.supporterOf),
      present: Boolean(blobUser.present),
      verifiedBy: String(blobUser.verifiedBy || ""),
    };
  }

  const dbUsers = (await store.get("users", { type: "json" })) || defaultUsers;
  if (Array.isArray(dbUsers)) {
    const found = dbUsers.find(
      (u) => String(u.login || "").toLowerCase() === lookupKey.toLowerCase()
    );
    if (found) {
      return {
        login: found.login,
        phone: found.phone || found.login,
        userId: String(found.userId || deriveDeterministicUserId(found.login)),
        fullName: found.fullName || found.login,
        group: found.group || "МГТУ им. Н.Э. Баумана",
        notBmstu: Boolean(found.notBmstu),
        supporterOf: found.supporterOf || "Просто зритель",
        present: Boolean(found.present),
        verifiedBy: String(found.verifiedBy || ""),
        password_sha256: found.password_sha256,
      };
    }
  }
  return null;
}

async function listAllUsersForAdmin(store, forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && ADMIN_USERS_CACHE.users && now - ADMIN_USERS_CACHE.ts < ADMIN_USERS_CACHE_TTL_MS) {
    return ADMIN_USERS_CACHE.users;
  }

  const loginsSet = new Set();
  const indexList = (await store.get("user_index", { type: "json" })) || [];
  if (Array.isArray(indexList)) {
    for (const lg of indexList) {
      if (lg && typeof lg === "string") loginsSet.add(lg.toLowerCase());
    }
  }

  try {
    if (typeof store.list === "function") {
      const listed = await store.list({ prefix: "user:" });
      if (listed && Array.isArray(listed.blobs)) {
        for (const b of listed.blobs) {
          if (b && typeof b.key === "string" && b.key.startsWith("user:")) {
            loginsSet.add(b.key.slice(5).toLowerCase());
          }
        }
      }
    }
  } catch {
    // fallback to user_index
  }

  const allLogins = [...loginsSet].filter(
    (lg) => !Object.prototype.hasOwnProperty.call(ADMIN_ACCOUNTS, lg)
  );
  const users = [];
  const BATCH_SIZE = 30;

  for (let i = 0; i < allLogins.length; i += BATCH_SIZE) {
    const batch = allLogins.slice(i, i + BATCH_SIZE);
    const batchItems = await Promise.all(
      batch.map(async (lg) => {
        const [u, voterData] = await Promise.all([
          store.get(`user:${lg}`, { type: "json" }),
          store.get(`voter:${lg}`, { type: "json" }),
        ]);
        if (!u) return null;
        let userId =
          u.userId && /^\d{4}$/.test(String(u.userId))
            ? String(u.userId)
            : "";
        if (!userId) {
          userId = deriveDeterministicUserId(u.login || lg);
          u.userId = userId;
          try {
            await store.setJSON(`user:${lg}`, u);
          } catch {}
        }
        const notBmstu = Boolean(u.notBmstu);
        const decName = decryptField(u.fullName) || lg;
        const decGroup = decryptField(u.group) || "";
        const decSupporter = decryptField(u.supporterOf) || "Просто зритель";
        return {
          login: u.login || lg,
          phone: u.phone || u.login || lg,
          userId,
          fullName: decName,
          group: notBmstu ? "Не из МГТУ им. Н.Э. Баумана" : decGroup,
          notBmstu,
          supporterOf: decSupporter,
          present: Boolean(u.present),
          verifiedBy: String(u.verifiedBy || ""),
          hasVoted: Boolean(voterData && voterData.candidateId),
          createdAt: Number(u.createdAt || 0),
        };
      })
    );
    for (const item of batchItems) {
      if (item) users.push(item);
    }
  }

  users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  ADMIN_USERS_CACHE = { ts: Date.now(), users };
  return users;
}

function formatPublicProfile(userObj) {
  if (!userObj) return null;
  const fallbackLogin = userObj.login || userObj.phone || "";
  const supp = userObj.supporterOf || "";
  const cid = userObj.candidateId || SUPPORTER_TO_CANDIDATE[supp] || "";
  return {
    userId: String(
      userObj.userId || (fallbackLogin ? deriveDeterministicUserId(fallbackLogin) : "")
    ),
    candidateId: cid,
    phone: userObj.phone || userObj.login,
    fullName: userObj.fullName || "",
    group: userObj.notBmstu ? "Не из МГТУ им. Н.Э. Баумана" : userObj.group || "",
    notBmstu: Boolean(userObj.notBmstu),
    supporterOf: supp,
    present: Boolean(userObj.present),
    verifiedBy: String(userObj.verifiedBy || ""),
  };
}

export default async (req) => {
  const clientIp = getClientIp(req);

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

  if (checkAndRecordRate(`burst:${clientIp}`, 400, 10000)) {
    banIp(clientIp, 60000);
    return jsonResponse(
      { ok: false, error: "Слишком много запросов (защита от DDoS). Подождите минуту." },
      429,
      { "Retry-After": "60" }
    );
  }

  const isPost = req.method === "POST";
  const rateBucket = isPost ? `api_post:${clientIp}` : `api_get:${clientIp}`;
  const rateLimitMax = isPost ? 250 : 600;
  if (checkAndRecordRate(rateBucket, rateLimitMax, 60000)) {
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
        body.target_login,
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

    // 1. РЕГИСТРАЦИЯ В ЛИЧНОМ КАБИНЕТЕ (ТОЛЬКО ДЛЯ УЧАСТНИКОВ/ЗРИТЕЛЕЙ, НЕ ДЛЯ АДМИНОВ)
    if (action === "register") {
      const regRlKey = `reg:${clientIp}`;
      if (isRateLimited(regRlKey, 120, 300000)) {
        return jsonResponse(
          { ok: false, error: "Слишком много запросов на регистрацию. Подождите 5 минут." },
          429
        );
      }

      const rawPhone = String(body.phone || body.login || "").trim().slice(0, 64);
      if (Object.prototype.hasOwnProperty.call(ADMIN_ACCOUNTS, rawPhone.toLowerCase())) {
        return jsonResponse(
          { ok: false, error: "Регистрация аккаунтов администраторов запрещена." },
          400
        );
      }

      const phoneCheck = validateRussianPhone(rawPhone);
      if (!phoneCheck.valid) {
        return jsonResponse(
          { ok: false, error: phoneCheck.error },
          400
        );
      }
      const phone = phoneCheck.normalized;
      const fullName = sanitizeText(body.fullName, 140);
      const notBmstu = Boolean(body.notBmstu);
      const rawGroup = sanitizeText(body.group, 60);
      const group = notBmstu ? "Не из МГТУ им. Н.Э. Баумана" : rawGroup;
      const supporterOf = sanitizeText(body.supporterOf, 80);
      const password = String(body.password || "").trim();

      if (!SAFE_LOGIN_RE.test(phone.toLowerCase())) {
        return jsonResponse(
          { ok: false, error: "Некорректный формат номера телефона" },
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

      const userId = await allocateUniqueUserId(store, phone);
      const candidateId = SUPPORTER_TO_CANDIDATE[supporterOf] || "";

      const storedRecord = {
        login: phone,
        phone,
        userId,
        candidateId,
        fullName: encryptField(fullName),
        group: encryptField(group),
        notBmstu,
        supporterOf: encryptField(supporterOf),
        present: false,
        verifiedBy: "",
        password_sha256: createPasswordHash(password),
        createdAt: Date.now(),
      };

      await store.setJSON(`user:${phone}`, storedRecord);
      ADMIN_USERS_CACHE = { ts: 0, users: null };

      const indexList = (await store.get("user_index", { type: "json" })) || [];
      if (Array.isArray(indexList) && !indexList.includes(phone)) {
        indexList.push(phone);
        await store.setJSON("user_index", indexList);
      }

      const token = createToken(phone);
      const state = await getCachedState(store);
      const total = Object.values(state.counts).reduce((a, b) => a + b, 0);

      return jsonResponse({
        ok: true,
        login: phone,
        is_admin: false,
        token,
        profile: {
          userId,
          candidateId,
          phone,
          fullName,
          group,
          notBmstu,
          supporterOf,
          present: false,
          verifiedBy: "",
        },
        my_vote: candidateId || null,
        counts: state.counts,
        total,
        cabinet_notice: "В личном кабинете скоро появятся лист рассадки и данные о входе в БЗДК",
      });
    }

    // 2. ВХОД В ЛИЧНЫЙ КАБИНЕТ (ЗРИТЕЛЬ ИЛИ АДМИНИСТРАТОР)
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
        return jsonResponse({ ok: false, error: "Неверный логин (номер телефона) или пароль" }, 401);
      }

      // Вход для 6 фиксированных аккаунтов администраторов
      if (Object.prototype.hasOwnProperty.call(ADMIN_ACCOUNTS, loginKey)) {
        if (!verifyPasswordHash(password, ADMIN_ACCOUNTS[loginKey])) {
          recordAttempt(rlKey);
          return jsonResponse({ ok: false, error: "Неверный логин администратора или пароль" }, 401);
        }

        resetRateLimit(rlKey);
        const token = createToken(loginKey);
        const state = await getCachedState(store);
        const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
        const adminUsers = await listAllUsersForAdmin(store);

        return jsonResponse({
          ok: true,
          login: loginKey,
          is_admin: true,
          token,
          profile: {
            phone: loginKey,
            fullName: `Администратор (${loginKey})`,
            group: "Оргкомитет / Администратор",
            notBmstu: false,
            supporterOf: "Администратор",
            present: true,
            isAdmin: true,
          },
          users: adminUsers,
          my_vote: null,
          counts: state.counts,
          total,
          cabinet_notice: "В личном кабинете скоро появятся лист рассадки и данные о входе в БЗДК",
        });
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
        is_admin: false,
        token,
        profile: formatPublicProfile(userAccount),
        my_vote: myVote,
        counts: myVote ? state.counts : null,
        total,
        cabinet_notice: "В личном кабинете скоро появятся лист рассадки и данные о входе в БЗДК",
      });
    }

    // 3. АДМИН-ПАНЕЛЬ: СПИСОК ПОЛЬЗОВАТЕЛЕЙ И ПОДТВЕРЖДЕНИЕ ПРИСУТСТВИЯ
    if (action === "admin_list" || action === "admin_set_presence") {
      const token = String(body.token || "").trim().slice(0, 256);
      const authenticatedLogin = verifyToken(token);
      if (
        !authenticatedLogin ||
        !Object.prototype.hasOwnProperty.call(ADMIN_ACCOUNTS, authenticatedLogin)
      ) {
        return jsonResponse(
          { ok: false, error: "Доступ разрешён только авторизованным администраторам" },
          403
        );
      }

      if (action === "admin_set_presence") {
        const rawTarget = String(body.target_login || "").trim().slice(0, 64);
        const normTarget = normalizePhone(rawTarget);
        const targetLogin = (normTarget || rawTarget).toLowerCase();
        const presentVal = Boolean(body.present);

        if (!targetLogin || !SAFE_LOGIN_RE.test(targetLogin)) {
          return jsonResponse({ ok: false, error: "Некорректный логин пользователя" }, 400);
        }

        const existingRecord = await store.get(`user:${targetLogin}`, { type: "json" });
        if (!existingRecord) {
          return jsonResponse({ ok: false, error: "Пользователь не найден" }, 404);
        }

        existingRecord.present = presentVal;
        existingRecord.verifiedBy = presentVal ? authenticatedLogin : "";
        await store.setJSON(`user:${targetLogin}`, existingRecord);
        ADMIN_USERS_CACHE = { ts: 0, users: null };
      }

      const adminUsers = await listAllUsersForAdmin(store, true);
      const freshCounts = { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0, f7: 0, f8: 0, f9: 0 };
      for (const u of adminUsers) {
        if (u.present && u.candidateId && freshCounts[u.candidateId] !== undefined) {
          freshCounts[u.candidateId]++;
        }
      }
      const state = { counts: freshCounts };
      await store.setJSON("state", state);
      STATE_CACHE = { ts: Date.now(), state };
      const total = Object.values(freshCounts).reduce((a, b) => a + b, 0);

      return jsonResponse({
        ok: true,
        is_admin: true,
        login: authenticatedLogin,
        users: adminUsers,
        counts: freshCounts,
        total,
      });
    }

    // 4. ГОЛОСОВАНИЕ ПО КНОПКЕ ОТКЛЮЧЕНО (ГОЛОС ПРИНИМАЕТСЯ ПРИ РЕГИСТРАЦИИ И АВТОРИЗУЕТСЯ АДМИНОМ)
    if (action === "vote") {
      return jsonResponse(
        {
          ok: false,
          error: "Голосование по кнопке отключено. Ваш голос принимается при регистрации за выбранного кандидата и учитывается после подтверждения присутствия администратором в БЗДК.",
        },
        400
      );
    }

    return jsonResponse({ ok: false, error: "Неизвестное действие" }, 400);
  }

  // 5. ПОЛУЧЕНИЕ СОСТОЯНИЯ И ПРОФИЛЯ (GET)
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
  let isAdmin = false;
  let adminUsers = null;

  if (authenticatedLogin && authenticatedLogin.toLowerCase() === expectedLogin.toLowerCase()) {
    if (Object.prototype.hasOwnProperty.call(ADMIN_ACCOUNTS, authenticatedLogin)) {
      isAdmin = true;
      profile = {
        phone: authenticatedLogin,
        fullName: `Администратор (${authenticatedLogin})`,
        group: "Оргкомитет / Администратор",
        notBmstu: false,
        supporterOf: "Администратор",
        present: true,
        isAdmin: true,
      };
      adminUsers = await listAllUsersForAdmin(store);
    } else {
      const userAccount = await findUserAccount(store, authenticatedLogin);
      profile = formatPublicProfile(userAccount);
      myVote = (profile && profile.candidateId) || null;
    }
  }

  const total = Object.values(state.counts).reduce((a, b) => a + b, 0);

  return jsonResponse({
    counts: state.counts,
    my_vote: myVote,
    total,
    login: authenticatedLogin || null,
    is_admin: isAdmin,
    profile,
    users: adminUsers,
  });
};
