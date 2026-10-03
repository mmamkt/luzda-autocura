# Luz da Autocura

Área de membros com acesso liberado automaticamente pelas compras da Cakto, e painel admin
que edita **todo** o app: nome, logo, cores, banner, produtos, módulos, materiais, ofertas e avisos.

- **Na Vercel:** páginas servidas pela CDN, servidor como função Python (`api/index.py`),
  banco **Postgres (Neon)** e arquivos no **Vercel Blob**.
- **No computador:** o mesmo código roda com `python dev.py`, usando SQLite e a pasta `data/`.

## Publicar na Vercel

### 1. Projeto
1. Envie este projeto para o GitHub (o repositório pode ser privado).
2. Na Vercel: **Add New → Project**, importe o repositório e clique em **Deploy**.
   Não precisa escolher framework: o `vercel.json` já configura tudo.
   O primeiro deploy mostra um erro de banco: é esperado até o passo 2.

### 2. Banco de dados (Postgres)
1. No projeto: **Storage → Create Database → Neon (Postgres)** → crie e conecte ao projeto.
2. A Vercel cria a variável `DATABASE_URL` sozinha.

### 3. Arquivos (Vercel Blob)
1. **Storage → Create → Blob**, escolha o acesso **Public** e conecte ao projeto.
2. A Vercel cria a variável `BLOB_READ_WRITE_TOKEN` sozinha.

> Use **Public**: o app confere login e produto liberado antes de entregar cada arquivo,
> e os endereços dos arquivos são aleatórios e impossíveis de adivinhar.

### 4. Senha do admin
Em **Settings → Environment Variables**, crie `ADMIN_PASSWORD` com a senha do painel (mínimo 10 caracteres).
Ela só é usada na primeira vez; depois, troque pelo painel em **Conta**.

### 5. Novo deploy
Em **Deployments**, clique em **Redeploy** para as variáveis valerem. Pronto:

- App: `https://SEU-PROJETO.vercel.app/`
- Painel: `https://SEU-PROJETO.vercel.app/admin`
- Webhook da Cakto: `https://SEU-PROJETO.vercel.app/api/webhooks/cakto`

Para usar um domínio próprio: **Settings → Domains**. Depois, atualize a URL do webhook na Cakto.

### 6. Levar os dados que já estão no computador (opcional)
Copia membros, compras, eventos, configurações (inclusive a senha do admin e a chave da Cakto),
o conteúdo do app e os arquivos enviados:

```bash
pip install -r requirements.txt
set DATABASE_URL=postgresql://...          # Vercel → Storage → Neon → .env.local
set BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... # Vercel → Storage → Blob → .env.local
python scripts/migrar_para_vercel.py
```

(No Mac/Linux use `export` no lugar de `set`.) Pode rodar mais de uma vez: nada é duplicado.

### Custos e limites
- O plano **Hobby** (grátis) da Vercel é só para uso **não comercial**. Como o app é vendido, use o plano **Pro**.
- Neon e Blob têm cota grátis; acima dela são cobrados por uso.
- Cada arquivo enviado pelo painel pode ter até **100 MB** (`UPLOAD_MAX_MB`).
  Para vídeos, prefira YouTube (não listado), Vimeo ou Panda.

### Esqueceu a senha do admin na Vercel?
No computador, com a conexão do banco de produção:

```bash
set DATABASE_URL=postgresql://...
python dev.py set-admin-password
```

## Rodar no computador

```bash
python dev.py
```

- App: http://localhost:8080/
- Admin: http://localhost:8080/admin

Na primeira execução, o terminal mostra a **senha do admin** gerada (aparece uma única vez).
Para trocar: `python dev.py set-admin-password`.

Também roda em Docker / VPS / Railway (`Dockerfile` incluso; monte um volume em `/data`).

## Painel admin

| Aba | O que dá para fazer |
|---|---|
| Membros | Ver quem tem acesso, último acesso e progresso. Liberar, bloquear, editar acessos por produto, excluir, exportar CSV |
| Conteúdo | Criar, editar, duplicar, reordenar e excluir produtos, módulos e ofertas. Enviar capas e materiais |
| Aparência | Nome, logo/ícone, cor principal, texto do login, banner, títulos e contatos de suporte |
| Avisos | Publicar, editar e excluir avisos |
| Integração Cakto | Webhook, chave secreta, produtos da Cakto detectados e vínculos, regras e teste |
| Eventos | Histórico das notificações da Cakto, com opção de reprocessar |
| Conta | Trocar a senha do admin |

**Abrir app** mostra o app como um membro vê (pré-visualização, sem gravar progresso).

## Identificação automática dos produtos (Cakto)

A cada compra aprovada (webhook V1 ou V2, com order bumps e upsells), o servidor:

1. Registra cada produto da Cakto em **Integração Cakto → Produtos da Cakto** e grava a venda.
2. Descobre o produto do app que cada um libera: pelo vínculo salvo, pelo **nome igual**,
   ou segue a regra escolhida (padrão: **criar o produto no app automaticamente**).
3. Cadastra o comprador com os produtos comprados.

Notificações repetidas não duplicam nada. Ao mudar um vínculo, dá para aplicar a quem já comprou.
Reembolso, chargeback ou cancelamento removem só o produto do pedido.

## Estrutura

| Pasta/arquivo | O que é |
|---|---|
| `backend/server.py` | Todo o servidor: login, painel, conteúdo, arquivos, Cakto, banco |
| `api/index.py` | Entrada da função na Vercel |
| `dev.py` | Entrada no computador |
| `public/` | App dos membros e painel admin (HTML, CSS, JS) |
| `content/seed.json` | Conteúdo inicial (só na primeira execução) |
| `scripts/migrar_para_vercel.py` | Copia os dados do computador para a Vercel |
| `vercel.json` | Rotas, cabeçalhos de segurança e configuração da função |
| `data/` | Banco e arquivos no computador (não vai para o GitHub nem para a Vercel) |

## Segurança

- Painel admin: senha com hash PBKDF2, bloqueio após 5 tentativas erradas em 15 min, sessão de 12 h,
  cookie `HttpOnly` + `SameSite=Strict`.
- Webhook: só aceita notificações com a chave secreta da Cakto.
- Envio de arquivos: o navegador recebe uma autorização de 15 minutos válida só para aquele arquivo.
- Links salvos pelo painel só aceitam `https://` ou arquivos enviados (bloqueia links `javascript:`).
- O login do membro é só por e-mail: quem souber o e-mail de um comprador consegue entrar como ele.
