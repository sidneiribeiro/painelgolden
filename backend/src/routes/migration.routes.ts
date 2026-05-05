import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';
import * as migrationController from '../controllers/migration.controller.js';

const router = Router();

// Apenas SUPER_ADMIN pode executar migrações
router.use(authMiddleware);
router.use(requireRole('SUPER_ADMIN'));

// Status da migração
router.get('/status', migrationController.migrationStatus);

// Importar painel PHP (dry-run por padrão)
router.post('/import-php-panel', migrationController.importPhpPanel);

// Corrigir billing dos resellers importados
router.post('/fix-reseller-billing', migrationController.fixResellerBilling);

export default router;
