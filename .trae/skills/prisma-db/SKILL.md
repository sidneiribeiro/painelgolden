---
name: "prisma-db"
description: "Prisma/Postgres no PainelMaster. Invoke quando mudar schema.prisma, precisar db push/generate, ou diagnosticar erro de tabela/coluna em produção."
---

# Prisma DB (Postgres)

Use este skill quando o usuário pedir para:
- adicionar/alterar models no Prisma
- aplicar mudanças no banco (sem migrations)
- resolver erro de tabela/coluna faltando

## Fluxo padrão do projeto

Este projeto costuma usar:
- `prisma db push` (aplica schema no banco)
- `prisma generate` (gera client)

## Checklist após mudanças no schema

1) Garantir `DATABASE_URL` correto no ambiente
2) Rodar:
- `prisma generate`
- `prisma db push`

3) Reiniciar backend

## Diagnóstico rápido

- Erro “table does not exist”:
  - db push não rodou no ambiente
  - DATABASE_URL aponta para outro banco

- Erro “Unknown arg”/tipos:
  - generate não rodou
  - build está usando client antigo

## Boas práticas

- Não logar `DATABASE_URL` nem segredos
- Em produção, rodar db push somente com manutenção planejada

