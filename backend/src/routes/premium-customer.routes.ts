import { Router } from 'express';
import { asyncHandler } from '../middleware/error.middleware.js';
import {
  loginCustomer,
  getCustomerDashboard,
  getSourceDetails,
  listUpgradePlans,
  updateCustomerProfile,
  authenticateCustomer,
  getSourceConnections,
  updateSourcePassword,
  createUpgradeCheckout,
} from '../controllers/premium-customer.controller.js';

const router = Router();

// ==========================================
// ROTAS PÚBLICAS (sem autenticação)
// ==========================================

// Login do cliente
router.post('/login', asyncHandler(loginCustomer));

// ==========================================
// ROTAS PROTEGIDAS (requer autenticação)
// ==========================================

// Dashboard do cliente (dados + fontes)
router.get('/dashboard', authenticateCustomer, asyncHandler(getCustomerDashboard));

// Detalhes de uma fonte
router.get('/sources/:sourceId', authenticateCustomer, asyncHandler(getSourceDetails));

// Listar planos para upgrade/downgrade
router.get('/sources/:sourceId/upgrade-plans', authenticateCustomer, asyncHandler(listUpgradePlans));

// Monitoramento de conexões em tempo real
router.get('/sources/:sourceId/connections', authenticateCustomer, asyncHandler(getSourceConnections));

// Editar senha da fonte
router.put('/sources/:sourceId/password', authenticateCustomer, asyncHandler(updateSourcePassword));

// Criar checkout de upgrade/downgrade
router.post('/sources/:sourceId/upgrade', authenticateCustomer, asyncHandler(createUpgradeCheckout));

// Atualizar perfil do cliente
router.put('/profile', authenticateCustomer, asyncHandler(updateCustomerProfile));

export default router;
