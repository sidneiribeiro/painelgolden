# PainelMaster

Painel completo de gerenciamento de IPTV integrado a servidores **XUI ONE** e **Xtream UI**, com cobrança PIX via ASAAS, notificações por WhatsApp/Telegram/Email, sincronização de VOD com TMDB, marketing automatizado (banners e vídeos), jogos do dia e portal premium para clientes.

## Sumário
1. [Requisitos](#requisitos)
2. [Instalação rápida](#instalação-rápida)
3. [Instalação manual](#instalação-manual)
4. [Variáveis de ambiente](#variáveis-de-ambiente)
5. [Arquitetura](#arquitetura)
6. [Primeiro acesso](#primeiro-acesso)
7. [Operação](#operação)
8. [Backup e restore](#backup-e-restore)
9. [Atualização](#atualização)
10. [Solução de problemas](#solução-de-problemas)

## Requisitos
- **VPS** Ubuntu 20.04/22.04/24.04 ou Debian 11/12
- **2 vCPU**, **4 GB RAM**, **30 GB disco** (mínimo recomendado)
- Portas **80/443** abertas
- **Domínio** apontado para o IP da VPS (recomendado para SSL)

## Instalação rápida
```bash
# 1. Baixar o pacote para a VPS
scp painelmaster-vX.Y.Z.tar.gz root@SEU-IP:/opt/
ssh root@SEU-IP
cd /opt && tar xzf painelmaster-vX.Y.Z.tar.gz && cd painelmaster

# 2. Instalador automático (pede domínio, email e credenciais)
sudo bash install.sh

# 2b. Instalação sem perguntas, com SSL
sudo DOMAIN=painel.cliente.com EMAIL=admin@cliente.com \
     bash install.sh --non-interactive --ssl
```

O instalador:
- Instala Docker Engine + Compose
- Gera `.env` com secrets aleatórios seguros
- Sobe `postgres`, `redis`, `backend`, `frontend`
- Configura `nginx` de host + SSL (opcional via certbot)
- Cria o usuário **SUPER_ADMIN** inicial (senha exibida ao final)

## Instalação manual
```bash
cp .env.example .env
# Edite .env: domínio, secrets (openssl rand -hex 32), credenciais admin
# Dica: ajuste COMPOSE_PROJECT_NAME no .env para não conflitar com outros projetos no mesmo servidor
docker compose build
docker compose up -d
```

## Instalação local (Windows/Mac)
Pré-requisito: Docker Desktop (com Docker Compose v2).

PowerShell (na pasta `painelmaster/`):
```powershell
Copy-Item .env.example .env
# Edite o .env (pelo menos: POSTGRES_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY,
# FRONTEND_URL, API_URL, ALLOWED_ORIGINS, SEED_ADMIN_*)
docker compose build
docker compose up -d
```

Acessos locais:
- Frontend: `http://localhost:8080`
- Healthcheck da API: `http://localhost:3001/api/health` (ou `http://localhost:8080/api/health`)

## Variáveis de ambiente
Arquivo único `.env` na raiz (todas descritas em `.env.example`).

### Obrigatórias
| Variável | Descrição |
|---|---|
| `POSTGRES_PASSWORD` | Senha do PostgreSQL containerizado |
| `DATABASE_URL` | `postgresql://USER:PASS@postgres:5432/DB?schema=public` |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Segredos JWT (32+ bytes hex) |
| `ENCRYPTION_KEY` | Chave para cifrar credenciais no banco (32 chars) |
| `FRONTEND_URL`, `API_URL` | URLs públicas finais |
| `ALLOWED_ORIGINS` | Lista CSV de origins permitidos no CORS |
| `SEED_ADMIN_USERNAME/EMAIL/PASSWORD` | SUPER_ADMIN inicial |
| `VITE_API_URL` | URL da API usada no bundle do frontend (normalmente `/api`) |

### Opcionais
Todas as integrações (ASAAS, BotBot WhatsApp, Telegram, SMTP, TMDB, XUI) podem ficar vazias e serem configuradas depois pela UI, por usuário.

## Arquitetura
```
Navegador → nginx (host, 80/443) → frontend:8080 (SPA)
                                 → backend:3001 (Express + Prisma + Socket.io)
                                            ↓
                                  ┌─────────┴─────────┐
                                postgres:5432    redis:6379
                                  (painel)        (cache)

Backend também conecta a:
- MySQL remoto dos servidores XUI (para VOD e streams)
- APIs externas: TMDB, ASAAS, BotBot, Telegram, API-Football
```

## Stack técnica
- **Backend**: Node.js 20 + TypeScript + Express + Prisma + Socket.io
- **Frontend**: React 18 + TypeScript + Vite + Tailwind + Zustand + React Query
- **Banco**: PostgreSQL 16 (Prisma)
- **Cache**: Redis 7
- **Infra**: Docker Compose + nginx + (opcional) certbot

## Primeiro acesso
1. Acesse `https://SEU-DOMINIO` (ou `http://IP` se sem SSL)
2. Login com o usuário/senha exibidos pelo `install.sh`
3. Troque a senha em `Configurações → Meu perfil`
4. Cadastre o servidor XUI em `Configurações → XUI Connection`
5. Importe pacotes e bouquets
6. (Opcional) Configure ASAAS em `Configurações → ASAAS` para cobrança PIX

## Operação
```bash
# Status
docker compose ps

# Logs em tempo real
docker compose logs -f backend
docker compose logs -f frontend

# Acessar shell do PostgreSQL
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB

# Prisma Studio (dev)
docker compose exec backend npx prisma studio
```

## Backup e restore
Scripts incluídos:
```bash
sudo bash backup.sh             # dump do banco + uploads
sudo bash backup-completo.sh    # + imagens + configs
sudo bash restore.sh <arquivo>  # restaurar
```

## Atualização
```bash
cd /opt/painelmaster
git pull                # ou substituir arquivos do novo pacote
docker compose build
docker compose up -d
# As migrations do Prisma rodam automaticamente no start (db push).
```

## Solução de problemas

**Backend não sobe**
```bash
docker compose logs backend | tail -100
```
Geralmente é `DATABASE_URL` incorreta ou porta 5432 ocupada.

**Frontend em branco**
Rebuildar com a `VITE_API_URL` correta:
```bash
docker compose build --no-cache frontend
docker compose up -d frontend
```

**CORS bloqueado**
Adicione a origin em `ALLOWED_ORIGINS` (CSV) no `.env` e reinicie o backend.

**Certbot falhou**
```bash
certbot --nginx -d painel.cliente.com
systemctl reload nginx
```

## Estrutura do projeto
```
painelmaster/
├── backend/                  # API Node.js/TypeScript
│   ├── src/
│   │   ├── controllers/      # handlers HTTP
│   │   ├── routes/           # rotas Express
│   │   ├── services/         # XUI, ASAAS, WhatsApp, VOD, etc
│   │   ├── middleware/       # auth, rate limit, erro
│   │   ├── jobs/             # scheduler (cron)
│   │   └── config/           # env, database, XUI
│   ├── prisma/
│   │   ├── schema.prisma     # 34 models
│   │   └── seed.ts           # seed do SUPER_ADMIN
│   └── Dockerfile
├── frontend/                 # SPA React
│   ├── src/
│   │   ├── pages/            # todas as telas
│   │   ├── components/
│   │   ├── api/
│   │   ├── store/            # Zustand
│   │   └── App.tsx
│   ├── nginx.conf
│   └── Dockerfile
├── docker-compose.yml
├── install.sh                # instalador completo
├── backup.sh / restore.sh
├── .env.example
└── README.md
```

## Licença
Proprietário — uso exclusivo mediante contrato.
