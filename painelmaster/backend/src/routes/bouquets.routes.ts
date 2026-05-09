import { Router } from 'express';
import * as bouquetsController from '../controllers/bouquets.controller.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);

// Listagem
router.get('/', bouquetsController.getAll);
router.get('/server/:serverId', bouquetsController.getByServer);
router.get('/for-select/:serverId', bouquetsController.getForSelect);

// Sincronização (apenas admin)
router.post('/sync/:serverId', requireRole('SUPER_ADMIN', 'ADMIN'), bouquetsController.sync);

router.get('/xui/:serverId/:bouquetId/items', requireRole('SUPER_ADMIN', 'ADMIN'), bouquetsController.getXuiBouquetItems);
router.put('/xui/:serverId/:bouquetId/order', requireRole('SUPER_ADMIN', 'ADMIN'), bouquetsController.updateXuiBouquetOrder);

export default router;
