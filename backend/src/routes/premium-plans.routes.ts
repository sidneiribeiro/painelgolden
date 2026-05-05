import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../middleware/error.middleware.js';
import {
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  getPlan,
} from '../controllers/premium-plans.controller.js';

const router = Router();

// ==========================================
// ROTAS PROTEGIDAS (com autenticação)
// ==========================================
router.use(authMiddleware);

// CRUD de planos premium
router.get('/', asyncHandler(listPlans));
router.post('/', asyncHandler(createPlan));
router.get('/:id', asyncHandler(getPlan));
router.put('/:id', asyncHandler(updatePlan));
router.delete('/:id', asyncHandler(deletePlan));

export default router;
