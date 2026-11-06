#!/usr/bin/env python3
"""
Сервер сайта «Лучший профорг — 2026» с единой базой голосования (SQLite).
Раздаёт статические файлы и обрабатывает API голосования:
  GET  /api/votes?device_id=...&fp=... -> { counts: {f1: 0, ...}, my_vote: "f1" | null, total: 0 }
  POST /api/votes                      -> принимает { id: "f1", device_id: "...", fp: "..." }
                                          проверяет, что с этого IP / устройства ещё не голосовали,
                                          сохраняет голос и возвращает обновлённую статистику.
Запуск:
  python3 server.py [порт] (по умолчанию 8080)
"""

import hashlib
import http.cookies
import json
import os
import sqlite3
import sys
import threading
import time
import urllib.parse
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "votes.db")
VALID_IDS = {f"f{i}" for i in range(1, 10)}
DB_LOCK = threading.Lock()


def init_db():
    with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                candidate_id TEXT NOT NULL,
                device_id TEXT NOT NULL,
                cookie_id TEXT NOT NULL,
                fp_ip_hash TEXT NOT NULL,
                ip TEXT,
                user_agent TEXT,
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_votes_candidate ON votes(candidate_id)"
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_votes_ip ON votes(ip)")
        conn.commit()


def compute_fp_ip_hash(fp: str, ip: str, user_agent: str) -> str:
    """Хэш устройства (отпечаток параметров экрана/GPU + IP + User-Agent)."""
    raw = f"{fp or 'nofp'}|{ip or 'noip'}|{user_agent or 'noua'}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def find_existing_vote(
    cur: sqlite3.Cursor,
    device_id: str,
    cookie_id: str,
    fp_ip_hash: str,
    ip: str,
):
    """Проверяет, голосовало ли уже устройство по IP, device_id, cookie или отпечатку."""
    conditions = []
    params = []
    if ip:
        conditions.append("ip = ?")
        params.append(ip)
    if device_id:
        conditions.append("device_id = ?")
        params.append(device_id)
    if cookie_id:
        conditions.append("cookie_id = ?")
        params.append(cookie_id)
    if fp_ip_hash:
        conditions.append("fp_ip_hash = ?")
        params.append(fp_ip_hash)

    if not conditions:
        return None

    query = f"SELECT candidate_id FROM votes WHERE {' OR '.join(conditions)} LIMIT 1"
    row = cur.execute(query, params).fetchone()
    return row[0] if row else None


def get_vote_state(device_id: str, cookie_id: str, fp_ip_hash: str, ip: str):
    counts = {cid: 0 for cid in sorted(VALID_IDS)}
    my_vote = None

    with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
        cur = conn.cursor()
        for cid, cnt in cur.execute(
            "SELECT candidate_id, COUNT(*) FROM votes GROUP BY candidate_id"
        ):
            if cid in counts:
                counts[cid] = cnt

        my_vote = find_existing_vote(cur, device_id, cookie_id, fp_ip_hash, ip)

    total = sum(counts.values())
    return {"counts": counts, "my_vote": my_vote, "total": total}


class ProforgHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def _client_ip(self) -> str:
        xff = self.headers.get("X-Forwarded-For")
        if xff:
            return xff.split(",")[0].strip()
        xri = self.headers.get("X-Real-IP")
        if xri:
            return xri.strip()
        return self.client_address[0] if self.client_address else ""

    def _cookie_voter_id(self):
        raw_cookie = self.headers.get("Cookie", "")
        c = http.cookies.SimpleCookie()
        try:
            c.load(raw_cookie)
            if "lp26_voter" in c:
                return c["lp26_voter"].value
        except Exception:
            pass
        return None

    def _send_json(self, status: int, payload: dict, set_cookie_id: str = None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        if set_cookie_id:
            self.send_header(
                "Set-Cookie",
                f"lp26_voter={set_cookie_id}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly",
            )
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/votes":
            qs = urllib.parse.parse_qs(parsed.query)
            device_id = (qs.get("device_id", [""])[0] or "").strip()[:128]
            fp = (qs.get("fp", [""])[0] or "").strip()[:256]
            cookie_id = self._cookie_voter_id()
            new_cookie = None
            if not cookie_id:
                cookie_id = uuid.uuid4().hex
                new_cookie = cookie_id

            ip = self._client_ip()
            ua = (self.headers.get("User-Agent") or "")[:256]
            fp_ip_hash = compute_fp_ip_hash(fp, ip, ua) if fp else ""

            state = get_vote_state(device_id, cookie_id, fp_ip_hash, ip)
            self._send_json(200, state, set_cookie_id=new_cookie)
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

        candidate_id = str(data.get("id") or "").strip()
        device_id = str(data.get("device_id") or "").strip()[:128]
        fp = str(data.get("fp") or "").strip()[:256]

        if candidate_id not in VALID_IDS:
            self._send_json(400, {"error": "Invalid candidate id"})
            return

        cookie_id = self._cookie_voter_id()
        new_cookie = None
        if not cookie_id:
            cookie_id = uuid.uuid4().hex
            new_cookie = cookie_id

        if not device_id:
            device_id = cookie_id

        ip = self._client_ip()
        ua = (self.headers.get("User-Agent") or "")[:256]
        fp_ip_hash = compute_fp_ip_hash(fp, ip, ua)

        with DB_LOCK, sqlite3.connect(DB_PATH) as conn:
            cur = conn.cursor()
            existing = find_existing_vote(cur, device_id, cookie_id, fp_ip_hash, ip)

            if not existing:
                try:
                    cur.execute(
                        """
                        INSERT INTO votes (
                            candidate_id, device_id, cookie_id, fp_ip_hash, ip, user_agent, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            candidate_id,
                            device_id,
                            cookie_id,
                            fp_ip_hash,
                            ip,
                            ua,
                            int(time.time()),
                        ),
                    )
                    conn.commit()
                except sqlite3.IntegrityError:
                    pass

        state = get_vote_state(device_id, cookie_id, fp_ip_hash, ip)
        self._send_json(200, state, set_cookie_id=new_cookie)


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
