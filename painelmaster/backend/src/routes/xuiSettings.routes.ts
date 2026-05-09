import { Router } from 'express';
import * as xuiSettingsController from '../controllers/xuiSettings.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);

// Listagem
router.get('/', xuiSettingsController.getAll);
router.get('/:id', xuiSettingsController.getById);

// CRUD (apenas admin)
router.post('/', requireRole('SUPER_ADMIN', 'ADMIN'), xuiSettingsController.create);
router.put('/:id', requireRole('SUPER_ADMIN', 'ADMIN'), xuiSettingsController.update);
router.delete('/:id', requireRole('SUPER_ADMIN', 'ADMIN'), xuiSettingsController.remove);

// Ações
router.post('/test-connection', requireRole('SUPER_ADMIN', 'ADMIN'), xuiSettingsController.testConnection);
router.get('/:id/test', requireRole('SUPER_ADMIN', 'ADMIN'), xuiSettingsController.testServerConnection);
router.post('/:id/create-reseller', requireRole('SUPER_ADMIN', 'ADMIN'), xuiSettingsController.createReseller);
router.post('/:id/sync', requireRole('SUPER_ADMIN', 'ADMIN'), xuiSettingsController.syncServer);
router.post('/:id/toggle', requireRole('SUPER_ADMIN', 'ADMIN'), xuiSettingsController.toggleActive);

export default router;

