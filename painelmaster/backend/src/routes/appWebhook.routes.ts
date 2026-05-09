import { Router } from 'express';
import * as appWebhookController from '../controllers/appWebhook.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// ==========================================
// ROTAS PÚBLICAS (sem autenticação JWT)
// ==========================================

// Endpoint principal para criar teste via app externo
// O app autentica via Bearer token no header
router.post('/create-test', appWebhookController.createTestFromApp);

// ==========================================
// ROTAS PROTEGIDAS (requer autenticação JWT)
// ==========================================

// Gerenciamento de configurações
router.get('/config', authMiddleware, appWebhookController.listConfigs);
router.post('/config', authMiddleware, appWebhookController.createConfig);
router.put('/config/:id', authMiddleware, appWebhookController.updateConfig);
router.delete('/config/:id', authMiddleware, appWebhookController.deleteConfig);
router.post('/config/:id/regenerate-token', authMiddleware, appWebhookController.regenerateToken);

// Logs de requisições
router.get('/logs', authMiddleware, appWebhookController.listLogs);

export default router;
