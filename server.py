#!/usr/bin/env python3
"""
Локальный сервер конкурса «Лучший профорг — 2026».
- Раздаёт статику сайта (с защитой служебных файлов и исходников).
- Обрабатывает регистрацию и вход в Личный кабинет по номеру телефона и паролю.
- Пароли хэшируются алгоритмом PBKDF2-HMAC-SHA256 (100 000 итераций + индивидуальная соль).
- Персональные данные (ФИО, группа, за кого болеет) шифруются перед записью в БД с проверкой целостности (HMAC-SHA256).
- База SQLite работает в режиме WAL + synchronous=FULL для защиты от сбоев и потери данных.
- Защищает от перебора паролей и спама регистраций (Rate Limiting).
- Обеспечивает атомарное голосование: 1 аккаунт = 1 голос.
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

FAILED_ATTEMPTS = {}
RATE_LOCK = threading.Lock()


def is_rate_limited(key: str, max_attempts: int = 5, window_sec: int = 300) -> bool:
    now = time.time()
    with RATE_LOCK:
        times = [t for t in FAILED_ATTEMPTS.get(key, []) if now - t < window_sec]
        FAILED_ATTEMPTS[key] = times
        return len(times) >= max_attempts


def record_attempt(key: str, window_sec: int = 300):
    now = time.time()
    with RATE_LOCK:
        times = [t for t in FAILED_ATTEMPTS.get(key, []) if now - t < window_sec]
        times.append(now)
        FAILED_ATTEMPTS[key] = times


def reset_rate_limit(key: str):
    with RATE_LOCK:
        FAILED_ATTEMPTS.pop(key, None)


def sanitize_text(val: str, max_len: int = 140) -> str:
    cleaned = re.sub(r"[\x00-\x1f\x7f<>]", "", str(val or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:max_len]


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", str(raw or "").strip())
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
    if re.search(r"[а-яА-ЯёЁ]", pwd):
        return "Пароль должен содержать только английские буквы (без русских символов)"
    if not re.search(r"[a-zA-Z]", pwd):
        return "Пароль должен содержать английские буквы"
    if not re.search(r"[^a-zA-Z0-9\s]", pwd):
        return "Пароль должен содержать хотя бы один специальный знак (например: ! @ # $ % ^ & * _ - + =)"
    return None


def create_password_hash(password: str) -> str:
    salt = os.urandom(16).hex()
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        password.strip().encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ITERATIONS,
        dklen=32,
    ).hex()
    return f"pbkdf2${PBKDF2_ITERATIONS}${salt}${derived}"


def verify_password_hash(password: str, stored_hash: str) -> bool:
    if not password or not stored_hash:
        return False
    pwd = password.strip().encode("utf-8")
    stored = stored_hash.strip()

    if stored.startswith("pbkdf2$"):
        parts = stored.split("$")
        if len(parts) != 4:
            return False
        try:
            iterations = int(parts[1])
            salt = parts[2]
            expected_hex = parts[3]
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
    if not token or not isinstance(token, str):
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    login, expiry_str, sig = parts
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
    return conn


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
            pwd_hash = str(item.get("password_sha256") or "").strip()
            if not pwd_hash and item.get("password"):
                pwd_hash = create_password_hash(str(item.get("password")))
            if login and pwd_hash:
                cur.execute(
                    """
                    INSERT INTO users (login, password_hash, full_name, study_group, not_bmstu, supporter_of, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(login) DO UPDATE SET password_hash = excluded.password_hash
                    """,
                    (
                        login,
                        pwd_hash,
                        encrypt_field(str(item.get("fullName") or login)),
                        encrypt_field(str(item.get("group") or "МГТУ им. Н.Э. Баумана")),
                        1 if item.get("notBmstu") else 0,
                        encrypt_field(str(item.get("supporterOf") or "Просто зритель")),
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
                password_hash TEXT NOT NULL,
                full_name TEXT DEFAULT '',
                study_group TEXT DEFAULT '',
                not_bmstu INTEGER DEFAULT 0,
                supporter_of TEXT DEFAULT '',
                created_at INTEGER DEFAULT 0
            )
            """
        )
        for col_sql in (
            "ALTER TABLE users ADD COLUMN full_name TEXT DEFAULT ''",
            "ALTER TABLE users ADD COLUMN study_group TEXT DEFAULT ''",
            "ALTER TABLE users ADD COLUMN not_bmstu INTEGER DEFAULT 0",
            "ALTER TABLE users ADD COLUMN supporter_of TEXT DEFAULT ''",
            "ALTER TABLE users ADD COLUMN created_at INTEGER DEFAULT 0",
        ):
            try:
                conn.execute(col_sql)
            except sqlite3.OperationalError:
                pass

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
    if not login_key:
        return None
    row = cur.execute(
        """
        SELECT login, password_hash, full_name, study_group, not_bmstu, supporter_of
        FROM users WHERE login = ? LIMIT 1
        """,
        (login_key.lower(),),
    ).fetchone()
    if not row:
        return None
    not_bmstu_flag = bool(row[4])
    dec_name = decrypt_field(row[2]) or row[0]
    dec_group = decrypt_field(row[3]) or ""
    dec_supporter = decrypt_field(row[5]) or "Просто зритель"
    return {
        "login": row[0],
        "password_hash": row[1],
        "profile": {
            "phone": row[0],
            "fullName": dec_name,
            "group": "Не из МГТУ им. Н.Э. Баумана" if not_bmstu_flag else dec_group,
            "notBmstu": not_bmstu_flag,
            "supporterOf": dec_supporter,
        },
    }


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
    if not login:
        return None
    row = cur.execute(
        "SELECT candidate_id FROM votes WHERE device_id = ? LIMIT 1",
        (f"user:{login.lower()}",),
    ).fetchone()
    return row[0] if row else None


