# Changelog

## v2.0.2 (2026-04-21)

### Correções de Permissões (MASTER_RESELLER / RESELLER)
- **Frontend** — `RoleProtectedRoute` agora aceita prop `menuKey` e libera acesso
  quando MASTER_RESELLER/RESELLER tem a chave em `menuPermissions`.
- **Frontend** — `App.tsx`: rotas de Pagamento Asaas, Backups, Financeiro,
  Relatório de Cobrança, Hierarquia, Notificações, Marketing e VOD Sources
  passaram a respeitar `menuPermissions`.
- **Frontend** — `Sidebar.tsx`: novo `DEFAULT_MASTER_RESELLER_KEYS` (menu padrão
  para master revenda sem permissões customizadas). Itens Pacotes, Asaas,
  Backups, Importar SIGMA incluem MASTER_RESELLER nos roles.
- **Backend** — `auth.controller.ts`: endpoint de login agora retorna
  `menuPermissions` e `canCreateResellers` no payload do usuário.
- **Backend** — Rotas `backup`, `packagesLocal`, `marketing` liberadas para
  MASTER_RESELLER no `requireRole`.
- **Backend** — `packagesLocal.controller.ts`: removidas referências ao campo
  inexistente `ownerId` que causava `PrismaClientValidationError`.

### Correções de Bugs
- **Frontend** — `HierarchicalView.tsx`: corrigido crash
  *"Cannot read properties of null (reading 'charAt')"* quando `user.name` é
  null; usa `username` como fallback.
- **Backend** — `jogos-do-dia.controller.ts` e `football.controller.ts`:
  corrigido erro *"Unknown column 'is_adult' in 'field list'"* ao criar
  categoria no XUI; agora inspeciona `SHOW COLUMNS` e inclui a coluna
  `is_adult` apenas se existir.

### Backup MySQL
- **Backend** — `backup.service` / `Dockerfile`: instalado `default-mysql-client`
  e ajustado script para suportar backup via `mysqldump` (antes só SQLite).

## v2.0.1 (2026-04-21)
- Versão inicial com instalador `install.sh` automatizado.

## v2.0.3 (2026-04-21)

### Isolamento de Pacotes por Dono (Ownership)
- **Schema** — `Package` ganhou campo `ownerId` (opcional) + relação `owner` com `User`.
- **Backend** — `packagesLocal.controller.ts` aplica filtro de visibilidade por role:
  - SUPER_ADMIN/ADMIN veem todos os pacotes.
  - MASTER_RESELLER vê apenas os seus próprios.
  - RESELLER vê os seus + os do MASTER pai (somente leitura).
- **Backend** — ao criar pacote, `ownerId = userId` automaticamente.
- **Backend** — `update` e `remove` retornam 403 se o usuário não for dono.
- **Backend** — MASTER_RESELLER e RESELLER estão limitados a `connections ≤ 2` e
  `maxConnections ≤ 2` (validação no controller).
- **Frontend** — `PackagesPage.tsx`: respeita `canEdit` vindo do backend
  (botões Editar/Excluir escondidos e badge "Somente leitura" em pacotes
  do Master). Inputs de conexões limitados a 2 quando usuário é revenda.
- **Rotas** — `POST/PUT/DELETE /api/packages-local` liberadas também para RESELLER
  (validações de ownership/limite ficam no controller).
- **Migração** — aplicar com `docker exec painelmaster-backend npx prisma db push`
  após subir o backend novo. Pacotes existentes ficam com `ownerId = NULL`
  (considerados do sistema, visíveis só para SUPER_ADMIN/ADMIN).
