"""Copia os dados do computador (data/app.db e data/uploads) para o Postgres e o Blob da Vercel.

Uso (no terminal, dentro da pasta do projeto):

    set DATABASE_URL=postgresql://...            (Windows: set ... | Mac/Linux: export ...)
    set BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
    python scripts/migrar_para_vercel.py

- Membros, compras e produtos da Cakto já existentes no destino são mantidos (não duplica).
- Conteúdo do app, configurações (senha do admin, chave da Cakto, regras) são sobrescritos pelos do computador.
- Arquivos já enviados ao Blob não são enviados de novo. Pode rodar mais de uma vez.
- Precisa do pacote psycopg:  pip install -r requirements.txt
"""
import json
import mimetypes
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
SOURCE_DB = Path(os.environ.get("SOURCE_DB", ROOT / "data" / "app.db"))
SOURCE_UPLOADS = Path(os.environ.get("SOURCE_UPLOADS", ROOT / "data" / "uploads"))


def main():
    if not (os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")):
        sys.exit("Defina DATABASE_URL com a conexão do Postgres da Vercel (Storage > Neon > .env.local).")
    if not SOURCE_DB.is_file():
        sys.exit(f"Banco do computador não encontrado em {SOURCE_DB}.")

    from backend import server as srv  # lê DATABASE_URL/BLOB_READ_WRITE_TOKEN do ambiente
    if not srv.USE_PG:
        sys.exit("DATABASE_URL precisa começar com postgres:// ou postgresql://")

    src = sqlite3.connect(f"file:{SOURCE_DB}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row
    tables = {r["name"] for r in src.execute("SELECT name FROM sqlite_master WHERE type='table'")}

    print("Preparando o banco de destino...")
    srv.db_init()

    def rows(table):
        return [dict(r) for r in src.execute(f"SELECT * FROM {table}")] if table in tables else []

    # Membros
    n = 0
    for m in rows("members"):
        m.setdefault("access", '"*"')
        n += srv.qexec(
            """INSERT INTO members(email, name, phone, status, source, product, order_id, created_at, updated_at,
                                   first_login, last_login, login_count, state, access)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING""",
            (m["email"], m["name"], m["phone"], m["status"], m["source"], m["product"], m["order_id"],
             m["created_at"], m["updated_at"], m["first_login"], m["last_login"], m["login_count"],
             m["state"], m["access"]))
    print(f"  membros copiados: {n}")

    # Produtos da Cakto e compras
    n = 0
    for c in rows("cakto_products"):
        n += srv.qexec("""INSERT INTO cakto_products(cakto_id, short_id, name, offers, first_seen, last_seen)
                          VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(cakto_id) DO NOTHING""",
                       (c["cakto_id"], c["short_id"], c["name"], c["offers"], c["first_seen"], c["last_seen"]))
    print(f"  produtos da Cakto copiados: {n}")
    n = 0
    for p in rows("purchases"):
        n += srv.qexec("""INSERT INTO purchases(order_id, email, cakto_id, offer_type, status, amount, created_at, updated_at)
                          VALUES(?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(order_id) DO NOTHING""",
                       (p["order_id"], p["email"], p["cakto_id"], p["offer_type"], p["status"], p["amount"],
                        p["created_at"], p["updated_at"]))
    print(f"  compras copiadas: {n}")

    # Histórico de eventos (só se o destino ainda não tiver nenhum, para não duplicar)
    if int(srv.q1("SELECT COUNT(*) AS n FROM events")["n"]) == 0:
        events = rows("events")
        for e in sorted(events, key=lambda x: x["id"]):
            srv.q("INSERT INTO events(received_at, event, email, result, payload) VALUES(?, ?, ?, ?, ?)",
                  (e["received_at"], e["event"], e["email"], e["result"], e["payload"]))
        print(f"  eventos copiados: {len(events)}")

    # Configurações (senha do admin, chave e regras da Cakto)
    settings = {r["key"]: r["value"] for r in rows("settings")}
    legacy_content = settings.pop("content", None)
    settings.pop("content_rev", None)
    for key, value in settings.items():
        srv.set_setting(key, value)
    print(f"  configurações copiadas: {len(settings)}")

    # Conteúdo do app
    content = None
    if "app_content" in tables:
        row = src.execute("SELECT data FROM app_content WHERE id = 1").fetchone()
        content = json.loads(row["data"]) if row else None
    if content is None and legacy_content:
        content = json.loads(legacy_content)
    if content is not None:
        data, rev = srv.load_content()
        srv.save_content(content, rev)
        print("  conteúdo do app copiado")

    # Arquivos enviados
    if SOURCE_UPLOADS.is_dir():
        files = [f for f in SOURCE_UPLOADS.iterdir() if f.is_file() and srv.UPLOAD_NAME_RE.match(f.name)]
        if files and not srv.USE_BLOB:
            print(f"  ATENÇÃO: {len(files)} arquivo(s) não enviados: defina BLOB_READ_WRITE_TOKEN e rode de novo.")
        elif files:
            sent = 0
            for f in files:
                if srv.q1("SELECT 1 AS ok FROM uploads WHERE name = ?", (f.name,)):
                    continue
                ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
                url = srv.blob_put(f"uploads/{f.name}", f.read_bytes(), ctype)
                srv.q("""INSERT INTO uploads(name, url, original, content_type, size, created_at) VALUES(?, ?, ?, ?, ?, ?)
                         ON CONFLICT(name) DO UPDATE SET url = excluded.url""",
                      (f.name, url, f.name, ctype, f.stat().st_size, srv.now()))
                sent += 1
                print(f"    enviado: {f.name}")
            print(f"  arquivos enviados ao Blob: {sent} (já existiam: {len(files) - sent})")

    print("Pronto! Os membros precisam entrar de novo no app (as sessões não são copiadas).")


if __name__ == "__main__":
    main()
