#!/usr/bin/env python3
"""
Servidor do app (área de membros).

- Entrega os arquivos de public/ (app dos membros e painel admin) quando roda no computador.
  Na Vercel, public/ é servido direto pela CDN e este módulo roda como função (api/index.py).
- Todo o conteúdo do app (nome, cores, banner, produtos, módulos, avisos) fica no banco
  e é editado pelo painel admin. content/seed.json é só o conteúdo inicial.
- Banco: Postgres quando DATABASE_URL/POSTGRES_URL está definido (Vercel + Neon);
  SQLite em data/app.db no computador.
- Arquivos enviados: Vercel Blob quando BLOB_READ_WRITE_TOKEN está definido;
  pasta data/uploads/ no computador.
- Login de membros por e-mail: só entra quem está cadastrado e ativo.
- Webhook da Cakto: compra aprovada libera os produtos; reembolso/chargeback/cancelamento remove.
- Painel admin protegido por senha.

Uso no computador:
    python dev.py                       # inicia o servidor
    python dev.py set-admin-password    # define/troca a senha do admin
"""
import base64
import csv
import getpass
import hashlib
import hmac
import io
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlencode, urlparse

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SEED_FILE = ROOT / "content" / "seed.json"
DB_PATH = Path(os.environ.get("DB_PATH", ROOT / "data" / "app.db"))
UPLOADS = Path(os.environ.get("UPLOADS_DIR", DB_PATH.parent / "uploads"))
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))
ADMIN_PATH = "/" + os.environ.get("ADMIN_PATH", "admin").strip("/")
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "auto")  # "1", "0" ou "auto" (segue X-Forwarded-Proto)
TRUST_PROXY = os.environ.get("TRUST_PROXY", "1") == "1"

ON_VERCEL = bool(os.environ.get("VERCEL"))
DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL") or ""
USE_PG = DATABASE_URL.startswith(("postgres://", "postgresql://"))
BLOB_TOKEN = os.environ.get("BLOB_READ_WRITE_TOKEN", "")
BLOB_ACCESS = os.environ.get("BLOB_ACCESS", "public")  # deve ser igual ao tipo da loja Blob
BLOB_API = os.environ.get("VERCEL_BLOB_API_URL", "https://vercel.com/api/blob")
USE_BLOB = bool(BLOB_TOKEN)
# Na Vercel o envio vai direto do navegador para o Blob (sem o limite de 4,5 MB das funções).
UPLOAD_MAX = int(os.environ.get("UPLOAD_MAX_MB", "100" if USE_BLOB else "200")) * 1024 * 1024

MEMBER_COOKIE = "me_sid"
ADMIN_COOKIE = "me_adm"
MEMBER_TTL = 30 * 86400
ADMIN_TTL = 12 * 3600
MAX_BODY = 1_000_000
MAX_CONTENT_BODY = 4_000_000
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
UPLOAD_NAME_RE = re.compile(r"^[a-f0-9]{16}\.[a-z0-9]{2,5}$")

# Extensões aceitas no envio. Imagens são públicas (logo aparece no login);
# os demais arquivos só abrem para membros logados ou para o admin.
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
FILE_EXTS = {".pdf", ".mp3", ".m4a", ".mp4", ".zip", ".epub", ".docx", ".xlsx", ".pptx"}

# Eventos da Cakto (https://docs.cakto.com.br/api-reference/webhooks/create)
GRANT_EVENTS = {
    "purchase_approved", "subscription_created", "subscription_renewed",
    "subscription_resumed", "subscription_late_recovered",
}
REVOKE_EVENTS = {"refund", "chargeback", "subscription_canceled"}

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("audio/mp4", ".m4a")
mimetypes.add_type("application/epub+zip", ".epub")


# ---------------------------------------------------------------- Banco de dados
# O mesmo SQL roda nos dois bancos: as consultas usam "?" e são convertidas para "%s" no Postgres.
SCHEMA_SQLITE = """
    CREATE TABLE IF NOT EXISTS members (
        email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active', source TEXT NOT NULL DEFAULT 'manual',
        product TEXT NOT NULL DEFAULT '', order_id TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        first_login INTEGER, last_login INTEGER, login_count INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT '{}', access TEXT NOT NULL DEFAULT '"*"'
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, email TEXT, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, received_at INTEGER NOT NULL,
        event TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
        result TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS app_content (id INTEGER PRIMARY KEY, rev INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cakto_products (
        cakto_id TEXT PRIMARY KEY, short_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '',
        offers TEXT NOT NULL DEFAULT '[]', first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS purchases (
        order_id TEXT PRIMARY KEY, email TEXT NOT NULL, cakto_id TEXT NOT NULL DEFAULT '',
        offer_type TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', amount REAL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS purchases_by_product ON purchases(cakto_id);
    CREATE TABLE IF NOT EXISTS uploads (
        name TEXT PRIMARY KEY, url TEXT NOT NULL, original TEXT NOT NULL DEFAULT '',
        content_type TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attempts (scope TEXT NOT NULL, key TEXT NOT NULL, ts INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS attempts_by_key ON attempts(scope, key, ts);
"""

