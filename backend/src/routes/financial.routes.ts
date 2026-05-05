import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { getFinancialStats } from '../controllers/financial.controller.js';

const router = Router();

// Todas as rotas requerem autenticação
router.use(authMiddleware);

router.get('/', getFinancialStats);

export default router;

