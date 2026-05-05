import { Router } from 'express';
import { asyncHandler } from '../middleware/error.middleware.js';
import { getPublicPremiumPlans, getPublicPlanDetails, requestTestAccess } from '../controllers/public-premium.controller.js';

const router = Router();

// ==========================================
// ROTAS PÚBLICAS (sem autenticação)
// ==========================================

// Listar todos os planos premium disponíveis
router.get('/premium-plans', asyncHandler(getPublicPremiumPlans));

// Detalhes de um plano específico
router.get('/premium-plans/:planId', asyncHandler(getPublicPlanDetails));

// Solicitar teste gratuito
router.post('/test-request', asyncHandler(requestTestAccess));

export default router;
