import { Router } from 'express';
import { asyncHandler } from '../middleware/error.middleware.js';
import { publicCoreCheckoutCreateLimiter, publicCoreCheckoutStatusLimiter } from '../middleware/rateLimit.middleware.js';
import {
  initiateCheckout,
  getCheckoutStatus,
  listPublicPlans,
  listPublicCorePackages,
  getPublicCoreBranding,
  initiateCoreCheckout,
  getCoreCheckoutStatus,
  recreateCoreCheckoutPix,
} from '../controllers/public-checkout.controller.js';

const router = Router();

// ==========================================
// ROTAS PÚBLICAS (sem autenticação)
// ==========================================

// Listar planos premium disponíveis
router.get('/premium-plans', asyncHandler(listPublicPlans));

// Iniciar checkout
router.post('/checkout', asyncHandler(initiateCheckout));

// Consultar status do checkout
router.get('/checkout/:checkoutId', asyncHandler(getCheckoutStatus));

// ==========================================
// CORE (Xtream novo) - ROTAS PÚBLICAS
// ==========================================

router.get('/core/:reseller/packages', asyncHandler(listPublicCorePackages));
router.get('/core/:reseller/branding', asyncHandler(getPublicCoreBranding));
router.post('/core/:reseller/checkout', publicCoreCheckoutCreateLimiter, asyncHandler(initiateCoreCheckout));
router.get('/core/checkout/:token', publicCoreCheckoutStatusLimiter, asyncHandler(getCoreCheckoutStatus));
router.post('/core/checkout/:token/recreate-pix', publicCoreCheckoutCreateLimiter, asyncHandler(recreateCoreCheckoutPix));

router.get('/core/packages', asyncHandler(listPublicCorePackages));
router.get('/core/branding', asyncHandler(getPublicCoreBranding));
router.post('/core/checkout', publicCoreCheckoutCreateLimiter, asyncHandler(initiateCoreCheckout));

export default router;
