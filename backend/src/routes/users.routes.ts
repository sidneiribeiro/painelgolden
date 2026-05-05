import { Router } from 'express';
import * as usersController from '../controllers/users.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);

// Grupos de acesso (somente admin)
router.get('/access-groups', requireRole('SUPER_ADMIN', 'ADMIN'), usersController.listAccessGroups);
router.post('/access-groups', requireRole('SUPER_ADMIN', 'ADMIN'), usersController.createAccessGroup);
router.put('/access-groups/:groupId', requireRole('SUPER_ADMIN', 'ADMIN'), usersController.updateAccessGroup);
router.delete('/access-groups/:groupId', requireRole('SUPER_ADMIN', 'ADMIN'), usersController.removeAccessGroup);

// Listagem e CRUD
router.get('/', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER'), usersController.getAll);
router.get('/:id', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER'), usersController.getById);
router.post('/', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER'), usersController.create);
router.put('/:id', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER'), usersController.update);
router.delete('/:id', requireRole('SUPER_ADMIN', 'ADMIN'), usersController.remove);

// Créditos - SUPER_ADMIN, ADMIN e MASTER_RESELLER podem adicionar créditos
router.post('/:id/credits', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), usersController.modifyCredits);
router.get('/:id/transactions', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), usersController.getTransactions);

export default router;
