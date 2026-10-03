"""Roda o app no computador.

    python dev.py                       # inicia o servidor em http://localhost:8080
    python dev.py set-admin-password    # define/troca a senha do admin

Sem variáveis de ambiente usa SQLite (data/app.db) e a pasta data/uploads.
Com DATABASE_URL apontando para o Postgres da Vercel, o mesmo comando mexe no banco de produção.
"""
from backend.server import main

if __name__ == "__main__":
    main()
