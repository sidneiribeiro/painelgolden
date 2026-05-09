import { Router } from 'express';
import * as packagesLocalController from '../controllers/packagesLocal.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);

// Listagem
router.get('/', packagesLocalController.getAll);
router.get('/for-select', packagesLocalController.getForSelect);
router.get('/trials', packagesLocalController.getTrials);
router.get('/:id', packagesLocalController.getById);

// CRUD - qualquer usuário autenticado pode criar seus próprios pacotes;
// limites de conexões e ownership são validados no controller.
router.post('/', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER'), packagesLocalController.create);
router.put('/:id', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER'), packagesLocalController.update);
router.delete('/:id', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER', 'RESELLER'), packagesLocalController.remove);

export default router;
