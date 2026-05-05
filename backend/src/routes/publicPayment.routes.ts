import { Router } from 'express';
import {
  getCustomerByToken,
  generatePixPayment,
  getAvailablePackages,
} from '../controllers/publicPayment.controller.js';
import { asyncHandler } from '../middleware/error.middleware.js';

const router = Router();

// Todas as rotas são públicas (sem autenticação)
router.get('/customer/:token', asyncHandler(getCustomerByToken));
router.get('/packages/:token', asyncHandler(getAvailablePackages));
router.post('/payment/:token', asyncHandler(generatePixPayment));

export default router;

