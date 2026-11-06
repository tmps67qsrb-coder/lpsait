#!/usr/bin/env python3
"""
Сервер сайта «Лучший профорг — 2026» с безопасной базой голосования и авторизацией.
Правило: 1 аккаунт (логин/пароль из БД) = 1 голос.
Безопасность:
  - Пароли проверяются по SHA-256 хешу из netlify/functions/users.json
  - Сессия защищена криптографическим токеном HMAC-SHA256
  - Защита от перебора паролей (Rate Limiting: 5 попыток / 5 минут)
  - Атомарное голосование с защитой от повторного/параллельного голоса
  - Полная блокировка доступа к служебным файлам (.py, .db, .json, .git, netlify)
Запуск:
  python3 server.py [порт] (по умолчанию 8080)
"""

import hashlib
import hmac
import json
import os
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

DB_LOCK = threading.Lock()
ATTEMPT_LOCK = threading.Lock()
FAILED_ATTEMPTS = {}  # key -> list of float timestamps


def is_rate_limited(key: str) -> bool:
    now = time.time()
    with ATTEMPT_LOCK:
        times = [t for t in FAILED_ATTEMPTS.get(key, []) if now - t < 300]
        FAILED_ATTEMPTS[key] = times
        return len(times) >= 5


def record_failed_attempt(key: str):
    now = time.time()
    with ATTEMPT_LOCK:
        times = [t for t in FAILED_ATTEMPTS.get(key, []) if now - t < 300]
        times.append(now)
        FAILED_ATTEMPTS[key] = times


def reset_rate_limit(key: str):
    with ATTEMPT_LOCK:
        FAILED_ATTEMPTS.pop(key, None)


def hash_password(password: str) -> str:
    return hashlib.sha256(password.strip().encode("utf-8")).hexdigest()


def create_token(login: str) -> str:
    expiry = int(time.time()) + 86400 * 7
    data = f"{login}:{expiry}".encode("utf-8")
    sig = hmac.new(SECRET_KEY, data, hashlib.sha256).hexdigest()
    return f"{login}.{expiry}.{sig}"


def verify_token(token: str) -> str:
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
    return login


def sync_users_from_json(conn: sqlite3.Connection):
    """Синхронизирует хеши пользователей из netlify/functions/users.json в SQLite."""
    if not os.path.exists(USERS_JSON_PATH):
        return
    try:
        with open(USERS_JSON_PATH, "r", encoding="utf-8") as f:
            items = json.load(f)
        if not isinstance(items, list):
            return
        for item in items:
            if not isinstance(item, dict):
                continue
            login = str(item.get("login") or "").strip().lower()
            pwd_hash = str(item.get("password_sha256") or "").strip().lower()
            if not pwd_hash and item.get("password"):
                pwd_hash = hash_password(str(item.get("password")))
            if login and pwd_hash:
                conn.execute(
                    """
                    INSERT INTO users (login, password_hash)
                    VALUES (?, ?)
                    ON CONFLICT(login) DO UPDATE SET password_hash = excluded.password_hash
                    """,
                    (login, pwd_hash),
                )
    except Exception:
        pass


def init_db():
    with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                login TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL
            )
            """
        )
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
        conn.commit()


def verify_user(cur: sqlite3.Cursor, login: str, password: str) -> bool:
    if not login or not password:
        return False
    row = cur.execute(
        "SELECT password_hash FROM users WHERE login = ? LIMIT 1",
        (login.lower(),),
    ).fetchone()
    if not row:
        return False
    stored_hash = row[0].lower()
    return hmac.compare_digest(stored_hash, hash_password(password).lower())


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
        clean_path = os.path.normpath(urllib.parse.unquote(parsed.path)).replace("\\", "/")

        if clean_path == "/api/votes":
            qs = urllib.parse.parse_qs(parsed.query)
            token = (qs.get("token", [""])[0] or "").strip()
            login = (qs.get("login", [""])[0] or "").strip().lower()
            authenticated_login = verify_token(token)

            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                cur = conn.cursor()
                counts = get_all_counts(cur)
                my_vote = None
                if authenticated_login and authenticated_login == login:
                    my_vote = find_existing_vote_by_login(cur, authenticated_login)

            total = sum(counts.values())
            self._send_json(
                200,
                {
                    "counts": counts if my_vote else None,
                    "my_vote": my_vote,
                    "total": total,
                    "login": authenticated_login,
                },
            )
            return

        # Блокировка скрытых файлов, бэкенда, БД и служебных папок
        path_parts = clean_path.strip("/").split("/")
        if any(part.startswith(".") for part in path_parts if part):
            self.send_error(403, "Forbidden")
            return

        blocked_exts = (".py", ".db", ".sqlite", ".json", ".toml", ".yaml", ".yml", ".md", ".sh")
        if any(clean_path.lower().endswith(ext) for ext in blocked_exts):
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
        login = str(data.get("login") or "").strip().lower()[:128]
        client_ip = self.client_address[0]
        rl_key = f"{client_ip}:{login or 'general'}"

        # 1. АВТОРИЗАЦИЯ
        if action == "login":
            password = str(data.get("password") or "").strip()[:128]

            if is_rate_limited(rl_key):
                self._send_json(
                    429,
                    {
                        "ok": False,
                        "error": "Слишком много неудачных попыток входа. Попробуйте через 5 минут.",
                    },
                )
                return

            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                sync_users_from_json(conn)
                cur = conn.cursor()
                if not verify_user(cur, login, password):
                    record_failed_attempt(rl_key)
                    self._send_json(
                        401,
                        {"ok": False, "error": "Неверный логин или пароль"},
                    )
                    return

                reset_rate_limit(rl_key)
                token = create_token(login)
                my_vote = find_existing_vote_by_login(cur, login)
                counts = get_all_counts(cur)
                total = sum(counts.values())

            self._send_json(
                200,
                {
                    "ok": True,
                    "login": login,
                    "token": token,
                    "my_vote": my_vote,
                    "counts": counts if my_vote else None,
                    "total": total,
                },
            )
            return

        # 2. ГОЛОСОВАНИЕ
        if action == "vote":
            token = str(data.get("token") or "").strip()
            authenticated_login = verify_token(token)

            if not authenticated_login or authenticated_login != login:
                self._send_json(
                    401,
                    {
                        "ok": False,
                        "error": "Сессия истекла или недействительна. Войдите снова.",
                    },
                )
                return

            candidate_id = str(data.get("id") or "").strip()
            if candidate_id not in VALID_IDS:
                self._send_json(400, {"ok": False, "error": "Некорректный кандидат"})
                return

            with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
                cur = conn.cursor()
                try:
                    cur.execute(
                        """
                        INSERT INTO votes (
                            candidate_id, device_id, cookie_id, fp_ip_hash, ip, user_agent, created_at
                        ) VALUES (?, ?, ?, '', ?, ?, ?)
                        """,
                        (
                            candidate_id,
                            f"user:{authenticated_login}",
                            f"user:{authenticated_login}",
                            client_ip,
                            self.headers.get("User-Agent", "")[:250],
                            int(time.time()),
                        ),
                    )
                    conn.commit()
                except sqlite3.IntegrityError:
                    # Уже проголосовал ранее
                    pass

                my_vote = find_existing_vote_by_login(cur, authenticated_login)
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
