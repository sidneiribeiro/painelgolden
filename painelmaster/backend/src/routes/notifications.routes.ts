import { Router } from 'express';
import * as notificationsController from '../controllers/notifications.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);

// Configurações
router.get('/settings', notificationsController.getSettings);
router.put('/settings', notificationsController.updateSettings);

// Logs
router.get('/logs', notificationsController.getLogs);
router.delete('/logs', notificationsController.deleteLogs);

// Stats
router.get('/stats', notificationsController.getStats);

// Testes
router.post('/test-whatsapp', notificationsController.testWhatsApp);
router.post('/test-telegram', notificationsController.testTelegram);

// Executar agora (apenas admin)
router.post('/run-now', requireRole('SUPER_ADMIN', 'ADMIN'), notificationsController.runNow);

// 🚀 NOVO: Campanha de recuperação (apenas admin)
router.post('/recovery-campaign', requireRole('SUPER_ADMIN', 'ADMIN'), notificationsController.sendRecoveryCampaign);

export default router;
