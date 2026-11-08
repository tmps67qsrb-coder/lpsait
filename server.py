#!/usr/bin/env python3
"""
Локальный сервер конкурса «Лучший профорг — 2026».
- Раздаёт статику сайта (с защитой служебных файлов и исходников).
- Обрабатывает регистрацию и вход в Личный кабинет по номеру телефона и паролю.
- Содержит 6 фиксированных аккаунтов администраторов (admin1..admin6, без регистрации админов).
- Право на голосование открывается только при одновременном выполнении двух условий:
  1) Обязательная регистрация пользователя в Личном кабинете;
  2) Подтверждение присутствия пользователя администратором через ЛК админа.
- Пароли хэшируются алгоритмом PBKDF2-HMAC-SHA256 (100 000 итераций + индивидуальная соль).
- Персональные данные (ФИО, группа, за кого болеет) шифруются перед записью в БД с проверкой целостности (HMAC-SHA256).
- Многоуровневая защита от DDoS/DoS-атак и SQL-инъекций.
"""

import hashlib
import hmac
import json
import os
import re
import sqlite3
import sys
import threading
import time
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "votes.db")
USERS_JSON_PATH = os.path.join(BASE_DIR, "netlify", "functions", "users.json")
VALID_IDS = {f"f{i}" for i in range(1, 10)}
SECRET_KEY = os.environ.get("VOTE_SECRET", "lp2026_bmstu_proforg_session_secret_983").encode("utf-8")
ENC_KEY = hashlib.sha256(SECRET_KEY).digest()
PBKDF2_ITERATIONS = 100000
DB_LOCK = threading.Lock()

# Ограничение числа одновременных тяжёлых операций PBKDF2 и подключений (защита от CPU/Thread DoS)
CRYPTO_SEMAPHORE = threading.BoundedSemaphore(4)
CONN_SEMAPHORE = threading.BoundedSemaphore(64)
MAX_BODY_BYTES = 4096
MAX_URI_LEN = 512

# 6 фиксированных аккаунтов администраторов (без возможности регистрации новых админов)
ADMIN_ACCOUNTS = {
    "admin1": "pbkdf2$100000$4db9e2f225847f883c894a966ac4a0c5$7e209fb9a8f177efeb51db9a6522f2152f432fc2a5569a00ebbc10ef7feb8ac8",
    "admin2": "pbkdf2$100000$d814c41b90647a6f84b7c69e67f7f2d0$0f36939d2d296036c0649076e052c71eea79913a563dc8bdf8d5f69388ddca9e",
    "admin3": "pbkdf2$100000$d57aa932d631aadebe2a95eff487ed57$4a535914707c641cbb2209d7590a7857f539d852cb7e183706781ec175c99ee0",
    "admin4": "pbkdf2$100000$353d65a24ce027f8726388017dfbac7a$17860788cc28d6ebae58e4294d508bc50310982a0b974ce16652dd759322d7a1",
    "admin5": "pbkdf2$100000$ac4b4d3def91f2890392f3c25094198a$c32225d0190618a7184809a05d1bd09450e634df5ae85f93bf65741b0b19593a",
    "admin6": "pbkdf2$100000$900e239b6b7778e8a3f741dac75f547a$05c9ee2e34cfc1bd1699ddbcefba9e6031161d20952c2d0873607ff5149fb8f2",
}

VALID_SUPPORTERS = {
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
}

CABINET_NOTICE = "В личном кабинете скоро появятся лист рассадки и данные о входе в БЗДК"

# ============================================================
# ЗАЩИТА ОТ DDOS / FLOOD И АВТО-БЛОКИРОВКА IP
# ============================================================
FAILED_ATTEMPTS = {}
BANNED_IPS = {}
RATE_LOCK = threading.Lock()
MAX_TRACKED_KEYS = 5000

# Короткоживущий кэш счётчиков голосов (снижает нагрузку на SQLite при пиковом трафике в зале)
COUNTS_CACHE = {"ts": 0.0, "counts": None, "total": 0}
COUNTS_CACHE_TTL = 1.5

# Регулярное выражение WAF для перехвата попыток SQL-инъекций
SQLI_PATTERN = re.compile(
    r"(?i)(\b(union\s+all\s+select|union\s+select|select\s+.+\s+from|insert\s+into|"
    r"update\s+.+\s+set|delete\s+from|drop\s+table|alter\s+table|truncate\s+table|"
    r"sqlite_master|sqlite_temp_master|information_schema|sleep\s*\(|benchmark\s*\(|"
    r"waitfor\s+delay|load_file\s*\(|into\s+outfile|attach\s+database|pragma\s+)\b|"
    r"('|\")\s*(or|and)\s*('|\"|\d)|\b(or|and)\s+1\s*=\s*1\b|--\s|--$|/\*|\*/|;\s*(select|drop|insert|update|delete))",
)

SAFE_LOGIN_RE = re.compile(r"^(\+[0-9]{10,15}|[a-z0-9_.+-]{3,64})$")
SAFE_NAME_RE = re.compile(r"^[а-яА-ЯёЁa-zA-Z\s\-]{3,140}$")
SAFE_GROUP_RE = re.compile(r"^[а-яА-ЯёЁa-zA-Z0-9\s\-/]{1,60}$")


