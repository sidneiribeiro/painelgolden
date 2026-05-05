import { Router } from 'express';
import * as serversController from '../controllers/servers.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/balancer/jobs/:jobId', requireRole('SUPER_ADMIN', 'ADMIN'), serversController.getBalancerJob);
router.post('/balancer/jobs/:jobId/cancel', requireRole('SUPER_ADMIN', 'ADMIN'), serversController.cancelBalancerJob);
router.get('/', serversController.listServers);
router.get('/status', serversController.getServersStatus);
router.post('/:id/balancer/install', requireRole('SUPER_ADMIN', 'ADMIN'), serversController.installBalancer);
router.get('/:id/bouquets', serversController.getServerBouquets);
router.get('/:id/content', serversController.getServerContent);

export default router;