def get_all_counts(cur: sqlite3.Cursor):
    counts = {cid: 0 for cid in sorted(VALID_IDS)}
    for cid, cnt in cur.execute(
        "SELECT candidate_id, COUNT(*) FROM votes GROUP BY candidate_id"
    ):
        if cid in counts:
            counts[cid] = cnt
    return counts


class ProforgHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        raw_path = urllib.parse.unquote(parsed.path)
        if ".." in raw_path:
            self.send_error(403, "Forbidden")
            return
        clean_path = os.path.normpath(raw_path).replace("\\", "/")

        if clean_path == "/api/votes":
            qs = urllib.parse.parse_qs(parsed.query)
            token = (qs.get("token", [""])[0] or "").strip()
            raw_login = (qs.get("login", [""])[0] or "").strip()
            norm_phone = normalize_phone(raw_login)
            expected_login = (norm_phone or raw_login).lower()
            authenticated_login = verify_token(token)

            with DB_LOCK, open_db() as conn:
                cur = conn.cursor()
                counts = get_all_counts(cur)
                my_vote = None
                profile = None
                if authenticated_login and authenticated_login == expected_login:
                    my_vote = find_existing_vote_by_login(cur, authenticated_login)
                    user_obj = get_user_profile(cur, authenticated_login)
                    if user_obj:
                        profile = user_obj["profile"]

            total = sum(counts.values())
            self._send_json(
                200,
                {
                    "counts": counts if my_vote else None,
                    "my_vote": my_vote,
                    "total": total,
                    "login": authenticated_login,
                    "profile": profile,
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

        if clean_path != "/api/votes":
            self._send_json(404, {"ok": False, "error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(min(length, 16384))
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send_json(400, {"ok": False, "error": "Invalid JSON"})
            return

        action = str(data.get("action") or "vote").strip()
        client_ip = self.client_address[0]

        # 1. РЕГИСТРАЦИЯ В ЛИЧНОМ КАБИНЕТЕ
        if action == "register":
            reg_rl_key = f"reg:{client_ip}"
            if is_rate_limited(reg_rl_key, max_attempts=8, window_sec=300):
                self._send_json(
                    429,
                    {"ok": False, "error": "Слишком много запросов на регистрацию. Подождите 5 минут."},
                )
                return

            raw_phone = str(data.get("phone") or data.get("login") or "").strip()
            phone = normalize_phone(raw_phone)
            full_name = sanitize_text(data.get("fullName"), 140)
            not_bmstu = bool(data.get("notBmstu"))
            raw_group = sanitize_text(data.get("group"), 60)
            study_group = "Не из МГТУ им. Н.Э. Баумана" if not_bmstu else raw_group
            supporter_of = sanitize_text(data.get("supporterOf"), 80)
            password = str(data.get("password") or "").strip()

            if not phone:
                self._send_json(
                    400,
                    {"ok": False, "error": "Введите корректный номер телефона (например, +7 999 123-45-67)"},
                )
                return
            if len(full_name) < 3 or " " not in full_name:
                self._send_json(400, {"ok": False, "error": "Введите ваше полное ФИО"})
                return
            if not not_bmstu and not raw_group:
                self._send_json(
                    400,
                    {"ok": False, "error": "Укажите учебную группу или выберите «Не из МГТУ им. Н.Э. Баумана»"},
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

                cur.execute(
                    """
                    INSERT INTO users (login, password_hash, full_name, study_group, not_bmstu, supporter_of, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        phone.lower(),
                        create_password_hash(password),
                        encrypt_field(full_name),
                        encrypt_field(study_group),
                        1 if not_bmstu else 0,
                        encrypt_field(supporter_of),
                        int(time.time()),
                    ),
                )
                conn.commit()
                counts = get_all_counts(cur)
                total = sum(counts.values())

            token = create_token(phone.lower())
            self._send_json(
                200,
                {
                    "ok": True,
                    "login": phone.lower(),
                    "token": token,
                    "profile": {
                        "phone": phone,
                        "fullName": full_name,
                        "group": study_group,
                        "notBmstu": not_bmstu,
                        "supporterOf": supporter_of,
                    },
                    "my_vote": None,
                    "counts": None,
                    "total": total,
                    "cabinet_notice": CABINET_NOTICE,
                },
            )
            return

        # 2. АВТОРИЗАЦИЯ В ЛИЧНОМ КАБИНЕТЕ
        if action == "login":
            raw_login = str(data.get("login") or data.get("phone") or "").strip()[:128]
            norm_phone = normalize_phone(raw_login)
            login_key = (norm_phone or raw_login).lower()
            password = str(data.get("password") or "").strip()[:128]
            rl_key = f"{client_ip}:{login_key or 'general'}"

            if is_rate_limited(rl_key):
                self._send_json(
                    429,
                    {
                        "ok": False,
                        "error": "Слишком много неудачных попыток входа. Попробуйте через 5 минут.",
                    },
                )
                return

            with DB_LOCK, open_db() as conn:
                sync_users_from_json(conn)
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
                counts = get_all_counts(cur)
                total = sum(counts.values())

            self._send_json(
                200,
                {
                    "ok": True,
                    "login": canonical_login,
                    "token": token,
                    "profile": user_obj["profile"],
                    "my_vote": my_vote,
                    "counts": counts if my_vote else None,
                    "total": total,
                    "cabinet_notice": CABINET_NOTICE,
                },
            )
            return

        # 3. ГОЛОСОВАНИЕ
        if action == "vote":
            raw_login = str(data.get("login") or "").strip()[:128]
            norm_phone = normalize_phone(raw_login)
            expected_login = (norm_phone or raw_login).lower()
            token = str(data.get("token") or "").strip()
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

            candidate_id = str(data.get("id") or "").strip()
            if candidate_id not in VALID_IDS:
                self._send_json(400, {"ok": False, "error": "Некорректный кандидат"})
                return

            with DB_LOCK, open_db() as conn:
                cur = conn.cursor()
                existing_vote = find_existing_vote_by_login(cur, authenticated_login)
                if existing_vote:
                    counts = get_all_counts(cur)
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
                            client_ip,
                            self.headers.get("User-Agent", "")[:250],
                            int(time.time()),
                        ),
                    )
                    conn.commit()
                except sqlite3.IntegrityError:
                    existing_vote = find_existing_vote_by_login(cur, authenticated_login)
                    counts = get_all_counts(cur)
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
                counts = get_all_counts(cur)
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


def main():
    init_db()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8080))
    server = ThreadingHTTPServer(("0.0.0.0", port), ProforgHandler)
    print(f"Serving Best Proforg 2026 on http://0.0.0.0:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
