---
name: "xc-debug"
description: "Debug de Xtream Codes (XC) e streaming. Invoke quando playback falhar, HLS/m3u8 quebrar, redirecionamento edge/main ou limite de conexões/IP."
---

# XC Debug (Playback)

Use este skill quando o usuário pedir para:
- corrigir play (live/movie/series/timeshift)
- diagnosticar HLS/m3u8 e proxy
- validar redirecionamento Main → Edge
- investigar limite de conexões/IP e sessões ativas

## Checklist do Play

1) Confirmar rota:
- `/get.php` e `/player_api.php` funcionando
- `/live/{u}/{p}/{id}.{ext}`
- `/timeshift/{u}/{p}/{duration}/{start}/{id}.{ext}`

2) Se usa Edge:
- Main deve redirecionar (302) quando `CORE_EDGE_ONLY=false`
- Edge deve servir (proxy) quando `CORE_EDGE_ONLY=true`

3) Testes rápidos (sem expor senha)
- Testar `/api/health` e `/health`
- Testar 1 stream com `.ts` e 1 com `.m3u8`

## HLS/m3u8

- O backend reescreve playlists para `/hls/{sessionId}?u=...`
- Erros comuns:
  - upstream bloqueando origin/headers
  - playlist com URLs relativas mal resolvidas

## Conexões e Sessões

- Sessões ativas são controladas por `corePlaybackSession`
- Verificar:
  - `activeOnly=true`
  - `contentType=live`
  - `serverHost` para saber qual balance atendeu

