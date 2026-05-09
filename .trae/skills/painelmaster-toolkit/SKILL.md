---
name: "painelmaster-toolkit"
description: "Toolkit do PainelMaster/Xtream Novo: deploy, edge/balances, Prisma/DB e troubleshooting. Invoke quando precisar montar/instalar balances, publicar, ou diagnosticar streams/metrics."
---

# PainelMaster Toolkit (Xtream Novo)

Use este skill quando o usuário pedir para:
- continuar a “montagem” do Xtream Novo
- instalar/configurar balances (edge)
- preparar deploy/produção
- diagnosticar playback/streams, conexões, métricas, ON/OFF, etc.

## Checklist rápido (Main vs Edge)

**Main (painel completo)**
- Sobe o frontend/backend completo.
- Tem rotas `/api/*` e também Xtream em raiz (`/get.php`, `/player_api.php`, `/live/...`, etc).

**Edge (balance)**
- Backend em modo edge: `CORE_EDGE_ONLY=true`
- NGINX recebe o tráfego público e faz proxy para `http://127.0.0.1:3001`
- Health: `GET /health` (NGINX) e `GET /api/health` (backend)
- Métricas: `GET /api/edge/metrics` (backend)

## Deploy do Edge (balance)

**Objetivo**: o cliente tocar a URL do canal no balance, e o balance proxiar o stream.

1) NGINX (via painel / instalação SSH)
- Confirma que está respondendo:
  - `http://SEU_BALANCE/health` → `OK`

2) Subir backend no balance
- Variáveis mínimas:
  - `CORE_EDGE_ONLY=true`
  - `PORT=3001`
  - `DATABASE_URL=...` (mesmo banco do Main, se for centralizado)
  - (opcional) `EDGE_TOKEN=...` (se você quiser proteger `/api/edge/metrics`)

3) Validar edge
- `http://SEU_BALANCE/api/health`
- `http://SEU_BALANCE/api/edge/metrics` (se tiver token, enviar `x-edge-token`)

## Prisma / Banco

Quando houver mudanças em models (streams/servers/sessions):
- Rodar no ambiente com Node/npm:
  - `prisma generate`
  - `prisma db push`

## Fluxo Xtream2024-like (Streams → Servidores)

1) Cadastrar servidores (balances)
2) Instalar o balance (marca como instalado no painel)
3) Vincular servidores em cada Stream (ou deixar vazio para “usar todos”)
4) Playback:
   - Main pode redirecionar para edge (302) quando `CORE_EDGE_ONLY=false`
   - Edge faz proxy de verdade quando `CORE_EDGE_ONLY=true`

## Diagnóstico rápido

**Edge aparece OFFLINE**
- Checar `/health` e `/api/health` no host/porta corretos
- Verificar firewall/portas (80/443/3001)

**Métricas vazias**
- Verificar `EDGE_TOKEN` (se configurado) e header `x-edge-token`
- Verificar se o edge está rodando com `CORE_EDGE_ONLY=true`

**Fluxos ON/OFF**
- ON: sessões ativas com ping recente
- OFF: sessões “stale” (sem ping recente, mas ainda não encerradas)

