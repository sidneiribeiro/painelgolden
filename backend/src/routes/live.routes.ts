/**
 * Rotas para importação de canais LIVE
 */

import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';
import { liveController } from '../controllers/live.controller.js';

const router = Router();

// Todas as rotas requerem autenticação
router.use(authMiddleware);

// GET: Recursos
router.get('/servers', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), liveController.getServers);
router.get('/categories', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), liveController.getCategories);
router.get('/bouquets', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), liveController.getBouquets);
router.get('/streams', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), liveController.getStreams);

// BULK: Gestão em massa (LIVE)
router.put(
  '/streams/bulk',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'),
  liveController.bulkUpdateStreams
);
router.delete(
  '/streams/bulk',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'),
  liveController.bulkDeleteStreams
);

// PUT: Gestão de streams (LIVE)
router.put(
  '/streams/:streamId',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'),
  liveController.updateStream
);

// POST: Importação
router.post(
  '/import',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'),
  liveController.importFromM3U
);

router.post(
  '/analyze-m3u',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'),
  liveController.analyzeM3U
);

// POST: Controle de importação
router.post('/import/pause', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), liveController.pauseImport);
router.post('/import/resume', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), liveController.resumeImport);
router.post('/import/cancel', requireRole('SUPER_ADMIN', 'ADMIN', 'MASTER_RESELLER'), liveController.cancelImport);

export default router;
