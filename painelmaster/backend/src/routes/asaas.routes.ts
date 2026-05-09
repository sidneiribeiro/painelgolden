import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  getConfig,
  saveConfig,
  testConnection,
  createPayment,
  listPayments,
  getQrCode,
  getPaymentPage,
} from '../controllers/asaas.controller.js';
import { handleAsaasWebhook } from '../webhooks/asaas.webhook.js';
import { asyncHandler } from '../middleware/error.middleware.js';

const router = Router();

// ==========================================
// ROTAS PÚBLICAS (sem autenticação)
// ==========================================

// Webhook do Asaas
router.post('/webhook/:token', asyncHandler(handleAsaasWebhook));

// Página de pagamento pública
router.get('/pay/:token', asyncHandler(getPaymentPage));

// ==========================================
// ROTAS PROTEGIDAS (com autenticação)
// ==========================================

router.use(authMiddleware);

// Configuração
router.get('/config', asyncHandler(getConfig));
router.post('/config', asyncHandler(saveConfig));
router.post('/test', asyncHandler(testConnection));

// Cobranças
router.post('/payments', asyncHandler(createPayment));
router.get('/payments/:customerId', asyncHandler(listPayments));
router.get('/payments/:id/qrcode', asyncHandler(getQrCode));

export default router;