def detect_sql_injection(*values) -> bool:
    """Проверяет входные значения на наличие SQL-инъекций и опасных последовательностей."""
    for val in values:
        if val is None:
            continue
        s = str(val)
        if "\x00" in s or SQLI_PATTERN.search(s):
            return True
    return False


def _prune_dict(store: dict, now: float):
    if len(store) <= MAX_TRACKED_KEYS:
        return
    excess = len(store) - (MAX_TRACKED_KEYS // 2)
    for k in list(store.keys())[:excess]:
        store.pop(k, None)


def is_ip_banned(ip: str) -> int:
    now = time.time()
    with RATE_LOCK:
        until = BANNED_IPS.get(ip, 0)
        if until > now:
            return int(until - now) + 1
        if until:
            BANNED_IPS.pop(ip, None)
        return 0


def ban_ip(ip: str, duration_sec: int = 300):
    now = time.time()
    with RATE_LOCK:
        _prune_dict(BANNED_IPS, now)
        BANNED_IPS[ip] = now + duration_sec


def check_and_record_rate(key: str, max_attempts: int, window_sec: int) -> bool:
    now = time.time()
    with RATE_LOCK:
        _prune_dict(FAILED_ATTEMPTS, now)
        times = [t for t in FAILED_ATTEMPTS.get(key, []) if now - t < window_sec]
        if len(times) >= max_attempts:
            FAILED_ATTEMPTS[key] = times
            return True
        times.append(now)
        FAILED_ATTEMPTS[key] = times
        return False


def is_rate_limited(key: str, max_attempts: int = 5, window_sec: int = 300) -> bool:
    now = time.time()
    with RATE_LOCK:
        times = [t for t in FAILED_ATTEMPTS.get(key, []) if now - t < window_sec]
        FAILED_ATTEMPTS[key] = times
        return len(times) >= max_attempts


def record_attempt(key: str, window_sec: int = 300):
    now = time.time()
    with RATE_LOCK:
        _prune_dict(FAILED_ATTEMPTS, now)
        times = [t for t in FAILED_ATTEMPTS.get(key, []) if now - t < window_sec]
        times.append(now)
        FAILED_ATTEMPTS[key] = times


def reset_rate_limit(key: str):
    with RATE_LOCK:
        FAILED_ATTEMPTS.pop(key, None)


def sanitize_text(val: str, max_len: int = 140) -> str:
    cleaned = re.sub(r"[\x00-\x1f\x7f<>'\";`\\]", "", str(val or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:max_len]


def normalize_phone(raw: str) -> str:
    s = str(raw or "").strip()
    if s.lower() in ADMIN_ACCOUNTS:
        return ""
    digits = re.sub(r"\D", "", s)
    if len(digits) == 11 and digits[0] in ("7", "8"):
        return "+7" + digits[1:]
    if len(digits) == 10 and digits.startswith("9"):
        return "+7" + digits
    if 10 <= len(digits) <= 15:
        return "+" + digits
    return ""


def validate_password_format(password: str):
    pwd = str(password or "")
    if len(pwd) < 8:
        return "Пароль должен содержать минимум 8 символов"
    if len(pwd) > 128:
        return "Пароль не должен превышать 128 символов"
    if re.search(r"[а-яА-ЯёЁ]", pwd):
        return "Пароль должен содержать только английские буквы (без русских символов)"
    if not re.search(r"[a-zA-Z]", pwd):
        return "Пароль должен содержать английские буквы"
    if not re.search(r"[^a-zA-Z0-9\s]", pwd):
        return "Пароль должен содержать хотя бы один специальный знак (например: ! @ # $ % ^ & * _ - + =)"
    return None


def create_password_hash(password: str) -> str:
    pwd_bytes = password.strip()[:128].encode("utf-8")
    salt = os.urandom(16).hex()
    with CRYPTO_SEMAPHORE:
        derived = hashlib.pbkdf2_hmac(
            "sha256",
            pwd_bytes,
            salt.encode("utf-8"),
            PBKDF2_ITERATIONS,
            dklen=32,
        ).hex()
    return f"pbkdf2${PBKDF2_ITERATIONS}${salt}${derived}"


def verify_password_hash(password: str, stored_hash: str) -> bool:
    if not password or not stored_hash or len(password) > 128:
        return False
    pwd = password.strip().encode("utf-8")
    stored = stored_hash.strip()

    if stored.startswith("pbkdf2$"):
        parts = stored.split("$")
        if len(parts) != 4:
            return False
        try:
            iterations = min(max(int(parts[1]), 1000), 300000)
            salt = parts[2]
            expected_hex = parts[3]
            with CRYPTO_SEMAPHORE:
                derived = hashlib.pbkdf2_hmac(
                    "sha256", pwd, salt.encode("utf-8"), iterations, dklen=32
                ).hex()
            return hmac.compare_digest(derived.lower(), expected_hex.lower())
        except Exception:
            return False

    legacy_sha = hashlib.sha256(pwd).hexdigest()
    return hmac.compare_digest(legacy_sha.lower(), stored.lower())


def _keystream(nonce: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        block = hmac.new(ENC_KEY, nonce + counter.to_bytes(4, "big"), hashlib.sha256).digest()
        out.extend(block)
        counter += 1
    return bytes(out[:length])


def encrypt_field(plain_text: str) -> str:
    text = str(plain_text or "")
    if not text:
        return ""
    raw = text.encode("utf-8")
    nonce = os.urandom(12)
    stream = _keystream(nonce, len(raw))
    cipher_bytes = bytes(a ^ b for a, b in zip(raw, stream))
    mac = hmac.new(ENC_KEY, b"enc1" + nonce + cipher_bytes, hashlib.sha256).hexdigest()[:32]
    return f"enc1:{nonce.hex()}:{mac}:{cipher_bytes.hex()}"


def decrypt_field(value: str) -> str:
    val = str(value or "")
    if not val.startswith("enc1:"):
        return val
    parts = val.split(":")
    if len(parts) != 4:
        return ""
    try:
        nonce = bytes.fromhex(parts[1])
        mac = parts[2]
        cipher_bytes = bytes.fromhex(parts[3])
        expected_mac = hmac.new(ENC_KEY, b"enc1" + nonce + cipher_bytes, hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(mac, expected_mac):
            return ""
        stream = _keystream(nonce, len(cipher_bytes))
        plain_bytes = bytes(a ^ b for a, b in zip(cipher_bytes, stream))
        return plain_bytes.decode("utf-8")
    except Exception:
        return ""


def create_token(login: str) -> str:
    expiry = int(time.time()) + 86400 * 7
    data = f"{login}:{expiry}".encode("utf-8")
    sig = hmac.new(SECRET_KEY, data, hashlib.sha256).hexdigest()
    return f"{login}.{expiry}.{sig}"


def verify_token(token: str):
    if not token or not isinstance(token, str) or len(token) > 256:
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    login, expiry_str, sig = parts
    if not SAFE_LOGIN_RE.match(login.lower()):
        return None
    try:
        expiry = int(expiry_str)
    except ValueError:
        return None
    if expiry < int(time.time()):
        return None
    data = f"{login}:{expiry}".encode("utf-8")
    expected_sig = hmac.new(SECRET_KEY, data, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        return None
    return login.lower()


def open_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=FULL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA trusted_schema=OFF")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def derive_deterministic_user_id(login: str) -> str:
    norm = str(login or "").strip().lower()
    digest = hmac.new(SECRET_KEY, f"uid4:{norm}".encode("utf-8"), hashlib.sha256).digest()
    num = (int.from_bytes(digest[:4], "big") % 9000) + 1000
    return str(num)


def generate_unique_user_id(cur: sqlite3.Cursor, login: str) -> str:
    norm = str(login or "").strip().lower()
    base_num = int(derive_deterministic_user_id(norm))
    existing_ids = {
        str(r[0])
        for r in cur.execute(
            "SELECT user_id FROM users WHERE user_id IS NOT NULL AND user_id != '' AND login != ?",
            (norm,),
        ).fetchall()
    }
    for offset in range(9000):
        candidate = str(((base_num - 1000 + offset) % 9000) + 1000)
        if candidate not in existing_ids:
            return candidate
    return str(base_num)


def sync_users_from_json(conn: sqlite3.Connection):
    if not os.path.exists(USERS_JSON_PATH):
        return
    try:
        with open(USERS_JSON_PATH, "r", encoding="utf-8") as f:
            items = json.load(f)
        if not isinstance(items, list):
            return
        cur = conn.cursor()
        for item in items:
            if not isinstance(item, dict):
                continue
            login = str(item.get("login") or "").strip().lower()
            if not SAFE_LOGIN_RE.match(login) or login in ADMIN_ACCOUNTS:
                continue
            pwd_hash = str(item.get("password_sha256") or "").strip()
            if not pwd_hash and item.get("password"):
                pwd_hash = create_password_hash(str(item.get("password")))
            if login and pwd_hash:
                uid = str(item.get("userId") or "") or generate_unique_user_id(cur, login)
                cur.execute(
                    """
                    INSERT INTO users (login, user_id, password_hash, full_name, study_group, not_bmstu, supporter_of, present, verified_by, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(login) DO UPDATE SET password_hash = excluded.password_hash
                    """,
                    (
                        login,
                        uid,
                        pwd_hash,
                        encrypt_field(str(item.get("fullName") or login)),
                        encrypt_field(str(item.get("group") or "МГТУ им. Н.Э. Баумана")),
                        1 if item.get("notBmstu") else 0,
                        encrypt_field(str(item.get("supporterOf") or "Просто зритель")),
                        1 if item.get("present") else 0,
                        str(item.get("verifiedBy") or ""),
                        int(time.time()),
                    ),
                )
        conn.commit()
    except Exception:
        pass


def init_db():
    with DB_LOCK, open_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                login TEXT PRIMARY KEY,
                user_id TEXT DEFAULT '',
                password_hash TEXT NOT NULL,
                full_name TEXT DEFAULT '',
                study_group TEXT DEFAULT '',
                not_bmstu INTEGER DEFAULT 0,
                supporter_of TEXT DEFAULT '',
                present INTEGER DEFAULT 0,
                verified_by TEXT DEFAULT '',
                created_at INTEGER DEFAULT 0
            )
            """
        )
        for col_sql in (
            "ALTER TABLE users ADD COLUMN user_id TEXT DEFAULT ''",
            "ALTER TABLE users ADD COLUMN full_name TEXT DEFAULT ''",
            "ALTER TABLE users ADD COLUMN study_group TEXT DEFAULT ''",
            "ALTER TABLE users ADD COLUMN not_bmstu INTEGER DEFAULT 0",
            "ALTER TABLE users ADD COLUMN supporter_of TEXT DEFAULT ''",
            "ALTER TABLE users ADD COLUMN present INTEGER DEFAULT 0",
            "ALTER TABLE users ADD COLUMN verified_by TEXT DEFAULT ''",
            "ALTER TABLE users ADD COLUMN created_at INTEGER DEFAULT 0",
        ):
            try:
                conn.execute(col_sql)
            except sqlite3.OperationalError:
                pass

        cur = conn.cursor()
        empty_rows = cur.execute(
            "SELECT login FROM users WHERE user_id IS NULL OR user_id = ''"
        ).fetchall()
        for (lg,) in empty_rows:
            uid = generate_unique_user_id(cur, lg)
            cur.execute("UPDATE users SET user_id = ? WHERE login = ?", (uid, lg))
        if empty_rows:
            conn.commit()

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                candidate_id TEXT NOT NULL,
                device_id TEXT NOT NULL UNIQUE,
                cookie_id TEXT NOT NULL,
                fp_ip_hash TEXT DEFAULT '',
                ip TEXT DEFAULT '',
                user_agent TEXT DEFAULT '',
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_votes_candidate ON votes(candidate_id)"
        )
        sync_users_from_json(conn)


def get_user_profile(cur: sqlite3.Cursor, login_key: str):
    if not login_key or not isinstance(login_key, str):
        return None
    clean_login = login_key.strip().lower()
    if not SAFE_LOGIN_RE.match(clean_login):
        return None
    row = cur.execute(
        """
        SELECT login, password_hash, full_name, study_group, not_bmstu, supporter_of, present, verified_by, created_at, user_id
        FROM users WHERE login = ? LIMIT 1
        """,
        (clean_login,),
    ).fetchone()
    if not row:
        return None
    not_bmstu_flag = bool(row[4])
    present_flag = bool(row[6])
    verified_by = str(row[7] or "")
    dec_name = decrypt_field(row[2]) or row[0]
    dec_group = decrypt_field(row[3]) or ""
    dec_supporter = decrypt_field(row[5]) or "Просто зритель"
    user_id = str(row[9] or "").strip()
    if not user_id or not user_id.isdigit() or len(user_id) != 4:
        user_id = generate_unique_user_id(cur, clean_login)
        cur.execute("UPDATE users SET user_id = ? WHERE login = ?", (user_id, clean_login))
    return {
        "login": row[0],
        "password_hash": row[1],
        "profile": {
            "userId": user_id,
            "phone": row[0],
            "fullName": dec_name,
            "group": "Не из МГТУ им. Н.Э. Баумана" if not_bmstu_flag else dec_group,
            "notBmstu": not_bmstu_flag,
            "supporterOf": dec_supporter,
            "present": present_flag,
            "verifiedBy": verified_by,
        },
    }


def list_all_users_for_admin(cur: sqlite3.Cursor) -> list:
    voted_devices = {
        r[0]: r[1]
        for r in cur.execute("SELECT device_id, candidate_id FROM votes").fetchall()
    }
    rows = cur.execute(
        """
        SELECT login, full_name, study_group, not_bmstu, supporter_of, present, verified_by, created_at, user_id
        FROM users
        ORDER BY created_at DESC, login ASC
        """
    ).fetchall()
    result = []
    for row in rows:
        login = row[0]
        if login in ADMIN_ACCOUNTS:
            continue
        not_bmstu_flag = bool(row[3])
        dec_name = decrypt_field(row[1]) or login
        dec_group = decrypt_field(row[2]) or ""
        dec_supporter = decrypt_field(row[4]) or "Просто зритель"
        present_flag = bool(row[5])
        verified_by = str(row[6] or "")
        created_at = int(row[7] or 0)
        user_id = str(row[8] or "").strip()
        if not user_id or not user_id.isdigit() or len(user_id) != 4:
            user_id = generate_unique_user_id(cur, login)
            cur.execute("UPDATE users SET user_id = ? WHERE login = ?", (user_id, login))
        vote_cid = voted_devices.get(f"user:{login.lower()}")
        result.append(
            {
                "login": login,
                "phone": login,
                "userId": user_id,
                "fullName": dec_name,
                "group": "Не из МГТУ им. Н.Э. Баумана" if not_bmstu_flag else dec_group,
                "notBmstu": not_bmstu_flag,
                "supporterOf": dec_supporter,
                "present": present_flag,
                "verifiedBy": verified_by,
                "hasVoted": bool(vote_cid),
                "createdAt": created_at,
            }
        )
    return result


def verify_user(cur: sqlite3.Cursor, login_key: str, password: str):
    if not login_key or not password:
        return None
    user_obj = get_user_profile(cur, login_key)
    if not user_obj:
        return None
    if verify_password_hash(password, user_obj["password_hash"]):
        return user_obj
    return None


def find_existing_vote_by_login(cur: sqlite3.Cursor, login: str):
    if not login or not SAFE_LOGIN_RE.match(login.lower()):
        return None
    row = cur.execute(
        "SELECT candidate_id FROM votes WHERE device_id = ? LIMIT 1",
        (f"user:{login.lower()}",),
    ).fetchone()
    return row[0] if row else None


def get_all_counts(cur: sqlite3.Cursor, use_cache: bool = True):
    now = time.time()
    if use_cache and COUNTS_CACHE["counts"] is not None and (now - COUNTS_CACHE["ts"] < COUNTS_CACHE_TTL):
        return dict(COUNTS_CACHE["counts"])

    counts = {cid: 0 for cid in sorted(VALID_IDS)}
    for cid, cnt in cur.execute(
        "SELECT candidate_id, COUNT(*) FROM votes GROUP BY candidate_id"
    ):
        if cid in counts:
            counts[cid] = int(cnt)

    COUNTS_CACHE["counts"] = dict(counts)
    COUNTS_CACHE["total"] = sum(counts.values())
    COUNTS_CACHE["ts"] = now
    return counts


class ProforgHandler(SimpleHTTPRequestHandler):
    timeout = 5

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-XSS-Protection", "1; mode=block")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self';",
        )
        super().end_headers()

    def _send_json(self, status: int, payload: dict, extra_headers: dict = None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _check_ddos_and_waf(self, is_api: bool = False) -> bool:
        client_ip = self.client_address[0]
        banned_left = is_ip_banned(client_ip)
        if banned_left > 0:
            self._send_json(
                429,
                {"ok": False, "error": f"IP временно заблокирован за подозрительную активность. Подождите {banned_left} сек."},
                {"Retry-After": str(banned_left)},
            )
            return False

        if len(self.path) > MAX_URI_LEN:
            self._send_json(414, {"ok": False, "error": "URI Too Long"})
            return False

        decoded_path = urllib.parse.unquote(self.path)
        if detect_sql_injection(decoded_path):
            ban_ip(client_ip, 300)
            self._send_json(400, {"ok": False, "error": "Обнаружен недопустимый запрос (WAF SQLi Protection)"})
            return False

        if check_and_record_rate(f"burst:{client_ip}", max_attempts=400, window_sec=10):
            ban_ip(client_ip, 60)
            self._send_json(
                429,
                {"ok": False, "error": "Слишком много запросов (защита от DDoS). Подождите минуту."},
                {"Retry-After": "60"},
            )
            return False

        is_post = self.command == "POST"
        rate_bucket = f"api_post:{client_ip}" if is_post else f"api_get:{client_ip}"
        rate_limit_max = 250 if is_post else 600
        if is_api and check_and_record_rate(rate_bucket, max_attempts=rate_limit_max, window_sec=60):
            self._send_json(
                429,
                {"ok": False, "error": "Превышен лимит обращений к API. Пожалуйста, подождите минуту."},
                {"Retry-After": "60"},
            )
            return False

        return True

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        raw_path = urllib.parse.unquote(parsed.path)
        if ".." in raw_path or "\x00" in raw_path:
            self.send_error(403, "Forbidden")
            return
        clean_path = os.path.normpath(raw_path).replace("\\", "/")

        is_api = clean_path == "/api/votes"
        if not self._check_ddos_and_waf(is_api=is_api):
            return

        if is_api:
            qs = urllib.parse.parse_qs(parsed.query)
            token = (qs.get("token", [""])[0] or "").strip()[:256]
            raw_login = (qs.get("login", [""])[0] or "").strip()[:128]

            if detect_sql_injection(token, raw_login):
                ban_ip(self.client_address[0], 300)
                self._send_json(400, {"ok": False, "error": "Недопустимые параметры запроса"})
                return

            norm_phone = normalize_phone(raw_login)
            expected_login = (norm_phone or raw_login).lower()
            authenticated_login = verify_token(token)

            with DB_LOCK, open_db() as conn:
                cur = conn.cursor()
                counts = get_all_counts(cur, use_cache=True)
                my_vote = None
                profile = None
                is_admin = False
                admin_users = None

                if authenticated_login and authenticated_login == expected_login:
                    if authenticated_login in ADMIN_ACCOUNTS:
                        is_admin = True
                        profile = {
                            "phone": authenticated_login,
                            "fullName": f"Администратор ({authenticated_login})",
                            "group": "Оргкомитет / Администратор",
                            "notBmstu": False,
                            "supporterOf": "Администратор",
                            "present": True,
                            "isAdmin": True,
                        }
                        admin_users = list_all_users_for_admin(cur)
                    else:
                        my_vote = find_existing_vote_by_login(cur, authenticated_login)
                        user_obj = get_user_profile(cur, authenticated_login)
                        if user_obj:
                            profile = user_obj["profile"]

            total = sum(counts.values())
            self._send_json(
                200,
                {
                    "counts": counts if (my_vote or is_admin) else None,
                    "my_vote": my_vote,
                    "total": total,
                    "login": authenticated_login,
                    "is_admin": is_admin,
                    "profile": profile,
                    "users": admin_users,
                },
            )
            return

        path_parts = clean_path.strip("/").split("/")
        if any(part.startswith(".") for part in path_parts if part):
            self.send_error(403, "Forbidden")
            return

        blocked_exts = (".py", ".db", ".sqlite", ".json", ".toml", ".yaml", ".yml", ".md", ".sh", ".wal", ".shm")
        if any(clean_path.lower().endswith(ext) for ext in blocked_exts) or ".db-" in clean_path.lower():
            self.send_error(403, "Forbidden")
            return

        if clean_path.startswith("/netlify") or clean_path.startswith("/.git"):
            self.send_error(403, "Forbidden")
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        clean_path = os.path.normpath(urllib.parse.unquote(parsed.path)).replace("\\", "/")

        if not self._check_ddos_and_waf(is_api=True):
            return

        if clean_path != "/api/votes":
            self._send_json(404, {"ok": False, "error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"ok": False, "error": "Invalid Content-Length"})
            return

        if length <= 0 or length > MAX_BODY_BYTES:
            self._send_json(413, {"ok": False, "error": "Payload Too Large or Empty"})
            return

        try:
            raw = self.rfile.read(length)
            data = json.loads(raw.decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("JSON body must be an object")
        except Exception:
            self._send_json(400, {"ok": False, "error": "Invalid JSON"})
            return

        client_ip = self.client_address[0]

        if detect_sql_injection(
            data.get("action"),
            data.get("phone"),
            data.get("login"),
            data.get("target_login"),
            data.get("fullName"),
            data.get("group"),
            data.get("supporterOf"),
            data.get("id"),
            data.get("token"),
        ):
            ban_ip(client_ip, 300)
            self._send_json(
                400,
                {"ok": False, "error": "Запрос заблокирован системой защиты от SQL-инъекций"},
            )
            return

        action = str(data.get("action") or "vote").strip()

        # 1. РЕГИСТРАЦИЯ В ЛИЧНОМ КАБИНЕТЕ (ТОЛЬКО ДЛЯ УЧАСТНИКОВ/ЗРИТЕЛЕЙ, НЕ ДЛЯ АДМИНОВ)
        if action == "register":
            reg_rl_key = f"reg:{client_ip}"
            if is_rate_limited(reg_rl_key, max_attempts=120, window_sec=300):
                self._send_json(
                    429,
                    {"ok": False, "error": "Слишком много запросов на регистрацию. Подождите 5 минут."},
                )
                return

            raw_phone = str(data.get("phone") or data.get("login") or "").strip()[:64]
            if raw_phone.lower() in ADMIN_ACCOUNTS:
                self._send_json(400, {"ok": False, "error": "Регистрация аккаунтов администраторов запрещена."})
                return

            phone = normalize_phone(raw_phone)
            full_name = sanitize_text(data.get("fullName"), 140)
            not_bmstu = bool(data.get("notBmstu"))
            raw_group = sanitize_text(data.get("group"), 60)
            study_group = "Не из МГТУ им. Н.Э. Баумана" if not_bmstu else raw_group
            supporter_of = sanitize_text(data.get("supporterOf"), 80)
            password = str(data.get("password") or "").strip()

            if not phone or not SAFE_LOGIN_RE.match(phone.lower()):
                self._send_json(
                    400,
                    {"ok": False, "error": "Введите корректный номер телефона (например, +7 999 123-45-67)"},
                )
                return
            if len(full_name) < 3 or " " not in full_name or not SAFE_NAME_RE.match(full_name):
                self._send_json(
                    400,
                    {"ok": False, "error": "Введите ваше полное ФИО (только буквы, пробелы и дефис)"},
                )
                return
            if not not_bmstu and (not raw_group or not SAFE_GROUP_RE.match(raw_group)):
                self._send_json(
                    400,
                    {"ok": False, "error": "Укажите корректную учебную группу или выберите «Не из МГТУ им. Н.Э. Баумана»"},
                )
                return
            if not supporter_of or supporter_of not in VALID_SUPPORTERS:
                self._send_json(
                    400,
                    {"ok": False, "error": "Выберите участника, за которого болеете, или «Просто зритель»"},
                )
                return

            pwd_error = validate_password_format(password)
            if pwd_error:
                self._send_json(400, {"ok": False, "error": pwd_error})
                return

            pwd_hash = create_password_hash(password)
            enc_name = encrypt_field(full_name)
            enc_group = encrypt_field(study_group)
            enc_supporter = encrypt_field(supporter_of)

            with DB_LOCK, open_db() as conn:
                cur = conn.cursor()
                existing_user = get_user_profile(cur, phone)
                if existing_user:
                    self._send_json(
                        409,
                        {
                            "ok": False,
                            "error": "Этот номер телефона уже зарегистрирован. Перейдите во вкладку «Вход».",
                        },
                    )
                    return

                record_attempt(reg_rl_key)
                user_id = generate_unique_user_id(cur, phone.lower())

                cur.execute(
                    """
                    INSERT INTO users (login, user_id, password_hash, full_name, study_group, not_bmstu, supporter_of, present, verified_by, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0, '', ?)
                    """,
                    (
                        phone.lower(),
                        user_id,
                        pwd_hash,
                        enc_name,
                        enc_group,
                        1 if not_bmstu else 0,
                        enc_supporter,
                        int(time.time()),
                    ),
                )
                conn.commit()
                counts = get_all_counts(cur, use_cache=True)
                total = sum(counts.values())

            token = create_token(phone.lower())
            self._send_json(
                200,
                {
                    "ok": True,
                    "login": phone.lower(),
                    "is_admin": False,
                    "token": token,
                    "profile": {
                        "userId": user_id,
                        "phone": phone,
                        "fullName": full_name,
                        "group": study_group,
                        "notBmstu": not_bmstu,
                        "supporterOf": supporter_of,
                        "present": False,
                        "verifiedBy": "",
                    },
                    "my_vote": None,
                    "counts": None,
                    "total": total,
                    "cabinet_notice": CABINET_NOTICE,
                },
            )
            return

        # 2. АВТОРИЗАЦИЯ В ЛИЧНОМ КАБИНЕТЕ (ЗРИТЕЛЬ ИЛИ АДМИНИСТРАТОР)
        if action == "login":
            raw_login = str(data.get("login") or data.get("phone") or "").strip()[:64]
            norm_phone = normalize_phone(raw_login)
            login_key = (norm_phone or raw_login).lower()
            password = str(data.get("password") or "").strip()[:128]
            rl_key = f"{client_ip}:{login_key or 'general'}"

            if is_rate_limited(rl_key, max_attempts=5, window_sec=300):
                self._send_json(
                    429,
                    {
                        "ok": False,
                        "error": "Слишком много неудачных попыток входа. Попробуйте через 5 минут.",
                    },
                )
                return

            if not SAFE_LOGIN_RE.match(login_key):
                record_attempt(rl_key)
                self._send_json(
                    401,
                    {"ok": False, "error": "Неверный логин (номер телефона) или пароль"},
                )
                return

            # Проверка входа для 6 фиксированных аккаунтов администраторов
            if login_key in ADMIN_ACCOUNTS:
                if not verify_password_hash(password, ADMIN_ACCOUNTS[login_key]):
                    record_attempt(rl_key)
                    self._send_json(
                        401,
                        {"ok": False, "error": "Неверный логин администратора или пароль"},
                    )
                    return

                reset_rate_limit(rl_key)
                token = create_token(login_key)
                with DB_LOCK, open_db() as conn:
                    cur = conn.cursor()
                    counts = get_all_counts(cur, use_cache=True)
                    total = sum(counts.values())
                    admin_users = list_all_users_for_admin(cur)

                self._send_json(
                    200,
                    {
                        "ok": True,
                        "login": login_key,
                        "is_admin": True,
                        "token": token,
                        "profile": {
                            "phone": login_key,
                            "fullName": f"Администратор ({login_key})",
                            "group": "Оргкомитет / Администратор",
                            "notBmstu": False,
                            "supporterOf": "Администратор",
                            "present": True,
                            "isAdmin": True,
                        },
                        "users": admin_users,
                        "my_vote": None,
                        "counts": counts,
                        "total": total,
                        "cabinet_notice": CABINET_NOTICE,
                    },
                )
                return

            # Обычный вход зрителя по номеру телефона
            with DB_LOCK, open_db() as conn:
                cur = conn.cursor()
                user_obj = verify_user(cur, login_key, password)
                if not user_obj:
                    record_attempt(rl_key)
                    self._send_json(
                        401,
                        {"ok": False, "error": "Неверный номер телефона или пароль"},
                    )
                    return

                reset_rate_limit(rl_key)
                canonical_login = user_obj["login"]
                token = create_token(canonical_login)
                my_vote = find_existing_vote_by_login(cur, canonical_login)
                counts = get_all_counts(cur, use_cache=True)
                total = sum(counts.values())

            self._send_json(
                200,
                {
                    "ok": True,
                    "login": canonical_login,
                    "is_admin": False,
                    "token": token,
                    "profile": user_obj["profile"],
                    "my_vote": my_vote,
                    "counts": counts if my_vote else None,
                    "total": total,
                    "cabinet_notice": CABINET_NOTICE,
                },
            )
            return

        # 3. АДМИН-ПАНЕЛЬ: СПИСОК ПОЛЬЗОВАТЕЛЕЙ И ПОДТВЕРЖДЕНИЕ ПРИСУТСТВИЯ
        if action in ("admin_list", "admin_set_presence"):
            token = str(data.get("token") or "").strip()[:256]
            authenticated_login = verify_token(token)
            if not authenticated_login or authenticated_login not in ADMIN_ACCOUNTS:
                self._send_json(
                    403,
                    {"ok": False, "error": "Доступ разрешён только авторизованным администраторам"},
                )
                return

            with DB_LOCK, open_db() as conn:
                cur = conn.cursor()
                if action == "admin_set_presence":
                    raw_target = str(data.get("target_login") or "").strip()[:64]
                    norm_target = normalize_phone(raw_target)
                    target_login = (norm_target or raw_target).lower()
                    present_val = 1 if bool(data.get("present")) else 0

                    if not target_login or not SAFE_LOGIN_RE.match(target_login):
                        self._send_json(400, {"ok": False, "error": "Некорректный логин пользователя"})
                        return

                    cur.execute(
                        """
                        UPDATE users
                        SET present = ?, verified_by = ?
                        WHERE login = ?
                        """,
                        (
                            present_val,
                            authenticated_login if present_val else "",
                            target_login,
                        ),
                    )
                    if cur.rowcount == 0:
                        self._send_json(404, {"ok": False, "error": "Пользователь не найден"})
                        return
                    conn.commit()

                admin_users = list_all_users_for_admin(cur)
                counts = get_all_counts(cur, use_cache=True)

            self._send_json(
                200,
                {
                    "ok": True,
                    "is_admin": True,
                    "login": authenticated_login,
                    "users": admin_users,
                    "counts": counts,
                    "total": sum(counts.values()),
                },
            )
            return

        # 4. ГОЛОСОВАНИЕ (ТОЛЬКО ПРИ НАЛИЧИИ РЕГИСТРАЦИИ И ПОДТВЕРЖДЕНИЯ ПРИСУТСТВИЯ ОТ АДМИНА)
        if action == "vote":
            vote_rl_key = f"vote:{client_ip}"
            if check_and_record_rate(vote_rl_key, max_attempts=180, window_sec=60):
                self._send_json(
                    429,
                    {"ok": False, "error": "Слишком много запросов на голосование. Подождите минуту."},
                )
                return

            raw_login = str(data.get("login") or "").strip()[:64]
            norm_phone = normalize_phone(raw_login)
            expected_login = (norm_phone or raw_login).lower()
            token = str(data.get("token") or "").strip()[:256]
            authenticated_login = verify_token(token)

            if not authenticated_login or authenticated_login != expected_login:
                self._send_json(
                    401,
                    {
                        "ok": False,
                        "error": "Сессия истекла или недействительна. Войдите в личный кабинет.",
                    },
                )
                return

            if check_and_record_rate(f"vote_user:{authenticated_login}", max_attempts=10, window_sec=60):
                self._send_json(
                    429,
                    {"ok": False, "error": "Слишком много попыток голосования. Подождите минуту."},
                )
                return

            if authenticated_login in ADMIN_ACCOUNTS:
                self._send_json(
                    403,
                    {"ok": False, "error": "Аккаунты администраторов предназначены для подтверждения присутствия и не участвуют в голосовании."},
                )
                return

            candidate_id = str(data.get("id") or "").strip()
            if candidate_id not in VALID_IDS:
                self._send_json(400, {"ok": False, "error": "Некорректный кандидат"})
                return

            with DB_LOCK, open_db() as conn:
                cur = conn.cursor()
                user_obj = get_user_profile(cur, authenticated_login)
                if not user_obj or not user_obj["profile"].get("present"):
                    self._send_json(
                        403,
                        {
                            "ok": False,
                            "error": "Право на голосование открывается только после подтверждения вашего присутствия администратором в БЗДК.",
                        },
                    )
                    return

                existing_vote = find_existing_vote_by_login(cur, authenticated_login)
                if existing_vote:
                    counts = get_all_counts(cur, use_cache=True)
                    self._send_json(
                        409,
                        {
                            "ok": False,
                            "error": "Вы уже голосовали в этом конкурсе",
                            "my_vote": existing_vote,
                            "counts": counts,
                            "total": sum(counts.values()),
                        },
                    )
                    return

                try:
                    cur.execute(
                        """
                        INSERT INTO votes (
                            candidate_id, device_id, cookie_id, fp_ip_hash, ip, user_agent, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            candidate_id,
                            f"user:{authenticated_login}",
                            f"cookie:{authenticated_login}",
                            f"hash:{authenticated_login}",
                            client_ip[:64],
                            sanitize_text(self.headers.get("User-Agent", ""), 200),
                            int(time.time()),
                        ),
                    )
                    conn.commit()
                except sqlite3.IntegrityError:
                    existing_vote = find_existing_vote_by_login(cur, authenticated_login)
                    counts = get_all_counts(cur, use_cache=False)
                    self._send_json(
                        409,
                        {
                            "ok": False,
                            "error": "Вы уже голосовали в этом конкурсе",
                            "my_vote": existing_vote,
                            "counts": counts,
                            "total": sum(counts.values()),
                        },
                    )
                    return

                my_vote = candidate_id
                counts = get_all_counts(cur, use_cache=False)
                total = sum(counts.values())

            self._send_json(
                200,
                {
                    "ok": True,
                    "login": authenticated_login,
                    "token": token,
                    "my_vote": my_vote,
                    "counts": counts,
                    "total": total,
                },
            )
            return

        self._send_json(400, {"ok": False, "error": "Неизвестное действие"})


class SecureThreadingHTTPServer(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True

    def process_request(self, request, client_address):
        if not CONN_SEMAPHORE.acquire(blocking=False):
            try:
                request.close()
            except Exception:
                pass
            return
        super().process_request(request, client_address)

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            CONN_SEMAPHORE.release()


def main():
    init_db()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8080))
    server = SecureThreadingHTTPServer(("0.0.0.0", port), ProforgHandler)
    print(f"Serving Best Proforg 2026 on http://0.0.0.0:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
