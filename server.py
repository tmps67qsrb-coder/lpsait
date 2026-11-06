#!/usr/bin/env python3
"""
Сервер сайта «Лучший профорг — 2026» с единой базой голосования и авторизацией (SQLite + users.json).
Правило: 1 аккаунт (логин/пароль из БД) = 1 голос.
  GET  /api/votes?login=... -> { counts: {f1: 0, ...}, my_vote: "f1" | null, total: 0, login: "..." | null }
  POST /api/votes           ->
    1) { action: "login", login: "...", password: "..." } — проверка логина и пароля по БД
    2) { action: "vote", id: "f1", login: "...", password: "..." } — голосование (1 аккаунт = 1 голос)
Запуск:
  python3 server.py [порт] (по умолчанию 8080)
"""

import http.cookies
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
USERS_JSON_PATH = os.path.join(BASE_DIR, "users.json")
VALID_IDS = {f"f{i}" for i in range(1, 10)}
DB_LOCK = threading.Lock()


def sync_users_from_json(conn: sqlite3.Connection):
    """Загружает список логинов и паролей из users.json (базы-заглушки) в таблицу users."""
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
            login = str(item.get("login") or "").strip()
            password = str(item.get("password") or "").strip()
            if login and password:
                conn.execute(
                    """
                    INSERT INTO users (login, password)
                    VALUES (?, ?)
                    ON CONFLICT(login) DO UPDATE SET password = excluded.password
                    """,
                    (login, password),
                )
    except Exception:
        pass


def init_db():
    with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                login TEXT PRIMARY KEY,
                password TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                candidate_id TEXT NOT NULL,
                device_id TEXT NOT NULL,
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
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_votes_device ON votes(device_id)"
        )
        sync_users_from_json(conn)
        conn.commit()


def verify_user(cur: sqlite3.Cursor, login: str, password: str) -> bool:
    if not login or not password:
        return False
    row = cur.execute(
        "SELECT password FROM users WHERE login = ? LIMIT 1", (login,)
    ).fetchone()
    return bool(row and row[0] == password)


def find_existing_vote_by_login(cur: sqlite3.Cursor, login: str):
    if not login:
        return None
    row = cur.execute(
        "SELECT candidate_id FROM votes WHERE device_id = ? LIMIT 1",
        (f"user:{login}",),
    ).fetchone()
    return row[0] if row else None


def get_vote_state(login: str = ""):
    counts = {cid: 0 for cid in sorted(VALID_IDS)}
    my_vote = None

    with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
        sync_users_from_json(conn)
        cur = conn.cursor()
        for cid, cnt in cur.execute(
            "SELECT candidate_id, COUNT(*) FROM votes GROUP BY candidate_id"
        ):
            if cid in counts:
                counts[cid] = cnt

        if login:
            my_vote = find_existing_vote_by_login(cur, login)

    total = sum(counts.values())
    return {
        "counts": counts,
        "my_vote": my_vote,
        "total": total,
        "login": login or None,
    }


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
        if parsed.path == "/api/votes":
            qs = urllib.parse.parse_qs(parsed.query)
            login = (qs.get("login", [""])[0] or "").strip()[:128]
            state = get_vote_state(login)
            self._send_json(200, state)
            return

        # Закрываем прямой доступ к файлу с паролями и БД
        if parsed.path in ("/users.json", "/votes.db", "/server.py"):
            self.send_error(403, "Forbidden")
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/votes":
            self._send_json(404, {"error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(min(length, 16384))
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send_json(400, {"error": "Invalid JSON"})
            return

        action = str(data.get("action") or "vote").strip()
        login = str(data.get("login") or "").strip()[:128]
        password = str(data.get("password") or "").strip()[:128]

        with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
            sync_users_from_json(conn)
            cur = conn.cursor()

            if not verify_user(cur, login, password):
                self._send_json(
                    401,
                    {
                        "ok": False,
                        "error": "Неверный логин или пароль",
                    },
                )
                return

            if action == "login":
                conn.commit()
                state = get_vote_state(login)
                state["ok"] = True
                self._send_json(200, state)
                return

            candidate_id = str(data.get("id") or "").strip()
            if candidate_id not in VALID_IDS:
                self._send_json(400, {"ok": False, "error": "Invalid candidate id"})
                return

            existing = find_existing_vote_by_login(cur, login)
            if not existing:
                cur.execute(
                    """
                    INSERT INTO votes (
                        candidate_id, device_id, cookie_id, fp_ip_hash, ip, user_agent, created_at
                    ) VALUES (?, ?, ?, '', '', '', ?)
                    """,
                    (
                        candidate_id,
                        f"user:{login}",
                        f"user:{login}",
                        int(time.time()),
                    ),
                )
                conn.commit()

        state = get_vote_state(login)
        state["ok"] = True
        self._send_json(200, state)


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
