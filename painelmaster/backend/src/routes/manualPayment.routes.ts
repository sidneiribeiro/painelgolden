import { Router } from 'express';
import {
  createManualPayment,
  getManualPayments,
  deleteManualPayment,
} from '../controllers/manualPayment.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// Todas as rotas requerem autenticação
router.use(authMiddleware);

router.post('/', createManualPayment);
router.get('/', getManualPayments);
router.delete('/:id', deleteManualPayment);

export default router;

