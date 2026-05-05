import { Router } from 'express';
import * as customersController from '../controllers/customers.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { createCustomerLimiter } from '../middleware/rateLimit.middleware.js';
import { billingMiddleware, requireBillingValid } from '../middleware/billingMiddleware.js';

const router = Router();

// Todas as rotas são protegidas
router.use(authMiddleware);
router.use(billingMiddleware);

// Listagem (permitido mesmo bloqueado - visualização)
router.get('/', customersController.listCustomers);
router.get('/expiring', customersController.getExpiringCustomers);
router.get('/live', customersController.getLiveConnections);

// Criar cliente (com pacote) - BLOQUEADO se vencido/sem créditos
router.post('/', requireBillingValid, createCustomerLimiter, customersController.createCustomer);

// Criar teste rápido - BLOQUEADO se vencido/sem créditos
router.post('/trial', requireBillingValid, createCustomerLimiter, customersController.createTrial);

// Importar clientes do SIGMA
router.post('/import-sigma', requireBillingValid, customersController.importSigmaCustomers);

// Exportar/Importar/Sincronizar clientes
router.post('/export', customersController.exportCustomers);
router.post('/import', requireBillingValid, customersController.importCustomers);
router.post('/sync-to-xui', customersController.syncCustomersToXui);

// Operações em cliente específico
router.get('/:serverId/:id', customersController.getCustomer);
router.get('/:serverId/:id/playlist', customersController.getPlaylist);
router.put('/:serverId/:id', customersController.updateCustomer);
router.post('/:serverId/:id/renew', requireBillingValid, customersController.renewCustomer);
router.post('/:serverId/:id/renew-trial', requireBillingValid, customersController.renewTrial);
router.post('/:serverId/:id/block', customersController.blockCustomer);
router.post('/:serverId/:id/unblock', customersController.unblockCustomer);
router.delete('/:serverId/:id', customersController.deleteCustomer);

export default router;