SCHEMA_PG = [
    """CREATE TABLE IF NOT EXISTS members (
        email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active', source TEXT NOT NULL DEFAULT 'manual',
        product TEXT NOT NULL DEFAULT '', order_id TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
        first_login BIGINT, last_login BIGINT, login_count INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT '{}', access TEXT NOT NULL DEFAULT '"*"')""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, email TEXT, expires_at BIGINT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS events (
        id BIGSERIAL PRIMARY KEY, received_at BIGINT NOT NULL,
        event TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
        result TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}')""",
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS app_content (id INTEGER PRIMARY KEY, rev INTEGER NOT NULL, data TEXT NOT NULL)",
    """CREATE TABLE IF NOT EXISTS cakto_products (
        cakto_id TEXT PRIMARY KEY, short_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '',
        offers TEXT NOT NULL DEFAULT '[]', first_seen BIGINT NOT NULL, last_seen BIGINT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS purchases (
        order_id TEXT PRIMARY KEY, email TEXT NOT NULL, cakto_id TEXT NOT NULL DEFAULT '',
        offer_type TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', amount DOUBLE PRECISION,
        created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS purchases_by_product ON purchases(cakto_id)",
    """CREATE TABLE IF NOT EXISTS uploads (
        name TEXT PRIMARY KEY, url TEXT NOT NULL, original TEXT NOT NULL DEFAULT '',
        content_type TEXT NOT NULL DEFAULT '', size BIGINT NOT NULL DEFAULT 0, created_at BIGINT NOT NULL)""",
    "CREATE TABLE IF NOT EXISTS attempts (scope TEXT NOT NULL, key TEXT NOT NULL, ts BIGINT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS attempts_by_key ON attempts(scope, key, ts)",
]

_conn = None
_lock = threading.RLock()
_ready = False


def _connect():
    global _conn
    if USE_PG:
        import psycopg
        from psycopg.rows import dict_row
        # prepare_threshold=None: compatível com o pooler do Neon (PgBouncer em modo transação).
        _conn = psycopg.connect(DATABASE_URL, autocommit=True, row_factory=dict_row,
                                connect_timeout=10, prepare_threshold=None)
    else:
        if ON_VERCEL:
            raise RuntimeError("Banco de dados não configurado: conecte um Postgres (Neon) ao projeto na Vercel.")
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")


def _run(sql, args, want_rows):
    """Executa com reconexão automática (conexões ociosas caem entre invocações na Vercel)."""
    if USE_PG:
        sql = sql.replace("?", "%s")
    for attempt in (1, 2):
        try:
            if _conn is None:
                _connect()
            cur = _conn.execute(sql, args)
            rows = cur.fetchall() if want_rows and cur.description else []
            if not USE_PG:
                _conn.commit()
            return rows if want_rows else cur.rowcount
        except Exception as exc:  # noqa: BLE001
            if USE_PG and attempt == 1 and _is_connection_error(exc):
                _reset_connection()
                continue
            raise


def _is_connection_error(exc):
    import psycopg
    return isinstance(exc, (psycopg.OperationalError, psycopg.InterfaceError))


def _reset_connection():
    global _conn
    try:
        if _conn is not None:
            _conn.close()
    except Exception:  # noqa: BLE001
        pass
    _conn = None


def q(sql, args=()):
    with _lock:
        return _run(sql, args, True)


def q1(sql, args=()):
    rows = q(sql, args)
    return rows[0] if rows else None


def qexec(sql, args=()):
    """Executa e devolve o número de linhas afetadas."""
    with _lock:
        return _run(sql, args, False)


def db_init():
    with _lock:
        if _conn is None:
            _connect()
        if USE_PG:
            for stmt in SCHEMA_PG:
                _run(stmt, (), False)
            _run("""ALTER TABLE members ADD COLUMN IF NOT EXISTS access TEXT NOT NULL DEFAULT '"*"'""", (), False)
        else:
            UPLOADS.mkdir(parents=True, exist_ok=True)
            _conn.executescript(SCHEMA_SQLITE)
            # Bancos criados antes do controle de acesso: membros antigos continuam com acesso a tudo.
            columns = {r["name"] for r in _conn.execute("PRAGMA table_info(members)")}
            if "access" not in columns:
                _conn.execute("""ALTER TABLE members ADD COLUMN access TEXT NOT NULL DEFAULT '"*"'""")
            _conn.commit()


def ensure_ready():
    """Inicialização preguiçosa: na Vercel roda na primeira requisição de cada instância."""
    global _ready
    if _ready:
        return
    with _lock:
        if _ready:
            return
        db_init()
        ensure_admin_password()
        load_content()
        _ready = True


def get_setting(key, default=""):
    row = q1("SELECT value FROM settings WHERE key = ?", (key,))
    return row["value"] if row else default


def set_setting(key, value):
    q("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, str(value)))


def now():
    return int(time.time())


# ---------------------------------------------------------------- Conteúdo do app
DEFAULT_THEME = ["#2a1740", "#5d3b78", "#e8c08a"]
CONTENT_TYPES = {"pdf", "link", "video", "text", "support", "none"}


def _s(value, limit=300):
    if value is None or isinstance(value, (dict, list)):
        return ""
    return str(value).strip()[:limit]


def _url(value):
    # Só http(s) ou arquivos enviados pelo painel: impede links "javascript:" no app.
    value = _s(value, 2000)
    return value if re.match(r"^(https?://|/uploads/)", value, re.I) else ""


def _color(value, default):
    value = _s(value, 7)
    return value if re.fullmatch(r"#[0-9a-fA-F]{6}", value) else default


def _theme(value):
    value = value if isinstance(value, list) else []
    return [_color(value[i] if i < len(value) else "", DEFAULT_THEME[i]) for i in range(3)]


def _id(value, used):
    base = re.sub(r"[^a-z0-9-]", "", _s(value, 40).lower()) or secrets.token_hex(4)
    while base in used:
        base = f"{base}-{secrets.token_hex(2)}"
    used.add(base)
    return base


def _list(value):
    return value if isinstance(value, list) else []


def _dict(value):
    return value if isinstance(value, dict) else {}


def _date(value):
    value = _s(value, 40)
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value
    except ValueError:
        return datetime.now(timezone.utc).isoformat(timespec="seconds")


def clean_content(raw):
    """Normaliza o conteúdo vindo do painel: só campos conhecidos, tipos certos e links seguros."""
    c = _dict(raw)
    app, hero, labels = _dict(c.get("app")), _dict(c.get("hero")), _dict(c.get("labels"))
    support = _dict(app.get("support"))
    out = {
        "app": {
            "name": _s(app.get("name"), 80) or "Meu App",
            "shortName": _s(app.get("shortName"), 30),
            "brand": _s(app.get("brand"), 40),
            "logo": _url(app.get("logo")),
            "primaryColor": _color(app.get("primaryColor"), "#5d3b78"),
            "loginText": _s(app.get("loginText"), 200),
            "support": {
                "whatsapp": re.sub(r"\D", "", _s(support.get("whatsapp"), 30)),
                "whatsappMessage": _s(support.get("whatsappMessage"), 300),
                "email": _s(support.get("email"), 120),
            },
        },
        "hero": {
            "tag": _s(hero.get("tag"), 120),
            "title": _s(hero.get("title"), 120),
            "subtitle": _s(hero.get("subtitle"), 400),
            "image": _url(hero.get("image")),
        },
        "labels": {
            "unlocked": _s(labels.get("unlocked"), 80) or "Conteúdos Liberados",
            "upsells": _s(labels.get("upsells"), 80) or "Achamos que você também pode gostar",
        },
        "products": [],
        "upsells": [],
        "posts": [],
    }

    used = set()
    for p in _list(c.get("products"))[:100]:
        p = _dict(p)
        cakto_ids = p.get("caktoIds")
        if isinstance(cakto_ids, str):
            cakto_ids = re.split(r"[\n,]+", cakto_ids)
        product = {
            "id": _id(p.get("id"), used),
            "title": _s(p.get("title"), 120) or "Sem título",
            "cover": _url(p.get("cover")),
            "coverText": _s(p.get("coverText"), 80),
            "theme": _theme(p.get("theme")),
            # Venda: produtos da Cakto que liberam este produto e o que aparece para quem não tem acesso.
            "caktoIds": list(dict.fromkeys(x for x in (_s(v, 120) for v in _list(cakto_ids)) if x))[:20],
            "buyUrl": _url(p.get("buyUrl")),
            "buyLabel": _s(p.get("buyLabel"), 60),
            "lockedDescription": _s(p.get("lockedDescription"), 600),
            "modules": [],
        }
        module_ids = set()
        for m in _list(p.get("modules"))[:300]:
            m = _dict(m)
            body = _dict(m.get("content"))
            product["modules"].append({
                "id": _id(m.get("id"), module_ids),
                "title": _s(m.get("title"), 160) or "Sem título",
                "continueTitle": _s(m.get("continueTitle"), 160),
                "description": _s(m.get("description"), 600),
                "cover": _url(m.get("cover")),
                "coverText": _s(m.get("coverText"), 80),
                "theme": _theme(m.get("theme")),
                "content": {
                    "type": body.get("type") if body.get("type") in CONTENT_TYPES else "none",
                    "url": _url(body.get("url")),
                    "body": _s(body.get("body"), 20000),
                    "buttonLabel": _s(body.get("buttonLabel"), 60),
                },
            })
        out["products"].append(product)

    used = set()
    for u in _list(c.get("upsells"))[:100]:
        u = _dict(u)
        out["upsells"].append({
            "id": _id(u.get("id"), used),
            "title": _s(u.get("title"), 120) or "Sem título",
            "description": _s(u.get("description"), 600),
            "cover": _url(u.get("cover")),
            "coverText": _s(u.get("coverText"), 80),
            "theme": _theme(u.get("theme")),
            "buyUrl": _url(u.get("buyUrl")),
            "buyLabel": _s(u.get("buyLabel"), 60),
        })

    used = set()
    for post in _list(c.get("posts"))[:500]:
        post = _dict(post)
        out["posts"].append({
            "id": _id(post.get("id"), used),
            "author": _s(post.get("author"), 80),
            "date": _date(post.get("date")),
            "title": _s(post.get("title"), 160),
            "body": _s(post.get("body"), 5000),
        })
    return out


_content_cache = {"rev": None, "data": None}


class ContentConflict(Exception):
    pass


def _initial_content():
    """Conteúdo da primeira execução: o que já estava em settings (versões antigas) ou o seed."""
    legacy = get_setting("content")
    if legacy:
        return clean_content(json.loads(legacy))
    seed = json.loads(SEED_FILE.read_text(encoding="utf-8")) if SEED_FILE.is_file() else {}
    return clean_content(seed)


def load_content():
    """Retorna (conteúdo, revisão). A revisão é lida do banco a cada chamada (várias instâncias na Vercel)."""
    row = q1("SELECT rev FROM app_content WHERE id = 1")
    if not row:
        data = _initial_content()
        q("INSERT INTO app_content(id, rev, data) VALUES(1, 1, ?) ON CONFLICT(id) DO NOTHING",
          (json.dumps(data, ensure_ascii=False),))
        row = q1("SELECT rev FROM app_content WHERE id = 1")
    rev = int(row["rev"])
    if _content_cache["rev"] == rev and _content_cache["data"] is not None:
        return _content_cache["data"], rev
    raw = q1("SELECT rev, data FROM app_content WHERE id = 1")
    # Normaliza ao carregar: conteúdo salvo por versões anteriores ganha os campos novos.
    data = clean_content(json.loads(raw["data"]))
    _content_cache.update(rev=int(raw["rev"]), data=data)
    return data, int(raw["rev"])


def save_content(raw, expected_rev):
    """Grava só se ninguém salvou antes (controle otimista pela revisão). Senão, ContentConflict."""
    data = clean_content(raw)
    changed = qexec("UPDATE app_content SET data = ?, rev = rev + 1 WHERE id = 1 AND rev = ?",
                    (json.dumps(data, ensure_ascii=False), int(expected_rev)))
    if changed != 1:
        raise ContentConflict()
    _content_cache.update(rev=int(expected_rev) + 1, data=data)
    return data, int(expected_rev) + 1


def mutate_content(fn):
    """Aplica fn(cópia do conteúdo) e salva; repete se outra instância salvou no meio. Devolve o retorno de fn."""
    for _ in range(8):
        data, rev = load_content()
        draft = json.loads(json.dumps(data))
        result = fn(draft)
        if result is _NO_CHANGE:
            return None
        try:
            save_content(draft, rev)
            return result
        except ContentConflict:
            time.sleep(0.05)
    raise HttpError(503, "Muitas alterações ao mesmo tempo. Tente novamente.")


_NO_CHANGE = object()


# ---------------------------------------------------------------- Senha e sessões
def hash_password(password):
    salt = secrets.token_bytes(16)
    iterations = 240_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"pbkdf2${iterations}${salt.hex()}${digest.hex()}"


def check_password(password, stored):
    try:
        _, iterations, salt, digest = stored.split("$")
        test = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
        return hmac.compare_digest(test.hex(), digest)
    except (ValueError, AttributeError):
        return False


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(kind, email=None):
    token = secrets.token_urlsafe(32)
    ttl = ADMIN_TTL if kind == "admin" else MEMBER_TTL
    q("DELETE FROM sessions WHERE expires_at < ?", (now(),))
    q("INSERT INTO sessions(token_hash, kind, email, expires_at) VALUES(?, ?, ?, ?)",
      (token_hash(token), kind, email, now() + ttl))
    return token, ttl


def read_session(token, kind):
    if not token:
        return None
    return q1("SELECT * FROM sessions WHERE token_hash = ? AND kind = ? AND expires_at > ?",
              (token_hash(token), kind, now()))


class RateLimiter:
    """Conta falhas por IP numa janela de tempo. Fica no banco: na Vercel cada requisição
    pode cair numa instância diferente, então contar em memória não funcionaria."""

    def __init__(self, scope, limit, window):
        self.scope, self.limit, self.window = scope, limit, window

    def blocked(self, key):
        row = q1("SELECT COUNT(*) AS n FROM attempts WHERE scope = ? AND key = ? AND ts > ?",
                 (self.scope, key, now() - self.window))
        return int(row["n"]) >= self.limit

    def hit(self, key):
        q("INSERT INTO attempts(scope, key, ts) VALUES(?, ?, ?)", (self.scope, key, now()))
        q("DELETE FROM attempts WHERE ts < ?", (now() - 86400,))


admin_limiter = RateLimiter("admin", limit=5, window=15 * 60)
member_limiter = RateLimiter("member", limit=20, window=10 * 60)


# ---------------------------------------------------------------- Membros e Cakto
def normalize_email(value):
    return str(value or "").strip().lower()


def parse_access(raw):
    """Acesso de um membro: "*" (todos os produtos, inclusive futuros) ou lista de ids."""
    try:
        value = json.loads(raw or '"*"')
    except ValueError:
        return "*"
    if isinstance(value, list):
        return [str(x) for x in value]
    return "*"


def has_product(access, product_id):
    return access == "*" or product_id in access


def clean_access(value):
    if value == "*":
        return "*"
    if not isinstance(value, list):
        raise HttpError(400, "Acesso inválido.")
    valid = {p["id"] for p in load_content()[0]["products"]}
    return [x for x in dict.fromkeys(str(v) for v in value) if x in valid]


def set_access(email, access):
    q("UPDATE members SET access = ?, updated_at = ? WHERE email = ?", (json.dumps(access), now(), email))


def grant_access(email, products):
    """Soma produtos ao acesso atual (nunca remove). "*" vence qualquer lista."""
    row = q1("SELECT access FROM members WHERE email = ?", (email,))
    current = parse_access(row["access"]) if row else []
    if current == "*" or products == "*":
        set_access(email, "*")
    else:
        set_access(email, list(dict.fromkeys(current + list(products))))


def product_names(ids):
    names = {p["id"]: p["title"] for p in load_content()[0]["products"]}
    return ", ".join(names.get(i, i) for i in ids)


def upsert_member(email, name="", phone="", source="manual", product="", order_id=""):
    """Cria (sem produtos) ou reativa o membro. Os produtos são dados por grant_access/set_access."""
    ts = now()
    q("""
        INSERT INTO members(email, name, phone, status, source, product, order_id, created_at, updated_at, access)
        VALUES(?, ?, ?, 'active', ?, ?, ?, ?, ?, '[]')
        ON CONFLICT(email) DO UPDATE SET
            status = 'active',
            name = CASE WHEN members.name = '' THEN excluded.name ELSE members.name END,
            phone = CASE WHEN excluded.phone = '' THEN members.phone ELSE excluded.phone END,
            source = excluded.source,
            product = CASE WHEN excluded.product = '' THEN members.product ELSE excluded.product END,
            order_id = CASE WHEN excluded.order_id = '' THEN members.order_id ELSE excluded.order_id END,
            updated_at = excluded.updated_at
    """, (email, name, phone, source, product, order_id, ts, ts))


def set_member_status(email, status):
    q("UPDATE members SET status = ?, updated_at = ? WHERE email = ?", (status, now(), email))
    if status != "active":
        q("DELETE FROM sessions WHERE kind = 'member' AND email = ?", (email,))


def _norm_name(value):
    """Nome comparável: sem acentos, minúsculo, espaços simples e sem emojis/pontuação."""
    import unicodedata
    text = unicodedata.normalize("NFD", str(value or "")).encode("ascii", "ignore").decode()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text.lower()).split())


def cakto_orders(payload):
    """Webhook V1 manda `data` como objeto; V2 manda lista (principal + order bumps + upsells)."""
    data = payload.get("data")
    if isinstance(data, list):
        return [o for o in data if isinstance(o, dict)]
    return [data] if isinstance(data, dict) else []


def order_identifiers(order):
    """Coleta id, short_id e nome do produto e da oferta de um pedido."""
    ids = set()
    for key in ("product", "offer"):
        obj = order.get(key)
        if isinstance(obj, dict):
            for field in ("id", "short_id", "shortId", "name"):
                if obj.get(field):
                    ids.add(str(obj[field]).strip())
        elif obj:
            ids.add(str(obj).strip())
    for field in ("product_id", "productId", "offer_id", "offerId"):
        if order.get(field):
            ids.add(str(order[field]).strip())
    return ids


def order_product(order):
    """(id estável, short_id, nome) do produto da Cakto num pedido."""
    product = order.get("product") if isinstance(order.get("product"), dict) else {}
    offer = order.get("offer") if isinstance(order.get("offer"), dict) else {}
    name = _s(product.get("name") or offer.get("name"), 160)
    key = _s(product.get("id") or product.get("short_id") or order.get("product_id") or name, 120)
    return key, _s(product.get("short_id"), 60), name


def remember_cakto_product(order):
    key, short_id, name = order_product(order)
    if not key:
        return ""
    offer = order.get("offer") if isinstance(order.get("offer"), dict) else {}
    row = q1("SELECT offers FROM cakto_products WHERE cakto_id = ?", (key,))
    offers = json.loads(row["offers"]) if row else []
    offer_name = _s(offer.get("name"), 120)
    if offer_name and offer_name not in offers:
        offers = (offers + [offer_name])[-10:]
    ts = now()
    q("""INSERT INTO cakto_products(cakto_id, short_id, name, offers, first_seen, last_seen) VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(cakto_id) DO UPDATE SET
            short_id = CASE WHEN excluded.short_id = '' THEN cakto_products.short_id ELSE excluded.short_id END,
            name = CASE WHEN excluded.name = '' THEN cakto_products.name ELSE excluded.name END,
            offers = excluded.offers, last_seen = excluded.last_seen""",
      (key, short_id, name, json.dumps(offers, ensure_ascii=False), ts, ts))
    return key


def record_purchase(order, email, event, status):
    key = order_product(order)[0]
    order_id = _s(order.get("id") or order.get("refId"), 120) or f"{event}:{email}:{key}"
    try:
        amount = float(order.get("amount")) if order.get("amount") is not None else None
    except (TypeError, ValueError):
        amount = None
    ts = now()
    q("""INSERT INTO purchases(order_id, email, cakto_id, offer_type, status, amount, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(order_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at""",
      (order_id, email, key, _s(order.get("offer_type"), 20), status, amount, ts, ts))


def match_products(order, persist=True):
    """Produtos do app que um pedido libera: pelos IDs vinculados ou, se não houver, pelo nome igual."""
    ids = order_identifiers(order)
    products = load_content()[0]["products"]
    matched = [p["id"] for p in products if ids.intersection(p["caktoIds"])]
    if matched:
        return matched
    key, _, name = order_product(order)
    target = _norm_name(name)
    by_name = [p["id"] for p in products if target and _norm_name(p["title"]) == target]
    if by_name and persist and key:
        link_cakto_product(key, by_name, keep_others=True)  # vincula pelo ID para as próximas vendas
    return by_name


def link_cakto_product(cakto_key, product_ids, keep_others=False):
    """Define quais produtos do app o produto `cakto_key` da Cakto libera (grava em caktoIds)."""
    def apply(data):
        changed = False
        for p in data["products"]:
            if p["id"] in product_ids:
                if cakto_key not in p["caktoIds"]:
                    p["caktoIds"].append(cakto_key)
                    changed = True
            elif not keep_others and cakto_key in p["caktoIds"]:
                p["caktoIds"].remove(cakto_key)
                changed = True
        return None if changed else _NO_CHANGE
    mutate_content(apply)


def auto_create_product(order):
    """Cria no app um produto (sem módulos) para um produto da Cakto ainda desconhecido."""
    key, _, name = order_product(order)
    ids = order_identifiers(order)

    def apply(data):
        # Outra notificação (talvez em outra instância) pode ter criado o produto agora.
        existing = [p["id"] for p in data["products"] if ids.intersection(p["caktoIds"])]
        if existing:
            apply.result = existing[0]
            return _NO_CHANGE
        product_id = f"cakto-{secrets.token_hex(4)}"
        title = name or f"Produto {key}"
        data["products"].append({"id": product_id, "title": title, "coverText": title, "caktoIds": [key] if key else [],
                                 "cover": "", "theme": None, "buyUrl": "", "buyLabel": "", "lockedDescription": "", "modules": []})
        apply.result = product_id
        return None

    apply.result = None
    mutate_content(apply)
    return apply.result


def process_cakto(payload, test=False):
    """Aplica um evento da Cakto. Retorna (email, resultado).

    test=True (botão do painel) não grava compras, não cria produtos e não registra produtos da Cakto.
    """
    event = str(payload.get("event") or "").strip()
    orders = cakto_orders(payload)
    email = ""
    customer = {}
    for o in orders:
        c = o.get("customer") if isinstance(o.get("customer"), dict) else {}
        if EMAIL_RE.match(normalize_email(c.get("email"))):
            email, customer = normalize_email(c.get("email")), c
            break
    if not email:
        return "", "ignorado: payload sem e-mail do comprador"

    # Filtro opcional: só considera pedidos de produtos da lista (Avançado).
    allowed = [p.strip() for p in get_setting("cakto_products").split(",") if p.strip()]
    if allowed and not test:
        orders = [o for o in orders if order_identifiers(o).intersection(allowed)]
        if not orders:
            return email, "ignorado: produto fora da lista de produtos aceitos"

    names = [order_product(o)[2] or order_product(o)[0] for o in orders]

    if event in GRANT_EVENTS:
        upsert_member(
            email,
            name=_s(customer.get("name"), 120),
            phone=_s(customer.get("phone"), 40),
            source="cakto",
            product=", ".join(n for n in names if n)[:300],
            order_id=_s(orders[0].get("id") or orders[0].get("refId"), 120),
        )
        rule = get_setting("cakto_unmapped", "create")
        granted, created, give_all, unlinked = [], [], False, []
        for o in orders:
            if not test:
                remember_cakto_product(o)
                record_purchase(o, email, event, "paid")
            matched = match_products(o, persist=not test)
            if not matched:
                if rule == "create" and not test:
                    new_id = auto_create_product(o)
                    matched = [new_id]
                    created.append(new_id)
                elif rule == "all":
                    give_all = True
                else:
                    unlinked.append(order_product(o)[2] or order_product(o)[0])
            granted += matched
        grant_access(email, "*" if give_all else list(dict.fromkeys(granted)))

        parts = []
        if give_all:
            parts.append("todos os produtos")
        elif granted:
            parts.append(product_names(list(dict.fromkeys(granted))))
        result = f"acesso liberado: {', '.join(parts)}" if parts else "cadastrado sem produtos"
        if created:
            result += f" (produto criado no app: {product_names(created)})"
        if unlinked:
            result += f" (sem vínculo: {', '.join(unlinked)})"
        return email, result

    if event in REVOKE_EVENTS:
        status = {"refund": "refunded", "chargeback": "chargedback", "subscription_canceled": "canceled"}[event]
        if not test:
            for o in orders:
                record_purchase(o, email, event, status)
        if get_setting("cakto_revoke", "1") != "1":
            return email, "ignorado: bloqueio automático desligado"
        row = q1("SELECT access FROM members WHERE email = ?", (email,))
        if not row:
            return email, "ignorado: membro não encontrado"
        matched = list(dict.fromkeys(pid for o in orders for pid in match_products(o, persist=False)))
        if matched:
            # Remove só os produtos dos pedidos cancelados; bloqueia se não sobrar nenhum.
            access = parse_access(row["access"])
            base = [p["id"] for p in load_content()[0]["products"]] if access == "*" else access
            remaining = [p for p in base if p not in matched]
            set_access(email, remaining)
            if not remaining:
                set_member_status(email, "revoked")
                return email, f"acesso bloqueado (removido: {product_names(matched)})"
            return email, f"acesso removido: {product_names(matched)}"
        set_member_status(email, "revoked")
        return email, "acesso bloqueado"

    return email, "ignorado: evento sem ação"


def apply_past_purchases(cakto_key):
    """Dá os produtos vinculados a quem já comprou `cakto_key` (compras pagas, membros ativos)."""
    products = [p["id"] for p in load_content()[0]["products"] if cakto_key in p["caktoIds"]]
    if not products:
        return 0
    emails = [r["email"] for r in q(
        """SELECT DISTINCT p.email FROM purchases p JOIN members m ON m.email = p.email
           WHERE p.cakto_id = ? AND p.status = 'paid' AND m.status = 'active'""", (cakto_key,))]
    for e in emails:
        grant_access(e, products)
    return len(emails)


def cakto_catalog():
    """Produtos da Cakto conhecidos + vendas + produtos do app que cada um libera."""
    products = load_content()[0]["products"]
    rows = q("""SELECT c.*,
                (SELECT COUNT(*) FROM purchases p WHERE p.cakto_id = c.cakto_id AND p.status = 'paid') AS sales,
                (SELECT COUNT(DISTINCT p.email) FROM purchases p WHERE p.cakto_id = c.cakto_id) AS buyers
                FROM cakto_products c ORDER BY c.last_seen DESC""")
    out = []
    for r in rows:
        keys = {r["cakto_id"], r["short_id"], r["name"]} - {""}
        linked = [p["id"] for p in products if keys.intersection(p["caktoIds"])]
        out.append({"cakto_id": r["cakto_id"], "short_id": r["short_id"], "name": r["name"],
                    "offers": json.loads(r["offers"]), "sales": r["sales"], "buyers": r["buyers"],
                    "first_seen": r["first_seen"], "last_seen": r["last_seen"], "linked": linked})
    return out


def log_event(event, email, result, payload):
    clean = dict(payload)
    clean.pop("secret", None)
    q("INSERT INTO events(received_at, event, email, result, payload) VALUES(?, ?, ?, ?, ?)",
      (now(), event, email, result, json.dumps(clean, ensure_ascii=False)[:100_000]))
    q("DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 2000)")


def member_row(r):
    state = json.loads(r["state"] or "{}")
    progress = state.get("progress") if isinstance(state.get("progress"), dict) else {}
    return {
        "email": r["email"], "name": r["name"], "phone": r["phone"], "status": r["status"],
        "source": r["source"], "product": r["product"], "order_id": r["order_id"],
        "created_at": r["created_at"], "first_login": r["first_login"], "last_login": r["last_login"],
        "login_count": r["login_count"],
        "progress_done": progress.get("done", 0), "progress_total": progress.get("total", 0),
        "access": parse_access(r["access"]),
    }


def content_for(member):
    """Conteúdo que um membro pode ver: módulos só dos produtos liberados; os demais vão com cadeado."""
    data = load_content()[0]
    if member is None:  # admin pré-visualizando
        return dict(data, lockedProducts=[])
    access = parse_access(member["access"])
    allowed = [p for p in data["products"] if has_product(access, p["id"])]
    # Sem acesso: aparece com cadeado só se der para comprar ou se já tiver conteúdo
    # (produtos criados automaticamente pela Cakto, ainda vazios, ficam escondidos).
    locked = [{k: p[k] for k in ("id", "title", "cover", "coverText", "theme", "buyUrl", "buyLabel", "lockedDescription")}
              for p in data["products"] if not has_product(access, p["id"]) and (p["buyUrl"] or p["modules"])]
    return dict(data, products=allowed, lockedProducts=locked)


def member_can_open(member, url):
    """Arquivo enviado só abre se estiver num módulo de produto liberado para o membro."""
    access = parse_access(member["access"])
    for p in load_content()[0]["products"]:
        if has_product(access, p["id"]) and any(m["content"]["url"] == url for m in p["modules"]):
            return True
    return False


# ---------------------------------------------------------------- Arquivos (disco local ou Vercel Blob)
BLOB_API_VERSION = "11"


def check_upload(filename, size):
    """Valida tipo e tamanho. Devolve a extensão normalizada (.jpeg vira .jpg)."""
    ext = Path(filename or "").suffix.lower()
    if ext not in IMAGE_EXTS | FILE_EXTS:
        raise HttpError(400, "Tipo de arquivo não aceito. Use imagem (PNG, JPG, WEBP, GIF), PDF, áudio, vídeo MP4, ZIP, EPUB ou documentos do Office.")
    if size <= 0:
        raise HttpError(400, "Arquivo vazio.")
    if size > UPLOAD_MAX:
        raise HttpError(413, f"Arquivo maior que {UPLOAD_MAX // (1024 * 1024)} MB. Para vídeos longos, use YouTube, Vimeo ou Panda.")
    return ".jpg" if ext == ".jpeg" else ext


def blob_client_token(pathname, max_size, valid_seconds=900):
    """Autorização de envio direto do navegador ao Vercel Blob, válida só para `pathname`.

    Mesmo algoritmo de generateClientTokenFromReadWriteToken do @vercel/blob:
    payload JSON em base64, assinado com HMAC-SHA256 (chave = token de leitura e escrita),
    no formato vercel_blob_client_{storeId}_{base64(assinatura_hex + "." + payload)}.
    """
    parts = BLOB_TOKEN.split("_")
    store_id = parts[3] if len(parts) > 3 else ""
    payload = base64.b64encode(json.dumps({
        "pathname": pathname,
        "maximumSizeInBytes": max_size,
        "addRandomSuffix": False,
        "allowOverwrite": False,
        "validUntil": int((time.time() + valid_seconds) * 1000),
    }, separators=(",", ":")).encode()).decode()
    signature = hmac.new(BLOB_TOKEN.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"vercel_blob_client_{store_id}_" + base64.b64encode(f"{signature}.{payload}".encode()).decode()


def blob_put(pathname, data, content_type, token=None):
    """Envio feito pelo servidor (usado pelo script de migração). Devolve a URL do arquivo no Blob."""
    req = urllib.request.Request(
        f"{BLOB_API}?{urlencode({'pathname': pathname})}", data=data, method="PUT",
        headers={
            "authorization": f"Bearer {token or BLOB_TOKEN}",
            "x-api-version": BLOB_API_VERSION,
            "x-vercel-blob-access": BLOB_ACCESS,
            "x-content-type": content_type,
            "x-add-random-suffix": "0",
            "x-allow-overwrite": "1",
        })
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())["url"]


# ---------------------------------------------------------------- HTTP
class HttpError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


class Handler(BaseHTTPRequestHandler):
    server_version = "AppServer"
    sys_version = ""

    # -- utilitários
    def client_ip(self):
        if TRUST_PROXY and self.headers.get("X-Forwarded-For"):
            return self.headers["X-Forwarded-For"].split(",")[0].strip()
        return self.client_address[0]

    def is_https(self):
        if COOKIE_SECURE in ("0", "1"):
            return COOKIE_SECURE == "1"
        return self.headers.get("X-Forwarded-Proto", "").lower() == "https"

    def cookie(self, name):
        for part in self.headers.get("Cookie", "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == name:
                return v
        return None

    def make_cookie(self, name, value, max_age, samesite):
        parts = [f"{name}={value}", "Path=/", "HttpOnly", f"SameSite={samesite}", f"Max-Age={max_age}"]
        if self.is_https():
            parts.append("Secure")
        return "; ".join(parts)

    def send_head(self, status, content_type, length, headers=None, cache="no-store"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("X-Frame-Options", "SAMEORIGIN")  # bloqueia sites de terceiros
        for k, v in (headers or []):
            self.send_header(k, v)
        self.end_headers()

    def send(self, status, body, content_type, headers=None, cache="no-store"):
        self.send_head(status, content_type, len(body), headers, cache)
        if self.command != "HEAD":
            self.wfile.write(body)

    def json(self, status, obj, headers=None):
        self.send(status, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8", headers)

    def body_json(self, limit=MAX_BODY):
        length = int(self.headers.get("Content-Length") or 0)
        if length > limit:
            raise HttpError(413, "Requisição grande demais.")
        raw = self.rfile.read(length) if length else b""
        try:
            data = json.loads(raw or b"{}")
        except ValueError:
            raise HttpError(400, "JSON inválido.")
        if not isinstance(data, dict):
            raise HttpError(400, "JSON inválido.")
        return data

    def require_fetch(self):
        # Bloqueia formulários de outros sites (CSRF): só o nosso fetch manda este cabeçalho.
        if self.headers.get("X-Requested-With") != "fetch":
            raise HttpError(403, "Requisição não permitida.")

    def is_admin(self):
        return bool(read_session(self.cookie(ADMIN_COOKIE), "admin"))

    def admin(self):
        if not self.is_admin():
            raise HttpError(401, "Sessão do admin expirada.")

    def viewer(self):
        """Membro logado e ativo; None quando é o admin pré-visualizando o app."""
        s = read_session(self.cookie(MEMBER_COOKIE), "member")
        if s:
            m = q1("SELECT * FROM members WHERE email = ? AND status = 'active'", (s["email"],))
            if m:
                return m
        if self.is_admin():
            return None
        if s:
            raise HttpError(401, "Seu acesso não está ativo.")
        raise HttpError(401, "Faça login para continuar.")

    def serve_file(self, path, cache="no-cache"):
        if not path.is_file():
            raise HttpError(404, "Não encontrado.")
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/json", "application/manifest+json", "image/svg+xml"):
            ctype += "; charset=utf-8"
        self.send(200, path.read_bytes(), ctype, cache=cache)

    def serve_static(self, url_path):
        rel = unquote(url_path).lstrip("/") or "index.html"
        target = (PUBLIC / rel).resolve()
        if PUBLIC.resolve() not in target.parents:
            raise HttpError(404, "Não encontrado.")
        if target.name == "admin.html":  # só pelo ADMIN_PATH
            raise HttpError(404, "Não encontrado.")
        self.serve_file(target)

    def serve_upload(self, name):
        if not UPLOAD_NAME_RE.match(name):
            raise HttpError(404, "Não encontrado.")
        ext = Path(name).suffix.lower()
        if ext not in IMAGE_EXTS:
            # Arquivos (PDF, áudio...) só para o admin ou para membros com o produto liberado.
            m = self.viewer()
            if m is not None and not member_can_open(m, f"/uploads/{name}"):
                raise HttpError(403, "Este material não faz parte do seu acesso.")
        # Arquivo no Vercel Blob: depois da checagem de acesso, redireciona para o endereço do Blob.
        row = q1("SELECT url FROM uploads WHERE name = ?", (name,))
        if row and row["url"].startswith("https://"):
            cache = "public, max-age=86400" if ext in IMAGE_EXTS else "private, no-store"
            return self.send(302, b"", "text/plain", [("Location", row["url"])], cache=cache)
        path = UPLOADS / name
        if not path.is_file():
            raise HttpError(404, "Não encontrado.")
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        size = path.stat().st_size
        start, end, status = 0, size - 1, 200
        m = re.match(r"^bytes=(\d*)-(\d*)$", self.headers.get("Range", ""))
        if m and (m.group(1) or m.group(2)) and size:
            if m.group(1):
                start = int(m.group(1))
                end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
            else:
                start = max(size - int(m.group(2)), 0)
            if start > end or start >= size:
                return self.send(416, b"", "text/plain", [("Content-Range", f"bytes */{size}")])
            status = 206
        headers = [("Accept-Ranges", "bytes"), ("Content-Disposition", "inline")]
        if status == 206:
            headers.append(("Content-Range", f"bytes {start}-{end}/{size}"))
        cache = "public, max-age=31536000, immutable" if ext in IMAGE_EXTS else "private, max-age=3600"
        self.send_head(status, ctype, end - start + 1, headers, cache)
        if self.command == "HEAD":
            return
        with path.open("rb") as f:
            f.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = f.read(min(65536, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def manifest(self):
        app = load_content()[0]["app"]
        icons = [{"src": "/icons/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any"}]
        if app["logo"]:
            icons.insert(0, {"src": app["logo"], "sizes": "512x512",
                             "type": mimetypes.guess_type(app["logo"])[0] or "image/png", "purpose": "any"})
        body = {
            "name": app["name"], "short_name": app["shortName"] or app["name"][:30],
            "start_url": "/#/", "scope": "/", "display": "standalone",
            "background_color": "#ffffff", "theme_color": app["primaryColor"], "icons": icons,
        }
        self.send(200, json.dumps(body, ensure_ascii=False).encode(), "application/manifest+json; charset=utf-8", cache="no-cache")

    # -- despacho
    def do_GET(self):
        self.dispatch("GET")

    def do_HEAD(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def request_path(self):
        """Caminho original da requisição. Na Vercel, os rewrites do vercel.json mandam tudo para
        /api/index com ?__path=/caminho/original; no computador o caminho chega direto."""
        url = urlparse(self.path)
        original = parse_qs(url.query).get("__path", [""])[0]
        path = original if original.startswith("/") else url.path
        return path.rstrip("/") or "/"

    def dispatch(self, method):
        path = self.request_path()
        try:
            try:
                ensure_ready()
            except Exception as e:  # noqa: BLE001
                sys.stderr.write(f"Falha ao iniciar: {e!r}\n")
                raise HttpError(503, "Servidor sem banco de dados configurado. Veja o README (Publicar na Vercel).")
            if path == "/api/webhooks/cakto" and method == "POST":
                return self.webhook_cakto()
            if path.startswith("/api/admin"):
                return self.admin_api(method, path)
            if path.startswith("/api/"):
                return self.member_api(method, path)
            if path.startswith("/uploads/") and method == "GET":
                return self.serve_upload(path[len("/uploads/"):])
            if path == "/manifest.webmanifest" and method == "GET":
                return self.manifest()
            if path == ADMIN_PATH and method == "GET":
                return self.serve_file(PUBLIC / "admin.html", cache="no-store")
            if method == "GET":
                return self.serve_static(path)
            raise HttpError(405, "Método não permitido.")
        except ContentConflict:
            self.json(409, {"error": "O conteúdo foi alterado em outra aba. Recarregue a página para ver a versão mais recente."})
        except HttpError as e:
            if path.startswith("/api/") or path.startswith("/uploads/"):
                self.json(e.status, {"error": e.message})
            else:
                self.send(e.status, e.message.encode(), "text/plain; charset=utf-8")
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # noqa: BLE001 - nunca derrubar o servidor por uma requisição
            sys.stderr.write(f"Erro em {method} {path}: {e!r}\n")
            self.json(500, {"error": "Erro interno."})

    # -- API dos membros
    def member_api(self, method, path):
        if method != "GET":
            self.require_fetch()

        if path == "/api/config" and method == "GET":
            # Público: nome, logo, cores e textos da tela de login.
            return self.json(200, {"app": load_content()[0]["app"]})

        if path == "/api/login" and method == "POST":
            ip = self.client_ip()
            if member_limiter.blocked(ip):
                raise HttpError(429, "Muitas tentativas. Aguarde alguns minutos.")
            email = normalize_email(self.body_json().get("email"))
            if not EMAIL_RE.match(email):
                raise HttpError(400, "Informe um e-mail válido.")
            m = q1("SELECT status FROM members WHERE email = ?", (email,))
            if not m:
                member_limiter.hit(ip)
                raise HttpError(403, "Não encontramos uma compra com este e-mail. Use o mesmo e-mail da compra.")
            if m["status"] != "active":
                member_limiter.hit(ip)
                raise HttpError(403, "O acesso deste e-mail está bloqueado. Fale com o suporte.")
            ts = now()
            q("""UPDATE members SET last_login = ?, first_login = COALESCE(first_login, ?),
                 login_count = login_count + 1 WHERE email = ?""", (ts, ts, email))
            token, ttl = create_session("member", email)
            return self.json(200, {"ok": True}, [("Set-Cookie", self.make_cookie(MEMBER_COOKIE, token, ttl, "Lax"))])

        if path == "/api/logout" and method == "POST":
            token = self.cookie(MEMBER_COOKIE)
            if token:
                q("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))
            return self.json(200, {"ok": True}, [("Set-Cookie", self.make_cookie(MEMBER_COOKIE, "", 0, "Lax"))])

        if path == "/api/me" and method == "GET":
            m = self.viewer()
            if m is None:
                return self.json(200, {"email": "admin", "name": "Admin", "preview": True, "state": {}})
            state = json.loads(m["state"] or "{}")
            return self.json(200, {"email": m["email"], "name": state.get("name") or m["name"], "state": state})

        if path == "/api/content" and method == "GET":
            return self.json(200, content_for(self.viewer()))

        if path == "/api/state" and method == "PUT":
            m = self.viewer()
            state = self.body_json().get("state")
            if not isinstance(state, dict):
                raise HttpError(400, "Estado inválido.")
            if m is None:  # pré-visualização do admin: não grava nada
                return self.json(200, {"ok": True})
            progress = state.get("progress") if isinstance(state.get("progress"), dict) else {}
            clean = {
                "completed": [str(x)[:200] for x in _list(state.get("completed"))][:500],
                "favorites": [str(x)[:200] for x in _list(state.get("favorites"))][:30],
                "last": state.get("last") if isinstance(state.get("last"), dict) else None,
                "name": str(state.get("name") or "")[:80],
                "progress": {"done": int(progress.get("done", 0) or 0), "total": int(progress.get("total", 0) or 0)},
            }
            q("UPDATE members SET state = ? WHERE email = ?", (json.dumps(clean, ensure_ascii=False), m["email"]))
            return self.json(200, {"ok": True})

        raise HttpError(404, "Não encontrado.")

    # -- Webhook Cakto
    def webhook_cakto(self):
        payload = self.body_json()
        event = str(payload.get("event") or "")
        secret = get_setting("cakto_secret")
        if not secret:
            log_event(event, "", "recusado: chave secreta não configurada no painel", payload)
            raise HttpError(503, "Webhook não configurado.")
        if not hmac.compare_digest(str(payload.get("secret") or ""), secret):
            log_event(event, "", "recusado: chave secreta inválida", payload)
            raise HttpError(401, "Chave secreta inválida.")
        email, result = process_cakto(payload)
        log_event(event, email, result, payload)
        self.json(200, {"ok": True, "result": result})

    # -- Envio de arquivos (admin)
    def upload(self):
        """Envio direto para a pasta data/uploads (só no computador)."""
        if ON_VERCEL:
            raise HttpError(503, "Na Vercel os arquivos vão para o Vercel Blob. Conecte um Blob ao projeto.")
        name = unquote(self.headers.get("X-Filename", "") or "arquivo")
        length = int(self.headers.get("Content-Length") or 0)
        ext = check_upload(name, length)
        final = UPLOADS / f"{secrets.token_hex(8)}{ext}"
        tmp = final.with_suffix(final.suffix + ".part")
        remaining = length
        with tmp.open("wb") as f:
            while remaining > 0:
                chunk = self.rfile.read(min(65536, remaining))
                if not chunk:
                    break
                f.write(chunk)
                remaining -= len(chunk)
        if remaining:
            tmp.unlink(missing_ok=True)
            raise HttpError(400, "Envio interrompido. Tente novamente.")
        tmp.replace(final)
        return self.json(200, {"url": f"/uploads/{final.name}", "name": name, "size": length,
                               "kind": "image" if ext in IMAGE_EXTS else "file"})

    # -- API do admin
    def admin_api(self, method, path):
        if method != "GET":
            self.require_fetch()

        if path == "/api/admin/login" and method == "POST":
            ip = self.client_ip()
            if admin_limiter.blocked(ip):
                raise HttpError(429, "Muitas tentativas. Tente novamente em 15 minutos.")
            password = str(self.body_json().get("password") or "")
            if not get_setting("admin_password_hash"):
                raise HttpError(503, "Senha do admin não definida. Crie a variável ADMIN_PASSWORD na Vercel e faça um novo deploy.")
            if not check_password(password, get_setting("admin_password_hash")):
                admin_limiter.hit(ip)
                time.sleep(0.5)
                raise HttpError(401, "Senha incorreta.")
            token, ttl = create_session("admin")
            return self.json(200, {"ok": True}, [("Set-Cookie", self.make_cookie(ADMIN_COOKIE, token, ttl, "Strict"))])

        if path == "/api/admin/logout" and method == "POST":
            token = self.cookie(ADMIN_COOKIE)
            if token:
                q("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))
            return self.json(200, {"ok": True}, [("Set-Cookie", self.make_cookie(ADMIN_COOKIE, "", 0, "Strict"))])

        self.admin()

        if path == "/api/admin/session" and method == "GET":
            return self.json(200, {"ok": True})

        if path == "/api/admin/content" and method == "GET":
            data, rev = load_content()
            return self.json(200, {"content": data, "rev": rev})

        if path == "/api/admin/content" and method == "PUT":
            body = self.body_json(MAX_CONTENT_BODY)
            # Nunca aceitar um salvamento sem conteúdo ou sem revisão: isso apagaria o app inteiro.
            if not isinstance(body.get("content"), dict) or not isinstance(body["content"].get("app"), dict):
                raise HttpError(400, "Conteúdo inválido.")
            if not isinstance(body.get("rev"), int):
                raise HttpError(400, "Revisão ausente. Recarregue a página.")
            data, rev = save_content(body["content"], body["rev"])
            return self.json(200, {"content": data, "rev": rev})

        if path == "/api/admin/upload" and method == "POST":
            return self.upload()

        if path == "/api/admin/upload/start" and method == "POST":
            # 1º passo do envio: valida o arquivo e, na Vercel, devolve uma autorização para o
            # navegador enviar direto ao Blob (sem passar pelo limite de 4,5 MB da função).
            body = self.body_json()
            ext = check_upload(_s(body.get("filename"), 200), int(body.get("size") or 0))
            name = f"{secrets.token_hex(8)}{ext}"
            if not USE_BLOB:
                if ON_VERCEL:
                    raise HttpError(503, "Conecte um Vercel Blob ao projeto para enviar arquivos.")
                return self.json(200, {"mode": "local"})
            pathname = f"uploads/{name}"
            return self.json(200, {
                "mode": "blob", "name": name, "pathname": pathname, "access": BLOB_ACCESS,
                "uploadUrl": f"{BLOB_API}?{urlencode({'pathname': pathname})}",
                "token": blob_client_token(pathname, UPLOAD_MAX),
                "apiVersion": BLOB_API_VERSION,
            })

        if path == "/api/admin/upload/finish" and method == "POST":
            # 2º passo: registra o arquivo enviado ao Blob e devolve o endereço do app (/uploads/...).
            body = self.body_json()
            name = _s(body.get("name"), 40)
            blob_url = _s(body.get("url"), 1000)
            parsed = urlparse(blob_url)
            if (not UPLOAD_NAME_RE.match(name) or parsed.scheme != "https"
                    or not parsed.hostname or not parsed.hostname.endswith(".blob.vercel-storage.com")
                    or parsed.path != f"/uploads/{name}"):
                raise HttpError(400, "Envio inválido. Tente novamente.")
            q("""INSERT INTO uploads(name, url, original, content_type, size, created_at) VALUES(?, ?, ?, ?, ?, ?)
                 ON CONFLICT(name) DO UPDATE SET url = excluded.url""",
              (name, blob_url, _s(body.get("filename"), 200), _s(body.get("contentType"), 100),
               int(body.get("size") or 0), now()))
            return self.json(200, {"url": f"/uploads/{name}",
                                   "kind": "image" if Path(name).suffix in IMAGE_EXTS else "file"})

        if path == "/api/admin/stats" and method == "GET":
            week = now() - 7 * 86400
            row = q1("""SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) AS revoked,
                SUM(CASE WHEN login_count > 0 THEN 1 ELSE 0 END) AS accessed,
                SUM(CASE WHEN last_login >= ? THEN 1 ELSE 0 END) AS active_week,
                SUM(CASE WHEN source = 'cakto' THEN 1 ELSE 0 END) AS from_cakto
                FROM members""", (week,))
            return self.json(200, {k: int(row[k] or 0) for k in row.keys()})

        if path == "/api/admin/members" and method == "GET":
            rows = q("SELECT * FROM members ORDER BY COALESCE(last_login, 0) DESC, created_at DESC")
            return self.json(200, {"members": [member_row(r) for r in rows]})

        if path == "/api/admin/members.csv" and method == "GET":
            out = io.StringIO()
            w = csv.writer(out, delimiter=";")
            w.writerow(["email", "nome", "telefone", "status", "origem", "produto_cakto", "pedido",
                        "cadastrado_em", "primeiro_acesso", "ultimo_acesso", "acessos", "modulos_concluidos",
                        "produtos_liberados"])

            def fmt(ts):
                return time.strftime("%d/%m/%Y %H:%M", time.localtime(ts)) if ts else ""

            for r in q("SELECT * FROM members ORDER BY created_at DESC"):
                m = member_row(r)
                w.writerow([m["email"], m["name"], m["phone"], m["status"], m["source"], m["product"], m["order_id"],
                            fmt(m["created_at"]), fmt(m["first_login"]), fmt(m["last_login"]), m["login_count"],
                            f'{m["progress_done"]}/{m["progress_total"]}',
                            "Todos" if m["access"] == "*" else product_names(m["access"])])
            body = ("﻿" + out.getvalue()).encode("utf-8")
            return self.send(200, body, "text/csv; charset=utf-8",
                             [("Content-Disposition", 'attachment; filename="membros.csv"')])

        if path == "/api/admin/members" and method == "POST":
            data = self.body_json()
            emails = [normalize_email(e) for e in re.split(r"[\s,;]+", str(data.get("emails") or ""))]
            valid = sorted({e for e in emails if EMAIL_RE.match(e)})
            invalid = [e for e in emails if e and not EMAIL_RE.match(e)]
            access = clean_access(data.get("access", "*"))
            if access != "*" and not access:
                raise HttpError(400, "Selecione pelo menos um produto.")
            for e in valid:
                upsert_member(e, name=str(data.get("name") or "").strip() if len(valid) == 1 else "")
                grant_access(e, access)
            return self.json(200, {"added": len(valid), "invalid": invalid})

        if path == "/api/admin/members/access" and method == "POST":
            data = self.body_json()
            email = normalize_email(data.get("email"))
            if not q1("SELECT 1 FROM members WHERE email = ?", (email,)):
                raise HttpError(404, "Membro não encontrado.")
            set_access(email, clean_access(data.get("access")))
            return self.json(200, {"ok": True})

        if path == "/api/admin/members/status" and method == "POST":
            data = self.body_json()
            email = normalize_email(data.get("email"))
            status = data.get("status")
            if status not in ("active", "revoked"):
                raise HttpError(400, "Status inválido.")
            set_member_status(email, status)
            return self.json(200, {"ok": True})

        if path == "/api/admin/members/delete" and method == "POST":
            email = normalize_email(self.body_json().get("email"))
            q("DELETE FROM members WHERE email = ?", (email,))
            q("DELETE FROM sessions WHERE kind = 'member' AND email = ?", (email,))
            return self.json(200, {"ok": True})

        if path == "/api/admin/settings" and method == "GET":
            secret = get_setting("cakto_secret")
            return self.json(200, {
                "webhook_path": "/api/webhooks/cakto",
                "cakto_secret_set": bool(secret),
                "cakto_secret_hint": f"••••{secret[-4:]}" if len(secret) >= 8 else ("••••" if secret else ""),
                "cakto_products": get_setting("cakto_products"),
                "cakto_revoke": get_setting("cakto_revoke", "1") == "1",
                "cakto_unmapped": get_setting("cakto_unmapped", "create"),
                "grant_events": sorted(GRANT_EVENTS),
                "revoke_events": sorted(REVOKE_EVENTS),
            })

        if path == "/api/admin/settings" and method == "POST":
            data = self.body_json()
            if "cakto_secret" in data:
                set_setting("cakto_secret", str(data["cakto_secret"] or "").strip())
            if "cakto_products" in data:
                items = [p.strip() for p in str(data["cakto_products"] or "").replace("\n", ",").split(",")]
                set_setting("cakto_products", ",".join(p for p in items if p))
            if "cakto_revoke" in data:
                set_setting("cakto_revoke", "1" if data["cakto_revoke"] else "0")
            if data.get("cakto_unmapped") in ("create", "all", "none"):
                set_setting("cakto_unmapped", data["cakto_unmapped"])
            return self.json(200, {"ok": True})

        if path == "/api/admin/events" and method == "GET":
            rows = q("SELECT id, received_at, event, email, result, payload FROM events ORDER BY id DESC LIMIT 200")
            return self.json(200, {"events": [dict(r) for r in rows]})

        if path == "/api/admin/events/reprocess" and method == "POST":
            row = q1("SELECT payload FROM events WHERE id = ?", (int(self.body_json().get("id") or 0),))
            if not row:
                raise HttpError(404, "Evento não encontrado.")
            payload = json.loads(row["payload"])
            email, result = process_cakto(payload)
            log_event(str(payload.get("event") or ""), email, f"reprocessado: {result}", payload)
            return self.json(200, {"result": result})

        if path == "/api/admin/test-webhook" and method == "POST":
            body = self.body_json()
            email = normalize_email(body.get("email"))
            if not EMAIL_RE.match(email):
                raise HttpError(400, "Informe um e-mail válido.")
            # Simula uma compra no formato do Webhook V2 (lista de pedidos: principal + order bumps).
            # Cada produto escolhido vira um pedido com o ID da Cakto vinculado a ele (ou o nome).
            wanted = [str(x) for x in _list(body.get("product_ids"))]
            if not wanted and body.get("product_id"):
                wanted = [str(body["product_id"])]
            products = [p for p in load_content()[0]["products"] if p["id"] in wanted]
            if not products:
                raise HttpError(400, "Escolha pelo menos um produto para o teste.")
            orders = []
            for i, p in enumerate(products):
                orders.append({
                    "id": f"teste-{i}", "status": "paid", "offer_type": "main" if i == 0 else "orderbump",
                    "customer": {"name": "", "email": email},
                    "product": {"id": (p["caktoIds"] or [p["title"]])[0], "name": p["title"]},
                })
            payload = {"event": "purchase_approved", "test": True, "data": orders}
            email, result = process_cakto(payload, test=True)
            log_event("teste (purchase_approved)", email, result, payload)
            return self.json(200, {"result": result})

        if path == "/api/admin/cakto/products" and method == "GET":
            return self.json(200, {"products": cakto_catalog()})

        if path == "/api/admin/cakto/products" and method == "POST":
            # Cadastro manual (para vincular antes da primeira venda).
            data = self.body_json()
            key = _s(data.get("cakto_id"), 120)
            if not key:
                raise HttpError(400, "Informe o ID do produto na Cakto.")
            ts = now()
            q("""INSERT INTO cakto_products(cakto_id, short_id, name, offers, first_seen, last_seen) VALUES(?, '', ?, '[]', ?, ?)
                 ON CONFLICT(cakto_id) DO UPDATE SET name = CASE WHEN excluded.name = '' THEN cakto_products.name ELSE excluded.name END""",
              (key, _s(data.get("name"), 160), ts, ts))
            return self.json(200, {"ok": True})

        if path == "/api/admin/cakto/products/delete" and method == "POST":
            key = _s(self.body_json().get("cakto_id"), 120)
            link_cakto_product(key, [])
            q("DELETE FROM cakto_products WHERE cakto_id = ?", (key,))
            return self.json(200, {"ok": True})

        if path == "/api/admin/cakto/link" and method == "POST":
            data = self.body_json()
            key = _s(data.get("cakto_id"), 120)
            row = q1("SELECT * FROM cakto_products WHERE cakto_id = ?", (key,))
            if not row:
                raise HttpError(404, "Produto da Cakto não encontrado.")
            valid = {p["id"] for p in load_content()[0]["products"]}
            chosen = [str(x) for x in _list(data.get("products")) if str(x) in valid]
            # Remove vínculos antigos feitos pelo short_id ou nome, para valer só a escolha atual.
            for alias in {row["short_id"], row["name"]} - {"", key}:
                link_cakto_product(alias, [])
            link_cakto_product(key, chosen)
            applied = apply_past_purchases(key) if data.get("apply_past") and chosen else 0
            return self.json(200, {"ok": True, "applied": applied})

        if path == "/api/admin/password" and method == "POST":
            data = self.body_json()
            if not check_password(str(data.get("current") or ""), get_setting("admin_password_hash")):
                raise HttpError(400, "Senha atual incorreta.")
            new = str(data.get("new") or "")
            if len(new) < 10:
                raise HttpError(400, "A nova senha precisa ter pelo menos 10 caracteres.")
            set_setting("admin_password_hash", hash_password(new))
            q("DELETE FROM sessions WHERE kind = 'admin'")
            return self.json(200, {"ok": True}, [("Set-Cookie", self.make_cookie(ADMIN_COOKIE, "", 0, "Strict"))])

        raise HttpError(404, "Não encontrado.")


# ---------------------------------------------------------------- Inicialização
def ensure_admin_password():
    if get_setting("admin_password_hash"):
        return
    password = os.environ.get("ADMIN_PASSWORD", "")
    generated = not password
    if generated and ON_VERCEL:
        return  # na Vercel a senha inicial vem da variável ADMIN_PASSWORD (ver README)
    if generated:
        password = secrets.token_urlsafe(12)
    set_setting("admin_password_hash", hash_password(password))
    if generated:
        print("=" * 60)
        print(" Senha do painel admin criada (anote, ela não será exibida de novo):")
        print(f"   {password}")
        print(" Para trocar: python dev.py set-admin-password")
        print("=" * 60)


def cli_set_password():
    db_init()
    password = os.environ.get("ADMIN_PASSWORD") or getpass.getpass("Nova senha do admin (mín. 10 caracteres): ")
    if len(password) < 10:
        sys.exit("Senha curta demais.")
    set_setting("admin_password_hash", hash_password(password))
    q("DELETE FROM sessions WHERE kind = 'admin'")
    print("Senha do admin atualizada.")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "set-admin-password":
        return cli_set_password()
    ensure_ready()
    print(f"Banco: {'Postgres' if USE_PG else DB_PATH} | Arquivos: {'Vercel Blob' if USE_BLOB else UPLOADS}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"App:   http://localhost:{PORT}/")
    print(f"Admin: http://localhost:{PORT}{ADMIN_PATH}")
    print("Webhook Cakto: <seu-dominio>/api/webhooks/cakto", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
