import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { requireBillingValid, allowReadOnly } from '../middleware/billingMiddleware.js';
import {
  getBillingInfo,
  updateUserBilling,
  renewUserAccess,
  getBillingReport,
  exportBillingReport
} from '../controllers/billingController.js';

const router = Router();

// Rotas que precisam de autenticação
router.use(authMiddleware);

// Informações de cobrança do usuário logado
router.get('/info', getBillingInfo);

// Rotas apenas para MASTER/ADMIN
router.post('/users/:id', updateUserBilling);
router.post('/users/:id/renew', renewUserAccess);
router.get('/report/export', exportBillingReport);
router.get('/report', getBillingReport);

export default router;
