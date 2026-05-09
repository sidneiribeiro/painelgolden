---
name: "deploy-edge"
description: "Guia de deploy do Balance/Edge (CORE_EDGE_ONLY). Invoke quando for instalar/subir balances, configurar NGINX, health/metrics e validar em produção."
---

# Deploy Edge (Balance)

Use este skill quando o usuário pedir para:
- instalar balances via SSH
- subir o backend em modo edge
- configurar NGINX para proxy de streaming
- validar health/metrics e portas (80/443/3001)

## Requisitos do Balance

- Linux (Ubuntu recomendado)
- Portas liberadas (mínimo): 80 e/ou 443
- Porta interna do backend edge: 3001 (localhost)

## Backend no Edge

Variáveis mínimas:
- `CORE_EDGE_ONLY=true`
- `PORT=3001`
- `DATABASE_URL=...` (mesmo Postgres do Main)

Opcional (recomendado para proteger métricas):
- `EDGE_TOKEN=...`

Endpoints de validação:
- `GET /api/health` (backend)
- `GET /api/edge/metrics` (backend, exige header `x-edge-token` se `EDGE_TOKEN` estiver setado)

## NGINX no Edge

Objetivo:
- `GET /health` retorna `OK`
- `location /` faz proxy para `http://127.0.0.1:3001`

Checklist rápido:
- `nginx -t` OK
- `systemctl restart nginx`
- `curl http://SEU_BALANCE/health`
- `curl http://SEU_BALANCE/api/health`

## Problemas comuns

- **OFFLINE/timeout**: firewall/porta errada/host errado no cadastro
- **Métricas 403**: token do edge não bate (EDGE_TOKEN vs x-edge-token)
- **Redirecionamento em loop**: edge não deve redirecionar (confirmar `CORE_EDGE_ONLY=true`)

